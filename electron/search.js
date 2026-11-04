// Search & documents: keeps a searchable copy of the text in your watched folders
// (a separate search.db that can always be rebuilt) and searches it together with the CRM.
const fs = require('fs');
const path = require('path');
const { Database } = require('./db');
const { SUPPORTED, phoneDigits } = require('./extract');

const SEARCH_MIGRATIONS = [
  `CREATE TABLE files (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, ext TEXT NOT NULL, folder TEXT NOT NULL,
     size INTEGER NOT NULL DEFAULT 0, mtime REAL NOT NULL DEFAULT 0, indexed_at TEXT, error TEXT NOT NULL DEFAULT '',
     facts TEXT NOT NULL DEFAULT '{}'
   );
   CREATE VIRTUAL TABLE docs USING fts4(name, body, extra);`,
];
const SKIP_DIRS = /^(\.|node_modules$|\$recycle\.bin$|appdata$|system volume information$|windows$|program files)/i;
const MAX_FILES = 20000;

function phoneTokens(facts) {
  const out = new Set();
  for (const p of facts.phones || []) { out.add(`p${p}`); out.add(`p${p.slice(3)}`); }
  for (const e of facts.emails || []) out.add(e);
  return [...out].join(' ');
}

function createSearch({ dataDir, workerPath, spawnWorker, mainDb, onProgress = () => {} }) {
  const sdb = new Database(path.join(dataDir, 'search.db'), SEARCH_MIGRATIONS);
  let folders = [];
  let scanning = false, rescan = false;
  let status = { state: 'idle', done: 0, total: 0, current: '', lastScan: null, files: 0, errors: 0 };
  const watchers = new Map();

  // ---------- background reader process ----------
  let worker = null;
  let nextId = 1;
  const pending = new Map();
  function getWorker() {
    if (worker) return worker;
    worker = spawnWorker(workerPath);
    worker.on('message', (m) => {
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); clearTimeout(p.timer); p.resolve(m); }
    });
    worker.on('exit', () => {
      worker = null;
      for (const [, p] of pending) { clearTimeout(p.timer); p.resolve({ ok: false, error: 'Reader stopped' }); }
      pending.clear();
    });
    return worker;
  }
  function readFile(file) {
    return new Promise((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        try { worker && worker.kill(); } catch { /* already gone */ }
        worker = null;
        resolve({ ok: false, error: 'Took too long to read' });
      }, 90000);
      pending.set(id, { resolve, timer });
      getWorker().postMessage({ id, file });
    });
  }

  // ---------- walking folders ----------
  async function walk(root, out, depth = 0) {
    if (depth > 8 || out.length >= MAX_FILES) return;
    let entries;
    try { entries = await fs.promises.readdir(root, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const full = path.join(root, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.test(e.name)) await walk(full, out, depth + 1); continue; }
      if (!e.isFile() || e.name.startsWith('~$')) continue; // ~$ = Office lock files
      if (!SUPPORTED.has(path.extname(e.name).toLowerCase())) continue;
      try {
        const st = await fs.promises.stat(full);
        out.push({ path: full, size: st.size, mtime: st.mtimeMs, folder: root });
      } catch { /* vanished */ }
    }
  }
  const inFolders = (p) => folders.some((f) => p.toLowerCase().startsWith(path.resolve(f).toLowerCase() + path.sep) || p.toLowerCase() === path.resolve(f).toLowerCase());

  async function scan() {
    if (scanning) { rescan = true; return status; }
    scanning = true;
    try {
      do {
        rescan = false;
        const found = [];
        for (const f of folders) await walk(path.resolve(f), found);
        const known = new Map(sdb.all('SELECT id, path, size, mtime FROM files').map((r) => [r.path, r]));
        const seen = new Set(found.map((f) => f.path));
        // Forget files that were deleted or are no longer in a watched folder.
        sdb.transaction(() => {
          for (const [p, r] of known) if (!seen.has(p) || !inFolders(p)) { sdb.run('DELETE FROM files WHERE id = ?', [r.id]); sdb.run('DELETE FROM docs WHERE rowid = ?', [r.id]); }
        });
        const todo = found.filter((f) => { const k = known.get(f.path); return !k || k.size !== f.size || Math.abs(k.mtime - f.mtime) > 1; });
        status = { ...status, state: todo.length ? 'reading' : 'idle', done: 0, total: todo.length };
        onProgress(status);
        for (const f of todo) {
          status.current = path.basename(f.path);
          onProgress(status);
          const r = await readFile(f.path);
          const name = path.basename(f.path);
          const ext = path.extname(f.path).toLowerCase();
          sdb.transaction(() => {
            const old = sdb.get('SELECT id FROM files WHERE path = ?', [f.path]);
            let id;
            if (old) {
              id = old.id;
              sdb.run("UPDATE files SET size = ?, mtime = ?, indexed_at = datetime('now'), error = ?, facts = ?, folder = ? WHERE id = ?",
                [f.size, f.mtime, r.ok ? '' : r.error, JSON.stringify(r.ok ? r.facts : {}), f.folder, id]);
              sdb.run('DELETE FROM docs WHERE rowid = ?', [id]);
            } else {
              sdb.run("INSERT INTO files (path, name, ext, folder, size, mtime, indexed_at, error, facts) VALUES (?,?,?,?,?,?,datetime('now'),?,?)",
                [f.path, name, ext, f.folder, f.size, f.mtime, r.ok ? '' : r.error, JSON.stringify(r.ok ? r.facts : {})]);
              id = sdb.get('SELECT last_insert_rowid() AS id').id;
            }
            sdb.run('INSERT INTO docs (rowid, name, body, extra) VALUES (?,?,?,?)', [id, name.replace(/[._-]+/g, ' '), r.ok ? r.text : '', r.ok ? phoneTokens(r.facts) : '']);
          });
          status.done++;
          onProgress(status);
        }
      } while (rescan);
    } finally {
      scanning = false;
      const c = sdb.get("SELECT COUNT(*) AS n, SUM(CASE WHEN error <> '' THEN 1 ELSE 0 END) AS e FROM files");
      status = { ...status, state: 'idle', current: '', lastScan: new Date().toISOString(), files: c.n, errors: c.e || 0 };
      sdb.save();
      onProgress(status);
    }
    return status;
  }

  // ---------- watching ----------
  let debounce = null;
  function setFolders(list) {
    folders = (list || []).filter((f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } });
    for (const [f, w] of watchers) if (!folders.includes(f)) { try { w.close(); } catch { /* ignore */ } watchers.delete(f); }
    for (const f of folders) {
      if (watchers.has(f)) continue;
      try {
        const w = fs.watch(f, { recursive: true }, () => { clearTimeout(debounce); debounce = setTimeout(() => scan().catch(() => {}), 4000); });
        w.on('error', () => {});
        watchers.set(f, w);
      } catch { /* recursive watch not available here; the periodic scan covers it */ }
    }
  }

  // ---------- searching ----------
  function ftsQuery(q) {
    const raw = String(q || '').trim();
    const digits = phoneDigits(raw);
    const looksPhone = /^[\d\s().+-]+$/.test(raw) && (digits.length === 10 || digits.length === 7);
    if (looksPhone) return { fts: `extra:p${digits}`, phone: digits };
    const phrases = [];
    const rest = raw.replace(/"([^"]+)"/g, (_m, p) => { phrases.push(p); return ' '; });
    const words = rest.toLowerCase().split(/[^\p{L}\p{N}@.]+/u).map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w.length > 0).slice(0, 12);
    const parts = [
      ...phrases.map((p) => `"${p.replace(/"/g, '')}"`),
      ...words.map((w) => (w.includes('@') || w.includes('.') ? `"${w}"` : `${w}*`)),
    ];
    return { fts: parts.join(' '), phone: null };
  }

  function searchFiles(q, limit = 60) {
    const { fts, phone } = ftsQuery(q);
    if (!fts) return [];
    try {
      const rows = sdb.all(`SELECT f.id, f.path, f.name, f.ext, f.size, f.mtime, f.error, snippet(docs, '[[', ']]', ' … ', 1, 14) AS snip
        FROM docs JOIN files f ON f.id = docs.rowid WHERE docs MATCH ? ORDER BY f.mtime DESC LIMIT ?`, [fts, limit]);
      if (phone) {
        // Show where the number appears, in whatever format the file used.
        const d = phone.split('');
        const re = phone.length === 10
          ? new RegExp(`${d.slice(0, 3).join('')}\\D{0,3}${d.slice(3, 6).join('')}\\D{0,2}${d.slice(6).join('')}`)
          : new RegExp(`${d.slice(0, 3).join('')}\\D{0,2}${d.slice(3).join('')}`);
        for (const r of rows) {
          const body = (sdb.get('SELECT body FROM docs WHERE rowid = ?', [r.id]) || {}).body || '';
          const m = body.match(re);
          if (m) {
            const a = Math.max(0, m.index - 70), b = Math.min(body.length, m.index + m[0].length + 70);
            r.snip = `${a ? '… ' : ''}${body.slice(a, m.index)}[[${m[0]}]]${body.slice(m.index + m[0].length, b)}${b < body.length ? ' …' : ''}`.replace(/\s+/g, ' ');
          }
        }
      }
      return rows;
    } catch { return []; }
  }

  function searchCrm(q) {
    const raw = String(q || '').trim();
    if (!raw) return { contacts: [], leads: [], deals: [], notes: [], analyses: [] };
    const { phone } = ftsQuery(raw);
    const like = `%${raw.slice(0, 80)}%`;
    const out = {};
    if (phone) {
      const tail = phone.slice(-4);
      const has = (s) => phoneDigits(s).includes(phone) || String(s || '').replace(/\D/g, '').includes(phone);
      out.contacts = mainDb.all('SELECT id, first_name, last_name, company, phone, more_phones, kind, role FROM contacts WHERE phone LIKE ? OR more_phones LIKE ? OR extra LIKE ? OR phone2 LIKE ? LIMIT 400', [`%${tail}%`, `%${tail}%`, `%${tail}%`, `%${tail}%`])
        .filter((c) => has(c.phone) || has(c.more_phones) || has(c.phone2)).slice(0, 30);
      const ids = out.contacts.map((c) => c.id);
      out.leads = mainDb.all(`SELECT li.id, li.title, li.address, li.city, li.status, li.people, li.extra, li.contact_id, l.name AS list FROM list_items li JOIN lists l ON l.id = li.list_id
        WHERE ${ids.length ? `li.contact_id IN (${ids.map(Number).join(',')}) OR ` : ''}li.people LIKE ? OR li.extra LIKE ? LIMIT 400`, [`%${tail}%`, `%${tail}%`])
        .filter((r) => ids.includes(r.contact_id) || String(r.people).replace(/\D/g, '').includes(phone) || String(r.extra).replace(/\D/g, '').includes(phone))
        .map(({ people, extra, ...r }) => r).slice(0, 30);
      out.deals = [];
      out.notes = mainDb.all('SELECT id, kind, body, contact_id, deal_id, created_at FROM activities WHERE body LIKE ? ORDER BY created_at DESC LIMIT 30', [`%${tail}%`]).filter((a) => phoneDigits(a.body).includes(phone));
      out.analyses = [];
      return out;
    }
    out.contacts = mainDb.all(`SELECT id, first_name, last_name, company, phone, kind, role FROM contacts
      WHERE (first_name || ' ' || last_name) LIKE ? OR company LIKE ? OR email LIKE ? OR emails2 LIKE ? OR notes LIKE ? OR tags LIKE ? OR city LIKE ? LIMIT 30`, [like, like, like, like, like, like, like]);
    out.leads = mainDb.all(`SELECT li.id, li.title, li.address, li.city, li.status, l.name AS list FROM list_items li JOIN lists l ON l.id = li.list_id
      WHERE li.title LIKE ? OR li.address LIKE ? OR li.notes LIKE ? OR li.people LIKE ? LIMIT 30`, [like, like, like, like]);
    out.deals = mainDb.all('SELECT id, address, city, state, stage FROM deals WHERE address LIKE ? OR city LIKE ? OR notes LIKE ? OR source LIKE ? LIMIT 30', [like, like, like, like]);
    out.notes = mainDb.all('SELECT id, kind, body, contact_id, deal_id, created_at FROM activities WHERE body LIKE ? ORDER BY created_at DESC LIMIT 30', [like]);
    out.analyses = mainDb.all('SELECT id, name, address FROM analyses WHERE name LIKE ? OR address LIKE ? LIMIT 20', [like, like]);
    return out;
  }

  function query(q) {
    return { files: searchFiles(q), crm: searchCrm(q), status };
  }

  // A file's matching lines (for turning a line into a contact, lead or task).
  function fileDetail(id, q) {
    const f = sdb.get('SELECT * FROM files WHERE id = ?', [Number(id)]);
    if (!f) throw new Error('File not found');
    const body = (sdb.get('SELECT body FROM docs WHERE rowid = ?', [f.id]) || {}).body || '';
    const lines = body.split(/\r?\n/);
    const { phone } = ftsQuery(q);
    const terms = phone ? [] : String(q || '').toLowerCase().replace(/"/g, ' ').split(/\s+/).filter((w) => w.length > 1);
    const hits = [];
    lines.forEach((line, i) => {
      if (hits.length >= 80 || !line.trim()) return;
      const l = line.toLowerCase();
      if (phone ? phoneDigits(line.replace(/[^\d]/g, ' ').replace(/\s/g, '')).includes(phone) || line.replace(/\D/g, '').includes(phone) : terms.every((t) => l.includes(t))) hits.push({ n: i + 1, text: line.slice(0, 600) });
    });
    return { ...f, facts: JSON.parse(f.facts || '{}'), hits, lines: lines.length, preview: hits.length ? '' : body.slice(0, 3000) };
  }

  const recent = (n = 6) => sdb.all("SELECT id, path, name, ext, mtime FROM files WHERE error = '' ORDER BY mtime DESC LIMIT ?", [Math.min(50, Number(n) || 6)]);
  const isIndexed = (p) => !!sdb.get('SELECT id FROM files WHERE path = ?', [p]);
  const stats = () => ({ ...status, folders, byType: sdb.all('SELECT ext, COUNT(*) AS n FROM files GROUP BY ext ORDER BY n DESC') });
  const close = () => { for (const [, w] of watchers) { try { w.close(); } catch { /* ignore */ } } try { worker && worker.kill(); } catch { /* ignore */ } sdb.save(); };
  return { sdb, open: () => sdb.open(), setFolders, scan, query, fileDetail, isIndexed, stats, close, ftsQuery, recent };
}

module.exports = { createSearch, phoneTokens };
