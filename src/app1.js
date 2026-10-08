/* ===================================================================== Keystone UI — part 1: toolkit */
'use strict';

// ---------------------------------------------------------------------- DOM helper
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (k.startsWith('aria-')) { if (v != null) el.setAttribute(k, String(v)); continue; }
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el && !k.includes('-')) { try { el[k] = v; } catch (e) { el.setAttribute(k, v === true ? '' : v); } }   // e.g. read-only <input list>
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}
const $ = (sel, el = document) => el.querySelector(sel);

const ICONS = {
  lock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 7.6-1.8"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H16"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.7 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  folderPlus: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M12 11v5M9.5 13.5h5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l.9 12a2 2 0 0 0 2 1.8h6.2a2 2 0 0 0 2-1.8L18 7M9 7V4.5h6V7"/>',
  edit: '<path d="M4 20h4L19.2 8.8a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  save: '<path d="M5 3.5h11l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19V5A1.5 1.5 0 0 1 5.5 3.5z"/><path d="M8 3.5V8h7V3.5M8 20.5V14h8v6.5"/>',
  clip: '<path d="M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7L9.2 17.2a1.7 1.7 0 0 1-2.4-2.4L14 7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r=".6"/><circle cx="15" cy="9" r=".6"/><circle cx="9" cy="15" r=".6"/><circle cx="15" cy="15" r=".6"/><circle cx="12" cy="12" r=".6"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  chevD: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  shield: '<path d="M12 3l7.5 2.8v5.9c0 4.7-3.2 7.8-7.5 9.3-4.3-1.5-7.5-4.6-7.5-9.3V5.8z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 8v4.5l3 1.8"/>',
  tag: '<path d="M3 12.5V4.8A1.8 1.8 0 0 1 4.8 3h7.7L21 11.5 12.5 21z"/><circle cx="8" cy="8" r="1.3"/>',
  alert: '<path d="M12 4l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.1"/>',
  file: '<path d="M6 3h8l5 5v12.5a.5.5 0 0 1-.5.5h-12a.5.5 0 0 1-.5-.5z"/><path d="M14 3v5h5"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>',
  trashBin: '<path d="M4 7h16M6 7l.9 12a2 2 0 0 0 2 1.8h6.2a2 2 0 0 0 2-1.8L18 7M9 7V4.5h6V7"/>',
  zoom: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  restore: '<path d="M4 9h11a5 5 0 0 1 0 10H9"/><path d="M8 5L4 9l4 4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/>',
  wifiOff: '<path d="M3 3l18 18"/><path d="M8.5 8.8A12 12 0 0 0 2.5 12M5.6 12.4a8 8 0 0 1 3.5-2M12 20h.01M16 11a8 8 0 0 1 2.5 1.4M19 8a12 12 0 0 1 2.5 2.2"/>',
};
const iconTpl = document.createElement('template');
function ic(name, extra) {
  iconTpl.innerHTML = '<svg class="ic' + (extra ? ' ' + extra : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  return iconTpl.content.firstChild.cloneNode(true);
}
const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M8.2 3h7.6l3.2 18H5zM12 8.8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM11 12.8h2l.6 4.2h-3.2z"/></svg>';
function logo() { const s = h('span', { class: 'logo' }); s.innerHTML = LOGO; return s; }

// ---------------------------------------------------------------------- state + settings
const DEFAULTS = { theme: 'system', autoLock: 10, clipClear: 20, backupMode: 'ask', hideFromCapture: true, lockOnRemove: false, sort: 'title',
  gen: { length: 20, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: false } };
function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem('keystone.settings') || '{}');
    if (raw.askBackup === false && !raw.backupMode) raw.backupMode = 'off';
    return Object.assign({}, DEFAULTS, raw, { gen: Object.assign({}, DEFAULTS.gen, raw.gen || {}) });
  } catch (e) { return Object.assign({}, DEFAULTS, { gen: Object.assign({}, DEFAULTS.gen) }); }
}
function saveSettings() { try { localStorage.setItem('keystone.settings', JSON.stringify(S.set)); } catch (e) { /* storage unavailable */ } }

const S = {
  set: loadSettings(),
  unlock: { db: null, key: null, usePw: true, useKey: false, pw: '', error: null, busy: false, progress: 0, showPw: false, recent: null },
  vault: null, scope: { type: 'all' }, query: '', selectedId: null, editing: null, reveal: false,
  collapsed: new Set(), dragId: null, stamp: null, backupDone: false, idleAt: Date.now(),
  clipTimer: null, clipPending: false, totpTimer: null, modals: [], menu: null,
};

// shortcuts are shown the way the platform writes them
const IS_MAC = /Mac/i.test(navigator.platform || '') || /Mac OS X/.test(navigator.userAgent || '');
const SC = { find: IS_MAC ? '⌘F' : 'Ctrl+F', lock: IS_MAC ? '⌘L' : 'Ctrl+L', save: IS_MAC ? '⌘S' : 'Ctrl+S', newEntry: IS_MAC ? '⌘N' : 'Alt+N',
  copyPass: IS_MAC ? '⇧⌘C' : 'Ctrl+C', copyUser: IS_MAC ? '⌘B' : 'Ctrl+B', openUrl: IS_MAC ? '⌘U' : 'Ctrl+U' };
const kbdLabel = (s) => s.replace('+', ' ');

function applyTheme() {
  const dark = S.set.theme === 'dark' || (S.set.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  IO.setTheme(dark);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------------------------------------------------------------------- formatting
const fmtDate = (d) => d ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d) : '—';
const fmtDay = (d) => d ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d) : '—';
const fmtBytes = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
function hostOf(url) { try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
function safeUrl(url) {
  const u = url.trim();
  if (!u) return null;
  const full = /^[a-z][a-z0-9+.-]*:/i.test(u) && !/^[a-z0-9.-]+:\d+/i.test(u) ? u : 'https://' + u;
  try { const p = new URL(full); return ['http:', 'https:', 'ftp:', 'mailto:'].includes(p.protocol) ? p.href : null; } catch (e) { return null; }
}
function hueOf(s) { let x = 0; for (const c of s) x = (x * 31 + c.codePointAt(0)) >>> 0; return x % 360; }
const displayTitle = (e) => e.title || hostOf(e.url) || e.username || 'Untitled';

function avatar(item, lg) {
  const name = displayTitle(item);
  const a = h('span', { class: 'avatar' + (lg ? ' lg' : ''), style: '--h:' + hueOf(name.toLowerCase()) });
  const icon = S.vault && S.vault.iconFor(item);
  if (icon) a.append(h('img', { src: icon, alt: '' }));
  else a.textContent = (Array.from(name.trim())[0] || '·').toUpperCase();
  return a;
}

// ---------------------------------------------------------------------- toast / busy
function toast(msg, o = {}) {
  let box = $('#toasts');
  if (!box) { box = h('div', { class: 'toasts', id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast' + (o.error ? ' err' : '') }, ic(o.error ? 'alert' : (o.icon || 'check')), h('span', null, msg),
    o.action ? h('button', { onclick: () => { t.remove(); o.action.fn(); } }, o.action.label) : null);
  box.append(t);
  setTimeout(() => t.remove(), o.ms || (o.error ? 7000 : 3200));
  while (box.children.length > 3) box.firstChild.remove();
}
function busy(message) {
  const el = h('div', { class: 'busy' }, h('div', null, h('span', { class: 'spin' }), h('span', null, message)));
  document.body.append(el);
  const done = () => el.remove();
  done.set = (m) => { el.querySelector('div > span:last-child').textContent = m; };     // update the message while it is showing
  return done;
}

// ---------------------------------------------------------------------- menu
function closeMenu() { if (S.menu) { S.menu.remove(); S.menu = null; } }
function openMenu(anchor, items) {
  closeMenu();
  const m = h('div', { class: 'menu', role: 'menu' }, items.map((it) => it === '-' ? h('hr') :
    h('button', { class: it.danger ? 'danger' : '', role: 'menuitem', onclick: () => { closeMenu(); it.onClick(); } }, it.icon ? ic(it.icon) : null, it.label)));
  document.body.append(m);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const w = m.offsetWidth, ht = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  m.style.top = (r.bottom + 4 + ht > innerHeight - 8 ? Math.max(8, r.top - ht - 4) : r.bottom + 4) + 'px';
  S.menu = m;
  const first = m.querySelector('button'); if (first) first.focus();
  m.addEventListener('keydown', (e) => {
    const bs = Array.from(m.querySelectorAll('button')), i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { bs[(i + 1) % bs.length].focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { bs[(i - 1 + bs.length) % bs.length].focus(); e.preventDefault(); }
  });
}
document.addEventListener('pointerdown', (e) => { if (S.menu && !S.menu.contains(e.target)) closeMenu(); }, true);

// ---------------------------------------------------------------------- modal
function openModal({ title, body, actions = [], wide = false, onClose, dismissable = true }) {
  const prev = document.activeElement;
  let primary = null;
  const api = { dismissable };
  const close = (result) => {
    scrim.remove();
    S.modals = S.modals.filter((m) => m !== api);
    if (prev && prev.isConnected && prev.focus) prev.focus();
    if (onClose) onClose(result);
  };
  api.close = close;
  const foot = actions.length ? h('footer', null, actions.map((a) => {
    const b = h('button', { class: 'btn ' + (a.kind || ''), onclick: async () => { const r = a.onClick ? await a.onClick(api) : undefined; if (r !== false) close(a.value); } }, a.label);
    if ((a.kind || '').includes('primary') || (a.kind || '').includes('solid')) primary = b;
    return b;
  })) : null;
  const modal = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', null, h('h2', null, title), dismissable ? h('button', { class: 'icon-btn sm', 'aria-label': 'Close', onclick: () => close() }, ic('x')) : null),
    h('div', { class: 'body' }, body), foot);
  const scrim = h('div', { class: 'scrim', onpointerdown: (e) => { if (e.target === scrim && dismissable) close(); } }, modal);
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range' && primary) { e.preventDefault(); primary.click(); }
    if (e.key === 'Tab') {
      const f = Array.from(modal.querySelectorAll('button,input,select,textarea,[tabindex="0"]')).filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { f[f.length - 1].focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { f[0].focus(); e.preventDefault(); }
    }
  });
  document.body.append(scrim);
  S.modals.push(api);
  (modal.querySelector('[data-autofocus]') || modal.querySelector('input:not([type=checkbox]):not([type=range]),textarea,select') || primary || modal.querySelector('.body button'))?.focus();
  return api;
}
const confirmBox = (o) => new Promise((res) => openModal({
  title: o.title, body: h('p', null, o.message),
  actions: [{ label: o.cancelLabel || 'Cancel', value: false }, { label: o.confirmLabel || 'Confirm', kind: o.danger ? 'danger solid' : 'primary', value: true }],
  onClose: (r) => res(r === true),
}));
const promptBox = (o) => new Promise((res) => {
  const inp = h('input', { class: 'input', value: o.value || '', placeholder: o.placeholder || '', 'data-autofocus': true, maxLength: 200 });
  let out = null;
  openModal({
    title: o.title,
    body: [o.message ? h('p', null, o.message) : null, h('div', { class: 'field' }, o.label ? h('label', null, o.label) : null, inp)],
    actions: [{ label: 'Cancel' }, { label: o.confirmLabel || 'OK', kind: 'primary', onClick: () => { const t = inp.value.trim(); if (!t) { inp.focus(); return false; } out = t; } }],
    onClose: () => res(out),
  });
  inp.select();
});

// ---------------------------------------------------------------------- clipboard (IO decides how; the desktop host clears it reliably)
async function copyText(text, what) {
  if (!(await IO.copy(text, S.set.clipClear))) { toast('Could not access the clipboard', { error: true }); return false; }
  const secs = S.set.clipClear;
  toast(what + ' copied' + (secs > 0 ? ' · clears in ' + secs + 's' : ''));
  return true;
}
function wipeClipboardNow() { IO.wipe(); }