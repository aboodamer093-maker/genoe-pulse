'use strict';
/*
 * GENOE — HEARTBEAT orchestrator
 * ---------------------------------------------------------------------------
 * Verifies the GENOE foundation is intact and reports the live heartbeat from
 * the sealed chain: number of beats, latest beat hash, and an honest per-vein
 * summary. No number is invented here — everything comes from files sealed by
 * the oracle (vein-a/vein-b on macos-15).
 */
const fs = require('fs');
const path = require('path');
const crosscheck = require('./crosscheck.js');
const { verifyChain } = require('./chain-verify.js');

const PROOT = path.join(__dirname, '..', '..');
const GENESIS = path.join(PROOT, 'genoe', 'receipts', 'chain-0-genesis.json');
const BEATS_DIR = path.join(PROOT, 'genoe', 'receipts', 'beats');

function main() {
  const t = [];
  const genesis = fs.readFileSync(GENESIS, 'utf8');
  const g = JSON.parse(genesis);
  t.push(['tree', 'genoe']);
  t.push(['chain-0', 'genesis ' + g.seal]);

  const st = crosscheck.selfTest();
  t.push(['ja4-core spec', st.pass ? 'PASS' : 'FAIL']);

  let beats = [];
  try {
    beats = fs.readdirSync(BEATS_DIR)
      .filter((f) => /^beat-\d+\.json$/.test(f))
      .sort();
  } catch (_) { beats = []; }
  t.push(['sealed beats', beats.length]);

  if (beats.length) {
    const v = verifyChain();
    const last = JSON.parse(fs.readFileSync(path.join(BEATS_DIR, beats[beats.length - 1]), 'utf8'));
    t.push(['last seal #', last.seal]);
    t.push(['last hash', String(last.hash || '').slice(0, 16) + '…']);
    t.push(['prev-links', v.ok ? 'verified genesis->tip (' + v.beats.length + ' links)' : 'BROKEN — ' + (v.firstError || '?')]);
    t.push(['oracle pulse', 'LIVE']);
    for (const v of last.veins) {
      t.push(['  ' + v.label, v.verdict + (v.match ? '  ->  ' + v.match : ''), v.ja4]);
    }
    if (last.witnesses && last.witnesses.length) {
      for (const w of last.witnesses) {
        t.push(['  ' + w.engine, w.verdict, w.ja4 + (w.h2PseudoOrder ? '  h2=' + w.h2PseudoOrder : '')]);
      }
    } else {
      t.push(['witnessed', 0, 'no external witness sealed this beat']);
    }
  } else {
    t.push(['oracle pulse', 0, 'no sealed beat yet — next: vein-a/vein-b on macos-15 (free Actions image)']);
  }

  for (const [k, v, note] of t) {
    console.log('  ' + String(k).padEnd(14) + (note ? String(v) + '  —  ' + note : String(v)));
  }
  console.log('');
  if (beats.length) {
    console.log('HEARTBEAT: ' + beats.length + ' sealed beat' + (beats.length === 1 ? '' : 's') + ' — live truth from real Safari (macOS + iOS simulator).');
  } else {
    console.log('HEARTBEAT: foundation OK, no beats yet — real Safari genes pending first oracle pulse.');
  }
  console.log('DOCTRINE: no number is reported as measured until a sealed beat exists.');
  process.exit(st.pass ? 0 : 1);
}

main();