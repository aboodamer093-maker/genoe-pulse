'use strict';
/*
 * GENOE — CURL_CFFI WIRE PARITY PROBE
 * ---------------------------------------------------------------------------
 * For every Safari impersonation profile shipped by curl_cffi (BoringSSL
 * wire), capture its true ClientHello against the local TLS capture server,
 * compute JA4, and compare against the EFFECTIVE corpus (public + sealed
 * beats). A match proves a valid wire-grade equivalent for the GENOE shell
 * on this machine — measured, never declared.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startCaptureServer } = require('./capture.js');
const ja4 = require('./ja4.js');
const { effectiveCorpus } = require('./effective-corpus.js');

const PORT = 10905;
const OUTDIR = path.join(__dirname, 'receipts');
const PY = 'python';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const PROFILES = [
  'safari153', 'safari155', 'safari15_3', 'safari15_5',
  'safari170', 'safari17_0',
  'safari180', 'safari18_0',
  'safari184', 'safari18_0',
  'safari260', 'safari2601', 'safari260_ios',
];

async function captureOne(profile) {
  const capture = startCaptureServer({ port: PORT, timeoutMs: 30000, label: 'parity-' + profile });
  await delay(700);
  const child = spawn(PY, [
    path.join(__dirname, '..', 'tools', 'parity-curl.py'),
    '--profile', profile,
    '--url', 'https://localhost:' + PORT + '/probe',
  ], { stdio: 'ignore' });
  let result;
  try {
    result = await capture;
  } catch (e) {
    try { child.kill(); } catch (_) {}
    return { profile, ja4: null, error: e.message };
  }
  child.kill();
  try {
    const r = ja4.fromBuffer(Buffer.from(result.helloHex, 'hex'));
    return { profile, ja4: r.ja4 };
  } catch (e) {
    return { profile, ja4: null, error: String(e) };
  }
}

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const corpus = effectiveCorpus();
  const rows = [];
  console.log('CURL_CFFI WIRE PARITY  (effective corpus: ' + corpus.length + ' entries)');
  for (const profile of PROFILES) {
    const row = await captureOne(profile);
    const hit = row.ja4 ? corpus.find((e) => e.ja4 === row.ja4) : null;
    row.status = row.ja4 ? (hit ? 'PARITY' : 'no-match') : 'capture-failed';
    row.match = hit ? hit.product + ' [' + hit.source + ']' : null;
    rows.push(row);
    console.log('  ' + profile.padEnd(14) + ' ja4=' + (row.ja4 || '-') + '  ' + row.status + (row.match ? '  -> ' + row.match : '') + (row.error ? '  err=' + row.error : ''));
  }
  const d = {
    at: new Date().toISOString(),
    engine: 'curl_cffi ' + (require('child_process').execFileSync(PY, ['-c', 'import curl_cffi; print(curl_cffi.__version__)'], { encoding: 'utf8' }).trim()),
    rows,
    parity: rows.filter((r) => r.status === 'PARITY').length,
    total: rows.length,
  };
  fs.writeFileSync(path.join(OUTDIR, 'parity-curl.json'), JSON.stringify(d, null, 2) + '\n');
  console.log('PARITY ' + d.parity + '/' + d.total + '  ->  receipts/parity-curl.json');
  process.exit(d.parity ? 0 : 5);
}

main().catch((e) => { console.error('PARITY UNHANDLED ' + e.message); process.exit(6); });