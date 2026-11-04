import React, { useEffect, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { Drawer, openRecord, dataChanged, callNumber, copyText, ago } from '../crm/shared.jsx';

const fmtPhone = (d) => (d && d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d);
const lookup = (address) => window.dispatchEvent(new CustomEvent('hub-lookup', { detail: address }));
const TYPE = { '.xlsx': 'Excel', '.xlsm': 'Excel', '.csv': 'CSV', '.docx': 'Word', '.pdf': 'PDF', '.txt': 'Text', '.md': 'Text', '.json': 'Data', '.html': 'Web page', '.htm': 'Web page', '.eml': 'Email', '.vcf': 'Contact card', '.tsv': 'Text', '.log': 'Text' };

function Snip({ text }) {
  const parts = String(text || '').split(/(\[\[|\]\])/);
  let on = false;
  return <span className="snip">{parts.map((p, i) => { if (p === '[[') { on = true; return null; } if (p === ']]') { on = false; return null; } return on ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>; })}</span>;
}

export default function SearchDocs({ flash, focusQuery }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [status, setStatus] = useState(null);
  const [openFile, setOpenFile] = useState(null);
  const [folders, setFolders] = useState(false);
  const inputRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    window.hub.search.stats().then(setStatus).catch(() => {});
    const off = window.hub.search.onProgress((st) => setStatus((s) => ({ ...(s || {}), ...st })));
    setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
    return off;
  }, []);
  useEffect(() => { if (focusQuery && focusQuery.q != null) { setQ(focusQuery.q); run(focusQuery.q); } setTimeout(() => inputRef.current && inputRef.current.focus(), 50); }, [focusQuery]);

  const run = async (text) => {
    if (!text.trim()) { setRes(null); return; }
    try { setRes({ q: text, ...(await window.hub.search.query(text)) }); } catch (e) { flash(e.message); }
  };
  const onType = (v) => { setQ(v); clearTimeout(timer.current); timer.current = setTimeout(() => run(v), 250); };

  const crm = res && res.crm;
  const crmCount = crm ? Object.values(crm).reduce((n, a) => n + a.length, 0) : 0;
  const st = status || {};

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1><Icon name="search" size={24} /> Search & Docs</h1>
          <div className="muted small">
            {st.state === 'reading' ? `Reading files… ${st.done || 0} of ${st.total || 0}${st.current ? ` · ${st.current}` : ''}` : `${(st.files || 0).toLocaleString()} files searchable in ${(st.folders || []).length} folder${(st.folders || []).length === 1 ? '' : 's'}`}
            {st.errors ? ` · ${st.errors} couldn't be read` : ''}
          </div>
        </div>
        <div className="row">
          <button onClick={async () => setStatus(await window.hub.search.scan())}>Rescan</button>
          <button onClick={() => setFolders(true)}>Folders…</button>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); run(q); }}>
        <input ref={inputRef} className="bigsearch" value={q} onChange={(e) => onType(e.target.value)} placeholder='Search files and the hub: a name, phone number, address, email… Use "quotes" for an exact phrase.' />
      </form>
      <p className="muted small" style={{ margin: '6px 2px 14px' }}>Press <b>Ctrl+K</b> anywhere to jump here. Reads txt, csv, Excel, Word and PDF files in your folders (scanned pictures have no text).</p>

      {res && (
        <div className="search-grid">
          <section>
            <h3>Files <span className="muted small">{res.files.length}{res.files.length === 60 ? '+' : ''}</span></h3>
            {res.files.length === 0 && <div className="card muted">No files match. {(st.folders || []).length === 0 && 'Add a folder to search first.'}</div>}
            {res.files.map((f) => (
              <div key={f.id} className="card file-hit clickable" onClick={() => setOpenFile(f.id)}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{f.name}</strong>
                  <span className="tag">{TYPE[f.ext] || f.ext}</span>
                </div>
                <div className="muted small path">{f.path}</div>
                <div className="small"><Snip text={f.snip} /></div>
              </div>
            ))}
          </section>
          <section>
            <h3>In the hub <span className="muted small">{crmCount}</span></h3>
            {crmCount === 0 && <div className="card muted">Nothing in contacts, leads, deals or notes.</div>}
            <CrmGroup title="Contacts" rows={crm.contacts} render={(c) => (
              <div key={c.id} className="hit clickable" onClick={() => openRecord(c.kind === 'lead' ? 'contact' : 'contact', c.id)}>
                <strong>{[c.first_name, c.last_name].filter(Boolean).join(' ') || c.company}</strong> <span className="muted small">{c.kind === 'network' ? 'SubTo Directory' : c.kind === 'lead' ? 'Lead' : c.role} {c.phone && `· ${c.phone}`}</span>
              </div>
            )} />
            <CrmGroup title="Leads" rows={crm.leads} render={(l) => (
              <div key={l.id} className="hit clickable" onClick={() => openRecord('lead', l.id)}>
                <strong>{l.title || l.address}</strong> <span className="muted small">{l.list} · {l.status}</span>
              </div>
            )} />
            <CrmGroup title="Deals" rows={crm.deals} render={(d) => (
              <div key={d.id} className="hit clickable" onClick={() => openRecord('deal', d.id)}>
                <strong>{[d.address, d.city].filter(Boolean).join(', ')}</strong> <span className="muted small">{d.stage}</span>
              </div>
            )} />
            <CrmGroup title="Underwriting" rows={crm.analyses} render={(a) => (
              <div key={a.id} className="hit clickable" onClick={() => openRecord('analysis', a.id)}><strong>{a.name}</strong> <span className="muted small">{a.address}</span></div>
            )} />
            <CrmGroup title="Notes, calls & chats" rows={crm.notes} render={(n) => (
              <div key={n.id} className="hit clickable" onClick={() => (n.deal_id ? openRecord('deal', n.deal_id) : n.contact_id ? openRecord('contact', n.contact_id) : null)}>
                <span className="tag">{n.kind}</span> <span className="small">{n.body.slice(0, 160)}</span> <span className="muted small">{ago(n.created_at)}</span>
              </div>
            )} />
          </section>
        </div>
      )}
      {!res && (
        <div className="card muted" style={{ maxWidth: 720 }}>
          <p style={{ marginTop: 0 }}>Type anything: a seller's name, part of an address, a phone number in any format (480-555-1234, (480) 555 1234, 4805551234), or an email.</p>
          <p style={{ marginBottom: 0 }}>Open a file to see the matching lines, then turn any line into a contact, a deal or a task, or attach the file to a deal.</p>
        </div>
      )}
      {openFile && <FileDrawer id={openFile} q={res ? res.q : ''} flash={flash} onClose={() => setOpenFile(null)} />}
      {folders && <Folders status={st} setStatus={setStatus} onClose={() => setFolders(false)} />}
    </div>
  );
}

function CrmGroup({ title, rows, render }) {
  if (!rows || !rows.length) return null;
  return <div className="card crm-group"><div className="muted small" style={{ marginBottom: 4 }}>{title}</div>{rows.map(render)}</div>;
}

// Guess a name / phone / email / address out of one line of text.
function parseLine(line) {
  const t = String(line || '');
  const phone = (t.match(/(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/) || [''])[0];
  const email = (t.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/) || [''])[0];
  const address = (t.match(/\b\d{2,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9.']+\s+){0,4}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Way|Place|Pl|Circle|Cir|Parkway|Pkwy|Highway|Hwy|Trail|Trl|Terrace|Ter|Loop)\b\.?(?:\s+(?:#|Apt|Unit|Ste)\s*[\w-]+)?(?:,?\s+[A-Za-z .]+,?\s+[A-Z]{2}(?:\s+\d{5})?)?/) || [''])[0];
  const before = t.split(/[|\t,;:]|\(?\d{3}\)?[\s.-]?\d{3}/)[0];
  const words = (before.match(/\b[A-Z][a-z'’-]+\b/g) || []).filter((w) => !/^(Seller|Owner|Agent|Call|Phone|Email|Name|Mr|Mrs|Ms|Dr|The|Property)$/.test(w)).slice(0, 3);
  return { first: words[0] || '', last: words.slice(1).join(' '), phone, email, address };
}

function FileDrawer({ id, q, flash, onClose }) {
  const [f, setF] = useState(null);
  const [deals, setDeals] = useState([]);
  const [dealId, setDealId] = useState('');
  useEffect(() => {
    window.hub.search.file(id, q).then(setF).catch((e) => { flash(e.message); onClose(); });
    window.hub.crm.listDeals({}).then(setDeals).catch(() => {});
  }, [id]);
  if (!f) return null;
  const facts = f.facts || {};
  const toContact = async (line) => {
    const p = parseLine(line);
    try {
      const c = await window.hub.crm.saveContact({ first_name: p.first, last_name: p.last, phone: p.phone, email: p.email, address: p.address, role: 'Other', notes: `From ${f.name}: ${line.trim()}` });
      dataChanged(); flash(`Contact added: ${[c.first_name, c.last_name].filter(Boolean).join(' ') || c.phone || c.email}`, { label: 'Open', run: () => openRecord('contact', c.id) });
    } catch (e) { flash(e.message.includes('at least') ? 'No name, phone or email found on that line.' : e.message); }
  };
  const toDeal = async (line) => {
    const p = parseLine(line);
    if (!p.address) { flash('No street address found on that line.'); return; }
    const parts = p.address.split(',').map((x) => x.trim());
    try {
      const d = await window.hub.crm.saveDeal({ address: parts[0], city: parts[1] || '', state: (parts[2] || '').split(' ')[0] || '', zip: ((parts[2] || '').match(/\d{5}/) || [''])[0], source: f.name, notes: line.trim() });
      await window.hub.files.linkDeal(d.id, f.path).catch(() => {});
      dataChanged(); flash(`Lead added to Deals: ${d.title}`, { label: 'Open', run: () => openRecord('deal', d.id) });
    } catch (e) { flash(e.message); }
  };
  const toTask = async (line) => {
    try {
      await window.hub.crm.saveTask({ title: line.trim().slice(0, 300), notes: `From ${f.path}` });
      dataChanged(); flash('Task added.');
    } catch (e) { flash(e.message); }
  };
  const link = async () => {
    if (!dealId) return;
    try { await window.hub.files.linkDeal(Number(dealId), f.path); dataChanged(); flash('File attached to the deal.'); } catch (e) { flash(e.message); }
  };
  return (
    <Drawer onClose={onClose} width={760}>
      <div className="drawer-head">
        <div><h2 style={{ margin: 0 }}>{f.name}</h2><div className="muted small path">{f.path}</div></div>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        <button className="primary" onClick={() => window.hub.files.open(f.path).catch((e) => flash(e.message))}>Open file</button>
        <button onClick={() => window.hub.files.show(f.path).catch((e) => flash(e.message))}>Show in folder</button>
        <select className="sel" value={dealId} onChange={(e) => setDealId(e.target.value)}>
          <option value="">Attach to a deal…</option>
          {deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
        {dealId && <button onClick={link}>Attach</button>}
      </div>
      {f.error && <div className="flag warn">Couldn't read this file: {f.error}</div>}
      {(facts.phones || []).length + (facts.emails || []).length + (facts.addresses || []).length + (facts.links || []).length > 0 && (
        <section className="panel-sec">
          <h3>Found in this file</h3>
          {facts.phones && facts.phones.length > 0 && <Facts label={`Phones (${facts.phones.length})`} items={facts.phones} render={(p) => (
            <span key={p} className="fact"><b>{fmtPhone(p)}</b> <button className="mini" onClick={() => callNumber(p, null, flash)}>Call</button> <button className="mini" onClick={() => copyText(fmtPhone(p), flash)}>Copy</button></span>
          )} />}
          {facts.emails && facts.emails.length > 0 && <Facts label={`Emails (${facts.emails.length})`} items={facts.emails} render={(e) => (
            <span key={e} className="fact"><b>{e}</b> <button className="mini" onClick={() => window.hub.app.openMail(e)}>Email</button> <button className="mini" onClick={() => copyText(e, flash)}>Copy</button></span>
          )} />}
          {facts.addresses && facts.addresses.length > 0 && <Facts label={`Addresses (${facts.addresses.length})`} items={facts.addresses} render={(a) => (
            <span key={a} className="fact"><b>{a}</b> <button className="mini" onClick={() => lookup(a)}>Look up</button></span>
          )} />}
          {facts.links && facts.links.length > 0 && <Facts label={`Links (${facts.links.length})`} items={facts.links} render={(l) => (
            <span key={l} className="fact"><button className="linkish" onClick={() => window.hub.app.openExternal(l)}>{l.length > 70 ? `${l.slice(0, 70)}…` : l}</button></span>
          )} />}
        </section>
      )}
      <section className="panel-sec">
        <h3>{f.hits.length ? `Lines matching "${q}" (${f.hits.length}${f.hits.length === 80 ? '+' : ''})` : 'Preview'}</h3>
        {f.hits.length === 0 && <pre className="preview-text">{f.preview}</pre>}
        {f.hits.map((h) => (
          <div key={h.n} className="line-hit">
            <div className="small"><span className="muted">Line {h.n}:</span> {h.text}</div>
            <div className="row" style={{ gap: 4 }}>
              <button className="mini" onClick={() => toContact(h.text)}>+ Contact</button>
              <button className="mini" onClick={() => toDeal(h.text)}>+ Deal</button>
              <button className="mini" onClick={() => toTask(h.text)}>+ Task</button>
            </div>
          </div>
        ))}
      </section>
    </Drawer>
  );
}

function Facts({ label, items, render }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 12);
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="muted small" style={{ marginBottom: 4 }}>{label}</div>
      <div className="facts-wrap">{shown.map(render)}</div>
      {items.length > 12 && <button className="linkish small" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${items.length}`}</button>}
    </div>
  );
}

function Folders({ status, setStatus, onClose }) {
  return (
    <Drawer onClose={onClose} width={620}>
      <div className="drawer-head"><h2 style={{ margin: 0 }}>Searched folders</h2><button className="icon-btn" onClick={onClose}>✕</button></div>
      <p className="muted small">The hub reads the files in these folders (and their subfolders) and keeps them searchable. New and changed files are picked up automatically. Your files are never changed.</p>
      <ul className="uw-list">
        {(status.folders || []).length === 0 && <li className="muted">No folders yet.</li>}
        {(status.folders || []).map((p) => (
          <li key={p}><span className="path">{p}</span><button className="mini" onClick={async () => setStatus(await window.hub.search.removeFolder(p))}>Remove</button></li>
        ))}
      </ul>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="primary" onClick={async () => setStatus(await window.hub.search.addFolder())}>Add a folder…</button></div>
      {status.byType && status.byType.length > 0 && (
        <section className="panel-sec" style={{ marginTop: 14 }}>
          <h3>What's searchable</h3>
          <div className="row wrap" style={{ gap: 6 }}>{status.byType.map((t) => <span key={t.ext} className="tag">{TYPE[t.ext] || t.ext}: {t.n}</span>)}</div>
        </section>
      )}
    </Drawer>
  );
}
