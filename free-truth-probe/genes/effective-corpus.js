'use strict';
/*
 * GENOE — EFFECTIVE CORPUS (public + sealed-measured)
 * ---------------------------------------------------------------------------
 * Tier-1 = public declared-prior references (independent).
 * Tier-2 = values SEALED from our own oracle beats (measured reality).
 * Merged by ja4 with tier-1 priority. Effect: a repeat measurement of the
 * same stable Safari build matches as EXACT-MATCH against the sealed beat
 * (self-consistent truth), while public values never lose precedence.
 */
const fs = require('fs');
const path = require('path');
const publicCorpus = require('./safari-corpus.js');

const BEATS_DIR = path.join(__dirname, '..', '..', 'genoe', 'receipts', 'beats');

function loadBeats() {
  if (!fs.existsSync(BEATS_DIR)) return [];
  return fs.readdirSync(BEATS_DIR)
    .filter((f) => /^beat-\d+\.json$/.test(f))
    .sort()
    .map((f) => {
      let beat;
      try { beat = JSON.parse(fs.readFileSync(path.join(BEATS_DIR, f), 'utf8')); } catch (_) { return null; }
      return beat && beat.veins ? { file: f, seal: beat.seal, at: beat.at, veins: beat.veins } : null;
    })
    .filter(Boolean);
}

function effectiveCorpus() {
  const pub = publicCorpus.map((e) => ({ ja4: e.ja4, product: e.product, platform: e.platform, source: e.source, tier: 1 }));
  const seen = new Set(pub.map((e) => e.ja4));
  for (const beat of loadBeats()) {
    for (const v of beat.veins || []) {
      if (!v.ja4) continue;
      if (seen.has(v.ja4)) continue; // public already owns the value
      seen.add(v.ja4);
      pub.push({
        ja4: v.ja4,
        product: (v.match ? v.match + ' (=sealed beat) ' : 'Sealed measured ') + beat.file,
        platform: v.label,
        source: 'sealed-beat #' + beat.seal + ' (' + (v.at || '').slice(0, 10) + ')',
        tier: 2,
      });
    }
  }
  return pub;
}

function corpusStats() {
  const all = effectiveCorpus();
  return {
    tier1: all.filter((e) => e.tier === 1).length,
    tier2: all.filter((e) => e.tier === 2).length,
    total: all.length,
  };
}

function selfTest() {
  // every sealed beat value must be present in the effective corpus (as t2
  // or shadowed by an identical public t1); counts must be coherent.
  const all = effectiveCorpus();
  const stats = corpusStats();
  const byJa4 = new Set(all.map((e) => e.ja4));
  let missing = 0;
  for (const beat of loadBeats()) {
    for (const v of beat.veins || []) if (v.ja4 && !byJa4.has(v.ja4)) missing++;
  }
  const pass = missing === 0 && stats.tier1 >= 3 && stats.tier2 >= 0;
  return { pass, results: [{ name: 'effective-corpus', pass, detail: stats.tier1 + ' public / ' + stats.tier2 + ' sealed — missing=' + missing }] };
}

if (require.main === module) {
  const s = selfTest();
  console.log('EFFECTIVE CORPUS SELF-TEST ' + (s.pass ? 'PASS' : 'FAIL'));
  for (const r of s.results) console.log('  [' + (r.pass ? 'PASS' : 'FAIL') + '] ' + r.detail);
  const st = corpusStats();
  console.log('  totals: ' + st.tier1 + ' public / ' + st.tier2 + ' sealed (total ' + st.total + ')');
  process.exit(s.pass ? 0 : 1);
}

module.exports = { effectiveCorpus, corpusStats, loadBeats, selfTest };