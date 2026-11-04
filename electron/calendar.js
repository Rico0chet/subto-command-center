// Calendar & alerts: reads your Google Calendar private iCal links, highlights SubTo calls,
// and pops a Windows alert before each call with a one-click Join.
const fs = require('fs');
const path = require('path');
const { parseIcs, expand, joinLink } = require('./ical');

const DAY = 86400000;

function createCalendar({ dataDir, db, getSettings, fetchText, notify, onAlert }) {
  const cacheFile = path.join(dataDir, 'calendar-cache.json');
  let feeds = []; // { name, parsed, error, fetchedAt }
  let lastFetch = null;
  const alerted = new Set();
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    feeds = (c.feeds || []).map((f) => ({ ...f, parsed: f.ics ? parseIcs(f.ics) : null }));
    lastFetch = c.lastFetch || null;
  } catch { /* no cache yet */ }

  async function refresh() {
    const s = getSettings();
    const out = [];
    for (const f of s.calFeeds || []) {
      try {
        const ics = process.env.SUBTO_CAL_FILE ? fs.readFileSync(process.env.SUBTO_CAL_FILE, 'utf8') : await fetchText(f.url);
        if (!/BEGIN:VCALENDAR/.test(ics)) throw new Error('That link did not return a calendar. Use the "Secret address in iCal format".');
        out.push({ id: f.id, name: f.name, ics, parsed: parseIcs(ics), error: '', fetchedAt: new Date().toISOString() });
      } catch (e) {
        const old = feeds.find((x) => x.id === f.id);
        out.push({ id: f.id, name: f.name, ics: old ? old.ics : '', parsed: old ? old.parsed : null, error: e.message, fetchedAt: old ? old.fetchedAt : null });
      }
    }
    feeds = out;
    lastFetch = new Date().toISOString();
    try { fs.writeFileSync(cacheFile, JSON.stringify({ lastFetch, feeds: feeds.map(({ parsed, ...f }) => f) })); } catch { /* ignore */ }
    return status();
  }

  const keywords = () => String(getSettings().calKeywords || '').split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
  function isSubto(ev, kw = keywords()) {
    const t = `${ev.title} ${ev.description} ${ev.location}`.toLowerCase();
    return kw.some((k) => t.includes(k));
  }

  function events(fromMs, toMs) {
    const kw = keywords();
    const all = [];
    for (const f of feeds) {
      if (!f.parsed) continue;
      for (const e of expand(f.parsed, fromMs, toMs)) {
        const join = joinLink(e);
        all.push({ ...e, calendar: f.name, feedId: f.id, join, subto: isSubto(e, kw), description: e.description.slice(0, 2000) });
      }
    }
    return all.sort((a, b) => a.start - b.start);
  }

  // Tasks, deal follow-ups and lead call-backs/appointments from the CRM, by date.
  function crmItems(fromYmd, toYmd) {
    const tasks = db.all('SELECT id, title, due_date AS date, deal_id, contact_id, priority FROM tasks WHERE done = 0 AND due_date BETWEEN ? AND ? ORDER BY due_date', [fromYmd, toYmd])
      .map((t) => ({ kind: 'task', ...t }));
    const deals = db.all("SELECT id, address, city, next_follow_up AS date, stage FROM deals WHERE next_follow_up BETWEEN ? AND ? AND stage NOT IN ('Closed','Dead')", [fromYmd, toYmd])
      .map((d) => ({ kind: 'deal', id: d.id, title: `Follow up: ${[d.address, d.city].filter(Boolean).join(', ')}`, date: d.date, stage: d.stage }));
    const leads = db.all(`SELECT li.id, li.title, li.address, li.follow_up, li.appointment, c.first_name, c.last_name FROM list_items li LEFT JOIN contacts c ON c.id = li.contact_id
      WHERE (li.follow_up BETWEEN ? AND ?) OR (substr(li.appointment, 1, 10) BETWEEN ? AND ?)`, [fromYmd, toYmd, fromYmd, toYmd]);
    const leadItems = [];
    for (const l of leads) {
      const who = [l.first_name, l.last_name].filter(Boolean).join(' ') || l.title || l.address;
      if (l.follow_up && l.follow_up >= fromYmd && l.follow_up <= toYmd) leadItems.push({ kind: 'lead', id: l.id, title: `Call back: ${who}`, date: l.follow_up });
      const ap = String(l.appointment || '').slice(0, 10);
      if (ap && ap >= fromYmd && ap <= toYmd) leadItems.push({ kind: 'lead', id: l.id, title: `Appointment: ${who}`, date: ap, time: String(l.appointment).slice(11, 16) });
    }
    return [...tasks, ...deals, ...leadItems];
  }

  // Called every 30 seconds.
  function checkAlerts(now = Date.now()) {
    const s = getSettings();
    const mins = Math.max(0, Number(s.calAlertMin ?? 10));
    const scope = s.calAlertScope || 'subto';
    if (scope === 'off') return [];
    const fired = [];
    for (const e of events(now - 60000, now + (mins + 1) * 60000)) {
      if (e.allDay) continue;
      if (scope === 'subto' && !e.subto) continue;
      if (scope === 'zoom' && !e.join && !e.subto) continue;
      const lead = e.start - now;
      if (lead > mins * 60000 || lead < -60000) continue;
      const key = `${e.id}|${e.start}`;
      if (alerted.has(key)) continue;
      alerted.add(key);
      fired.push(e);
      onAlert(e, Math.max(0, Math.round(lead / 60000)));
    }
    return fired;
  }

  function status() {
    return { lastFetch, feeds: feeds.map((f) => ({ id: f.id, name: f.name, error: f.error, fetchedAt: f.fetchedAt, events: f.parsed ? f.parsed.events.length : 0 })) };
  }

  return { refresh, events, crmItems, checkAlerts, status, isSubto };
}

module.exports = { createCalendar, DAY };
