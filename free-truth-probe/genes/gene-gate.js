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

const gates = [
  { name: 'ja4-core (4 refs)', run: () => crosscheck.selfTest() },
  { name: 'wire cassette', run: () => cassette.selfTest() },
  { name: 'mspa / JA4H', run: () => mspa.selfTest() },
  { name: 'UAD matrix', run: () => uad.selfTest() },
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
  console.log('  [' + (pass ? 'PASS' : 'FAIL') + '] ' + g.name.padEnd(22) + detail);
}
console.log('GENE GATE ' + (allPass ? 'GREEN' : 'RED'));
process.exit(allPass ? 0 : 1);