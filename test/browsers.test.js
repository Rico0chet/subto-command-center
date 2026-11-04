const test = require('node:test');
const assert = require('node:assert');
const B = require('../electron/browsers');

const REG = [
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\Google Chrome',
  '    (Default)    REG_SZ    Google Chrome',
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\Google Chrome\\shell\\open\\command',
  '    (Default)    REG_SZ    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"',
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\Microsoft Edge',
  '    (Default)    REG_SZ    Microsoft Edge',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\Microsoft Edge\\Capabilities',
  '    ApplicationName    REG_SZ    Microsoft Edge',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\Microsoft Edge\\shell\\open\\command',
  '    (Default)    REG_SZ    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\FIREFOX.EXE',
  '    (Standard)    REG_SZ    Mozilla Firefox',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\FIREFOX.EXE\\shell\\open\\command',
  '    (Standard)    REG_SZ    "C:\\Program Files\\Mozilla Firefox\\firefox.exe"',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\IEXPLORE.EXE',
  '    (Default)    REG_SZ    Internet Explorer',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\IEXPLORE.EXE\\shell\\open\\command',
  '    (Default)    REG_SZ    "C:\\Program Files\\Internet Explorer\\iexplore.exe"',
].join('\r\n');

test('reads installed browsers from the Windows registry (any language), skipping Internet Explorer', () => {
  const list = B.parseRegistry(REG);
  assert.deepStrictEqual(list.map((b) => [b.id, b.name, b.kind]), [
    ['chrome', 'Google Chrome', 'chromium'],
    ['msedge', 'Microsoft Edge', 'chromium'],
    ['firefox', 'Mozilla Firefox', 'firefox'],
  ]);
  assert.strictEqual(list[1].path, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
});

test('detects each browser once, only if it is really installed, in a friendly order', async () => {
  const brave = 'C:\\Users\\p\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
  const installed = new Set([
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    brave,
  ]);
  const list = await B.detectBrowsers({
    platform: 'win32',
    reg: async (hive) => (hive === 'HKLM' ? REG : ''),
    exists: (p) => installed.has(p),
    env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local' },
  });
  assert.deepStrictEqual(list.map((b) => b.id), ['chrome', 'msedge', 'brave']); // Firefox listed in registry but not on disk
});

test('launch options: app window + separate hub sign-in for Chrome-type browsers; Firefox gets its own profile', () => {
  const chrome = { kind: 'chromium' };
  assert.deepStrictEqual(B.launchArgs(chrome, 'https://voice.google.com', 'C:\\hub\\chrome'),
    ['--user-data-dir=C:\\hub\\chrome', '--app=https://voice.google.com', '--no-first-run', '--no-default-browser-check']);
  assert.deepStrictEqual(B.launchArgs(chrome, 'https://voice.google.com', null),
    ['--app=https://voice.google.com', '--no-first-run', '--no-default-browser-check']);
  assert.deepStrictEqual(B.launchArgs({ kind: 'firefox' }, 'https://drive.google.com', 'C:\\hub\\ff'),
    ['-profile', 'C:\\hub\\ff', '-new-window', 'https://drive.google.com']);
  assert.deepStrictEqual(B.launchArgs({ kind: 'other' }, 'https://x.com', 'C:\\p'), ['https://x.com']);
});
