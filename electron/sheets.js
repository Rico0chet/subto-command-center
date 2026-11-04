// Reads spreadsheets (.xlsx / .csv): finds the real header row, keeps title lines and links above it.
const fs = require('fs');
const path = require('path');
const { parseCsv, gridToObjects } = require('./crm');

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    // Excel dates at midnight are plain dates; otherwise keep the time.
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
  }
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.text != null) return typeof v.text === 'object' ? cellText(v.text) : String(v.text); // hyperlinks
    if (v.result != null) return cellText(v.result); // formulas
    return '';
  }
  return String(v);
}
const cellLink = (v) => (v && typeof v === 'object' && typeof v.hyperlink === 'string' ? v.hyperlink : '');

// rows: [{ n: rowNumber, cells: [text...], links: [url...] }]
async function readXlsxGrids(file) {
  const ExcelJS = require('./vendor/exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheets = [];
  wb.eachSheet((ws) => {
    const rows = [];
    let width = 0;
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const vals = Array.isArray(row.values) ? row.values : [];
      const cells = [];
      const links = [];
      for (let c = 1; c < vals.length; c++) {
        cells.push(cellText(vals[c]).trim());
        const l = cellLink(vals[c]);
        if (l) links.push(l);
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (!cells.length && !links.length) return;
      width = Math.max(width, cells.length);
      rows.push({ n, cells, links });
    });
    if (rows.length) sheets.push({ name: ws.name, rows, width });
  });
  return sheets;
}

function csvGrids(file) {
  const grid = parseCsv(fs.readFileSync(file, 'utf8'));
  return [{ name: path.basename(file), rows: grid.map((cells, i) => ({ n: i + 1, cells: cells.map((c) => String(c).trim()), links: [] })), width: Math.max(0, ...grid.map((r) => r.length)) }];
}

// The header row is the first row (in the top 25) with the most distinct short labels.
// Title rows that are merged across many cells repeat one text, so they score low.
function findHeaderRow(rows) {
  let best = -1; let bestScore = 2;
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    const labels = rows[i].cells.filter((c) => c && c.length <= 60 && !/^\d+(\.\d+)?$/.test(c));
    const score = new Set(labels.map((c) => c.toLowerCase())).size;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

function uniqueHeaders(cells, width) {
  const seen = {};
  const out = [];
  for (let i = 0; i < width; i++) {
    let h = (cells[i] || '').replace(/\s+/g, ' ').trim() || `Column ${i + 1}`;
    const k = h.toLowerCase();
    seen[k] = (seen[k] || 0) + 1;
    if (seen[k] > 1) h = `${h} (${seen[k]})`;
    out.push(h);
  }
  return out;
}

// Turns one sheet into { headers, rows: [{...}], rowNumbers, preamble, links }.
function shapeSheet(sheet) {
  const hi = findHeaderRow(sheet.rows);
  if (hi < 0) return { name: sheet.name, headers: [], rows: [], rowNumbers: [], preamble: [], links: [], total: 0 };
  const headers = uniqueHeaders(sheet.rows[hi].cells, sheet.width);
  const preamble = [...new Set(sheet.rows.slice(0, hi).flatMap((r) => r.cells).filter(Boolean))];
  const links = [...new Set(sheet.rows.slice(0, hi).flatMap((r) => r.links))];
  const body = sheet.rows.slice(hi + 1).filter((r) => r.cells.some((c) => c));
  return {
    name: sheet.name,
    headerRow: sheet.rows[hi].n,
    headers,
    rows: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, r.cells[i] || '']))),
    rowNumbers: body.map((r) => r.n),
    preamble,
    links,
    total: body.length,
  };
}

async function readWorkbook(file) {
  const ext = path.extname(file).toLowerCase();
  if (fs.statSync(file).size > 80 * 1024 * 1024) throw new Error('That file is over 80 MB');
  let grids;
  if (ext === '.csv' || ext === '.txt') grids = csvGrids(file);
  else if (ext === '.xlsx' || ext === '.xlsm') grids = await readXlsxGrids(file);
  else if (ext === '.xls') throw new Error('Old .xls files aren\'t supported. Open it in Excel and "Save As" .xlsx or .csv, then import that.');
  else throw new Error('Choose an Excel (.xlsx) or CSV file');
  return { file: path.basename(file), sheets: grids.map(shapeSheet).filter((s) => s.headers.length || s.preamble.length) };
}

// Older simple reader (row 1 = headers), still used by the plain contact import.
async function readTable(file) {
  const wb = await readWorkbook(file);
  return { file: wb.file, sheets: wb.sheets.filter((s) => s.headers.length).map((s) => ({ name: s.name, headers: s.headers, rows: s.rows, total: s.total })) };
}

module.exports = { readWorkbook, readTable, cellText, findHeaderRow, shapeSheet, uniqueHeaders, gridToObjects };
