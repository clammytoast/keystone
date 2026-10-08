/* Small standalone helpers: password generator, strength estimate, TOTP. */
const Util = (() => {
  'use strict';

  // ---------------------------------------------------------- random + generator
  function randomInt(max) {
    const limit = Math.floor(4294967296 / max) * max;
    const buf = new Uint32Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % max;
  }
  const SETS = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    symbols: '!@#$%^&*()-_=+[]{};:,.<>?/~',
  };
  function generatePassword(o) {
    const strip = (s) => o.avoidAmbiguous ? s.replace(/[Il1O0o|]/g, '') : s;
    const sets = ['lower', 'upper', 'digits', 'symbols'].filter((k) => o[k]).map((k) => strip(SETS[k]));
    if (!sets.length) return '';
    const all = sets.join('');
    const out = [];
    for (const s of sets) out.push(s[randomInt(s.length)]);
    while (out.length < o.length) out.push(all[randomInt(all.length)]);
    out.length = Math.max(o.length, sets.length);
    for (let i = out.length - 1; i > 0; i--) { const j = randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out.join('');
  }

  // ---------------------------------------------------------- strength (rough estimate, not a guarantee)
  const COMMON = ['password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'dragon', 'football', 'abc123', '123456', '111111', 'login', 'master'];
  function estimateBits(pw) {
    if (!pw) return 0;
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/[0-9]/.test(pw)) pool += 10;
    if (/[ -/:-@[-`{-~]/.test(pw)) pool += 33;
    if (/[^\x00-\x7f]/.test(pw)) pool += 64;
    const chars = Array.from(pw);
    let bits = chars.length * Math.log2(pool || 1);
    const uniq = new Set(chars).size;
    bits *= Math.min(1, 0.4 + 0.6 * (uniq / chars.length));          // repeated characters
    const lower = pw.toLowerCase();
    for (const w of COMMON) if (lower.includes(w)) bits -= w.length * 3;   // dictionary words
    if (/(.)\1{2,}/.test(pw)) bits -= 6;
    if (/(?:abc|bcd|cde|def|123|234|345|456|567|678|789)/i.test(pw)) bits -= 6;
    return Math.max(0, bits);
  }
  function strength(pw) {
    const bits = estimateBits(pw);
    if (!pw) return { bits: 0, level: 0, label: '' };
    if (bits < 36) return { bits, level: 1, label: 'Weak' };
    if (bits < 60) return { bits, level: 2, label: 'Fair' };
    if (bits < 84) return { bits, level: 3, label: 'Good' };
    return { bits, level: 4, label: 'Strong' };
  }

  // ---------------------------------------------------------- TOTP
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function base32Decode(s) {
    s = s.replace(/[\s=-]/g, '').toUpperCase();
    let bits = 0, value = 0;
    const out = [];
    for (const ch of s) {
      const i = B32.indexOf(ch);
      if (i < 0) throw new Error('bad base32');
      value = (value << 5) | i; bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    return new Uint8Array(out);
  }
  async function hotp(secret, counter, digits, algo) {
    const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: algo }, false, ['sign']);
    const msg = new Uint8Array(8);
    new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
    const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
    const off = h[h.length - 1] & 15;
    const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
    return String(bin % Math.pow(10, digits)).padStart(digits, '0');
  }
  // Finds a TOTP configuration among an entry's custom fields. Supports otpauth:// URIs (KeePassXC, Bitwarden, 2FAS ...),
  // KeePass's built-in TimeOtp-* fields and the TrayTOTP "TOTP Seed" / "TOTP Settings" pair.
  function totpConfig(fields) {
    const get = (k) => { const f = fields.find((x) => x.key === k); return f ? f.value.trim() : ''; };
    const algoName = (a) => ({ SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512', 'HMAC-SHA-1': 'SHA-1', 'HMAC-SHA-256': 'SHA-256', 'HMAC-SHA-512': 'SHA-512' }[String(a).toUpperCase()] || 'SHA-1');
    try {
      const otp = get('otp');
      if (otp.toLowerCase().startsWith('otpauth://')) {
        const u = new URL(otp);
        if (u.hostname.toLowerCase() !== 'totp') return null;
        const secret = u.searchParams.get('secret');
        if (!secret) return null;
        return { secret: base32Decode(secret), period: +u.searchParams.get('period') || 30, digits: +u.searchParams.get('digits') || 6, algo: algoName(u.searchParams.get('algorithm') || 'SHA1') };
      }
      if (otp && /^[A-Za-z2-7\s=-]+$/.test(otp)) return { secret: base32Decode(otp), period: 30, digits: 6, algo: 'SHA-1' };
      const kb32 = get('TimeOtp-Secret-Base32'), khex = get('TimeOtp-Secret-Hex'), kutf = get('TimeOtp-Secret'), kb64 = get('TimeOtp-Secret-Base64');
      let secret = null;
      if (kb32) secret = base32Decode(kb32);
      else if (khex) secret = new Uint8Array(khex.match(/../g).map((h) => parseInt(h, 16)));
      else if (kb64) secret = Uint8Array.from(atob(kb64), (c) => c.charCodeAt(0));
      else if (kutf) secret = new TextEncoder().encode(kutf);
      if (secret) return { secret, period: +get('TimeOtp-Period') || 30, digits: +get('TimeOtp-Length') || 6, algo: algoName(get('TimeOtp-Algorithm') || 'SHA1') };
      const seed = get('TOTP Seed');
      if (seed) {
        const [per, dig] = (get('TOTP Settings') || '30;6').split(';');
        return { secret: base32Decode(seed), period: +per || 30, digits: +dig || 6, algo: 'SHA-1' };
      }
    } catch (e) { return null; }
    return null;
  }
  async function totpNow(cfg, nowMs = Date.now()) {
    const sec = Math.floor(nowMs / 1000);
    const code = await hotp(cfg.secret, Math.floor(sec / cfg.period), cfg.digits, cfg.algo);
    return { code, period: cfg.period, remaining: cfg.period - (sec % cfg.period) };
  }

  return { generatePassword, strength, estimateBits, totpConfig, totpNow, hotp, base32Decode, randomInt, SETS };
})();
