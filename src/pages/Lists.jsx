import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import { askConfirm } from '../confirm.jsx';
import ImportDialog from './ImportDialog.jsx';
import {
  money, dueLabel, dueClass, ago, useDataChanged, dataChanged, openRecord, Field, Drawer, callNumber, copyText,
} from '../crm/shared.jsx';

const CLOSED = ['Not interested', 'Wrong number', 'Do not call', 'Sold / under contract'];
const statusClass = (s) => `st st-${String(s).toLowerCase().replace(/[^a-z]+/g, '-')}`;

export default function Lists({ flash, focusId, clearFocus }) {
  const [lists, setLists] = useState([]);
  const [openList, setOpenList] = useState(null);
  const [importing, setImporting] = useState(false);
  const load = useCallback(async () => setLists(await window.hub.lists.listLists()), []);
  useEffect(() => { load(); }, [load]);
  useDataChanged(load);
  const [focusItem, setFocusItem] = useState(null);
  // Opened from elsewhere: { listId, itemId } or just a lead's id.
  useEffect(() => {
    if (!focusId) return;
    (async () => {
      try {
        if (typeof focusId === 'object') { setOpenList(focusId.listId); setFocusItem(focusId.itemId || null); }
        else { const it = await window.hub.lists.getItem(focusId); setOpenList(it.list_id); setFocusItem(it.id); }
      } catch (e) { flash(e.message); }
      clearFocus();
    })();
  }, [focusId]);

  const current = lists.find((l) => l.id === openList);
  if (current) return <ListView key={`${current.id}-${focusItem || ''}`} list={current} flash={flash} onBack={() => { setOpenList(null); setFocusItem(null); }} focusItem={focusItem} />;

  return (
    <div className="page page-wide">
      <header className="page-head">
        <h1><Icon name="phone" size={24} /> Lead Lists</h1>
        <button className="primary" onClick={() => setImporting(true)}>Import a list…</button>
      </header>
      {lists.length === 0 && (
        <section className="card soon-card">
          <p><strong>No lists yet.</strong> Import a call list, owner list or skip-traced list from Excel or CSV. Each one becomes a call queue you can work top to bottom.</p>
          <button className="primary" onClick={() => setImporting(true)}>Import a list…</button>
        </section>
      )}
      <div className="list-cards">
        {lists.map((l) => {
          const pct = l.total ? Math.round((l.called / l.total) * 100) : 0;
          return (
            <article key={l.id} className="card list-card" onClick={() => setOpenList(l.id)}>
              <h2>{l.name}</h2>
              <div className="muted small">{l.file_name} · imported {ago(l.created_at)}</div>
              <div className="bar" title={`${pct}% called`}><div style={{ width: `${pct}%` }} /></div>
              <div className="list-stats">
                <span><strong>{l.total.toLocaleString()}</strong> leads</span>
                <span><strong>{(l.called || 0).toLocaleString()}</strong> called</span>
                <span><strong>{l.reached || 0}</strong> reached</span>
                <span><strong>{l.interested || 0}</strong> interested</span>
                <span><strong>{l.appointments || 0}</strong> appointments</span>
                <span><strong>{l.deals || 0}</strong> deals</span>
              </div>
            </article>
          );
        })}
      </div>
      {importing && <ImportDialog flash={flash} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
    </div>
  );
}

function ListView({ list, flash, onBack, focusItem }) {
  const [statuses, setStatuses] = useState([]);
  const [filter, setFilter] = useState({ q: '', status: '', hideClosed: true });
  const [page, setPage] = useState(0);
  const [data, setData] = useState({ total: 0, items: [] });
  const [openItem, setOpenItem] = useState(focusItem || null);
  const PER = 100;
  const load = useCallback(async () => setData(await window.hub.lists.listItems(list.id, { ...filter, offset: page * PER, limit: PER })), [list.id, filter, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.hub.lists.statuses().then(setStatuses); }, []);
  useDataChanged(load);

  const exportIt = async () => {
    try {
      const r = await window.hub.lists.export(list.id);
      if (r) flash(`Exported ${r.rows.toLocaleString()} rows${r.original ? ' in the original columns' : ''}.`);
    } catch (e) { flash(e.message); }
  };
  const remove = async () => {
    if (!(await askConfirm(`Delete the list "${list.name}"?\n\n${list.total.toLocaleString()} leads are removed. Deals you made from it, and people who are your contacts, are kept.`, 'Delete list'))) return;
    await window.hub.lists.deleteList(list.id);
    dataChanged();
    onBack();
  };
  const setF = (k, v) => { setFilter((f) => ({ ...f, [k]: v })); setPage(0); };
  const pages = Math.max(1, Math.ceil(data.total / PER));

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <button className="linkish small" onClick={onBack}>‹ All lists</button>
          <h1 style={{ marginTop: 4 }}>{list.name}</h1>
          <div className="muted small">{list.total.toLocaleString()} leads · {(list.called || 0).toLocaleString()} called · {list.appointments || 0} appointments · {list.deals || 0} deals</div>
        </div>
        <div className="row">
          <button onClick={exportIt}>Export to Excel</button>
          <button className="danger-btn" onClick={remove}>Delete list</button>
        </div>
      </header>
      {list.info && <details className="card list-info"><summary>About this list (from the file)</summary><div style={{ whiteSpace: 'pre-wrap' }}>{list.info}</div></details>}

      <div className="row" style={{ marginBottom: 12 }}>
        <input className="search" value={filter.q} onChange={(e) => setF('q', e.target.value)} placeholder="Search address, city, name, notes…" />
        <select className="sel" value={filter.status} onChange={(e) => setF('status', e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="remember" style={{ margin: 0 }}>
          <input type="checkbox" checked={filter.hideClosed} onChange={(e) => setF('hideClosed', e.target.checked)} /> Hide finished (not interested, wrong number, DNC, sold)
        </label>
        <span style={{ flex: 1 }} />
        {data.items[0] && <button className="primary" onClick={() => setOpenItem(data.items.find((x) => x.status === 'Not called')?.id || data.items[0].id)}>Start calling ▶</button>}
      </div>

      <section className="card" style={{ padding: 0 }}>
        <table className="table contacts-table">
          <thead><tr><th>#</th><th>Property</th><th>Person</th><th>Phone</th><th>Key info</th><th>Status</th><th>Tries</th><th>Follow-up</th></tr></thead>
          <tbody>
            {data.items.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 20 }}>No leads match.</td></tr>}
            {data.items.map((it) => (
              <tr key={it.id} className={`clickable ${CLOSED.includes(it.status) ? 'row-closed' : ''}`} onClick={() => setOpenItem(it.id)}>
                <td className="muted small">{it.position}</td>
                <td><strong>{it.title || it.address}</strong><div className="muted small">{it.title ? `${it.address}, ` : ''}{[it.city, it.state].filter(Boolean).join(', ')}{it.price ? ` · ${money(it.price)}` : ''}{it.units ? ` · ${it.units} units` : ''}</div></td>
                <td>{it.contact_name}{it.company && it.contact_name !== it.company && <div className="muted small">{it.company}</div>}</td>
                <td className="small" style={{ whiteSpace: 'nowrap' }}>{it.phone}</td>
                <td className="small"><div className="key-info">{it.highlight}</div></td>
                <td><span className={statusClass(it.status)}>{it.status}</span>{it.deal_id && <span className="tag" style={{ marginLeft: 4 }}>Deal</span>}</td>
                <td className="small">{it.attempts || ''}</td>
                <td>{it.follow_up && <span className={`due ${dueClass(it.follow_up)}`}>{dueLabel(it.follow_up)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {pages > 1 && (
        <div className="row pager">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Previous</button>
          <span className="muted small">Page {page + 1} of {pages} · {data.total.toLocaleString()} leads</span>
          <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
        </div>
      )}
      {openItem && <LeadPanel id={openItem} filter={filter} flash={flash} onClose={() => setOpenItem(null)} onOpen={setOpenItem} onChanged={load} />}
    </div>
  );
}

const RESULTS = [
  ['No answer', ''], ['Left voicemail', ''], ['Call back', ''], ['Interested', 'good'], ['Appointment set', 'good'],
  ['Not interested', 'bad'], ['Wrong number', 'bad'], ['Do not call', 'bad'], ['Sold / under contract', 'bad'],
];

export function LeadPanel({ id, filter, flash, onClose, onOpen, onChanged }) {
  const [it, setIt] = useState(null);
  const [note, setNote] = useState('');
  const [form, setForm] = useState({});
  const [autoNext, setAutoNext] = useState(true);
  const [showBackups, setShowBackups] = useState(false);

  const load = useCallback(async () => {
    try {
      const x = await window.hub.lists.getItem(id);
      setIt(x);
      setForm({ follow_up: x.follow_up || '', appointment: x.appointment || '', notes: x.notes || '' });
    } catch (e) { flash(e.message); onClose(); }
  }, [id]);
  useEffect(() => { load(); setNote(''); setShowBackups(false); }, [id]);
  if (!it) return null;

  const c = it.contact;
  const phones = c ? (c.more_phones.length ? c.more_phones : [c.phone, c.phone2].filter(Boolean).map((n) => ({ n }))) : [];
  const who = { name: c ? c.name : it.title, contactId: c && c.id, listItemId: it.id, skipLogger: true };
  const go = async (dir) => {
    const next = await window.hub.lists.neighbor(it.id, dir, filter);
    if (next) onOpen(next); else flash(dir > 0 ? 'That was the last lead in this view.' : 'This is the first lead.');
  };
  const result = async (status) => {
    try {
      await window.hub.lists.setStatus(it.id, status, note);
      setNote('');
      onChanged(); dataChanged();
      flash(`${status} logged.`);
      if (autoNext && !['Interested', 'Appointment set'].includes(status)) await go(1);
      else load();
    } catch (e) { flash(e.message); }
  };
  const saveField = async (k) => {
    if ((it[k] || '') === (form[k] || '')) return;
    try { const x = await window.hub.lists.updateItem(it.id, { [k]: form[k] }); setIt(x); onChanged(); dataChanged(); } catch (e) { flash(e.message); }
  };
  const markBad = async (p) => { await window.hub.lists.markPhone(c.id, p.n, !p.bad); load(); };
  const makeDeal = async () => {
    try {
      const dealId = await window.hub.lists.promote(it.id);
      dataChanged();
      flash('Deal created and added to your board.', { label: 'Open deal', run: () => openRecord('deal', dealId) });
      load();
    } catch (e) { flash(e.message); }
  };
  const hot = ['Interested', 'Appointment set'].includes(it.status);
  const warn = [c && c.flags, it.flags].filter(Boolean).join(' · ');

  return (
    <Drawer onClose={onClose} width={720}>
      <div className="drawer-head">
        <div>
          <div className="muted small">{it.list.name} · #{it.position}</div>
          <h2 style={{ margin: '2px 0 0' }}>{it.title || it.address || 'Lead'}</h2>
          <div className="muted small">{it.title ? `${it.address}, ` : ''}{[it.city, it.state, it.zip].filter(Boolean).join(', ')}
            {it.address && <button className="mini" style={{ marginLeft: 8 }} onClick={() => window.dispatchEvent(new CustomEvent('hub-lookup', { detail: [it.address, it.city, [it.state, it.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') }))}>Look up</button>}
            {it.address && <button className="mini" style={{ marginLeft: 4 }} onClick={() => openRecord('uwLead', it.id)}>Underwrite</button>}
          </div>
        </div>
        <div className="row">
          <button className="mini" onClick={() => go(-1)}>‹ Prev</button>
          <button className="mini" onClick={() => go(1)}>Next ›</button>
          <button className="icon-btn" title="Close" onClick={onClose}>✕</button>
        </div>
      </div>

      {warn && <div className="warn-bar">⚠ {warn}</div>}

      <section className="panel-sec">
        <div className="facts-row">
          <span className={statusClass(it.status)}>{it.status}</span>
          {it.attempts > 0 && <span>{it.attempts} tr{it.attempts === 1 ? 'y' : 'ies'}</span>}
          {it.last_called && <span>last {it.last_called}</span>}
          {it.property_type && <span>{it.property_type}</span>}
          {it.price != null && <span>{money(it.price)}</span>}
          {it.dom && <span>{it.dom} days on market</span>}
          {it.units && <span>{it.units} units</span>}
          {it.year_built && <span>built {it.year_built}</span>}
          {it.caller && <span>caller: {it.caller}</span>}
        </div>
        {it.highlights.length > 0 && (
          <dl className="facts highlights">
            {it.highlights.map((h) => (<React.Fragment key={h.label}><dt>{h.label}</dt><dd>{/^https?:\/\//.test(h.value) ? <button className="linkish" onClick={() => window.hub.app.openExternal(h.value)}>{h.value}</button> : h.value}</dd></React.Fragment>))}
          </dl>
        )}
      </section>

      <section className="panel-sec">
        <h3>{c ? 'Who to call' : 'No person on this lead'}</h3>
        {c && (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><strong>{c.name}</strong> <span className="tag">{c.role}</span>{c.company && c.company !== c.name && <span className="muted small"> · {c.company}</span>}</div>
              <button className="linkish small" onClick={() => openRecord('contact', c.id)}>Open contact</button>
            </div>
            <ul className="phone-list">
              {phones.map((p) => (
                <li key={p.n} className={p.bad ? 'bad' : ''}>
                  <span className="phone-num">{p.n}</span>
                  {(p.type || p.label) && <span className="tag">{[p.label, p.type].filter(Boolean).join(' · ')}</span>}
                  <span style={{ flex: 1 }} />
                  {!p.bad && <button className="mini primary" onClick={() => callNumber(p.n, who, flash)}>Call</button>}
                  <button className="mini" onClick={() => copyText(p.n, flash, 'Number copied')}>Copy</button>
                  {c.more_phones.length > 0 && <button className="mini" title={p.bad ? 'Mark as working' : 'Mark as a bad number'} onClick={() => markBad(p)}>{p.bad ? 'Undo bad' : 'Bad #'}</button>}
                </li>
              ))}
              {phones.length === 0 && <li className="muted">No phone numbers on this lead.</li>}
            </ul>
            {(c.email || c.emails2) && <div className="small">✉ {[c.email, c.emails2].filter(Boolean).join(', ')}</div>}
            {c.address && <div className="small muted">Mailing: {c.address}</div>}
          </>
        )}
        {it.people.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <button className="linkish small" onClick={() => setShowBackups(!showBackups)}>{showBackups ? '▾' : '▸'} Backup numbers: {it.people.length} co-owner / relative{it.people.length > 1 ? 's' : ''}</button>
            {showBackups && (
              <ul className="phone-list">
                {it.people.map((p, i) => (
                  <li key={i} className="backup">
                    <div style={{ minWidth: 190 }}><strong>{p.name}</strong> <span className="muted small">{p.role}{p.age ? `, ${p.age}` : ''}{p.deceased ? ', may be deceased' : ''}</span></div>
                    <div className="row" style={{ flex: 1, gap: 6 }}>
                      {p.phones.map((ph) => (
                        <span key={ph.n} className="phone-actions">
                          <button className="mini" title={`Call ${ph.type || ''}`} onClick={() => callNumber(ph.n, { ...who, name: p.name }, flash)}>{ph.n}{ph.type === 'Mobile' ? ' 📱' : ''}</button>
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="panel-sec">
        <h3>How did the call go?</h3>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Quick note (optional), e.g. owner open to terms, call back after the 15th" style={{ width: '100%', marginBottom: 8 }} />
        <div className="results">
          {RESULTS.map(([s, tone]) => (
            <button key={s} className={`res ${tone} ${it.status === s ? 'on' : ''}`} onClick={() => result(s)}>{s}</button>
          ))}
        </div>
        <label className="remember" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} /> Go to the next lead after logging (stays here for Interested / Appointment set)
        </label>
        {it.deal_id ? (
          <div className="deal-bar">✅ This lead is a deal. <button className="linkish" onClick={() => openRecord('deal', it.deal_id)}>Open the deal</button></div>
        ) : (
          <button className={`${hot ? 'primary big' : ''}`} style={{ marginTop: 6 }} onClick={makeDeal}>Make it a deal</button>
        )}
      </section>

      <section className="panel-sec">
        <div className="form-grid">
          <Field label="Follow-up date"><input type="date" value={form.follow_up} onChange={(e) => setForm({ ...form, follow_up: e.target.value })} onBlur={() => saveField('follow_up')} /></Field>
          <Field label="Appointment"><input value={form.appointment} onChange={(e) => setForm({ ...form, appointment: e.target.value })} onBlur={() => saveField('appointment')} placeholder="e.g. Thu 10/30 2:00 PM" /></Field>
          <Field label="Notes" wide><textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} onBlur={() => saveField('notes')} /></Field>
        </div>
      </section>

      <section className="panel-sec">
        <h3>History on this lead</h3>
        <ul className="timeline">
          {it.activities.length === 0 && <li className="muted">No calls logged in the hub yet.</li>}
          {it.activities.map((a) => (
            <li key={a.id} className={`k-${a.kind}`}>
              <div className="tl-head"><span className="tl-kind">{a.kind === 'call' ? '📞 Call' : a.kind}{a.outcome ? ` · ${a.outcome}` : ''}</span><span className="muted small">{ago(a.created_at)}</span></div>
              {a.body && <div className="tl-body">{a.body}</div>}
            </li>
          ))}
        </ul>
      </section>

      {it.extra && (
        <details className="panel-sec">
          <summary><strong>Sheet details</strong> <span className="muted small">— everything else from the file ({it.extra.split('\n').length} fields)</span></summary>
          <pre className="sheet-details">{it.extra}</pre>
        </details>
      )}
    </Drawer>
  );
}
