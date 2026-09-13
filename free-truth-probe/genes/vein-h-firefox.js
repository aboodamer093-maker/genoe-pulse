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
  setTimeout(() => { console.error('VEIN-H-FIREFOX WATCHDOG exit'); process.exit(3); }, 170000).unref();

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
    'pref("security.enterprise_roots.enabled", true);\n' +
    'pref("app.update.disabledForTesting", true);\n' +
    'pref("browser.startup.homepage", "about:blank");\n' +
    'pref("browser.startup.page", 0);\n' +
    'pref("browser.shell.checkDefaultBrowser", false);\n' +
    'pref("browser.tabs.warnOnClose", false);\n' +
    'pref("network.http.max-connections", 64);\n');
  const navigate = () => spawn(BIN, ['--headless', '--profile', profile, '--no-remote', 'https://localhost:' + PORT + '/blade'], { stdio: 'ignore' });
  const attempts = [];
  let child = navigate();
  attempts.push(blade.wait());
  let cap = await Promise.race(attempts);
  let shot = 1;
  while (!cap && shot < 3) {
    try { child.kill('SIGTERM'); } catch (_) {}
    await new Promise((r) => setTimeout(r, 6000));
    child = navigate();
    cap = await Promise.race([blade.wait()]);
    shot++;
  }
  try { child.kill('SIGTERM'); } catch (_) {}
  blade.close();
  if (!cap) {
    fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify({
      label: LABEL, engine: 'firefox', at: new Date().toISOString(), available: true, captured: false,
      note: 'engine present but no h2 request captured on runner this pulse (cold-start/trust flake)',
    }, null, 2) + '\n');
    console.error('VEIN-H-FIREFOX FAIL no request captured (receipt recorded)');
    process.exit(14);
  }

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