// Finds the web browsers installed on this Windows PC and opens sites in the one you pick.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const KIND = [
  [/\\(chrome|msedge|brave|vivaldi|opera|launcher|chromium|thorium|arc)\.exe$/i, 'chromium'],
  [/\\(firefox|librewolf|waterfox|floorp)\.exe$/i, 'firefox'],
];
const kindOf = (exe) => (KIND.find(([re]) => re.test(exe)) || [null, 'other'])[1];
const idOf = (exe) => path.win32.basename(exe).replace(/\.exe$/i, '').toLowerCase();

// Parses `reg query ...\StartMenuInternet /s` (the list Windows uses for "Default apps").
function parseRegistry(text) {
  const found = {};
  let key = '';
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (/^HKEY_/i.test(line)) { key = line; continue; }
    const m = /^\s+\(.*?\)\s+REG_(?:EXPAND_)?SZ\s+(.+)$/.exec(line); // the "(Default)" value, any language
    if (!m || !key) continue;
    const k = /\\StartMenuInternet\\([^\\]+)(\\shell\\open\\command)?$/i.exec(key);
    if (!k) continue;
    const entry = (found[k[1]] = found[k[1]] || {});
    if (k[2]) {
      const v = m[1].trim();
      entry.path = v.startsWith('"') ? v.slice(1, v.indexOf('"', 1)) : v.split(/\s+-/)[0].trim();
    } else {
      entry.name = m[1].trim();
    }
  }
  return Object.entries(found)
    .filter(([, e]) => e.path && /\.exe$/i.test(e.path) && !/iexplore\.exe$/i.test(e.path))
    .map(([regKey, e]) => ({ id: idOf(e.path), name: e.name || regKey, path: e.path, kind: kindOf(e.path) }));
}

function knownPaths(env = process.env) {
  const L = env.LOCALAPPDATA, P = env.ProgramFiles, X = env['ProgramFiles(x86)'];
  const j = (...p) => (p.every(Boolean) ? path.win32.join(...p) : null);
  return [
    ['Google Chrome', j(P, 'Google', 'Chrome', 'Application', 'chrome.exe')],
    ['Google Chrome', j(X, 'Google', 'Chrome', 'Application', 'chrome.exe')],
    ['Google Chrome', j(L, 'Google', 'Chrome', 'Application', 'chrome.exe')],
    ['Microsoft Edge', j(X, 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
    ['Microsoft Edge', j(P, 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
    ['Mozilla Firefox', j(P, 'Mozilla Firefox', 'firefox.exe')],
    ['Mozilla Firefox', j(X, 'Mozilla Firefox', 'firefox.exe')],
    ['Brave', j(P, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')],
    ['Brave', j(L, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')],
    ['Opera', j(L, 'Programs', 'Opera', 'launcher.exe')],
    ['Opera GX', j(L, 'Programs', 'Opera GX', 'launcher.exe')],
    ['Vivaldi', j(L, 'Vivaldi', 'Application', 'vivaldi.exe')],
  ].filter(([, p]) => p);
}

function regQuery(hive) {
  return new Promise((resolve) => {
    execFile('reg', ['query', `${hive}\\SOFTWARE\\Clients\\StartMenuInternet`, '/s'], { windowsHide: true, timeout: 5000 },
      (err, stdout) => resolve(err ? '' : stdout));
  });
}

// Every installed browser, once each, in a friendly order.
async function detectBrowsers({ exists = fs.existsSync, env = process.env, platform = process.platform, reg = regQuery } = {}) {
  let list = [];
  if (platform === 'win32') {
    for (const hive of ['HKCU', 'HKLM']) {
      list = list.concat(parseRegistry(await reg(hive)));
    }
  }
  for (const [name, p] of knownPaths(env)) {
    if (exists(p)) list.push({ id: idOf(p), name, path: p, kind: kindOf(p) });
  }
  const seen = new Map();
  for (const b of list) {
    if (!exists(b.path)) continue;
    const id = b.id === 'launcher' ? (/gx/i.test(b.path) ? 'operagx' : 'opera') : b.id;
    if (!seen.has(id)) seen.set(id, { ...b, id });
  }
  const order = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'operagx', 'vivaldi'];
  return [...seen.values()].sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
  });
}

// Command-line arguments to open `url`. With a separate profile, the hub gets its own sign-in
// in that browser (Google asks you to log in once), apart from your everyday browsing.
function launchArgs(browser, url, profileDir) {
  if (browser.kind === 'chromium') {
    const a = [`--app=${url}`, '--no-first-run', '--no-default-browser-check'];
    if (profileDir) a.unshift(`--user-data-dir=${profileDir}`);
    return a;
  }
  if (browser.kind === 'firefox') {
    return profileDir ? ['-profile', profileDir, '-new-window', url] : ['-new-window', url];
  }
  return [url];
}

module.exports = { parseRegistry, detectBrowsers, launchArgs, kindOf };
