'use strict';
/*
 * GENOE — UAD MATRIX (user-agent & client-hints truth per skin)
 * ---------------------------------------------------------------------------
 * Rules (honesty first):
 *   - Safari (macOS & iOS skins): NO UA-CH. Real Safari never sends Sec-CH-UA*.
 *   - Firefox (macOS skin): NO UA-CH (Gecko does not emit client hints).
 *   - Chrome (macOS skin) & CriOS/EdgiOS (iOS): full UA-CH on request headers.
 * UA strings are template-declared from official/vendor formats until the
 * oracle header-vein (S14) replaces them with measured values.
 */
const UA_TEMPLATE = {
  'safari-macos': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Safari/605.1.15',
  'safari-ios':   'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  'crios-ios':    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7152.87 Mobile/15E148 Safari/604.1',
  'edgios-ios':   'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/138.0.7168.58 Mobile/15E148 Safari/604.1',
  'fxios-ios':    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/138.0 Mobile/15E148 Safari/604.1',
  'chrome-macos': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'firefox-macos': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
  'safari-engine': '',
};

const UACH_PAYLOAD = {
  chrome: (v) => ({ 'Sec-CH-UA': '"Chromium";v="146.0.0.0", "Google Chrome";v="146.0.0.0", "Not(A:Brand";v="99.0.0.0"', 'Sec-CH-UA-Platform': '"macOS"', 'Sec-CH-UA-Platform-Version': '"15.7.0"', 'Sec-CH-UA-Mobile': '?0', 'Sec-CH-UA-Full-Version-List': '"Chromium";v="146.0.0.0", "Google Chrome";v="146.0.0.0"' }),
};

const ROWS = [
  { skin: 'safari-macos',  ua: UA_TEMPLATE['safari-macos'],  uaCh: 'none', note: 'Safari sends no Client Hints on real wire' },
  { skin: 'safari-ios',    ua: UA_TEMPLATE['safari-ios'],    uaCh: 'none', note: 'Safari sends no Client Hints on real wire' },
  { skin: 'crios-ios',     ua: UA_TEMPLATE['crios-ios'],     uaCh: 'none', note: 'CriOS is WKWebView; iOS WebKit does not emit UA-CH' },
  { skin: 'edgios-ios',    ua: UA_TEMPLATE['edgios-ios'],    uaCh: 'none', note: 'EdgiOS is WKWebView; no UA-CH' },
  { skin: 'fxios-ios',     ua: UA_TEMPLATE['fxios-ios'],     uaCh: 'none', note: 'FxiOS is WKWebView; no UA-CH' },
  { skin: 'chrome-macos',  ua: UA_TEMPLATE['chrome-macos'],  uaCh: 'full', note: 'desktop Chrome emits UA-CH (MEASURED vein-h-chrome: sec-ch-ua present)' },
  { skin: 'firefox-macos', ua: UA_TEMPLATE['firefox-macos'], uaCh: 'none', note: 'Firefox emits no UA-CH (MEASURED vein-h-firefox: sec-ch-ua absent)' },
];
// safari-macos UA replaced by the MEASURED value from S14 vein-s (sealed
// beat-001): the oracle runner's real Safari 26.6.1 — a declaration no longer.

function selfTest() {
  const results = [];
  for (const row of ROWS) {
    const pass = (typeof row.ua === 'string' && row.ua.length > 0) &&
                 (row.uaCh === 'none' || row.uaCh === 'full') &&
                 (row.uaCh === 'none' || UACH_PAYLOAD.chrome);
    results.push({ skin: row.skin, pass, uaCh: row.uaCh });
  }
  const safariHonest = ROWS.filter((r) => r.skin.startsWith('safari')).every((r) => r.uaCh === 'none');
  results.push({ skin: 'rule:safari-no-uach', pass: safariHonest, uaCh: 'none' });
  return { pass: results.every((r) => r.pass), results };
}

if (require.main === module) {
  const r = selfTest();
  console.log('UAD SELF-TEST ' + (r.pass ? 'PASS' : 'FAIL'));
  for (const res of r.results) {
    console.log('  [' + (res.pass ? 'PASS' : 'FAIL') + '] ' + res.skin.padEnd(24) + ' uaCh=' + res.uaCh);
  }
  console.log('  (safari-macos UA = measured S14 vein-s; others are declared from official templates — payable via header-vein)');
  process.exit(r.pass ? 0 : 1);
}

module.exports = { ROWS, UACH_PAYLOAD, UA_TEMPLATE, selfTest };