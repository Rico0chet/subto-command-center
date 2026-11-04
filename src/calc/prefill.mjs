// Turns what the hub already knows about a property (your lead list row, the deal, and the
// Zillow / Redfin page) into underwriting inputs — and suggests the property type and the
// loan structures that fit it. Every filled field remembers where it came from.

const n = (v) => { if (v == null || v === '') return null; const x = Number(String(v).replace(/[$,%\s]/g, '')); return Number.isFinite(x) ? x : null; };

// Property type for the calculator from a site's "home type", the unit count and the lead list's wording.
export function typeFromFacts({ homeType = '', units = null, leadType = '', title = '' } = {}) {
  const t = `${homeType} ${leadType} ${title}`.toLowerCase();
  const u = n(units);
  if (/mobile home park|\bmhp\b|rv park|trailer park|manufactured (home )?community/.test(t)) return 'mhp';
  if (/business|restaurant|laundromat|car wash/.test(t)) return 'business';
  if (/\blot\b|land|acre|vacant/.test(t)) return 'land';
  if (/manufactured|mobile/.test(t)) return 'mobile';
  if (/retail|office|industrial|warehouse|storage|commercial|mixed use/.test(t)) return 'commercial';
  if (u != null && u >= 5) return 'mf';
  if (u != null && u >= 2) return 'smf';
  if (/multi|duplex|triplex|quad|fourplex|apartment/.test(t)) return u != null && u >= 5 ? 'mf' : (/apartment/.test(t) ? 'mf' : 'smf');
  if (/single|condo|town|house|sfr|residential/.test(t)) return 'sf';
  return null;
}

const WHY = {
  subto: 'Take over the existing loan: little cash, keeps their low rate.',
  seller: 'No bank needed. Best when the owner has lots of equity or owns it free & clear.',
  hybrid: 'Take over the loan and the seller carries the rest of their equity.',
  wrap: 'Buy Subject-To and resell on terms for a monthly spread.',
  dscr: 'Investor loan qualified on rent: typically 20–25% down, no income docs.',
  conventional: 'Bank loan: 5–25% down; 2–4 units can use owner-occupied FHA/conventional.',
  cash: 'Fastest close; refinance or sell later.',
  hard: 'Short-term money for a fixer before a refinance or sale.',
  brrrr: 'Fixer: buy, rehab, rent, refinance at the after-repair value.',
  flip: 'Fixer to resell: max offer by the 70% rule.',
  sba: 'Business purchase: ~10% down, 10-year SBA 7(a) loan.',
};
const NEEDS = {
  subto: 'Mortgage statement (balance, rate, payment), authorization to release info, Subject-To addendum.',
  seller: 'Seller-finance terms (down, rate, years, balloon) and a promissory note + deed of trust.',
  hybrid: 'Mortgage statement + seller-carry terms for the 2nd note.',
  wrap: 'Mortgage statement, end-buyer terms, a licensed RMLO and a loan servicer.',
  dscr: 'Rent estimate or leases, 6–12 months of reserves, a DSCR lender quote.',
  conventional: 'Pre-approval, income docs, down payment.',
  cash: 'Proof of funds.',
  hard: 'Hard-money term sheet, rehab budget, exit plan.',
  brrrr: 'Hard money or cash, rehab budget, refinance lender lined up.',
  flip: 'ARV comps, rehab budget, hard money or cash.',
  sba: 'Tax returns + P&L, SBA lender, ~10% down.',
};

// The structures worth running for this property, best first.
export function suggestStructures({ type, units, freeAndClear = false, hasLoan = null, fixer = false } = {}) {
  let ids;
  if (type === 'business') ids = ['sba', 'seller', 'cash'];
  else if (type === 'land') ids = ['seller', 'cash'];
  else if (type === 'mobile' || type === 'mhp') ids = freeAndClear ? ['seller', 'cash'] : ['seller', 'hybrid', 'subto', 'cash'];
  else if (type === 'mf' || type === 'commercial') ids = freeAndClear ? ['seller', 'dscr', 'cash'] : ['seller', 'hybrid', 'subto', 'dscr'];
  else ids = freeAndClear ? ['seller', 'dscr', 'cash'] : ['subto', 'hybrid', 'seller', 'dscr'];
  if (fixer && type !== 'business' && type !== 'land') ids = [...ids, 'brrrr', 'flip'];
  if (hasLoan === false && !freeAndClear) ids = ids.filter((x) => x !== 'subto' && x !== 'hybrid');
  const label = { subto: 'Subject-To', seller: 'Seller finance', hybrid: 'Hybrid', wrap: 'Wrap', dscr: 'DSCR loan', conventional: 'Conventional', cash: 'Cash', hard: 'Hard money', brrrr: 'BRRRR', flip: 'Fix & flip', sba: 'SBA loan' };
  return [...new Set(ids)].map((id) => ({ id, label: label[id], why: WHY[id], needs: NEEDS[id] }));
}

// Pull numbers out of "Header: value" Sheet-details lines (lead lists carry all sorts of columns).
function fromExtra(extra = '') {
  const lines = String(extra).split('\n');
  const find = (re) => { for (const l of lines) { const i = l.indexOf(':'); if (i > 0 && re.test(l.slice(0, i))) return l.slice(i + 1).trim(); } return null; };
  return {
    price: n(find(/asking|list(ing)? price|^price$|purchase price/i)),
    sqft: n(find(/sq\.? ?ft|square feet|building size|rentable/i)),
    rent: n(find(/^(gross )?rent|monthly rent|market rent|avg rent/i)),
    taxes: n(find(/^taxes|property tax/i)),
    noi: n(find(/\bnoi\b/i)),
    loanBalance: n(find(/loan balance|mortgage balance|open mortgage|est\.? (loan )?balance/i)),
    rate: n(find(/interest rate|loan rate/i)),
    arv: n(find(/\barv\b|est(imated)? value|market value/i)),
  };
}

// lead = { address, price, units, yearBuilt, propertyType, title, extra, highlights:[{label,value}], listName, owner, loanBalance, rate, rent, arv }
// listing = what the Zillow/Redfin page showed (see electron/listing.js)
export function buildPrefill({ lead = null, deal = null, listing = null, current = {} } = {}) {
  const patch = {};
  const sources = {};
  const facts = [];
  const put = (k, v, src) => {
    if (v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return;
    if (patch[k] !== undefined) return; // deal → lead list → website: the first one that has it wins
    const cur = current[k];
    if (cur !== '' && cur != null && !(current._src || {})[k]) return; // never overwrite what you typed
    patch[k] = String(v);
    sources[k] = src;
  };
  const leadSrc = lead ? `Lead list${lead.listName ? `: ${lead.listName}` : ''}` : '';
  const ex = lead ? fromExtra(lead.extra) : {};
  const hl = (label) => { const h = lead && (lead.highlights || []).find((x) => new RegExp(label, 'i').test(x.label)); return h ? String(h.value) : ''; };
  const sourceList = hl('^source');
  // What an earlier fill already learned (e.g. from the lead list) carries over to a later website fill.
  const freeAndClear = !!current._freeClear || /free\s*&?\s*clear|no loan|paid off/i.test(`${sourceList} ${lead ? lead.extra : ''}`);
  const hasLoanHint = /high equity|pre-?foreclosure|mortgage|loan/i.test(sourceList) && !freeAndClear ? true : null;

  // ---------- where it is and what it is ----------
  const address = (deal && deal.address && [deal.address, deal.city, [deal.state, deal.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '))
    || (lead && lead.address) || (listing && listing.address);
  if (address && !current.address) { patch.address = address; patch.name = current.name || address; }
  const units = n(lead && lead.units) ?? n(current.units) ?? n(listing && listing.units);
  const knownType = current._src && current._src.type && !/zillow|redfin/i.test(current._src.type) && !lead && !deal ? current.type : null;
  const type = knownType || typeFromFacts({ homeType: listing && listing.homeType, units, leadType: (lead && lead.propertyType) || (deal && deal.property_type), title: lead && lead.title });
  if (type && !knownType && !(current.type && current._src && !current._src.type && current.type !== 'sf')) { patch.type = type; sources.type = lead ? leadSrc : deal ? 'Deal' : 'Zillow/Redfin'; }
  if (units && (type === 'smf' || type === 'mf' || type === 'mhp' || type === 'commercial')) put('units', units, lead && lead.units ? leadSrc : 'Zillow/Redfin');

  // ---------- price & value ----------
  if (deal) { put('price', deal.asking_price, 'Deal'); put('arv', deal.arv, 'Deal'); put('st_balance', deal.loan_balance, 'Deal'); put('st_rate', deal.interest_rate, 'Deal'); }
  if (lead) { put('price', n(lead.price) ?? ex.price, leadSrc); put('arv', n(lead.arv) ?? ex.arv, leadSrc); put('st_balance', n(lead.loanBalance) ?? ex.loanBalance, leadSrc); put('st_rate', n(lead.rate) ?? ex.rate, leadSrc); put('sqft', ex.sqft, leadSrc); put('taxesYr', ex.taxes, leadSrc); }
  if (listing) {
    put('price', listing.price, 'Zillow/Redfin');
    put('arv', listing.zestimate, 'Zillow/Redfin');
    put('sqft', listing.sqft, 'Zillow/Redfin');
    put('taxesYr', listing.taxesYr ?? (listing.taxRate && listing.price ? Math.round(listing.price * listing.taxRate / 100) : null), 'Zillow/Redfin');
    put('insuranceYr', listing.insuranceYr, 'Zillow/Redfin');
    put('hoaMo', listing.hoaMo, 'Zillow/Redfin');
    // Value check: each site's estimate is kept separately, and a county page fills the appraised value.
    const site = /zillow/i.test(listing.site || '') ? 'Zillow' : /redfin/i.test(listing.site || '') ? 'Redfin' : /realtor/i.test(listing.site || '') ? 'Realtor.com'
      : /homes\.com/i.test(listing.site || '') ? 'Homes.com' : /propwire/i.test(listing.site || '') ? 'Propwire' : /dealsauce/i.test(listing.site || '') ? 'DealSauce' : /propstream/i.test(listing.site || '') ? 'PropStream' : (listing.site || 'Website');
    if (listing.zestimate) {
      const list = (current.val_estimates || []).filter((e) => e.source !== site);
      patch.val_estimates = [...list, { source: site, value: String(Math.round(listing.zestimate)) }];
      sources.val_estimates = site;
    }
    if (listing.countyValue && !current.val_county) { patch.val_county = String(Math.round(listing.countyValue)); sources.val_county = listing.site || 'County'; }
  }

  // ---------- rent ----------
  const rent = n(deal && deal.rent) ?? n(lead && lead.rent) ?? ex.rent;
  const rentSrc = n(deal && deal.rent) != null ? 'Deal' : leadSrc;
  const siteRent = listing && n(listing.rentEstimate);
  const rentNow = (current.rents || [])[0] || {};
  const rentTyped = rentNow.rent && !(current._src || {}).rents;
  if (!rentTyped && (rent || siteRent)) {
    const u = units && units > 1 ? units : 1;
    patch.rents = [{ label: u > 1 ? 'Unit' : 'Unit 1', rent: String(rent || siteRent), count: String(u) }];
    sources.rents = rent ? rentSrc : (u > 1 ? 'Zillow/Redfin (check: may be for one unit)' : 'Zillow/Redfin');
  }
  if (deal && deal.piti) facts.push(['PITI on the deal', `$${Math.round(deal.piti).toLocaleString()}/mo`]);

  // ---------- facts worth seeing ----------
  if (lead) {
    if (lead.yearBuilt) facts.push(['Year built', lead.yearBuilt]);
    for (const h of lead.highlights || []) if (h.value) facts.push([h.label, h.value]);
    if (lead.owner) facts.push(['Owner', lead.owner]);
  }
  if (listing) {
    const L = listing;
    const add = (k, v) => { if (v != null && v !== '') facts.push([k, v]); };
    add('Listing', L.status ? String(L.status).replace(/_/g, ' ').toLowerCase() : '');
    add('Beds / baths', L.beds != null || L.baths != null ? `${L.beds ?? '?'} bd / ${L.baths ?? '?'} ba` : '');
    if (!lead || !lead.yearBuilt) add('Year built', L.yearBuilt);
    add('Lot', L.lotSize);
    add('Days on market', L.daysOnMarket);
    add('Est. payment (site)', L.estPayment ? `$${Number(L.estPayment).toLocaleString()}/mo` : '');
    add('Rent estimate (site)', L.rentEstimate ? `$${Number(L.rentEstimate).toLocaleString()}/mo` : '');
    add('Value estimate (site)', L.zestimate ? `$${Number(L.zestimate).toLocaleString()}` : '');
    add('30-yr rate (site)', L.rate30 ? `${L.rate30}%` : '');
    add('Last event', L.lastEvent);
  }
  if (freeAndClear) facts.unshift(['Loan', 'Free & clear (no mortgage) — Subject-To is not possible; seller finance fits best']);

  // ---------- which structures ----------
  const yb = n((lead && lead.yearBuilt) || (listing && listing.yearBuilt));
  const fixer = /fixer|tlc|needs work|as-is|investor special|handyman/i.test(`${listing && listing.description} ${lead && lead.extra}`);
  const suggestions = suggestStructures({ type: patch.type || current.type, units, freeAndClear, hasLoan: freeAndClear ? false : hasLoanHint, fixer });
  if (suggestions[0] && !current._strategyTouched && !(suggestions.some((x) => x.id === current.strategy) && (current._src || {}).strategy)) { patch.strategy = suggestions[0].id; sources.strategy = 'Suggested'; }
  // Keep facts found earlier (lead list) and add the new ones.
  const merged = [...(current._facts || [])];
  for (const f of facts) { const i = merged.findIndex((x) => x[0] === f[0]); if (i >= 0) merged[i] = f; else merged.push(f); }
  facts.length = 0; facts.push(...merged);
  if (yb && yb < 1980 && (patch.type || current.type) !== 'land') facts.push(['Age', `Built ${yb}: check roof, plumbing, electrical before you offer`]);
  return { patch, sources, facts, suggestions, freeAndClear, type: patch.type || current.type };
}
