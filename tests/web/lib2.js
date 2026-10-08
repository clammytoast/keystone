// write-path test: open fixture, edit through Vault, save, upload bytes to /out/
window.runWriteTest = async (name, pw, kf, outName) => {
  const bytes = await getBytes('/fx/' + name + '.kdbx');
  const keyfile = kf ? await getBytes('/fx/' + kf) : null;
  const db = await KDBX.open(bytes, { password: pw, keyfile });
  const v = new Vault(db, { fileName: name + '.kdbx', bytes });
  const find = (t) => v.allEntries.find((e) => e.title === t);
  // 1. edit GitHub: new password, new custom field, drop attachment, new attachment, tags
  const gh = find('GitHub');
  const d = v.draftOf(gh);
  d.password = 'NEW p@ss ✓ "quoted" <&>';
  d.fields.push({ key: 'Added field', value: 'secret value', protected: true });
  d.attachments = d.attachments.filter((a) => a.name !== 'hello.txt');
  d.attachments.push({ name: 'new.bin', ref: null, data: new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]) });
  d.tags = ['work', 'edited'];
  v.updateEntry(gh.id, d);
  // 2. new group + new entry inside
  const gid = v.addGroup(v.root.id, 'Brand new group');
  const nd = v.emptyDraft(gid);
  Object.assign(nd, { title: 'Created in Keystone', username: 'u', password: 'pw-created', url: 'https://x.test', notes: 'multi\nline\nnotes' });
  nd.fields.push({ key: 'PIN', value: '0000', protected: true });
  nd.expires = true; nd.expiry = new Date(Date.now() + 86400000 * 30);
  v.addEntry(nd);
  // 3. delete (-> recycle bin) and move
  v.deleteEntry(find('My Bank').id);
  v.moveEntry(find('Mastodon').id, gid);
  // 4. edit an entry without changes -> must not add history
  const before = find('Empty-password entry').history.length;
  v.updateEntry(find('Empty-password entry').id, v.draftOf(find('Empty-password entry')));
  const histUnchanged = find('Empty-password entry').history.length === before;
  const out = await v.buildBytes();
  const r = await fetch('/out/' + outName, { method: 'PUT', body: out });
  // re-open with our own reader from the produced bytes
  const again = await KDBX.open(out, { password: pw, keyfile });
  const same = KDBX.sameContent(db, again);
  const got = await dumpDb(db);
  return { status: r.status, bytes: out.length, histUnchanged, reopenSame: same, dump: got, ghHistory: find('GitHub').history.length };
};
