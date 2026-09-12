'use strict';
/*
 * GENOE — HEARTBEAT orchestrator seed
 * ---------------------------------------------------------------------------
 * Runs before any real oracle pulse. Verifies the foundation is intact and
 * reports the live heartbeat line. A real pulse (vein-a/vein-b on macos-15)
 * seals actual Safari ClientHello bytes through ja4+crosscheck; until then
 * this file is the honest "no pulse yet" state — no invented numbers.
 */
const fs = require('fs');
const path = require('path');
const crosscheck = require('./crosscheck.js');

const PROOT = path.join(__dirname, '..', '..');
const GENESIS = path.join(PROOT, 'genoe', 'receipts', 'chain-0-genesis.json');

function main() {
  const t = [];
  const genesis = fs.readFileSync(GENESIS, 'utf8');
  const g = JSON.parse(genesis);
  t.push(['tree', 'genoe']);
  t.push(['seal', g.seal + ' (genesis seed)']);
  t.push(['chain-0', 'present']);

  const st = crosscheck.selfTest();
  t.push(['ja4-core spec', st.pass ? 'PASS' : 'FAIL']);

  const beats = (() => { try { return fs.readdirSync(path.join(__dirname, 'receipts')).filter((f) => /^beat-/).length; } catch (_) { return 0; } })();
  t.push(['sealed beats', beats]);
  t.push(['oracle pulse', 0, 'next: vein-a/vein-b on macos-15 (free Actions image)']);

  for (const [k, v, note] of t) {
    console.log('  ' + String(k).padEnd(14) + (note ? String(v) + '  —  ' + note : String(v)));
  }
  console.log('');
  console.log('HEARTBEAT: foundation OK, no beats yet — real Safari genes pending first oracle pulse.');
  console.log('DOCTRINE: no number is reported as measured until a sealed beat exists.');
  process.exit(st.pass ? 0 : 1);
}

main();