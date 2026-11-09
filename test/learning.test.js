// The pattern finders must find planted signal and ignore noise.
const test = require('node:test');
const assert = require('node:assert');
const { NN } = require('../build/nn');
const { signatures, segmented } = require('../build/review');
const { levels } = require('../build/lib/segments');
const { selectFeatures } = require('../build/walkforward');

function synthetic(n, seed) {
  const r = NN.rng(seed), rows = [];
  for (let i = 0; i < n; i++) {
    const pFav = 0.55 + r() * 0.4, real = r() * 2 - 1, noise = r() * 2 - 1;
    // Underdogs with a higher "real" value win more often than the model's pFav says.
    const pDog = Math.min(0.95, Math.max(0.02, (1 - pFav) + 0.2 * real));
    rows.push({ year: 2008 + (i % 18), pFav, miss: r() < pDog, dogStats: { real, noise }, favStats: { real: 0, noise: 0 } });
  }
  return rows;
}

test('miss review flags a planted signal and not noise', () => {
  const sig = signatures(synthetic(3000, 4), ['real', 'noise']).list;
  assert.ok(sig.find(s => s.col === 'real').replicates);
  assert.ok(!sig.find(s => s.col === 'noise').replicates);
});

test('chance baseline stays near zero on pure noise', () => {
  const r = NN.rng(11);
  const rows = Array.from({ length: 1500 }, (_, i) => {
    const dogStats = {}, favStats = {};
    for (let k = 0; k < 40; k++) { dogStats['n' + k] = r(); favStats['n' + k] = 0; }
    const pFav = 0.55 + r() * 0.4;
    return { year: 2008 + (i % 18), pFav, miss: r() < 1 - pFav, dogStats, favStats };
  });
  const s = signatures(rows, Object.keys(rows[0].dogStats), { perms: 100 });
  assert.ok(s.chanceMean < 1, `chance mean ${s.chanceMean}`);
  assert.ok(s.pSlice > 0.01, 'noise should not look significant');
});

test('a pattern that lives in one slice is hidden when pooled and found when sliced', () => {
  // Underdog "grit" helps in 5v12 games and hurts elsewhere, so pooled it nearly cancels out.
  const r = NN.rng(21), rows = [];
  for (let i = 0; i < 6000; i++) {
    const in512 = i % 4 === 0, grit = r() * 2 - 1, pFav = 0.6 + r() * 0.3;
    const shift = in512 ? 0.35 * grit : -0.12 * grit;
    const row = { year: 2008 + Math.floor(r() * 18), round: 1, seedFav: in512 ? 5 : 3, seedDog: in512 ? 12 : 14, pFav, confDog: 'MVC',
      miss: r() < Math.min(0.95, Math.max(0.02, 1 - pFav + shift)), dogStats: { grit }, favStats: { grit: 0 } };
    row.segments = levels(row);
    rows.push(row);
  }
  const pooled = signatures(rows, ['grit']).list[0];
  assert.ok(!pooled.replicates, `pooled r=${pooled.effect}`);
  const seg = segmented(rows, ['grit'], { perms: 50 }).find(s => s.segment === 'seed_line' && s.level === '5v12');
  assert.strictEqual(seg.passing, 1);
});

test('walk-forward feature selection ranks the planted signal first', () => {
  const r = NN.rng(5);
  const rows = Array.from({ length: 800 }, () => {
    const raw = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1], pA = 0.5;
    return { raw, present: [1, 1, 1], pA, y: r() < 0.5 + 0.3 * raw[1] ? 1 : 0 };
  });
  assert.strictEqual(selectFeatures(rows, ['a', 'b', 'c'], 1)[0], 'b');
});

test('walk-forward --run path works end to end (one season, tiny settings, nothing saved)', require('./helpers').needs('data/dataset.json', 'data/model.json', 'data/features-kaggle.json'), () => {
  const wf = require('../build/walkforward');
  const saved = JSON.parse(JSON.stringify(wf.CONFIG.stageB));
  Object.assign(wf.CONFIG.stageB, { epochs: 3, nets: 1 });
  try {
    const { report, preds } = wf.run({ dry: false, sharedA: true, years: [2025], write: false });
    const y = report.years[2025];
    assert.strictEqual(y.n, 67);
    assert.ok(Number.isFinite(y.llA) && Number.isFinite(y.llB));
    assert.ok(report.selected[2025].length > 0);
    for (const p of Object.values(preds.stageB)) assert.ok(p > 0 && p < 1);
  } finally { Object.assign(wf.CONFIG.stageB, saved); }
});

test('upset watch only learns from seasons before the one it judges', require('./helpers').needs('data/dataset.json', 'data/model.json', 'data/features-kaggle.json'), () => {
  const { buildRows, predictions } = require('../build/review');
  const { watchYear } = require('../build/upset-watch');
  const h = require('./helpers');
  const dataset = h.read('data/dataset.json'), kaggle = h.read('data/features-kaggle.json');
  const rows = buildRows(dataset, kaggle, predictions(dataset).p).filter(r => r.year >= 2019);
  const cols = ['base_adjEM', 'ap_preseason_rank', 'kb_talent'];
  const out = watchYear(rows, 2024, cols);
  assert.strictEqual(out.length, 67);
  for (const w of out) {
    assert.ok(w.near.length === 12);
    assert.ok(w.near.every(n => n.r.year < 2024), 'a lookalike came from the judged season or later');
    assert.ok(w.adjusted > 0 && w.adjusted < 1);
  }
});
