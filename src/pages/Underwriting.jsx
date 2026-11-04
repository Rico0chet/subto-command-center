import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../Icon.jsx';
import { askConfirm } from '../confirm.jsx';
import { Drawer, dataChanged, openRecord, useOptions } from '../crm/shared.jsx';
import { analyze, whatIf, blankInput, PROPERTY_TYPES, STRATEGIES, strategiesFor, groupOf, show, fmt } from '../calc/underwrite.mjs';
import { summaryHtml } from '../calc/summary.mjs';
import { buildPrefill } from '../calc/prefill.mjs';
import { valueCheck } from '../calc/valuation.mjs';

const MULTI = new Set(['mf', 'commercial', 'mhp', 'smf']);
const STRAT_TO_DEAL = { subto: 'Subject-To', seller: 'Seller Finance', hybrid: 'Hybrid', wrap: 'Wrap', novation: 'Novation', wholesale: 'Wholesale', cash: 'Cash', brrrr: 'BRRRR' };
const TYPE_TO_DEAL = { sf: 'Single family', smf: 'Multifamily 2-4', mf: 'Multifamily 5+', commercial: 'Commercial', str: 'Short-term rental', land: 'Land', mobile: 'Mobile home', mhp: 'Commercial', business: 'Business' };
const DEAL_TO_TYPE = Object.fromEntries(Object.entries(TYPE_TO_DEAL).filter(([k]) => k !== 'mhp').map(([k, v]) => [v, k]));
const DEAL_TO_STRAT = Object.fromEntries(Object.entries(STRAT_TO_DEAL).map(([k, v]) => [v, k]));

export function inputFromDeal(d) {
  const type = DEAL_TO_TYPE[d.property_type] || 'sf';
  const strategy = DEAL_TO_STRAT[d.strategy] || 'subto';
  const v = (x) => (x == null ? '' : String(x));
  return {
    ...blankInput(type, strategy), name: d.title || d.address, address: [d.address, d.city, d.state, d.zip].filter(Boolean).join(', '),
    price: v(d.asking_price), arv: v(d.arv), st_balance: v(d.loan_balance), st_rate: v(d.interest_rate),
    rents: [{ label: 'Unit 1', rent: v(d.rent), count: '1' }],
  };
}

const newDoc = (input) => ({ id: null, name: input ? input.name : '', address: input ? input.address : '', dealId: null, scenarios: [{ name: 'Scenario A', input: input || blankInput() }], current: 0 });

export default function Underwriting({ flash, focus, clearFocus }) {
  const [doc, setDoc] = useState(() => newDoc());
  const [dirty, setDirty] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [deals, setDeals] = useState([]);
  const [tip, setTip] = useState(null);
  const [view, setView] = useState('results'); // results | whatif | compare

  const loadDeals = async () => setDeals(await window.hub.crm.listDeals({ includeDead: true }));
  useEffect(() => { loadDeals(); }, []);

  // Opened from a deal or a saved analysis elsewhere in the hub.
  useEffect(() => {
    if (!focus) return;
    (async () => {
      try {
        if (focus.type === 'analysis') await openSaved(focus.id);
        else if (focus.type === 'uwDeal') {
          const d = await window.hub.crm.getDeal(focus.id);
          const existing = await window.hub.uw.list({ dealId: d.id });
          if (existing.length) await openSaved(existing[0].id);
          else { setDoc({ ...newDoc(inputFromDeal(d)), dealId: d.id, name: d.title }); setDirty(true); setTimeout(() => window.dispatchEvent(new CustomEvent('uw-prefill', { detail: { ref: { kind: 'deal', id: d.id } } })), 0); }
        } else if (focus.type === 'uwLead') {
          setDoc(newDoc()); setDirty(true);
          setTimeout(() => window.dispatchEvent(new CustomEvent('uw-prefill', { detail: { ref: { kind: 'lead', id: focus.id } } })), 0);
        } else if (focus.type === 'uwPrefill') {
          setTimeout(() => window.dispatchEvent(new CustomEvent('uw-prefill', { detail: { address: focus.address, listing: focus.listing, fetch: false } })), 0);
        }
      } catch (e) { flash(e.message); }
      clearFocus();
    })();
  }, [focus]);

  const prefillRef = React.useRef(null);
  useEffect(() => {
    const h = (e) => prefillRef.current && prefillRef.current(e.detail);
    window.addEventListener('uw-prefill', h);
    return () => window.removeEventListener('uw-prefill', h);
  }, []);
  const sc = doc.scenarios[doc.current] || doc.scenarios[0];
  const input = sc.input;
  const result = useMemo(() => analyze(input), [input]);
  const assumedMap = useMemo(() => Object.fromEntries(result.assumed.map((a) => [a.key, a.value])), [result]);
  const missingKeys = useMemo(() => new Set(result.missing.map((m) => m.key)), [result]);

  // Typing over a filled-in field drops its "From …" tag; picking a structure yourself stops the suggestion from overriding it.
  const setInput = (patch, auto = false) => {
    setDoc((d) => ({ ...d, scenarios: d.scenarios.map((s, i) => {
      if (i !== d.current) return s;
      const next = { ...s.input, ...patch };
      if (!auto) {
        const src = { ...(s.input._src || {}) };
        for (const k of Object.keys(patch)) delete src[k];
        next._src = src;
        if ('strategy' in patch) next._strategyTouched = true;
      }
      return { ...s, input: next };
    }) }));
    setDirty(true);
  };
  const [filling, setFilling] = useState('');
  useEffect(() => { prefillRef.current = (d) => prefill(d); });
  // Fill from what the hub already has (lead list row / deal), then read Zillow or Redfin for the rest.
  const prefill = async ({ ref = null, address = '', listing = null, fetch = true } = {}) => {
    let data = { lead: null, deal: null };
    try {
      if (ref) data = await window.hub.uw.prefillData(ref);
      let cur = address ? { ...input, address, name: input.name && input.name !== input.address ? input.name : address } : input;
      if (address) setInput({ address: cur.address, name: cur.name }, true);
      const apply = (lst) => {
        const r = buildPrefill({ lead: data.lead, deal: data.deal, listing: lst, current: cur });
        const patch = { ...r.patch, _src: { ...(cur._src || {}), ...r.sources }, _facts: r.facts, _suggest: r.suggestions, _freeClear: r.freeAndClear };
        if (!r.patch.address && address && !cur.address) { patch.address = address; patch.name = cur.name || address; }
        cur = { ...cur, ...patch };
        setInput(patch, true);
        return r;
      };
      const first = apply(listing);
      if (data.deal) setDoc((d) => ({ ...d, dealId: d.dealId || data.deal.id, name: d.name || cur.address, address: d.address || cur.address }));
      else setDoc((d) => ({ ...d, name: d.name || cur.address, address: d.address || cur.address }));
      const filled = Object.keys(first.sources).filter((k) => k !== 'strategy' && k !== 'type').length;
      if (ref) flash(`Filled ${filled} field${filled === 1 ? '' : 's'} from your ${data.deal ? 'deal' : 'lead list'}.${fetch ? ' Reading Zillow/Redfin…' : ''}`);
      if (!listing && fetch && (cur.address || address)) {
        setFilling('Reading Zillow/Redfin…');
        try {
          const lst = await window.hub.uw.fetchListing(cur.address || address);
          const r = apply(lst);
          const n = Object.keys(r.sources).filter((k) => r.sources[k].startsWith('Zillow')).length;
          flash(n ? `Added ${n} more from ${lst.site || 'the listing'}.` : `Read ${lst.site || 'the listing'}; nothing new to fill.`);
        } catch (e) { flash(e.message); }
        setFilling('');
      }
    } catch (e) { flash(e.message); setFilling(''); }
  };
  const setDocField = (patch) => { setDoc((d) => ({ ...d, ...patch })); setDirty(true); };

  const openSaved = async (id) => {
    const a = await window.hub.uw.get(id);
    if (!a) return;
    const data = a.data || {};
    setDoc({ id: a.id, name: a.name, address: a.address, dealId: a.deal_id, scenarios: data.scenarios && data.scenarios.length ? data.scenarios : [{ name: 'Scenario A', input: blankInput() }], current: data.current || 0 });
    setDirty(false); setShowSaved(false);
  };
  const confirmLeave = async () => !dirty || (await askConfirm('You have unsaved changes. Discard them?', 'Discard'));

  const save = async (asCopy = false) => {
    const name = doc.name || input.address || input.name || 'Untitled analysis';
    const r = analyze(input);
    const a = await window.hub.uw.save({
      id: asCopy ? null : doc.id, name: asCopy ? `${name} (copy)` : name, address: doc.address || input.address, dealId: doc.dealId,
      data: { scenarios: doc.scenarios, current: doc.current },
      summary: { ...r.summary, strategy: r.strategy, type: r.type, flags: r.flags.filter((f) => f.level === 'bad').length },
    });
    setDoc((d) => ({ ...d, id: a.id, name: a.name })); setDirty(false);
    dataChanged();
    flash(asCopy ? 'Saved a copy.' : 'Analysis saved.');
  };

  const makeDeal = async () => {
    const addr = doc.address || input.address;
    if (!addr) { flash('Add the property address first.'); return; }
    const parts = addr.split(',').map((x) => x.trim());
    const s = result.summary;
    const d = await window.hub.crm.saveDeal({
      address: parts[0], city: parts[1] || '', state: (parts[2] || '').split(' ')[0] || '', zip: ((parts[2] || '').match(/\d{5}/) || [''])[0],
      property_type: TYPE_TO_DEAL[input.type] || 'Other', strategy: STRAT_TO_DEAL[input.strategy] || 'Other',
      asking_price: s.price ?? input.price, arv: input.arv, loan_balance: input.st_balance, interest_rate: input.st_rate,
      rent: result.metrics.find((m) => m.id === 'gpi') ? Math.round(result.metrics.find((m) => m.id === 'gpi').value) : '',
      entry_fee: result.metrics.find((m) => m.id === 'entry') ? Math.round(result.metrics.find((m) => m.id === 'entry').value) : '', source: 'Underwriting',
    });
    setDocField({ dealId: d.id });
    await loadDeals();
    flash(`Deal created: ${d.title}. Save the analysis to keep the link.`);
  };

  const pdf = async () => {
    try {
      const team = doc.dealId ? await window.hub.crm.team(doc.dealId).catch(() => null) : null;
      const html = summaryHtml({ name: doc.name || input.address || 'Underwriting', address: doc.address || input.address, input, result, whatIf: whatIf(input), team,
        typeLabel: (PROPERTY_TYPES.find((t) => t.id === result.type) || {}).label, stratLabel: (STRATEGIES.find((t) => t.id === result.strategy) || {}).label });
      const out = await window.hub.uw.pdf(html, doc.name || input.address || 'Underwriting');
      if (out) flash('Summary saved as PDF.');
    } catch (e) { flash(e.message); }
  };

  const addScenario = () => {
    setDoc((d) => {
      const letter = String.fromCharCode(65 + d.scenarios.length);
      const copy = JSON.parse(JSON.stringify(d.scenarios[d.current].input));
      return { ...d, scenarios: [...d.scenarios, { name: `Scenario ${letter}`, input: copy }], current: d.scenarios.length };
    });
    setDirty(true);
  };
  const removeScenario = async (i) => {
    if (doc.scenarios.length < 2) return;
    if (!(await askConfirm(`Remove ${doc.scenarios[i].name}?`, 'Remove'))) return;
    setDoc((d) => ({ ...d, scenarios: d.scenarios.filter((_, j) => j !== i), current: 0 }));
    setDirty(true);
  };
  const renameScenario = (i, name) => { setDoc((d) => ({ ...d, scenarios: d.scenarios.map((s, j) => (j === i ? { ...s, name } : s)) })); setDirty(true); };

  const type = input.type;
  const group = groupOf(type);
  const strategy = result.strategy;
  const strats = strategiesFor(type);
  const P = { inp: input, set: setInput, assumedMap, missingKeys };

  return (
    <div className="page page-wide uw">
      <header className="page-head">
        <div>
          <h1><Icon name="calc" size={24} /> Underwriting</h1>
          <input className="uw-name" value={doc.name} onChange={(e) => setDocField({ name: e.target.value })} placeholder="Name this analysis (e.g. 123 Main St – Subject-To)" />
        </div>
        <div className="row wrap">
          <button onClick={async () => { if (await confirmLeave()) { setDoc(newDoc()); setDirty(false); } }}>New</button>
          <button onClick={() => setShowSaved(true)}>Open saved…</button>
          <button onClick={() => save(false)} className={dirty ? 'primary' : ''}>{dirty ? 'Save' : 'Saved'}</button>
          {doc.id && <button onClick={() => save(true)}>Save a copy</button>}
          <button onClick={pdf}>PDF summary</button>
        </div>
      </header>

      <div className="uw-deal row wrap">
        <span className="muted small">Deal:</span>
        <select className="sel" value={doc.dealId || ''} onChange={(e) => setDocField({ dealId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Not linked to a deal</option>
          {deals.map((d) => <option key={d.id} value={d.id}>{d.title} · {d.stage}</option>)}
        </select>
        {doc.dealId ? <button className="mini" onClick={() => openRecord('deal', doc.dealId)}>Open deal</button> : <button className="mini" onClick={makeDeal}>Create a deal from this</button>}
        {(input.address || doc.address) && <button className="mini" onClick={() => window.dispatchEvent(new CustomEvent('hub-lookup', { detail: input.address || doc.address }))}>Look up property</button>}
      </div>

      <div className="uw-scen row wrap">
        {doc.scenarios.map((s, i) => (
          <div key={i} className={`scen-tab ${i === doc.current ? 'on' : ''}`} onClick={() => setDoc((d) => ({ ...d, current: i }))}>
            {i === doc.current ? <input value={s.name} onChange={(e) => renameScenario(i, e.target.value)} onClick={(e) => e.stopPropagation()} /> : <span>{s.name}</span>}
            <span className="muted small"> · {(STRATEGIES.find((x) => x.id === s.input.strategy) || {}).label}</span>
            {doc.scenarios.length > 1 && <button className="x" title="Remove scenario" onClick={(e) => { e.stopPropagation(); removeScenario(i); }}>✕</button>}
          </div>
        ))}
        <button className="mini" onClick={addScenario} title="Copies this scenario so you can try another structure on the same property">+ Compare another structure</button>
      </div>

      <div className="uw-grid">
        {/* ---------------- INPUTS ---------------- */}
        <div className="uw-inputs">
          <section className="card">
            <h3>Property</h3>
            <div className="uw-row">
              <label className="uwf wide"><span>Property type</span>
                <select className="sel" value={type} onChange={(e) => {
                  const t = e.target.value;
                  const allowed = strategiesFor(t).map((x) => x.id);
                  setInput({ type: t, strategy: allowed.includes(input.strategy) ? input.strategy : allowed[0] });
                }}>{PROPERTY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
              </label>
            </div>
            {(input._facts || []).length > 0 && <Facts facts={input._facts} src={input._src || {}} />}
            {(input._suggest || []).length > 0 && <Suggest list={input._suggest} current={strategy} pick={(id) => setInput({ strategy: id })} compare={() => {
              setDoc((d) => {
                const base = d.scenarios[d.current].input;
                const have = new Set(d.scenarios.map((x) => x.input.strategy));
                const add = (base._suggest || []).filter((x) => !have.has(x.id)).map((x) => ({ name: x.label, input: { ...JSON.parse(JSON.stringify(base)), strategy: x.id, _strategyTouched: true } }));
                return { ...d, scenarios: [...d.scenarios, ...add] };
              });
              setView('compare'); setDirty(true);
            }} />}
            <div className="strat-pills">
              {strats.map((s) => <button key={s.id} className={`pill ${strategy === s.id ? 'on' : ''}`} title={s.hint} onClick={() => setInput({ strategy: s.id })}>{s.label}</button>)}
            </div>
            <p className="muted small" style={{ margin: '6px 0 10px' }}>{(STRATEGIES.find((s) => s.id === strategy) || {}).hint}</p>
            <div className="uw-row">
              <AddressPicker value={input.address} onType={(v) => { setInput({ address: v }); if (!doc.address || doc.address === input.address) setDocField({ address: v }); }}
                onPick={(r) => { setInput({ address: r.address }); prefill({ ref: { kind: r.kind, id: r.id }, address: r.address }); }}
                onFetch={() => prefill({ address: input.address })} filling={filling} />
              {(group === 'rental' && (MULTI.has(type))) && <Num k="units" label={type === 'mhp' ? 'Lots' : 'Units'} {...P} hint="Leave blank to count from the rent table." />}
              {group !== 'business' && group !== 'land' && <Num k="sqft" label="Square feet" {...P} />}
              {group === 'land' && <Num k="acres" label="Acres" {...P} />}
              {!['subto', 'wrap'].includes(strategy) && <Num k="price" label={group === 'business' ? 'Asking / purchase price' : 'Purchase price'} unit="$" {...P} />}
              {group !== 'business' && group !== 'land' && <Num k="arv" label={['flip', 'brrrr', 'wholesale', 'novation'].includes(strategy) ? 'After-repair value (ARV)' : 'Value (as-is or ARV)'} unit="$" {...P} hint="Used for equity, refinance and max-offer math. Blank = purchase price." />}
              {group !== 'business' && group !== 'land' && <Num k="rehab" label="Rehab / repairs" unit="$" {...P} />}
              <Num k="closing" label="Closing costs" unit="$" {...P} />
            </div>
          </section>

          {group !== 'business' && group !== 'land' && <ValueCheck input={input} set={setInput} P={P} />}

          {group === 'rental' && strategy !== 'wholesale' && (
            <section className="card">
              <h3>Income</h3>
              <RentTable inp={input} set={setInput} type={type} missing={missingKeys.has('rents')} />
              {input._src && input._src.rents && <em className="src">Rent from {input._src.rents}</em>}
              <div className="uw-row"><Num k="otherIncome" label="Other income / month" unit="$" {...P} hint="Laundry, parking, pet, storage, RUBS…" /></div>
            </section>
          )}

          {group === 'str' && (
            <section className="card">
              <h3>Short-term rental income</h3>
              <div className="uw-row">
                <Num k="str_adr" label="Average nightly rate" unit="$" {...P} />
                <Num k="str_occ" label="Occupancy" unit="%" {...P} />
                <Num k="str_stayNights" label="Average stay (nights)" {...P} />
                <Num k="str_cleanFee" label="Cleaning fee you charge" unit="$" {...P} />
              </div>
              <h4>Revenue estimates from STR sites (per year)</h4>
              <p className="muted small">Copy each site's annual revenue estimate (AirDNA, Rabbu, AirROI, Awning, Chalet…). The calculator shows low / average / high.</p>
              {(input.str_estimates || []).map((e, i) => (
                <div className="uw-row" key={i}>
                  <label className="uwf"><span>Site</span><input value={e.source} onChange={(ev) => setInput({ str_estimates: input.str_estimates.map((x, j) => (j === i ? { ...x, source: ev.target.value } : x)) })} /></label>
                  <label className="uwf"><span>Annual revenue</span><input inputMode="decimal" value={e.revenue} onChange={(ev) => setInput({ str_estimates: input.str_estimates.map((x, j) => (j === i ? { ...x, revenue: ev.target.value } : x)) })} placeholder="$" /></label>
                  <button className="mini" onClick={() => setInput({ str_estimates: input.str_estimates.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              ))}
              <button className="mini" onClick={() => setInput({ str_estimates: [...(input.str_estimates || []), { source: '', revenue: '' }] })}>+ Add a site</button>
              <div className="uw-row" style={{ marginTop: 10 }}>
                <label className="uwf wide"><span>Revenue to use</span>
                  <select className="sel" value={input.str_use} onChange={(e) => setInput({ str_use: e.target.value })}>
                    <option value="calc">My nightly rate × occupancy</option>
                    <option value="low">Lowest site estimate</option>
                    <option value="avg">Average of site estimates</option>
                    <option value="high">Highest site estimate</option>
                  </select>
                </label>
                <Num k="str_ltrRent" label="Long-term rent (to compare)" unit="$" {...P} />
                <Num k="str_furnish" label="Furnishing & setup" unit="$" {...P} />
              </div>
              <label className="remember"><input type="checkbox" checked={!!input.str_allowed} onChange={(e) => setInput({ str_allowed: e.target.checked })} /> I confirmed short-term rentals are allowed here (city, permit, HOA)</label>
            </section>
          )}

          {group === 'business' && (
            <section className="card">
              <h3>Business earnings (yearly)</h3>
              <div className="uw-row">
                <Num k="biz_revenue" label="Revenue" unit="$" {...P} />
                <Num k="biz_netProfit" label="Net profit" unit="$" {...P} hint="From the tax return or P&L." />
                <Num k="biz_ownerSalary" label="Owner's salary" unit="$" {...P} />
                <Num k="biz_addbacks" label="Other add-backs" unit="$" {...P} hint="Owner perks, one-time costs." />
                <Num k="biz_interest" label="Interest expense" unit="$" {...P} />
                <Num k="biz_depr" label="Depreciation & amortization" unit="$" {...P} />
                <Num k="biz_taxes" label="Income taxes" unit="$" {...P} />
                <Num k="biz_multiple" label="Fair multiple (x SDE)" {...P} />
                <Num k="biz_newSalary" label="Salary you'll take (or a manager)" unit="$" {...P} />
              </div>
            </section>
          )}

          {(group === 'rental' || group === 'str' || group === 'land') && !['wholesale'].includes(strategy) && (
            <section className="card">
              <h3>Expenses</h3>
              <div className="uw-row">
                <Num k="taxesYr" label="Property taxes / year" unit="$" {...P} />
                <Num k="taxesPct" label="…or tax rate (% of price)" unit="%" {...P} hint="Use this when taxes reset to the purchase price." />
                {group !== 'land' && <Num k="insuranceYr" label="Insurance / year" unit="$" {...P} />}
                {group !== 'land' && <Num k="hoaMo" label={type === 'mobile' ? 'HOA / lot rent / month' : 'HOA / month'} unit="$" {...P} />}
                {group === 'rental' && <Num k="utilitiesMo" label="Owner-paid utilities / month" unit="$" {...P} />}
                {group !== 'land' && <Num k="otherExpMo" label="Other expenses / month" unit="$" {...P} />}
              </div>
              {group === 'rental' && (
                <div className="uw-row">
                  <Num k="vacancyPct" label="Vacancy" unit="%" {...P} />
                  <Num k="repairsPct" label="Repairs" unit="%" {...P} />
                  <Num k="capexPct" label="CapEx" unit="%" {...P} />
                  <Num k="mgmtPct" label="Management" unit="%" {...P} />
                  {MULTI.has(type) && type !== 'smf' && <Num k="reservesUnit" label="Reserves / unit / year" unit="$" {...P} />}
                </div>
              )}
              {group === 'str' && (
                <div className="uw-row">
                  <Num k="str_platformPct" label="Platform fee" unit="%" {...P} />
                  <Num k="str_cleanCost" label="Cleaning cost / stay" unit="$" {...P} />
                  <Num k="str_suppliesPct" label="Supplies" unit="%" {...P} />
                  <Num k="str_mgmtPct" label="STR management" unit="%" {...P} />
                  <Num k="str_utilMo" label="Utilities & internet / month" unit="$" {...P} />
                  <Num k="repairsPct" label="Repairs" unit="%" {...P} />
                  <Num k="capexPct" label="CapEx & furniture" unit="%" {...P} />
                </div>
              )}
            </section>
          )}

          <Financing strategy={strategy} group={group} P={P} input={input} />

          <section className="card">
            <h3>Your targets</h3>
            <p className="muted small">Used for the pass/fail checks and the max offer.</p>
            <div className="uw-row">
              {group !== 'business' && <Num k="tgt_cf" label={MULTI.has(type) ? 'Min cash flow / door / month' : 'Min cash flow / month'} unit="$" {...P} ph="200" />}
              <Num k="tgt_coc" label="Min cash-on-cash" unit="%" {...P} ph="10" />
              <Num k="tgt_dscr" label="Min DSCR" {...P} ph="1.2" />
              {group === 'rental' && <Num k="tgt_cap" label="Min cap rate (optional)" unit="%" {...P} />}
              <Num k="jv_split" label="Your JV split (optional)" unit="%" {...P} />
            </div>
            <label className="uwf wide"><span>Notes</span><textarea rows={3} value={input.notes} onChange={(e) => setInput({ notes: e.target.value })} /></label>
          </section>
        </div>

        {/* ---------------- RESULTS ---------------- */}
        <div className="uw-results">
          <SummaryCards result={result} />
          <Flags flags={result.flags} />
          <div className="tabs-mini">
            {[['results', 'Results'], ['whatif', 'What-if'], ['compare', `Compare (${doc.scenarios.length})`]].map(([k, l]) => (
              <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>
            ))}
          </div>
          {view === 'results' && <Results result={result} tip={tip} setTip={setTip} />}
          {view === 'whatif' && <WhatIf input={input} />}
          {view === 'compare' && <Compare scenarios={doc.scenarios} current={doc.current} pick={(i) => setDoc((d) => ({ ...d, current: i }))} add={addScenario} />}
          <p className="muted small disclaimer">Results are only as good as the inputs. Confirm loan balances with a mortgage statement or payoff letter. This is a decision tool, not financial, legal or tax advice.</p>
        </div>
      </div>

      {showSaved && <SavedList onClose={() => setShowSaved(false)} open={async (id) => { if (await confirmLeave()) await openSaved(id); }} flash={flash} currentId={doc.id} onDeleted={(id) => { if (id === doc.id) setDoc((d) => ({ ...d, id: null })); }} />}
    </div>
  );
}

// ---------- inputs ----------
function Num({ k, label, unit, inp, set, assumedMap, missingKeys, hint, ph, wide }) {
  const def = assumedMap[k];
  const miss = missingKeys.has(k);
  return (
    <label className={`uwf ${wide ? 'wide' : ''} ${miss ? 'miss' : ''}`} title={hint || ''}>
      <span>{label}{unit === '%' ? ' (%)' : ''}</span>
      <div className="uw-in">
        {unit === '$' && <i>$</i>}
        <input inputMode="decimal" value={inp[k] ?? ''} onChange={(e) => set({ [k]: e.target.value })} placeholder={def ? `Default ${def}` : ph ? `Default ${ph}` : miss ? 'Needed' : ''} />
      </div>
      {def && <em className="def">Using default {def}</em>}
      {!def && inp._src && inp._src[k] && <em className="src">From {inp._src[k]}</em>}
    </label>
  );
}

function AddressPicker({ value, onType, onPick, onFetch, filling }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!open || !q || q.length < 2) { setRows([]); return undefined; }
    let live = true;
    const t = setTimeout(() => window.hub.uw.addressSearch(q).then((r) => live && setRows(r)).catch(() => {}), 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);
  return (
    <div className="uwf wide addr-pick">
      <span>Address <span className="muted">— pick one from your lead lists or deals and the hub fills in what it knows</span></span>
      <div className="row" style={{ gap: 6 }}>
        <input value={value ?? ''} placeholder="Start typing: 602 E Texas…" onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)}
          onChange={(e) => { onType(e.target.value); setQ(e.target.value); setOpen(true); }} style={{ flex: 1 }} />
        <button className="mini" disabled={!value || !!filling} onClick={onFetch} title="Reads the Zillow (or Redfin) page for this address">{filling || 'Fill from Zillow/Redfin'}</button>
        {value && <button className="mini" onClick={() => window.dispatchEvent(new CustomEvent('hub-lookup', { detail: value }))}>Look up</button>}
      </div>
      {open && rows.length > 0 && (
        <div className="picker-box addr-list">
          {rows.map((r) => (
            <button key={`${r.kind}${r.id}`} className="pk-row" onMouseDown={(e) => { e.preventDefault(); setOpen(false); onPick(r); }}>
              <b>{r.address}</b><span className="muted small">{r.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Facts({ facts }) {
  return (
    <div className="facts-box">
      <div className="muted small" style={{ marginBottom: 4 }}>What the hub found</div>
      <div className="facts-grid">{facts.map(([k, v], i) => <div key={i}><span className="muted small">{k}</span><b>{String(v)}</b></div>)}</div>
    </div>
  );
}

function Suggest({ list, current, pick, compare }) {
  return (
    <div className="suggest-box">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted small">Structures that fit this property (best first)</span>
        <button className="mini" onClick={compare}>Compare all {list.length}</button>
      </div>
      {list.map((x, i) => (
        <div key={x.id} className={`sg-row ${current === x.id ? 'on' : ''}`} onClick={() => pick(x.id)}>
          <b>{i + 1}. {x.label}</b> <span className="small">{x.why}</span>
          <div className="muted small">You'll need: {x.needs}</div>
        </div>
      ))}
    </div>
  );
}
function Text({ k, label, inp, set, wide, onChange }) {
  return <label className={`uwf ${wide ? 'wide' : ''}`}><span>{label}</span><input value={inp[k] ?? ''} onChange={(e) => (onChange ? onChange(e.target.value) : set({ [k]: e.target.value }))} /></label>;
}

function RentTable({ inp, set, type, missing }) {
  const rows = inp.rents || [];
  const upd = (i, k, v) => set({ rents: rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) });
  const multi = type !== 'sf' && type !== 'mobile';
  return (
    <div className={`rent-table ${missing ? 'miss' : ''}`}>
      <div className="rt-head"><span>{multi ? 'Unit type' : 'Unit'}</span><span>Rent / month</span>{multi && <span>How many</span>}<span /></div>
      {rows.map((r, i) => (
        <div className="rt-row" key={i}>
          <input value={r.label} onChange={(e) => upd(i, 'label', e.target.value)} />
          <div className="uw-in"><i>$</i><input inputMode="decimal" value={r.rent} onChange={(e) => upd(i, 'rent', e.target.value)} placeholder={missing ? 'Needed' : ''} /></div>
          {multi && <input inputMode="numeric" value={r.count} onChange={(e) => upd(i, 'count', e.target.value)} />}
          {rows.length > 1 ? <button className="mini" onClick={() => set({ rents: rows.filter((_, j) => j !== i) })}>✕</button> : <span />}
        </div>
      ))}
      {multi && <button className="mini" onClick={() => set({ rents: [...rows, { label: `Type ${rows.length + 1}`, rent: '', count: '1' }] })}>+ Add a unit type</button>}
    </div>
  );
}

function Financing({ strategy, group, P, input }) {
  const subtoFields = (withCash) => (
    <>
      <h4>Seller's existing loan</h4>
      <div className="uw-row">
        <Num k="st_balance" label="Loan balance" unit="$" {...P} />
        <Num k="st_rate" label="Interest rate" unit="%" {...P} />
        <Num k="st_monthsLeft" label="Months left on the loan" {...P} hint="From the mortgage statement (maturity date)." />
        <Num k="st_pi" label="…or monthly P&I" unit="$" {...P} hint="Principal + interest only (not taxes/insurance). If you enter this, months left is worked out." />
        <Num k="st_arrears" label="Back payments owed" unit="$" {...P} />
        {withCash && <Num k="st_cashToSeller" label="Cash to seller" unit="$" {...P} />}
      </div>
      <p className="muted small">Enter taxes and insurance under Expenses; the escrow part of the payment is not counted twice.</p>
    </>
  );
  const sellerFields = (label) => (
    <>
      <h4>{label}</h4>
      <div className="uw-row">
        <Num k="sf_down" label="Down payment to seller" unit="$" {...P} />
        <Num k="sf_rate" label="Interest rate" unit="%" {...P} />
        <Num k="sf_years" label="Amortization (years)" {...P} />
        <Num k="sf_balloon" label="Balloon in (years, optional)" {...P} />
      </div>
      <label className="remember"><input type="checkbox" checked={!!input.sf_io} onChange={(e) => P.set({ sf_io: e.target.checked })} /> Interest-only payments</label>
    </>
  );
  const hard = (
    <>
      <h4>Hard money</h4>
      <div className="uw-row">
        <Num k="hm_pctPrice" label="% of price financed" unit="%" {...P} />
        <Num k="hm_pctRehab" label="% of rehab financed" unit="%" {...P} />
        <Num k="hm_rate" label="Rate (interest-only)" unit="%" {...P} />
        <Num k="hm_points" label="Points" unit="%" {...P} />
      </div>
    </>
  );
  let body = null;
  if (strategy === 'cash') body = <p className="muted small">No loan. Cash needed = price + closing + rehab.</p>;
  else if (strategy === 'conventional' || strategy === 'dscr') body = (
    <div className="uw-row">
      <Num k="loan_ltv" label="Loan-to-value" unit="%" {...P} />
      <Num k="loan_rate" label="Interest rate" unit="%" {...P} />
      <Num k="loan_years" label="Term (years)" {...P} />
      <Num k="loan_points" label="Points" unit="%" {...P} />
    </div>
  );
  else if (strategy === 'hard') body = hard;
  else if (strategy === 'subto') body = subtoFields(true);
  else if (strategy === 'seller') body = sellerFields('Seller note');
  else if (strategy === 'hybrid') body = <>{subtoFields(false)}{sellerFields('Seller carry on their equity (2nd note)')}<p className="muted small">The 2nd note = price − down payment − existing loan − back payments.</p></>;
  else if (strategy === 'wrap') body = (
    <>
      {subtoFields(true)}
      <h4>Wrap you sell to your buyer</h4>
      <div className="uw-row">
        <Num k="wr_price" label="Wrap sale price" unit="$" {...P} />
        <Num k="wr_down" label="Buyer's down payment" unit="$" {...P} />
        <Num k="wr_rate" label="Wrap interest rate" unit="%" {...P} />
        <Num k="wr_years" label="Amortization (years)" {...P} />
        <Num k="wr_balloon" label="Balloon in (years, optional)" {...P} />
      </div>
    </>
  );
  else if (strategy === 'brrrr') body = (
    <>
      <div className="uw-row">
        <label className="uwf"><span>Buy and rehab with</span><select className="sel" value={input.br_buyWith} onChange={(e) => P.set({ br_buyWith: e.target.value })}><option value="hard">Hard money</option><option value="cash">Cash</option></select></label>
        <Num k="br_months" label="Months until refinance" {...P} />
      </div>
      {input.br_buyWith !== 'cash' && hard}
      <h4>Refinance</h4>
      <div className="uw-row">
        <Num k="br_refiLtv" label="LTV of ARV" unit="%" {...P} />
        <Num k="br_refiRate" label="Rate" unit="%" {...P} />
        <Num k="br_refiYears" label="Term (years)" {...P} />
        <Num k="br_refiCostsPct" label="Refi costs (% of loan)" unit="%" {...P} />
      </div>
    </>
  );
  else if (strategy === 'flip') body = (
    <>
      <div className="uw-row">
        <label className="uwf"><span>Buy and rehab with</span><select className="sel" value={input.fl_buyWith} onChange={(e) => P.set({ fl_buyWith: e.target.value })}><option value="hard">Hard money</option><option value="cash">Cash</option></select></label>
        <Num k="fl_months" label="Months to rehab & sell" {...P} />
        <Num k="fl_holdMo" label="Holding costs / month" unit="$" {...P} hint="Blank = taxes + insurance + HOA + $150 utilities." />
        <Num k="fl_sellPct" label="Selling costs" unit="%" {...P} />
        <Num k="rule_pct" label="Max-offer rule (% of ARV)" unit="%" {...P} />
      </div>
      {input.fl_buyWith !== 'cash' && hard}
    </>
  );
  else if (strategy === 'wholesale') body = (
    <div className="uw-row">
      <Num k="rule_pct" label="Buyer's rule (% of ARV)" unit="%" {...P} />
      <Num k="ws_fee" label="Your assignment fee" unit="$" {...P} />
    </div>
  );
  else if (strategy === 'novation') body = (
    <div className="uw-row">
      <Num k="nv_sellerNet" label="Seller's net (what they walk away with)" unit="$" {...P} />
      <Num k="nv_agentPct" label="Agent commissions" unit="%" {...P} />
      <Num k="nv_sellPct" label="Seller closing costs" unit="%" {...P} />
      <Num k="nv_months" label="Months to sell" {...P} />
      <Num k="nv_holdMo" label="Holding costs / month you pay" unit="$" {...P} />
    </div>
  );
  else if (strategy === 'sba') body = (
    <>
      <div className="uw-row">
        <Num k="sba_downPct" label="Down payment" unit="%" {...P} />
        <Num k="sba_rate" label="SBA rate" unit="%" {...P} />
        <Num k="sba_years" label="SBA term (years)" {...P} />
      </div>
      <div className="uw-row">
        <Num k="sn_pct" label="Seller note (% of price)" unit="%" {...P} />
        <Num k="sn_rate" label="Seller note rate" unit="%" {...P} />
        <Num k="sn_years" label="Seller note term (years)" {...P} />
      </div>
    </>
  );
  return (
    <section className="card">
      <h3>Financing: {(STRATEGIES.find((s) => s.id === strategy) || {}).label}</h3>
      {body}
      {group === 'land' && strategy !== 'wholesale' && (
        <>
          <h4>Sell it on terms (optional)</h4>
          <div className="uw-row">
            <Num k="land_sellPrice" label="Resale price" unit="$" {...P} />
            <Num k="land_down" label="Buyer's down payment" unit="$" {...P} />
            <Num k="land_rate" label="Note rate you charge" unit="%" {...P} />
            <Num k="land_months" label="Note term (months)" {...P} />
            <Num k="land_sellCosts" label="Selling / note setup costs" unit="$" {...P} />
          </div>
        </>
      )}
    </section>
  );
}

// ---------- results ----------
function SummaryCards({ result }) {
  const s = result.summary;
  const m = (id) => result.metrics.find((x) => x.id === id);
  const cards = [];
  if (['flip', 'wholesale', 'novation'].includes(result.strategy) || (result.group === 'land' && s.profit != null)) {
    cards.push(['Profit', show(s.profit, 'money'), s.profit < 0 ? 'neg' : 'pos']);
    if (s.cashIn != null) cards.push(['Cash needed', show(s.cashIn, 'money')]);
    if (s.roi != null) cards.push(['Return on cash', show(s.roi, 'pct')]);
    if (s.mao != null) cards.push(['Max offer', show(s.mao, 'money'), s.price > s.mao ? 'neg' : 'pos']);
    if (s.irr != null) cards.push(['Note IRR', show(s.irr, 'pct')]);
  } else {
    cards.push(['Cash flow / month', show(s.cfMo, 'money'), s.cfMo < 0 ? 'neg' : 'pos']);
    cards.push(['Cash needed', show(s.cashIn, 'money')]);
    cards.push(['Cash-on-cash', s.coc === Infinity ? '∞' : show(s.coc, 'pct'), s.coc != null && s.coc < 0 ? 'neg' : '']);
    if (s.dscr != null) cards.push(['DSCR', show(s.dscr, 'ratio'), Number.isFinite(s.dscr) && s.dscr < 1.2 ? 'neg' : '']);
    const mo = m('maxOffer');
    if (mo) cards.push([mo.label.replace(' to hit your targets', ''), mo.value == null ? 'Not possible' : show(mo.value, 'money')]);
  }
  return <div className="uw-cards">{cards.map(([l, v, c]) => <div key={l} className="uw-card"><div className="muted small">{l}</div><div className={`big ${c || ''}`}>{v}</div></div>)}</div>;
}

function Flags({ flags }) {
  if (!flags.length) return <div className="flag ok">No red flags.</div>;
  const order = { bad: 0, warn: 1, info: 2 };
  return (
    <div className="flags">
      {[...flags].sort((a, b) => order[a.level] - order[b.level]).map((f, i) => (
        <div key={i} className={`flag ${f.level}`}>{f.level === 'bad' ? '⛔' : f.level === 'warn' ? '⚠️' : 'ℹ️'} {f.text}</div>
      ))}
    </div>
  );
}

function Results({ result, tip, setTip }) {
  const groups = [];
  for (const m of result.metrics) {
    let g = groups.find((x) => x.name === m.group);
    if (!g) { g = { name: m.group, items: [] }; groups.push(g); }
    g.items.push(m);
  }
  return (
    <>
      {result.targets && result.targets.length > 0 && (
        <div className="card targets">
          {result.targets.map((t) => <span key={t.key} className={`tgt ${t.pass ? 'pass' : 'fail'}`}>{t.pass ? '✓' : '✗'} {t.label}</span>)}
        </div>
      )}
      {groups.map((g) => (
        <section key={g.name} className="card metrics">
          <h3>{g.name}</h3>
          {g.items.map((m) => {
            const key = `${g.name}-${m.id}`;
            const open = tip === key;
            return (
              <div key={key} className={`metric ${open ? 'open' : ''}`}>
                <div className="metric-row" onClick={() => setTip(open ? null : key)}>
                  <span>{m.label}</span>
                  <span className="mv">
                    <strong className={tone(m)}>{m.value === Infinity && m.kind === 'pct' ? '∞' : show(m.value, m.kind)}</strong>
                    <button className="info" title="How this was figured">ⓘ</button>
                  </span>
                </div>
                {open && (
                  <div className="explain">
                    <div><b>Formula:</b> {m.formula}</div>
                    <div><b>Your numbers:</b> {m.work}</div>
                    {m.note && <div className="muted">{m.note}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
      {result.loans.length > 0 && (
        <section className="card">
          <h3>Loans</h3>
          <table className="table small">
            <thead><tr><th>Loan</th><th>Amount</th><th>Rate</th><th>Payment</th></tr></thead>
            <tbody>{result.loans.map((l, i) => (
              <tr key={i} title={l.work}><td>{l.label}</td><td>{fmt.money(l.amount)}</td><td>{l.rate}%{l.io ? ' IO' : ''}</td><td>{fmt.money2(l.payment)}/mo</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}
      {result.cashLines.length > 0 && (
        <section className="card">
          <h3>Cash to close</h3>
          <table className="table small"><tbody>
            {result.cashLines.map((c, i) => <tr key={i}><td>{c.label}</td><td style={{ textAlign: 'right' }}>{fmt.money(c.amount)}</td></tr>)}
          </tbody></table>
        </section>
      )}
      {result.assumed.length > 0 && (
        <section className="card">
          <h3>Default assumptions in use</h3>
          <p className="muted small">These numbers weren't entered, so the calculator used a common default. Type over any of them on the left.</p>
          <ul className="assumed">{result.assumed.map((a) => <li key={a.key}><span>{a.label}</span><b>{a.value}</b></li>)}</ul>
        </section>
      )}
    </>
  );
}
function tone(m) {
  if (typeof m.value !== 'number') return '';
  if (['cfMo', 'cfYr', 'cfDoor', 'flProfit', 'nvProfit', 'spread', 'profit', 'wrProfit', 'coc'].includes(m.id)) return m.value < 0 ? 'neg' : 'pos';
  if (m.id === 'dscr') return m.value < 1.2 ? 'neg' : 'pos';
  return '';
}

function WhatIf({ input }) {
  const rows = useMemo(() => whatIf(input), [input]);
  const profitMode = rows[0] && rows[0].cfMo == null;
  return (
    <section className="card">
      <h3>What if…</h3>
      <p className="muted small">Rent (or revenue/earnings) 10% lower or higher, and new-loan rates 1 point higher. A Subject-To loan's rate never changes.</p>
      <table className="table small">
        <thead><tr><th>Rent</th><th>Rate</th>{profitMode ? <th>Profit</th> : <><th>Cash flow / mo</th><th>Cash-on-cash</th><th>DSCR</th></>}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} className={r.rent === 'As entered' && r.rate === 'As entered' ? 'base' : ''}>
            <td>{r.rent}</td><td>{r.rate}</td>
            {profitMode ? <td className={r.profit < 0 ? 'neg' : ''}>{show(r.profit, 'money')}</td> : (
              <><td className={r.cfMo < 0 ? 'neg' : ''}>{show(r.cfMo, 'money')}</td><td>{r.coc === Infinity ? '∞' : show(r.coc, 'pct')}</td><td>{show(r.dscr, 'ratio')}</td></>
            )}
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

const COMPARE_ROWS = [
  ['Strategy', (r) => (STRATEGIES.find((s) => s.id === r.strategy) || {}).label],
  ['Price', (r) => show(r.summary.price, 'money')],
  ['Cash flow / month', (r) => show(r.summary.cfMo, 'money')],
  ['Cash needed', (r) => show(r.summary.cashIn, 'money')],
  ['Cash-on-cash', (r) => (r.summary.coc === Infinity ? '∞' : show(r.summary.coc, 'pct'))],
  ['DSCR', (r) => show(r.summary.dscr, 'ratio')],
  ['Cap rate', (r) => show(r.summary.cap, 'pct')],
  ['Equity', (r) => show(r.summary.equity, 'money')],
  ['Profit', (r) => show(r.summary.profit, 'money')],
  ['Max offer', (r) => { const m = r.metrics.find((x) => x.id === 'maxOffer' || x.id === 'mao'); return m ? show(m.value, 'money') : '—'; }],
  ['Red flags', (r) => String(r.flags.filter((f) => f.level === 'bad').length)],
];
function Compare({ scenarios, current, pick, add }) {
  const results = useMemo(() => scenarios.map((s) => analyze(s.input)), [scenarios]);
  return (
    <section className="card">
      <h3>Side-by-side</h3>
      {scenarios.length < 2 && <p className="muted small">Click "+ Compare another structure" to copy this property into a second scenario, then switch its structure (for example Subject-To vs. seller finance).</p>}
      <div className="preview-wrap">
        <table className="table small compare">
          <thead><tr><th />{scenarios.map((s, i) => <th key={i} className={i === current ? 'on' : ''} onClick={() => pick(i)}>{s.name}</th>)}</tr></thead>
          <tbody>{COMPARE_ROWS.map(([label, f]) => (
            <tr key={label}><td>{label}</td>{results.map((r, i) => <td key={i}>{f(r) ?? '—'}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
      {scenarios.length < 2 && <button className="mini" onClick={add}>+ Compare another structure</button>}
    </section>
  );
}

function SavedList({ onClose, open, flash, currentId, onDeleted }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const load = async () => setRows(await window.hub.uw.list({ q }));
  useEffect(() => { load(); }, [q]);
  const remove = async (r) => {
    if (!(await askConfirm(`Delete the analysis "${r.name}"?`, 'Delete'))) return;
    await window.hub.uw.remove(r.id);
    onDeleted(r.id); load(); flash('Deleted.');
  };
  return (
    <Drawer onClose={onClose} width={640}>
      <div className="drawer-head"><h2 style={{ margin: 0 }}>Saved analyses</h2><button className="icon-btn" onClick={onClose}>✕</button></div>
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or address" autoFocus />
      <table className="table" style={{ marginTop: 10 }}>
        <thead><tr><th>Name</th><th>Cash flow</th><th>Deal</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={4} className="muted">Nothing saved yet.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} className={`clickable ${r.id === currentId ? 'sel-row' : ''}`} onClick={() => open(r.id)}>
              <td><strong>{r.name}</strong><div className="muted small">{r.address} · {(STRATEGIES.find((s) => s.id === r.summary.strategy) || {}).label || ''}</div></td>
              <td>{r.summary.cfMo != null ? `${show(r.summary.cfMo, 'money')}/mo` : r.summary.profit != null ? `${show(r.summary.profit, 'money')} profit` : '—'}</td>
              <td className="small">{r.deal_title || '—'}</td>
              <td><button className="mini" onClick={(e) => { e.stopPropagation(); remove(r); }}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Drawer>
  );
}

// ---------- Value check: online estimates + income + sold comps (+ county as a check) ----------
function ValueCheck({ input, set, P }) {
  const [open, setOpen] = useState(true);
  const v = useMemo(() => valueCheck(input), [input]);
  const ests = input.val_estimates || [];
  const comps = input.val_comps || [];
  const updE = (i, k, val) => set({ val_estimates: ests.map((e, j) => (j === i ? { ...e, [k]: val } : e)) });
  const updC = (i, k, val) => set({ val_comps: comps.map((c, j) => (j === i ? { ...c, [k]: val } : c)) });
  const $ = (x) => (x == null ? '—' : `$${Math.round(x).toLocaleString('en-US')}`);
  const look = (q) => window.dispatchEvent(new CustomEvent('hub-lookup', { detail: q }));
  const useIt = () => { set({ arv: String(Math.round(v.value)), _src: { ...(input._src || {}), arv: 'Value check' } }, true); };
  return (
    <section className="card valcheck">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Value check</h3>
        <button className="mini" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      <div className="vc-result">
        <div><span className="muted small">Suggested value</span><b>{$(v.value)}</b></div>
        <div><span className="muted small">Range</span><b className="small">{v.value ? `${$(v.low)} – ${$(v.high)}` : '—'}</b></div>
        <div><span className="muted small">Confidence</span><b className={`conf-${v.confidence.toLowerCase()}`}>{v.confidence === 'None' ? 'Add data below' : v.confidence}</b></div>
        <button className="mini primary" disabled={!v.value} onClick={useIt} title="Puts this into the Value field used for equity, LTV and max offer">Use as value</button>
      </div>
      {v.work && <div className="muted small">{v.work}</div>}
      {v.notes.map((x, i) => <div key={i} className="flag warn small" style={{ marginTop: 6 }}>{x}</div>)}
      {open && (
        <>
          <h4>1. Online estimates <span className="muted small">— filled from Zillow/Redfin automatically; add others you check</span></h4>
          {ests.map((e, i) => (
            <div key={i} className="vc-row">
              <input value={e.source} onChange={(x) => updE(i, 'source', x.target.value)} placeholder="Site" />
              <div className="uw-in"><i>$</i><input inputMode="decimal" value={e.value} onChange={(x) => updE(i, 'value', x.target.value)} /></div>
              <button className="mini" onClick={() => set({ val_estimates: ests.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div className="row wrap" style={{ gap: 4 }}>
            {['Realtor.com', 'Propwire', 'DealSauce', 'PropStream'].filter((s) => !ests.some((e) => e.source === s)).map((s) => <button key={s} className="mini" onClick={() => set({ val_estimates: [...ests, { source: s, value: '' }] })}>+ {s}</button>)}
            <button className="mini" onClick={() => set({ val_estimates: [...ests, { source: '', value: '' }] })}>+ Other</button>
            {input.address && <button className="mini" onClick={() => look(input.address)}>Open the sites</button>}
          </div>

          <h4>2. County appraisal <span className="muted small">— a floor / sanity check, not part of the blend</span></h4>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <div className="uw-in" style={{ width: 170 }}><i>$</i><input inputMode="decimal" value={input.val_county || ''} onChange={(e) => set({ val_county: e.target.value })} placeholder="Appraised value" /></div>
            {input.address && <button className="mini" onClick={() => look(input.address)}>Find county record</button>}
            {input._src && input._src.val_county && <em className="src">From {input._src.val_county}</em>}
          </div>
          <p className="muted small" style={{ margin: '4px 0 0' }}>Texas is a non-disclosure state: the county shows appraised value but not sale prices. In Property Lookup use County records → "Google: county assessor" (Tarrant = TAD), open the property, then "Send to Underwriting".</p>

          <h4>3. Income value {v.income && v.income.noi > 0 ? <span className="muted small">— NOI {$(v.income.noi)}/yr from the rent and expenses you entered</span> : <span className="muted small">— enter rent and expenses first</span>}</h4>
          <div className="uw-row">
            <Num k="val_capRate" label="Market cap rate" unit="%" {...P} hint="Sold cap rates for this type in this area (broker, Crexi/LoopNet sold)." />
            <Num k="val_grm" label="Market GRM (optional)" {...P} hint="Price ÷ yearly gross rent of sold comps." />
          </div>

          <h4>4. Sold comps <span className="muted small">— similar properties sold within ~½ mile, last 6–12 months</span></h4>
          {comps.length > 0 && <div className="vc-comp head"><span>Address</span><span>Sold $</span><span>Date</span><span>Units</span><span>Sq ft</span><span /></div>}
          {comps.map((c, i) => (
            <div key={i} className="vc-comp">
              <input value={c.address || ''} onChange={(e) => updC(i, 'address', e.target.value)} placeholder="Address" />
              <input inputMode="decimal" value={c.price || ''} onChange={(e) => updC(i, 'price', e.target.value)} placeholder="$" />
              <input type="date" value={c.date || ''} onChange={(e) => updC(i, 'date', e.target.value)} />
              <input inputMode="numeric" value={c.units || ''} onChange={(e) => updC(i, 'units', e.target.value)} />
              <input inputMode="numeric" value={c.sqft || ''} onChange={(e) => updC(i, 'sqft', e.target.value)} />
              <button className="mini" onClick={() => set({ val_comps: comps.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div className="row wrap" style={{ gap: 4 }}>
            <button className="mini" onClick={() => set({ val_comps: [...comps, { address: '', price: '', date: '', units: input.units || '', sqft: '' }] })}>+ Add a sold comp</button>
            {input.address && <button className="mini" onClick={() => look(input.address)}>Find sold comps</button>}
          </div>
          {v.comps && <div className="muted small" style={{ marginTop: 4 }}>{v.comps.perUnit ? `Median ${$(v.comps.perUnit)}/unit` : ''}{v.comps.perUnit && v.comps.perSqft ? ' · ' : ''}{v.comps.perSqft ? `${$(v.comps.perSqft)}/sq ft` : ''}</div>}
        </>
      )}
    </section>
  );
}
