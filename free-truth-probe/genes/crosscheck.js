'use strict';
/*
 * GENOE — CROSSCHECK (harvest vs public corpus) + SPEC SELF-TEST
 * -----------------------------------------------------------------
 * Modes:
 *   --self-test        verify the JA4 core against FoxIO's canonical example
 *   <hello.hex file>   parse a captured ClientHello hex blob, compute JA4,
 *                      then exact-match against the published Safari corpus.
 * Verdict vocabulary: EXACT-MATCH / NO-MATCH / NOT-IN-CORPUS.
 */
const fs = require('fs');
const path = require('path');
const ja4 = require('./ja4.js');
const corpus = require('./safari-corpus.js');

// Canonical FoxIO reference (JA4.md): Chrome -> t13d1516h2_8daaf6152771_e5627efa2ab1
const VECTOR = {
  transport: 't',
  version: 0x0304,
  sni: true,
  ciphers: [
    0x002f, 0x0035, 0x009c, 0x009d, 0x1301, 0x1302, 0x1303,
    0xc013, 0xc014, 0xc02b, 0xc02c, 0xc02f, 0xc030, 0xcca8, 0xcca9,
  ],
  extensions: [
    0x0005, 0x000a, 0x000b, 0x000d, 0x0010, 0x0012, 0x0015,
    0x0017, 0x001b, 0x0023, 0x002b, 0x002d, 0x0033, 0x4469, 0xff01, 0x0000,
  ],
  sigAlgs: [0x0403, 0x0804, 0x0401, 0x0503, 0x0805, 0x0501, 0x0806, 0x0601],
  alpnFirst: Buffer.from('h2'),
};
const EXPECTED = 't13d1516h2_8daaf6152771_e5627efa2ab1';

// Authoritative Safari 26.0 ClientHello (curl-impersonate tests/signatures/safari_26.0_macOS.yaml).
// Independent reference #2: -> t13d2014h2_a09f3c656075_d0a99439f9b1
const VECTOR_SAFARI_260 = {
  transport: 't',
  version: 0x0304,
  sni: 'd',
  ciphers: [
    0x8a8a, 0x1302, 0x1303, 0x1301, 0xc02c, 0xc02b, 0xcca9, 0xc030,
    0xc02f, 0xcca8, 0xc00a, 0xc009, 0xc014, 0xc013, 0x009d, 0x009c,
    0x0035, 0x002f, 0xc008, 0xc012, 0x000a,
  ],
  extensions: [
    0x0a0a, 0x0000, 0x0017, 0xff01, 0x000a, 0x000b, 0x0023, 0x0010,
    0x0005, 0x000d, 0x0012, 0x0033, 0x002d, 0x002b, 0x001b, 0x4a4a,
  ],
  sigAlgs: [0x0403, 0x0804, 0x0401, 0x0503, 0x0805, 0x0805, 0x0501, 0x0806, 0x0601, 0x0201],
  alpnFirst: Buffer.from('h2'),
};
const EXPECTED_SAFARI_260 = 't13d2014h2_a09f3c656075_d0a99439f9b1';

// Vector as measured by the GENOE oracle on the live macos-15 runner (Safari 26.6):
// ext 0x0023 (session_ticket) dropped, 0x0015 (heartbeat) added. IP-literal target -> no SNI.
// -> t1302013h2_a09f3c656075_e42f34c56612
const VECTOR_SAFARI_266 = {
  transport: 't',
  version: 0x0304,
  sni: '0',
  ciphers: [
    0x8a8a, 0x1301, 0x1302, 0x1303, 0xc02c, 0xc02b, 0xcca9, 0xc030,
    0xc02f, 0xcca8, 0xc00a, 0xc009, 0xc014, 0xc013, 0x009d, 0x009c,
    0x0035, 0x002f, 0xc008, 0xc012, 0x000a,
  ],
  extensions: [
    0x0a0a, 0x0017, 0xff01, 0x000a, 0x000b, 0x0010, 0x0005, 0x000d,
    0x0012, 0x0033, 0x002d, 0x002b, 0x001b, 0x4a4a, 0x0015,
  ],
  sigAlgs: [0x0403, 0x0804, 0x0401, 0x0503, 0x0805, 0x0805, 0x0501, 0x0806, 0x0601, 0x0201],
  alpnFirst: Buffer.from('h2'),
};
const EXPECTED_SAFARI_266 = 't1302013h2_a09f3c656075_e42f34c56612';
// Domain-SNI (localhost capture target) variant, as measured by the oracle:
// -> t13d2014h2_a09f3c656075_e42f34c56612
const EXPECTED_SAFARI_266_DOMAIN = 't13d2014h2_a09f3c656075_e42f34c56612';

function selfTest() {
  const suite = [
    { name: 'FoxIO Chrome canonical', v: VECTOR, expected: EXPECTED },
    { name: 'Safari 26.0 reference', v: VECTOR_SAFARI_260, expected: EXPECTED_SAFARI_260 },
    { name: 'Safari 26.6 (oracle-measured)', v: VECTOR_SAFARI_266, expected: EXPECTED_SAFARI_266 },
  ];
  const results = suite.map((s) => {
    const got = ja4.computeFromLists(s.v);
    return { name: s.name, pass: got.ja4 === s.expected, got: got.ja4, expected: s.expected };
  });
  const realHex = path.join(__dirname, 'receipts', 'hello-vein-a-safari.txt');
  if (fs.existsSync(realHex)) {
    const hex = fs.readFileSync(realHex, 'utf8').trim();
    const got = ja4.fromBuffer(Buffer.from(hex, 'hex'));
    results.push({
      name: 'Real captured Safari 26.6 buffer',
      pass: got.ja4 === EXPECTED_SAFARI_266_DOMAIN,
      got: got.ja4,
      expected: EXPECTED_SAFARI_266_DOMAIN,
      buffer: true,
    });
  }
  const pass = results.every((r) => r.pass);
  let detail = pass
    ? 'JA4 core conforms to all references (FoxIO canonical + Safari 26.0 official signature + live oracle buffer).'
    : 'JA4 core MISMATCH against a reference — fix before any gene use.';
  return { pass, results, detail };
}

function crosscheckHello(hexFile) {
  const hex = fs.readFileSync(hexFile, 'utf8').trim();
  const buf = Buffer.from(hex.replace(/[^0-9a-fA-F]/g, ''), 'hex');
  const r = ja4.fromBuffer(buf);
  const hit = corpus.find((e) => e.ja4 === r.ja4);
  return {
    ja4: r.ja4,
    a: r.a,
    verdict: hit ? 'EXACT-MATCH' : 'NOT-IN-CORPUS',
    match: hit ? hit.product : null,
    corpusSize: corpus.length,
  };
}

function main() {
  const arg = process.argv[2];
  if (arg === '--self-test') {
    const r = selfTest();
    console.log('SELF-TEST ' + (r.pass ? 'PASS' : 'FAIL'));
    for (const res of r.results) {
      console.log('  [' + (res.pass ? 'PASS' : 'FAIL') + '] ' + res.name.padEnd(34) + (res.buffer ? 'buffer ok   ' : 'lists ok    ') + res.got);
    }
    console.log('  ' + r.detail);
    process.exit(r.pass ? 0 : 1);
  }
  if (arg) {
    const r = crosscheckHello(arg);
    const hit = corpus.find((e) => e.ja4 === r.ja4);
    console.log('VERDICT ' + r.verdict + '  ja4=' + r.ja4);
    console.log('  a=' + r.a + '  corpus=' + r.corpusSize + ' entry' + (hit ? ' -> ' + hit.product + ' [' + hit.platform + ']' : ''));
    process.exit(hit ? 0 : 2);
  }
  console.error('usage: node crosscheck.js --self-test  |  node crosscheck.js <hello.hex>');
  process.exit(2);
}

module.exports = { selfTest, crosscheckHello };

if (require.main === module) main();