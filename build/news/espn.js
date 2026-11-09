// Collects ESPN data for every tournament game: tip-off time, AP ranks at tip, the recap article
// (postgame), and player minutes from the box score (to measure who was missing later).
// Usage: node build/news/espn.js 2024 [2025 ...]   (all years if none given). Responses are cached in raw/espn/.
const path = require('path');
const fs = require('fs');
const { ROOT, gameKey, load, save, addItem, cachedJSON } = require('./store');
const { makeMatcher } = require('../lib/names');

const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';
const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dataset.json'), 'utf8'));

function teamNames(competitor) {
  const t = competitor.team || {};
  return [t.location, t.shortDisplayName, t.displayName, t.name && t.location ? t.location : null].filter(Boolean);
}

function boxMinutes(summary) {
  const out = {};
  for (const side of (summary.boxscore && summary.boxscore.players) || []) {
    const stats = (side.statistics || [])[0];
    if (!stats) continue;
    const iMin = (stats.labels || stats.names || []).findIndex(l => /^MIN$/i.test(l));
    out[side.team.location || side.team.displayName] = (stats.athletes || []).map(a => ({
      player: a.athlete && a.athlete.displayName, starter: !!a.starter, dnp: !!a.didNotPlay,
      min: iMin >= 0 && a.stats ? +a.stats[iMin] || 0 : null,
    }));
  }
  return out;
}

async function collectYear(year) {
  const games = dataset.games.filter(g => g.year === year);
  const match = makeMatcher(new Set(Object.keys(dataset.teams[year])));
  const store = load(year);
  const dates = [...new Set(games.map(g => g.date))];
  let found = 0, recaps = 0;
  for (const date of dates) {
    const ymd = date.replace(/-/g, '');
    const sb = await cachedJSON(`${API}/scoreboard?dates=${ymd}&groups=100&limit=200`, path.join(ROOT, 'raw', 'espn', 'scoreboard', `${ymd}.json`));
    for (const ev of sb.events || []) {
      const comp = ev.competitions[0];
      const sides = comp.competitors.map(c => teamNames(c).map(n => match(n, null)).find(Boolean));
      const g = games.find(x => x.date === date && sides.includes(x.a) && sides.includes(x.b));
      if (!g) continue;
      found++;
      const key = gameKey(g);
      const entry = store.games[key] = store.games[key] || { year, round: g.round, a: g.a, b: g.b };
      entry.espnId = ev.id;
      entry.tipoff = ev.date;
      entry.apRankAtTip = Object.fromEntries(comp.competitors.map((c, i) => [sides[i], c.curatedRank && c.curatedRank.current < 99 ? c.curatedRank.current : null]));
      const summary = await cachedJSON(`${API}/summary?event=${ev.id}`, path.join(ROOT, 'raw', 'espn', 'summary', `${ev.id}.json`));
      if (summary.article && summary.article.story) {
        recaps++;
        addItem(entry, { source: 'espn_recap', title: summary.article.headline, published: summary.article.published,
          url: (summary.article.links && summary.article.links.web && summary.article.links.web.href) || null,
          text: summary.article.story.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
      }
      entry.minutes = boxMinutes(summary);
    }
  }
  save(store);
  console.log(`${year}: matched ${found}/${games.length} games to ESPN, ${recaps} recaps`);
}

if (require.main === module) {
  (async () => {
    const years = process.argv.slice(2).map(Number).filter(Boolean);
    for (const y of years.length ? years : dataset.years) await collectYear(y);
  })().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { collectYear, boxMinutes };
