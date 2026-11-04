import React, { useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import { when, bytes, greeting } from '../format.js';
import { dueLabel, dueClass, openRecord, useDataChanged, dataChanged } from '../crm/shared.jsx';

// Today's calls, follow-ups and tasks, this week's numbers with trend, and quick ways into the work.
const DAY = 86400000;
const timeStr = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function countdown(ms) {
  const m = Math.round((ms - Date.now()) / 60000);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `in ${h} h ${m % 60} min` : `in ${Math.round(h / 24)} days`;
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function Spark({ values, label }) {
  const w = 120, h = 30, max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * (w - 4) + 2},${h - 3 - (v / max) * (h - 8)}`).join(' ');
  const last = values[values.length - 1] || 0;
  return (
    <svg width={w} height={h} role="img" aria-label={`${label}: last 8 weeks ${values.join(', ')}`} className="spark">
      <title>{`${label} by week (oldest → this week): ${values.join(', ')}`}</title>
      <polyline points={pts} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={w - 2} cy={h - 3 - (last / max) * (h - 8)} r="3" fill="var(--gold)" />
    </svg>
  );
}

function TodayCards({ go, settings, setSettings }) {
  const [due, setDue] = useState(null);
  const [trend, setTrend] = useState(null);
  const [pipe, setPipe] = useState(null);
  const [cal, setCal] = useState(null);
  const [lists, setLists] = useState([]);
  const [recentUw, setRecentUw] = useState([]);
  const [recentFiles, setRecentFiles] = useState([]);
  const [editGoals, setEditGoals] = useState(false);
  const [q, setQ] = useState('');
  const [, tick] = useState(0);
  const load = async () => {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const [d, tr, p, c, l, u, f] = await Promise.all([
      window.hub.crm.dueToday(), window.hub.crm.weeklyTrend(8), window.hub.crm.pipelineCounts(),
      window.hub.cal.events(t0.getTime(), t0.getTime() + 2 * DAY, ymd(t0), ymd(t0)).catch(() => null),
      window.hub.lists.listLists().catch(() => []), window.hub.uw.list({}).catch(() => []), window.hub.search.recent(5).catch(() => []),
    ]);
    setDue(d); setTrend(tr); setPipe(p); setCal(c); setLists(l); setRecentUw(u.slice(0, 4)); setRecentFiles(f);
  };
  useEffect(() => { load(); const t = setInterval(() => { tick((n) => n + 1); }, 30000); const r = setInterval(load, 5 * 60000); return () => { clearInterval(t); clearInterval(r); }; }, []);
  useDataChanged(load);
  if (!due || !trend || !pipe) return null;
  const toggle = async (t) => { await window.hub.crm.setTaskDone(t.id, true); load(); dataChanged(); };
  const week = trend[trend.length - 1];
  const prev = trend[trend.length - 2] || {};
  const goals = settings.weeklyGoals || {};
  const nums = [
    ['calls', 'Calls'], ['conversations', 'Conversations'], ['texts', 'Texts & emails'],
    ['offers', 'Offers'], ['contracts', 'Contracts'], ['closings', 'Closings'],
  ];
  const stages = ['Lead', 'Talking', 'Offer Sent', 'Under Contract', 'Closed'];
  const leads = due.leadFollowUps || [];
  const now = Date.now();
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const calls = cal ? cal.events.filter((e) => !e.allDay && e.end > now && e.start <= todayEnd.getTime()) : [];
  const next = cal && cal.events.find((e) => !e.allDay && e.end > now && (e.subto || e.join));
  const empty = due.followUps.length === 0 && due.tasks.length === 0 && leads.length === 0 && calls.length === 0;
  const queues = lists.map((l) => ({ ...l, left: l.total - l.called })).filter((l) => l.left > 0).slice(0, 4);
  const join = (url) => window.hub.cal.join(url).catch(() => {});
  return (
    <>
      <section className="card span-3 dash-top">
        <form className="dash-search" onSubmit={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('hub-search', { detail: q })); }}>
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything: names, phones, addresses, files… (Ctrl+K)" />
        </form>
        <div className="row wrap" style={{ gap: 6 }}>
          {queues[0] && <button className="primary" onClick={() => go('lists')}>📞 Start calling ({queues[0].left.toLocaleString()} left)</button>}
          <button onClick={() => go('deals')}>+ Deal</button>
          <button onClick={() => go('calculator')}>Underwrite</button>
          <button onClick={() => go('lookup')}>Look up an address</button>
        </div>
      </section>

      {next && (
        <section className="card span-3 next-call">
          <div>
            <div className="muted small">Next call · {countdown(next.start)}</div>
            <div className="big">{next.title}</div>
            <div className="muted small">{timeStr(next.start)}–{timeStr(next.end)}{next.start > todayEnd.getTime() ? ' tomorrow' : ''}</div>
          </div>
          {next.join && <button className="primary big-btn" onClick={() => join(next.join.url)}>Join {next.join.kind}</button>}
        </section>
      )}

      <section className="card span-2">
        <h2>Today</h2>
        {empty && <p className="muted">Nothing due today. Good time to make some calls.</p>}
        {calls.length > 0 && (
          <>
            <h3>Calls & meetings</h3>
            <ul className="tasks">
              {calls.map((e) => (
                <li key={e.id}>
                  <span className="due">{timeStr(e.start)}</span>
                  <span className="t-title">{e.title} {e.subto && <span className="tag subto-tag">SubTo</span>}</span>
                  {e.join && <button className="mini primary" onClick={() => join(e.join.url)}>Join</button>}
                </li>
              ))}
            </ul>
          </>
        )}
        {due.followUps.length > 0 && (
          <>
            <h3>Follow-ups due</h3>
            <ul className="tasks">
              {due.followUps.map((d) => (
                <li key={d.id}>
                  <span className="t-title"><button className="linkish" onClick={() => openRecord('deal', d.id)}>🏠 {d.title}</button></span>
                  <span className="tag">{d.stage}</span>
                  <span className={`due ${dueClass(d.next_follow_up)}`}>{dueLabel(d.next_follow_up)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {leads.length > 0 && (
          <>
            <h3>Lead call-backs due</h3>
            <ul className="tasks">
              {leads.map((l) => (
                <li key={`l${l.id}`}>
                  <span className="t-title"><button className="linkish" onClick={() => openRecord('lead', l.id)}>📞 {l.contact_name || l.title || l.address}</button> <span className="muted small">{l.title || l.address} · {l.list_name}</span></span>
                  <span className="tag">{l.status}</span>
                  <span className={`due ${dueClass(l.follow_up)}`}>{dueLabel(l.follow_up)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {due.tasks.length > 0 && (
          <>
            <h3>Tasks due</h3>
            <ul className="tasks">
              {due.tasks.map((t) => (
                <li key={t.id}>
                  <input type="checkbox" checked={false} onChange={() => toggle(t)} />
                  <span className="t-title">{t.priority === 'High' && <span className="hi">!</span>}{t.title}</span>
                  {t.deal_title && <button className="linkish small" onClick={() => openRecord('deal', t.deal_id)}>{t.deal_title}</button>}
                  {t.contact_name && <button className="linkish small" onClick={() => openRecord('contact', t.contact_id)}>{t.contact_name}</button>}
                  <span className={`due ${dueClass(t.due_date)}`}>{dueLabel(t.due_date)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={() => go('tasks')}>All tasks</button>
          <button onClick={() => go('calendar')}>Calendar</button>
          <button onClick={() => go('lists')}>Lead lists</button>
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>This week</h2>
          <button className="mini" onClick={() => setEditGoals(!editGoals)}>{editGoals ? 'Done' : 'Goals'}</button>
        </div>
        {editGoals && <Goals goals={goals} setSettings={setSettings} />}
        <div className="kpis" style={{ marginTop: 10 }}>
          {nums.map(([k, l]) => {
            const d = (week[k] || 0) - (prev[k] || 0);
            return (
              <div key={k} className="kpi" title={`Last week: ${prev[k] || 0}`}>
                <div className="kpi-n">{week[k]}</div>
                <div className="kpi-l">{l}</div>
                <div className={`kpi-d ${d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted'}`}>{d > 0 ? `▲ ${d}` : d < 0 ? `▼ ${-d}` : '—'} <span className="muted">vs last wk</span></div>
              </div>
            );
          })}
        </div>
        {['calls', 'conversations', 'offers', 'contracts'].filter((k) => goals[k]).map((k) => (
          <div key={k} className="goal">
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="small">{k[0].toUpperCase() + k.slice(1)} goal</span><span className="small">{week[k]} / {goals[k]}</span></div>
            <div className="bar"><div style={{ width: `${Math.min(100, Math.round(((week[k] || 0) / goals[k]) * 100))}%` }} /></div>
          </div>
        ))}
        <h3>Last 8 weeks</h3>
        <div className="trend">
          {[['calls', 'Calls'], ['conversations', 'Conversations'], ['offers', 'Offers']].map(([k, l]) => (
            <div key={k} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}><span className="small">{l}</span><Spark values={trend.map((w) => w[k] || 0)} label={l} /></div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Pipeline</h2>
        <ul className="pipe">
          {stages.map((s) => <li key={s}><span>{s}</span><strong>{pipe[s] || 0}</strong></li>)}
        </ul>
        <button onClick={() => go('deals')}>Deal board</button>
      </section>

      <section className="card">
        <h2>Calling queues</h2>
        {queues.length === 0 && <p className="muted small">No leads waiting. Import a list in Lead Lists.</p>}
        {queues.map((l) => (
          <div key={l.id} className="goal">
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="small"><b>{l.name}</b></span><span className="small muted">{l.left.toLocaleString()} left</span></div>
            <div className="bar"><div style={{ width: `${Math.round((l.called / Math.max(1, l.total)) * 100)}%` }} /></div>
            <div className="muted small">{l.called} called · {l.reached} reached · {l.appointments} appointments</div>
          </div>
        ))}
        <button onClick={() => go('lists')}>Lead lists</button>
      </section>

      <section className="card">
        <h2>Recent</h2>
        {recentUw.length === 0 && recentFiles.length === 0 && <p className="muted small">Saved analyses and new files in your searched folders show here.</p>}
        {recentUw.length > 0 && <h3>Underwriting</h3>}
        <ul className="uw-list">
          {recentUw.map((a) => (
            <li key={a.id} className="clickable" onClick={() => openRecord('analysis', a.id)}><span>{a.name}</span><span className="muted small">{a.summary.cfMo != null ? `${Math.round(a.summary.cfMo).toLocaleString()}/mo` : ''}</span></li>
          ))}
        </ul>
        {recentFiles.length > 0 && <h3>Files</h3>}
        <ul className="uw-list">
          {recentFiles.map((f) => (
            <li key={f.id} className="clickable" onClick={() => window.hub.files.open(f.path).catch(() => {})}><span>{f.name}</span><span className="muted small">{new Date(f.mtime).toLocaleDateString()}</span></li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Goals({ goals, setSettings }) {
  const [g, setG] = useState({ calls: goals.calls || 0, conversations: goals.conversations || 0, offers: goals.offers || 0, contracts: goals.contracts || 0 });
  const save = async (next) => { setG(next); setSettings(await window.hub.settings.set('weeklyGoals', next)); };
  return (
    <div className="form-grid" style={{ marginTop: 8 }}>
      {Object.keys(g).map((k) => (
        <label key={k} className="f"><span>{k[0].toUpperCase() + k.slice(1)} / week</span><input inputMode="numeric" value={g[k]} onChange={(e) => save({ ...g, [k]: e.target.value })} /></label>
      ))}
    </div>
  );
}

const PHASES = [
  [1, 'Foundation', 'App window, sidebar, settings, local database, daily backup'],
  [2, 'Built-in tabs', 'Facebook, Discord, SubTo, Google Voice, DocuSeal, Drive, Calendly'],
  [3, 'CRM, pipeline & tasks', 'Contacts, deal board, follow-ups, click-to-call'],
  [4, 'Underwriting calculator', 'Every property type and structure, with ⓘ explanations'],
  [5, 'Property lookup & STR', 'One address opens every research site'],
  [6, 'Search & documents', 'txt, Excel, Word and PDF, searchable'],
  [7, 'Calendar & alerts', 'Google Calendar, call alerts, Join button'],
  [8, 'Dashboard', "Today's calls, follow-ups and weekly numbers"],
  [9, 'Zoom Chat Organizer & release', 'Connect your existing app, final installer'],
];

export default function Dashboard({ settings, setSettings, go }) {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [info, setInfo] = useState(null);
  const [msg, setMsg] = useState('');

  const refresh = async () => {
    setNotes(await window.hub.notes.list());
    setInfo(await window.hub.app.info());
  };
  useEffect(() => { refresh(); }, []);

  const add = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    try {
      setNotes(await window.hub.notes.add(draft));
      setDraft('');
      setInfo(await window.hub.app.info());
    } catch (err) { setMsg(err.message); }
  };

  const remove = async (id) => {
    setNotes(await window.hub.notes.remove(id));
    setInfo(await window.hub.app.info());
  };

  const name = settings.userName ? `, ${settings.userName}` : '';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{greeting()}{name}</h1>
          <p className="muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
      </header>

      <div className="grid">
        <TodayCards go={go} settings={settings} setSettings={setSettings} />
        <section className="card span-2">
          <h2>Quick notes</h2>
          <p className="muted small">Jot down anything: a lead, an idea from a call, a follow-up. Notes stay after you close the app.</p>
          <form className="row" onSubmit={add}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Call back agent Maria about 123 Main St (sub-to, 3.1% rate)" />
            <button className="primary" type="submit">Save</button>
          </form>
          {msg && <p className="error small">{msg}</p>}
          <ul className="notes">
            {notes.length === 0 && <li className="empty">No notes yet. Add your first one above.</li>}
            {notes.map((n) => (
              <li key={n.id}>
                <div>
                  <div>{n.body}</div>
                  <div className="muted small">{when(n.created_at)}</div>
                </div>
                <button className="icon-btn" title="Delete note" onClick={() => remove(n.id)}><Icon name="trash" size={16} /></button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2><Icon name="shield" /> Your data</h2>
          <dl className="facts">
            <dt>Saved on</dt><dd>This PC</dd>
            <dt>Records</dt><dd>{info ? info.stats.notes : '…'} notes</dd>
            <dt>Database size</dt><dd>{info ? bytes(info.stats.sizeBytes) : '…'}</dd>
            <dt>Last backup</dt><dd>{when(settings.lastBackup)}</dd>
          </dl>
          <button onClick={() => go('settings')}>Backup settings</button>
        </section>

        <section className="card span-3">
          <h2>Build progress</h2>
          <ol className="phases">
            {PHASES.map(([n, title, desc]) => (
              <li key={n} className={n <= 9 ? 'done' : ''}>
                <span className="phase-num">{n <= 9 ? '✓' : n}</span>
                <div>
                  <div className="phase-title">{title}</div>
                  <div className="muted small">{desc}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
