'use strict';
/*
 * GENOE — CHAIN VERIFIER (single source of truth for chain integrity)
 * ------------------------------------------------------------------
 * Walks genesis -> tip recomputing EVERY prev-link (sha256 of the previous
 * beat's EXACT file bytes, exactly as seal.js sealed it) and EVERY stored
 * self-hash (sha256 of the parsed beat object minus its hash field), then
 * asserts index.json.lastHash equals the tip hash. Read-only — never writes,
 * never mints. Used by: seal.js (verify-then-seal), gene-gate, pulse CI.
 *
 * Exit: 0 = GREEN, 22 = structural chain lie.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROOT = path.join(__dirname, '..', '..');
const GENESIS = path.join(PROOT, 'genoe', 'receipts', 'chain-0-genesis.json');
const BEATS_DIR = path.join(PROOT, 'genoe', 'receipts', 'beats');
const INDEX = path.join(BEATS_DIR, 'index.json');

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

function selfHashOf(beat) {
  const clone = Object.assign({}, beat);
  delete clone.hash;
  return sha256(JSON.stringify(clone));
}

function verifyChain() {
  const errors = [];
  const beats = [];
  if (!fs.existsSync(GENESIS)) return { ok: false, beats, maxSeal: -1, firstError: 'genesis missing', errors };
  const genesisText = fs.readFileSync(GENESIS, 'utf8');
  if (!fs.existsSync(BEATS_DIR)) return { ok: true, beats, maxSeal: -1, firstError: null, errors };

  const names = fs.readdirSync(BEATS_DIR)
    .filter((f) => /^beat-\d+\.json$/.test(f))
    .sort();
  let prevSha = sha256(genesisText);
  let expected = 0;
  for (const f of names) {
    const num = parseInt(f.slice(5, -5), 10);
    if (num !== expected) errors.push('seal number gap at ' + f + ' (expected ' + expected + ')');
    expected = num + 1;
    const fileText = fs.readFileSync(path.join(BEATS_DIR, f), 'utf8');
    let beat;
    try { beat = JSON.parse(fileText); } catch (e) { errors.push(f + ' unparseable: ' + e.message); continue; }
    if (beat.prevHash !== prevSha) errors.push(f + ' prevHash mismatch (got ' + String(beat.prevHash).slice(0, 12) + '… want ' + prevSha.slice(0, 12) + '…)');
    const self = selfHashOf(beat);
    if (beat.hash !== self) errors.push(f + ' self-hash mismatch (stored ' + String(beat.hash).slice(0, 12) + '… recomputed ' + self.slice(0, 12) + '…)');
    prevSha = sha256(fileText);
    beats.push(f);
  }
  const maxSeal = beats.length ? parseInt(beats[beats.length - 1].slice(5, -5), 10) : -1;
  const idx = (() => { try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch (_) { return null; } })();
  if (beats.length) {
    if (!idx) {
      errors.push('index.json missing while beats exist (chain not sealed)');
    } else {
      if (idx.beats.length !== beats.length || idx.beats[idx.beats.length - 1] !== beats[beats.length - 1]) {
        errors.push('index.beats divergent from beats dir');
      }
      const tip = JSON.parse(fs.readFileSync(path.join(BEATS_DIR, beats[beats.length - 1]), 'utf8'));
      if (idx.lastHash !== tip.hash) errors.push('index.lastHash != tip.hash');
    }
  }
  return { ok: errors.length === 0, beats, maxSeal, firstError: errors[0] || null, errors };
}

function gateResult() {
  const v = verifyChain();
  const detail = v.ok ? 'genesis->tip OK (' + v.beats.length + ' beats, last seal #' + v.maxSeal + ')' : (v.firstError || 'chain broken');
  return { pass: v.ok, results: [{ name: 'chain-integrity', pass: v.ok, detail }] };
}

if (require.main === module) {
  // ALWAYS write a committed verdict file — even on crash — so a red post-seal
  // verification can never hide its own cause from future analysis.
  const verdictPath = path.join(__dirname, 'receipts', 'chain-verify.json');
  const writeVerdict = (doc) => {
    try {
      fs.mkdirSync(path.dirname(verdictPath), { recursive: true });
      fs.writeFileSync(verdictPath, JSON.stringify(doc, null, 2) + '\n');
    } catch (_) {}
  };
  let v = null;
  let crash = null;
  try {
    v = verifyChain();
  } catch (e) {
    crash = String(e && e.stack || e);
    v = { ok: false, beats: [], maxSeal: -1, errors: ['CLI crashed: ' + crash] };
  }
  console.log('CHAIN VERIFY ' + (v.ok ? 'GREEN' : 'RED'));
  console.log('  beats=' + v.beats.length + '  last=' + (v.maxSeal >= 0 ? 'beat-' + String(v.maxSeal).padStart(3, '0') : 'genesis only'));
  for (const e of (v.errors || []).slice(0, 25)) console.log('  ERR ' + e);
  writeVerdict({ at: new Date().toISOString(), ok: v.ok, beats: v.beats.length, last: v.maxSeal, errors: (v.errors || []).slice(0, 60), crash: crash || null });
  console.log('  verdict written to receipts/chain-verify.json');
  process.exit(v.ok ? 0 : 22);
}

module.exports = { verifyChain, gateResult, selfHashOf };