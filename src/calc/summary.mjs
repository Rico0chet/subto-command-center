// One-page printable summary of an analysis (turned into a PDF by the main process).
import { show } from './underwrite.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function summaryHtml({ name, address, input, result, whatIf, typeLabel, stratLabel, team }) {
  const s = result.summary;
  const profitMode = ['flip', 'wholesale', 'novation'].includes(result.strategy);
  const cards = profitMode
    ? [['Profit', show(s.profit, 'money')], ['Cash needed', show(s.cashIn, 'money')], ['Max offer', show(s.mao, 'money')]]
    : [['Cash flow / mo', show(s.cfMo, 'money')], ['Cash needed', show(s.cashIn, 'money')], ['Cash-on-cash', s.coc === Infinity ? '∞' : show(s.coc, 'pct')], ['DSCR', show(s.dscr, 'ratio')]];
  const groups = [];
  for (const m of result.metrics) {
    let g = groups.find((x) => x.name === m.group);
    if (!g) { g = { name: m.group, items: [] }; groups.push(g); }
    g.items.push(m);
  }
  const metricRows = groups.map((g) => `<tr class="g"><td colspan="2">${esc(g.name)}</td></tr>` + g.items.map((m) => `<tr><td>${esc(m.label)}<div class="w">${esc(m.work)}</div></td><td class="v">${esc(m.value === Infinity && m.kind === 'pct' ? '∞' : show(m.value, m.kind))}</td></tr>`).join('')).join('');
  const flags = result.flags.map((f) => `<li class="${f.level}">${esc(f.text)}</li>`).join('');
  const loans = result.loans.map((l) => `<tr><td>${esc(l.label)}</td><td>${show(l.amount, 'money')}</td><td>${l.rate}%${l.io ? ' IO' : ''}</td><td>${show(l.payment, 'money2')}/mo</td></tr>`).join('');
  const assumed = result.assumed.map((a) => `${esc(a.label)}: ${esc(a.value)}`).join(' · ');
  const wi = whatIf && !profitMode ? `<h3>What if</h3><table class="t"><tr><th>Rent</th><th>Rate</th><th>Cash flow/mo</th><th>CoC</th><th>DSCR</th></tr>${whatIf.map((r) => `<tr><td>${r.rent}</td><td>${r.rate}</td><td>${show(r.cfMo, 'money')}</td><td>${r.coc === Infinity ? '∞' : show(r.coc, 'pct')}</td><td>${show(r.dscr, 'ratio')}</td></tr>`).join('')}</table>` : '';
  const sellerHtml = team && team.seller && team.seller.length ? `<h3>Seller side</h3><div>${team.seller.map((m) => `${esc(m.role || 'Seller')}: ${esc(m.name)}${m.phone ? ` (${esc(m.phone)})` : ''}${m.terms ? ` — ${esc(m.terms)}` : ''}`).join('<br>')}</div>` : '';
  const teamHtml = team && team.members.length ? `<h3>Deal team</h3><table class="t"><tr><th>Role</th><th>Person</th><th>Brings</th><th>Amount</th><th>Terms</th><th>Status</th></tr>${team.members.map((m) => `<tr><td>${esc(m.role)}</td><td>${esc(m.name)}</td><td>${esc(m.brings)}</td><td>${m.amount != null ? show(m.amount, 'money') : ''}</td><td>${esc(m.terms)}</td><td>${esc(m.status)}</td></tr>`).join('')}</table><div>Needed ${team.needed != null ? show(team.needed, 'money') : '—'} · Committed ${show(team.committed, 'money')} · Pending ${show(team.pending, 'money')}${team.short ? ` · Short ${show(team.short, 'money')}` : ''}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}</title><style>
  *{box-sizing:border-box} body{font:8.4px/1.28 -apple-system,Segoe UI,Arial,sans-serif;color:#111;margin:0}
  h1{font-size:15px;margin:0} h3{font-size:10px;margin:6px 0 3px;border-bottom:1px solid #ccc;padding-bottom:2px}
  .sub{color:#555;margin:2px 0 8px} .cards{display:flex;gap:6px;margin:6px 0}
  .card{flex:1;border:1px solid #ddd;border-radius:6px;padding:6px} .card{padding:4px 6px} .card b{display:block;font-size:12.5px}
  .mcols{column-count:2;column-gap:14px;margin-bottom:6px} .mcols table{break-inside:auto} .m tr{break-inside:avoid} .cols{display:flex;gap:14px} .cols>div{flex:1;min-width:0}
  table{width:100%;border-collapse:collapse} td,th{padding:2px 3px;vertical-align:top;text-align:left}
  .m tr td{border-bottom:1px solid #eee} .m .v{text-align:right;white-space:nowrap;font-weight:600}
  .g td{font-weight:700;background:#f3f3f3} .w{color:#666;font-size:6.8px;line-height:1.2}
  .t td,.t th{border-bottom:1px solid #eee} ul{margin:0;padding-left:14px} li.bad{color:#b00020} li.warn{color:#8a5a00}
  .foot{color:#666;font-size:8px;margin-top:8px}
  </style></head><body>
  <h1>${esc(name)}</h1>
  <div class="sub">${esc(address || '')} · ${esc(typeLabel)} · ${esc(stratLabel)} · ${new Date().toLocaleDateString()}</div>
  <div class="cards">${cards.map(([l, v]) => `<div class="card">${esc(l)}<b>${esc(v)}</b></div>`).join('')}</div>
  <div class="mcols"><table class="m">${metricRows}</table></div>
  <div class="cols">
    <div>
      ${flags ? `<h3>Red flags & notes</h3><ul>${flags}</ul>` : ''}
      ${loans ? `<h3>Loans</h3><table class="t">${loans}</table>` : ''}
      ${sellerHtml}
      ${teamHtml}
    </div>
    <div>
      ${wi}
      ${assumed ? `<h3>Default assumptions</h3><div>${assumed}</div>` : ''}
      ${input.notes ? `<h3>Notes</h3><div>${esc(input.notes).replace(/\n/g, '<br>')}</div>` : ''}
    </div>
  </div>
  <div class="foot">SubTo Command Center. Results are only as good as the inputs; confirm loan balances with the mortgage statement or payoff letter. A decision tool, not financial, legal or tax advice.</div>
  </body></html>`;
}
