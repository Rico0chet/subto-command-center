const test = require('node:test');
const assert = require('node:assert');
const { pageExtractor } = require('../electron/listing');
let P, U;
test.before(async () => { P = await import('../src/calc/prefill.mjs'); U = await import('../src/calc/underwrite.mjs'); });

const lead602 = {
  address: '602 E Texas St, Grapevine, TX 76051', price: null, units: '4', yearBuilt: '1982', propertyType: 'Multifamily (4 units)', title: '',
  extra: 'Column 5: Search Google\nCounty: Tarrant', listName: 'MF Lists - Texas List 06', owner: 'Greg Windham',
  highlights: [{ label: 'Source', value: 'No Loan / Free & Clear' }, { label: 'Class', value: 'C' }, { label: 'Occupancy', value: '0' }],
};

test('a lead list row fills type, units and suggests seller finance for a free & clear owner', () => {
  const r = P.buildPrefill({ lead: lead602, current: U.blankInput() });
  assert.strictEqual(r.patch.type, 'smf');
  assert.strictEqual(r.patch.units, '4');
  assert.strictEqual(r.patch.address, '602 E Texas St, Grapevine, TX 76051');
  assert.strictEqual(r.patch.strategy, 'seller');
  assert.deepStrictEqual(r.suggestions.map((x) => x.id), ['seller', 'dscr', 'cash']);
  assert.ok(r.facts.some(([k, v]) => k === 'Loan' && /Free & clear/.test(v)));
  assert.ok(r.facts.some(([k, v]) => k === 'Year built' && v === '1982'));
  assert.strictEqual(r.sources.units, 'Lead list: MF Lists - Texas List 06');
});

test('Zillow facts fill the rest, never over what you typed, and lead numbers win', () => {
  const cur = { ...U.blankInput(), insuranceYr: '2000' };
  const listing = { site: 'zillow.com', price: 650000, zestimate: 700000, sqft: 3200, taxesYr: 11000, insuranceYr: 3100, hoaMo: 0, rentEstimate: 1450, homeType: 'MULTI_FAMILY', units: 4, beds: 8, baths: 4, yearBuilt: 1982, status: 'FOR_SALE', rate30: 6.4 };
  const r = P.buildPrefill({ lead: { ...lead602, price: 620000 }, listing, current: cur });
  assert.strictEqual(r.patch.price, '620000'); // lead list beats the website
  assert.strictEqual(r.patch.arv, '700000');
  assert.strictEqual(r.patch.taxesYr, '11000');
  assert.strictEqual(r.patch.insuranceYr, undefined); // you typed 2000
  assert.deepStrictEqual(r.patch.rents, [{ label: 'Unit', rent: '1450', count: '4' }]);
  assert.match(r.sources.rents, /check/);
  assert.ok(r.facts.some(([k]) => k === 'Beds / baths'));
  // The result runs cleanly through the calculator.
  const a = U.analyze({ ...cur, ...r.patch });
  assert.strictEqual(a.strategy, 'seller');
  assert.ok(Number.isFinite(a.summary.cfMo));
});

test('property type from site wording and unit counts', () => {
  assert.strictEqual(P.typeFromFacts({ homeType: 'SINGLE_FAMILY' }), 'sf');
  assert.strictEqual(P.typeFromFacts({ homeType: 'MULTI_FAMILY', units: 12 }), 'mf');
  assert.strictEqual(P.typeFromFacts({ homeType: 'MANUFACTURED' }), 'mobile');
  assert.strictEqual(P.typeFromFacts({ leadType: 'Mobile home park' }), 'mhp');
  assert.strictEqual(P.typeFromFacts({ homeType: 'LOT' }), 'land');
  assert.strictEqual(P.typeFromFacts({ homeType: 'Duplex' }), 'smf');
  assert.deepStrictEqual(P.suggestStructures({ type: 'sf' }).map((x) => x.id), ['subto', 'hybrid', 'seller', 'dscr']);
  assert.deepStrictEqual(P.suggestStructures({ type: 'business' }).map((x) => x.id), ['sba', 'seller', 'cash']);
});

test('reads a Zillow page (JSON) and a Redfin-style page (text)', () => {
  const run = (html, nextData, url) => {
    global.location = { href: url, hostname: new URL(url).hostname };
    global.document = {
      title: 't',
      getElementById: (id) => (id === '__NEXT_DATA__' && nextData ? { textContent: JSON.stringify(nextData) } : null),
      querySelectorAll: () => [],
      body: { innerText: html },
    };
    try { return pageExtractor(); } finally { delete global.document; delete global.location; }
  };
  const prop = { price: 650000, zestimate: 700000, rentZestimate: 1450, bedrooms: 8, bathrooms: 4, livingArea: 3200, yearBuilt: 1982, homeType: 'MULTI_FAMILY', homeStatus: 'FOR_SALE',
    taxAnnualAmount: 11000, monthlyHoaFee: null, annualHomeownersInsurance: 3100, resoFacts: { numberOfUnitsTotal: 4 }, address: { streetAddress: '602 E Texas St', city: 'Grapevine', state: 'TX', zipcode: '76051' } };
  const z = run('', { props: { pageProps: { componentProps: { gdpClientCache: JSON.stringify({ 'q': { property: prop } }) } } } }, 'https://www.zillow.com/homedetails/x');
  assert.deepStrictEqual([z.price, z.rentEstimate, z.units, z.taxesYr, z.insuranceYr, z.address, z.site], [650000, 1450, 4, 11000, 3100, '602 E Texas St, Grapevine, TX 76051', 'zillow.com']);
  const rf = run('602 E Texas St\n$649,900\n8 beds\n4 baths\n3,200 sq ft\nBuilt in 1982\nRedfin Estimate $701,233\nHOA dues $0/month\nProperty taxes $10,880\n', null, 'https://www.redfin.com/TX/x');
  assert.deepStrictEqual([rf.price, rf.beds, rf.baths, rf.sqft, rf.yearBuilt, rf.zestimate, rf.taxesYr], [649900, 8, 4, 3200, 1982, 701233, 10880]);
  const blocked = run('Press & Hold to confirm you are a human', null, 'https://www.zillow.com/homes/x');
  assert.strictEqual(blocked.blocked, true);
});

test('a later Zillow fill keeps what the lead list taught (type, units, free & clear, structure)', () => {
  const r1 = P.buildPrefill({ lead: lead602, current: U.blankInput() });
  let cur = { ...U.blankInput(), ...r1.patch, _src: r1.sources, _facts: r1.facts, _suggest: r1.suggestions, _freeClear: r1.freeAndClear };
  const r2 = P.buildPrefill({ listing: { site: 'zillow.com', homeType: 'SINGLE_FAMILY', zestimate: 640000, rentEstimate: 1400 }, current: cur });
  assert.strictEqual(r2.patch.type, undefined);
  assert.strictEqual(r2.patch.strategy, undefined);
  assert.deepStrictEqual(r2.patch.rents, [{ label: 'Unit', rent: '1400', count: '4' }]);
  assert.deepStrictEqual(r2.suggestions.map((x) => x.id), ['seller', 'dscr', 'cash']);
  assert.ok(r2.facts.some(([k]) => k === 'Loan'));
});
