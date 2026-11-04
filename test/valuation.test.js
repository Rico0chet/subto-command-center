const test = require('node:test');
const assert = require('node:assert');
let V, U, P;
test.before(async () => { V = await import('../src/calc/valuation.mjs'); U = await import('../src/calc/underwrite.mjs'); P = await import('../src/calc/prefill.mjs'); });
const near = (a, b, t = 1) => assert.ok(Math.abs(a - b) <= t, `${a} vs ${b}`);

const fourplex = (over = {}) => ({
  ...U.blankInput('smf', 'seller'), units: '4', sqft: '3200',
  rents: [{ label: 'Unit', rent: '1400', count: '4' }], vacancyPct: '5', repairsPct: '5', capexPct: '5', mgmtPct: '8', taxesYr: '9000', insuranceYr: '3600', ...over,
});

test('nothing entered → no value, confidence None', () => {
  const v = V.valueCheck(U.blankInput('sf'));
  assert.strictEqual(v.value, null);
  assert.strictEqual(v.confidence, 'None');
});

test('4-plex: income, comps and estimates blend, income weighted most', () => {
  const v = V.valueCheck(fourplex({
    val_estimates: [{ source: 'Zillow', value: '640000' }, { source: 'Redfin', value: '600000' }],
    val_capRate: '7', val_comps: [{ price: '620000', units: '4' }, { price: '660000', units: '4' }, { price: '575000', units: '4' }], val_county: '400000',
  }));
  // NOI: rent 5600, vacancy 280 → EGI 5320; opex 750 + 300 + 280 + 280 + 425.6 = 2035.6 → NOI 3284.4 × 12 = 39412.8
  near(v.income.noi, 39412.8, 0.01);
  near(v.methods.find((m) => m.id === 'cap').value, 39412.8 / 0.07, 0.01);
  near(v.comps.perUnit, 155000, 0.01);
  near(v.comps.value, 620000, 0.01);
  near(v.est.mid, 620000, 0.01);
  const w = { cap: 0.35, comps: 0.3, est: 0.2 };
  const exp = (563040 * w.cap + 620000 * w.comps + 620000 * w.est) / (w.cap + w.comps + w.est);
  near(v.value, exp, 1);
  assert.strictEqual(v.confidence, 'High'); // 3 methods within 15%
  assert.ok(v.notes.some((x) => /county appraisal/.test(x)));
});

test('house: comps by $/sq ft lead', () => {
  const v = V.valueCheck({ ...U.blankInput('sf'), sqft: '2000', val_comps: [{ price: '400000', sqft: '2000' }, { price: '330000', sqft: '1500' }, { price: '390000', sqft: '1800' }], val_estimates: [{ source: 'Zillow', value: '415000' }] });
  near(v.comps.perSqft, 216.67, 0.01);
  near(v.comps.value, 433333.33, 0.01);
  assert.strictEqual(v.methods.length, 2);
});

test('site estimates are collected per site by the prefill', () => {
  let cur = U.blankInput('sf');
  const r1 = P.buildPrefill({ listing: { site: 'zillow.com', zestimate: 640000 }, current: cur });
  cur = { ...cur, ...r1.patch };
  const r2 = P.buildPrefill({ listing: { site: 'redfin.com', zestimate: 600123 }, current: cur });
  assert.deepStrictEqual(r2.patch.val_estimates, [{ source: 'Zillow', value: '640000' }, { source: 'Redfin', value: '600123' }]);
  const r3 = P.buildPrefill({ listing: { site: 'tad.org', countyValue: 480000 }, current: cur });
  assert.strictEqual(r3.patch.val_county, '480000');
});
