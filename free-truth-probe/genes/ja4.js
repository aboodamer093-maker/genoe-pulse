'use strict';
/*
 * GENOE — JA4 CORE (FoxIO spec)
 * ---------------------------------
 * Computes JA4 (and JA4_r) from a captured TLS ClientHello payload
 * (the Handshake.ClientHello bytes, i.e. the record payload sans record header)
 * or from explicit lists (used by the self-test vectors in crosscheck.js).
 *
 * Spec (FoxIO-JA4, per technical_details/JA4.md):
 *   a = <t|q|d><version><d|i><cc><ec><alpn>
 *         version : from supported_versions(0x002b) [max offered] else legacy_version
 *         cc/ec   : 2-digit counts, GREASE excluded (cap 99), include SCSV/0xFE00-0xFEFF
 *         alpn    : first+last ASCII-alnum chars of first ALPN value; "00" if none
 *   b = sha256(sorted(ciphers joined ","), 4-hex lowercase, GREASE removed)[0:12]
 *   c = sha256(sorted(extensions without 0000,0010, GREASE removed) + "_"
 *              + sigAlgs in ORIGINAL order join(",") lowercase)[0:12]
 */
const crypto = require('crypto');

function isGrease(v) {
  // RFC 8701 GREASE: 0x?a?a where the nibble is 0xa..0xf and both bytes are identical.
  const hi = (v >>> 8) & 0xff;
  const lo = v & 0xff;
  return hi === lo && (hi & 0x0f) === 0x0a;
}

function hex4(v) {
  return ('0000' + v.toString(16)).slice(-4);
}

function sha12(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);
}

function versionLabel(v) {
  return { 0x0304: '13', 0x0303: '12', 0x0302: '11', 0x0301: '10', 0x0300: 's3' }[v] || '00';
}

function alpnLabel(protocols) {
  const p = protocols[0];
  if (!p || p.length === 0) return '00';
  const a = p[0], z = p[p.length - 1];
  const alnum = (c) => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A);
  if (alnum(a) && alnum(z)) {
    const ca = String.fromCharCode(a), cz = String.fromCharCode(z);
    return p.length === 1 ? ca + ca : p.length === 0 ? '00' : ca + cz;
  }
  const h = Buffer.from(p).toString('hex');
  return h.length >= 2 ? h.slice(0, 2) : '00';
}

/*
 * ClientHello payload parser.
 * Returns { version, sni:bool, ciphers:[int], extensions:[int], sigAlgs:[int], alpn:[buffers] }.
 */
function parseHello(buf) {
  let o = 0;
  const type = buf[o]; o += 1;
  if (type !== 0x01) throw new Error('not a ClientHello (type=0x' + type.toString(16) + ')');
  const len = (buf[o] << 16) | (buf[o + 1] << 8) | buf[o + 2]; o += 3;
  const end = o + len;
  if (end > buf.length) throw new Error('truncated ClientHello');
  const legacy = buf.readUInt16BE(o); o += 2;
  o += 32; // random
  const sidLen = buf[o]; o += 1 + sidLen;
  const csLen = buf.readUInt16BE(o); o += 2;
  const ciphers = [];
  for (let i = 0; i < csLen; i += 2) ciphers.push(buf.readUInt16BE(o + i));
  o += csLen;
  const cmLen = buf[o]; o += 1 + cmLen;
  if (o >= end) return { version: legacy, sni: false, ciphers, extensions: [], sigAlgs: [], alpn: [] };
  const extLen = buf.readUInt16BE(o); o += 2;
  const extEnd = Math.min(o + extLen, end);
  const extensions = [];
  let sni = false, alpn = [], pas = null, sv = [];
  while (o + 4 <= extEnd) {
    const type = buf.readUInt16BE(o); o += 2;
    const elen = buf.readUInt16BE(o); o += 2;
    const data = buf.slice(o, o + elen); o += elen;
    extensions.push(type);
    if (type === 0x0000) sni = true;                                     // SNI
    else if (type === 0x0010) {                                          // ALPN
      const n = data.readUInt16BE(0);
      let k = 2, list = [];
      while (k + 1 < n + 2) {
        const pl = data[k]; k += 1;
        list.push(data.slice(k, k + pl)); k += pl;
      }
      alpn = list;
    } else if (type === 0x000d) {                                        // sig algs
      const n = data.readUInt16BE(0);
      pas = [];
      for (let i = 2; i < 2 + n; i += 2) pas.push(data.readUInt16BE(i));
    } else if (type === 0x002b) {                                        // supported versions
      const n = data[0];
      for (let i = 1; i <= n; i += 2) sv.push(data.readUInt16BE(i));
    }
  }
  return { version: legacy, sni, ciphers, extensions, sigAlgs: pas || [], alpn, supportedVersions: sv };
}

function computeFromLists({ transport = 't', version, sni, ciphers, extensions, sigAlgs, alpnFirst }) {
  const cipherList = ciphers.filter((c) => !isGrease(c));
  const extList = extensions.filter((e) => !isGrease(e) && e !== 0x0000 && e !== 0x0010);
  const cc = Math.min(99, cipherList.length);
  const ec = Math.min(99, extensions.filter((e) => !isGrease(e)).length);
  const n1 = transport[0];                     // t | q | d
  const vv = versionLabel(version);
  const nn = sni ? 'd' : 'i';
  const a = (n1 === 't' || n1 === 'd' || n1 === 'q' ? n1 : 't') + vv + nn +
            String(cc).padStart(2, '0') + String(ec).padStart(2, '0') +
            alpnLabel(alpnFirst != null ? [alpnFirst] : []);

  const sortedCiphers = cipherList.map(hex4).sort().join(',');
  const b = sha12(sortedCiphers);

  const sortedExts = extList.map(hex4).sort().join(',');
  const sigs = (sigAlgs || []).map(hex4).join(',');
  const c = sha12(sortedExts + '_' + sigs);

  const raw = a + '_' + sortedCiphers + '_' + sortedExts + (sigs ? '_' + sigs : '');
  return { ja4: a + '_' + b + '_' + c, a, b, c, raw };
}

function fromBuffer(helloBuffer) {
  const p = parseHello(helloBuffer);
  const version = p.supportedVersions && p.supportedVersions.length
    ? Math.max(...p.supportedVersions)
    : p.version;
  return computeFromLists({
    transport: 't',
    version,
    sni: p.sni,
    ciphers: p.ciphers,
    extensions: p.extensions,
    sigAlgs: p.sigAlgs,
    alpnFirst: p.alpn.map((x) => x)[0] || null,
  });
}

module.exports = { fromBuffer, computeFromLists, parseHello, isGrease, sha12, hex4 };