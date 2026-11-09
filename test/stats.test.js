// Statistical tools: scoring, bootstrap, model choice, ridge, importance weights, the network's base offset.
const test = require('node:test');
const assert = require('node:assert');
const { NN } = require('../build/nn');
const M = require('../build/lib/metrics');

test('season bootstrap: no difference is ~0, a real difference is confident', () => {
  const r = NN.rng(1), same = {}, better = {};
  for (let y = 0; y < 15; y++) {
    same[y] = []; better[y] = [];
    for (let i = 0; i < 60; i++) { const l = r(); same[y].push({ x: l, y: l }); better[y].push({ x: l, y: l + 0.05 + 0.01 * (r() - 0.5) }); }
  }
  const s = M.pairedBootstrap(same), b = M.pairedBootstrap(better);
  assert.strictEqual(s.mean, 0); assert.strictEqual(s.se, 0);
  assert.ok(b.mean < -0.04 && b.pBetter === 1 && b.hi90 < 0);
});

test('one-SE rule prefers the simpler model when the gap is noise', () => {
  const r = NN.rng(2), simple = {}, fancy = {};
  for (let y = 0; y < 15; y++) { simple[y] = []; fancy[y] = []; for (let i = 0; i < 60; i++) { const l = 0.55 + 0.3 * (r() - 0.5); simple[y].push(l); fancy[y].push(l - 0.0005 + 0.2 * (r() - 0.5)); } }
  const out = M.oneSERule([{ name: 'simple', complexity: 0, losses: simple }, { name: 'fancy', complexity: 5, losses: fancy }]);
  assert.strictEqual(out.chosen, 'simple');
});

test('logistic regression recovers coefficients, and a huge penalty returns the prior', () => {
  const r = NN.rng(3), xs = [], ys = [];
  for (let i = 0; i < 4000; i++) { const x = [r() * 2 - 1, r() * 2 - 1]; xs.push(x); ys.push(r() < NN.sigmoid(1.5 * x[0] - 0.7 * x[1]) ? 1 : 0); }
  const w = M.fitLogistic(xs, ys, { l2: 1e-6 });
  assert.ok(Math.abs(w[0] - 1.5) < 0.2 && Math.abs(w[1] + 0.7) < 0.2, w.join(','));
  const shrunk = M.fitLogistic(xs, ys, { l2: 1e4, prior: [1, 0] });
  assert.ok(Math.abs(shrunk[0] - 1) < 0.01 && Math.abs(shrunk[1]) < 0.01, shrunk.join(','));
});

test('ridge stage B picks its penalty by leave-one-season-out', () => {
  const { fitRidge } = require('../build/walkforward');
  const r = NN.rng(4), X = [], ys = [], years = [];
  for (let i = 0; i < 1200; i++) { const x = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]; X.push(x); years.push(2008 + (i % 12)); ys.push(r() < NN.sigmoid(x[0] + 0.4 * x[1]) ? 1 : 0); }
  const fit = fitRidge(X, ys, years, [1, 1, 1]);
  assert.ok(Number.isFinite(fit.cv) && fit.w.length === 3);
  assert.ok(Math.abs(fit.w[2]) < Math.abs(fit.w[1]), 'the pure-noise input gets the smallest weight');
});

test('calibration error is small for calibrated forecasts and large for overconfident ones', () => {
  const r = NN.rng(5), good = [], bad = [];
  for (let i = 0; i < 5000; i++) { const p = r(); const y = r() < p ? 1 : 0; good.push({ p, y }); bad.push({ p: p > 0.5 ? 0.99 : 0.01, y }); }
  assert.ok(M.reliability(good).ece < 0.03);
  assert.ok(M.reliability(bad).ece > 0.15);
});

test('game importance: uniform is 1, tournament-like games count more, weights average 1', () => {
  const I = require('../build/lib/importance');
  const good = { adjEM: 20 }, weak = { adjEM: -10 };
  assert.strictEqual(I.weight(null, '2020-1', good, good, 0, 5), 1);
  const imp = I.PRESETS.all;
  assert.ok(I.weight(imp, '2020-5', good, good, 0, 5) > I.weight(imp, '2020-1', good, weak, 1, 5));
  assert.ok(I.weight(imp, '2020-pre', weak, weak, 1, 5) > I.weight(imp, '2020-0', weak, weak, 1, 5), 'postseason counts as late');
  const n = I.normalize([1, 2, 3, 6]);
  assert.ok(Math.abs(n.reduce((s, v) => s + v, 0) / n.length - 1) < 1e-12);
});

test('with an offset, an untrained correction leaves the base model unchanged and stays symmetric', () => {
  const net = NN.initNet(3, 4, 2, 1, 3);
  net.w.fill(0); net.offset = 0;
  const x = Float64Array.from([0.8, 0.3, -0.2]), nx = Float64Array.from([-0.8, -0.3, 0.2]);
  assert.strictEqual(NN.logit(net, x), 0.8);
  const trained = NN.train([x, nx], [1, 0], { h1: 4, h2: 2, epochs: 5, na: 3, offset: 0, seed: 2 });
  assert.ok(Math.abs(NN.logit(trained, x) + NN.logit(trained, nx)) < 1e-12);
  assert.strictEqual(NN.fromJSON(NN.toJSON(trained)).offset, 0);
});

test('boosted trees learn a real pattern, leave noise alone, and stay symmetric', () => {
  const GBM = require('../build/lib/gbm');
  const r = NN.rng(3);
  const mk = (n, s) => { const X = [], y = [], z = []; for (let i = 0; i < n; i++) { const x = [r() * 2 - 1, r() * 2 - 1]; X.push(x); z.push(0); y.push(r() < NN.sigmoid(s * (x[0] > 0.3 ? 1.5 : x[0] < -0.3 ? -1.5 : 0)) ? 1 : 0); } return { X, y, z }; };
  const a = mk(1200, 1), av = mk(1200, 1), fa = GBM.fit(a.X, a.y, a.z, { trees: 120 }, av);
  assert.ok(Math.min(...fa.valLoss) < fa.valLoss[0] - 0.05);
  const b = mk(1200, 0), bv = mk(1200, 0), fb = GBM.fit(b.X, b.y, b.z, { trees: 120 }, bv);
  assert.ok(Math.min(...fb.valLoss) > fb.valLoss[0] - 0.005, 'no real gain on pure noise');
  const x = [0.4, -0.1];
  assert.ok(Math.abs(GBM.predict(fa.model, x, 0.2) + GBM.predict(fa.model, x.map(v => -v), -0.2) - 1) < 1e-12);
});
