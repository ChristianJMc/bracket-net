const test = require('node:test');
const assert = require('node:assert');
const { NN } = require('../build/nn');

const randX = (r, n) => Float64Array.from({ length: n }, () => r() * 2 - 1);

test('P(A beats B) + P(B beats A) = 1 for any weights', () => {
  const r = NN.rng(1);
  const net = NN.initNet(NN.INPUTS, 8, 4, 3);
  for (let i = 0; i < 50; i++) {
    const x = randX(r, NN.INPUTS);
    const flipped = Float64Array.from(x, (v, j) => (j < NN.ANTI ? -v : v)); // context inputs stay put
    const p = NN.sigmoid(NN.logit(net, x)), q = NN.sigmoid(NN.logit(net, flipped));
    assert.ok(Math.abs(p + q - 1) < 1e-12);
  }
});

test('training moves every weight against its numerical gradient', () => {
  const r = NN.rng(3);
  const x = randX(r, NN.INPUTS);
  const net = NN.initNet(NN.INPUTS, 5, 4, 11);
  const loss = (n) => -Math.log(NN.sigmoid(NN.logit(n, x)));
  const after = NN.trainSteps([x], [1], { h1: 5, h2: 4, epochs: 1, lr: 1e-6, l2: 0, batch: 1, seed: 11 }).next().value.net;
  const base = loss(net);
  for (let i = 0; i < net.w.length; i++) {
    const n2 = { ...net, w: Float64Array.from(net.w) }; n2.w[i] += 1e-6;
    const g = (loss(n2) - base) / 1e-6;
    if (Math.abs(g) > 1e-5) assert.strictEqual(Math.sign(after.w[i] - net.w[i]), -Math.sign(g), `weight ${i}`);
  }
});

test('learns a rule and generalizes to unseen games instead of memorizing', () => {
  // Synthetic: the team with the bigger first stat wins 85% of the time; the other inputs are noise.
  const r = NN.rng(7);
  const make = (n) => {
    const xs = [], ys = [];
    for (let i = 0; i < n; i++) {
      const x = randX(r, 6); xs.push(x);
      ys.push((x[0] > 0) === (r() < 0.85) ? 1 : 0);
    }
    return { xs, ys };
  };
  const tr = make(2000), te = make(2000);
  const net = NN.train(tr.xs, tr.ys, { h1: 8, h2: 4, epochs: 15, lr: 0.01, l2: 1e-4, batch: 32, seed: 1, na: 6 });
  const acc = (d) => d.xs.filter((x, i) => (NN.sigmoid(NN.logit(net, x)) > 0.5) === (d.ys[i] === 1)).length / d.xs.length;
  const a = acc(te);
  assert.ok(a > 0.8, `held-out accuracy ${a}`);
  assert.ok(acc(tr) - a < 0.05, 'train/test gap suggests memorization');
});

test('model JSON round-trips', () => {
  const net = NN.initNet(NN.INPUTS, 4, 3, 5, 10);
  const back = NN.fromJSON(JSON.parse(JSON.stringify(NN.toJSON(net, 17))));
  const x = randX(NN.rng(2), NN.INPUTS);
  assert.ok(Math.abs(NN.logit(net, x) - NN.logit(back, x)) < 1e-9);
  assert.strictEqual(back.na, 10);
});
