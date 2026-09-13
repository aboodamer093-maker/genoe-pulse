'use strict';
/*
 * GENOE — VEIN-S: real macOS Safari SURFACE genes (S14)
 * ------------------------------------------------------
 * Reuses the safaridriver bootstrap, points Safari at the plain-http surface
 * page served by the GENOE collector, reads the measured snapshot back from
 * the DOM, and records receipts/surface-macos.json.
 *
 * Exit: 0 = surface snapshot captured.
 *      >5 = capture failure (workflow treats as FAIL; seal runs via always()).
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startSurfaceServer, saveSurface } = require('./surface.js');
const uad = require('./uad.js');

const PORT = 10904;
const LABEL = 'vein-s-macos';
const OUTDIR = path.join(__dirname, 'receipts');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });

  const server = await startSurfaceServer({ port: PORT, timeoutMs: 60000 });
  spawnSync('sudo', ['safaridriver', '--enable'], { stdio: 'ignore' });
  const drv = spawn('safaridriver', ['-p', '4444'], { stdio: 'ignore' });
  await delay(3500);

  let text = null;
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
      body: JSON.stringify({ url: 'http://localhost:' + PORT + '/surface' }),
    });
    await delay(3000);
    const res = await fetch('http://127.0.0.1:4444/session/' + sid + '/execute/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script: 'return document.body.textContent', args: [] }),
    }).then((r) => r.json());
    text = res && res.value;
    await fetch('http://127.0.0.1:4444/session/' + sid, { method: 'DELETE' }).catch(() => {});
  } catch (e) {
    console.error('VEIN-S FAIL ' + e.message);
    try { drv.kill('SIGTERM'); } catch (_) {}
    spawnSync('killall', ['Safari'], { stdio: 'ignore' });
    server.close();
    process.exit(7);
  }
  try { drv.kill('SIGTERM'); } catch (_) {}
  spawnSync('killall', ['Safari'], { stdio: 'ignore' });
  server.close();

  if (!text) { console.error('VEIN-S FAIL empty snapshot'); process.exit(8); }
  let snap;
  try { snap = JSON.parse(text); } catch (e) { console.error('VEIN-S FAIL unparseable snapshot'); process.exit(9); }

  const uaRows = uad.ROWS.filter((r) => r.skin === 'safari-macos');
  const declared = uaRows.length ? uaRows[0].ua : null;
  const doc = {
    label: LABEL,
    at: new Date().toISOString(),
    platform: 'macOS',
    source: 'measured',
    ua: snap.userAgent,
    uaMatchesDeclaration: declared ? snap.userAgent === declared : null,
    uaChAbsent: snap.userAgentData === null,
    surface: snap,
  };
  saveSurface(doc, path.join(OUTDIR, LABEL + '.json'));
  console.log('VEIN-S measured macOS Safari surface');
  console.log('  ua = ' + snap.userAgent);
  console.log('  uaCh = ' + (snap.userAgentData === null ? 'ABSENT (Safari, honest)' : 'PRESENT'));
  console.log('  platform=' + snap.platform + '  concurrency=' + snap.hardwareConcurrency + '  dpr=' + snap.window.dpr);
  console.log('  webgl renderer = ' + (snap.webgl.renderer || 'n/a'));
  console.log('  receipt = free-truth-probe/genes/receipts/' + LABEL + '.json');
  process.exit(0);
}

main().catch((e) => { console.error('VEIN-S UNHANDLED ' + e.message); process.exit(10); });