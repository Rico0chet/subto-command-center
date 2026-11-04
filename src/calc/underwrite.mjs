// The underwriting engine. One function, analyze(input), turns the form into results.
// Every result carries its formula and the numbers that went into it, for the ⓘ popups.
import { pmt, ioPayment, balanceAfter, monthsToPayoff, irr, annualize, solveMax } from './finance.mjs';

export const PROPERTY_TYPES = [
  { id: 'sf', label: 'Single family', group: 'rental' },
  { id: 'smf', label: 'Small multifamily (2–4 units)', group: 'rental' },
  { id: 'mf', label: 'Multifamily (5+ units)', group: 'rental' },
  { id: 'commercial', label: 'Commercial (retail, office, industrial, storage)', group: 'rental' },
  { id: 'mhp', label: 'Mobile home park', group: 'rental' },
  { id: 'mobile', label: 'Mobile home (single)', group: 'rental' },
  { id: 'str', label: 'Short-term rental (Airbnb / VRBO)', group: 'str' },
  { id: 'business', label: 'Business', group: 'business' },
  { id: 'land', label: 'Land', group: 'land' },
];

export const STRATEGIES = [
  { id: 'subto', label: 'Subject-To', hint: "Keep the seller's loan in place and take over the payments." },
  { id: 'seller', label: 'Seller finance', hint: 'The seller is the bank: you pay them a down payment and monthly payments.' },
  { id: 'hybrid', label: 'Hybrid (Subject-To + seller carry)', hint: "Take over the loan, and the seller carries their equity as a second note." },
  { id: 'wrap', label: 'Wraparound (sell on terms)', hint: "Buy Subject-To, then sell to a buyer on a new note that 'wraps' the existing loan. You keep the spread." },
  { id: 'cash', label: 'Cash', hint: 'All cash, no loan.' },
  { id: 'conventional', label: 'Conventional loan', hint: 'Bank loan: down payment plus a 30-year mortgage.' },
  { id: 'dscr', label: 'DSCR loan', hint: "Investor loan qualified on the property's rent, not your income." },
  { id: 'hard', label: 'Hard money (hold)', hint: 'Short-term, interest-only private loan.' },
  { id: 'brrrr', label: 'BRRRR (rehab + refinance)', hint: 'Buy, rehab, rent, refinance to pull your cash back out, repeat.' },
  { id: 'flip', label: 'Fix & flip', hint: 'Buy, rehab and resell. Uses the 70% rule for max offer.' },
  { id: 'wholesale', label: 'Wholesale (assignment)', hint: 'Put it under contract and assign the contract to a buyer for a fee.' },
  { id: 'novation', label: 'Novation', hint: "Fix it up and sell it on the open market for the seller; you keep the difference over the seller's net." },
  { id: 'sba', label: 'SBA loan + seller note', hint: 'Typical business purchase: ~10% down, SBA 7(a) loan, optional seller note.' },
];

const BY_GROUP = {
  rental: ['subto', 'seller', 'hybrid', 'wrap', 'cash', 'conventional', 'dscr', 'hard', 'brrrr', 'flip', 'wholesale', 'novation'],
  str: ['subto', 'seller', 'hybrid', 'cash', 'conventional', 'dscr', 'hard', 'brrrr'],
  business: ['sba', 'seller', 'cash'],
  land: ['cash', 'seller', 'subto', 'wholesale'],
};
export const groupOf = (type) => (PROPERTY_TYPES.find((t) => t.id === type) || PROPERTY_TYPES[0]).group;
export const strategiesFor = (type) => BY_GROUP[groupOf(type)].map((id) => STRATEGIES.find((s) => s.id === id));
const MULTI = new Set(['mf', 'commercial', 'mhp']);

export function blankInput(type = 'sf', strategy = 'subto') {
  return {
    type, strategy, name: '', address: '', units: '', sqft: '', acres: '', price: '', arv: '', rehab: '', closing: '',
    rents: [{ label: type === 'mhp' ? 'Lot' : 'Unit 1', rent: '', count: '1' }], otherIncome: '',
    vacancyPct: '', repairsPct: '', capexPct: '', mgmtPct: '', reservesUnit: '', taxesYr: '', taxesPct: '', insuranceYr: '', hoaMo: '', utilitiesMo: '', otherExpMo: '',
    str_adr: '', str_occ: '', str_stayNights: '', str_cleanFee: '', str_platformPct: '', str_cleanCost: '', str_suppliesPct: '', str_utilMo: '', str_mgmtPct: '', str_furnish: '',
    str_estimates: [{ source: 'AirDNA', revenue: '' }, { source: 'Rabbu', revenue: '' }, { source: 'AirROI', revenue: '' }], str_use: 'calc', str_allowed: false, str_ltrRent: '',
    biz_revenue: '', biz_netProfit: '', biz_ownerSalary: '', biz_addbacks: '', biz_interest: '', biz_depr: '', biz_taxes: '', biz_multiple: '', biz_newSalary: '',
    loan_ltv: '', loan_rate: '', loan_years: '', loan_points: '',
    hm_pctPrice: '', hm_pctRehab: '', hm_rate: '', hm_points: '',
    st_balance: '', st_rate: '', st_monthsLeft: '', st_pi: '', st_arrears: '', st_cashToSeller: '',
    sf_down: '', sf_rate: '', sf_years: '', sf_balloon: '', sf_io: false,
    wr_price: '', wr_down: '', wr_rate: '', wr_years: '', wr_balloon: '',
    br_buyWith: 'hard', br_months: '', br_refiLtv: '', br_refiRate: '', br_refiYears: '', br_refiCostsPct: '',
    fl_buyWith: 'hard', fl_months: '', fl_holdMo: '', fl_sellPct: '',
    rule_pct: '', ws_fee: '',
    nv_agentPct: '', nv_sellPct: '', nv_sellerNet: '', nv_months: '', nv_holdMo: '',
    jv_split: '',
    sba_downPct: '', sba_rate: '', sba_years: '', sn_pct: '', sn_rate: '', sn_years: '',
    land_sellPrice: '', land_down: '', land_rate: '', land_months: '', land_sellCosts: '',
    tgt_cf: '', tgt_coc: '', tgt_dscr: '', tgt_cap: '',
    notes: '',
  };
}

// ---------- formatting for the explanations ----------
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
export const fmt = {
  money: (n) => (isNum(n) ? `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}` : '—'),
  money2: (n) => (isNum(n) ? `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'),
  pct: (n, d = 2) => (isNum(n) ? `${(n * 100).toFixed(d)}%` : n === Infinity ? '∞' : '—'),
  ratio: (n) => (isNum(n) ? `${n.toFixed(2)}x` : n === Infinity ? 'No debt' : '—'),
  num: (n, d = 1) => (isNum(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d }) : '—'),
  months: (n) => (isNum(n) ? `${Math.round(n)} mo (${(n / 12).toFixed(1)} yr)` : n === Infinity ? 'Never' : '—'),
  years: (n) => (isNum(n) ? `${n.toFixed(1)} yr` : n === Infinity ? 'Never' : '—'),
};
export function show(value, kind) {
  if (kind === 'money') return fmt.money(value);
  if (kind === 'money2') return fmt.money2(value);
  if (kind === 'pct') return fmt.pct(value);
  if (kind === 'ratio') return fmt.ratio(value);
  if (kind === 'months') return fmt.months(value);
  if (kind === 'years') return fmt.years(value);
  if (kind === 'text') return value;
  return fmt.num(value);
}
const $ = fmt.money, $2 = fmt.money2, P = fmt.pct;

// ---------- reading inputs, with defaults that are tracked ----------
function reader(input) {
  const assumed = [];
  const missing = [];
  const num = (k) => {
    const v = input[k];
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(/[$,%\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  // Value typed by the user, or a default that gets listed as an assumption.
  const get = (k, def, label, unit = '') => {
    const n = num(k);
    if (n != null) return n;
    if (def == null) return null;
    assumed.push({ key: k, label, value: unit === '%' ? `${def}%` : unit === '$' ? $(def) : `${def}${unit ? ` ${unit}` : ''}` });
    return def;
  };
  const need = (k, label) => {
    const n = num(k);
    if (n == null) missing.push({ key: k, label });
    return n == null ? 0 : n;
  };
  return { num, get, need, assumed, missing };
}

const NEW_LOAN_KINDS = new Set(['new', 'hard', 'refi', 'sba']);

// ---------- main ----------
export function analyze(input, opts = {}) {
  const rentFactor = opts.rentFactor ?? 1;
  const rateBump = opts.rateBump ?? 0;
  const R = reader(input);
  const type = input.type || 'sf';
  const group = groupOf(type);
  const allowed = BY_GROUP[group];
  const strategy = allowed.includes(input.strategy) ? input.strategy : allowed[0];
  const metrics = [];
  const flags = [];
  const loans = [];
  const cashLines = [];
  const add = (group_, id, label, value, kind, formula, work, note) => metrics.push({ group: group_, id, label, value, kind, formula, work, note });
  const flag = (level, text) => flags.push({ level, text });
  const rate = (r, kind) => r + (NEW_LOAN_KINDS.has(kind) ? rateBump : 0);

  const out = { type, group, strategy, metrics, flags, loans, cashLines, assumed: R.assumed, missing: R.missing, summary: {}, _noSolve: !!opts._solving };

  if (group === 'business') return business(input, R, out, { add, flag, rate, rentFactor, strategy });
  if (group === 'land') return land(input, R, out, { add, flag, rate, strategy });

  // ---------------- property basics ----------------
  const isSubtoLike = strategy === 'subto' || strategy === 'wrap';
  const rehab = R.num('rehab') || 0;
  let price;
  let B = 0, stRate = 0, stPI = 0, stMonths = 0, arrears = 0, cashToSeller = 0;
  if (['subto', 'wrap', 'hybrid'].includes(strategy)) {
    B = R.need('st_balance', 'Loan balance');
    stRate = R.need('st_rate', 'Loan interest rate');
    arrears = R.num('st_arrears') || 0;
    const piTyped = R.num('st_pi');
    const left = R.num('st_monthsLeft');
    if (piTyped != null) {
      stPI = piTyped;
      stMonths = left != null ? left : monthsToPayoff(B, stRate, stPI);
    } else {
      stMonths = R.need('st_monthsLeft', 'Months left on the loan (or the monthly P&I)');
      stPI = pmt(B, stRate, stMonths);
    }
  }
  if (isSubtoLike) {
    cashToSeller = R.num('st_cashToSeller') || 0;
    price = B + arrears + cashToSeller;
  } else {
    price = R.need('price', 'Purchase price');
  }
  const value = R.num('arv') ?? price;
  if (R.num('arv') == null && ['flip', 'brrrr', 'wholesale', 'novation'].includes(strategy)) R.missing.push({ key: 'arv', label: 'After-repair value (ARV)' });
  const closing = R.get('closing', Math.round(price * 0.02), 'Buyer closing costs (2% of price)', '$');

  // ---------------- income & expenses ----------------
  const ops = group === 'str' ? strOps(input, R, { rentFactor, price }) : rentalOps(input, R, { rentFactor, type, price });
  const units = ops.units;

  // ---------------- financing by strategy ----------------
  let cashIn = 0;
  let ds = 0; // monthly debt service while holding
  const cashLine = (label, amount) => { if (amount) cashLines.push({ label, amount }); cashIn += amount; };
  const furnish = group === 'str' ? R.get('str_furnish', 0, 'Furnishing & setup', '$') : 0;

  const addLoan = (l) => { loans.push(l); return l; };
  let holdNoi = ops.noiYr; // NOI used for hold metrics
  let afterRefi = null;

  if (strategy === 'cash') {
    cashLine('Purchase price', price); cashLine('Closing costs', closing); cashLine('Rehab', rehab); cashLine('Furnishing', furnish);
  } else if (strategy === 'conventional' || strategy === 'dscr') {
    const isD = strategy === 'dscr';
    const ltv = R.get('loan_ltv', isD ? 75 : 80, 'Loan-to-value', '%');
    const r = rate(R.get('loan_rate', isD ? 7.75 : 7.0, 'Interest rate (check today’s rates)', '%'), 'new');
    const yrs = R.get('loan_years', 30, 'Loan term', 'years');
    const pts = R.get('loan_points', isD ? 1 : 0, 'Points', '%');
    const amt = price * ltv / 100;
    const p = pmt(amt, r, yrs * 12);
    addLoan({ kind: 'new', label: isD ? 'DSCR loan' : 'Conventional loan', amount: amt, rate: r, months: yrs * 12, payment: p,
      work: `${$(price)} × ${ltv}% = ${$(amt)}; ${r}% for ${yrs} yr → ${$2(p)}/mo` });
    ds = p;
    cashLine('Down payment', price - amt); cashLine('Closing costs', closing); cashLine(`Points (${pts}%)`, amt * pts / 100); cashLine('Rehab', rehab); cashLine('Furnishing', furnish);
  } else if (strategy === 'hard') {
    const hm = hardMoney(R, price, rehab, rate);
    addLoan(hm.loan); ds = hm.loan.payment;
    cashLine('Price + rehab not covered by the loan', price + rehab - hm.loan.amount); cashLine('Closing costs', closing); cashLine(`Points (${hm.points}%)`, hm.pointsCost); cashLine('Furnishing', furnish);
    flag('warn', 'Hard money is short-term (usually 6–18 months). Plan the refinance or sale before it comes due.');
  } else if (strategy === 'subto' || strategy === 'wrap') {
    addLoan({ kind: 'existing', label: "Seller's existing loan (Subject-To)", amount: B, rate: stRate, months: stMonths, payment: stPI,
      work: R.num('st_pi') != null ? `You entered P&I of ${$2(stPI)}/mo` : `${$(B)} at ${stRate}% over ${stMonths} months left → ${$2(stPI)}/mo` });
    ds = stPI;
    cashLine('Cash to seller', cashToSeller); cashLine('Back payments (arrears)', arrears); cashLine('Closing costs', closing); cashLine('Rehab', rehab); cashLine('Furnishing', furnish);
  } else if (strategy === 'seller' || strategy === 'hybrid') {
    const downDefault = strategy === 'hybrid' ? 0 : Math.round(price * 0.1);
    const down = R.get('sf_down', downDefault, strategy === 'hybrid' ? 'Down payment to seller' : 'Down payment to seller (10% of price)', '$');
    const r = R.get('sf_rate', strategy === 'hybrid' ? 0 : 5, 'Seller note rate', '%');
    const yrs = R.get('sf_years', 30, 'Seller note amortization', 'years');
    const balloonYrs = R.num('sf_balloon');
    const io = !!input.sf_io;
    if (strategy === 'hybrid') {
      addLoan({ kind: 'existing', label: "Seller's existing loan (Subject-To)", amount: B, rate: stRate, months: stMonths, payment: stPI,
        work: R.num('st_pi') != null ? `You entered P&I of ${$2(stPI)}/mo` : `${$(B)} at ${stRate}% over ${stMonths} months left → ${$2(stPI)}/mo` });
      ds += stPI;
    }
    const noteAmt = Math.max(0, price - down - (strategy === 'hybrid' ? B + arrears : 0));
    const p = io ? ioPayment(noteAmt, r) : pmt(noteAmt, r, yrs * 12);
    const balloon = balloonYrs ? (io ? noteAmt : balanceAfter(noteAmt, r, yrs * 12, balloonYrs * 12, p)) : null;
    addLoan({ kind: 'seller', label: strategy === 'hybrid' ? 'Seller carry (2nd note on their equity)' : 'Seller-financed note', amount: noteAmt, rate: r, months: yrs * 12, payment: p, io,
      balloonMonths: balloonYrs ? balloonYrs * 12 : null, balloon,
      work: `${strategy === 'hybrid' ? `${$(price)} − ${$(down)} down − ${$(B + arrears)} existing loan & arrears` : `${$(price)} − ${$(down)} down`} = ${$(noteAmt)}; ${r}% ${io ? 'interest-only' : `over ${yrs} yr`} → ${$2(p)}/mo` });
    ds += p;
    cashLine('Down payment to seller', down); if (strategy === 'hybrid') cashLine('Back payments (arrears)', arrears);
    cashLine('Closing costs', closing); cashLine('Rehab', rehab); cashLine('Furnishing', furnish);
    if (strategy === 'hybrid' && price < B + arrears) flag('bad', 'Price is less than the loan balance plus arrears. Check the numbers.');
  } else if (strategy === 'brrrr') {
    afterRefi = brrrr(input, R, { price, rehab, closing, value, ops, rate, addLoan, flag, cashLine, add, furnish });
    cashIn = afterRefi.cashLeft;
    ds = afterRefi.payment;
  } else if (strategy === 'flip' || strategy === 'novation' || strategy === 'wholesale') {
    // Not a hold: handled below.
  }

  // ---------------- income section (holds) ----------------
  const isHold = !['flip', 'wholesale', 'novation', 'wrap'].includes(strategy);
  if (isHold || strategy === 'wrap') addIncomeMetrics(add, ops, group);

  // ---------------- hold metrics ----------------
  if (isHold) {
    const dsYr = ds * 12;
    const cfMo = holdNoi / 12 - ds;
    const cfYr = cfMo * 12;
    const totalDebt = loans.filter((l) => l.kind !== 'receivable' && l.kind !== 'hard-paidoff').reduce((s, l) => s + l.amount, 0);
    const debtNow = afterRefi ? afterRefi.newLoan : totalDebt;
    add('Cash flow', 'ds', 'Debt service', ds, 'money2', 'Sum of monthly loan payments (principal + interest)',
      loans.filter((l) => l.kind !== 'hard-paidoff').map((l) => `${l.label}: ${$2(l.payment)}`).join(' + ') || 'No loans', 'Taxes and insurance are counted in expenses, not here, so they are never counted twice.');
    add('Cash flow', 'cfMo', 'Cash flow / month', cfMo, 'money', 'NOI ÷ 12 − monthly debt service', `${$(holdNoi)} ÷ 12 − ${$2(ds)} = ${$2(cfMo)}`, 'What lands in your pocket each month after every expense and loan payment.');
    add('Cash flow', 'cfYr', 'Cash flow / year', cfYr, 'money', 'Monthly cash flow × 12', `${$2(cfMo)} × 12 = ${$(cfYr)}`);
    if (units > 1) add('Cash flow', 'cfDoor', 'Cash flow per door / month', cfMo / units, 'money', 'Monthly cash flow ÷ units', `${$2(cfMo)} ÷ ${units} = ${$2(cfMo / units)}`);
    add('Returns', 'cashIn', strategy === 'brrrr' ? 'Cash left in the deal' : 'Cash needed to close', cashIn, 'money',
      strategy === 'brrrr' ? 'Cash invested − cash returned at refinance' : 'Sum of everything you pay out of pocket',
      strategy === 'brrrr' ? `${$(afterRefi.invested)} − ${$(afterRefi.returned)} = ${$(cashIn)}` : cashLines.map((c) => `${c.label} ${$(c.amount)}`).join(' + ') || '$0');
    const coc = cashIn > 0 ? cfYr / cashIn : (cfYr > 0 ? Infinity : null);
    add('Returns', 'coc', 'Cash-on-cash return', coc, 'pct', 'Annual cash flow ÷ cash in the deal',
      cashIn > 0 ? `${$(cfYr)} ÷ ${$(cashIn)} = ${P(coc)}` : 'You have no cash left in the deal, so the return is unlimited (∞) as long as it cash flows.',
      'The yearly return on the cash you actually put in. 8–12% is a common target for rentals.');
    const cap = price > 0 ? holdNoi / price : null;
    add('Returns', 'cap', 'Cap rate (on price)', cap, 'pct', 'NOI ÷ purchase price', `${$(holdNoi)} ÷ ${$(price)} = ${P(cap)}`, 'The return if you bought it all cash. Lets you compare properties regardless of financing.');
    if (afterRefi || rehab > 0) {
      const allIn = price + rehab + closing;
      add('Returns', 'yoc', 'Yield on cost', holdNoi / allIn, 'pct', 'NOI ÷ (price + rehab + closing)', `${$(holdNoi)} ÷ ${$(allIn)} = ${P(holdNoi / allIn)}`, 'Cap rate on everything you spent. Aim for 1–1.5 points above the market cap rate.');
    }
    const dscr = dsYr > 0 ? holdNoi / dsYr : Infinity;
    add('Debt', 'dscr', 'DSCR', dscr, 'ratio', 'NOI ÷ annual debt service', dsYr > 0 ? `${$(holdNoi)} ÷ ${$(dsYr)} = ${fmt.ratio(dscr)}` : 'No loan payments.',
      'Debt service coverage ratio: how many times the income covers the loan payments. Lenders want 1.20x–1.25x or more.');
    if (debtNow > 0) {
      add('Debt', 'debtYield', 'Debt yield', holdNoi / debtNow, 'pct', 'NOI ÷ total loan amount', `${$(holdNoi)} ÷ ${$(debtNow)} = ${P(holdNoi / debtNow)}`, 'Commercial lenders usually want 8–10%+.');
      add('Debt', 'ltv', 'Loan-to-value', debtNow / value, 'pct', 'Total loans ÷ property value', `${$(debtNow)} ÷ ${$(value)} = ${P(debtNow / value)}`);
    }
    const equity = value - debtNow - (strategy === 'brrrr' ? 0 : 0);
    add('Debt', 'equity', strategy === 'brrrr' ? 'Equity after refinance' : 'Equity at purchase', equity, 'money', 'Property value − loans', `${$(value)} − ${$(debtNow)} = ${$(equity)}`,
      R.num('arv') != null ? 'Uses the value / ARV you entered.' : 'No value entered, so the purchase price is used as the value.');
    const beo = ops.breakEvenOcc(ds);
    if (beo != null) add('Risk', 'beo', 'Break-even occupancy', beo, 'pct', group === 'str' ? 'Occupancy where revenue just covers expenses + loan payments' : '(Operating expenses + debt service) ÷ gross potential income',
      ops.beoWork(ds), 'Below this occupancy you lose money. Under 85% is the usual comfort line.');
    if (group !== 'str' && ops.gprYr > 0) {
      add('Risk', 'grm', 'Gross rent multiplier', price / ops.gprYr, 'num', 'Price ÷ annual gross rent', `${$(price)} ÷ ${$(ops.gprYr)} = ${fmt.num(price / ops.gprYr, 2)}`, 'Lower is better. Quick screen for comparing rentals in the same area.');
      if (type === 'sf' || type === 'smf' || type === 'mobile') add('Risk', 'onePct', '1% rule', (ops.rentMo) / price, 'pct', 'Monthly rent ÷ price', `${$(ops.rentMo)} ÷ ${$(price)} = ${P(ops.rentMo / price)}`, 'Quick screen: 1% or more usually cash flows with a normal loan. Creative terms can work below it.');
    }
    if (units > 0) add('Risk', 'ppu', MULTI.has(type) || type === 'smf' ? 'Price per unit' : 'Price per door', price / units, 'money', 'Price ÷ units', `${$(price)} ÷ ${units} = ${$(price / units)}`);
    const sqft = R.num('sqft');
    if (sqft) add('Risk', 'ppsf', 'Price per sq ft', price / sqft, 'money2', 'Price ÷ square feet', `${$(price)} ÷ ${fmt.num(sqft, 0)} = ${$2(price / sqft)}`);

    // Lender-style DSCR for DSCR loans: rent ÷ PITIA.
    if (strategy === 'dscr' || (strategy === 'brrrr')) {
      const pitia = ds + ops.taxesMo + ops.insMo + ops.hoaMo;
      const lender = pitia > 0 ? ops.rentMo / pitia : null;
      add('Debt', 'lenderDscr', 'Lender DSCR (rent ÷ PITIA)', lender, 'ratio', 'Monthly rent ÷ (P&I + taxes + insurance + HOA)',
        `${$(ops.rentMo)} ÷ (${$2(ds)} + ${$2(ops.taxesMo)} + ${$2(ops.insMo)} + ${$2(ops.hoaMo)}) = ${fmt.ratio(lender)}`, 'How most DSCR lenders qualify a rental. Most want 1.00x+, better pricing at 1.25x+.');
      if (lender != null && lender < 1) flag('bad', `Lender DSCR is ${fmt.ratio(lender)}. Most DSCR lenders need at least 1.00x.`);
    }

    out.summary = { cfMo, cfYr, cashIn, coc, cap, dscr, noi: holdNoi, equity, price, value };
    if (cfMo < 0) flag('bad', `Negative cash flow: ${$(cfMo)}/month.`);
    if (dsYr > 0 && dscr < 1.2) flag(dscr < 1 ? 'bad' : 'warn', `DSCR is ${fmt.ratio(dscr)}, below 1.20x. Income barely covers (or doesn't cover) the loan payments.`);
    if (beo != null && beo > 0.85) flag('warn', `Break-even occupancy is ${P(beo, 0)}. Above 85% leaves little room for vacancy.`);
    if (MULTI.has(type) && ops.egiYr > 0 && ops.opexYr / ops.egiYr < 0.35) flag('warn', `Expense ratio is ${P(ops.opexYr / ops.egiYr, 0)}. Under ~35% usually means expenses are understated.`);
    if (group !== 'str' && R.num('vacancyPct') != null && R.num('vacancyPct') < 5) flag('warn', 'Vacancy under 5% is optimistic. Most underwriting never goes below 5%.');
    targetsAndMaxOffer(input, out, { add, flag, isHold: true });
  }

  // ---------------- strategy-specific ----------------
  if (strategy === 'subto' || strategy === 'hybrid' || strategy === 'wrap') subtoMetrics({ add, flag, value, B, stRate, stPI, stMonths, arrears, cashToSeller, closing, strategy, price });
  if (strategy === 'seller' || strategy === 'hybrid') balloonCheck({ loans, flag, value, add, B, stRate, stPI, stMonths });
  if (strategy === 'wrap') wrap(input, R, { add, flag, out, B, stRate, stPI, stMonths, cashIn, price });
  if (strategy === 'flip') flip(input, R, { add, flag, out, price, rehab, closing, value, rate, addLoan, ops });
  if (strategy === 'wholesale') wholesale(input, R, { add, flag, out, price, rehab, value });
  if (strategy === 'novation') novation(input, R, { add, flag, out, price, rehab, value, ops });
  if (group === 'str') strExtras(input, R, { add, flag, out, ops, ds, cashIn });
  jvSplit(input, R, { add, out });

  if (R.missing.length) flag('bad', `Missing: ${R.missing.map((m) => m.label).join(', ')}.`);
  if (R.assumed.length) flag('info', `${R.assumed.length} number${R.assumed.length > 1 ? 's are' : ' is a'} default assumption${R.assumed.length > 1 ? 's' : ''}. Replace with real numbers when you have them.`);
  return out;
}

// ---------- rental operations ----------
function rentalOps(input, R, { rentFactor, type, price }) {
  const multi = MULTI.has(type);
  const rows = (input.rents || []).map((r) => ({ label: r.label, rent: Number(String(r.rent).replace(/[$,]/g, '')) || 0, count: Number(r.count) || (r.count === '' || r.count == null ? 1 : 0) }));
  const rentMo = rows.reduce((s, r) => s + r.rent * r.count, 0) * rentFactor;
  const unitsTyped = R.num('units');
  const units = unitsTyped || rows.reduce((s, r) => s + (r.rent ? r.count : 0), 0) || 1;
  if (rentMo <= 0) R.missing.push({ key: 'rents', label: 'Rent' });
  const other = (R.num('otherIncome') || 0) * rentFactor;
  const gpi = rentMo + other;
  const vacPct = R.get('vacancyPct', multi ? 7 : 5, 'Vacancy', '%');
  const vac = gpi * vacPct / 100;
  const egi = gpi - vac;
  const repPct = R.get('repairsPct', 5, 'Repairs & maintenance (% of rent)', '%');
  const capPct = R.get('capexPct', multi ? 0 : 5, 'CapEx reserve (% of rent)', '%');
  const mgmtPct = R.get('mgmtPct', multi ? 5 : 8, multi ? 'Management (% of collected income)' : 'Property management (% of collected rent)', '%');
  const resUnit = multi ? R.get('reservesUnit', 300, 'Replacement reserves per unit / year', '$') : (R.num('reservesUnit') || 0);
  let taxesYr = R.num('taxesYr');
  let taxWork;
  if (taxesYr == null && R.num('taxesPct') != null) { taxesYr = price * R.num('taxesPct') / 100; taxWork = `${$(price)} × ${R.num('taxesPct')}% = ${$(taxesYr)}/yr`; }
  if (taxesYr == null) { R.missing.push({ key: 'taxesYr', label: 'Property taxes' }); taxesYr = 0; }
  const insYr = R.num('insuranceYr');
  if (insYr == null) R.missing.push({ key: 'insuranceYr', label: 'Insurance' });
  const hoa = R.num('hoaMo') || 0, util = R.num('utilitiesMo') || 0, otherExp = R.num('otherExpMo') || 0;
  const lines = [
    ['Property taxes', taxesYr / 12, taxWork ? `Price × tax rate: ${taxWork}` : `${$(taxesYr)}/yr ÷ 12`],
    ['Insurance', (insYr || 0) / 12, `${$(insYr || 0)}/yr ÷ 12`],
    [type === 'mobile' || type === 'mhp' ? 'HOA / lot rent' : 'HOA', hoa, 'Monthly'],
    ['Utilities (owner-paid)', util, 'Monthly'],
    ['Repairs & maintenance', rentMo * repPct / 100, `${$(rentMo)} × ${repPct}%`],
    ['CapEx reserve', rentMo * capPct / 100, `${$(rentMo)} × ${capPct}%`],
    ['Management', egi * mgmtPct / 100, `${$(egi)} × ${mgmtPct}%`],
    ['Replacement reserves', resUnit * units / 12, `${$(resUnit)} × ${units} units ÷ 12`],
    ['Other expenses', otherExp, 'Monthly'],
  ].filter((l) => l[1]);
  const opexMo = lines.reduce((s, l) => s + l[1], 0);
  const noiMo = egi - opexMo;
  return {
    units, rentMo, other, gpi, vac, vacPct, egi, lines, opexMo, opexYr: opexMo * 12, noiYr: noiMo * 12, gprYr: rentMo * 12, egiYr: egi * 12,
    taxesMo: taxesYr / 12, insMo: (insYr || 0) / 12, hoaMo: hoa,
    breakEvenOcc: (ds) => (gpi > 0 ? (opexMo + ds) / gpi : null),
    beoWork: (ds) => `(${$2(opexMo)} + ${$2(ds)}) ÷ ${$2(gpi)} = ${P((opexMo + ds) / gpi)}`,
  };
}

// ---------- short-term rental operations ----------
function strOps(input, R, { rentFactor, price }) {
  const DPM = 365 / 12;
  const adr = (R.num('str_adr') || 0) * rentFactor;
  const occ = R.get('str_occ', 60, 'Occupancy', '%');
  const stay = R.get('str_stayNights', 3, 'Average stay', 'nights');
  const cleanFee = R.get('str_cleanFee', 0, 'Cleaning fee charged to guests', '$');
  const nights = DPM * occ / 100;
  const stays = stay > 0 ? nights / stay : 0;
  const calcRev = adr * nights + cleanFee * stays;
  const ests = (input.str_estimates || []).map((e) => ({ source: e.source, revenue: Number(String(e.revenue).replace(/[$,]/g, '')) || 0 })).filter((e) => e.revenue > 0);
  const est = ests.length ? {
    low: Math.min(...ests.map((e) => e.revenue)), high: Math.max(...ests.map((e) => e.revenue)), avg: ests.reduce((s, e) => s + e.revenue, 0) / ests.length,
  } : null;
  const use = est && ['low', 'avg', 'high'].includes(input.str_use) ? input.str_use : 'calc';
  const revenue = use === 'calc' ? calcRev : (est[use] * rentFactor) / 12;
  if (use === 'calc' && !adr) R.missing.push({ key: 'str_adr', label: 'Nightly rate (or a revenue estimate)' });
  const revWork = use === 'calc'
    ? `${$2(adr)}/night × ${fmt.num(nights, 1)} nights (${occ}% of ${fmt.num(DPM, 2)} days) + ${$(cleanFee)} cleaning fee × ${fmt.num(stays, 1)} stays = ${$2(calcRev)}`
    : `${use === 'avg' ? 'Average' : use === 'low' ? 'Lowest' : 'Highest'} of ${ests.map((e) => `${e.source} ${$(e.revenue)}`).join(', ')} = ${$(est[use] * rentFactor)}/yr ÷ 12 = ${$2(revenue)}`;
  const platPct = R.get('str_platformPct', 3, 'Platform fee (Airbnb host fee)', '%');
  const cleanCost = R.get('str_cleanCost', 100, 'Cleaning cost per stay', '$');
  const supPct = R.get('str_suppliesPct', 3, 'Supplies & consumables (% of revenue)', '%');
  const mgmtPct = R.get('str_mgmtPct', 0, 'STR management (% of revenue; 20–25% if you hire a manager)', '%');
  const utilMo = R.get('str_utilMo', 300, 'Utilities, internet & streaming', '$');
  const repPct = R.get('repairsPct', 5, 'Repairs & maintenance (% of revenue)', '%');
  const capPct = R.get('capexPct', 5, 'CapEx & furniture replacement (% of revenue)', '%');
  let taxesYr = R.num('taxesYr');
  if (taxesYr == null && R.num('taxesPct') != null) taxesYr = price * R.num('taxesPct') / 100;
  if (taxesYr == null) { R.missing.push({ key: 'taxesYr', label: 'Property taxes' }); taxesYr = 0; }
  const insYr = R.num('insuranceYr');
  if (insYr == null) R.missing.push({ key: 'insuranceYr', label: 'Insurance (STR policy)' });
  const hoa = R.num('hoaMo') || 0, otherExp = R.num('otherExpMo') || 0;
  const varPct = (platPct + supPct + mgmtPct + repPct + capPct) / 100;
  const fixed = taxesYr / 12 + (insYr || 0) / 12 + hoa + utilMo + otherExp;
  const lines = [
    ['Platform fees', revenue * platPct / 100, `${$2(revenue)} × ${platPct}%`],
    ['Cleaning', cleanCost * stays, `${$(cleanCost)} × ${fmt.num(stays, 1)} stays`],
    ['Supplies', revenue * supPct / 100, `${$2(revenue)} × ${supPct}%`],
    ['STR management', revenue * mgmtPct / 100, `${$2(revenue)} × ${mgmtPct}%`],
    ['Repairs & maintenance', revenue * repPct / 100, `${$2(revenue)} × ${repPct}%`],
    ['CapEx & furniture', revenue * capPct / 100, `${$2(revenue)} × ${capPct}%`],
    ['Utilities & internet', utilMo, 'Monthly'],
    ['Property taxes', taxesYr / 12, `${$(taxesYr)}/yr ÷ 12`],
    ['Insurance', (insYr || 0) / 12, `${$(insYr || 0)}/yr ÷ 12`],
    ['HOA', hoa, 'Monthly'],
    ['Other expenses', otherExp, 'Monthly'],
  ].filter((l) => l[1]);
  const opexMo = lines.reduce((s, l) => s + l[1], 0);
  // Cleaning scales with stays; per-dollar-of-revenue cleaning cost:
  const cleanPerRev = revenue > 0 ? (cleanCost * stays) / revenue : 0;
  return {
    units: 1, rentMo: revenue, other: 0, gpi: revenue, vac: 0, vacPct: 0, egi: revenue, lines, opexMo, opexYr: opexMo * 12, noiYr: (revenue - opexMo) * 12, gprYr: revenue * 12, egiYr: revenue * 12,
    taxesMo: taxesYr / 12, insMo: (insYr || 0) / 12, hoaMo: hoa, revWork, est, ests, use, occ, adr, nights, stays,
    breakEvenOcc: (ds) => {
      const denom = 1 - varPct - cleanPerRev;
      if (revenue <= 0 || denom <= 0) return null;
      return (occ / 100) * ((fixed + ds) / denom) / revenue;
    },
    beoWork: (ds) => {
      const denom = 1 - varPct - cleanPerRev;
      const beRev = (fixed + ds) / denom;
      return `Break-even revenue = (fixed costs ${$2(fixed)} + loan ${$2(ds)}) ÷ (1 − ${P(varPct + cleanPerRev, 1)} variable costs) = ${$2(beRev)}/mo. ${$2(beRev)} ÷ ${$2(revenue)} × ${occ}% occupancy = ${P((occ / 100) * beRev / revenue)}`;
    },
  };
}

function addIncomeMetrics(add, ops, group) {
  if (group === 'str') {
    add('Income', 'gpi', 'Gross revenue / month', ops.gpi, 'money', ops.use === 'calc' ? 'Nightly rate × booked nights + cleaning fees' : 'Annual revenue estimate ÷ 12', ops.revWork,
      'Booked nights = occupancy × 30.42 days. Revenue estimates from AirDNA, Rabbu and others are averaged, or use the low or high one.');
  } else {
    add('Income', 'gpi', 'Gross income / month', ops.gpi, 'money', 'Total rent + other income', `${$(ops.rentMo)} rent + ${$(ops.other)} other = ${$(ops.gpi)}`);
    add('Income', 'vac', 'Vacancy & credit loss', ops.vac, 'money', 'Gross income × vacancy %', `${$(ops.gpi)} × ${ops.vacPct}% = ${$(ops.vac)}`);
    add('Income', 'egi', 'Effective gross income / month', ops.egi, 'money', 'Gross income − vacancy', `${$(ops.gpi)} − ${$(ops.vac)} = ${$(ops.egi)}`);
  }
  add('Income', 'opex', 'Operating expenses / month', ops.opexMo, 'money', 'Sum of all operating expenses (not loan payments)',
    ops.lines.map((l) => `${l[0]} ${$2(l[1])}${l[2] && l[2] !== 'Monthly' ? ` (${l[2]})` : ''}`).join(' + '));
  add('Income', 'noi', 'Net operating income (NOI) / year', ops.noiYr, 'money', '(Effective income − operating expenses) × 12', `(${$(ops.egi)} − ${$(ops.opexMo)}) × 12 = ${$(ops.noiYr)}`,
    'Income after expenses and before loan payments. Cap rate and DSCR are built on this.');
  if (ops.egiYr > 0) add('Income', 'expRatio', 'Expense ratio', ops.opexYr / ops.egiYr, 'pct', 'Operating expenses ÷ effective income', `${$(ops.opexYr)} ÷ ${$(ops.egiYr)} = ${P(ops.opexYr / ops.egiYr)}`,
    'Rule of thumb: about 50% for older rentals (the "50% rule"); 35–55% for apartments.');
}

function hardMoney(R, price, rehab, rate) {
  const pp = R.get('hm_pctPrice', 90, 'Hard money: % of price financed', '%');
  const pr = R.get('hm_pctRehab', 100, 'Hard money: % of rehab financed', '%');
  const r = rate(R.get('hm_rate', 11, 'Hard money rate', '%'), 'hard');
  const points = R.get('hm_points', 2, 'Hard money points', '%');
  const amt = price * pp / 100 + rehab * pr / 100;
  const p = ioPayment(amt, r);
  return {
    points, pointsCost: amt * points / 100,
    loan: { kind: 'hard', label: 'Hard money (interest-only)', amount: amt, rate: r, months: 12, payment: p, io: true,
      work: `${$(price)} × ${pp}% + ${$(rehab)} × ${pr}% = ${$(amt)}; ${r}% interest-only → ${$2(p)}/mo` },
  };
}

// ---------- Subject-To ----------
function subtoMetrics({ add, flag, value, B, stRate, stPI, stMonths, arrears, cashToSeller, closing, strategy, price }) {
  const G = 'Subject-To';
  const equity = value - B - arrears;
  const entry = cashToSeller + arrears + closing;
  if (strategy !== 'hybrid') add(G, 'stPrice', 'Purchase price', price, 'money', 'Loan balance + back payments + cash to seller', `${$(B)} + ${$(arrears)} + ${$(cashToSeller)} = ${$(price)}`);
  add(G, 'stEquity', 'Equity you take over', equity, 'money', 'Value − loan balance − back payments', `${$(value)} − ${$(B)} − ${$(arrears)} = ${$(equity)}`);
  add(G, 'entry', 'Entry fee', entry, 'money', 'Cash to seller + back payments + closing', `${$(cashToSeller)} + ${$(arrears)} + ${$(closing)} = ${$(entry)}`, 'Everything it takes to get the keys (rehab not included).');
  add(G, 'stPI', 'Existing loan P&I', stPI, 'money2', "The seller's monthly principal + interest", `${$(B)} at ${stRate}% with ${stMonths} months left`);
  add(G, 'stPayoff', 'Loan paid off in', stMonths, 'months', 'Months left on the existing loan', `${fmt.num(stMonths, 0)} months`);
  const int1 = B * stRate / 100 / 12;
  add(G, 'stPrin', 'Principal paid down / month (now)', stPI - int1, 'money2', 'P&I − this month’s interest', `${$2(stPI)} − (${$(B)} × ${stRate}% ÷ 12 = ${$2(int1)}) = ${$2(stPI - int1)}`, 'Equity you build every month just by making the payment.');
  if (entry > equity) flag('bad', `Entry fee (${$(entry)}) is higher than the equity you get (${$(equity)}).`);
  flag('info', "Subject-To leaves the loan in the seller's name; the lender can call it due on transfer (due-on-sale). Keep payments current and use proper paperwork and insurance.");
}

function balloonCheck({ loans, flag, value, add, B, stRate, stPI, stMonths }) {
  for (const l of loans.filter((x) => x.balloonMonths)) {
    const yrs = l.balloonMonths / 12;
    add('Seller note', 'balloon', `Balloon due in ${fmt.num(yrs, 1)} yr`, l.balloon, 'money', l.io ? 'Interest-only: the full note is due' : 'Note balance left after the balloon date',
      l.io ? `${$(l.amount)}` : `${$(l.amount)} at ${l.rate}% over ${l.months / 12} yr, after ${l.balloonMonths} payments → ${$(l.balloon)}`, 'You must refinance or sell to pay this.');
    const firstAtBalloon = B ? balanceAfter(B, stRate, stMonths, l.balloonMonths, stPI) : 0;
    const refiMax = value * 0.75;
    const owed = l.balloon + firstAtBalloon;
    if (yrs < 3) flag('bad', `Balloon in ${fmt.num(yrs, 1)} years is very short. Lenders often need 1–2 years of seasoning plus time to fix credit or raise money.`);
    else if (yrs < 5) flag('warn', `Balloon in ${fmt.num(yrs, 1)} years: line up the refinance early.`);
    if (owed > refiMax) flag('bad', `At the balloon you'd owe about ${$(owed)}, more than a 75% LTV refinance on today's value (${$(refiMax)}).`);
  }
  for (const l of loans.filter((x) => x.kind === 'seller' && !x.balloonMonths && x.amount > 0)) {
    add('Seller note', 'sfPI', 'Seller note payment', l.payment, 'money2', l.io ? 'Note × rate ÷ 12' : 'Standard amortizing payment', l.work);
  }
}

// ---------- Wraparound ----------
function wrap(input, R, { add, flag, out, B, stRate, stPI, stMonths, cashIn, price }) {
  const G = 'Wrap';
  const wp = R.need('wr_price', 'Wrap sale price');
  const down = R.get('wr_down', 0, 'Buyer down payment', '$');
  const r = R.need('wr_rate', 'Wrap interest rate');
  const yrs = R.get('wr_years', 30, 'Wrap amortization', 'years');
  const balloonYrs = R.num('wr_balloon');
  const note = Math.max(0, wp - down);
  const wpmt = pmt(note, r, yrs * 12);
  const spread = wpmt - stPI;
  out.loans.push({ kind: 'receivable', label: "Wrap note (buyer pays you)", amount: note, rate: r, months: yrs * 12, payment: wpmt,
    work: `${$(wp)} − ${$(down)} down = ${$(note)}; ${r}% over ${yrs} yr → ${$2(wpmt)}/mo` });
  const netCash = cashIn - down;
  add(G, 'wrPmt', 'Buyer pays you / month', wpmt, 'money2', 'Payment on the wrap note (P&I)', `${$(note)} at ${r}% over ${yrs} yr = ${$2(wpmt)}`, 'Taxes and insurance are assumed to be paid by the buyer on top of this, then passed through.');
  add(G, 'spread', 'Monthly spread', spread, 'money2', 'Wrap payment − underlying P&I', `${$2(wpmt)} − ${$2(stPI)} = ${$2(spread)}`, 'Your cash flow each month.');
  add(G, 'wrEquity', 'Equity in the wrap', wp - B, 'money', 'Wrap price − underlying balance', `${$(wp)} − ${$(B)} = ${$(wp - B)}`);
  add(G, 'wrNetCash', 'Your cash in after buyer’s down payment', netCash, 'money', 'Cash to close − buyer down payment', `${$(cashIn)} − ${$(down)} = ${$(netCash)}`, netCash < 0 ? 'Negative means you walk away from closing with cash.' : '');
  const coc = netCash > 0 ? spread * 12 / netCash : (spread > 0 ? Infinity : null);
  add(G, 'wrCoc', 'Cash-on-cash', coc, 'pct', 'Spread × 12 ÷ your net cash in', netCash > 0 ? `${$(spread * 12)} ÷ ${$(netCash)} = ${P(coc)}` : 'No cash left in, so unlimited while the spread is positive.');
  // Life-of-wrap cash flows → IRR and total profit.
  const N = balloonYrs ? Math.round(balloonYrs * 12) : yrs * 12;
  const flows = [-netCash];
  for (let m = 1; m <= N; m++) {
    let f = (m <= yrs * 12 ? wpmt : 0) - (m <= stMonths ? stPI : 0);
    if (m === N) f += balanceAfter(note, r, yrs * 12, N, wpmt) - balanceAfter(B, stRate, stMonths, N, stPI);
    flows.push(f);
  }
  const total = flows.reduce((s, f) => s + f, 0);
  add(G, 'wrProfit', balloonYrs ? `Total profit through the ${balloonYrs}-yr balloon` : 'Total profit over the wrap', total, 'money',
    'Buyer down + all wrap payments + payoff received − underlying payments − payoff of underlying − your cash in',
    `Month by month over ${N} months: wrap ${$2(wpmt)} in, underlying ${$2(stPI)} out (until it's paid off in month ${Math.min(stMonths, N)}), then the remaining balances settle at the end. Total = ${$(total)}`);
  const ir = annualize(irr(flows));
  if (ir != null) add(G, 'wrIrr', 'IRR (annual)', ir, 'pct', 'Internal rate of return on the monthly cash flows', 'Solved from the month-by-month cash flows above.', 'Accounts for timing: money now is worth more than money later.');
  out.summary = { cfMo: spread, cfYr: spread * 12, cashIn: netCash, coc, profit: total, price };
  if (spread < 0) flag('bad', `The wrap payment is ${$2(-spread)}/mo less than the underlying loan payment.`);
  if (r < stRate) flag('warn', `Wrap rate (${r}%) is below the underlying rate (${stRate}%). You lose spread on every dollar.`);
  if (wp < B) flag('bad', 'Wrap price is below the underlying loan balance.');
  if (yrs * 12 < stMonths && !balloonYrs) flag('warn', 'The wrap pays off before the underlying loan. Make sure the final payoff covers what is left.');
  flag('info', "On a wrap you're the buyer's lender. Use a licensed RMLO and a loan servicer, and follow Dodd-Frank/SAFE Act rules.");
}

// ---------- BRRRR ----------
function brrrr(input, R, { price, rehab, closing, value, ops, rate, addLoan, flag, cashLine, add, furnish }) {
  const G = 'BRRRR';
  const months = R.get('br_months', 6, 'Months from purchase to refinance', 'months');
  const withHard = input.br_buyWith !== 'cash';
  let hmAmt = 0, hmInterest = 0, pointsCost = 0;
  if (withHard) {
    const hm = hardMoney(R, price, rehab, rate);
    hm.loan.kind = 'hard-paidoff';
    hm.loan.label = 'Hard money (paid off at refinance)';
    addLoan(hm.loan);
    hmAmt = hm.loan.amount; hmInterest = hm.loan.payment * months; pointsCost = hm.pointsCost;
  }
  const carry = (ops.taxesMo + ops.insMo + ops.hoaMo) * months;
  const invested = price + rehab + closing + pointsCost + hmInterest + carry + furnish - hmAmt;
  cashLine(withHard ? 'Price + rehab not covered by hard money' : 'Purchase price + rehab', price + rehab - hmAmt);
  cashLine('Closing costs', closing); cashLine('Hard money points', pointsCost); cashLine(`Hard money interest (${months} mo)`, hmInterest);
  cashLine(`Taxes, insurance & HOA while rehabbing (${months} mo)`, carry); cashLine('Furnishing', furnish);
  const ltv = R.get('br_refiLtv', 75, 'Refinance LTV (of ARV)', '%');
  const rr = rate(R.get('br_refiRate', 7.75, 'Refinance rate', '%'), 'refi');
  const yrs = R.get('br_refiYears', 30, 'Refinance term', 'years');
  const costPct = R.get('br_refiCostsPct', 3, 'Refinance closing costs (% of new loan)', '%');
  const newLoan = value * ltv / 100;
  const refiCosts = newLoan * costPct / 100;
  const returned = newLoan - hmAmt - refiCosts;
  const payment = pmt(newLoan, rr, yrs * 12);
  addLoan({ kind: 'refi', label: 'Refinance loan', amount: newLoan, rate: rr, months: yrs * 12, payment, work: `${$(value)} ARV × ${ltv}% = ${$(newLoan)}; ${rr}% for ${yrs} yr → ${$2(payment)}/mo` });
  const cashLeft = invested - returned;
  add(G, 'brInvested', 'Total cash invested before refinance', invested, 'money', 'Price + rehab + closing + points + interest + carrying costs − hard money', [`${$(price)} + ${$(rehab)} + ${$(closing)}`, pointsCost && `${$(pointsCost)} points`, hmInterest && `${$(hmInterest)} interest`, carry && `${$(carry)} carrying`, furnish && `${$(furnish)} furnishing`, hmAmt && `− ${$(hmAmt)} hard money`].filter(Boolean).join(' + ').replace('+ −', '−') + ` = ${$(invested)}`);
  add(G, 'brNewLoan', 'New loan at refinance', newLoan, 'money', 'ARV × refinance LTV', `${$(value)} × ${ltv}% = ${$(newLoan)}`);
  add(G, 'brReturned', 'Cash back at refinance', returned, 'money', 'New loan − hard money payoff − refinance costs', `${$(newLoan)} − ${$(hmAmt)} − ${$(refiCosts)} = ${$(returned)}`);
  add(G, 'brLeft', 'Cash left in the deal', cashLeft, 'money', 'Invested − cash back', `${$(invested)} − ${$(returned)} = ${$(cashLeft)}`, cashLeft <= 0 ? 'All your cash came back out. That is a full BRRRR.' : '');
  if (returned < 0) flag('bad', 'The refinance does not even pay off the hard money and costs. You would need to bring cash to the refinance.');
  flag('info', 'Many lenders want 3–6 months of ownership (seasoning) before a cash-out refinance on the ARV.');
  return { cashLeft, invested, returned, newLoan, payment };
}

// ---------- Fix & flip ----------
function flip(input, R, { add, flag, out, price, rehab, closing, value, rate, addLoan, ops }) {
  const G = 'Flip';
  const months = R.get('fl_months', 6, 'Months to rehab and sell', 'months');
  const holdMo = R.num('fl_holdMo') ?? (ops.taxesMo + ops.insMo + ops.hoaMo + 150);
  const sellPct = R.get('fl_sellPct', 8, 'Selling costs (agent + closing, % of sale price)', '%');
  const withHard = input.fl_buyWith !== 'cash';
  let hmAmt = 0, interest = 0, pointsCost = 0;
  if (withHard) {
    const hm = hardMoney(R, price, rehab, rate);
    addLoan(hm.loan);
    hmAmt = hm.loan.amount; interest = hm.loan.payment * months; pointsCost = hm.pointsCost;
  }
  const holding = holdMo * months;
  const selling = value * sellPct / 100;
  const totalCost = price + rehab + closing + pointsCost + interest + holding + selling;
  const profit = value - totalCost;
  const cashIn = price + rehab + closing + pointsCost + interest + holding - hmAmt;
  const rule = R.get('rule_pct', 70, 'Max-offer rule (% of ARV)', '%');
  const mao = value * rule / 100 - rehab;
  add(G, 'mao', `Max offer (${rule}% rule)`, mao, 'money', `ARV × ${rule}% − rehab`, `${$(value)} × ${rule}% − ${$(rehab)} = ${$(mao)}`, 'Leaves room for holding, selling costs and profit.');
  add(G, 'flCost', 'Total project cost', totalCost, 'money', 'Price + rehab + closing + points + interest + holding + selling costs',
    `${$(price)} + ${$(rehab)} + ${$(closing)} + ${$(pointsCost)} + ${$(interest)} + ${$(holding)} (${months} mo × ${$(holdMo)}) + ${$(selling)} (${sellPct}% of ${$(value)}) = ${$(totalCost)}`);
  add(G, 'flProfit', 'Profit', profit, 'money', 'ARV − total project cost', `${$(value)} − ${$(totalCost)} = ${$(profit)}`);
  add(G, 'flCash', 'Cash needed', cashIn, 'money', 'Everything paid out of pocket before the sale', `Project cost before selling ${$(totalCost - selling)} − hard money ${$(hmAmt)} = ${$(cashIn)}`);
  const roi = cashIn > 0 ? profit / cashIn : null;
  add(G, 'flRoi', 'Return on cash', roi, 'pct', 'Profit ÷ cash needed', `${$(profit)} ÷ ${$(cashIn)} = ${P(roi)}`);
  if (roi != null) add(G, 'flRoiYr', 'Annualized return', roi * 12 / months, 'pct', 'Return × 12 ÷ months', `${P(roi)} × 12 ÷ ${months} = ${P(roi * 12 / months)}`);
  add(G, 'flMargin', 'Profit margin (of ARV)', value ? profit / value : null, 'pct', 'Profit ÷ ARV', `${$(profit)} ÷ ${$(value)} = ${P(profit / value)}`, 'Many flippers want 10–15%+ of ARV.');
  out.summary = { profit, cashIn, roi, mao, price, value };
  if (price > mao) flag('warn', `Price is ${$(price - mao)} above the ${rule}% rule max offer (${$(mao)}).`);
  if (profit < 0) flag('bad', `This flip loses ${$(-profit)}.`);
  else if (value && profit / value < 0.1) flag('warn', `Profit is only ${P(profit / value, 1)} of ARV. A small surprise wipes it out.`);
}

// ---------- Wholesale ----------
function wholesale(input, R, { add, flag, out, price, rehab, value }) {
  const G = 'Wholesale';
  const rule = R.get('rule_pct', 70, 'Buyer max-offer rule (% of ARV)', '%');
  const fee = R.get('ws_fee', 10000, 'Your assignment fee', '$');
  const buyerMax = value * rule / 100 - rehab;
  const mao = buyerMax - fee;
  add(G, 'buyerMax', `Cash buyer's max price (${rule}% rule)`, buyerMax, 'money', `ARV × ${rule}% − rehab`, `${$(value)} × ${rule}% − ${$(rehab)} = ${$(buyerMax)}`);
  add(G, 'mao', 'Your max contract price', mao, 'money', "Buyer's max − your fee", `${$(buyerMax)} − ${$(fee)} = ${$(mao)}`);
  add(G, 'buyerPays', 'Buyer pays', price + fee, 'money', 'Your contract price + assignment fee', `${$(price)} + ${$(fee)} = ${$(price + fee)}`);
  add(G, 'room', 'Room left for the buyer', buyerMax - price - fee, 'money', "Buyer's max − what the buyer pays", `${$(buyerMax)} − ${$(price + fee)} = ${$(buyerMax - price - fee)}`);
  out.summary = { profit: fee, mao, price, value };
  if (price > mao) flag('bad', `Contract price is ${$(price - mao)} above your max. A cash buyer won't pay ${$(price + fee)}.`);
}

// ---------- Novation ----------
function novation(input, R, { add, flag, out, price, rehab, value, ops }) {
  const G = 'Novation';
  const agentPct = R.get('nv_agentPct', 6, 'Agent commissions', '%');
  const sellPct = R.get('nv_sellPct', 2, "Seller's closing costs", '%');
  const months = R.get('nv_months', 4, 'Months to list and sell', 'months');
  const holdMo = R.num('nv_holdMo') ?? 0;
  const sellerNet = R.num('nv_sellerNet') ?? price;
  const commission = value * agentPct / 100, closingSell = value * sellPct / 100, holding = holdMo * months;
  const profit = value - commission - closingSell - rehab - holding - sellerNet;
  add(G, 'nvProfit', 'Your profit', profit, 'money', 'Sale price − commissions − closing − repairs − holding − seller’s net',
    `${$(value)} − ${$(commission)} − ${$(closingSell)} − ${$(rehab)} − ${$(holding)} − ${$(sellerNet)} = ${$(profit)}`, 'Seller’s net is what the seller walks away with (including their loan payoff). Uses the purchase price if you leave it blank.');
  add(G, 'nvCash', 'Cash you put in', rehab + holding, 'money', 'Repairs + holding costs you fund', `${$(rehab)} + ${$(holding)} = ${$(rehab + holding)}`);
  if (rehab + holding > 0) add(G, 'nvRoi', 'Return on cash', profit / (rehab + holding), 'pct', 'Profit ÷ cash in', `${$(profit)} ÷ ${$(rehab + holding)} = ${P(profit / (rehab + holding))}`);
  out.summary = { profit, cashIn: rehab + holding, price, value };
  if (profit < 0) flag('bad', 'The sale does not cover the seller’s net and costs.');
}

// ---------- STR extras ----------
function strExtras(input, R, { add, flag, out, ops, ds, cashIn }) {
  const G = 'Short-term rental';
  if (ops.est) {
    add(G, 'estLow', 'Revenue estimate: low', ops.est.low, 'money', 'Lowest annual estimate entered', ops.ests.map((e) => `${e.source} ${$(e.revenue)}`).join(', '));
    add(G, 'estAvg', 'Revenue estimate: average', ops.est.avg, 'money', 'Average of the annual estimates', `(${ops.ests.map((e) => $(e.revenue)).join(' + ')}) ÷ ${ops.ests.length} = ${$(ops.est.avg)}`);
    add(G, 'estHigh', 'Revenue estimate: high', ops.est.high, 'money', 'Highest annual estimate entered', ops.ests.map((e) => `${e.source} ${$(e.revenue)}`).join(', '));
    if (ops.adr && ops.use !== 'calc') {
      const calcYr = ops.adr * ops.nights * 12;
      add(G, 'estCheck', 'Your nightly-rate math (per year, before cleaning fees)', calcYr, 'money', 'Nightly rate × booked nights × 12', `${$2(ops.adr)} × ${fmt.num(ops.nights, 1)} × 12 = ${$(calcYr)}`, 'Compare with the site estimates to sanity-check them.');
    }
  }
  if (ops.stays) add(G, 'stays', 'Stays / month', ops.stays, 'num', 'Booked nights ÷ average stay', `${fmt.num(ops.nights, 1)} ÷ ${fmt.num(ops.nights / ops.stays, 1)} = ${fmt.num(ops.stays, 1)}`);
  const ltr = R.num('str_ltrRent');
  if (ltr) {
    const ltrOpex = ltr * 0.05 + ltr * 0.05 + ltr * 0.95 * 0.08 + ops.taxesMo + ops.insMo + ops.hoaMo;
    const ltrCf = ltr * 0.95 - ltrOpex - ds;
    const strCf = ops.noiYr / 12 - ds;
    add(G, 'ltrCf', 'Same house as a long-term rental: cash flow / month', ltrCf, 'money', 'Rent − 5% vacancy − 5% repairs − 5% CapEx − 8% mgmt − taxes, insurance, HOA − loan',
      `${$(ltr)} × 95% − ${$(ltr * 0.05)} − ${$(ltr * 0.05)} − ${$(ltr * 0.95 * 0.08)} − ${$2(ops.taxesMo + ops.insMo + ops.hoaMo)} − ${$2(ds)} = ${$2(ltrCf)}`);
    add(G, 'strVsLtr', 'STR earns more per month by', strCf - ltrCf, 'money', 'STR cash flow − long-term cash flow', `${$2(strCf)} − ${$2(ltrCf)} = ${$2(strCf - ltrCf)}`, 'STR takes more work and carries more risk; the extra should be worth it.');
  }
  if (!input.str_allowed) flag('warn', "Short-term rentals not confirmed as allowed. Check city rules, permits and any HOA before you offer.");
}

// ---------- JV split ----------
function jvSplit(input, R, { add, out }) {
  const split = R.num('jv_split');
  if (!split) return;
  const s = out.summary;
  if (s.profit != null) add('JV split', 'jvProfit', `Your share of profit (${split}%)`, s.profit * split / 100, 'money', 'Profit × your split', `${$(s.profit)} × ${split}% = ${$(s.profit * split / 100)}`);
  if (s.cfYr != null) add('JV split', 'jvCf', `Your share of yearly cash flow (${split}%)`, s.cfYr * split / 100, 'money', 'Yearly cash flow × your split', `${$(s.cfYr)} × ${split}% = ${$(s.cfYr * split / 100)}`);
}

// ---------- Business ----------
function business(input, R, out, { add, flag, rate, rentFactor, strategy }) {
  const G = 'Earnings';
  const price = R.need('price', 'Asking / purchase price');
  const revenue = (R.num('biz_revenue') || 0) * rentFactor;
  const np = R.need('biz_netProfit', 'Net profit (from the tax return or P&L)');
  const owner = R.num('biz_ownerSalary') || 0;
  const addbacks = R.num('biz_addbacks') || 0;
  const interest = R.num('biz_interest') || 0;
  const depr = R.num('biz_depr') || 0;
  const taxes = R.num('biz_taxes') || 0;
  const delta = (rentFactor - 1) * (revenue || 0) * 0; // revenue swing handled through SDE below
  const swing = rentFactor;
  const sde = (np + owner + addbacks + interest + depr) * swing + delta;
  const ebitda = (np + interest + taxes + depr) * swing;
  const closing = R.get('closing', Math.round(price * 0.03), 'Closing, legal & SBA fees (3% of price)', '$');
  add(G, 'sde', "Seller's discretionary earnings (SDE) / year", sde, 'money', 'Net profit + owner salary + add-backs + interest + depreciation/amortization',
    `${$(np)} + ${$(owner)} + ${$(addbacks)} + ${$(interest)} + ${$(depr)}${swing !== 1 ? ` (× ${swing})` : ''} = ${$(sde)}`, 'What one full-time owner-operator earns from the business. Small businesses are priced on this.');
  add(G, 'ebitda', 'EBITDA / year', ebitda, 'money', 'Net profit + interest + taxes + depreciation/amortization', `${$(np)} + ${$(interest)} + ${$(taxes)} + ${$(depr)} = ${$(ebitda)}`, 'Used for larger businesses that already pay a manager.');
  if (revenue) add(G, 'margin', 'SDE margin', sde / revenue, 'pct', 'SDE ÷ revenue', `${$(sde)} ÷ ${$(revenue)} = ${P(sde / revenue)}`);
  add('Value', 'mult', 'Price ÷ SDE (multiple)', sde > 0 ? price / sde : null, 'num', 'Price ÷ SDE', `${$(price)} ÷ ${$(sde)} = ${fmt.num(price / sde, 2)}x`, 'Most small businesses sell for 2–4x SDE.');
  const m = R.get('biz_multiple', 3, 'Fair multiple of SDE', 'x');
  add('Value', 'val', `Value at ${m}x SDE`, sde * m, 'money', 'SDE × multiple', `${$(sde)} × ${m} = ${$(sde * m)}`);
  if (price > sde * m) flag('warn', `Price is ${$(price - sde * m)} above ${m}x SDE.`);

  let ds = 0, cashIn = 0;
  const cl = (label, amount) => { if (amount) out.cashLines.push({ label, amount }); cashIn += amount; };
  if (strategy === 'sba') {
    const dp = R.get('sba_downPct', 10, 'SBA down payment', '%');
    const snp = R.get('sn_pct', 0, 'Seller note (% of price)', '%');
    const r = rate(R.get('sba_rate', 10.5, 'SBA rate (Prime + 2.75%; check today’s)', '%'), 'sba');
    const yrs = R.get('sba_years', 10, 'SBA term', 'years');
    const sbaAmt = price * (1 - dp / 100 - snp / 100);
    const p = pmt(sbaAmt, r, yrs * 12);
    out.loans.push({ kind: 'sba', label: 'SBA 7(a) loan', amount: sbaAmt, rate: r, months: yrs * 12, payment: p, work: `${$(price)} × ${100 - dp - snp}% = ${$(sbaAmt)}; ${r}% over ${yrs} yr → ${$2(p)}/mo` });
    ds += p;
    if (snp) {
      const sr = R.get('sn_rate', 6, 'Seller note rate', '%');
      const sy = R.get('sn_years', 10, 'Seller note term', 'years');
      const sAmt = price * snp / 100;
      const sp = pmt(sAmt, sr, sy * 12);
      out.loans.push({ kind: 'seller', label: 'Seller note', amount: sAmt, rate: sr, months: sy * 12, payment: sp, work: `${$(price)} × ${snp}% = ${$(sAmt)}; ${sr}% over ${sy} yr → ${$2(sp)}/mo` });
      ds += sp;
    }
    cl('Down payment', price * dp / 100);
  } else if (strategy === 'seller') {
    const down = R.get('sf_down', Math.round(price * 0.2), 'Down payment (20% of price)', '$');
    const r = R.get('sf_rate', 6, 'Seller note rate', '%');
    const yrs = R.get('sf_years', 7, 'Seller note term', 'years');
    const amt = price - down;
    const p = pmt(amt, r, yrs * 12);
    out.loans.push({ kind: 'seller', label: 'Seller note', amount: amt, rate: r, months: yrs * 12, payment: p, work: `${$(price)} − ${$(down)} = ${$(amt)}; ${r}% over ${yrs} yr → ${$2(p)}/mo` });
    ds += p;
    cl('Down payment', down);
  } else cl('Purchase price', price);
  cl('Closing costs', closing);

  const salary = R.get('biz_newSalary', 0, 'Salary you pay yourself (or a manager)', '$');
  const dsYr = ds * 12;
  const cf = sde - salary - dsYr;
  const dscr = dsYr > 0 ? (sde - salary) / dsYr : Infinity;
  add('Cash flow', 'ds', 'Debt service / month', ds, 'money2', 'Sum of loan payments', out.loans.map((l) => `${l.label} ${$2(l.payment)}`).join(' + ') || 'No loans');
  add('Cash flow', 'cfYr', 'Cash flow after debt / year', cf, 'money', 'SDE − your salary − annual debt service', `${$(sde)} − ${$(salary)} − ${$(dsYr)} = ${$(cf)}`);
  add('Cash flow', 'cfMo', 'Cash flow / month', cf / 12, 'money', 'Yearly ÷ 12', `${$(cf)} ÷ 12 = ${$(cf / 12)}`);
  add('Returns', 'cashIn', 'Cash needed', cashIn, 'money', 'Down payment + closing', out.cashLines.map((c) => `${c.label} ${$(c.amount)}`).join(' + '));
  const coc = cashIn > 0 ? cf / cashIn : null;
  add('Returns', 'coc', 'Cash-on-cash return', coc, 'pct', 'Yearly cash flow ÷ cash needed', `${$(cf)} ÷ ${$(cashIn)} = ${P(coc)}`);
  const payback = cf > 0 ? cashIn / cf : Infinity;
  add('Returns', 'payback', 'Payback period', payback, 'years', 'Cash needed ÷ yearly cash flow', cf > 0 ? `${$(cashIn)} ÷ ${$(cf)} = ${fmt.num(payback, 1)} years` : 'Never: the business does not cash flow after debt.', 'How long until the cash you put in comes back.');
  add('Debt', 'dscr', 'DSCR', dscr, 'ratio', '(SDE − your salary) ÷ annual debt service', dsYr > 0 ? `(${$(sde)} − ${$(salary)}) ÷ ${$(dsYr)} = ${fmt.ratio(dscr)}` : 'No loan payments.', 'SBA lenders generally want 1.25x or more.');
  out.summary = { cfMo: cf / 12, cfYr: cf, cashIn, coc, dscr, price, sde };
  if (cf < 0) flag('bad', `After debt and your salary, the business loses ${$(-cf)}/year.`);
  if (dsYr > 0 && dscr < 1.25) flag(dscr < 1 ? 'bad' : 'warn', `DSCR is ${fmt.ratio(dscr)}. SBA lenders usually require 1.25x.`);
  if (!salary) flag('warn', 'No salary for the owner/manager. If you will not work in the business full time, enter what a manager would cost.');
  targetsAndMaxOffer(input, out, { add, flag, isHold: true });
  if (out.missing.length) flag('bad', `Missing: ${out.missing.map((x) => x.label).join(', ')}.`);
  if (out.assumed.length) flag('info', `${out.assumed.length} number${out.assumed.length > 1 ? 's are' : ' is a'} default assumption${out.assumed.length > 1 ? 's' : ''}.`);
  return out;
}

// ---------- Land ----------
function land(input, R, out, { add, flag, rate, strategy }) {
  const G = 'Land';
  const price = R.need('price', 'Purchase price');
  const acres = R.num('acres');
  const closing = R.get('closing', Math.round(Math.max(price * 0.02, 1500)), 'Closing costs (2%, $1,500 minimum)', '$');
  const taxesYr = R.num('taxesYr') || 0;
  if (acres) add(G, 'ppa', 'Price per acre', price / acres, 'money', 'Price ÷ acres', `${$(price)} ÷ ${acres} = ${$(price / acres)}`);
  let cashIn = price + closing;
  let ourPmt = 0, ourLoan = null;
  if (strategy === 'seller' || strategy === 'subto') {
    const down = strategy === 'seller' ? R.get('sf_down', Math.round(price * 0.1), 'Down payment to seller (10%)', '$') : 0;
    const amt = strategy === 'seller' ? price - down : R.need('st_balance', 'Loan balance');
    const r = strategy === 'seller' ? R.get('sf_rate', 5, 'Seller note rate', '%') : R.need('st_rate', 'Loan rate');
    const months = strategy === 'seller' ? R.get('sf_years', 10, 'Seller note term', 'years') * 12 : R.need('st_monthsLeft', 'Months left on the loan');
    ourPmt = pmt(amt, r, months);
    ourLoan = { kind: strategy === 'seller' ? 'seller' : 'existing', label: strategy === 'seller' ? 'Seller note (your purchase)' : "Seller's loan (Subject-To)", amount: amt, rate: r, months, payment: ourPmt, work: `${$(amt)} at ${r}% over ${months} months → ${$2(ourPmt)}/mo` };
    out.loans.push(ourLoan);
    cashIn = price - amt + closing;
  }
  if (strategy === 'wholesale') {
    const fee = R.get('ws_fee', 5000, 'Assignment fee', '$');
    add(G, 'wsBuyer', 'Buyer pays', price + fee, 'money', 'Contract + fee', `${$(price)} + ${$(fee)} = ${$(price + fee)}`);
    out.summary = { profit: fee, price };
    return out;
  }
  out.cashLines.push({ label: 'Cash at purchase', amount: cashIn - closing }, { label: 'Closing costs', amount: closing });
  add('Returns', 'cashIn', 'Cash needed', cashIn, 'money', strategy === 'cash' ? 'Price + closing' : 'Down payment + closing', `${$(cashIn - closing)} + ${$(closing)} = ${$(cashIn)}`);
  const sell = R.num('land_sellPrice');
  if (!sell) {
    if (taxesYr) add(G, 'hold', 'Holding cost / year', taxesYr + ourPmt * 12, 'money', 'Taxes + loan payments', `${$(taxesYr)} + ${$(ourPmt * 12)}`);
    flag('info', 'Enter a resale price to see the seller-finance note you could create when you sell.');
    out.summary = { cashIn, price };
    return out;
  }
  const down = R.get('land_down', Math.round(sell * 0.1), "Buyer's down payment (10%)", '$');
  const nr = R.get('land_rate', 9.9, 'Note rate you charge', '%');
  const months = R.get('land_months', 84, 'Note term', 'months');
  const sellCosts = R.get('land_sellCosts', 500, 'Selling / note setup costs', '$');
  const note = sell - down;
  const np = pmt(note, nr, months);
  out.loans.push({ kind: 'receivable', label: 'Note you carry (buyer pays you)', amount: note, rate: nr, months, payment: np, work: `${$(sell)} − ${$(down)} = ${$(note)}; ${nr}% over ${months} months → ${$2(np)}/mo` });
  if (acres) add(G, 'spa', 'Resale price per acre', sell / acres, 'money', 'Resale ÷ acres', `${$(sell)} ÷ ${acres} = ${$(sell / acres)}`);
  add('Note', 'notePmt', 'Buyer pays you / month', np, 'money2', 'Standard amortizing payment', `${$(note)} at ${nr}% over ${months} months = ${$2(np)}`);
  const netIn = cashIn + sellCosts - down;
  add('Note', 'netIn', 'Your cash in after buyer’s down payment', netIn, 'money', 'Cash needed + selling costs − buyer down', `${$(cashIn)} + ${$(sellCosts)} − ${$(down)} = ${$(netIn)}`, netIn <= 0 ? 'The down payment returned all your cash.' : '');
  const flows = [-netIn];
  for (let m = 1; m <= months; m++) {
    let f = np - (ourLoan && m <= ourLoan.months ? ourPmt : 0);
    if (m === months && ourLoan && ourLoan.months > months) f -= balanceAfter(ourLoan.amount, ourLoan.rate, ourLoan.months, months, ourPmt);
    flows.push(f);
  }
  const total = flows.reduce((s, f) => s + f, 0);
  add('Note', 'collected', 'Total collected from the buyer', down + np * months, 'money', 'Down + payment × months', `${$(down)} + ${$2(np)} × ${months} = ${$(down + np * months)}`);
  add('Note', 'profit', 'Total profit', total, 'money', 'All cash in − all cash out over the note', `Down ${$(down)} + payments ${$(np * months)} − purchase cash ${$(cashIn)} − costs ${$(sellCosts)}${ourLoan ? ` − your loan payments and payoff` : ''} = ${$(total)}`);
  const ir = annualize(irr(flows));
  add('Note', 'irr', 'Return on the note (IRR, annual)', ir, 'pct', 'Internal rate of return on monthly cash flows', 'Solved from: your net cash in at the start, then each month’s note payment' + (ourLoan ? ' minus your own loan payment.' : '.'), ir == null && netIn <= 0 ? 'You have no cash in, so the return is unlimited.' : '');
  if (netIn > 0) add('Note', 'yield', 'Cash-on-cash yield', (np - ourPmt) * 12 / netIn, 'pct', '(Note payment − your loan payment) × 12 ÷ cash in', `(${$2(np)} − ${$2(ourPmt)}) × 12 ÷ ${$(netIn)} = ${P((np - ourPmt) * 12 / netIn)}`);
  out.summary = { cfMo: np - ourPmt, cfYr: (np - ourPmt) * 12, cashIn: netIn, profit: total, irr: ir, price };
  if (ourLoan && ourLoan.months > months) flag('warn', 'Your purchase loan outlasts the note; the payoff at the end comes out of your pocket.');
  if (np < ourPmt) flag('bad', 'The note payment you receive is less than your own loan payment.');
  return out;
}

// ---------- targets & max offer ----------
const TEST_LABEL = { cf: 'Cash flow per door', coc: 'Cash-on-cash', dscr: 'DSCR', cap: 'Cap rate' };
function targetsAndMaxOffer(input, out, { add, flag }) {
  out.targets = [];
  const R = reader(input);
  const units = out.metrics.find((m) => m.id === 'ppu') ? Math.max(1, Math.round(out.summary.price / out.metrics.find((m) => m.id === 'ppu').value)) : 1;
  const t = {
    cf: R.num('tgt_cf') ?? (out.group === 'business' ? null : 200),
    coc: R.num('tgt_coc') ?? 10,
    dscr: R.num('tgt_dscr') ?? 1.2,
    cap: R.num('tgt_cap'),
  };
  out.targetValues = t;
  if (out._noSolve) return;
  const s = out.summary;
  const passes = {
    cf: t.cf == null ? null : s.cfMo / units >= t.cf,
    coc: s.coc == null ? null : s.coc >= t.coc / 100,
    dscr: !Number.isFinite(s.dscr) ? null : s.dscr >= t.dscr,
    cap: t.cap == null || s.cap == null ? null : s.cap >= t.cap / 100,
  };
  out.targets = Object.entries(passes).filter(([, v]) => v != null).map(([k, v]) => ({ key: k, label: TEST_LABEL[k], pass: v, target: t[k] }));
  // Solve the max offer: which input moves the price?
  const strategy = out.strategy;
  const knob = strategy === 'subto' ? 'st_cashToSeller' : 'price';
  if (strategy === 'wrap') return;
  const base = Number(String(input[knob] || '0').replace(/[$,]/g, '')) || 0;
  const hi = Math.max(base * 3, (Number(String(input.arv || 0).replace(/[$,]/g, '')) || 0) * 1.5, 50000);
  const tests = Object.keys(passes).filter((k) => passes[k] != null && !(k === 'dscr' && s.dscr === Infinity));
  const results = [];
  for (const k of tests) {
    const ok = (x) => {
      const r = analyze({ ...input, [knob]: String(x) }, { _solving: true });
      const rs = r.summary;
      if (k === 'cf') return rs.cfMo / units >= t.cf;
      if (k === 'coc') return rs.coc != null && rs.coc >= t.coc / 100;
      if (k === 'dscr') return rs.dscr >= t.dscr;
      if (k === 'cap') return rs.cap >= t.cap / 100;
      return true;
    };
    results.push({ key: k, label: TEST_LABEL[k], max: solveMax(ok, 1000, hi, 10) });
  }
  if (!results.length) return;
  const valid = results.filter((r) => r.max != null);
  const binding = valid.length === results.length ? valid.reduce((a, b) => (b.max < a.max ? b : a)) : null;
  out.maxOffer = { knob, results, binding };
  const label = knob === 'price' ? 'Max offer to hit your targets' : 'Max cash to seller to hit your targets';
  const lines = results.map((r) => `${r.label} ≥ ${r.key === 'cf' ? $(t.cf) + (units > 1 ? '/door' : '') + '/mo' : r.key === 'dscr' ? `${t.dscr}x` : `${t[r.key]}%`}: ${r.max == null ? 'not possible at any price' : r.max >= hi ? `passes at any ${knob === 'price' ? 'price' : 'amount'} up to ${$(hi)}` : $(r.max)}`);
  add('Max offer', 'maxOffer', label, binding ? binding.max : null, 'money', 'The highest price that passes every test; the lowest one wins',
    lines.join(' · ') + (binding ? ` → lowest is ${binding.label}: ${$(binding.max)}` : ''),
    'Change the targets under "Your targets". Other inputs (rent, rate, terms) stay as entered.');
  if (!binding) flag('warn', `Can't hit every target at any ${knob === 'price' ? 'price' : 'cash to seller'}: ${results.filter((r) => r.max == null).map((r) => r.label).join(', ')}.`);
}


// ---------- what-if table ----------
export function whatIf(input) {
  const rows = [];
  for (const rf of [0.9, 1, 1.1]) {
    for (const rb of [0, 1]) {
      const r = analyze(input, { rentFactor: rf, rateBump: rb, _solving: true });
      rows.push({ rent: rf === 1 ? 'As entered' : rf < 1 ? '−10%' : '+10%', rate: rb ? '+1%' : 'As entered', ...r.summary });
    }
  }
  return rows;
}
