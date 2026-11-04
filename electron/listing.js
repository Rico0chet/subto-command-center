// Reads the facts off a Zillow / Redfin / Realtor.com property page: price, beds, baths, square feet,
// year built, rent estimate, taxes, HOA, insurance… Runs inside the page (a Property Lookup tab or a
// hidden window using the same signed-in session), so whatever the site shows you, the hub can read.

// The function below is sent to the page as text; it must not use anything from this file.
function pageExtractor() {
  const out = { url: location.href, site: location.hostname.replace(/^www\./, ''), title: document.title };
  const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) && String(v).match(/\d/) ? n : null; };
  const set = (k, v) => { if (v != null && v !== '' && !(typeof v === 'number' && !Number.isFinite(v)) && out[k] == null) out[k] = v; };
  // 1) Zillow keeps the whole listing as JSON in the page.
  try {
    const nd = document.getElementById('__NEXT_DATA__');
    if (nd) {
      const j = JSON.parse(nd.textContent);
      const pp = (j.props && j.props.pageProps) || {};
      let cache = pp.componentProps && pp.componentProps.gdpClientCache;
      if (typeof cache === 'string') cache = JSON.parse(cache);
      let p = null;
      if (cache) for (const v of Object.values(cache)) if (v && v.property) { p = v.property; break; }
      if (!p && pp.initialReduxState && pp.initialReduxState.gdp) p = pp.initialReduxState.gdp.building || null;
      if (p) {
        const rf = p.resoFacts || {};
        set('price', p.price || p.listPrice);
        set('zestimate', p.zestimate);
        set('rentEstimate', p.rentZestimate);
        set('beds', p.bedrooms); set('baths', p.bathrooms);
        set('sqft', p.livingArea || p.livingAreaValue);
        set('yearBuilt', p.yearBuilt);
        set('homeType', p.homeType);
        set('status', p.homeStatus);
        set('taxesYr', p.taxAnnualAmount || rf.taxAnnualAmount);
        set('taxRate', p.propertyTaxRate);
        set('hoaMo', p.monthlyHoaFee || num(rf.hoaFee));
        set('insuranceYr', p.annualHomeownersInsurance);
        set('lotSize', rf.lotSize || (p.lotAreaValue ? `${p.lotAreaValue} ${p.lotAreaUnits || ''}`.trim() : null));
        set('daysOnMarket', p.daysOnZillow);
        set('units', rf.numberOfUnitsTotal || p.numberOfUnitsTotal);
        set('rate30', p.mortgageRates && p.mortgageRates.thirtyYearFixedRate);
        set('description', p.description && String(p.description).slice(0, 1500));
        if (p.address) set('address', [p.address.streetAddress, p.address.city, [p.address.state, p.address.zipcode].filter(Boolean).join(' ')].filter(Boolean).join(', '));
        if (Array.isArray(p.taxHistory) && p.taxHistory[0] && p.taxHistory[0].taxPaid) set('taxesYr', p.taxHistory[0].taxPaid);
        if (Array.isArray(p.priceHistory) && p.priceHistory[0]) set('lastEvent', `${p.priceHistory[0].event || ''} ${p.priceHistory[0].date || ''} $${p.priceHistory[0].price || ''}`.trim());
      }
    }
  } catch (e) { out.jsonError = String(e && e.message); }
  // 2) Structured data many sites include (schema.org).
  try {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let j; try { j = JSON.parse(s.textContent); } catch { continue; }
      for (const x of [].concat(j, (j && j['@graph']) || [])) {
        if (!x || typeof x !== 'object') continue;
        if (x.offers && x.offers.price) set('price', num(x.offers.price));
        if (x.floorSize && x.floorSize.value) set('sqft', num(x.floorSize.value));
        if (x.numberOfRooms) set('beds', num(x.numberOfRooms));
        if (x.yearBuilt) set('yearBuilt', num(x.yearBuilt));
        if (x.address && x.address.streetAddress) set('address', [x.address.streetAddress, x.address.addressLocality, [x.address.addressRegion, x.address.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', '));
      }
    }
  } catch { /* ignore */ }
  // 3) Whatever the page says in plain text (Redfin, Realtor.com, and a backup for Zillow).
  const text = (document.body ? document.body.innerText : '').replace(/ /g, ' ');
  const m = (re) => { const x = text.match(re); return x ? x[1] : null; };
  set('price', num(m(/(?:List(?:ing)? price|Price)[:\s]*\$([\d,]{4,})/i)) || num(m(/^\s*\$([\d,]{5,})\s*$/m)));
  set('beds', num(m(/(\d+(?:\.\d+)?)\s*(?:bd|beds?|bedrooms?)\b/i)));
  set('baths', num(m(/(\d+(?:\.\d+)?)\s*(?:ba|baths?|bathrooms?)\b/i)));
  set('sqft', num(m(/([\d,]{3,})\s*(?:sq\.?\s*ft|sqft|square feet)/i)));
  set('yearBuilt', num(m(/(?:Built in|Year built)[:\s]*(\d{4})/i)));
  set('rentEstimate', num(m(/Rent\s*Zestimate[®\s]*[:\s]*\$([\d,]+)/i)) || num(m(/(?:rental estimate|estimated rent|Rent estimate)[^$]{0,30}\$([\d,]+)/i)));
  set('zestimate', num(m(/(?:Zestimate|Redfin Estimate|Estimated value)[®\s]*[:\s]*\$([\d,]{4,})/i)));
  set('hoaMo', num(m(/HOA(?:\s*dues)?[:\s]*\$([\d,]+)\s*(?:\/\s*mo|monthly|per month)/i)));
  set('taxesYr', num(m(/(?:Annual tax amount|Property taxes?|Tax amount)[:\s]*\$([\d,]+)/i)));
  set('estPayment', num(m(/(?:Est\.?\s*payment|Estimated monthly payment)[:\s]*\$([\d,]+)/i)));
  set('units', num(m(/(?:Number of units|Total units|Units)[:\s]*(\d+)\b/i)));
  set('homeType', m(/(?:Home type|Property type|Type)[:\s]*(Single Family|Multi[- ]?Family|Condo|Townhouse|Townhome|Manufactured|Mobile|Lot|Land|Duplex|Triplex|Quadruplex|Apartment)/i));
  set('daysOnMarket', num(m(/(\d+)\s*days?\s*on\s*(?:Zillow|Redfin|market|Realtor)/i)));
  // County appraisal district pages (TAD, DCAD, HCAD…): appraised / market value.
  set('countyValue', num(m(/(?:Total\s+)?(?:Appraised|Market|Assessed)\s+Value[^$\d]{0,40}\$?([\d,]{4,})/i)));
  set('landValue', num(m(/Land\s+Value[^$\d]{0,30}\$?([\d,]{3,})/i)));
  set('improvementValue', num(m(/Improvement\s+Value[^$\d]{0,30}\$?([\d,]{3,})/i)));
  if (/zillow|redfin|realtor|homes\.com/i.test(location.hostname)) out.countyValue = null;
  if (/propwire|dealsauce|propstream|privy/i.test(location.hostname)) set('zestimate', num(m(/(?:Estimated value|Est\. value|AVM|Estimated equity value|Value)[:\s]*\$([\d,]{4,})/i)));
  if (/press\s*&?\s*hold|are you a human|verify you are a human|captcha|access to this page has been denied/i.test(text)) out.blocked = true;
  return out;
}

const EXTRACT_JS = `(${pageExtractor.toString()})()`;

module.exports = { EXTRACT_JS, pageExtractor };
