/* ===================================================================== Keystone IO layer
 * Everything that touches the outside world (files, clipboard, links, window) goes through `IO`.
 *   - nativeIO : talks to the desktop host (Keystone.exe) over a tiny message bridge.
 *   - browserIO: uses File System Access / blob downloads, so the UI also runs in a plain browser (used for testing).
 * A host for another OS only has to implement the bridge commands listed in docs/host-bridge.md.
 */
'use strict';

const host = (() => {
  const wv = window.chrome && window.chrome.webview;
  if (!wv) return null;
  let seq = 0;
  const pending = new Map(), handlers = new Map();
  wv.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m && m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.ok) p.res(m.result); else p.rej(Object.assign(new Error(m.error || 'Host error'), { code: m.code }));
    } else if (m && m.event && handlers.has(m.event)) handlers.get(m.event)(m.data);
  });
  return {
    call(cmd, args) { return new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); wv.postMessage(Object.assign({ id, cmd }, args || {})); }); },
    on(event, fn) { handlers.set(event, fn); },
    postFiles(files) { wv.postMessageWithAdditionalObjects({ cmd: 'drop' }, files); },
  };
})();

const b64enc = (u8) => KDBX.util.b64(u8), b64dec = (s) => KDBX.util.unb64(s);
const sameBytes = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const baseName = (p) => p.replace(/^.*[\\/]/, '');
const dirName = (p) => { const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')); return i < 0 ? '' : p.slice(0, i); };
const pad2 = (n) => String(n).padStart(2, '0');
const backupStamp = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + pad2(d.getMinutes()); };

// "USB drive “MYSTICK” (E:)" — empty for the system drive
function whereText(d) {
  if (!d || d.system) return '';
  return (d.removable ? 'USB drive' : 'Drive') + (d.label ? ' “' + d.label + '”' : '') + (d.drive ? ' (' + d.drive + ')' : '');
}

// ---------------------------------------------------------------------- native desktop host
const nativeIO = {
  native: true, canSave: true,
  async pickOpen(kind) { const r = await host.call('openDialog', { kind }); return r ? { ref: { path: r.path }, name: r.name, size: r.size } : null; },
  async read(ref) {
    if (ref.bytes) return { bytes: ref.bytes, stamp: null };
    const r = await host.call('readFile', { path: ref.path });
    return { bytes: b64dec(r.data), stamp: { lastModified: r.mtime, size: r.size } };
  },
  async stat(ref) { const r = await host.call('statFile', { path: ref.path }); return r && r.exists ? { lastModified: r.mtime, size: r.size } : null; },
  async ensureWrite() { return true; },
  async write(ref, bytes) { const r = await host.call('writeFile', { path: ref.path, data: b64enc(bytes) }); return { lastModified: r.mtime, size: r.size }; },
  async pickSave(name, kind) { const r = await host.call('saveDialog', { suggestedName: name, kind: kind || 'db' }); return r ? { ref: { path: r.path }, name: r.name } : null; },
  async download(bytes, name) { const s = await this.pickSave(name, 'any'); if (!s) return false; await this.write(s.ref, bytes); return true; },
  // writes next to the database and keeps only the newest few
  async backupBeside(ref, bytes) {
    const base = baseName(ref.path).replace(/\.kdbx$/i, ''), dir = dirName(ref.path), sep = ref.path.includes('\\') ? '\\' : '/';
    const path = dir + sep + base + ' (backup ' + backupStamp() + ').kdbx';
    await host.call('writeFile', { path, data: b64enc(bytes) });
    host.call('pruneBackups', { dir, prefix: base + ' (backup ', keep: 10 }).catch(() => {});
    return path;
  },
  async copy(text, secs) { await host.call('clipboardCopy', { text, clearMs: secs > 0 ? secs * 1000 : 0 }); return true; },
  wipe() { host.call('clipboardClear').catch(() => {}); },
  openUrl(url) { host.call('openUrl', { url }).catch(() => {}); },
  // The remembered database is stored with the identity of the drive it lives on, so it is found again even when
  // Windows gives the USB stick a different drive letter (or it is another computer's port).
  async loadRecent() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem('keystone.recent') || 'null'); } catch (e) { /* ignore */ }
    if (!r || !r.dbPath) return null;
    let res = null;
    try { res = await host.call('resolveRecent', { dbPath: r.dbPath, dbRel: r.dbRel, vol: r.vol, keyPath: r.keyPath, keyRel: r.keyRel, keyVol: r.keyVol }); } catch (e) { /* treat as missing */ }
    const keyName = r.keyName || (r.keyPath ? baseName(r.keyPath) : '');
    if (!res || !res.found) return { name: r.name, missing: true, volLabel: r.volLabel || '', removable: !!r.removable, keyName };
    return { name: r.name, db: { path: res.dbPath }, key: res.keyPath ? { path: res.keyPath } : null, keyName: res.keyPath ? baseName(res.keyPath) : keyName,
      size: res.size, where: whereText(res), usePw: r.usePw, useKey: r.useKey };
  },
  async saveRecent(db, key, prefs) {
    try {
      const vi = await host.call('volumeInfo', { path: db.ref.path });
      const kv = key && key.ref.path ? await host.call('volumeInfo', { path: key.ref.path }) : null;
      localStorage.setItem('keystone.recent', JSON.stringify({
        name: db.name, dbPath: db.ref.path, dbRel: vi.serial ? vi.rel : null, vol: vi.serial || null, volLabel: vi.label, removable: vi.removable,
        keyPath: key && key.ref.path || null, keyName: key && key.name || null,
        keyRel: kv && vi.serial && kv.serial === vi.serial ? kv.rel : null, keyVol: kv && kv.serial || null,
        usePw: prefs ? prefs.usePw : true, useKey: prefs ? prefs.useKey : !!key,
      }));
    } catch (e) { /* ignore */ }
  },
  async forgetRecent() { try { localStorage.removeItem('keystone.recent'); } catch (e) { /* ignore */ } },
  async openRecent(r) {
    const st = await host.call('statFile', { path: r.db.path });
    if (!st || !st.exists) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
    return { ref: r.db, name: baseName(r.db.path), size: st.size };
  },
  // databases (and their key files) found on connected drives
  async scanDrives() {
    try { return (await host.call('scanDrives')).map((c) => Object.assign(c, { where: whereText(c) })); } catch (e) { return []; }
  },
  async launchArgs() { try { return await host.call('launchArgs'); } catch (e) { return []; } },
  setTheme(dark) { host.call('theme', { dark }).catch(() => {}); },
  setCapture(on) { host.call('captureProtection', { on }).catch(() => {}); },
  setDirty(dirty) { host.call('dirty', { dirty }).catch(() => {}); },
  quit() { host.call('quit').catch(() => {}); },
  closeCancelled() { host.call('closeCancelled').catch(() => {}); },
  ready() { host.call('ready').catch(() => {}); },
};

// ---------------------------------------------------------------------- plain browser (File System Access API)
const idb = {
  open() { return new Promise((res, rej) => { const r = indexedDB.open('keystone', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async run(mode, fn) {
    try {
      const db = await this.open();
      return await new Promise((res, rej) => { const q = fn(db.transaction('kv', mode).objectStore('kv')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    } catch (e) { return undefined; }
  },
  get(k) { return this.run('readonly', (s) => s.get(k)); },
  set(k, v) { return this.run('readwrite', (s) => s.put(v, k)); },
  del(k) { return this.run('readwrite', (s) => s.delete(k)); },
};
async function perm(handle, mode, ask) {
  try {
    const o = { mode };
    if ((await handle.queryPermission(o)) === 'granted') return true;
    return ask ? (await handle.requestPermission(o)) === 'granted' : false;
  } catch (e) { return false; }
}
const browserIO = {
  native: false,
  canSave: typeof window.showSaveFilePicker === 'function',
  async fromFile(file, handle) { return { ref: handle ? { handle } : { bytes: new Uint8Array(await file.arrayBuffer()) }, name: file.name, size: file.size }; },
  async pickOpen(kind) {
    if (typeof window.showOpenFilePicker !== 'function') {
      return new Promise((resolve) => {
        const inp = h('input', { type: 'file', accept: kind === 'db' ? '.kdbx' : '.keyx,.key,*/*', hidden: true });
        inp.addEventListener('change', async () => { resolve(inp.files[0] ? await this.fromFile(inp.files[0], null) : null); inp.remove(); });
        inp.addEventListener('cancel', () => { resolve(null); inp.remove(); });
        document.body.append(inp); inp.click();
      });
    }
    try {
      const types = kind === 'db' ? [{ description: 'KeePass database', accept: { 'application/octet-stream': ['.kdbx'] } }]
        : [{ description: 'Key file', accept: { 'application/octet-stream': ['.keyx', '.key'] } }];
      const [handle] = await showOpenFilePicker({ types, excludeAcceptAllOption: false, multiple: false, mode: kind === 'db' ? 'readwrite' : 'read' });
      return this.fromFile(await handle.getFile(), handle);
    } catch (e) { if (e.name === 'AbortError') return null; throw e; }
  },
  async read(ref) {
    if (ref.bytes) return { bytes: ref.bytes, stamp: null };
    await perm(ref.handle, 'read', true);
    const f = await ref.handle.getFile();
    return { bytes: new Uint8Array(await f.arrayBuffer()), stamp: { lastModified: f.lastModified, size: f.size } };
  },
  async stat(ref) { if (!ref.handle) return null; const f = await ref.handle.getFile(); return { lastModified: f.lastModified, size: f.size }; },
  ensureWrite(ref, ask) { return ref.handle ? perm(ref.handle, 'readwrite', ask) : Promise.resolve(false); },
  async write(ref, bytes) {
    const w = await ref.handle.createWritable();
    await w.write(bytes); await w.close();
    const f = await ref.handle.getFile();
    if (!sameBytes(new Uint8Array(await f.arrayBuffer()), bytes)) throw new Error('The file on disk does not match what was written. Your changes are still safe in memory — try saving again or save a copy.');
    return { lastModified: f.lastModified, size: f.size };
  },
  async pickSave(name, kind) {
    if (typeof window.showSaveFilePicker !== 'function') return null;
    try {
      const types = kind === 'key' ? [{ description: 'KeePass key file', accept: { 'application/octet-stream': ['.keyx'] } }]
        : kind === 'any' ? [] : [{ description: 'KeePass database', accept: { 'application/octet-stream': ['.kdbx'] } }];
      const handle = await showSaveFilePicker({ suggestedName: name, types });
      return { ref: { handle }, name: handle.name };
    } catch (e) { if (e.name === 'AbortError') return null; throw e; }
  },
  async download(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const a = h('a', { href: url, download: name, hidden: true });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  },
  clipTimer: null, clipPending: false,
  async copy(text, secs) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch (e) {
      const t = h('textarea', { style: 'position:fixed;opacity:0' }, text);
      document.body.append(t); t.select();
      try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
      t.remove();
    }
    if (!ok) return false;
    clearTimeout(this.clipTimer); this.clipPending = false;
    if (secs > 0) this.clipTimer = setTimeout(async () => { try { await navigator.clipboard.writeText(''); } catch (e) { this.clipPending = true; } }, secs * 1000);
    return true;
  },
  wipe() { if (this.clipTimer) { clearTimeout(this.clipTimer); this.clipTimer = null; navigator.clipboard.writeText('').catch(() => { this.clipPending = true; }); } },
  openUrl(url) { window.open(url, '_blank', 'noopener,noreferrer'); },
  async loadRecent() {
    const r = await idb.get('recent');
    return r && r.db ? { name: r.name, db: { handle: r.db }, key: r.key ? { handle: r.key } : null, keyName: r.key ? r.key.name : '' } : null;
  },
  async saveRecent(db, key) { if (db.ref.handle) idb.set('recent', { name: db.name, db: db.ref.handle, key: key && key.ref.handle || null }); },
  forgetRecent() { return idb.del('recent'); },
  async openRecent(r) {
    if (!(await perm(r.db.handle, 'readwrite', true))) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const f = await r.db.handle.getFile();
    return { ref: r.db, name: f.name, size: f.size };
  },
  async launchArgs() { return []; },
  async scanDrives() { return []; },
  setTheme() {}, setCapture() {}, setDirty() {}, quit() {}, closeCancelled() {}, ready() {},
};
window.addEventListener('focus', async () => {
  if (!browserIO.clipPending) return;
  try { await navigator.clipboard.writeText(''); browserIO.clipPending = false; } catch (e) { /* try next time */ }
});

const IO = host ? nativeIO : browserIO;
