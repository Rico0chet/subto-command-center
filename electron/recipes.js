// Import recipes: how to read each kind of spreadsheet into the hub's standard shape.
// Anything a recipe doesn't place in a field goes into "Sheet details" (nothing is lost).
const { formatPhone, guessMapping } = require('./crm');

const STATUSES = ['Not called', 'No answer', 'Left voicemail', 'Call back', 'Interested', 'Appointment set', 'Not interested', 'Wrong number', 'Do not call', 'Sold / under contract'];
const CLOSED_STATUSES = ['Not interested', 'Wrong number', 'Do not call', 'Sold / under contract'];

// Translates each sheet's own wording ("Left VM", "Interested - Send to Closer", "DNC"...) to the standard list.
function normalizeStatus(v) {
  const s = String(v || '').toLowerCase().trim();
  if (!s || s === 'not called' || s === 'new') return 'Not called';
  if (/appoint|\bappt\b|booked|scheduled/.test(s)) return 'Appointment set';
  if (/not interested|no interest|\bni\b/.test(s)) return 'Not interested';
  if (/do not call|\bdnc\b|remove/.test(s)) return 'Do not call';
  if (/wrong|disconnect|bad number|invalid/.test(s)) return 'Wrong number';
  if (/sold|under contract|off market|pending/.test(s)) return 'Sold / under contract';
  if (/interested|hot|warm|send to closer/.test(s)) return 'Interested';
  if (/voicemail|\bvm\b|left message|lvm/.test(s)) return 'Left voicemail';
  if (/call ?back|follow ?up|later/.test(s)) return 'Call back';
  if (/no answer|\bna\b|no pick|busy|rang/.test(s)) return 'No answer';
  return null; // unknown: kept as text in Sheet details
}

const num = (v) => { const n = Number(String(v || '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && String(v).trim() !== '' ? n : null; };
const isoDate = (v) => { const s = String(v || '').trim(); const m = /^(\d{4}-\d{2}-\d{2})/.exec(s); return m ? m[1] : null; };
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bMc([a-z])/g, (m, c) => `Mc${c.toUpperCase()}`);
const smartCase = (s) => (s && s === s.toUpperCase() && /[A-Z]{2}/.test(s) ? titleCase(s) : s); // "LEAVERTON" -> "Leaverton"

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  return { first: parts.shift(), last: parts.join(' ') };
}

// Helper given to every recipe: reads a column and remembers it was used.
function reader(row, headers) {
  const used = new Set();
  const lower = Object.fromEntries(headers.map((h) => [h.toLowerCase(), h]));
  const col = (...names) => {
    for (const n of names) {
      const h = lower[n.toLowerCase()];
      if (h) { used.add(h); const v = row[h]; if (v != null && String(v).trim() !== '') return String(v).trim(); }
    }
    return '';
  };
  const mark = (...names) => names.forEach((n) => { const h = lower[n.toLowerCase()]; if (h) used.add(h); });
  const has = (n) => !!lower[n.toLowerCase()];
  return { col, mark, has, used };
}

function phone(n, type = '', label = '') {
  const f = formatPhone(n);
  return f && f.replace(/\D/g, '').length >= 10 ? { n: f, type, label } : null;
}

// ---------------------------------------------------------------- recipes
const RECIPES = [
  {
    id: 'agent-call-list',
    label: 'Listing-agent call list (appointment setting)',
    kind: 'leads',
    personRole: 'Agent',
    detect: (h) => h.has('ask for (listing agent)') || (h.has('agent phone') && h.has('property address')),
    build(r) {
      const agent = splitName(r.col('Ask For (Listing Agent)', 'Listing Agent', 'Agent Name', 'Agent'));
      const phones = [phone(r.col('Agent Phone'), 'Mobile', 'Agent'), phone(r.col('Agent Phone 2'), '', 'Agent 2'), phone(r.col('Office Phone'), 'Office', 'Office')].filter(Boolean);
      const status = r.col('Status');
      return {
        person: { first: agent.first, last: agent.last, company: r.col('Brokerage'), phones, emails: [r.col('Agent Email')].filter(Boolean), role: 'Agent' },
        item: {
          address: r.col('Property Address'), city: r.col('City'), state: r.col('State'), zip: r.col('Zip'),
          property_type: r.col('Type') || 'Single family', year_built: r.col('Year Built'), price: num(r.col('List Price')), dom: r.col('Days on Market'),
          status, attempts: r.col('Attempts'), last_called: r.col('Last Called'), follow_up: r.col('Follow-Up Date', 'Follow Up Date'),
          appointment: r.col('Appt Date / Time', 'Appointment'), caller: r.col('Caller Name'), priority: r.col('Priority'), notes: r.col('Notes'),
          highlights: [['Seller signals', r.col('Seller Signals')], ['Caller tips', r.col('Caller Tips')], ['Home', r.col('Home')], ['Co-listing agent', r.col('Co-Listing Agent')], ['Listing', r.col('View Listing')]],
        },
      };
    },
  },
  {
    id: 'owner-list',
    label: 'Property owner list (multifamily / commercial)',
    kind: 'leads',
    personRole: 'Seller',
    detect: (h) => h.has('owner contact') || (h.has('property name') && h.has('units') && (h.has('phone 1') || h.has('phone1'))),
    build(r) {
      const owner = splitName(r.col('Owner Contact', 'Owner Name', 'Owner'));
      const company = r.col('Owner Company', 'Company');
      // "Phone Sources" says which phone is whose, e.g. "1=Owner | 2=Property Mgr | 3"
      const src = {};
      for (const m of r.col('Phone Sources').matchAll(/(\d)\s*=\s*([^|]+)/g)) src[m[1]] = m[2].trim();
      const phones = [1, 2, 3, 4].map((i) => phone(r.col(`Phone ${i}`, `Phone${i}`), '', src[i] || '')).filter(Boolean);
      const units = r.col('Units');
      return {
        person: { first: owner.first, last: owner.last, company, phones, emails: [r.col('Email', 'Owner Email')].filter(Boolean), role: 'Seller',
          address: [r.col('Owner Mailing Address'), r.col('Owner City/State/Zip')].filter(Boolean).join(', ') },
        item: {
          title: r.col('Property Name'), address: r.col('Property Address'), city: r.col('City'), state: r.col('State'), zip: r.col('Zip'), county: r.col('County'),
          property_type: units ? `Multifamily (${units} units)` : 'Multifamily', units, year_built: r.col('Year Built'),
          last_called: r.col('Dates Called'), caller: r.col('Cold Caller Name'), notes: r.col('NOTES', 'Notes'), status: r.col('Status'),
          highlights: [['Source', r.col('Source List')], ['Class', r.col('Class')], ['Occupancy', (() => { const o = num(r.col('Occupancy %')); return o != null && o <= 1 ? `${Math.round(o * 100)}%` : r.col('Occupancy %'); })()], ['Property manager', r.col('Property Manager')]],
        },
      };
    },
  },
  {
    id: 'skip-trace',
    label: 'Skip-traced owner list',
    kind: 'leads',
    personRole: 'Seller',
    detect: (h) => h.has('resultcode') || (h.has('phone1 type') && (h.has('input last name') || h.has('matched last name'))),
    build(r, headers) {
      const first = smartCase(r.col('Matched First Name', 'Input First Name'));
      const last = smartCase(r.col('Matched Last Name', 'Input Last Name'));
      const ph = (prefix, max) => Array.from({ length: max }, (_, i) => phone(r.col(`${prefix}Phone${i + 1}`), r.col(`${prefix}Phone${i + 1} Type`))).filter(Boolean)
        .sort((a, b) => (b.type === 'Mobile') - (a.type === 'Mobile'));
      const deceased = /^y/i.test(r.col('Deceased'));
      // Second owner and relatives become backup numbers on the lead, not separate contacts.
      const people = [];
      const p2 = [smartCase(r.col('Person2 First Name')), smartCase(r.col('Person2 Last Name'))].filter(Boolean).join(' ');
      if (p2) people.push({ name: p2, role: 'Co-owner', age: r.col('Person2 Age'), deceased: /^y/i.test(r.col('Person2 Deceased')), phones: ph('Person2 ', 7), emails: [r.col('Person2 Email1'), r.col('Person2 Email2')].filter(Boolean) });
      for (const who of ['', 'Person2 ']) {
        for (let i = 1; i <= 5; i++) {
          const name = smartCase(r.col(`${who}Relative${i} Name`));
          r.col(`${who}Relative${i} Age`);
          const phones = ph(`${who}Relative${i} `, 5);
          if (name && phones.length) people.push({ name, role: who ? 'Relative of co-owner' : 'Relative', age: r.col(`${who}Relative${i} Age`), phones });
        }
      }
      // All Person2 / Relative columns are now accounted for.
      headers.filter((h) => /^(person2 |relative\d)/i.test(h)).forEach((h) => r.mark(h));
      const mailing = [titleCase(r.col('Confirmed Mailing Address', 'Input Mailing Address')), titleCase(r.col('Confirmed Mailing City', 'Input Mailing City')), r.col('Confirmed Mailing State', 'Input Mailing State').toUpperCase(), r.col('Confirmed Mailing Zip', 'Input Mailing Zip')].filter(Boolean).join(', ');
      r.mark('Input Mailing Address', 'Input Mailing City', 'Input Mailing State', 'Input Mailing Zip', 'Input First Name', 'Input Last Name');
      const flags = deceased ? 'Owner may be deceased' : '';
      // Drop repeats: relatives who are the owner or co-owner, or appear twice.
      const seenNames = new Set([`${first} ${last}`.toLowerCase().trim()]);
      const unique = [];
      for (const pp of people) {
        const k = pp.name.toLowerCase().trim();
        if (seenNames.has(k)) continue;
        seenNames.add(k);
        unique.push(pp);
      }
      people.length = 0;
      people.push(...unique);
      const park = smartCase(r.col('Input Custom Field 1'));
      const entity = r.col('Input Custom Field 2');
      return {
        person: { first, last, company: entity && !entity.toUpperCase().includes(String(last).toUpperCase()) ? smartCase(entity) : '', phones: ph('', 7), emails: [r.col('Email1'), r.col('Email2')].filter(Boolean), role: 'Seller', address: mailing, flags },
        item: {
          title: park, address: titleCase(r.col('Input Property Address')), city: titleCase(r.col('Input Property City')), state: r.col('Input Property State'), zip: r.col('Input Property Zip'),
          property_type: /trailer|mobile|mhp|park|rv|estates/i.test(park) ? 'Mobile home park' : '',
          status: r.col('Status'), notes: r.col('Notes'), people,
          highlights: [['Owner of record', smartCase(entity)], ['Owner age', r.col('Age')], ['Match', r.col('ResultCode')]],
        },
      };
    },
  },
  {
    id: 'network',
    label: 'SubTo Directory (community members from Zoom)',
    kind: 'network',
    detect: (h) => h.has('blinq card') || h.has('communities') || (h.has('calls attended') && h.has('contact id')),
    build(r) {
      return {
        person: {
          first: r.col('First Name'), last: r.col('Last Name'), phones: [phone(r.col('Phone'))].filter(Boolean), emails: [r.col('Email')].filter(Boolean),
          state: r.col('State'), city: r.col('City / Area', 'City'), communities: r.col('Communities'), calls_attended: r.col('Calls Attended'),
          link: r.col('Blinq Card', 'Blinq'), ext_id: r.col('Contact ID'), notes: r.col('Comments (what they said)', 'Comments'),
          flags: r.col('Notes / Flags'), tags: r.col('Role'), role: 'Other',
        },
      };
    },
  },
  {
    id: 'zoom-names',
    label: 'Zoom name map (recognizes people across calls)',
    kind: 'namemap',
    detect: (h) => h.has('zoom name (as displayed)') && h.has('contact id'),
    build(r) {
      return { map: { zoom: r.col('Zoom Name (as displayed)'), ext_id: r.col('Contact ID') } };
    },
  },
  {
    id: 'chat-log',
    label: 'Zoom chat log (becomes each person\'s history)',
    kind: 'chat',
    detect: (h) => h.has('message') && h.has('contact id') && (h.has('sender (as shown in zoom)') || h.has('matched contact')),
    build(r) {
      return { chat: { ext_id: r.col('Contact ID'), date: r.col('Date'), time: r.col('Time'), call: r.col('Call'), message: r.col('Message'), sender: r.col('Sender (as shown in Zoom)', 'Matched Contact') } };
    },
  },
];

// Sheets that are notes or lookups, not data to import.
const SKIP_SHEETS = /^(read ?me|start here|instructions?|review|notes?)\b/i;

function headerSet(headers) {
  const s = new Set(headers.map((h) => h.toLowerCase()));
  return { has: (n) => s.has(n.toLowerCase()) };
}

// Picks the recipe for a sheet. Unknown sheets fall back to "contacts" (match columns yourself) or skip.
function detectRecipe(sheet) {
  if (!sheet.headers.length) return { id: 'skip', kind: 'skip', label: 'Instructions only (skipped)' };
  if (SKIP_SHEETS.test(sheet.name)) return { id: 'skip', kind: 'skip', label: 'Notes / lookup sheet (skipped)' };
  const h = headerSet(sheet.headers);
  const r = RECIPES.find((x) => x.detect(h));
  if (r) return { id: r.id, kind: r.kind, label: r.label };
  const g = guessMapping(sheet.headers);
  if (g.phone || g.email || g.full_name || g.first_name) return { id: 'contacts', kind: 'contacts', label: 'Contact list (match the columns)' };
  return { id: 'skip', kind: 'skip', label: 'Not recognized (skipped)' };
}

// Runs a recipe on one row. Returns { person, item, chat, extra }.
function applyRecipe(recipeId, row, headers) {
  const recipe = RECIPES.find((x) => x.id === recipeId);
  if (!recipe) throw new Error(`Unknown recipe ${recipeId}`);
  const r = reader(row, headers);
  const out = recipe.build(r, headers);
  // Sheet details: every non-empty column the recipe didn't use, as "Header: value" lines.
  const extra = headers.filter((h) => !r.used.has(h) && String(row[h] || '').trim())
    .map((h) => `${/^Column \d+$/.test(h) ? `Unlabeled ${h.toLowerCase()}` : h}: ${String(row[h]).trim()}`);
  if (out.item) {
    const st = out.item.status;
    const norm = normalizeStatus(st);
    if (st && !norm) extra.unshift(`Original status: ${st}`);
    out.item.status = norm || 'Not called';
    out.item.attempts = Math.max(0, parseInt(out.item.attempts, 10) || 0);
    out.item.follow_up = isoDate(out.item.follow_up);
    out.item.highlights = (out.item.highlights || []).filter(([, v]) => v).map(([label, value]) => ({ label, value }));
    out.item.people = out.item.people || [];
  }
  out.extra = extra.join('\n');
  return out;
}

module.exports = { RECIPES, STATUSES, CLOSED_STATUSES, normalizeStatus, detectRecipe, applyRecipe, splitName, smartCase };
