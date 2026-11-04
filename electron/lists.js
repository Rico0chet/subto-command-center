// Lead lists: import a spreadsheet as a call queue, work it, promote good leads to deals, export it back.
const fs = require('fs');
const path = require('path');
const { readWorkbook } = require('./sheets');
const R = require('./recipes');
const { phoneKey, contactName, guessMapping } = require('./crm');

const REACHED = ['Interested', 'Appointment set', 'Not interested', 'Call back'];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const str = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);
const idOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// How each recipe's own sheet columns are written back on export.
const WRITE_BACK = {
  'agent-call-list': {
    status: 'Status', attempts: 'Attempts', last_called: 'Last Called', follow_up: 'Follow-Up Date', notes: 'Notes', appointment: 'Appt Date / Time', caller: 'Caller Name',
    statusOut: { 'Not called': 'Not Called', 'No answer': 'No Answer', 'Left voicemail': 'Left Voicemail', 'Call back': 'Call Back Later', Interested: 'Interested - Send to Closer',
      'Appointment set': 'Appointment Set', 'Not interested': 'Not Interested', 'Wrong number': 'Wrong / Disconnected Number', 'Do not call': 'Do Not Call', 'Sold / under contract': 'Under Contract / Sold' },
  },
  'owner-list': { notes: 'NOTES', caller: 'Cold Caller Name', last_called: 'Dates Called' },
  'skip-trace': {},
};

function createLists(db, crm, dataDir) {
  const rawDir = path.join(dataDir, 'lists');
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  // ---------------- import ----------------
  let pending = null;

  async function analyze(file) {
    const wb = await readWorkbook(file);
    const isMhp = /mhp|mobile ?home|trailer/i.test(wb.file);
    pending = { file, wb };
    return {
      file: wb.file,
      sheets: wb.sheets.map((s, index) => {
        const recipe = R.detectRecipe(s);
        const sample = s.rows.slice(0, 3).map((row) => {
          if (recipe.id === 'skip' || recipe.id === 'contacts') return null;
          const o = R.applyRecipe(recipe.id, row, s.headers);
          const p = o.person || {};
          return {
            name: [p.first, p.last].filter(Boolean).join(' ') || p.company || '',
            phone: (p.phones && p.phones[0] && p.phones[0].n) || '',
            property: o.item ? [o.item.title, o.item.address, o.item.city].filter(Boolean).join(', ') : '',
            status: o.item ? o.item.status : '',
            extraLines: o.extra ? o.extra.split('\n').length : 0,
            chat: o.chat ? o.chat.message : '',
          };
        }).filter(Boolean);
        return {
          index, name: s.name, total: s.total, headerRow: s.headerRow, headers: s.headers, recipe, sample,
          guess: recipe.id === 'contacts' ? guessMapping(s.headers) : null,
          preview: recipe.id === 'contacts' ? s.rows.slice(0, 5) : [],
          defaultName: `${wb.file.replace(/\.[^.]+$/, '')}${wb.sheets.length > 1 ? ` – ${s.name}` : ''}`.slice(0, 80),
          defaultType: recipe.id === 'skip-trace' && isMhp ? 'Mobile home park' : '',
          info: s.preamble.slice(0, 6).join('\n'),
          links: s.links,
          include: recipe.id !== 'skip',
        };
      }),
    };
  }

  // Finds an existing person by any phone or email, so the same agent or owner is stored once.
  // Office / main lines are shared by many people (a whole brokerage), so they never identify a person.
  const sharedLine = (p) => /office|main|company|fax/i.test(`${p.type || ''} ${p.label || ''}`);
  const lastName = (s) => String(s || '').trim().toLowerCase().split(/\s+/).pop() || '';
  function buildIndex() {
    const byPhone = new Map();
    const byEmail = new Map();
    const byExt = new Map();
    const names = new Map();
    for (const c of db.all('SELECT id, first_name, last_name, company, phone, phone2, more_phones, email, ext_id FROM contacts')) {
      const extra = parse(c.more_phones, []);
      const personal = [c.phone, c.phone2, ...extra.filter((p) => !sharedLine(p)).map((p) => p.n)].filter((n) => !extra.some((p) => sharedLine(p) && phoneKey(p.n) === phoneKey(n)));
      for (const n of personal) { const k = phoneKey(n); if (k && !byPhone.has(k)) byPhone.set(k, c.id); }
      if (c.email && !byEmail.has(c.email)) byEmail.set(c.email, c.id);
      if (c.ext_id && !byExt.has(c.ext_id)) byExt.set(c.ext_id, c.id);
      names.set(c.id, lastName(c.last_name) || lastName(c.company));
    }
    const remember = (cid, person) => {
      for (const p of person.phones || []) { if (sharedLine(p)) continue; const k = phoneKey(p.n); if (k && !byPhone.has(k)) byPhone.set(k, cid); }
      for (const e of person.emails || []) { const k = String(e).toLowerCase(); if (k && !byEmail.has(k)) byEmail.set(k, cid); }
      if (person.ext_id && !byExt.has(person.ext_id)) byExt.set(person.ext_id, cid);
      names.set(cid, lastName(person.last) || lastName(person.company));
    };
    // Same phone or email AND (when both have one) the same last name.
    const sameName = (cid, person) => {
      const a = names.get(cid); const b = lastName(person.last) || lastName(person.company);
      return !a || !b || a === b;
    };
    const find = (person) => {
      if (person.ext_id && byExt.has(person.ext_id)) return byExt.get(person.ext_id);
      for (const p of person.phones || []) {
        if (sharedLine(p)) continue;
        const k = phoneKey(p.n);
        if (k && byPhone.has(k) && sameName(byPhone.get(k), person)) return byPhone.get(k);
      }
      for (const e of person.emails || []) {
        const k = String(e).toLowerCase();
        if (byEmail.has(k) && sameName(byEmail.get(k), person)) return byEmail.get(k);
      }
      return null;
    };
    return { find, remember, byExt };
  }

  function personToContact(person, kind, role) {
    const phones = person.phones || [];
    return crm.cleanContact({
      first_name: person.first, last_name: person.last, company: person.company, role: person.role || role, kind,
      phone: phones[0] && phones[0].n, phone2: phones[1] && phones[1].n, more_phones: phones,
      email: (person.emails || [])[0], emails2: (person.emails || []).slice(1).join(', '),
      address: person.address, state: person.state, city: person.city, communities: person.communities, calls_attended: person.calls_attended,
      link: person.link, ext_id: person.ext_id, notes: person.notes, flags: person.flags, tags: person.tags,
    });
  }

  const tick = () => new Promise((r) => setImmediate(r));

  // plan: { sheets: [{ index, include, recipe, name, propertyType, map, role, tags }] }; onProgress(done, total, label)
  async function run(plan, onProgress = () => {}) {
    if (!pending) throw new Error('Choose a file first');
    const { wb } = pending;
    const chosen = (plan.sheets || []).filter((p) => p.include && wb.sheets[p.index]);
    // People first (network), then lead lists, then chat logs (they need the people).
    const order = { network: 0, contacts: 1, leads: 2, namemap: 3, chat: 4 };
    chosen.sort((a, b) => (order[R.detectRecipe(wb.sheets[a.index]).kind] ?? 9) - (order[R.detectRecipe(wb.sheets[b.index]).kind] ?? 9));
    const results = [];
    const total = chosen.reduce((n, p) => n + wb.sheets[p.index].total, 0);
    let done = 0;
    const index = buildIndex();
    fs.mkdirSync(rawDir, { recursive: true });

    for (const p of chosen) {
      const sheet = wb.sheets[p.index];
      const recipe = p.recipe === 'contacts' ? { id: 'contacts', kind: 'contacts' } : R.detectRecipe(sheet);
      const res = { sheet: sheet.name, recipe: recipe.id, kind: recipe.kind, dest: '', added: 0, matched: 0, skipped: 0, listId: null, name: '' };

      if (recipe.kind === 'contacts') {
        const r = crm.importContacts(sheet.rows, p.map || guessMapping(sheet.headers), { role: p.role || 'Other', tags: p.tags || '', kind: p.kind === 'network' ? 'network' : 'contact' });
        Object.assign(res, { added: r.added, skipped: r.skipped + r.empty });
        done += sheet.total; onProgress(done, total, sheet.name);
      } else if (recipe.kind === 'leads') {
        const def = R.RECIPES.find((x) => x.id === recipe.id);
        const name = str(p.name, 80) || sheet.name;
        const listId = db.run('INSERT INTO lists (name, recipe, file_name, sheet_name, headers, person_role, info) VALUES (?,?,?,?,?,?,?)',
          [name, recipe.id, wb.file, sheet.name, JSON.stringify(sheet.headers), def.personRole, [sheet.preamble.join('\n'), ...sheet.links].filter(Boolean).join('\n').slice(0, 4000)]);
        res.listId = listId; res.name = name;
        const rawFile = fs.openSync(path.join(rawDir, `${listId}.jsonl`), 'w');
        for (let start = 0; start < sheet.rows.length; start += 400) {
          db.transaction(() => {
            for (let i = start; i < Math.min(sheet.rows.length, start + 400); i++) {
              const row = sheet.rows[i];
              const o = R.applyRecipe(recipe.id, row, sheet.headers);
              const it = o.item;
              if (!it.address && !it.title && !(o.person.phones || []).length && !o.person.first && !o.person.company) { res.skipped++; continue; }
              let cid = index.find(o.person);
              if (cid) res.matched++;
              else if (o.person.first || o.person.last || o.person.company || (o.person.phones || []).length) {
                cid = crm.insertContact(personToContact(o.person, 'lead', def.personRole));
                index.remember(cid, o.person);
              }
              db.run(`INSERT INTO list_items (list_id, position, row_number, contact_id, status, attempts, last_called, follow_up, appointment, caller, priority, notes,
                  title, address, city, state, zip, county, property_type, units, year_built, price, dom, highlights, people, extra, flags)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [listId, i + 1, sheet.rowNumbers[i], cid, it.status, it.attempts, str(it.last_called, 40), it.follow_up, str(it.appointment, 60), str(it.caller, 80),
                  str(it.priority, 20), str(it.notes, 10000), str(it.title, 160), str(it.address, 200), str(it.city, 80), str(it.state, 20), str(it.zip, 12),
                  str(it.county, 60), str(it.property_type || p.propertyType, 60), str(it.units, 20), str(it.year_built, 10), Number.isFinite(it.price) ? it.price : null, str(it.dom, 20),
                  JSON.stringify(it.highlights), JSON.stringify(it.people), str(o.extra, 30000), str(it.flags, 300)]);
              res.added++;
              fs.writeSync(rawFile, `${JSON.stringify(sheet.headers.map((h) => row[h] || ''))}\n`);
            }
          });
          done += Math.min(400, sheet.rows.length - start);
          onProgress(done, total, sheet.name);
          await tick();
        }
        fs.closeSync(rawFile);
      } else if (recipe.kind === 'network') {
        for (let start = 0; start < sheet.rows.length; start += 400) {
          db.transaction(() => {
            for (let i = start; i < Math.min(sheet.rows.length, start + 400); i++) {
              const o = R.applyRecipe(recipe.id, sheet.rows[i], sheet.headers);
              const person = o.person;
              if (!person.first && !person.last && !(person.phones || []).length && !(person.emails || []).length) { res.skipped++; continue; }
              const toContacts = p.kind === 'contact';
              const c = personToContact(person, toContacts ? 'contact' : 'network', 'Other');
              c.extra = str(o.extra, 20000);
              const cid = index.find(person);
              if (cid) {
                const old = db.get('SELECT kind FROM contacts WHERE id = ?', [cid]);
                // Keep a working contact a working contact; refresh their community details.
                db.run(`UPDATE contacts SET communities = ?, calls_attended = ?, link = CASE WHEN ? <> '' THEN ? ELSE link END, ext_id = CASE WHEN ext_id = '' THEN ? ELSE ext_id END,
                    flags = ?, extra = ?, notes = CASE WHEN notes = '' THEN ? ELSE notes END, state = CASE WHEN state = '' THEN ? ELSE state END,
                    city = CASE WHEN city = '' THEN ? ELSE city END, tags = CASE WHEN tags = '' THEN ? ELSE tags END, kind = ?, updated_at = ? WHERE id = ?`,
                  [c.communities, c.calls_attended, c.link, c.link, c.ext_id, c.flags, c.extra, c.notes, c.state, c.city, c.tags, toContacts ? 'contact' : old.kind === 'lead' ? 'network' : old.kind, now(), cid]);
                res.matched++;
              } else {
                const nid = crm.insertContact(c);
                index.remember(nid, person);
                res.added++;
              }
            }
          });
          done += Math.min(400, sheet.rows.length - start);
          onProgress(done, total, sheet.name);
          await tick();
        }
      } else if (recipe.kind === 'namemap') {
        db.transaction(() => {
          for (const row of sheet.rows) {
            const { map } = R.applyRecipe(recipe.id, row, sheet.headers);
            const cid = map.ext_id && index.byExt.get(map.ext_id);
            if (!cid || !map.zoom) { res.skipped++; continue; }
            db.run('INSERT OR REPLACE INTO zoom_names (zoom_name, contact_id) VALUES (?, ?)', [map.zoom, cid]);
            res.added++;
          }
        });
        done += sheet.rows.length;
        onProgress(done, total, sheet.name);
      } else if (recipe.kind === 'chat') {
        const seen = new Set(db.all("SELECT contact_id, created_at, body FROM activities WHERE kind = 'chat'").map((a) => `${a.contact_id}|${a.created_at}|${a.body}`));
        for (let start = 0; start < sheet.rows.length; start += 500) {
          db.transaction(() => {
            for (let i = start; i < Math.min(sheet.rows.length, start + 500); i++) {
              const { chat } = R.applyRecipe(recipe.id, sheet.rows[i], sheet.headers);
              const cid = chat.ext_id && index.byExt.get(chat.ext_id);
              if (!cid || !chat.message) { res.skipped++; continue; }
              let at = '';
              const t = Date.parse(`${chat.date}T${/^\d{1,2}:\d{2}/.test(chat.time) ? chat.time.padStart(8, '0') : '12:00:00'}`); // local time
              at = Number.isNaN(t) ? now() : new Date(t).toISOString().replace('T', ' ').slice(0, 19);
              const body = str(chat.message, 4000);
              const key = `${cid}|${at}|${body}`;
              if (seen.has(key)) { res.skipped++; continue; }
              seen.add(key);
              db.run('INSERT INTO activities (kind, body, outcome, contact_id, created_at) VALUES (?,?,?,?,?)', ['chat', body, str(chat.call ? `Zoom call ${chat.call}` : 'Zoom chat', 60), cid, at]);
              if (chat.sender && !/read\.ai/i.test(chat.sender) && !db.get('SELECT 1 AS x FROM zoom_names WHERE zoom_name = ?', [chat.sender])) db.run('INSERT INTO zoom_names (zoom_name, contact_id) VALUES (?, ?)', [chat.sender, cid]);
              res.added++;
            }
          });
          done += Math.min(500, sheet.rows.length - start);
          onProgress(done, total, sheet.name);
          await tick();
        }
      }
      res.dest = recipe.kind === 'leads' ? 'lists'
        : recipe.kind === 'contacts' ? (p.kind === 'network' ? 'directory' : 'contacts')
          : recipe.kind === 'network' ? (p.kind === 'contact' ? 'contacts' : 'directory')
            : recipe.kind === 'chat' || recipe.kind === 'namemap' ? 'history' : '';
      results.push(res);
    }
    db.save();
    pending = null;
    return results;
  }

  // ---------------- lists ----------------
  function listLists() {
    return db.all(`SELECT l.*, COUNT(li.id) AS total,
        SUM(CASE WHEN li.status <> 'Not called' OR li.attempts > 0 THEN 1 ELSE 0 END) AS called,
        SUM(CASE WHEN li.status IN ('Interested','Appointment set','Not interested','Call back') THEN 1 ELSE 0 END) AS reached,
        SUM(CASE WHEN li.status = 'Interested' THEN 1 ELSE 0 END) AS interested,
        SUM(CASE WHEN li.status = 'Appointment set' THEN 1 ELSE 0 END) AS appointments,
        SUM(CASE WHEN li.status IN ('Not interested','Wrong number','Do not call','Sold / under contract') THEN 1 ELSE 0 END) AS closed,
        SUM(CASE WHEN li.deal_id IS NOT NULL THEN 1 ELSE 0 END) AS deals
      FROM lists l LEFT JOIN list_items li ON li.list_id = l.id GROUP BY l.id ORDER BY l.id DESC`)
      .map((l) => ({ ...l, headers: undefined }));
  }

  function itemWhere(listId, { q = '', status = '', hideClosed = false } = {}) {
    const where = ['li.list_id = ?'];
    const p = [idOf(listId)];
    if (status) { where.push('li.status = ?'); p.push(status); }
    if (hideClosed) where.push("li.status NOT IN ('Not interested','Wrong number','Do not call','Sold / under contract')");
    if (q) {
      const like = `%${str(q, 80)}%`;
      where.push("(li.address LIKE ? OR li.city LIKE ? OR li.title LIKE ? OR li.zip LIKE ? OR c.first_name || ' ' || c.last_name LIKE ? OR c.company LIKE ? OR li.notes LIKE ?)");
      p.push(like, like, like, like, like, like, like);
    }
    return { sql: where.join(' AND '), p };
  }

  function listItems(listId, filter = {}) {
    const { sql, p } = itemWhere(listId, filter);
    const limit = Math.min(200, Number(filter.limit) || 100);
    const offset = Math.max(0, Number(filter.offset) || 0);
    const total = db.get(`SELECT COUNT(*) AS n FROM list_items li LEFT JOIN contacts c ON c.id = li.contact_id WHERE ${sql}`, p).n;
    const rows = db.all(`SELECT li.id, li.position, li.status, li.attempts, li.last_called, li.follow_up, li.priority, li.title, li.address, li.city, li.state, li.zip,
        li.property_type, li.price, li.dom, li.units, li.deal_id, li.highlights, li.flags,
        c.id AS contact_id, c.first_name, c.last_name, c.company, c.phone, c.flags AS contact_flags
      FROM list_items li LEFT JOIN contacts c ON c.id = li.contact_id WHERE ${sql} ORDER BY li.position LIMIT ? OFFSET ?`, [...p, limit, offset]);
    return {
      total,
      items: rows.map((r) => ({ ...r, contact_name: r.contact_id ? contactName(r) : '', highlight: (parse(r.highlights, [])[0] || {}).value || '', highlights: undefined })),
    };
  }

  function getItem(itemId) {
    const it = db.get('SELECT * FROM list_items WHERE id = ?', [idOf(itemId)]);
    if (!it) throw new Error('Lead not found');
    const list = db.get('SELECT id, name, recipe, person_role, info FROM lists WHERE id = ?', [it.list_id]);
    const contact = it.contact_id ? crm.getContact(it.contact_id) : null;
    const acts = db.all(`SELECT * FROM activities WHERE list_item_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`, [it.id]);
    return { ...it, list, contact, highlights: parse(it.highlights, []), people: parse(it.people, []), activities: acts };
  }

  // The next (or previous) lead in the same filtered queue.
  function neighbor(itemId, dir, filter = {}) {
    const it = db.get('SELECT list_id, position FROM list_items WHERE id = ?', [idOf(itemId)]);
    if (!it) return null;
    const { sql, p } = itemWhere(it.list_id, filter);
    const r = db.get(`SELECT li.id FROM list_items li LEFT JOIN contacts c ON c.id = li.contact_id WHERE ${sql} AND li.position ${dir < 0 ? '<' : '>'} ?
      ORDER BY li.position ${dir < 0 ? 'DESC' : 'ASC'} LIMIT 1`, [...p, it.position]);
    return r ? r.id : null;
  }

  // One click after a call: sets the result, counts the attempt, logs it to the lead and the person.
  function setStatus(itemId, status, note = '') {
    const s = R.STATUSES.includes(status) ? status : null;
    if (!s) throw new Error('Unknown status');
    const it = db.get('SELECT * FROM list_items WHERE id = ?', [idOf(itemId)]);
    if (!it) throw new Error('Lead not found');
    db.transaction(() => {
      const isCall = s !== 'Not called';
      db.run('UPDATE list_items SET status = ?, attempts = attempts + ?, last_called = CASE WHEN ? THEN ? ELSE last_called END, updated_at = ? WHERE id = ?',
        [s, isCall ? 1 : 0, isCall ? 1 : 0, today(), now(), it.id]);
      if (isCall) {
        const outcome = { Interested: 'Talked', 'Appointment set': 'Talked', 'Not interested': 'Not interested', 'Left voicemail': 'Left voicemail', 'No answer': 'No answer', 'Wrong number': 'Wrong number', 'Call back': 'Call back later' }[s] || s;
        db.run('INSERT INTO activities (kind, body, outcome, contact_id, list_item_id) VALUES (?,?,?,?,?)',
          ['call', str(note ? `${s}: ${note}` : s, 5000), outcome, it.contact_id, it.id]);
      }
      if (s === 'Do not call' && it.contact_id) {
        db.run("UPDATE contacts SET flags = CASE WHEN flags LIKE '%Do not call%' THEN flags WHEN flags = '' THEN 'Do not call' ELSE flags || ' · Do not call' END WHERE id = ?", [it.contact_id]);
      }
    });
    return getItem(it.id);
  }

  function updateItem(itemId, fields) {
    const f = fields || {};
    const it = db.get('SELECT id FROM list_items WHERE id = ?', [idOf(itemId)]);
    if (!it) throw new Error('Lead not found');
    const sets = []; const p = [];
    if ('follow_up' in f) { sets.push('follow_up = ?'); p.push(/^\d{4}-\d{2}-\d{2}$/.test(f.follow_up || '') ? f.follow_up : null); }
    for (const k of ['notes', 'appointment', 'priority', 'caller']) if (k in f) { sets.push(`${k} = ?`); p.push(str(f[k], k === 'notes' ? 10000 : 80)); }
    if (!sets.length) return getItem(it.id);
    db.run(`UPDATE list_items SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...p, now(), it.id]);
    return getItem(it.id);
  }

  function markPhone(contactId, number, bad) {
    const c = db.get('SELECT more_phones FROM contacts WHERE id = ?', [idOf(contactId)]);
    if (!c) throw new Error('Contact not found');
    const key = phoneKey(number);
    const phones = parse(c.more_phones, []).map((x) => (phoneKey(x.n) === key ? { ...x, bad: !!bad } : x));
    db.run('UPDATE contacts SET more_phones = ? WHERE id = ?', [JSON.stringify(phones), idOf(contactId)]);
    return true;
  }

  // "Make it a deal": the property becomes a deal on the board, the person a working contact.
  function promote(itemId) {
    const it = getItem(itemId);
    if (it.deal_id) return it.deal_id;
    return db.transaction(() => {
      const details = [
        it.title && `Property: ${it.title}`, it.units && `Units: ${it.units}`, it.year_built && `Year built: ${it.year_built}`, it.dom && `Days on market: ${it.dom}`,
        ...it.highlights.map((h) => `${h.label}: ${h.value}`), it.notes && `Notes: ${it.notes}`, it.appointment && `Appointment: ${it.appointment}`,
      ].filter(Boolean).join('\n');
      const pt = /multi/i.test(it.property_type) ? (Number(it.units) >= 5 ? 'Multifamily 5+' : 'Multifamily 2-4') : /mobile/i.test(it.property_type) ? 'Mobile home' : /commercial/i.test(it.property_type) ? 'Commercial' : 'Single family';
      const deal = crm.saveDeal({
        address: it.address || it.title || 'Lead', city: it.city, state: it.state, zip: it.zip, property_type: pt, asking_price: it.price,
        source: `List: ${it.list.name}`, notes: details, stage: 'Talking', next_follow_up: it.follow_up,
      });
      if (it.contact_id) {
        crm.linkContact(deal.id, it.contact_id, it.list.person_role === 'Agent' ? "Seller's agent" : it.list.person_role);
        db.run("UPDATE contacts SET kind = 'contact', role = CASE WHEN role = 'Other' THEN ? ELSE role END WHERE id = ? AND kind <> 'contact'", [it.list.person_role, it.contact_id]);
      }
      db.run('UPDATE activities SET deal_id = ? WHERE list_item_id = ?', [deal.id, it.id]);
      db.run('UPDATE list_items SET deal_id = ? WHERE id = ?', [deal.id, it.id]);
      return deal.id;
    });
  }

  function renameList(listId, name) {
    const n = str(name, 80);
    if (!n) throw new Error('Give the list a name');
    db.run('UPDATE lists SET name = ? WHERE id = ?', [n, idOf(listId)]);
    return true;
  }

  // Deletes the list; people who were only on this list (not on deals, not contacts) go too.
  function deleteList(listId) {
    const lid = idOf(listId);
    db.transaction(() => {
      const people = db.all('SELECT DISTINCT contact_id FROM list_items WHERE list_id = ? AND contact_id IS NOT NULL', [lid]).map((r) => r.contact_id);
      db.run('DELETE FROM list_items WHERE list_id = ?', [lid]);
      db.run('DELETE FROM lists WHERE id = ?', [lid]);
      for (const cid of people) {
        db.run(`DELETE FROM contacts WHERE id = ? AND kind = 'lead' AND NOT EXISTS (SELECT 1 FROM list_items WHERE contact_id = ?)
          AND NOT EXISTS (SELECT 1 FROM deal_contacts WHERE contact_id = ?)`, [cid, cid, cid]);
      }
    });
    try { fs.unlinkSync(path.join(rawDir, `${lid}.jsonl`)); } catch { /* no saved copy */ }
    return true;
  }

  // Excel file in the same columns it came in, with the hub's calling progress written back.
  async function exportList(listId, outFile) {
    const ExcelJS = require('./vendor/exceljs');
    const list = db.get('SELECT * FROM lists WHERE id = ?', [idOf(listId)]);
    if (!list) throw new Error('List not found');
    const headers = parse(list.headers, []);
    const items = db.all(`SELECT li.*, c.first_name, c.last_name, c.company, c.phone FROM list_items li LEFT JOIN contacts c ON c.id = li.contact_id
      WHERE li.list_id = ? ORDER BY li.position`, [list.id]);
    let raws = [];
    try { raws = fs.readFileSync(path.join(rawDir, `${list.id}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => parse(l, [])); } catch { raws = []; }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(String(list.sheet_name || 'List').slice(0, 31));
    const wbk = WRITE_BACK[list.recipe] || {};
    const fields = ['status', 'attempts', 'last_called', 'follow_up', 'notes', 'appointment', 'caller'];
    const labels = { status: 'Hub Status', attempts: 'Hub Attempts', last_called: 'Hub Last Called', follow_up: 'Hub Follow-up', notes: 'Hub Notes', appointment: 'Hub Appointment', caller: 'Hub Caller' };
    const appended = fields.filter((f) => !wbk[f] || !headers.includes(wbk[f]));
    const useOriginal = raws.length === items.length && headers.length;
    if (useOriginal) {
      ws.addRow([...headers, ...appended.map((f) => labels[f])]);
      items.forEach((it, i) => {
        const vals = [...raws[i]];
        const out = { ...it, status: (wbk.statusOut && wbk.statusOut[it.status]) || it.status };
        for (const f of fields) if (wbk[f] && headers.includes(wbk[f])) vals[headers.indexOf(wbk[f])] = out[f] == null ? '' : out[f];
        ws.addRow([...vals, ...appended.map((f) => (it[f] == null ? '' : it[f]))]);
      });
    } else {
      ws.addRow(['Property', 'Address', 'City', 'State', 'Zip', 'Contact', 'Company', 'Phone', 'Status', 'Attempts', 'Last called', 'Follow-up', 'Notes', 'Sheet details']);
      for (const it of items) {
        ws.addRow([it.title, it.address, it.city, it.state, it.zip, contactName(it), it.company, it.phone, it.status, it.attempts, it.last_called, it.follow_up || '', it.notes, it.extra]);
      }
    }
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    await wb.xlsx.writeFile(outFile);
    return { file: outFile, rows: items.length, original: !!useOriginal };
  }

  return { analyze, run, listLists, listItems, getItem, neighbor, setStatus, updateItem, markPhone, promote, renameList, deleteList, exportList };
}

module.exports = { createLists, REACHED };
