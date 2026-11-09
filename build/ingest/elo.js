// Margin-of-victory Elo run continuously from 2008 through every season, carried over between seasons with
// regression toward the mean. Unlike the per-season efficiency ratings, it remembers last year (program strength),
// and it weights recent games more by construction. Writes data/features-elo.json.
//
//   node build/ingest/elo.js
//
// Settings (K and how much to regress between seasons) are tuned on regular-season games only, never on
// tournament games, so the tournament stays a clean test. Tournament games do update ratings afterwards, but
// each team's snapshot is taken before its first NCAA game.
//   elo            rating entering the tournament
//   elo_30d        change over the last 30 days before the tournament (rising or fading)
//   elo_preseason  rating at the first game of the season (what last year said about this team)
const fs = require('fs');
const path = require('path');
const { seasonGames } = require('../lib/sked');

const ROOT = path.join(__dirname, '..', '..');
const DAY = 86400e3;
const HOME = 75;

// beforeGame(g, R) sees the ratings just before each game; onGame(g, p, y) sees the pregame chance and result.
function runElo(seasons, { K, carry }, { onSeason, beforeGame, onGame } = {}) {
  const R = new Map();
  const get = (t) => (R.has(t) ? R.get(t) : 1500);
  for (const { year, games } of seasons) {
    for (const [t, r] of R) R.set(t, 1500 + (r - 1500) * carry);
    if (onSeason) onSeason(year, R);
    for (const g of games) {
      if (beforeGame) beforeGame(g, R);
      const d = get(g.t1) - get(g.t2) + HOME * g.loc1;
      const p = 1 / (1 + Math.pow(10, -d / 400));
      const y = g.b1.pts > g.b2.pts ? 1 : 0;
      if (onGame) onGame(g, p, y);
      const mov = Math.abs(g.b1.pts - g.b2.pts);
      const mult = Math.pow(mov + 3, 0.8) / (7.5 + 0.006 * (y ? d : -d));
      const delta = K * mult * (y - p);
      R.set(g.t1, get(g.t1) + delta); R.set(g.t2, get(g.t2) - delta);
    }
  }
  return R;
}

function load(years) {
  return years.map(year => {
    const games = seasonGames(JSON.parse(fs.readFileSync(path.join(ROOT, 'raw', `sked${year}.json`), 'utf8'))).sort((a, b) => a.date - b.date);
    return { year, games };
  });
}

function tune(seasons) {
  let best = null;
  for (const K of [30, 40, 50, 60, 75, 90]) for (const carry of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
    let ll = 0, n = 0;
    runElo(seasons, { K, carry }, { onGame: (g, p, y) => {
      if (g.type === 3) return;                       // never tournament / postseason games
      if (g.date < g.seasonStart + 21 * DAY) return;  // skip the first three weeks while ratings settle
      ll -= Math.log(y ? p : 1 - p); n++;
    } });
    const s = { K, carry, ll: ll / n };
    if (!best || s.ll < best.ll) best = s;
  }
  return best;
}

function build({ log = console.log } = {}) {
  const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dataset.json'), 'utf8'));
  const years = dataset.years;
  const seasons = load(years);
  for (const s of seasons) { const start = s.games[0].date; for (const g of s.games) g.seasonStart = start; }
  const best = tune(seasons);
  log(`Elo settings tuned on regular-season games: K ${best.K}, carry-over ${best.carry} (log loss ${best.ll.toFixed(4)})`);

  // Snapshots: season start, 30 days before the tournament, and the tournament.
  const out = { about: 'Margin-of-victory Elo across seasons; snapshot before each team\'s first NCAA game.', settings: best, teams: {}, columns: {} };
  for (const c of ['elo', 'elo_30d', 'elo_preseason']) out.columns[c] = { file: 'elo', column: c, source: 'own_elo', kind: 'rating' };
  for (const s of seasons) {
    const start = Math.min(...dataset.games.filter(g => g.year === s.year && g.date).map(g => Date.parse(g.date)));
    const firstNcaa = s.games.find(g => g.date >= start - DAY / 2);
    for (const g of s.games) g.year = s.year;
    if (firstNcaa) firstNcaa.snapshotBefore = true;
    const m30 = s.games.find(g => g.date >= start - 30 * DAY);
    if (m30) m30.snapshot30 = true;
  }
  const snaps = {};
  const snap = (year, k, R) => { (snaps[year] = snaps[year] || {})[k] = new Map(R); };
  runElo(seasons, best, {
    onSeason: (year, R) => snap(year, 'start', R),
    beforeGame: (g, R) => { if (g.snapshotBefore) snap(g.year, 'tournament', R); if (g.snapshot30) snap(g.year, 'd30', R); },
  });
  for (const year of years) {
    out.teams[year] = {};
    const S = snaps[year] || {}, at = S.tournament, st = S.start, m = S.d30;
    for (const name of Object.keys(dataset.teams[year])) {
      const r = (M) => (M && M.has(name) ? M.get(name) : null);
      out.teams[year][name] = { elo: r(at), elo_30d: r(at) != null && r(m) != null ? r(at) - r(m) : null, elo_preseason: year === years[0] ? null : r(st) };
    }
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'features-elo.json'), JSON.stringify(out));
  return out;
}

if (require.main === module) build();
module.exports = { runElo, build, load };
