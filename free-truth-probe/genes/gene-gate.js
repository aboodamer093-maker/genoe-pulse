'use strict';
/*
 * GENOE — GENE GATE (single early-warning gate for the gene layer)
 * ---------------------------------------------------------------------------
 * Runs: chain integrity, ja4 core self-test (4 references), wire cassette
 * self-test, mspa/JA4H truth, UAD matrix, effective corpus, and the live
 * heartbeat report. All cached external evidence (parity, wire-verify,
 * observer receipts) must be FRESH inside a rolling window or the gate
 * reports them as stale — no months-old JSON can ever bless a pulse.
 * Exit 0 only if every gene discipline passes.
 */
const crosscheck = require('./crosscheck.js');
const cassette = require('./cassette.js');
const mspa = require('./mspa.js');
const uad = require('./uad.js');
const effectiveCorpus = require('./effective-corpus.js');
const chainVerify = require('./chain-verify.js');
const fs = require('fs');
const path = require('path');

const FRESH_MS = 2 * 60 * 60 * 1000;
const isFresh = (atStr) => {
  const t = Date.parse(atStr || '');
  return !Number.isNaN(t) && (Date.now() - t) <= FRESH_MS;
};

let parityCached = { pass: false, results: [{ name: 'wire-parity', pass: false, detail: 'no fresh parity receipt' }] };
{
  let p = null;
  try { p = JSON.parse(fs.readFileSync(path.join(__dirname, 'receipts', 'parity-curl.json'), 'utf8')); } catch (_) { p = null; }
  const freshP = !!(p && isFresh(p.at));
  const ok = !!(p && p.parity && p.parity >= 1 && freshP);
  parityCached.pass = ok;
  parityCached.results = [{ name: 'wire-parity', pass: ok, detail: ok ? p.parity + '/' + p.total + ' parity (fresh ' + (p.at || '').slice(0, 10) + ')' : (p ? 'parity ' + p.parity + '/' + p.total + ' — STALE (at ' + (p.at || '?') + ' >2h)' : 'no parity receipt (absent)') }];
}

let extCached = { pass: false, results: [{ name: 'external-verify', pass: false, detail: 'no fresh external verify' }] };
{
  let ev = null;
  try { ev = JSON.parse(fs.readFileSync(path.join(__dirname, 'receipts', 'wire-verify', 'summary.json'), 'utf8')); } catch (_) { ev = null; }
  const freshE = !!(ev && isFresh(ev.at));
  const exact = freshE ? (ev.rows || []).filter((r) => r.verdict && r.verdict.startsWith('EXACT')).length : 0;
  const ok = freshE && exact > 0;
  extCached.pass = ok;
  extCached.results = [{ name: 'external-verify', pass: ok, detail: ok ? exact + '/' + ((ev.rows || []).length) + ' EXACT vs independent service (' + (ev.at || '').slice(0, 10) + ')' : (ev ? (freshE ? '0 EXACT in fresh receipt' : 'external-verify STALE (' + (ev.at || '?') + ' >2h)') : 'external-verify receipt absent') }];
}

// observer authority: the outside world's own verdict. Presence with GENOE_
// REQUIRE_WITNESS=1 demands >=1 fresh witnessed engine; corrupt JSON files
// under receipts/observer/ can never silently pass the gate.
let obsCached = null;
{
  const requireW = process.env.GENOE_REQUIRE_WITNESS === '1';
  const dir = path.join(__dirname, 'receipts', 'observer');
  let files = [];
  try { files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json') : []; } catch (_) { files = []; }
  if (!files.length) {
    obsCached = { pass: !requireW, results: [{ name: 'observer-witness', pass: !requireW, detail: requireW ? 'no observer receipts (REQUIRED for this pulse)' : 'no observer receipts (advisory)' }] };
  } else {
    let witnessed = 0, corrupt = 0, stale = 0, total = files.length;
    for (const f of files) {
      let r = null;
      try { r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { corrupt++; continue; }
      if (!isFresh(r && r.at)) { stale++; continue; }
      if (r.witnessed) witnessed++;
    }
    const pass = (witnessed > 0 || !requireW) && corrupt === 0;
    obsCached = { pass, results: [{ name: 'observer-witness', pass, detail: witnessed + '/' + total + ' fresh witnessed' + (corrupt ? ', CORRUPT=' + corrupt : '') + (stale ? ', stale=' + stale : '') + (requireW ? ' (required)' : ' (advisory)') }] };
  }
}

const gates = [
  { name: 'chain integrity', run: () => chainVerify.gateResult() },
  { name: 'ja4-core (4 refs)', run: () => crosscheck.selfTest() },
  { name: 'wire cassette', run: () => cassette.selfTest() },
  { name: 'mspa / JA4H', run: () => mspa.selfTest() },
  { name: 'UAD matrix', run: () => uad.selfTest() },
  { name: 'effective corpus', run: () => effectiveCorpus.selfTest() },
  { name: 'wire parity', run: () => parityCached },
  { name: 'external wire verify', run: () => extCached },
  { name: 'observer authority', run: () => obsCached },
];

let allPass = true;
console.log('GENOE GENE GATE');
for (const g of gates) {
  const r = g.run();
  const pass = r.pass;
  allPass = allPass && pass;
  const detail = r.results && r.results.length
    ? ' [' + r.results.map((x) => (x.pass ? x.skin || x.product || x.name : '!' + (x.skin || x.product || x.name)).split(' ')[0]).join(' ') + ']'
    : '';
  console.log('  [' + (pass ? 'PASS' : 'FAIL') + '] ' + g.name.padEnd(24) + detail);
}
console.log('GENE GATE ' + (allPass ? 'GREEN' : 'RED'));
process.exit(allPass ? 0 : 1);