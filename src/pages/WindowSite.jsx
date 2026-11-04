import React from 'react';
import Icon from '../Icon.jsx';
import { openSiteWindow, chooseBrowserFor } from '../browserPicker.jsx';

// Sites Google won't let you sign in to inside an app open as their own browser window instead.
export default function WindowSite({ site, reloadSites, flash }) {
  const openAgain = () => openSiteWindow(site, flash);
  const tryInside = async () => {
    await window.hub.sites.setMode(site.id, 'tab');
    await reloadSites();
    flash(`${site.label} will now try to open inside the hub. Click it again in the sidebar.`);
  };

  return (
    <div className="page">
      <header className="page-head"><h1><Icon name={site.icon} size={24} /> {site.label}</h1></header>
      <section className="card soon-card">
        <p><strong>{site.label} opens in its own browser window</strong>, because Google doesn't allow signing in inside apps. Pick any browser on your PC; the first time, Google asks you to sign in.</p>
        <p className="muted small">Tip: pin that window to your taskbar (right-click its icon → Pin to taskbar) to keep it one click away.</p>
        <div className="row">
          <button className="primary big" onClick={openAgain}>Open {site.label}</button>
          <button onClick={() => chooseBrowserFor(site)}>Choose a different browser…</button>
        </div>
        <p className="muted small" style={{ marginTop: 18 }}>
          Want it inside the hub instead? Google may still block sign-in there.{' '}
          <button className="linkish" onClick={tryInside}>Try inside the hub</button>
        </p>
      </section>
    </div>
  );
}
