'use strict';
/*
 * GENOE — VEIN-H: real macOS Safari h2 HEADERS frame (S14/S12 header blade)
 * ---------------------------------------------------------------------------
 * 1. Generates a per-run self-signed cert (SAN localhost/127.0.0.1/::1) and
 *    trusts it in the SYSTEM keychain (sudo) so Safari accepts it.
 * 2. Serves an HTTP/2 (ALPN h2) HTTPS endpoint via Node http2.
 * 3. Safari is driven to it with safaridriver; the server records the first
 *    request's pseudo-header ORDER and the measured header field set.
 * 4. That measured order is decoded into the JA4H code and checked against
 *    the declared mspa.safari -> this is a MEASURED header-blade gene.
 *
 * Exit: 0 = captured and order matched or at least captured
 *      >5 = failure (workflow treats as FAIL; seal runs via always()).
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http2 = require('http2');

const PORT = 10906;
const LABEL = 'vein-h-macos';
const OUTDIR = path.join(__dirname, 'receipts');
const mspa = require('./mspa.js');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function certFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genoe-h2-'));
  const key = path.join(dir, 'key.pem');
  const crt = path.join(dir, 'crt.pem');
  const ext = path.join(dir, 'san.cnf');
  fs.writeFileSync(ext, `[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=localhost\n[v3]\nsubjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`);
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', crt, '-config', ext]);
  if (r.status !== 0) { console.error('VEIN-H FAIL openssl ' + (r.stderr || '').toString()); process.exit(11); }
  return { key, crt };
}

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const { key, crt } = certFiles();
  const trust = spawnSync('sudo', ['security', 'add-trusted-cert', '-d', '-r', 'trustRoot', '-k', '/Library/Keychains/System.keychain', crt]);
  if (trust.status !== 0) { console.error('VEIN-H FAIL keychain trust: ' + (trust.stderr || '').toString()); process.exit(12); }

  const server = http2.createSecureServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt), allowHTTP1: false });
  let captured = null;

  server.on('request', (req, res) => {
    if (!captured) {
      captured = {
        at: new Date().toISOString(),
        alpn: 'h2 (http2 ALPN) ' + (req.stream.session.alpnProtocol || ''),
        remote: req.socket.remoteAddress,
        headers: req.headers,
        order: Object.keys(req.headers),
      };
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('GENOE h2 blade captured');
  });

  await new Promise((resolve, reject) => { server.on('error', reject); server.listen(PORT, resolve); });

  spawnSync('sudo', ['safaridriver', '--enable'], { stdio: 'ignore' });
  const drv = spawn('safaridriver', ['-p', '4444'], { stdio: 'ignore' });
  await delay(3500);
  try {
    const ses = await fetch('http://127.0.0.1:4444/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: 'safari' } } }),
    }).then((r) => r.json());
    const sid = ses && ses.value && ses.value.sessionId;
    if (!sid) throw new Error('no session');
    await fetch('http://127.0.0.1:4444/session/' + sid + '/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://localhost:' + PORT + '/blade' }),
    });
    await delay(6000);
    await fetch('http://127.0.0.1:4444/session/' + sid, { method: 'DELETE' }).catch(() => {});
  } catch (e) {
    console.error('VEIN-H FAIL drive ' + e.message);
    try { drv.kill('SIGTERM'); } catch (_) {}
    spawnSync('killall', ['Safari'], { stdio: 'ignore' });
    server.close();
    process.exit(13);
  }
  try { drv.kill('SIGTERM'); } catch (_) {}
  spawnSync('killall', ['Safari'], { stdio: 'ignore' });

  await delay(1000);
  if (!captured) { console.error('VEIN-H FAIL no request captured'); server.close(); process.exit(14); }
  server.close();

  // JA4H code from measured pseudo-header order (m=:method s=:scheme p=:path a=:authority)
  const h2Code = measuredOrderCode(captured.order);
  const declared = mspa.H2_ORDER.safari;
  const doc = {
    label: LABEL,
    at: captured.at,
    platform: 'macOS',
    source: 'measured',
    alpn: captured.alpn,
    order: captured.order,
    h2Code,
    matchesDeclared: h2Code === declared.code,
    headers: captured.headers,
  };
  fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log('VEIN-H measured macOS Safari h2 HEADERS');
  console.log('  order = ' + captured.order.join(' , '));
  console.log('  jA4h code = ' + h2Code + '  (declared safari=' + declared.code + ' ' + (h2Code === declared.code ? 'MATCH' : 'MISMATCH') + ')');
  console.log('  ua = ' + (captured.headers['user-agent'] || '-'));
  console.log('  sec-ch-ua = ' + (captured.headers['sec-ch-ua'] || 'ABSENT (Safari, honest)'));
  console.log('  accept-language = ' + (captured.headers['accept-language'] || '-'));
  console.log('  sec-fetch = ' + [captured.headers['sec-fetch-mode'], captured.headers['sec-fetch-site'], captured.headers['sec-fetch-dest']].filter(Boolean).join(' '));
  process.exit(0);
}

function measuredOrderCode(keys) {
  const map = { ':method': 'm', ':scheme': 's', ':path': 'p', ':authority': 'a' };
  return keys.filter((k) => map[k]).map((k) => map[k]).join('').slice(0, 4) || '';
}

main().catch((e) => { console.error('VEIN-H UNHANDLED ' + e.message); process.exit(15); });