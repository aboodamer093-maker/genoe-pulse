'use strict';
/*
 * GENOE — VEIN-V: local raw-TLS ClientHello capture for Chrome + Firefox
 * ----------------------------------------------------------------------
 * Production-grade capture WITHOUT cert trust: the browser is DNS-restricted
 * to 127.0.0.1 while the SNI stays the REAL public hostname (tls.peet.ws),
 * so the harvested ClientHello is byte-comparable with the external observer's
 * capture of the SAME engine (same SNI host, same ALPN, same cipher list) —
 * yet the drop happens before any handshake, so no CA is touched.
 *
 *   chrome   -> --host-resolver-rules=MAP tls.peet.ws 127.0.0.1  (10910)
 *   firefox  -> local CONNECT proxy 10912 -> raw TLS server 10911
 *               (network.proxy.* prefs; the CONNECT tunnel carries the real
 *               ClientHello with SNI=tls.peet.ws unchanged)
 *
 * Exit: 0 = chrome captured  |  5 = only firefox not chrome  |  4 = neither.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { startCaptureServer } = require('./capture.js');
const ja4 = require('./ja4.js');

const CHROME_PORT = 10910;
const FIREFOX_PORT = 10911;
const PROXY_PORT = 10912;
const HOST = 'tls.peet.ws';
const OUTDIR = path.join(__dirname, 'receipts');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const rmrf = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} };

function writeReceipt(label, mode, helloHex, r, verdict, extra = {}) {
  const hexFile = path.join(OUTDIR, 'hello-' + label + '.txt');
  fs.writeFileSync(hexFile, helloHex + '\n');
  const doc = Object.assign({
    label,
    at: new Date().toISOString(),
    mode,
    ja4: r.ja4,
    a: r.a,
    sni: HOST,
    verdict,
    helloHexFile: hexFile,
  }, extra);
  fs.writeFileSync(path.join(OUTDIR, label + '.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log('VEIN-V ' + label + ' ' + verdict + ' ja4=' + r.ja4);
}

async function chromeCapture(token) {
  const capture = startCaptureServer({ port: CHROME_PORT, timeoutMs: 60000, label: 'vein-v-chrome' });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vveni-chrome-'));
  const child = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--no-first-run', '--disable-background-networking', '--no-default-browser-check', '--disable-component-update',
    '--user-data-dir=' + profile,
    '--host-resolver-rules=MAP ' + HOST + ' 127.0.0.1',
    'https://' + HOST + ':' + CHROME_PORT + '/api/all?tok=iv.chrome.' + token,
  ], { stdio: 'ignore' });
  let result;
  try {
    result = await Promise.race([capture, delay(60000).then(() => { throw new Error('chrome capture timeout'); })]);
  } finally {
    try { child.kill('SIGKILL'); } catch (_) {}
    rmrf(profile);
  }
  return result;
}

function startConnectProxy() {
  return new Promise((resolve) => {
    const proxy = net.createServer((cs) => {
      cs.once('data', (chunk) => {
        // The first data event is the CONNECT request head ONLY. We must NOT
        // forward that byte stream into the raw TLS capture server (a dumped
        // 'CONNECT tls.peet.ws…' would corrupt the first ClientHello record).
        // Answer the CONNECT, then bridge ONLY the post-handshake stream so the
        // raw server sees a clean TLS ClientHello with SNI=tls.peet.ws.
        const m = /^CONNECT\s+([^:\s]+)(?::(\d+))?\s+HTTP\/[01]\.\d/.exec(chunk.toString('latin1'));
        if (!m || m[1] !== HOST) { try { cs.end('HTTP/1.1 403 Forbidden\r\n\r\n'); } catch (_) {} return; }
        const up = net.connect(FIREFOX_PORT, '127.0.0.1', () => {
          if (!cs.destroyed) {
            cs.write('HTTP/1.1 200 Connection established\r\n\r\n');
            cs.pipe(up);
            up.pipe(cs);
          }
        });
        up.on('error', () => { try { cs.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch (_) {} });
      });
      cs.on('error', () => {});
    });
    proxy.listen(PROXY_PORT, '127.0.0.1', () => resolve(proxy));
  });
}

async function firefoxCapture(token) {
  const capture = startCaptureServer({ port: FIREFOX_PORT, timeoutMs: 60000, label: 'vein-v-firefox' });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vveni-fx-'));
  asWriter(profile);
  const proxy = await startConnectProxy();
  const child = spawn('/Applications/Firefox.app/Contents/MacOS/firefox', [
    '--headless', '--no-remote', '--profile', profile,
    'https://' + HOST + '/api/all?tok=iv.firefox.' + token,
  ], { stdio: 'ignore' });
  let result;
  try {
    result = await Promise.race([capture, delay(60000).then(() => { throw new Error('firefox capture timeout'); })]);
  } finally {
    try { child.kill('SIGKILL'); } catch (_) {}
    proxy.close();
    rmrf(profile);
  }
  return result;
}

function asWriter(profile) {
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'user.js'), [
    'user_pref("network.proxy.type", 1);',
    'user_pref("network.proxy.http", "127.0.0.1");',
    'user_pref("network.proxy.http_port", ' + PROXY_PORT + ');',
    'user_pref("network.proxy.ssl", "127.0.0.1");',
    'user_pref("network.proxy.ssl_port", ' + PROXY_PORT + ');',
    'user_pref("network.proxy.share_proxy_settings", true);',
    'user_pref("network.proxy.no_proxies_on", "");',
    'user_pref("network.http.connection-timeout", 15);',
    'user_pref("security.certerror.hideAddException", true);',
    'user_pref("network.dns.disablePrefetch", true);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
  ].join('\n') + '\n');
}

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  let chromeVerdict = null;
  let firefoxVerdict = null;

  try {
    const result = await chromeCapture(token);
    if (result && result.helloHex) {
      const r = ja4.fromBuffer(Buffer.from(result.helloHex, 'hex'));
      writeReceipt('vein-v-chrome', 'local-raw-tcp', result.helloHex, r, 'captured-local-raw-tcp-im');
      chromeVerdict = 'captured';
    }
  } catch (e) {
    console.error('VEIN-V chrome fail: ' + e.message);
  }

  try {
    const result = await firefoxCapture(token);
    if (result && result.helloHex) {
      const r = ja4.fromBuffer(Buffer.from(result.helloHex, 'hex'));
      writeReceipt('vein-v-firefox', 'local-raw-tcp', result.helloHex, r, 'captured-local-raw-tcp-im', { channel: 'connect-proxy:' + PROXY_PORT });
      firefoxVerdict = 'captured';
    }
  } catch (e) {
    console.error('VEIN-V firefox fail: ' + e.message);
  }

  console.log('VEIN-V chrome=' + (chromeVerdict || 'NONE') + '  firefox=' + (firefoxVerdict || 'NONE'));
  process.exit(chromeVerdict ? 0 : (firefoxVerdict ? 5 : 4));
}

main().catch((e) => { console.error('VEIN-V UNHANDLED ' + e.message); process.exit(7); });