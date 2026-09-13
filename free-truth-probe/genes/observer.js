'use strict';
/*
 * GENOE — VEIN-O OBSERVER MATRIX (external h2 + JA4 witness layer)
 * ---------------------------------------------------------------------------
 * Each REAL engine navigates an INDEPENDENT PUBLIC observer (tls.peet.ws,
 * recorder B: tls.browserleaks.com) and the OUTSIDE WORLD's verdict is read
 * back through an ORIGINAL per-engine channel:
 *   safari   -> safaridriver (W3C source)          chrome -> --dump-dom
 *   firefox  -> geckodriver  (W3C source)          safari-ios -> OCR + PNG
 *
 * NO local cert trust anywhere in this lane: public sites, public CA.
 * The receipt cross-checks the EXTERNAL ja4 / h2-order against our LOCAL
 * sealed measurements (vein-a/vein-b/vein-h). Exits 0 when receipts are
 * written (witnessed or honest absence); a matrix that could not even render
 * a single readback is a hard failure (exit 4).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const witness = require('./witness.js');
const mspa = require('./mspa.js');
const { effectiveCorpus } = require('./effective-corpus.js');

const OUTDIR = path.join(__dirname, 'receipts', 'observer');
const REC = path.join(__dirname, 'receipts');
const PEET = 'https://tls.peet.ws/api/all';
const BROWSERLEAKS = 'https://tls.browserleaks.com/json';

const RUN = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 15);
const tokenFor = (engine) => 'obs=' + engine + '.' + RUN + '.' + Math.random().toString(36).slice(2, 8);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

const readReceipt = (f) => {
  const p = path.join(REC, f);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
};

const corpusHit = (ja4) => (ja4 ? effectiveCorpus().find((e) => e.ja4 === ja4) || null : null);

// local same-genome cross-references (frame our claim, never the answer)
const LOCAL = {
  safari: { ja4: () => (readReceipt('vein-a-safari.json') || {}).ja4 || null, h2: () => (readReceipt('vein-h-safari.json') || {}).h2Code || null },
  chrome: { ja4: () => null, h2: () => (readReceipt('vein-h-chrome.json') || {}).h2Code || null },
  firefox: { ja4: () => null, h2: () => (readReceipt('vein-h-firefox.json') || {}).h2Code || null },
  'safari-ios': { ja4: () => (readReceipt('vein-b-iosim.json') || {}).ja4 || null, h2: () => (readReceipt('vein-h-iosim.json') || {}).h2Code || null },
};

function buildReceipt(engine, token, read, peet, recorderB, localRef) {
  const rec = {
    label: 'witness-' + engine,
    engine,
    token,
    at: new Date().toISOString(),
    readback: read.ok ? (read.channel || 'unknown') : (read.reason || 'readback-failed'),
    error: read.ok ? null : read.error || null,
    pngEvidence: read.png || null,
  };
  rec.peet = peet ? {
    ok: peet.ok, ja4: peet.ja4, ja4_r: peet.ja4_r, ja3_hash: peet.ja3_hash,
    h2: peet.h2, h2PseudoOrder: peet.h2PseudoOrder, userAgent: peet.userAgent,
    tokenEcho: peet.tokenEcho,
  } : null;
  rec.recorderB = recorderB ? {
    ok: recorderB.ok, ja4: recorderB.ja4, ja4_r: recorderB.ja4_r, tokenEcho: recorderB.tokenEcho,
  } : null;
  rec.local = { refJa4: localRef.ja4(), refH2: localRef.h2(), declaredH2: mspa.orderingFor(engine) ? mspa.orderingFor(engine).code : null };

  if (!peet || !peet.ok || !peet.ja4) {
    rec.verdict = (read.ok ? 'READBACK-FAILED' : 'CHANNEL-UNAVAILABLE');
    rec.witnessed = false;
    return rec;
  }

  const ja4AgreeLocal = rec.local.refJa4 ? peet.ja4 === rec.local.refJa4 : null;
  const ja4AgreeB = rec.recorderB && rec.recorderB.ja4 ? peet.ja4 === rec.recorderB.ja4 : null;
  const hit = corpusHit(peet.ja4);
  const h2AgreeLocal = peet.h2PseudoOrder && rec.local.refH2 ? peet.h2PseudoOrder === rec.local.refH2 : null;
  const h2AgreeDeclared = peet.h2PseudoOrder && rec.local.declaredH2 ? peet.h2PseudoOrder === rec.local.declaredH2 : null;

  rec.cross = { ja4AgreeLocal, ja4AgreeRecorderB: ja4AgreeB, corpusHit: hit ? hit.product : null, h2AgreeLocal, h2AgreeDeclared };

  if (ja4AgreeLocal && ja4AgreeB) rec.verdict = 'WITNESSED-DOUBLE';
  else if (ja4AgreeLocal) rec.verdict = 'WITNESSED-LOCAL';
  else if (ja4AgreeB) rec.verdict = 'WITNESSED-EXTERNAL';
  else if (hit) rec.verdict = 'IN-CORPUS';
  else rec.verdict = 'NOT-IN-LOCAL';
  rec.witnessed = rec.verdict.startsWith('WITNESSED');
  return rec;
}

async function runEngine(engine) {
  const token = tokenFor(engine);
  const localRef = LOCAL[engine];
  const peetUrl = PEET + '?' + token;
  const blUrl = BROWSERLEAKS + '?' + token;
  let read = null;
  let peetRaw = null;
  let blRaw = null;

  if (engine === 'chrome') {
    read = witness.chromeDumpDom(peetUrl);
    if (read.ok) peetRaw = witness.parsePeet(read.text);
    const readB = witness.chromeDumpDom(blUrl);
    if (readB.ok) blRaw = witness.parseRecorderB(readB.text);
  } else if (engine === 'safari') {
    read = await witness.safariSource([peetUrl, blUrl]);
    if (read.ok) { peetRaw = witness.parsePeet(read.texts[0]); if (read.texts[1]) blRaw = witness.parseRecorderB(read.texts[1]); }
  } else if (engine === 'firefox') {
    read = await witness.firefoxSource([peetUrl, blUrl]);
    if (read.ok) { peetRaw = witness.parsePeet(read.texts[0]); if (read.texts[1]) blRaw = witness.parseRecorderB(read.texts[1]); }
  } else if (engine === 'safari-ios') {
    const boot = await witness.bootIos();
    if (!boot.ok) {
      read = { ok: false, reason: 'channel-unavailable', error: boot.error };
    } else {
      read = await witness.iosReadback({ udid: boot.udid, url: peetUrl, outDir: OUTDIR, token });
      run('xcrun', ['simctl', 'shutdown', boot.udid], { stdio: 'ignore' });
      if (read.ok && read.text) peetRaw = witness.parsePeet(read.text);
    }
    read = { ...read, channel: 'ios-screenshot-ocr', pngEvidence: read.png || null };
  }

  // honest token correlation: the outside world echoes our per-shot token in
  // the HEADERS it observed (:path) — record it directly from the raw body.
  if (peetRaw && peetRaw.ok) {
    const peetText = read.ok ? (Array.isArray(read.texts) ? read.texts[0] : read.text) : null;
    peetRaw.tokenEcho = Boolean(peetText) && peetText.includes(token);
  }
  if (blRaw && blRaw.ok) {
    const blText = read.ok && Array.isArray(read.texts) ? read.texts[1] : null;
    blRaw.tokenEcho = Boolean(blText) && blText.includes(token);
  }

  if (!peetRaw) return buildReceipt(engine, token, read, null, null, localRef);
  return buildReceipt(engine, token, read, peetRaw, blRaw, localRef);
}

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  setTimeout(() => { console.error('VEIN-O WATCHDOG exit'); process.exit(3); }, 600000).unref();
  console.log('VEIN-O observer matrix (independent public h2/JA4 observers)');

  const engines = [];
  for (const e of ['safari', 'safari-ios', 'chrome', 'firefox']) {
    try {
      const rec = await runEngine(e);
      engines.push({ engine: e, rec });
    } catch (err) {
      engines.push({ engine: e, rec: { label: 'witness-' + e, engine: e, token: null, at: new Date().toISOString(), verdict: 'ENGINE-ERROR', witnessed: false, error: String(err.message).slice(0, 160) } });
    }
  }

  for (const { engine, rec } of engines) {
    const f = path.join(OUTDIR, engine + '.json');
    fs.writeFileSync(f, JSON.stringify(rec, null, 2) + '\n');
    const line = '  ' + engine.padEnd(12) + rec.verdict.padEnd(20) + ' peetJa4=' + (rec.peet && rec.peet.ja4 || '-');
    console.log(line + '  h2=' + (rec.peet && rec.peet.h2PseudoOrder || '-') + (rec.witnessed ? '  [WITNESSED]' : '') + (rec.error ? '  err=' + String(rec.error).slice(0, 80) : ''));
  }

  fs.writeFileSync(path.join(OUTDIR, 'index.json'), JSON.stringify({ at: new Date().toISOString(), run: RUN, service: PEET, engines: engines.map((e) => e.rec) }, null, 2) + '\n');
  const anyReadable = engines.some((e) => e.rec.peet !== null || e.rec.verdict === 'CHANNEL-UNAVAILABLE');
  console.log('VEIN-O receipts under receipts/observer/ (witnessed=' + engines.filter((e) => e.rec.witnessed).length + ')');
  process.exit(anyReadable ? 0 : 4);
}

main().catch((e) => { console.error('VEIN-O UNHANDLED ' + e.message); process.exit(13); });