'use strict';
/*
 * GENOE — VEIN-H FIREFOX: real macOS Firefox h2 HEADERS frame.
 * Detects the binary; when absent on the runner it records that honestly and
 * exits 0 (nothing to measure). When present it launches the real binary
 * headless against the shared h2 blade — genuine Gecko wire.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startBlade, measuredOrderCode } = require('./blade.js');
const mspa = require('./mspa.js');

const PORT = 10908;
const LABEL = 'vein-h-firefox';
const BIN = '/Applications/Firefox.app/Contents/MacOS/firefox';
const OUTDIR = path.join(__dirname, 'receipts');

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  setTimeout(() => { console.error('VEIN-H-FIREFOX WATCHDOG exit'); process.exit(3); }, 70000).unref();

  if (!fs.existsSync(BIN)) {
    fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify({
      label: LABEL, engine: 'firefox', at: new Date().toISOString(), available: false,
      note: 'Firefox not on this runner — nothing to measure (honest skip)',
    }, null, 2) + '\n');
    console.log('VEIN-H-FIREFOX engine not on runner (skip, exit 0)');
    process.exit(0);
  }

  const blade = startBlade({ port: PORT, timeoutMs: 60000 });
  await blade.listenP;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genoe-ff-'));
  // Firefox ignores the OS keychain unless it reads enterprise roots — without
  // this the blade's system-trusted root is unknown to Gecko and the h2 request
  // NEVER happens (flaky timeout). Explicitly enable it for this profile.
  fs.writeFileSync(path.join(profile, 'user.js'),
    'pref("security.enterprise_roots.enabled", true);\npref("app.update.disabledForTesting", true);\n');
  const navigate = () => spawn(BIN, ['--headless', '--profile', profile, 'https://localhost:' + PORT + '/blade'], { stdio: 'ignore' });
  let child = navigate();
  let cap = await blade.wait();
  if (!cap) { // bounded cold-start retry: kill and relaunch once
    try { child.kill('SIGTERM'); } catch (_) {}
    await new Promise((r) => setTimeout(r, 5000));
    child = navigate();
    cap = await blade.wait();
  }
  try { child.kill('SIGTERM'); } catch (_) {}
  blade.close();
  if (!cap) { console.error('VEIN-H-FIREFOX FAIL no request captured'); process.exit(14); }

  const h2Code = measuredOrderCode(cap.order);
  const declared = mspa.H2_ORDER.firefox;
  const doc = {
    label: LABEL, engine: 'firefox', at: cap.at, platform: 'macOS', source: 'measured', available: true,
    alpn: cap.alpn, order: cap.order, h2Code, matchesDeclared: h2Code === declared.code, headers: cap.headers,
  };
  fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log('VEIN-H-FIREFOX measured Firefox h2 HEADERS  order=' + cap.order.join(',') + '  code=' + h2Code + '  declared=' + declared.code + '  ' + (doc.matchesDeclared ? 'MATCH' : 'MISMATCH'));
  console.log('  ua = ' + (cap.headers['user-agent'] || '-'));
  console.log('  sec-ch-ua = ' + (cap.headers['sec-ch-ua'] || 'ABSENT'));
  console.log('  accept-language = ' + (cap.headers['accept-language'] || '-'));
  process.exit(0);
}

main().catch((e) => { console.error('VEIN-H-FIREFOX UNHANDLED ' + e.message); process.exit(15); });