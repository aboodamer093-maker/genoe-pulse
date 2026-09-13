'use strict';
/*
 * GENOE — JA4H (h2 pseudo-header order) truth table
 * ---------------------------------------------------------------------------
 * Per-browser ordering of the HTTP/2 HEADERS pseudo-block:
 *   m = :method, s = :scheme, p = :path, a = :authority
 *
 *   Safari  = msap   (MEASURED: sealed beat-002 vein-h — real 26.6.1 wire
 *                     shows :method,:scheme,:authority,:path. The earlier
 *                     mspa declaration was WRONG cancel of oracle value.)
 *   Chrome  = masp
 *   Firefox = mpas
 */
const H2_ORDER = {
  safari: { code: 'msap', seq: [':method', ':scheme', ':authority', ':path'], src: 'measured (sealed beat-002 vein-h + beat-005 vein-h-safari)' },
  chrome: { code: 'masp', seq: [':method', ':authority', ':scheme', ':path'], src: 'measured (sealed beat-005 vein-h-chrome)' },
  firefox: { code: 'mpas', seq: [':method', ':path', ':authority', ':scheme'], src: 'measured (sealed beat-005 vein-h-firefox)' },
};

function orderingFor(skin) {
  const k = String(skin).toLowerCase();
  if (k.includes('safari')) return H2_ORDER.safari;
  if (k.includes('firefox') || k.includes('fxios')) return H2_ORDER.firefox;
  if (k.includes('chrome') || k.includes('crios') || k.includes('edge') || k.includes('edgios')) return H2_ORDER.chrome;
  return null;
}

function selfTest() {
  const checks = [
    ['safari', 'msap'], ['Safari 26.6 skin', 'msap'], ['crios', 'masp'],
    ['edgios', 'masp'], ['fxios', 'mpas'], ['chrome', 'masp'],
  ];
  const results = checks.map(([skin, want]) => {
    const g = orderingFor(skin);
    return { skin, pass: g && g.code === want, want, got: g ? g.code : null };
  });
  return { pass: results.every((r) => r.pass), results };
}

if (require.main === module) {
  const r = selfTest();
  console.log('MSPA SELF-TEST ' + (r.pass ? 'PASS' : 'FAIL'));
  for (const res of r.results) {
    console.log('  [' + (res.pass ? 'PASS' : 'FAIL') + '] skin=' + res.skin.padEnd(20) + ' want=' + res.want + '  got=' + res.got);
  }
  process.exit(r.pass ? 0 : 1);
}

module.exports = { H2_ORDER, orderingFor, selfTest };