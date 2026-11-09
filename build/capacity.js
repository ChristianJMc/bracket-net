// Does a bigger network help? Trains the base model at several sizes on seasons through 2019 and scores each on
// 2021-2026: every regular-season game (tens of thousands, so small differences are measurable) and the tournaments.
// A linear model on the same inputs is included: if it matches the networks, capacity isn't the bottleneck.
// Also compares learning from wins and losses with learning from point margins (P(win) = Phi(margin / sigma)).
//   node build/capacity.js
const fs = require('fs');
const path = require('path');
const { NN } = require('./nn');
const { fitLogistic, fitMargin, normCdf, dot, logLoss } = require('./lib/metrics');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const SPLIT = 2019;
const SIZES = process.argv.includes("--quick") ? [[24, 12]] : [[4, 2], [12, 6], [24, 12], [48, 24], [96, 48]];

function main() {
  const data = read('data/dataset.json'), tr = read('data/training.json');
  const xs = [], ys = [], yrs = [], ms = [];
  for (const [key, a, b, loc, y, m] of tr.rows) { const s = tr.snapshots[key]; xs.push(NN.diff(s[a], s[b], loc)); ys.push(y); yrs.push(+key.slice(0, 4)); ms.push(m); }
  const train = [], test = [];
  yrs.forEach((y, i) => (y <= SPLIT ? train : test).push(i));
  const scale = NN.fitScale(train.map(i => xs[i]));
  const X = xs.map(x => x.map((v, j) => v / scale[j]));
  const tour = data.games.filter(g => g.year > SPLIT).map(g => ({ x: NN.diff(data.teams[g.year][g.a], data.teams[g.year][g.b], 0).map((v, j) => v / scale[j]), y: g.sa > g.sb ? 1 : 0 }));
  const evalP = (p) => ({
    season: test.reduce((s, i) => s + logLoss(p(X[i]), ys[i]), 0) / test.length,
    tourney: tour.reduce((s, t) => s + logLoss(p(t.x), t.y), 0) / tour.length,
    trainLL: train.filter((_, k) => k % 10 === 0).reduce((s, i) => s + logLoss(p(X[i]), ys[i]), 0) / Math.ceil(train.length / 10),
  });
  console.log(`train ${train.length} games (≤${SPLIT}), test ${test.length} regular-season games and ${tour.length} tournament games (>${SPLIT})`);
  const out = [];
  const w = fitLogistic(train.map(i => X[i]), train.map(i => ys[i]), { l2: 1e-5 });
  out.push({ model: 'linear (logistic, same inputs)', params: w.length, ...evalP(x => NN.sigmoid(dot(w, x))) });
  if (ms.every(Number.isFinite)) {
    const { w: wm, sigma } = fitMargin(train.map(i => X[i]), train.map(i => ms[i]));
    out.push({ model: `linear on margin (sigma ${sigma.toFixed(1)})`, params: wm.length, ...evalP(x => normCdf(dot(wm, x) / sigma)) });
  }
  for (const [h1, h2] of SIZES) {
    const t0 = Date.now(), nets = [];
    for (let s = 0; s < 3; s++) nets.push(NN.train(train.map(i => X[i]), train.map(i => ys[i]), { h1, h2, epochs: 10, l2: 1e-4, lr: 0.002, batch: 128, seed: 1000 + s * 31 }));
    const p = (x) => NN.sigmoid(nets.reduce((s, n) => s + NN.logit(n, x), 0) / nets.length);
    out.push({ model: `network ${h1}-${h2}`, params: nets[0].w.length, ...evalP(p), seconds: Math.round((Date.now() - t0) / 1000) });
    console.log(`  ${h1}-${h2} done`);
  }
  for (const r of out) console.log(`${r.model.padEnd(32)} params ${String(r.params).padStart(5)}  train ${r.trainLL.toFixed(4)}  2021+ season ${r.season.toFixed(4)}  2021+ tournaments ${r.tourney.toFixed(4)}`);
  fs.writeFileSync(path.join(ROOT, 'data', 'capacity.json'), JSON.stringify({ split: SPLIT, trainGames: train.length, testGames: test.length, tourneyGames: tour.length, results: out }, null, 1));
}

if (require.main === module) main();
