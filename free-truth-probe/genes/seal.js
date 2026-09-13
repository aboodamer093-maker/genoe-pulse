'use strict';
/*
 * GENOE — SEAL (chain #1 beat mint)
 * ---------------------------------------------------------------------------
 * Merges the harvested veins (free-truth-probe/genes/receipts/*.json) into a
 * GENOE chain block under genoe/receipts/beats/, linked by sha256 to the
 * genesis seed and to the previous beat. Produces the heartbeat summary.
 *
 * Honesty rule: a beat is sealed only with at least one captured vein; empty
 * beats are never produced.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { verifyChain, selfHashOf } = require('./chain-verify.js');

const PROOT = path.join(__dirname, '..', '..');
const GENESIS = path.join(PROOT, 'genoe', 'receipts', 'chain-0-genesis.json');
const BEATS_DIR = path.join(PROOT, 'genoe', 'receipts', 'beats');
const RECEIPTS = path.join(__dirname, 'receipts');

const sha256 = (o) => crypto.createHash('sha256').update(typeof o === 'string' ? o : JSON.stringify(o), 'utf8').digest('hex');

// a vein/surface is only sealable if measured inside this rolling window —
// stale receipts from a previous run are NEVER reused (chain hygiene).
const FRESH_MS = 2 * 60 * 60 * 1000;
const fresh = (at) => { const t = Date.parse(at); return !Number.isNaN(t) && (Date.now() - t) <= FRESH_MS; };

function loadVeins() {
  const out = [];
  for (const f of ['vein-a-safari.json', 'vein-b-iosim.json']) {
    const p = path.join(RECEIPTS, f);
    if (!fs.existsSync(p)) continue;
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (v.ja4 && fresh(v.at)) out.push({ label: v.label, at: v.at, ja4: v.ja4, verdict: v.verdict, match: v.match || null });
  }
  return out;
}

function loadSurface() {
  const p = path.join(RECEIPTS, 'vein-s-macos.json');
  if (!fs.existsSync(p)) return null;
  const v = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!fresh(v.at)) return null;
  return { label: v.label, at: v.at, platform: v.platform, ua: v.ua, uaChAbsent: v.uaChAbsent };
}

function loadH2() {
  const out = [];
  if (!fs.existsSync(RECEIPTS)) return out;
  for (const f of fs.readdirSync(RECEIPTS)) {
    if (!/^vein-h-.*\.json$/.test(f)) continue;
    let v;
    try { v = JSON.parse(fs.readFileSync(path.join(RECEIPTS, f), 'utf8')); } catch (_) { continue; }
    if (v.h2Code && fresh(v.at)) out.push({ label: v.label, engine: v.engine, at: v.at, h2Code: v.h2Code, matchesDeclared: v.matchesDeclared });
  }
  return out;
}

// external observer witnesses inside the fresh rolling window: seals the
// outside world's own verdict (peet ja4/h2-order) cross-checked per engine.
function loadWitnesses() {
  const dir = path.join(RECEIPTS, 'observer');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    let v;
    try { v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    if (!fresh(v.at) || !v.witnessed) continue;
    out.push({
      engine: v.engine,
      at: v.at,
      token: v.token || null,
      verdict: v.verdict,
      ja4: (v.peet && v.peet.ja4) || null,
      h2PseudoOrder: (v.peet && v.peet.h2PseudoOrder) || null,
      cross: v.cross || null,
      recorderBJa4: (v.recorderB && v.recorderB.ja4) || null,
    });
  }
  return out;
}

function main() {
  if (!fs.existsSync(GENESIS)) { console.error('SEAL FAIL missing genesis ' + GENESIS); process.exit(20); }
  fs.mkdirSync(BEATS_DIR, { recursive: true });

  const veins = loadVeins();
  if (!veins.length) { console.error('SEAL FAIL no fresh captured vein — nothing to seal (no invented numbers).'); process.exit(21); }

  // VERIFY-THEN-SEAL: never mint on top of a broken chain. The walk also
  // recomputes every prior self-hash, so a forged/corrupt beat cannot ride
  // a valid prevHash link through.
  const chain = verifyChain();
  if (!chain.ok) { console.error('SEAL ABORT chain integrity violated: ' + chain.firstError); process.exit(22); }

  const existing = chain.beats;
  const prevFile = existing.length ? path.join(BEATS_DIR, existing[existing.length - 1]) : GENESIS;
  const seal = existing.length ? chain.maxSeal + 1 : 0;
  const prevHash = sha256(fs.readFileSync(prevFile, 'utf8'));
  const witnesses = loadWitnesses();

  const block = {
    kind: 'genoe/chain/beat',
    seal,
    at: new Date().toISOString(),
    prevHash,
    veins,
    surface: loadSurface(),
    h2: loadH2(),
    witnesses,
    summary: {
      veins: veins.length,
      exactMatches: veins.filter((v) => v.verdict === 'EXACT-MATCH').length,
      references: veins.filter((v) => v.verdict === 'NOT-IN-CORPUS').length,
      surface: loadSurface() ? 1 : 0,
      h2Blades: loadH2().length,
      witnesses: witnesses.length,
    },
  };
  block.hash = sha256(block);

  const outName = 'beat-' + String(seal).padStart(3, '0') + '.json';
  const outPath = path.join(BEATS_DIR, outName);
  const body = JSON.stringify(block, null, 2) + '\n';
  const tmp = outPath + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, outPath); // atomic: readers never see a half-written beat
  fs.writeFileSync(path.join(BEATS_DIR, 'index.json'), JSON.stringify({
    chain: 'genoe',
    rootSeed: 'chain-0-genesis.json',
    beats: [...existing, outName],
    lastHash: block.hash,
  }, null, 2) + '\n');

  // POST-MINT SELF-VERIFY: immediately re-walk genesis->tip INCLUDING the new
  // beat. If the mint somehow broke the chain, abort LOUDLY instead of letting
  // a broken tip get persisted as if green.
  const after = verifyChain();
  if (!after.ok) {
    console.error('SEAL POST-MINT VERIFY FAILED: ' + after.firstError);
    console.error('  ' + (after.errors || []).slice(0, 8).join('\n  '));
    process.exit(22);
  }
  console.log('SEAL post-mint verify GREEN (' + after.beats.length + ' beats, tip=' + outName + ')');

  console.log('SEAL #' + seal + ' beat=' + outName);
  console.log('  veins=' + block.summary.veins + ' exact=' + block.summary.exactMatches + ' refs=' + block.summary.references + '  witnesses=' + block.summary.witnesses);
  for (const v of veins) console.log('  ' + v.label.padEnd(14) + v.verdict.padEnd(12) + v.ja4 + (v.match ? '  -> ' + v.match : ''));
  console.log('  hash=' + block.hash.slice(0, 16) + '…  prev=' + prevHash.slice(0, 16) + '…');
  process.exit(0);
}

main();