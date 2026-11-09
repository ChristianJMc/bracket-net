// What decided each tournament game, what upsets have in common, and how well the model separates near-certain
// wins from likely upsets. Uses only out-of-sample predictions (data/walkforward-preds.json) for the "before" side,
// and the game's own box score (raw/skedYYYY.json) for the "what happened" side. Writes docs/upset-anatomy.md and
// data/game-explanations.json.
//
// What happened in a game is measured against what each team usually does: for each of the four factors (shooting,
// turnovers, offensive rebounding, free throws) plus three-point shooting luck, the expected value for A's offense is
// the average of A's season offense and B's season defense. A factor "decided" the game when its swing, converted to
// points, did the most to produce the winner's margin.
//   node build/explain.js
const fs = require('fs');
const path = require('path');
const { seasonGames } = require('./lib/sked');
const { gameKey } = require('./news/store');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const ROUNDS = ['First Four', 'Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];

// Points each factor's swing was worth for one team's offense in this game, versus expectation.
function swings(box, opp, poss, off, def) {
  const exp = (o, d) => (o + d) / 2;
  const fga = box.fga, efg = (box.fgm + 0.5 * box.tpm) / fga, tov = box.tov / poss, orb = box.orb / (box.orb + opp.drb), ftr = box.fta / fga;
  const tp = box.tpa ? box.tpm / box.tpa : null;
  const ppShot = 2 * exp(off.efgO, def.efgD); // points per field-goal attempt at the expected shooting
  return {
    // Three-point luck: makes above expectation on the threes actually taken (the part of shooting most driven by chance).
    threes: tp == null ? 0 : (tp - exp(off.tpO, def.tpD)) * box.tpa * 3,
    // Two-point and overall shooting beyond the three-point luck.
    shooting: (efg - exp(off.efgO, def.efgD)) * fga * 2 - (tp == null ? 0 : (tp - exp(off.tpO, def.tpD)) * box.tpa * 3),
    turnovers: -(tov - exp(off.toO, def.toD)) * poss * ppShot * 0.5,
    rebounding: (orb - exp(off.orbO, def.orbD)) * (opp.drb + box.orb) * ppShot * 0.5,
    free_throws: (ftr - exp(off.ftrO, def.ftrD)) * fga * off.ftp * 1.0,
  };
}

function main() {
  const dataset = read('data/dataset.json');
  const wf = read('data/walkforward-report.json'), P = read('data/walkforward-preds.json').preds;
  const games = [];
  for (const year of dataset.years) {
    const sked = seasonGames(read(`raw/sked${year}.json`));
    const T = dataset.teams[year];
    for (const g of dataset.games.filter(x => x.year === year)) {
      const p = P[gameKey(g)]; if (p == null) continue;
      const box = sked.find(x => x.type === 3 && ((x.t1 === g.a && x.t2 === g.b) || (x.t1 === g.b && x.t2 === g.a)));
      if (!box) continue;
      const aIs1 = box.t1 === g.a, bA = aIs1 ? box.b1 : box.b2, bB = aIs1 ? box.b2 : box.b1;
      const sA = swings(bA, bB, box.poss, T[g.a], T[g.b]), sB = swings(bB, bA, box.poss, T[g.b], T[g.a]);
      const fav = p >= 0.5 ? g.a : g.b, pFav = Math.max(p, 1 - p), winner = g.sa > g.sb ? g.a : g.b;
      const net = Object.fromEntries(Object.keys(sA).map(k => [k, winner === g.a ? sA[k] - sB[k] : sB[k] - sA[k]])); // in the winner's favour
      const decided = Object.entries(net).sort((a, b) => b[1] - a[1])[0][0];
      games.push({ year, round: g.round, key: gameKey(g), fav, dog: fav === g.a ? g.b : g.a, seedFav: T[fav].seed, seedDog: T[fav === g.a ? g.b : g.a].seed,
        pFav, upset: winner !== fav, winner, margin: Math.abs(g.sa - g.sb), poss: box.poss, net, decided,
        luck: net.threes, score: `${Math.max(g.sa, g.sb)}-${Math.min(g.sa, g.sb)}` });
    }
  }

  // 1. Tiers: how often favourites at each confidence level actually lost.
  const TIERS = [[0.5, 0.6, 'Coin flip (50–60%)'], [0.6, 0.7, 'Lean (60–70%)'], [0.7, 0.8, 'Solid (70–80%)'], [0.8, 0.9, 'Strong (80–90%)'], [0.9, 0.97, 'Heavy (90–97%)'], [0.97, 1.01, 'Near-certain (97%+)']];
  const tiers = TIERS.map(([lo, hi, label]) => {
    const t = games.filter(x => x.pFav >= lo && x.pFav < hi);
    return { label, n: t.length, predicted: t.reduce((s, x) => s + 1 - x.pFav, 0) / (t.length || 1), actual: t.filter(x => x.upset).length / (t.length || 1) };
  });
  // Discrimination: probability a random upset was rated more upset-prone than a random favourite win (AUC).
  const ups = games.filter(x => x.upset), wins = games.filter(x => !x.upset);
  let auc = 0; for (const u of ups) for (const w of wins) auc += u.pFav < w.pFav ? 1 : u.pFav === w.pFav ? 0.5 : 0;
  auc /= ups.length * wins.length;

  // 2. What decided games: upsets vs favourite wins.
  const FACT = { threes: 'Three-point shooting luck', shooting: 'Other shooting', turnovers: 'Turnovers', rebounding: 'Offensive rebounding', free_throws: 'Free throws' };
  const share = (list, k) => list.filter(x => x.decided === k).length / list.length;
  const avgNet = (list, k) => list.reduce((s, x) => s + x.net[k], 0) / list.length;
  // 3. Upsets by how far the underdog's three-point shooting ran above its norm.
  const hot = ups.filter(x => x.luck >= 6).length / ups.length;
  const luckOver = ups.filter(x => x.luck > x.margin).length / ups.length;
  // 4. Pace: possessions in upsets vs favourite wins.
  const avg = (list, f) => list.reduce((s, x) => s + f(x), 0) / list.length;

  const md = ['# Upset anatomy', '',
    `Out-of-sample predictions for ${games.length} tournament games (${Math.min(...games.map(g => g.year))}–${Math.max(...games.map(g => g.year))}), adopted model: ${wf.adopted}. "Favorite" means the model's favorite before tip-off.`, '',
    '## Can the model tell near-certain wins from likely upsets?', '',
    '| Favorite\'s chance | Games | Upsets expected | Upsets that happened |', '|---|---|---|---|',
    ...tiers.map(t => `| ${t.label} | ${t.n} | ${pct(t.predicted)} | ${pct(t.actual)} |`), '',
    `Ranking games by upset risk: a random upset had been rated more upset-prone than a random favorite win **${pct(auc)}** of the time (AUC ${auc.toFixed(3)}; 50% would be guessing).`, '',
    '## What decided the games', '',
    'For each game, the factor whose swing against both teams\' season norms did the most to produce the winning margin.', '',
    '| Factor | Upsets decided by it | Favorite wins decided by it | Avg. points it gave the winner in upsets | ... in favorite wins |', '|---|---|---|---|---|',
    ...Object.entries(FACT).map(([k, label]) => `| ${label} | ${pct(share(ups, k))} | ${pct(share(wins, k))} | ${avgNet(ups, k).toFixed(1)} | ${avgNet(wins, k).toFixed(1)} |`), '',
    `- In ${pct(hot)} of upsets the underdog made at least 6 more points from three than its norm (against that defense) would predict; in ${pct(luckOver)} that three-point luck alone was bigger than the final margin.`,
    `- Possessions: ${avg(ups, x => x.poss).toFixed(1)} in upsets vs ${avg(wins, x => x.poss).toFixed(1)} in favorite wins (fewer possessions, fewer chances for the better team to pull away).`,
    `- Margin: upsets were decided by ${avg(ups, x => x.margin).toFixed(1)} points on average, favorite wins by ${avg(wins, x => x.margin).toFixed(1)}.`, '',
    'What this means for prediction: a large share of upsets come from shooting variance that no pregame number can see. The model\'s job is to rate the risk correctly (the tiers above), not to call every upset.', '',
    '## The biggest upsets and what decided them', '',
    '| Year | Round | Winner (seed) | Loser (seed) | Score | Model gave the winner | Decided by | Three-point luck (pts) |', '|---|---|---|---|---|---|---|---|',
    ...ups.sort((a, b) => b.pFav - a.pFav).slice(0, 25).map(x => `| ${x.year} | ${ROUNDS[x.round]} | ${x.dog} (${x.seedDog}) | ${x.fav} (${x.seedFav}) | ${x.score} | ${pct(1 - x.pFav)} | ${FACT[x.decided]} | ${x.luck.toFixed(1)} |`), ''];
  fs.writeFileSync(path.join(ROOT, 'docs', 'upset-anatomy.md'), md.join('\n'));
  fs.writeFileSync(path.join(ROOT, 'data', 'game-explanations.json'), JSON.stringify({ tiers, auc, games }, null, 1));
  console.log(`${games.length} games; AUC ${auc.toFixed(3)}`);
  for (const t of tiers) console.log(`  ${t.label.padEnd(22)} n ${String(t.n).padStart(4)}  expected ${pct(t.predicted).padStart(6)}  actual ${pct(t.actual).padStart(6)}`);
  for (const [k, label] of Object.entries(FACT)) console.log(`  ${label.padEnd(26)} upsets ${pct(share(ups, k)).padStart(6)}  fav wins ${pct(share(wins, k)).padStart(6)}`);
  console.log(`  hot underdog threes in ${pct(hot)} of upsets; luck > margin in ${pct(luckOver)}; poss ${avg(ups, x => x.poss).toFixed(1)} vs ${avg(wins, x => x.poss).toFixed(1)}`);
}

if (require.main === module) main();
