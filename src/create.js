/* ===================================================================== Keystone UI — create a new database */

// How hard to make it to guess the master password if someone steals the file. Both are Argon2id (the same
// family KeePass uses); "Stronger" costs a few more seconds every time the database is opened.
const PRESETS = {
  standard: { label: 'Standard', memoryMiB: 64, iterations: 2, parallelism: 2, note: 'Opens in about 2 seconds. A good fit for most people.' },
  strong: { label: 'Stronger', memoryMiB: 128, iterations: 3, parallelism: 2, note: 'Opens in about 6 seconds. Makes a stolen file much slower to attack.' },
};
const safeFileName = (s) => (String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Passwords');
const stripExt = (n) => n.replace(/\.[^.\\/]+$/, '');
const welcomeNotes = (fileName) => 'This is a sample entry. Edit it, or delete it — it moves to the Recycle Bin.\n\n' +
  '• Add a login with the + button above the list.\n' +
  '• Everything is stored encrypted in one file: ' + fileName + '. Back it up, and keep a copy somewhere safe.\n' +
  '• Copy a password with its copy button, or select an entry and press ' + SC.copyPass + '. Keystone clears your clipboard for you.\n' +
  '• If this database lives on a USB drive, plug the drive in and Keystone finds it on its own.\n' +
  '• If you ever forget your master password, nobody can recover it for you. That is what keeps your passwords safe.';

// Builds, saves and returns a brand-new unlocked vault. `p` has everything already decided:
// { name, dbRef, dbName, password|null, keyBytes|null, preset }
async function createDatabase(p, onProgress) {
  const { doc, groupIds } = Vault.newDocument(p.name, ['Personal', 'Work', 'Finance']);
  const preset = PRESETS[p.preset] || PRESETS.standard;
  const db = await KDBX.create(doc, { password: p.password, keyfile: p.keyBytes }, { memoryMiB: preset.memoryMiB, iterations: preset.iterations, parallelism: preset.parallelism, cipher: KDBX.CIPHER_AES }, onProgress);
  const v = new Vault(db, { fileName: p.dbName, ref: p.dbRef, bytes: null });
  const d = v.emptyDraft(groupIds.Personal);
  d.title = 'Welcome to Keystone'; d.notes = welcomeNotes(p.dbName);
  const welcomeId = v.addEntry(d);
  const bytes = await v.buildBytes();
  let stamp = null;
  if (p.dbRef && IO.canSave) stamp = await IO.write(p.dbRef, bytes);
  else await IO.download(bytes, p.dbName);                      // plain browser without file access: hand the file over as a download
  v.markSaved(bytes);
  return { vault: v, stamp, bytes, welcomeId };
}

function openCreateDialog() {
  if (S.vault) return;
  const st = { name: 'Passwords', dbPick: null, usePw: true, useKey: false, keyMode: 'new', keyPick: null, preset: 'standard' };

  const err = h('div', { class: 'errmsg', hidden: true, role: 'alert' });
  const fail = (m) => { err.hidden = false; err.replaceChildren(ic('alert'), h('span', null, m)); return false; };

  // ---- name + where it is saved
  const where = h('small', null);
  const refreshWhere = () => {
    where.textContent = st.dbPick ? (st.dbPick.ref && st.dbPick.ref.path ? dirName(st.dbPick.ref.path) : 'Saved as a download') : 'Not chosen yet';
    whereName.textContent = st.dbPick ? st.dbPick.name : safeFileName(st.name) + '.kdbx';
  };
  const whereName = h('b', null);
  async function chooseLocation() {
    try {
      const s = await IO.pickSave(safeFileName(st.name) + '.kdbx', 'db');
      if (s) st.dbPick = s; else if (!IO.canSave) st.dbPick = { ref: null, name: safeFileName(st.name) + '.kdbx' };
    } catch (e) { fail(e.message); }
    refreshWhere();
  }
  const nameIn = h('input', { class: 'input', value: st.name, maxLength: 100, 'data-autofocus': true, 'aria-label': 'Database name',
    oninput: (e) => { st.name = e.target.value; if (!st.dbPick) refreshWhere(); } });
  const locBox = h('div', { class: 'filechip' }, ic('file'), h('div', { class: 'nm' }, whereName, where),
    h('button', { class: 'btn sm', type: 'button', onclick: chooseLocation }, 'Choose…'));
  refreshWhere();

  // ---- how it is unlocked: password, key file, or both (like KeePass)
  const p1 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', spellcheck: false, placeholder: 'Master password', 'aria-label': 'Master password' });
  const p2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', spellcheck: false, placeholder: 'Type it again', 'aria-label': 'Repeat the password' });
  const meterBox = h('div', { class: 'pwtools', style: 'margin:0' });
  const hint = h('div', { class: 'hint', style: 'margin-top:0' });
  p1.addEventListener('input', () => {
    meterBox.replaceChildren(...(p1.value ? meterEl(p1.value) : []));
    hint.textContent = p1.value && Util.strength(p1.value).level <= 1 ? 'That password would be easy to guess. A few random words, or a long sentence, is much stronger.' : '';
  });
  const eye = h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Show password', onclick: () => {
    const on = p1.type === 'password'; p1.type = p2.type = on ? 'text' : 'password'; eye.replaceChildren(ic(on ? 'eyeOff' : 'eye'));
  } }, ic('eye'));
  const pwBox = h('input', { type: 'checkbox', checked: true, onchange: (e) => {
    if (!e.target.checked && !st.useKey) { e.target.checked = true; return; }
    st.usePw = e.target.checked; drawMethods();
  } });
  const keyBox = h('input', { type: 'checkbox', onchange: (e) => {
    if (!e.target.checked && !st.usePw) { e.target.checked = true; return; }
    st.useKey = e.target.checked; drawMethods();
  } });
  const pwSection = h('div', { class: 'method' });
  const keySection = h('div', { class: 'method off' });
  function drawMethods() {
    pwSection.className = 'method' + (st.usePw ? '' : ' off'); keySection.className = 'method' + (st.useKey ? '' : ' off');
    p1.disabled = p2.disabled = !st.usePw;
    const mode = (val, label) => h('button', { type: 'button', 'aria-pressed': st.keyMode === val, onclick: () => { st.keyMode = val; drawMethods(); } }, label);
    keySection.replaceChildren(
      h('label', { class: 'check' }, keyBox, 'Key file'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Key file' }, mode('new', 'Create a new one'), mode('existing', 'Use one I have')),
      st.keyMode === 'existing'
        ? (st.keyPick
          ? h('div', { class: 'filechip' }, ic('key'), h('div', { class: 'nm' }, h('b', null, st.keyPick.name), h('small', null, 'Key file')),
            h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Remove', onclick: () => { st.keyPick = null; drawMethods(); } }, ic('x')))
          : h('button', { class: 'btn sm', type: 'button', style: 'justify-self:start', onclick: async () => { try { const k = await IO.pickOpen('key'); if (k) { st.keyPick = k; drawMethods(); } } catch (e) { fail(e.message); } } }, ic('key'), 'Choose key file…'))
        : h('div', { class: 'hint', style: 'margin-top:0' }, 'Keystone makes a key file and asks where to save it. It works like a second password, so keep it away from the database — on a different USB stick, say.'));
  }
  pwSection.append(h('label', { class: 'check' }, pwBox, 'Master password'),
    h('div', { class: 'input-wrap' }, p1, h('div', { class: 'tail' }, eye)), meterBox, p2, hint);
  drawMethods();

  // ---- how hard to make it for an attacker
  const presetSel = h('select', { class: 'input', 'aria-label': 'Security level', onchange: (e) => { st.preset = e.target.value; presetNote.textContent = PRESETS[st.preset].note; } },
    Object.keys(PRESETS).map((k) => h('option', { value: k, selected: k === st.preset }, PRESETS[k].label)));
  const presetNote = h('small', { style: 'color:var(--ink-3)' }, PRESETS[st.preset].note);

  openModal({
    title: 'Create a new database', wide: true,
    body: [
      h('p', null, 'Your passwords will live in one encrypted file that you keep. It is a standard KeePass file, so KeePass and other KeePass apps can open it too.'),
      h('div', { class: 'field' }, h('label', null, 'Name'), nameIn),
      h('div', { class: 'field' }, h('label', null, 'Save it to'), locBox),
      pwSection, keySection,
      h('div', { class: 'field' }, h('label', null, 'Security level'), presetSel, presetNote),
      h('p', { style: 'font-size:12.5px;color:var(--ink-3)' }, 'There is no “forgot password” option: if you lose your master password (or your key file), nobody can recover the database.'),
      err,
    ],
    actions: [{ label: 'Cancel' }, { label: 'Create database', kind: 'primary', onClick: async () => {
      err.hidden = true;
      const name = st.name.trim();
      if (!name) { nameIn.focus(); return fail('Give your database a name.'); }
      if (st.usePw) {
        if (!p1.value) { p1.focus(); return fail('Enter a master password, or untick “Master password” to use only a key file.'); }
        if (p1.value !== p2.value) { p2.focus(); return fail('The two passwords don’t match.'); }
      }
      if (st.useKey && st.keyMode === 'existing' && !st.keyPick) return fail('Choose your key file, or switch to “Create a new one”.');
      if (!st.dbPick) { await chooseLocation(); if (!st.dbPick) return false; }          // dialog cancelled: nothing else to say

      let busyUi = null;
      try {
        let keyBytes = null, keyPick = null;
        if (st.useKey) {
          if (st.keyMode === 'new') {
            keyBytes = await makeKeyFile();
            const s = await IO.pickSave(stripExt(st.dbPick.name) + '.keyx', 'key');
            if (s) { await IO.write(s.ref, keyBytes); keyPick = { ref: s.ref, name: s.name }; }
            else if (!IO.canSave) { await IO.download(keyBytes, stripExt(st.dbPick.name) + '.keyx'); keyPick = null; }
            else return false;                                                             // cancelled the key file dialog
          } else { keyBytes = (await IO.read(st.keyPick.ref)).bytes; keyPick = { ref: st.keyPick.ref, name: st.keyPick.name }; }
        }
        busyUi = busy('Creating your database…');
        const res = await createDatabase({ name, dbRef: st.dbPick.ref, dbName: st.dbPick.name, password: st.usePw ? p1.value : null, keyBytes, preset: st.preset },
          (frac) => busyUi && busyUi.set('Securing your database… ' + Math.round(frac * 100) + '%'));
        busyUi(); busyUi = null;

        const u = S.unlock;
        S.vault = res.vault; S.stamp = res.stamp; S.backupDone = true;                      // brand-new file: nothing to back up
        u.db = { name: st.dbPick.name, size: res.bytes.length, ref: st.dbPick.ref, where: '' };
        u.key = keyPick ? { name: keyPick.name, ref: keyPick.ref, auto: false } : null;
        u.usePw = st.usePw; u.useKey = !!keyPick; u.pw = ''; u.error = null;
        if (st.dbPick.ref) IO.saveRecent(u.db, u.key, { usePw: u.usePw, useKey: u.useKey });
        p1.value = p2.value = '';
        enterVault();
        select(res.welcomeId);
        toast('Your database is ready');
      } catch (e) {
        if (busyUi) busyUi();
        return fail(e.message || String(e));
      }
    } }],
  });
}
