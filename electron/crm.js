// CRM: contacts, deals (pipeline), tasks and the activity log. All data stays in the local database.

const STAGES = ['Lead', 'Talking', 'Offer Sent', 'Under Contract', 'Closed', 'Dead'];
const SELLER_ROLES = ['Seller', "Seller's agent", "Seller's attorney"];
const isSellerSide = (role) => /^(seller|seller'?s? agent|listing agent|agent|seller'?s? attorney|co-?owner|owner)$/i.test(String(role || '').trim());
const TEAM_ROLES = ['Buyer', 'TC', 'Gator / Private lender', 'JV partner', 'Closer', 'Agent', 'Title / Escrow', 'Bird dog', 'Other'];
const TEAM_BRINGS = ['Down payment / EMD', 'Gap funding', 'Rehab money', 'Purchase loan', 'Cash to seller', 'Reserves', 'Nothing (service only)'];
const TEAM_STATUS = ['Asked', 'Pending', 'Committed', 'Funded', 'Backed out'];
const ROLES = ['Seller', 'Agent', 'Buyer', 'JV Partner', 'Lender', 'Title / Attorney', 'TC', 'Referral Partner', 'Other'];
const STRATEGIES = ['Subject-To', 'Seller Finance', 'Hybrid', 'Wrap', 'Novation', 'Wholesale', 'Cash', 'Lease Option', 'BRRRR', 'Other'];
const PROPERTY_TYPES = ['Single family', 'Multifamily 2-4', 'Multifamily 5+', 'Commercial', 'Short-term rental', 'Land', 'Mobile home', 'Business', 'Other'];
const ACTIVITY_KINDS = ['note', 'call', 'text', 'email', 'offer', 'meeting', 'stage', 'chat'];
const KINDS = ['contact', 'network', 'lead'];
const CALL_OUTCOMES = ['Talked', 'Left voicemail', 'No answer', 'Not interested', 'Call back later', 'Wrong number'];
const PRIORITIES = ['Low', 'Normal', 'High'];

const str = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const isoDate = (v) => {
  const s = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
const id = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// US phone numbers to one format: "(512) 555-0142". Others are kept as typed.
function formatPhone(v) {
  const raw = str(v, 40);
  const d = raw.replace(/\D/g, '');
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return raw;
}
// "+15125550142" for dialing; null if it isn't a usable number.
function dialable(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === '1') return `+${d}`;
  if (d.length > 11 && d.length <= 15) return `+${d}`;
  return null;
}
const phoneKey = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const cleanTags = (v) => [...new Set(String(v || '').split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 20).join(', ');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function contactName(c) {
  const n = `${c.first_name || ''} ${c.last_name || ''}`.trim();
  return n || c.company || c.phone || c.email || 'Unnamed contact';
}
function dealTitle(d) {
  const place = [d.city, d.state].filter(Boolean).join(', ');
  return d.address ? (place ? `${d.address}, ${place}` : d.address) : (place || `Deal #${d.id}`);
}

function createCrm(db) {
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  // ---------- contacts ----------
  function cleanPhones(list) {
    let arr = list;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = []; } }
    if (!Array.isArray(arr)) return '[]';
    const out = [];
    const seen = new Set();
    for (const p of arr.slice(0, 40)) {
      const n = formatPhone(p && p.n);
      const key = phoneKey(n);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ n, type: str(p.type, 30), label: str(p.label, 40), bad: !!p.bad });
    }
    return JSON.stringify(out);
  }
  function cleanContact(c) {
    return {
      first_name: str(c.first_name, 80), last_name: str(c.last_name, 80), company: str(c.company, 120),
      role: pick(c.role, ROLES, 'Other'), phone: formatPhone(c.phone), phone2: formatPhone(c.phone2),
      email: str(c.email, 160).toLowerCase(), address: str(c.address, 200), tags: cleanTags(c.tags), notes: str(c.notes, 20000),
      kind: pick(c.kind, KINDS, 'contact'), more_phones: cleanPhones(c.more_phones || []), emails2: str(c.emails2, 400).toLowerCase(),
      extra: str(c.extra, 20000), state: str(c.state, 40), city: str(c.city, 80), communities: str(c.communities, 300),
      calls_attended: str(c.calls_attended, 500), link: /^https?:\/\//i.test(str(c.link, 400)) ? str(c.link, 400) : '',
      ext_id: str(c.ext_id, 40), flags: str(c.flags, 2000),
    };
  }
  const CONTACT_COLS = ['first_name', 'last_name', 'company', 'role', 'phone', 'phone2', 'email', 'address', 'tags', 'notes',
    'kind', 'more_phones', 'emails2', 'extra', 'state', 'city', 'communities', 'calls_attended', 'link', 'ext_id', 'flags'];
  function insertContact(c) {
    return db.run(`INSERT INTO contacts (${CONTACT_COLS.join(', ')}) VALUES (${CONTACT_COLS.map(() => '?').join(', ')})`, CONTACT_COLS.map((k) => c[k]));
  }
  function decorateContact(r) {
    let phones = [];
    try { phones = JSON.parse(r.more_phones || '[]'); } catch { phones = []; }
    return { ...r, name: contactName(r), more_phones: phones };
  }
  function listContacts({ q = '', role = '', tag = '', limit = 500, kind = 'contact' } = {}) {
    const where = [];
    const p = [];
    if (kind !== 'any') { where.push('kind = ?'); p.push(pick(kind, KINDS, 'contact')); }
    if (q) {
      const like = `%${str(q, 80)}%`;
      const digits = str(q, 40).replace(/\D/g, '');
      where.push(`(first_name || ' ' || last_name LIKE ? OR company LIKE ? OR email LIKE ? OR tags LIKE ? OR address LIKE ? OR communities LIKE ? OR city LIKE ?${digits.length >= 3 ? " OR replace(replace(replace(replace(phone,'(',''),')',''),'-',''),' ','') LIKE ? OR more_phones LIKE ?" : ''})`);
      p.push(like, like, like, like, like, like, like);
      if (digits.length >= 3) p.push(`%${digits.slice(-4)}%`);
      if (digits.length >= 3) p.push(`%${digits}%`);
    }
    if (role) { where.push('role = ?'); p.push(role); }
    if (tag) { where.push("(', ' || tags || ',') LIKE ?"); p.push(`%, ${str(tag, 40)},%`); }
    const rows = db.all(`SELECT c.*, (SELECT MAX(created_at) FROM activities a WHERE a.contact_id = c.id) AS last_activity
      FROM contacts c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(last_activity, c.updated_at) DESC LIMIT ?`, [...p, Math.min(5000, limit)]);
    return rows.map(decorateContact);
  }
  function getContact(cid) {
    const c = db.get('SELECT * FROM contacts WHERE id = ?', [id(cid)]);
    if (!c) throw new Error('Contact not found');
    return {
      ...decorateContact(c),
      leads: db.all(`SELECT li.id, li.list_id, li.status, li.title, li.address, li.city, l.name AS list_name FROM list_items li JOIN lists l ON l.id = li.list_id WHERE li.contact_id = ? ORDER BY li.id DESC LIMIT 50`, [c.id]),
      deals: db.all(`SELECT d.*, dc.role AS link_role, dc.brings, dc.amount, dc.terms, dc.status AS team_status FROM deals d JOIN deal_contacts dc ON dc.deal_id = d.id WHERE dc.contact_id = ? ORDER BY d.updated_at DESC`, [c.id])
        .map((d) => ({ ...d, title: dealTitle(d) })),
      tasks: listTasks({ contactId: c.id, includeDone: true }),
      activities: listActivities({ contactId: c.id }),
    };
  }
  function saveContact(input) {
    const c = cleanContact(input || {});
    if (!c.first_name && !c.last_name && !c.company && !c.phone && !c.email) throw new Error('Add at least a name, company, phone or email');
    const cid = id(input && input.id);
    if (cid) {
      const old = db.get('SELECT * FROM contacts WHERE id = ?', [cid]);
      if (!old) throw new Error('Contact not found');
      // Fields the form didn't send keep their saved value.
      const vals = CONTACT_COLS.map((k) => (input[k] === undefined ? old[k] : c[k]));
      db.run(`UPDATE contacts SET ${CONTACT_COLS.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...vals, now(), cid]);
      return getContact(cid);
    }
    return getContact(insertContact(c));
  }
  // Network member or lead becomes a working contact ("Work with them").
  function promoteContact(cid, role) {
    const c = db.get('SELECT kind, role FROM contacts WHERE id = ?', [id(cid)]);
    if (!c) throw new Error('Contact not found');
    db.run('UPDATE contacts SET kind = ?, role = ?, updated_at = ? WHERE id = ?', ['contact', pick(role, ROLES, c.role), now(), id(cid)]);
    return getContact(cid);
  }
  function deleteContact(cid) { db.run('DELETE FROM contacts WHERE id = ?', [id(cid)]); return true; }
  function allTags() {
    const set = new Set();
    for (const r of db.all("SELECT tags FROM contacts WHERE tags <> ''")) r.tags.split(',').forEach((t) => t.trim() && set.add(t.trim()));
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // ---------- deals ----------
  const DEAL_NUMS = ['asking_price', 'arv', 'loan_balance', 'interest_rate', 'piti', 'rent', 'entry_fee'];
  function cleanDeal(d) {
    const out = {
      address: str(d.address, 200), city: str(d.city, 80), state: str(d.state, 40).toUpperCase(), zip: str(d.zip, 12),
      property_type: pick(d.property_type, PROPERTY_TYPES, 'Single family'), strategy: pick(d.strategy, STRATEGIES, 'Subject-To'),
      source: str(d.source, 120), next_follow_up: isoDate(d.next_follow_up), notes: str(d.notes, 10000), dead_reason: str(d.dead_reason, 300),
    };
    for (const k of DEAL_NUMS) out[k] = num(d[k]);
    return out;
  }
  function decorateDeal(d) {
    const contacts = db.all(`SELECT c.id, c.first_name, c.last_name, c.company, c.phone, c.role, dc.role AS link_role
      FROM contacts c JOIN deal_contacts dc ON dc.contact_id = c.id WHERE dc.deal_id = ?`, [d.id]).map((c) => ({ ...c, name: contactName(c) }));
    const openTasks = db.get('SELECT COUNT(*) AS n FROM tasks WHERE deal_id = ? AND done = 0', [d.id]).n;
    return { ...d, title: dealTitle(d), contacts, openTasks, overdue: !!(d.next_follow_up && d.next_follow_up < today() && !['Closed', 'Dead'].includes(d.stage)) };
  }
  function listDeals({ q = '', includeDead = false } = {}) {
    const where = [];
    const p = [];
    if (!includeDead) where.push("stage <> 'Dead'");
    if (q) {
      const like = `%${str(q, 80)}%`;
      where.push(`(address LIKE ? OR city LIKE ? OR zip LIKE ? OR notes LIKE ? OR source LIKE ? OR id IN (SELECT dc.deal_id FROM deal_contacts dc JOIN contacts c ON c.id = dc.contact_id WHERE c.first_name || ' ' || c.last_name LIKE ? OR c.company LIKE ?))`);
      p.push(like, like, like, like, like, like, like);
    }
    return db.all(`SELECT * FROM deals ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY position ASC, id ASC`, p).map(decorateDeal);
  }
  function getDeal(did) {
    const d = db.get('SELECT * FROM deals WHERE id = ?', [id(did)]);
    if (!d) throw new Error('Deal not found');
    return { ...decorateDeal(d), tasks: listTasks({ dealId: d.id, includeDone: true }), activities: listActivities({ dealId: d.id }) };
  }
  function nextPosition(stage) {
    const r = db.get('SELECT MAX(position) AS m FROM deals WHERE stage = ?', [stage]);
    return (r && r.m != null ? r.m : 0) + 1;
  }
  function saveDeal(input) {
    const d = cleanDeal(input || {});
    if (!d.address && !d.city && !d.zip) throw new Error('Add the property address');
    const did = id(input && input.id);
    if (did) {
      const sets = Object.keys(d).map((k) => `${k} = ?`).join(', ');
      db.run(`UPDATE deals SET ${sets}, updated_at = ? WHERE id = ?`, [...Object.values(d), now(), did]);
      return getDeal(did);
    }
    const stage = pick(input && input.stage, STAGES, 'Lead');
    const cols = Object.keys(d);
    const newId = db.run(`INSERT INTO deals (${cols.join(', ')}, stage, position) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`,
      [...Object.values(d), stage, nextPosition(stage)]);
    return getDeal(newId);
  }
  // Move a card to a stage (and optionally before another card). Logs the change.
  function moveDeal(did, stage, beforeId) {
    const dealId = id(did);
    const s = pick(stage, STAGES, null);
    if (!s) throw new Error('Unknown stage');
    const current = db.get('SELECT stage FROM deals WHERE id = ?', [dealId]);
    if (!current) throw new Error('Deal not found');
    return db.transaction(() => {
      let pos;
      const before = id(beforeId) ? db.get('SELECT position FROM deals WHERE id = ? AND stage = ?', [id(beforeId), s]) : null;
      if (before) {
        const prev = db.get('SELECT MAX(position) AS m FROM deals WHERE stage = ? AND position < ? AND id <> ?', [s, before.position, dealId]);
        pos = prev && prev.m != null ? (prev.m + before.position) / 2 : before.position - 1;
      } else {
        pos = nextPosition(s);
      }
      db.run('UPDATE deals SET stage = ?, position = ?, updated_at = ?, closed_at = CASE WHEN ? = \'Closed\' THEN COALESCE(closed_at, ?) ELSE NULL END WHERE id = ?',
        [s, pos, now(), s, now(), dealId]);
      if (current.stage !== s) {
        db.run('INSERT INTO activities (kind, body, deal_id) VALUES (?, ?, ?)', ['stage', `${current.stage} → ${s}`, dealId]);
      }
      return getDeal(dealId);
    });
  }
  function deleteDeal(did) { db.run('DELETE FROM deals WHERE id = ?', [id(did)]); return true; }
  function linkContact(did, cid, role = '') {
    db.run("INSERT INTO deal_contacts (deal_id, contact_id, role, added_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(deal_id, contact_id) DO UPDATE SET role = excluded.role",
      [id(did), id(cid), str(role, 40)]);
    return getDeal(did);
  }

  // ---------- deal team ----------
  // Who you're doing the deal with: SubTo Directory first, then your contacts.
  function teamSearch(q, dealId, side = 'team') {
    const t = str(q, 80);
    if (!t) return { directory: [], contacts: [], leads: [] };
    const like = `%${t}%`;
    const digits = t.replace(/\D/g, '');
    const taken = new Set(dealId ? db.all('SELECT contact_id FROM deal_contacts WHERE deal_id = ?', [id(dealId)]).map((r) => r.contact_id) : []);
    const run = (kind) => db.all(`SELECT id, first_name, last_name, company, phone, role, kind, communities, state, city, calls_attended FROM contacts
      WHERE kind = ? AND ((first_name || ' ' || last_name) LIKE ? OR company LIKE ? OR communities LIKE ? OR state LIKE ? OR city LIKE ? OR email LIKE ?
        ${digits.length >= 4 ? "OR replace(replace(replace(replace(phone,'(',''),')',''),'-',''),' ','') LIKE ?" : ''})
      ORDER BY lower(first_name), lower(last_name) LIMIT 12`, [kind, like, like, like, like, like, like, ...(digits.length >= 4 ? [`%${digits}%`] : [])])
      .filter((c) => !taken.has(c.id))
      .map((c) => ({ ...c, name: contactName(c), calls: String(c.calls_attended || '').split(',').filter((x) => x.trim()).length }));
    return { directory: run('network'), contacts: run('contact'), leads: side === 'seller' ? run('lead') : [] };
  }
  function team(did) {
    const d = db.get('SELECT id, funds_needed FROM deals WHERE id = ?', [id(did)]);
    if (!d) throw new Error('Deal not found');
    const members = db.all(`SELECT c.id, c.first_name, c.last_name, c.company, c.phone, c.email, c.kind, c.communities, c.state, c.link,
        dc.role, dc.brings, dc.amount, dc.terms, dc.status
      FROM deal_contacts dc JOIN contacts c ON c.id = dc.contact_id WHERE dc.deal_id = ? ORDER BY dc.added_at, c.id`, [d.id])
      .map((c) => ({ ...c, name: contactName(c), sellerSide: isSellerSide(c.role) }));
    const seller = members.filter((m) => m.sellerSide);
    const crew = members.filter((m) => !m.sellerSide);
    let needed = d.funds_needed;
    let neededFrom = needed != null ? 'typed' : '';
    if (needed == null) {
      const a = db.get('SELECT summary FROM analyses WHERE deal_id = ? ORDER BY updated_at DESC LIMIT 1', [d.id]);
      const cash = a ? JSON.parse(a.summary || '{}').cashIn : null;
      if (Number.isFinite(cash) && cash > 0) { needed = Math.round(cash); neededFrom = 'underwriting'; }
    }
    const money = (m) => (m.brings && m.brings !== 'Nothing (service only)' && Number.isFinite(m.amount) ? m.amount : 0);
    const committed = crew.filter((m) => ['Committed', 'Funded'].includes(m.status)).reduce((s, m) => s + money(m), 0);
    const pending = crew.filter((m) => ['Asked', 'Pending'].includes(m.status)).reduce((s, m) => s + money(m), 0);
    const splits = crew.map((m) => { const x = String(m.terms || '').match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?(?:the\s*)?profit/i); return x ? Number(x[1]) : null; }).filter((x) => x != null);
    return {
      members: crew, seller, needed: needed ?? null, neededFrom, committed, pending,
      short: needed != null ? Math.max(0, needed - committed) : null,
      splitTotal: splits.length ? splits.reduce((a, b) => a + b, 0) : null,
    };
  }
  function saveTeamMember(did, cid, f = {}) {
    const dealId = id(did), contactId = id(cid);
    if (!db.get('SELECT id FROM deals WHERE id = ?', [dealId])) throw new Error('Deal not found');
    if (!db.get('SELECT id FROM contacts WHERE id = ?', [contactId])) throw new Error('Person not found');
    const amt = f.amount === '' || f.amount == null ? null : Number(String(f.amount).replace(/[$,\s]/g, ''));
    const vals = [str(f.role, 40), str(f.brings, 40), Number.isFinite(amt) ? amt : null, str(f.terms, 200), pick(f.status, TEAM_STATUS, 'Pending')];
    if (db.get('SELECT 1 AS x FROM deal_contacts WHERE deal_id = ? AND contact_id = ?', [dealId, contactId])) {
      db.run('UPDATE deal_contacts SET role = ?, brings = ?, amount = ?, terms = ?, status = ? WHERE deal_id = ? AND contact_id = ?', [...vals, dealId, contactId]);
    } else {
      db.run("INSERT INTO deal_contacts (role, brings, amount, terms, status, deal_id, contact_id, added_at) VALUES (?,?,?,?,?,?,?, datetime('now'))", [...vals, dealId, contactId]);
      const c = db.get('SELECT first_name, last_name, company, email FROM contacts WHERE id = ?', [contactId]);
      db.run("INSERT INTO activities (kind, body, deal_id, contact_id) VALUES ('note', ?, ?, ?)", [`Added to the deal team${vals[0] ? ` as ${vals[0]}` : ''}: ${contactName(c)}`, dealId, contactId]);
    }
    return team(dealId);
  }
  function removeTeamMember(did, cid) { db.run('DELETE FROM deal_contacts WHERE deal_id = ? AND contact_id = ?', [id(did), id(cid)]); return team(did); }
  function setFundsNeeded(did, amount) {
    const amt = amount === '' || amount == null ? null : Number(String(amount).replace(/[$,\s]/g, ''));
    db.run('UPDATE deals SET funds_needed = ? WHERE id = ?', [Number.isFinite(amt) ? amt : null, id(did)]);
    return team(did);
  }
  function unlinkContact(did, cid) { db.run('DELETE FROM deal_contacts WHERE deal_id = ? AND contact_id = ?', [id(did), id(cid)]); return getDeal(did); }

  // ---------- tasks ----------
  function listTasks({ dealId, contactId, includeDone = false, scope = '' } = {}) {
    const where = [];
    const p = [];
    if (dealId) { where.push('t.deal_id = ?'); p.push(id(dealId)); }
    if (contactId) { where.push('t.contact_id = ?'); p.push(id(contactId)); }
    if (!includeDone) where.push('t.done = 0');
    if (scope === 'due') { where.push('t.done = 0 AND t.due_date IS NOT NULL AND t.due_date <= ?'); p.push(today()); }
    const rows = db.all(`SELECT t.*, d.address, d.city, d.state, d.id AS d_id, c.first_name, c.last_name, c.company
      FROM tasks t LEFT JOIN deals d ON d.id = t.deal_id LEFT JOIN contacts c ON c.id = t.contact_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY t.done ASC, CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date ASC,
        CASE t.priority WHEN 'High' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END, t.id DESC`, p);
    return rows.map((t) => ({
      id: t.id, title: t.title, due_date: t.due_date, done: !!t.done, done_at: t.done_at, priority: t.priority, notes: t.notes,
      deal_id: t.deal_id, contact_id: t.contact_id, created_at: t.created_at,
      deal_title: t.deal_id ? dealTitle({ id: t.d_id, address: t.address, city: t.city, state: t.state }) : '',
      contact_name: t.contact_id ? contactName(t) : '',
    }));
  }
  function saveTask(input) {
    const t = input || {};
    const title = str(t.title, 300);
    if (!title) throw new Error('Give the task a name');
    const vals = [title, isoDate(t.due_date), pick(t.priority, PRIORITIES, 'Normal'), str(t.notes, 5000), id(t.deal_id), id(t.contact_id)];
    const tid = id(t.id);
    if (tid) {
      db.run('UPDATE tasks SET title=?, due_date=?, priority=?, notes=?, deal_id=?, contact_id=? WHERE id=?', [...vals, tid]);
      return tid;
    }
    return db.run('INSERT INTO tasks (title, due_date, priority, notes, deal_id, contact_id) VALUES (?,?,?,?,?,?)', vals);
  }
  function setTaskDone(tid, done) {
    db.run('UPDATE tasks SET done = ?, done_at = ? WHERE id = ?', [done ? 1 : 0, done ? now() : null, id(tid)]);
    return true;
  }
  function deleteTask(tid) { db.run('DELETE FROM tasks WHERE id = ?', [id(tid)]); return true; }

  // ---------- activity log ----------
  function listActivities({ dealId, contactId, limit = 200 } = {}) {
    const where = [];
    const p = [];
    if (dealId) { where.push('a.deal_id = ?'); p.push(id(dealId)); }
    if (contactId) { where.push('a.contact_id = ?'); p.push(id(contactId)); }
    return db.all(`SELECT a.*, c.first_name, c.last_name, c.company, d.address, d.city, d.state
      FROM activities a LEFT JOIN contacts c ON c.id = a.contact_id LEFT JOIN deals d ON d.id = a.deal_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`, [...p, limit])
      .map((a) => ({
        id: a.id, kind: a.kind, body: a.body, outcome: a.outcome, deal_id: a.deal_id, contact_id: a.contact_id, created_at: a.created_at,
        contact_name: a.contact_id ? contactName(a) : '', deal_title: a.deal_id ? dealTitle({ id: a.deal_id, address: a.address, city: a.city, state: a.state }) : '',
      }));
  }
  function logActivity(input) {
    const a = input || {};
    const kind = pick(a.kind, ACTIVITY_KINDS.filter((k) => k !== 'stage' && k !== 'chat'), null);
    if (!kind) throw new Error('Unknown activity type');
    const body = str(a.body, 5000);
    const outcome = kind === 'call' ? (CALL_OUTCOMES.includes(a.outcome) ? a.outcome : str(a.outcome, 60)) : str(a.outcome, 60);
    if (!body && !outcome) throw new Error('Write something to log');
    if (!id(a.deal_id) && !id(a.contact_id) && !id(a.list_item_id)) throw new Error('Pick a deal or contact');
    return db.transaction(() => {
      const aid = db.run('INSERT INTO activities (kind, body, outcome, deal_id, contact_id, list_item_id) VALUES (?,?,?,?,?,?)',
        [kind, body, outcome, id(a.deal_id), id(a.contact_id), id(a.list_item_id)]);
      // An offer moves a deal from Lead/Talking to Offer Sent automatically.
      if (kind === 'offer' && id(a.deal_id)) {
        const d = db.get('SELECT stage FROM deals WHERE id = ?', [id(a.deal_id)]);
        if (d && (d.stage === 'Lead' || d.stage === 'Talking')) moveDeal(a.deal_id, 'Offer Sent');
      }
      if (id(a.deal_id)) db.run('UPDATE deals SET updated_at = ? WHERE id = ?', [now(), id(a.deal_id)]);
      if (id(a.contact_id)) db.run('UPDATE contacts SET updated_at = ? WHERE id = ?', [now(), id(a.contact_id)]);
      return aid;
    });
  }
  function deleteActivity(aid) { db.run('DELETE FROM activities WHERE id = ?', [id(aid)]); return true; }

  // ---------- numbers & reminders ----------
  // This week = Monday 00:00 local time to now.
  function weekStartUtc(ref = new Date()) {
    const d = new Date(ref);
    const day = (d.getDay() + 6) % 7; // Monday = 0
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }
  function weeklyNumbers(ref, until) {
    const since = weekStartUtc(ref);
    const end = until || '9999-12-31';
    const count = (sql, p = []) => db.get(sql.replace('created_at >= ?', 'created_at >= ? AND created_at < ?'), [since, end, ...p]).n;
    return {
      since,
      calls: count("SELECT COUNT(*) AS n FROM activities WHERE created_at >= ? AND kind = 'call'"),
      conversations: count("SELECT COUNT(*) AS n FROM activities WHERE created_at >= ? AND kind = 'call' AND outcome = 'Talked'"),
      texts: count("SELECT COUNT(*) AS n FROM activities WHERE created_at >= ? AND kind IN ('text','email')"),
      offers: count("SELECT COUNT(*) AS n FROM activities WHERE created_at >= ? AND kind = 'offer'"),
      contracts: count("SELECT COUNT(*) AS n FROM activities WHERE created_at >= ? AND kind = 'stage' AND body LIKE '%→ Under Contract'"),
      closings: count("SELECT COUNT(*) AS n FROM activities WHERE created_at >= ? AND kind = 'stage' AND body LIKE '%→ Closed'"),
    };
  }
  // The last `weeks` weeks (oldest first), Monday to Sunday, for the dashboard trend lines.
  function weeklyTrend(weeks = 8) {
    const out = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const ref = new Date(); ref.setDate(ref.getDate() - 7 * i);
      const next = new Date(ref); next.setDate(next.getDate() + 7);
      out.push(weeklyNumbers(ref, i === 0 ? null : weekStartUtc(next)));
    }
    return out;
  }
  function dueToday() {
    const t = today();
    const followUps = db.all(`SELECT * FROM deals WHERE next_follow_up IS NOT NULL AND next_follow_up <= ? AND stage NOT IN ('Closed','Dead') ORDER BY next_follow_up`, [t])
      .map((d) => ({ ...decorateDeal(d) }));
    const tasks = listTasks({ scope: 'due' });
    const leadFollowUps = db.all(`SELECT li.id, li.list_id, li.title, li.address, li.city, li.status, li.follow_up, l.name AS list_name,
        c.first_name, c.last_name, c.company FROM list_items li JOIN lists l ON l.id = li.list_id LEFT JOIN contacts c ON c.id = li.contact_id
      WHERE li.follow_up IS NOT NULL AND li.follow_up <= ? AND li.status NOT IN ('Not interested','Wrong number','Do not call','Sold / under contract')
      ORDER BY li.follow_up LIMIT 50`, [t]).map((x) => ({ ...x, contact_name: x.first_name || x.last_name || x.company ? contactName(x) : '' }));
    return { today: t, followUps, tasks, leadFollowUps, overdueTasks: tasks.filter((x) => x.due_date < t).length };
  }
  function pipelineCounts() {
    const out = Object.fromEntries(STAGES.map((s) => [s, 0]));
    for (const r of db.all('SELECT stage, COUNT(*) AS n FROM deals GROUP BY stage')) out[r.stage] = r.n;
    return out;
  }

  // ---------- import ----------
  // rows: array of objects; map: { first_name: 'Owner First', phone: 'Phone 1', ... } (column names)
  function importContacts(rows, map, { role = 'Other', tags = '', skipDuplicates = true, kind = 'contact' } = {}) {
    const fields = ['first_name', 'last_name', 'full_name', 'company', 'phone', 'phone2', 'email', 'address', 'notes'];
    const existingPhones = new Set(db.all("SELECT phone, phone2 FROM contacts").flatMap((r) => [phoneKey(r.phone), phoneKey(r.phone2)]).filter(Boolean));
    const existingEmails = new Set(db.all("SELECT email FROM contacts WHERE email <> ''").map((r) => r.email.toLowerCase()));
    let added = 0; let skipped = 0; let empty = 0;
    db.transaction(() => {
      for (const row of (rows || []).slice(0, 20000)) {
        const v = {};
        for (const f of fields) v[f] = map[f] ? str(row[map[f]], f === 'notes' ? 2000 : 200) : '';
        if (v.full_name && !v.first_name && !v.last_name) {
          const parts = v.full_name.split(/\s+/);
          v.first_name = parts.shift() || '';
          v.last_name = parts.join(' ');
        }
        const c = cleanContact({ ...v, role, tags, kind });
        if (!c.first_name && !c.last_name && !c.company && !c.phone && !c.email) { empty++; continue; }
        const pk = phoneKey(c.phone);
        if (skipDuplicates && ((pk && existingPhones.has(pk)) || (c.email && existingEmails.has(c.email)))) { skipped++; continue; }
        insertContact(c);
        if (pk) existingPhones.add(pk);
        if (c.email) existingEmails.add(c.email);
        added++;
      }
    });
    return { added, skipped, empty };
  }

  return {
    listContacts, getContact, saveContact, deleteContact, allTags, promoteContact, cleanContact, insertContact,
    listDeals, getDeal, saveDeal, moveDeal, deleteDeal, linkContact, unlinkContact,
    teamSearch, team, saveTeamMember, removeTeamMember, setFundsNeeded,
    listTasks, saveTask, setTaskDone, deleteTask,
    listActivities, logActivity, deleteActivity,
    weeklyNumbers, weeklyTrend, dueToday, pipelineCounts, importContacts,
  };
}

// Guess which spreadsheet column holds which field, from the header names.
function guessMapping(headers) {
  const h = headers.map((x) => ({ raw: x, k: String(x).toLowerCase().replace(/[^a-z0-9]/g, '') }));
  const find = (...tests) => { for (const t of tests) { const m = h.find((x) => t.test(x.k)); if (m) return m.raw; } return ''; };
  const map = {
    first_name: find(/^(owner)?firstname$/, /^first$/, /^fname$/, /firstname/),
    last_name: find(/^(owner)?lastname$/, /^last$/, /^lname$/, /lastname/, /surname/),
    full_name: find(/^(owner|full|contact|agent)?name$/, /^owner$/, /ownername/, /fullname/, /contactname/, /agentname/),
    company: find(/company/, /brokerage/, /business/, /office/, /entity/),
    phone: find(/^(phone|phone1|mobile|cell|cellphone|mobilephone|phonenumber|primaryphone|wireless1|landline1)$/, /^phone/, /mobile|cell/, /phone/),
    email: find(/^e?mail/, /email/),
    address: find(/^(property)?address$/, /propertyaddress/, /mailingaddress/, /^street/, /address/),
    notes: find(/^notes?$/, /comment/),
  };
  const phone2 = h.find((x) => /phone|mobile|cell|landline|wireless/.test(x.k) && x.raw !== map.phone);
  map.phone2 = phone2 ? phone2.raw : '';
  if (map.first_name || map.last_name) map.full_name = '';
  return map;
}

// Small CSV reader (quotes, commas and line breaks inside quotes).
function parseCsv(text) {
  const rows = [];
  let row = []; let cell = ''; let q = false;
  const t = String(text).replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

// Turns a grid (first row = headers) into objects.
function gridToObjects(grid) {
  if (!grid.length) return { headers: [], rows: [] };
  const headers = grid[0].map((x, i) => String(x || '').trim() || `Column ${i + 1}`);
  const rows = grid.slice(1).map((r) => Object.fromEntries(headers.map((hh, i) => [hh, r[i] == null ? '' : String(r[i])])));
  return { headers, rows };
}

module.exports = {
  createCrm, KINDS, phoneKey, STAGES, ROLES, SELLER_ROLES, isSellerSide, TEAM_ROLES, TEAM_BRINGS, TEAM_STATUS, STRATEGIES, PROPERTY_TYPES, CALL_OUTCOMES, PRIORITIES,
  formatPhone, dialable, guessMapping, parseCsv, gridToObjects, contactName, dealTitle,
};
