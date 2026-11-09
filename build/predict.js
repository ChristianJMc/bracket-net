// One matchup, predicted the way it will actually be played: with everything known before tip-off
// (both teams' season profiles, this tournament's earlier rounds, earlier seasons) and nothing after.
//
//   node build/predict.js --year 2026 --a Michigan --b Connecticut --round 6 [--loc 0]
//     --round  0 First Four, 1 round of 64 ... 6 championship (default 1)
//     --loc    1 if A is at home, -1 if B is, 0 neutral (default)
//
// Prints the win chance, what pushes it each way (tagged stat / rating / projection / hybrid / opinion),
// the teams' spark and tournament-run stats, and the closest past matchups.
const fs = require('fs');
const path = require('path');
const { NN } = require('./nn');
const { makeHistory, HISTORY_COLUMNS } = require('./lib/tourney-history');
const { buildRows } = require('./review');
const { watchYear } = require('./upset-watch');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const ROUNDS = ['First Four', 'Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];
const pct = (p) => `${(p * 100).toFixed(1)}%`;

function predictMatchup({ year, a, b, round = 1, loc = 0 }) {
  const dataset = read('data/dataset.json');
  const kaggle = require('./lib/features').loadFeatures();
  const T = dataset.teams[year];
  for (const t of [a, b]) if (!T || !T[t]) throw new Error(`${t} is not in the ${year} field. Names follow Barttorvik (e.g. "Connecticut", "N.C. State", "Saint Mary's").`);
  // Only games before this one: earlier seasons, and earlier rounds of this tournament.
  const before = { ...dataset, games: dataset.games.filter(g => g.year < year || (g.year === year && g.round < round)) };
  const m = read('data/model.json');
  const model = { scale: m.model.scale, nets: m.model.nets.map(NN.fromJSON) };
  const pBase = (g) => NN.predict(model, dataset.teams[g.year][g.a], dataset.teams[g.year][g.b], g.loc || 0);
  const game = { year, round, a, b, loc };
  let p = pBase(game), modelName = 'base model';
  let stageBInfo = null;
  if (fs.existsSync(path.join(ROOT, 'data', 'model-stageB.json'))) {
    const saved = read('data/model-stageB.json');
    if (saved.adopted) {
      const { stageBPredictor, kindOfColumn } = require('./walkforward');
      const history = makeHistory(before, pBase);
      p = stageBPredictor(saved, { dataset, kaggle, factors: {}, history }, pBase)(game);
      modelName = `adopted model: ${saved.adopted}${['nnB', 'ridgeB', 'blend'].includes(saved.adopted) && saved.chosen.length ? ` (${saved.chosen.length} tournament inputs)` : ''}`;
      stageBInfo = saved.chosen.map(c => ({ c, kind: kindOfColumn(c, kaggle) }));
    }
  }

  // What pushes it: zero out one stat difference at a time in the base model (rough; stats overlap).
  const x = NN.diff(T[a], T[b], loc);
  const prob = (v) => NN.sigmoid(model.nets.reduce((s, n) => s + NN.logit(n, v.map((q, j) => q / model.scale[j])), 0) / model.nets.length);
  const p0 = prob(x);
  const factors = NN.FEATURES.map(([k, label], j) => { const v = Float64Array.from(x); v[j] = 0; return { label, d: p0 - prob(v) }; })
    .sort((u, w) => Math.abs(w.d) - Math.abs(u.d)).slice(0, 6);

  const hist = makeHistory(before, pBase);
  const ha = hist(year, round, a), hb = hist(year, round, b);
  const spark = Object.keys(T[a]).filter(k => k.startsWith('mo_'));

  // Closest past matchups, from earlier seasons only.
  const rows = buildRows({ ...before, games: [...before.games, { ...game, sa: 1, sb: 0 }] }, kaggle, pBase);
  const target = rows[rows.length - 1];
  const columns = [...new Set(rows.flatMap(r => Object.keys(r.favStats)))];
  const w = watchYear(rows.slice(0, -1), year, columns, { targets: [target] })[0];

  return { a, b, year, round, p, modelName, factors, ha, hb, spark, Ta: T[a], Tb: T[b], watch: w, stageBInfo };
}

function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const r = predictMatchup({ year: +arg('--year'), a: arg('--a'), b: arg('--b'), round: +arg('--round', 1), loc: +arg('--loc', 0) });
  const fav = r.p >= 0.5 ? r.a : r.b, fp = Math.max(r.p, 1 - r.p);
  console.log(`\n${r.year} ${ROUNDS[r.round]}: ${r.a} (${r.Ta.seed}) vs ${r.b} (${r.Tb.seed})`);
  console.log(`${fav} wins ${pct(fp)} (${r.modelName}).  ${r.a} ${pct(r.p)} · ${r.b} ${pct(1 - r.p)}\n`);
  console.log('What pushes it (base model, one stat at a time):');
  for (const f of r.factors) console.log(`  ${f.label.padEnd(30)} favors ${(f.d > 0 ? r.a : r.b).padEnd(18)} ${(Math.abs(f.d) * 100).toFixed(1)} pts`);
  console.log('\nTournament run so far and program history (before this game):');
  for (const c of HISTORY_COLUMNS) console.log(`  ${c.padEnd(18)} ${String(+r.ha[c].toFixed(2)).padStart(7)}  ${String(+r.hb[c].toFixed(2)).padStart(7)}`);
  console.log('\nSpark stats:');
  for (const c of r.spark) console.log(`  ${c.padEnd(18)} ${String(+r.Ta[c].toFixed(2)).padStart(7)}  ${String(+r.Tb[c].toFixed(2)).padStart(7)}`);
  const wv = r.watch;
  console.log(`\nClosest past matchups (${wv.group}): underdogs won ${wv.near.filter(n => n.r.miss).length} of ${wv.near.length}; the model expected ${(wv.expected * wv.near.length).toFixed(1)}.`);
  for (const n of wv.near.slice(0, 6)) console.log(`  ${n.r.year} ${ROUNDS[n.r.round]}: ${n.r.dog} (${n.r.seedDog}) vs ${n.r.fav} (${n.r.seedFav}): ${n.r.miss ? 'underdog won' : 'favorite won'} ${n.r.score}`);
  if (wv.fired.length) console.log(`Upset signatures firing for the underdog: ${wv.fired.map(f => `${f.col} (${f.scope})`).join(', ')}`);
  if (r.stageBInfo) {
    const byKind = {};
    for (const s of r.stageBInfo) byKind[s.kind] = (byKind[s.kind] || 0) + 1;
    console.log(`\nTournament model inputs by kind: ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  }
}

if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exit(1); } }
module.exports = { predictMatchup };
