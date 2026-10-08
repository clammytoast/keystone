/* ===================================================================== Keystone UI — part 4: editor, generator, settings, shortcuts, boot */

// ---------------------------------------------------------------------- password generator
function generatorPanel({ onUse, onCopy } = {}) {
  const g = S.set.gen;
  let current = '';
  const out = h('div', { class: 'pw-v' });
  const meter = h('div', { class: 'pwtools', style: 'margin:0' });
  const regen = () => {
    current = Util.generatePassword(g);
    out.replaceChildren(colorizePw(current)); meter.replaceChildren(...meterEl(current));
    saveSettings();
  };
  const lenVal = h('b', null, g.length);
  const range = h('input', { type: 'range', class: 'range', min: 8, max: 64, value: g.length, 'aria-label': 'Length', oninput: (e) => { g.length = +e.target.value; lenVal.textContent = g.length; regen(); } });
  const boxes = {};
  const cb = (key, label) => {
    const i = h('input', { type: 'checkbox', checked: g[key], onchange: (e) => {
      g[key] = e.target.checked;
      if (key !== 'avoidAmbiguous' && !(g.lower || g.upper || g.digits || g.symbols)) { g.lower = true; boxes.lower.checked = true; }
      regen();
    } });
    boxes[key] = i;
    return h('label', { class: 'check' }, i, label);
  };
  const el = h('div', { class: 'stack' },
    h('div', { class: 'gen-out' }, out,
      h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Generate another', title: 'Generate another', onclick: regen }, ic('dice')),
      onCopy ? h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Copy', title: 'Copy', onclick: () => copyText(current, 'Password') }, ic('copy')) : null),
    meter,
    h('div', { class: 'field' }, h('label', null, 'Length ', lenVal), range),
    h('div', { class: 'opts' }, cb('lower', 'a–z'), cb('upper', 'A–Z'), cb('digits', '0–9'), cb('symbols', '!@#$%'), cb('avoidAmbiguous', 'Avoid look-alikes')),
    onUse ? h('div', { style: 'display:flex;justify-content:flex-end' }, h('button', { class: 'btn primary sm', type: 'button', onclick: () => onUse(current) }, ic('check'), 'Use this password')) : null);
  regen();
  return el;
}
function openGeneratorDialog() {
  openModal({ title: 'Password generator', body: generatorPanel({ onCopy: true }), actions: [{ label: 'Done', kind: 'primary' }] });
}

// ---------------------------------------------------------------------- entry editor
function currentGroupForNew() {
  const v = S.vault;
  const g = S.scope.type === 'group' ? v.groups.get(S.scope.id) : null;
  return g && !g.inBin ? g.id : v.root.id;
}
function startNewEntry() {
  if (!S.vault || S.editing || (S.scope.type === 'bin' && !S.query)) return;
  const draft = S.vault.emptyDraft(currentGroupForNew());
  S.editing = { draft, isNew: true, base: S.vault.sig(draft) };
  S.selectedId = null;
  document.querySelectorAll('#list .row').forEach((r) => r.setAttribute('aria-selected', 'false'));
  renderDetail(); $('#app').dataset.pane = 'detail';
  const t = $('#f-title'); if (t) t.focus();
}
function startEdit(e) {
  const draft = S.vault.draftOf(e);
  S.editing = { draft, isNew: false, base: S.vault.sig(draft) };
  renderDetail(); $('#app').dataset.pane = 'detail';
  const t = $('#f-title'); if (t) { t.focus(); t.select(); }
}
async function leaveEdit() {
  const ed = S.editing;
  if (!ed) return true;
  if (S.vault.sig(ed.draft) !== ed.base) {
    if (!(await confirmBox({ title: 'Discard your changes?', message: 'You have unsaved edits to this entry.', confirmLabel: 'Discard', danger: true }))) return false;
  }
  S.editing = null; renderDetail();
  if (!S.selectedId) $('#app').dataset.pane = 'list';
  return true;
}
function commitEdit() {
  const ed = S.editing, v = S.vault;
  if (!ed) return;
  const d = ed.draft;
  S.editing = null; S.reveal = false;
  if (ed.isNew) {
    const id = v.addEntry(d);
    S.selectedId = id;
    if (S.scope.type === 'group' && S.scope.id !== d.groupId) S.scope = { type: 'group', id: d.groupId };
    else if (S.scope.type === 'tag' || S.scope.type === 'expired') S.scope = { type: 'all' };
    toast('Entry added');
  } else v.updateEntry(d.id, d);
  refresh();
}

function editForm() {
  const v = S.vault, ed = S.editing, d = ed.draft;
  const field = (label, control, id) => h('div', { class: 'field' }, h('label', { htmlFor: id }, label), control);
  const text = (key, id, o = {}) => h('input', { class: 'input' + (o.mono ? ' mono' : ''), id, value: d[key], placeholder: o.ph || '', autocomplete: 'off', spellcheck: false, oninput: (e) => { d[key] = e.target.value; } });

  // password with generator
  const meterBox = h('div', { class: 'pwtools' });
  const updMeter = () => meterBox.replaceChildren(...(d.password ? meterEl(d.password) : []));
  const pw = h('input', { class: 'input mono', id: 'f-pw', type: 'password', value: d.password, autocomplete: 'new-password', spellcheck: false, oninput: (e) => { d.password = e.target.value; updMeter(); } });
  const eye = h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Show password', onclick: () => { const on = pw.type === 'password'; pw.type = on ? 'text' : 'password'; eye.replaceChildren(ic(on ? 'eyeOff' : 'eye')); } }, ic('eye'));
  const genBox = h('div', { class: 'card', hidden: true, style: 'padding:14px;margin:10px 0 0' });
  const dice = h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Generate a password', title: 'Generate a password', onclick: () => {
    genBox.hidden = !genBox.hidden;
    if (!genBox.hidden) genBox.replaceChildren(generatorPanel({ onUse: (p) => { pw.value = p; d.password = p; updMeter(); genBox.hidden = true; pw.type = 'text'; eye.replaceChildren(ic('eyeOff')); } }));
  } }, ic('dice'));
  updMeter();

  const groupSel = h('select', { class: 'input', id: 'f-group', onchange: (e) => { d.groupId = e.target.value; } },
    Array.from(v.walkGroups()).filter((g) => !g.inBin).map((g) => h('option', { value: g.id, selected: g.id === d.groupId }, ' '.repeat(g.depth) + (g.name || 'Untitled group'))));
  const tagList = h('datalist', { id: 'taglist' }, Array.from(v.tags.keys()).map((t) => h('option', { value: t })));
  const tags = h('input', { class: 'input', id: 'f-tags', value: d.tags.join(', '), placeholder: 'work, finance', list: 'taglist', autocomplete: 'off',
    oninput: (e) => { d.tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean); } });

  // expiry
  const dayStr = (dt) => dt ? dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0') : '';
  const date = h('input', { class: 'input', type: 'date', style: 'width:auto', value: dayStr(d.expiry), disabled: !d.expires, 'aria-label': 'Expiry date',
    oninput: (e) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(e.target.value); d.expiry = m ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59) : null; } });
  const exp = h('input', { type: 'checkbox', checked: d.expires, onchange: (e) => {
    d.expires = e.target.checked; date.disabled = !d.expires;
    if (d.expires && !d.expiry) { const t = new Date(); t.setMonth(t.getMonth() + 3); t.setHours(23, 59, 59, 0); d.expiry = t; date.value = dayStr(t); }
  } });

  // custom fields
  const cfBox = h('div', { class: 'form', style: 'gap:8px' });
  const renderCf = () => {
    cfBox.replaceChildren(...d.fields.map((f, i) => h('div', { class: 'cf' },
      h('input', { class: 'input', value: f.key, placeholder: 'Field name', 'aria-label': 'Field name', oninput: (e) => { f.key = e.target.value; } }),
      h('input', { class: 'input' + (f.protected ? ' mono' : ''), type: f.protected ? 'password' : 'text', value: f.value, placeholder: 'Value', 'aria-label': 'Field value', autocomplete: 'off', oninput: (e) => { f.value = e.target.value; } }),
      h('button', { class: 'icon-btn sm' + (f.protected ? ' on' : ''), type: 'button', 'aria-pressed': !!f.protected, title: f.protected ? 'Hidden (click to show)' : 'Visible (click to hide)', 'aria-label': 'Hide value', onclick: () => { f.protected = !f.protected; renderCf(); } }, ic(f.protected ? 'lock' : 'unlock')),
      h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Remove field', onclick: () => { d.fields.splice(i, 1); renderCf(); } }, ic('x')))));
  };
  renderCf();

  // attachments
  const attBox = h('div', { class: 'form', style: 'gap:6px' });
  const renderAtt = () => {
    attBox.replaceChildren(...d.attachments.map((a, i) => h('div', { class: 'filechip' }, ic('clip'), h('div', { class: 'nm' }, h('b', null, a.name), h('small', null, fmtBytes(a.size != null ? a.size : a.data.length))),
      h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Remove attachment', onclick: () => { d.attachments.splice(i, 1); renderAtt(); } }, ic('x')))));
  };
  renderAtt();
  const picker = h('input', { type: 'file', multiple: true, hidden: true, onchange: async (e) => {
    for (const f of Array.from(e.target.files)) {
      if (f.size > 64 * 1048576 && !(await confirmBox({ title: 'Large file', message: f.name + ' is ' + fmtBytes(f.size) + '. Large attachments make the database slow to open. Add it anyway?', confirmLabel: 'Add anyway' }))) continue;
      d.attachments.push({ name: f.name, ref: null, data: new Uint8Array(await f.arrayBuffer()), size: f.size });
    }
    e.target.value = ''; renderAtt();
  } });

  const notes = h('textarea', { class: 'input', id: 'f-notes', spellcheck: true, oninput: (e) => { d.notes = e.target.value; } }, d.notes);

  return h('form', { class: 'detail-inner', onsubmit: (e) => { e.preventDefault(); commitEdit(); } },
    h('div', { class: 'dhead' },
      h('button', { class: 'icon-btn back-narrow', type: 'button', 'aria-label': 'Back', onclick: () => leaveEdit() }, ic('back')),
      h('div', { class: 'ttl' }, h('h1', null, ed.isNew ? 'New entry' : 'Edit entry'))),
    h('div', { class: 'card', style: 'padding:18px' }, h('div', { class: 'form' },
      field('Title', Object.assign(text('title', 'f-title', { ph: 'e.g. GitHub' }), {}), 'f-title'),
      field('Username or email', text('username', 'f-user'), 'f-user'),
      h('div', { class: 'field' }, h('label', { htmlFor: 'f-pw' }, 'Password'), h('div', { class: 'input-wrap' }, pw, h('div', { class: 'tail' }, eye, dice)), meterBox, genBox),
      field('Website', text('url', 'f-url', { ph: 'https://' }), 'f-url'))),
    h('div', { class: 'card', style: 'padding:18px' }, h('div', { class: 'form' }, field('Notes', notes, 'f-notes'))),
    h('div', { class: 'card', style: 'padding:18px' }, h('div', { class: 'form' },
      h('div', { class: 'two' }, field('Group', groupSel, 'f-group'), h('div', { class: 'field' }, h('label', { htmlFor: 'f-tags' }, 'Tags'), tags, tagList)),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Expiry'), h('div', { style: 'display:flex;gap:12px;align-items:center;min-height:38px' }, h('label', { class: 'check' }, exp, 'Expires on'), date)))),
    h('div', { class: 'card', style: 'padding:18px' }, h('div', { class: 'form' },
      h('span', { class: 'lbl' }, 'Custom fields'), cfBox,
      h('button', { class: 'btn sm', type: 'button', style: 'justify-self:start', onclick: () => { d.fields.push({ key: '', value: '', protected: false }); renderCf(); const ins = cfBox.querySelectorAll('.cf'); const last = ins[ins.length - 1]; if (last) last.querySelector('input').focus(); } }, ic('plus'), 'Add field'))),
    h('div', { class: 'card', style: 'padding:18px' }, h('div', { class: 'form' },
      h('span', { class: 'lbl' }, 'Attachments'), attBox, picker,
      h('button', { class: 'btn sm', type: 'button', style: 'justify-self:start', onclick: () => picker.click() }, ic('clip'), 'Add file'))),
    h('div', { class: 'formbar' },
      h('button', { class: 'btn', type: 'button', onclick: () => leaveEdit() }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'submit' }, ic('check'), ed.isNew ? 'Add entry' : 'Save changes')));
}

// ---------------------------------------------------------------------- settings
const cipherName = (id) => id === KDBX.CIPHER_CHACHA ? 'ChaCha20' : id === KDBX.CIPHER_AES ? 'AES-256' : 'Unknown';
function openSettings() {
  const v = S.vault, db = v.db, k = db.kdfInfo;
  const sel = (key, opts, parse) => h('select', { class: 'input', style: 'width:auto', onchange: (e) => { S.set[key] = parse(e.target.value); saveSettings(); } },
    opts.map(([val, lab]) => h('option', { value: val, selected: String(S.set[key]) === String(val) }, lab)));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' }, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([val, lab]) =>
    h('button', { type: 'button', 'aria-pressed': S.set.theme === val, onclick: (e) => { S.set.theme = val; saveSettings(); applyTheme(); renderTheme(); seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === e.currentTarget)); } }, lab)));
  const kdfText = k.name === 'AES-KDF' ? 'AES-KDF · ' + k.rounds.toLocaleString() + ' rounds' : k.name + ' · ' + Math.round(k.memory / 1048576) + ' MiB · ' + k.iterations + ' passes · ' + k.parallelism + ' threads';
  const nameIn = h('input', { class: 'input', value: v.name, style: 'max-width:240px', onchange: (e) => { const n = e.target.value.trim(); if (n && n !== v.name) v.setName(n); } });
  openModal({
    title: 'Settings', wide: true,
    body: [
      h('div', { class: 'setrow' }, h('div', null, h('b', null, 'Appearance'), h('small', null, 'Follows your system by default')), seg),
      h('div', { class: 'setrow' }, h('div', null, h('b', null, 'Auto-lock'), h('small', null, 'Lock after you’ve been away')), sel('autoLock', [[0, 'Never'], [1, '1 minute'], [5, '5 minutes'], [10, '10 minutes'], [30, '30 minutes'], [60, '1 hour']], Number)),
      h('div', { class: 'setrow' }, h('div', null, h('b', null, 'Clear clipboard'), h('small', null, 'After copying a password or code')), sel('clipClear', [[0, 'Never'], [10, '10 seconds'], [20, '20 seconds'], [30, '30 seconds'], [60, '1 minute']], Number)),
      h('div', { class: 'setrow' }, h('div', null, h('b', null, 'Backup before the first save'), h('small', null, 'A copy of the original file, once per session')),
        sel('backupMode', IO.native ? [['ask', 'Ask me'], ['auto', 'Back up next to the file'], ['off', 'Don’t']] : [['ask', 'Ask me'], ['off', 'Don’t']], String)),
      IO.native ? h('div', { class: 'setrow' }, h('div', null, h('b', null, 'Lock when the drive is removed'), h('small', null, 'If your database is on a USB drive and you unplug it')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.set.lockOnRemove, onchange: (e) => { S.set.lockOnRemove = e.target.checked; saveSettings(); } }))) : null,
      IO.native ? h('div', { class: 'setrow' }, h('div', null, h('b', null, 'Hide from screenshots'), h('small', null, 'Blocks screen capture and screen sharing of this window')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.set.hideFromCapture, onchange: (e) => { S.set.hideFromCapture = e.target.checked; saveSettings(); IO.setCapture(e.target.checked); } }))) : null,
      h('hr', { style: 'border:0;border-top:1px solid var(--line);width:100%;margin:2px 0' }),
      h('div', { class: 'setrow' }, h('div', null, h('b', null, 'Database name')), nameIn),
      h('dl', { class: 'kv' },
        h('dt', null, 'File'), h('dd', null, v.fileName), h('dt', null, 'Format'), h('dd', null, 'KDBX ' + db.format.major + '.' + db.format.minor),
        h('dt', null, 'Encryption'), h('dd', null, cipherName(db.cipher)), h('dt', null, 'Key derivation'), h('dd', null, kdfText),
        h('dt', null, 'Contents'), h('dd', null, v.allEntries.length + ' entries · ' + (v.groups.size) + ' groups')),
      h('div', { class: 'setrow' }, h('div', null, h('b', null, 'Master key'), h('small', null, 'Change your password or key file')),
        h('button', { class: 'btn', onclick: () => { changeKeyDialog(); } }, ic('key'), 'Change…')),
      h('div', { class: 'setrow' }, h('div', null, h('b', null, 'Save a copy'), h('small', null, 'Write the database to a new file')),
        h('button', { class: 'btn', onclick: () => saveVault({ asCopy: true }) }, ic('save'), 'Save as…')),
      h('p', { style: 'font-size:12.5px;color:var(--ink-3)' }, 'Keystone 1.0.0 · everything runs on this device with no network access.'),
    ],
    actions: [{ label: 'Done', kind: 'primary' }],
  });
}

async function makeKeyFile() {
  const { rand, sha256, hex } = KDBX.util;
  const key = rand(32), hx = hex(key).toUpperCase(), hash = hex((await sha256(key)).subarray(0, 4)).toUpperCase();
  const g = hx.match(/.{8}/g);
  const xml = '<?xml version="1.0" encoding="utf-8"?>\r\n<KeyFile>\r\n\t<Meta>\r\n\t\t<Version>2.0</Version>\r\n\t</Meta>\r\n\t<Key>\r\n\t\t<Data Hash="' + hash + '">\r\n\t\t\t' +
    g.slice(0, 4).join(' ') + '\r\n\t\t\t' + g.slice(4).join(' ') + '\r\n\t\t</Data>\r\n\t</Key>\r\n</KeyFile>\r\n';
  return new TextEncoder().encode(xml);
}
function changeKeyDialog() {
  const v = S.vault;
  let keyBytes = null, keyName = '';
  const p1 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'New master password', 'data-autofocus': true });
  const p2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Repeat the password' });
  const meterBox = h('div', { class: 'pwtools', style: 'margin:0' });
  p1.addEventListener('input', () => meterBox.replaceChildren(...(p1.value ? meterEl(p1.value) : [])));
  const err = h('div', { class: 'errmsg', hidden: true });
  const keyBox = h('div');
  const showKey = () => keyBox.replaceChildren(keyBytes
    ? h('div', { class: 'filechip' }, ic('key'), h('div', { class: 'nm' }, h('b', null, keyName), h('small', null, 'New key file')), h('button', { class: 'icon-btn sm', type: 'button', onclick: () => { keyBytes = null; showKey(); } }, ic('x')))
    : h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { const p = await IO.pickOpen('key'); if (p) { keyBytes = (await IO.read(p.ref)).bytes; keyName = p.name; showKey(); } } catch (e) { toast(e.message, { error: true }); } } }, ic('key'), 'Choose key file'),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        const bytes = await makeKeyFile();
        try {
          const s = await IO.pickSave('Keystone.keyx', 'key');
          if (s) { await IO.write(s.ref, bytes); keyName = s.name; }
          else if (!IO.canSave) { await IO.download(bytes, 'Keystone.keyx'); keyName = 'Keystone.keyx'; }
          else return;                                   // dialog cancelled
          keyBytes = bytes; showKey(); toast('Key file created — keep it somewhere safe');
        } catch (e) { toast(e.message, { error: true }); }
      } }, ic('plus'), 'Create new key file'),
    ));
  showKey();
  openModal({
    title: 'Change master key',
    body: [
      h('p', null, 'Protect the database with a password, a key file, or both — like in KeePass. It will be re-encrypted with the new key, and the old password and key file stop working once you save.'),
      h('div', { class: 'field' }, h('label', null, 'Password'), p1, meterBox, p2),
      h('div', { class: 'field' }, h('label', null, 'Key file (optional)'), keyBox),
      v.db.keyfileUsed ? h('p', { style: 'font-size:13px' }, 'This database currently uses a key file. Leave this empty to remove it, or pick the file again to keep using it.') : null,
      err,
    ],
    actions: [{ label: 'Cancel' }, { label: 'Change key', kind: 'primary', onClick: async () => {
      const fail = (m) => { err.hidden = false; err.replaceChildren(ic('alert'), h('span', null, m)); return false; };
      if (p1.value !== p2.value) return fail('The two passwords don’t match.');
      if (!p1.value && !keyBytes) return fail('Add a password, a key file, or both.');
      const done = busy('Re-encrypting…');
      try { await KDBX.rekey(v.db, { password: p1.value, keyfile: keyBytes }); v.dirty = true; v.emit(); toast('Master key changed — press Save to apply it'); }
      catch (e) { done(); return fail(e.message); }
      done();
    } }],
  });
}

// ---------------------------------------------------------------------- actions (keyboard shortcuts and the native menu bar share these)
const selectedEntry = () => (S.vault && !S.editing && S.selectedId) ? S.vault.entries.get(S.selectedId) : null;
const ACTIONS = {
  find() { const s = $('#search'); if (s) { s.focus(); s.select(); } },
  save() { saveVault(); },
  lock() { lockVault(); },
  newEntry() { startNewEntry(); },
  settings() { openSettings(); },
  generator() { openGeneratorDialog(); },
  copyUser() { const e = selectedEntry(); if (e && e.username) copyText(e.username, 'Username'); },
  copyPass() { const e = selectedEntry(); if (e && e.password) copyText(e.password, 'Password'); },
  openUrl() { const e = selectedEntry(); const u = e && safeUrl(e.url); if (u) IO.openUrl(u); },
};
function perform(name) {
  if (!S.vault || S.modals.length || !ACTIONS[name]) return;
  const now = Date.now();                                   // a shortcut can arrive as a key press and as a menu event: run it once
  if (S.lastAct === name && now - (S.lastActAt || 0) < 250) return;
  S.lastAct = name; S.lastActAt = now;
  ACTIONS[name]();
}
// a database handed to the app from outside (double-click in Explorer/Finder, "Open with Keystone")
async function handleOpenFile(path) {
  if (S.vault) { toast('Lock Keystone first to open another database'); return; }
  if (!/\.kdbx$/i.test(path)) return;
  await setDbWithKey({ ref: { path }, name: baseName(path), size: 0 });
}

// ---------------------------------------------------------------------- shortcuts, idle lock
document.addEventListener('keydown', (e) => {
  S.idleAt = Date.now();
  if (e.key === 'Escape') {
    if (S.menu) { closeMenu(); return; }
    if (S.modals.length) { const top = S.modals[S.modals.length - 1]; if (top.dismissable) { e.preventDefault(); top.close(); } return; }
    if (S.editing) { e.preventDefault(); leaveEdit(); return; }
    return;
  }
  if (!S.vault || S.modals.length) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  const ae = document.activeElement, inField = !!ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
  const free = !inField && !S.editing && !!selectedEntry();
  const hit = (name, ev) => { ev.preventDefault(); perform(name); };
  if (mod && k === 'f') hit('find', e);
  else if (mod && k === 's') hit('save', e);
  else if (mod && k === 'l') hit('lock', e);
  else if ((e.altKey && k === 'n') || (IS_MAC && e.metaKey && k === 'n')) hit('newEntry', e);
  else if (mod && k === 'enter' && S.editing) { e.preventDefault(); commitEdit(); }
  else if (free && mod && !e.shiftKey && k === 'b') hit('copyUser', e);
  else if (free && mod && k === 'c' && (!e.shiftKey ? !String(window.getSelection()).length : IS_MAC)) hit('copyPass', e);
  else if (free && mod && k === 'u') hit('openUrl', e);
  else if (!inField && !mod && !e.altKey && e.key === '/') hit('find', e);}, true);
['pointerdown', 'pointermove', 'wheel', 'touchstart'].forEach((t) => document.addEventListener(t, () => { S.idleAt = Date.now(); }, { passive: true, capture: true }));
setInterval(() => {
  if (S.vault && S.set.autoLock > 0 && !S.locking && Date.now() - S.idleAt > S.set.autoLock * 60000) {
    S.locking = true;
    lockVault({ auto: true }).finally(() => { S.locking = false; });
  }
}, 5000);
window.addEventListener('beforeunload', (e) => { if (S.vault && S.vault.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------------- boot
async function boot() {
  applyTheme();
  const root = h('div', { id: 'root' });
  document.body.prepend(root);
  renderUnlock();
  if (typeof DecompressionStream === 'undefined' || !crypto.subtle) toast('This browser is too old for Keystone. Please use a current Edge or Chrome.', { error: true, ms: 15000 });
  if (host) {
    host.on('dropped', (list) => handleDrops(list.map((d) => ({ ref: { path: d.path }, name: d.name, size: d.size }))));
    host.on('menu', (d) => perform(d && d.action));                                                           // native menu bar (macOS)
    host.on('openFile', (d) => { if (d && d.path) handleOpenFile(d.path); });
    host.on('sessionLock', () => { if (S.vault) lockVault({ auto: true }); });                          // Windows was locked
    host.on('closeRequested', async () => { if (!S.vault || (await lockVault({ closing: true }))) IO.quit(); else IO.closeCancelled(); });   // window close button
    host.on('drivesChanged', async () => {                                                                  // a drive was plugged in or removed
      if (!S.vault) { discover(); return; }
      if (S.set.lockOnRemove && S.vault.ref && S.vault.ref.path && !(await IO.stat(S.vault.ref))) lockVault({ auto: true }).then(() => discover());
    });
    window.addEventListener('focus', () => { if (IO.native && !S.vault && Date.now() - (S.lastDiscover || 0) > 3000) discover(); });
    IO.setCapture(S.set.hideFromCapture);
  }
  if (IO.native) {
    const file = (await IO.launchArgs()).find((a) => /\.kdbx$/i.test(a));
    if (file) await setDbWithKey({ ref: { path: file }, name: baseName(file), size: 0 });
    await discover();                                                       // remembered database, else whatever is on connected drives
    IO.ready();
  } else {
    const recent = await IO.loadRecent();
    if (recent && !S.unlock.db && !S.vault) { S.unlock.recent = recent; renderUnlock(); }
  }
}
if (location.hash === '#ks-test') window.__ks = { S, KDBX, Vault, Util, IO, host, discover, setDb, setKey, unlockVault, saveVault, lockVault, select, refresh, makeKeyFile, deleteEntry, setScope };
boot();
