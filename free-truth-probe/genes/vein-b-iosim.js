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
const corpus = require('./safari-corpus.js');

const PORT = 10902;
const LABEL = 'vein-b-iosim';
const OUTDIR = path.join(__dirname, 'receipts');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

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

  const capture = startCaptureServer({ port: PORT, timeoutMs: 90000, label: LABEL });
  await delay(3000);
  run('xcrun', ['simctl', 'openurl', udid, 'https://127.0.0.1:' + PORT + '/probe']);
  await delay(9000);

  let result;
  try {
    result = await capture;
  } catch (e) {
    run('xcrun', ['simctl', 'shutdown', udid], { stdio: 'ignore' });
    console.error('VEIN-B FAIL ' + e.message);
    process.exit(12);
  }
  run('xcrun', ['simctl', 'shutdown', udid], { stdio: 'ignore' });

  const r = ja4.fromBuffer(Buffer.from(result.helloHex, 'hex'));
  const hit = corpus.find((e) => e.ja4 === r.ja4);
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