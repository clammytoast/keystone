/* KDBX (KeePass 2.x) container format: read + write.
 * Supports KDBX 3.x and 4.x, AES-256 and ChaCha20 outer ciphers, AES-KDF / Argon2d / Argon2id,
 * password and key-file (XML v1/v2, 32-byte, hex-64, arbitrary) credentials.
 * Reading always yields a KDBX-4-style model; writing always produces KDBX 4.x.
 */
const KDBX = (() => {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');
  const SIG1 = 0x9AA2D903, SIG2 = 0xB54BFB67, SIG2_KDB1 = 0xB54BFB65;
  const CIPHER_AES = '31c1f2e6bf714350be5805216afc5aff';
  const CIPHER_CHACHA = 'd6038a2b8b6f4cb5a524339a31dbb59a';
  const KDF_AES = 'c9d9f39a628a4460bf740d08c18a4fea';
  const KDF_AES3 = '7c02bb8279a74ac0927d114a00648238';
  const KDF_ARGON2D = 'ef636ddf8c29444b91f7a9a403e30a0c';
  const KDF_ARGON2ID = '9e298b1956db4773b23dfc3ec6f0a1e6';
  const EPOCH_OFFSET_SECONDS = 62135596800; // 0001-01-01 -> 1970-01-01

  class KdbxError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  // ------------------------------------------------------------ byte helpers
  const concat = (...parts) => {
    let n = 0; for (const p of parts) n += p.length;
    const out = new Uint8Array(n); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
  const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const fromHex = (s) => { const out = new Uint8Array(s.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(2 * i, 2), 16); return out; };
  const equal = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  function b64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    const bin = atob(s.replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ------------------------------------------------------------ crypto primitives (WebCrypto + small JS ciphers)
  const subtle = crypto.subtle;
  const sha256 = async (...parts) => new Uint8Array(await subtle.digest('SHA-256', parts.length === 1 ? parts[0] : concat(...parts)));
  const sha512 = async (...parts) => new Uint8Array(await subtle.digest('SHA-512', parts.length === 1 ? parts[0] : concat(...parts)));
  async function hmac256(keyBytes, data) {
    const k = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await subtle.sign('HMAC', k, data));
  }
  async function aesCbc(decrypt, key, iv, data) {
    const k = await subtle.importKey('raw', key, 'AES-CBC', false, [decrypt ? 'decrypt' : 'encrypt']);
    return new Uint8Array(await (decrypt ? subtle.decrypt : subtle.encrypt).call(subtle, { name: 'AES-CBC', iv }, k, data));
  }
  async function gzipStream(kind, data) {
    const s = new Blob([data]).stream().pipeThrough(new (kind === 'gzip' ? CompressionStream : DecompressionStream)('gzip'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  class ChaCha20 {
    constructor(key, nonce, counter = 0) {
      const s = this.s = new Uint32Array(16);
      s[0] = 0x61707865; s[1] = 0x3320646e; s[2] = 0x79622d32; s[3] = 0x6b206574;
      const kv = new DataView(key.buffer, key.byteOffset, 32);
      for (let i = 0; i < 8; i++) s[4 + i] = kv.getUint32(4 * i, true);
      s[12] = counter;
      const nv = new DataView(nonce.buffer, nonce.byteOffset, 12);
      for (let i = 0; i < 3; i++) s[13 + i] = nv.getUint32(4 * i, true);
      this.buf = new Uint8Array(64); this.pos = 64;
    }
    block() {
      const x = new Int32Array(this.s), s = this.s;
      const qr = (a, b, c, d) => {
        x[a] = (x[a] + x[b]) | 0; x[d] ^= x[a]; x[d] = (x[d] << 16) | (x[d] >>> 16);
        x[c] = (x[c] + x[d]) | 0; x[b] ^= x[c]; x[b] = (x[b] << 12) | (x[b] >>> 20);
        x[a] = (x[a] + x[b]) | 0; x[d] ^= x[a]; x[d] = (x[d] << 8) | (x[d] >>> 24);
        x[c] = (x[c] + x[d]) | 0; x[b] ^= x[c]; x[b] = (x[b] << 7) | (x[b] >>> 25);
      };
      for (let i = 0; i < 10; i++) {
        qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
        qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
      }
      const dv = new DataView(this.buf.buffer);
      for (let i = 0; i < 16; i++) dv.setUint32(4 * i, (x[i] + s[i]) | 0, true);
      s[12]++; this.pos = 0;
    }
    xor(data) {
      const out = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) { if (this.pos >= 64) this.block(); out[i] = data[i] ^ this.buf[this.pos++]; }
      return out;
    }
  }

  class Salsa20 {
    constructor(key, nonce) {
      const s = this.s = new Uint32Array(16);
      const kv = new DataView(key.buffer, key.byteOffset, 32), nv = new DataView(nonce.buffer, nonce.byteOffset, 8);
      s[0] = 0x61707865; s[5] = 0x3320646e; s[10] = 0x79622d32; s[15] = 0x6b206574;
      for (let i = 0; i < 4; i++) { s[1 + i] = kv.getUint32(4 * i, true); s[11 + i] = kv.getUint32(16 + 4 * i, true); }
      s[6] = nv.getUint32(0, true); s[7] = nv.getUint32(4, true);
      this.buf = new Uint8Array(64); this.pos = 64;
    }
    block() {
      const x = new Int32Array(this.s), s = this.s;
      const R = (v, n) => (v << n) | (v >>> (32 - n));
      for (let i = 0; i < 10; i++) {
        x[4] ^= R((x[0] + x[12]) | 0, 7); x[8] ^= R((x[4] + x[0]) | 0, 9); x[12] ^= R((x[8] + x[4]) | 0, 13); x[0] ^= R((x[12] + x[8]) | 0, 18);
        x[9] ^= R((x[5] + x[1]) | 0, 7); x[13] ^= R((x[9] + x[5]) | 0, 9); x[1] ^= R((x[13] + x[9]) | 0, 13); x[5] ^= R((x[1] + x[13]) | 0, 18);
        x[14] ^= R((x[10] + x[6]) | 0, 7); x[2] ^= R((x[14] + x[10]) | 0, 9); x[6] ^= R((x[2] + x[14]) | 0, 13); x[10] ^= R((x[6] + x[2]) | 0, 18);
        x[3] ^= R((x[15] + x[11]) | 0, 7); x[7] ^= R((x[3] + x[15]) | 0, 9); x[11] ^= R((x[7] + x[3]) | 0, 13); x[15] ^= R((x[11] + x[7]) | 0, 18);
        x[1] ^= R((x[0] + x[3]) | 0, 7); x[2] ^= R((x[1] + x[0]) | 0, 9); x[3] ^= R((x[2] + x[1]) | 0, 13); x[0] ^= R((x[3] + x[2]) | 0, 18);
        x[6] ^= R((x[5] + x[4]) | 0, 7); x[7] ^= R((x[6] + x[5]) | 0, 9); x[4] ^= R((x[7] + x[6]) | 0, 13); x[5] ^= R((x[4] + x[7]) | 0, 18);
        x[11] ^= R((x[10] + x[9]) | 0, 7); x[8] ^= R((x[11] + x[10]) | 0, 9); x[9] ^= R((x[8] + x[11]) | 0, 13); x[10] ^= R((x[9] + x[8]) | 0, 18);
        x[12] ^= R((x[15] + x[14]) | 0, 7); x[13] ^= R((x[12] + x[15]) | 0, 9); x[14] ^= R((x[13] + x[12]) | 0, 13); x[15] ^= R((x[14] + x[13]) | 0, 18);
      }
      const dv = new DataView(this.buf.buffer);
      for (let i = 0; i < 16; i++) dv.setUint32(4 * i, (x[i] + s[i]) | 0, true);
      if (++s[8] === 0) s[9]++;
      this.pos = 0;
    }
    xor(data) {
      const out = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) { if (this.pos >= 64) this.block(); out[i] = data[i] ^ this.buf[this.pos++]; }
      return out;
    }
  }

  // inner random stream that protects passwords etc. inside the XML
  async function innerStream(algo, key) {
    if (algo === 3) { const h = await sha512(key); return new ChaCha20(h.subarray(0, 32), h.subarray(32, 44)); }
    if (algo === 2) return new Salsa20(await sha256(key), new Uint8Array([0xE8, 0x30, 0x09, 0x4B, 0x97, 0x20, 0x5D, 0x2A]));
    throw new KdbxError('unsupported', 'This database uses an unsupported inner stream cipher (' + algo + ').');
  }

  // ------------------------------------------------------------ KDF worker bridge
  let workerUrl = null;
  function runKdfJob(job, onProgress) {
    if (!workerUrl) {
      const src = document.getElementById('worker-src').textContent;
      workerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    }
    return new Promise((resolve, reject) => {
      const w = new Worker(workerUrl);
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'progress') onProgress && onProgress(m.value);
        else if (m.type === 'done') { w.terminate(); resolve(m.result); }
        else if (m.type === 'error') { w.terminate(); reject(new KdbxError('kdf', m.message)); }
      };
      w.onerror = (e) => { w.terminate(); reject(new KdbxError('kdf', 'Key derivation failed: ' + (e.message || 'worker error'))); };
      w.postMessage(Object.assign({ id: 1 }, job));
    });
  }

  // ------------------------------------------------------------ variant dictionary (KDBX4 KDF params)
  function parseVariantDict(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const entries = [];
    let p = 2;
    while (p < b.length) {
      const t = b[p++];
      if (t === 0) break;
      const nl = dv.getUint32(p, true); p += 4;
      const name = dec.decode(b.subarray(p, p + nl)); p += nl;
      const vl = dv.getUint32(p, true); p += 4;
      const vb = b.slice(p, p + vl); p += vl;
      const vv = new DataView(vb.buffer);
      let value;
      switch (t) {
        case 0x04: value = vv.getUint32(0, true); break;
        case 0x05: value = vv.getBigUint64(0, true); break;
        case 0x08: value = vb[0] !== 0; break;
        case 0x0C: value = vv.getInt32(0, true); break;
        case 0x0D: value = vv.getBigInt64(0, true); break;
        case 0x18: value = dec.decode(vb); break;
        case 0x42: value = vb; break;
        default: throw new KdbxError('corrupt', 'Unknown value type in KDF parameters.');
      }
      entries.push({ name, type: t, value });
    }
    return entries;
  }
  function writeVariantDict(entries) {
    const parts = [new Uint8Array([0x00, 0x01])];
    for (const e of entries) {
      const nameB = enc.encode(e.name);
      let vb;
      switch (e.type) {
        case 0x04: vb = u32(e.value); break;
        case 0x05: vb = u64(e.value); break;
        case 0x08: vb = new Uint8Array([e.value ? 1 : 0]); break;
        case 0x0C: vb = new Uint8Array(4); new DataView(vb.buffer).setInt32(0, e.value, true); break;
        case 0x0D: vb = new Uint8Array(8); new DataView(vb.buffer).setBigInt64(0, BigInt(e.value), true); break;
        case 0x18: vb = enc.encode(e.value); break;
        default: vb = e.value;
      }
      parts.push(new Uint8Array([e.type]), u32(nameB.length), nameB, u32(vb.length), vb);
    }
    parts.push(new Uint8Array([0]));
    return concat(...parts);
  }
  const vget = (entries, name) => { const e = entries.find((x) => x.name === name); return e ? e.value : undefined; };
  function vset(entries, name, type, value) {
    const e = entries.find((x) => x.name === name);
    if (e) { e.type = type; e.value = value; } else entries.push({ name, type, value });
  }

  // ------------------------------------------------------------ credentials
  // Returns the 32 key bytes represented by a key file.
  async function keyFileToKey(bytes) {
    // XML key file (v1 or v2)
    let text = null;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { /* binary file */ }
    if (text && text.trim().startsWith('<')) {
      const xml = new DOMParser().parseFromString(text, 'application/xml');
      const root = xml.documentElement;
      if (!xml.querySelector('parsererror') && root && root.tagName === 'KeyFile') {
        const ver = (root.querySelector('Meta > Version') || {}).textContent || '';
        const data = root.querySelector('Key > Data');
        if (data) {
          if (ver.trim().startsWith('2')) {
            const hexStr = data.textContent.replace(/\s+/g, '');
            if (hexStr.length % 2 || /[^0-9a-fA-F]/.test(hexStr)) throw new KdbxError('keyfile', 'The key file is damaged.');
            const key = fromHex(hexStr);
            const want = (data.getAttribute('Hash') || '').replace(/\s+/g, '').toLowerCase();
            if (want) {
              const got = hex((await sha256(key)).subarray(0, 4));
              if (got !== want) throw new KdbxError('keyfile', 'The key file is damaged (checksum mismatch).');
            }
            return key.length === 32 ? key : sha256(key);
          }
          const key = unb64(data.textContent);
          return key.length === 32 ? key : sha256(key);
        }
      }
    }
    if (bytes.length === 32) return bytes.slice();
    if (bytes.length === 64 && /^[0-9a-fA-F]{64}$/.test(dec.decode(bytes))) return fromHex(dec.decode(bytes));
    return sha256(bytes);
  }

  async function compositeKey(creds) {
    const parts = [];
    if (creds.password != null && creds.password !== '') parts.push(await sha256(enc.encode(String(creds.password))));
    if (creds.keyfile) parts.push(await keyFileToKey(creds.keyfile));
    if (!parts.length) throw new KdbxError('nocreds', 'Enter a password or choose a key file.');
    return sha256(concat(...parts));
  }

  // ------------------------------------------------------------ header
  function parseHeader(bytes) {
    if (bytes.length < 12) throw new KdbxError('badsig', 'This file is too small to be a KeePass database.');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== SIG1) throw new KdbxError('badsig', 'This is not a KeePass (.kdbx) database.');
    const sig2 = dv.getUint32(4, true);
    if (sig2 === SIG2_KDB1) throw new KdbxError('unsupported', 'This is an old KeePass 1.x (.kdb) database. Open it in KeePass and save it as .kdbx first.');
    if (sig2 !== SIG2) throw new KdbxError('badsig', 'This is not a KeePass 2.x (.kdbx) database.');
    const minor = dv.getUint16(8, true), major = dv.getUint16(10, true);
    if (major < 3 || major > 4) throw new KdbxError('unsupported', 'Unsupported database version ' + major + '.' + minor + '.');
    let p = 12;
    const f = {};
    for (;;) {
      if (p >= bytes.length) throw new KdbxError('corrupt', 'The database header is truncated.');
      const id = bytes[p++];
      let len;
      if (major === 4) { len = dv.getUint32(p, true); p += 4; } else { len = dv.getUint16(p, true); p += 2; }
      if (p + len > bytes.length) throw new KdbxError('corrupt', 'The database header is truncated.');
      const data = bytes.slice(p, p + len); p += len;
      switch (id) {
        case 0: break;
        case 2: f.cipher = hex(data); break;
        case 3: f.compression = new DataView(data.buffer).getUint32(0, true); break;
        case 4: f.masterSeed = data; break;
        case 5: f.transformSeed = data; break;
        case 6: f.transformRounds = new DataView(data.buffer).getBigUint64(0, true); break;
        case 7: f.iv = data; break;
        case 8: f.innerKey = data; break;
        case 9: f.streamStart = data; break;
        case 10: f.innerAlgo = new DataView(data.buffer).getUint32(0, true); break;
        case 11: f.kdf = parseVariantDict(data); break;
        case 12: f.publicCustomData = data; break;
        default: break;
      }
      if (id === 0) break;
    }
    return { major, minor, f, end: p, headerBytes: bytes.subarray(0, p) };
  }

  // Describes the KDF of a parsed header (always as a variant-dict style object).
  function kdfOf(h) {
    if (h.major === 3) {
      return [
        { name: '$UUID', type: 0x42, value: fromHex(KDF_AES) },
        { name: 'S', type: 0x42, value: h.f.transformSeed },
        { name: 'R', type: 0x05, value: h.f.transformRounds },
      ];
    }
    return h.f.kdf;
  }
  function kdfInfo(kdf) {
    const id = hex(vget(kdf, '$UUID') || new Uint8Array(16));
    if (id === KDF_AES || id === KDF_AES3) return { id, name: 'AES-KDF', rounds: Number(vget(kdf, 'R') || 0n) };
    if (id === KDF_ARGON2D || id === KDF_ARGON2ID) {
      return { id, name: id === KDF_ARGON2D ? 'Argon2d' : 'Argon2id', memory: Number(vget(kdf, 'M') || 0n), iterations: Number(vget(kdf, 'I') || 0n), parallelism: vget(kdf, 'P') };
    }
    return { id, name: 'Unknown' };
  }

  async function deriveTransformedKey(composite, kdf, onProgress) {
    const id = hex(vget(kdf, '$UUID') || new Uint8Array(16));
    if (id === KDF_AES || id === KDF_AES3) {
      const rounds = Number(vget(kdf, 'R'));
      if (!(rounds > 0)) throw new KdbxError('corrupt', 'Invalid AES-KDF parameters.');
      return runKdfJob({ kind: 'aes', key: composite, seed: vget(kdf, 'S'), rounds }, onProgress);
    }
    if (id === KDF_ARGON2D || id === KDF_ARGON2ID) {
      const mem = Number(vget(kdf, 'M')) / 1024;
      return runKdfJob({
        kind: 'argon2', variant: id === KDF_ARGON2D ? 0 : 2, key: composite, salt: vget(kdf, 'S'),
        secret: vget(kdf, 'K'), assoc: vget(kdf, 'A'), iterations: Number(vget(kdf, 'I')), memoryKiB: mem,
        parallelism: vget(kdf, 'P'), version: vget(kdf, 'V') || 0x13,
      }, onProgress);
    }
    throw new KdbxError('unsupported', 'This database uses an unsupported key derivation function.');
  }

  // ------------------------------------------------------------ payload decryption
  async function cipherCrypt(decrypt, cipherId, key, iv, data) {
    if (cipherId === CIPHER_AES) return aesCbc(decrypt, key, iv, data);
    if (cipherId === CIPHER_CHACHA) return new ChaCha20(key, iv).xor(data);
    throw new KdbxError('unsupported', 'This database uses an unsupported encryption cipher (Twofish). Re-save it in KeePass with AES or ChaCha20.');
  }

  async function decryptV4(bytes, h, transformed) {
    const f = h.f;
    const sha = bytes.subarray(h.end, h.end + 32), mac = bytes.subarray(h.end + 32, h.end + 64);
    if (!equal(await sha256(h.headerBytes), sha)) throw new KdbxError('corrupt', 'The database header is damaged.');
    const hmacBase = await sha512(f.masterSeed, transformed, new Uint8Array([1]));
    const blockKey = (i) => sha512(u64(i), hmacBase);
    const hdrKey = await blockKey(0xFFFFFFFFFFFFFFFFn);
    if (!equal(await hmac256(hdrKey, h.headerBytes), mac)) throw new KdbxError('wrongkey', 'Wrong password or key file.');
    // HMAC block stream
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = h.end + 64, index = 0n;
    const blocks = [];
    for (;;) {
      if (p + 36 > bytes.length) throw new KdbxError('corrupt', 'The database is truncated.');
      const bmac = bytes.subarray(p, p + 32), len = dv.getUint32(p + 32, true);
      if (p + 36 + len > bytes.length) throw new KdbxError('corrupt', 'The database is truncated.');
      const data = bytes.subarray(p + 36, p + 36 + len);
      const key = await blockKey(index);
      if (!equal(await hmac256(key, concat(u64(index), u32(len), data)), bmac)) throw new KdbxError('corrupt', 'The database is damaged (block checksum mismatch).');
      p += 36 + len; index++;
      if (len === 0) break;
      blocks.push(data);
    }
    const cipherKey = await sha256(f.masterSeed, transformed);
    let plain = await cipherCrypt(true, f.cipher, cipherKey, f.iv, concat(...blocks));
    if (f.compression === 1) plain = await gzipStream('gzip-d', plain);
    // inner header
    const pdv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
    let q = 0, innerAlgo = 0, innerKey = null;
    const binaries = [];
    for (;;) {
      const id = plain[q++], len = pdv.getUint32(q, true); q += 4;
      const data = plain.slice(q, q + len); q += len;
      if (id === 0) break;
      if (id === 1) innerAlgo = new DataView(data.buffer).getUint32(0, true);
      else if (id === 2) innerKey = data;
      else if (id === 3) binaries.push({ protect: (data[0] & 1) !== 0, data: data.slice(1) });
    }
    return { xml: plain.subarray(q), innerAlgo, innerKey, binaries };
  }

  async function decryptV3(bytes, h, transformed) {
    const f = h.f;
    const cipherKey = await sha256(f.masterSeed, transformed);
    let body;
    try { body = await cipherCrypt(true, f.cipher, cipherKey, f.iv, bytes.subarray(h.end)); }
    catch (e) { if (e instanceof KdbxError) throw e; throw new KdbxError('wrongkey', 'Wrong password or key file.'); }
    if (!equal(body.subarray(0, 32), f.streamStart)) throw new KdbxError('wrongkey', 'Wrong password or key file.');
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    let p = 32;
    const blocks = [];
    for (;;) {
      if (p + 40 > body.length) throw new KdbxError('corrupt', 'The database is truncated.');
      const size = dv.getUint32(p + 36, true);
      const hash = body.subarray(p + 4, p + 36);
      p += 40;
      if (size === 0) break;
      const data = body.subarray(p, p + size); p += size;
      if (!equal(await sha256(data), hash)) throw new KdbxError('corrupt', 'The database is damaged (block hash mismatch).');
      blocks.push(data);
    }
    let xml = concat(...blocks);
    if (f.compression === 1) xml = await gzipStream('gzip-d', xml);
    return { xml, innerAlgo: f.innerAlgo || 2, innerKey: f.innerKey, binaries: null };
  }

  // ------------------------------------------------------------ XML helpers
  const kids = (el, name) => { const out = []; for (const c of el.children) if (c.tagName === name) out.push(c); return out; };
  const kid = (el, name) => { for (const c of el.children) if (c.tagName === name) return c; return null; };
  const kidText = (el, name) => { const k = el && kid(el, name); return k ? k.textContent : ''; };

  // XOR-decrypt / re-encrypt every protected <Value> in document order
  async function unprotectAll(doc, algo, key) {
    const stream = await innerStream(algo, key);
    // KDBX3 also protects attachments that live in <Meta><Binaries>; they come first in document order.
    for (const v of doc.querySelectorAll('Value, Binaries > Binary')) {
      if (v.getAttribute('Protected') !== 'True') continue;
      const raw = v.textContent.trim() ? unb64(v.textContent) : new Uint8Array(0);
      const plain = stream.xor(raw);
      v.textContent = v.tagName === 'Binary' ? b64(plain) : dec.decode(plain);
    }
  }
  async function protectAll(doc, algo, key) {
    const stream = await innerStream(algo, key);
    for (const v of doc.querySelectorAll('Value')) {
      if (v.getAttribute('Protected') !== 'True') continue;
      v.textContent = b64(stream.xor(enc.encode(v.textContent)));
    }
  }

  // KDBX3 stores attachments in <Meta><Binaries>; convert to KDBX4-style indexed list.
  async function normaliseV3Binaries(doc) {
    const meta = kid(doc.documentElement, 'Meta');
    const bins = meta && kid(meta, 'Binaries');
    const list = [], idToIndex = new Map();
    if (bins) {
      for (const b of kids(bins, 'Binary')) {
        let data = b.textContent.trim() ? unb64(b.textContent) : new Uint8Array(0);
        if (b.getAttribute('Compressed') === 'True') data = await gzipStream('gzip-d', data);
        idToIndex.set(b.getAttribute('ID'), list.length);
        list.push({ protect: b.getAttribute('Protected') === 'True', data });
      }
      meta.removeChild(bins);
    }
    for (const v of doc.querySelectorAll('Binary > Value[Ref]')) {
      const ref = v.getAttribute('Ref');
      if (idToIndex.has(ref)) v.setAttribute('Ref', String(idToIndex.get(ref)));
    }
    return list;
  }

  // ------------------------------------------------------------ time
  function parseTime(s) {
    if (!s) return null;
    s = s.trim();
    if (/^\d{4}-\d\d-\d\d/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d; }
    try {
      const b = unb64(s);
      if (b.length !== 8) return null;
      const secs = Number(new DataView(b.buffer).getBigInt64(0, true));
      return new Date((secs - EPOCH_OFFSET_SECONDS) * 1000);
    } catch (e) { return null; }
  }
  function formatTime(date) {
    const secs = Math.floor(date.getTime() / 1000) + EPOCH_OFFSET_SECONDS;
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, BigInt(secs), true);
    return b64(b);
  }
  function upgradeTimes(doc) {
    // ISO-8601 timestamps (KDBX3) -> base64 ticks (KDBX4)
    for (const el of doc.getElementsByTagName('*')) {
      if (el.children.length) continue;
      if (!/(Time|Changed)$/.test(el.tagName)) continue;
      const t = el.textContent.trim();
      if (/^\d{4}-\d\d-\d\dT/.test(t)) { const d = parseTime(t); if (d) el.textContent = formatTime(d); }
    }
  }

  // ------------------------------------------------------------ open
  async function open(bytes, creds, onProgress) {
    const h = parseHeader(bytes);
    const composite = await compositeKey(creds);
    const kdf = kdfOf(h);
    const info = kdfInfo(kdf);
    const transformed = await deriveTransformedKey(composite, kdf, onProgress);
    return finishOpen(bytes, h, composite, transformed, kdf, info, creds);
  }

  async function finishOpen(bytes, h, composite, transformed, kdf, info, creds) {
    const payload = h.major === 4 ? await decryptV4(bytes, h, transformed) : await decryptV3(bytes, h, transformed);
    const doc = new DOMParser().parseFromString(dec.decode(payload.xml), 'application/xml');
    if (doc.querySelector('parsererror') || !doc.documentElement || doc.documentElement.tagName !== 'KeePassFile') {
      throw new KdbxError('corrupt', 'The database content could not be read.');
    }
    let binaries = payload.binaries;
    if (h.major === 3) {
      const meta = kid(doc.documentElement, 'Meta');
      const hh = meta && kid(meta, 'HeaderHash');
      if (hh && hh.textContent.trim() && !equal(unb64(hh.textContent), await sha256(h.headerBytes))) {
        throw new KdbxError('corrupt', 'The database header hash does not match (file may be tampered with).');
      }
      if (hh) meta.removeChild(hh);
    }
    await unprotectAll(doc, payload.innerAlgo, payload.innerKey);
    if (h.major === 3) binaries = await normaliseV3Binaries(doc);
    return {
      doc, binaries, compositeKey: composite, transformedKey: transformed,
      keyfileUsed: !!(creds && creds.keyfile),
      format: { major: h.major, minor: h.minor },
      cipher: h.f.cipher, compression: h.f.compression, kdf, kdfInfo: info,
      publicCustomData: h.f.publicCustomData || null,
    };
  }

  // ------------------------------------------------------------ write
  async function serialize(db) {
    const major = 4, minor = db.format.major === 4 ? db.format.minor : 0;
    const cipherId = db.cipher;
    const ivLen = cipherId === CIPHER_CHACHA ? 12 : 16;
    const masterSeed = rand(32), iv = rand(ivLen);
    const innerKey = rand(64), innerAlgo = 3;

    // XML: re-protect a copy, never the live document
    const copy = db.doc.cloneNode(true);
    const root = copy.documentElement;
    const meta = kid(root, 'Meta');
    if (meta) for (const n of ['HeaderHash', 'Binaries']) { const e = kid(meta, n); if (e) meta.removeChild(e); }
    upgradeTimes(copy);
    await protectAll(copy, innerAlgo, innerKey);
    const xml = enc.encode('<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n' + new XMLSerializer().serializeToString(root));

    const innerParts = [new Uint8Array([1]), u32(4), u32(innerAlgo), new Uint8Array([2]), u32(innerKey.length), innerKey];
    for (const b of db.binaries) innerParts.push(new Uint8Array([3]), u32(b.data.length + 1), new Uint8Array([b.protect ? 1 : 0]), b.data);
    innerParts.push(new Uint8Array([0]), u32(0));
    let plain = concat(...innerParts, xml);
    if (db.compression === 1) plain = await gzipStream('gzip', plain);

    const field = (id, data) => concat(new Uint8Array([id]), u32(data.length), data);
    const hdrParts = [u32(SIG1), u32(SIG2), new Uint8Array([minor & 255, minor >> 8, major & 255, major >> 8]),
      field(2, fromHex(cipherId)), field(3, u32(db.compression)), field(4, masterSeed),
      field(11, writeVariantDict(db.kdf)), field(7, iv)];
    if (db.publicCustomData) hdrParts.push(field(12, db.publicCustomData));
    hdrParts.push(field(0, new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a])));
    const header = concat(...hdrParts);

    const hmacBase = await sha512(masterSeed, db.transformedKey, new Uint8Array([1]));
    const cipherKey = await sha256(masterSeed, db.transformedKey);
    const cipherText = await cipherCrypt(false, cipherId, cipherKey, iv, plain);

    const out = [header, await sha256(header), await hmac256(await sha512(u64(0xFFFFFFFFFFFFFFFFn), hmacBase), header)];
    const BLOCK = 1 << 20;
    let index = 0n;
    for (let pos = 0; pos < cipherText.length; pos += BLOCK) {
      const data = cipherText.subarray(pos, Math.min(pos + BLOCK, cipherText.length));
      out.push(await hmac256(await sha512(u64(index), hmacBase), concat(u64(index), u32(data.length), data)), u32(data.length), data);
      index++;
    }
    // terminating empty block
    out.push(await hmac256(await sha512(u64(index), hmacBase), concat(u64(index), u32(0))), u32(0));
    return concat(...out);
  }

  // Decrypt freshly written bytes using the in-memory keys; used to verify a save before it hits the disk.
  async function verify(bytes, db) {
    const h = parseHeader(bytes);
    const copy = await finishOpen(bytes, h, db.compositeKey, db.transformedKey, kdfOf(h), kdfInfo(kdfOf(h)), null);
    return copy;
  }

  // True when two opened databases hold exactly the same content (used to double-check a save).
  function sameContent(a, b) {
    const flat = (db) => {
      const c = db.doc.cloneNode(true);
      const meta = kid(c.documentElement, 'Meta');
      if (meta) for (const n of ['HeaderHash', 'Binaries']) { const e = kid(meta, n); if (e) meta.removeChild(e); }
      upgradeTimes(c);
      return new XMLSerializer().serializeToString(c.documentElement);
    };
    if (flat(a) !== flat(b)) return false;
    if (a.binaries.length !== b.binaries.length) return false;
    return a.binaries.every((x, i) => x.protect === b.binaries[i].protect && equal(x.data, b.binaries[i].data));
  }

  // A brand-new database around a ready-made XML document. Argon2id with the given cost, AES-256, gzip.
  async function create(doc, creds, opts, onProgress) {
    const composite = await compositeKey(creds);
    const kdf = [
      { name: '$UUID', type: 0x42, value: fromHex(KDF_ARGON2ID) }, { name: 'S', type: 0x42, value: rand(32) },
      { name: 'P', type: 0x04, value: opts.parallelism }, { name: 'I', type: 0x05, value: BigInt(opts.iterations) },
      { name: 'M', type: 0x05, value: BigInt(opts.memoryMiB) * 1048576n }, { name: 'V', type: 0x04, value: 0x13 },
    ];
    const transformed = await deriveTransformedKey(composite, kdf, onProgress);
    return {
      doc, binaries: [], compositeKey: composite, transformedKey: transformed, keyfileUsed: !!creds.keyfile,
      format: { major: 4, minor: 0 }, cipher: opts.cipher || CIPHER_AES, compression: 1, kdf, kdfInfo: kdfInfo(kdf), publicCustomData: null,
    };
  }

  // Re-key: new credentials with a fresh KDF salt.
  async function rekey(db, creds, onProgress) {
    const composite = await compositeKey(creds);
    const kdf = db.kdf.map((e) => Object.assign({}, e));
    const info = kdfInfo(kdf);
    vset(kdf, 'S', 0x42, rand(32)); // fresh salt / seed
    const transformed = await deriveTransformedKey(composite, kdf, onProgress);
    db.compositeKey = composite; db.transformedKey = transformed; db.kdf = kdf; db.kdfInfo = info;
    db.keyfileUsed = !!creds.keyfile;
  }

  return {
    open, create, serialize, verify, sameContent, rekey, KdbxError, parseHeader, runKdfJob, kdfInfo,
    util: { concat, hex, fromHex, b64, unb64, rand, sha256, sha512, kids, kid, kidText, parseTime, formatTime, enc, dec },
    CIPHER_AES, CIPHER_CHACHA, vset, vget,
    // exposed for self-tests
    _ChaCha20: ChaCha20, _Salsa20: Salsa20, keyFileToKey, compositeKey,
  };
})();
