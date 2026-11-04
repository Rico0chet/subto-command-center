// The Zoom Chat Organizer, built into the hub. Reads saved Zoom chat .txt files and feeds the
// SubTo Directory: one contact per person (recognized across calls by their Zoom name), every
// message kept as that person's chat history. Same rules as the organizer's add_chats.py:
// existing contacts are only filled in or added to, never overwritten.
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- parsing
const HDR_DATED = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) From (.*) to (Everyone|.*\(direct message\)|.*\(Direct Message\)|.*):\s*(.*)$/;
const HDR_TIME = /^(\d\d:\d\d:\d\d) From (.*?) to (Everyone|.*?)(?:\(Direct Message\)|\(direct message\))?:\s*(.*)$/;
const HDR_OLD = /^(\d\d:\d\d:\d\d)\t From (.*?) : (.*)$/;
const REACT = /^.{1,250}:\s*[^\w\s:]{1,8}\s*$/u;
const IMG = /^[\w\-{}(). ]+\.(png|jpg|jpeg|gif)$/i;

// Date for files whose lines only have a time: Zoom's folder name ("2026-09-19 18.00.12 Meeting") or the file date.
function fallbackDate(file, mtimeMs) {
  const m = String(file || '').match(/(\d{4})-(\d\d)-(\d\d)[ _]\d\d[.:]\d\d/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(mtimeMs || Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseChat(text, { date } = {}) {
  const msgs = [];
  let cur = null;
  for (const raw of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.replace(/\r$/, '');
    let m = line.match(HDR_DATED);
    if (m) {
      if (cur) msgs.push(cur);
      cur = { date: m[1], time: m[2], sender: m[3].trim(), lines: m[5] && m[5].trim() ? [m[5].trim()] : [] };
      continue;
    }
    m = line.match(HDR_TIME);
    if (m && date) {
      if (cur) msgs.push(cur);
      cur = { date, time: m[1], sender: m[2].trim(), lines: m[4] && m[4].trim() ? [m[4].trim()] : [] };
      continue;
    }
    m = line.match(HDR_OLD);
    if (m && date) {
      if (cur) msgs.push(cur);
      cur = { date, time: m[1], sender: m[2].trim(), lines: [m[3].trim()] };
      continue;
    }
    if (!cur) continue;
    const t = line.trim();
    if (t) cur.lines.push(t);
  }
  if (cur) msgs.push(cur);
  return msgs.map((m) => {
    const lines = [];
    let reply = false;
    for (const t of m.lines) {
      if (t.startsWith('Replying to "')) { reply = true; continue; }
      if (IMG.test(t)) { lines.push('[image attached]'); continue; }
      if (REACT.test(t) && lines.length) continue; // reaction footer, e.g. "Jane Doe:❤️"
      lines.push(t);
    }
    const body = lines.join(' ').trim();
    return { date: m.date, time: m.time, sender: m.sender, text: (reply && body ? '(reply) ' : '') + body };
  });
}

// ---------------------------------------------------------------- reading Zoom names
const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
const NAME2AB = Object.fromEntries(Object.entries(STATES).map(([k, v]) => [v.toLowerCase(), k]));
const AMBIG = new Set(['OC', 'ME', 'IN', 'OR', 'HI', 'DE', 'MA', 'ID', 'LA', 'OK']);
const PHONE = /(?<!\d)(?:\+?1[\s.-]*)?\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})(?!\d)/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const BLINQ = /(?:https?:\/\/)?(?:s1?\.)?blinq\.me\/[\w\-/]+(?:\?[\w=&]+)?/g;

function tagsFrom(s) {
  const t = [];
  if (/gator|🐊/i.test(s)) t.push('Gator');
  if (/sub\s?-?to|sub2/i.test(s)) t.push('SubTo');
  if (/\bTTTC\b|top\s?tier|\bTT\s?TC\b/i.test(s)) t.push('TTTC');
  else if (/\bTC\b/.test(s)) t.push('TC');
  if (/\bOC\b|owners?\s?club/.test(s)) t.push('Owners Club');
  if (/\bZDB\b|zero down/i.test(s)) t.push('ZDB');
  return t;
}
function statesFrom(s) {
  const s2 = s.replace(EMAIL, ' ').replace(PHONE, ' ');
  const out = [];
  for (const tok of s2.split(/[\s,/|.:\-()]+/)) {
    const u = tok.toUpperCase();
    if (STATES[u]) {
      if (AMBIG.has(u) && tok !== u) continue;
      if (tok === u || ['Il', 'Fl', 'Az', 'Ga', 'Tx', 'Ca', 'Ny', 'Nj'].includes(tok)) out.push(u);
    }
    if (NAME2AB[tok.toLowerCase()]) out.push(NAME2AB[tok.toLowerCase()]);
  }
  for (const full of ['new york', 'new jersey', 'north carolina', 'south carolina', 'new mexico', 'west virginia', 'rhode island', 'new hampshire', 'north dakota', 'south dakota']) {
    if (s2.toLowerCase().includes(full)) out.push(NAME2AB[full]);
  }
  return [...new Set(out)];
}
function nameFrom(s) {
  let t = s.replace(EMAIL, ' ').replace(PHONE, ' ').replace(BLINQ, ' ');
  t = t.replace(/✌️?|🐊|🏻|\|/gu, ' , ');
  t = t.split(/[,/|:;]| - | -|\s{2,}/)[0];
  t = t.replace(/\b(Gator|Subto|Sub2|sub to|TTTC|TC|OC|ZDB|Scout|Bird Dog|SoCal|NorCal|UTAH|PMB|PML)\b.*/i, '');
  t = t.replace(/\d+/g, '').replace(/^[\s\-.,#]+|[\s\-.,#]+$/g, '');
  const toks = t.split(/\s+/).filter(Boolean);
  while (toks.length > 1 && toks[toks.length - 1].length === 2 && toks[toks.length - 1] === toks[toks.length - 1].toUpperCase() && STATES[toks[toks.length - 1]]) toks.pop();
  return toks.join(' ');
}
const tc = (s) => s.split(' ').map((w) => ((w === w.toUpperCase() || w === w.toLowerCase()) && w.length > 1 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');
const fmtPhone = (d) => (d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d);
const phonesIn = (s) => [...String(s).matchAll(PHONE)].map((m) => `${m[1]}${m[2]}${m[3]}`);
const emailsIn = (s) => String(s).match(EMAIL) || [];

const TRIVIAL = new Set(['yes', 'yup', 'nope', 'lol', 'ok', 'sure', 'hello', 'hi', 'yay', 'same', 'sweet', 'thanks', 'thank you', 'ty', 'hello everyone', 'no', 'yeah', 'heard', 'me', 'me too', 'morning', 'good morning', 'goodmorning', 'hey', 'hey everyone', 'y', '1', '2']);
const AUDIO = /\b(cutting|cut out|cutin|froze|frozen|choppy|chopy|hear|lost|gone|breaking|audio|bandwidth|sound|splotchy|glitch|halting|cutn|reboot|unmute)\b/i;
function substantive(text) {
  const t = String(text).replace('(reply) ', '').trim();
  const core = t.replace(/[\W_]+/gu, '');
  if (!core || core.length <= 2 || /^[\d²]+$|^[yY]+$/.test(core)) return false;
  if (TRIVIAL.has(t.toLowerCase().replace(/^[ .!?]+|[ .!?]+$/g, '')) || t.startsWith('Giphy [ID')) return false;
  if (t.split(/\s+/).length <= 10 && AUDIO.test(t)) return false;
  return true;
}

// Same timestamp format the MASTER import uses, so re-adding a chat never duplicates it.
function chatTime(date, time) {
  const t = Date.parse(`${date}T${/^\d{1,2}:\d{2}/.test(time) ? time.padStart(8, '0') : '12:00:00'}`);
  return Number.isNaN(t) ? new Date().toISOString().replace('T', ' ').slice(0, 19) : new Date(t).toISOString().replace('T', ' ').slice(0, 19);
}

// ---------------------------------------------------------------- the organizer
function createZoomChats({ db, crm }) {
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const contactName = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || c.company || 'Unnamed';

  function labelFor(msgs, given) {
    if (given) return given;
    const d0 = msgs[0].date;
    let label = `${Number(d0.slice(5, 7))}/${Number(d0.slice(8, 10))}`;
    const exists = db.get("SELECT 1 AS x FROM activities WHERE kind = 'chat' AND outcome = ? LIMIT 1", [`Zoom call ${label}`]);
    if (exists && !db.get("SELECT 1 AS x FROM activities WHERE kind = 'chat' AND outcome = ? AND substr(created_at, 1, 10) = ? LIMIT 1", [`Zoom call ${label}`, chatTime(d0, msgs[0].time).slice(0, 10)])) {
      label += Number(msgs[0].time.slice(0, 2)) < 12 ? ' AM' : ' PM';
    }
    return label;
  }

  // Preview a file without saving anything.
  function preview(file, stat) {
    const text = fs.readFileSync(file, 'utf8');
    const msgs = parseChat(text, { date: fallbackDate(file, stat && stat.mtimeMs) });
    const senders = new Set(msgs.map((m) => m.sender));
    return { file, name: path.basename(file), folder: path.basename(path.dirname(file)), messages: msgs.length, people: senders.size, first: msgs[0] ? `${msgs[0].date} ${msgs[0].time}` : '', label: msgs.length ? labelFor(msgs) : '' };
  }

  // Add chats. files: [{ path, label, inferSubto }]
  function addChats(files) {
    const review = { files: [], newContacts: [], filled: [], candidates: [], messages: 0, skipped: 0 };
    const zmap = new Map(db.all('SELECT zoom_name, contact_id FROM zoom_names').map((r) => [r.zoom_name, r.contact_id]));
    const seen = new Set(db.all("SELECT contact_id, created_at, body FROM activities WHERE kind = 'chat'").map((a) => `${a.contact_id}|${a.created_at}|${a.body}`));
    const touched = new Map(); // contactId → Set(labels)
    const inferred = new Set();
    db.transaction(() => {
      for (const f of files) {
        let st;
        try { st = fs.statSync(f.path); } catch { review.files.push({ name: path.basename(f.path), error: 'File not found' }); continue; }
        const msgs = parseChat(fs.readFileSync(f.path, 'utf8'), { date: fallbackDate(f.path, st.mtimeMs) });
        if (!msgs.length) { review.files.push({ name: path.basename(f.path), error: 'No chat messages found in this file' }); continue; }
        const label = labelFor(msgs, f.label && String(f.label).trim());
        const bySender = new Map();
        for (const m of msgs) { if (!bySender.has(m.sender)) bySender.set(m.sender, []); bySender.get(m.sender).push(m); }
        let added = 0, dup = 0;
        for (const [sender, ms] of bySender) {
          if (/read\.ai/i.test(sender)) continue;
          let cid = zmap.get(sender);
          if (cid && !db.get('SELECT id FROM contacts WHERE id = ?', [cid])) cid = undefined;
          const phones = phonesIn(sender);
          const emails = emailsIn(sender);
          const blinqs = [];
          const bseen = new Set();
          for (const m of ms) for (const u of m.text.match(BLINQ) || []) { const k = u.replace(/\?.*/, '').split('/').pop(); if (!bseen.has(k)) { bseen.add(k); blinqs.push(u.startsWith('http') ? u : `https://${u}`); } }
          const tags = tagsFrom(sender);
          const states = statesFrom(sender).join(', ');
          if (!cid) {
            const parts = nameFrom(sender).split(/\s+/).filter(Boolean);
            const first = parts.length ? tc(parts[0]) : sender.slice(0, 80);
            const last = tc(parts.slice(1).join(' '));
            const c = crm.insertContact(crm.cleanContact({
              first_name: first, last_name: last, phone: phones[0] ? fmtPhone(phones[0]) : '', email: emails[0] || '', emails2: emails.slice(1).join('; '),
              more_phones: phones.slice(1).map((p) => ({ n: fmtPhone(p), label: 'Zoom name' })), state: states, communities: tags.join('; '),
              link: blinqs[0] || '', kind: 'network', role: 'Other', notes: '', flags: '',
            }));
            cid = typeof c === 'object' ? c.id : c;
            review.newContacts.push({ id: cid, name: [first, last].filter(Boolean).join(' '), phone: phones[0] ? fmtPhone(phones[0]) : '', email: emails[0] || '', state: states, communities: tags.join('; '), zoomName: sender });
          } else {
            const c = db.get('SELECT * FROM contacts WHERE id = ?', [cid]);
            const fill = (field, value, label_) => {
              if (!value) return;
              const old = c[field] || '';
              if (!old) { db.run(`UPDATE contacts SET ${field} = ?, updated_at = ? WHERE id = ?`, [value, now(), cid]); c[field] = value; review.filled.push({ id: cid, name: contactName(c), field: label_, from: '', to: value }); }
            };
            if (phones.length) {
              const have = new Set([c.phone, c.phone2, ...JSON.parse(c.more_phones || '[]').map((p) => p.n || p.number || p)].map((p) => String(p || '').replace(/\D/g, '').slice(-10)));
              const fresh = phones.filter((p) => !have.has(p));
              if (fresh.length) {
                if (!c.phone) { fill('phone', fmtPhone(fresh.shift()), 'phone'); }
                if (fresh.length) {
                  const base = JSON.parse(c.more_phones || '[]');
                  const seed = base.length ? base : [c.phone, c.phone2].filter(Boolean).map((n) => ({ n }));
                  const more = [...seed, ...fresh.map((p) => ({ n: fmtPhone(p), label: 'Zoom name' }))];
                  db.run('UPDATE contacts SET more_phones = ? WHERE id = ?', [JSON.stringify(more), cid]);
                  review.filled.push({ id: cid, name: contactName(c), field: 'phone', from: c.phone, to: fresh.map(fmtPhone).join(', ') });
                }
              }
            }
            for (const e of emails) {
              const all = `${c.email} ${c.emails2}`.toLowerCase();
              if (all.includes(e.toLowerCase())) continue;
              if (!c.email) fill('email', e, 'email');
              else { const v = [c.emails2, e].filter(Boolean).join('; '); db.run('UPDATE contacts SET emails2 = ? WHERE id = ?', [v, cid]); c.emails2 = v; review.filled.push({ id: cid, name: contactName(c), field: 'email', from: c.email, to: e }); }
            }
            for (const u of blinqs) if (!c.link) fill('link', u, 'Blinq card');
            if (states && !c.state) fill('state', states, 'state');
            const comm = String(c.communities || '').split(';').map((x) => x.trim()).filter(Boolean);
            const add = tags.filter((t) => !comm.includes(t));
            if (add.length) {
              const v = [...comm, ...add].join('; ');
              db.run('UPDATE contacts SET communities = ? WHERE id = ?', [v, cid]);
              review.filled.push({ id: cid, name: contactName(c), field: 'communities', from: c.communities || '', to: v });
              c.communities = v;
            }
            if (c.kind === 'lead') db.run("UPDATE contacts SET kind = 'network' WHERE id = ?", [cid]);
          }
          zmap.set(sender, cid);
          db.run('INSERT OR REPLACE INTO zoom_names (zoom_name, contact_id) VALUES (?, ?)', [sender, cid]);
          // Phones and emails people typed in messages: shown for review, not applied.
          const c2 = db.get('SELECT phone, phone2, more_phones, email, emails2 FROM contacts WHERE id = ?', [cid]);
          const knownText = `${c2.phone} ${c2.phone2} ${c2.more_phones} ${c2.email} ${c2.emails2}`.replace(/\D/g, ' ');
          const cands = new Set();
          for (const m of ms) {
            for (const p of phonesIn(m.text)) if (!knownText.includes(p) && !`${c2.phone}${c2.more_phones}`.replace(/\D/g, '').includes(p)) cands.add(`phone:${p}`);
            for (const e of emailsIn(m.text)) if (!`${c2.email} ${c2.emails2}`.toLowerCase().includes(e.toLowerCase())) cands.add(`email:${e}`);
          }
          if (cands.size) review.candidates.push({ id: cid, name: contactName(db.get('SELECT first_name, last_name, email, company FROM contacts WHERE id = ?', [cid])), zoomName: sender, items: [...cands].map((x) => { const [k, v] = x.split(/:(.*)/s); return { kind: k, value: k === 'phone' ? fmtPhone(v) : v }; }) });
          for (const m of ms) {
            const at = chatTime(m.date, m.time);
            const body = String(m.text).slice(0, 4000);
            const key = `${cid}|${at}|${body}`;
            if (!body || seen.has(key)) { dup++; continue; }
            seen.add(key);
            db.run('INSERT INTO activities (kind, body, outcome, contact_id, created_at) VALUES (?,?,?,?,?)', ['chat', body, `Zoom call ${label}`.slice(0, 60), cid, at]);
            added++;
          }
          if (!touched.has(cid)) touched.set(cid, new Set());
          touched.get(cid).add(label);
          if (f.inferSubto) inferred.add(cid);
        }
        db.run('INSERT OR REPLACE INTO zoom_files (path, mtime, label, messages, imported_at) VALUES (?,?,?,?,?)', [f.path, st.mtimeMs, label, msgs.length, now()]);
        review.files.push({ name: path.basename(f.path), label, messages: msgs.length, added, skipped: dup });
        review.messages += added;
        review.skipped += dup;
      }
      // Communities inferred from attending a SubTo call; calls attended rebuilt from the chat history.
      for (const cid of inferred) {
        const c = db.get('SELECT communities, flags FROM contacts WHERE id = ?', [cid]);
        const comm = String(c.communities || '').split(';').map((x) => x.trim()).filter(Boolean);
        if (!comm.includes('SubTo')) db.run('UPDATE contacts SET communities = ? WHERE id = ?', [['SubTo', ...comm].join('; '), cid]);
      }
      for (const cid of touched.keys()) refreshCalls(cid);
    });
    return review;
  }

  function refreshCalls(cid) {
    const c = db.get('SELECT calls_attended FROM contacts WHERE id = ?', [cid]);
    if (!c) return;
    const fromChats = db.all("SELECT outcome, MIN(created_at) AS t FROM activities WHERE contact_id = ? AND kind = 'chat' AND outcome LIKE 'Zoom call %' GROUP BY outcome ORDER BY t", [cid]).map((r) => r.outcome.replace(/^Zoom call /, ''));
    const old = String(c.calls_attended || '').split(',').map((x) => x.trim()).filter(Boolean);
    const all = [...old, ...fromChats.filter((x) => !old.includes(x))];
    db.run('UPDATE contacts SET calls_attended = ? WHERE id = ?', [all.join(', '), cid]);
  }

  // People who are probably the same person: same name, same phone, or same Blinq card.
  function duplicates() {
    const rows = db.all("SELECT id, first_name, last_name, phone, more_phones, email, link, kind, calls_attended FROM contacts WHERE kind IN ('network','contact')");
    const groups = new Map();
    const parent = new Map(rows.map((r) => [r.id, r.id]));
    const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
    const unite = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb)); };
    const index = new Map();
    const key = (k, id) => { if (!k) return; if (index.has(k)) unite(index.get(k), id); else index.set(k, id); };
    for (const r of rows) {
      const nm = `${r.first_name} ${r.last_name}`.trim().toLowerCase();
      if (nm.includes(' ')) key(`n:${nm}`, r.id);
      for (const p of [r.phone, ...JSON.parse(r.more_phones || '[]').map((x) => x.n || x.number || x)]) { const d = String(p || '').replace(/\D/g, '').slice(-10); if (d.length === 10) key(`p:${d}`, r.id); }
      if (r.link) key(`b:${r.link.replace(/\?.*/, '').split('/').pop().toLowerCase()}`, r.id);
      if (r.email) key(`e:${r.email.toLowerCase()}`, r.id);
    }
    for (const r of rows) { const g = find(r.id); if (!groups.has(g)) groups.set(g, []); groups.get(g).push({ ...r, name: contactName(r) }); }
    return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a.id - b.id));
  }

  // Merge `dropId` into `keepId`: history, leads, deals and tasks move over; blanks get filled; Zoom names re-pointed.
  function merge(keepId, dropId) {
    keepId = Number(keepId); dropId = Number(dropId);
    if (keepId === dropId) throw new Error('Pick two different people');
    const k = db.get('SELECT * FROM contacts WHERE id = ?', [keepId]);
    const d = db.get('SELECT * FROM contacts WHERE id = ?', [dropId]);
    if (!k || !d) throw new Error('Contact not found');
    db.transaction(() => {
      for (const f of ['first_name', 'last_name', 'company', 'phone', 'email', 'address', 'state', 'city', 'link', 'ext_id']) {
        if (!k[f] && d[f]) db.run(`UPDATE contacts SET ${f} = ? WHERE id = ?`, [d[f], keepId]);
      }
      const kp = JSON.parse(k.more_phones || '[]');
      const phones = kp.length ? kp : [k.phone, k.phone2].filter(Boolean).map((n) => ({ n }));
      const have = new Set([k.phone, k.phone2, ...phones.map((p) => p.n || p.number || p)].map((p) => String(p || '').replace(/\D/g, '').slice(-10)));
      for (const p of [d.phone, d.phone2, ...JSON.parse(d.more_phones || '[]').map((x) => x.n || x.number || x)]) {
        const dd = String(p || '').replace(/\D/g, '').slice(-10);
        if (dd.length === 10 && !have.has(dd)) { phones.push({ n: fmtPhone(dd), label: 'Merged' }); have.add(dd); }
      }
      const joinList = (a, b, sep) => [...new Set([...String(a || '').split(sep), ...String(b || '').split(sep)].map((x) => x.trim()).filter(Boolean))].join(sep === ',' ? ', ' : '; ');
      db.run('UPDATE contacts SET more_phones = ?, emails2 = ?, communities = ?, calls_attended = ?, tags = ?, notes = ?, flags = ?, extra = ?, updated_at = ? WHERE id = ?', [
        JSON.stringify(phones), joinList(k.emails2, [d.email !== k.email ? d.email : '', d.emails2].filter(Boolean).join(';'), ';'),
        joinList(k.communities, d.communities, ';'), joinList(k.calls_attended, d.calls_attended, ','), joinList(k.tags, d.tags, ','),
        [k.notes, d.notes].filter(Boolean).join('\n\n'), [k.flags, d.flags].filter(Boolean).join('\n'), [k.extra, d.extra].filter(Boolean).join('\n'), now(), keepId]);
      db.run('UPDATE activities SET contact_id = ? WHERE contact_id = ?', [keepId, dropId]);
      db.run('UPDATE list_items SET contact_id = ? WHERE contact_id = ?', [keepId, dropId]);
      db.run('UPDATE tasks SET contact_id = ? WHERE contact_id = ?', [keepId, dropId]);
      db.run('UPDATE OR IGNORE deal_contacts SET contact_id = ? WHERE contact_id = ?', [keepId, dropId]);
      db.run('DELETE FROM deal_contacts WHERE contact_id = ?', [dropId]);
      db.run('UPDATE zoom_names SET contact_id = ? WHERE contact_id = ?', [keepId, dropId]);
      if (d.kind === 'contact' && k.kind !== 'contact') db.run("UPDATE contacts SET kind = 'contact' WHERE id = ?", [keepId]);
      db.run('DELETE FROM contacts WHERE id = ?', [dropId]);
      refreshCalls(keepId);
    });
    return db.get('SELECT * FROM contacts WHERE id = ?', [keepId]);
  }

  // Point a Zoom display name at a different person (fixes a wrong match); moves that name's messages too.
  function remap(zoomName, contactId) {
    const old = db.get('SELECT contact_id FROM zoom_names WHERE zoom_name = ?', [zoomName]);
    db.run('INSERT OR REPLACE INTO zoom_names (zoom_name, contact_id) VALUES (?, ?)', [zoomName, Number(contactId)]);
    return { from: old ? old.contact_id : null, to: Number(contactId) };
  }

  const namesFor = (contactId) => db.all('SELECT zoom_name FROM zoom_names WHERE contact_id = ? ORDER BY zoom_name', [Number(contactId)]).map((r) => r.zoom_name);
  const imported = () => db.all('SELECT * FROM zoom_files ORDER BY imported_at DESC LIMIT 200');

  // Saved chats in the Zoom folder that haven't been added yet (or changed since).
  function findNew(dir) {
    const out = [];
    const done = new Map(db.all('SELECT path, mtime FROM zoom_files').map((r) => [r.path, r.mtime]));
    const walk = (d, depth) => {
      if (depth > 3) return;
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (/\.txt$/i.test(e.name) && /chat/i.test(e.name)) {
          try {
            const st = fs.statSync(p);
            if (done.has(p) && Math.abs(done.get(p) - st.mtimeMs) < 1) continue;
            const pv = preview(p, st);
            if (pv.messages) out.push({ ...pv, mtime: st.mtimeMs });
          } catch { /* unreadable */ }
        }
      }
    };
    if (dir) walk(dir, 0);
    return out.sort((a, b) => a.first.localeCompare(b.first));
  }

  // Export in the organizer's MASTER layout (Contacts, Raw Chat Log, Zoom Name Map), so its other tools keep working.
  async function exportMaster(file, ExcelJS) {
    const wb = new ExcelJS.Workbook();
    const people = db.all("SELECT * FROM contacts WHERE kind = 'network' ORDER BY lower(first_name), lower(last_name)");
    const ws = wb.addWorksheet('Contacts');
    ws.addRow(['First Name', 'Last Name', 'Blinq Card', 'Phone', 'Email', 'State', 'City / Area', 'Communities', 'Community Basis', 'Calls Attended', 'Role', '# Msgs', 'Comments (what they said)', 'Notes / Flags', 'Contact ID']);
    const idOf = (c) => c.ext_id || `H${String(c.id).padStart(4, '0')}`;
    for (const c of people) {
      const msgs = db.all("SELECT body, created_at FROM activities WHERE contact_id = ? AND kind = 'chat' ORDER BY created_at", [c.id]);
      const comments = msgs.filter((m) => substantive(m.body)).map((m) => { const t = new Date(`${m.created_at.replace(' ', 'T')}Z`); return `[${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}] ${m.body}`; }).join('\n');
      const phones = [c.phone, ...JSON.parse(c.more_phones || '[]').map((p) => p.n || p.number || p)].filter(Boolean).join('; ');
      ws.addRow([c.first_name, c.last_name, c.link, phones, [c.email, c.emails2].filter(Boolean).join('; '), c.state, c.city, c.communities, '', c.calls_attended, c.tags, msgs.length, comments || c.notes, c.flags, idOf(c)]);
    }
    const wr = wb.addWorksheet('Raw Chat Log');
    wr.addRow(['Call', 'Date', 'Time', 'Sender (as shown in Zoom)', 'Matched Contact', 'Message', 'Contact ID']);
    const names = new Map();
    for (const r of db.all('SELECT zoom_name, contact_id FROM zoom_names')) if (!names.has(r.contact_id)) names.set(r.contact_id, r.zoom_name);
    for (const m of db.all("SELECT a.body, a.outcome, a.created_at, c.* , c.id AS cid FROM activities a JOIN contacts c ON c.id = a.contact_id WHERE a.kind = 'chat' ORDER BY a.created_at")) {
      const t = new Date(`${m.created_at.replace(' ', 'T')}Z`);
      const date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
      const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
      wr.addRow([String(m.outcome || '').replace(/^Zoom call /, ''), date, time, names.get(m.cid) || contactName(m), contactName(m), m.body, idOf(m)]);
    }
    const wm = wb.addWorksheet('Zoom Name Map');
    wm.addRow(['Zoom Name (as displayed)', 'Contact ID', 'Contact']);
    for (const r of db.all('SELECT z.zoom_name, c.* FROM zoom_names z JOIN contacts c ON c.id = z.contact_id ORDER BY lower(z.zoom_name)')) wm.addRow([r.zoom_name, idOf(r), contactName(r)]);
    for (const s of [ws, wr, wm]) { s.getRow(1).font = { bold: true }; s.views = [{ state: 'frozen', ySplit: 1 }]; }
    await wb.xlsx.writeFile(file);
    return { file, people: people.length };
  }

  return { preview, addChats, duplicates, merge, remap, namesFor, imported, findNew, exportMaster, refreshCalls };
}

module.exports = { createZoomChats, parseChat, nameFrom, statesFrom, tagsFrom, substantive, fallbackDate };
