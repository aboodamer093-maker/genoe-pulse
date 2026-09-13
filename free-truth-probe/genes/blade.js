'use strict';
/*
 * GENOE — H2 BLADE (shared): per-engine HEADERS-frame capture server.
 * ---------------------------------------------------------------------------
 * Generates + system-trusts a per-run self-signed cert (SAN localhost), serves
 * HTTP/2 (ALPN h2), records the FIRST request's pseudo-header ORDER and the
 * measured header field set. The driving vein chooses the engine transport.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http2 = require('http2');

let _certCache = null;

function trustCert() {
  // one cert per process (workflow runs each vein as its own node process)
  if (_certCache && fs.existsSync(_certCache.crt)) return _certCache;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genoe-h2-'));
  const key = path.join(dir, 'key.pem');
  const crt = path.join(dir, 'crt.pem');
  const ext = path.join(dir, 'san.cnf');
  fs.writeFileSync(ext, `[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=localhost\n[v3]\nsubjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`);
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', crt, '-config', ext]);
  if (r.status !== 0) throw new Error('openssl cert gen: ' + (r.stderr || '').toString());
  const trust = spawnSync('sudo', ['security', 'add-trusted-cert', '-d', '-r', 'trustRoot', '-k', '/Library/Keychains/System.keychain', crt]);
  if (trust.status !== 0) throw new Error('keychain trust: ' + (trust.stderr || '').toString());
  _certCache = { key, crt };
  return _certCache;
}

function measuredOrderCode(keys) {
  const map = { ':method': 'm', ':scheme': 's', ':path': 'p', ':authority': 'a' };
  return keys.filter((k) => map[k]).map((k) => map[k]).join('').slice(0, 4) || '';
}

function startBlade({ port, timeoutMs = 60000 } = {}) {
  const { key, crt } = trustCert();
  const server = http2.createSecureServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt), allowHTTP1: false });
  let captured = null;
  let resolveCap;
  const capturedPromise = new Promise((r) => { resolveCap = r; });

  server.on('request', (req, res) => {
    if (!captured) {
      captured = {
        at: new Date().toISOString(),
        alpn: req.stream.session.alpnProtocol || '',
        remote: req.socket.remoteAddress,
        headers: req.headers,
        order: Object.keys(req.headers),
      };
      resolveCap(captured);
      setTimeout(() => { try { server.close(); } catch (_) {} }, 300);
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('GENOE h2 blade captured');
  });
  server.on('error', (e) => { if (!captured) resolveCap(null); });

  const listenP = new Promise((res, rej) => { server.once('error', rej); server.listen(port, res); });

  let settled = false;
  const wait = () => new Promise((res) => {
    const t = setTimeout(() => { settled = true; res(null); }, timeoutMs);
    capturedPromise.then((v) => { if (!settled) { settled = true; clearTimeout(t); res(v); } }).catch(() => {});
  });

  return {
    server,
    listenP,
    wait,
    close() { try { server.close(); } catch (_) {} },
  };
}

module.exports = { trustCert, measuredOrderCode, startBlade };