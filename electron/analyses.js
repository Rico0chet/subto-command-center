// Saved underwriting analyses. The calculator runs in the window; this just stores its inputs and headline numbers.
function createAnalyses(db) {
  const parse = (r) => r && { ...r, data: JSON.parse(r.data || '{}'), summary: JSON.parse(r.summary || '{}') };
  function list({ dealId, q = '' } = {}) {
    const where = [];
    const p = [];
    if (dealId) { where.push('a.deal_id = ?'); p.push(Number(dealId)); }
    if (q) { where.push('(a.name LIKE ? OR a.address LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
    return db.all(`SELECT a.id, a.name, a.address, a.deal_id, a.summary, a.updated_at, d.address AS deal_address, d.city AS deal_city
      FROM analyses a LEFT JOIN deals d ON d.id = a.deal_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.updated_at DESC LIMIT 500`, p).map((r) => ({ ...r, deal_title: [r.deal_address, r.deal_city].filter(Boolean).join(', '), summary: JSON.parse(r.summary || '{}') }));
  }
  const get = (id) => parse(db.get('SELECT * FROM analyses WHERE id = ?', [Number(id)]));
  function save({ id, name, address, dealId, data, summary }) {
    const vals = [String(name || 'Untitled analysis').slice(0, 200), String(address || '').slice(0, 300), dealId ? Number(dealId) : null,
      JSON.stringify(data || {}), JSON.stringify(summary || {})];
    if (id && db.get('SELECT id FROM analyses WHERE id = ?', [Number(id)])) {
      db.run("UPDATE analyses SET name = ?, address = ?, deal_id = ?, data = ?, summary = ?, updated_at = datetime('now') WHERE id = ?", [...vals, Number(id)]);
      db.saveSoon();
      return get(id);
    }
    db.run('INSERT INTO analyses (name, address, deal_id, data, summary) VALUES (?,?,?,?,?)', vals);
    const nid = db.get('SELECT last_insert_rowid() AS id').id;
    if (dealId) db.run("INSERT INTO activities (kind, body, deal_id) VALUES ('note', ?, ?)", [`Saved underwriting: ${vals[0]}`, Number(dealId)]);
    db.saveSoon();
    return get(nid);
  }
  function remove(id) {
    db.run('DELETE FROM analyses WHERE id = ?', [Number(id)]);
    db.saveSoon();
    return true;
  }
  return { list, get, save, remove };
}
module.exports = { createAnalyses };
