'use strict';
/*
 * GENOE — VEIN-H CHROME: real macOS Google Chrome h2 HEADERS frame.
 * Detects the binary; when absent on the runner it records that honestly and
 * exits 0 (nothing to measure). When present it launches WebDriver-free via
 * the real binary (--headless=new) against the shared h2 blade — headless
 * Chrome still emits its genuine TLS + h2 HEADERS wire.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startBlade, measuredOrderCode } = require('./blade.js');
const mspa = require('./mspa.js');

const PORT = 10907;
const LABEL = 'vein-h-chrome';
const BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUTDIR = path.join(__dirname, 'receipts');

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  setTimeout(() => { console.error('VEIN-H-CHROME WATCHDOG exit'); process.exit(3); }, 70000).unref();

  if (!fs.existsSync(BIN)) {
    fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify({
      label: LABEL, engine: 'chrome', at: new Date().toISOString(), available: false,
      note: 'Google Chrome not on this runner — nothing to measure (honest skip)',
    }, null, 2) + '\n');
    console.log('VEIN-H-CHROME engine not on runner (skip, exit 0)');
    process.exit(0);
  }

  const blade = startBlade({ port: PORT, timeoutMs: 60000 });
  await blade.listenP;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genoe-cr-'));
  const child = spawn(BIN, ['--headless=new', '--no-first-run', '--disable-background-networking', '--no-default-browser-check', '--user-data-dir=' + profile, 'https://localhost:' + PORT + '/blade'], { stdio: 'ignore' });
  const cap = await blade.wait();
  try { child.kill('SIGTERM'); } catch (_) {}
  blade.close();
  if (!cap) { console.error('VEIN-H-CHROME FAIL no request captured'); process.exit(14); }

  const h2Code = measuredOrderCode(cap.order);
  const declared = mspa.H2_ORDER.chrome;
  const doc = {
    label: LABEL, engine: 'chrome', at: cap.at, platform: 'macOS', source: 'measured', available: true,
    alpn: cap.alpn, order: cap.order, h2Code, matchesDeclared: h2Code === declared.code, headers: cap.headers,
  };
  fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log('VEIN-H-CHROME measured Chrome h2 HEADERS  order=' + cap.order.join(',') + '  code=' + h2Code + '  declared=' + declared.code + '  ' + (doc.matchesDeclared ? 'MATCH' : 'MISMATCH'));
  console.log('  ua = ' + (cap.headers['user-agent'] || '-'));
  console.log('  sec-ch-ua = ' + (cap.headers['sec-ch-ua'] || 'ABSENT'));
  console.log('  accept-language = ' + (cap.headers['accept-language'] || '-'));
  process.exit(0);
}

main().catch((e) => { console.error('VEIN-H-CHROME UNHANDLED ' + e.message); process.exit(15); });