'use strict';
/*
 * GENOE — ENGINE PROBE (S13): capture the real wire of the WebKit engine
 * -------------------------------------------------------------------------
 * Launches MiniBrowser.exe (WinCairo WebKit2, BoringSSL) against the local
 * capture server, grabs its true ClientHello, computes JA4 and decodes the
 * wire. Honest: the verdict is what the measurement says — no forcing.
 */
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const { startCaptureServer } = require('./capture.js');
const ja4 = require('./ja4.js');
const corpus = require('./safari-corpus.js');

const BIN = path.join(__dirname, '..', '..', 'engines', 'vendor', 'webkit', 'WebKitBuild', 'Release', 'bin');
const MB = path.join(BIN, 'MiniBrowser.exe');
const PORT = 10903;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const capture = startCaptureServer({ port: PORT, timeoutMs: 45000, label: 'engine-wincairo' });
  const url = 'https://localhost:' + PORT + '/probe';
  console.log('  launching ' + (path.basename(MB)) + '  ->  ' + url);

  const child = spawn(MB, [url], { cwd: BIN, stdio: 'ignore', windowsHide: false, detached: true });
  await delay(4000);

  let result;
  try {
    result = await capture;
  } catch (e) {
    try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {}
    console.error('ENGINE-PROBE FAIL ' + e.message);
    process.exit(3);
  }
  try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {}

  const buf = Buffer.from(result.helloHex, 'hex');
  const p = ja4.parseHello(buf);
  const r = ja4.fromBuffer(buf);
  const hit = corpus.find((e) => e.ja4 === r.ja4);

  console.log('  handshake bytes  = ' + buf.length);
  console.log('  legacy_version   = ' + ja4.hex4(p.version));
  console.log('  sni              = ' + JSON.stringify(p.sni));
  console.log('  ciphers (n=' + p.ciphers.length + ') = ' + p.ciphers.map(ja4.hex4).join(' '));
  console.log('  exts     (n=' + p.extensions.length + ') = ' + p.extensions.map(ja4.hex4).join(' '));
  console.log('  sigAlgs          = ' + (p.sigAlgs || []).map(ja4.hex4).join(' '));
  console.log('  alpn             = ' + p.alpn.map((x) => x.toString()).join(','));
  console.log('  JA4              = ' + r.ja4);
  console.log('  VERDICT          = ' + (hit ? 'EXACT-MATCH -> ' + hit.product : 'NOT-IN-CORPUS (engine wire is its own truth)'));

  const outDir = path.join(__dirname, 'receipts');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'hello-engine-wincairo.txt'), result.helloHex + '\n');
  fs.writeFileSync(path.join(outDir, 'engine-wincairo.json'), JSON.stringify({
    label: 'engine-wincairo',
    at: new Date().toISOString(),
    exe: 'MiniBrowser.exe (WinCairo WebKit2, BoringSSL)',
    build: 'Release|Win|Ninja|clang-cl',
    ja4: r.ja4,
    a: r.a,
    ciphers: p.ciphers.length,
    exts: p.extensions.length,
    verdict: hit ? 'EXACT-MATCH' : 'NOT-IN-CORPUS',
    note: 'engine wire is its own truth; Safari wire comes from sealed oracle beats (S12 cassette)',
  }, null, 2) + '\n');
  console.log('  receipt        = free-truth-probe/genes/receipts/engine-wincairo.json + hello-engine-wincairo.txt');
  process.exit(hit ? 0 : 5);
}

main().catch((e) => { console.error('ENGINE-PROBE UNHANDLED ' + e.message); process.exit(4); });