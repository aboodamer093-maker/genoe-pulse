'use strict';
/*
 * GENOE — JA4H (h2 pseudo-header order) truth table
 * ---------------------------------------------------------------------------
 * Per-browser ordering of the HTTP/2 HEADERS pseudo-block:
 *   m = :method, s = :scheme, p = :path, a = :authority
 *
 *   WebKit (macOS Safari AND every iOS shell: Safari, CriOS, EdgiOS, FxiOS)
 *          = msap   — the iOS shells are WKWebView, i.e. the SAME WebKit HTTP/2
 *                     engine as macOS Safari. Measured on macOS via sealed
 *                     vein-h-safari beats. (Not fxios->mpas, crios->masp.)
 *   Chrome  = masp   (measured: sealed beat-005 vein-h-chrome)
 *   Firefox = mpas   (Gecko; NOT measured locally yet — the lane is blocked by
 *                     the driver-port bug + NSS trust. Until measured via the
 *                     public-route observer, this value is DECLARED only.)
 */
const H2_ORDER = {
  webkit: { code: 'msap', seq: [':method', ':scheme', ':authority', ':path'], src: 'measured (sealed vein-h-safari beats) — WebKit engine family incl. iOS WKWebView shells' },
  chrome: { code: 'masp', seq: [':method', ':authority', ':scheme', ':path'], src: 'measured (sealed vein-h-chrome beats)' },
  firefox: { code: 'mpas', seq: [':method', ':path', ':authority', ':scheme'], src: 'declared (Gecko) — to be measured via public-route observer once the engine lane is wired' },
};

function orderingFor(skin) {
  const k = String(skin).toLowerCase();
  if (k.includes('safari') || k.includes('fxios') || k.includes('crios') || k.includes('edgios')) return H2_ORDER.webkit;
  if (k.includes('firefox')) return H2_ORDER.firefox;
  if (k.includes('chrome') || k.includes('edge') || k.includes('chromium')) return H2_ORDER.chrome;
  return null;
}

function selfTest() {
  const checks = [
    ['safari', 'msap'], ['Safari 26.6 skin', 'msap'], ['safari-ios', 'msap'],
    ['fxios', 'msap'], ['crios', 'msap'], ['edgios', 'msap'],
    ['firefox', 'mpas'], ['chrome', 'masp'], ['edge', 'masp'],
  ];
  const results = checks.map(([skin, want]) => {
    const g = orderingFor(skin);
    return { skin, pass: g && g.code === want, want, got: g ? g.code : null };
  });
  results.push({ skin: 'rule:ios-shells-webkit', pass: ['fxios', 'crios', 'edgios', 'safari-ios'].every((s) => (orderingFor(s) || {}).code === 'msap'), want: 'msap', got: 'msap' });
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