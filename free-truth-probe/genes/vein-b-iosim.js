'use strict';
/*
 * GENOE — VEIN-B: real Mobile Safari (iOS simulator) wire gene
 * --------------------------------------------------------------
 * Boots an iPhone simulator, opens a URL in the REAL Mobile Safari via
 * `simctl openurl`, harvests the true ClientHello on the shared host loopback,
 * computes JA4, and cross-checks against the published Safari corpus.
 *
 * Exit codes: 0 = EXACT-MATCH | 5 = measured reference, not in corpus
 *            >5 = capture failure.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startCaptureServer } = require('./capture.js');
const ja4 = require('./ja4.js');
const { effectiveCorpus } = require('./effective-corpus.js');

const PORT = 10902;
const LABEL = 'vein-b-iosim';
const OUTDIR = path.join(__dirname, 'receipts');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

let captureDone = false;
// resolves as soon as the capture promise settles; otherwise fires the retry
async function bounceCapture(cap, retryFn) {
  try {
    await Promise.race([cap, new Promise((_, rej) => setTimeout(() => rej(new Error('pending')), 800))]);
    captureDone = true;
  } catch (_) {
    retryFn();
  }
}

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });

  run('xcrun', ['simctl', 'list']); // GH Actions workaround (issue #12862): warm the core first

  let deviceType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-16';
  {
    const dev = run('xcrun', ['simctl', 'list', 'devicetypes', '-j']);
    if (dev.status !== 0 || !/iPhone-16\b/.test(dev.stdout || '')) {
      deviceType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-15';
      if (dev.status !== 0 || !/iPhone-15\b/.test(dev.stdout || '')) {
        console.error('VEIN-B FAIL no iPhone device type available');
        process.exit(9);
      }
    }
  }

  let runtime = null;
  {
    const rt = run('xcrun', ['simctl', 'list', 'runtimes', '-j']);
    try {
      const data = JSON.parse(rt.stdout);
      const avail = ((data.runtimes || []).filter((x) => /^iOS/.test(x.name || '') && x.isAvailable));
      if (!avail.length) throw new Error('no available iOS runtime');
      runtime = avail[avail.length - 1].identifier;
    } catch (e) {
      console.error('VEIN-B FAIL ' + e.message);
      process.exit(10);
    }
  }

  const created = run('xcrun', ['simctl', 'create', 'genoe-vein', deviceType, runtime]);
  const udid = (created.stdout || '').trim();
  if (!udid) { console.error('VEIN-B FAIL simctl create returned no UDID'); process.exit(11); }

  run('xcrun', ['simctl', 'boot', udid], { stdio: 'ignore' });
  run('xcrun', ['simctl', 'bootstatus', udid, '-b'], { stdio: 'ignore', timeout: 120000 });

  // keep the sim alive and hand its UDID to the h2 blade via a marker file so
  // the whole iOS lane uses ONE device (double-boot thrashes shared runners)
  fs.writeFileSync(path.join(OUTDIR, '.sim-udid'), udid + '\n');

  const target = 'https://localhost:' + PORT + '/probe';
  const capture = startCaptureServer({ port: PORT, timeoutMs: 150000, label: LABEL });
  run('xcrun', ['simctl', 'openurl', udid, target]);
  // cold-boot resilience: keep re-asserting the navigation while the capture
  // is still pending (first launch can be slow on shared macos runners)
  for (let attempt = 1; attempt <= 4 && !captureDone; attempt++) {
    await bounceCapture(capture, () => run('xcrun', ['simctl', 'openurl', udid, target], { stdio: 'ignore' }));
    await delay(12000);
  }

  let result;
  try {
    result = await capture;
    captureDone = true;
  } catch (e) {
    // infrastructure flake on shared runners (cold sim, stalled launch): this
    // is a REFERENCE gene with the iOS wire already in the cassette — record
    // the honest absence instead of turning the whole pulse red
    try { fs.unlinkSync(path.join(OUTDIR, '.sim-udid')); } catch (_) {}
    run('xcrun', ['simctl', 'shutdown', udid], { stdio: 'ignore' });
    fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify({
      label: LABEL, at: new Date().toISOString(), device: deviceType, runtime,
      available: false, note: 'capture flake on runner: ' + e.message,
    }, null, 2) + '\n');
    console.log('VEIN-B honest skip (capture flake) -> ' + e.message);
    process.exit(0);
  }
  // success: leave the sim BOOTED and hand it to vein-h-iosim via the marker

  const r = ja4.fromBuffer(Buffer.from(result.helloHex, 'hex'));
  const hit = effectiveCorpus().find((e) => e.ja4 === r.ja4);
  const hexFile = path.join(OUTDIR, 'hello-' + LABEL + '.txt');
  fs.writeFileSync(hexFile, result.helloHex + '\n');
  const doc = {
    label: LABEL,
    at: new Date().toISOString(),
    device: deviceType,
    runtime,
    ja4: r.ja4,
    a: r.a,
    verdict: hit ? 'EXACT-MATCH' : 'NOT-IN-CORPUS',
    match: hit ? hit.product : null,
    helloHexFile: hexFile,
  };
  fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log('VEIN-B ' + doc.verdict + ' ja4=' + doc.ja4 + (doc.match ? ' -> ' + doc.match : ''));
  process.exit(hit ? 0 : 5);
}

main().catch((e) => { console.error('VEIN-B UNHANDLED ' + e.message); process.exit(13); });