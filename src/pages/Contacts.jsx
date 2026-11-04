import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import { askConfirm } from '../confirm.jsx';
import {
  ago, useOptions, useDataChanged, dataChanged, openRecord, Field, Select, Drawer, ActivityLog, TaskList, PhoneActions, copyText,
} from '../crm/shared.jsx';
import ImportDialog from './ImportDialog.jsx';

// kind 'contact' = My contacts; kind 'network' = SubTo Directory (people from the community / Zoom calls).
export default function Contacts({ flash, focusId, clearFocus, kind = 'contact' }) {
  const isDir = kind === 'network';
  const opts = useOptions();
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [tag, setTag] = useState('');
  const [tags, setTags] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setList(await window.hub.crm.listContacts({ q, role, tag, kind, limit: 2000 }));
    setTags(await window.hub.crm.allTags());
  }, [q, role, tag, kind]);
  useEffect(() => { load(); }, [load]);
  useDataChanged(load);
  useEffect(() => { if (focusId) { setOpenId(focusId); clearFocus(); } }, [focusId]);

  if (!opts) return null;
  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1><Icon name={isDir ? 'star' : 'people'} size={24} /> {isDir ? 'SubTo Directory' : 'Contacts'} <span className="muted small" style={{ fontWeight: 400 }}>{list.length}{list.length === 2000 ? '+' : ''}</span></h1>
          {isDir && <p className="muted small" style={{ margin: 0 }}>People from the SubTo community: who they are, which calls they joined and what they said. Fed by the Zoom Chat Organizer (in the sidebar): add saved Zoom chats there, or import your SubTo Contacts MASTER file here.</p>}
        </div>
        <div className="row">
          <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={isDir ? 'Search name, community, city, what they said…' : 'Search name, phone, email, tag…'} />
          {!isDir && <Select value={role} onChange={setRole} options={opts.roles} blank="All roles" />}
          {tags.length > 0 && <Select value={tag} onChange={setTag} options={tags} blank="All tags" />}
          <button onClick={() => setImporting(true)}>Import…</button>
          {!isDir && <button className="primary" onClick={() => setCreating(true)}>+ New contact</button>}
        </div>
      </header>

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table contacts-table">
          {isDir ? (
            <thead><tr><th>Name</th><th>What they do</th><th>Communities</th><th>Calls attended</th><th>Phone</th><th>Where</th><th>Last seen</th></tr></thead>
          ) : (
            <thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Email</th><th>Tags</th><th>Last activity</th></tr></thead>
          )}
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ padding: 20 }}>
                {q || role || tag ? 'No one matches.' : isDir ? 'The directory is empty. Import your SubTo Contacts file (from the Zoom Chat Organizer).' : 'No contacts yet. Add one, or import a list from Excel or CSV.'}
              </td></tr>
            )}
            {isDir && list.map((c) => (
              <tr key={c.id} onClick={() => setOpenId(c.id)} className="clickable">
                <td><strong>{c.name}</strong>{c.link && <span className="muted small"> · card</span>}</td>
                <td className="small">{c.tags}</td>
                <td className="small">{c.communities}</td>
                <td className="small">{c.calls_attended}</td>
                <td>{c.phone && <PhoneActions phone={c.phone} who={{ name: c.name, contactId: c.id }} flash={flash} />}</td>
                <td className="small">{[c.city, c.state].filter(Boolean).join(', ')}</td>
                <td className="muted small">{ago(c.last_activity)}</td>
              </tr>
            ))}
            {!isDir && list.map((c) => (
              <tr key={c.id} onClick={() => setOpenId(c.id)} className="clickable">
                <td><strong>{c.name}</strong>{c.company && c.name !== c.company && <div className="muted small">{c.company}</div>}</td>
                <td><span className="tag">{c.role}</span></td>
                <td>{c.phone && <PhoneActions phone={c.phone} who={{ name: c.name, contactId: c.id }} flash={flash} />}</td>
                <td className="small">{c.email}</td>
                <td className="small">{c.tags}</td>
                <td className="muted small">{ago(c.last_activity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {creating && <ContactEditor flash={flash} onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); load(); dataChanged(); setOpenId(c.id); }} />}
      {openId && <ContactPanel id={openId} flash={flash} onClose={() => setOpenId(null)} onChanged={load} />}
      {importing && <ImportDialog from={isDir ? 'directory' : 'contacts'} flash={flash} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); dataChanged(); }} />}
    </div>
  );
}

function ContactForm({ value, onChange }) {
  const opts = useOptions();
  const set = (k) => (v) => onChange({ ...value, [k]: typeof v === 'object' && v && v.target ? v.target.value : v });
  if (!opts) return null;
  return (
    <div className="form-grid">
      <Field label="First name"><input autoFocus value={value.first_name} onChange={set('first_name')} /></Field>
      <Field label="Last name"><input value={value.last_name} onChange={set('last_name')} /></Field>
      <Field label="Role"><Select value={value.role} onChange={set('role')} options={opts.roles} /></Field>
      <Field label="Company / brokerage"><input value={value.company} onChange={set('company')} /></Field>
      <Field label="Phone"><input value={value.phone} onChange={set('phone')} placeholder="(512) 555-0142" /></Field>
      <Field label="Second phone"><input value={value.phone2} onChange={set('phone2')} /></Field>
      <Field label="Email" wide><input value={value.email} onChange={set('email')} /></Field>
      <Field label="Address" wide><input value={value.address} onChange={set('address')} /></Field>
      <Field label="Tags (comma separated)" wide><input value={value.tags} onChange={set('tags')} placeholder="e.g. Austin, expired listings, creative-friendly" /></Field>
      <Field label="Notes" wide><textarea rows={3} value={value.notes} onChange={set('notes')} /></Field>
    </div>
  );
}

const BLANK = { first_name: '', last_name: '', role: 'Agent', company: '', phone: '', phone2: '', email: '', address: '', tags: '', notes: '' };

function ContactEditor({ flash, onClose, onSaved }) {
  const [c, setC] = useState(BLANK);
  const save = async (e) => {
    e.preventDefault();
    try { onSaved(await window.hub.crm.saveContact(c)); } catch (err) { flash(err.message); }
  };
  return (
    <Drawer onClose={onClose} width={560}>
      <form onSubmit={save}>
        <h2>New contact</h2>
        <ContactForm value={c} onChange={setC} />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit">Save contact</button>
        </div>
      </form>
    </Drawer>
  );
}

export function ContactPanel({ id, flash, onClose, onChanged }) {
  const opts = useOptions();
  const [workRole, setWorkRole] = useState('Buyer');
  const [c, setC] = useState(null);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [zoomNames, setZoomNames] = useState([]);
  const load = useCallback(async () => {
    try { const x = await window.hub.crm.getContact(id); setC(x); if (!editing) setForm(x); window.hub.zc.names(id).then(setZoomNames).catch(() => {}); }
    catch (e) { flash(e.message); onClose(); }
  }, [id, editing]);
  useEffect(() => { load(); }, [id]);
  useDataChanged(load);
  if (!c || !form) return null;

  const save = async () => {
    try {
      const x = await window.hub.crm.saveContact(form);
      setC(x); setForm(x); setEditing(false);
      onChanged(); dataChanged(); flash('Contact saved.');
    } catch (e) { flash(e.message); }
  };
  const remove = async () => {
    if (!(await askConfirm(`Delete ${c.name}? They'll be removed from any deals. Their activity log is deleted too.`, 'Delete contact'))) return;
    await window.hub.crm.deleteContact(id);
    onChanged(); dataChanged(); onClose();
  };
  const newDeal = async () => {
    try {
      const d = await window.hub.crm.saveDeal({ address: c.address || 'New deal', stage: 'Lead', source: c.role === 'Agent' ? `Agent: ${c.name}` : '' });
      await window.hub.crm.linkContact(d.id, c.id, c.role);
      dataChanged();
      openRecord('deal', d.id);
    } catch (e) { flash(e.message); }
  };
  const who = { name: c.name, contactId: c.id };
  const promote = async () => {
    try {
      const x = await window.hub.crm.promoteContact(c.id, workRole);
      setC(x); setForm(x); onChanged(); dataChanged();
      flash(`${c.name} is now in your Contacts as a ${workRole}.`);
    } catch (e) { flash(e.message); }
  };
  const allPhones = c.more_phones.length ? c.more_phones : [c.phone, c.phone2].filter(Boolean).map((n) => ({ n }));
  const kindLabel = { contact: '', network: 'SubTo Directory', lead: 'Lead (from a list)' }[c.kind];

  return (
    <Drawer onClose={onClose} width={640}>
      <div className="drawer-head">
        <div>
          <h2 style={{ margin: 0 }}>{c.name}</h2>
          <div className="muted small"><span className="tag">{c.role}</span> {kindLabel && <span className="tag">{kindLabel}</span>} {c.company}</div>
        </div>
        <button className="icon-btn" title="Close" onClick={onClose}>✕</button>
      </div>

      {c.flags && <div className="warn-bar">⚠ {c.flags}</div>}

      {c.kind !== 'contact' && opts && (
        <section className="panel-sec promote-bar">
          <span>Doing business with {c.first_name || 'them'}?</span>
          <Select value={workRole} onChange={setWorkRole} options={opts.roles} />
          <button className="primary" onClick={promote}>Work with them → My contacts</button>
        </section>
      )}

      <section className="panel-sec">
        {editing ? (
          <>
            <ContactForm value={form} onChange={setForm} />
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
              <button className="danger-btn" onClick={remove}>Delete contact</button>
              <div className="row">
                <button onClick={() => { setForm(c); setEditing(false); }}>Cancel</button>
                <button className="primary" onClick={save}>Save</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <dl className="facts">
              {allPhones.map((p, i) => (
                <React.Fragment key={p.n}>
                  <dt>{i === 0 ? 'Phone' : `Phone ${i + 1}`}{(p.label || p.type) ? <div className="muted small">{[p.label, p.type].filter(Boolean).join(' · ')}</div> : null}</dt>
                  <dd className={p.bad ? 'bad-num' : ''}>{p.bad ? <span>{p.n} (bad number)</span> : <PhoneActions phone={p.n} who={who} flash={flash} />}</dd>
                </React.Fragment>
              ))}
              {c.email && (<><dt>Email</dt><dd>{c.email} <button className="mini" onClick={() => window.hub.app.openMail(c.email).catch((e) => flash(e.message))}>Email</button> <button className="mini" onClick={() => copyText(c.email, flash, 'Email copied')}>Copy</button></dd></>)}
              {c.emails2 && (<><dt>Other emails</dt><dd>{c.emails2}</dd></>)}
              {c.address && (<><dt>Address</dt><dd>{c.address}</dd></>)}
              {(c.city || c.state) && (<><dt>Location</dt><dd>{[c.city, c.state].filter(Boolean).join(', ')}</dd></>)}
              {c.communities && (<><dt>Communities</dt><dd>{c.communities}</dd></>)}
              {c.calls_attended && (<><dt>Calls attended</dt><dd>{c.calls_attended}</dd></>)}
              {zoomNames.length > 0 && (<><dt>Zoom names</dt><dd className="small">{zoomNames.join(' · ')}</dd></>)}
              {c.link && (<><dt>Card</dt><dd><button className="linkish" onClick={() => window.hub.app.openExternal(c.link)}>{c.link}</button></dd></>)}
              {c.ext_id && (<><dt>Directory ID</dt><dd className="muted">{c.ext_id}</dd></>)}
              {c.tags && (<><dt>Tags</dt><dd>{c.tags}</dd></>)}
              {c.notes && (<><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</dd></>)}
            </dl>
            <div className="row">
              <button onClick={() => setEditing(true)}>Edit</button>
              <button onClick={newDeal}>+ New deal with {c.first_name || 'this contact'}</button>
            </div>
          </>
        )}
      </section>

      {c.leads && c.leads.length > 0 && (
        <section className="panel-sec">
          <h3>On lead lists</h3>
          <ul className="people">
            {c.leads.map((l) => (
              <li key={l.id}>
                <button className="linkish" onClick={() => openRecord('lead', { listId: l.list_id, itemId: l.id })}><strong>{l.title || l.address}</strong></button>
                <span className="muted small">{l.city} · {l.list_name}</span>
                <span className="tag">{l.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.extra && (
        <details className="panel-sec">
          <summary><strong>Sheet details</strong> <span className="muted small">— everything else from the imported file</span></summary>
          <pre className="sheet-details">{c.extra}</pre>
        </details>
      )}

      <section className="panel-sec">
        <h3>Deals</h3>
        <ul className="people">
          {c.deals.length === 0 && <li className="muted">Not on any deals yet.</li>}
          {c.deals.map((d) => (
            <li key={d.id}>
              <button className="linkish" onClick={() => openRecord('deal', d.id)}><strong>{d.title}</strong></button>
              <span className="tag">{d.stage}</span>
              <span className="muted small">{[d.link_role, d.brings && d.brings !== 'Nothing (service only)' ? `${d.brings}${d.amount != null ? ` $${Math.round(d.amount).toLocaleString()}` : ''}` : '', d.terms, d.team_status].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel-sec">
        <h3>Tasks</h3>
        <TaskList tasks={c.tasks} contactId={c.id} onChanged={load} flash={flash} showLinks />
      </section>

      <section className="panel-sec">
        <h3>Activity</h3>
        <ActivityLog contactId={c.id} items={c.activities} onChanged={load} flash={flash} showLinks />
      </section>
    </Drawer>
  );
}

