// Inlines nn.js, the tournament data and the trained model into site/index.html (the published page),
// site/preview.html (the same page with a full HTML skeleton, for opening locally) and public/index.html (the static site).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dataset.json'), 'utf8'));
const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'model.json'), 'utf8'));
const { NN } = require('./nn');

const keep = ['seed', 'region', 'w', 'l', ...NN.FEATURES.map(f => f[0])];
const teams = {};
for (const [y, T] of Object.entries(data.teams)) {
  teams[y] = {};
  for (const [n, t] of Object.entries(T)) {
    teams[y][n] = {};
    for (const k of keep) teams[y][n][k] = typeof t[k] === 'number' ? +t[k].toPrecision(5) : t[k];
  }
}
const games = {};
for (const g of data.games) (games[g.year] = games[g.year] || []).push([g.round, g.a, g.b, g.sa, g.sb]);

// The adopted model (linear on point margin) and the walk-forward findings, when a training run has produced them.
const read = (f) => (fs.existsSync(path.join(ROOT, f)) ? JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')) : null);
const saved = read('data/model-stageB.json'), wf = read('data/walkforward-report.json'), ex = read('data/game-explanations.json');
const r4 = (v) => +v.toPrecision(4);
const margin = saved && saved.marginA ? { w: saved.marginA.w.map(r4), sigma: r4(saved.marginA.sigma), scale: saved.marginA.scale.map(r4) } : null;
let findings = null;
if (wf && wf.models) {
  const ups = ex ? ex.games.filter(g => g.upset) : [], wins = ex ? ex.games.filter(g => !g.upset) : [];
  const share = (list, k) => (list.length ? list.filter(g => g.decided === k).length / list.length : 0);
  findings = {
    adopted: wf.adopted, games: Object.values(wf.years).reduce((s, v) => s + v.n, 0),
    years: [Math.min(...Object.keys(wf.years).map(Number)), Math.max(...Object.keys(wf.years).map(Number))],
    models: Object.fromEntries(Object.entries(wf.models).map(([k, v]) => [k, { logLoss: r4(v.logLoss), brier: r4(v.brier), accuracy: r4(v.accuracy), ece: r4(v.ece) }])),
    tiers: ex ? ex.tiers.map(t => ({ label: t.label, n: t.n, predicted: r4(t.predicted), actual: r4(t.actual) })) : [],
    auc: ex ? r4(ex.auc) : null,
    decided: ['threes', 'shooting', 'turnovers', 'rebounding', 'free_throws'].map(k => [k, r4(share(ups, k)), r4(share(wins, k))]),
    hotThrees: ups.length ? r4(ups.filter(g => g.luck >= 6).length / ups.length) : null,
    luckOverMargin: ups.length ? r4(ups.filter(g => g.luck > g.margin).length / ups.length) : null,
  };
}
const payload = { teams, games, brackets: data.brackets, model: model.model, eval: model.eval, opts: model.opts, features: model.features, margin, findings };
const json = JSON.stringify(payload).replace(/</g, '\\u003c');
const nn = fs.readFileSync(path.join(__dirname, 'nn.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'site', 'template.html'), 'utf8')
  .replace('/*__NN__*/', () => nn).replace('/*__DATA__*/', () => json);
fs.writeFileSync(path.join(ROOT, 'site', 'index.html'), page);
fs.writeFileSync(path.join(ROOT, 'site', 'preview.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
  '<style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + page + '</body></html>');
// The same full page as the static site Vercel serves (public/index.html).
fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'site', 'preview.html'), path.join(ROOT, 'public', 'index.html'));
console.log(`site/index.html ${(page.length / 1024).toFixed(0)}KB`);
