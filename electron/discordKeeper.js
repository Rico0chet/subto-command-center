// Keeps you signed in to Discord across restarts.
// Discord's web app keeps its sign-in in the page's local storage, and that sometimes doesn't make it to disk
// when the hub closes (or Windows shuts it down), so Discord asks you to log in again. The hub keeps its own
// copy of that sign-in, encrypted with your Windows account (it never leaves this PC), and puts it back when
// Discord opens signed out. Logging out inside Discord, or "Sign out" in the hub's site settings, deletes the copy.
const fs = require('fs');
const path = require('path');

// Read / write Discord's stored sign-in through a fresh same-site frame (the app hides window.localStorage).
const READ_JS = `(() => { try { if (!/(^|\\.)discord\\.com$/.test(location.hostname)) return { skip: true };
  const f = document.createElement('iframe'); f.style.display = 'none'; document.documentElement.appendChild(f);
  const t = f.contentWindow.localStorage.getItem('token'); f.remove();
  return { token: t, loginPage: /^\\/(login|register)/.test(location.pathname) }; } catch (e) { return { error: String(e) }; } })()`;
const writeJs = (token) => `(() => { try { const f = document.createElement('iframe'); f.style.display = 'none'; document.documentElement.appendChild(f);
  f.contentWindow.localStorage.setItem('token', ${JSON.stringify(token)}); f.remove(); return true; } catch (e) { return false; } })()`;

function createDiscordKeeper({ dataDir, safeStorage, partition = 'persist:discord', isDiscord = (c) => c.session === require('electron').session.fromPartition(partition) }) {
  const file = path.join(dataDir, 'discord-signin.bin');
  const canEncrypt = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
  let cached;
  const load = () => {
    if (cached !== undefined) return cached;
    try { cached = canEncrypt() && fs.existsSync(file) ? safeStorage.decryptString(fs.readFileSync(file)) : null; } catch { cached = null; }
    return cached;
  };
  const save = (token) => {
    if (!token || !canEncrypt() || token === load()) return;
    try { fs.writeFileSync(file, safeStorage.encryptString(token)); cached = token; } catch { /* ignore */ }
  };
  const forget = () => { cached = null; try { fs.unlinkSync(file); } catch { /* not there */ } };

  // Attach to every Discord tab.
  function watch(contents) {
    if (!isDiscord(contents)) return;
    let restored = false;
    let sawToken = false;
    const check = async () => {
      if (contents.isDestroyed()) return;
      const r = await contents.executeJavaScript(READ_JS).catch(() => null);
      if (!r || r.skip || r.error) return;
      if (r.token) { sawToken = true; save(r.token); return; }
      // Signed out. Was it you (you were signed in a moment ago in this tab)? Then forget the copy.
      if (sawToken) { forget(); sawToken = false; return; }
      const saved = load();
      if (saved && !restored) {
        restored = true;
        const ok = await contents.executeJavaScript(writeJs(saved)).catch(() => false);
        if (ok) contents.loadURL('https://discord.com/app');
      }
    };
    contents.on('did-finish-load', () => setTimeout(check, 1500));
    contents.on('did-navigate-in-page', () => setTimeout(check, 1500));
    const timer = setInterval(check, 60 * 1000);
    contents.once('destroyed', () => clearInterval(timer));
  }

  // Called right before the hub closes.
  async function snapshot(contentsList) {
    for (const c of contentsList) {
      if (c.isDestroyed() || !isDiscord(c)) continue;
      const r = await c.executeJavaScript(READ_JS).catch(() => null);
      if (r && r.token) save(r.token);
    }
  }
  return { watch, snapshot, forget, hasSaved: () => !!load() };
}

module.exports = { createDiscordKeeper, READ_JS, writeJs };
