import React, { useEffect, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { askConfirm } from '../confirm.jsx';
import { openSiteWindow } from '../browserPicker.jsx';

// One built-in website. Stays loaded in the background after the first visit,
// so switching tabs never loses your place.
export default function WebTab({ site, active, onUnread, onSitesChanged, flash, discordServerName = 'Creative Campus', goTo }) {
  const ref = useRef(null);
  const [initialUrl] = useState((goTo && goTo.url) || site.url);
  const goN = useRef(goTo ? goTo.n : 0);
  // Asked to show a specific page (e.g. start a Google Voice call): load it once per request.
  useEffect(() => {
    if (!goTo || goTo.n === goN.current) return;
    goN.current = goTo.n;
    try { ref.current && ref.current.loadURL(goTo.url); } catch { /* webview not ready; initialUrl covers first load */ }
  }, [goTo]);
  const [url, setUrl] = useState(site.url);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(null);
  const [nav, setNav] = useState({ back: false, fwd: false });
  const [zoom, setZoom] = useState(0);
  const [askPin, setAskPin] = useState(false); // false | 'unlock' | 'permanent' | 'newpin'
  const [pin, setPin] = useState('');
  const [pinErr, setPinErr] = useState('');
  const pinRef = useRef(null);
  useEffect(() => {
    if (!askPin) return undefined;
    try { ref.current && ref.current.blur(); } catch { /* ignore */ }
    window.hub.app.refocus().catch(() => {});
    const t = setTimeout(() => { if (pinRef.current) pinRef.current.focus(); }, 150);
    return () => clearTimeout(t);
  }, [askPin]);
  const [title, setTitle] = useState('');
  const locked = !!site.lock;
  const what = (site.lock && site.lock.name) || (site.id === 'facebook' ? 'SubTo group' : discordServerName || 'SubTo server');
  const place = (site.lock && site.lock.name) || (site.id === 'facebook' ? 'the SubTo group' : discordServerName || 'the SubTo server');

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return undefined;
    const sync = () => {
      try {
        setUrl(wv.getURL());
        setNav({ back: wv.canGoBack(), fwd: wv.canGoForward() });
      } catch { /* not ready yet */ }
    };
    const on = {
      'did-start-loading': () => { setLoading(true); setFailed(null); },
      'did-stop-loading': () => { setLoading(false); sync(); },
      'did-navigate': sync,
      'did-navigate-in-page': sync,
      'page-title-updated': (e) => { setTitle(e.title); onUnread(site.id, e.title); },
      'did-fail-load': (e) => {
        if (e.isMainFrame && e.errorCode !== -3) setFailed(e.errorDescription || 'Page failed to load');
      },
    };
    Object.entries(on).forEach(([k, fn]) => wv.addEventListener(k, fn));
    return () => Object.entries(on).forEach(([k, fn]) => wv.removeEventListener(k, fn));
  }, [site.id]);

  const wv = () => ref.current;
  const go = (fn) => { try { fn(wv()); } catch { /* ignore */ } };
  const setZ = (z) => { const v = Math.max(-3, Math.min(3, z)); setZoom(v); go((w) => w.setZoomLevel(v)); };

  const setHome = async () => {
    try {
      await window.hub.sites.setHome(site.id, url);
      onSitesChanged();
      flash(`${site.label} will now open on this page.`);
    } catch (e) { flash(e.message); }
  };

  const lockHere = async () => {
    try {
      let t = title;
      try { t = ref.current.getTitle(); } catch { /* use last known title */ }
      let list;
      try {
        list = await window.hub.sites.lock(site.id, url, t);
      } catch (err) {
        if (err.message !== 'NO_NAME') throw err;
        if (!(await askConfirm(`The hub couldn't read this server's name. Are you in ${discordServerName}?`, 'Yes, lock it'))) return;
        list = await window.hub.sites.lock(site.id, url, discordServerName);
      }
      const me = list.find((x) => x.id === site.id);
      await onSitesChanged();
      go((w) => w.loadURL(me.lock.home));
      flash(`Locked. ${site.label} now stays inside ${place}.`);
    } catch (e) { flash(e.message); }
  };
  const permanent = !!(site.lock && site.lock.permanent);
  const suspended = site.suspended;
  const ask = (mode) => { setAskPin(mode); setPin(''); setPinErr(''); };
  const relock = async () => {
    const list = await window.hub.sites.relock(site.id);
    await onSitesChanged();
    const me = list.find((x) => x.id === site.id);
    go((w) => w.loadURL(me.lock ? me.lock.home : site.url));
    flash(`${site.label} is locked again.`);
  };
  const unlock = async (e) => {
    if (e) e.preventDefault();
    try {
      const hasPin = await window.hub.lock.hasPin();
      if ((hasPin || permanent) && askPin !== 'unlock') { ask('unlock'); return; }
      await window.hub.sites.unlock(site.id, pin);
      setAskPin(false);
      await onSitesChanged();
      go((w) => w.reload());
      flash(permanent ? `${site.label} is unlocked until you close the app.` : `${site.label} is unlocked.`);
    } catch (err) { setPinErr(err.message); }
  };
  const makePermanent = async (e) => {
    if (e) e.preventDefault();
    try {
      if (askPin !== 'permanent' && askPin !== 'newpin') {
        if (!(await askConfirm(`Make this lock permanent?\n\n${site.label} will always stay inside ${place}. Only your PIN can unlock it, and it locks again every time the app starts. Updates, reinstalling or restoring a backup won't remove it.`, 'Make permanent'))) return;
        ask((await window.hub.lock.hasPin()) ? 'permanent' : 'newpin');
        return;
      }
      if (askPin === 'newpin') await window.hub.lock.setPin('', pin);
      await window.hub.sites.makePermanent(site.id, pin);
      setAskPin(false);
      await onSitesChanged();
      flash(`${site.label} is now permanently locked to ${place}.`);
    } catch (err) { setPinErr(err.message); if (!askPin) flash(err.message); }
  };

  return (
    <div className="webtab" style={{ visibility: active ? 'visible' : 'hidden', zIndex: active ? 1 : 0 }}>
      <div className="webbar">
        <button className="tb" title="Back" disabled={!nav.back} onClick={() => go((w) => w.goBack())}>‹</button>
        <button className="tb" title="Forward" disabled={!nav.fwd} onClick={() => go((w) => w.goForward())}>›</button>
        <button className="tb" title="Reload" onClick={() => go((w) => w.reload())}>⟳</button>
        <button className="tb" title="Home page" onClick={() => go((w) => w.loadURL(site.url))}><Icon name="home" size={15} /></button>
        <div className="urlbox" title={url}>
          {loading && <span className="spinner" />}
          <span className="urltext">{url}</span>
        </div>
        <button className="tb" title="Smaller" onClick={() => setZ(zoom - 0.5)}>A−</button>
        <button className="tb" title="Bigger" onClick={() => setZ(zoom + 0.5)}>A+</button>
        {site.lockable && (permanent ? (
          <button className="tb text lock-on" title={`Permanently locked to ${place}. Your PIN unlocks it until the app closes.`} onClick={() => unlock()}>🔒 {what} · permanent · Unlock with PIN</button>
        ) : suspended ? (
          <button className="tb text unlocked" title="It locks again automatically the next time the app starts" onClick={relock}>🔓 Unlocked until you close the app · Lock again</button>
        ) : locked ? (
          <>
            <button className="tb text lock-on" title={`Only ${place} can be used in this tab`} onClick={() => unlock()}>🔒 Locked to {what} · Unlock</button>
            <button className="tb text" title="Lock this tab for good" onClick={() => makePermanent()}>Make permanent</button>
          </>
        ) : (
          <button className="tb text" title={`Keep this tab inside ${place}`} onClick={lockHere}>🔓 Lock to {site.id === 'facebook' ? 'this group' : what}</button>
        ))}
        {!locked && <button className="tb text" title="Always open this tab on the current page" onClick={setHome}>Set as home</button>}
        {!locked && <button className="tb text" title="Open this page in your normal browser" onClick={() => window.hub.app.openExternal(url)}>Open in browser</button>}
      </div>
      {askPin && (
        <form className="webhint pinbar" onSubmit={askPin === 'unlock' ? unlock : makePermanent}>
          <span>{askPin === 'newpin' ? 'Choose a PIN (4–8 digits). You\'ll need it to unlock:'
            : askPin === 'permanent' ? 'Enter your PIN to make the lock permanent:' : 'Enter your PIN to unlock:'}</span>
          <input ref={pinRef} type="password" inputMode="numeric" autoFocus value={pin} onMouseDown={() => setTimeout(() => pinRef.current && pinRef.current.focus(), 0)} onChange={(e) => setPin(e.target.value)} style={{ width: 120 }} />
          <button className="primary" type="submit">{askPin === 'unlock' ? 'Unlock' : 'Make permanent'}</button>
          <button type="button" onClick={() => setAskPin(false)}>Cancel</button>
          {pinErr && <span className="error">{pinErr}</span>}
        </form>
      )}
      {site.lockable && !locked && !suspended && (
        <div className="webhint">
          {site.id === 'facebook'
            ? 'To lock this tab: open the SubTo group, then click "Lock to this group".'
            : `To lock this tab: open any channel in ${discordServerName || 'the SubTo server'}, then click "Lock to this server".`}
        </div>
      )}
      {site.hint && !site.lockable && site.url === site.defaultUrl && <div className="webhint">{site.hint}</div>}
      {(site.google || /google/i.test(url)) && (
        <div className="webhint">
          Google won't let you sign in here?{' '}
          <button className="linkish" onClick={async () => {
            await window.hub.sites.setMode(site.id, 'window');
            onSitesChanged();
            openSiteWindow(site, flash);
          }}>Open {site.label} in a browser window instead</button>
        </div>
      )}
      <div className="webbody">
        <webview ref={ref} src={initialUrl} partition={site.partition} allowpopups="true" style={{ width: '100%', height: '100%' }} />
        {failed && (
          <div className="webfail">
            <h2>Couldn't load {site.label}</h2>
            <p className="muted">{failed}. Check your internet connection.</p>
            <button className="primary" onClick={() => go((w) => w.reload())}>Try again</button>
          </div>
        )}
      </div>
    </div>
  );
}
