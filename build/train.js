// Trains the ensemble on ~59k regular-season and non-NCAA postseason games, then tests it on all
// 1,196 NCAA tournament games 2008-2026 (none of which it ever trains on). Writes data/model.json.
// Usage: node build/train.js [h1 h2 epochs l2 nets]
const fs = require('fs');
const path = require('path');
const { NN } = require('./nn');
const IMPORTANCE = require('./lib/importance');

const ROOT = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dataset.json'), 'utf8'));
const training = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'training.json'), 'utf8'));
const args = process.argv.slice(2);
const [h1, h2, epochs, l2, nNets] = [+(args[0] || 24), +(args[1] || 12), +(args[2] || 12), +(args[3] || 1e-4), +(args[4] || 5)];
const OPTS = { h1, h2, epochs, l2, lr: 0.002, batch: 128 };
const ll = (p, y) => -(y ? Math.log(Math.max(p, 1e-12)) : Math.log(Math.max(1 - p, 1e-12)));
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';

// ---- Inputs ----
// Game importance (build/lib/importance.js; chosen by build/tune-importance.js, uniform until something beats it).
const imp = IMPORTANCE.current(), cal = IMPORTANCE.caliberEM(data);
const trainX = [], trainY = [], trainW = [];
for (const [key, a, b, loc, y] of training.rows) {
  const s = training.snapshots[key];
  trainX.push(NN.diff(s[a], s[b], loc)); trainY.push(y); trainW.push(IMPORTANCE.weight(imp.imp, key, s[a], s[b], loc, cal));
}
console.log(`game importance: ${imp.name}`);
const scale = NN.fitScale(trainX);
const scaleX = (x) => { const o = new Float64Array(x.length); for (let j = 0; j < x.length; j++) o[j] = x[j] / scale[j]; return o; };
const X = trainX.map(scaleX);

// Hold out 10% of training games (not tournament games) to watch for overfitting.
const r = NN.rng(42);
const isVal = X.map(() => r() < 0.1);
const fitX = X.filter((_, i) => !isVal[i]), fitY = trainY.filter((_, i) => !isVal[i]), fitW = IMPORTANCE.normalize(trainW.filter((_, i) => !isVal[i]));
const valX = X.filter((_, i) => isVal[i]), valY = trainY.filter((_, i) => isVal[i]);

const tour = data.games.map(gm => {
  const A = data.teams[gm.year][gm.a], B = data.teams[gm.year][gm.b];
  return { gm, raw: NN.diff(A, B, 0), x: scaleX(NN.diff(A, B, 0)), y: gm.sa > gm.sb ? 1 : 0, seedDiff: A.seed - B.seed };
});
console.log(`training games ${X.length} (fit ${fitX.length}, val ${valX.length}), tournament test games ${tour.length}`);

// ---- Neural network ensemble ----
const nets = [], curves = [];
for (let s = 0; s < nNets; s++) {
  const curve = [];
  for (const step of NN.trainSteps(fitX, fitY, { ...OPTS, seed: 1000 + s * 31, weights: fitW })) {
    const v = valX.reduce((acc, x, i) => acc + ll(NN.sigmoid(NN.logit(step.net, x)), valY[i]), 0) / valX.length;
    const tl = tour.reduce((acc, t) => acc + ll(NN.sigmoid(NN.logit(step.net, t.x)), t.y), 0) / tour.length;
    curve.push({ epoch: step.epoch, train: +step.loss.toFixed(4), val: +v.toFixed(4) });
    if (s === 0) console.log(`  net ${s} epoch ${step.epoch}: train ${step.loss.toFixed(4)} val ${v.toFixed(4)} (tourney ${tl.toFixed(4)}) ${secs()}`);
    if (step.epoch === OPTS.epochs) nets.push(step.net);
  }
  curves.push(curve);
  console.log(`net ${s} done ${secs()}`);
}
const model = { scale, nets };
const nnProb = (x) => NN.sigmoid(nets.reduce((s, n) => s + NN.logit(n, x), 0) / nets.length);

// ---- Baselines, fit on the same training games ----
// Linear logistic regression (no intercept, so it is symmetric too), fit by Newton's method.
function fitLogistic(xs, ys, cols) {
  const k = cols.length, w = new Array(k).fill(0);
  for (let it = 0; it < 12; it++) {
    const g = new Array(k).fill(0), H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < xs.length; i++) {
      let z = 0; for (let a = 0; a < k; a++) z += w[a] * xs[i][cols[a]];
      const p = NN.sigmoid(z), q = p * (1 - p);
      for (let a = 0; a < k; a++) {
        g[a] += (p - ys[i]) * xs[i][cols[a]];
        for (let b = 0; b < k; b++) H[a][b] += q * xs[i][cols[a]] * xs[i][cols[b]];
      }
    }
    for (let a = 0; a < k; a++) H[a][a] += 1e-6 * xs.length;
    // Solve H d = g by Gaussian elimination.
    const M = H.map((row, a) => [...row, g[a]]);
    for (let c = 0; c < k; c++) {
      let piv = c; for (let rr = c + 1; rr < k; rr++) if (Math.abs(M[rr][c]) > Math.abs(M[piv][c])) piv = rr;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let rr = 0; rr < k; rr++) if (rr !== c) { const f = M[rr][c] / M[c][c]; for (let cc = c; cc <= k; cc++) M[rr][cc] -= f * M[c][cc]; }
    }
    for (let a = 0; a < k; a++) w[a] -= M[a][k] / M[a][a];
  }
  return (x) => { let z = 0; for (let a = 0; a < k; a++) z += w[a] * x[cols[a]]; return NN.sigmoid(z); };
}
const iEM = NN.FEATURES.findIndex(f => f[0] === 'adjEM'), iLoc = NN.FEATURES.length;
const emProb = fitLogistic(fitX, fitY, [iEM, iLoc]);
const linProb = fitLogistic(fitX, fitY, Array.from({ length: NN.INPUTS }, (_, j) => j));
console.log(`baselines fit ${secs()}`);

// ---- Evaluation on tournament games ----
const models = { nn: (t) => nnProb(t.x), linear: (t) => linProb(t.x), em: (t) => emProb(t.x) };
const blank = () => ({ n: 0, chalk: 0, ...Object.fromEntries(Object.keys(models).map(k => [k, { acc: 0, ll: 0, brier: 0 }])) });
const byYear = {}, byRound = {}, total = blank();
const preds = [];
for (const t of tour) {
  const y = t.gm.year, rd = t.gm.round;
  byYear[y] = byYear[y] || blank(); byRound[rd] = byRound[rd] || blank();
  // Better seed wins; equal seeds (First Four, Final Four) go to the higher efficiency margin.
  const chalkPick = t.seedDiff !== 0 ? (t.seedDiff < 0 ? 1 : 0) : (t.raw[iEM] > 0 ? 1 : 0);
  const p = {};
  for (const [k, f] of Object.entries(models)) p[k] = f(t);
  for (const agg of [byYear[y], byRound[rd], total]) {
    agg.n++; agg.chalk += chalkPick === t.y ? 1 : 0;
    for (const k of Object.keys(models)) {
      agg[k].acc += (p[k] > 0.5 ? 1 : 0) === t.y ? 1 : 0; agg[k].ll += ll(p[k], t.y); agg[k].brier += (p[k] - t.y) ** 2;
    }
  }
  preds.push({ t, p: p.nn });
}
const fin = (a) => ({ n: a.n, chalkAcc: a.chalk / a.n,
  ...Object.fromEntries(Object.keys(models).map(k => [k, { acc: a[k].acc / a.n, logloss: a[k].ll / a.n, brier: a[k].brier / a.n }])) });
const summary = fin(total);
const fmt = (a) => `NN ${(a.nn.acc * 100).toFixed(1)}%/${a.nn.logloss.toFixed(3)}  linear ${(a.linear.acc * 100).toFixed(1)}%/${a.linear.logloss.toFixed(3)}  ` +
  `AdjEM ${(a.em.acc * 100).toFixed(1)}%/${a.em.logloss.toFixed(3)}  seeds ${(a.chalkAcc * 100).toFixed(1)}%`;
for (const y of Object.keys(byYear)) console.log(`${y} (${byYear[y].n}): ${fmt(fin(byYear[y]))}`);
for (const rd of Object.keys(byRound)) console.log(`round ${rd} (${byRound[rd].n}): ${fmt(fin(byRound[rd]))}`);
console.log(`OVERALL (${summary.n}): ${fmt(summary)}`);

// Permutation importance on tournament games: rise in log loss when one input is scrambled across games.
const pr = NN.rng(5);
const baseLL = summary.nn.logloss;
const labels = [...NN.FEATURES, ['loc', 'Home court']];
const importance = labels.slice(0, NN.FEATURES.length).map(([key, label], j) => {
  let s = 0;
  const reps = 3;
  for (let rep = 0; rep < reps; rep++) {
    const col = tour.map(t => t.x[j]);
    for (let i = col.length - 1; i > 0; i--) { const k = Math.floor(pr() * (i + 1)); [col[i], col[k]] = [col[k], col[i]]; }
    tour.forEach((t, i) => { const x = Float64Array.from(t.x); x[j] = col[i]; s += ll(nnProb(x), t.y); });
  }
  return { key, label, delta: s / (tour.length * reps) - baseLL };
}).sort((a, b) => b.delta - a.delta);
console.log('IMPORTANCE', importance.map(f => `${f.key} ${f.delta.toFixed(4)}`).join(', '));

// Calibration: favorite's predicted chance vs. how often the favorite actually won.
const edges = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
const calibration = edges.slice(0, -1).map((lo, i) => {
  const inB = preds.filter(q => { const pf = Math.max(q.p, 1 - q.p); return pf >= lo && pf < edges[i + 1]; });
  return { lo, hi: Math.min(edges[i + 1], 1), n: inB.length,
    predicted: inB.reduce((s, q) => s + Math.max(q.p, 1 - q.p), 0) / inB.length,
    actual: inB.reduce((s, q) => s + ((q.p >= 0.5 ? q.t.y : 1 - q.t.y)), 0) / inB.length };
});
console.log('CALIBRATION', calibration.map(b => `${b.lo}: n=${b.n} pred ${(b.predicted * 100).toFixed(1)} act ${(b.actual * 100).toFixed(1)}`).join(' | '));

const round = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' ? +v.toPrecision(5) : v)));
const out = {
  opts: { ...OPTS, nets: nNets, importance: imp.name, trainingGames: X.length, seasons: data.years.length },
  features: NN.FEATURES,
  model: { scale: scale.map(v => +v.toPrecision(6)), nets: nets.map(n => NN.toJSON(n)) },
  eval: round({ summary, byYear: Object.fromEntries(Object.entries(byYear).map(([k, v]) => [k, fin(v)])),
    byRound: Object.fromEntries(Object.entries(byRound).map(([k, v]) => [k, fin(v)])), importance, calibration, curve: curves[0] }),
};
fs.writeFileSync(path.join(ROOT, 'data', 'model.json'), JSON.stringify(out));
console.log('wrote data/model.json', (JSON.stringify(out).length / 1024).toFixed(0) + 'KB', secs());
