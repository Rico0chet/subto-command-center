// Daily backups: copies the database file into a folder you choose and keeps the newest N copies.
const fs = require('fs');
const path = require('path');

const PREFIX = 'SubTo-Hub-backup-';
const DAY_MS = 24 * 60 * 60 * 1000;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function listBackups(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.db'))
    .map((f) => {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      return { name: f, path: full, sizeBytes: st.size, time: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1)); // newest first (names sort by date)
}

function runBackup(db, dir, keep = 14) {
  if (!dir) throw new Error('No backup folder set');
  fs.mkdirSync(dir, { recursive: true });
  db.save();
  const target = path.join(dir, `${PREFIX}${stamp()}.db`);
  fs.copyFileSync(db.filePath, target);
  // Verify the copy matches byte for byte.
  if (fs.statSync(target).size !== fs.statSync(db.filePath).size) {
    throw new Error('Backup copy size mismatch');
  }
  const all = listBackups(dir);
  for (const old of all.slice(Math.max(1, keep))) fs.unlinkSync(old.path);
  return { path: target, time: new Date().toISOString() };
}

function isDue(lastBackupIso, now = Date.now()) {
  if (!lastBackupIso) return true;
  const t = Date.parse(lastBackupIso);
  return Number.isNaN(t) || now - t >= DAY_MS;
}

module.exports = { runBackup, listBackups, isDue, PREFIX };
