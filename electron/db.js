// Local database: SQLite (via sql.js, no native build needed) stored as one file on the PC.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

// Each migration runs once, in order. Never edit an old one; add a new one.
const MIGRATIONS = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
   CREATE TABLE notes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     body TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
  // Phase 3: CRM
  `CREATE TABLE contacts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '',
     company TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'Other',
     phone TEXT NOT NULL DEFAULT '', phone2 TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
     address TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE deals (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     address TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', zip TEXT NOT NULL DEFAULT '',
     property_type TEXT NOT NULL DEFAULT 'Single family', strategy TEXT NOT NULL DEFAULT 'Subject-To',
     stage TEXT NOT NULL DEFAULT 'Lead', position REAL NOT NULL DEFAULT 0,
     asking_price REAL, arv REAL, loan_balance REAL, interest_rate REAL, piti REAL, rent REAL, entry_fee REAL,
     source TEXT NOT NULL DEFAULT '', next_follow_up TEXT, notes TEXT NOT NULL DEFAULT '',
     dead_reason TEXT NOT NULL DEFAULT '', closed_at TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE deal_contacts (
     deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
     contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
     role TEXT NOT NULL DEFAULT '',
     PRIMARY KEY (deal_id, contact_id)
   );
   CREATE TABLE tasks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL, due_date TEXT, done INTEGER NOT NULL DEFAULT 0, done_at TEXT,
     priority TEXT NOT NULL DEFAULT 'Normal', notes TEXT NOT NULL DEFAULT '',
     deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
     contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE activities (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL DEFAULT '',
     deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
     contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_deals_stage ON deals(stage, position);
   CREATE INDEX idx_tasks_due ON tasks(done, due_date);
   CREATE INDEX idx_act_deal ON activities(deal_id, created_at);
   CREATE INDEX idx_act_contact ON activities(contact_id, created_at);
   CREATE INDEX idx_act_time ON activities(created_at);`,
  // Phase 3.5: lead lists, network contacts, sheet details
  `ALTER TABLE contacts ADD COLUMN kind TEXT NOT NULL DEFAULT 'contact';
   ALTER TABLE contacts ADD COLUMN more_phones TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE contacts ADD COLUMN emails2 TEXT NOT NULL DEFAULT '';
   ALTER TABLE contacts ADD COLUMN extra TEXT NOT NULL DEFAULT '';
   ALTER TABLE contacts ADD COLUMN state TEXT NOT NULL DEFAULT '';
   ALTER TABLE contacts ADD COLUMN city TEXT NOT NULL DEFAULT '';
   ALTER TABLE contacts ADD COLUMN communities TEXT NOT NULL DEFAULT '';
   ALTER TABLE contacts ADD COLUMN calls_attended TEXT NOT NULL DEFAULT '';
   ALTER TABLE contacts ADD COLUMN link TEXT NOT NULL DEFAULT '';
   ALTER TABLE contacts ADD COLUMN ext_id TEXT NOT NULL DEFAULT '';
   ALTER TABLE contacts ADD COLUMN flags TEXT NOT NULL DEFAULT '';
   CREATE INDEX idx_contacts_kind ON contacts(kind);
   CREATE INDEX idx_contacts_ext ON contacts(ext_id);
   CREATE TABLE lists (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL, recipe TEXT NOT NULL, file_name TEXT NOT NULL DEFAULT '', sheet_name TEXT NOT NULL DEFAULT '',
     headers TEXT NOT NULL DEFAULT '[]', person_role TEXT NOT NULL DEFAULT 'Seller', info TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE list_items (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
     position INTEGER NOT NULL DEFAULT 0, row_number INTEGER,
     contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
     deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
     status TEXT NOT NULL DEFAULT 'Not called', attempts INTEGER NOT NULL DEFAULT 0,
     last_called TEXT NOT NULL DEFAULT '', follow_up TEXT, appointment TEXT NOT NULL DEFAULT '',
     caller TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
     title TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '',
     zip TEXT NOT NULL DEFAULT '', county TEXT NOT NULL DEFAULT '', property_type TEXT NOT NULL DEFAULT '',
     units TEXT NOT NULL DEFAULT '', year_built TEXT NOT NULL DEFAULT '', price REAL, dom TEXT NOT NULL DEFAULT '',
     highlights TEXT NOT NULL DEFAULT '[]', people TEXT NOT NULL DEFAULT '[]', extra TEXT NOT NULL DEFAULT '',
     flags TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_items_list ON list_items(list_id, position);
   CREATE INDEX idx_items_follow ON list_items(follow_up);
   CREATE INDEX idx_items_contact ON list_items(contact_id);
   ALTER TABLE activities ADD COLUMN list_item_id INTEGER REFERENCES list_items(id) ON DELETE SET NULL;
   CREATE INDEX idx_act_item ON activities(list_item_id, created_at);`,
  // 5: saved underwriting analyses (phase 4)
  `CREATE TABLE analyses (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
     deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
     data TEXT NOT NULL DEFAULT '{}', summary TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_analyses_deal ON analyses(deal_id);`,
  // 6: files linked to deals (phase 6)
  `CREATE TABLE deal_files (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
     path TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
     added_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE(deal_id, path)
   );`,
  // 7: Zoom Chat Organizer built in (phase 9)
  `CREATE TABLE zoom_names (
     zoom_name TEXT PRIMARY KEY,
     contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE
   );
   CREATE INDEX idx_zoom_names_contact ON zoom_names(contact_id);
   CREATE TABLE zoom_files (
     path TEXT PRIMARY KEY, mtime REAL NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '',
     messages INTEGER NOT NULL DEFAULT 0, imported_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
  // 8: deal team — who you're doing the deal with and what each person brings (1.0.1)
  `ALTER TABLE deal_contacts ADD COLUMN brings TEXT NOT NULL DEFAULT '';
   ALTER TABLE deal_contacts ADD COLUMN amount REAL;
   ALTER TABLE deal_contacts ADD COLUMN terms TEXT NOT NULL DEFAULT '';
   ALTER TABLE deal_contacts ADD COLUMN status TEXT NOT NULL DEFAULT 'Pending';
   ALTER TABLE deal_contacts ADD COLUMN added_at TEXT NOT NULL DEFAULT '';
   ALTER TABLE deals ADD COLUMN funds_needed REAL;`,
];

class Database {
  constructor(filePath, migrations = MIGRATIONS) {
    this.filePath = filePath;
    this.migrations = migrations;
    this.db = null;
  }

  async open() {
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) });
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (fs.existsSync(this.filePath)) {
      this.db = new SQL.Database(fs.readFileSync(this.filePath));
    } else {
      this.db = new SQL.Database();
    }
    this.db.run('PRAGMA foreign_keys = ON');
    this.migrate();
    return this;
  }

  migrate() {
    this.db.run('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = this.get('SELECT version FROM schema_version');
    let version = row ? row.version : 0;
    if (!row) this.db.run('INSERT INTO schema_version (version) VALUES (0)');
    while (version < this.migrations.length) {
      this.db.run('BEGIN');
      try {
        this.db.exec(this.migrations[version]);
        version += 1;
        this.db.run('UPDATE schema_version SET version = ?', [version]);
        this.db.run('COMMIT');
      } catch (e) {
        this.db.run('ROLLBACK');
        throw e;
      }
    }
    this.save();
  }

  // Write to a temp file, then swap it in, so a crash never leaves a half-written database.
  save() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const data = Buffer.from(this.db.export());
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, this.filePath);
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(sql, params = []) {
    return this.all(sql, params)[0];
  }

  run(sql, params = []) {
    this.db.run(sql, params);
    const id = this.get('SELECT last_insert_rowid() AS id').id;
    if (!this.inTx) this.saveSoon();
    return id;
  }

  // Writes are grouped: the file is saved within a second of the last change (and always on close),
  // so clicking through a 14,000-row list stays fast.
  saveSoon() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; if (this.db) this.save(); }, 700);
    if (this.saveTimer.unref) this.saveTimer.unref();
  }

  changes() {
    return this.get('SELECT changes() AS n').n;
  }

  // Many changes as one: all or nothing, saved to disk once at the end.
  transaction(fn) {
    if (this.inTx) return fn();
    this.inTx = true;
    this.db.run('BEGIN');
    try {
      const out = fn();
      this.db.run('COMMIT');
      this.inTx = false;
      this.save();
      return out;
    } catch (e) {
      try { this.db.run('ROLLBACK'); } catch { /* ignore */ }
      this.inTx = false;
      throw e;
    }
  }

  // ---- settings ----
  getSettings() {
    const out = {};
    for (const r of this.all('SELECT key, value FROM settings')) {
      try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
    }
    return out;
  }

  setSetting(key, value) {
    this.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)]);
  }

  // ---- notes (phase 1 test record) ----
  listNotes() {
    return this.all('SELECT id, body, created_at FROM notes ORDER BY id DESC');
  }
  addNote(body) {
    const text = String(body || '').trim();
    if (!text) throw new Error('Note is empty');
    return this.run('INSERT INTO notes (body) VALUES (?)', [text]);
  }
  deleteNote(id) {
    this.run('DELETE FROM notes WHERE id = ?', [Number(id)]);
  }

  stats() {
    return {
      schemaVersion: this.get('SELECT version FROM schema_version').version,
      notes: this.get('SELECT COUNT(*) AS n FROM notes').n,
      sizeBytes: fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0,
    };
  }

  close() {
    if (this.db) { this.save(); this.db.close(); this.db = null; }
  }
}

module.exports = { Database, MIGRATIONS };
