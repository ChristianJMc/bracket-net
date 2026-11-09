// Shared helpers for news collection: game keys, the per-year news store, timing labels, polite fetch.
const fs = require('fs');
const path = require('path');
const { sanitizeText, injectionFlags } = require('./sanitize');
const { hostAllowed } = require('../lib/safe-fetch');

const ROOT = path.join(__dirname, '..', '..');
const NEWS_DIR = path.join(ROOT, 'data', 'news');

const gameKey = (g) => `${g.year}-r${g.round}-${[g.a, g.b].sort().join('|')}`;

// The rule that keeps news from leaking: only text published before tip-off may become a feature.
// Anything after (recaps, Wikipedia write-ups) is analysis material for the miss review.
function timing(published, tipoff) {
  if (!published || !tipoff) return 'postgame';
  return new Date(published).getTime() < new Date(tipoff).getTime() ? 'pregame' : 'postgame';
}

function load(year) {
  const f = path.join(NEWS_DIR, `${year}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { year, games: {} };
}

function save(store) {
  fs.mkdirSync(NEWS_DIR, { recursive: true });
  fs.writeFileSync(path.join(NEWS_DIR, `${store.year}.json`), JSON.stringify(store, null, 1));
}

// Adds an item unless one with the same source+url/title is already stored. Text is sanitized on the way in and
// screened for prompt injection (build/news/sanitize.js); flagged items are kept for review but never sent to a model.
function addItem(entry, item) {
  entry.items = entry.items || [];
  item = { ...item, title: sanitizeText(item.title || '', { max: 300 }), text: sanitizeText(item.text || '') };
  item.flags = injectionFlags(item.title + ' ' + item.text);
  const id = item.source + '|' + (item.url || item.title);
  if (entry.items.some(x => x.source + '|' + (x.url || x.title) === id)) return false;
  entry.items.push({ ...item, timing: item.timing || timing(item.published, entry.tipoff) });
  return true;
}

// Cached GET: responses are written under raw/<cacheDir>/ so re-runs never refetch.
// Only allowlisted hosts (build/lib/safe-fetch.js), and the response must be JSON under 20 MB.
async function cachedJSON(url, cacheFile, { delayMs = 400 } = {}) {
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  await new Promise(r => setTimeout(r, delayMs));
  if (!hostAllowed(url)) throw new Error(`refusing host ${new URL(url).hostname}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'BracketNet/1.0 (personal research)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  if (text.length > 20e6) throw new Error(`response from ${url} is over 20 MB`);
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error(`non-JSON response from ${url}: ${text.slice(0, 120)}`); }
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, text);
  return json;
}

module.exports = { ROOT, NEWS_DIR, gameKey, timing, load, save, addItem, cachedJSON };
