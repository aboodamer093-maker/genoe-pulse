'use strict';
/*
 * GENOE — VEIN-H FIREFOX: real macOS Firefox h2 HEADERS frame.
 * Firefox ships on the macos runners; driven via `open -a`. Firefox treats
 * the system-trusted cert as valid for this local endpoint.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startBlade, measuredOrderCode } = require('./blade.js');
const mspa = require('./mspa.js');

const PORT = 10908;
const LABEL = 'vein-h-firefox';
const OUTDIR = path.join(__dirname, 'receipts');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  setTimeout(() => { console.error('VEIN-H-FIREFOX WATCHDOG exit'); process.exit(3); }, 70000).unref();
  const blade = startBlade({ port: PORT, timeoutMs: 60000 });
  await blade.listenP;
  const f = spawnSync('open', ['-a', 'Firefox', 'https://localhost:' + PORT + '/blade'], { stdio: 'ignore', timeout: 20000 });
  if (f.error) console.error('open: ' + f.error.message);
  const cap = await blade.wait();
  spawnSync('killall', ['Firefox'], { stdio: 'ignore' });
  blade.close();
  if (!cap) { console.error('VEIN-H-FIREFOX FAIL no request captured'); process.exit(14); }

  const h2Code = measuredOrderCode(cap.order);
  const declared = mspa.H2_ORDER.firefox;
  const doc = {
    label: LABEL,
    engine: 'firefox',
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
  console.log('VEIN-H-FIREFOX measured Firefox h2 HEADERS  order=' + cap.order.join(',') + '  code=' + h2Code + '  declared=' + declared.code + '  ' + (doc.matchesDeclared ? 'MATCH' : 'MISMATCH'));
  console.log('  ua = ' + (cap.headers['user-agent'] || '-'));
  console.log('  sec-ch-ua = ' + (cap.headers['sec-ch-ua'] || 'ABSENT'));
  console.log('  accept-language = ' + (cap.headers['accept-language'] || '-'));
  process.exit(0);
}

main().catch((e) => { console.error('VEIN-H-FIREFOX UNHANDLED ' + e.message); process.exit(15); });