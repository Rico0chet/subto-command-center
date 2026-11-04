// Lead lists, recipes and the one-import flow, tested with made-up files shaped like real ones.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { Database } = require('../electron/db');
const { createCrm } = require('../electron/crm');
const { createLists } = require('../electron/lists');
const R = require('../electron/recipes');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lists-'));
async function open() {
  const dir = tmp();
  const db = await new Database(path.join(dir, 'hub.db')).open();
  const crm = createCrm(db);
  return { dir, db, crm, lists: createLists(db, crm, dir) };
}
async function xlsx(dir, name, sheets) {
  const wb = new ExcelJS.Workbook();
  for (const [sheetName, rows] of sheets) { const ws = wb.addWorksheet(sheetName); rows.forEach((r) => ws.addRow(r)); }
  const f = path.join(dir, name);
  await wb.xlsx.writeFile(f);
  return f;
}
const importAll = async (lists, file) => {
  const a = await lists.analyze(file);
  const r = await lists.run({ sheets: a.sheets.map((s) => ({ index: s.index, include: s.include, name: s.defaultName, propertyType: s.defaultType })) });
  return { a, r };
};

// --- an appointment-setting call list: title rows on top, listing agents, office line shared by two agents
const AGENT_HEADERS = ['Caller Name', '#', 'Priority', 'Property Address', 'City', 'Zip', 'Ask For (Listing Agent)', 'Brokerage', 'Agent Phone', 'Agent Phone 2', 'Office Phone', 'Agent Email', 'List Price', 'Days on Market', 'Seller Signals', 'Caller Tips', 'Status', 'Attempts', 'Last Called', 'Follow-Up Date', 'Notes', 'MLS Remarks', 'APN'];
const agentRows = [
  ['Virtual Team Call List | Setting appointments for Closers'],
  ['Buyer: Example Buyer LLC. Read the Start Here tab.'],
  [],
  AGENT_HEADERS,
  ['Ana', 1, 'High', '1 Elm St', 'Mesa', '85204', 'Judy Massey', 'West Realty', '(480) 555-0101', '', '(480) 555-0999', 'judy@west.com', 365000, 185, 'Free and clear', 'Ask about terms', 'Left Voicemail', 2, '2026-10-01', '2026-10-30', 'Call after 3', 'Nice home', '140-47-414'],
  ['Ana', 2, 'High', '2 Oak St', 'Mesa', '85204', 'Judy Massey', 'West Realty', '(480) 555-0101', '', '(480) 555-0999', 'judy@west.com', 410000, 90, 'Assumable', '', 'Interested - Send to Closer', 1, '', '', '', '', ''],
  ['Bo', 3, 'Low', '3 Pine St', 'Tempe', '85281', 'Tom Ruiz', 'West Realty', '(480) 555-0202', '', '(480) 555-0999', '', 299000, 30, '', '', 'Not Called', 0, '', '', '', '', ''],
  ['Bo', 4, 'Low', '4 Ash St', 'Tempe', '85281', 'Kim Lee', 'Other Realty', '(480) 555-0303', '', '', '', 250000, 12, '', '', 'Do Not Call', 1, '', '', '', '', ''],
];

test('finds the header row under title rows, picks the right recipe, keeps leftovers as Sheet details', async () => {
  const { dir, db, lists } = await open();
  const f = await xlsx(dir, 'VIRTUAL - SINGLE FAMILY.xlsx', [['Start Here', [['Start Here | read me'], ['Your mission', 'Book calls']]], ['Virtual Call List', agentRows]]);
  const a = await lists.analyze(f);
  const sheet = a.sheets.find((s) => s.name === 'Virtual Call List');
  assert.strictEqual(sheet.headerRow, 4);
  assert.strictEqual(sheet.recipe.id, 'agent-call-list');
  assert.strictEqual(sheet.total, 4);
  assert.ok(!a.sheets.some((s) => s.name === 'Start Here' && s.include));
  const r = await lists.run({ sheets: a.sheets.map((s) => ({ index: s.index, include: s.include, name: 'Virtual SF' })) });
  assert.strictEqual(r[0].added, 4);
  const l = lists.listLists()[0];
  assert.deepStrictEqual([l.name, l.total, l.interested, l.closed, l.called], ['Virtual SF', 4, 1, 1, 3]);
  assert.match(l.info, /Buyer: Example Buyer LLC/);
  const items = lists.listItems(l.id, { limit: 10 }).items;
  const first = lists.getItem(items[0].id);
  assert.strictEqual(first.status, 'Left voicemail');
  assert.strictEqual(first.attempts, 2);
  assert.strictEqual(first.follow_up, '2026-10-30');
  assert.strictEqual(first.notes, 'Call after 3');
  assert.deepStrictEqual(first.highlights.map((h) => h.label), ['Seller signals', 'Caller tips']);
  assert.match(first.extra, /MLS Remarks: Nice home/);
  assert.match(first.extra, /APN: 140-47-414/);
  assert.doesNotMatch(first.extra, /Agent Phone|Status/); // used columns aren't repeated
  // People: Judy (2 listings) once; Tom shares only the office line with Judy, so he's his own person.
  const people = db.all("SELECT first_name, last_name, kind, role FROM contacts ORDER BY id");
  assert.deepStrictEqual(people.map((p) => `${p.first_name} ${p.last_name}`), ['Judy Massey', 'Tom Ruiz', 'Kim Lee']);
  assert.ok(people.every((p) => p.kind === 'lead' && p.role === 'Agent'));
  // Leads don't crowd My contacts.
  assert.strictEqual(createCrm(db).listContacts().length, 0);
  // Hide finished leads (Do not call).
  assert.strictEqual(lists.listItems(l.id, { hideClosed: true }).total, 3);
  db.close();
});

test('working a lead: result buttons count attempts, next lead, Make it a deal, export writes back in the sheet\'s words', async () => {
  const { dir, db, crm, lists } = await open();
  const f = await xlsx(dir, 'calls.xlsx', [['Virtual Call List', agentRows]]);
  await importAll(lists, f);
  const l = lists.listLists()[0];
  const ids = lists.listItems(l.id).items.map((x) => x.id);
  const after = lists.setStatus(ids[2], 'No answer', 'rang out');
  assert.strictEqual(after.attempts, 1);
  assert.ok(after.last_called);
  assert.match(after.activities[0].body, /No answer: rang out/);
  assert.strictEqual(lists.neighbor(ids[0], 1, {}), ids[1]);
  assert.strictEqual(lists.neighbor(ids[2], 1, { hideClosed: true }), null); // #4 is Do not call
  assert.throws(() => lists.setStatus(ids[0], 'Bogus'), /Unknown status/);
  lists.updateItem(ids[2], { follow_up: '2026-11-02', notes: 'try mornings' });
  const dealId = lists.promote(ids[1]);
  const deal = crm.getDeal(dealId);
  assert.deepStrictEqual([deal.address, deal.city, deal.stage, deal.asking_price], ['2 Oak St', 'Mesa', 'Talking', 410000]);
  assert.strictEqual(deal.contacts[0].name, 'Judy Massey');
  assert.match(deal.source, /List:/);
  assert.match(deal.notes, /Seller signals: Assumable/);
  assert.strictEqual(lists.promote(ids[1]), dealId); // twice = same deal
  assert.strictEqual(crm.listContacts().length, 1); // Judy is now a working contact
  // Export: original columns, statuses written back using the sheet's own dropdown wording.
  const out = path.join(dir, 'export.xlsx');
  const ex = await lists.exportList(l.id, out);
  assert.ok(ex.original);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const ws = wb.worksheets[0];
  const hdr = ws.getRow(1).values.slice(1);
  assert.deepStrictEqual(hdr.slice(0, AGENT_HEADERS.length), AGENT_HEADERS);
  const col = (name) => hdr.indexOf(name) + 1;
  assert.strictEqual(ws.getRow(4).getCell(col('Status')).value, 'No Answer');
  assert.strictEqual(ws.getRow(4).getCell(col('Attempts')).value, 1);
  assert.strictEqual(ws.getRow(4).getCell(col('Follow-Up Date')).value, '2026-11-02');
  assert.strictEqual(ws.getRow(4).getCell(col('Notes')).value, 'try mornings');
  assert.strictEqual(ws.getRow(3).getCell(col('Status')).value, 'Interested - Send to Closer');
  assert.strictEqual(ws.getRow(2).getCell(col('MLS Remarks')).value, 'Nice home');
  db.close();
});

test('owner list (multifamily): phone owners from "Phone Sources", company owners, same owner on several buildings', async () => {
  const { dir, db, lists } = await open();
  const f = await xlsx(dir, 'MF Lists - Texas.xlsx', [['Sheet2', [
    [],
    ['', 'NOTES', 'Cold Caller Name', 'Dates Called', '', 'Property Name', 'Property Address', 'City', 'State', 'Zip', 'County', 'Units', 'Owner Contact', 'Owner Company', 'Phone 1', 'Phone 2', 'Phone 3', 'Phone 4', 'Phone Sources', 'Year Built', 'Class', 'Occupancy %', 'Property Manager', 'Owner Mailing Address', 'Owner City/State/Zip', 'Source List'],
    ['', '', '', '', 'Search Google', 'Jefferson House', '1510 W Jefferson Blvd', 'Dallas', 'TX', '75208', 'Dallas', 17, 'Chris Welsh', 'Chris Welsh', '(214) 555-0419', '', '', '', '1=Owner', 1972, 'C', 0.941, '', '7238 Northaven Rd', 'Dallas, TX 75230', 'No Loan / Free & Clear'],
    ['', 'left msg', 'Jo', '10/2', 'Search Google', 'Infinity', '660 Yorktown St', 'Dallas', 'TX', '75208', 'Dallas', 226, '', 'Shain Capital', '(310) 555-0693', '(888) 555-9384', '', '', '1=Owner | 2=Property Mgr', 2015, 'A', 0.841, 'Landmark', '', '', 'No Loan / Free & Clear'],
    ['', '', '', '', '', 'Infinity II', '700 Yorktown St', 'Dallas', 'TX', '75208', 'Dallas', 120, '', 'Shain Capital', '(310) 555-0693', '', '', '', '1=Owner', 2016, 'A', '', '', '', '', 'No Loan / Free & Clear'],
  ]]]);
  const { a } = await importAll(lists, f);
  assert.strictEqual(a.sheets[0].recipe.id, 'owner-list');
  const l = lists.listLists()[0];
  assert.strictEqual(l.total, 3);
  const items = lists.listItems(l.id).items;
  const inf = lists.getItem(items[1].id);
  assert.strictEqual(inf.title, 'Infinity');
  assert.strictEqual(inf.property_type, 'Multifamily (226 units)');
  assert.strictEqual(inf.notes, 'left msg');
  assert.strictEqual(inf.caller, 'Jo');
  assert.deepStrictEqual(inf.contact.more_phones.map((p) => p.label), ['Owner', 'Property Mgr']);
  assert.ok(inf.highlights.some((h) => h.label === 'Occupancy' && h.value === '84%'));
  assert.strictEqual(lists.getItem(items[2].id).contact.id, inf.contact.id); // same owner company, one contact
  assert.match(inf.extra, /Unlabeled column 5: Search Google/);
  assert.match(inf.extra, /Year Built|Class/.test(inf.extra) ? /^$/ : /Search Google/); // used columns aren't repeated
  db.close();
});

test('skip-traced list: mobiles first, co-owner + relatives as backup numbers, deceased flagged, MHP type from file name', async () => {
  const { dir, db, lists } = await open();
  const H = ['Input Last Name', 'Input First Name', 'Input Mailing Address', 'Input Mailing City', 'Input Mailing State', 'Input Mailing Zip', 'Input Property Address', 'Input Property City', 'Input Property State', 'Input Property Zip', 'Input Custom Field 1', 'Input Custom Field 2', 'ResultCode', 'Matched First Name', 'Matched Last Name', 'Age', 'Deceased', 'Phone1', 'Phone1 Type', 'Phone2', 'Phone2 Type', 'Email1', 'Relative1 Name', 'Relative1 Age', 'Relative1 Phone1', 'Relative1 Phone1 Type', 'Relative2 Name', 'Relative2 Phone1', 'Person2 First Name', 'Person2 Last Name', 'Person2 Phone1', 'Person2 Phone1 Type'];
  const f = await xlsx(dir, 'Mobile Money Skip Traced MHP List.xlsx', [['USA MHP', [
    [], [], [], [], [], [],
    H,
    ['', '', '560 NE F ST', 'GRANTS PASS', 'OR', '97526', '3500 DIAMOND LAKE LOOP', 'GRANTS PASS', 'OR', '97731', 'DIAMOND LAKE TRAILER PK', 'LEAVERTON WM & CAROLE', 'CI', 'CAROLE', 'LEAVERTON', 74, 'N', '5415550101', 'Residential', '5415550102', 'Mobile', 'CAROLE@EXAMPLE.COM', 'MARY PRINCE', 98, '7075550103', 'Residential', 'WILLIAM LEAVERTON', '5415550104', 'WILLIAM', 'LEAVERTON', '5415550104', 'Mobile'],
    ['', '', '', '', '', '', '1 PARK RD', 'TULSA', 'OK', '74101', 'SUNNY ACRES MHP', '', 'CI', 'GENE', 'OLD', 91, 'Y', '9185550105', 'Mobile', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ]]]);
  const { a } = await importAll(lists, f);
  assert.strictEqual(a.sheets[0].headerRow, 7);
  assert.strictEqual(a.sheets[0].recipe.id, 'skip-trace');
  const l = lists.listLists()[0];
  const [one, two] = lists.listItems(l.id).items.map((x) => lists.getItem(x.id));
  assert.strictEqual(one.title, 'Diamond Lake Trailer Pk');
  assert.strictEqual(one.address, '3500 Diamond Lake Loop');
  assert.strictEqual(one.property_type, 'Mobile home park');
  assert.strictEqual(one.contact.name, 'Carole Leaverton');
  assert.deepStrictEqual(one.contact.more_phones.map((p) => p.type), ['Mobile', 'Residential']);
  assert.strictEqual(one.contact.email, 'carole@example.com');
  assert.strictEqual(one.contact.address, '560 Ne F St, Grants Pass, OR, 97526');
  assert.deepStrictEqual(one.people.map((p) => `${p.name}|${p.role}`), ['William Leaverton|Co-owner', 'Mary Prince|Relative']); // William's relative copy dropped
  assert.ok(one.highlights.some((h) => h.label === 'Owner age' && h.value === '74'));
  assert.ok(!one.contact.flags);
  assert.match(two.contact.flags, /deceased/i);
  assert.doesNotMatch(one.extra, /Relative|Person2|Phone1/);
  db.close();
});

test('SubTo Directory file: people into the Directory, chat log becomes their history, re-import adds nothing twice', async () => {
  const { dir, db, crm, lists } = await open();
  const f = await xlsx(dir, 'SubTo_Contacts_MASTER.xlsx', [
    ['Contacts', [
      ['First Name', 'Last Name', 'Blinq Card', 'Phone', 'Email', 'State', 'City / Area', 'Communities', 'Community Basis', 'Calls Attended', 'Role', '# Msgs', 'Comments (what they said)', 'Notes / Flags', 'Contact ID'],
      ['Heidi', 'Scoats', 'https://s.blinq.me/abc', '714-555-0146', '', 'CA', 'Orange County', 'SubTo; Gator', 'stated', '9/15, 9/23 PM', 'Bird Dog', 4, '[09/15 16:02] Hi all', '', 'C0111'],
      ['Leland', 'Hill', '', '', '', '', '', 'SubTo', 'inferred', '9/15', '', 1, '', 'Zoom name had a phone number', 'C0182'],
    ]],
    ['Raw Chat Log', [
      ['Call', 'Date', 'Time', 'Sender (as shown in Zoom)', 'Matched Contact', 'Message', 'Contact ID'],
      ['9/15', '2026-09-15', '16:02:22', 'Heidi Scoats Gator CT', 'Heidi Scoats', 'Hi all', 'C0111'],
      ['9/15', '2026-09-15', '16:05:00', 'Heidi Scoats Gator CT', 'Heidi Scoats', 'Looking for deals in OC', 'C0111'],
      ['9/15', '2026-09-15', '16:06:00', 'Leland Hill', 'Leland Hill', '1', 'C0182'],
      ['9/15', '2026-09-15', '16:07:00', 'Unknown', '', 'hello', ''],
    ]],
    ['Zoom Name Map', [['Zoom Name (as displayed)', 'Contact ID', 'Contact'], ['x', 'C0111', 'Heidi']]],
    ['Read Me', [['How this workbook works'], ['608 contacts']]],
  ]);
  const a = await lists.analyze(f);
  assert.deepStrictEqual(a.sheets.map((s) => [s.name, s.recipe.id, s.include]), [['Contacts', 'network', true], ['Raw Chat Log', 'chat-log', true], ['Zoom Name Map', 'zoom-names', true]]);
  const r = await lists.run({ sheets: a.sheets.map((s) => ({ index: s.index, include: s.include })) });
  assert.deepStrictEqual(r.map((x) => [x.kind, x.added, x.skipped]), [['network', 2, 0], ['namemap', 1, 0], ['chat', 3, 1]]);
  // Zoom names from the map and from the chat log both point at the person.
  assert.deepStrictEqual(db.all('SELECT zoom_name FROM zoom_names ORDER BY zoom_name').map((x) => x.zoom_name), ['Heidi Scoats Gator CT', 'Leland Hill', 'x']);
  const dir1 = crm.listContacts({ kind: 'network' });
  const heidi = crm.getContact(dir1.find((c) => c.first_name === 'Heidi').id);
  assert.deepStrictEqual([heidi.communities, heidi.calls_attended, heidi.link, heidi.ext_id, heidi.tags, heidi.city], ['SubTo; Gator', '9/15, 9/23 PM', 'https://s.blinq.me/abc', 'C0111', 'Bird Dog', 'Orange County']);
  assert.deepStrictEqual(heidi.activities.filter((x) => x.kind === 'chat').map((x) => x.body), ['Looking for deals in OC', 'Hi all']);
  assert.match(heidi.extra, /Community Basis: stated/);
  assert.strictEqual(crm.listContacts().length, 0); // not mixed into My contacts
  assert.strictEqual(crm.listContacts({ q: 'Gator', kind: 'network' }).length, 1);
  // Work with them → My contacts
  crm.promoteContact(heidi.id, 'Buyer');
  assert.deepStrictEqual(crm.listContacts().map((c) => [c.first_name, c.role]), [['Heidi', 'Buyer']]);
  // Same file again: matched by Contact ID, chats not duplicated, Heidi stays a contact.
  const a2 = await lists.analyze(f);
  const r2 = await lists.run({ sheets: a2.sheets.map((s) => ({ index: s.index, include: s.include })) });
  assert.deepStrictEqual(r2.map((x) => [x.kind, x.added, x.matched]), [['network', 0, 2], ['namemap', 1, 0], ['chat', 0, 0]]);
  assert.strictEqual(crm.getContact(heidi.id).kind, 'contact');
  db.close();
});

test('status wording from different sheets maps to one standard set', () => {
  const m = (s) => R.normalizeStatus(s);
  assert.strictEqual(m('Left Voicemail'), 'Left voicemail');
  assert.strictEqual(m('LVM'), 'Left voicemail');
  assert.strictEqual(m('Interested - Send to Closer'), 'Interested');
  assert.strictEqual(m('Not Interested'), 'Not interested');
  assert.strictEqual(m('Appointment Set'), 'Appointment set');
  assert.strictEqual(m('Wrong / Disconnected Number'), 'Wrong number');
  assert.strictEqual(m('DNC'), 'Do not call');
  assert.strictEqual(m('Under Contract / Sold'), 'Sold / under contract');
  assert.strictEqual(m('Call Back Later'), 'Call back');
  assert.strictEqual(m(''), 'Not called');
  assert.strictEqual(m('purple'), null); // unknown → kept in Sheet details as "Original status"
});

test('deleting a list removes its leads and lead-only people, keeps deals and working contacts', async () => {
  const { dir, db, crm, lists } = await open();
  const f = await xlsx(dir, 'calls.xlsx', [['Virtual Call List', agentRows]]);
  await importAll(lists, f);
  const l = lists.listLists()[0];
  const ids = lists.listItems(l.id).items.map((x) => x.id);
  const dealId = lists.promote(ids[0]);
  lists.deleteList(l.id);
  assert.strictEqual(lists.listLists().length, 0);
  assert.ok(crm.getDeal(dealId));
  assert.deepStrictEqual(db.all('SELECT first_name FROM contacts').map((c) => c.first_name), ['Judy']);
  assert.ok(!fs.existsSync(path.join(dir, 'lists', `${l.id}.jsonl`)));
  db.close();
});

test('a plain contact list (no recipe) still imports with column matching, into My contacts or the Directory', async () => {
  const { dir, db, crm, lists } = await open();
  const f = await xlsx(dir, 'agents.xlsx', [['Agents', [['My agent list'], [], ['Full Name', 'Mobile', 'Email', 'Office'], ['Ana Diaz', '512-555-0111', 'ana@x.com', 'KW'], ['Bo Li', '512-555-0112', '', 'RE/MAX']]]]);
  const a = await lists.analyze(f);
  assert.strictEqual(a.sheets[0].recipe.id, 'contacts');
  assert.strictEqual(a.sheets[0].headerRow, 3);
  const map = { ...a.sheets[0].guess, company: 'Office' };
  await lists.run({ sheets: [{ index: 0, include: true, recipe: 'contacts', map, role: 'Agent', tags: 'Austin agents', kind: 'contact' }] });
  const c = crm.listContacts();
  assert.deepStrictEqual(c.map((x) => [x.first_name, x.last_name, x.company, x.role, x.tags]).sort(), [['Ana', 'Diaz', 'KW', 'Agent', 'Austin agents'], ['Bo', 'Li', 'RE/MAX', 'Agent', 'Austin agents']]);
  db.close();
});
