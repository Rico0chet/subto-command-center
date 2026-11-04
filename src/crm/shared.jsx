import React, { useEffect, useState } from 'react';
import { chooseBrowserFor } from '../browserPicker.jsx';

// ---------- formatting ----------
export const money = (n) => (n == null || n === '' ? '' : `$${Math.round(Number(n)).toLocaleString('en-US')}`);
export const pct = (n) => (n == null || n === '' ? '' : `${Number(n)}%`);
export function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }
export function dueLabel(date) {
  if (!date) return '';
  const t = ymd();
  if (date === t) return 'Today';
  if (date === addDays(1)) return 'Tomorrow';
  if (date === addDays(-1)) return 'Yesterday';
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}
export const dueClass = (date, done) => (!date || done ? '' : date < ymd() ? 'due-over' : date === ymd() ? 'due-today' : '');
export function ago(sqlUtc) {
  if (!sqlUtc) return '';
  const t = Date.parse(sqlUtc.replace(' ', 'T') + 'Z');
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------- options (stages, roles...) ----------
let optionsCache = null;
export function useOptions() {
  const [o, setO] = useState(optionsCache);
  useEffect(() => { if (!optionsCache) window.hub.crm.options().then((x) => { optionsCache = x; setO(x); }); }, []);
  return o;
}

// ---------- moving around the app ----------
export const openRecord = (type, id) => window.dispatchEvent(new CustomEvent('hub-open', { detail: { type, id } }));
export const dataChanged = () => window.dispatchEvent(new CustomEvent('hub-data-changed'));
export function useDataChanged(fn) {
  useEffect(() => {
    window.addEventListener('hub-data-changed', fn);
    return () => window.removeEventListener('hub-data-changed', fn);
  });
}

// ---------- calling ----------
// Starts a Google Voice call (inside the hub or in its browser window), then offers to log the result.
export async function callNumber(number, who, flash) {
  try {
    const info = await window.hub.crm.callInfo(number);
    if (info.mode === 'tab') {
      window.dispatchEvent(new CustomEvent('hub-open-site', { detail: { siteId: 'voice', url: info.url } }));
    } else {
      const r = await window.hub.sites.openWindow('voice', undefined, false, info.url);
      if (r.needChoice) {
        const sites = await window.hub.sites.list();
        chooseBrowserFor(sites.find((s) => s.id === 'voice'), info.url);
      }
    }
    window.dispatchEvent(new CustomEvent('hub-call-started', { detail: { number, ...who } }));
  } catch (e) { flash(e.message); }
}

export async function copyText(text, flash, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); flash(`${what}: ${text}`); }
  catch { flash("Couldn't copy"); }
}

export function PhoneActions({ phone, who, flash, compact }) {
  if (!phone) return null;
  return (
    <span className="phone-actions" onClick={(e) => e.stopPropagation()}>
      {!compact && <span className="phone-num">{phone}</span>}
      <button className="mini primary" title="Call with Google Voice" onClick={() => callNumber(phone, who, flash)}>Call</button>
      <button className="mini" title="Copy the number (to paste into a text)" onClick={() => copyText(phone, flash, 'Number copied')}>Copy</button>
    </span>
  );
}

// Floating "how did it go?" box after a call. It doesn't block the Google Voice tab.
export function CallLoggerHost({ flash }) {
  const [call, setCall] = useState(null);
  const [note, setNote] = useState('');
  const opts = useOptions();
  useEffect(() => {
    // Calls from a lead list are logged with that lead's own result buttons instead.
    const h = (e) => { if (e.detail && e.detail.skipLogger) return; setCall(e.detail); setNote(''); };
    window.addEventListener('hub-call-started', h);
    return () => window.removeEventListener('hub-call-started', h);
  }, []);
  if (!call || !opts) return null;
  const canLog = call.contactId || call.dealId;
  const log = async (outcome) => {
    try {
      await window.hub.crm.logActivity({ kind: 'call', outcome, body: note, contact_id: call.contactId, deal_id: call.dealId });
      flash(`Call logged: ${outcome}`);
      setCall(null);
      dataChanged();
    } catch (e) { flash(e.message); }
  };
  return (
    <div className="call-logger">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>📞 Calling {call.name || call.number}</strong>
        <button className="icon-btn" title="Close" onClick={() => setCall(null)}>✕</button>
      </div>
      {canLog ? (
        <>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notes from the call (optional)" />
          <div className="outcomes">
            {opts.callOutcomes.map((o) => <button key={o} className="mini" onClick={() => log(o)}>{o}</button>)}
          </div>
        </>
      ) : <p className="muted small">Tip: call from a contact or deal to log the result automatically.</p>}
    </div>
  );
}

// ---------- form bits ----------
export function Field({ label, children, wide }) {
  return <label className={`f ${wide ? 'wide' : ''}`}><span>{label}</span>{children}</label>;
}
export function Select({ value, onChange, options, blank }) {
  return (
    <select className="sel" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {blank != null && <option value="">{blank}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function Drawer({ onClose, children, width = 620 }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="drawer-back" onMouseDown={onClose}>
      <aside className="drawer" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>{children}</aside>
    </div>
  );
}

const KIND_LABEL = { note: '📝 Note', call: '📞 Call', text: '💬 Text', email: '✉️ Email', offer: '📄 Offer', meeting: '🤝 Meeting', stage: '➡️ Stage', chat: '💬 Zoom chat' };

// The activity log: quick add + history.
export function ActivityLog({ dealId, contactId, items, onChanged, flash, showLinks }) {
  const [kind, setKind] = useState('note');
  const [body, setBody] = useState('');
  const opts = useOptions();
  const add = async (e) => {
    e.preventDefault();
    try {
      await window.hub.crm.logActivity({ kind, body, outcome: kind === 'call' ? 'Talked' : '', deal_id: dealId, contact_id: contactId });
      setBody('');
      onChanged();
      dataChanged();
    } catch (err) { flash(err.message); }
  };
  const del = async (id) => { await window.hub.crm.deleteActivity(id); onChanged(); dataChanged(); };
  return (
    <div className="activity">
      <form className="row" onSubmit={add}>
        <select className="sel" value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 120 }}>
          {['note', 'call', 'text', 'email', 'offer', 'meeting'].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === 'offer' ? 'Offer details, e.g. Sub-to, $10k entry, close in 30 days' : 'What happened?'} />
        <button className="primary" type="submit">Log</button>
      </form>
      {opts && kind === 'call' && <p className="muted small">Logged as "Talked". Use a phone's Call button to pick other results.</p>}
      <ul className="timeline">
        {items.length === 0 && <li className="muted">Nothing logged yet.</li>}
        {items.map((a) => (
          <li key={a.id} className={`k-${a.kind}`}>
            <div className="tl-head">
              <span className="tl-kind">{KIND_LABEL[a.kind] || a.kind}{a.outcome ? ` · ${a.outcome}` : ''}</span>
              <span className="muted small">{ago(a.created_at)}</span>
              {a.kind !== 'stage' && a.kind !== 'chat' && <button className="icon-btn" title="Delete" onClick={() => del(a.id)}>✕</button>}
            </div>
            {a.body && <div className="tl-body">{a.body}</div>}
            {showLinks && (a.contact_name || a.deal_title) && (
              <div className="muted small">
                {a.contact_name && <button className="linkish" onClick={() => openRecord('contact', a.contact_id)}>{a.contact_name}</button>}
                {a.contact_name && a.deal_title && ' · '}
                {a.deal_title && <button className="linkish" onClick={() => openRecord('deal', a.deal_id)}>{a.deal_title}</button>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Small task list used inside deals and contacts.
export function TaskList({ tasks, dealId, contactId, onChanged, flash, showLinks }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const add = async (e) => {
    e.preventDefault();
    try {
      await window.hub.crm.saveTask({ title, due_date: due, deal_id: dealId, contact_id: contactId });
      setTitle(''); setDue('');
      onChanged(); dataChanged();
    } catch (err) { flash(err.message); }
  };
  const toggle = async (t) => { await window.hub.crm.setTaskDone(t.id, !t.done); onChanged(); dataChanged(); };
  const del = async (t) => { await window.hub.crm.deleteTask(t.id); onChanged(); dataChanged(); };
  return (
    <div>
      <form className="row" onSubmit={add}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task, e.g. Send offer to agent" />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ width: 150, minWidth: 150 }} />
        <button className="primary" type="submit">Add</button>
      </form>
      <div className="quick-dates">
        {[['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]].map(([l, n]) => (
          <button key={l} type="button" className="mini" onClick={() => setDue(addDays(n))}>{l}</button>
        ))}
      </div>
      <ul className="tasks">
        {tasks.map((t) => (
          <li key={t.id} className={t.done ? 'done' : ''}>
            <input type="checkbox" checked={t.done} onChange={() => toggle(t)} />
            <span className="t-title">{t.priority === 'High' && !t.done && <span className="hi">!</span>}{t.title}</span>
            {showLinks && t.deal_title && <button className="linkish small" onClick={() => openRecord('deal', t.deal_id)}>{t.deal_title}</button>}
            {showLinks && t.contact_name && <button className="linkish small" onClick={() => openRecord('contact', t.contact_id)}>{t.contact_name}</button>}
            {t.due_date && <span className={`due ${dueClass(t.due_date, t.done)}`}>{dueLabel(t.due_date)}</span>}
            <button className="icon-btn" title="Delete task" onClick={() => del(t)}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
