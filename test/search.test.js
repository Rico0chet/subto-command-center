const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Database } = require('../electron/db');
const { createSearch } = require('../electron/search');
const { extractFacts, extractText } = require('../electron/extract');

// Runs the file reader in-process instead of a background process.
function fakeWorker() {
  const w = new EventEmitter();
  w.postMessage = async ({ id, file }) => {
    try { const text = await extractText(file); w.emit('message', { id, ok: true, text, facts: extractFacts(text) }); }
    catch (e) { w.emit('message', { id, ok: false, error: e.message }); }
  };
  w.kill = () => {};
  return w;
}

test('pulls phones, emails, links and addresses out of text', () => {
  const f = extractFacts('Call John at (480) 555-1234 or 1-602.555.9876, john@x.com. See https://zillow.com/a. Property: 1015 S Val Vista Drive #33, Mesa, AZ 85204.');
  assert.deepStrictEqual(f.phones, ['4805551234', '6025559876']);
  assert.deepStrictEqual(f.emails, ['john@x.com']);
  assert.deepStrictEqual(f.links, ['https://zillow.com/a']);
  assert.deepStrictEqual(f.addresses, ['1015 S Val Vista Drive #33, Mesa, AZ 85204']);
});

test('indexes a folder, finds phones in any format, words and CRM records; forgets deleted files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubsearch-'));
  const docs = path.join(dir, 'docs');
  fs.mkdirSync(path.join(docs, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(docs, 'notes.txt'), 'Seller Maria Lopez wants out. Phone 480.555.1234\nOwes 2 back payments.');
  fs.writeFileSync(path.join(docs, 'sub', 'list.csv'), 'name,phone\nBob Ray,(602) 555-0000\n');
  fs.writeFileSync(path.join(docs, 'skip.exe'), 'nope');
  const mainDb = await new Database(path.join(dir, 'hub.db')).open();
  mainDb.run("INSERT INTO contacts (first_name, last_name, phone) VALUES ('Maria', 'Lopez', '(480) 555-1234')");
  const s = createSearch({ dataDir: dir, mainDb, workerPath: '', spawnWorker: fakeWorker });
  await s.open();
  s.setFolders([docs]);
  const st = await s.scan();
  assert.strictEqual(st.files, 2);
  for (const q of ['4805551234', '(480) 555-1234', '480-555-1234', '555-1234']) {
    const r = s.query(q);
    assert.strictEqual(r.files.length, 1, q);
    assert.strictEqual(r.files[0].name, 'notes.txt');
  }
  assert.match(s.query('480-555-1234').files[0].snip, /\[\[480\.555\.1234\]\]/);
  assert.strictEqual(s.query('(480) 555-1234').crm.contacts.length, 1);
  assert.strictEqual(s.query('maria lop').files.length, 1);
  assert.strictEqual(s.query('"back payments"').files.length, 1);
  assert.strictEqual(s.query('bob').files[0].name, 'list.csv');
  const d = s.fileDetail(s.query('maria').files[0].id, 'maria');
  assert.strictEqual(d.hits.length, 1);
  assert.strictEqual(d.hits[0].n, 1);
  fs.unlinkSync(path.join(docs, 'notes.txt'));
  const st2 = await s.scan();
  assert.strictEqual(st2.files, 1);
  assert.strictEqual(s.query('maria').files.length, 0);
  s.close();
  mainDb.close && mainDb.close();
});
