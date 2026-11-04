import React, { useEffect, useState } from 'react';

// "Which browser should open Google Voice?" — lists the browsers installed on this PC.
let show = null;

export async function openSiteWindow(site, flash) {
  try {
    const r = await window.hub.sites.openWindow(site.id);
    if (r.needChoice) { if (show) show(site); return; }
    flash(`${site.label} opened in ${r.browser}.`);
  } catch (e) { flash(e.message); }
}

export function chooseBrowserFor(site, url) { if (show) show(site, url); }

export function BrowserPickerHost({ flash }) {
  const [site, setSite] = useState(null);
  const [atUrl, setAtUrl] = useState(null);
  const [list, setList] = useState(null);
  const [remember, setRemember] = useState(false);
  useEffect(() => { show = (s, u) => { setAtUrl(u || null); setSite(s); }; return () => { show = null; }; }, []);
  useEffect(() => {
    if (!site) return;
    setList(null);
    window.hub.browsers.list().then((r) => setList(r.browsers)).catch(() => setList([]));
  }, [site]);
  if (!site) return null;

  const pick = async (b) => {
    try {
      const r = await window.hub.sites.openWindow(site.id, b.id, remember, atUrl || undefined);
      flash(`${site.label} opened in ${r.browser}.${remember ? ' (remembered)' : ''}`);
      setSite(null);
    } catch (e) { flash(e.message); }
  };

  return (
    <div className="modal-back" onMouseDown={() => setSite(null)}>
      <div className="modal picker" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') setSite(null); }}>
        <h2>Open {site.label} in…</h2>
        <p className="muted small">It opens in its own window. The first time, Google asks you to sign in.</p>
        {list === null && <p className="muted">Looking for browsers…</p>}
        {list && list.length === 0 && <p>No browsers found. Your default browser will be used.</p>}
        <div className="browser-list">
          {list && list.map((b) => (
            <button key={b.id} className="browser-btn" onClick={() => pick(b)}>
              <strong>{b.name}</strong>
              <span className="muted small">{b.kind === 'chromium' ? 'Opens as an app window' : 'Opens in a new window'}</span>
            </button>
          ))}
        </div>
        <label className="remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember my choice (change it anytime in Settings → Website tabs)
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={() => setSite(null)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
