/* Vault: an unlocked database as a friendly model (groups, entries) plus every edit operation.
 * The XML document stays the single source of truth so that data Keystone does not understand
 * (custom data, auto-type, colours, ...) survives a save untouched.
 */
const Vault = (() => {
  'use strict';
  const { kids, kid, kidText, parseTime, formatTime, b64, unb64, rand, hex } = KDBX.util;
  const ZERO_UUID = 'AAAAAAAAAAAAAAAAAAAAAA==';
  const STD = ['Title', 'UserName', 'Password', 'URL', 'Notes'];
  const PROTECT_DEFAULT = { Title: false, UserName: false, Password: true, URL: false, Notes: false };
  const newUuid = () => b64(rand(16));

  function mk(doc, name, text, attrs) {
    const e = doc.createElement(name);
    if (text != null) e.textContent = text;
    if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
    return e;
  }
  function setKid(doc, parent, name, text) {
    let k = kid(parent, name);
    if (!k) { k = mk(doc, name); parent.appendChild(k); }
    k.textContent = text;
    return k;
  }
  const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/\r\n?/g, '\n');
  const sniffMime = (b) => (b[0] === 0x89 && b[1] === 0x50) ? 'image/png' : (b[0] === 0xFF && b[1] === 0xD8) ? 'image/jpeg' : (b[0] === 0x47 && b[1] === 0x49) ? 'image/gif' : null;

  function timesEl(doc, when) {
    const t = formatTime(when);
    const el = mk(doc, 'Times');
    el.append(mk(doc, 'CreationTime', t), mk(doc, 'LastModificationTime', t), mk(doc, 'LastAccessTime', t), mk(doc, 'ExpiryTime', t),
      mk(doc, 'Expires', 'False'), mk(doc, 'UsageCount', '0'), mk(doc, 'LocationChanged', t));
    return el;
  }

  function groupEl(doc, name, icon) {
    const g = mk(doc, 'Group');
    g.append(mk(doc, 'UUID', newUuid()), mk(doc, 'Name', clean(name)), mk(doc, 'Notes'), mk(doc, 'IconID', String(icon == null ? 48 : icon)),
      timesEl(doc, new Date()), mk(doc, 'IsExpanded', 'True'), mk(doc, 'DefaultAutoTypeSequence'), mk(doc, 'EnableAutoType', 'null'),
      mk(doc, 'EnableSearching', 'null'), mk(doc, 'LastTopVisibleEntry', ZERO_UUID));
    return g;
  }

  class Vault {
    // The XML of an empty database: a root group called `name` with the given sub-groups. Returns { doc, groupIds }.
    static newDocument(name, groupNames) {
      const t = formatTime(new Date());
      const doc = new DOMParser().parseFromString('<KeePassFile><Meta></Meta><Root></Root></KeePassFile>', 'application/xml');
      const meta = doc.documentElement.firstElementChild, root = doc.documentElement.lastElementChild;
      const m = (n, v) => meta.appendChild(mk(doc, n, v));
      m('Generator', 'Keystone'); m('DatabaseName', clean(name)); m('DatabaseNameChanged', t); m('DatabaseDescription', ''); m('DatabaseDescriptionChanged', t);
      m('DefaultUserName', ''); m('DefaultUserNameChanged', t); m('MaintenanceHistoryDays', '365'); m('Color', '');
      m('MasterKeyChanged', t); m('MasterKeyChangeRec', '-1'); m('MasterKeyChangeForce', '-1');
      const mp = mk(doc, 'MemoryProtection');
      for (const [k, v] of [['ProtectTitle', 'False'], ['ProtectUserName', 'False'], ['ProtectPassword', 'True'], ['ProtectURL', 'False'], ['ProtectNotes', 'False']]) mp.append(mk(doc, k, v));
      meta.append(mp);
      m('RecycleBinEnabled', 'True'); m('RecycleBinUUID', ZERO_UUID); m('RecycleBinChanged', t);
      m('EntryTemplatesGroup', ZERO_UUID); m('EntryTemplatesGroupChanged', t); m('HistoryMaxItems', '10'); m('HistoryMaxSize', '6291456'); m('SettingsChanged', t);
      const rg = groupEl(doc, name, 49), groupIds = {};
      for (const gn of groupNames) { const g = groupEl(doc, gn, 48); groupIds[gn] = kidText(g, 'UUID'); rg.appendChild(g); }
      root.append(rg, mk(doc, 'DeletedObjects'));
      return { doc, groupIds };
    }

    constructor(db, info) {
      this.db = db;
      this.fileName = info.fileName;
      this.ref = info.ref || null;
      this.sourceBytes = info.bytes;
      this.dirty = false;
      this.listeners = new Set();
      this.build();
    }

    // ------------------------------------------------------------------ model
    get docEl() { return this.db.doc.documentElement; }
    get metaEl() { return kid(this.docEl, 'Meta'); }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit() { for (const fn of this.listeners) fn(); }

    metaProtect(name) {
      const mp = this.metaEl && kid(this.metaEl, 'MemoryProtection');
      const v = mp && kidText(mp, 'Protect' + name);
      return v ? v === 'True' : PROTECT_DEFAULT[name];
    }

    build() {
      const meta = this.metaEl;
      this.name = (meta && kidText(meta, 'DatabaseName')) || this.fileName.replace(/\.kdbx$/i, '');
      this.binId = (meta && kidText(meta, 'RecycleBinUUID')) || ZERO_UUID;
      this.binEnabled = !meta || kidText(meta, 'RecycleBinEnabled') !== 'False';
      this.groups = new Map(); this.entries = new Map(); this.allEntries = []; this.bin = null;
      this.icons = new Map();
      const ci = meta && kid(meta, 'CustomIcons');
      if (ci) for (const ic of kids(ci, 'Icon')) {
        try { const d = unb64(kidText(ic, 'Data')); const m = sniffMime(d); if (m) this.icons.set(kidText(ic, 'UUID'), 'data:' + m + ';base64,' + b64(d)); } catch (e) { /* ignore broken icon */ }
      }
      const rootEl = kid(kid(this.docEl, 'Root'), 'Group');
      this.root = this.buildGroup(rootEl, null, 0);
      this.tags = new Map();
      for (const e of this.allEntries) if (!e.group.inBin) for (const t of e.tags) this.tags.set(t, (this.tags.get(t) || 0) + 1);
      this.expiredCount = this.allEntries.filter((e) => !e.group.inBin && e.expired).length;
    }

    buildGroup(el, parent, depth) {
      const g = {
        id: kidText(el, 'UUID'), el, parent, depth, name: kidText(el, 'Name'), notes: kidText(el, 'Notes'),
        iconId: parseInt(kidText(el, 'IconID'), 10) || 0, customIcon: kidText(el, 'CustomIconUUID'),
        groups: [], entries: [], total: 0,
      };
      g.isRoot = !parent;
      g.isBin = this.binEnabled && g.id === this.binId && g.id !== ZERO_UUID;
      g.inBin = g.isBin || !!(parent && parent.inBin);
      if (g.isBin) this.bin = g;
      this.groups.set(g.id, g);
      for (const c of el.children) {
        if (c.tagName === 'Group') { const sg = this.buildGroup(c, g, depth + 1); g.groups.push(sg); g.total += sg.total; }
        else if (c.tagName === 'Entry') { const e = this.buildEntry(c, g, false); g.entries.push(e); this.entries.set(e.id, e); this.allEntries.push(e); g.total++; }
      }
      return g;
    }

    buildEntry(el, group, isHistory) {
      const e = { id: kidText(el, 'UUID'), el, group, isHistory, std: {}, protect: {}, fields: [], attachments: [], history: [] };
      for (const s of kids(el, 'String')) {
        const key = kidText(s, 'Key'), v = kid(s, 'Value');
        const value = v ? v.textContent : '', prot = !!v && v.getAttribute('Protected') === 'True';
        if (STD.includes(key)) { e.std[key] = value; e.protect[key] = prot; } else e.fields.push({ key, value, protected: prot });
      }
      e.title = e.std.Title || ''; e.username = e.std.UserName || ''; e.password = e.std.Password || '';
      e.url = e.std.URL || ''; e.notes = e.std.Notes || '';
      for (const b of kids(el, 'Binary')) {
        const v = kid(b, 'Value'), ref = v ? parseInt(v.getAttribute('Ref'), 10) : NaN;
        if (this.db.binaries[ref]) e.attachments.push({ name: kidText(b, 'Key'), ref, size: this.db.binaries[ref].data.length });
      }
      e.tags = kidText(el, 'Tags').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
      const t = kid(el, 'Times');
      e.created = parseTime(kidText(t, 'CreationTime')); e.modified = parseTime(kidText(t, 'LastModificationTime'));
      e.accessed = parseTime(kidText(t, 'LastAccessTime')); e.expires = kidText(t, 'Expires') === 'True';
      e.expiry = parseTime(kidText(t, 'ExpiryTime'));
      e.expired = e.expires && !!e.expiry && e.expiry.getTime() < Date.now();
      e.iconId = parseInt(kidText(el, 'IconID'), 10) || 0; e.customIcon = kidText(el, 'CustomIconUUID');
      if (!isHistory) {
        const h = kid(el, 'History');
        if (h) e.history = kids(h, 'Entry').map((he) => this.buildEntry(he, group, true)).sort((a, b) => (b.modified || 0) - (a.modified || 0));
        e.hasTotp = !!Util.totpConfig(e.fields);
      }
      return e;
    }

    path(group) { const p = []; for (let g = group; g && !g.isRoot; g = g.parent) p.unshift(g.name); return p; }
    iconFor(x) { return x.customIcon && this.icons.get(x.customIcon) || null; }
    attachmentData(att) { return this.db.binaries[att.ref].data; }

    // ------------------------------------------------------------------ queries
    *walkGroups(g = this.root) { yield g; for (const c of g.groups) yield* this.walkGroups(c); }
    entriesIn(group) { const out = []; const rec = (g) => { out.push(...g.entries); g.groups.forEach(rec); }; rec(group); return out; }

    list(scope, query, sort) {
      let items;
      if (query && query.trim()) items = this.search(query, scope);
      else if (scope.type === 'group') items = this.entriesIn(this.groups.get(scope.id) || this.root);
      else if (scope.type === 'tag') items = this.allEntries.filter((e) => !e.group.inBin && e.tags.includes(scope.tag));
      else if (scope.type === 'expired') items = this.allEntries.filter((e) => !e.group.inBin && e.expired);
      else if (scope.type === 'bin') items = this.bin ? this.entriesIn(this.bin) : [];
      else items = this.allEntries.filter((e) => !e.group.inBin);
      const by = sort || 'title';
      const cmp = by === 'modified' ? (a, b) => (b.modified || 0) - (a.modified || 0)
        : by === 'created' ? (a, b) => (b.created || 0) - (a.created || 0)
          : (a, b) => (a.title || '~').localeCompare(b.title || '~', undefined, { sensitivity: 'base', numeric: true });
      return items.slice().sort(cmp);
    }

    search(query, scope) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const inBin = scope && scope.type === 'bin';
      return this.allEntries.filter((e) => {
        if (e.group.inBin !== !!inBin) return false;
        const hay = (e.title + '\n' + e.username + '\n' + e.url + '\n' + e.notes + '\n' + e.tags.join(' ') + '\n' +
          e.fields.map((f) => f.key + ' ' + (f.protected ? '' : f.value)).join('\n') + '\n' + e.group.name + '\n' +
          e.attachments.map((a) => a.name).join(' ')).toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    }

    // ------------------------------------------------------------------ plumbing
    mutate(fn) { fn(); this.dirty = true; this.build(); this.emit(); }
    touch(el, { modified = true } = {}) {
      const t = kid(el, 'Times') || el.appendChild(mk(this.db.doc, 'Times'));
      const stamp = formatTime(new Date());
      if (modified) setKid(this.db.doc, t, 'LastModificationTime', stamp);
      setKid(this.db.doc, t, 'LastAccessTime', stamp);
    }
    stamp(el, name) { setKid(this.db.doc, kid(el, 'Times') || el.appendChild(mk(this.db.doc, 'Times')), name, formatTime(new Date())); }

    // ------------------------------------------------------------------ entries
    emptyDraft(groupId) {
      return { id: null, title: '', username: '', password: '', url: '', notes: '', tags: [], fields: [], attachments: [], expires: false, expiry: null, groupId: groupId || this.root.id };
    }
    draftOf(e) {
      return {
        id: e.id, title: e.title, username: e.username, password: e.password, url: e.url, notes: e.notes, tags: e.tags.slice(),
        fields: e.fields.map((f) => ({ key: f.key, value: f.value, protected: f.protected })),
        attachments: e.attachments.map((a) => ({ name: a.name, ref: a.ref, size: a.size })),
        expires: e.expires, expiry: e.expiry, groupId: e.group.id,
      };
    }
    sig(x) {
      return JSON.stringify([x.title, x.username, x.password, x.url, x.notes, x.tags, x.fields.map((f) => [f.key, f.value, !!f.protected]),
        x.attachments.map((a) => [a.name, a.ref == null ? 'new' : a.ref]), !!x.expires, x.expires && x.expiry ? +x.expiry : 0]);
    }

    writeEntry(el, d, prot) {
      const doc = this.db.doc;
      for (const s of kids(el, 'String')) el.removeChild(s);
      for (const b of kids(el, 'Binary')) el.removeChild(b);
      const anchor = ['AutoType', 'History'].map((n) => kid(el, n)).find(Boolean) || null;
      const put = (n) => el.insertBefore(n, anchor);
      const str = (key, value, protectIt) => {
        const s = mk(doc, 'String');
        s.append(mk(doc, 'Key', key), mk(doc, 'Value', clean(value), protectIt ? { Protected: 'True' } : null));
        put(s);
      };
      const vals = { Title: d.title, UserName: d.username, Password: d.password, URL: d.url, Notes: d.notes };
      for (const k of STD) str(k, vals[k], k in prot ? prot[k] : this.metaProtect(k));
      for (const f of d.fields) if (f.key.trim()) str(clean(f.key).trim(), f.value, f.protected);
      for (const a of d.attachments) {
        let ref = a.ref;
        if (ref == null) { ref = this.db.binaries.length; this.db.binaries.push({ protect: false, data: a.data }); a.ref = ref; }
        const b = mk(doc, 'Binary');
        b.append(mk(doc, 'Key', clean(a.name)), mk(doc, 'Value', null, { Ref: String(ref) }));
        put(b);
      }
      const tags = d.tags.map((t) => clean(t).replace(/[;,]/g, ' ').trim()).filter(Boolean);
      let te = kid(el, 'Tags');
      if (!te) { te = mk(doc, 'Tags'); el.insertBefore(te, kid(el, 'Times')); }
      te.textContent = tags.join(';');
      const times = kid(el, 'Times');
      setKid(doc, times, 'Expires', d.expires ? 'True' : 'False');
      setKid(doc, times, 'ExpiryTime', formatTime(d.expires && d.expiry ? d.expiry : new Date()));
    }

    pushHistory(el) {
      const doc = this.db.doc;
      const snap = el.cloneNode(true);
      const old = kid(snap, 'History');
      if (old) snap.removeChild(old);
      let h = kid(el, 'History');
      if (!h) { h = mk(doc, 'History'); el.appendChild(h); }
      h.appendChild(snap);
      const max = parseInt(kidText(this.metaEl, 'HistoryMaxItems'), 10);
      const limit = Number.isFinite(max) && max >= 0 ? max : 10;
      while (kids(h, 'Entry').length > limit) h.removeChild(kids(h, 'Entry')[0]);
    }

    addEntry(d) {
      let id;
      this.mutate(() => {
        const doc = this.db.doc;
        const el = mk(doc, 'Entry');
        id = newUuid();
        el.append(mk(doc, 'UUID', id), mk(doc, 'IconID', '0'), mk(doc, 'ForegroundColor'), mk(doc, 'BackgroundColor'), mk(doc, 'OverrideURL'),
          mk(doc, 'Tags'), timesEl(doc, new Date()));
        const at = mk(doc, 'AutoType');
        at.append(mk(doc, 'Enabled', 'True'), mk(doc, 'DataTransferObfuscation', '0'));
        el.appendChild(at);
        this.writeEntry(el, d, {});
        (this.groups.get(d.groupId) || this.root).el.appendChild(el);
      });
      return id;
    }

    updateEntry(id, d) {
      const e = this.entries.get(id);
      if (!e) return;
      this.mutate(() => {
        const changed = this.sig(this.draftOf(e)) !== this.sig(d);
        if (changed) {
          this.pushHistory(e.el);
          this.writeEntry(e.el, d, e.protect);
          this.touch(e.el);
        }
        if (d.groupId && d.groupId !== e.group.id && this.groups.get(d.groupId)) this.moveEl(e.el, this.groups.get(d.groupId).el);
      });
    }

    moveEl(el, targetEl) {
      targetEl.appendChild(el);
      this.stamp(el, 'LocationChanged');
    }
    moveEntry(id, groupId) {
      const e = this.entries.get(id), g = this.groups.get(groupId);
      if (e && g && e.group !== g) this.mutate(() => this.moveEl(e.el, g.el));
    }

    restoreVersion(id, index) {
      const e = this.entries.get(id);
      if (!e || !e.history[index]) return;
      const d = this.draftOf(e.history[index]);
      d.id = id; d.groupId = e.group.id;
      this.updateEntry(id, d);
    }

    ensureBin() {
      if (this.bin) return this.bin.el;
      const doc = this.db.doc;
      const g = this.newGroupEl('Recycle Bin', 43);
      kid(g, 'EnableAutoType').textContent = 'false';
      kid(g, 'EnableSearching').textContent = 'false';
      this.root.el.appendChild(g);
      const meta = this.metaEl;
      setKid(doc, meta, 'RecycleBinEnabled', 'True');
      setKid(doc, meta, 'RecycleBinUUID', kidText(g, 'UUID'));
      setKid(doc, meta, 'RecycleBinChanged', formatTime(new Date()));
      this.binId = kidText(g, 'UUID');
      return g;
    }

    recordDeletion(el) {
      const doc = this.db.doc;
      const rootEl = kid(this.docEl, 'Root');
      let list = kid(rootEl, 'DeletedObjects');
      if (!list) { list = mk(doc, 'DeletedObjects'); rootEl.appendChild(list); }
      const when = formatTime(new Date());
      const add = (x) => { const d = mk(doc, 'DeletedObject'); d.append(mk(doc, 'UUID', kidText(x, 'UUID')), mk(doc, 'DeletionTime', when)); list.appendChild(d); };
      add(el);
      for (const sub of el.querySelectorAll('Entry, Group')) if (!sub.parentElement || sub.parentElement.tagName !== 'History') add(sub);
    }

    // Moves to the recycle bin; entries already in the bin are deleted for good.
    deleteEntry(id) {
      const e = this.entries.get(id);
      if (!e) return;
      this.mutate(() => {
        if (e.group.inBin || !this.binEnabled) { this.recordDeletion(e.el); e.el.parentNode.removeChild(e.el); }
        else this.moveEl(e.el, this.ensureBin());
      });
    }

    emptyBin() {
      if (!this.bin) return;
      this.mutate(() => {
        for (const c of Array.from(this.bin.el.children)) if (c.tagName === 'Entry' || c.tagName === 'Group') { this.recordDeletion(c); this.bin.el.removeChild(c); }
      });
    }

    // ------------------------------------------------------------------ groups
    newGroupEl(name, icon) { return groupEl(this.db.doc, name, icon); }
    addGroup(parentId, name) {
      let id;
      this.mutate(() => { const g = this.newGroupEl(name); id = kidText(g, 'UUID'); (this.groups.get(parentId) || this.root).el.appendChild(g); });
      return id;
    }
    renameGroup(id, name) {
      const g = this.groups.get(id);
      if (g) this.mutate(() => { setKid(this.db.doc, g.el, 'Name', clean(name)); this.touch(g.el); });
    }
    moveGroup(id, parentId) {
      const g = this.groups.get(id), p = this.groups.get(parentId);
      if (!g || !p || g.isRoot || g === p) return false;
      for (let x = p; x; x = x.parent) if (x === g) return false;      // can't move into itself
      this.mutate(() => this.moveEl(g.el, p.el));
      return true;
    }
    deleteGroup(id) {
      const g = this.groups.get(id);
      if (!g || g.isRoot || g.isBin) return;
      this.mutate(() => {
        if (g.inBin || !this.binEnabled) { this.recordDeletion(g.el); g.el.parentNode.removeChild(g.el); }
        else this.moveEl(g.el, this.ensureBin());
      });
    }

    setName(name) { this.mutate(() => setKid(this.db.doc, this.metaEl, 'DatabaseName', clean(name))); }

    // ------------------------------------------------------------------ persistence
    // Drops attachments nothing refers to any more and renumbers the rest.
    compactBinaries() {
      const refs = this.docEl.querySelectorAll('Binary > Value[Ref]');
      const used = Array.from(new Set(Array.from(refs, (v) => parseInt(v.getAttribute('Ref'), 10)))).sort((a, b) => a - b);
      if (used.length === this.db.binaries.length) return;
      const map = new Map(used.map((old, i) => [old, i]));
      for (const v of refs) v.setAttribute('Ref', String(map.get(parseInt(v.getAttribute('Ref'), 10))));
      this.db.binaries = used.map((old) => this.db.binaries[old]);
    }

    // Serialises, then proves the result decrypts back to exactly what is in memory.
    async buildBytes() {
      this.compactBinaries();
      const bytes = await KDBX.serialize(this.db);
      const check = await KDBX.verify(bytes, this.db);
      if (!KDBX.sameContent(this.db, check)) throw new Error('Safety check failed: the data to be saved did not match what is in memory. Nothing was written.');
      return bytes;
    }
    markSaved(bytes) {
      this.sourceBytes = bytes;
      this.dirty = false;
      this.db.format = { major: 4, minor: this.db.format.major === 4 ? this.db.format.minor : 0 };
      this.build();
      this.emit();
    }
  }

  return Vault;
})();
