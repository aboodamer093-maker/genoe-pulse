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

const PROOT = path.join(__dirname, '..', '..');
const GENESIS = path.join(PROOT, 'genoe', 'receipts', 'chain-0-genesis.json');
const BEATS_DIR = path.join(PROOT, 'genoe', 'receipts', 'beats');
const RECEIPTS = path.join(__dirname, 'receipts');

const sha256 = (o) => crypto.createHash('sha256').update(typeof o === 'string' ? o : JSON.stringify(o), 'utf8').digest('hex');

function loadVeins() {
  const out = [];
  for (const f of ['vein-a-safari.json', 'vein-b-iosim.json']) {
    const p = path.join(RECEIPTS, f);
    if (!fs.existsSync(p)) continue;
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (v.ja4) out.push({ label: v.label, at: v.at, ja4: v.ja4, verdict: v.verdict, match: v.match || null });
  }
  return out;
}

function loadSurface() {
  const p = path.join(RECEIPTS, 'vein-s-macos.json');
  if (!fs.existsSync(p)) return null;
  const v = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { label: v.label, at: v.at, platform: v.platform, ua: v.ua, uaChAbsent: v.uaChAbsent };
}

function main() {
  if (!fs.existsSync(GENESIS)) { console.error('SEAL FAIL missing genesis ' + GENESIS); process.exit(20); }
  fs.mkdirSync(BEATS_DIR, { recursive: true });

  const veins = loadVeins();
  if (!veins.length) { console.error('SEAL FAIL no captured vein — nothing to seal (no invented numbers).'); process.exit(21); }

  const existing = fs.existsSync(BEATS_DIR)
    ? fs.readdirSync(BEATS_DIR).filter((f) => /^beat-\d+\.json$/.test(f)).sort()
    : [];
  const seal = existing.length;
  const prevFile = seal === 0 ? GENESIS : path.join(BEATS_DIR, existing[existing.length - 1]);
  const prevHash = sha256(fs.readFileSync(prevFile, 'utf8'));

  const block = {
    kind: 'genoe/chain/beat',
    seal,
    at: new Date().toISOString(),
    prevHash,
    veins,
    surface: loadSurface(),
    summary: {
      veins: veins.length,
      exactMatches: veins.filter((v) => v.verdict === 'EXACT-MATCH').length,
      references: veins.filter((v) => v.verdict === 'NOT-IN-CORPUS').length,
      surface: loadSurface() ? 1 : 0,
    },
  };
  block.hash = sha256(block);

  const outName = 'beat-' + String(seal).padStart(3, '0') + '.json';
  fs.writeFileSync(path.join(BEATS_DIR, outName), JSON.stringify(block, null, 2) + '\n');
  fs.writeFileSync(path.join(BEATS_DIR, 'index.json'), JSON.stringify({
    chain: 'genoe',
    rootSeed: 'chain-0-genesis.json',
    beats: [...existing, outName],
    lastHash: block.hash,
  }, null, 2) + '\n');

  console.log('SEAL #' + seal + ' beat=' + outName);
  console.log('  veins=' + block.summary.veins + ' exact=' + block.summary.exactMatches + ' refs=' + block.summary.references);
  for (const v of veins) console.log('  ' + v.label.padEnd(14) + v.verdict.padEnd(12) + v.ja4 + (v.match ? '  -> ' + v.match : ''));
  console.log('  hash=' + block.hash.slice(0, 16) + '…  prev=' + prevHash.slice(0, 16) + '…');
  process.exit(0);
}

main();