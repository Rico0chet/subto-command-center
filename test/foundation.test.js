const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Database, MIGRATIONS } = require('../electron/db');
const { runBackup, listBackups, isDue } = require('../electron/backup');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'subto-hub-'));

test('database creates schema and saves a record that survives reopening', async () => {
  const dir = tmp();
  const file = path.join(dir, 'hub.db');
  let db = await new Database(file).open();
  assert.strictEqual(db.stats().schemaVersion, MIGRATIONS.length);
  db.addNote('Call agent Maria about 123 Main St');
  db.setSetting('userName', 'Phillip');
  db.setSetting('windowBounds', { width: 1200, height: 800 });
  db.close();

  db = await new Database(file).open();
  const notes = db.listNotes();
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].body, 'Call agent Maria about 123 Main St');
  const s = db.getSettings();
  assert.strictEqual(s.userName, 'Phillip');
  assert.deepStrictEqual(s.windowBounds, { width: 1200, height: 800 });
  db.close();
});

test('migrations run only once', async () => {
  const file = path.join(tmp(), 'hub.db');
  (await new Database(file).open()).close();
  const db = await new Database(file).open(); // would throw "table exists" if re-run
  assert.strictEqual(db.stats().schemaVersion, MIGRATIONS.length);
  db.close();
});

test('empty notes are rejected and deletes work', async () => {
  const db = await new Database(path.join(tmp(), 'hub.db')).open();
  assert.throws(() => db.addNote('   '), /empty/);
  const id = db.addNote('temp');
  db.deleteNote(id);
  assert.strictEqual(db.listNotes().length, 0);
  db.close();
});

test('save leaves no temp file behind', async () => {
  const dir = tmp();
  const db = await new Database(path.join(dir, 'hub.db')).open();
  db.addNote('x');
  assert.deepStrictEqual(fs.readdirSync(dir), ['hub.db']);
  db.close();
});

test('backup copies the database and the copy opens with the same data', async () => {
  const dir = tmp();
  const db = await new Database(path.join(dir, 'hub.db')).open();
  db.addNote('backed up note');
  const backups = path.join(dir, 'backups');
  const r = runBackup(db, backups, 14);
  assert.ok(fs.existsSync(r.path));
  const copy = await new Database(r.path).open();
  assert.strictEqual(copy.listNotes()[0].body, 'backed up note');
  copy.close();
  db.close();
});

test('backup keeps only the newest N copies', async () => {
  const dir = tmp();
  const db = await new Database(path.join(dir, 'hub.db')).open();
  const backups = path.join(dir, 'backups');
  fs.mkdirSync(backups);
  for (let i = 1; i <= 5; i++) {
    fs.writeFileSync(path.join(backups, `SubTo-Hub-backup-2026-01-0${i}_120000.db`), 'old');
  }
  runBackup(db, backups, 3);
  const left = listBackups(backups).map((b) => b.name);
  assert.strictEqual(left.length, 3);
  assert.ok(!left.includes('SubTo-Hub-backup-2026-01-01_120000.db'));
  db.close();
});

test('backup is due after 24 hours or when never run', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  assert.strictEqual(isDue(null, now), true);
  assert.strictEqual(isDue('2026-10-22T00:00:00Z', now), false);
  assert.strictEqual(isDue('2026-10-21T11:59:00Z', now), true);
  assert.strictEqual(isDue('garbage', now), true);
});
