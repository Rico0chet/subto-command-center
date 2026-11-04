// Finds and opens your existing "Zoom Chat Organizer" app.
const fs = require('fs');
const path = require('path');

const NAME_RE = /zoom[\s._-]*chat[\s._-]*organi[sz]er/i;
const OPENABLE = /\.(exe|lnk|bat|cmd|url|appref-ms|html?|py|pyw)$/i;

function candidateDirs(env = process.env) {
  const dirs = [];
  const add = (...p) => { if (p.every(Boolean)) dirs.push(path.join(...p)); };
  add(env.LOCALAPPDATA, 'Programs');
  add(env.LOCALAPPDATA);
  add(env.ProgramFiles);
  add(env['ProgramFiles(x86)']);
  add(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  add(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  add(env.USERPROFILE, 'Desktop');
  add(env.USERPROFILE, 'OneDrive', 'Desktop');
  add(env.PUBLIC, 'Desktop');
  return dirs;
}

function safeList(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

// Looks up to two folders deep in the usual install and shortcut locations.
function findZoomOrganizer(dirs = candidateDirs()) {
  const hits = [];
  for (const dir of dirs) {
    for (const ent of safeList(dir)) {
      const full = path.join(dir, ent.name);
      if (!NAME_RE.test(ent.name)) continue;
      if (ent.isFile() && OPENABLE.test(ent.name)) hits.push(full);
      else if (ent.isDirectory()) {
        for (const sub of safeList(full)) {
          if (sub.isFile() && /\.(exe|lnk)$/i.test(sub.name) && !/uninstall/i.test(sub.name)) hits.push(path.join(full, sub.name));
        }
      }
    }
  }
  // Prefer a real program (.exe) whose name matches, then shortcuts.
  const score = (p) => (/\.exe$/i.test(p) ? 0 : 1) + (NAME_RE.test(path.basename(p)) ? 0 : 2);
  return [...new Set(hits)].sort((a, b) => score(a) - score(b));
}

module.exports = { findZoomOrganizer, candidateDirs, NAME_RE };
