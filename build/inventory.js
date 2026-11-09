// Every input, old and new: how verifiable it is and how much it actually matters. Writes docs/data-inventory.md.
//
// Verifiability, from most to least:
//   counted     it happened and was recorded: a rebound, a shot, a minute played, a mile travelled, a coach's record
//   calculated  a formula applied to counted stats (efficiency ratings, Elo): verifiable inputs, a modelling choice
//   forecast    a formula's guess before the season (preseason ratings)
//   judgment    people deciding with stats in hand (committee seeds, recruiting rankings, the listed home team)
//   opinion     what people think (AP votes, analysts' picks)
// Every kind gets the same chance to enter the tournament model (same screen, same bar). Once in, judgment and
// opinion carry a larger penalty, so they must show more evidence before the model leans on them. Perceptions are
// tested, not excluded, and they aren't punished when they turn out to be right.
//
// Importance comes from three measurements, all out of sample:
//   base network: how much log loss rises when one of its 26 inputs is scrambled (permutation importance)
//   misses: the strongest correlation of any of the source's columns with what the base model got wrong
//   selection: in how many walk-forward seasons the screen let any of the source's columns in
//   node build/inventory.js
const fs = require('fs');
const path = require('path');
const wf = require('./walkforward');
const { loadFeatures } = require('./lib/features');
const { makeHistory } = require('./lib/tourney-history');
const { gameKey } = require('./news/store');
const { NN } = require('./nn');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const TIER = { stat: 'counted', rating: 'calculated', projection: 'forecast', hybrid: 'judgment', opinion: 'opinion' };
const TIER_ORDER = ['counted', 'calculated', 'forecast', 'judgment', 'opinion'];

function sourceOf(c, kaggle) {
  if (c === 'seed') return 'Selection committee (seeds)';
  if (c === 'hca') return 'Our ratings: home-court edge';
  if (c.startsWith('mo_')) return 'Our game logs: spark stats';
  if (c.startsWith('run_') || c.startsWith('prog_')) return 'Our game logs: tournament runs and program history';
  if (c.startsWith('g_travel')) return 'Kaggle locations: travel';
  if (c === 'g_rest') return 'Schedule: rest before each game';
  if (c.startsWith('gx_')) return 'Variance interactions (pace, threes, rivals)';
  const m = kaggle.columns[c];
  if (!m) return 'other';
  const names = { 'features-players.json': 'ESPN player box scores', 'features-elo.json': 'Our Elo', 'features-schedule.json': 'Schedule: workload and road games',
    'features-gamectx.json': 'Game context (altitude, pressure, body clock, crowd, home listing, head-to-head)', 'features-coach.json': 'Coaches (Sports-Reference)',
    'features-derived.json': 'Engineered (home boost, neutral gap, campus elevation)' };
  if (names[m.from]) return names[m.from];
  return `Kaggle: ${m.file.replace(/\.csv$/, '')}`;
}

function main() {
  const dataset = read('data/dataset.json'), kaggle = loadFeatures();
  const report = read('data/walkforward-report.json'), P = read('data/walkforward-preds.json').models.stageA;
  const m = read('data/model.json'), model = { scale: m.model.scale, nets: m.model.nets.map(NN.fromJSON) };
  const ctx = { dataset, kaggle, history: makeHistory(dataset, (g) => NN.predict(model, dataset.teams[g.year][g.a], dataset.teams[g.year][g.b], 0)) };
  const cols = wf.columnsFor(kaggle, wf.CONFIG.groups, dataset);
  const games = dataset.games.filter(g => P[gameKey(g)] != null);
  // Correlation of each candidate's A-minus-B difference with the base model's out-of-sample misses.
  const sums = cols.map(() => ({ n: 0, x: 0, y: 0, xx: 0, yy: 0, xy: 0 }));
  for (const g of games) {
    const p = P[gameKey(g)], z = Math.log(p / (1 - p)), resid = (g.sa > g.sb ? 1 : 0) - p;
    const r = wf.stageBRow(g, ctx, cols, z);
    cols.forEach((c, j) => { if (!r.present[j]) return; const s = sums[j], v = r.x[1 + j]; s.n++; s.x += v; s.y += resid; s.xx += v * v; s.yy += resid * resid; s.xy += v * resid; });
  }
  const corr = (s) => { if (s.n < 100) return null; const cov = s.xy - s.x * s.y / s.n, vx = s.xx - s.x * s.x / s.n, vy = s.yy - s.y * s.y / s.n; return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : null; };
  const selectedIn = {};
  for (const list of Object.values(report.selected)) for (const c of new Set(list)) selectedIn[c] = (selectedIn[c] || 0) + 1;
  const seasons = Object.keys(report.selected).length;

  const bySource = {};
  cols.forEach((c, j) => {
    const src = sourceOf(c, kaggle), tier = TIER[wf.kindOfColumn(c, kaggle)] || 'counted', r = corr(sums[j]);
    const b = bySource[src] = bySource[src] || { src, cols: 0, tiers: {}, best: null, bestCol: null, selected: 0, picked: [] };
    b.cols++; b.tiers[tier] = (b.tiers[tier] || 0) + 1;
    if (r != null && (b.best == null || Math.abs(r) > Math.abs(b.best))) { b.best = r; b.bestCol = c; }
    if (selectedIn[c]) { b.selected = Math.max(b.selected, selectedIn[c]); b.picked.push(`${c} (${selectedIn[c]})`); }
  });
  const rows = Object.values(bySource).sort((a, b) => (b.selected - a.selected) || (Math.abs(b.best || 0) - Math.abs(a.best || 0)));
  const bar = 3.3 / Math.sqrt(games.length);
  const tierText = (t) => TIER_ORDER.filter(k => t[k]).map(k => `${k} ${t[k]}`).join(', ');
  const imp = (m.eval && m.eval.importance) || [];
  const tierRows = TIER_ORDER.map(t => {
    const cs = cols.filter(c => (TIER[wf.kindOfColumn(c, kaggle)] || 'counted') === t);
    const rs = cs.map(c => corr(sums[cols.indexOf(c)])).filter(r => r != null).map(Math.abs).sort((a, b) => b - a);
    return { t, n: cs.length, top: rs[0] || 0, median: rs[rs.length >> 1] || 0, sel: cs.filter(c => selectedIn[c]).length };
  });

  const md = ['# Data inventory: what is verifiable, what matters', '',
    'Every input the models can use, grouped by source, with how verifiable it is and how much it mattered **out of sample**. Generated by `node build/inventory.js` (also run by the pipeline).', '',
    '## How verifiable each kind is', '',
    '| Kind | What it is | Candidates | Strongest link to the base model\'s misses | Median | Columns ever selected |', '|---|---|---|---|---|---|',
    ...tierRows.map(r => `| ${r.t} | ${{ counted: 'It happened and was recorded (rebounds, shots, minutes, miles, records)', calculated: 'A formula applied to counted stats (efficiency ratings, Elo)', forecast: 'A formula\'s guess before the season', judgment: 'People deciding with stats in hand (seeds, recruiting rankings)', opinion: 'What people think (AP votes, analysts\' picks)' }[r.t]} | ${r.n} | ${r.top.toFixed(3)} | ${r.median.toFixed(3)} | ${r.sel} |`), '',
    'Every kind passes through the same screen with the same bar. Judgment and opinion carry a larger penalty once inside the model (2× and 4×), so they need more evidence, but they are never excluded. When an opinion is right, as AP preseason rank sometimes is, the model can still use it.', '',
    '## What the base network leans on (its 26 counted and calculated inputs)', '',
    'Rise in tournament log loss when one input is scrambled. Bigger means more important. These inputs carry most of the prediction.', '',
    '| Input | Importance |', '|---|---|',
    ...imp.slice(0, 26).map(f => `| ${f.label} | ${f.delta.toFixed(4)} |`), '',
    `## Every source, ranked by how much it adds beyond the base model`, '',
    `"Seasons selected" is out of ${seasons} walk-forward seasons. "Strongest link" is the largest |r| between one of the source's columns and the base model's out-of-sample misses (${games.length} games); entering the model takes about ${bar.toFixed(3)}, plus the same sign in odd and even seasons.`, '',
    '| Source | Columns | Verifiability | Strongest link (column) | Seasons selected | Selected columns (seasons) |', '|---|---|---|---|---|---|',
    ...rows.map(b => `| ${b.src} | ${b.cols} | ${tierText(b.tiers)} | ${b.best == null ? 'n/a' : b.best.toFixed(3)} (${b.bestCol || ''}) | ${b.selected} | ${b.picked.slice(0, 4).join(', ')} |`), ''];
  fs.writeFileSync(path.join(ROOT, 'docs', 'data-inventory.md'), md.join('\n'));
  console.log(`${cols.length} candidates from ${rows.length} sources`);
  for (const r of tierRows) console.log(`  ${r.t.padEnd(10)} ${String(r.n).padStart(4)} top ${r.top.toFixed(3)} median ${r.median.toFixed(3)} selected ${r.sel}`);
  for (const b of rows.slice(0, 12)) console.log(`  ${b.src.slice(0, 50).padEnd(50)} best ${b.best == null ? 'n/a' : b.best.toFixed(3)} sel ${b.selected}`);
}

if (require.main === module) main();
