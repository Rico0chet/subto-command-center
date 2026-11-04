// Value check: what a property is worth when there's no list price to lean on.
// Three ways — online estimates, income (rent), sold comps — plus the county's appraised value as a check.
import { analyze } from './underwrite.mjs';

const n = (v) => { if (v == null || v === '') return null; const x = Number(String(v).replace(/[$,%\s]/g, '')); return Number.isFinite(x) && x > 0 ? x : null; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const $ = (v) => (v == null ? '—' : `$${Math.round(v).toLocaleString('en-US')}`);
const MULTI = new Set(['smf', 'mf', 'commercial', 'mhp']);

export function valueCheck(input) {
  const type = input.type || 'sf';
  const units = n(input.units) || (input.rents || []).reduce((s, r) => s + (n(r.rent) ? (n(r.count) || 1) : 0), 0) || 1;
  const sqft = n(input.sqft);
  const multi = MULTI.has(type) || units >= 2;
  const methods = [];
  const notes = [];

  // 1) Online estimates (Zillow, Redfin, Realtor.com, Propwire, DealSauce…)
  const ests = (input.val_estimates || []).map((e) => ({ source: e.source || 'Estimate', value: n(e.value) })).filter((e) => e.value);
  let est = null;
  if (ests.length) {
    const vals = ests.map((e) => e.value);
    est = { low: Math.min(...vals), mid: median(vals), high: Math.max(...vals), list: ests };
    methods.push({ id: 'est', label: 'Online estimates', value: est.mid, work: `Middle of ${ests.map((e) => `${e.source} ${$(e.value)}`).join(', ')} = ${$(est.mid)}` });
    if (est.high / est.low - 1 > 0.2) notes.push(`Online estimates are ${Math.round((est.high / est.low - 1) * 100)}% apart. In non-disclosure states like Texas they are less reliable; lean on comps and income.`);
  }

  // 2) Income value: NOI ÷ market cap rate, and gross rent × GRM
  let income = null;
  if (['sf', 'smf', 'mf', 'commercial', 'mhp', 'mobile', 'str'].includes(type)) {
    const r = analyze({ ...input, strategy: 'cash', price: input.price || input.arv || '1', closing: '0' }, { _solving: true });
    const noi = (r.metrics.find((m) => m.id === 'noi') || {}).value;
    const gpi = (r.metrics.find((m) => m.id === 'gpi') || {}).value;
    const cap = n(input.val_capRate);
    const grm = n(input.val_grm);
    income = { noi, cap, grm, grossYr: gpi ? gpi * 12 : null };
    if (noi > 0 && cap) {
      income.capValue = noi / (cap / 100);
      methods.push({ id: 'cap', label: 'Income (NOI ÷ cap rate)', value: income.capValue, work: `${$(noi)} NOI ÷ ${cap}% = ${$(income.capValue)}` });
    } else if (noi > 0) notes.push('Enter the market cap rate for this area and type (ask a local broker, or check sold listings on Crexi/LoopNet) to value it on income.');
    if (gpi > 0 && grm) {
      income.grmValue = gpi * 12 * grm;
      methods.push({ id: 'grm', label: 'Income (gross rent × GRM)', value: income.grmValue, work: `${$(gpi * 12)} yearly rent × ${grm} = ${$(income.grmValue)}` });
    }
  }

  // 3) Sold comps
  const comps = (input.val_comps || []).map((c) => ({ ...c, price: n(c.price), units: n(c.units), sqft: n(c.sqft) })).filter((c) => c.price);
  let compV = null;
  if (comps.length) {
    const perUnit = median(comps.filter((c) => c.units).map((c) => c.price / c.units));
    const perSqft = median(comps.filter((c) => c.sqft).map((c) => c.price / c.sqft));
    const byUnit = perUnit && units ? perUnit * units : null;
    const bySqft = perSqft && sqft ? perSqft * sqft : null;
    const pick = multi ? (byUnit ?? bySqft) : (bySqft ?? byUnit);
    compV = { perUnit, perSqft, byUnit, bySqft, value: pick, count: comps.length };
    if (pick) methods.push({ id: 'comps', label: `Sold comps (${comps.length})`, value: pick,
      work: multi && byUnit ? `Median ${$(perUnit)}/unit × ${units} units = ${$(byUnit)}` : bySqft ? `Median ${$(perSqft)}/sq ft × ${sqft.toLocaleString()} sq ft = ${$(bySqft)}` : `Median ${$(perUnit)}/unit × ${units} = ${$(byUnit)}` });
    else notes.push('Add units or square feet to the comps (and to this property) to compare them.');
    if (comps.length < 3) notes.push('Three or more sold comps make the comp value much more trustworthy.');
  }

  // County appraisal: a check, not part of the blend
  const county = n(input.val_county);
  if (county && methods.length) {
    const mid = median(methods.map((m) => m.value));
    if (mid / county > 1.4) notes.push(`The value is ${Math.round((mid / county - 1) * 100)}% above the county appraisal. Counties often lag, but check your numbers.`);
    if (mid < county * 0.85) notes.push('The value is below the county appraisal. Possible bargain, or the comps/rents are too low.');
  }

  // Blend: income leads for 2+ units, comps lead for houses.
  const W = multi ? { cap: 0.35, grm: 0.15, comps: 0.3, est: 0.2 } : { comps: 0.5, est: 0.35, cap: 0.1, grm: 0.05 };
  let value = null, low = null, high = null, confidence = 'None';
  if (methods.length) {
    const tw = methods.reduce((s, m) => s + W[m.id], 0);
    value = methods.reduce((s, m) => s + m.value * W[m.id], 0) / tw;
    const vals = methods.map((m) => m.value).concat(est ? [est.low, est.high] : []);
    low = Math.min(...vals); high = Math.max(...vals);
    const spread = high / low - 1;
    confidence = methods.length >= 3 && spread <= 0.15 ? 'High' : methods.length >= 2 && spread <= 0.3 ? 'Medium' : 'Low';
    for (const m of methods) m.weight = W[m.id] / tw;
  }
  return { type, units, sqft, multi, methods, est, income, comps: compV, county, value, low, high, confidence, notes,
    work: methods.length ? methods.map((m) => `${m.label} ${$(m.value)} × ${Math.round(m.weight * 100)}%`).join(' + ') + ` = ${$(value)}` : '' };
}
