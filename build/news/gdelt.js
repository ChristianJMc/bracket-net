// Pregame news for the live season (GDELT DOC API: free, no key, rolling ~3-month window, one request
// per 5 seconds). For each upcoming game, searches each team for injury/illness/suspension coverage
// published before tip-off and stores the article list as pregame items.
// Usage: node build/news/gdelt.js <year> [--days 10]   (games must have tip-off times from espn.js)
const { gameKey, load, save, addItem } = require('./store');
const { hostAllowed, fetchWithTimeout } = require('../lib/safe-fetch');

const API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const TERMS = '(injury OR injured OR illness OR sick OR suspended OR questionable OR "out for" OR "will not play")';
const stamp = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function search(team, from, to) {
  const q = `"${team}" basketball ${TERMS}`;
  const url = `${API}?query=${encodeURIComponent(q)}&mode=ArtList&format=json&maxrecords=50&sort=DateDesc` +
    `&startdatetime=${stamp(from)}&enddatetime=${stamp(to)}`;
  await sleep(6000);
  if (!hostAllowed(url)) throw new Error(`refusing host ${new URL(url).hostname}`);
  const res = await fetchWithTimeout(url, {}, 30_000);
  const text = await res.text();
  if (text.length > 20e6) throw new Error('GDELT response over 20 MB');
  if (!text.trim().startsWith('{')) throw new Error(`GDELT: ${text.slice(0, 120)}`);
  return (JSON.parse(text).articles || []).map(a => ({
    source: 'gdelt', title: a.title, url: a.url, published: a.seendate &&
      `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}T${a.seendate.slice(9, 11)}:${a.seendate.slice(11, 13)}:00Z`,
    domain: a.domain, text: null,
  }));
}

async function collectPregame(year, days = 10) {
  const store = load(year);
  for (const [key, entry] of Object.entries(store.games)) {
    if (!entry.tipoff) continue;
    const tip = new Date(entry.tipoff), from = new Date(tip.getTime() - days * 864e5);
    for (const team of [entry.a, entry.b]) {
      const items = await search(team, from, tip);
      // Search windows end at tip-off, and timing() re-checks every item against it.
      let n = 0; for (const it of items) if (addItem(entry, { ...it, team })) n++;
      console.log(`${key} ${team}: ${n} pregame articles`);
    }
    save(store);
  }
}

if (require.main === module) {
  const year = +process.argv[2];
  const di = process.argv.indexOf('--days');
  if (!year) { console.error('usage: node build/news/gdelt.js <year> [--days 10]'); process.exit(1); }
  collectPregame(year, di > 0 ? +process.argv[di + 1] : 10).catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { search, collectPregame, gameKey };
