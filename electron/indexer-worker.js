// Runs in its own background process so reading big files never freezes the window.
// pdf.js only uses its Node.js code path when it thinks it's in Node/the main process.
try { Object.defineProperty(process, 'type', { value: 'browser', configurable: true }); } catch { /* ignore */ }
const { extractText, extractFacts } = require('./extract');

// pdf.js prints harmless warnings about optional drawing libraries; keep the log clean.
const warn = console.warn;
console.warn = (...a) => { if (!/polyfill|canvas/i.test(String(a[0]))) warn(...a); };
console.log = console.warn;

process.parentPort.on('message', async (e) => {
  const { id, file } = e.data || {};
  try {
    const text = await extractText(file);
    process.parentPort.postMessage({ id, ok: true, text, facts: extractFacts(text) });
  } catch (err) {
    process.parentPort.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
});
