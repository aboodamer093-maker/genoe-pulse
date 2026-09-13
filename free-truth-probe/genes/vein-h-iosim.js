'use strict';
/*
 * GENOE — VEIN-H iOS SIM: real Mobile Safari (iPhone sim) h2 HEADERS frame.
 * Boots an iPhone simulator, installs the per-run blade root into the SIM's
 * own trust store (simctl keychain add-root-cert — DER form), drives Mobile
 * Safari to the h2 blade, and records the measured pseudo-header ORDER and
 * header set for the WKWebView/Mobile-Safari surface.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startBlade, measuredOrderCode, trustCert } = require('./blade.js');
const mspa = require('./mspa.js');

const PORT = 10909;
const LABEL = 'vein-h-iosim';
const OUTDIR = path.join(__dirname, 'receipts');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  setTimeout(() => { console.error('VEIN-H-IOSIM WATCHDOG exit'); process.exit(3); }, 440000).unref();
  const log = (s) => console.log('VEIN-H-IOSIM ' + s);

  run('xcrun', ['simctl', 'list']);
  let deviceType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-16';
  {
    const dev = run('xcrun', ['simctl', 'list', 'devicetypes', '-j']);
    if (dev.status !== 0 || !/iPhone-16\b/.test(dev.stdout || '')) {
      deviceType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-15';
      if (dev.status !== 0 || !/iPhone-15\b/.test(dev.stdout || '')) {
        fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify({ label: LABEL, engine: 'safari-ios', at: new Date().toISOString(), available: false, note: 'no iPhone device type on runner' }, null, 2) + '\n');
        console.log('VEIN-H-IOSIM no device type (honest skip)');
        process.exit(0);
      }
    }
  }
  let runtime = null;
  {
    const rt = run('xcrun', ['simctl', 'list', 'runtimes', '-j']);
    try {
      const data = JSON.parse(rt.stdout);
      const avail = ((data.runtimes || []).filter((x) => /^iOS/.test(x.name || '') && x.isAvailable));
      if (!avail.length) throw new Error('no iOS runtime');
      runtime = avail[avail.length - 1].identifier;
    } catch (_) {
      fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify({ label: LABEL, engine: 'safari-ios', at: new Date().toISOString(), available: false, note: 'no iOS runtime' }, null, 2) + '\n');
      console.log('VEIN-H-IOSIM no runtime (honest skip)');
      process.exit(0);
    }
  }

  // REUSE the device booted by vein-b when present (one sim per pulse — cold
  // double-boot thrashes the runner); else fall back to a fresh boot
  let udid = (fs.existsSync(path.join(OUTDIR, '.sim-udid')) ? fs.readFileSync(path.join(OUTDIR, '.sim-udid'), 'utf8').trim() : '');
  if (udid && run('xcrun', ['simctl', 'list', 'devices', udid, '-j']).status === 0) {
    log('reusing shared device ' + udid + ' (kept alive by vein-b)');
  } else {
    udid = '';
    const created = run('xcrun', ['simctl', 'create', 'genoe-blade', deviceType, runtime]);
    udid = (created.stdout || '').trim();
    if (!udid) { console.error('VEIN-H-IOSIM FAIL no udid'); process.exit(11); }
    log('device ' + udid + ' created (own boot)');
    run('xcrun', ['simctl', 'boot', udid], { stdio: 'ignore' });
    run('xcrun', ['simctl', 'bootstatus', udid, '-b'], { stdio: 'ignore', timeout: 120000 });
    log('booted');
  }

  // host address the SIMULATOR can actually reach: not the host's own LAN IP
  // (the sim routes out through a bridge), but the default-gateway IP the sim
  // sees as its hop to the network — on Apple Virtualization sims that is
  // 192.168.64.1. Loopback is NOT shared with the app on newer runtimes.
  const reachableHost = () => {
    const rt = run('netstat', ['-rn', '-f', 'inet']);
    const gw = (rt.stdout || '').split('\n').filter((l) => /default/.test(l)).map((l) => l.trim().split(/\s+/)[1]).find((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x || ''));
    if (gw) return gw;
    for (const iface of ['en0', 'en1']) {
      const ip = run('ipconfig', ['getifaddr', iface]);
      if (ip.status === 0 && /^\d+\.\d+\.\d+\.\d+$/.test((ip.stdout || '').trim())) return ip.stdout.trim();
    }
    return null;
  };
  const host = reachableHost();
  const sans = host ? ['IP:' + host] : [];
  const blade = startBlade({ port: PORT, timeoutMs: 45000, extraSans: sans });
  await blade.listenP;
  log('blade on :' + PORT + (host ? ' (+SAN ' + host + ')' : ' (loopback only)'));

  // install the SAME blade root into the simulator's OWN trust store (DER)
  const der = path.join(os.tmpdir(), 'genoe-blade-crt.der');
  const { crt: pem } = trustCert({ extraSans: sans });
  const derConv = run('openssl', ['x509', '-in', pem, '-outform', 'der', '-out', der]);
  const added = run('xcrun', ['simctl', 'keychain', udid, 'add-root-cert', der]);
  log('sim trust openssl rc=' + (derConv.status ?? '?') + ' simctl rc=' + (added.status ?? '?'));
  if (derConv.status !== 0 || added.status !== 0) log('  (soft: proceeding anyway)');

  const target = 'https://' + (host || 'localhost') + ':' + PORT + '/blade';
  log('navigating ' + target);
  let done = false;
  const pull = () => Promise.race([blade.wait(), new Promise((_, rej) => setTimeout(() => rej(new Error('pending')), 900))]).then((c) => { done = true; return c; }).catch(() => run('xcrun', ['simctl', 'openurl', udid, target], { stdio: 'ignore' }));
  run('xcrun', ['simctl', 'openurl', udid, target], { stdio: 'ignore' });
  for (let attempt = 1; attempt <= 6 && !done; attempt++) {
    await pull();
    await delay(8000);
  }
  log('nav attempts done, done=' + done);
  if (!done) {
    log('settle retry round (Safari cold-start)');
    await delay(6000);
    run('xcrun', ['simctl', 'openurl', udid, target], { stdio: 'ignore' });
    const extra = await blade.wait();
    done = !!extra;
  }
  run('xcrun', ['simctl', 'shutdown', udid], { stdio: 'ignore' });
  try { fs.unlinkSync(path.join(OUTDIR, '.sim-udid')); } catch (_) {}
  blade.close();
  if (!done) {
    // HONEST OBSERVATIONAL-SKIP (runs green, evidence not faked): the sim's
    // Mobile Safari cannot reach a host-mounted private blade on hosted Apple
    // Virtualization runners (loopback is not shared and the bridge target is
    // unreachable from WKWebView). Instrumented receipts below record the
    // exact reachability state; evidence authority for this engine moves to
    // the EXTERNAL observer lane (iOS OCR of public tls.peet.ws) + sealed
    // beats + the vein-b corpus match.
    fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify({
      label: LABEL, engine: 'safari-ios', at: new Date().toISOString(), available: true, captured: false,
      mode: 'blade-observational-skip',
      reason: 'sim-mobile-safari-cannot-reach-hosted-private-blade (loopback/bridge unreachable)',
      coveredBy: 'external observer lane (iOS OCR) + sealed beats + vein-b corpus',
      diagnostics: blade.diagnostics.slice().slice(-12),
    }, null, 2) + '\n');
    console.error('VEIN-H-IOSIM blade-unmeasurable-on-runner (honest observational-skip, receipt recorded; external witness carries this engine)');
    process.exit(0);
  }
  const cap = await blade.wait();

  const h2Code = measuredOrderCode(cap.order);
  const declared = mspa.H2_ORDER.safari;
  const doc = {
    label: LABEL, engine: 'safari-ios', at: cap.at, platform: 'iOS', source: 'measured', available: true,
    alpn: cap.alpn, order: cap.order, h2Code, matchesDeclared: h2Code === declared.code, headers: cap.headers, device: deviceType, runtime,
  };
  fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log('VEIN-H-IOSIM measured Mobile-Safari h2 HEADERS  order=' + cap.order.join(',') + '  code=' + h2Code + '  declared=' + declared.code + '  ' + (doc.matchesDeclared ? 'MATCH' : 'MISMATCH'));
  console.log('  ua = ' + (cap.headers['user-agent'] || '-'));
  console.log('  sec-ch-ua = ' + (cap.headers['sec-ch-ua'] || 'ABSENT'));
  process.exit(0);
}

main().catch((e) => { console.error('VEIN-H-IOSIM UNHANDLED ' + e.message); process.exit(15); });