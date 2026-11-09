// Small RFC-4180 CSV parser (quoted fields, embedded commas/newlines, BOM). Returns objects keyed by header.
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map(h => h.trim());
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, coerce(r[i])])));
}

function coerce(v) {
  if (v == null) return null;
  const t = v.trim();
  if (t === '') return null;
  if (/^(TRUE|FALSE)$/i.test(t)) return /^TRUE$/i.test(t) ? 1 : 0;
  const n = Number(t.replace(/%$/, ''));
  return Number.isFinite(n) && /^-?[\d.]+%?$/.test(t) ? n : t;
}

module.exports = { parseCSV };
