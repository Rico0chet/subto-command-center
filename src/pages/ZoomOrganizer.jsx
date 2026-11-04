import React, { useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import { openRecord, dataChanged } from '../crm/shared.jsx';
import { askConfirm } from '../confirm.jsx';

// The Zoom Chat Organizer, built into the hub: saved Zoom chats → SubTo Directory.
export default function ZoomOrganizer({ flash }) {
  const [st, setSt] = useState(null);
  const [rows, setRows] = useState([]); // chats ready to add: { file, name, folder, messages, people, label, include, inferSubto }
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [dupes, setDupes] = useState(null);
  const [legacy, setLegacy] = useState(null);

  const load = async () => {
    const s = await window.hub.zc.status();
    setSt(s);
    setRows((old) => mergeRows(old, s.found));
  };
  useEffect(() => {
    load();
    window.hub.zoom.status().then(setLegacy).catch(() => {});
    return window.hub.zc.onUpdate((u) => { load(); if (u.added) flash(`Added ${u.added} new Zoom chat messages to the SubTo Directory.`); });
  }, []);

  const scan = async () => { const f = await window.hub.zc.scan(); setRows((old) => mergeRows(old, f)); setSt(await window.hub.zc.status()); flash(f.length ? `${f.length} chat${f.length > 1 ? 's' : ''} ready to add.` : 'No new chats found.'); };
  const pick = async () => { const f = await window.hub.zc.pickFiles(); if (f.length) setRows((old) => mergeRows(old, f)); };
  const chooseDir = async () => { await window.hub.zc.chooseDir(); load(); };
  const set = (file, k, v) => setRows((r) => r.map((x) => (x.file === file ? { ...x, [k]: v } : x)));
  const add = async () => {
    const chosen = rows.filter((r) => r.include && r.messages);
    if (!chosen.length) { flash('Tick at least one chat.'); return; }
    setBusy(true);
    try {
      const r = await window.hub.zc.add(chosen.map((x) => ({ path: x.file, label: x.label, inferSubto: x.inferSubto })));
      setReview(r);
      setRows((old) => old.filter((x) => !chosen.some((c) => c.file === x.file)));
      dataChanged(); load();
      flash(`Added ${r.messages} messages · ${r.newContacts.length} new people.`);
    } catch (e) { flash(e.message); }
    setBusy(false);
  };
  const apply = async (cand, item) => {
    try {
      await window.hub.zc.applyCandidate(cand.id, item.kind, item.value);
      setReview((r) => ({ ...r, candidates: r.candidates.map((c) => (c === cand ? { ...c, items: c.items.filter((i) => i !== item) } : c)).filter((c) => c.items.length) }));
      dataChanged(); flash(`Added ${item.value} to ${cand.name}.`);
    } catch (e) { flash(e.message); }
  };
  const findDupes = async () => setDupes(await window.hub.zc.duplicates());
  const merge = async (group, keep) => {
    const others = group.filter((c) => c.id !== keep.id);
    if (!(await askConfirm(`Merge ${others.map((o) => o.name).join(', ')} into ${keep.name}? Their chats, leads and tasks move to ${keep.name}.`, 'Merge'))) return;
    try {
      for (const o of others) await window.hub.zc.merge(keep.id, o.id);
      dataChanged(); flash('Merged.'); findDupes();
    } catch (e) { flash(e.message); }
  };
  const exportMaster = async () => { try { const r = await window.hub.zc.export(); if (r) flash(`Exported ${r.people} people.`); } catch (e) { flash(e.message); } };

  if (!st) return null;
  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1><Icon name="video" size={24} /> Zoom Chat Organizer</h1>
          <div className="muted small">Saved Zoom chats → the SubTo Directory. Everyone who chats becomes a person you can search, call and work with; what they said becomes their history.</div>
        </div>
        <div className="row">
          <button onClick={() => window.dispatchEvent(new CustomEvent('hub-open-page', { detail: 'directory' }))}>Open SubTo Directory</button>
          <button onClick={exportMaster}>Export MASTER spreadsheet</button>
        </div>
      </header>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Chats to add</h3>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <span className="muted small">Zoom chat folder: <code className="path">{st.dir}</code>{!st.dirExists && ' (not found)'}</span>
          <button className="mini" onClick={chooseDir}>Change…</button>
          <button className="mini" onClick={scan}>Check for new chats</button>
          <button className="mini primary" onClick={pick}>Add chat files…</button>
        </div>
        <p className="muted small">In a Zoom meeting, open Chat → ⋯ → <b>Save chat</b>. Zoom saves it into your Zoom folder; the hub checks it every 10 minutes. You can also pick any saved chat .txt file.</p>
        {rows.length === 0 ? <p className="muted">No new chats. </p> : (
          <table className="table small">
            <thead><tr><th /><th>Chat</th><th>Messages</th><th>Call name</th><th title="Tag everyone in this chat as SubTo. Leave off for calls with non-SubTo people.">Everyone is SubTo</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.file}>
                  <td><input type="checkbox" checked={!!r.include} disabled={!r.messages} onChange={(e) => set(r.file, 'include', e.target.checked)} /></td>
                  <td><b>{r.folder && r.folder !== '.' ? r.folder : r.name}</b><div className="muted">{r.error || `${r.name} · ${r.first}`}</div></td>
                  <td>{r.messages} · {r.people} people</td>
                  <td><input className="mini-in" value={r.label || ''} onChange={(e) => set(r.file, 'label', e.target.value)} placeholder="e.g. 9/19 PM" /></td>
                  <td><input type="checkbox" checked={!!r.inferSubto} onChange={(e) => set(r.file, 'inferSubto', e.target.checked)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > 0 && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button className="primary" disabled={busy} onClick={add}>{busy ? 'Adding…' : `Add ${rows.filter((r) => r.include).length} chat${rows.filter((r) => r.include).length === 1 ? '' : 's'}`}</button></div>}
        <label className="remember" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={!!st.autoAdd} onChange={async (e) => { await window.hub.settings.set('zoomAutoAdd', e.target.checked); load(); }} /> Add new chats from the Zoom folder automatically
        </label>
      </section>

      {review && (
        <section className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>What was added</h3><button className="mini" onClick={() => setReview(null)}>Close</button></div>
          <ul className="uw-list">
            {review.files.map((f) => <li key={f.name}><span><b>{f.label || f.name}</b> {f.error && <span className="error">{f.error}</span>}</span><span className="muted">{f.added != null ? `${f.added} new messages${f.skipped ? `, ${f.skipped} already in the hub` : ''}` : ''}</span></li>)}
          </ul>
          {review.newContacts.length > 0 && (
            <>
              <h4>New people ({review.newContacts.length}) — check the name split, state and communities</h4>
              <table className="table small">
                <thead><tr><th>Name</th><th>Phone</th><th>State</th><th>Communities</th><th>Zoom name</th></tr></thead>
                <tbody>{review.newContacts.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => openRecord('contact', c.id)}><td><b>{c.name}</b></td><td>{c.phone}</td><td>{c.state}</td><td>{c.communities}</td><td className="muted">{c.zoomName}</td></tr>
                ))}</tbody>
              </table>
            </>
          )}
          {review.filled.length > 0 && (
            <>
              <h4>Filled in on people you already had ({review.filled.length})</h4>
              <ul className="uw-list">{review.filled.slice(0, 60).map((f, i) => <li key={i} className="clickable" onClick={() => openRecord('contact', f.id)}><span>{f.name}: {f.field}</span><span className="muted">{f.to}</span></li>)}</ul>
            </>
          )}
          {review.candidates.length > 0 && (
            <>
              <h4>Phones and emails people typed in the chat (not added unless you click)</h4>
              <ul className="uw-list">
                {review.candidates.map((c) => (
                  <li key={c.id}>
                    <button className="linkish" onClick={() => openRecord('contact', c.id)}>{c.name}</button>
                    <span className="row wrap" style={{ gap: 4 }}>{c.items.map((it) => <button key={it.value} className="mini" onClick={() => apply(c, it)}>+ {it.value}</button>)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Same person, two entries?</h3>
          <button className="mini" onClick={findDupes}>Find duplicates</button>
        </div>
        <p className="muted small">People who used a different Zoom name on another call can end up listed twice. This finds entries with the same full name, phone, email or Blinq card. Pick the one to keep; the others are merged into it.</p>
        {dupes && dupes.length === 0 && <p className="muted">No duplicates found.</p>}
        {dupes && dupes.map((g, i) => (
          <div key={i} className="dupe">
            {g.map((c) => (
              <div key={c.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span><button className="linkish" onClick={() => openRecord('contact', c.id)}>{c.name}</button> <span className="muted small">{c.phone} {c.email} {c.calls_attended && `· calls ${c.calls_attended}`} {c.kind === 'contact' && '· in Contacts'}</span></span>
                <button className="mini" onClick={() => merge(g, c)}>Keep this one</button>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Search your chats</h3>
        <p className="muted small">Every message is already searchable in Search & Docs (Ctrl+K), under "Notes, calls & chats", and on each person in the SubTo Directory. You can also search the saved chat files themselves:</p>
        <button className="mini" onClick={async () => { try { await window.hub.zc.searchFolder(); flash('The Zoom chat folder is now searched too.'); } catch (e) { flash(e.message); } }}>Search the Zoom chat folder too</button>
      </section>

      {legacy && legacy.exists && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Your original organizer app</h3>
          <p className="muted small">Still installed at <code className="path">{legacy.path}</code>. You don't need it any more, but it opens here if you want it.</p>
          <button className="mini" onClick={() => window.hub.zoom.open().catch((e) => flash(e.message))}>Open it</button>
        </section>
      )}
    </div>
  );
}

function mergeRows(old, found) {
  const byFile = new Map(old.map((r) => [r.file, r]));
  for (const f of found || []) if (!byFile.has(f.file)) byFile.set(f.file, { ...f, include: !!f.messages, inferSubto: /sub\s?-?to|pace|morby|creative campus|deal detective/i.test(`${f.folder} ${f.name}`) });
  return [...byFile.values()];
}
