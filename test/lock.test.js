const test = require('node:test');
const assert = require('node:assert');
const L = require('../electron/lock');
const S = require('../electron/sites');

const fbLock = { key: 'subtogroup', aliases: ['123456789'], home: 'https://www.facebook.com/groups/subtogroup' };
const dLock = { key: '111222333444555666', home: 'https://discord.com/channels/111222333444555666' };
const fb = (u) => L.checkUrl('facebook', fbLock, u);
const dc = (u) => L.checkUrl('discord', dLock, u);

test('lock target comes from the group or server you are on', () => {
  assert.deepStrictEqual(L.lockTargetFromUrl('facebook', 'https://www.facebook.com/groups/subtogroup/posts/987'),
    { key: 'subtogroup', home: 'https://www.facebook.com/groups/subtogroup' });
  assert.strictEqual(L.lockTargetFromUrl('facebook', 'https://www.facebook.com/groups/feed/'), null);
  assert.strictEqual(L.lockTargetFromUrl('facebook', 'https://www.facebook.com/'), null);
  assert.deepStrictEqual(L.lockTargetFromUrl('discord', 'https://discord.com/channels/111222333444555666/999888777666555444'),
    { key: '111222333444555666', home: 'https://discord.com/channels/111222333444555666/999888777666555444' });
  assert.strictEqual(L.lockTargetFromUrl('discord', 'https://discord.com/channels/@me'), null);
});

test('Facebook: everything inside the SubTo group is allowed', () => {
  for (const u of [
    'https://www.facebook.com/groups/subtogroup',
    'https://www.facebook.com/groups/SubToGroup/posts/12345/',
    'https://www.facebook.com/groups/subtogroup/permalink/555/',
    'https://www.facebook.com/groups/subtogroup/user/100001/',
    'https://www.facebook.com/groups/subtogroup/members',
    'https://www.facebook.com/groups/123456789/posts/777',
    'https://www.facebook.com/photo/?fbid=1&set=g.123456789',
    'https://www.facebook.com/login/?next=x',
    'https://www.facebook.com/checkpoint/1501092823525282/',
  ]) assert.strictEqual(fb(u), 'allow', u);
});

test('Facebook: feed, profiles, search, Marketplace, Messenger and other groups are blocked', () => {
  for (const u of [
    'https://www.facebook.com/',
    'https://www.facebook.com/phillip.hone',
    'https://www.facebook.com/profile.php?id=100',
    'https://www.facebook.com/search/top?q=house',
    'https://www.facebook.com/marketplace/',
    'https://www.facebook.com/messages/t/123',
    'https://www.facebook.com/watch/',
    'https://www.facebook.com/groups/othergroup',
    'https://www.facebook.com/groups/feed/',
    'https://www.facebook.com/friends',
  ]) assert.strictEqual(fb(u), 'block', u);
});

test('Facebook: outside links open in your normal browser', () => {
  assert.deepStrictEqual(fb('https://l.facebook.com/l.php?u=https%3A%2F%2Fzillow.com%2Fx&h=abc'), { external: 'https://zillow.com/x' });
  assert.deepStrictEqual(fb('https://www.zillow.com/homedetails/1'), { external: 'https://www.zillow.com/homedetails/1' });
});

test('Discord: every channel in the SubTo server is allowed', () => {
  assert.strictEqual(dc('https://discord.com/channels/111222333444555666'), 'allow');
  assert.strictEqual(dc('https://discord.com/channels/111222333444555666/999/888'), 'allow');
  assert.strictEqual(dc('https://discord.com/login'), 'allow');
});

test('Discord: DMs, other servers, store and discovery are blocked', () => {
  for (const u of [
    'https://discord.com/channels/@me',
    'https://discord.com/channels/@me/123',
    'https://discord.com/channels/999999999999999999/1',
    'https://discord.com/app',
    'https://discord.com/store',
    'https://discord.com/shop',
    'https://discord.com/guild-discovery',
  ]) assert.strictEqual(dc(u), 'block', u);
});

test('no lock means no restrictions', () => {
  assert.strictEqual(L.checkUrl('facebook', null, 'https://www.facebook.com/marketplace'), 'allow');
});

test('PIN is stored hashed and checked correctly', () => {
  const h = L.hashPin('4321');
  assert.ok(!h.includes('4321'));
  assert.ok(L.checkPin('4321', h));
  assert.ok(!L.checkPin('1234', h));
  assert.ok(!L.checkPin('', h));
  assert.ok(L.checkPin('anything', '')); // no PIN set
  assert.ok(L.validPin('1234') && L.validPin('12345678'));
  assert.ok(!L.validPin('123') && !L.validPin('abcd'));
});

test('a locked site always opens at its lock home inside the hub', () => {
  const sites = S.mergeSites({ siteLocks: { facebook: fbLock }, siteModes: { facebook: 'window' } });
  const f = sites.find((s) => s.id === 'facebook');
  assert.strictEqual(f.url, fbLock.home);
  assert.strictEqual(f.mode, 'tab');
  assert.ok(f.lockable);
  assert.strictEqual(sites.find((s) => s.id === 'voice').lockable, false);
});

test('Discord server name is read from the page title and must be Creative Campus', () => {
  assert.strictEqual(L.serverNameFromTitle('Discord | #general | Creative Campus'), 'Creative Campus');
  assert.strictEqual(L.serverNameFromTitle('(3) #deal-chat | Creative Campus'), 'Creative Campus');
  assert.strictEqual(L.serverNameFromTitle('Discord'), '');
  assert.strictEqual(L.serverNameFromTitle('Discord | @someone'), '');
  assert.ok(L.titleMatches('Discord | #general | Creative Campus', 'Creative Campus'));
  assert.ok(L.titleMatches('#wins | creative campus', 'Creative Campus'));
  assert.ok(!L.titleMatches('Discord | #general | Some Other Server', 'Creative Campus'));
});
