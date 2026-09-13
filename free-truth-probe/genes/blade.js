'use strict';
/*
 * GENOE — H2 BLADE (shared): per-engine HEADERS-frame capture server.
 * ---------------------------------------------------------------------------
 * Generates + system-trusts a per-run self-signed cert (SAN localhost), serves
 * HTTP/2 (ALPN h2), records the FIRST request's pseudo-header ORDER and the
 * measured header field set. The driving vein chooses the engine transport.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http2 = require('http2');

let _certCache = null;

function trustCert({ extraSans = [] } = {}) {
  // one cert per process (workflow runs each vein as its own node process)
  if (_certCache && fs.existsSync(_certCache.crt)) return _certCache;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genoe-h2-'));
  const key = path.join(dir, 'key.pem');
  const crt = path.join(dir, 'crt.pem');
  const ext = path.join(dir, 'san.cnf');
  const alt = ['DNS:localhost', 'IP:127.0.0.1', 'IP:::1'].concat(extraSans);
  fs.writeFileSync(ext, `[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=localhost\n[v3]\nsubjectAltName=${alt.join(',')}\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`);
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', crt, '-config', ext], { timeout: 25000, maxBuffer: 1 << 20, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('openssl cert gen: ' + ((r.stderr || '') + ' ' + (r.error ? r.error.message : '')).slice(0, 300));
  // headless runners can hang on the keychain UI prompt — bound it hard
  const trust = spawnSync('sudo', ['security', 'add-trusted-cert', '-d', '-r', 'trustRoot', '-k', '/Library/Keychains/System.keychain', crt], { timeout: 30000, maxBuffer: 1 << 20, encoding: 'utf8' });
  if (trust.status !== 0) throw new Error('keychain trust: ' + ((trust.stderr || '') + ' ' + (trust.error ? trust.error.message : '')).slice(0, 300));
  _certCache = { key, crt };
  return _certCache;
}

function measuredOrderCode(keys) {
  const map = { ':method': 'm', ':scheme': 's', ':path': 'p', ':authority': 'a' };
  return keys.filter((k) => map[k]).map((k) => map[k]).join('').slice(0, 4) || '';
}

function startBlade({ port, timeoutMs = 60000, extraSans = [] } = {}) {
  const { key, crt } = trustCert({ extraSans });
  const server = http2.createSecureServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt), allowHTTP1: false });
  let captured = null;
  let resolveCap;
  const capturedPromise = new Promise((r) => { resolveCap = r; });
  const diagnostics = [];

  server.on('request', (req, res) => {
    if (!captured) {
      captured = {
        at: new Date().toISOString(),
        alpn: req.stream.session.alpnProtocol || '',
        remote: req.socket.remoteAddress,
        headers: req.headers,
        order: Object.keys(req.headers),
        diagnostics: diagnostics.slice(),
      };
      resolveCap(captured);
      setTimeout(() => { try { server.close(); } catch (_) {} }, 300);
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('GENOE h2 blade captured');
  });

  // honest per-observer diagnostics: engines that reach the blade but fail TLS
  // (cert untrusted, ALPN mismatch, reset) are RECORDED, not silently swallowed.
  // connection/secure logs disambiguate "never reached TCP" from "TLS refused".
  const logDiag = (d) => { if (diagnostics.length < 60) diagnostics.push(d); };
  server.on('connection', (s) => logDiag({ kind: 'conn', at: new Date().toISOString(), remote: s && s.remoteAddress }));
  server.on('secureConnection', (s) => logDiag({ kind: 'secure', at: new Date().toISOString(), remote: s && s.remoteAddress, alpn: (s && s.alpnProtocol) || null }));
  server.on('tlsClientError', (err, socket) => {
    logDiag({ kind: 'tls', at: new Date().toISOString(), remote: socket && socket.remoteAddress, error: String(err && err.message || err).slice(0, 160) });
  });
  server.on('sessionError', (err, socket) => {
    logDiag({ kind: 'session', at: new Date().toISOString(), error: String(err && err.message || err).slice(0, 160) });
  });
  server.on('streamError', (err, socket) => {
    logDiag({ kind: 'stream', at: new Date().toISOString(), error: String(err && err.message || err).slice(0, 160) });
  });
  server.on('error', (e) => {
    logDiag({ kind: 'server', at: new Date().toISOString(), error: String(e && e.message || e).slice(0, 160) });
    // Only LISTEN-level failures abort the wait. Transient socket resets must
    // not kill a capture that a genuine engine request may still complete.
    const fatal = e && /EADDRINUSE|EACCES|EADDRNOTAVAIL|ERR_SERVER_ALREADY_LISTEN/.test(String(e.code || e.message || ''));
    if (!captured && fatal) resolveCap(null);
  });

  const listenP = new Promise((res, rej) => { server.once('error', rej); server.listen(port, res); });

  let settled = false;
  const wait = () => new Promise((res) => {
    if (captured) { settled = true; return res(captured); }
    const t = setTimeout(() => { settled = true; res(null); }, timeoutMs);
    capturedPromise.then((v) => { if (!settled) { settled = true; clearTimeout(t); res(v); } }).catch(() => {});
  });

  return {
    server,
    listenP,
    wait,
    diagnostics,
    close() { try { server.close(); } catch (_) {} },
  };
}

module.exports = { trustCert, measuredOrderCode, startBlade };