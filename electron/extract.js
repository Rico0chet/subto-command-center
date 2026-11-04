// Pull plain text out of the files the hub searches: txt, md, csv, json, Excel, Word and PDF.
const fs = require('fs');
const path = require('path');

const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.log', '.html', '.htm', '.eml', '.vcf']);
const SUPPORTED = new Set([...TEXT_EXT, '.xlsx', '.xlsm', '.docx', '.pdf']);
const MAX_TEXT = 2 * 1024 * 1024; // keep at most 2 MB of text per file
const MAX_FILE = 60 * 1024 * 1024;

const clip = (s) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s);

function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
}

async function readDocx(file) {
  const { JSZip } = require('./vendor/docs');
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n)).sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)));
  let out = '';
  for (const p of parts) {
    const xml = await zip.file(p).async('string');
    out += decodeXml(xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tc>/g, '\t')
      .replace(/<[^>]+>/g, '')) + '\n';
  }
  return out.replace(/\n{3,}/g, '\n\n');
}

let pdfReady = false;
async function readPdf(file) {
  const { pdfjs } = require('./vendor/docs');
  if (!pdfReady) {
    pdfjs.GlobalWorkerOptions.workerSrc = path.join(__dirname, 'vendor', 'pdf.worker.js');
    pdfReady = true;
  }
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  let out = '';
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 300); i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let lastY = null;
      for (const it of tc.items) {
        const y = it.transform ? it.transform[5] : null;
        if (lastY != null && y != null && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n';
        out += it.str;
        if (it.hasEOL) out += '\n';
        lastY = y;
      }
      out += '\n\n';
      if (out.length > MAX_TEXT) break;
    }
  } finally { await doc.destroy(); }
  return out;
}

async function readXlsx(file) {
  const ExcelJS = require('./vendor/exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  let out = '';
  wb.eachSheet((ws) => {
    out += `# ${ws.name}\n`;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (out.length > MAX_TEXT) return;
      const vals = (row.values || []).slice(1).map((v) => {
        if (v == null) return '';
        if (typeof v === 'object') {
          if (v instanceof Date) return v.toISOString().slice(0, 10);
          if (v.text) return String(v.text);
          if (v.richText) return v.richText.map((r) => r.text).join('');
          if (v.result != null) return String(v.result);
          if (v.hyperlink) return v.hyperlink;
          return '';
        }
        return String(v);
      });
      const line = vals.filter((x) => x !== '').join(' | ');
      if (line) out += `${line}\n`;
    });
  });
  return out;
}

async function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  const st = fs.statSync(file);
  if (st.size > MAX_FILE) throw new Error('File is too large to read');
  if (TEXT_EXT.has(ext)) {
    let s = fs.readFileSync(file, 'utf8');
    if (ext === '.html' || ext === '.htm') s = decodeXml(s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<(br|\/p|\/div|\/tr|\/li)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' '));
    return clip(s);
  }
  if (ext === '.docx') return clip(await readDocx(file));
  if (ext === '.pdf') return clip(await readPdf(file));
  if (ext === '.xlsx' || ext === '.xlsm') return clip(await readXlsx(file));
  throw new Error('Unsupported file type');
}

// ---------- pulling out phones, emails, links and addresses ----------
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const LINK_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const SUFFIX = '(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Way|Place|Pl|Circle|Cir|Parkway|Pkwy|Highway|Hwy|Trail|Trl|Terrace|Ter|Loop|Run|Pass|Square|Sq)\\b';
const ADDR_RE = new RegExp(`\\b\\d{2,6}\\s+(?:[NSEW]\\.?\\s+|North\\s+|South\\s+|East\\s+|West\\s+)?(?:[A-Za-z0-9.']+\\s+){0,4}${SUFFIX}\\.?(?:\\s+(?:#|Apt|Unit|Ste|Suite)\\s*[\\w-]+)?(?:,?\\s+[A-Za-z .]+,?\\s+[A-Z]{2}(?:\\s+\\d{5})?)?`, 'g');

function uniq(arr, max = 200) { return [...new Set(arr)].slice(0, max); }
function extractFacts(text) {
  const t = String(text || '');
  const phones = [];
  for (const m of t.matchAll(PHONE_RE)) phones.push(`${m[1]}${m[2]}${m[3]}`);
  return {
    phones: uniq(phones),
    emails: uniq((t.match(EMAIL_RE) || []).map((e) => e.toLowerCase())),
    links: uniq((t.match(LINK_RE) || []).map((l) => l.replace(/[.,;]+$/, ''))),
    addresses: uniq((t.match(ADDR_RE) || []).map((a) => a.trim().replace(/\s+/g, ' ')), 100),
  };
}
const digits = (s) => String(s || '').replace(/\D/g, '');
const phoneDigits = (s) => { const d = digits(s); return d.length === 11 && d[0] === '1' ? d.slice(1) : d; };

module.exports = { extractText, extractFacts, SUPPORTED, phoneDigits };
