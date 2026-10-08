/* Keystone key-derivation worker.
 * Runs the slow part of unlocking a KDBX database (AES-KDF / Argon2d / Argon2id)
 * off the UI thread. Pure JavaScript, no dependencies, no network.
 *
 * Request : { id, kind: 'aes'|'argon2', key: Uint8Array(32), ...params }
 * Messages: { id, type: 'progress', value: 0..1 } | { id, type: 'done', result: Uint8Array } | { id, type: 'error', message }
 */
'use strict';

// ---------------------------------------------------------------- AES-256 (encrypt only, for AES-KDF)

const SBOX = new Uint8Array(256);
(function initSbox() {
  let p = 1, q = 1;
  const rotl8 = (x, s) => ((x << s) | (x >> (8 - s))) & 0xff;
  do {
    p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff; // p *= 3
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;            // q /= 3
    if (q & 0x80) q ^= 0x09;
    SBOX[p] = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
})();

const TE0 = new Uint32Array(256), TE1 = new Uint32Array(256), TE2 = new Uint32Array(256), TE3 = new Uint32Array(256);
(function initTables() {
  for (let i = 0; i < 256; i++) {
    const s = SBOX[i], s2 = ((s << 1) ^ (s & 0x80 ? 0x11b : 0)) & 0xff, s3 = s2 ^ s;
    const t = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
    TE0[i] = t;
    TE1[i] = ((t >>> 8) | (t << 24)) >>> 0;
    TE2[i] = ((t >>> 16) | (t << 16)) >>> 0;
    TE3[i] = ((t >>> 24) | (t << 8)) >>> 0;
  }
})();

function aesExpandKey256(key) {
  const rk = new Uint32Array(60);
  for (let i = 0; i < 8; i++) rk[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
  let rcon = 1;
  const sub = (w) => ((SBOX[w >>> 24] << 24) | (SBOX[(w >>> 16) & 255] << 16) | (SBOX[(w >>> 8) & 255] << 8) | SBOX[w & 255]) >>> 0;
  for (let i = 8; i < 60; i++) {
    let t = rk[i - 1];
    if (i % 8 === 0) { t = (sub(((t << 8) | (t >>> 24)) >>> 0) ^ (rcon << 24)) >>> 0; rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x11b : 0)) & 0xff; }
    else if (i % 8 === 4) t = sub(t);
    rk[i] = (rk[i - 8] ^ t) >>> 0;
  }
  return rk;
}

// Encrypts one 16-byte block held in w[o..o+3] (big-endian words) in place.
function aesEncryptBlock(rk, w, o) {
  let s0 = w[o] ^ rk[0], s1 = w[o + 1] ^ rk[1], s2 = w[o + 2] ^ rk[2], s3 = w[o + 3] ^ rk[3];
  let t0, t1, t2, t3;
  for (let k = 4; k < 56; k += 4) {
    t0 = TE0[s0 >>> 24] ^ TE1[(s1 >>> 16) & 255] ^ TE2[(s2 >>> 8) & 255] ^ TE3[s3 & 255] ^ rk[k];
    t1 = TE0[s1 >>> 24] ^ TE1[(s2 >>> 16) & 255] ^ TE2[(s3 >>> 8) & 255] ^ TE3[s0 & 255] ^ rk[k + 1];
    t2 = TE0[s2 >>> 24] ^ TE1[(s3 >>> 16) & 255] ^ TE2[(s0 >>> 8) & 255] ^ TE3[s1 & 255] ^ rk[k + 2];
    t3 = TE0[s3 >>> 24] ^ TE1[(s0 >>> 16) & 255] ^ TE2[(s1 >>> 8) & 255] ^ TE3[s2 & 255] ^ rk[k + 3];
    s0 = t0; s1 = t1; s2 = t2; s3 = t3;
  }
  w[o]     = ((SBOX[s0 >>> 24] << 24) | (SBOX[(s1 >>> 16) & 255] << 16) | (SBOX[(s2 >>> 8) & 255] << 8) | SBOX[s3 & 255]) ^ rk[56];
  w[o + 1] = ((SBOX[s1 >>> 24] << 24) | (SBOX[(s2 >>> 16) & 255] << 16) | (SBOX[(s3 >>> 8) & 255] << 8) | SBOX[s0 & 255]) ^ rk[57];
  w[o + 2] = ((SBOX[s2 >>> 24] << 24) | (SBOX[(s3 >>> 16) & 255] << 16) | (SBOX[(s0 >>> 8) & 255] << 8) | SBOX[s1 & 255]) ^ rk[58];
  w[o + 3] = ((SBOX[s3 >>> 24] << 24) | (SBOX[(s0 >>> 16) & 255] << 16) | (SBOX[(s1 >>> 8) & 255] << 8) | SBOX[s2 & 255]) ^ rk[59];
}

async function sha256(data) { return new Uint8Array(await crypto.subtle.digest('SHA-256', data)); }

// AES-KDF: encrypt the 32-byte key `rounds` times with AES-256-ECB keyed by `seed`, then SHA-256.
async function aesKdf(key, seed, rounds, onProgress) {
  const rk = aesExpandKey256(seed);
  const w = new Uint32Array(8);
  for (let i = 0; i < 8; i++) w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
  const chunk = 200000;
  for (let done = 0; done < rounds;) {
    const n = Math.min(chunk, rounds - done);
    for (let r = 0; r < n; r++) { aesEncryptBlock(rk, w, 0); aesEncryptBlock(rk, w, 4); }
    done += n;
    onProgress(done / rounds);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) { out[4 * i] = w[i] >>> 24; out[4 * i + 1] = (w[i] >>> 16) & 255; out[4 * i + 2] = (w[i] >>> 8) & 255; out[4 * i + 3] = w[i] & 255; }
  return sha256(out);
}

// ---------------------------------------------------------------- BLAKE2b (BigInt; only used for a few hundred small hashes)

const M64 = (1n << 64n) - 1n;
const B2_IV = [0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n];
const B2_SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4], [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13], [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11], [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5], [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0]];
const rotr64 = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64;

function blake2bCompress(h, block, t, last) {
  const m = new Array(16);
  for (let i = 0; i < 16; i++) {
    let v = 0n;
    for (let j = 7; j >= 0; j--) v = (v << 8n) | BigInt(block[8 * i + j]);
    m[i] = v;
  }
  const v = h.concat(B2_IV);
  v[12] ^= BigInt(t) & M64;
  if (last) v[14] ^= M64;
  const G = (a, b, c, d, x, y) => {
    v[a] = (v[a] + v[b] + x) & M64; v[d] = rotr64(v[d] ^ v[a], 32);
    v[c] = (v[c] + v[d]) & M64;     v[b] = rotr64(v[b] ^ v[c], 24);
    v[a] = (v[a] + v[b] + y) & M64; v[d] = rotr64(v[d] ^ v[a], 16);
    v[c] = (v[c] + v[d]) & M64;     v[b] = rotr64(v[b] ^ v[c], 63);
  };
  for (let r = 0; r < 12; r++) {
    const s = B2_SIGMA[r % 10];
    G(0, 4, 8, 12, m[s[0]], m[s[1]]); G(1, 5, 9, 13, m[s[2]], m[s[3]]);
    G(2, 6, 10, 14, m[s[4]], m[s[5]]); G(3, 7, 11, 15, m[s[6]], m[s[7]]);
    G(0, 5, 10, 15, m[s[8]], m[s[9]]); G(1, 6, 11, 12, m[s[10]], m[s[11]]);
    G(2, 7, 8, 13, m[s[12]], m[s[13]]); G(3, 4, 9, 14, m[s[14]], m[s[15]]);
  }
  for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
}

function blake2b(input, outLen) {
  const h = B2_IV.slice();
  h[0] ^= 0x01010000n ^ BigInt(outLen);
  let pos = 0;
  const block = new Uint8Array(128);
  while (input.length - pos > 128) {
    block.set(input.subarray(pos, pos + 128));
    pos += 128;
    blake2bCompress(h, block, pos, false);
  }
  block.fill(0);
  block.set(input.subarray(pos));
  blake2bCompress(h, block, input.length, true);
  const out = new Uint8Array(64);
  for (let i = 0; i < 8; i++) { let v = h[i]; for (let j = 0; j < 8; j++) { out[8 * i + j] = Number(v & 0xffn); v >>= 8n; } }
  return out.slice(0, outLen);
}

function concatBytes(...parts) {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function u32le(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }

// Variable-length hash H' (RFC 9106 section 3.3)
function hprime(input, T) {
  const inp = concatBytes(u32le(T), input);
  if (T <= 64) return blake2b(inp, T);
  const r = Math.ceil(T / 32) - 2;
  const out = new Uint8Array(T);
  let v = blake2b(inp, 64);
  out.set(v.subarray(0, 32), 0);
  let pos = 32;
  for (let i = 2; i <= r; i++) { v = blake2b(v, 64); out.set(v.subarray(0, 32), pos); pos += 32; }
  out.set(blake2b(v, T - 32 * r), pos);
  return out;
}

// ---------------------------------------------------------------- Argon2 (d, i, id), 64-bit words as (lo, hi) uint32 pairs

let RL = 0, RH = 0;
// x + y + 2 * lo32(x) * lo32(y)  (mod 2^64)   -> result in RL/RH
function blamka(xl, xh, yl, yh) {
  xl >>>= 0; xh >>>= 0; yl >>>= 0; yh >>>= 0;
  const a0 = xl & 0xffff, a1 = xl >>> 16, b0 = yl & 0xffff, b1 = yl >>> 16;
  const mid = a1 * b0 + a0 * b1;
  const lo = a0 * b0 + (mid % 65536) * 65536;
  const pl = lo >>> 0;
  const ph = a1 * b1 + Math.floor(mid / 65536) + (lo >= 4294967296 ? 1 : 0);
  const p2l = (pl << 1) >>> 0;
  const p2h = ((ph << 1) | (pl >>> 31)) >>> 0;
  const sl = xl + yl + p2l;
  RL = sl >>> 0;
  RH = (xh + yh + p2h + Math.floor(sl / 4294967296)) >>> 0;
}

function gb(v, a, b, c, d) {
  let al = v[a], ah = v[a + 1], bl = v[b], bh = v[b + 1], cl = v[c], ch = v[c + 1], dl = v[d], dh = v[d + 1], tl, th;
  blamka(al, ah, bl, bh); al = RL; ah = RH;
  tl = dl ^ al; th = dh ^ ah; dl = th; dh = tl;                                                   // rotr 32
  blamka(cl, ch, dl, dh); cl = RL; ch = RH;
  tl = bl ^ cl; th = bh ^ ch; bl = (tl >>> 24) | (th << 8); bh = (th >>> 24) | (tl << 8);         // rotr 24
  blamka(al, ah, bl, bh); al = RL; ah = RH;
  tl = dl ^ al; th = dh ^ ah; dl = (tl >>> 16) | (th << 16); dh = (th >>> 16) | (tl << 16);       // rotr 16
  blamka(cl, ch, dl, dh); cl = RL; ch = RH;
  tl = bl ^ cl; th = bh ^ ch; bl = (tl << 1) | (th >>> 31); bh = (th << 1) | (tl >>> 31);         // rotr 63
  v[a] = al; v[a + 1] = ah; v[b] = bl; v[b + 1] = bh; v[c] = cl; v[c + 1] = ch; v[d] = dl; v[d + 1] = dh;
}

function permute(v, ix) {
  gb(v, ix[0], ix[4], ix[8], ix[12]); gb(v, ix[1], ix[5], ix[9], ix[13]);
  gb(v, ix[2], ix[6], ix[10], ix[14]); gb(v, ix[3], ix[7], ix[11], ix[15]);
  gb(v, ix[0], ix[5], ix[10], ix[15]); gb(v, ix[1], ix[6], ix[11], ix[12]);
  gb(v, ix[2], ix[7], ix[8], ix[13]); gb(v, ix[3], ix[4], ix[9], ix[14]);
}

const ROW_IX = [], COL_IX = [];
for (let i = 0; i < 8; i++) {
  const row = new Int32Array(16), col = new Int32Array(16);
  for (let k = 0; k < 16; k++) row[k] = 32 * i + 2 * k;
  for (let r = 0; r < 8; r++) { col[2 * r] = 32 * r + 4 * i; col[2 * r + 1] = 32 * r + 4 * i + 2; }
  ROW_IX.push(row); COL_IX.push(col);
}

const GR = new Uint32Array(256), GQ = new Uint32Array(256);
// dst = P(a ^ b) ^ (a ^ b) [^ dst]
function fillBlock(a, ao, b, bo, d, dof, xorDst) {
  for (let k = 0; k < 256; k++) { const r = a[ao + k] ^ b[bo + k]; GR[k] = r; GQ[k] = r; }
  for (let i = 0; i < 8; i++) permute(GQ, ROW_IX[i]);
  for (let i = 0; i < 8; i++) permute(GQ, COL_IX[i]);
  if (xorDst) for (let k = 0; k < 256; k++) d[dof + k] ^= GQ[k] ^ GR[k];
  else for (let k = 0; k < 256; k++) d[dof + k] = GQ[k] ^ GR[k];
}

// high 32 bits of a 32x32 -> 64 unsigned product
function mulHi(a, b) {
  const a0 = a & 0xffff, a1 = a >>> 16, b0 = b & 0xffff, b1 = b >>> 16;
  const mid = a1 * b0 + a0 * b1;
  const lo = a0 * b0 + (mid % 65536) * 65536;
  return (a1 * b1 + Math.floor(mid / 65536) + (lo >= 4294967296 ? 1 : 0)) >>> 0;
}

function argon2(type, password, salt, secret, assoc, t, mKiB, p, version, onProgress) {
  if (p < 1 || t < 1 || mKiB < 8 * p) throw new Error('Unsupported Argon2 parameters');
  const mPrime = 4 * p * Math.floor(mKiB / (4 * p));
  const laneLen = mPrime / p, segLen = laneLen / 4;
  if (mPrime * 256 > 0x7fffffff) throw new Error('This database needs more memory than the browser can allocate (' + Math.round(mKiB / 1024) + ' MiB).');
  let mem;
  try { mem = new Uint32Array(mPrime * 256); }
  catch (e) { throw new Error('Not enough memory to unlock this database (needs ' + Math.round(mKiB / 1024) + ' MiB).'); }

  const h0 = blake2b(concatBytes(u32le(p), u32le(32), u32le(mKiB), u32le(t), u32le(version), u32le(type),
    u32le(password.length), password, u32le(salt.length), salt, u32le(secret.length), secret, u32le(assoc.length), assoc), 64);
  const mem8 = new Uint8Array(mem.buffer);
  for (let l = 0; l < p; l++) {
    mem8.set(hprime(concatBytes(h0, u32le(0), u32le(l)), 1024), (l * laneLen) * 1024);
    mem8.set(hprime(concatBytes(h0, u32le(1), u32le(l)), 1024), (l * laneLen + 1) * 1024);
  }

  const zero = new Uint32Array(256), inb = new Uint32Array(256), addr = new Uint32Array(256);
  const totalSlices = t * 4;
  let sliceNo = 0;
  for (let pass = 0; pass < t; pass++) {
    const xorMode = pass > 0 && version === 0x13;
    for (let slice = 0; slice < 4; slice++) {
      const dataIndep = type === 1 || (type === 2 && pass === 0 && slice < 2);
      for (let lane = 0; lane < p; lane++) {
        const laneBase = lane * laneLen;
        let startIdx = 0;
        const nextAddresses = () => { inb[12]++; fillBlock(zero, 0, inb, 0, addr, 0, false); fillBlock(zero, 0, addr, 0, addr, 0, false); };
        if (dataIndep) { inb.fill(0); inb[0] = pass; inb[2] = lane; inb[4] = slice; inb[6] = mPrime; inb[8] = t; inb[10] = type; }
        if (pass === 0 && slice === 0) { startIdx = 2; if (dataIndep) nextAddresses(); }
        let cur = laneBase + slice * segLen + startIdx;
        for (let i = startIdx; i < segLen; i++, cur++) {
          const prev = (cur === laneBase) ? laneBase + laneLen - 1 : cur - 1;
          let j1, j2;
          if (dataIndep) {
            if (i % 128 === 0) nextAddresses();
            j1 = addr[2 * (i % 128)]; j2 = addr[2 * (i % 128) + 1];
          } else { j1 = mem[prev * 256]; j2 = mem[prev * 256 + 1]; }
          const refLane = (pass === 0 && slice === 0) ? lane : (j2 % p);
          const same = refLane === lane;
          let area;
          if (pass === 0) area = slice === 0 ? i - 1 : (same ? slice * segLen + i - 1 : slice * segLen + (i === 0 ? -1 : 0));
          else area = same ? laneLen - segLen + i - 1 : laneLen - segLen + (i === 0 ? -1 : 0);
          const x = mulHi(j1, j1);
          const rel = area - 1 - mulHi(area, x);
          const start = pass === 0 ? 0 : (slice === 3 ? 0 : (slice + 1) * segLen);
          const ref = refLane * laneLen + ((start + rel) % laneLen);
          fillBlock(mem, prev * 256, mem, ref * 256, mem, cur * 256, xorMode);
        }
      }
      sliceNo++;
      onProgress(sliceNo / totalSlices);
    }
  }
  const fin = new Uint32Array(256);
  for (let l = 0; l < p; l++) { const base = (l * laneLen + laneLen - 1) * 256; for (let k = 0; k < 256; k++) fin[k] ^= mem[base + k]; }
  return hprime(new Uint8Array(fin.buffer), 32);
}

// ---------------------------------------------------------------- message handling

self.onmessage = async (ev) => {
  const m = ev.data;
  const progress = (value) => self.postMessage({ id: m.id, type: 'progress', value });
  try {
    let result;
    if (m.kind === 'aes') result = await aesKdf(m.key, m.seed, m.rounds, progress);
    else if (m.kind === 'argon2') {
      // yield so that the first progress message is delivered, then run synchronously
      result = argon2(m.variant, m.key, m.salt, m.secret || new Uint8Array(0), m.assoc || new Uint8Array(0),
        m.iterations, m.memoryKiB, m.parallelism, m.version || 0x13, progress);
    } else if (m.kind === 'selftest') {
      result = { blake2b: blake2b(m.input, 64), sbox0: SBOX[0], sbox1: SBOX[1], sbox53: SBOX[0x53] };
      const rk = aesExpandKey256(m.aesKey); const w = new Uint32Array(4);
      for (let i = 0; i < 4; i++) w[i] = ((m.aesPlain[4 * i] << 24) | (m.aesPlain[4 * i + 1] << 16) | (m.aesPlain[4 * i + 2] << 8) | m.aesPlain[4 * i + 3]) >>> 0;
      aesEncryptBlock(rk, w, 0);
      const o = new Uint8Array(16); for (let i = 0; i < 4; i++) { o[4 * i] = w[i] >>> 24; o[4 * i + 1] = (w[i] >>> 16) & 255; o[4 * i + 2] = (w[i] >>> 8) & 255; o[4 * i + 3] = w[i] & 255; }
      result.aes = o;
    } else throw new Error('Unknown KDF request');
    self.postMessage({ id: m.id, type: 'done', result });
  } catch (e) {
    self.postMessage({ id: m.id, type: 'error', message: String(e && e.message || e) });
  }
};
