const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { Database } = require('../electron/db');
const { createCrm } = require('../electron/crm');
const { createLists } = require('../electron/lists');
const { createZoomChats, parseChat, nameFrom, statesFrom, tagsFrom, fallbackDate } = require('../electron/zoomchats');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zoomchats-'));
async function open() {
  const dir = tmp();
  const db = await new Database(path.join(dir, 'hub.db')).open();
  const crm = createCrm(db);
  return { dir, db, crm, lists: createLists(db, crm, dir), zc: createZoomChats({ db, crm }) };
}

const CHAT = [
  '2026-09-19 18:01:34 From Heidi Scoats Gator CT 714-555-0146 to Everyone:',
  '\tHi all! Looking for deals in OC',
  '2026-09-19 18:02:00 From Greg | Riverton | Utah | 801-910-9713 to Everyone:',
  '\tReplying to "Hi all! Looking..."',
  '\tWelcome Heidi',
  '\tHeidi Scoats Gator CT 714-555-0146:❤️',
  '2026-09-19 18:03:10 From Heidi Scoats Gator CT 714-555-0146 to Everyone:',
  '\tmy card https://s.blinq.me/heidi123 or email heidi@x.com, cell 949-555-0000',
  '2026-09-19 18:04:00 From Read.ai meeting notes to Everyone:',
  '\tRead.ai is taking notes',
].join('\r\n');

test('reads Zoom chat formats and Zoom display names', () => {
  const m = parseChat(CHAT);
  assert.strictEqual(m.length, 4);
  assert.deepStrictEqual(m[1], { date: '2026-09-19', time: '18:02:00', sender: 'Greg | Riverton | Utah | 801-910-9713', text: '(reply) Welcome Heidi' });
  const older = parseChat('18:01:34 From  John Doe  to  Everyone:\n\tHello there\n18:02:00 From John Doe to Everyone: inline msg', { date: '2026-09-20' });
  assert.deepStrictEqual(older.map((x) => [x.date, x.time, x.sender, x.text]), [['2026-09-20', '18:01:34', 'John Doe', 'Hello there'], ['2026-09-20', '18:02:00', 'John Doe', 'inline msg']]);
  const oldest = parseChat('18:01:34\t From  Jane Roe : hi everyone', { date: '2026-09-21' });
  assert.strictEqual(oldest[0].sender, 'Jane Roe');
  assert.strictEqual(oldest[0].text, 'hi everyone');
  assert.strictEqual(fallbackDate('C:/Users/x/Documents/Zoom/2026-09-19 18.00.12 SubTo Call/meeting_saved_chat.txt'), '2026-09-19');
  assert.strictEqual(nameFrom('Heidi Scoats Gator CT 714-555-0146'), 'Heidi Scoats');
  assert.strictEqual(nameFrom('Greg | Riverton | Utah | 801-910-9713'), 'Greg');
  assert.deepStrictEqual(statesFrom('Greg | Riverton | Utah | 801-910-9713'), ['UT']);
  assert.deepStrictEqual(tagsFrom('Heidi Scoats Gator CT SubTo'), ['Gator', 'SubTo']);
});

test('adds chats to the SubTo Directory, recognizes people next time, never duplicates', async () => {
  const { dir, db, crm, zc } = await open();
  const f = path.join(dir, 'chat1.txt');
  fs.writeFileSync(f, CHAT);
  const r = zc.addChats([{ path: f, inferSubto: true }]);
  assert.strictEqual(r.files[0].label, '9/19');
  assert.strictEqual(r.messages, 3); // bot skipped
  assert.deepStrictEqual(r.newContacts.map((c) => [c.name, c.phone, c.state, c.communities]), [['Heidi Scoats', '(714) 555-0146', 'CT', 'Gator'], ['Greg', '(801) 910-9713', 'UT', '']]);
  const heidi = crm.getContact(r.newContacts[0].id);
  assert.strictEqual(heidi.kind, 'network');
  assert.strictEqual(heidi.link, 'https://s.blinq.me/heidi123');
  assert.strictEqual(heidi.communities, 'SubTo; Gator');
  assert.strictEqual(heidi.calls_attended, '9/19');
  assert.deepStrictEqual(r.candidates.find((c) => c.id === heidi.id).items.map((x) => x.value).sort(), ['(949) 555-0000', 'heidi@x.com']);
  // Same file again: nothing new.
  const r2 = zc.addChats([{ path: f }]);
  assert.strictEqual(r2.messages, 0);
  assert.strictEqual(r2.newContacts.length, 0);
  // A new call with the same Zoom name → same person, new call label.
  const f2 = path.join(dir, 'chat2.txt');
  fs.writeFileSync(f2, '2026-09-23 19:00:00 From Heidi Scoats Gator CT 714-555-0146 to Everyone:\n\tBack again!\n');
  const r3 = zc.addChats([{ path: f2, label: '9/23 PM' }]);
  assert.strictEqual(r3.newContacts.length, 0);
  assert.strictEqual(crm.getContact(heidi.id).calls_attended, '9/19, 9/23 PM');
  assert.strictEqual(crm.getContact(heidi.id).activities.filter((a) => a.kind === 'chat').length, 3);
  db.close();
});

test('chats from the MASTER file and the same .txt are not counted twice', async () => {
  const { dir, db, crm, lists, zc } = await open();
  const wb = new ExcelJS.Workbook();
  const add = (n, rows) => { const ws = wb.addWorksheet(n); rows.forEach((x) => ws.addRow(x)); };
  add('Contacts', [['First Name', 'Last Name', 'Blinq Card', 'Phone', 'Email', 'State', 'City / Area', 'Communities', 'Community Basis', 'Calls Attended', 'Role', '# Msgs', 'Comments (what they said)', 'Notes / Flags', 'Contact ID'],
    ['Heidi', 'Scoats', '', '714-555-0146', '', 'CT', '', 'Gator', 'stated', '9/19', '', 1, '', '', 'C0001']]);
  add('Raw Chat Log', [['Call', 'Date', 'Time', 'Sender (as shown in Zoom)', 'Matched Contact', 'Message', 'Contact ID'],
    ['9/19', '2026-09-19', '18:01:34', 'Heidi Scoats Gator CT 714-555-0146', 'Heidi Scoats', 'Hi all! Looking for deals in OC', 'C0001']]);
  add('Zoom Name Map', [['Zoom Name (as displayed)', 'Contact ID', 'Contact'], ['Heidi Scoats Gator CT 714-555-0146', 'C0001', 'Heidi Scoats']]);
  const mf = path.join(dir, 'master.xlsx');
  await wb.xlsx.writeFile(mf);
  const a = await lists.analyze(mf);
  await lists.run({ sheets: a.sheets.map((s) => ({ index: s.index, include: s.include })) });
  const f = path.join(dir, 'chat1.txt');
  fs.writeFileSync(f, CHAT);
  const r = zc.addChats([{ path: f, label: '9/19' }]);
  assert.strictEqual(r.newContacts.map((c) => c.name).join(), 'Greg'); // Heidi recognized from the map
  const heidi = crm.listContacts({ kind: 'network' }).find((c) => c.first_name === 'Heidi');
  assert.strictEqual(crm.getContact(heidi.id).activities.filter((x) => x.kind === 'chat').length, 2); // 1 from MASTER + 1 new
  // Export in the organizer's layout and read it back.
  const out = path.join(dir, 'export.xlsx');
  await zc.exportMaster(out, ExcelJS);
  const back = new ExcelJS.Workbook();
  await back.xlsx.readFile(out);
  assert.deepStrictEqual(back.worksheets.map((w) => w.name), ['Contacts', 'Raw Chat Log', 'Zoom Name Map']);
  assert.strictEqual(back.getWorksheet('Raw Chat Log').rowCount, 4);
  db.close();
});

test('finds duplicates and merges them', async () => {
  const { db, crm, zc } = await open();
  const a = crm.saveContact({ first_name: 'Greg', last_name: 'Dibble', phone: '801-910-9713', kind: 'network' });
  const b = crm.saveContact({ first_name: 'Greg', last_name: '', phone: '(801) 910-9713', email: 'g@d.com', kind: 'network', communities: 'SubTo' });
  db.run("INSERT INTO activities (kind, body, outcome, contact_id) VALUES ('chat', 'hello', 'Zoom call 9/19', ?)", [b.id]);
  db.run('INSERT INTO zoom_names (zoom_name, contact_id) VALUES (?, ?)', ['Greg | Utah', b.id]);
  const groups = zc.duplicates();
  assert.strictEqual(groups.length, 1);
  assert.deepStrictEqual(groups[0].map((c) => c.id), [a.id, b.id]);
  const kept = zc.merge(a.id, b.id);
  assert.strictEqual(kept.email, 'g@d.com');
  assert.strictEqual(kept.communities, 'SubTo');
  assert.strictEqual(kept.calls_attended, '9/19');
  assert.strictEqual(db.get('SELECT contact_id FROM zoom_names').contact_id, a.id);
  assert.strictEqual(crm.getContact(a.id).activities.length, 1);
  assert.throws(() => crm.getContact(b.id));
  db.close();
});
