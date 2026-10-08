/* ===================================================================== Keystone UI — part 3: vault shell, sidebar, list, detail */

S.revealed = new Set();
const sameScope = (a, b) => a.type === b.type && a.id === b.id && a.tag === b.tag;
const isNarrow = () => matchMedia('(max-width: 760px)').matches;

function enterVault() {
  S.scope = { type: 'all' }; S.query = ''; S.selectedId = null; S.editing = null; S.reveal = false; S.revealed.clear();
  S.vault.on(refresh);
  S.idleAt = Date.now();
  renderVault();
}

function renderVault() {
  const v = S.vault, root = $('#root');
  root.replaceChildren();
  document.title = v.name + ' — Keystone';
  const clearBtn = h('button', { class: 'icon-btn sm clear', id: 'searchclear', 'aria-label': 'Clear search', hidden: true, onclick: () => { clearSearch(); $('#search').focus(); } }, ic('x'));
  const search = h('input', {
    id: 'search', type: 'text', placeholder: 'Search everything', autocomplete: 'off', spellcheck: false, 'aria-label': 'Search',
    oninput: (e) => { S.query = e.target.value; clearBtn.hidden = !S.query; queryChanged(); },
    onkeydown: (e) => {
      if (e.key === 'Escape') { clearSearch(); e.target.blur(); }
      else if ((e.key === 'ArrowDown' || e.key === 'Enter') && S.listItems && S.listItems.length) { e.preventDefault(); select(S.selectedId && S.listItems.some((x) => x.id === S.selectedId) ? S.selectedId : S.listItems[0].id, { focusRow: e.key === 'ArrowDown' }); }
    },
  });
  const app = h('div', { class: 'app', id: 'app', 'data-pane': 'list' },
    h('header', { class: 'topbar' },
      h('div', { class: 'lead' }, h('button', { class: 'icon-btn only-narrow', 'aria-label': 'Groups', onclick: () => $('#app').classList.toggle('side-open') }, ic('menu')), logo(), h('b', null, 'Keystone')),
      h('div', { class: 'search' }, ic('search'), search, clearBtn, h('span', { class: 'kbd' }, kbdLabel(SC.find))),
      h('div', { class: 'tools' },
        h('span', { class: 'status', id: 'status' }),
        h('button', { class: 'btn primary sm', id: 'savebtn', hidden: true, onclick: () => saveVault() }, ic('save'), 'Save'),
        h('button', { class: 'icon-btn', id: 'themebtn', 'aria-label': 'Toggle dark mode', title: 'Light / dark', onclick: toggleTheme }),
        h('button', { class: 'icon-btn', id: 'genbtn', 'aria-label': 'Password generator', title: 'Password generator', onclick: openGeneratorDialog }, ic('dice')),
        h('button', { class: 'icon-btn', 'aria-label': 'Settings', title: 'Settings', onclick: openSettings }, ic('sliders')),
        h('button', { class: 'icon-btn', 'aria-label': 'Lock', title: 'Lock (' + SC.lock + ')', onclick: () => lockVault() }, ic('lock')))),
    h('div', { class: 'panes' },
      h('aside', { class: 'side', id: 'side' }), h('section', { class: 'listpane', id: 'listpane' }), h('main', { class: 'detail', id: 'detail', tabIndex: -1 })));
  root.append(app);
  app.addEventListener('pointerdown', (e) => { if ($('#app').classList.contains('side-open') && !e.target.closest('.side') && !e.target.closest('.lead')) $('#app').classList.remove('side-open'); });
  refresh();
}

function toggleTheme() {
  S.set.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  saveSettings(); applyTheme(); renderTheme();
}
function renderTheme() {
  const b = $('#themebtn'); if (b) b.replaceChildren(ic(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'));
}

function refresh() {
  if (!S.vault) return;
  if (S.selectedId && !S.vault.entries.has(S.selectedId)) { S.selectedId = null; S.editing = null; }
  renderTop(); renderSide(); renderList(); renderDetail(true);
}

function renderTop() {
  const v = S.vault;
  document.title = (v.dirty ? '● ' : '') + v.name + ' — Keystone';
  IO.setDirty(v.dirty);
  const st = $('#status'); if (!st) return;
  st.className = 'status' + (v.dirty ? ' dirty' : '');
  st.replaceChildren(h('i', { class: 'dot' }), h('span', null, v.dirty ? 'Unsaved changes' : 'All changes saved'));
  $('#savebtn').hidden = !v.dirty;
  renderTheme();
}

function clearSearch() { S.query = ''; const s = $('#search'); if (s) s.value = ''; const c = $('#searchclear'); if (c) c.hidden = true; queryChanged(); }
function queryChanged() {
  renderList();
  if (S.selectedId && !S.listItems.some((x) => x.id === S.selectedId)) { S.selectedId = null; S.editing = null; renderDetail(); }
}

function setScope(scope) {
  if (S.editing) { leaveEdit().then((ok) => { if (ok) setScope(scope); }); return; }
  S.scope = scope;
  if (S.query) { S.query = ''; const s = $('#search'); if (s) s.value = ''; const c = $('#searchclear'); if (c) c.hidden = true; }
  S.editing = null;
  renderSide(); renderList();
  if (S.selectedId && !S.listItems.some((x) => x.id === S.selectedId)) S.selectedId = null;
  renderDetail();
  $('#app').classList.remove('side-open'); $('#app').dataset.pane = 'list';
}

// ---------------------------------------------------------------------- sidebar
function navRow({ icon, label, count, scope, depth = 0, group, chev }) {
  const v = S.vault;
  const cur = sameScope(S.scope, scope) && !S.query;
  const row = h('div', {
    class: 'nav', role: 'button', tabIndex: 0, 'aria-current': cur ? 'true' : null, style: depth ? 'padding-left:' + (8 + depth * 14) + 'px' : null,
    onclick: () => setScope(scope),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setScope(scope); } },
  });
  if (chev) {
    row.append(h('button', { class: 'chev ' + (chev.has ? (chev.open ? 'open' : '') : 'none'), tabIndex: -1, 'aria-label': chev.open ? 'Collapse' : 'Expand',
      onclick: (e) => { e.stopPropagation(); if (S.collapsed.has(group.id)) S.collapsed.delete(group.id); else S.collapsed.add(group.id); renderSide(); } }, ic('chevR')));
  }
  row.append(ic(icon), h('span', { class: 'lbl2' }, label), count != null ? h('span', { class: 'count' }, count) : null);
  if (group) {
    row.append(h('button', { class: 'icon-btn sm more', tabIndex: -1, 'aria-label': 'Group options', onclick: (e) => { e.stopPropagation(); groupMenu(e.currentTarget, group); } }, ic('more')));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); groupMenu({ x: e.clientX, y: e.clientY }, group); });
    row.addEventListener('dragover', (e) => { if (S.dragId) { e.preventDefault(); row.classList.add('drop-target'); } });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      e.preventDefault(); row.classList.remove('drop-target');
      if (S.dragId) { const id = S.dragId; S.dragId = null; v.moveEntry(id, group.id); toast('Moved to ' + group.name); }
    });
  }
  return row;
}

function renderSide() {
  const v = S.vault, side = $('#side');
  const keep = $('.side-scroll', side) ? $('.side-scroll', side).scrollTop : 0;
  const scroll = h('div', { class: 'side-scroll' });
  const live = v.allEntries.filter((e) => !e.group.inBin).length;
  scroll.append(navRow({ icon: 'grid', label: 'All items', count: live, scope: { type: 'all' } }));
  if (v.expiredCount) scroll.append(navRow({ icon: 'clock', label: 'Expired', count: v.expiredCount, scope: { type: 'expired' } }));
  scroll.append(h('h4', null, 'Groups'));
  const tree = (g, depth) => {
    if (g.isBin) return;
    const open = !S.collapsed.has(g.id), subs = g.groups.filter((x) => !x.isBin);
    scroll.append(navRow({ icon: 'folder', label: g.name || 'Untitled group', count: g.total, scope: { type: 'group', id: g.id }, depth, group: g, chev: { has: subs.length > 0, open } }));
    if (open) subs.forEach((s) => tree(s, depth + 1));
  };
  tree(v.root, 0);
  if (v.tags.size) {
    scroll.append(h('h4', null, 'Tags'));
    Array.from(v.tags.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([t, n]) => scroll.append(navRow({ icon: 'tag', label: t, count: n, scope: { type: 'tag', tag: t } })));
  }
  if (v.bin) {
    scroll.append(h('h4', null, 'Trash'));
    scroll.append(navRow({ icon: 'trashBin', label: 'Recycle Bin', count: v.bin.total, scope: { type: 'bin' }, group: v.bin }));
  }
  side.replaceChildren(scroll, h('div', { class: 'side-foot' },
    h('button', { class: 'btn ghost sm', style: 'width:100%;justify-content:flex-start', onclick: () => newGroup(currentGroupId()) }, ic('folderPlus'), 'New group')));
  scroll.scrollTop = keep;
}
function currentGroupId() { return S.scope.type === 'group' ? S.scope.id : S.vault.root.id; }

function groupMenu(anchor, g) {
  const v = S.vault;
  if (g.isBin) { openMenu(anchor, [{ label: 'Empty Recycle Bin', icon: 'trash', danger: true, onClick: async () => {
    if (g.total && await confirmBox({ title: 'Empty the Recycle Bin?', message: 'This permanently deletes ' + g.total + (g.total === 1 ? ' item' : ' items') + '. It can’t be undone.', confirmLabel: 'Delete forever', danger: true })) v.emptyBin(); } }]); return; }
  const items = [{ label: 'New subgroup…', icon: 'folderPlus', onClick: () => newGroup(g.id) }, { label: 'New entry here', icon: 'plus', onClick: () => { setScope({ type: 'group', id: g.id }); startNewEntry(); } }];
  if (!g.isRoot) {
    items.push({ label: 'Rename…', icon: 'edit', onClick: async () => { const n = await promptBox({ title: 'Rename group', label: 'Name', value: g.name, confirmLabel: 'Rename' }); if (n) v.renameGroup(g.id, n); } });
    items.push('-', { label: 'Delete group', icon: 'trash', danger: true, onClick: () => deleteGroup(g) });
  } else {
    items.push({ label: 'Rename database…', icon: 'edit', onClick: async () => { const n = await promptBox({ title: 'Rename database', label: 'Name', value: v.name, confirmLabel: 'Rename' }); if (n) v.setName(n); } });
  }
  openMenu(anchor, items);
}
async function newGroup(parentId) {
  const n = await promptBox({ title: 'New group', label: 'Name', placeholder: 'e.g. Family', confirmLabel: 'Create' });
  if (!n) return;
  const id = S.vault.addGroup(parentId, n);
  S.collapsed.delete(parentId);
  setScope({ type: 'group', id });
}
async function deleteGroup(g) {
  const v = S.vault, n = g.total;
  const msg = v.binEnabled && !g.inBin ? '“' + g.name + '” and its ' + n + (n === 1 ? ' item' : ' items') + ' will move to the Recycle Bin.' : '“' + g.name + '” and its ' + n + (n === 1 ? ' item' : ' items') + ' will be deleted permanently.';
  if (!(await confirmBox({ title: 'Delete group?', message: msg, confirmLabel: 'Delete', danger: true }))) return;
  if (S.scope.type === 'group' && v.groups.get(S.scope.id) && (function inside(x) { for (; x; x = x.parent) if (x === g) return true; return false; })(v.groups.get(S.scope.id))) S.scope = { type: 'all' };
  v.deleteGroup(g.id);
}

// ---------------------------------------------------------------------- list
function scopeTitle() {
  const v = S.vault;
  if (S.query) return 'Search results';
  switch (S.scope.type) {
    case 'group': return (v.groups.get(S.scope.id) || v.root).name || 'Untitled group';
    case 'tag': return '#' + S.scope.tag;
    case 'expired': return 'Expired';
    case 'bin': return 'Recycle Bin';
    default: return 'All items';
  }
}

function renderList() {
  const v = S.vault, pane = $('#listpane');
  const keep = $('#list') ? $('#list').scrollTop : 0;
  const items = S.listItems = v.list(S.scope, S.query, S.set.sort);
  const inBin = S.scope.type === 'bin' && !S.query;
  const head = h('div', { class: 'listhead' },
    h('h2', null, scopeTitle(), h('small', null, items.length)),
    h('select', { 'aria-label': 'Sort', title: 'Sort', onchange: (e) => { S.set.sort = e.target.value; saveSettings(); renderList(); } },
      [['title', 'A–Z'], ['modified', 'Recent'], ['created', 'Newest']].map(([val, lab]) => h('option', { value: val, selected: S.set.sort === val }, lab))),
    inBin ? null : h('button', { class: 'icon-btn', 'aria-label': 'New entry', title: 'New entry (' + SC.newEntry + ')', onclick: startNewEntry }, ic('plus')));
  const list = h('div', { class: 'list', id: 'list', role: 'listbox', 'aria-label': 'Entries', onkeydown: listKeys });
  const limit = S.showAll ? Infinity : 400;
  items.slice(0, limit).forEach((e) => list.append(entryRow(e)));
  if (items.length > limit) list.append(h('button', { class: 'btn ghost sm', style: 'margin:8px', onclick: () => { S.showAll = true; renderList(); } }, 'Show all ' + items.length));
  if (!items.length) {
    list.append(S.query
      ? h('div', { class: 'empty' }, ic('search'), h('b', null, 'No matches'), h('p', null, 'Nothing matches “' + S.query + '”. Search looks at titles, usernames, websites, notes and tags.'))
      : inBin ? h('div', { class: 'empty' }, ic('trashBin'), h('b', null, 'Recycle Bin is empty'), h('p', null, 'Deleted items wait here until you empty the bin.'))
        : S.scope.type === 'expired' ? h('div', { class: 'empty' }, ic('clock'), h('b', null, 'Nothing has expired'))
          : h('div', { class: 'empty' }, ic('key'), h('b', null, 'No items here yet'), h('p', null, 'Add your first login to this group.'), h('button', { class: 'btn primary', onclick: startNewEntry }, ic('plus'), 'New entry')));
  }
  pane.replaceChildren(head, list);
  list.scrollTop = keep;
}

function entryRow(e) {
  const sub = e.username || hostOf(e.url);
  const showGroup = S.query || S.scope.type === 'all' || S.scope.type === 'tag' || S.scope.type === 'expired';
  return h('button', {
    class: 'row', role: 'option', 'data-id': e.id, 'aria-selected': e.id === S.selectedId, draggable: true,
    onclick: () => select(e.id),
    ondragstart: (ev) => { S.dragId = e.id; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', displayTitle(e)); ev.currentTarget.classList.add('dragging'); },
    ondragend: (ev) => { S.dragId = null; ev.currentTarget.classList.remove('dragging'); },
  }, avatar(e),
  h('span', { class: 'txt' }, h('span', { class: 't' + (e.title ? '' : ' untitled') }, displayTitle(e)),
    h('span', { class: 's' }, sub, showGroup && !e.group.isRoot ? h('span', { class: 'g' }, (sub ? ' · ' : '') + e.group.name) : null)),
  h('span', { class: 'flags' }, e.expired ? h('span', { class: 'exp', title: 'Expired' }, ic('clock')) : null, e.hasTotp ? ic('shield') : null, e.attachments.length ? ic('clip') : null));
}

function listKeys(ev) {
  const items = S.listItems || [];
  if (!items.length) return;
  const i = items.findIndex((x) => x.id === S.selectedId);
  let n = null;
  if (ev.key === 'ArrowDown') n = Math.min(items.length - 1, i + 1);
  else if (ev.key === 'ArrowUp') n = Math.max(0, i < 0 ? 0 : i - 1);
  else if (ev.key === 'Home') n = 0;
  else if (ev.key === 'End') n = items.length - 1;
  if (n == null) return;
  ev.preventDefault();
  select(items[n].id, { focusRow: true });
}

function select(id, opts = {}) {
  const { focusRow = false } = opts;
  if (S.editing) { leaveEdit().then((ok) => { if (ok) select(id, opts); }); return; }
  S.selectedId = id; S.reveal = false; S.revealed.clear(); S.showAllHist = false;
  document.querySelectorAll('#list .row').forEach((r) => {
    const on = r.dataset.id === id;
    r.setAttribute('aria-selected', on);
    if (on && focusRow) { r.focus(); r.scrollIntoView({ block: 'nearest' }); }
  });
  renderDetail(false);
  $('#app').dataset.pane = 'detail';
  if (focusRow) { const r = Array.from(document.querySelectorAll('#list .row')).find((x) => x.dataset.id === id); if (r) r.focus(); }
}

// ---------------------------------------------------------------------- detail
function colorizePw(pw) {
  const f = document.createDocumentFragment();
  let buf = '', kind = '';
  const flush = () => { if (buf) { f.append(kind ? h('span', { class: kind }, buf) : document.createTextNode(buf)); buf = ''; } };
  for (const ch of pw) {
    const k = /[0-9]/.test(ch) ? 'd' : /[A-Za-z]/.test(ch) ? '' : 's';
    if (k !== kind) { flush(); kind = k; }
    buf += ch;
  }
  flush();
  return f;
}

function copyBtn(getText, what) {
  const b = h('button', { class: 'icon-btn sm', 'aria-label': 'Copy ' + what, title: 'Copy ' + what, onclick: async () => {
    const t = typeof getText === 'function' ? getText() : getText;
    if (await copyText(t, what)) { b.classList.add('done'); b.replaceChildren(ic('check')); setTimeout(() => { b.classList.remove('done'); b.replaceChildren(ic('copy')); }, 1200); }
  } }, ic('copy'));
  return b;
}
function frow(label, value, acts, labelExtra, valueClass) {
  return h('div', { class: 'frow' },
    h('div', { class: 'fb' }, h('div', { class: 'fl' }, label, labelExtra || null), h('div', { class: 'fv ' + (valueClass || '') }, value)),
    acts && acts.length ? h('div', { class: 'acts' }, acts) : null);
}
const meterEl = (pw) => { const s = Util.strength(pw); return [h('span', { class: 'meter', 'data-l': s.level, title: Math.round(s.bits) + ' bits (estimate)' }, h('i'), h('i'), h('i'), h('i')), h('span', { class: 'meter-l' }, s.label)]; };

function renderDetail(keepScroll) {
  clearInterval(S.totpTimer); S.totpTimer = null;
  const d = $('#detail'); if (!d) return;
  const top = keepScroll ? d.scrollTop : 0;
  d.replaceChildren();
  if (S.editing) { d.append(editForm()); d.scrollTop = top; return; }
  const e = S.selectedId && S.vault.entries.get(S.selectedId);
  if (!e) {
    d.append(h('div', { class: 'emptydetail' }, h('div', { class: 'empty' }, ic('shield'), h('b', null, 'Select an item'), h('p', null, 'Pick something from the list to see its details, or add a new entry.'),
      h('div', { class: 'hints' }, h('span', null, 'New entry ', h('span', { class: 'kbd' }, kbdLabel(SC.newEntry))), h('span', null, 'Search ', h('span', { class: 'kbd' }, kbdLabel(SC.find))), h('span', null, 'Copy password ', h('span', { class: 'kbd' }, kbdLabel(SC.copyPass))), h('span', null, 'Copy username ', h('span', { class: 'kbd' }, kbdLabel(SC.copyUser)))))));
    return;
  }
  d.append(entryView(e));
  d.scrollTop = top;
}

function entryView(e) {
  const v = S.vault, inBin = e.group.inBin;
  const wrap = h('div', { class: 'detail-inner' });
  const crumbs = [ic('folder')];
  if (e.group.isRoot) crumbs.push(h('span', null, e.group.name || 'Root'));
  else v.path(e.group).forEach((p, i) => { if (i) crumbs.push(ic('chevR')); crumbs.push(h('span', null, p)); });
  const menu = (anchor) => openMenu(anchor, [
    { label: 'Duplicate', icon: 'copy', onClick: () => duplicateEntry(e) },
    { label: 'Move to group…', icon: 'folder', onClick: () => moveDialog(e) },
    '-', { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteEntry(e) }]);
  wrap.append(h('div', { class: 'dhead' },
    h('button', { class: 'icon-btn back-narrow', 'aria-label': 'Back to list', onclick: () => { $('#app').dataset.pane = 'list'; } }, ic('back')),
    avatar(e, true),
    h('div', { class: 'ttl' }, h('h1', null, displayTitle(e)), h('div', { class: 'crumbs' }, crumbs)),
    h('div', { class: 'dactions' }, inBin
      ? [h('button', { class: 'btn', onclick: () => { v.moveEntry(e.id, v.root.id); toast('Restored to ' + v.root.name); } }, ic('restore'), 'Restore'),
        h('button', { class: 'btn danger', onclick: () => deleteEntry(e) }, ic('trash'), 'Delete')]
      : [h('button', { class: 'btn', onclick: () => startEdit(e) }, ic('edit'), 'Edit'),
        h('button', { class: 'icon-btn', 'aria-label': 'More actions', onclick: (ev) => menu(ev.currentTarget) }, ic('more'))])));
  if (e.expired) wrap.append(h('div', { class: 'banner warn' }, ic('clock'), 'This entry expired on ' + fmtDay(e.expiry) + '.'));
  else if (e.expires && e.expiry) wrap.append(h('div', { class: 'banner info' }, ic('clock'), 'Expires on ' + fmtDay(e.expiry) + '.'));

  // login card
  const rows = [];
  if (e.username) rows.push(frow('Username', e.username, [copyBtn(e.username, 'Username')]));
  if (e.password) {
    const shown = S.reveal;
    rows.push(frow('Password', h('span', { class: 'pw-v' }, shown ? colorizePw(e.password) : '••••••••••••'), [
      h('button', { class: 'icon-btn sm', 'aria-label': shown ? 'Hide password' : 'Show password', title: shown ? 'Hide' : 'Show', onclick: () => { S.reveal = !S.reveal; renderDetail(true); } }, ic(shown ? 'eyeOff' : 'eye')),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Show large', title: 'Show large', onclick: () => bigPassword(e.password) }, ic('zoom')),
      copyBtn(e.password, 'Password')], meterEl(e.password)));
  }
  const cfg = Util.totpConfig(e.fields);
  if (cfg) {
    const code = h('span', { class: 'totp' }, '······');
    const ring = h('span'); ring.innerHTML = '<svg class="ring" viewBox="0 0 26 26"><circle class="bg" cx="13" cy="13" r="10"/><circle class="fg" cx="13" cy="13" r="10" stroke-dasharray="62.83" stroke-dashoffset="0"/></svg>';
    const svg = ring.firstChild;
    const tick = async () => {
      const r = await Util.totpNow(cfg);
      const half = Math.ceil(r.code.length / 2);
      code.textContent = r.code.slice(0, half) + ' ' + r.code.slice(half); code.dataset.raw = r.code;
      svg.querySelector('.fg').style.strokeDashoffset = String(62.83 * (1 - r.remaining / r.period));
      svg.classList.toggle('low', r.remaining <= 5);
    };
    tick(); S.totpTimer = setInterval(tick, 1000);
    rows.push(frow('One-time code', h('span', { style: 'display:inline-flex;align-items:center;gap:12px' }, code, svg), [copyBtn(() => code.dataset.raw || '', 'One-time code')]));
  }
  if (e.url) {
    const href = safeUrl(e.url);
    rows.push(frow('Website', href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, e.url) : e.url,
      [href ? h('a', { class: 'icon-btn sm', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open website', title: 'Open (' + SC.openUrl + ')' }, ic('external')) : null, copyBtn(e.url, 'Website')]));
  }
  if (rows.length) wrap.append(h('div', { class: 'card' }, rows));

  const custom = e.fields.filter((f) => f.value !== '' && !/^(otp|TimeOtp-.*|TOTP (Seed|Settings))$/.test(f.key));
  if (custom.length) wrap.append(h('div', { class: 'card' }, h('h3', null, 'Other fields'), custom.map((f) => {
    const id = e.id + ':' + f.key, shown = !f.protected || S.revealed.has(id);
    return frow(f.key, shown ? (f.protected ? h('span', { class: 'pw-v' }, colorizePw(f.value)) : f.value) : h('span', { class: 'pw-v' }, '••••••••••••'), [
      f.protected ? h('button', { class: 'icon-btn sm', 'aria-label': shown ? 'Hide' : 'Show', onclick: () => { if (S.revealed.has(id)) S.revealed.delete(id); else S.revealed.add(id); renderDetail(true); } }, ic(shown ? 'eyeOff' : 'eye')) : null,
      copyBtn(f.value, f.key)]);
  })));
  if (e.notes) wrap.append(h('div', { class: 'card' }, h('h3', null, 'Notes'), h('div', { class: 'frow' }, h('div', { class: 'fb' }, h('div', { class: 'fv' }, e.notes)))));
  if (e.attachments.length) wrap.append(h('div', { class: 'card' }, h('h3', null, 'Attachments'), e.attachments.map((a) =>
    h('div', { class: 'frow' }, h('div', { class: 'fb att' }, ic('clip'), h('span', null, a.name), h('small', null, fmtBytes(a.size))),
      h('div', { class: 'acts', style: 'opacity:1' }, h('button', { class: 'icon-btn sm', 'aria-label': 'Download ' + a.name, title: 'Download', onclick: async () => { try { if (await IO.download(v.attachmentData(a), a.name || 'attachment')) toast('Saved ' + (a.name || 'attachment')); } catch (e) { toast(e.message, { error: true }); } } }, ic('download')))))));
  if (!rows.length && !custom.length && !e.notes && !e.attachments.length) wrap.append(h('div', { class: 'card' }, h('div', { class: 'frow' }, h('div', { class: 'fb' }, h('div', { class: 'fv empty-v' }, 'Nothing here yet. Press Edit to add details.')))));
  if (e.tags.length) wrap.append(h('div', { class: 'card' }, h('h3', null, 'Tags'), h('div', { class: 'frow' }, h('div', { class: 'chips' }, e.tags.map((t) => h('button', { class: 'chip', onclick: () => setScope({ type: 'tag', tag: t }) }, ic('tag'), t))))));

  wrap.append(h('div', { class: 'card' }, h('h3', null, 'Details'), h('div', { class: 'meta-grid' },
    h('div', null, h('div', { class: 'fl' }, 'Modified'), h('div', { class: 'fv' }, fmtDate(e.modified))),
    h('div', null, h('div', { class: 'fl' }, 'Created'), h('div', { class: 'fv' }, fmtDate(e.created))))));

  if (e.history.length) {
    const shown = S.showAllHist ? e.history : e.history.slice(0, 5);
    wrap.append(h('div', { class: 'card' }, h('h3', null, 'Previous versions · ' + e.history.length),
      shown.map((hv, i) => h('div', { class: 'hist' }, ic('history'), h('div', { class: 'when' }, fmtDate(hv.modified), h('small', null, changedLabels(hv, i === 0 ? e : e.history[i - 1]))),
        h('button', { class: 'btn sm', onclick: () => viewVersion(hv) }, 'View'),
        h('button', { class: 'btn sm', onclick: async () => { if (await confirmBox({ title: 'Restore this version?', message: 'The current version is kept in the history, so you can switch back.', confirmLabel: 'Restore' })) { v.restoreVersion(e.id, e.history.indexOf(hv)); toast('Version restored'); } } }, 'Restore'))),
      e.history.length > 5 && !S.showAllHist ? h('div', { class: 'hist' }, h('button', { class: 'linkbtn', onclick: () => { S.showAllHist = true; renderDetail(true); } }, 'Show all ' + e.history.length)) : null));
  }
  return wrap;
}

function changedLabels(older, newer) {
  const out = [];
  if (older.title !== newer.title) out.push('title');
  if (older.username !== newer.username) out.push('username');
  if (older.password !== newer.password) out.push('password');
  if (older.url !== newer.url) out.push('website');
  if (older.notes !== newer.notes) out.push('notes');
  if (JSON.stringify(older.fields) !== JSON.stringify(newer.fields)) out.push('custom fields');
  if (older.tags.join() !== newer.tags.join()) out.push('tags');
  if (older.attachments.map((a) => a.name).join() !== newer.attachments.map((a) => a.name).join()) out.push('attachments');
  return out.length ? 'Then changed: ' + out.join(', ') : 'Then changed: nothing visible';
}

function viewVersion(hv) {
  let shown = false;
  const pw = h('span', { class: 'pw-v' }, '••••••••••••');
  const eye = h('button', { class: 'icon-btn sm', 'aria-label': 'Show password', onclick: () => { shown = !shown; pw.replaceChildren(shown ? colorizePw(hv.password) : '••••••••••••'); eye.replaceChildren(ic(shown ? 'eyeOff' : 'eye')); } }, ic('eye'));
  const row = (l, val) => h('div', { class: 'field' }, h('label', null, l), h('div', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, val || '—'));
  openModal({ title: 'Version from ' + fmtDate(hv.modified), body: [row('Title', hv.title), row('Username', hv.username),
    h('div', { class: 'field' }, h('label', null, 'Password'), h('div', { style: 'display:flex;align-items:center;gap:8px' }, pw, eye, copyBtn(hv.password, 'Password'))),
    row('Website', hv.url), row('Notes', hv.notes)], actions: [{ label: 'Close', kind: 'primary' }] });
}
function bigPassword(pw) {
  openModal({ title: 'Password', wide: true, body: h('div', { class: 'bigpw' }, colorizePw(pw)), actions: [{ label: 'Close', kind: 'primary' }] });
}

// ---------------------------------------------------------------------- entry actions
function duplicateEntry(e) {
  const v = S.vault, d = v.draftOf(e);
  d.id = null; d.title = (e.title || displayTitle(e)) + ' (copy)';
  const id = v.addEntry(d);
  select(id); toast('Duplicated');
}
function moveDialog(e) {
  const v = S.vault;
  const sel = h('select', { class: 'input', 'data-autofocus': true }, Array.from(v.walkGroups()).filter((g) => !g.inBin).map((g) =>
    h('option', { value: g.id, selected: g === e.group }, ' '.repeat(g.depth) + (g.name || 'Untitled group'))));
  openModal({ title: 'Move to group', body: h('div', { class: 'field' }, h('label', null, 'Group'), sel),
    actions: [{ label: 'Cancel' }, { label: 'Move', kind: 'primary', onClick: () => { v.moveEntry(e.id, sel.value); toast('Moved'); } }] });
}
async function deleteEntry(e) {
  const v = S.vault;
  if (e.group.inBin || !v.binEnabled) {
    if (!(await confirmBox({ title: 'Delete forever?', message: '“' + displayTitle(e) + '” will be permanently deleted. This can’t be undone.', confirmLabel: 'Delete forever', danger: true }))) return;
    v.deleteEntry(e.id); toast('Deleted');
  } else {
    const oldGroup = e.group.id, id = e.id;
    v.deleteEntry(id);
    toast('Moved to Recycle Bin', { icon: 'trash', action: { label: 'Undo', fn: () => { if (v.entries.has(id)) v.moveEntry(id, v.groups.has(oldGroup) ? oldGroup : v.root.id); } } });
  }
}
