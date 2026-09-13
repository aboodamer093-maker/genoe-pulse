'use strict';
/*
 * GENOE — TLS ClientHello capture helper (raw TCP, cert-free)
 * --------------------------------------------------------------
 * Assembles TLS records until the full ClientHello handshake message is
 * captured (handshake type + 3-byte length + body), then resolves with the
 * handshake bytes as lowercase hex — ready for ja4.fromBuffer. The peer is
 * dropped right after the hello (wire-gene stage; surface genes come later
 * behind a trusted-cert reply path).
 */
const net = require('net');

function startCaptureServer({ port = 10901, timeoutMs = 60000, label = 'vein' } = {}) {
  return new Promise((resolve, reject) => {
    let leftover = Buffer.alloc(0);
    let acc = Buffer.alloc(0);
    let done = false;
    let server = null;
    let timer = null;

    const finish = (err, hex) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (server) server.close(); } catch (_) {}
      if (err) reject(err); else resolve({ label, handshakeBytes: hex.length / 2, helloHex: hex });
    };

    timer = setTimeout(() => finish(new Error('capture timeout (' + label + '): no full ClientHello in ' + timeoutMs + 'ms')), timeoutMs);

    server = net.createServer((sock) => {
      sock.on('data', (chunk) => {
        if (done) return;
        leftover = Buffer.concat([leftover, chunk]);
        for (;;) {
          if (leftover.length < 5) return;
          const recType = leftover[0];
          const recLen = (leftover[3] << 8) | leftover[4];
          if (leftover.length < 5 + recLen) return;
          const payload = leftover.slice(5, 5 + recLen);
          leftover = leftover.slice(5 + recLen);
          if (recType === 0x16) {
            acc = Buffer.concat([acc, payload]);
            if (acc.length >= 4) {
              const handLen = (acc[1] << 16) | (acc[2] << 8) | acc[3];
              if (acc.length >= 4 + handLen) {
                finish(null, acc.slice(0, 4 + handLen).toString('hex'));
                try { sock.destroy(); } catch (_) {}
                return;
              }
            }
          }
          if (leftover.length === 0) return;
        }
      });
      sock.on('error', (e) => finish(e));
      sock.on('close', () => {
        if (!done) finish(new Error('socket closed before full hello; bytes=' + acc.length));
      });
    });
    server.on('error', (e) => { clearTimeout(timer); reject(e); });
    // Dual-stack bind: macOS/iOS simulators tend to resolve localhost to ::1,
    // while host Safari may hit 127.0.0.1. '::' accepts both (IPv4-mapped).
    server.listen(port, '::');
  });
}

module.exports = { startCaptureServer };