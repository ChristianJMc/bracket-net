// Miss review: which tournament games did the model get wrong, and what set those apart?
//  1. Lists every miss with the model's pregame probability and seeds.
//  2. Stat signatures over all games, then separately inside each segment (seed line, later-round seed gap,
//     round, era, underdog conference type, favorite strength), because pooling can hide a pattern that
//     only lives in one slice or flips between slices.
//     A signature is the correlation between (underdog − favorite) on a stat and the residual (did the
//     underdog win, minus the model's chance for it). It counts only if it clears 2 standard errors in
//     odd and even seasons separately. Each slice also gets a permutation baseline: the residuals are
//     shuffled 200 times to count how many stats pass by luck alone. A slice's findings are trusted only
//     when it beats that baseline.
//  3. News factors (if build/news/extract.mjs has run): how often each appears in misses vs correct picks.
// Predictions come from data/walkforward-preds.json when present, else the shipped base model (which never
// trained on a tournament game, so its tournament predictions are all out-of-sample).
// Writes data/misses.json, data/signatures.json and docs/miss-review.md.
const fs = require('fs');
const path = require('path');
const { NN } = require('./nn');
const { gameKey } = require('./news/store');
const { SEGMENTS, levels } = require('./lib/segments');
const { makeHistory, HISTORY_COLUMNS } = require('./lib/tourney-history');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const exists = (f) => fs.existsSync(path.join(ROOT, f));
const ROUNDS = ['First Four', 'Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];

function predictions(dataset) {
  if (exists('data/walkforward-preds.json')) {
    const wf = read('data/walkforward-preds.json');
    return { source: 'walk-forward', p: (g) => wf.preds[gameKey(g)] };
  }
  const m = read('data/model.json');
  const model = { scale: m.model.scale, nets: m.model.nets.map(NN.fromJSON) };
  return { source: 'shipped base model', p: (g) => NN.predict(model, dataset.teams[g.year][g.a], dataset.teams[g.year][g.b], 0) };
}

// One row per game, oriented favorite vs underdog, with both teams' stats. Shared with build/upset-watch.js.
function buildRows(dataset, kaggle, pFn) {
  const baseCols = NN.FEATURES.map(f => f[0]);
  const history = makeHistory(dataset, pFn);
  const rows = [];
  for (const g of dataset.games) {
    const p = pFn(g);
    if (p == null) continue;
    const favA = p >= 0.5, fav = favA ? g.a : g.b, dog = favA ? g.b : g.a;
    const winner = g.sa > g.sb ? g.a : g.b;
    const T = dataset.teams[g.year], K = kaggle.teams[g.year] || {}, C = (kaggle.conf || {})[g.year] || {};
    const own = (n) => Object.fromEntries(Object.entries(T[n]).filter(([c]) => c.startsWith('mo_')));
    const stats = (n) => ({ ...Object.fromEntries(baseCols.map(c => ['base_' + c, T[n][c]])), seed: T[n].seed, ...own(n), ...history(g.year, g.round, n), ...(K[n] || {}) });
    const row = { key: gameKey(g), year: g.year, round: g.round, fav, dog, winner, miss: winner === dog, pFav: Math.max(p, 1 - p),
      seedFav: T[fav].seed, seedDog: T[dog].seed, confFav: C[fav] || null, confDog: C[dog] || null,
      score: `${Math.max(g.sa, g.sb)}-${Math.min(g.sa, g.sb)}`, favStats: stats(fav), dogStats: stats(dog) };
    row.segments = levels(row);
    rows.push(row);
  }
  return rows;
}

function pearson(d, r, idx) {
  const n = idx.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (const i of idx) { mx += d[i]; my += r[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const i of idx) { const a = d[i] - mx, b = r[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

// Signatures for a set of rows. Passing = same sign in odd and even seasons, each at least 2 standard
// errors (2/sqrt(n) for a correlation). `perms` > 0 adds a chance baseline from shuffled residuals.
function signatures(rows, columns, { lo = 0.5, hi = 0.97, minHalf = 30, perms = 0, seed = 1 } = {}) {
  const pool = rows.filter(r => r.pFav >= lo && r.pFav <= hi);
  const resid = Float64Array.from(pool, r => (r.miss ? 1 : 0) - (1 - r.pFav));
  const odd = pool.map(r => r.year % 2 === 1);
  const prepared = [];
  for (const col of columns) {
    const d = new Float64Array(pool.length), oddIdx = [], evenIdx = [];
    pool.forEach((r, i) => {
      const a = r.dogStats[col], b = r.favStats[col];
      if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a - b)) return;
      d[i] = a - b; (odd[i] ? oddIdx : evenIdx).push(i);
    });
    if (oddIdx.length >= minHalf && evenIdx.length >= minHalf) prepared.push({ col, d, oddIdx, evenIdx, all: [...oddIdx, ...evenIdx] });
  }
  const evaluate = (r) => prepared.map(p => {
    const o = pearson(p.d, r, p.oddIdx), e = pearson(p.d, r, p.evenIdx);
    const pass = o != null && e != null && Math.sign(o) === Math.sign(e) &&
      Math.abs(o) >= 2 / Math.sqrt(p.oddIdx.length) && Math.abs(e) >= 2 / Math.sqrt(p.evenIdx.length);
    return { o, e, pass };
  });
  const res = evaluate(resid);
  const out = prepared.map((p, k) => ({ col: p.col, effect: pearson(p.d, resid, p.all), odd: res[k].o, even: res[k].e, n: p.all.length, replicates: res[k].pass }));
  const strength = (s) => (s.odd == null || s.even == null ? -1 : Math.sign(s.odd * s.even) * Math.min(Math.abs(s.odd), Math.abs(s.even)));
  out.sort((x, y) => strength(y) - strength(x));
  const result = { games: pool.length, upsets: pool.filter(r => r.miss).length, tested: prepared.length, passing: out.filter(s => s.replicates).length, list: out };
  if (perms > 0 && prepared.length) {
    const rng = NN.rng(seed), counts = [];
    const shuffled = Float64Array.from(resid);
    for (let t = 0; t < perms; t++) {
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp; }
      counts.push(evaluate(shuffled).filter(x => x.pass).length);
    }
    counts.sort((a, b) => a - b);
    result.chanceMean = counts.reduce((s, c) => s + c, 0) / counts.length;
    result.chance95 = counts[Math.floor(0.95 * (counts.length - 1))];
    // Share of shuffles that did at least as well as the real data: a p-value for the whole slice.
    result.pSlice = (counts.filter(c => c >= result.passing).length + 1) / (counts.length + 1);
  }
  return result;
}

function segmented(rows, columns, { perms = 200, minUpsets = 12 } = {}) {
  const out = [];
  for (const name of Object.keys(SEGMENTS)) {
    const groups = {};
    for (const r of rows) { const v = r.segments[name]; if (v != null) (groups[v] = groups[v] || []).push(r); }
    for (const [level, list] of Object.entries(groups)) {
      // A slice with only a handful of upsets (1v16 has two) can't support a correlation at all.
      const ups = list.filter(r => r.pFav <= 0.995 && r.miss).length;
      if (ups < minUpsets) { out.push({ segment: name, level, games: list.length, upsets: list.filter(r => r.miss).length, tested: 0 }); continue; }
      const s = signatures(list, columns, { perms, minHalf: 25, hi: 0.995, seed: out.length + 7 });
      if (!s.tested) { out.push({ segment: name, level, games: list.length, upsets: list.filter(r => r.miss).length, tested: 0 }); continue; }
      out.push({ segment: name, level, ...s, list: s.list.filter(x => x.replicates).slice(0, 15) });
    }
  }
  // Many slices are tested, so some will look good by luck. Benjamini-Hochberg q-values control the
  // expected share of false discoveries among the slices we call real.
  const tested = out.filter(s => s.pSlice != null).sort((a, b) => a.pSlice - b.pSlice);
  let minQ = 1;
  for (let i = tested.length - 1; i >= 0; i--) { minQ = Math.min(minQ, tested[i].pSlice * tested.length / (i + 1)); tested[i].qSlice = minQ; }
  return out;
}

function main() {
  const dataset = read('data/dataset.json');
  const kaggle = require('./lib/features').loadFeatures();
  const pred = predictions(dataset);
  const rows = buildRows(dataset, kaggle, pred.p);
  const columns = [...new Set(rows.flatMap(r => Object.keys(r.favStats)))];
  const t0 = Date.now();
  const pooled = signatures(rows, columns, { perms: 200 });
  const seg = segmented(rows, columns);
  console.log(`signatures computed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const factorRates = {};
  const fdir = path.join(ROOT, 'data', 'news-factors');
  if (fs.existsSync(fdir)) {
    const byKey = {};
    for (const f of fs.readdirSync(fdir)) Object.assign(byKey, JSON.parse(fs.readFileSync(path.join(fdir, f), 'utf8')).games);
    for (const r of rows) {
      const ex = byKey[r.key]; if (!ex || !ex.factors) continue;
      const group = r.miss ? 'miss' : 'hit';
      for (const f of ex.factors.decisive_factors) {
        factorRates[f.factor] = factorRates[f.factor] || { miss: 0, hit: 0 };
        factorRates[f.factor][group]++;
      }
      factorRates._n = factorRates._n || { miss: 0, hit: 0 };
      factorRates._n[group]++;
    }
  }

  const misses = rows.filter(r => r.miss);
  fs.writeFileSync(path.join(ROOT, 'data', 'misses.json'), JSON.stringify({ predictionSource: pred.source,
    games: rows.map(({ favStats, dogStats, ...r }) => r), factorRates }, null, 1));
  fs.writeFileSync(path.join(ROOT, 'data', 'signatures.json'), JSON.stringify({ pooled: { ...pooled, list: pooled.list.slice(0, 100) }, segments: seg }, null, 1));

  const label = (c) => (kaggle.columns[c] ? `${c} (${kaggle.columns[c].file.replace('.csv', '')}: ${kaggle.columns[c].column})` : c);
  const verdict = (s) => s.pSlice == null ? '' : (s.qSlice != null ? s.qSlice : s.pSlice) <= 0.1 ? 'beats chance' : s.pSlice <= 0.05 ? 'promising (not after correction)' : 'not above chance';
  const f3 = (v) => (v == null ? '' : v.toFixed(3));
  const md = [
    '# Miss review', '',
    `Predictions: ${pred.source}. ${rows.length} tournament games, ${misses.length} misses (${(misses.length / rows.length * 100).toFixed(1)}%).`, '',
    '## How to read the signatures', '',
    'A signature is a stat whose underdog-minus-favorite gap goes with upsets more (or less) often than the model expects. It counts only if it clears two standard errors in odd and even seasons separately. "By chance" is how many stats pass when the results are shuffled at random (average, and the 95th percentile). A slice is trusted only when it beats chance; a slice that doesn\'t may still hold one real pattern, but it can\'t be told apart from luck yet.', '',
    '## All games pooled', '',
    `${pooled.passing} of ${pooled.tested} stats pass; by chance ${pooled.chanceMean.toFixed(1)} on average (95th percentile ${pooled.chance95}). ${verdict(pooled)} (p = ${pooled.pSlice.toFixed(3)}).`, '',
    '| Stat | r | Odd yrs | Even yrs | Games | Passes |', '|---|---|---|---|---|---|',
    ...pooled.list.slice(0, 20).map(s => `| ${label(s.col)} | ${f3(s.effect)} | ${f3(s.odd)} | ${f3(s.even)} | ${s.n} | ${s.replicates ? '✓' : ''} |`),
    '', '## By segment', '',
    'Verdicts for slices use Benjamini–Hochberg q-values (q ≤ 0.10 = beats chance) because about two dozen slices are tested at once.', '',
    '| Segment | Level | Games | Upsets | Stats passing | By chance (avg / 95th) | p | q | Verdict |', '|---|---|---|---|---|---|---|---|---|',
    ...seg.map(s => s.tested ? `| ${s.segment} | ${s.level} | ${s.games} | ${s.upsets} | ${s.passing} of ${s.tested} | ${s.chanceMean.toFixed(1)} / ${s.chance95} | ${s.pSlice.toFixed(3)} | ${s.qSlice.toFixed(2)} | ${verdict(s)} |`
      : `| ${s.segment} | ${s.level} | ${s.games} | ${s.upsets} | too few to test | | | | |`),
  ];
  // Do tournament runs carry forward? For each run/program stat: correlation between the teams' gap and
  // the residual, in games where the stat can differ (rounds 2+ for this-run stats).
  const carry = HISTORY_COLUMNS.map(col => {
    const pool = col.startsWith('run_') ? rows.filter(r => r.round >= 2) : rows;
    const sg = signatures(pool, [col], { minHalf: 25, hi: 0.995 }).list[0];
    return { col, pool: pool.length, ...sg };
  });
  md.push('', '## Do tournament runs carry forward?', '',
    'Rounds 2 and later for this-tournament stats; all games for program history. r > 0 means teams with more of it win more often than the model expects. "Passes" uses the same two-halves rule as above.', '',
    '| Stat | Games | r | Odd yrs | Even yrs | Passes |', '|---|---|---|---|---|---|',
    ...carry.map(c => `| ${c.col} | ${c.pool} | ${f3(c.effect)} | ${f3(c.odd)} | ${f3(c.even)} | ${c.replicates ? '✓' : ''} |`));
  for (const s of seg.filter(s => s.tested && s.passing)) {
    md.push('', `### ${s.segment}: ${s.level} (${verdict(s)}, p = ${s.pSlice.toFixed(3)}, q = ${s.qSlice.toFixed(2)})`, '',
      '| Stat | r | Odd yrs | Even yrs | Games |', '|---|---|---|---|---|',
      ...s.list.map(x => `| ${label(x.col)} | ${f3(x.effect)} | ${f3(x.odd)} | ${f3(x.even)} | ${x.n} |`));
  }
  md.push('', '## Misses by round', '', '| Round | Games | Misses | Miss rate |', '|---|---|---|---|',
    ...ROUNDS.map((n, rd) => { const g = rows.filter(r => r.round === rd); const m = g.filter(r => r.miss); return g.length ? `| ${n} | ${g.length} | ${m.length} | ${(m.length / g.length * 100).toFixed(0)}% |` : null; }).filter(Boolean),
    '', '## Biggest misses', '',
    '| Year | Round | Winner (seed) | Favorite (seed) | Model gave winner | Score |', '|---|---|---|---|---|---|',
    ...misses.slice().sort((a, b) => b.pFav - a.pFav).slice(0, 40).map(r => `| ${r.year} | ${ROUNDS[r.round]} | ${r.winner} (${r.seedDog}) | ${r.fav} (${r.seedFav}) | ${((1 - r.pFav) * 100).toFixed(0)}% | ${r.score} |`));
  if (factorRates._n) {
    md.push('', '## News factors: misses vs correct picks', '', `${factorRates._n.miss} misses and ${factorRates._n.hit} correct picks have extracted factors.`, '',
      '| Factor | In misses | In correct picks |', '|---|---|---|',
      ...Object.entries(factorRates).filter(([k]) => k !== '_n').sort((a, b) => b[1].miss - a[1].miss)
        .map(([k, v]) => `| ${k} | ${(v.miss / Math.max(1, factorRates._n.miss) * 100).toFixed(0)}% | ${(v.hit / Math.max(1, factorRates._n.hit) * 100).toFixed(0)}% |`));
  }
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'miss-review.md'), md.join('\n'));
  console.log('carry-forward: ' + carry.map(c => `${c.col} r=${f3(c.effect)}${c.replicates ? ' ✓' : ''}`).join(', '));
  console.log(`pooled: ${pooled.passing}/${pooled.tested} pass, chance ${pooled.chanceMean.toFixed(1)} (95th ${pooled.chance95}), p ${pooled.pSlice.toFixed(3)}`);
  for (const s of seg) console.log(`  ${s.segment.padEnd(20)} ${String(s.level).padEnd(24)} n=${String(s.games).padEnd(4)} ups=${String(s.upsets).padEnd(4)} ` +
    (s.tested ? `pass ${s.passing}/${s.tested} chance ${s.chanceMean.toFixed(1)}/${s.chance95} p=${s.pSlice.toFixed(3)} q=${s.qSlice.toFixed(2)}` : 'too few'));
}

if (require.main === module) main();
module.exports = { signatures, segmented, buildRows, predictions };
