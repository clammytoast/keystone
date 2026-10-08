/* ===================================================================== Keystone UI — part 2: unlock, save, lock */

const choose = (o) => new Promise((res) => openModal({
  title: o.title, body: h('p', null, o.message),
  actions: o.options.map((x) => ({ label: x.label, kind: x.kind, value: x.value, onClick: x.onClick })),
  onClose: (r) => res(r === undefined ? null : r),
}));

// ---------------------------------------------------------------------- unlock screen
function setUnlockError(msg) {
  S.unlock.error = msg;
  renderUnlock();
  const card = $('.unlock-card'); if (card) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); }
}

// pick = { ref, name, size, where }  (ref is opaque: a file handle, a host path, or in-memory bytes)
// keyPick = { ref, name, auto }      (auto: found next to the database rather than chosen by the user)
function setDb(pick, keyPick, prefs) {
  const u = S.unlock;
  u.db = { name: pick.name, size: pick.size, ref: pick.ref, where: pick.where || '' };
  u.error = null; u.pw = ''; u.suppressAuto = false;
  if (keyPick) u.key = keyPick;
  else if (u.recent && u.recent.name === pick.name && u.recent.key && !u.key) u.key = { name: u.recent.keyName, ref: u.recent.key };
  // password and/or key file: a remembered choice for this database wins, otherwise use every method that is available
  u.usePw = prefs && prefs.usePw !== undefined ? !!prefs.usePw : true;
  u.useKey = !!u.key && !(prefs && prefs.useKey === false);
  if (!u.usePw && !u.useKey) u.usePw = true;
  renderUnlock();
}
function setKey(pick) {
  S.unlock.key = { name: pick.name, ref: pick.ref, auto: false };
  S.unlock.useKey = true;
  S.unlock.error = null;
  renderUnlock();
}
// a database picked by hand or dropped on the window: use the key file that sits next to it, if there is one
async function setDbWithKey(pick) {
  let key = null;
  if (IO.native && pick.ref.path && !S.unlock.key) {
    try { const kp = await host.call('findKey', { path: pick.ref.path }); if (kp) key = { name: baseName(kp), ref: { path: kp }, auto: true }; } catch (e) { /* no key found */ }
  }
  setDb(pick, key);
}
async function chooseDb() { try { const p = await IO.pickOpen('db'); if (p) await setDbWithKey(p); } catch (e) { toast(e.message, { error: true }); } }
async function chooseKey() { try { const p = await IO.pickOpen('key'); if (p) setKey(p); } catch (e) { toast(e.message, { error: true }); } }

async function continueRecent() {            // plain-browser mode only; the desktop app selects the remembered database by itself
  const r = S.unlock.recent;
  try { setDb(await IO.openRecent(r)); }
  catch (e) {
    toast(e.name === 'NotAllowedError' ? 'Keystone needs permission to open ' + r.name : 'Could not find ' + r.name + ' any more. Choose it again.', { error: true });
    if (e.name !== 'NotAllowedError') { await IO.forgetRecent(); S.unlock.recent = null; renderUnlock(); }
  }
}

// ---------------------------------------------------------------------- finding the database on its own (desktop app)
function applyCandidate(c) {
  setDb({ ref: { path: c.dbPath }, name: c.name, size: c.size, where: c.where }, c.keyPath ? { name: c.keyName, ref: { path: c.keyPath }, auto: true } : null);
}
let discovering = false;
function restorePw() { const u = S.unlock; if (u.keepPw) { u.pw = u.keepPw; u.keepPw = ''; renderUnlock(); } }
// Looks for the remembered database (wherever its drive is plugged in now), then for databases on connected drives.
// Runs at start, when a drive is plugged in or removed, and when the window is focused again on the unlock screen.
async function discover() {
  if (!IO.native || S.vault || S.unlock.busy || discovering) return;
  discovering = true;
  try {
    const u = S.unlock;
    if (u.db && u.db.ref.path) {
      if (await IO.stat(u.db.ref)) return;                  // still where we left it
      u.keepPw = u.pw; u.db = null; u.key = null;             // its drive was unplugged: keep what was typed for when it comes back
    }
    if (u.db) return;
    const rec = await IO.loadRecent();
    u.waiting = null; u.found = [];
    if (rec && !rec.missing && !u.suppressAuto) {
      setDb({ ref: rec.db, name: rec.name, size: rec.size, where: rec.where }, rec.key ? { name: rec.keyName, ref: rec.key, auto: true } : null, { usePw: rec.usePw, useKey: rec.useKey });
      restorePw();
      return;
    }
    if (rec && rec.missing) u.waiting = rec;
    u.found = await IO.scanDrives();
    if (!u.suppressAuto && !u.waiting && u.found.length === 1) { applyCandidate(u.found[0]); restorePw(); return; }
    renderUnlock();
  } finally { discovering = false; S.lastDiscover = Date.now(); }
}

function renderUnlock() {
  document.title = 'Keystone';
  const u = S.unlock, root = $('#root');
  root.replaceChildren();
  const brand = h('div', { class: 'brand' }, logo(), h('div', null, h('b', null, 'Keystone'), h('span', null, 'Your KeePass vault, made simple')));
  let main;
  if (!u.db) {
    const cands = u.found || [];
    main = [
      h('h1', null, 'Open your database'),
      h('p', { class: 'sub' }, IO.native ? 'Plug in your USB drive and Keystone finds your database, or choose the file yourself.' : 'Choose your .kdbx file, or drop it anywhere on this window.'),
      u.waiting ? h('div', { class: 'recent', style: 'cursor:default', role: 'status' }, ic('info'),
        h('span', { class: 'nm' }, h('b', null, 'Waiting for your drive'), h('small', null, 'Plug in ' + (u.waiting.volLabel ? '“' + u.waiting.volLabel + '”' : 'the USB drive') + ' to open ' + u.waiting.name))) : null,
      cands.length ? h('div', { class: 'cands' }, cands.map((c) => h('button', { class: 'recent', onclick: () => applyCandidate(c) }, ic('file'),
        h('span', { class: 'nm' }, h('b', null, c.name), h('small', null, [c.where, c.keyName ? 'key file ' + c.keyName : null].filter(Boolean).join(' · '))), ic('chevR')))) : null,
      h('button', { class: 'drop', id: 'dropzone', onclick: chooseDb }, ic('file'), h('strong', null, 'Choose a database'), h('small', null, 'KeePass 2 files (.kdbx), format 3 or 4')),
      h('div', { class: 'or' }, h('span', null, 'new here?')),
      h('button', { class: 'btn', style: 'width:100%;height:40px', id: 'createbtn', onclick: openCreateDialog }, ic('plus'), 'Create a new database'),
      u.recent ? h('button', { class: 'recent', onclick: continueRecent }, ic('lock'),
        h('span', { class: 'nm' }, h('b', null, 'Continue with ' + u.recent.name), h('small', null, u.recent.keyName ? 'with key file ' + u.recent.keyName : 'last opened here')),
        ic('chevR')) : null,
    ];
  } else {
    // Like KeePass: unlock with a password, a key file, or both. At least one stays ticked.
    const pw = h('input', { class: 'input', id: 'pw', type: u.showPw ? 'text' : 'password', value: u.pw, autocomplete: 'off', spellcheck: false, placeholder: 'Master password', disabled: u.busy || !u.usePw,
      oninput: (e) => { u.pw = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') unlockVault(); } });
    const eye = h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Show password', disabled: !u.usePw, onclick: () => { u.showPw = !u.showPw; pw.type = u.showPw ? 'text' : 'password'; eye.replaceChildren(ic(u.showPw ? 'eyeOff' : 'eye')); pw.focus(); } }, ic(u.showPw ? 'eyeOff' : 'eye'));
    const pwBox = h('input', { type: 'checkbox', checked: u.usePw, disabled: u.busy, onchange: (e) => {
      if (!e.target.checked && !u.useKey) { e.target.checked = true; return; }          // keep at least one method
      u.usePw = e.target.checked; renderUnlock();
    } });
    const keyBox = h('input', { type: 'checkbox', checked: u.useKey, disabled: u.busy, onchange: async (e) => {
      if (e.target.checked) { if (!u.key) { e.target.checked = false; await chooseKey(); return; } u.useKey = true; }
      else { if (!u.usePw) { e.target.checked = true; return; } u.useKey = false; }
      renderUnlock();
    } });
    main = [
      h('h1', null, 'Welcome back'),
      h('p', { class: 'sub' }, 'Unlock with your password, your key file, or both — whatever this database uses.'),
      h('div', { class: 'stack' },
        h('div', { class: 'filechip' }, ic('file'), h('div', { class: 'nm' }, h('b', null, u.db.name), h('small', null, [u.db.where, u.db.size ? fmtBytes(u.db.size) : null].filter(Boolean).join(' · ') || 'KeePass database')),
          h('button', { class: 'btn ghost sm', disabled: u.busy, onclick: () => { u.db = null; u.key = null; u.useKey = false; u.usePw = true; u.pw = ''; u.keepPw = ''; u.error = null; u.suppressAuto = true; renderUnlock(); discover(); } }, 'Change')),
        h('div', { class: 'method' + (u.usePw ? '' : ' off') }, h('label', { class: 'check' }, pwBox, 'Master password'), h('div', { class: 'input-wrap' }, pw, h('div', { class: 'tail' }, eye))),
        h('div', { class: 'method' + (u.useKey ? '' : ' off') }, h('label', { class: 'check' }, keyBox, 'Key file'),
          u.key
            ? h('div', { class: 'filechip' }, ic('key'), h('div', { class: 'nm' }, h('b', null, u.key.name), h('small', null, u.key.auto ? 'Found next to the database' : 'Chosen by you')),
              h('button', { class: 'btn ghost sm', disabled: u.busy, onclick: chooseKey }, 'Change'),
              h('button', { class: 'icon-btn sm', 'aria-label': 'Remove key file', disabled: u.busy, onclick: () => { u.key = null; u.useKey = false; renderUnlock(); } }, ic('x')))
            : h('button', { class: 'btn sm', style: 'justify-self:start', disabled: u.busy, onclick: chooseKey }, ic('key'), 'Choose key file…')),
        u.error ? h('div', { class: 'errmsg', role: 'alert' }, ic('alert'), h('span', null, u.error)) : null,
        u.busy
          ? h('div', null, h('div', { class: 'progress' }, h('i', { id: 'prog', style: 'width:' + Math.round(u.progress * 100) + '%' })),
            h('div', { class: 'progress-label' }, h('span', null, 'Unlocking — this takes a moment on purpose'), h('span', { id: 'progpct' }, Math.round(u.progress * 100) + '%')))
          : h('button', { class: 'btn primary', style: 'height:42px;font-size:15px', onclick: unlockVault }, ic('unlock'), 'Unlock'),
      ),
    ];
  }
  root.append(h('div', { class: 'unlock' }, h('div', { class: 'unlock-card' }, brand, main,
    h('div', { class: 'privacy' }, ic('shield'), 'Decrypted on this device only. No network access.'))));
  if (u.db && !u.busy) { const p = (u.usePw ? $('#pw') : null) || $('.unlock-card .btn.primary'); if (p) p.focus(); }
}

async function unlockVault() {
  const u = S.unlock;
  if (u.busy || !u.db) return;
  if (u.usePw && !u.pw) { setUnlockError(u.useKey ? 'Enter your master password, or untick “Master password” if this database only uses the key file.' : 'Enter your master password.'); return; }
  if (u.useKey && !u.key) { setUnlockError('Choose your key file, or untick “Key file”.'); return; }
  u.busy = true; u.error = null; u.progress = 0; renderUnlock();
  try {
    const src = await IO.read(u.db.ref);
    const key = u.useKey && u.key ? await IO.read(u.key.ref) : null;
    const progress = (p) => {
      u.progress = p;
      const bar = $('#prog'); if (bar) bar.style.width = Math.round(p * 100) + '%';
      const pct = $('#progpct'); if (pct) pct.textContent = Math.round(p * 100) + '%';
    };
    const password = u.usePw ? u.pw : null;
    let db;
    try { db = await KDBX.open(src.bytes, { password, keyfile: key ? key.bytes : null }, progress); }
    catch (e) {
      // a key file Keystone picked up on its own may not belong to this database: try the password alone before giving up
      if (!(e.code === 'wrongkey' && key && u.key.auto && password)) throw e;
      try { db = await KDBX.open(src.bytes, { password, keyfile: null }, progress); u.useKey = false; } catch (e2) { throw e; }
    }
    S.vault = new Vault(db, { fileName: u.db.name, ref: u.db.ref, bytes: src.bytes });
    S.stamp = src.stamp; S.backupDone = false;
    IO.saveRecent(u.db, u.key, { usePw: u.usePw, useKey: u.useKey });
    u.pw = ''; u.busy = false;
    enterVault();
  } catch (e) {
    u.busy = false;
    let msg = e.message || String(e);
    if (e.code === 'wrongkey') {
      msg = u.usePw && u.useKey ? 'That password and key file don’t match this database.'
        : u.useKey ? 'That key file alone doesn’t unlock this database. If it also needs a password, tick “Master password”.'
          : 'That password doesn’t match. If this database also uses a key file, tick “Key file” and choose it.';
    }
    else if (e.name === 'NotFoundError' || e.code === 'FileNotFound') msg = 'The database file isn’t available. If it’s on a USB drive, plug it in — Keystone will find it again.';
    else if (e.name === 'NotAllowedError' || e.code === 'Unauthorized') msg = 'Keystone doesn’t have permission to read that file.';
    setUnlockError(msg);
  }
}
// ---------------------------------------------------------------------- drag & drop of .kdbx / key files onto the unlock screen
async function handleDrops(picks) {
  if (S.vault || S.unlock.busy) return;
  for (const p of picks) { if (/\.kdbx$/i.test(p.name)) await setDbWithKey(p); else setKey(p); }
}
(function setupDrop() {
  let veil = null, depth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  const clearVeil = () => { depth = 0; if (veil) { veil.remove(); veil = null; } };
  document.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; if (!S.vault && !veil) { veil = h('div', { class: 'dropveil' }, 'Drop to open'); document.body.append(veil); } });
  document.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth && veil) clearVeil(); });
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); clearVeil();
    if (S.vault || S.unlock.busy) return;
    if (host) { host.postFiles(e.dataTransfer.files); return; }          // the desktop host answers with real paths ('dropped' event)
    const jobs = Array.from(e.dataTransfer.items).filter((i) => i.kind === 'file').map((i) => ({ hp: i.getAsFileSystemHandle ? i.getAsFileSystemHandle() : null, f: i.getAsFile() }));
    const picks = [];
    for (const j of jobs) {
      let handle = null;
      try { const hnd = j.hp ? await j.hp : null; if (hnd && hnd.kind === 'file') handle = hnd; } catch (err) { /* plain file */ }
      const file = handle ? await handle.getFile() : j.f;
      if (file) picks.push(await browserIO.fromFile(file, handle));
    }
    handleDrops(picks);
  });
})();

// ---------------------------------------------------------------------- backups + saving
const backupName = (v) => v.fileName.replace(/\.kdbx$/i, '') + ' (backup ' + backupStamp() + ').kdbx';

async function backupElsewhere(v) {
  const s = await IO.pickSave(backupName(v), 'db');
  if (s) { await IO.write(s.ref, v.sourceBytes); return true; }
  if (IO.canSave) return false;                    // user cancelled the dialog
  await IO.download(v.sourceBytes, backupName(v)); return true;
}

// Returns true when it is fine to go on and overwrite the file.
async function offerBackup(silent) {
  const v = S.vault;
  if (S.set.backupMode === 'auto' && IO.native && v.ref && v.ref.path) {
    try { await IO.backupBeside(v.ref, v.sourceBytes); S.backupDone = true; return true; }
    catch (e) { if (!silent) openModal({ title: 'Couldn’t write the backup', body: h('p', null, (e.message || String(e)) + ' Nothing was changed. You can turn automatic backups off in Settings.'), actions: [{ label: 'OK', kind: 'primary' }] }); return false; }
  }
  if (silent) return false;
  const upgrade = v.db.format.major < 4;
  const always = h('input', { type: 'checkbox' });
  const choice = await new Promise((res) => {
    const actions = [{ label: 'Skip', value: 'skip' }, { label: 'Don’t ask again', value: 'never' }];
    const fail = (e) => { toast('Backup failed: ' + (e.message || e), { error: true }); return false; };
    actions.push({ label: 'Choose location…', value: 'done', onClick: async () => { try { if (!(await backupElsewhere(v))) return false; toast('Backup saved'); } catch (e) { return fail(e); } } });
    if (IO.native && v.ref && v.ref.path) {
      actions.push({ label: 'Back up next to the database', kind: 'primary', value: 'done', onClick: async () => {
        try { await IO.backupBeside(v.ref, v.sourceBytes); if (always.checked) { S.set.backupMode = 'auto'; saveSettings(); } toast('Backup saved next to your database'); } catch (e) { return fail(e); }
      } });
    }
    openModal({
      title: 'Keep a backup of the original?',
      body: [
        h('p', null, 'This is the first time Keystone will overwrite this file in this session. A copy of the database as it was when you opened it costs nothing and lets you go back.'),
        upgrade ? h('p', null, 'Heads up: this file uses the older KDBX ' + v.db.format.major + ' format. Saving upgrades it to KDBX 4, which KeePass 2.35 and newer open fine.') : null,
        IO.native ? h('label', { class: 'check' }, always, 'Do this automatically from now on') : null,
      ],
      actions, onClose: (r) => res(r || 'cancel'),
    });
  });
  if (choice === 'cancel') return false;
  if (choice === 'never') { S.set.backupMode = 'off'; saveSettings(); }
  S.backupDone = true;
  return true;
}

async function saveVault({ asCopy = false, silent = false } = {}) {
  const v = S.vault;
  if (!v) return false;
  let done = silent ? () => {} : busy('Saving…');
  try {
    const bytes = await v.buildBytes();
    if (!IO.canSave) { await IO.download(bytes, v.fileName); v.markSaved(bytes); toast('Downloaded ' + v.fileName + ' — replace your original with it'); return true; }
    const ref = v.ref;
    if (!ref || asCopy) {
      if (silent) return false;
      done();
      const s = await IO.pickSave(asCopy ? v.fileName.replace(/\.kdbx$/i, '') + ' (copy).kdbx' : v.fileName, 'db');
      if (!s) return false;
      done = busy('Saving…');
      const stamp = await IO.write(s.ref, bytes);
      if (asCopy) { toast('Saved a copy as ' + s.name); return true; }
      v.ref = s.ref; v.fileName = s.name; S.unlock.db = { name: s.name, size: bytes.length, ref: s.ref }; S.stamp = stamp;
      v.markSaved(bytes); toast('Saved'); return true;
    }
    if (!(await IO.ensureWrite(ref, !silent))) { if (!silent) toast('Keystone needs permission to write to that file', { error: true }); return false; }
    const cur = await IO.stat(ref);
    if (S.stamp && cur && (cur.lastModified !== S.stamp.lastModified || cur.size !== S.stamp.size)) {
      if (silent) return false;
      done();
      const c = await choose({ title: 'The file changed on disk', message: 'Another program or device modified ' + v.fileName + ' after you opened it. Overwriting would discard those changes.',
        options: [{ label: 'Cancel', value: null }, { label: 'Save as a copy…', value: 'copy' }, { label: 'Overwrite', kind: 'danger solid', value: 'overwrite' }] });
      if (c === 'copy') return saveVault({ asCopy: true });
      if (c !== 'overwrite') return false;
      done = busy('Saving…');
    }
    if (!S.backupDone && S.set.backupMode !== 'off') {
      if (!silent) done();
      if (!(await offerBackup(silent))) return false;
      if (!silent) done = busy('Saving…');
    }
    S.stamp = await IO.write(ref, bytes);
    v.markSaved(bytes);
    if (!silent) toast('Saved');
    return true;
  } catch (e) {
    const gone = e && (e.code === 'FileNotFound' || e.name === 'NotFoundError');
    if (!silent) openModal({ title: 'Couldn’t save', body: h('p', null, gone ? 'The drive or folder holding this database isn’t available any more. Plug the USB drive back in and save again, or use Settings → Save as… to keep a copy somewhere else. Your changes are still safe in Keystone until you close it.' : (e.message || String(e))), actions: [{ label: 'OK', kind: 'primary' }] });
    return false;
  } finally { done(); }
}

// ---------------------------------------------------------------------- lock
function wipeVaultUi() {
  wipeClipboardNow();
  clearInterval(S.totpTimer); S.totpTimer = null;
  closeMenu();
  for (const m of S.modals.slice()) m.close();
  S.vault = null; S.editing = null; S.selectedId = null; S.query = ''; S.reveal = false; S.scope = { type: 'all' };
  IO.setDirty(false);
  const u = S.unlock;
  u.pw = ''; u.keepPw = ''; u.error = null; u.busy = false; u.progress = 0; u.showPw = false;
  if (u.key && u.key.ref.bytes) u.key = null;          // never keep key-file bytes around after locking
  renderUnlock();
}
async function lockVault({ auto = false, closing = false } = {}) {
  const v = S.vault;
  if (!v) return true;
  if (v.dirty) {
    if (auto) {
      if (!(await saveVault({ silent: true }))) {
        toast('Auto-lock waiting — you have unsaved changes', { error: true });
        S.idleAt = Date.now() - S.set.autoLock * 60000 + 60000;
        return false;
      }
    } else {
      const c = await choose({ title: closing ? 'Save changes before closing?' : 'Save changes before locking?', message: 'You have changes that haven’t been saved to ' + v.fileName + '.',
        options: [{ label: 'Cancel', value: null }, { label: 'Discard', kind: 'danger', value: 'discard' },
          { label: closing ? 'Save & close' : 'Save & lock', kind: 'primary', value: 'save', onClick: async () => { if (!(await saveVault())) return false; } }] });
      if (!c) return false;
    }
  }
  wipeVaultUi();
  return true;
}
