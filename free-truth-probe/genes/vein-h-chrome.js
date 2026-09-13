'use strict';
/*
 * GENOE — VEIN-H CHROME: real macOS Google Chrome h2 HEADERS frame.
 * Chrome ships on the macos runners; driven via `open -a` (URL launch), no
 * automation permission needed. Chrome respects the system-trusted cert.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startBlade, measuredOrderCode } = require('./blade.js');
const mspa = require('./mspa.js');

const PORT = 10907;
const LABEL = 'vein-h-chrome';
const OUTDIR = path.join(__dirname, 'receipts');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const blade = startBlade({ port: PORT, timeoutMs: 60000 });
  await blade.listenP;
  spawnSync('open', ['-a', 'Google Chrome', 'https://localhost:' + PORT + '/blade'], { stdio: 'ignore' });
  const cap = await blade.wait();
  spawnSync('killall', ['Google Chrome'], { stdio: 'ignore' });
  blade.close();
  if (!cap) { console.error('VEIN-H-CHROME FAIL no request captured'); process.exit(14); }

  const h2Code = measuredOrderCode(cap.order);
  const declared = mspa.H2_ORDER.chrome;
  const doc = {
    label: LABEL,
    engine: 'chrome',
    at: cap.at,
    platform: 'macOS',
    source: 'measured',
    alpn: cap.alpn,
    order: cap.order,
    h2Code,
    matchesDeclared: h2Code === declared.code,
    headers: cap.headers,
  };
  fs.writeFileSync(path.join(OUTDIR, LABEL + '.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log('VEIN-H-CHROME measured Chrome h2 HEADERS  order=' + cap.order.join(',') + '  code=' + h2Code + '  declared=' + declared.code + '  ' + (doc.matchesDeclared ? 'MATCH' : 'MISMATCH'));
  console.log('  ua = ' + (cap.headers['user-agent'] || '-'));
  console.log('  sec-ch-ua = ' + (cap.headers['sec-ch-ua'] || 'ABSENT'));
  console.log('  accept-language = ' + (cap.headers['accept-language'] || '-'));
  process.exit(0);
}

main().catch((e) => { console.error('VEIN-H-CHROME UNHANDLED ' + e.message); process.exit(15); });