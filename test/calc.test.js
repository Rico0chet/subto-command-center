// Accuracy tests for the underwriting calculator: known answers from amortization tables and lender examples.
const test = require('node:test');
const assert = require('node:assert');
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
let F, U;
test.before(async () => {
  F = await import('../src/calc/finance.mjs');
  U = await import('../src/calc/underwrite.mjs');
});
const met = (r, id) => { const m = r.metrics.find((x) => x.id === id); assert.ok(m, `metric ${id} missing`); return m.value; };

test('payment formula matches amortization tables', () => {
  near(F.pmt(200000, 3.25, 360), 870.41);           // plan example
  near(F.pmt(200000, 6, 360), 1199.10);
  near(F.pmt(250000, 7, 360), 1663.26);
  near(F.pmt(100000, 5, 180), 790.79);
  near(F.pmt(120000, 0, 120), 1000);                 // zero rate
  assert.strictEqual(F.pmt(0, 5, 360), 0);
});

test('remaining balance, payoff months, interest-only', () => {
  near(F.balanceAfter(200000, 6, 360, 60), 186108.71);
  near(F.balanceAfter(200000, 6, 360, 360), 0, 0.05);
  assert.strictEqual(F.monthsToPayoff(200000, 6, F.pmt(200000, 6, 360)), 360);
  assert.strictEqual(F.monthsToPayoff(100000, 6, 400), Infinity); // doesn't cover interest
  near(F.ioPayment(150000, 11), 1375);
  const s = F.splitPayments(200000, 6, 360, 12);
  near(s.interest, 11933.19, 0.05);
  near(s.principal, 2456.01, 0.05);
  near(s.endBalance, 197543.99, 0.05);
});

test('IRR and NPV', () => {
  near(F.irr([-100, 110]), 0.10, 1e-6);
  near(F.irr([-1000, 300, 400, 500]), 0.0889633947, 1e-6);
  assert.strictEqual(F.irr([100, 100]), null);
  near(F.annualize(0.01), 0.12682503, 1e-6);
  near(F.npv(0.1, [-100, 110]), 0, 1e-9);
});

const rental = (over = {}) => ({ ...U.blankInput('sf', 'cash'), price: '200000', closing: '0', rents: [{ label: 'Unit', rent: '2000', count: '1' }],
  vacancyPct: '5', repairsPct: '5', capexPct: '5', mgmtPct: '8', taxesYr: '2400', insuranceYr: '1200', ...over });

test('rental NOI, cap rate, cash-on-cash (cash purchase)', () => {
  const r = U.analyze(rental());
  // EGI 1900; opex 200 + 100 + 100 + 100 + 152 = 652; NOI = 1248 × 12 = 14,976
  near(met(r, 'egi'), 1900);
  near(met(r, 'opex'), 652);
  near(met(r, 'noi'), 14976);
  near(met(r, 'cap'), 0.07488, 1e-9);
  near(met(r, 'coc'), 0.07488, 1e-9);
  near(met(r, 'cfMo'), 1248);
  near(met(r, 'grm'), 200000 / 24000, 1e-9);
  near(met(r, 'beo'), 652 / 2000, 1e-9);
  assert.strictEqual(met(r, 'dscr'), Infinity);
});

test('conventional loan: DSCR, debt yield, cash needed', () => {
  const r = U.analyze(rental({ strategy: 'conventional', loan_ltv: '80', loan_rate: '7', loan_years: '30', loan_points: '0', closing: '4000' }));
  const p = F.pmt(160000, 7, 360);
  near(met(r, 'ds'), p);
  near(met(r, 'dscr'), 14976 / (p * 12), 1e-9);
  near(met(r, 'debtYield'), 14976 / 160000, 1e-9);
  near(met(r, 'cashIn'), 44000);
  near(met(r, 'cfMo'), 1248 - p);
  near(met(r, 'equity'), 40000);
});

test('Subject-To: price, equity, entry fee, payment', () => {
  const r = U.analyze(rental({ strategy: 'subto', arv: '250000', st_balance: '180000', st_rate: '3.25', st_monthsLeft: '300', st_arrears: '6000', st_cashToSeller: '10000', closing: '3000' }));
  const pi = F.pmt(180000, 3.25, 300);
  near(met(r, 'stPrice'), 196000);
  near(met(r, 'stEquity'), 64000);
  near(met(r, 'entry'), 19000);
  near(met(r, 'stPI'), pi);
  near(met(r, 'cashIn'), 19000);
  near(met(r, 'cfMo'), 1248 - pi);
  near(met(r, 'stPrin'), pi - 180000 * 0.0325 / 12);
});

test('Subject-To with P&I typed works out months left', () => {
  const r = U.analyze(rental({ strategy: 'subto', st_balance: '200000', st_rate: '6', st_pi: String(F.pmt(200000, 6, 360)), st_cashToSeller: '0' }));
  assert.strictEqual(met(r, 'stPayoff'), 360);
});

test('entry fee above equity is a red flag', () => {
  const r = U.analyze(rental({ strategy: 'subto', arv: '190000', st_balance: '180000', st_rate: '4', st_monthsLeft: '300', st_cashToSeller: '20000', closing: '2000' }));
  assert.ok(r.flags.some((f) => f.level === 'bad' && /Entry fee/.test(f.text)));
});

test('seller finance with balloon', () => {
  const r = U.analyze(rental({ strategy: 'seller', sf_down: '20000', sf_rate: '5', sf_years: '30', sf_balloon: '5' }));
  const p = F.pmt(180000, 5, 360);
  near(met(r, 'ds'), p);
  near(met(r, 'balloon'), F.balanceAfter(180000, 5, 360, 60));
  assert.ok(!r.flags.some((f) => /Balloon in/.test(f.text)));
  const r3 = U.analyze(rental({ strategy: 'seller', sf_down: '20000', sf_rate: '5', sf_years: '30', sf_balloon: '3' }));
  assert.ok(r3.flags.some((f) => /Balloon in 3 years/.test(f.text)));
});

test('interest-only seller note', () => {
  const r = U.analyze(rental({ strategy: 'seller', sf_down: '20000', sf_rate: '6', sf_io: true }));
  near(met(r, 'ds'), 900);
});

test('hybrid: Subject-To plus seller carry on the equity', () => {
  const r = U.analyze(rental({ strategy: 'hybrid', price: '220000', st_balance: '150000', st_rate: '3', st_monthsLeft: '320', sf_down: '10000', sf_rate: '0', sf_years: '20' }));
  const carry = r.loans.find((l) => l.kind === 'seller');
  near(carry.amount, 60000);
  near(carry.payment, 250);
  near(met(r, 'ds'), F.pmt(150000, 3, 320) + 250);
});

test('wrap: spread, equity, cash after buyer down', () => {
  const r = U.analyze(rental({ strategy: 'wrap', st_balance: '150000', st_rate: '3', st_monthsLeft: '300', st_cashToSeller: '5000', closing: '2000', wr_price: '230000', wr_down: '15000', wr_rate: '8', wr_years: '30' }));
  const w = F.pmt(215000, 8, 360), u = F.pmt(150000, 3, 300);
  near(met(r, 'wrPmt'), w);
  near(met(r, 'spread'), w - u);
  near(met(r, 'wrEquity'), 80000);
  near(met(r, 'wrNetCash'), -8000);
  assert.strictEqual(met(r, 'wrCoc'), Infinity);
});

test('BRRRR: cash left after refinance', () => {
  const r = U.analyze(rental({ strategy: 'brrrr', br_buyWith: 'cash', price: '150000', rehab: '30000', closing: '3000', arv: '240000', br_months: '0', br_refiLtv: '75', br_refiRate: '7', br_refiYears: '30', br_refiCostsPct: '2' }));
  // invested 183,000; new loan 180,000; costs 3,600; returned 176,400; left 6,600
  near(met(r, 'brInvested'), 183000);
  near(met(r, 'brNewLoan'), 180000);
  near(met(r, 'brReturned'), 176400);
  near(met(r, 'brLeft'), 6600);
  near(met(r, 'ds'), F.pmt(180000, 7, 360));
});

test('flip: 70% rule and profit', () => {
  const r = U.analyze(rental({ strategy: 'flip', fl_buyWith: 'cash', price: '150000', rehab: '40000', arv: '300000', closing: '3000', fl_months: '6', fl_holdMo: '500', fl_sellPct: '8' }));
  near(met(r, 'mao'), 170000);
  // cost = 150000 + 40000 + 3000 + 3000 holding + 24000 selling = 220000; profit 80000; cash 196000
  near(met(r, 'flCost'), 220000);
  near(met(r, 'flProfit'), 80000);
  near(met(r, 'flCash'), 196000);
});

test('wholesale: max contract price', () => {
  const r = U.analyze(rental({ strategy: 'wholesale', price: '140000', arv: '300000', rehab: '40000', ws_fee: '15000' }));
  near(met(r, 'buyerMax'), 170000);
  near(met(r, 'mao'), 155000);
  near(met(r, 'room'), 15000);
});

test('novation profit', () => {
  const r = U.analyze(rental({ strategy: 'novation', price: '200000', arv: '300000', rehab: '10000', nv_agentPct: '6', nv_sellPct: '2', nv_sellerNet: '230000', nv_months: '3', nv_holdMo: '0' }));
  near(met(r, 'nvProfit'), 300000 - 18000 - 6000 - 10000 - 230000);
});

test('multifamily: reserves per unit and expense ratio', () => {
  const r = U.analyze({ ...U.blankInput('mf', 'cash'), price: '1000000', closing: '0', rents: [{ label: '1BR', rent: '1000', count: '10' }],
    vacancyPct: '7', repairsPct: '5', mgmtPct: '5', reservesUnit: '300', taxesYr: '12000', insuranceYr: '6500' });
  // GPI 10,000; vac 700; EGI 9,300; opex: tax 1000 + ins 541.67 + R&M 500 + mgmt 465 + reserves 250 = 2756.67
  near(met(r, 'opex'), 2756.67, 0.01);
  near(met(r, 'noi'), (9300 - 2756.6667) * 12, 0.05);
  near(met(r, 'ppu'), 100000);
});

test('taxes as % of price follow the price', () => {
  const r = U.analyze(rental({ taxesYr: '', taxesPct: '1.5' }));
  const line = r.metrics.find((m) => m.id === 'opex');
  assert.match(line.work, /Property taxes \$250\.00/);
});

test('max offer solver: lowest test wins', () => {
  const i = rental({ strategy: 'conventional', loan_ltv: '80', loan_rate: '7', loan_years: '30', loan_points: '0', closing: '0', tgt_cf: '200', tgt_coc: '8', tgt_dscr: '1.2' });
  const r = U.analyze(i);
  const mo = r.maxOffer;
  assert.ok(mo.binding);
  const at = U.analyze({ ...i, price: String(mo.binding.max) });
  assert.ok(at.summary.cfMo >= 200 - 0.5 && at.summary.coc >= 0.08 - 1e-4 && at.summary.dscr >= 1.2 - 1e-4);
  const over = U.analyze({ ...i, price: String(mo.binding.max + 500) });
  assert.ok(over.summary.cfMo < 200 || over.summary.coc < 0.08 || over.summary.dscr < 1.2);
});

test('STR: revenue from nightly rate and break-even', () => {
  const r = U.analyze({ ...U.blankInput('str', 'cash'), price: '300000', closing: '0', str_adr: '200', str_occ: '60', str_stayNights: '3', str_cleanFee: '100',
    str_platformPct: '3', str_cleanCost: '100', str_suppliesPct: '0', str_mgmtPct: '0', str_utilMo: '300', repairsPct: '0', capexPct: '0', taxesYr: '3600', insuranceYr: '2400', str_allowed: true });
  const nights = 365 / 12 * 0.6, stays = nights / 3;
  const rev = 200 * nights + 100 * stays;
  near(met(r, 'gpi'), rev);
  const opex = rev * 0.03 + 100 * stays + 300 + 300 + 200;
  near(met(r, 'opex'), opex);
  assert.ok(!r.flags.some((f) => /not confirmed/.test(f.text)));
  // At break-even occupancy, revenue minus costs = 0 (cleaning and platform scale with occupancy).
  const be = met(r, 'beo');
  const n2 = 365 / 12 * be, s2 = n2 / 3, rev2 = 200 * n2 + 100 * s2;
  near(rev2 - (rev2 * 0.03 + 100 * s2 + 800), 0, 0.01);
});

test('STR uses the average of site estimates when chosen and flags unconfirmed rules', () => {
  const r = U.analyze({ ...U.blankInput('str', 'cash'), price: '300000', taxesYr: '0', insuranceYr: '0', str_use: 'avg',
    str_estimates: [{ source: 'AirDNA', revenue: '40000' }, { source: 'Rabbu', revenue: '50000' }, { source: 'AirROI', revenue: '' }] });
  near(met(r, 'gpi'), 45000 / 12);
  near(met(r, 'estAvg'), 45000);
  assert.ok(r.flags.some((f) => /not confirmed/.test(f.text)));
});

test('business: SDE, EBITDA, SBA DSCR, payback', () => {
  const r = U.analyze({ ...U.blankInput('business', 'sba'), price: '500000', closing: '15000', biz_revenue: '1000000', biz_netProfit: '100000', biz_ownerSalary: '60000', biz_addbacks: '10000', biz_interest: '5000', biz_depr: '15000', biz_taxes: '20000',
    sba_downPct: '10', sn_pct: '0', sba_rate: '10.5', sba_years: '10', biz_newSalary: '50000' });
  near(met(r, 'sde'), 190000);
  near(met(r, 'ebitda'), 140000);
  const p = F.pmt(450000, 10.5, 120);
  near(met(r, 'ds'), p);
  near(met(r, 'dscr'), 140000 / (p * 12), 1e-9);
  near(met(r, 'cashIn'), 65000);
  near(met(r, 'payback'), 65000 / (140000 - p * 12), 1e-9);
});

test('land: note payment and IRR', () => {
  const r = U.analyze({ ...U.blankInput('land', 'cash'), price: '10000', closing: '1000', acres: '5', land_sellPrice: '30000', land_down: '3000', land_rate: '10', land_months: '60', land_sellCosts: '0' });
  const np = F.pmt(27000, 10, 60);
  near(met(r, 'notePmt'), np);
  near(met(r, 'ppa'), 2000);
  near(met(r, 'netIn'), 8000);
  const flows = [-8000, ...Array(60).fill(np)];
  near(met(r, 'irr'), F.annualize(F.irr(flows)), 1e-9);
});

test('what-if table: 6 rows, rent and rate move the right way', () => {
  const rows = U.whatIf(rental({ strategy: 'conventional', loan_ltv: '80', loan_rate: '7', closing: '0' }));
  assert.strictEqual(rows.length, 6);
  const base = rows.find((r) => r.rent === 'As entered' && r.rate === 'As entered');
  const up = rows.find((r) => r.rent === '+10%' && r.rate === 'As entered');
  const rate = rows.find((r) => r.rent === 'As entered' && r.rate === '+1%');
  assert.ok(up.cfMo > base.cfMo && rate.cfMo < base.cfMo);
});

test('a rate bump never changes a Subject-To loan', () => {
  const i = rental({ strategy: 'subto', st_balance: '150000', st_rate: '3', st_monthsLeft: '300', st_cashToSeller: '0' });
  const rows = U.whatIf(i);
  near(rows[0].cfMo, rows[1].cfMo);
});

test('missing inputs are reported, not guessed', () => {
  const r = U.analyze({ ...U.blankInput('sf', 'cash') });
  const keys = r.missing.map((m) => m.key);
  for (const k of ['price', 'rents', 'taxesYr', 'insuranceYr']) assert.ok(keys.includes(k), k);
});

test('every strategy for every type runs without NaN', () => {
  for (const t of U.PROPERTY_TYPES) {
    for (const s of U.strategiesFor(t.id)) {
      const r = U.analyze({ ...U.blankInput(t.id, s.id), price: '200000', arv: '260000', rehab: '20000', rents: [{ label: 'u', rent: '1800', count: '1' }], taxesYr: '2400', insuranceYr: '1200',
        st_balance: '150000', st_rate: '3.25', st_monthsLeft: '300', st_cashToSeller: '10000', wr_price: '240000', wr_rate: '8', str_adr: '180', biz_netProfit: '120000', land_sellPrice: '40000' });
      for (const m of r.metrics) assert.ok(!(typeof m.value === 'number' && Number.isNaN(m.value)), `${t.id}/${s.id}/${m.id} is NaN`);
    }
  }
});
