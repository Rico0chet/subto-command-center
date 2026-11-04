// Core money math. Full precision everywhere; rounding happens only on screen.

// Monthly payment on an amortizing loan.  Payment = L × r(1+r)^n / ((1+r)^n − 1), r = annual rate ÷ 12.
export function pmt(principal, annualRatePct, months) {
  const L = Number(principal) || 0;
  const n = Math.round(Number(months) || 0);
  if (L <= 0 || n <= 0) return 0;
  const r = (Number(annualRatePct) || 0) / 100 / 12;
  if (r === 0) return L / n;
  const f = Math.pow(1 + r, n);
  return (L * r * f) / (f - 1);
}

// Interest-only monthly payment.
export function ioPayment(principal, annualRatePct) {
  return ((Number(principal) || 0) * (Number(annualRatePct) || 0)) / 100 / 12;
}

// Balance left after k payments of `payment` (defaults to the amortizing payment).
export function balanceAfter(principal, annualRatePct, months, k, payment) {
  const L = Number(principal) || 0;
  if (L <= 0) return 0;
  const r = (Number(annualRatePct) || 0) / 100 / 12;
  const P = payment == null ? pmt(L, annualRatePct, months) : payment;
  const kk = Math.max(0, Math.round(k));
  if (r === 0) return Math.max(0, L - P * kk);
  const f = Math.pow(1 + r, kk);
  return Math.max(0, L * f - (P * (f - 1)) / r);
}

// How many months until a balance is paid off at a given payment (for a Subject-To loan where you know P&I).
export function monthsToPayoff(balance, annualRatePct, payment) {
  const B = Number(balance) || 0;
  const P = Number(payment) || 0;
  if (B <= 0) return 0;
  const r = (Number(annualRatePct) || 0) / 100 / 12;
  if (P <= 0) return Infinity;
  if (r === 0) return Math.ceil(B / P);
  if (P <= B * r) return Infinity; // payment doesn't cover interest
  return Math.ceil(-Math.log(1 - (B * r) / P) / Math.log(1 + r) - 1e-6);
}

// Principal and interest paid in the first `months` payments.
export function splitPayments(principal, annualRatePct, months, k, payment) {
  const P = payment == null ? pmt(principal, annualRatePct, months) : payment;
  const end = balanceAfter(principal, annualRatePct, months, k, P);
  const principalPaid = (Number(principal) || 0) - end;
  return { principal: principalPaid, interest: P * k - principalPaid, endBalance: end };
}

// Net present value of evenly spaced cash flows at a periodic rate.
export function npv(rate, flows) {
  return flows.reduce((s, cf, i) => s + cf / Math.pow(1 + rate, i), 0);
}

// Internal rate of return per period (bisection with a Newton polish). Returns null when there's no sign change.
export function irr(flows) {
  if (!flows.some((f) => f < 0) || !flows.some((f) => f > 0)) return null;
  let lo = -0.9999, hi = 1;
  let fLo = npv(lo, flows), fHi = npv(hi, flows);
  let grow = 0;
  while (fLo * fHi > 0 && grow < 60) { hi *= 2; fHi = npv(hi, flows); grow++; }
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid, flows);
    if (Math.abs(fm) < 1e-9) return mid;
    if (fLo * fm < 0) { hi = mid; fHi = fm; } else { lo = mid; fLo = fm; }
  }
  return (lo + hi) / 2;
}

// Monthly IRR → annual effective rate.
export const annualize = (monthly) => (monthly == null ? null : Math.pow(1 + monthly, 12) - 1);

// Yearly amortization summary (for the schedule view).
export function amortYears(principal, annualRatePct, months, years = 10, payment) {
  const P = payment == null ? pmt(principal, annualRatePct, months) : payment;
  const out = [];
  let prev = Number(principal) || 0;
  for (let y = 1; y <= years; y++) {
    const k = Math.min(y * 12, months || y * 12);
    const bal = balanceAfter(principal, annualRatePct, months, k, P);
    const paidMonths = Math.max(0, k - (y - 1) * 12);
    const principalPaid = prev - bal;
    out.push({ year: y, payments: P * paidMonths, principal: principalPaid, interest: P * paidMonths - principalPaid, balance: bal });
    prev = bal;
    if (bal <= 0.005) break;
  }
  return out;
}

// Find the largest x in [lo, hi] where ok(x) is true, assuming ok is true below some cutoff and false above it.
export function solveMax(ok, lo, hi, tol = 1) {
  if (!ok(lo)) return null;
  if (ok(hi)) return hi;
  for (let i = 0; i < 100 && hi - lo > tol; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid; else hi = mid;
  }
  return lo;
}
