import React, { useCallback, useEffect, useRef, useState } from 'react';
import { buildNav, WORK } from './modules.js';
import Icon from './Icon.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Settings from './pages/Settings.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import WebTab from './pages/WebTab.jsx';
import ZoomOrganizer from './pages/ZoomOrganizer.jsx';
import WindowSite from './pages/WindowSite.jsx';
import { ConfirmHost } from './confirm.jsx';
import { BrowserPickerHost, openSiteWindow } from './browserPicker.jsx';
import Deals from './pages/Deals.jsx';
import Contacts from './pages/Contacts.jsx';
import Tasks from './pages/Tasks.jsx';
import Lists from './pages/Lists.jsx';
import Underwriting from './pages/Underwriting.jsx';
import PropertyLookup from './pages/PropertyLookup.jsx';
import SearchDocs from './pages/SearchDocs.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import { CallLoggerHost } from './crm/shared.jsx';

const BUILT_PHASE = 9; // sidebar items from later phases show a "coming" badge

// "(3) Facebook" -> 3
const unreadFromTitle = (t) => { const m = /^\s*\((\d{1,4})\+?\)/.exec(String(t || '')); return m ? Number(m[1]) : 0; };

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [settings, setSettings] = useState(null);
  const [sites, setSites] = useState([]);
  const [visited, setVisited] = useState([]); // website tabs opened so far (kept alive)
  const [unread, setUnread] = useState({});
  const [toasts, setToasts] = useState([]);
  const [error, setError] = useState('');
  const toastId = useRef(0);
  const [focus, setFocus] = useState(null); // { type: 'deal' | 'contact', id }
  const [siteGo, setSiteGo] = useState({});
  const [lookupReq, setLookupReq] = useState(null); // { address, n }
  const [lookupOn, setLookupOn] = useState(false);
  const [searchReq, setSearchReq] = useState(null); // { [siteId]: { url, n } } — send a tab to an address

  const flash = useCallback((text, action) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const sitesRef = useRef([]);
  const loadSites = useCallback(async () => {
    const list = await window.hub.sites.list();
    sitesRef.current = list;
    setSites(list);
  }, []);

  useEffect(() => {
    window.hub.settings.get().then(setSettings).catch((e) => setError(e.message));
    loadSites().catch((e) => setError(e.message));
    let lastLockMsg = 0;
    const offLock = window.hub.lock.onBlocked((d) => {
      const now = Date.now();
      if (!d.stuck && now - lastLockMsg < 3000) return;
      lastLockMsg = now;
      const lockSite = sitesRef.current.find((x) => x.id === d.siteId);
      const where = (lockSite && lockSite.lock && lockSite.lock.name) || (d.siteId === 'facebook' ? 'the SubTo group' : 'the SubTo server');
      flash(d.stuck
        ? `The page kept leaving ${where}. Click the Home button, or unlock the tab.`
        : `That page is outside ${where}, so the hub kept you here.`);
    });
    const offDl = window.hub.downloads.onEvent((d) => {
      if (d.state === 'completed') flash(`Downloaded ${d.name}`, { label: 'Show in folder', run: () => window.hub.downloads.show(d.path) });
      else if (d.state === 'interrupted') flash(`Download failed: ${d.name}`);
    });
    let lastAppMsg = 0;
    const offApp = window.hub.onAppLinkBlocked(() => {
      if (Date.now() - lastAppMsg < 10000) return;
      lastAppMsg = Date.now();
      flash('A website tried to open its desktop app. The hub kept it here instead.');
    });
    // Jump to a deal or contact from anywhere (tasks, dashboard, links inside panels).
    const onOpen = (e) => {
      const { type, id } = e.detail;
      setFocus({ type, id });
      setPage(type === 'deal' ? 'deals' : type === 'lead' ? 'lists' : type === 'analysis' || type === 'uwDeal' || type === 'uwLead' ? 'calculator' : 'contacts');
    };
    // Open a website tab at a specific address (click-to-call in Google Voice).
    const onSite = (e) => {
      const { siteId, url } = e.detail;
      setVisited((v) => (v.includes(siteId) ? v : [...v, siteId]));
      setSiteGo((g) => ({ ...g, [siteId]: { url, n: ((g[siteId] && g[siteId].n) || 0) + 1 } }));
      setPage(siteId);
    };
    const onPage = (e) => setPage(e.detail);
    const offCal = window.hub.cal.onAlert((a) => flash(`${a.mins ? `In ${a.mins} min` : 'Starting now'}: ${a.title}`, a.join ? { label: `Join ${a.join.kind}`, run: () => window.hub.cal.join(a.join.url).catch(() => {}) } : { label: 'Calendar', run: () => setPage('calendar') }));
    const onLookup = (e) => { setLookupReq((r) => ({ address: e.detail, n: ((r && r.n) || 0) + 1 })); setPage('lookup'); };
    window.addEventListener('hub-lookup', onLookup);
    const onUwPrefill = (e) => { setFocus({ type: 'uwPrefill', address: e.detail.address, listing: e.detail.listing, n: Date.now() }); setPage('calculator'); };
    const onToast = (e) => flash(e.detail);
    window.addEventListener('hub-uw-prefill', onUwPrefill);
    window.addEventListener('hub-toast', onToast);
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setSearchReq((r) => ({ n: ((r && r.n) || 0) + 1 })); setPage('search'); }
    };
    window.addEventListener('keydown', onKey);
    const onSearch = (e) => { setSearchReq((r) => ({ q: e.detail, n: ((r && r.n) || 0) + 1 })); setPage('search'); };
    window.addEventListener('hub-search', onSearch);
    window.addEventListener('hub-open', onOpen);
    window.addEventListener('hub-open-site', onSite);
    window.addEventListener('hub-open-page', onPage);
    const offNav = window.hub.onNavigate((p) => setPage(p));
    return () => {
      offLock(); offDl(); offApp(); offNav();
      window.removeEventListener('hub-open', onOpen);
      window.removeEventListener('hub-open-site', onSite);
      window.removeEventListener('hub-open-page', onPage);
      window.removeEventListener('hub-lookup', onLookup);
      window.removeEventListener('hub-uw-prefill', onUwPrefill);
      window.removeEventListener('hub-toast', onToast);
      offCal();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hub-search', onSearch);
    };
  }, []);

  useEffect(() => {
    if (settings) document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
  }, [settings]);

  const update = async (key, value) => {
    try { setSettings(await window.hub.settings.set(key, value)); }
    catch (e) { setError(e.message); }
  };

  const open = (id) => {
    setPage(id);
    const site = sites.find((s) => s.id === id);
    if (!site) return;
    if (site.mode === 'window') {
      openSiteWindow(site, flash);
    } else {
      setVisited((v) => (v.includes(id) ? v : [...v, id]));
    }
  };

  const onUnread = useCallback((id, title) => {
    const n = unreadFromTitle(title);
    setUnread((u) => (u[id] === n ? u : { ...u, [id]: n }));
  }, []);

  // A removed custom site closes its tab.
  useEffect(() => {
    setVisited((v) => v.filter((id) => sites.some((s) => s.id === id && s.mode === 'tab')));
    if (page.startsWith('c-') && !sites.some((s) => s.id === page)) setPage('dashboard');
  }, [sites]);

  useEffect(() => { if (page === 'lookup') setLookupOn(true); }, [page]);

  if (error) return <div className="fatal">Something went wrong: {error}</div>;
  if (!settings) return <div className="loading">Loading…</div>;

  const nav = buildNav(sites);
  const isWeb = sites.some((s) => s.id === page && s.mode === 'tab');
  const windowSite = sites.find((s) => s.id === page && s.mode === 'window');
  const workItem = WORK.find((i) => i.id === page);

  let body = null;
  if (page === 'dashboard') body = <Dashboard settings={settings} setSettings={setSettings} go={open} />;
  else if (page === 'settings') body = <Settings settings={settings} setSettings={setSettings} update={update} sites={sites} reloadSites={loadSites} flash={flash} />;
  else if (page === 'zoomorg') body = <ZoomOrganizer flash={flash} />;
  else if (page === 'deals') body = <Deals flash={flash} focusId={focus && focus.type === 'deal' ? focus.id : null} clearFocus={() => setFocus(null)} />;
  else if (page === 'contacts') body = <Contacts key="contacts" flash={flash} focusId={focus && focus.type === 'contact' ? focus.id : null} clearFocus={() => setFocus(null)} />;
  else if (page === 'tasks') body = <Tasks flash={flash} />;
  else if (page === 'lists') body = <Lists flash={flash} focusId={focus && focus.type === 'lead' ? focus.id : null} clearFocus={() => setFocus(null)} />;
  else if (page === 'directory') body = <Contacts key="dir" kind="network" flash={flash} focusId={focus && focus.type === 'contact' ? focus.id : null} clearFocus={() => setFocus(null)} />;
  else if (page === 'calculator') body = <Underwriting flash={flash} focus={focus && ['analysis', 'uwDeal', 'uwLead', 'uwPrefill'].includes(focus.type) ? focus : null} clearFocus={() => setFocus(null)} />;
  else if (page === 'lookup') body = null;
  else if (page === 'calendar') body = <CalendarPage settings={settings} setSettings={setSettings} flash={flash} />;
  else if (page === 'search') body = <SearchDocs flash={flash} focusQuery={searchReq} />;
  else if (workItem) body = <ComingSoon item={workItem} />;
  else if (windowSite) body = <WindowSite site={windowSite} reloadSites={loadSites} flash={flash} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">SC</div>
          <div>
            <div className="brand-name">SubTo</div>
            <div className="brand-sub">Command Center</div>
          </div>
        </div>
        <nav>
          {nav.map((g) => (
            <div key={g.group} className="nav-group">
              <div className="nav-group-label">{g.group}</div>
              {g.items.map((it) => (
                <button key={it.id} className={`nav-item ${page === it.id ? 'active' : ''}`}
                  onClick={() => open(it.id)} title={it.phase > BUILT_PHASE ? `Coming in phase ${it.phase}` : it.label}>
                  <Icon name={it.icon} />
                  <span>{it.label}</span>
                  {it.phase > BUILT_PHASE && <span className="soon">P{it.phase}</span>}
                  {unread[it.id] > 0 && <span className="badge">{unread[it.id] > 99 ? '99+' : unread[it.id]}</span>}
                  {it.kind === 'web' && visited.includes(it.id) && !(unread[it.id] > 0) && <span className="live" title="Open in the background" />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button className={`nav-item settings-btn ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>
          <Icon name="gear" />
          <span>Settings</span>
        </button>
      </aside>
      <main className="content">
        {!isWeb && page !== 'lookup' && <div className="pagewrap">{body}</div>}
        {(lookupOn || page === 'lookup') && (
          <div className="lookupstack" style={{ visibility: page === 'lookup' ? 'visible' : 'hidden', zIndex: page === 'lookup' ? 3 : 0 }}>
            <PropertyLookup settings={settings} setSettings={setSettings} flash={flash} active={page === 'lookup'} request={lookupReq} />
          </div>
        )}
        <div className="webstack" style={{ visibility: isWeb ? 'visible' : 'hidden' }}>
          {visited.map((id) => {
            const site = sites.find((s) => s.id === id);
            return site ? (
              <WebTab key={id} site={site} active={page === id} onUnread={onUnread} onSitesChanged={loadSites} flash={flash} discordServerName={settings.discordServerName} goTo={siteGo[id]} />
            ) : null;
          })}
        </div>
      </main>
      <ConfirmHost />
      <BrowserPickerHost flash={flash} />
      <CallLoggerHost flash={flash} />
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.text}</span>
            {t.action && <button onClick={t.action.run}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
