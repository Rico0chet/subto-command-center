// Main-process side of the built-in website tabs: saved logins, popups, permissions, downloads.
const { app, session, shell, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { chromeUserAgent, isAuthPopup, sameSite, uniqueName, isWebUrl, FIREFOX_UA, isGoogleAuth } = require('./sites');

const ALLOWED_PERMISSIONS = new Set([
  'media', 'notifications', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'mediaKeySystem',
]);

const { checkUrl, LOCK_CSS, FB_ALIAS_SCRIPT } = require('./lock');

const prepared = new Set();

// Local ports desktop apps listen on for websites to "hand off" to them (Discord: 6463-6472).
function isDesktopAppBridge(url) {
  try {
    const u = new URL(url);
    if (!/^(127\.0\.0\.1|localhost)$/i.test(u.hostname)) return false;
    const port = Number(u.port);
    return port >= 6463 && port <= 6472;
  } catch { return false; }
}

// getLock(siteId) -> lock or null; siteForPartition(partition) -> siteId or null (null for shared logins)
function setupWebviews({ getWin, getDownloadDir, partitions, getLock = () => null, siteForPartition = () => null, learnAliases = () => {} }) {
  const notify = (channel, data) => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send(channel, data);
  };
  const siteOf = (contents) => {
    for (const p of prepared) if (session.fromPartition(p) === contents.session) return siteForPartition(p);
    return null;
  };
  const ua = chromeUserAgent(process.versions.chrome);
  app.userAgentFallback = ua;

  const prepare = (partition) => {
    if (prepared.has(partition)) return;
    prepared.add(partition);
    const ses = session.fromPartition(partition);
    // The shared Google login looks like Firefox, which Google blocks less often inside apps.
    ses.setUserAgent(partition === 'persist:google' ? FIREFOX_UA : ua);
    // "Sign in with Google" on any site (DocuSeal, Calendly...): same Firefox look, no Chrome hints.
    ses.webRequest.onBeforeSendHeaders({ urls: ['https://accounts.google.com/*'] }, (details, cb) => {
      const h = { ...details.requestHeaders, 'User-Agent': FIREFOX_UA };
      for (const k of Object.keys(h)) if (/^sec-ch-ua/i.test(k)) delete h[k];
      cb({ requestHeaders: h });
    });
    ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
      if (permission === 'openExternal') {
        // Websites asking Windows to launch a desktop app (discord://, zoommtg://, ...) are refused,
        // so a site like Discord can't pull you out of the hub into its own app.
        notify('app-link-blocked', { url: details && details.externalURL });
        return cb(false);
      }
      cb(ALLOWED_PERMISSIONS.has(permission));
    });
    // Discord's website looks for the Discord desktop app on this PC (a local connection on
    // ports 6463-6472) and hands you over to it. Block that so Discord stays in the hub tab.
    ses.webRequest.onBeforeRequest({ urls: ['*://127.0.0.1/*', '*://localhost/*', 'ws://127.0.0.1/*', 'ws://localhost/*'] }, (details, cb) => {
      cb({ cancel: isDesktopAppBridge(details.url) });
    });
    ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
    ses.on('will-download', (_e, item) => {
      const dir = getDownloadDir();
      try { fs.mkdirSync(dir, { recursive: true }); } catch { /* reported below */ }
      const name = uniqueName(item.getFilename(), (n) => fs.existsSync(path.join(dir, n)));
      const target = path.join(dir, name);
      item.setSavePath(target);
      const send = (state) => {
        const w = getWin();
        if (w && !w.isDestroyed()) w.webContents.send('download', { name, path: target, state });
      };
      send('started');
      item.once('done', (_ev, state) => send(state)); // completed | cancelled | interrupted
    });
  };
  partitions().forEach(prepare);

  app.on('web-contents-created', (_e, contents) => {
    // Lock down every embedded website: no Node.js, no preload scripts, web addresses only.
    contents.on('will-attach-webview', (ev, webPreferences, params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      if (!isWebUrl(params.src) || !String(params.partition || '').startsWith('persist:')) {
        ev.preventDefault();
        return;
      }
      prepare(params.partition);
    });

    // Keep the page's own idea of the browser in step with the headers on Google sign-in pages.
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && isGoogleAuth(details.url) && contents.getUserAgent() !== FIREFOX_UA) {
        contents.setUserAgent(FIREFOX_UA);
      }
    });

    if (contents.getType() !== 'webview') return;

    // ---- Community lock: keep Facebook in the SubTo group and Discord in the SubTo server ----
    let lastAllowed = '';
    let bounces = [];
    const decide = (url) => {
      const siteId = siteOf(contents);
      const lock = siteId ? getLock(siteId) : null;
      return { siteId, lock, verdict: lock ? checkUrl(siteId, lock, url) : 'allow' };
    };
    const bounce = (siteId, lock, url, inPage) => {
      const now = Date.now();
      bounces = bounces.filter((t) => now - t < 8000);
      bounces.push(now);
      notify('lock-blocked', { siteId, url, stuck: bounces.length > 4 });
      if (bounces.length > 4) return; // stop a redirect loop; the tab shows a message instead
      if (inPage && lastAllowed && contents.canGoBack()) contents.goBack();
      else contents.loadURL(lastAllowed || lock.home);
    };
    const guard = (url, isMainFrame, inPage, ev) => {
      if (isMainFrame === false) return;
      const { siteId, lock, verdict } = decide(url);
      if (verdict === 'allow') { lastAllowed = url; return; }
      if (ev && ev.preventDefault) ev.preventDefault();
      if (verdict.external) {
        shell.openExternal(verdict.external);
        if (!ev) contents.loadURL(lastAllowed || lock.home);
        return;
      }
      if (ev) notify('lock-blocked', { siteId, url, stuck: false });
      else bounce(siteId, lock, url, inPage);
    };
    // Links that would launch a desktop app (discord://, etc.) never leave the hub.
    const appLink = (u) => { try { return !/^(https?|about|blob|data|javascript|chrome-error):$/i.test(new URL(u).protocol); } catch { return false; } };
    contents.on('will-frame-navigate', (e) => {
      if (appLink(e.url)) { e.preventDefault(); notify('app-link-blocked', { url: e.url }); }
    });
    contents.on('will-navigate', (e, url) => guard(e.url || url, e.isMainFrame, false, e));
    contents.on('will-redirect', (e, url) => guard(e.url || url, e.isMainFrame, false, e));
    contents.on('did-navigate', (_e, url) => guard(url, true, false, null));
    contents.on('did-navigate-in-page', (_e, url, isMainFrame) => guard(url, isMainFrame, true, null));
    contents.on('dom-ready', () => {
      const siteId = siteOf(contents);
      const lock = siteId ? getLock(siteId) : null;
      if (!lock || !LOCK_CSS[siteId]) return;
      contents.insertCSS(LOCK_CSS[siteId]).catch(() => {});
      if (siteId === 'facebook') {
        // Learn the group's other address (number vs. name) a few seconds after it loads.
        setTimeout(() => {
          if (contents.isDestroyed()) return;
          contents.executeJavaScript(FB_ALIAS_SCRIPT, true)
            .then((names) => { if (Array.isArray(names) && names.length) learnAliases(siteId, names); })
            .catch(() => {});
        }, 4000);
      }
    });

    contents.setWindowOpenHandler(({ url }) => {
      if (!isWebUrl(url)) return { action: 'deny' };
      const { siteId, verdict } = decide(url);
      if (verdict !== 'allow') {
        if (verdict.external) shell.openExternal(verdict.external);
        else notify('lock-blocked', { siteId, url, stuck: false });
        return { action: 'deny' };
      }
      if (isAuthPopup(url)) {
        // Sign-in windows ("Sign in with Google") stay in the app and share the tab's login.
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520, height: 720, autoHideMenuBar: true, parent: getWin() || undefined,
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
          },
        };
      }
      if (sameSite(url, contents.getURL())) {
        contents.loadURL(url); // same website: open in this tab
      } else {
        shell.openExternal(url); // other websites: your normal browser
      }
      return { action: 'deny' };
    });
  });
}

// Sites that sign you in with a "session cookie" (no expiry date) forget you whenever the
// browser closes. For the hub's own tabs we keep those cookies for 30 days instead, so you
// stay signed in to the SubTo site and others the way you would with "Remember me".
const KEEP_DAYS = 30;
async function keepSessionCookies(ses) {
  let cookies = [];
  try { cookies = await ses.cookies.get({}); } catch { return 0; }
  const until = Math.floor(Date.now() / 1000) + KEEP_DAYS * 86400;
  let n = 0;
  for (const c of cookies) {
    if (!c.session) continue;
    const host = String(c.domain || '').replace(/^\./, '');
    if (!host) continue;
    const details = {
      url: `${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`,
      name: c.name, value: c.value, path: c.path || '/',
      secure: c.secure, httpOnly: c.httpOnly, expirationDate: until,
    };
    if (!c.hostOnly && !c.name.startsWith('__Host-')) details.domain = c.domain;
    if (c.sameSite && c.sameSite !== 'unspecified') details.sameSite = c.sameSite;
    try { await ses.cookies.set(details); n++; } catch { /* skip cookies Chromium won't take back */ }
  }
  return n;
}

module.exports = { setupWebviews, keepSessionCookies, isDesktopAppBridge };
