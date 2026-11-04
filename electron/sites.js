// Built-in website tabs. Each site gets its own saved login ("partition"),
// except Google sites, which share one so a single Google sign-in covers Voice and Drive.
const DEFAULT_SITES = [
  { id: 'facebook', label: 'Facebook', group: 'Community', icon: 'globe', url: 'https://www.facebook.com/groups/', partition: 'persist:facebook',
    hint: 'Tip: open your SubTo group, then click "Set as home" so this tab always opens there.' },
  { id: 'discord', label: 'Discord', group: 'Community', icon: 'chat', url: 'https://discord.com/app', partition: 'persist:discord' },
  { id: 'subto', label: 'SubTo Site', group: 'Community', icon: 'star', url: 'https://subto.com', partition: 'persist:subto',
    hint: 'If SubTo uses a different login page, go there and click "Set as home".' },
  { id: 'voice', label: 'Google Voice', group: 'Tools', icon: 'phone', url: 'https://voice.google.com', partition: 'persist:google', google: true },
  { id: 'docuseal', label: 'DocuSeal', group: 'Tools', icon: 'pen', url: 'https://docuseal.com/sign_in', partition: 'persist:docuseal' },
  { id: 'drive', label: 'Google Drive', group: 'Tools', icon: 'folder', url: 'https://drive.google.com', partition: 'persist:google', google: true },
  { id: 'calendly', label: 'Calendly', group: 'Tools', icon: 'clock', url: 'https://calendly.com/app/login', partition: 'persist:calendly' },
];

const isWebUrl = (u) => {
  try { const p = new URL(u); return p.protocol === 'https:' || p.protocol === 'http:'; }
  catch { return false; }
};

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'site';

// Combine the defaults with the user's saved home pages and custom sites.
function mergeSites(saved = {}) {
  const homes = saved.siteHomes || {};
  const modes = saved.siteModes || {};
  const locks = saved.siteLocks || {};
  const builtIn = DEFAULT_SITES.map((s) => ({
    ...s,
    defaultUrl: s.url,
    url: isWebUrl(homes[s.id]) ? homes[s.id] : s.url,
    // Google blocks sign-in inside embedded apps, so Google sites open in a real browser window by default.
    mode: modes[s.id] === 'tab' || modes[s.id] === 'window' ? modes[s.id] : (s.google ? 'window' : 'tab'),
    lockable: s.id === 'facebook' || s.id === 'discord',
    lock: (s.id === 'facebook' || s.id === 'discord') && locks[s.id] && locks[s.id].key ? locks[s.id] : null,
    custom: false,
  })).map((s) => (s.lock ? { ...s, url: s.lock.home, mode: 'tab' } : s));
  const custom = (saved.customSites || [])
    .filter((c) => c && c.id && c.label && isWebUrl(c.url))
    .map((c) => ({ id: c.id, label: c.label, group: 'My Sites', icon: 'globe', url: c.url, defaultUrl: c.url,
      partition: `persist:custom-${c.id}`, custom: true,
      mode: modes[c.id] === 'window' ? 'window' : 'tab' }));
  return [...builtIn, ...custom];
}

function makeCustomSite(label, url, existingIds) {
  const name = String(label || '').trim();
  if (!name) throw new Error('Give the site a name');
  let u = String(url || '').trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^https?:\/\//i.test(u)) throw new Error('That web address doesn\'t look right');
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  if (!isWebUrl(u)) throw new Error('That web address doesn\'t look right');
  let id = 'c-' + slug(name);
  let n = 2;
  while (existingIds.includes(id)) id = `c-${slug(name)}-${n++}`;
  return { id, label: name.slice(0, 40), url: u };
}

// "(3) Facebook" -> 3 ; "Discord | #general" -> 0
function unreadFromTitle(title) {
  const m = /^\s*\((\d{1,4})\+?\)/.exec(String(title || ''));
  return m ? Number(m[1]) : 0;
}

// A normal Chrome user agent, so sites (especially Google sign-in) treat the hub like Chrome.
function chromeUserAgent(chromeVersion) {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

// Google accepts sign-in from Firefox-looking browsers more often than from embedded Chrome.
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
const isGoogleAuth = (url) => /^https:\/\/accounts\.google\.com\//i.test(String(url));

// Real browsers on Windows, in order of preference, for "open in its own window".
function browserCandidates(env = process.env) {
  const p = require('path');
  const out = [];
  const add = (...parts) => { if (parts.every(Boolean)) out.push(p.join(...parts)); };
  add(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe');
  add(env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe');
  add(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe');
  add(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  add(env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  add(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  return out;
}

// Sign-in popups that must stay inside the app (same saved login).
const AUTH_HOSTS = [
  'accounts.google.com', 'www.facebook.com', 'm.facebook.com', 'discord.com',
  'login.microsoftonline.com', 'appleid.apple.com', 'calendly.com', 'docuseal.com',
];
function isAuthPopup(url) {
  try {
    const h = new URL(url).hostname;
    return AUTH_HOSTS.includes(h) && /login|signin|sign_in|oauth|auth|dialog|consent/i.test(url);
  } catch { return false; }
}

function sameSite(a, b) {
  try {
    const base = (h) => h.split('.').slice(-2).join('.');
    return base(new URL(a).hostname) === base(new URL(b).hostname);
  } catch { return false; }
}

// Downloads: never overwrite an existing file. "deal.xlsx" -> "deal (2).xlsx"
function uniqueName(name, exists) {
  const clean = String(name || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'download';
  if (!exists(clean)) return clean;
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : '';
  for (let i = 2; i < 10000; i++) {
    const c = `${stem} (${i})${ext}`;
    if (!exists(c)) return c;
  }
  return `${stem}-${Date.now()}${ext}`;
}

module.exports = {
  DEFAULT_SITES, mergeSites, makeCustomSite, unreadFromTitle, chromeUserAgent,
  isAuthPopup, sameSite, uniqueName, isWebUrl, FIREFOX_UA, isGoogleAuth, browserCandidates,
};
