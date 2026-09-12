'use strict';
/*
 * GENOE — SAFARI PUBLIC CORPUS (JA4, published fingerprint corpus)
 * -----------------------------------------------------------------
 * Publicly published Safari JA4 fingerprints (krowdev/tls.fingerprint.io
 * corpus, 2026). Used by crosscheck as the INDEPENDENT second reference:
 * measured harvest must equal the published value for the same build —
 * zero tolerance. Entries are reference data (declared-prior), not claims.
 */
module.exports = [
  {
    ja4: 't13d2014h2_a09f3c656075_7f0f34a4126d',
    product: 'Safari 18.4',
    platform: 'iOS/macOS (WebKit 618 family)',
    source: 'public JA4 corpus (krowdev) — declared-prior reference',
  },
  {
    ja4: 't13d2014h2_a09f3c656075_d0a99439f9b1',
    product: 'Safari 26.0',
    platform: 'macOS/iOS (WebKit)',
    source: 'public JA4 corpus (krowdev) — declared-prior reference',
  },
  {
    ja4: 't13d2013h2_a09f3c656075_7f0f34a4126d',
    product: 'Safari 26.0.1',
    platform: 'macOS/iOS (WebKit)',
    source: 'public JA4 corpus (krowdev) — declared-prior reference',
  },
];