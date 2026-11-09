const test = require('node:test');
const assert = require('node:assert');
const { kBest, bruteForce, gamesOf } = require('../build/lib/bracket');
const { NN } = require('../build/nn');

// 8 slots, one of them a play-in, with arbitrary but consistent pairwise probabilities.
const leaves = [['A'], ['B'], ['C'], ['D1', 'D2'], ['E'], ['F'], ['G'], ['H']];
const r = NN.rng(9);
const strength = Object.fromEntries(['A', 'B', 'C', 'D1', 'D2', 'E', 'F', 'G', 'H'].map(t => [t, r() * 3]));
const P = (a, b) => NN.sigmoid(strength[a] - strength[b]);

test('k-best equals the top of an exhaustive enumeration', () => {
  const all = bruteForce(leaves, P);
  assert.ok(Math.abs(all.reduce((s, b) => s + b.p, 0) - 1) < 1e-9, 'all outcomes sum to 1');
  const best = kBest(leaves, P, 12);
  best.forEach((b, i) => {
    assert.ok(Math.abs(b.p - all[i].p) < 1e-12, `rank ${i + 1}`);
    assert.deepStrictEqual(b.picks, all[i].picks);
  });
});

test('brackets are distinct, sorted, and each probability matches its games', () => {
  const best = kBest(leaves, P, 20);
  const keys = new Set(best.map(b => JSON.stringify(b.picks)));
  assert.strictEqual(keys.size, best.length);
  for (let i = 1; i < best.length; i++) assert.ok(best[i].p <= best[i - 1].p);
  for (const b of best) {
    const prod = gamesOf(leaves, b.picks, P).reduce((s, g) => s * g.p, 1);
    assert.ok(Math.abs(prod - b.p) < 1e-12);
  }
});
