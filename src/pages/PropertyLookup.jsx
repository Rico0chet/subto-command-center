import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { Drawer } from '../crm/shared.jsx';
import { GROUPS, mergeSites, buildUrl, parseAddress, cleanCustomSite } from '../lookup.mjs';

const PARTITION = 'persist:lookup'; // one shared sign-in jar, so DealSauce, PropStream, AirDNA… stay signed in

export default function PropertyLookup({ settings, setSettings, flash, active, request }) {
  const [addr, setAddr] = useState('');
  const [current, setCurrent] = useState(''); // address the open tabs belong to
  const [tabs, setTabs] = useState([]); // { key, site, url, paste }
  const [on, setOn] = useState(null);
  const [editing, setEditing] = useState(false);
  const [showGroups, setShowGroups] = useState(true);
  const [suggest, setSuggest] = useState([]);
  const reqN = useRef(0);

  const sites = useMemo(() => mergeSites(settings), [settings]);
  const county = (settings.county && settings.county.name) || '';
  const parsed = parseAddress(addr);

  useEffect(() => {
    (async () => {
      const deals = await window.hub.crm.listDeals({ includeDead: true }).catch(() => []);
      setSuggest([...new Set([...(settings.lookupRecent || []), ...deals.map((d) => [d.address, d.city, d.state, d.zip].filter(Boolean).join(', '))].filter(Boolean))].slice(0, 60));
    })();
  }, [active, settings.lookupRecent]);

  // Asked from a deal, lead or analysis: fill in the address.
  useEffect(() => {
    if (!request || request.n === reqN.current) return;
    reqN.current = request.n;
    setAddr(request.address || '');
  }, [request]);

  const remember = async (a) => {
    const list = [a, ...(settings.lookupRecent || []).filter((x) => x !== a)].slice(0, 20);
    setSettings(await window.hub.settings.set('lookupRecent', list));
  };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ } };

  const openSites = async (list) => {
    const a = addr.trim();
    if (!a) { flash('Type an address first.'); return; }
    if (a !== current) { setCurrent(a); }
    await copy(a);
    remember(a);
    const fresh = list.map((s) => ({ key: `${s.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, site: s, ...buildUrl(s, a, county) }));
    setTabs((t) => {
      const keep = a === current ? t.filter((x) => !list.some((s) => s.id === x.site.id)) : [];
      return [...keep, ...fresh];
    });
    setOn(fresh[0].key);
    setShowGroups(false);
    if (fresh.some((f) => f.paste)) flash('Address copied. On sites without a direct link, click their search box and press Ctrl+V.');
  };
  const closeTab = (key) => setTabs((t) => {
    const next = t.filter((x) => x.key !== key);
    if (on === key) setOn(next.length ? next[next.length - 1].key : null);
    return next;
  });
  const tab = tabs.find((t) => t.key === on);

  return (
    <div className="lookup" style={{ display: active ? 'flex' : 'none' }}>
      <div className="lk-top">
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}><Icon name="pin" size={20} /> Property Lookup</h1>
          <form className="lk-search" onSubmit={(e) => { e.preventDefault(); openSites(sites.filter((s) => s.enabled && s.group === 'residential')); }}>
            <input list="lk-addrs" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Type an address: 123 Main St, Mesa, AZ 85203" autoFocus />
            <datalist id="lk-addrs">{suggest.map((s) => <option key={s} value={s} />)}</datalist>
            <button className="primary" type="submit">Look up</button>
          </form>
          <button onClick={() => copy(addr.trim()).then(() => flash('Address copied.'))} disabled={!addr.trim()}>Copy address</button>
          {tabs.length > 0 && <button onClick={() => setShowGroups(!showGroups)}>{showGroups ? 'Hide sites ▴' : 'Show sites ▾'}</button>}
          <button onClick={() => setEditing(true)}>Edit sites</button>
        </div>
        {addr.trim() && <div className="muted small lk-parsed">{parsed.street || '—'} · {parsed.city || 'city?'} · {parsed.state || 'state?'} · {parsed.zip || 'ZIP?'}{!parsed.city && ' (add commas: street, city, state ZIP)'}</div>}
        {(showGroups || tabs.length === 0) && <div className="lk-groups">
          {GROUPS.map((g) => {
            const list = sites.filter((s) => s.enabled && s.group === g.id);
            if (!list.length) return null;
            return (
              <div key={g.id} className="lk-group">
                <div className="lk-gh"><b>{g.label}</b><button className="mini primary" onClick={() => openSites(list)}>Open all {list.length}</button></div>
                <div className="lk-sites">
                  {list.map((s) => (
                    <button key={s.id} className="mini" title={s.url ? (s.note || 'Opens straight to this address') : 'Opens the site; paste the address (copied for you)'} onClick={() => openSites([s])}>
                      {s.label}{!s.url && <span className="paste-dot" title="Paste the address">⧉</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>}
      </div>

      {tabs.length > 0 && (
        <div className="lk-tabs">
          {tabs.map((t) => (
            <div key={t.key} className={`lk-tab ${t.key === on ? 'on' : ''}`} onClick={() => setOn(t.key)}>
              <span>{t.site.label}</span>
              <button className="x" title="Close" onClick={(e) => { e.stopPropagation(); closeTab(t.key); }}>✕</button>
            </div>
          ))}
          <button className="mini" onClick={() => { setTabs([]); setOn(null); }}>Close all</button>
        </div>
      )}
      <div className="lk-body">
        {tabs.length === 0 && (
          <div className="lk-empty muted">
            <p>Type an address, then click <b>Look up</b> (listings & values) or <b>Open all</b> on any group. Each site opens as a tab here.</p>
            <p className="small">Sites marked ⧉ don't take an address in their link, so the hub copies it for you: click the site's search box and press Ctrl+V. Sign in to DealSauce, PropStream, AirDNA and others once; the hub remembers.</p>
          </div>
        )}
        {tabs.map((t) => <LookupView key={t.key} tab={t} visible={t.key === on} address={current} />)}
      </div>
      {editing && <EditSites settings={settings} setSettings={setSettings} sites={sites} flash={flash} onClose={() => setEditing(false)} />}
    </div>
  );
}

function LookupView({ tab, visible, address }) {
  const ref = useRef(null);
  const [url, setUrl] = useState(tab.url);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const wv = ref.current;
    if (!wv) return undefined;
    const sync = () => { try { setUrl(wv.getURL()); } catch { /* not ready */ } };
    const h = { 'did-start-loading': () => setLoading(true), 'did-stop-loading': () => { setLoading(false); sync(); }, 'did-navigate': sync, 'did-navigate-in-page': sync };
    Object.entries(h).forEach(([k, f]) => wv.addEventListener(k, f));
    return () => Object.entries(h).forEach(([k, f]) => wv.removeEventListener(k, f));
  }, []);
  const go = (fn) => { try { fn(ref.current); } catch { /* not ready */ } };
  return (
    <div className="lk-view" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="webbar">
        <button className="tb" title="Back" onClick={() => go((w) => w.goBack())}>‹</button>
        <button className="tb" title="Forward" onClick={() => go((w) => w.goForward())}>›</button>
        <button className="tb" title="Reload" onClick={() => go((w) => w.reload())}>{loading ? '…' : '↻'}</button>
        <div className="urlbox" title={url}>{url}</div>
        <button className="tb text" onClick={() => navigator.clipboard.writeText(address).catch(() => {})}>Copy address</button>
        <button className="tb text" onClick={() => window.hub.app.openExternal(url)}>Open in browser</button>
        <button className="tb text primary-ish" title="Read this page (price, beds, baths, sq ft, rent estimate, taxes…) into Underwriting" onClick={async () => {
          try {
            const data = await window.hub.uw.extractFromTab(ref.current.getWebContentsId());
            if (!data || !(data.price || data.sqft || data.beds || data.zestimate || data.rentEstimate || data.countyValue)) { window.dispatchEvent(new CustomEvent('hub-toast', { detail: "Couldn't find property facts on this page. Open the property's own page (not a search list) and try again." })); return; }
            window.dispatchEvent(new CustomEvent('hub-uw-prefill', { detail: { address: data.address || address, listing: data } }));
          } catch (e) { window.dispatchEvent(new CustomEvent('hub-toast', { detail: e.message })); }
        }}>Send to Underwriting</button>
      </div>
      {tab.paste && <div className="webhint">The address is copied. Click this site's search box and press <b>Ctrl+V</b>.</div>}
      <div className="webbody">
        <webview ref={ref} src={tab.url} partition={PARTITION} allowpopups="true" style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
}

function EditSites({ settings, setSettings, sites, flash, onClose }) {
  const [county, setCounty] = useState({ name: '', assessor: '', recorder: '', treasurer: '', gis: '', ...(settings.county || {}) });
  const [nw, setNw] = useState({ label: '', url: '', group: 'investor' });
  const save = async (key, value) => setSettings(await window.hub.settings.set(key, value));
  const toggle = async (s) => {
    if (s.custom) return;
    if (s.off !== undefined && s.off) {
      const shown = new Set(settings.lookupShown || []);
      if (shown.has(s.id)) shown.delete(s.id); else shown.add(s.id);
      return save('lookupShown', [...shown]);
    }
    const hidden = new Set(settings.lookupHidden || []);
    if (hidden.has(s.id)) hidden.delete(s.id); else hidden.add(s.id);
    return save('lookupHidden', [...hidden]);
  };
  const addSite = async () => {
    try {
      const s = cleanCustomSite(nw);
      await save('lookupCustom', [...(settings.lookupCustom || []), { id: s.id, label: s.label, url: s.url, group: s.group }]);
      setNw({ label: '', url: '', group: nw.group });
      flash(`Added ${s.label}.`);
    } catch (e) { flash(e.message); }
  };
  const removeCustom = (id) => save('lookupCustom', (settings.lookupCustom || []).filter((x) => x.id !== id));
  const saveCounty = async () => {
    for (const k of ['assessor', 'recorder', 'treasurer', 'gis']) {
      if (county[k] && !/^https?:\/\//i.test(county[k])) { flash('County web addresses must start with https://'); return; }
    }
    await save('county', county);
    flash('County saved.');
  };
  return (
    <Drawer onClose={onClose} width={720}>
      <div className="drawer-head"><h2 style={{ margin: 0 }}>Lookup sites</h2><button className="icon-btn" onClick={onClose}>✕</button></div>
      <section className="panel-sec">
        <h3>Your county</h3>
        <p className="muted small">Paste the search page for each county site. If the site puts the address in its web address, use {'{q}'} (full address), {'{street}'}, {'{city}'} or {'{zip}'} where it goes and it will open straight to the property.</p>
        <div className="form-grid">
          {[['name', 'County name (e.g. Maricopa County, AZ)'], ['assessor', 'Assessor / appraisal district'], ['recorder', 'Recorder / deeds'], ['treasurer', 'Treasurer / tax bill'], ['gis', 'GIS / parcel map']].map(([k, l]) => (
            <label key={k} className="f wide"><span>{l}</span><input value={county[k]} onChange={(e) => setCounty({ ...county, [k]: e.target.value })} placeholder={k === 'name' ? '' : 'https://'} /></label>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="primary" onClick={saveCounty}>Save county</button></div>
      </section>
      <section className="panel-sec">
        <h3>Add your own site</h3>
        <div className="form-grid">
          <label className="f"><span>Name</span><input value={nw.label} onChange={(e) => setNw({ ...nw, label: e.target.value })} /></label>
          <label className="f"><span>Group</span><select className="sel" value={nw.group} onChange={(e) => setNw({ ...nw, group: e.target.value })}>{GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
          <label className="f wide"><span>Web address (use {'{q}'} where the address goes, if the site supports it)</span><input value={nw.url} onChange={(e) => setNw({ ...nw, url: e.target.value })} placeholder="https://" /></label>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="primary" onClick={addSite}>Add site</button></div>
      </section>
      <section className="panel-sec">
        <h3>Show or hide sites</h3>
        {GROUPS.map((g) => (
          <div key={g.id} style={{ marginBottom: 8 }}>
            <div className="muted small" style={{ marginBottom: 4 }}>{g.label}</div>
            <div className="lk-sites">
              {sites.filter((s) => s.group === g.id).map((s) => (
                <span key={s.id} className="lk-toggle">
                  <label className="remember" style={{ margin: 0 }}><input type="checkbox" checked={s.enabled} disabled={s.custom} onChange={() => toggle(s)} /> {s.label}</label>
                  {s.custom && <button className="mini" onClick={() => removeCustom(s.id)}>Remove</button>}
                </span>
              ))}
            </div>
          </div>
        ))}
      </section>
    </Drawer>
  );
}
