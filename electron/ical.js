// Reads a Google Calendar "secret address in iCal format" feed: events, repeats, time zones.
// No Google login or API needed.

// ---------- time zones (via the built-in Intl database) ----------
const dtfCache = new Map();
function tzParts(ms, tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dtfCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
}
// Wall-clock time in a zone → real UTC milliseconds.
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!tz) return guess;
  try {
    let t = guess - (tzParts(guess, tz) - guess);
    const off2 = tzParts(t, tz) - t; // second pass handles DST edges
    t = guess - off2;
    return t;
  } catch { return guess; }
}

// ---------- parsing ----------
function unfold(text) { return String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }
function unescape(v) { return String(v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); }

function parseLine(line) {
  const i = line.indexOf(':');
  if (i < 0) return null;
  const left = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...ps] = left.split(';');
  const params = {};
  for (const p of ps) { const [k, v] = p.split('='); if (k) params[k.toUpperCase()] = (v || '').replace(/^"|"$/g, ''); }
  return { name: name.toUpperCase(), params, value };
}

// Returns { ms, allDay }
function parseDate(value, params, defaultTz) {
  const v = String(value || '').trim();
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    const y = +v.slice(0, 4), m = +v.slice(4, 6), d = +v.slice(6, 8);
    return { ms: zonedToUtc(y, m, d, 0, 0, 0, defaultTz), allDay: true, ymd: [y, m, d] };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) return { ms: Date.UTC(+y, +mo - 1, +d, +h, +mi, +s), allDay: false };
  return { ms: zonedToUtc(+y, +mo, +d, +h, +mi, +s, params.TZID || defaultTz), allDay: false, tz: params.TZID || defaultTz, wall: [+y, +mo, +d, +h, +mi, +s] };
}

function parseIcs(text) {
  const lines = unfold(text).split('\n');
  const events = [];
  let calTz = '';
  let calName = '';
  let cur = null;
  let depth = 0; // ignore nested VALARM etc.
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [], raw: {} }; depth = 0; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    const p = parseLine(line);
    if (!p) continue;
    if (!cur) {
      if (p.name === 'X-WR-TIMEZONE') calTz = p.value.trim();
      if (p.name === 'X-WR-CALNAME') calName = unescape(p.value);
      continue;
    }
    if (p.name === 'BEGIN') { depth++; continue; }
    if (p.name === 'END') { depth--; continue; }
    if (depth > 0) continue;
    if (p.name === 'EXDATE') { for (const v of p.value.split(',')) cur.exdates.push({ value: v, params: p.params }); continue; }
    cur.raw[p.name] = p;
  }
  const out = [];
  for (const e of events) {
    const r = e.raw;
    if (!r.DTSTART) continue;
    const start = parseDate(r.DTSTART.value, r.DTSTART.params, calTz);
    if (!start) continue;
    let end = r.DTEND ? parseDate(r.DTEND.value, r.DTEND.params, calTz) : null;
    let durMs = end ? end.ms - start.ms : (r.DURATION ? parseDuration(r.DURATION.value) : (start.allDay ? 86400000 : 0));
    if (durMs < 0) durMs = 0;
    out.push({
      uid: r.UID ? r.UID.value : `${r.DTSTART.value}-${r.SUMMARY ? r.SUMMARY.value : ''}`,
      title: r.SUMMARY ? unescape(r.SUMMARY.value) : '(No title)',
      description: r.DESCRIPTION ? unescape(r.DESCRIPTION.value) : '',
      location: r.LOCATION ? unescape(r.LOCATION.value) : '',
      url: r.URL ? r.URL.value : '',
      status: r.STATUS ? r.STATUS.value : '',
      start, durMs,
      rrule: r.RRULE ? r.RRULE.value : '',
      exdates: e.exdates.map((x) => (parseDate(x.value, x.params, calTz) || {}).ms).filter(Boolean),
      recurrenceId: r['RECURRENCE-ID'] ? (parseDate(r['RECURRENCE-ID'].value, r['RECURRENCE-ID'].params, calTz) || {}).ms : null,
    });
  }
  return { tz: calTz, name: calName, events: out };
}

function parseDuration(v) {
  const m = String(v).match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+w || 0) * 7 * 86400 + (+d || 0) * 86400 + (+h || 0) * 3600 + (+mi || 0) * 60 + (+s || 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

// ---------- repeating events ----------
const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// Wall-clock fields of an occurrence in the event's own zone, so 9 AM stays 9 AM across DST.
function wallOf(start) {
  if (start.wall) return start.wall.slice();
  if (start.ymd) return [...start.ymd, 0, 0, 0];
  const d = new Date(start.ms);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
}
function toMs(w, start) {
  if (start.wall || start.ymd) return zonedToUtc(w[0], w[1], w[2], w[3], w[4], w[5], start.tz || (start.ymd ? start.tzAllDay : null));
  return Date.UTC(w[0], w[1] - 1, w[2], w[3], w[4], w[5]);
}
const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const addDaysW = (w, n) => { const t = new Date(Date.UTC(w[0], w[1] - 1, w[2] + n)); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), w[3], w[4], w[5]]; };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function expandRule(ev, fromMs, toMs_, tz) {
  const rule = Object.fromEntries(ev.rrule.split(';').map((p) => p.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = rule.FREQ;
  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  const until = rule.UNTIL ? (parseDate(rule.UNTIL, {}, tz) || {}).ms : Infinity;
  const byday = rule.BYDAY ? rule.BYDAY.split(',') : null;
  const bymonthday = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null;
  const start = { ...ev.start, tzAllDay: tz };
  const w0 = wallOf(start);
  const out = [];
  let n = 0;
  const push = (w) => {
    const ms = toMs(w, start);
    if (ms < ev.start.ms) return true;
    if (ms > until || n >= count) return false;
    n++;
    if (ms + ev.durMs >= fromMs && ms <= toMs_) out.push(ms);
    return ms <= toMs_;
  };
  const guard = 3000;
  if (freq === 'DAILY') {
    for (let i = 0; i < guard; i++) { if (!push(addDaysW(w0, i * interval))) break; }
  } else if (freq === 'WEEKLY') {
    const days = byday ? byday.map((d) => DAYS[d.slice(-2)]).sort((a, b) => a - b) : [dow(w0[0], w0[1], w0[2])];
    const wkStart = addDaysW(w0, -dow(w0[0], w0[1], w0[2])); // Sunday of the first week
    outer: for (let k = 0; k < guard; k++) {
      const base = addDaysW(wkStart, k * 7 * interval);
      for (const d of days) { if (!push(addDaysW(base, d))) break outer; }
    }
  } else if (freq === 'MONTHLY') {
    outer2: for (let k = 0; k < 600; k++) {
      const y = w0[0] + Math.floor((w0[1] - 1 + k * interval) / 12);
      const m = ((w0[1] - 1 + k * interval) % 12) + 1;
      const dates = [];
      if (byday) {
        for (const bd of byday) {
          const mm = bd.match(/^([+-]?\d+)?([A-Z]{2})$/);
          if (!mm) continue;
          const nth = mm[1] ? Number(mm[1]) : 0;
          const wd = DAYS[mm[2]];
          const all = [];
          for (let d = 1; d <= daysInMonth(y, m); d++) if (dow(y, m, d) === wd) all.push(d);
          if (nth > 0 && all[nth - 1]) dates.push(all[nth - 1]);
          else if (nth < 0 && all[all.length + nth]) dates.push(all[all.length + nth]);
          else if (!nth) dates.push(...all);
        }
      } else {
        for (const md of bymonthday || [w0[2]]) { const d = md < 0 ? daysInMonth(y, m) + md + 1 : md; if (d >= 1 && d <= daysInMonth(y, m)) dates.push(d); }
      }
      for (const d of dates.sort((a, b) => a - b)) { if (!push([y, m, d, w0[3], w0[4], w0[5]])) break outer2; }
    }
  } else if (freq === 'YEARLY') {
    for (let k = 0; k < 200; k++) {
      const y = w0[0] + k * interval;
      if (w0[2] > daysInMonth(y, w0[1])) continue;
      if (!push([y, w0[1], w0[2], w0[3], w0[4], w0[5]])) break;
    }
  } else {
    if (ev.start.ms + ev.durMs >= fromMs && ev.start.ms <= toMs_) out.push(ev.start.ms);
  }
  return out;
}

// All occurrences between two times, with moved/cancelled single occurrences applied.
function expand(parsed, fromMs, toMs_) {
  const overrides = new Map();
  for (const e of parsed.events) if (e.recurrenceId) overrides.set(`${e.uid}|${e.recurrenceId}`, e);
  const out = [];
  for (const e of parsed.events) {
    if (e.recurrenceId) continue;
    const starts = e.rrule ? expandRule(e, fromMs, toMs_, parsed.tz) : (e.start.ms + e.durMs >= fromMs && e.start.ms <= toMs_ ? [e.start.ms] : []);
    for (const s of starts) {
      if (e.exdates.includes(s)) continue;
      const ov = overrides.get(`${e.uid}|${s}`);
      const src = ov || e;
      if (src.status === 'CANCELLED') continue;
      const st = ov ? ov.start.ms : s;
      out.push({ uid: e.uid, id: `${e.uid}|${s}`, title: src.title, description: src.description, location: src.location, url: src.url, start: st, end: st + (ov ? ov.durMs : e.durMs), allDay: !!src.start.allDay });
    }
  }
  // Moved occurrences that land in range but whose original date did not.
  for (const [, ov] of overrides) {
    if (ov.status === 'CANCELLED') continue;
    if (out.some((x) => x.id === `${ov.uid}|${ov.recurrenceId}`)) continue;
    if (ov.start.ms + ov.durMs >= fromMs && ov.start.ms <= toMs_) out.push({ uid: ov.uid, id: `${ov.uid}|${ov.recurrenceId}`, title: ov.title, description: ov.description, location: ov.location, url: ov.url, start: ov.start.ms, end: ov.start.ms + ov.durMs, allDay: !!ov.start.allDay });
  }
  return out.sort((a, b) => a.start - b.start);
}

// Zoom / Meet / Teams link in an event.
function joinLink(ev) {
  const text = `${ev.location || ''}\n${ev.url || ''}\n${ev.description || ''}`;
  const zoom = text.match(/https:\/\/[\w.-]*zoom\.us\/(?:j|my|w|s)\/[^\s<>"')\]]+/i);
  if (zoom) return { kind: 'Zoom', url: zoom[0].replace(/[.,;]+$/, '') };
  const meet = text.match(/https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i);
  if (meet) return { kind: 'Google Meet', url: meet[0] };
  const teams = text.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"')\]]+/i);
  if (teams) return { kind: 'Teams', url: teams[0] };
  return null;
}

module.exports = { parseIcs, expand, joinLink, zonedToUtc, parseDuration };
