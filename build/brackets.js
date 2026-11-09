// Generates the N most probable brackets for a season and reports the odds honestly.
// Usage: node build/brackets.js --year 2026 [--n 10] [--flip 0.6]
//   --n     how many brackets to produce (the N most probable maximize P(at least one perfect); max 50)
//   --flip  a game counts as a coin flip when the pick's chance is below this (default 0.6)
//   --after-first-four  lock in First Four winners (from data/dataset.json) before searching, the way pools open
// Uses data/model-stageB.json when walk-forward adopted it (pass --base to force the base model),
// otherwise the base model in data/model.json.
// Writes docs/brackets-YEAR.md and data/brackets-YEAR.json.
const fs = require('fs');
const path = require('path');
const { NN } = require('./nn');
const { leavesOf, kBest, gamesOf, ESPN_POINTS } = require('./lib/bracket');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const ROUNDS = ['First Four', 'Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];

function pairwise(dataset, year) {
  const m = read('data/model.json');
  const model = { scale: m.model.scale, nets: m.model.nets.map(NN.fromJSON) };
  const T = dataset.teams[year], cache = new Map();
  const base = (g) => NN.predict(model, T[g.a], T[g.b], 0);
  let f = base, name = 'base model (data/model.json)';
  if (fs.existsSync(path.join(ROOT, 'data', 'model-stageB.json')) && !process.argv.includes('--base')) {
    const saved = read('data/model-stageB.json');
    if (saved.adopted) {
      const { stageBPredictor } = require('./walkforward');
      const kaggle = require('./lib/features').loadFeatures();
      // Built before tip-off: earlier tournaments only, so this-run stats are zero and program history stops at last year.
      const { makeHistory } = require('./lib/tourney-history');
      const before = { ...dataset, games: dataset.games.filter(g => g.year < year) };
      const mp = (g) => NN.predict(model, dataset.teams[g.year][g.a], dataset.teams[g.year][g.b], 0);
      f = stageBPredictor(saved, { dataset, kaggle, factors: {}, history: makeHistory(before, mp) }, base);
      name = `adopted model: ${saved.adopted} (data/model-stageB.json${['nnB', 'ridgeB', 'blend'].includes(saved.adopted) && saved.chosen.length ? `, ${saved.chosen.length} tournament inputs` : ''})`;
    }
  }
  return {
    name,
    P: (a, b, round) => {
      const k = a + '|' + b + '|' + round;
      if (!cache.has(k)) { const p = f({ year, round, a, b }); cache.set(k, p); cache.set(b + '|' + a + '|' + round, 1 - p); }
      return cache.get(k);
    },
  };
}

function actualPicks(dataset, year, leaves) {
  const games = dataset.games.filter(g => g.year === year);
  if (!games.length) return null;
  const picks = {};
  function go(lo, hi) {
    if (hi - lo === 1) {
      const s = leaves[lo];
      if (s.length === 1) return s[0];
      const g = games.find(x => x.round === 0 && s.includes(x.a) && s.includes(x.b));
      return (picks[`0:${lo}`] = g ? (g.sa > g.sb ? g.a : g.b) : s[0]);
    }
    const mid = (lo + hi) / 2, a = go(lo, mid), b = go(mid, hi), round = Math.log2(hi - lo);
    const g = games.find(x => x.round === round && [x.a, x.b].includes(a) && [x.a, x.b].includes(b));
    const w = g ? (g.sa > g.sb ? g.a : g.b) : games.some(x => x.round > round && (x.a === a || x.b === a)) ? a : b;
    return (picks[`${round}:${lo}`] = w);
  }
  go(0, leaves.length);
  return picks;
}

function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const year = +arg('--year', 2026), N = Math.min(50, +arg('--n', 10)), flip = +arg('--flip', 0.6);
  const dataset = read('data/dataset.json');
  if (!dataset.teams[year]) { console.error(`No field for ${year} in data/dataset.json yet (the bracket is announced on Selection Sunday).`); process.exit(1); }
  let leaves = leavesOf(dataset.teams[year], dataset.brackets[year].finalFour);
  const afterFF = process.argv.includes('--after-first-four');
  if (afterFF) leaves = leaves.map(s => {
    if (s.length === 1) return s;
    const g = dataset.games.find(x => x.year === year && x.round === 0 && s.includes(x.a) && s.includes(x.b));
    if (!g) { console.error('First Four results not in the dataset yet; run without --after-first-four.'); process.exit(1); }
    return [g.sa > g.sb ? g.a : g.b];
  });
  const { name, P } = pairwise(dataset, year);
  const best = kBest(leaves, P, N);
  const top = gamesOf(leaves, best[0].picks, P);
  const flips = top.filter(g => g.p < flip).sort((a, b) => a.p - b.p);
  // Most pools open after the First Four, so its games drop out of the odds.
  const ffProb = top.filter(g => g.round === 0).reduce((s, g) => s * g.p, 1);
  let cum = 0;
  const rows = best.map((b, i) => {
    cum += b.p;
    const diff = gamesOf(leaves, b.picks, P).filter(g => best[0].picks[g.key] !== g.w);
    return { rank: i + 1, p: b.p, cumulative: cum, changes: diff.map(g => `${ROUNDS[g.round]}: ${g.w} over ${g.l} (${(g.p * 100).toFixed(0)}%)`) };
  });
  const actual = actualPicks(dataset, year, leaves);
  let actualInfo = null;
  if (actual) {
    const ag = gamesOf(leaves, actual, P);
    const pActual = ag.reduce((s, g) => s * g.p, 1);
    const score = (picks) => top.reduce((s, g) => s + (picks[g.key] === actual[g.key] && g.round > 0 ? ESPN_POINTS[g.round] : 0), 0);
    actualInfo = { log10P: Math.log10(pActual), bestScore: score(best[0].picks), correct: top.filter(g => g.round > 0 && best[0].picks[g.key] === actual[g.key]).length };
  }
  const oneIn = (p) => p > 0 ? `1 in ${Number((1 / p).toPrecision(3)).toLocaleString('en-US')}` : '0';
  const md = [
    `# ${year} bracket set`, '',
    `Model: ${name}. ${N} brackets, the ${N} most probable complete outcomes of the ${afterFF ? '63 games after the First Four' : '67 games'}.`, '',
    `- Most likely bracket: ${oneIn(best[0].p)} to be perfect including the First Four, ${oneIn(best[0].p / ffProb)} for the 63 games most pools score.`,
    `- Chance at least one of these ${N} is perfect: ${oneIn(cum)}.`,
    `- For scale: picking every game by coin flip is 1 in ${(2 ** 63).toExponential(2)}.`,
    actualInfo ? `- The real ${year} bracket had a 1 in 10^${(-actualInfo.log10P).toFixed(1)} chance under this model. The top bracket got ${actualInfo.correct}/63 games right for ${actualInfo.bestScore} ESPN points.` : '',
    '', `## Coin flips in the top bracket (pick's chance under ${Math.round(flip * 100)}%)`, '',
    '| Round | Pick | Over | Chance |', '|---|---|---|---|',
    ...flips.map(g => `| ${ROUNDS[g.round]} | ${g.w} | ${g.l} | ${(g.p * 100).toFixed(0)}% |`),
    '', '## The brackets', '',
    '| # | Chance perfect | Cumulative | Changes from bracket 1 |', '|---|---|---|---|',
    ...rows.map(r => `| ${r.rank} | ${oneIn(r.p)} | ${oneIn(r.cumulative)} | ${r.changes.join('; ') || 'baseline'} |`),
    '', '## Bracket 1, game by game', '',
    '| Round | Winner | Loser | Chance |', '|---|---|---|---|',
    ...top.sort((a, b) => a.round - b.round || a.key.localeCompare(b.key)).map(g => `| ${ROUNDS[g.round]} | ${g.w} | ${g.l} | ${(g.p * 100).toFixed(0)}% |`),
  ];
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', `brackets-${year}.md`), md.filter(l => l !== '').join('\n').replace(/\n(#+ )/g, '\n\n$1').replace(/\n\|/g, '\n|'));
  fs.writeFileSync(path.join(ROOT, 'data', `brackets-${year}.json`), JSON.stringify({ year, model: name, brackets: best, flips, actual: actualInfo }));
  console.log(`${year}: top bracket ${oneIn(best[0].p)}; top ${N} combined ${oneIn(cum)}; ${flips.length} coin flips under ${flip}`);
  if (actualInfo) console.log(`actual bracket: 1 in 10^${(-actualInfo.log10P).toFixed(1)}; top bracket ${actualInfo.correct}/63 right, ${actualInfo.bestScore} pts`);
}

if (require.main === module) main();
