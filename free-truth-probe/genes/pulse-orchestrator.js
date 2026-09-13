'use strict';
/*
 * GENOE — PULSE ORCHESTRATOR (parallel measurement burst)
 * --------------------------------------------------------
 * Replaces the 16-step serial pipeline with a dependency-aware WAVE burst.
 * Cross-engine measurements are independent, so Chrome, Firefox, Safari and
 * the wire (wire-verify, python curl_cffi) all run CONCURRENTLY; only the
 * shared-resource lanes stay serialized:
 *   wave 1  (parallel)  vein-a-safari | vein-h-chrome | vein-h-firefox |
 *                       vein-v (chrome+firefox raw TLS) | wire-verify
 *   wave 2  (parallel)  [vein-s-macos -> vein-h-safari] | vein-b-iosim
 *   wave 3  (serial)    vein-h-iosim (own sim boot; do not race vein-b's)
 *
 * A lane is OK if its exit code is within its acceptable set (measured or
 * honest negation). The orchestrator aggregates the verdict per lane instead
 * of the workflow turning each miss into a wall-clock loss.
 *
 * Exit: 0 = burst complete (any measurement captured, hard fails recorded)
 *       4 = every lane hard-failed (nothing at all could be measured)
 */
const { spawn } = require('child_process');
const path = require('path');

const G = (f) => path.join(__dirname, f);
const LANES = {
  'vein-a-safari': { script: 'vein-a-safari.js', ok: [0, 5], hd: 'Safari local JA4' },
  'vein-h-chrome': { script: 'vein-h-chrome.js', ok: [0, 5], hd: 'Chrome h2 HEADERS' },
  'vein-h-firefox': { script: 'vein-h-firefox.js', ok: [0, 5], hd: 'Firefox h2 HEADERS' },
  'vein-v': { script: 'vein-v.js', ok: [0, 5], hd: 'Chrome+Firefox raw JA4' },
  'vein-x': { script: 'wire-verify.js', ok: [0, 4, 5], hd: 'External wire verify', venv: true },
  'parity-curl': { script: 'parity-curl.js', ok: [0, 5], hd: 'curl_cffi corpus parity', venv: true },
  'vein-s-macos': { script: 'vein-s-macos.js', ok: [0], hd: 'Safari surface' },
  'vein-b-iosim': { script: 'vein-b-iosim.js', ok: [0, 5], hd: 'iOS JA4' },
  'vein-h-iosim': { script: 'vein-h-iosim.js', ok: [0, 5], hd: 'iOS h2 HEADERS' },
};

function runLane(name) {
  const L = LANES[name];
  return new Promise((resolve) => {
    let child = null;
    try {
      const started = Date.now();
      console.log('[burst] lane ' + name + ' (' + L.hd + ') started');
      if (L.venv) {
        child = spawn('/bin/bash', ['-lc', 'cd ' + JSON.stringify(path.join(__dirname, '..', '..')) + ' && python3 -m pip install --break-system-packages --quiet --disable-pip-version-check curl_cffi >/dev/null 2>&1; node free-truth-probe/genes/' + L.script], { stdio: 'inherit' });
      } else {
        child = spawn('node', [G(L.script)], { stdio: 'inherit' });
      }
      const killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} console.error('[burst] lane ' + name + ' watchdog killed'); }, 420000);
      killTimer.unref();
      child.on('exit', (code) => {
        clearTimeout(killTimer);
        const ok = L.ok.includes(code);
        console.log('[burst] lane ' + name + ' exit=' + code + (ok ? ' OK' : ' HARD-FAIL') + ' ' + ((Date.now() - started) / 1000).toFixed(1) + 's');
        resolve({ name, code, ok, hard: !ok });
      });
      child.on('error', (e) => { clearTimeout(killTimer); console.error('[burst] lane ' + name + ' spawn error ' + e.message); resolve({ name, code: null, ok: false, hard: true }); });
    } catch (e) {
      // a synchronous spawn throw (EMFILE/resource pressure) must NEVER kill
      // the whole burst: record the lane and let the wave continue
      console.error('[burst] lane ' + name + ' sync-spawn error ' + e.message);
      resolve({ name, code: null, ok: false, hard: true });
    }
  });
}

async function runItem(item) {
  if (typeof item === 'string') return [await runLane(item)];
  if (item && Array.isArray(item.serial)) {
    const out = [];
    for (const sub of item.serial) out.push(await runLane(sub));
    return out;
  }
  return [];
}

// run a wave and ALWAYS resolve: settle every lane/item independently so a
// single rejection can never abort the measurement burst early
async function settleWave(wave) {
  const lanes = [];
  const results = [];
  const started = Date.now();
  if (wave.parallel) {
    for (const item of wave.parallel) {
      if (typeof item === 'string') lanes.push(item);
      else if (item && Array.isArray(item.serial)) lanes.push.apply(lanes, item.serial);
    }
    const settled = await Promise.allSettled((wave.parallel).map((item) => runItem(item)));
    for (const s of settled) {
      if (s.status === 'fulfilled') s.value.forEach((x) => { results.push(x); });
      else console.error('[burst] wave item rejected: ' + (s.reason && s.reason.message));
    }
  } else if (wave.serial) {
    const settled = await Promise.allSettled([runItem({ serial: wave.serial })]);
    for (const s of settled) {
      if (s.status === 'fulfilled') s.value.forEach((x) => results.push(x));
    }
  }
  return { results, labels: lanes };
}

async function main() {
  console.log('GENOE BURST (parallel measurement) — ' + new Date().toISOString());
  const results = [];
  const WAVES = [
    { parallel: ['vein-a-safari', 'vein-h-chrome', 'vein-h-firefox', 'vein-v', 'vein-x', 'parity-curl'] },
    { parallel: [{ serial: ['vein-s-macos', 'vein-h-safari'] }, 'vein-b-iosim'] },
    { serial: ['vein-h-iosim'] },
  ];
  for (const wave of WAVES) {
    console.log('[burst] === WAVE ' + (WAVES.indexOf(wave) + 1) + ' ===');
    const { results: waveResults, labels } = await settleWave(wave);
    results.push.apply(results, waveResults);
    const stuck = labels.filter((l) => !waveResults.some((r) => r.name === l));
    if (stuck.length) console.error('[burst] wave ' + (WAVES.indexOf(wave) + 1) + ' lanes never reported: ' + stuck.join(', '));
  }
  const hard = results.filter((r) => r.hard);
  const okNames = results.filter((r) => r.ok).map((r) => r.name);
  console.log('[burst] complete. ok=' + okNames.join(','));
  if (hard.length) console.error('[burst] hard-failed lanes: ' + hard.map((h) => h.name).join(', '));
  const anythingMeasured = results.some((r) => r.ok);
  process.exit(anythingMeasured ? 0 : (hard.length ? 4 : 0));
}

main().catch((e) => { console.error('BURST UNHANDLED ' + e.message); process.exit(7); });