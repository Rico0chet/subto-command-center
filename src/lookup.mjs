// Property lookup: one address → the right page on every research site.
// Sites with a known search address open straight to the property; the rest open their
// home page with the address already copied, so you just paste (Ctrl+V).

export const GROUPS = [
  { id: 'residential', label: 'Listings & values' },
  { id: 'investor', label: 'Investor tools' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'records', label: 'County records' },
  { id: 'people', label: 'Owner / people search' },
  { id: 'rent', label: 'Rent comps' },
  { id: 'risk', label: 'Map, flood & area' },
  { id: 'str', label: 'Short-term rental (STR)' },
];

// {q} full address · {zdash} Zillow-style slug · {street} · {citystatezip} · {citystate} · {city} · {state} · {zip}
// {streetdash} · {citystatedash} · {ducky:site} → jumps to the first search result on that site
export const DEFAULT_SITES = [
  { id: 'zillow', group: 'residential', label: 'Zillow', url: 'https://www.zillow.com/homes/{zdash}_rb/' },
  { id: 'redfin', group: 'residential', label: 'Redfin', url: '{ducky:redfin.com}', note: 'Opens the first Redfin result for the address' },
  { id: 'realtor', group: 'residential', label: 'Realtor.com', url: '{ducky:realtor.com}', note: 'Opens the first Realtor.com result for the address' },
  { id: 'homes', group: 'residential', label: 'Homes.com', url: '{ducky:homes.com}' },
  { id: 'propwire', group: 'investor', label: 'Propwire', url: '', home: 'https://propwire.com/' },
  { id: 'dealsauce', group: 'investor', label: 'DealSauce', url: '', home: 'https://app.dealsauce.io/' },
  { id: 'propstream', group: 'investor', label: 'PropStream', url: '', home: 'https://app.propstream.com/' },
  { id: 'privy', group: 'investor', label: 'Privy', url: '', home: 'https://app.privy.pro/', off: true },
  { id: 'crexi', group: 'commercial', label: 'Crexi', url: '', home: 'https://www.crexi.com/properties' },
  { id: 'loopnet', group: 'commercial', label: 'LoopNet', url: '', home: 'https://www.loopnet.com/' },
  { id: 'crexi-g', group: 'commercial', label: 'Crexi / LoopNet (search)', url: 'https://www.google.com/search?q={q}+site%3Acrexi.com+OR+site%3Aloopnet.com' },
  { id: 'gparcel', group: 'records', label: 'Google: parcel & owner', url: 'https://www.google.com/search?q={q}+parcel+owner' },
  { id: 'gassessor', group: 'records', label: 'Google: county assessor', url: 'https://www.google.com/search?q={county}+assessor+parcel+search' },
  { id: 'tps', group: 'people', label: 'TruePeopleSearch', url: 'https://www.truepeoplesearch.com/resultaddress?streetaddress={street}&citystatezip={citystatezip}' },
  { id: 'fps', group: 'people', label: 'FastPeopleSearch', url: 'https://www.fastpeoplesearch.com/address/{streetdash}_{citystatedash}' },
  { id: 'zrent', group: 'rent', label: 'Zillow rentals nearby', url: 'https://www.zillow.com/homes/for_rent/{zcity}_rb/' },
  { id: 'rentometer', group: 'rent', label: 'Rentometer', url: '', home: 'https://www.rentometer.com/' },
  { id: 'rentcast', group: 'rent', label: 'RentCast', url: '', home: 'https://app.rentcast.io/app' },
  { id: 'apartments', group: 'rent', label: 'Apartments.com', url: '{ducky:apartments.com}' },
  { id: 'gmaps', group: 'risk', label: 'Google Maps', url: 'https://www.google.com/maps/search/?api=1&query={q}' },
  { id: 'fema', group: 'risk', label: 'FEMA flood map', url: 'https://msc.fema.gov/portal/search?AddressQuery={q}' },
  { id: 'crime', group: 'risk', label: 'Crime map', url: 'https://www.google.com/search?q={q}+crime+map' },
  { id: 'schools', group: 'risk', label: 'GreatSchools', url: 'https://www.greatschools.org/search/search.page?q={q}' },
  { id: 'airdna', group: 'str', label: 'AirDNA', url: '', home: 'https://app.airdna.co/data/rentalizer' },
  { id: 'rabbu', group: 'str', label: 'Rabbu', url: '', home: 'https://www.rabbu.com/airbnb-calculator' },
  { id: 'airroi', group: 'str', label: 'AirROI', url: '', home: 'https://www.airroi.com/' },
  { id: 'awning', group: 'str', label: 'Awning', url: '', home: 'https://awning.com/airbnb-estimator' },
  { id: 'chalet', group: 'str', label: 'Chalet', url: '', home: 'https://www.getchalet.com/' },
  { id: 'airbnb', group: 'str', label: 'Airbnb listings nearby', url: 'https://www.airbnb.com/s/{citystateurl}/homes' },
  { id: 'vrbo', group: 'str', label: 'VRBO nearby', url: 'https://www.vrbo.com/search?destination={citystate}' },
  { id: 'strrules', group: 'str', label: 'STR rules for this city', url: 'https://www.google.com/search?q={city}+{state}+short+term+rental+ordinance+permit' },
];

const STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');

// "123 Main St, Mesa, AZ 85203" → parts. Also handles "123 Main St Mesa AZ 85203".
export function parseAddress(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim().replace(/,?\s*(USA|United States)$/i, '');
  const out = { full: s, street: '', city: '', state: '', zip: '' };
  if (!s) return out;
  const zipM = s.match(/\b(\d{5})(?:-\d{4})?\s*$/);
  let rest = s;
  if (zipM) { out.zip = zipM[1]; rest = s.slice(0, zipM.index).trim().replace(/,$/, ''); }
  const stM = rest.match(/[,\s]([A-Za-z]{2})$/);
  if (stM && STATES.includes(stM[1].toUpperCase())) { out.state = stM[1].toUpperCase(); rest = rest.slice(0, stM.index).trim().replace(/,$/, ''); }
  const parts = rest.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) { out.street = parts[0]; out.city = parts.slice(1).join(', '); }
  else {
    // No commas: guess the city as the words after the street suffix.
    const m = rest.match(/^(.*?\b(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|ct|court|way|pl|place|cir|circle|pkwy|hwy|trl|trail|ter|terrace)\.?(?:\s+(?:n|s|e|w|ne|nw|se|sw))?(?:\s+(?:#|apt|unit|ste)\s*\S+)?)\s+(.+)$/i);
    if (m) { out.street = m[1]; out.city = m[2]; } else out.street = rest;
  }
  return out;
}

const slug = (s) => String(s || '').toLowerCase().replace(/#/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function buildUrl(site, address, county = '') {
  const a = parseAddress(address);
  const cityState = [a.city, a.state].filter(Boolean).join(', ');
  const tokens = {
    q: encodeURIComponent(a.full),
    zdash: [a.street, a.city, a.state, a.zip].filter(Boolean).join(' ').replace(/[#,]/g, '').trim().replace(/\s+/g, '-'),
    zcity: [a.city, a.state, a.zip].filter(Boolean).join(' ').replace(/,/g, '').trim().replace(/\s+/g, '-') || encodeURIComponent(a.full),
    street: encodeURIComponent(a.street || a.full),
    citystatezip: encodeURIComponent([cityState, a.zip].filter(Boolean).join(' ')),
    citystate: encodeURIComponent(cityState),
    citystateurl: encodeURIComponent(cityState.replace(/,\s*/g, '--').replace(/\s+/g, '-')),
    city: encodeURIComponent(a.city),
    state: encodeURIComponent(a.state),
    zip: encodeURIComponent(a.zip),
    streetdash: slug(a.street || a.full),
    citystatedash: slug([a.city, a.state, a.zip].filter(Boolean).join(' ')),
    county: encodeURIComponent(county || [a.city, a.state].filter(Boolean).join(' ')),
  };
  const tpl = String(site.url || '');
  if (!tpl) return { url: site.home, paste: true };
  const ducky = tpl.match(/^\{ducky:([^}]+)\}$/);
  if (ducky) return { url: `https://duckduckgo.com/?q=${encodeURIComponent(`\\site:${ducky[1]} ${a.full}`)}`, paste: false };
  const url = tpl.replace(/\{(\w+)\}/g, (_m, k) => (k in tokens ? tokens[k] : ''));
  return { url, paste: false };
}

// Default list + your county pages + your own sites, minus the ones you hid.
export function mergeSites(settings = {}) {
  const hidden = new Set(settings.lookupHidden || []);
  const shown = new Set(settings.lookupShown || []);
  const c = settings.county || {};
  const countySites = [
    c.assessor && { id: 'c-assessor', group: 'records', label: `${c.name || 'County'} assessor`, url: c.assessor.includes('{') ? c.assessor : '', home: c.assessor },
    c.recorder && { id: 'c-recorder', group: 'records', label: `${c.name || 'County'} recorder / deeds`, url: c.recorder.includes('{') ? c.recorder : '', home: c.recorder },
    c.treasurer && { id: 'c-treasurer', group: 'records', label: `${c.name || 'County'} treasurer / taxes`, url: c.treasurer.includes('{') ? c.treasurer : '', home: c.treasurer },
    c.gis && { id: 'c-gis', group: 'records', label: `${c.name || 'County'} GIS map`, url: c.gis.includes('{') ? c.gis : '', home: c.gis },
  ].filter(Boolean);
  const custom = (settings.lookupCustom || []).map((s) => ({ ...s, custom: true, url: s.url && s.url.includes('{') ? s.url : '', home: s.url }));
  return [...DEFAULT_SITES, ...countySites, ...custom].map((s) => ({ ...s, enabled: s.off ? shown.has(s.id) : !hidden.has(s.id) }));
}

export function cleanCustomSite({ label, url, group }) {
  const l = String(label || '').trim().slice(0, 40);
  const u = String(url || '').trim();
  if (!l) throw new Error('Give the site a name');
  if (!/^https?:\/\//i.test(u)) throw new Error('The web address must start with http:// or https://');
  return { id: `x-${l.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`, label: l, url: u.slice(0, 500), group: GROUPS.some((g) => g.id === group) ? group : 'investor' };
}
