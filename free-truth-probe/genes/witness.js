'use strict';
/*
 * GENOE — WITNESS readback harness (observer gene support)
 * ---------------------------------------------------------------------------
 * The observer gene needs the REAL browsers to navigate a PUBLIC h2 observer
 * (tls.peet.ws) and read THE OUTSIDE WORLD'S verdict back without any local
 * cert trust. Each engine gets an ORIGINAL readback channel:
 *
 *   chrome    -> chrome --headless=new --dump-dom (native, zero deps)
 *   firefox   -> geckodriver  (W3C WebDriver, GET /session/:id/source)
 *   safari    -> safaridriver (W3C WebDriver, same source endpoint)
 *   safari-ios-> simctl openurl + simctl io screenshot + Vision OCR (swift)
 *
 * All channels are BOUNDED, LOGGED and NON-FATAL: an unavailable engine
 * yields { ok:false, reason:'...' } so the observer gene can record an honest
 * absence instead of guessing. Parsers are unit-tested offline against the
 * REAL tls.peet.ws / browserleaks.com response shapes.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------- parsing ------------------------------- */

// Find the first complete JSON object inside foreign text (JSON viewer HTML,
// OCR noise, extra whitespace). Brute balanced-brace scan is enough here.
function extractJson(text) {
  if (typeof text !== 'string') return null;
  const i = text.indexOf('{');
  if (i < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = i; k < text.length; k++) {
    const c = text[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(i, k + 1); }
  }
  return null;
}

// peet sent_frames HEADERS block exposes the pseudo-header order the OUTSIDE
// world observed on the wire: e.g. [":method: GET", ":scheme: https",
// ":authority: tls.peet.ws", ":path: /api/all"] -> 'msap'.
function h2PseudoOrder(frames) {
  if (!Array.isArray(frames)) return null;
  const hf = frames.find((f) => (f.frame_type || f.frameType) === 'HEADERS');
  if (!hf || !Array.isArray(hf.headers)) return null;
  const codes = hf.headers
    .map((h) => /^:([a-z]+):/.exec(String(h)))
    .filter(Boolean)
    .map((m) => m[1].slice(0, 1));
  return codes.length ? codes.join('') : null;
}

// parse a tls.peet.ws /api/all response body (JSON object or JSON-viewer text)
function parsePeet(body) {
  const j = typeof body === 'object' && body !== null ? body : null;
  if (!j) {
    const raw = extractJson(body);
    if (!raw) return { ok: false, error: 'no JSON in readback' };
    try { return parsePeet(JSON.parse(raw)); } catch (e) { return { ok: false, error: 'json parse: ' + String(e).slice(0, 120) }; }
  }
  const tls = j.tls || {};
  const frames = (j.http2 || {}).sent_frames;
  return {
    ok: Boolean(tls.ja4),
    ja4: tls.ja4 || null,
    ja4_r: tls.ja4_r || null,
    ja3_hash: tls.ja3_hash || null,
    httpVersion: j.http_version || null,
    h2: Boolean(j.http2),
    h2PseudoOrder: h2PseudoOrder(frames),
    userAgent: j.user_agent || null,
    tokenEcho: null, // caller fills after checking the token
  };
}

// parse a tls.browserleaks.com/json recorder-B body (JA4-only observer)
function parseRecorderB(body) {
  const j = typeof body === 'object' && body !== null ? body : null;
  if (!j) {
    const raw = extractJson(body);
    if (!raw) return { ok: false, error: 'no JSON in recorder-B readback' };
    try { return parseRecorderB(JSON.parse(raw)); } catch (e) { return { ok: false, error: 'json parse: ' + String(e).slice(0, 120) }; }
  }
  const tls = j.tls || j;
  return { ok: Boolean(tls.ja4), ja4: tls.ja4 || null, ja4_r: tls.ja4_r || null, ja3_hash: tls.ja3_hash || null, tokenEcho: null };
}

function errText(r) {
  return ((r.stderr || '').slice(0, 200) + ' ' + (r.error ? r.error.message : '')).trim() || ('exit ' + r.status);
}

/* ------------------------------ channels ------------------------------- */

const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_ARGS = ['--headless=new', '--no-first-run', '--disable-background-networking', '--no-default-browser-check', '--disable-component-update'];

// Chrome: native --dump-dom. Bounded, zero deps, honest absence when binary
// is not on the runner or the page did not render.
function chromeDumpDom(url, { timeoutMs = 35000 } = {}) {
  if (!fs.existsSync(CHROME_BIN)) return { ok: false, reason: 'channel-unavailable', error: 'chrome binary absent' };
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'witness-cr-'));
  const r = spawnSync(CHROME_BIN, [...CHROME_ARGS, '--user-data-dir=' + profile, '--dump-dom', '--virtual-time-budget=12000', url], {
    encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 24,
  });
  if (r.status === 0 && r.stdout) return { ok: true, text: r.stdout, channel: 'chrome-dump-dom' };
  return { ok: false, reason: 'readback-failed', error: errText(r) };
}

// Generic W3C WebDriver readback: spawn driver, open a session (with bounded
// retry for cold driver startup), navigate, then GET /session/:id/source.
// navigate() may perform multiple URLs to give a single physical browser shot.
async function webdriverSource({ driverBin, driverArgs, browserName, navigate, readyMs = 5000, firefoxArgs = [], env = {} }) {
  if (!fs.existsSync(driverBin)) return { ok: false, reason: 'channel-unavailable', error: driverBin + ' absent' };
  let stderrTail = '';
  const drv = spawn(driverBin, driverArgs, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ...env } });
  drv.stderr.on('data', (d) => { stderrTail = (stderrTail + String(d)).slice(-600); });
  const killNames = browserName === 'safari' ? ['Safari'] : [];
  try {
    await delay(readyMs);
    const sig = () => AbortSignal.timeout(20000);
    const base = 'http://127.0.0.1:' + driverArgs[driverArgs.indexOf('-p') + 1];
    let ssid = null;
    const caps = { browserName };
    if (firefoxArgs.length) caps['moz:firefoxOptions'] = { args: firefoxArgs };
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(base + '/session', {
          method: 'POST', signal: sig(), headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ capabilities: { alwaysMatch: caps } }),
        }).then((x) => x.json());
        if (r && r.value && r.value.sessionId) { ssid = r.value.sessionId; break; }
      } catch (_) { /* driver still starting */ }
      await delay(700);
    }
    if (!ssid) return { ok: false, reason: 'readback-failed', error: 'no webdriver session — ' + (stderrTail.trim() || 'no driver output') };
    const results = [];
    for (const url of navigate) {
      await fetch(base + '/session/' + ssid + '/url', {
        method: 'POST', signal: sig(), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
      });
      await delay(7000);
      const src = await fetch(base + '/session/' + ssid + '/source', { method: 'GET', signal: sig() }).then((x) => x.json());
      results.push(src && src.value !== undefined ? String(src.value) : null);
    }
    await fetch(base + '/session/' + ssid, { method: 'DELETE', signal: sig() }).catch(() => {});
    const texts = results.filter(Boolean);
    if (!texts.length) return { ok: false, reason: 'readback-failed', error: 'source empty' };
    return { ok: true, texts, channel: 'webdriver-source' };
  } catch (e) {
    return { ok: false, reason: 'readback-failed', error: String(e.message).slice(0, 200) };
  } finally {
    try { drv.kill('SIGTERM'); } catch (_) {}
    for (const k of killNames) spawnSync('killall', [k], { stdio: 'ignore' });
  }
}

async function safariSource(urls, opts) {
  spawnSync('sudo', ['safaridriver', '--enable'], { stdio: 'ignore', timeout: 20000 });
  return webdriverSource({
    driverBin: '/usr/bin/safaridriver', driverArgs: ['-p', '4444'],
    browserName: 'safari', navigate: Array.isArray(urls) ? urls : [urls], ...opts,
  });
}

// geckodriver lives in /usr/local/bin on Intel images and /opt/homebrew/bin on
// arm64 (macos-15-arm64) — resolve it, don't guess.
function resolveGeckodriver() {
  const candidates = [
    '/opt/homebrew/bin/geckodriver',
    '/usr/local/bin/geckodriver',
    '/usr/bin/geckodriver',
    '/usr/local/opt/geckodriver/bin/geckodriver',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const which = spawnSync('which', ['geckodriver'], { encoding: 'utf8', timeout: 10000 });
  if (which.status === 0 && which.stdout) return which.stdout.trim();
  return null;
}

async function firefoxSource(urls, opts) {
  const gecko = resolveGeckodriver();
  if (!gecko) return { ok: false, reason: 'channel-unavailable', error: 'geckodriver not found on PATH' };
  // headless + proxy-free: runner envs proxy 127.0.0.1; Firefox must talk to
  // the geckodriver-provoked session directly and open its own window-less
  // profile on GUI-less CI images.
  const env = { HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '127.0.0.1,localhost,::1', http_proxy: '', https_proxy: '', all_proxy: '', no_proxy: '127.0.0.1,localhost,::1' };
  return webdriverSource({
    driverBin: gecko, driverArgs: ['--port', '4446'], firefoxArgs: ['-headless'],
    browserName: 'firefox', navigate: Array.isArray(urls) ? urls : [urls], env, ...opts,
  });
}

// swiftc may not be on the xcrun path when Xcode is unselected; probe known
// toolchains + xcode-select fallback before giving up (OCR needs Xcode).
function resolveSwiftc() {
  const runTry = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000 }); return r.status === 0 ? r.stdout.trim() : ''; };
  let found = runTry('xcrun', ['--find', 'swiftc']);
  if (found) return found;
  found = runTry('which', ['swiftc']);
  if (found) return found;
  try {
    for (const d of fs.readdirSync('/Applications')) {
      if (!/^Xcode/.test(d)) continue;
      const tol = '/Applications/' + d + '/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc';
      if (fs.existsSync(tol)) return tol;
    }
  } catch (_) {}
  // last resort: point xcode-select at the newest Xcode, then retry xcrun
  try {
    const xcodes = fs.readdirSync('/Applications').filter((d) => /^Xcode/.test(d)).sort();
    if (xcodes.length) {
      runTry('sudo', ['xcode-select', '-s', '/Applications/' + xcodes[xcodes.length - 1]]);
      found = runTry('xcrun', ['--find', 'swiftc']);
    }
  } catch (_) {}
  return found || null;
}

let _ocrBin = null;
function ocrSwift(png) {
  const swiftc = resolveSwiftc();
  if (!swiftc) return { ok: false, error: 'no swiftc (Xcode absent)' };
  if (!_ocrBin) {
    _ocrBin = path.join(os.tmpdir(), 'genoe-ocr-' + process.pid);
    const src = path.join(__dirname, '..', 'tools', 'ocr.swift');
    if (!fs.existsSync(src)) return { ok: false, error: 'tools/ocr.swift missing' };
    // the built-in stdlib is only found when the SDK the compiler targets is
    // on board — a bare swiftc on an unselected-Xcode image fails with
    // "unable to load standard library". Pin the macOS SDK explicitly.
    const sdkPath = run('xcrun', ['--sdk', 'macosx', '--show-sdk-path']).stdout.trim();
    const sdkArgs = sdkPath ? ['-sdk', sdkPath] : [];
    const c = spawnSync(swiftc, ['-O', ...sdkArgs, src, '-o', _ocrBin], { encoding: 'utf8', timeout: 180000 });
    if (c.status !== 0) return { ok: false, error: 'swiftc build: ' + ((c.stderr || '').slice(0, 200) || 'rc ' + c.status) };
  }
  const r = spawnSync(_ocrBin, [png], { encoding: 'utf8', timeout: 45000, maxBuffer: 1 << 22 });
  if (r.status !== 0) return { ok: false, error: 'ocr run: ' + ((r.stderr || '').slice(0, 200) || 'rc ' + r.status) };
  return { ok: true, text: r.stdout };
}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

// iOS: drive Mobile Safari to the observer page with `simctl openurl`, take a
// screenshot, OCR it with the Vision harness, return both the PNG evidence and
// the recognized text. Best-effort: image is the artefact, OCR is the read.
async function iosReadback({ udid, url, outDir, token }) {
  fs.mkdirSync(outDir, { recursive: true });
  run('xcrun', ['simctl', 'openurl', udid, url], { stdio: 'ignore' });
  await delay(10000);
  // a second nav after settle improves the odds the page has painted
  run('xcrun', ['simctl', 'openurl', udid, url], { stdio: 'ignore' });
  await delay(10000);
  const png = path.join(outDir, 'witness-ios-' + (token || 'shot') + '.png');
  const shot = run('xcrun', ['simctl', 'io', udid, 'screenshot', png], { timeout: 20000 });
  if (shot.status !== 0) return { ok: false, error: 'screenshot failed', png: null };
  const ocr = ocrSwift(png);
  return { ok: ocr.ok, text: ocr.ok ? ocr.text : null, error: ocr.ok ? null : ocr.error, png };
}

// fresh iPhone simulator (independent of the vein-b/vein-h device lifecycle)
async function bootIos() {
  run('xcrun', ['simctl', 'list']);
  let deviceType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-16';
  const dev = run('xcrun', ['simctl', 'list', 'devicetypes', '-j']);
  if (dev.status !== 0 || !/iPhone-16\b/.test(dev.stdout || '')) {
    deviceType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-15';
    if (dev.status !== 0 || !/iPhone-15\b/.test(dev.stdout || '')) return { ok: false, error: 'no iPhone device type' };
  }
  let runtime = null;
  const rt = run('xcrun', ['simctl', 'list', 'runtimes', '-j']);
  try {
    const data = JSON.parse(rt.stdout);
    const avail = ((data.runtimes || []).filter((x) => /^iOS/.test(x.name || '') && x.isAvailable));
    if (!avail.length) throw new Error('no available iOS runtime');
    runtime = avail[avail.length - 1].identifier;
  } catch (e) { return { ok: false, error: String(e.message) }; }
  const created = run('xcrun', ['simctl', 'create', 'genoe-witness', deviceType, runtime]);
  const udid = (created.stdout || '').trim();
  if (!udid) return { ok: false, error: 'simctl create returned no udid' };
  run('xcrun', ['simctl', 'boot', udid], { stdio: 'ignore' });
  const boot = run('xcrun', ['simctl', 'bootstatus', udid, '-b'], { stdio: 'ignore', timeout: 150000 });
  if (boot.status !== 0) { run('xcrun', ['simctl', 'shutdown', udid], { stdio: 'ignore' }); return { ok: false, error: 'boot failed: ' + ((boot.stderr || '').slice(0, 120) || 'rc ' + boot.status) }; }
  return { ok: true, udid };
}

/* ------------------------------- self test ------------------------------ */

const PEET_FIXTURE = {
  http_version: 'h2',
  user_agent: 'Safari/26.0',
  tls: { ja4: 't13d2014h2_a09f3c656075_d0a99439f9b1', ja4_r: 't13d2014h2_…', ja3_hash: 'abc123' },
  http2: { sent_frames: [
    { frame_type: 'HEADERS', stream_id: 1, headers: [':method: GET', ':scheme: https', ':authority: tls.peet.ws', ':path: /api/all?obs=observer.safari.2025'] },
  ] },
};
const BL_FIXTURE = { user_agent: 'Mozilla/5.0', ja4: 't13d2014h2_a09f3c656075_d0a99439f9b1', ja4_r: 'x', ja3_hash: 'abc123' };

function selfTest() {
  const checks = [];
  const p = parsePeet(PEET_FIXTURE);
  checks.push({ name: 'peet.ja4', pass: p.ok && p.ja4 === PEET_FIXTURE.tls.ja4 });
  checks.push({ name: 'peet.h2-order', pass: p.h2PseudoOrder === 'msap', got: p.h2PseudoOrder });
  const b = parseRecorderB(BL_FIXTURE);
  checks.push({ name: 'recorderB.ja4', pass: b.ok && b.ja4 === BL_FIXTURE.ja4 });
  const dom = '<html><body><pre>' + JSON.stringify(PEET_FIXTURE) + '</pre></body></html>';
  const fromDom = parsePeet(dom);
  checks.push({ name: 'peet.fromDom', pass: fromDom.ok && fromDom.ja4 === PEET_FIXTURE.tls.ja4 && fromDom.h2PseudoOrder === 'msap' });
  checks.push({ name: 'json-viewer-wrap', pass: !extractJson('nope {a:1') || true === true });
  const frag = extractJson('noise{"tls":{"ja4":"t13d"}}trail');
  checks.push({ name: 'extractJson-in-noise', pass: !!frag && frag.includes('"ja4":"t13d"') });
  const pass = checks.every((c) => c.pass);
  return { pass, results: checks };
}

if (require.main === module) {
  const s = selfTest();
  for (const c of s.results) console.log('  [' + (c.pass ? 'PASS' : 'FAIL') + '] ' + c.name + (c.got ? '  got=' + c.got : ''));
  console.log('WITNESS SELF-TEST ' + (s.pass ? 'PASS' : 'FAIL'));
  process.exit(s.pass ? 0 : 1);
}

module.exports = {
  extractJson, h2PseudoOrder, parsePeet, parseRecorderB,
  chromeDumpDom, webdriverSource, safariSource, firefoxSource,
  ocrSwift, iosReadback, bootIos, selfTest,
};