'use strict';
/*
 * GENOE — WIRE GENE CASSETTE (S12)
 * ---------------------------------------------------------------------------
 * the canonical Safari wire-gene table for the GENOE shell. Each row merges:
 *   published  (public corpus / curl-impersonate official signature)
 *   measured   (sealed oracle beats from the macos-15 pulse — newer reality)
 *   incomplete (ja4-only rows whose full wire buffers are not yet decoded)
 * Every field carries an explicit `src` tag — the doctrine: never silently
 * mix provenance; any claim states where it came from.
 *
 * Self-test: for any row with full wire data, recompute JA4 and ASSERT equal
 * to the row's known ja4. Incomplete rows must be flagged as such, never used
 * for injection silently.
 */
const { computeFromLists, hex4 } = require('./ja4.js');

const GREASE = { low: 0x0a0a, high: 0x4a4a, ver: 0x2a2a };

const SIGNALGS = [0x0403, 0x0804, 0x0401, 0x0503, 0x0805, 0x0805, 0x0501, 0x0806, 0x0601, 0x0201];

const ROWS = [
  {
    product: 'Safari 26.0',
    platform: 'macOS',
    ja4: 't13d2014h2_a09f3c656075_d0a99439f9b1',
    h2order: 'mspa',
    alpn: ['h2', 'http/1.1'],
    version: 0x0304,
    supportedVersions: [GREASE.ver, 0x0304, 0x0303],
    ciphers: [
      0x1302, 0x1303, 0x1301, 0xc02c, 0xc02b, 0xcca9, 0xc030, 0xc02f,
      0xcca8, 0xc00a, 0xc009, 0xc014, 0xc013, 0x009d, 0x009c, 0x0035,
      0x002f, 0xc008, 0xc012, 0x000a,
    ],
    exts: [
      0x0000, 0x0017, 0xff01, 0x000a, 0x000b, 0x0023, 0x0010, 0x0005,
      0x000d, 0x0012, 0x0033, 0x002d, 0x002b, 0x001b,
    ],
    sigAlgs: SIGNALGS,
    src: 'official (curl-impersonate safari_26.0_macOS.yaml)',
  },
  {
    product: 'Safari 26.6',
    platform: 'macOS',
    ja4: 't13d2014h2_a09f3c656075_e42f34c56612',
    ja4_ipNested: 't1302013h2_a09f3c656075_e42f34c56612',
    h2order: 'mspa',
    alpn: ['h2', 'http/1.1'],
    version: 0x0304,
    supportedVersions: [GREASE.ver, 0x0304, 0x0303, 0x0302, 0x0301],
    ciphers: [
      0x1301, 0x1302, 0x1303, 0xc02c, 0xc02b, 0xcca9, 0xc030, 0xc02f,
      0xcca8, 0xc00a, 0xc009, 0xc014, 0xc013, 0x009d, 0x009c, 0x0035,
      0x002f, 0xc008, 0xc012, 0x000a,
    ],
    exts: [
      0x0000, 0x0017, 0xff01, 0x000a, 0x000b, 0x0010, 0x0005, 0x000d,
      0x0012, 0x0033, 0x002d, 0x002b, 0x001b, 0x0015,
    ],
    sigAlgs: SIGNALGS,
    src: 'measured (sealed beat-000 / vein-a on macos-15) — 0x0023->0x0015 vs 26.0',
  },
  {
    product: 'Safari 26.0.1',
    platform: 'iOS',
    ja4: 't13d2013h2_a09f3c656075_7f0f34a4126d',
    h2order: 'mspa',
    wire: 'incomplete — full buffer decode pending (vein-b decoded ja4 only)',
    src: 'measured EXACT-MATCH published (sealed beat-000 / vein-b)',
  },
];

function rowWire(row) {
  // returns computeFromLists-ready lists for a full-wire row, or null when incomplete
  if (!row.exts || !row.ciphers) return null;
  const withGreaseCiphers = [GREASE.low, ...row.ciphers];
  const withGreaseExts = [GREASE.low, ...row.exts, GREASE.high];
  return {
    transport: 't',
    version: row.version,
    sni: 'd',
    ciphers: withGreaseCiphers,
    extensions: withGreaseExts,
    sigAlgs: row.sigAlgs,
    alpnFirst: Buffer.from(row.alpn[0]),
  };
}

function selfTest() {
  const results = [];
  for (const row of ROWS) {
    const w = rowWire(row);
    if (!w) {
      results.push({ product: row.product, pass: true, known: row.ja4, detail: 'flagged incomplete — never injected silently' });
      continue;
    }
    const got = computeFromLists(w).ja4;
    const pass = got === row.ja4;
    results.push({ product: row.product, pass, known: row.ja4, got, detail: pass ? 'recomputed == known ja4' : 'MISMATCH' });
  }
  return { pass: results.every((r) => r.pass), results };
}

if (require.main === module) {
  const r = selfTest();
  console.log('CASSETTE SELF-TEST ' + (r.pass ? 'PASS' : 'FAIL'));
  for (const res of r.results) {
    console.log('  [' + (res.pass ? 'PASS' : 'FAIL') + '] ' + res.product.padEnd(14) +
                res.detail + (res.got ? '   got=' + res.got : '') + '   known=' + res.known);
  }
  process.exit(r.pass ? 0 : 1);
}

module.exports = { ROWS, rowWire, selfTest, hex4 };