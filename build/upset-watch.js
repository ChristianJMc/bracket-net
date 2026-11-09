// Upset watch: for each game in a season, find the most similar past tournament games (same seed line in
// the first round, same seed gap later), see how often those underdogs won compared with what the model
// expected, and list which learned upset signatures fire. Uses only seasons before the target year.
//
// The adjusted chance is partially pooled: it moves from the model's number toward the lookalikes' record
// only as far as the number of lookalikes supports, so one wild analog can't swing it.
//
//   node build/upset-watch.js --year 2026            one season (backtest if results are known)
//   node build/upset-watch.js --backtest              every season from 2012, scored against what happened
// Writes docs/upset-watch-YEAR.md (or docs/upset-watch-backtest.md).
const fs = require('fs');
const path = require('path');
const { buildRows, predictions, signatures } = require('./review');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const ROUNDS = ['First Four', 'Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];

// What "similar" means: the strength gap the model sees plus the ingredients that showed up in upsets.
const SIMILARITY = ['base_adjEM', 'base_adjO', 'base_adjD', 'base_adjT', 'base_tpO', 'base_tpD', 'base_toO', 'base_toD',
  'base_orbO', 'base_form', 'ap_preseason_rank', 'kb_talent', 'kb_exp', 'kb_eff_hgt', 'em_relative_rating', 'btn_badj_em'];
const K = 12;
// How much to trust the lookalikes and the firing signatures. Chosen walk-forward in the backtest: each
// season uses the setting that scored best on earlier seasons only. PRIOR = how many "virtual games" of
// trust the model's own number gets; BETA = points added per firing signature. Only upward moves are
// allowed: in the first backtest, lookalike evidence for *fewer* upsets was noise.
const DEFAULT = { prior: 40, beta: 0.02 };
const GRID = [10, 20, 40, 80, 160, 1e9].flatMap(prior => [0, 0.01, 0.02, 0.04].map(beta => ({ prior, beta })));
const adjust = (w, { prior, beta }) => Math.min(0.97, Math.max(0.01,
  w.pDog + Math.max(0, (w.near.length / (w.near.length + prior)) * (w.rate - w.expected)) + beta * w.fired.length));

const logit = (p) => Math.log(p / (1 - p));
const peerGroup = (r) => (r.round === 1 ? 'R1 ' + r.segments.seed_line : r.round === 0 ? 'First Four' : 'later ' + r.segments.later_round_gap);

function vector(r, stats) {
  return [logit(r.pFav), ...SIMILARITY.map(c => {
    const a = r.dogStats[c], b = r.favStats[c];
    return typeof a === 'number' && typeof b === 'number' ? (a - b - stats[c].m) / stats[c].s : 0;
  })];
}

// targets: optional rows to judge instead of the season's actual games (build/predict.js passes one matchup).
function watchYear(allRows, year, columns, { sigCache, targets } = {}) {
  const history = allRows.filter(r => r.year < year), target = targets || allRows.filter(r => r.year === year);
  const stats = {};
  for (const c of SIMILARITY) {
    const d = history.map(r => r.dogStats[c] - r.favStats[c]).filter(Number.isFinite);
    const m = d.reduce((s, v) => s + v, 0) / d.length;
    stats[c] = { m, s: Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / d.length) || 1 };
  }
  // Upset signatures learned from history only: pooled and per peer group.
  const sigs = sigCache || {};
  const sigFor = (key, rows) => (sigs[key] = sigs[key] || signatures(rows, columns, { minHalf: 25, hi: 0.995 }).list.filter(s => s.replicates));
  const pooledSigs = sigFor(`${year}|all`, history);
  const hv = history.map(r => ({ r, v: vector(r, stats), g: peerGroup(r) }));
  return target.map(t => {
    const tv = vector(t, stats), group = peerGroup(t);
    const peers = hv.filter(h => h.g === group);
    const pool = peers.length >= K ? peers : hv;
    const near = pool.map(h => ({ ...h, dist: Math.sqrt(h.v.reduce((s, x, i) => s + (x - tv[i]) ** 2, 0)) }))
      .sort((a, b) => a.dist - b.dist).slice(0, K);
    const rate = near.filter(n => n.r.miss).length / near.length;
    const expected = near.reduce((s, n) => s + (1 - n.r.pFav), 0) / near.length;
    const pDog = 1 - t.pFav;
    const groupRows = history.filter(r => peerGroup(r) === group);
    const groupSigs = groupRows.filter(r => r.miss).length >= 12 ? sigFor(`${year}|${group}`, groupRows) : [];
    const fired = [...pooledSigs.map(s => ({ ...s, scope: 'all games' })), ...groupSigs.map(s => ({ ...s, scope: group }))].filter(s => {
      const a = t.dogStats[s.col], b = t.favStats[s.col];
      if (typeof a !== 'number' || typeof b !== 'number') return false;
      const ds = (s.scope === 'all games' ? history : groupRows).map(r => r.dogStats[s.col] - r.favStats[s.col]).filter(Number.isFinite);
      const m = ds.reduce((x, v) => x + v, 0) / ds.length, sd = Math.sqrt(ds.reduce((x, v) => x + (v - m) ** 2, 0) / ds.length) || 1;
      return Math.sign(s.effect) * ((a - b) - m) / sd > 0.75; // underdog is well on the upset side of this stat
    });
    const w = { t, group, pDog, rate, expected, near, fired };
    w.adjusted = adjust(w, DEFAULT);
    return w;
  });
}

function fmtGame(w) {
  const t = w.t, res = t.winner ? (t.miss ? `**${t.dog} won** ${t.score}` : `${t.fav} won ${t.score}`) : '';
  return `| ${ROUNDS[t.round]} | ${t.dog} (${t.seedDog}) over ${t.fav} (${t.seedFav}) | ${(w.pDog * 100).toFixed(0)}% | ${(w.adjusted * 100).toFixed(0)}% | ` +
    `${w.near.filter(n => n.r.miss).length}/${w.near.length} won (model expected ${(w.expected * w.near.length).toFixed(1)}) | ${w.fired.map(f => f.col).join(', ') || ''} | ${res} |`;
}

function main() {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const dataset = read('data/dataset.json');
  const kaggle = require('./lib/features').loadFeatures();
  const pred = predictions(dataset);
  const rows = buildRows(dataset, kaggle, pred.p);
  const columns = [...new Set(rows.flatMap(r => Object.keys(r.favStats)))];
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });

  if (process.argv.includes('--backtest')) {
    const years = dataset.years.filter(y => y >= 2012);
    const ll = (p, y) => -(y ? Math.log(p) : Math.log(1 - p));
    const sum = (list, f) => list.reduce((s, w) => s + f(w), 0);
    const raw = [];
    for (const y of years) { raw.push(...watchYear(rows, y, columns)); process.stdout.write(`${y} `); }
    console.log();
    // Score each idea separately. Each season's setting is picked on earlier seasons only.
    const VARIANTS = {
      'signatures only': GRID.filter(g => g.prior > 1e8),
      'lookalikes only': GRID.filter(g => g.beta === 0),
      'both': GRID,
    };
    const results = {};
    for (const [name, grid] of Object.entries(VARIANTS)) {
      const scored = [], chosen = {};
      for (const y of years) {
        const past = scored.filter(w => w.t.year < y);
        const setting = past.length < 150 ? grid.find(g => g.beta === 0 && g.prior > 1e8) || grid[0]
          : grid.map(g => ({ g, loss: sum(past, w => ll(adjust(w, g), w.t.miss)) })).sort((p, q) => p.loss - q.loss)[0].g;
        chosen[y] = setting;
        for (const w of raw.filter(w => w.t.year === y)) scored.push({ ...w, adjusted: adjust(w, setting) });
      }
      results[name] = { scored, chosen, loss: sum(scored, w => ll(w.adjusted, w.t.miss)) / scored.length };
    }
    const llModel = sum(raw, w => ll(w.pDog, w.t.miss)) / raw.length;
    const best = Object.entries(results).sort((p, q) => p[1].loss - q[1].loss)[0];
    const use = best[1].loss < llModel ? best[0] : 'none';
    const last = use === 'none' ? { prior: 1e9, beta: 0 } : best[1].chosen[years[years.length - 1]];
    fs.writeFileSync(path.join(ROOT, 'data', 'upset-watch-settings.json'), JSON.stringify({ use, setting: last, llModel, variants: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.loss])) }, null, 1));
    const bands = [['a signature fired', w => w.fired.length > 0], ['lookalikes beat the model by 8+ pts', w => w.rate - w.expected >= 0.08], ['neither', w => !w.fired.length && w.rate - w.expected < 0.08]];
    const md = ['# Upset watch backtest', '', `Every season ${years[0]}–${years[years.length - 1]}, each judged using only earlier seasons. Predictions: ${pred.source}.`, '',
      '## Does each idea improve the underdog chances?', '', '| Adjustment | Log loss (lower is better) | vs model |', '|---|---|---|',
      `| model alone | ${llModel.toFixed(4)} | |`,
      ...Object.entries(results).map(([k, v]) => `| ${k} | ${v.loss.toFixed(4)} | ${(llModel - v.loss >= 0 ? 'better by ' : 'worse by ') + Math.abs(llModel - v.loss).toFixed(4)} |`), '',
      `In use for upset-watch reports: **${use}**.`, '',
      '## Where underdogs beat the model', '', '| Games | Count | Model said underdogs win | Underdogs actually won |', '|---|---|---|---|',
      ...bands.map(([name, f]) => { const g = raw.filter(f); return `| ${name} | ${g.length} | ${(sum(g, w => w.pDog) / g.length * 100).toFixed(1)}% | ${(g.filter(w => w.t.miss).length / g.length * 100).toFixed(1)}% |`; })];
    fs.writeFileSync(path.join(ROOT, 'docs', 'upset-watch-backtest.md'), md.join('\n'));
    console.log(md.slice(4).join('\n'));
    return;
  }

  const year = +(arg('--year') || Math.max(...dataset.years));
  const settingsFile = path.join(ROOT, 'data', 'upset-watch-settings.json');
  const settings = fs.existsSync(settingsFile) ? read('data/upset-watch-settings.json') : { use: 'default', setting: DEFAULT };
  const w = watchYear(rows, year, columns).map(x => ({ ...x, adjusted: adjust(x, settings.setting) }))
    // Rank by upset evidence (signatures firing, lookalikes beating the model), whether or not it moves the number.
    .sort((a, b) => (b.fired.length * 0.03 + b.rate - b.expected) - (a.fired.length * 0.03 + a.rate - a.expected));
  const md = [`# Upset watch: ${year}`, '', `Lookalikes and signatures come from ${Math.min(...rows.map(r => r.year))}–${year - 1} only. Adjustment in use: ${settings.use} (chosen by the walk-forward backtest; run --backtest to refresh).`, '',
    '| Round | Upset | Model | Adjusted | 12 closest past games | Signatures firing | Result |', '|---|---|---|---|---|---|---|', ...w.map(fmtGame), '', '## Closest past games for the top 10 flags', ''];
  for (const x of w.slice(0, 10)) {
    md.push(`### ${x.t.dog} (${x.t.seedDog}) vs ${x.t.fav} (${x.t.seedFav}), ${ROUNDS[x.t.round]}`, '',
      ...x.near.slice(0, 6).map(n => `- ${n.r.year} ${ROUNDS[n.r.round]}: ${n.r.dog} (${n.r.seedDog}) vs ${n.r.fav} (${n.r.seedFav}) — ${n.r.miss ? 'underdog won' : 'favorite won'} ${n.r.score}, model had the underdog at ${((1 - n.r.pFav) * 100).toFixed(0)}%`), '');
  }
  fs.writeFileSync(path.join(ROOT, 'docs', `upset-watch-${year}.md`), md.join('\n'));
  console.log(`wrote docs/upset-watch-${year}.md; top flags:`);
  for (const x of w.slice(0, 8)) console.log(`  ${x.t.dog} (${x.t.seedDog}) over ${x.t.fav} (${x.t.seedFav}): model ${(x.pDog * 100).toFixed(0)}% → ${(x.adjusted * 100).toFixed(0)}%  ${x.t.miss ? 'UPSET HAPPENED' : ''}  [${x.fired.map(f => f.col).join(', ')}]`);
}

if (require.main === module) main();
module.exports = { watchYear, SIMILARITY };
