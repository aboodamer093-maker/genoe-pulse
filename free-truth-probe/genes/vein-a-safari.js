'use strict';
/*
 * GENOE — VEIN-A: real macOS Safari wire gene
 * ----------------------------------------------
 * Drives the real Safari (safaridriver; fallback `open -a Safari`) to hit the
 * local capture server, harvests the true ClientHello, computes JA4, and
 * cross-checks against the published Safari corpus.
 *
 * Exit codes: 0 = EXACT-MATCH against public corpus
 *             5 = captured measured reference, not yet in public corpus (valid beat)
 *            >5 = capture failure (workflow treats as FAIL).
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startCaptureServer } = require('./capture.js');
const ja4 = require('./ja4.js');
const corpus = require('./safari-corpus.js');

const PORT = 10901;
const LABEL = 'vein-a-safari';
const OUTDIR = path.join(__dirname, 'receipts');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const capture = startCaptureServer({ port: PORT, timeoutMs: 90000, label: LABEL });

  spawnSync('sudo', ['safaridriver', '--enable'], { stdio: 'ignore' });
  const drv = spawn('safaridriver', ['-p', '4444'], { stdio: 'ignore' });
  await delay(3500);

  const target = 'https://127.0.0.1:' + PORT + '/probe';
  let nav = 'safaridriver';
  try {
    const ses = await fetch('http://127.0.0.1:4444/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: 'safari' } } }),
    }).then((r) => r.json());
    const sid = ses && ses.value && ses.value.sessionId;
    if (sid) {
      await fetch('http://127.0.0.1:4444/session/' + sid + '/url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: target }),
      }).catch(() => {});
      await delay(2500);
      await fetch('http://127.0.0.1:4444/session/' + sid, { method: 'DELETE' }).catch(() => {});
    } else {
      nav = 'open-fallback';
      spawnSync('open', ['-a', 'Safari', target]);
    }
  } catch (_) {
    nav = 'open-fallback';
    spawnSync('open', ['-a', 'Safari', target]);
  }
  await delay(6000);

  let result;
  try {
    result = await capture;
  } catch (e) {
    try { drv.kill('SIGTERM'); } catch (_) {}
    spawnSync('killall', ['Safari'], { stdio: 'ignore' });
    console.error('VEIN-A FAIL ' + e.message);
    process.exit(6);
  }
  try { drv.kill('SIGTERM'); } catch (_) {}
  spawnSync('killall', ['Safari'], { stdio: 'ignore' });

  const r = ja4.fromBuffer(Buffer.from(result.helloHex, 'hex'));
  const hit = corpus.find((e) => e.ja4 === r.ja4);
  const hexFile = path.join(OUTDIR, 'hello-' + LABEL + '.txt');
  fs.writeFileSync(hexFile, result.helloHex + '\n');
  const doc = {
    label: LABEL,
    at: new Date().toISOString(),
    nav,
    ja4: r.ja4,
    a: r.a,
    verdict: hit ? 'EXACT-MATCH' : 'NOT-IN-CORPUS',
    match: hit ? hit.product : null,
    helloHexFile: hexFile,
  };
  fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log('VEIN-A ' + doc.verdict + ' ja4=' + doc.ja4 + (doc.match ? ' -> ' + doc.match : '') + ' nav=' + nav);
  process.exit(hit ? 0 : 5);
}

main().catch((e) => { console.error('VEIN-A UNHANDLED ' + e.message); process.exit(7); });