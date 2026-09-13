'use strict';
/*
 * GENOE — VEIN-H SAFARI: real macOS Safari h2 HEADERS frame.
 * Drives Safari via safaridriver against the shared h2 blade.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startBlade, measuredOrderCode } = require('./blade.js');
const mspa = require('./mspa.js');

const PORT = 10906;
const LABEL = 'vein-h-safari';
const OUTDIR = path.join(__dirname, 'receipts');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  // hard watchdog: never let the step hang the workflow past ~70s
  setTimeout(() => { console.error('VEIN-H-SAFARI WATCHDOG exit'); process.exit(3); }, 70000).unref();
  const blade = startBlade({ port: PORT, timeoutMs: 60000 });
  await blade.listenP;
  spawnSync('sudo', ['safaridriver', '--enable'], { stdio: 'ignore', timeout: 20000 });
  const drv = spawn('safaridriver', ['-p', '4444'], { stdio: 'ignore' });
  await delay(3500);
  const sig = () => AbortSignal.timeout(15000);
  try {
    const ses = await fetch('http://127.0.0.1:4444/session', {
      method: 'POST',
      signal: sig(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: 'safari' } } }),
    }).then((r) => r.json());
    const sid = ses && ses.value && ses.value.sessionId;
    if (!sid) throw new Error('no session');
    await fetch('http://127.0.0.1:4444/session/' + sid + '/url', {
      method: 'POST',
      signal: sig(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://localhost:' + PORT + '/blade' }),
    });
    await delay(6000);
    await fetch('http://127.0.0.1:4444/session/' + sid + '', { method: 'DELETE', signal: sig() }).catch(() => {});
  } catch (e) {
    console.error('VEIN-H-SAFARI FAIL drive ' + e.message);
    try { drv.kill('SIGTERM'); } catch (_) {}
    spawnSync('killall', ['Safari'], { stdio: 'ignore' });
    blade.close();
    process.exit(13);
  }
  try { drv.kill('SIGTERM'); } catch (_) {}
  spawnSync('killall', ['Safari'], { stdio: 'ignore' });

  const cap = await blade.wait();
  blade.close();
  if (!cap) { console.error('VEIN-H-SAFARI FAIL no request captured'); process.exit(14); }

  const h2Code = measuredOrderCode(cap.order);
  const declared = mspa.H2_ORDER.safari;
  const doc = {
    label: LABEL,
    engine: 'safari',
    at: cap.at,
    platform: 'macOS',
    source: 'measured',
    alpn: cap.alpn,
    order: cap.order,
    h2Code,
    matchesDeclared: h2Code === declared.code,
    headers: cap.headers,
  };
  fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log('VEIN-H-SAFARI measured Safari h2 HEADERS  order=' + cap.order.join(',') + '  code=' + h2Code + '  declared=' + declared.code + '  ' + (doc.matchesDeclared ? 'MATCH' : 'MISMATCH'));
  console.log('  ua = ' + (cap.headers['user-agent'] || '-'));
  console.log('  sec-ch-ua = ' + (cap.headers['sec-ch-ua'] || 'ABSENT'));
  console.log('  accept-language = ' + (cap.headers['accept-language'] || '-'));
  process.exit(0);
}

main().catch((e) => { console.error('VEIN-H-SAFARI UNHANDLED ' + e.message); process.exit(15); });