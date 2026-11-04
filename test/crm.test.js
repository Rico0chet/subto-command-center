const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Database } = require('../electron/db');
const C = require('../electron/crm');
const { readTable } = require('../electron/sheets');

const fresh = async () => {
  const db = await new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crm-')), 'hub.db')).open();
  return { db, crm: C.createCrm(db) };
};

test('phone numbers are tidied and made dialable', () => {
  assert.strictEqual(C.formatPhone('512.555.0142'), '(512) 555-0142');
  assert.strictEqual(C.formatPhone('+1 512 555 0142'), '(512) 555-0142');
  assert.strictEqual(C.formatPhone('ext 22'), 'ext 22');
  assert.strictEqual(C.dialable('(512) 555-0142'), '+15125550142');
  assert.strictEqual(C.dialable('15125550142'), '+15125550142');
  assert.strictEqual(C.dialable('555-0142'), null);
});

test('contacts: save, edit, search by name/phone/tag, delete', async () => {
  const { db, crm } = await fresh();
  const maria = crm.saveContact({ first_name: 'Maria', last_name: 'Lopez', role: 'Agent', phone: '512-555-0142', tags: 'Austin, expired listings, Austin' });
  assert.strictEqual(maria.phone, '(512) 555-0142');
  assert.strictEqual(maria.tags, 'Austin, expired listings');
  crm.saveContact({ company: 'Lone Star Title', role: 'Title / Attorney', email: 'Closer@LoneStar.com' });
  assert.strictEqual(crm.listContacts({ q: 'maria' }).length, 1);
  assert.strictEqual(crm.listContacts({ q: '5550142' }).length, 1);
  assert.strictEqual(crm.listContacts({ tag: 'Austin' }).length, 1);
  assert.strictEqual(crm.listContacts({ role: 'Title / Attorney' })[0].email, 'closer@lonestar.com');
  const edited = crm.saveContact({ ...maria, role: 'JV Partner' });
  assert.strictEqual(edited.role, 'JV Partner');
  assert.deepStrictEqual(crm.allTags(), ['Austin', 'expired listings']);
  assert.throws(() => crm.saveContact({ notes: 'no name' }), /at least/);
  crm.deleteContact(maria.id);
  assert.strictEqual(crm.listContacts().length, 1);
  db.close();
});

test('deals: create, numbers parsed, move between stages with history, order within a column', async () => {
  const { db, crm } = await fresh();
  const a = crm.saveDeal({ address: '123 Main St', city: 'Austin', state: 'tx', asking_price: '$245,000', interest_rate: '3.1%', piti: '1,420' });
  assert.strictEqual(a.stage, 'Lead');
  assert.strictEqual(a.asking_price, 245000);
  assert.strictEqual(a.interest_rate, 3.1);
  assert.strictEqual(a.title, '123 Main St, Austin, TX');
  const b = crm.saveDeal({ address: '9 Oak Ln' });
  const c = crm.saveDeal({ address: '5 Elm Ct' });
  crm.moveDeal(c.id, 'Lead', a.id); // put c before a
  assert.deepStrictEqual(crm.listDeals().map((d) => d.id), [c.id, a.id, b.id]);
  const moved = crm.moveDeal(a.id, 'Under Contract');
  assert.strictEqual(moved.stage, 'Under Contract');
  assert.match(moved.activities[0].body, /Lead → Under Contract/);
  crm.moveDeal(b.id, 'Dead');
  assert.ok(!crm.listDeals().some((d) => d.id === b.id));
  assert.ok(crm.listDeals({ includeDead: true }).some((d) => d.id === b.id));
  assert.throws(() => crm.moveDeal(a.id, 'Nope'), /Unknown stage/);
  assert.throws(() => crm.saveDeal({ notes: 'x' }), /address/);
  db.close();
});

test('contacts link to deals; logging an offer moves the deal to Offer Sent', async () => {
  const { db, crm } = await fresh();
  const seller = crm.saveContact({ first_name: 'Dave', role: 'Seller', phone: '2145550199' });
  const deal = crm.saveDeal({ address: '77 Ranch Rd', stage: 'Talking' });
  crm.linkContact(deal.id, seller.id, 'Seller');
  assert.strictEqual(crm.getDeal(deal.id).contacts[0].name, 'Dave');
  assert.strictEqual(crm.getContact(seller.id).deals[0].id, deal.id);
  crm.logActivity({ kind: 'call', outcome: 'Talked', body: 'Open to terms', deal_id: deal.id, contact_id: seller.id });
  crm.logActivity({ kind: 'offer', body: 'Sub-to, $10k entry', deal_id: deal.id });
  const d = crm.getDeal(deal.id);
  assert.strictEqual(d.stage, 'Offer Sent');
  assert.deepStrictEqual(d.activities.map((x) => x.kind), ['stage', 'offer', 'call']);
  assert.throws(() => crm.logActivity({ kind: 'call', deal_id: deal.id }), /Write something/);
  crm.unlinkContact(deal.id, seller.id);
  assert.strictEqual(crm.getDeal(deal.id).contacts.length, 0);
  db.close();
});

test('tasks: due today / overdue, done, linked names, deleting a deal keeps its tasks', async () => {
  const { db, crm } = await fresh();
  const deal = crm.saveDeal({ address: '1 Pine' });
  const ymd = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const t1 = crm.saveTask({ title: 'Send offer', due_date: ymd(-1), deal_id: deal.id, priority: 'High' });
  crm.saveTask({ title: 'Call title co', due_date: ymd(0) });
  crm.saveTask({ title: 'Later', due_date: ymd(5) });
  crm.saveTask({ title: 'Someday' });
  const due = crm.dueToday();
  assert.strictEqual(due.tasks.length, 2);
  assert.strictEqual(due.overdueTasks, 1);
  assert.strictEqual(due.tasks[0].deal_title, '1 Pine');
  crm.setTaskDone(t1, true);
  assert.strictEqual(crm.dueToday().tasks.length, 1);
  crm.deleteDeal(deal.id);
  assert.strictEqual(crm.listTasks({ includeDone: true }).length, 4);
  assert.throws(() => crm.saveTask({ title: ' ' }), /name/);
  db.close();
});

test('follow-ups due show on today list; weekly numbers count calls, talks, offers and contracts', async () => {
  const { db, crm } = await fresh();
  const d = crm.saveDeal({ address: '2 Birch', next_follow_up: '2020-01-01' });
  crm.saveDeal({ address: '3 Cedar', next_follow_up: '2999-01-01' });
  assert.deepStrictEqual(crm.dueToday().followUps.map((x) => x.id), [d.id]);
  assert.ok(crm.dueToday().followUps[0].overdue);
  crm.logActivity({ kind: 'call', outcome: 'No answer', deal_id: d.id });
  crm.logActivity({ kind: 'call', outcome: 'Talked', deal_id: d.id });
  crm.logActivity({ kind: 'offer', body: 'x', deal_id: d.id });
  crm.moveDeal(d.id, 'Under Contract');
  const w = crm.weeklyNumbers();
  assert.deepStrictEqual([w.calls, w.conversations, w.offers, w.contracts], [2, 1, 1, 1]);
  assert.strictEqual(crm.pipelineCounts()['Under Contract'], 1);
  db.close();
});

test('import: guesses columns, splits full names, skips duplicates and blank rows, saves once', async () => {
  const { db, crm } = await fresh();
  crm.saveContact({ first_name: 'Existing', phone: '(512) 555-0100' });
  const headers = ['Owner Name', 'Property Address', 'Phone 1', 'Phone 2', 'Email'];
  const map = C.guessMapping(headers);
  assert.deepStrictEqual(map, { first_name: '', last_name: '', full_name: 'Owner Name', company: '', phone: 'Phone 1', email: 'Email', address: 'Property Address', notes: '', phone2: 'Phone 2' });
  const rows = [
    { 'Owner Name': 'John Q Public', 'Property Address': '10 A St', 'Phone 1': '512-555-0101', 'Phone 2': '', Email: '' },
    { 'Owner Name': 'Dup Person', 'Property Address': '', 'Phone 1': '5125550100', 'Phone 2': '', Email: '' },
    { 'Owner Name': '', 'Property Address': '', 'Phone 1': '', 'Phone 2': '', Email: '' },
    { 'Owner Name': 'Jane Roe', 'Property Address': '', 'Phone 1': '', 'Phone 2': '', Email: 'JANE@x.com' },
  ];
  const r = crm.importContacts(rows, map, { role: 'Seller', tags: 'MF List' });
  assert.deepStrictEqual(r, { added: 2, skipped: 1, empty: 1 });
  const john = crm.listContacts({ q: 'John' })[0];
  assert.deepStrictEqual([john.first_name, john.last_name, john.role, john.tags, john.phone], ['John', 'Q Public', 'Seller', 'MF List', '(512) 555-0101']);
  db.close();
});

test('CSV and Excel files are read into rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-'));
  const csv = path.join(dir, 'agents.csv');
  fs.writeFileSync(csv, '﻿First Name,Last Name,Mobile,Notes\r\nAna,Diaz,512-555-0111,"likes ""terms"", call AM"\r\n,,,\r\nBo,Li,5125550112,"two\nlines"\r\n');
  const t = await readTable(csv);
  assert.deepStrictEqual(t.sheets[0].headers, ['First Name', 'Last Name', 'Mobile', 'Notes']);
  assert.strictEqual(t.sheets[0].total, 2);
  assert.strictEqual(t.sheets[0].rows[0].Notes, 'likes "terms", call AM');
  assert.strictEqual(C.guessMapping(t.sheets[0].headers).phone, 'Mobile');

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Texas');
  ws.addRow(['Owner First Name', 'Owner Last Name', 'Wireless 1', 'Email']);
  ws.addRow(['Cal', 'Ng', 2145550177, { text: 'cal@ng.com', hyperlink: 'mailto:cal@ng.com' }]);
  const xlsx = path.join(dir, 'list.xlsx');
  await wb.xlsx.writeFile(xlsx);
  const x = await readTable(xlsx);
  assert.strictEqual(x.sheets[0].name, 'Texas');
  assert.deepStrictEqual(x.sheets[0].rows[0], { 'Owner First Name': 'Cal', 'Owner Last Name': 'Ng', 'Wireless 1': '2145550177', Email: 'cal@ng.com' });
  const m = C.guessMapping(x.sheets[0].headers);
  assert.deepStrictEqual([m.first_name, m.last_name, m.phone, m.email], ['Owner First Name', 'Owner Last Name', 'Wireless 1', 'Email']);
  await assert.rejects(readTable(path.join(dir, 'old.xls')).catch((e) => { throw e; }), /./);
});

test('existing phase 1-2 databases upgrade to the CRM tables without losing data', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'up-')), 'hub.db');
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const old = new SQL.Database();
  old.exec(`CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (1);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('userName', '"Phillip"');
    CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO notes (body) VALUES ('old note');`);
  fs.writeFileSync(file, Buffer.from(old.export()));
  const db = await new Database(file).open();
  assert.strictEqual(db.stats().schemaVersion, require('../electron/db').MIGRATIONS.length);
  assert.strictEqual(db.listNotes()[0].body, 'old note');
  assert.strictEqual(db.getSettings().userName, 'Phillip');
  C.createCrm(db).saveContact({ first_name: 'New' });
  db.close();
});

test('deal team: Directory first, money totals, splits, funds needed from underwriting', async () => {
  const fs2 = require('fs'); const os2 = require('os'); const path2 = require('path');
  const { Database: DB } = require('../electron/db');
  const { createCrm: mk } = require('../electron/crm');
  const db = await new DB(path2.join(fs2.mkdtempSync(path2.join(os2.tmpdir(), 'team-')), 'hub.db')).open();
  const crm = mk(db);
  const deal = crm.saveDeal({ address: '123 Main St', city: 'Mesa' });
  const heidi = crm.saveContact({ first_name: 'Heidi', last_name: 'Scoats', kind: 'network', communities: 'Gator; SubTo', state: 'CT' });
  const greg = crm.saveContact({ first_name: 'Greg', last_name: 'Dibble', kind: 'network', phone: '801-910-9713' });
  const gregC = crm.saveContact({ first_name: 'Greg', last_name: 'Lowe', kind: 'contact', role: 'Title / Attorney' });
  const s = crm.teamSearch('greg', deal.id);
  assert.deepStrictEqual([s.directory.map((c) => c.name), s.contacts.map((c) => c.name)], [['Greg Dibble'], ['Greg Lowe']]);
  assert.deepStrictEqual(crm.teamSearch('9109713', deal.id).directory.map((c) => c.name), ['Greg Dibble']);
  assert.deepStrictEqual(crm.teamSearch('gator', deal.id).directory.map((c) => c.name), ['Heidi Scoats']);
  crm.saveTeamMember(deal.id, heidi.id, { role: 'Buyer', brings: 'Down payment / EMD', amount: '$15,000', terms: 'Buys on wrap · 70% of profit', status: 'Committed' });
  crm.saveTeamMember(deal.id, greg.id, { role: 'Gator / Private lender', brings: 'Gap funding', amount: '20000', terms: '12% · 12 mo · 2 pts', status: 'Pending' });
  let t = crm.saveTeamMember(deal.id, gregC.id, { role: 'Title / Escrow', brings: 'Nothing (service only)', amount: '500', terms: '30% of profit' });
  assert.strictEqual(t.members.length, 3);
  assert.deepStrictEqual([t.committed, t.pending, t.needed, t.short, t.splitTotal], [15000, 20000, null, null, 100]);
  assert.strictEqual(crm.teamSearch('greg', deal.id).directory.length, 0); // already on the deal
  db.run("INSERT INTO analyses (name, deal_id, summary) VALUES ('a', ?, ?)", [deal.id, JSON.stringify({ cashIn: 42000 })]);
  t = crm.team(deal.id);
  assert.deepStrictEqual([t.needed, t.neededFrom, t.short], [42000, 'underwriting', 27000]);
  t = crm.setFundsNeeded(deal.id, '30,000');
  assert.deepStrictEqual([t.needed, t.neededFrom, t.short], [30000, 'typed', 15000]);
  crm.saveTeamMember(deal.id, greg.id, { role: 'Gator / Private lender', brings: 'Gap funding', amount: 20000, status: 'Funded' });
  t = crm.team(deal.id);
  assert.deepStrictEqual([t.committed, t.short], [35000, 0]);
  assert.strictEqual(crm.getContact(greg.id).kind, 'network'); // stays in the Directory
  assert.strictEqual(crm.getContact(greg.id).deals[0].brings, 'Gap funding');
  t = crm.removeTeamMember(deal.id, heidi.id);
  assert.strictEqual(t.members.length, 2);
  // Seller side is kept apart and never counted as funding.
  const owner = crm.saveContact({ first_name: 'Robin', last_name: 'Windham', kind: 'lead', phone: '512-656-7368' });
  assert.deepStrictEqual(crm.teamSearch('robin', deal.id, 'seller').leads.map((c) => c.name), ['Robin Windham']);
  assert.strictEqual(crm.teamSearch('robin', deal.id).leads.length, 0);
  t = crm.saveTeamMember(deal.id, owner.id, { role: 'Seller', brings: 'Cash to seller', amount: 10000, status: 'Committed', terms: 'Wants to move by June' });
  assert.deepStrictEqual([t.seller.map((m) => m.name), t.members.length, t.committed], [['Robin Windham'], 2, 20000]);
  t = crm.saveTeamMember(deal.id, gregC.id, { role: 'Agent' });
  assert.deepStrictEqual(t.seller.map((m) => m.name).sort(), ['Greg Lowe', 'Robin Windham']);
  t = crm.saveTeamMember(deal.id, gregC.id, { role: '' });
  assert.strictEqual(t.seller.length, 1);
  db.close();
});
