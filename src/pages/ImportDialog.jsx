import React, { useEffect, useState } from 'react';
import { useOptions, Field, Select, Drawer, dataChanged } from '../crm/shared.jsx';

// One import for every kind of file: lead lists, contact lists, the SubTo Directory and Zoom chat logs.
const KIND_LABEL = { leads: 'Lead list → Lead Lists', network: 'SubTo Directory', chat: 'Chat history → SubTo Directory', namemap: 'Zoom names → SubTo Directory', contacts: 'Contact list → Contacts', skip: 'Skipped' };
const MAP_FIELDS = [
  ['full_name', 'Full name (one column)'], ['first_name', 'First name'], ['last_name', 'Last name'], ['company', 'Company'],
  ['phone', 'Phone'], ['phone2', 'Second phone'], ['email', 'Email'], ['address', 'Address'], ['notes', 'Notes'],
];

const DEST = { lists: ['Lead Lists', 'lists'], contacts: ['Contacts', 'contacts'], directory: ['SubTo Directory', 'directory'] };

export default function ImportDialog({ flash, onClose, onDone, from = 'lists' }) {
  const opts = useOptions();
  const [step, setStep] = useState('pick'); // pick | reading | review | running | done
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState([]);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => window.hub.lists.onProgress((p) => {
    if (p.reading) setStep('reading');
    else setProgress(p);
  }), []);

  const pick = async () => {
    setError('');
    try {
      const f = await window.hub.lists.analyze();
      if (!f) { setStep(file ? 'review' : 'pick'); return; }
      if (!f.sheets.length) { setError('That file has no rows to import.'); setStep('pick'); return; }
      setFile(f);
      setPlan(f.sheets.map((s) => ({
        index: s.index, include: s.include, recipe: s.recipe.id, name: s.defaultName, propertyType: s.defaultType,
        map: s.guess || {}, role: 'Agent', tags: s.defaultName.slice(0, 40), kind: s.recipe.kind === 'network' ? 'network' : (from === 'directory' ? 'network' : 'contact'),
      })));
      setStep('review');
    } catch (e) { setError(e.message || String(e)); setStep('pick'); }
  };
  useEffect(() => { pick(); }, []);
  if (!opts) return null;

  const set = (i, k, v) => setPlan((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const run = async () => {
    setStep('running');
    setProgress({ done: 0, total: 1, label: '' });
    try {
      const r = await window.hub.lists.run({ sheets: plan });
      setResults(r);
      setStep('done');
      dataChanged();
    } catch (e) { setError(e.message || String(e)); setStep('review'); }
  };
  const chosen = plan.filter((p) => p.include);
  const totalRows = file ? chosen.reduce((n, p) => n + file.sheets[p.index].total, 0) : 0;

  return (
    <Drawer onClose={step === 'running' ? () => {} : onClose} width={820}>
      <div className="drawer-head">
        <h2 style={{ margin: 0 }}>Import a spreadsheet</h2>
        {step !== 'running' && <button className="icon-btn" title="Close" onClick={onClose}>✕</button>}
      </div>

      {error && (
        <section className="panel-sec" style={{ borderColor: 'var(--danger, #e5484d)' }}>
          <strong>The import didn't work.</strong>
          <p className="small" style={{ margin: '6px 0 0' }}>{error}</p>
          <p className="muted small" style={{ margin: '6px 0 0' }}>If the file is open in Excel, close it and try again. Otherwise send this message to Claude.</p>
        </section>
      )}

      {step === 'pick' && (
        <section className="panel-sec">
          <p>Pick any Excel (.xlsx) or CSV file: a call list, a skip-traced list, an owner list, a contact list, or your SubTo Directory file.</p>
          <p className="muted small">The hub finds the real column names (even under title rows), works out what kind of list it is, and keeps every column. Anything that doesn't have its own field goes into <strong>Sheet details</strong>. Your file is never changed.</p>
          <button className="primary" onClick={pick}>Choose file…</button>
        </section>
      )}

      {step === 'reading' && <section className="panel-sec"><p><span className="spinner" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> Reading the file… big lists take a few seconds.</p></section>}

      {step === 'review' && file && (
        <>
          <p><strong>{file.file}</strong> <button className="mini" onClick={pick}>Choose another file</button></p>
          {file.sheets.map((s, i) => {
            const p = plan[i];
            const kind = p.recipe === 'contacts' ? 'contacts' : s.recipe.kind;
            return (
              <section key={s.index} className={`panel-sec ${p.include ? '' : 'sheet-off'}`}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <label className="remember" style={{ margin: 0, color: 'var(--text)' }}>
                    <input type="checkbox" checked={p.include} disabled={s.recipe.id === 'skip' && !s.headers.length} onChange={(e) => set(i, 'include', e.target.checked)} />
                    <strong>Tab "{s.name}"</strong> · {s.total.toLocaleString()} rows{s.headerRow > 1 ? ` · column names on row ${s.headerRow}` : ''}
                  </label>
                  <span className="tag">{(kind === 'network' || kind === 'contacts') && p.include ? (p.kind === 'network' ? 'SubTo Directory' : 'Contact list → Contacts') : KIND_LABEL[kind]}</span>
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>{s.recipe.label}</div>
                {p.include && kind === 'leads' && (
                  <div className="form-grid" style={{ marginTop: 10 }}>
                    <Field label="List name" wide><input value={p.name} onChange={(e) => set(i, 'name', e.target.value)} /></Field>
                    <Field label="Property type (if the file doesn't say)"><input value={p.propertyType} onChange={(e) => set(i, 'propertyType', e.target.value)} placeholder="e.g. Mobile home park" /></Field>
                  </div>
                )}
                {p.include && kind === 'network' && (
                  <div className="form-grid" style={{ marginTop: 10 }}>
                    <Field label="Put these people in">
                      <select className="sel" value={p.kind} onChange={(e) => set(i, 'kind', e.target.value)}>
                        <option value="network">SubTo Directory (community members)</option>
                        <option value="contact">My Contacts (people I do business with)</option>
                      </select>
                    </Field>
                    <p className="muted small" style={{ gridColumn: '1 / -1', margin: 0 }}>This looks like your SubTo community file, so it normally goes to the <strong>SubTo Directory</strong> (under Community in the sidebar). You can move any one person to Contacts later with "Work with them".</p>
                  </div>
                )}
                {p.include && kind === 'contacts' && (
                  <>
                    <div className="form-grid" style={{ marginTop: 10 }}>
                      {MAP_FIELDS.map(([k, label]) => (
                        <Field key={k} label={label}><Select value={p.map[k] || ''} onChange={(v) => set(i, 'map', { ...p.map, [k]: v })} options={s.headers} blank="—" /></Field>
                      ))}
                      <Field label="Goes to"><select className="sel" value={p.kind} onChange={(e) => set(i, 'kind', e.target.value)}><option value="contact">My contacts</option><option value="network">SubTo Directory</option></select></Field>
                      <Field label="Everyone in this tab is a…"><Select value={p.role} onChange={(v) => set(i, 'role', v)} options={opts.roles} /></Field>
                      <Field label="Tag them with"><input value={p.tags} onChange={(e) => set(i, 'tags', e.target.value)} /></Field>
                    </div>
                  </>
                )}
                {p.include && s.sample.length > 0 && (
                  <div className="preview-wrap" style={{ marginTop: 8 }}>
                    <table className="table small">
                      <thead><tr><th>{kind === 'chat' ? 'Message' : 'Person'}</th>{kind === 'leads' && <th>Property</th>}<th>Phone</th>{kind === 'leads' && <th>Status</th>}<th>Sheet details</th></tr></thead>
                      <tbody>
                        {s.sample.map((r, k) => (
                          <tr key={k}>
                            <td>{kind === 'chat' ? r.chat : r.name}</td>{kind === 'leads' && <td>{r.property}</td>}<td>{r.phone}</td>
                            {kind === 'leads' && <td>{r.status}</td>}<td className="muted">{r.extraLines ? `${r.extraLines} more field${r.extraLines > 1 ? 's' : ''}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
          <p className="muted small">People already in the hub (same personal phone or email, same last name) are matched, not duplicated. Office lines don't count as a match.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!chosen.length} onClick={run}>Import {totalRows.toLocaleString()} rows</button>
          </div>
        </>
      )}

      {step === 'running' && progress && (
        <section className="panel-sec">
          <p>Importing {progress.label}… {progress.done.toLocaleString()} of {progress.total.toLocaleString()}</p>
          <div className="bar"><div style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} /></div>
          <p className="muted small">Please keep the hub open until it finishes.</p>
        </section>
      )}

      {step === 'done' && results && (
        <section className="panel-sec">
          <h3>Done</h3>
          <ul className="people">
            {results.map((r) => (
              <li key={r.sheet}>
                <strong>{r.sheet}</strong>
                <span className="tag">{r.dest === 'contacts' ? 'Contacts' : r.dest === 'directory' ? 'SubTo Directory' : KIND_LABEL[r.kind]}</span>
                <span>{r.added.toLocaleString()} added{r.matched ? `, ${r.matched} matched to people already in the hub` : ''}{r.skipped ? `, ${r.skipped} skipped` : ''}</span>
              </li>
            ))}
          </ul>
          {(() => {
            const dests = [...new Set(results.map((r) => r.dest).filter((d) => DEST[d]))];
            const here = { lists: 'lists', contacts: 'contacts', directory: 'directory' }[from];
            const elsewhere = dests.filter((d) => d !== here);
            return (
              <>
                {elsewhere.length > 0 && !dests.includes(here) && (
                  <p className="small">Nothing from this file went into <strong>{DEST[here][0]}</strong>. It went to {elsewhere.map((d) => DEST[d][0]).join(' and ')}.</p>
                )}
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  {elsewhere.map((d) => (
                    <button key={d} onClick={() => { onDone(results); window.dispatchEvent(new CustomEvent('hub-open-page', { detail: DEST[d][1] })); }}>Open {DEST[d][0]}</button>
                  ))}
                  <button className="primary" onClick={() => onDone(results)}>Done</button>
                </div>
              </>
            );
          })()}
        </section>
      )}
    </Drawer>
  );
}
