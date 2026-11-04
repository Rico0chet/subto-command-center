const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createDiscordKeeper, READ_JS } = require('../electron/discordKeeper');

// A pretend Discord tab: its local storage, page, and the hub's calls into it.
function fakeTab(store) {
  const c = new EventEmitter();
  c.loads = [];
  c.isDestroyed = () => false;
  c.page = { hostname: 'discord.com', pathname: '/app' };
  c.executeJavaScript = async (js) => {
    if (js === READ_JS) return { token: store.token ?? null, loginPage: false };
    const m = js.match(/setItem\('token', ("(?:[^"\\]|\\.)*")\)/);
    if (m) { store.token = JSON.parse(m[1]); return true; }
    return null;
  };
  c.loadURL = (u) => c.loads.push(u);
  return c;
}
const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`enc:${s}`), decryptString: (b) => String(b).slice(4) };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('Discord sign-in is saved, put back after a restart, and forgotten when you log out', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-'));
  // Session 1: signed in → saved (encrypted) at shutdown.
  let k = createDiscordKeeper({ dataDir, safeStorage, isDiscord: () => true });
  const store1 = { token: '"secret-token"' };
  await k.snapshot([fakeTab(store1)]);
  assert.ok(fs.readFileSync(path.join(dataDir, 'discord-signin.bin')).toString().startsWith('enc:'));
  // Session 2: Discord lost the sign-in → the hub puts it back and reloads once.
  k = createDiscordKeeper({ dataDir, safeStorage, isDiscord: () => true });
  const store2 = {};
  const tab = fakeTab(store2);
  k.watch(tab);
  tab.emit('did-finish-load');
  await wait(1700);
  assert.strictEqual(store2.token, '"secret-token"');
  assert.deepStrictEqual(tab.loads, ['https://discord.com/app']);
  // Signed in now; then you log out inside Discord → the copy is deleted, not restored.
  tab.emit('did-finish-load');
  await wait(1700);
  delete store2.token;
  tab.emit('did-navigate-in-page');
  await wait(1700);
  assert.strictEqual(fs.existsSync(path.join(dataDir, 'discord-signin.bin')), false);
  assert.strictEqual(k.hasSaved(), false);
  tab.emit('destroyed');
});
