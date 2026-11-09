// Game context, coaches, interactions, redundancy-aware screening.
const test = require('node:test');
const assert = require('node:assert');
const { read, needs } = require('./helpers');
const { NN } = require('../build/nn');

test('air pressure and time-zone helpers', () => {
  const { stdPressure, offsetOf } = require('../build/ingest/gamesite');
  assert.ok(Math.abs(stdPressure(0) - 1013.25) < 1e-9);
  assert.ok(stdPressure(1600) < 850 && stdPressure(1600) > 820, 'Denver is about 835 hPa');
  assert.strictEqual(offsetOf('Eastern', 1), -4);
  assert.strictEqual(offsetOf('Pacific', 1), -7);
  assert.strictEqual(offsetOf('Mountain', 0), -7, 'Arizona keeps standard time');
});

test('game context values are in sane ranges', needs('data/features-gamectx.json'), () => {
  const f = read('data/features-gamectx.json');
  for (const G of Object.values(f.games)) for (const v of Object.values(G)) {
    if (v.gm_body_hour != null) assert.ok(v.gm_body_hour >= 0 && v.gm_body_hour < 24);
    if (v.gm_elev_gain != null) assert.ok(Math.abs(v.gm_elev_gain) < 3);
    assert.ok([0, 1].includes(v.gm_designated_home));
    assert.ok(v.gm_h2h_wins >= 0 && v.gm_h2h_wins <= 3);
  }
});

test('coach records come from before the season', needs('data/features-coach.json'), () => {
  const c = read('data/features-coach.json');
  // Dan Hurley won the 2023 title: it counts for 2024, not for 2023 itself.
  assert.strictEqual(c.teams[2023].Connecticut.coach_champ_prior, 0);
  assert.strictEqual(c.teams[2024].Connecticut.coach_champ_prior, 1);
  // A coach's first tournament has no tournament residual yet.
  for (const T of Object.values(c.teams)) for (const v of Object.values(T)) if (v.coach_first_ncaa === 1) assert.strictEqual(v.coach_tourney_resid, 0);
});

test('variance interactions flip sign when the teams swap', needs('data/dataset.json', 'data/features-kaggle.json'), () => {
  const wf = require('../build/walkforward');
  const d = read('data/dataset.json'), k = require('../build/lib/features').loadFeatures(), ctx = { dataset: d, kaggle: k };
  const g = d.games.find(x => x.year === 2023 && x.round === 1);
  const sw = { ...g, a: g.b, b: g.a, sa: g.sb, sb: g.sa };
  const r1 = wf.stageBRow(g, ctx, wf.VARIANCE_COLUMNS, 0.8), r2 = wf.stageBRow(sw, ctx, wf.VARIANCE_COLUMNS, -0.8);
  for (let j = 1; j <= wf.VARIANCE_COLUMNS.length; j++) assert.ok(Math.abs(r1.x[j] + r2.x[j]) < 1e-12);
  assert.ok(r1.present.every(p => p === 1), 'an interaction of zero is a real value, not missing');
});

test('screening keeps one input per idea', () => {
  const wf = require('../build/walkforward');
  const r = NN.rng(9), rows = [];
  for (let i = 0; i < 1500; i++) {
    const s = r() * 2 - 1, noise = r() * 2 - 1;
    rows.push({ raw: [s, s + 0.01 * (r() - 0.5), noise], present: [1, 1, 1], pA: 0.5, y: r() < 0.5 + 0.35 * s ? 1 : 0, year: 2008 + (i % 16) });
  }
  const picked = wf.selectFeatures(rows, ['signal', 'signal_copy', 'noise'], 3);
  assert.strictEqual(picked.length, 1);
  assert.ok(['signal', 'signal_copy'].includes(picked[0]));
});

test('upset tiers cover every game and rank risk better than chance', needs('data/game-explanations.json'), () => {
  const e = read('data/game-explanations.json');
  assert.strictEqual(e.tiers.reduce((s, t) => s + t.n, 0), e.games.length);
  assert.ok(e.auc > 0.6);
  for (const g of e.games) assert.ok(['threes', 'shooting', 'turnovers', 'rebounding', 'free_throws'].includes(g.decided));
});

test('home-court edges: altitude programs get bigger edges, everyone else stays near the league edge', needs('data/dataset.json', 'sources/campus-elevation.json'), () => {
  const d = read('data/dataset.json');
  const T = d.teams[2024], all = Object.values(T).map(t => t.hca), mean = all.reduce((s, v) => s + v, 0) / all.length;
  for (const t of ['Colorado', 'New Mexico', 'Colorado St.', 'BYU', 'Utah St.']) assert.ok(T[t].hca > mean, `${t} ${T[t].hca} vs ${mean}`);
  const sd = Math.sqrt(all.reduce((s, v) => s + (v - mean) ** 2, 0) / all.length);
  assert.ok(sd < 0.3, 'edges are shrunk hard toward the prior: venue differences beyond altitude are mostly noise');
});
