const { app, BrowserWindow, ipcMain, dialog, shell, session, Notification, utilityProcess, net, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Database } = require('./db');
const { runBackup, listBackups, isDue } = require('./backup');
const { mergeSites, makeCustomSite, isWebUrl, browserCandidates, sameSite: sameSiteUrl } = require('./sites');
const CRM = require('./crm');
const { readTable } = require('./sheets');
const { createLists } = require('./lists');
const { createAnalyses } = require('./analyses');
const { createSearch } = require('./search');
const { createCalendar } = require('./calendar');
const { createZoomChats } = require('./zoomchats');
const { EXTRACT_JS } = require('./listing');
const { createDiscordKeeper } = require('./discordKeeper');
const { spawn } = require('child_process');
const { detectBrowsers, launchArgs } = require('./browsers');
const { setupWebviews, keepSessionCookies } = require('./webviews');
const { findZoomOrganizer } = require('./launcher');
const { lockTargetFromUrl, hashPin, checkPin, validPin, serverNameFromTitle, titleMatches } = require('./lock');

const APP_NAME = 'SubTo Command Center';
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('com.phillip.subtocommandcenter');

let win = null;
let db = null;
let backupTimer = null;
let crm = null;
let lists = null;
let uw = null;
let search = null;
let cal = null;
let zc = null;
let discordKeeper = null;
let zoomNew = [];

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

function defaults() {
  return {
    userName: '',
    theme: 'dark',
    backupDir: path.join(app.getPath('documents'), `${APP_NAME} Backups`),
    backupKeep: 14,
    lastBackup: null,
    downloadDir: path.join(app.getPath('downloads'), 'SubTo'),
    siteHomes: {},
    siteModes: {},
    siteLocks: {},
    lockPin: '',
    discordServerName: 'Creative Campus',
    windowBrowser: '',          // '' = ask every time
    windowSeparateProfile: true, // the hub gets its own sign-in in that browser
    customSites: [],
    zoomOrganizerPath: '',
    county: {},
    lookupHidden: [],
    lookupShown: [],
    lookupCustom: [],
    lookupRecent: [],
    watchFolders: [path.join(app.getPath('downloads'), 'SubTo')],
    calFeeds: [],
    zoomChatDir: path.join(app.getPath('documents'), 'Zoom'),
    zoomAutoAdd: false,
    weeklyGoals: { calls: 100, conversations: 20, offers: 5, contracts: 1 },
    calAlertMin: 10,
    calAlertScope: 'subto', // subto | zoom | all | off
    calKeywords: 'subto, sub-to, pace, morby, creative campus, deal detective, gator, novation, mastermind',
  };
}

// Permanent locks live in their own file next to the database, so updates, reinstalls and
// restoring a backup can't remove them. Nothing in the app deletes this file.
let permanentFile = '';
const tempUnlocked = new Set(); // permanent locks opened with the PIN until the app closes
function readPermanent() {
  try {
    const data = JSON.parse(fs.readFileSync(permanentFile, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch { return {}; }
}
function writePermanent(data) {
  const tmp = permanentFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, permanentFile);
}

function settings() {
  const s = { ...defaults(), ...db.getSettings() };
  const perm = readPermanent();
  const locks = { ...s.siteLocks };
  for (const [id, l] of Object.entries(perm)) {
    if (!l || !l.key || id.startsWith('_')) continue;
    if (tempUnlocked.has(id)) { delete locks[id]; continue; }
    const { pinHash, ...rest } = l;
    locks[id] = { ...rest, permanent: true };
  }
  return { ...s, siteLocks: locks };
}

function doBackup() {
  const s = settings();
  const result = runBackup(db, s.backupDir, Number(s.backupKeep) || 14);
  db.setSetting('lastBackup', result.time);
  return result;
}

function backupIfDue() {
  try {
    if (isDue(settings().lastBackup)) doBackup();
  } catch (e) {
    console.error('Automatic backup failed:', e.message);
  }
}

// Once a day (from 8 AM), a Windows notification lists what's due: follow-ups and tasks.
function remindIfDue() {
  try {
    if (!crm || !Notification.isSupported()) return;
    const now = new Date();
    if (now.getHours() < 8) return;
    const due = crm.dueToday();
    if (settings().lastReminderDate === due.today) return;
    const leadN = (due.leadFollowUps || []).length;
    const n = due.followUps.length + due.tasks.length + leadN;
    if (!n) return;
    const parts = [];
    if (due.followUps.length) parts.push(`${due.followUps.length} deal follow-up${due.followUps.length > 1 ? 's' : ''}`);
    if (leadN) parts.push(`${leadN} lead call-back${leadN > 1 ? 's' : ''}`);
    if (due.tasks.length) parts.push(`${due.tasks.length} task${due.tasks.length > 1 ? 's' : ''}${due.overdueTasks ? ` (${due.overdueTasks} overdue)` : ''}`);
    const note = new Notification({ title: 'SubTo Command Center', body: `Due today: ${parts.join(' and ')}. Click to see them.` });
    note.on('click', () => {
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
      win.webContents.send('navigate', 'tasks');
    });
    note.show();
    db.setSetting('lastReminderDate', due.today);
  } catch (e) {
    console.error('Reminder failed:', e.message);
  }
}

// A Windows pop-up before a call; clicking it joins (Zoom/Meet) or opens the calendar.
function showCallAlert(e, mins) {
  const when = new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (win && !win.isDestroyed()) win.webContents.send('cal-alert', { title: e.title, start: e.start, mins, join: e.join });
  if (!Notification.isSupported()) return;
  const note = new Notification({ title: `${mins ? `In ${mins} min` : 'Starting now'}: ${e.title}`, body: `${when}${e.join ? ` · Click to join ${e.join.kind}` : ' · Click to open your calendar'}` });
  note.on('click', () => {
    if (e.join && e.id !== 'test') { shell.openExternal(e.join.url); return; }
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    win.webContents.send('navigate', 'calendar');
  });
  note.show();
}

function createWindow() {
  const s = settings();
  const b = s.windowBounds || { width: 1360, height: 860 };
  win = new BrowserWindow({
    ...b,
    minWidth: 1000,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: s.theme === 'light' ? '#f5f7fb' : '#0b1626',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  if (s.windowMaximized) win.maximize();

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    db.setSetting('windowMaximized', win.isMaximized());
    if (!win.isMaximized() && !win.isMinimized()) db.setSetting('windowBounds', win.getBounds());
  };
  // Close every website tab the way a browser would before the app exits. Discord (and
  // some other sites) only write your sign-in to disk when their page unloads normally;
  // skipping this is what logged you out of Discord on every restart.
  let readyToClose = false;
  // Windows logging off or shutting down: save sign-ins before the hub is stopped.
  win.on('session-end', () => { gracefulShutdown().catch(() => {}); });
  win.on('close', (e) => {
    saveBounds();
    if (readyToClose) return;
    e.preventDefault();
    gracefulShutdown().finally(() => {
      readyToClose = true;
      if (win && !win.isDestroyed()) win.close();
    });
  });

  // Links to websites open in the normal browser for now (built-in tabs arrive in phase 2).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Test hook: capture a screenshot of a page and quit (used by the build's smoke test only).
  if (process.env.SUBTO_SCREENSHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.SUBTO_CLICK) {
        await win.webContents.executeJavaScript(`[...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes(${JSON.stringify(process.env.SUBTO_CLICK)}))?.click()`);
        await new Promise((r) => setTimeout(r, Number(process.env.SUBTO_WAIT || 800)));
      }
      if (process.env.SUBTO_MAIN_JS) {
        for (const step of process.env.SUBTO_MAIN_JS.split('|||')) {
          if (step.startsWith('TYPE:')) {
            for (const ch of step.slice(5)) {
              win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch });
              win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
              win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch });
            }
            await new Promise((r) => setTimeout(r, 600));
            continue;
          }
          if (step.startsWith('CLICK:')) {
            const [x, y] = step.slice(6).split(',').map(Number);
            win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
            win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
            await new Promise((r) => setTimeout(r, 800));
            continue;
          }
          const out = await win.webContents.executeJavaScript(step).catch((e) => 'error ' + e.message);
          console.log('MAIN_STEP', out);
          await new Promise((r) => setTimeout(r, 2500));
        }
      }
      if (process.env.SUBTO_WEBVIEW_JS) {
        const { webContents } = require('electron');
        for (const step of process.env.SUBTO_WEBVIEW_JS.split('|||')) {
          for (const wc of webContents.getAllWebContents().filter((w) => w.getType() === 'webview')) {
            await wc.executeJavaScript(step).catch((e) => console.log('step error', e.message));
          }
          await new Promise((r) => setTimeout(r, 2500));
          for (const wc of webContents.getAllWebContents().filter((w) => w.getType() === 'webview')) console.log('WEBVIEW_URL', wc.getURL());
        }
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.SUBTO_SCREENSHOT, img.toPNG());
      app.quit();
    }, 1500));
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist-renderer', 'index.html'));
  }
}

function registerIpc() {
  const handle = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  handle('settings:get', () => settings());
  handle('settings:set', (key, value) => {
    const allowed = ['userName', 'theme', 'backupDir', 'backupKeep', 'discordServerName', 'county', 'lookupHidden', 'lookupShown', 'lookupCustom', 'lookupRecent', 'calFeeds', 'calAlertMin', 'calAlertScope', 'calKeywords', 'weeklyGoals', 'zoomAutoAdd'];
    if (!allowed.includes(key)) throw new Error('Unknown setting');
    const webUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u) && u.length < 600;
    if (key === 'county') {
      const c = value || {};
      value = { name: String(c.name || '').slice(0, 80) };
      for (const k of ['assessor', 'recorder', 'treasurer', 'gis']) value[k] = webUrl(c[k]) ? c[k] : '';
    }
    if (key === 'calFeeds') {
      value = (Array.isArray(value) ? value : []).slice(0, 10).map((f, i) => {
        let u = String((f && f.url) || '').trim().replace(/^webcal:\/\//i, 'https://');
        if (!/^https:\/\//i.test(u) || u.length > 1000) throw new Error('The calendar link must start with https:// (use the "Secret address in iCal format")');
        return { id: String((f && f.id) || `cal${Date.now()}${i}`).slice(0, 40), name: String((f && f.name) || 'Calendar').slice(0, 60), url: u };
      });
    }
    if (key === 'zoomAutoAdd') value = !!value;
    if (key === 'weeklyGoals') {
      const g = value || {};
      value = {};
      for (const k of ['calls', 'conversations', 'offers', 'contracts']) value[k] = Math.min(10000, Math.max(0, parseInt(g[k], 10) || 0));
    }
    if (key === 'calAlertMin') value = Math.min(120, Math.max(0, parseInt(value, 10) || 0));
    if (key === 'calAlertScope') value = ['subto', 'zoom', 'all', 'off'].includes(value) ? value : 'subto';
    if (key === 'calKeywords') value = String(value || '').slice(0, 500);
    if (key === 'lookupHidden' || key === 'lookupShown') value = (Array.isArray(value) ? value : []).map(String).slice(0, 200);
    if (key === 'lookupRecent') value = (Array.isArray(value) ? value : []).map((x) => String(x).slice(0, 200)).slice(0, 20);
    if (key === 'lookupCustom') value = (Array.isArray(value) ? value : []).filter((x) => x && webUrl(x.url)).slice(0, 60)
      .map((x) => ({ id: String(x.id).slice(0, 80), label: String(x.label || '').slice(0, 40), url: x.url, group: String(x.group || 'investor').slice(0, 20) }));
    if (key === 'discordServerName') value = String(value || '').trim().slice(0, 80);
    if (key === 'backupKeep') value = Math.min(365, Math.max(1, parseInt(value, 10) || 14));
    db.setSetting(key, value);
    return settings();
  });

  handle('notes:list', () => db.listNotes());
  handle('notes:add', (body) => { db.addNote(body); return db.listNotes(); });
  handle('notes:delete', (id) => { db.deleteNote(id); return db.listNotes(); });

  handle('backup:now', () => doBackup());
  handle('backup:list', () => listBackups(settings().backupDir));
  handle('backup:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose backup folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return settings();
    db.setSetting('backupDir', r.filePaths[0]);
    return settings();
  });
  handle('backup:restore', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a backup to restore',
      defaultPath: settings().backupDir,
      filters: [{ name: 'SubTo Hub backup', extensions: ['db'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return { restored: false };
    const confirm = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Restore and restart', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Replace your current data with this backup?',
      detail: 'A safety copy of your current data is saved to the backup folder first.',
    });
    if (confirm.response !== 0) return { restored: false };
    doBackup(); // safety copy
    const file = db.filePath;
    db.close();
    fs.copyFileSync(r.filePaths[0], file);
    app.relaunch();
    app.exit(0);
    return { restored: true };
  });

  // ---- built-in website tabs ----
  const sites = () => {
    const perm = readPermanent();
    return mergeSites(settings()).map((x) => (tempUnlocked.has(x.id) && perm[x.id]
      ? { ...x, suspended: { name: perm[x.id].name, home: perm[x.id].home } } : x));
  };
  const permPinOk = (id, pin) => {
    const l = readPermanent()[id];
    return !!(l && l.pinHash && checkPin(pin, l.pinHash));
  };
  const siteById = (id) => {
    const s = sites().find((x) => x.id === id);
    if (!s) throw new Error('Unknown site');
    return s;
  };
  handle('sites:list', () => sites());
  handle('sites:setHome', (id, url) => {
    siteById(id);
    if (!isWebUrl(url)) throw new Error('Not a web address');
    const s = settings();
    const custom = s.customSites.find((c) => c.id === id);
    if (custom) {
      custom.url = url;
      db.setSetting('customSites', s.customSites);
    } else {
      db.setSetting('siteHomes', { ...s.siteHomes, [id]: url });
    }
    return sites();
  });
  handle('sites:resetHome', (id) => {
    const homes = { ...settings().siteHomes };
    delete homes[id];
    db.setSetting('siteHomes', homes);
    return sites();
  });
  handle('sites:addCustom', (label, url) => {
    const s = settings();
    const site = makeCustomSite(label, url, sites().map((x) => x.id));
    db.setSetting('customSites', [...s.customSites, site]);
    return sites();
  });
  handle('sites:removeCustom', async (id) => {
    const s = settings();
    db.setSetting('customSites', s.customSites.filter((c) => c.id !== id));
    await session.fromPartition(`persist:custom-${id}`).clearStorageData();
    return sites();
  });
  handle('sites:signOut', async (id) => {
    const site = siteById(id);
    await session.fromPartition(site.partition).clearStorageData();
    await session.fromPartition(site.partition).clearCache();
    if (site.partition === 'persist:discord' && discordKeeper) discordKeeper.forget();
    return true;
  });
  // ---- community lock ----
  handle('sites:lock', (id, url, title) => {
    const site = siteById(id);
    if (!site.lockable) throw new Error('This site cannot be locked');
    if (readPermanent()[id]) throw new Error('This lock is permanent and can\'t be changed.');
    const target = lockTargetFromUrl(id, url);
    if (!target) {
      throw new Error(id === 'facebook'
        ? 'Open the SubTo Facebook group first, then click Lock.'
        : 'Open a channel in the SubTo Discord server first, then click Lock.');
    }
    let name = '';
    if (id === 'discord') {
      const want = settings().discordServerName;
      const here = serverNameFromTitle(title);
      if (!here) throw new Error('NO_NAME'); // the tab asks you to confirm instead
      if (!titleMatches(title, want)) {
        throw new Error(`This is ${here ? `"${here}"` : 'not the right server'}. Open a channel in ${want}, then click Lock.`);
      }
      name = want || serverNameFromTitle(title);
    } else {
      name = String(title || '').replace(/^\s*\(\d+\+?\)\s*/, '').replace(/\s*\|\s*Facebook\s*$/i, '').trim().slice(0, 60);
    }
    db.setSetting('siteLocks', { ...(db.getSettings().siteLocks || {}), [id]: { ...target, name, aliases: [], lockedAt: new Date().toISOString() } });
    return sites();
  });
  handle('sites:unlock', (id, pin) => {
    if (readPermanent()[id]) {
      // Permanent: the PIN opens it until the app closes; it locks again on the next start.
      if (!permPinOk(id, pin)) throw new Error('Wrong PIN');
      tempUnlocked.add(id);
      return sites();
    }
    const s = settings();
    if (s.lockPin && !checkPin(pin, s.lockPin)) throw new Error('Wrong PIN');
    const locks = { ...(db.getSettings().siteLocks || {}) };
    delete locks[id];
    db.setSetting('siteLocks', locks);
    return sites();
  });
  handle('sites:relock', (id) => { tempUnlocked.delete(id); return sites(); });
  handle('sites:makePermanent', (id, pin) => {
    const s = settings();
    const l = s.siteLocks[id];
    if (!l || !l.key) throw new Error('Lock this tab first, then make it permanent.');
    if (l.permanent) return sites();
    if (!s.lockPin) throw new Error('NEED_PIN');
    if (!checkPin(pin, s.lockPin)) throw new Error('Wrong PIN');
    const { permanent, ...lock } = l;
    writePermanent({ ...readPermanent(), [id]: { ...lock, pinHash: s.lockPin, permanentSince: new Date().toISOString() } });
    return sites();
  });
  handle('sites:removePermanent', (id, pin) => {
    const perm = readPermanent();
    if (!perm[id]) throw new Error('This lock is not permanent');
    if (!permPinOk(id, pin)) throw new Error('Wrong PIN');
    delete perm[id];
    writePermanent(perm);
    tempUnlocked.delete(id);
    const locks = { ...(db.getSettings().siteLocks || {}) };
    delete locks[id];
    db.setSetting('siteLocks', locks);
    return sites();
  });
  handle('lock:hasPin', () => {
    const perm = readPermanent();
    return !!settings().lockPin || Object.values(perm).some((l) => l && l.pinHash);
  });
  handle('lock:setPin', (oldPin, newPin) => {
    const s = settings();
    const perm = readPermanent();
    const permIds = Object.keys(perm).filter((k) => perm[k] && perm[k].key);
    const current = s.lockPin || (permIds[0] && perm[permIds[0]].pinHash) || '';
    if (current && !checkPin(oldPin, current)) throw new Error('Current PIN is wrong');
    if (newPin === '' || newPin == null) {
      if (permIds.length) throw new Error('A permanent lock needs a PIN. Remove the permanent lock first.');
      db.setSetting('lockPin', '');
      return false;
    }
    if (!validPin(newPin)) throw new Error('PIN must be 4 to 8 digits');
    const h = hashPin(newPin);
    db.setSetting('lockPin', h);
    if (permIds.length) {
      for (const id of permIds) perm[id] = { ...perm[id], pinHash: h };
      writePermanent(perm);
    }
    return true;
  });

  handle('sites:setMode', (id, mode) => {
    siteById(id);
    if (mode !== 'tab' && mode !== 'window') throw new Error('Unknown mode');
    db.setSetting('siteModes', { ...settings().siteModes, [id]: mode });
    return sites();
  });
  // ---- Google sites in a real browser you pick ----
  let browserCache = null;
  const browsers = async (fresh) => {
    if (process.env.SUBTO_FAKE_BROWSERS) return JSON.parse(process.env.SUBTO_FAKE_BROWSERS); // test hook
    if (!browserCache || fresh) browserCache = await detectBrowsers();
    return browserCache;
  };
  handle('browsers:list', async () => {
    const s = settings();
    return { browsers: await browsers(true), remembered: s.windowBrowser, separate: s.windowSeparateProfile !== false };
  });
  handle('browsers:setPrefs', (browserId, separate) => {
    if (typeof browserId === 'string') db.setSetting('windowBrowser', browserId.slice(0, 40));
    if (typeof separate === 'boolean') db.setSetting('windowSeparateProfile', separate);
    return { remembered: settings().windowBrowser, separate: settings().windowSeparateProfile !== false };
  });
  // Opens the site as its own window in the browser you chose. Returns {needChoice:true}
  // when no browser was given and none is remembered, so the hub can show the picker.
  handle('sites:openWindow', async (id, browserId, remember, atUrl) => {
    const site = siteById(id);
    const target = isWebUrl(atUrl) && sameSiteUrl(atUrl, site.url) ? atUrl : site.url;
    const s = settings();
    const list = await browsers();
    const chosenId = browserId || s.windowBrowser;
    const b = list.find((x) => x.id === chosenId);
    if (!b) {
      if (!list.length) { shell.openExternal(target); return { browser: 'your default browser' }; }
      return { needChoice: true };
    }
    if (remember) db.setSetting('windowBrowser', b.id);
    let profileDir = null;
    if (s.windowSeparateProfile !== false) {
      profileDir = path.join(app.getPath('userData'), 'browser-profiles', b.id);
      fs.mkdirSync(profileDir, { recursive: true });
    }
    const child = spawn(b.path, launchArgs(b, target, profileDir), { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => shell.openExternal(target));
    child.unref();
    return { browser: b.name };
  });
  // Give the keyboard back to the hub's own controls (away from an embedded website).
  handle('app:refocus', () => {
    if (!win || win.isDestroyed()) return false;
    win.webContents.focus();
    return true;
  });
  handle('app:openExternal', (url) => {
    if (!isWebUrl(url)) throw new Error('Not a web address');
    return shell.openExternal(url);
  });

  // ---- downloads from website tabs ----
  handle('downloads:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Where should downloads go?', properties: ['openDirectory', 'createDirectory'] });
    if (!r.canceled && r.filePaths[0]) db.setSetting('downloadDir', r.filePaths[0]);
    return settings();
  });
  handle('downloads:openFolder', () => {
    const dir = settings().downloadDir;
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });
  handle('downloads:show', (file) => {
    const dir = path.resolve(settings().downloadDir);
    if (!path.resolve(file).startsWith(dir + path.sep)) throw new Error('Not allowed');
    shell.showItemInFolder(file);
  });

  // ---- Zoom Chat Organizer ----
  handle('zoom:status', () => {
    const p = settings().zoomOrganizerPath;
    return { path: p, exists: !!p && fs.existsSync(p) };
  });
  handle('zoom:detect', () => {
    const found = findZoomOrganizer();
    if (found[0]) db.setSetting('zoomOrganizerPath', found[0]);
    return { found, path: found[0] || '' };
  });
  handle('zoom:choose', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Find your Zoom Chat Organizer',
      properties: ['openFile'],
      filters: [{ name: 'Programs and shortcuts', extensions: ['exe', 'lnk', 'bat', 'cmd', 'url', 'appref-ms', 'html', 'htm', 'py', 'pyw'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (!r.canceled && r.filePaths[0]) db.setSetting('zoomOrganizerPath', r.filePaths[0]);
    return { path: settings().zoomOrganizerPath };
  });
  handle('zoom:open', async () => {
    const p = settings().zoomOrganizerPath;
    if (!p || !fs.existsSync(p)) throw new Error('Zoom Chat Organizer not found. Set its location first.');
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
    return true;
  });

  // ---- CRM (phase 3) ----
  const CRM_CALLS = ['listContacts', 'getContact', 'saveContact', 'deleteContact', 'allTags', 'promoteContact',
    'listDeals', 'getDeal', 'saveDeal', 'moveDeal', 'deleteDeal', 'linkContact', 'unlinkContact',
    'listTasks', 'saveTask', 'setTaskDone', 'deleteTask', 'listActivities', 'logActivity', 'deleteActivity',
    'weeklyNumbers', 'weeklyTrend', 'dueToday', 'pipelineCounts', 'teamSearch', 'team', 'saveTeamMember', 'removeTeamMember', 'setFundsNeeded'];
  for (const fn of CRM_CALLS) handle(`crm:${fn}`, (...args) => crm[fn](...args));
  handle('crm:options', () => ({
    stages: CRM.STAGES, roles: CRM.ROLES, strategies: CRM.STRATEGIES, propertyTypes: CRM.PROPERTY_TYPES,
    callOutcomes: CRM.CALL_OUTCOMES, priorities: CRM.PRIORITIES,
    teamRoles: CRM.TEAM_ROLES, sellerRoles: CRM.SELLER_ROLES, teamBrings: CRM.TEAM_BRINGS, teamStatus: CRM.TEAM_STATUS,
  }));
  // Click-to-call: works out the Google Voice address that starts a call to this number.
  handle('crm:callInfo', (number) => {
    const e164 = CRM.dialable(number);
    if (!e164) throw new Error('That phone number is incomplete');
    const voice = sites().find((x) => x.id === 'voice');
    return { e164, url: `https://voice.google.com/u/0/calls?a=nc,${encodeURIComponent(e164)}`, mode: voice ? voice.mode : 'window' };
  });
  handle('app:openMail', (email) => {
    const e = String(email || '').trim();
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e)) throw new Error('That email address doesn\'t look right');
    return shell.openExternal(`mailto:${e}`);
  });
  // Import: pick a file, preview it, then import with the columns you matched.
  let pendingImport = null;
  handle('crm:pickImportFile', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Import contacts from a spreadsheet',
      defaultPath: app.getPath('downloads'),
      filters: [{ name: 'Excel or CSV', extensions: ['xlsx', 'xlsm', 'csv', 'xls'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const table = await readTable(r.filePaths[0]);
    if (!table.sheets.length) throw new Error('That file has no rows to import');
    pendingImport = table;
    return {
      file: table.file,
      sheets: table.sheets.map((sh) => ({ name: sh.name, headers: sh.headers, total: sh.total, preview: sh.rows.slice(0, 5), guess: CRM.guessMapping(sh.headers) })),
    };
  });
  handle('crm:runImport', (sheetIndex, map, opts) => {
    if (!pendingImport) throw new Error('Choose a file first');
    const sheet = pendingImport.sheets[Number(sheetIndex) || 0];
    if (!sheet) throw new Error('Sheet not found');
    const allowed = new Set(sheet.headers);
    const clean = {};
    for (const [k, v] of Object.entries(map || {})) if (allowed.has(v)) clean[k] = v;
    const result = crm.importContacts(sheet.rows, clean, opts || {});
    pendingImport = null;
    return result;
  });

  // ---- Lead lists & the one import for every kind of file ----
  const LIST_CALLS = ['listLists', 'listItems', 'getItem', 'neighbor', 'setStatus', 'updateItem', 'markPhone', 'promote', 'renameList', 'deleteList'];
  for (const fn of LIST_CALLS) handle(`lists:${fn}`, (...args) => lists[fn](...args));
  // ---- Underwriting (phase 4) ----
  handle('uw:list', (opts) => uw.list(opts || {}));
  handle('uw:get', (id) => uw.get(id));
  handle('uw:save', (a) => uw.save(a || {}));
  handle('uw:remove', (id) => uw.remove(id));
  // ---- Underwriting prefill (1.0.2): pick an address you already have, fill from the lead, deal and Zillow/Redfin ----
  handle('uw:addressSearch', (q) => {
    const t = String(q || '').trim().slice(0, 80);
    if (t.length < 2) return [];
    const like = `%${t}%`;
    const deals = db.all('SELECT id, address, city, state, zip, stage, property_type FROM deals WHERE address LIKE ? OR city LIKE ? LIMIT 8', [like, like])
      .map((d) => ({ kind: 'deal', id: d.id, address: [d.address, d.city, [d.state, d.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), sub: `Deal · ${d.stage} · ${d.property_type}` }));
    const leads = db.all(`SELECT li.id, li.title, li.address, li.city, li.state, li.zip, li.units, li.property_type, l.name AS list FROM list_items li JOIN lists l ON l.id = li.list_id
      WHERE li.address LIKE ? OR li.title LIKE ? OR li.city LIKE ? LIMIT 15`, [like, like, like])
      .map((r) => ({ kind: 'lead', id: r.id, address: [r.address, r.city, [r.state, r.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), sub: `${r.list}${r.property_type ? ` · ${r.property_type}` : ''}${r.title ? ` · ${r.title}` : ''}` }));
    return [...deals, ...leads];
  });
  handle('uw:prefillData', (ref) => {
    const out = { deal: null, lead: null };
    let leadId = null;
    if (ref && ref.kind === 'deal') {
      out.deal = db.get('SELECT * FROM deals WHERE id = ?', [Number(ref.id)]);
      const li = db.get('SELECT id FROM list_items WHERE deal_id = ? LIMIT 1', [Number(ref.id)]);
      if (li) leadId = li.id;
    } else if (ref && ref.kind === 'lead') leadId = Number(ref.id);
    if (leadId) {
      const it = db.get('SELECT li.*, l.name AS list_name FROM list_items li JOIN lists l ON l.id = li.list_id WHERE li.id = ?', [leadId]);
      if (it) {
        const c = it.contact_id ? db.get('SELECT first_name, last_name, company FROM contacts WHERE id = ?', [it.contact_id]) : null;
        let hl = []; try { hl = JSON.parse(it.highlights || '[]'); } catch { /* ignore */ }
        out.lead = { id: it.id, address: [it.address, it.city, [it.state, it.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), price: it.price, units: it.units, yearBuilt: it.year_built,
          propertyType: it.property_type, title: it.title, extra: it.extra, highlights: hl, listName: it.list_name, dealId: it.deal_id,
          owner: c ? [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company : '' };
        if (!out.deal && it.deal_id) out.deal = db.get('SELECT * FROM deals WHERE id = ?', [it.deal_id]);
      }
    }
    return out;
  });
  // Read Zillow (then Redfin) for an address in a hidden window that shares Property Lookup's sign-in.
  handle('uw:fetchListing', async (address) => {
    const a = String(address || '').trim();
    if (!a) throw new Error('Add the address first');
    const slug = a.replace(/[#,]/g, '').trim().replace(/\s+/g, '-');
    const tries = [
      `https://www.zillow.com/homes/${encodeURIComponent(slug).replace(/%2D/g, '-')}_rb/`,
      `https://duckduckgo.com/?q=${encodeURIComponent(`\\site:redfin.com ${a}`)}`,
    ];
    let last = null;
    for (const url of tries) {
      const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: 'persist:lookup', sandbox: true, contextIsolation: true, nodeIntegration: false } });
      try {
        await Promise.race([w.loadURL(url).catch(() => {}), new Promise((r) => setTimeout(r, 20000))]);
        let data = null;
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          data = await w.webContents.executeJavaScript(EXTRACT_JS).catch(() => null);
          if (data && (data.blocked || data.price || data.sqft || data.beds)) break;
        }
        last = data;
        if (data && !data.blocked && (data.price || data.sqft || data.beds || data.zestimate)) return data;
      } finally { w.destroy(); }
    }
    if (last && last.blocked) throw new Error('Zillow wants to check you\'re a person. Open the address once in Property Lookup (Zillow tab), finish the check, then click "Fill from Zillow/Redfin" again — or click "Send to Underwriting" right on that tab.');
    throw new Error("Couldn't read a listing for that address. Open it in Property Lookup and click \"Send to Underwriting\" on the Zillow or Redfin tab.");
  });
  // Read the page open in a Property Lookup tab.
  handle('uw:extractFromTab', async (wcId) => {
    const { webContents } = require('electron');
    const wc = webContents.fromId(Number(wcId));
    if (!wc || wc.getType() !== 'webview') throw new Error('That tab is closed');
    const data = await wc.executeJavaScript(EXTRACT_JS);
    if (data && data.blocked) throw new Error('The site is asking you to verify you\'re a person. Finish that check in the tab, then try again.');
    return data;
  });
  handle('uw:pdf', async (html, name) => {
    const safe = String(name || 'Underwriting').replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
    let out = process.env.SUBTO_PDF_OUT; // test hook
    if (!out) {
      const dir = settings().downloadDir;
      fs.mkdirSync(dir, { recursive: true });
      const r = await dialog.showSaveDialog(win, { title: 'Save one-page summary', defaultPath: path.join(dir, `${safe}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (r.canceled || !r.filePath) return null;
      out = r.filePath;
    }
    const pdfWin = new BrowserWindow({ show: false, width: 850, height: 1100, webPreferences: { javascript: false, sandbox: true } });
    try {
      await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(String(html))}`);
      const buf = await pdfWin.webContents.printToPDF({ pageSize: 'Letter', printBackground: true, margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
      fs.writeFileSync(out, buf);
    } finally { pdfWin.destroy(); }
    if (!process.env.SUBTO_PDF_OUT) shell.showItemInFolder(out);
    return out;
  });
  // ---- Search & documents (phase 6) ----
  const fileAllowed = (p) => typeof p === 'string' && (search.isIndexed(p) || !!db.get('SELECT id FROM deal_files WHERE path = ?', [p]));
  handle('search:query', (q) => search.query(q));
  handle('search:file', (id, q) => search.fileDetail(id, q));
  handle('search:scan', () => { search.scan().catch(() => {}); return search.stats(); });
  handle('search:stats', () => search.stats());
  handle('search:recent', (n) => search.recent(n));
  handle('search:addFolder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pick a folder to search', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return search.stats();
    const list = [...new Set([...(settings().watchFolders || []), r.filePaths[0]])].slice(0, 20);
    db.setSetting('watchFolders', list);
    search.setFolders(list);
    search.scan().catch(() => {});
    return search.stats();
  });
  handle('search:removeFolder', (p) => {
    const list = (settings().watchFolders || []).filter((x) => x !== p);
    db.setSetting('watchFolders', list);
    search.setFolders(list);
    search.scan().catch(() => {});
    return search.stats();
  });
  handle('files:open', (p) => { if (!fileAllowed(p)) throw new Error('That file is not in a searched folder'); return shell.openPath(p); });
  handle('files:show', (p) => { if (!fileAllowed(p)) throw new Error('That file is not in a searched folder'); shell.showItemInFolder(p); return true; });
  handle('files:forDeal', (dealId) => db.all('SELECT * FROM deal_files WHERE deal_id = ? ORDER BY added_at DESC', [Number(dealId)]).map((f) => ({ ...f, exists: fs.existsSync(f.path) })));
  handle('files:linkDeal', async (dealId, p) => {
    let file = p;
    if (!file) {
      const r = await dialog.showOpenDialog(win, { title: 'Attach a file to this deal', properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return null;
      file = r.filePaths[0];
    } else if (!search.isIndexed(file)) throw new Error('That file is not in a searched folder');
    db.run('INSERT OR IGNORE INTO deal_files (deal_id, path, name) VALUES (?,?,?)', [Number(dealId), file, path.basename(file)]);
    db.run("INSERT INTO activities (kind, body, deal_id) VALUES ('note', ?, ?)", [`Attached file: ${path.basename(file)}`, Number(dealId)]);
    return true;
  });
  handle('files:unlink', (id) => { db.run('DELETE FROM deal_files WHERE id = ?', [Number(id)]); return true; });
  // ---- Calendar & alerts (phase 7) ----
  handle('cal:events', (fromMs, toMs, fromYmd, toYmd) => ({ events: cal.events(Number(fromMs), Number(toMs)), crm: cal.crmItems(String(fromYmd), String(toYmd)), status: cal.status() }));
  handle('cal:refresh', async () => { const st = await cal.refresh(); return st; });
  handle('cal:join', (url) => {
    if (!/^https:\/\/([\w-]+\.)*(zoom\.us|meet\.google\.com|teams\.microsoft\.com)\//i.test(String(url))) throw new Error('Not a meeting link');
    return shell.openExternal(url);
  });
  handle('cal:testAlert', () => {
    showCallAlert({ id: 'test', title: 'Test: SubTo call', start: Date.now() + 10 * 60000, join: { kind: 'Zoom', url: 'https://zoom.us/test' }, subto: true }, 10);
    return true;
  });
  // ---- Zoom Chat Organizer, built in (phase 9) ----
  handle('zc:status', () => ({ dir: settings().zoomChatDir, dirExists: fs.existsSync(settings().zoomChatDir || ''), autoAdd: !!settings().zoomAutoAdd, found: zoomNew, imported: zc.imported() }));
  handle('zc:scan', () => { zoomNew = zc.findNew(settings().zoomChatDir); return zoomNew; });
  handle('zc:chooseDir', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Where does Zoom save your chats?', defaultPath: settings().zoomChatDir, properties: ['openDirectory'] });
    if (!r.canceled && r.filePaths[0]) db.setSetting('zoomChatDir', r.filePaths[0]);
    zoomNew = zc.findNew(settings().zoomChatDir);
    return settings().zoomChatDir;
  });
  handle('zc:pickFiles', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pick saved Zoom chat files', defaultPath: fs.existsSync(settings().zoomChatDir) ? settings().zoomChatDir : app.getPath('downloads'), filters: [{ name: 'Zoom chats', extensions: ['txt'] }], properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return [];
    return r.filePaths.map((p) => { try { return zc.preview(p, fs.statSync(p)); } catch (e) { return { file: p, name: path.basename(p), error: e.message, messages: 0 }; } });
  });
  handle('zc:add', (files) => {
    const list = (files || []).filter((f) => f && typeof f.path === 'string' && /\.txt$/i.test(f.path) && fs.existsSync(f.path));
    if (!list.length) throw new Error('No chat files to add');
    const r = zc.addChats(list.map((f) => ({ path: f.path, label: String(f.label || '').slice(0, 30), inferSubto: !!f.inferSubto })));
    zoomNew = zoomNew.filter((x) => !list.some((f) => f.path === x.file));
    return r;
  });
  handle('zc:applyCandidate', (contactId, kind, value) => {
    const c = crm.getContact(contactId);
    if (kind === 'phone') {
      const phones = c.more_phones.length ? c.more_phones : [c.phone, c.phone2].filter(Boolean).map((n) => ({ n }));
      if (!c.phone) crm.saveContact({ id: c.id, phone: value });
      else crm.saveContact({ id: c.id, more_phones: [...phones, { n: value, label: 'From chat' }] });
    } else if (kind === 'email') {
      if (!c.email) crm.saveContact({ id: c.id, email: value });
      else crm.saveContact({ id: c.id, emails2: [c.emails2, value].filter(Boolean).join('; ') });
    }
    return crm.getContact(contactId);
  });
  handle('zc:duplicates', () => zc.duplicates());
  handle('zc:merge', (keepId, dropId) => zc.merge(keepId, dropId));
  handle('zc:names', (contactId) => zc.namesFor(contactId));
  handle('zc:export', async () => {
    const r = await dialog.showSaveDialog(win, { title: 'Export SubTo Directory (MASTER layout)', defaultPath: path.join(app.getPath('downloads'), `SubTo_Contacts_MASTER (from hub ${new Date().toISOString().slice(0, 10)}).xlsx`), filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (r.canceled || !r.filePath) return null;
    const out = await zc.exportMaster(r.filePath, require('./vendor/exceljs'));
    shell.showItemInFolder(r.filePath);
    return out;
  });
  handle('zc:searchFolder', () => {
    const dir = settings().zoomChatDir;
    if (!fs.existsSync(dir)) throw new Error('The Zoom chat folder was not found');
    const list = [...new Set([...(settings().watchFolders || []), dir])];
    db.setSetting('watchFolders', list);
    search.setFolders(list);
    search.scan().catch(() => {});
    return true;
  });
  handle('lists:statuses', () => require('./recipes').STATUSES);
  handle('lists:analyze', async () => {
    if (process.env.SUBTO_IMPORT_FILE) return lists.analyze(process.env.SUBTO_IMPORT_FILE); // test hook
    const r = await dialog.showOpenDialog(win, {
      title: 'Import a spreadsheet',
      defaultPath: app.getPath('downloads'),
      filters: [{ name: 'Excel or CSV', extensions: ['xlsx', 'xlsm', 'csv', 'xls'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    win.webContents.send('import-progress', { reading: true, file: path.basename(r.filePaths[0]) });
    return lists.analyze(r.filePaths[0]);
  });
  handle('lists:run', (plan) => lists.run(plan, (done, total, label) => {
    if (win && !win.isDestroyed()) win.webContents.send('import-progress', { done, total, label });
  }));
  handle('lists:export', async (listId) => {
    const l = lists.listLists().find((x) => x.id === Number(listId));
    if (!l) throw new Error('List not found');
    const safe = l.name.replace(/[<>:"/\\|?*]/g, '_');
    const r = await dialog.showSaveDialog(win, {
      title: 'Export list to Excel',
      defaultPath: path.join(app.getPath('downloads'), `${safe} (from hub ${new Date().toISOString().slice(0, 10)}).xlsx`),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const out = await lists.exportList(l.id, r.filePath);
    shell.showItemInFolder(r.filePath);
    return out;
  });

  handle('app:info', () => ({
    version: app.getVersion(),
    dataFile: db.filePath,
    stats: db.stats(),
  }));
  handle('app:openDataFolder', () => shell.openPath(path.dirname(db.filePath)));
  handle('app:openPath', (p) => {
    const s = settings();
    if (p !== s.backupDir) throw new Error('Not allowed');
    fs.mkdirSync(p, { recursive: true });
    return shell.openPath(p);
  });
}

app.whenReady().then(async () => {
  const dataDir = process.env.SUBTO_HUB_DATA_DIR || app.getPath('userData');
  db = await new Database(path.join(dataDir, 'hub.db')).open();
  permanentFile = path.join(dataDir, 'permanent-locks.json');
  crm = CRM.createCrm(db);
  lists = createLists(db, crm, dataDir);
  uw = createAnalyses(db);
  discordKeeper = createDiscordKeeper({ dataDir, safeStorage });
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() === 'webview') contents.once('did-start-loading', () => discordKeeper.watch(contents));
  });
  cal = createCalendar({
    dataDir, db, getSettings: () => settings(),
    fetchText: async (url) => { const r = await net.fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`Calendar link returned ${r.status}${r.status === 404 ? ' (check the secret address)' : ''}`); return r.text(); },
    onAlert: (e, mins) => showCallAlert(e, mins),
  });
  cal.refresh().catch(() => {});
  setInterval(() => cal.refresh().catch(() => {}), 10 * 60 * 1000);
  setInterval(() => { try { cal.checkAlerts(); } catch (e) { console.error('Alert check failed:', e.message); } }, 30 * 1000);
  zc = createZoomChats({ db, crm });
  const checkZoom = () => {
    try {
      const before = new Set(zoomNew.map((x) => x.file));
      zoomNew = zc.findNew(settings().zoomChatDir);
      const fresh = zoomNew.filter((x) => !before.has(x.file));
      if (!fresh.length) return;
      if (settings().zoomAutoAdd) {
        const r = zc.addChats(fresh.map((x) => ({ path: x.file })));
        zoomNew = zoomNew.filter((x) => !fresh.some((f) => f.file === x.file));
        if (win && !win.isDestroyed()) win.webContents.send('zc-update', { added: r.messages, people: r.newContacts.length });
      } else if (win && !win.isDestroyed()) win.webContents.send('zc-update', { found: zoomNew.length });
    } catch (e) { console.error('Zoom chat check failed:', e.message); }
  };
  setTimeout(checkZoom, 8000);
  setInterval(checkZoom, 10 * 60 * 1000);
  search = createSearch({
    dataDir, mainDb: db, workerPath: path.join(__dirname, 'indexer-worker.js'),
    spawnWorker: (p) => utilityProcess.fork(p, [], { serviceName: 'SubTo file reader', stdio: 'ignore' }),
    onProgress: (st) => { if (win && !win.isDestroyed()) win.webContents.send('search-progress', st); },
  });
  await search.open();
  search.setFolders(settings().watchFolders);
  setTimeout(() => search.scan().catch(() => {}), 6000);
  setInterval(() => search.scan().catch(() => {}), 15 * 60 * 1000);
  registerIpc();
  setupWebviews({
    getWin: () => win,
    getDownloadDir: () => settings().downloadDir,
    partitions: () => [...new Set(mergeSites(settings()).map((x) => x.partition))],
    getLock: (siteId) => {
      const l = settings().siteLocks[siteId];
      return l && l.key ? l : null;
    },
    siteForPartition: (partition) => {
      const users = mergeSites(settings()).filter((x) => x.partition === partition);
      return users.length === 1 ? users[0].id : null;
    },
    learnAliases: (siteId, names) => {
      const s = settings();
      const l = s.siteLocks[siteId];
      if (!l) return;
      const clean = names.filter((n) => /^[\w.-]{1,100}$/.test(n) && n.toLowerCase() !== String(l.key).toLowerCase());
      const aliases = [...new Set([...(l.aliases || []), ...clean])].slice(0, 10);
      if (aliases.length === (l.aliases || []).length) return;
      if (l.permanent) {
        const perm = readPermanent();
        writePermanent({ ...perm, [siteId]: { ...perm[siteId], aliases } });
      } else {
        const saved = db.getSettings().siteLocks || {};
        db.setSetting('siteLocks', { ...saved, [siteId]: { ...l, aliases } });
      }
    },
  });
  createWindow();
  backupIfDue();
  backupTimer = setInterval(backupIfDue, 60 * 60 * 1000); // check hourly
  setTimeout(remindIfDue, 20 * 1000);
  setInterval(remindIfDue, 30 * 60 * 1000);
  // Every 5 minutes, save sign-ins to disk too, so a crash or power cut doesn't log you out.
  setInterval(async () => {
    for (const p of new Set(mergeSites(settings()).map((x) => x.partition))) {
      const ses = session.fromPartition(p);
      await keepSessionCookies(ses);
      try { ses.flushStorageData(); await ses.cookies.flushStore(); } catch { /* ignore */ }
    }
  }, 5 * 60 * 1000);
});

async function gracefulShutdown() {
  const { webContents } = require('electron');
  const guests = webContents.getAllWebContents().filter((w) => w.getType() === 'webview' && !w.isDestroyed());
  const sessions = new Set(guests.map((w) => w.session));
  if (discordKeeper) await discordKeeper.snapshot(guests).catch(() => {});
  // Navigating to a blank page fires the sites' own "page is closing" handlers.
  await Promise.all(guests.map((w) => new Promise((resolve) => {
    const done = () => resolve();
    const timer = setTimeout(done, 2500);
    w.once('did-finish-load', () => { clearTimeout(timer); done(); });
    w.once('did-fail-load', () => { clearTimeout(timer); done(); });
    w.loadURL('about:blank').catch(() => { clearTimeout(timer); done(); });
  })));
  // Force everything the sites stored (sign-ins, settings) onto disk now.
  for (const p of mergeSites(settings()).map((x) => x.partition)) sessions.add(session.fromPartition(p));
  for (const ses of sessions) {
    await keepSessionCookies(ses);
    try { ses.flushStorageData(); } catch { /* ignore */ }
    try { await ses.cookies.flushStore(); } catch { /* ignore */ }
  }
}

app.on('before-quit', () => {
  if (!db || !db.db) return; // already shut down cleanly
  try {
    for (const p of new Set(mergeSites(settings()).map((x) => x.partition))) session.fromPartition(p).flushStorageData();
  } catch { /* ignore */ }
});

app.on('window-all-closed', () => {
  if (backupTimer) clearInterval(backupTimer);
  try { if (search) search.close(); } catch { /* ignore */ }
  if (db) db.close();
  app.quit();
});
