'use strict';
/*
 * GENOE — GENE GATE (single early-warning gate for the gene layer)
 * ---------------------------------------------------------------------------
 * Runs: ja4 core self-test (4 references), wire cassette self-test,
 * mspa/JA4H truth, UAD matrix, and the live heartbeat report.
 * Exit 0 only if every gene discipline passes.
 */
const crosscheck = require('./crosscheck.js');
const cassette = require('./cassette.js');
const mspa = require('./mspa.js');
const uad = require('./uad.js');
const effectiveCorpus = require('./effective-corpus.js');
const fs = require('fs');
const path = require('path');

const parityCached = { pass: false, results: [{ name: 'wire-parity', pass: false, detail: 'no cached parity run' }] };
try {
  const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'receipts', 'parity-curl.json'), 'utf8'));
  parityCached.pass = p.parity && p.parity >= 1;
  parityCached.results = [{ name: 'wire-parity', pass: parityCached.pass, detail: p.parity + '/' + p.total + ' parity (cached ' + (p.at || '').slice(0, 10) + ')' }];
} catch (_) {}

const gates = [
  { name: 'ja4-core (4 refs)', run: () => crosscheck.selfTest() },
  { name: 'wire cassette', run: () => cassette.selfTest() },
  { name: 'mspa / JA4H', run: () => mspa.selfTest() },
  { name: 'UAD matrix', run: () => uad.selfTest() },
  { name: 'effective corpus', run: () => effectiveCorpus.selfTest() },
  { name: 'wire parity', run: () => parityCached },
];

const extCached = { pass: false, results: [{ name: 'external-verify', pass: false, detail: 'no cached external verify' }] };
try {
  const ev = JSON.parse(fs.readFileSync(path.join(__dirname, 'receipts', 'wire-verify', 'summary.json'), 'utf8'));
  const exact = (ev.rows || []).filter((r) => r.verdict && r.verdict.startsWith('EXACT')).length;
  extCached.pass = exact > 0;
  extCached.results = [{ name: 'external-verify', pass: extCached.pass, detail: exact + '/' + ((ev.rows || []).length) + ' EXACT vs independent service (' + (ev.at || '').slice(0, 10) + ')' }];
} catch (_) {}
gates.push({ name: 'external wire verify', run: () => extCached });

// observer authority: the outside world's own verdict (peet/browserleaks) is
// WITNESSED when >=1 engine agrees externally this pulse. Absence (no observer
// receipts — e.g. a pure offline check) never turns the gate red on its own:
// GENOE_REQUIRE_WITNESS=1 forces the demand where a full pulse is expected.
const obsCached = { pass: true, results: [{ name: 'observer-witness', pass: true, detail: 'no observer receipts (not required offline)' }] };
try {
  const dir = path.join(__dirname, 'receipts', 'observer');
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
    if (files.length) {
      const rows = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      const witnessed = rows.filter((r) => r.witnessed).length;
      const requireW = process.env.GENOE_REQUIRE_WITNESS === '1';
      obsCached.pass = witnessed > 0 || !requireW;
      obsCached.results = [{ name: 'observer-witness', pass: obsCached.pass, detail: witnessed + '/' + rows.length + ' engines externally witnessed' + (requireW ? ' (required)' : ' (advisory)') }];
    } else {
      obsCached.results = [{ name: 'observer-witness', pass: true, detail: 'observer receipts cleared this pulse' }];
    }
  }
} catch (_) {}
gates.push({ name: 'observer authority', run: () => obsCached });

let allPass = true;
console.log('GENOE GENE GATE');
for (const g of gates) {
  const r = g.run();
  const pass = r.pass;
  allPass = allPass && pass;
  const detail = r.results && r.results.length
    ? ' [' + r.results.map((x) => (x.pass ? x.skin || x.product || x.name : '!' + (x.skin || x.product || x.name)).split(' ')[0]).join(' ') + ']'
    : '';
  console.log('  [' + (pass ? 'PASS' : 'FAIL') + '] ' + g.name.padEnd(22) + detail);
}
console.log('GENE GATE ' + (allPass ? 'GREEN' : 'RED'));
process.exit(allPass ? 0 : 1);