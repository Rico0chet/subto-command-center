const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../electron/sites');
const { findZoomOrganizer } = require('../electron/launcher');

test('all built-in sites are present with saved-login partitions', () => {
  const ids = S.mergeSites({}).map((s) => s.id);
  assert.deepStrictEqual(ids, ['facebook', 'discord', 'subto', 'voice', 'docuseal', 'drive', 'calendly']);
  for (const s of S.mergeSites({})) assert.match(s.partition, /^persist:/);
});

test('Google Voice and Drive share one Google sign-in; others are separate', () => {
  const by = Object.fromEntries(S.mergeSites({}).map((s) => [s.id, s.partition]));
  assert.strictEqual(by.voice, by.drive);
  assert.notStrictEqual(by.facebook, by.discord);
  assert.notStrictEqual(by.facebook, by.voice);
});

test('saved home pages override defaults; bad ones are ignored', () => {
  const sites = S.mergeSites({ siteHomes: { facebook: 'https://www.facebook.com/groups/subto', discord: 'javascript:alert(1)' } });
  const fb = sites.find((s) => s.id === 'facebook');
  assert.strictEqual(fb.url, 'https://www.facebook.com/groups/subto');
  assert.strictEqual(fb.defaultUrl, 'https://www.facebook.com/groups/');
  assert.strictEqual(sites.find((s) => s.id === 'discord').url, 'https://discord.com/app');
});

test('custom sites get their own group, partition and unique ids', () => {
  const a = S.makeCustomSite('PropStream', 'app.propstream.com', []);
  assert.deepStrictEqual(a, { id: 'c-propstream', label: 'PropStream', url: 'https://app.propstream.com' });
  const b = S.makeCustomSite('PropStream', 'https://x.com', ['c-propstream']);
  assert.strictEqual(b.id, 'c-propstream-2');
  const merged = S.mergeSites({ customSites: [a] });
  const c = merged.find((s) => s.id === 'c-propstream');
  assert.strictEqual(c.group, 'My Sites');
  assert.strictEqual(c.partition, 'persist:custom-c-propstream');
  assert.throws(() => S.makeCustomSite('', 'x.com', []), /name/);
  assert.throws(() => S.makeCustomSite('Bad', 'ftp://x', []), /look right/);
});

test('unread counts read from page titles', () => {
  assert.strictEqual(S.unreadFromTitle('(3) Facebook'), 3);
  assert.strictEqual(S.unreadFromTitle('(12) Discord | #general'), 12);
  assert.strictEqual(S.unreadFromTitle('Facebook'), 0);
  assert.strictEqual(S.unreadFromTitle('Deal (2) notes'), 0);
});

test('user agent looks like normal Chrome (no "Electron")', () => {
  const ua = S.chromeUserAgent('130.0.6723.191');
  assert.match(ua, /Chrome\/130\.0\.6723\.191 Safari/);
  assert.doesNotMatch(ua, /Electron|SubTo/);
});

test('sign-in popups stay in the app; other links are recognized', () => {
  assert.ok(S.isAuthPopup('https://accounts.google.com/o/oauth2/auth?client_id=1'));
  assert.ok(!S.isAuthPopup('https://www.zillow.com/homedetails/123'));
  assert.ok(S.sameSite('https://docs.google.com/x', 'https://drive.google.com/'));
  assert.ok(!S.sameSite('https://zillow.com/x', 'https://www.facebook.com/'));
});

test('downloads never overwrite existing files and strip bad characters', () => {
  const existing = new Set(['deal.xlsx', 'deal (2).xlsx']);
  assert.strictEqual(S.uniqueName('deal.xlsx', (n) => existing.has(n)), 'deal (3).xlsx');
  assert.strictEqual(S.uniqueName('a:b?.pdf', () => false), 'a_b_.pdf');
  assert.strictEqual(S.uniqueName('', () => false), 'download');
});

test('finds Zoom Chat Organizer in install folders and on the desktop', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zco-'));
  const programs = path.join(root, 'Programs');
  const desktop = path.join(root, 'Desktop');
  fs.mkdirSync(path.join(programs, 'Zoom Chat Organizer'), { recursive: true });
  fs.mkdirSync(desktop);
  fs.writeFileSync(path.join(programs, 'Zoom Chat Organizer', 'Zoom Chat Organizer.exe'), '');
  fs.writeFileSync(path.join(programs, 'Zoom Chat Organizer', 'Uninstall Zoom Chat Organizer.exe'), '');
  fs.writeFileSync(path.join(desktop, 'Zoom Chat Organizer.lnk'), '');
  fs.writeFileSync(path.join(desktop, 'notes.txt'), '');
  const hits = findZoomOrganizer([programs, desktop, path.join(root, 'missing')]);
  assert.strictEqual(path.basename(hits[0]), 'Zoom Chat Organizer.exe');
  assert.ok(hits.some((h) => h.endsWith('.lnk')));
  assert.ok(!hits.some((h) => /Uninstall/.test(h)));
});

test('Google sites open in their own browser window by default; can switch back', () => {
  const by = (saved) => Object.fromEntries(S.mergeSites(saved).map((s) => [s.id, s.mode]));
  const d = by({});
  assert.strictEqual(d.voice, 'window');
  assert.strictEqual(d.drive, 'window');
  assert.strictEqual(d.facebook, 'tab');
  assert.strictEqual(d.discord, 'tab');
  const changed = by({ siteModes: { voice: 'tab', facebook: 'window', discord: 'bogus' } });
  assert.strictEqual(changed.voice, 'tab');
  assert.strictEqual(changed.facebook, 'window');
  assert.strictEqual(changed.discord, 'tab');
});

test('Google sign-in pages are recognized; browsers listed Chrome first, then Edge', () => {
  assert.ok(S.isGoogleAuth('https://accounts.google.com/v3/signin/identifier?x=1'));
  assert.ok(!S.isGoogleAuth('https://voice.google.com/u/0/calls'));
  assert.match(S.FIREFOX_UA, /Firefox\/\d+/);
  const list = S.browserCandidates({ ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\L' });
  assert.match(list[0], /chrome\.exe$/);
  assert.match(list.at(-1), /msedge\.exe$/);
});
