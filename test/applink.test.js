const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
// webviews.js needs Electron; give it a stub so the pure helper can be tested.
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? {} : orig.call(this, req, ...rest); };
const { isDesktopAppBridge } = require('../electron/webviews');
Module._load = orig;

test('Discord desktop-app hand-off ports are blocked; normal local and web addresses are not', () => {
  assert.ok(isDesktopAppBridge('http://127.0.0.1:6463/rpc?v=1'));
  assert.ok(isDesktopAppBridge('ws://localhost:6472/?v=1'));
  assert.ok(!isDesktopAppBridge('http://127.0.0.1:8080/'));
  assert.ok(!isDesktopAppBridge('https://discord.com/channels/1/2'));
  assert.ok(!isDesktopAppBridge('not a url'));
});
