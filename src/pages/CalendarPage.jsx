import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../Icon.jsx';
import { Drawer, openRecord, useDataChanged } from '../crm/shared.jsx';

const DAY = 86400000;
const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const timeStr = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayLabel = (d) => {
  const t = startOfDay(new Date());
  const diff = Math.round((startOfDay(d) - t) / DAY);
  const base = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  return diff === 0 ? `Today · ${base}` : diff === 1 ? `Tomorrow · ${base}` : base;
};
function countdown(ms) {
  const m = Math.round((ms - Date.now()) / 60000);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `in ${h} h ${m % 60} min` : `in ${Math.round(h / 24)} days`;
}

export default function CalendarPage({ settings, setSettings, flash }) {
  const [view, setView] = useState('agenda');
  const [weekStart, setWeekStart] = useState(() => { const d = startOfDay(new Date()); d.setDate(d.getDate() - d.getDay()); return d; });
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [, tick] = useState(0);
  const [openEv, setOpenEv] = useState(null);

  const range = useMemo(() => {
    if (view === 'week') return { from: weekStart, to: new Date(weekStart.getTime() + 7 * DAY) };
    const f = startOfDay(new Date());
    return { from: f, to: new Date(f.getTime() + 14 * DAY) };
  }, [view, weekStart]);

  const load = useCallback(async () => {
    try {
      const to = new Date(range.to.getTime() - 1);
      setData(await window.hub.cal.events(range.from.getTime(), range.to.getTime(), ymdLocal(range.from), ymdLocal(to)));
    } catch (e) { flash(e.message); }
  }, [range]);
  useEffect(() => { load(); }, [load]);
  useDataChanged(load);
  useEffect(() => { const t = setInterval(() => { tick((n) => n + 1); }, 30000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(load, 5 * 60000); return () => clearInterval(t); }, [load]);

  const refresh = async () => { try { await window.hub.cal.refresh(); await load(); flash('Calendar updated.'); } catch (e) { flash(e.message); } };
  const join = (url) => window.hub.cal.join(url).catch((e) => flash(e.message));
  const feeds = settings.calFeeds || [];

  const days = useMemo(() => {
    const n = view === 'week' ? 7 : 14;
    const list = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(range.from.getTime() + i * DAY + 3 * 3600000); // +3h guards DST days
      const s = startOfDay(d), e = new Date(s.getTime() + DAY);
      const key = ymdLocal(s);
      list.push({
        date: s, key,
        events: data ? data.events.filter((ev) => {
          if (!ev.allDay) return ymdLocal(new Date(ev.start)) === key;
          const a = ymdLocal(new Date(ev.start + 12 * 3600000)), b = ymdLocal(new Date(ev.end - 12 * 3600000));
          return key >= a && key <= b;
        }) : [],
        crm: data ? data.crm.filter((c) => c.date === key) : [],
      });
    }
    return list;
  }, [data, view, range]);

  const next = data && data.events.find((e) => !e.allDay && e.end > Date.now() && (e.subto || e.join));

  return (
    <div className="page page-wide cal">
      <header className="page-head">
        <div>
          <h1><Icon name="calendar" size={24} /> Calendar</h1>
          <div className="muted small">
            {feeds.length ? `${feeds.length} Google calendar${feeds.length > 1 ? 's' : ''}` : 'No calendar connected yet'}
            {data && data.status.lastFetch ? ` · updated ${new Date(data.status.lastFetch).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
            {settings.calAlertScope !== 'off' && ` · alerts ${settings.calAlertMin ?? 10} min before ${settings.calAlertScope === 'all' ? 'every event' : settings.calAlertScope === 'zoom' ? 'calls with a Zoom/Meet link' : 'SubTo calls'}`}
          </div>
        </div>
        <div className="row">
          <div className="seg">
            <button className={view === 'agenda' ? 'on' : ''} onClick={() => setView('agenda')}>Next 2 weeks</button>
            <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>Week</button>
          </div>
          <button onClick={refresh}>Refresh</button>
          <button onClick={() => window.hub.app.openExternal('https://calendar.google.com/')}>Open Google Calendar</button>
          <button onClick={() => setEditing(true)}>Settings</button>
        </div>
      </header>

      {data && data.status.feeds.some((f) => f.error) && data.status.feeds.filter((f) => f.error).map((f) => <div key={f.id} className="flag warn" style={{ marginBottom: 8 }}>{f.name}: {f.error}</div>)}
      {!feeds.length && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Connect your Google Calendar (2 minutes, no password)</h3>
          <ol className="small">
            <li>Open <button className="linkish" onClick={() => window.hub.app.openExternal('https://calendar.google.com/calendar/r/settings')}>Google Calendar settings</button> in your browser.</li>
            <li>On the left, under <b>Settings for my calendars</b>, click your calendar.</li>
            <li>Scroll to <b>Integrate calendar</b> and copy the <b>Secret address in iCal format</b>.</li>
            <li>Click <b>Settings</b> here → paste it → Save. Don't share that link with anyone.</li>
          </ol>
          <p className="muted small">Your tasks, deal follow-ups and lead call-backs already show below.</p>
        </div>
      )}

      {next && (
        <div className="card next-call">
          <div>
            <div className="muted small">Next call · {countdown(next.start)}</div>
            <div className="big">{next.title}</div>
            <div className="muted small">{dayLabel(new Date(next.start))} · {timeStr(next.start)}–{timeStr(next.end)}</div>
          </div>
          {next.join && <button className="primary big-btn" onClick={() => join(next.join.url)}>Join {next.join.kind}</button>}
        </div>
      )}

      {view === 'week' && (
        <div className="row" style={{ marginBottom: 8, gap: 6 }}>
          <button className="mini" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY))}>‹ Previous week</button>
          <button className="mini" onClick={() => { const d = startOfDay(new Date()); d.setDate(d.getDate() - d.getDay()); setWeekStart(d); }}>This week</button>
          <button className="mini" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY))}>Next week ›</button>
        </div>
      )}

      <div className={view === 'week' ? 'week-grid' : 'agenda'}>
        {days.map((d) => (
          (view === 'week' || d.events.length || d.crm.length || ymdLocal(new Date()) === d.key) && (
            <section key={d.key} className={`card day ${ymdLocal(new Date()) === d.key ? 'today' : ''}`}>
              <h3>{view === 'week' ? d.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : dayLabel(d.date)}</h3>
              {d.events.length === 0 && d.crm.length === 0 && <div className="muted small">Nothing scheduled.</div>}
              {d.events.map((e) => (
                <div key={e.id} className={`ev ${e.subto ? 'subto' : ''} ${e.end < Date.now() ? 'past' : ''}`} onClick={() => setOpenEv(e)}>
                  <span className="ev-time">{e.allDay ? 'All day' : timeStr(e.start)}</span>
                  <span className="ev-title">{e.title}{e.subto && <span className="tag subto-tag">SubTo</span>}</span>
                  {e.join && e.end > Date.now() && <button className="mini primary" onClick={(x) => { x.stopPropagation(); join(e.join.url); }}>Join</button>}
                </div>
              ))}
              {d.crm.map((c) => (
                <div key={`${c.kind}-${c.id}-${c.title}`} className="ev crm" onClick={() => (c.kind === 'task' ? (c.deal_id ? openRecord('deal', c.deal_id) : window.dispatchEvent(new CustomEvent('hub-open-page', { detail: 'tasks' }))) : openRecord(c.kind, c.id))}>
                  <span className="ev-time">{c.time || (c.kind === 'task' ? 'Task' : c.kind === 'deal' ? 'Deal' : 'Lead')}</span>
                  <span className="ev-title">{c.title}</span>
                </div>
              ))}
            </section>
          )
        ))}
      </div>
      {openEv && <EventDrawer ev={openEv} onClose={() => setOpenEv(null)} join={join} />}
      {editing && <CalSettings settings={settings} setSettings={setSettings} flash={flash} onClose={() => setEditing(false)} onSaved={async () => { await window.hub.cal.refresh().catch(() => {}); load(); }} />}
    </div>
  );
}

function EventDrawer({ ev, onClose, join }) {
  return (
    <Drawer onClose={onClose} width={560}>
      <div className="drawer-head"><h2 style={{ margin: 0 }}>{ev.title}</h2><button className="icon-btn" onClick={onClose}>✕</button></div>
      <p>{dayLabel(new Date(ev.start))}{!ev.allDay && ` · ${timeStr(ev.start)}–${timeStr(ev.end)}`}</p>
      <p className="muted small">{ev.calendar}</p>
      {ev.join && <button className="primary" onClick={() => join(ev.join.url)}>Join {ev.join.kind}</button>}
      {ev.location && <p><b>Where:</b> {ev.location}</p>}
      {ev.description && <pre className="preview-text">{ev.description}</pre>}
    </Drawer>
  );
}

function CalSettings({ settings, setSettings, flash, onClose, onSaved }) {
  const [feeds, setFeeds] = useState(settings.calFeeds && settings.calFeeds.length ? settings.calFeeds : [{ name: 'My calendar', url: '' }]);
  const [mins, setMins] = useState(String(settings.calAlertMin ?? 10));
  const [scope, setScope] = useState(settings.calAlertScope || 'subto');
  const [kw, setKw] = useState(settings.calKeywords || '');
  const save = async () => {
    try {
      let s = await window.hub.settings.set('calFeeds', feeds.filter((f) => f.url.trim()));
      s = await window.hub.settings.set('calAlertMin', mins);
      s = await window.hub.settings.set('calAlertScope', scope);
      s = await window.hub.settings.set('calKeywords', kw);
      setSettings(s);
      flash('Calendar settings saved.');
      onSaved(); onClose();
    } catch (e) { flash(e.message); }
  };
  return (
    <Drawer onClose={onClose} width={640}>
      <div className="drawer-head"><h2 style={{ margin: 0 }}>Calendar settings</h2><button className="icon-btn" onClick={onClose}>✕</button></div>
      <section className="panel-sec">
        <h3>Google Calendar links</h3>
        <p className="muted small">Paste each calendar's <b>Secret address in iCal format</b> (Google Calendar → Settings → your calendar → Integrate calendar). The hub only reads it. Google can take a few hours to show brand-new events in this link.</p>
        {feeds.map((f, i) => (
          <div key={i} className="form-grid">
            <label className="f"><span>Name</span><input value={f.name} onChange={(e) => setFeeds(feeds.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></label>
            <label className="f wide"><span>Secret iCal address</span><input type="password" value={f.url} onChange={(e) => setFeeds(feeds.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" /></label>
            <div><button className="mini" onClick={() => setFeeds(feeds.filter((_, j) => j !== i))}>Remove</button></div>
          </div>
        ))}
        <button className="mini" onClick={() => setFeeds([...feeds, { name: `Calendar ${feeds.length + 1}`, url: '' }])}>+ Add another calendar</button>
      </section>
      <section className="panel-sec">
        <h3>Alerts</h3>
        <div className="form-grid">
          <label className="f"><span>Minutes before</span><input inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} /></label>
          <label className="f wide"><span>Alert me for</span>
            <select className="sel" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="subto">SubTo calls only</option>
              <option value="zoom">SubTo calls + anything with a Zoom/Meet link</option>
              <option value="all">Every timed event</option>
              <option value="off">No alerts</option>
            </select>
          </label>
          <label className="f wide"><span>Words that mark a SubTo call (comma-separated)</span><input value={kw} onChange={(e) => setKw(e.target.value)} /></label>
        </div>
        <button className="mini" onClick={() => window.hub.cal.testAlert().then(() => flash('Test alert sent. Look at the bottom-right of your screen.'))}>Send a test alert</button>
      </section>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save</button></div>
    </Drawer>
  );
}
