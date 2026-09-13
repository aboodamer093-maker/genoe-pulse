'use strict';
/*
 * GENOE — EXTERNAL WIRE VERIFICATION (the crown check)
 * ---------------------------------------------------------------------------
 * Claims are never self-verifying. This probe drives the SAME curl_cffi
 * Safari profiles the shell would use (JA4-parity proven locally against
 * sealed beats) at an INDEPENDENT third-party fingerprint service and
 * records the JA4 the OUTSIDE WORLD measures for us. The claim "wire ==
 * Safari 26.0/26.0.1" only stands if an external neutral server sees the
 * same shape. This is the honest, non-circular proof.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { effectiveCorpus } = require('./effective-corpus.js');
const cassette = require('./cassette.js');

const PY = 'python3';
const TOOL = path.join(__dirname, '..', 'tools', 'wire-verify-py.py');
const OUTDIR = path.join(__dirname, 'receipts', 'wire-verify');
const SERVICE = 'https://tls.peet.ws/api/all';

// profile -> expected (from our OWN measured/verified world)
const PROFILES = [
  { profile: 'safari260',  product: 'Safari 26.0',   cassetteJa4: 't13d2014h2_a09f3c656075_d0a99439f9b1' },
  { profile: 'safari2601', product: 'Safari 26.0.1', cassetteJa4: 't13d2013h2_a09f3c656075_7f0f34a4126d' },
  { profile: 'safari260_ios', product: 'Safari iOS 26 (mobile)', cassetteJa4: null },
];

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const corpus = effectiveCorpus();
  const rows = [];
  console.log('EXTERNAL WIRE VERIFICATION  (independent service: ' + SERVICE + ')');
  if (!fs.existsSync(TOOL)) {
    for (const p of PROFILES) {
      const rec = { profile: p.profile, product: p.product, cassetteJa4: p.cassetteJa4, outsideJa4: null, outsideJa3: null, verdict: 'tool-missing', error: 'wire-verify-py.py not present in free-truth-probe/tools (untracked?)' };
      rows.push(rec);
      console.log('  ' + p.profile.padEnd(14) + ' tool-missing');
    }
    fs.writeFileSync(path.join(OUTDIR, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), service: SERVICE, rows }, null, 2) + '\n');
    console.log('EXTERNAL VERIFY TOOL MISSING -> receipts/wire-verify/summary.json (honest, non-green)');
    process.exit(7);
  }
  for (const p of PROFILES) {
    const r = spawnSync(PY, [TOOL, '--profile', p.profile, '--service', SERVICE], { encoding: 'utf8', timeout: 70000, maxBuffer: 1 << 22 });
    let rec = { profile: p.profile, product: p.product, cassetteJa4: p.cassetteJa4, outsideJa4: null, outsideJa3: null, verdict: 'fetch-failed', error: null };
    if (r.status === 0 && r.stdout) {
      try {
        const data = JSON.parse(r.stdout);
        const tls = data.tls || data;
        rec.outsideJa4 = tls.ja4 || null;
        rec.outsideJa3 = tls.ja3_hash || tls.ja3 || null;
        const corpusHit = rec.outsideJa4 ? corpus.find((e) => e.ja4 === rec.outsideJa4) : null;
        const cassetteOk = p.cassetteJa4 ? rec.outsideJa4 === p.cassetteJa4 : null;
        rec.verdict = rec.outsideJa4 ? (corpusHit ? 'EXACT-MATCH ' + corpusHit.product : 'NOT-IN-CORPUS') : 'no-ja4';
        // external observation of the h2 HEADERS pseudo-order (msap etc.)
        const frames = (data.http2 || {}).sent_frames || [];
const hf = frames.find((f) => f.frame_type === 'HEADERS');
        if (hf && Array.isArray(hf.headers)) {
          const PSEUDO = { method: 'm', scheme: 's', path: 'p', authority: 'a' };
          const pseudo = hf.headers.filter((x) => String(x).startsWith(':'));
          rec.h2PseudoOrder = pseudo.map((x) => {
            const tok = String(x).split(/\s+/)[0].replace(/^:|:$/g, '');
            return PSEUDO[tok] || '?';
          }).join('');
        }
        rec.parityWithCassette = cassetteOk;
        rec.outsideUa = data.user_agent || null;
      } catch (e) {
        rec.error = 'unparseable response: ' + String(e).slice(0, 200);
      }
    } else {
      rec.error = (r.stderr || '') + ' ' + (r.error ? r.error.message : '');
    }
    rows.push(rec);
    console.log('  ' + p.profile.padEnd(14) + ' outsideJa4=' + (rec.outsideJa4 || '-') + '  ' + rec.verdict + (rec.outsideJa4 === p.cassetteJa4 ? '  [== our cassette]' : '') + (rec.h2PseudoOrder ? '  h2=' + rec.h2PseudoOrder : '') + (rec.error ? '  err=' + String(rec.error).slice(0, 120) : ''));
  }
  fs.writeFileSync(path.join(OUTDIR, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), service: SERVICE, rows }, null, 2) + '\n');
  const measured = rows.filter((r) => r.outsideJa4).length;
  const matched = rows.filter((r) => r.outsideJa4 && r.parityWithCassette !== false && r.verdict.startsWith('EXACT')).length;
  console.log('EXTERNAL VERIFY ' + matched + '/' + rows.length + ' exact  (' + measured + '/' + rows.length + ' measured by the outside world)  ->  receipts/wire-verify/summary.json');
  // HONEST EXIT CONTRACT (no green-with-zero-proof):
  //   0 = >=1 profile EXACT (crown confirmed against a neutral third party)
  //   5 = measured by outside world, zero exact (valid NOT-IN-CORPUS beat)
  //   4 = NOTHING measured at all — the crown could not even be reached
  process.exit(matched ? 0 : (measured ? 5 : 4));
}

function sha(s) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(String(s || ''), 'utf8').digest('hex').slice(0, 12);
}

main().catch((e) => { console.error('WIRE-VERIFY UNHANDLED ' + e.message); process.exit(6); });