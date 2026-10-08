window.dumpDb = async (db) => {
  const U = KDBX.util;
  const root = U.kid(U.kid(db.doc.documentElement, 'Root'), 'Group');
  const entries = [], groups = [];
  const strs = (e) => { const f = {}; for (const s of U.kids(e, 'String')) f[U.kidText(s, 'Key')] = U.kid(s, 'Value').textContent; return f; };
  const walk = async (g, path) => {
    const here = path ? path + '/' + U.kidText(g, 'Name') : U.kidText(g, 'Name');
    groups.push(here);
    for (const e of U.kids(g, 'Entry')) {
      const b = {};
      for (const bn of U.kids(e, 'Binary')) { const idx = +U.kid(bn, 'Value').getAttribute('Ref'); const d = db.binaries[idx].data; const h = U.hex(await U.sha256(d)).toUpperCase().slice(0, 16); b[U.kidText(bn, 'Key')] = d.length + ':' + h; }
      const hist = [];
      const hEl = U.kid(e, 'History');
      if (hEl) for (const he of U.kids(hEl, 'Entry')) { const f = strs(he); hist.push((f.Password || '') + '/' + (f.UserName || '')); }
      const tags = (U.kidText(e, 'Tags') || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean).sort();
      entries.push({ path: here, fields: strs(e), binaries: b, tags, history: hist, expires: U.kidText(U.kid(e, 'Times'), 'Expires') === 'True' });
    }
    for (const sg of U.kids(g, 'Group')) await walk(sg, here);
  };
  await walk(root, '');
  return { entries, groups: groups.slice(1) };
};

const norm = (o) => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v);
const ekey = (e) => norm([e.path, e.fields.Title || '', e.fields.UserName || '', e.fields.Password || '']);
window.sameAsExpected = (got, exp) => {
  const problems = [];
  const g = { groups: got.groups.slice().sort(), entries: got.entries.slice().sort((a, b) => ekey(a) < ekey(b) ? -1 : 1) };
  exp = {
    groups: [].concat(exp.groups).sort(),
    entries: [].concat(exp.entries).map((e) => ({ path: e.path, fields: e.fields, binaries: e.binaries, tags: [].concat(e.tags || []).sort(), history: [].concat(e.history || []), expires: e.expires }))
      .sort((a, b) => ekey(a) < ekey(b) ? -1 : 1),
  };
  if (norm(g.groups) !== norm(exp.groups)) problems.push('groups differ: ' + norm(g.groups) + ' vs ' + norm(exp.groups));
  if (g.entries.length !== exp.entries.length) problems.push('entry count ' + g.entries.length + ' vs ' + exp.entries.length);
  for (let i = 0; i < Math.min(g.entries.length, exp.entries.length); i++) {
    if (norm(g.entries[i]) !== norm(exp.entries[i])) problems.push('entry ' + i + ' differs:\n  got ' + norm(g.entries[i]) + '\n  exp ' + norm(exp.entries[i]));
  }
  return problems;
};

window.CASES = [
  ['argon2d-aes-pwkey', 'correct horse', 'test.keyx'],
  ['argon2id-chacha-pw', 'pässwörd-ünï', null],
  ['aeskdf-pw', 'legacy', null],
  ['aeskdf-v3', 'legacy', null],
  ['argon2d-keyonly', '', 'test.keyx'],
  ['keyfile-v1xml', 'pw', 'v1.xml.key'],
  ['keyfile-arbitrary', 'pw', 'arbitrary.key'],
  ['argon2d-default', 'correct horse', 'test.keyx'],
];

window.runOpenTests = async (only) => {
  const results = {};
  for (const [name, pw, kf] of window.CASES) {
    if (only && !only.includes(name)) continue;
    const t0 = performance.now();
    try {
      const bytes = await getBytes('/fx/' + name + '.kdbx');
      const keyfile = kf ? await getBytes('/fx/' + kf) : null;
      const db = await KDBX.open(bytes, { password: pw, keyfile });
      const exp = await (await fetch('/fx/' + name + '.expected.json')).json();
      const probs = sameAsExpected(await dumpDb(db), exp);
      results[name] = (probs.length ? 'FAIL ' + probs.join(' | ') : 'ok') + ' [' + db.format.major + '.' + db.format.minor + ' ' + db.kdfInfo.name + (db.kdfInfo.memory ? ' ' + Math.round(db.kdfInfo.memory / 1048576) + 'MiB x' + db.kdfInfo.iterations : '') + ' ' + Math.round(performance.now() - t0) + 'ms]';
    } catch (e) { results[name] = 'ERROR ' + e.code + ' ' + e.message + ' ' + (e.stack || '').split('\n')[1]; }
  }
  return results;
};
