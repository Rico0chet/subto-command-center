import React, { useEffect, useState } from 'react';
import { when, bytes } from '../format.js';
import SitesSettings from './SitesSettings.jsx';

export default function Settings({ settings, setSettings, update, sites, reloadSites, flash: notify }) {
  const [name, setName] = useState(settings.userName || '');
  const [keep, setKeep] = useState(settings.backupKeep);
  const [backups, setBackups] = useState([]);
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState('');

  const load = async () => {
    setBackups(await window.hub.backup.list());
    setInfo(await window.hub.app.info());
  };
  useEffect(() => { load(); }, [settings.backupDir, settings.lastBackup]);

  const flash = (t) => { setStatus(t); setTimeout(() => setStatus(''), 4000); };

  const backupNow = async () => {
    try {
      await window.hub.backup.now();
      setSettings(await window.hub.settings.get());
      flash('Backup saved.');
    } catch (e) { flash(`Backup failed: ${e.message}`); }
  };

  const chooseFolder = async () => setSettings(await window.hub.backup.chooseFolder());
  const restore = async () => {
    try { await window.hub.backup.restore(); } catch (e) { flash(`Restore failed: ${e.message}`); }
  };

  return (
    <div className="page">
      <header className="page-head"><h1>Settings</h1></header>

      <section className="card">
        <h2>Profile</h2>
        <label className="field">
          <span>Your name</span>
          <div className="row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Phillip" />
            <button onClick={() => update('userName', name.trim())}>Save</button>
          </div>
        </label>
        <div className="field">
          <span>Theme</span>
          <div className="seg">
            {['dark', 'light'].map((t) => (
              <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => update('theme', t)}>
                {t === 'dark' ? 'Dark' : 'Light'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Backups</h2>
        <p className="muted small">The hub backs up automatically once a day while it's open. Choose your Google Drive folder to keep a copy in the cloud for free.</p>
        <div className="field">
          <span>Backup folder</span>
          <div className="row">
            <code className="path">{settings.backupDir}</code>
            <button onClick={chooseFolder}>Change…</button>
            <button onClick={() => window.hub.app.openPath(settings.backupDir)}>Open</button>
          </div>
        </div>
        <label className="field">
          <span>Backups to keep</span>
          <div className="row">
            <input type="number" min="1" max="365" value={keep} onChange={(e) => setKeep(e.target.value)} style={{ width: 100 }} />
            <button onClick={() => update('backupKeep', keep)}>Save</button>
          </div>
        </label>
        <div className="row">
          <button className="primary" onClick={backupNow}>Back up now</button>
          <button onClick={restore}>Restore from backup…</button>
          <span className="muted small">Last backup: {when(settings.lastBackup)}</span>
        </div>
        {status && <p className="small status">{status}</p>}
        {backups.length > 0 && (
          <table className="table">
            <thead><tr><th>Backup</th><th>Size</th></tr></thead>
            <tbody>
              {backups.slice(0, 10).map((b) => (
                <tr key={b.name}><td>{when(b.time)}</td><td>{bytes(b.sizeBytes)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <SitesSettings settings={settings} setSettings={setSettings} sites={sites} reloadSites={reloadSites} flash={notify} />

      <section className="card">
        <h2>About</h2>
        <dl className="facts">
          <dt>Version</dt><dd>{info?.version}</dd>
          <dt>Data file</dt><dd><code className="path">{info?.dataFile}</code></dd>
        </dl>
        <button onClick={() => window.hub.app.openDataFolder()}>Open data folder</button>
        <p className="muted small">More settings (calendar link, watched folders, your county) arrive with the phases that use them.</p>
      </section>
    </div>
  );
}
