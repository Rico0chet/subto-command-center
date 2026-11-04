import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import { askConfirm } from '../confirm.jsx';
import {
  money, pct, dueLabel, dueClass, useOptions, useDataChanged, dataChanged, openRecord,
  Field, Select, Drawer, ActivityLog, TaskList, PhoneActions,
} from '../crm/shared.jsx';

const BOARD = ['Lead', 'Talking', 'Offer Sent', 'Under Contract', 'Closed'];

export default function Deals({ flash, focusId, clearFocus }) {
  const [deals, setDeals] = useState([]);
  const [q, setQ] = useState('');
  const [showDead, setShowDead] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null); // { stage, beforeId }

  const load = useCallback(async () => setDeals(await window.hub.crm.listDeals({ q, includeDead: showDead })), [q, showDead]);
  useEffect(() => { load(); }, [load]);
  useDataChanged(load);
  useEffect(() => { if (focusId) { setOpenId(focusId); clearFocus(); } }, [focusId]);

  const columns = showDead ? [...BOARD, 'Dead'] : BOARD;
  const byStage = (s) => deals.filter((d) => d.stage === s);

  const drop = async (stage, beforeId) => {
    const id = drag;
    setDrag(null); setOver(null);
    if (!id) return;
    try {
      await window.hub.crm.moveDeal(id, stage, beforeId);
      await load();
      dataChanged();
    } catch (e) { flash(e.message); }
  };

  return (
    <div className="page page-wide">
      <header className="page-head">
        <h1><Icon name="board" size={24} /> Deals</h1>
        <div className="row">
          <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address, city, contact…" />
          <label className="remember" style={{ margin: 0 }}>
            <input type="checkbox" checked={showDead} onChange={(e) => setShowDead(e.target.checked)} /> Show dead deals
          </label>
          <button className="primary" onClick={() => setCreating(true)}>+ New deal</button>
        </div>
      </header>

      <div className="board">
        {columns.map((stage) => {
          const cards = byStage(stage);
          return (
            <section key={stage} className={`col ${over && over.stage === stage ? 'col-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); if (!over || over.stage !== stage || over.beforeId) setOver({ stage, beforeId: null }); }}
              onDrop={(e) => { e.preventDefault(); drop(stage, over && over.stage === stage ? over.beforeId : null); }}>
              <div className="col-head"><span>{stage}</span><span className="count">{cards.length}</span></div>
              {cards.map((d) => (
                <article key={d.id} className={`card-deal ${drag === d.id ? 'dragging' : ''} ${over && over.beforeId === d.id ? 'drop-before' : ''}`}
                  draggable onDragStart={(e) => { setDrag(d.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => { setDrag(null); setOver(null); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (drag !== d.id) setOver({ stage, beforeId: d.id }); }}
                  onClick={() => setOpenId(d.id)}>
                  <div className="cd-title">{d.address || d.title}</div>
                  <div className="muted small">{[d.city, d.state].filter(Boolean).join(', ')}{d.city || d.state ? ' · ' : ''}{d.strategy}</div>
                  <div className="cd-nums">
                    {d.asking_price != null && <span>{money(d.asking_price)}</span>}
                    {d.loan_balance != null && <span title="Loan balance">Bal {money(d.loan_balance)}</span>}
                    {d.interest_rate != null && <span title="Interest rate">{pct(d.interest_rate)}</span>}
                  </div>
                  <div className="cd-foot">
                    {(() => {
                      const isSeller = (c) => /^(seller|seller'?s? agent|listing agent|agent|seller'?s? attorney|co-?owner|owner)$/i.test(String(c.link_role || '').trim());
                      const sellers = d.contacts.filter(isSeller);
                      const team = d.contacts.filter((c) => !isSeller(c));
                      return (
                        <>
                          {sellers[0] && <span className="small seller-chip">Seller side: {sellers[0].name}{sellers.length > 1 ? ` +${sellers.length - 1}` : ''}</span>}
                          {team[0] && <span className="small">👤 {team[0].name}{team.length > 1 ? ` +${team.length - 1}` : ''}</span>}
                        </>
                      );
                    })()}
                    {d.openTasks > 0 && <span className="small" title="Open tasks">☑ {d.openTasks}</span>}
                    {d.next_follow_up && <span className={`due ${dueClass(d.next_follow_up)}`} title="Next follow-up">↻ {dueLabel(d.next_follow_up)}</span>}
                  </div>
                </article>
              ))}
              {cards.length === 0 && <div className="col-empty">Drag deals here</div>}
            </section>
          );
        })}
      </div>

      {creating && <NewDeal flash={flash} onClose={() => setCreating(false)} onCreated={(d) => { setCreating(false); load(); dataChanged(); setOpenId(d.id); }} />}
      {openId && <DealPanel id={openId} flash={flash} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function NewDeal({ flash, onClose, onCreated }) {
  const opts = useOptions();
  const [d, setD] = useState({ address: '', city: '', state: '', zip: '', strategy: 'Subject-To', property_type: 'Single family', stage: 'Lead', source: '' });
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: typeof v === 'object' && v && v.target ? v.target.value : v }));
  if (!opts) return null;
  const save = async (e) => {
    e.preventDefault();
    try { onCreated(await window.hub.crm.saveDeal(d)); } catch (err) { flash(err.message); }
  };
  return (
    <Drawer onClose={onClose} width={520}>
      <form onSubmit={save}>
        <h2>New deal</h2>
        <div className="form-grid">
          <Field label="Property address" wide><input autoFocus value={d.address} onChange={set('address')} placeholder="123 Main St" /></Field>
          <Field label="City"><input value={d.city} onChange={set('city')} /></Field>
          <Field label="State"><input value={d.state} onChange={set('state')} maxLength={2} placeholder="TX" /></Field>
          <Field label="ZIP"><input value={d.zip} onChange={set('zip')} /></Field>
          <Field label="Stage"><Select value={d.stage} onChange={set('stage')} options={opts.stages.filter((s) => s !== 'Dead')} /></Field>
          <Field label="Strategy"><Select value={d.strategy} onChange={set('strategy')} options={opts.strategies} /></Field>
          <Field label="Property type"><Select value={d.property_type} onChange={set('property_type')} options={opts.propertyTypes} /></Field>
          <Field label="Lead source" wide><input value={d.source} onChange={set('source')} placeholder="e.g. Agent outreach, Facebook group, JV partner" /></Field>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit">Create deal</button>
        </div>
      </form>
    </Drawer>
  );
}

const NUM_FIELDS = [
  ['asking_price', 'Asking price ($)'], ['arv', 'ARV / value ($)'], ['loan_balance', 'Loan balance ($)'],
  ['interest_rate', 'Interest rate (%)'], ['piti', 'PITI / month ($)'], ['rent', 'Rent / month ($)'], ['entry_fee', 'Entry fee ($)'],
];

export function DealPanel({ id, flash, onClose, onChanged }) {
  const opts = useOptions();
  const [deal, setDeal] = useState(null);
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await window.hub.crm.getDeal(id);
      setDeal(d);
      setForm((f) => (dirty && f ? f : d));
    } catch (e) { flash(e.message); onClose(); }
  }, [id, dirty]);
  useEffect(() => { load(); }, [id]);
  useDataChanged(load);

  if (!deal || !form || !opts) return null;
  const set = (k) => (v) => { setForm((x) => ({ ...x, [k]: typeof v === 'object' && v && v.target ? v.target.value : v })); setDirty(true); };

  const save = async () => {
    try {
      const d = await window.hub.crm.saveDeal(form);
      setDeal(d); setForm(d); setDirty(false);
      onChanged(); dataChanged();
      flash('Deal saved.');
    } catch (e) { flash(e.message); }
  };
  const move = async (stage) => {
    try {
      if (dirty) await window.hub.crm.saveDeal(form);
      const d = await window.hub.crm.moveDeal(id, stage);
      setDeal(d); setForm(d); setDirty(false);
      onChanged(); dataChanged();
    } catch (e) { flash(e.message); }
  };
  const remove = async () => {
    if (!(await askConfirm(`Delete ${deal.title}? Its activity log is deleted too. Tasks are kept.`, 'Delete deal'))) return;
    await window.hub.crm.deleteDeal(id);
    onChanged(); dataChanged(); onClose();
  };
  const close = async () => {
    if (dirty && (await askConfirm('Save your changes to this deal?', 'Save'))) await save();
    onClose();
  };

  const n = (k) => (form[k] === '' || form[k] == null ? null : Number(String(form[k]).replace(/[$,%]/g, '')));
  const spread = n('rent') != null && n('piti') != null ? n('rent') - n('piti') : null;
  const equity = n('arv') != null && n('loan_balance') != null ? n('arv') - n('loan_balance') : null;

  return (
    <Drawer onClose={close} width={920}>
      <div className="drawer-head">
        <div>
          <h2 style={{ margin: 0 }}>{deal.title}</h2>
          <div className="muted small"><button className="mini" style={{ marginRight: 8 }} onClick={() => window.dispatchEvent(new CustomEvent('hub-lookup', { detail: [deal.address, deal.city, [deal.state, deal.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') }))}>Look up</button>{deal.strategy} · {deal.property_type} · added {new Date(deal.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
        </div>
        <div className="row">
          <select className="sel stage-pick" value={deal.stage} onChange={(e) => move(e.target.value)} title="Move to stage">
            {opts.stages.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="icon-btn" title="Close" onClick={close}>✕</button>
        </div>
      </div>

      <section className="panel-sec">
        <div className="form-grid">
          <Field label="Address" wide><input value={form.address} onChange={set('address')} /></Field>
          <Field label="City"><input value={form.city} onChange={set('city')} /></Field>
          <Field label="State"><input value={form.state} onChange={set('state')} maxLength={2} /></Field>
          <Field label="ZIP"><input value={form.zip} onChange={set('zip')} /></Field>
          <Field label="Strategy"><Select value={form.strategy} onChange={set('strategy')} options={opts.strategies} /></Field>
          <Field label="Property type"><Select value={form.property_type} onChange={set('property_type')} options={opts.propertyTypes} /></Field>
          <Field label="Next follow-up"><input type="date" value={form.next_follow_up || ''} onChange={set('next_follow_up')} /></Field>
          <Field label="Lead source"><input value={form.source} onChange={set('source')} /></Field>
        </div>
        <h3>Numbers</h3>
        <div className="form-grid">
          {NUM_FIELDS.map(([k, label]) => (
            <Field key={k} label={label}><input inputMode="decimal" value={form[k] ?? ''} onChange={set(k)} /></Field>
          ))}
        </div>
        {(spread != null || equity != null) && (
          <div className="quick-math">
            {spread != null && <span>Rent − PITI: <strong className={spread < 0 ? 'neg' : 'pos'}>{money(spread)}/mo</strong></span>}
            {equity != null && <span>Value − loan: <strong className={equity < 0 ? 'neg' : 'pos'}>{money(equity)}</strong></span>}

          </div>
        )}
        {deal.stage === 'Dead' && (
          <Field label="Why it died" wide><input value={form.dead_reason} onChange={set('dead_reason')} placeholder="e.g. Seller listed with agent, numbers didn't work" /></Field>
        )}
        <Field label="Notes" wide><textarea rows={3} value={form.notes} onChange={set('notes')} /></Field>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="danger-btn" onClick={remove}>Delete deal</button>
          <button className="primary" disabled={!dirty} onClick={save}>{dirty ? 'Save changes' : 'Saved'}</button>
        </div>
      </section>


      <section className="panel-sec">
        <h3>People on this deal</h3>
        <DealContacts deal={deal} flash={flash} onChanged={load} />
      </section>

      <DealAnalyses deal={deal} />
      <DealFiles deal={deal} flash={flash} />

      <section className="panel-sec">
        <h3>Tasks</h3>
        <TaskList tasks={deal.tasks} dealId={deal.id} onChanged={load} flash={flash} />
      </section>

      <section className="panel-sec">
        <h3>Activity</h3>
        <ActivityLog dealId={deal.id} items={deal.activities} onChanged={load} flash={flash} showLinks />
      </section>
    </Drawer>
  );
}

function DealContacts({ deal, flash, onChanged }) {
  const opts = useOptions();
  const [t, setT] = useState(null);
  const [needed, setNeeded] = useState('');
  const load = useCallback(async () => {
    const x = await window.hub.crm.team(deal.id);
    setT(x);
    setNeeded(x.neededFrom === 'typed' ? String(x.needed) : '');
  }, [deal.id]);
  useEffect(() => { load(); }, [load]);
  if (!opts || !t) return null;
  const done = (x) => { setT(x); onChanged(); dataChanged(); };
  const add = async (c, role = '') => {
    try { done(await window.hub.crm.saveTeamMember(deal.id, c.id, { role, status: role ? 'Committed' : 'Pending' })); }
    catch (e) { flash(e.message); }
  };
  const local = (m, patch) => setT((x) => ({ ...x, members: x.members.map((y) => (y.id === m.id ? { ...y, ...patch } : y)), seller: x.seller.map((y) => (y.id === m.id ? { ...y, ...patch } : y)) }));
  const update = async (m, patch) => {
    const next = { role: m.role, brings: m.brings, amount: m.amount ?? '', terms: m.terms, status: m.status, ...patch };
    local(m, patch);
    try { done(await window.hub.crm.saveTeamMember(deal.id, m.id, next)); } catch (e) { flash(e.message); }
  };
  const remove = async (m) => {
    if (!(await askConfirm(`Take ${m.name} off this deal?`, 'Remove'))) return;
    done(await window.hub.crm.removeTeamMember(deal.id, m.id));
  };
  const saveNeeded = async () => done(await window.hub.crm.setFundsNeeded(deal.id, needed));
  const createAndAdd = async (form, role) => {
    const c = await window.hub.crm.saveContact({ ...form, kind: 'contact' });
    done(await window.hub.crm.saveTeamMember(deal.id, c.id, { role, status: role ? 'Committed' : 'Pending' }));
    flash(`${[c.first_name, c.last_name].filter(Boolean).join(' ') || 'Contact'} added to Contacts and to this deal.`);
  };
  const anyMoney = t.members.some((m) => m.brings && m.brings !== 'Nothing (service only)');
  const who = (m) => (
    <span className="tt-who">
      <button className="linkish" onClick={() => openRecord('contact', m.id)}><strong>{m.name}</strong></button>
      <span className="muted small">{m.kind === 'network' ? 'SubTo Directory' : m.kind === 'lead' ? 'From a lead list' : 'Contact'}{m.communities ? ` · ${m.communities}` : ''}{m.state ? ` · ${m.state}` : ''}</span>
      {m.phone && <PhoneActions phone={m.phone} who={{ name: m.name, contactId: m.id, dealId: deal.id }} flash={flash} compact />}
    </span>
  );
  return (
    <div className="team">
      {/* ---- the other side of the deal ---- */}
      <div className="seller-box">
        <div className="seller-head"><span className="seller-badge">SELLER SIDE</span><span className="muted small">The people you're buying from: not part of your team, not counted in funding.</span></div>
        {t.seller.length === 0 && <p className="muted small" style={{ margin: '6px 0' }}>No seller or seller's agent on this deal yet.</p>}
        {t.seller.map((m) => (
          <div key={m.id} className="sl-row">
            {who(m)}
            <select className="sel" value={opts.sellerRoles.includes(m.role) ? m.role : (/agent/i.test(m.role) ? "Seller's agent" : 'Seller')} onChange={(e) => update(m, { role: e.target.value === '__team' ? '' : e.target.value })}>
              {opts.sellerRoles.map((r) => <option key={r} value={r}>{r}</option>)}
              <option value="__team">Move to my deal team…</option>
            </select>
            <input value={m.terms} placeholder="Notes: what they want, timeline, motivation…" onChange={(e) => local(m, { terms: e.target.value })} onBlur={(e) => update(m, { terms: e.target.value })} />
            <button className="icon-btn" title="Remove from deal" onClick={() => remove(m)}>✕</button>
          </div>
        ))}
        <TeamPicker dealId={deal.id} side="seller" roles={opts.sellerRoles} flash={flash} onPick={add} onCreate={createAndAdd}
          placeholder="+ Add seller or seller's agent: search your leads, contacts and SubTo Directory" />
      </div>

      {/* ---- your team ---- */}
      <h3 style={{ margin: '14px 0 8px' }}>Your deal team</h3>
      <div className={`team-sum ${t.short ? 'short' : t.needed != null && t.needed > 0 ? 'ok' : ''}`}>
        <label className="f"><span>Money needed to close</span>
          <input inputMode="decimal" value={needed} placeholder={t.neededFrom === 'underwriting' ? `${money(t.needed)} (from Underwriting)` : '$'} onChange={(e) => setNeeded(e.target.value)} onBlur={saveNeeded} />
        </label>
        <div><span className="muted small">Committed</span><b>{money(t.committed)}</b></div>
        <div><span className="muted small">Pending</span><b>{money(t.pending)}</b></div>
        <div><span className="muted small">{t.short ? 'Still needed' : 'Status'}</span><b className={t.short ? 'neg' : 'pos'}>{t.needed == null ? '—' : t.short ? money(t.short) : 'Fully funded ✓'}</b></div>
        {t.splitTotal != null && <div><span className="muted small">Profit splits</span><b className={Math.abs(t.splitTotal - 100) < 0.01 ? 'pos' : 'neg'}>{t.splitTotal}%{Math.abs(t.splitTotal - 100) < 0.01 ? ' ✓' : ' of 100%'}</b></div>}
      </div>

      {t.members.length === 0 && <p className="muted small">No one on your team yet. Add the buyer, TC, Gator and anyone else you're closing it with.</p>}
      {t.members.length > 0 && (
        <div className="team-table">
          <div className="tt-head"><span>Person</span><span>Role</span><span>Brings</span><span>Amount</span><span>Terms / split</span><span>Status</span><span /></div>
          {t.members.map((m) => (
            <div key={m.id} className={`tt-row ${m.status === 'Backed out' ? 'out' : ''}`}>
              {who(m)}
              <input list="team-roles" value={m.role} placeholder="Role" onChange={(e) => local(m, { role: e.target.value })} onBlur={(e) => update(m, { role: e.target.value })} />
              <select className="sel" value={m.brings} onChange={(e) => update(m, { brings: e.target.value })}>
                <option value="">—</option>
                {opts.teamBrings.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <input inputMode="decimal" value={m.amount ?? ''} placeholder="$" disabled={!m.brings || m.brings === 'Nothing (service only)'} onChange={(e) => local(m, { amount: e.target.value })} onBlur={(e) => update(m, { amount: e.target.value })} />
              <input value={m.terms} placeholder="e.g. 12% · 12 mo · 2 pts" onChange={(e) => local(m, { terms: e.target.value })} onBlur={(e) => update(m, { terms: e.target.value })} />
              <select className="sel" value={m.status} onChange={(e) => update(m, { status: e.target.value })}>
                {opts.teamStatus.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <button className="icon-btn" title="Remove from deal" onClick={() => remove(m)}>✕</button>
            </div>
          ))}
          <datalist id="team-roles">{opts.teamRoles.map((r) => <option key={r} value={r} />)}</datalist>
        </div>
      )}
      {anyMoney && <p className="muted small" style={{ margin: '4px 0 0' }}>Committed and Funded count toward the total; Asked and Pending show as pending; Backed out is left out.</p>}
      <TeamPicker dealId={deal.id} side="team" flash={flash} onPick={(c) => add(c, '')} onCreate={(f) => createAndAdd(f, '')}
        placeholder="+ Add to deal team: search the SubTo Directory by name, phone, community or state" />
    </div>
  );
}

// Search box + results for adding someone to a deal. Seller side: leads and contacts first; team: SubTo Directory first.
function TeamPicker({ dealId, side, roles, flash, onPick, onCreate, placeholder }) {
  const opts = useOptions();
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ directory: [], contacts: [], leads: [] });
  const [role, setRole] = useState(roles ? roles[0] : '');
  const [adding, setAdding] = useState(null);
  useEffect(() => {
    let live = true;
    if (!q.trim()) { setFound({ directory: [], contacts: [], leads: [] }); return undefined; }
    window.hub.crm.teamSearch(q, dealId, side).then((r) => live && setFound(r));
    return () => { live = false; };
  }, [q, dealId, side]);
  if (!opts) return null;
  const pick = async (c) => { await onPick(c, role); setQ(''); };
  const start = () => {
    const parts = q.trim().split(/\s+/);
    const looksPhone = /^[\d\s().+-]{7,}$/.test(q.trim());
    setAdding({ first_name: looksPhone ? '' : parts[0] || '', last_name: looksPhone ? '' : parts.slice(1).join(' '), phone: looksPhone ? q.trim() : '', email: '', role: side === 'seller' ? (/agent/i.test(role) ? 'Agent' : 'Seller') : 'Other' });
  };
  const save = async () => { try { await onCreate(adding, role); setAdding(null); setQ(''); } catch (e) { flash(e.message); } };
  const group = (title, list, sub) => (
    <>
      <div className="pk-h">{title}</div>
      {list.length === 0 && <div className="muted small pk-none">No matches.</div>}
      {list.map((c) => <button key={c.id} className="pk-row" onClick={() => pick(c)}><b>{c.name}</b><span className="muted small">{sub(c)}</span></button>)}
    </>
  );
  const dirSub = (c) => [c.communities, c.state, c.calls ? `${c.calls} call${c.calls > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
  const conSub = (c) => [c.role, c.phone].filter(Boolean).join(' · ');
  return (
    <div className="team-add">
      <div className="row" style={{ gap: 6 }}>
        {roles && <select className="sel" value={role} onChange={(e) => setRole(e.target.value)} title="Add them as">{roles.map((r) => <option key={r} value={r}>{r}</option>)}</select>}
        <input className={side === 'seller' ? 'seller-in' : ''} value={q} onChange={(e) => { setQ(e.target.value); setAdding(null); }} placeholder={placeholder} style={{ flex: 1 }} />
      </div>
      {q.trim() && !adding && (
        <div className="picker-box">
          {side === 'seller' ? (
            <>
              {group('From your lead lists', found.leads, conSub)}
              {group('My contacts', found.contacts, conSub)}
              {group('SubTo Directory', found.directory, dirSub)}
            </>
          ) : (
            <>
              {group('SubTo Directory', found.directory, dirSub)}
              {group('My contacts', found.contacts, conSub)}
            </>
          )}
          <div className="pk-foot">Not here? <button className="mini" onClick={start}>+ Add "{q.trim()}" as a new contact</button></div>
        </div>
      )}
      {adding && (
        <div className="picker-box">
          <div className="pk-h">New contact (saved to Contacts, then added to this deal{roles ? ` as ${role}` : ''})</div>
          <div className="form-grid">
            <label className="f"><span>First name</span><input autoFocus value={adding.first_name} onChange={(e) => setAdding({ ...adding, first_name: e.target.value })} /></label>
            <label className="f"><span>Last name</span><input value={adding.last_name} onChange={(e) => setAdding({ ...adding, last_name: e.target.value })} /></label>
            <label className="f"><span>Role</span><Select value={adding.role} onChange={(v) => setAdding({ ...adding, role: v })} options={opts.roles} /></label>
            <label className="f"><span>Phone</span><input value={adding.phone} onChange={(e) => setAdding({ ...adding, phone: e.target.value })} /></label>
            <label className="f"><span>Email</span><input value={adding.email} onChange={(e) => setAdding({ ...adding, email: e.target.value })} /></label>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button onClick={() => setAdding(null)}>Cancel</button>
            <button className="primary" onClick={save}>Save and add to deal</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DealAnalyses({ deal }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { window.hub.uw.list({ dealId: deal.id }).then(setRows); }, [deal.id]);
  const money0 = (n) => (n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`);
  return (
    <section className="panel-sec">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Underwriting</h3>
        <button className="mini primary" onClick={() => openRecord('uwDeal', deal.id)}>{rows.length ? 'Open underwriting' : 'Underwrite this deal'}</button>
      </div>
      {rows.length === 0 ? <p className="muted small">No analysis yet. The calculator starts with this deal's numbers.</p> : (
        <ul className="uw-list">
          {rows.map((r) => (
            <li key={r.id} className="clickable" onClick={() => openRecord('analysis', r.id)}>
              <span><strong>{r.name}</strong></span>
              <span className="muted">{r.summary.cfMo != null ? `${money0(r.summary.cfMo)}/mo` : r.summary.profit != null ? `${money0(r.summary.profit)} profit` : ''}{r.summary.coc != null ? ` · CoC ${r.summary.coc === null ? '' : Number.isFinite(r.summary.coc) ? (r.summary.coc * 100).toFixed(1) + '%' : '∞'}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DealFiles({ deal, flash }) {
  const [rows, setRows] = useState([]);
  const load = () => window.hub.files.forDeal(deal.id).then(setRows).catch(() => {});
  useEffect(() => { load(); }, [deal.id]);
  useDataChanged(load);
  const attach = async () => { try { if (await window.hub.files.linkDeal(deal.id)) { load(); dataChanged(); } } catch (e) { flash(e.message); } };
  return (
    <section className="panel-sec">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Files</h3>
        <button className="mini" onClick={attach}>Attach a file…</button>
      </div>
      {rows.length === 0 ? <p className="muted small">Contracts, photos, statements… Attach them here or from Search & Docs.</p> : (
        <ul className="uw-list">
          {rows.map((r) => (
            <li key={r.id}>
              <span className={r.exists ? '' : 'muted'}>{r.name}{!r.exists && ' (moved or deleted)'}</span>
              <span className="row" style={{ gap: 4 }}>
                {r.exists && <button className="mini" onClick={() => window.hub.files.open(r.path).catch((e) => flash(e.message))}>Open</button>}
                {r.exists && <button className="mini" onClick={() => window.hub.files.show(r.path).catch((e) => flash(e.message))}>Folder</button>}
                <button className="mini" onClick={async () => { await window.hub.files.unlink(r.id); load(); }}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
