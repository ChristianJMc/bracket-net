// Provenance tags, opinion wariness, and no-lookahead rules for the newer inputs.
const test = require('node:test');
const assert = require('node:assert');
const { read, needs } = require('./helpers');
const { NN } = require('../build/nn');

const KINDS = new Set(['stat', 'rating', 'projection', 'hybrid', 'opinion']);

test('every Kaggle column says where it comes from', needs('data/features-kaggle.json'), () => {
  const k = read('data/features-kaggle.json');
  const bad = Object.entries(k.columns).filter(([, v]) => !KINDS.has(v.kind)).map(([c]) => c);
  assert.deepStrictEqual(bad, []);
  const kind = (c) => k.columns[c].kind;
  assert.strictEqual(kind('ap_preseason_rank'), 'opinion');
  assert.strictEqual(kind('hc_cinderella'), 'opinion');
  assert.strictEqual(kind('kb_talent'), 'hybrid');       // recruiting rankings: scouts' judgment
  assert.strictEqual(kind('kb_kadj_em'), 'rating');
  assert.strictEqual(kind('kb_exp'), 'stat');
  assert.strictEqual(kind('kpre_preseason_kadj_em'), 'projection');
  assert.strictEqual(kind('res_q1_w'), 'stat');
});

test('our own columns are tagged too, and seeds count as human judgment', () => {
  const { kindOfColumn } = require('../build/walkforward');
  assert.strictEqual(kindOfColumn('seed', { columns: {} }), 'hybrid');
  assert.strictEqual(kindOfColumn('mo_streaky', { columns: {} }), 'stat');
  assert.strictEqual(kindOfColumn('run_margin', { columns: {} }), 'stat');
});

test('a heavier penalty makes the net lean less on an input that carries real signal', () => {
  const r = NN.rng(3), xs = [], ys = [];
  for (let i = 0; i < 1500; i++) { const x = Float64Array.from({ length: 2 }, () => r() * 2 - 1); xs.push(x); ys.push(r() < NN.sigmoid(2 * x[0] + 2 * x[1]) ? 1 : 0); }
  const opts = { h1: 4, h2: 3, epochs: 20, lr: 0.01, l2: 0.01, batch: 32, seed: 1, na: 2 };
  const plain = NN.train(xs, ys, opts), wary = NN.train(xs, ys, { ...opts, l2Input: Float64Array.from([1, 25]) });
  const weightOn = (net, k) => { let s = 0; for (let i = 0; i < net.h1; i++) s += Math.abs(net.w[i * net.n + k]); return s; };
  assert.ok(weightOn(wary, 1) < 0.5 * weightOn(plain, 1), 'penalized input should get much smaller weights');
  assert.ok(weightOn(wary, 0) > 0.5 * weightOn(plain, 0), 'the other input should be unaffected');
});

test('excluding a kind removes every column of that kind', needs('data/features-kaggle.json', 'data/dataset.json'), () => {
  const wf = require('../build/walkforward');
  const k = read('data/features-kaggle.json'), d = read('data/dataset.json');
  wf.CONFIG.stageB.excludeKinds = ['opinion'];
  try {
    const cols = wf.columnsFor(k, wf.CONFIG.groups, d);
    assert.deepStrictEqual(cols.filter(c => wf.kindOfColumn(c, k) === 'opinion'), []);
    assert.ok(cols.length > 300);
  } finally { wf.CONFIG.stageB.excludeKinds = []; }
});

test('tournament-run stats only use earlier games', needs('data/dataset.json'), () => {
  const { makeHistory } = require('../build/lib/tourney-history');
  const d = read('data/dataset.json');
  const h = makeHistory(d, () => 0.5);
  // 2024 Connecticut won six games; before its round-of-64 game it has no run, before the final it has five wins.
  assert.strictEqual(h(2024, 1, 'Connecticut').run_wins, 0);
  assert.strictEqual(h(2024, 6, 'Connecticut').run_wins, 5);
  assert.strictEqual(h(2024, 1, 'Connecticut').prog_wins5, h(2024, 6, 'Connecticut').prog_wins5, 'program history must not include this year');
  // Flipping the result of the 2024 final must not change anything known before it.
  const flipped = { ...d, games: d.games.map(g => (g.year === 2024 && g.round === 6 ? { ...g, sa: g.sb, sb: g.sa } : g)) };
  assert.deepStrictEqual(makeHistory(flipped, () => 0.5)(2024, 6, 'Connecticut'), h(2024, 6, 'Connecticut'));
});

test('spark stats exist for every tournament team', needs('data/dataset.json'), () => {
  const d = read('data/dataset.json');
  for (const [y, T] of Object.entries(d.teams)) for (const [n, t] of Object.entries(T)) {
    for (const k of ['mo_ceiling', 'mo_floor', 'mo_streaky', 'mo_slope', 'mo_last5', 'mo_tp_sd', 'mo_conf_tourney_w'])
      assert.ok(Number.isFinite(t[k]), `${y} ${n} ${k}`);
    assert.ok(t.mo_ceiling >= t.mo_floor);
  }
});

test('single-matchup prediction sees only what came before the game', needs('data/dataset.json', 'data/model.json', 'data/features-kaggle.json'), () => {
  const { predictMatchup } = require('../build/predict');
  const r = predictMatchup({ year: 2024, a: 'N.C. State', b: 'Duke', round: 4 });
  assert.ok(r.p > 0 && r.p < 1);
  assert.strictEqual(r.ha.run_wins, 3); // N.C. State's first three wins, not the Elite 8 or Final Four
  assert.ok(r.watch.near.every(n => n.r.year < 2024));
});

test('travel and rest are screened candidates, not fixed inputs', needs('data/dataset.json', 'data/features-kaggle.json'), () => {
  const wf = require('../build/walkforward');
  const d = read('data/dataset.json'), k = require('../build/lib/features').loadFeatures();
  const cols = wf.columnsFor(k, wf.CONFIG.groups, d);
  for (const c of wf.GAME_COLUMNS) assert.ok(cols.includes(c), c);
  const ctx = { dataset: d, kaggle: k };
  const g = d.games.find(x => x.year === 2024 && x.round === 2);
  // With no columns chosen, the row is stage A's logit plus the power-conference slice context only.
  assert.strictEqual(wf.stageBRow(g, ctx, [], 0).na, 2);
  // When chosen, rest is days since each team's previous game (capped at 10), A minus B.
  const r = wf.stageBRow(g, ctx, ['g_rest'], 0);
  assert.strictEqual(r.na, 3);
  assert.ok(Math.abs(r.x[1]) <= 10);
});
