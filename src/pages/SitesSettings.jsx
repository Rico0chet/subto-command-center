import React, { useEffect, useState } from 'react';
import { askConfirm } from '../confirm.jsx';

function SiteRow({ site, reloadSites, flash }) {
  const [url, setUrl] = useState(site.url);
  useEffect(() => setUrl(site.url), [site.url]);
  const changed = url.trim() !== site.url;

  const save = async () => {
    try { await window.hub.sites.setHome(site.id, url.trim()); await reloadSites(); flash(`Saved ${site.label} home page.`); }
    catch (e) { flash(e.message); }
  };
  const reset = async () => { await window.hub.sites.resetHome(site.id); await reloadSites(); };
  const signOut = async () => {
    const shared = site.partition === 'persist:google' ? ' (this signs out of all Google tabs: Voice and Drive)' : '';
    if (!(await askConfirm(`Sign out of ${site.label}${shared}?`, 'Sign out'))) return;
    await window.hub.sites.signOut(site.id);
    flash(`Signed out of ${site.label}. Restart the app to see the sign-in page.`);
  };
  const remove = async () => {
    if (!(await askConfirm(`Remove ${site.label} from the sidebar?`, 'Remove'))) return;
    await window.hub.sites.removeCustom(site.id);
    await reloadSites();
  };

  return (
    <tr>
      <td style={{ width: 150 }}><strong>{site.label}</strong></td>
      <td><input disabled={!!site.lock} title={site.lock ? "Locked. Unlock it from the tab to change." : ""} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && changed && save()} /></td>
      <td className="actions">
        {changed && <button className="primary" onClick={save}>Save</button>}
        {!site.custom && site.url !== site.defaultUrl && <button onClick={reset}>Reset</button>}
        <select className="mode-pick" value={site.mode} title="Where this site opens"
          onChange={async (e) => { await window.hub.sites.setMode(site.id, e.target.value); await reloadSites(); }}>
          <option value="tab">Inside the hub</option>
          <option value="window">Own browser window</option>
        </select>
        {site.mode === 'tab' && <button onClick={signOut}>Sign out</button>}
        {site.custom && <button onClick={remove}>Remove</button>}
      </td>
    </tr>
  );
}

function LockSettings({ sites, flash, settings, setSettings }) {
  const [server, setServer] = useState(settings.discordServerName || '');
  const [hasPin, setHasPin] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  useEffect(() => { window.hub.lock.hasPin().then(setHasPin); }, []);
  const save = async (clear) => {
    try {
      const r = await window.hub.lock.setPin(oldPin, clear ? '' : newPin);
      setHasPin(r); setOldPin(''); setNewPin('');
      flash(r ? 'Unlock PIN saved.' : 'Unlock PIN removed.');
    } catch (e) { flash(e.message); }
  };
  const lockable = sites.filter((s) => s.lockable);
  const [removing, setRemoving] = useState(null);
  const [removePin, setRemovePin] = useState('');
  const removePerm = async (site) => {
    try {
      await window.hub.sites.removePermanent(site.id, removePin);
      setRemoving(null); setRemovePin('');
      flash(`The permanent lock on ${site.label} was removed.`);
      window.location.reload();
    } catch (e) { flash(e.message); }
  };
  return (
    <section className="card">
      <h2>🔒 Community lock</h2>
      <p className="muted small">A locked tab stays inside the SubTo Facebook group or the SubTo Discord server: no feed, profile, search, Marketplace, DMs or other servers. Lock it from the tab's toolbar while you're in the group or server. A permanent lock can't be undone from inside the app.</p>
      <table className="table">
        <tbody>
          {lockable.map((s) => (
            <tr key={s.id}>
              <td style={{ width: 150 }}><strong>{s.label}</strong></td>
              <td>{s.suspended && !s.lock ? <>Locked to <strong>{s.suspended.name || s.suspended.home}</strong></> : s.lock ? <>Locked to <strong>{s.lock.name || s.lock.home}</strong> <span className="muted small">({s.lock.home})</span></> : <span className="muted">Not locked</span>}</td>
              <td style={{ textAlign: 'right' }}>
                {(s.lock?.permanent || s.suspended) && <span className="perm-tag">Permanent{s.suspended ? ' (unlocked until restart)' : ''}</span>}
                {(s.lock?.permanent || s.suspended) && (removing === s.id ? (
                  <span className="row" style={{ display: 'inline-flex', marginLeft: 8 }}>
                    <input type="password" inputMode="numeric" placeholder="PIN" value={removePin} onChange={(e) => setRemovePin(e.target.value)} style={{ width: 90, minWidth: 90 }} />
                    <button onClick={() => removePerm(s)}>Remove lock</button>
                    <button onClick={() => setRemoving(null)}>Cancel</button>
                  </span>
                ) : (
                  <button style={{ marginLeft: 8, padding: '4px 10px', fontSize: 12.5 }} onClick={() => { setRemoving(s.id); setRemovePin(''); }}>Remove permanent lock…</button>
                ))}
                {s.lock && !s.lock.permanent && <span className="muted small">Use "Make permanent" in the {s.label} tab</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="field" style={{ marginTop: 14 }}>
        <span>Discord server the lock is allowed to use</span>
        <div className="row">
          <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="Creative Campus" style={{ maxWidth: 320 }} />
          <button onClick={async () => { setSettings(await window.hub.settings.set('discordServerName', server)); flash('Saved.'); }}>Save</button>
        </div>
      </label>
      <div className="field">
        <span>Unlock PIN (optional, 4–8 digits). With a PIN, nobody can unlock the tabs without it.</span>
        <div className="row">
          {hasPin && <input type="password" inputMode="numeric" placeholder="Current PIN" value={oldPin} onChange={(e) => setOldPin(e.target.value)} style={{ maxWidth: 160, minWidth: 120 }} />}
          <input type="password" inputMode="numeric" placeholder={hasPin ? 'New PIN' : 'Choose a PIN'} value={newPin} onChange={(e) => setNewPin(e.target.value)} style={{ maxWidth: 160, minWidth: 120 }} />
          <button className="primary" onClick={() => save(false)}>{hasPin ? 'Change PIN' : 'Set PIN'}</button>
          {hasPin && <button onClick={() => save(true)}>Remove PIN</button>}
        </div>
      </div>
    </section>
  );
}

function BrowserPrefs({ flash }) {
  const [data, setData] = useState(null);
  useEffect(() => { window.hub.browsers.list().then(setData); }, []);
  if (!data) return null;
  const save = async (browserId, separate) => {
    const r = await window.hub.browsers.setPrefs(browserId, separate);
    setData({ ...data, ...r });
    flash('Saved.');
  };
  return (
    <section className="card">
      <h2>Browser for Google Voice and Drive</h2>
      <p className="muted small">Google sites open in a real browser window. Found on this PC: {data.browsers.map((b) => b.name).join(', ') || 'none'}.</p>
      <div className="row">
        <select className="mode-pick" value={data.remembered || ''} onChange={(e) => save(e.target.value, undefined)}>
          <option value="">Ask me every time</option>
          {data.browsers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <label className="remember" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={data.separate} onChange={(e) => save(undefined, e.target.checked)} />
        Use a separate sign-in just for the hub (recommended). Turn off to use your everyday browser profile instead.
      </label>
    </section>
  );
}

export default function SitesSettings({ settings, setSettings, sites, reloadSites, flash }) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [zoom, setZoom] = useState(null);

  const loadZoom = async () => setZoom(await window.hub.zoom.status());
  useEffect(() => { loadZoom(); }, []);

  const add = async (e) => {
    e.preventDefault();
    try {
      await window.hub.sites.addCustom(label, url);
      await reloadSites();
      flash(`Added ${label.trim()} under "My Sites".`);
      setLabel(''); setUrl('');
    } catch (err) { flash(err.message); }
  };

  return (
    <>
      <LockSettings sites={sites} flash={flash} settings={settings} setSettings={setSettings} />
      <section className="card">
        <h2>Website tabs</h2>
        <p className="muted small">Each tab remembers its own sign-in. Change a home page here, or use "Set as home" while you're on the page you want.</p>
        <table className="table sites-table">
          <tbody>
            {sites.map((s) => <SiteRow key={s.id} site={s} reloadSites={reloadSites} flash={flash} />)}
          </tbody>
        </table>
        <h2 style={{ marginTop: 20 }}>Add your own site</h2>
        <form className="row" onSubmit={add}>
          <input style={{ maxWidth: 220, minWidth: 160 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. PropStream" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Web address, e.g. app.propstream.com" />
          <button className="primary" type="submit">Add</button>
        </form>
      </section>

      <BrowserPrefs flash={flash} />

      <section className="card">
        <h2>Downloads</h2>
        <p className="muted small">Files you download inside the hub (from Facebook, Discord, Drive, etc.) are saved here. In phase 6 this folder becomes searchable.</p>
        <div className="row">
          <code className="path">{settings.downloadDir}</code>
          <button onClick={async () => setSettings(await window.hub.downloads.chooseFolder())}>Change…</button>
          <button onClick={() => window.hub.downloads.openFolder()}>Open</button>
        </div>
      </section>

      <section className="card">
        <h2>Zoom Chat Organizer</h2>
        <div className="row">
          <code className="path">{zoom?.path || 'Not set yet'}</code>
          <button onClick={async () => { await window.hub.zoom.detect(); loadZoom(); }}>Find automatically</button>
          <button onClick={async () => { await window.hub.zoom.choose(); loadZoom(); }}>Choose…</button>
        </div>
      </section>
    </>
  );
}
