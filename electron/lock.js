// "Community lock": keeps the Facebook tab inside one group and the Discord tab inside one server.
const crypto = require('crypto');

const LOCKABLE = { facebook: 'group', discord: 'server' };

const parse = (u) => { try { return new URL(u); } catch { return null; } };
const isFbHost = (h) => /(^|\.)facebook\.com$/i.test(h);
const isDiscordHost = (h) => /(^|\.)discord\.com$/i.test(h) || /(^|\.)discordapp\.com$/i.test(h);

// From the page you're on, work out what to lock to.
function lockTargetFromUrl(siteId, url) {
  const u = parse(url);
  if (!u) return null;
  if (siteId === 'facebook' && isFbHost(u.hostname)) {
    const m = /^\/groups\/([^/?#]+)/i.exec(u.pathname);
    if (!m || /^(feed|discover|joins|create|search)$/i.test(m[1])) return null;
    return { key: m[1], home: `https://www.facebook.com/groups/${m[1]}` };
  }
  if (siteId === 'discord' && isDiscordHost(u.hostname)) {
    const m = /^\/channels\/(\d{5,25})(?:\/(\d{5,25}))?/.exec(u.pathname);
    if (!m) return null;
    return { key: m[1], home: `https://discord.com/channels/${m[1]}${m[2] ? `/${m[2]}` : ''}` };
  }
  return null;
}

// Discord titles look like "(2) #general | Creative Campus" or "Discord | #general | Creative Campus".
function titleParts(title) {
  return String(title || '').replace(/^\s*\(\d+\+?\)\s*/, '').split(/\s+\|\s+/).map((x) => x.trim()).filter(Boolean);
}
function serverNameFromTitle(title) {
  const parts = titleParts(title).filter((x) => !/^discord$/i.test(x) && !/^[#@]/.test(x));
  return parts.length ? parts[parts.length - 1] : '';
}
function titleMatches(title, expected) {
  const want = String(expected || '').trim().toLowerCase();
  if (!want) return true;
  return titleParts(title).some((x) => x.replace(/^[#@]/, '').toLowerCase().includes(want));
}

// Sign-in, security and media pages Facebook needs even inside a group.
const FB_ALWAYS = /^\/(login|login\.php|checkpoint|two_step_verification|two_factor|recover|cookie|privacy\/consent|dialog|auth_platform|confirmemail|logout\.php|photo|photo\.php|photos|video|video\.php|reel|story\.php|permalink\.php|ajax|help)(\/|$|\?)/i;
const DISCORD_ALWAYS = /^\/(login|verify|reset|authorize|oauth2|ra|activate)(\/|$)/i;

// 'allow' | 'block' | { external: url }
function checkUrl(siteId, lock, url) {
  if (!lock || !lock.key) return 'allow';
  const u = parse(url);
  if (!u) return 'block';
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'allow'; // about:blank, data:, blob:
  if (siteId === 'facebook') {
    if (/^l\.facebook\.com$|^lm\.facebook\.com$/i.test(u.hostname)) {
      const target = u.searchParams.get('u');
      return target ? { external: target } : 'block';
    }
    if (!isFbHost(u.hostname)) return { external: url };
    const p = u.pathname;
    if (p === '/' && u.search === '') return 'block';
    const g = /^\/groups\/([^/?#]+)/i.exec(p);
    if (g) {
      const names = [lock.key, ...(lock.aliases || [])].map((x) => String(x).toLowerCase());
      return names.includes(g[1].toLowerCase()) ? 'allow' : 'block';
    }
    if (FB_ALWAYS.test(p)) return 'allow';
    if (/^\/watch\/?$/i.test(p) && u.searchParams.get('v')) return 'allow'; // one video, not the Watch feed
    return 'block';
  }
  if (siteId === 'discord') {
    if (!isDiscordHost(u.hostname)) return { external: url };
    const p = u.pathname;
    const c = /^\/channels\/([^/]+)/.exec(p);
    if (c) return c[1] === String(lock.key) ? 'allow' : 'block';
    if (DISCORD_ALWAYS.test(p)) return 'allow';
    return 'block'; // /app, /store, /shop, /discovery, /channels/@me (DMs) ...
  }
  return 'allow';
}

// Hide the parts of the page that lead outside (best effort; the address rules above do the real locking).
const LOCK_CSS = {
  facebook: `
    div[role="banner"] { display: none !important; }
    div[aria-label="Chats"], div[aria-label="New message"] { display: none !important; }`,
  discord: `
    nav[aria-label="Servers sidebar"], nav[aria-label="Servers"] { display: none !important; }
    [aria-label="Direct Messages"], a[href="/store"], a[href="/shop"], a[data-list-item-id*="guildsnav___home"] { display: none !important; }`,
};

// Facebook shows one group under a name ("subtogroup") and a number ("123456789").
// This script, run on an allowed group page, finds both so either address stays allowed.
const FB_ALIAS_SCRIPT = `(() => {
  const out = new Set();
  const html = document.documentElement.innerHTML;
  const id = html.match(/"groupID":"(\\d+)"/) || html.match(/fb:\\/\\/group\\/(\\d+)/);
  if (id) out.add(id[1]);
  const canon = document.querySelector('link[rel="canonical"]');
  const m = canon && /\\/groups\\/([^/?#]+)/.exec(canon.href);
  if (m) out.add(m[1]);
  return [...out];
})()`;

// Optional unlock PIN, stored only as a salted hash.
function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${h}`;
}
function checkPin(pin, stored) {
  if (!stored) return true;
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const test = crypto.scryptSync(String(pin || ''), salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(h, 'hex'));
}
function validPin(pin) { return /^\d{4,8}$/.test(String(pin || '')); }

module.exports = { serverNameFromTitle, titleMatches, LOCKABLE, lockTargetFromUrl, checkUrl, LOCK_CSS, FB_ALIAS_SCRIPT, hashPin, checkPin, validPin };
