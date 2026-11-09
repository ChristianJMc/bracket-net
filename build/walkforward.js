// Walk-forward (rolling-origin) training: for each test season Y, train only on what was knowable before
// Y's tournament tipped off, predict Y's tournament, move on. This is the honest test for "learn from
// every previous year" and the guard against memorizing.
//
//   Stage A  base network on regular-season (+ non-NCAA postseason) games from seasons <= Y, optionally
//            with tournament games from seasons < Y at extra weight (tournament effort is different).
//   Stage B  small tournament network trained on tournaments < Y only. Inputs: stage A's logit plus
//            stat differences from the extra sources (KenPom, preseason, AP, talent, travel, ...), and
//            optionally pregame availability from news. Features are chosen using training years only.
//
// Default is a dry run that prints the plan. Training happens only with --run:
//   node build/walkforward.js                 dry run
//   node build/walkforward.js --run           full walk-forward (slow: one stage A per test year)
//   node build/walkforward.js --run --shared-a   reuse data/model.json for stage A (fast; it saw later seasons, so only for smoke tests)
//   node build/walkforward.js --run --cached-a   reuse the main run's per-season stage A (for the control and ablations)
//   node build/walkforward.js --run --control shuffled   leakage control: stage B on shuffled labels
//   node build/walkforward.js --run --exclude-kind opinion   same run without one kind of input, to see if it earns its place
const fs = require('fs');
const path = require('path');
const { NN } = require('./nn');
const { gameKey } = require('./news/store');
const { makeHistory, HISTORY_COLUMNS } = require('./lib/tourney-history');
const IMPORTANCE = require('./lib/importance');
const GBM = require('./lib/gbm');
const { logLoss, logit: logitP, score, reliability, pairedBootstrap, oneSERule, fitLogistic, fitMargin, normCdf, dot } = require('./lib/metrics');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const exists = (f) => fs.existsSync(path.join(ROOT, f));

const CONFIG = {
  firstTestYear: 2012,          // stage B needs a few prior tournaments to learn from
  stageA: { h1: 24, h2: 12, epochs: 10, l2: 1e-4, lr: 0.002, batch: 128, nets: 5, priorTournamentWeight: 0 },
  // priorTournamentWeight is 0 on purpose: stage B learns from stage A's predictions on earlier tournaments, so stage A
  // must not have trained on them (stacking needs out-of-sample first-stage predictions). Tournament-specific learning
  // lives in stage B.
  // The tournament network learns a correction on top of stage A's logit (offset), so regularization pulls it back to
  // stage A. Its L2 and training length are not fixed by hand: `tune` tries each pair on the most recent training
  // tournaments (held out, in time order) and keeps the best; l2/epochs here are only the fallback.
  stageB: { h1: 6, h2: 3, epochs: 30, l2: 0.3, lr: 0.003, batch: 32, nets: 5, maxFeatures: 24,
    tune: { l2: [0.03, 0.1, 0.3, 1], epochs: [30, 90], valYears: 2, nets: 3 },
    // What stage B corrects: 'margin' = the linear point-margin model, 'nn' = the base network. Chosen on the
    // regular-season time split in build/capacity.js (2021-2026 games, no tournament results): margin 0.5712 vs
    // network 0.5725 log loss.
    base: 'margin',
    // At most one stage B input per this many training games, so early seasons (few tournaments) get few inputs.
    gamesPerFeature: 25,
    // Screening bar for stage B inputs (see selectFeatures): |r| >= selectZ / sqrt(n).
    selectZ: 3.3,
    // Boosted trees get a wider input list (no significance bar, still one per idea and same sign in odd and even
    // seasons) because trees choose among inputs themselves; how many trees to keep is tuned on held-out tournaments.
    gbm: { maxFeatures: 30, trees: 300, depth: 2, lr: 0.03, lambda: 5, minLeaf: 30, subsample: 0.7, valYears: 2 },
    // Skip a candidate that correlates at |r| >= maxRedundancy with one already chosen: one input per idea.
    maxRedundancy: 0.8,
    // Don't pool everything: give the net the game's slice (seeds, round, era, power vs mid-major) so it can
    // learn that a stat matters differently in, say, 5-vs-12 games than in Elite 8 games. The strong L2
    // keeps thin slices close to the overall pattern (partial pooling) instead of trusting tiny samples.
    segmentContext: true,
    // Also admit the top few features within each round group, chosen on training years only, so a
    // stat that only matters in one slice can get in even if it's weak overall.
    perSegmentFeatures: 3,
    // Weight recent tournaments more if effects drift across eras (portal, NIL). Half-life in years; null = off.
    recencyHalfLife: null,
    // How much evidence each kind of input needs before the net leans on it: a multiplier on its L2 penalty.
    // Opinions (polls, analysts' picks) and human-judgment hybrids can carry signal, so they aren't banned,
    // but they have to show it more clearly than counted stats do.
    kindL2: { stat: 1, rating: 1, projection: 1.5, hybrid: 2, opinion: 4, report: 1 },
    // Kinds left out entirely (set from --exclude-kind); checks.js compares runs with and without each.
    excludeKinds: [] },
  // Feature groups for stage B, by column prefix in data/features-*.json (merged by build/lib/features.js). Toggle to run ablations.
  groups: {
    seed: { on: true, cols: ['seed'] },
    kenpom: { on: true, prefix: ['kb_kadj', 'kb_k_'] },
    barttorvik: { on: true, prefix: ['kb_badj', 'kb_barthag', 'kb_wab', 'kb_elite'] },
    neutral_splits: { on: true, prefix: ['btn_', 'trn_'] },
    roster: { on: true, prefix: ['kb_exp', 'kb_talent', 'kb_avg_hgt', 'kb_eff_hgt'] },
    preseason: { on: true, prefix: ['kpre_', 'rppfpre_', 'ap_preseason'] },
    ap_poll: { on: true, prefix: ['ap_'] },
    other_ratings: { on: true, prefix: ['em_', 'f38_', 'z_', 'rppf_', 'tr_', 'res_', 'ts_'] },
    shooting: { on: true, prefix: ['shot_', 'kb_3pt', 'kb_2pt', 'kb_ft'] },
    // Streaks, ceiling games, momentum into March, close games, 3-point swings (build/build-data.js momentum()).
    momentum: { on: true, own: ['mo_'] },
    // Analysts' pre-tournament picks (Heat Check dark horse / upset alert / Cinderella / easy or tough draw): opinion.
    analyst_picks: { on: true, prefix: ['hc_'] },
    // Roster shape from player box scores: star dependence, depth, continuity, transfers, experience, and whether
    // the top players were playing their usual minutes going into the tournament (build/ingest/players.mjs).
    players: { on: true, prefix: ['pl_'] },
    // Our own margin-of-victory Elo, carried across seasons (build/ingest/elo.js).
    elo: { on: true, prefix: ['elo'] },
    // This tournament's run so far (earlier rounds only) and the program's earlier tournaments (build/lib/tourney-history.js).
    tourney_run: { on: true, history: true },
    conference: { on: true, prefix: ['conf_', 'rppfconf_'] },
    // Travel and rest are per-game inputs, but they go through the same screen as every other candidate (GAME_COLUMNS).
    travel: { on: true, cols: ['g_travel_miles', 'g_travel_tz'] },
    // Workload and road share before the tournament (build/ingest/schedule.js), and days of rest before this game.
    schedule: { on: true, prefix: ['sch_'] },
    rest: { on: true, cols: ['g_rest'] },
    // Altitude, air pressure, body-clock tip time, crowd, listed home team, earlier meetings (build/ingest/gamesite.js).
    game_context: { on: true, prefix: ['gm_'] },
    // Coach tenure and record before the season; tournament over/under-performance walk-forward (build/ingest/coaches.js).
    coach: { on: true, prefix: ['coach_'] },
    // Engineered: home-floor boost, neutral-court gap, road gap, campus elevation (build/ingest/derived.js).
    derived: { on: true, prefix: ['dv_'] },
    // Each team's home-court edge from the ratings (altitude-informed empirical Bayes, build/build-data.js).
    venue: { on: true, own: ['hca'] },
    // Massey ordinals: consensus of dozens of computer rankings at Selection Sunday (build/ingest/mmlm.js; Kaggle files).
    massey: { on: true, prefix: ['ms_'] },
    // Variance: slow games and three-heavy games have fewer, swingier possessions, which should pull the favourite's
    // chance toward 50%; conference rivals know each other. Each is (game trait) x stage A's logit (VARIANCE_COLUMNS).
    variance: { on: true, cols: ['gx_pace', 'gx_3pa', 'gx_same_conf'] },
    // Availability read from recaps is hindsight even when the text says it was known before tip-off.
    // Off by default; turn on to measure how much a real injury feed would be worth.
    news_availability: { on: false, game: 'news' },
  },
  gates: { minLogLossGain: 0.002, minYearsWon: 0.6, maxTrainTestGap: 0.05, maxYearRegression: 0.05 },
};


// Which data each stage may see when testing season Y. Exported for test/walkforward.test.js.
function split(years, testYear) {
  return { stageASeasons: years.filter(y => y <= testYear), stageBTournaments: years.filter(y => y < testYear), test: testYear };
}

// Where an input comes from (see build/ingest/kaggle-files.js for the kinds).
// Per-game candidates: each team's value for this game (miles travelled, time zones crossed, days since its last game).
const GAME_COLUMNS = ['g_travel_miles', 'g_travel_tz', 'g_rest'];
const VARIANCE_COLUMNS = ['gx_pace', 'gx_3pa', 'gx_same_conf'];

function kindOfColumn(c, kaggle) {
  if (c === 'seed') return 'hybrid';
  if (c === 'hca') return 'rating';
  if (GAME_COLUMNS.includes(c) || VARIANCE_COLUMNS.includes(c)) return 'stat';            // the committee's judgment, informed by the ratings
  if (c.startsWith('mo_') || HISTORY_COLUMNS.includes(c)) return 'stat'; // counted from our own game logs
  return (kaggle.columns[c] && kaggle.columns[c].kind) || 'stat';
}

function columnsFor(kaggle, groups, dataset) {
  const all = Object.keys(kaggle.columns);
  const own = dataset ? Object.keys(Object.values(Object.values(dataset.teams)[0])[0]) : [];
  const cols = new Set();
  for (const g of Object.values(groups)) {
    if (!g.on) continue;
    for (const c of g.cols || []) cols.add(c);
    for (const p of g.prefix || []) for (const c of all) if (c.startsWith(p)) cols.add(c);
    for (const p of g.own || []) for (const c of own) if (c.startsWith(p)) cols.add(c);
    if (g.history) for (const c of HISTORY_COLUMNS) cols.add(c);
  }
  return [...cols].filter(c => !CONFIG.stageB.excludeKinds.includes(kindOfColumn(c, kaggle)));
}

// Per-input L2 multipliers for a stage B row: stage A's logit, then each chosen column by kind, then the
// game-level and context inputs at 1.
function l2For(chosen, kaggle, n) {
  const m = new Float64Array(n).fill(1);
  chosen.forEach((c, j) => { m[1 + j] = CONFIG.stageB.kindL2[kindOfColumn(c, kaggle)] || 1; });
  return m;
}

// Pregame availability from extracted news: weighted count of players out per team (star 3, starter 2, rotation 1).
function availability(factors, key, team, sideOf) {
  const f = factors[key];
  if (!f || !f.factors) return null;
  const w = { star: 3, starter: 2, rotation: 1, bench: 0.3, unknown: 0.5 };
  return f.factors.availability.filter(a => a.known_before_tipoff && a.status !== 'returned_from_absence' && sideOf(a.team) === team)
    .reduce((s, a) => s + (w[a.role] || 0) * (a.status === 'out' ? 1 : 0.5), 0);
}

// Days since the team's previous game: an earlier round of this tournament, else its last game before it.
function restDays(ctx, g, team) {
  if (!g.date) return null;
  const prev = ctx.dataset.games.filter(x => x.year === g.year && x.round < g.round && x.date && (x.a === team || x.b === team))
    .map(x => x.date).sort().pop() || ((ctx.kaggle.lastGame || {})[g.year] || {})[team];
  return prev ? Math.round((Date.parse(g.date) - Date.parse(prev)) / 86400e3) : null;
}

const POWER = new Set(['ACC', 'B10', 'B12', 'BE', 'SEC', 'P12']);
const ROUND_GROUP = (rd) => (rd <= 1 ? 'early' : rd === 2 ? 'r32' : 'late');

function stageBRow(g, ctx, cols, zA) {
  const T = ctx.dataset.teams[g.year], K = ctx.kaggle.teams[g.year] || {};
  const C = (ctx.kaggle.conf || {})[g.year] || {};
  const trip = (team) => (((ctx.kaggle.travel || {})[g.year] || {})[team] || {})[g.round] || null;
  const gameVal = (team, c) => {
    if (c === 'g_rest') { const r = restDays(ctx, g, team); return r == null ? null : Math.min(r, 10); }
    const t = trip(team); if (!t) return null;
    return c === 'g_travel_miles' ? Math.log1p(t.mi) : Math.abs(t.tz);
  };
  // Per-game, per-team values from data/features-gamectx.json (and any other file with level: 'game').
  const G = ((ctx.kaggle.games || {})[gameKey(g)] || {});
  // Interactions: half of (trait x zA) for A and minus half for B, so A minus B is trait x zA.
  const variance = (team, c) => {
    const n = varianceNorms(ctx.dataset), A = T[g.a], B = T[g.b];
    const trait = c === 'gx_pace' ? ((A.adjT + B.adjT) / 2 - n.t[0]) / n.t[1] : c === 'gx_3pa' ? ((A.tprO + B.tprO) / 2 - n.p[0]) / n.p[1]
      : (C[g.a] && C[g.a] === C[g.b] ? 1 : 0);
    return (team === g.a ? 0.5 : -0.5) * trait * zA;
  };
  const val = (team, c) => (HISTORY_COLUMNS.includes(c) ? (ctx.history ? ctx.history(g.year, g.round, team)[c] : 0)
    : GAME_COLUMNS.includes(c) ? gameVal(team, c)
    : VARIANCE_COLUMNS.includes(c) ? variance(team, c)
    : c.startsWith('gm_') ? (G[team] || {})[c]
    : c === 'seed' || c === 'hca' || c.startsWith('mo_') ? T[team][c] : (K[team] || {})[c]);
  const x = [zA], present = [];
  for (const c of cols) {
    const a = val(g.a, c), b = val(g.b, c);
    const ok = Number.isFinite(a) && Number.isFinite(b);
    x.push(ok ? (a - b) : 0); present.push(ok ? 1 : 0);
  }
  if (CONFIG.groups.news_availability.on) {
    const key = gameKey(g), side = (s) => (s === 'A' ? g.a : g.b);
    const a = availability(ctx.factors, key, g.a, side), b = availability(ctx.factors, key, g.b, side);
    x.push(a != null && b != null ? b - a : 0);
  }
  if (CONFIG.stageB.segmentContext) x.push((POWER.has(C[g.a]) ? 1 : 0) - (POWER.has(C[g.b]) ? 1 : 0));
  const na = x.length;
  // Context (same for both orientations): round, and the share of features present for this game.
  x.push(g.round / 6, present.length ? present.reduce((s, v) => s + v, 0) / present.length : 1);
  // Slice context: the better and worse seed (symmetric, unlike a seed difference) and era.
  if (CONFIG.stageB.segmentContext) x.push(Math.min(T[g.a].seed, T[g.b].seed) / 16, Math.max(T[g.a].seed, T[g.b].seed) / 16,
    g.year >= 2015 && g.year <= 2019 ? 1 : 0, g.year >= 2021 ? 1 : 0);
  return { x: Float64Array.from(x), na, present };
}

// Mean and SD of tempo and 3-point attempt rate over every tournament team, for the variance interactions.
const NORMS = new WeakMap();
function varianceNorms(dataset) {
  if (NORMS.has(dataset)) return NORMS.get(dataset);
  const all = Object.values(dataset.teams).flatMap(T => Object.values(T));
  const ms = (k) => { const v = all.map(t => t[k]), m = v.reduce((s, x) => s + x, 0) / v.length; return [m, Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) || 1]; };
  const n = { t: ms('adjT'), p: ms('tprO') };
  NORMS.set(dataset, n);
  return n;
}

// Feature choice uses training tournaments only: rank by |corr(diff, residual of stage A)|.
// Screening hundreds of candidates on a few hundred games mostly finds noise (the winner's curse), so a candidate
// must clear a bar corrected for the number screened (|r| >= selectZ / sqrt(n), about p < 0.001 per test) and, when
// rows carry a year, show the same sign in odd and even seasons separately.
function corr(pts) {
  const n = pts.length; if (n < 3) return 0;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [a, b] of pts) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; syy += (b - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
function selectFeatures(rows, cols, max, { z = CONFIG.stageB.selectZ, already = [] } = {}) {
  const halves = rows.length && rows[0].year != null;
  const scored = cols.map((c, j) => {
    const use = rows.filter(r => r.present[j]);
    if (use.length < 100) return { c, s: 0 };
    const r = corr(use.map(q => [q.raw[j], q.y - q.pA]));
    let ok = Math.abs(r) >= z / Math.sqrt(use.length);
    if (ok && halves) {
      const half = (odd) => corr(use.filter(q => (q.year % 2 === 1) === odd).map(q => [q.raw[j], q.y - q.pA]));
      ok = Math.sign(half(true)) === Math.sign(r) && Math.sign(half(false)) === Math.sign(r);
    }
    return { c, s: ok ? Math.abs(r) : 0 };
  }).sort((a, b) => b.s - a.s);
  // One input per idea: skip a candidate that nearly duplicates one already chosen (on rows where both exist).
  const idx = (c) => cols.indexOf(c), picked = [];
  const redundant = (c) => [...already, ...picked].some(d => {
    const i = idx(c), j = idx(d); if (j < 0) return false;
    const both = rows.filter(q => q.present[i] && q.present[j]);
    return both.length >= 50 && Math.abs(corr(both.map(q => [q.raw[i], q.raw[j]]))) >= (CONFIG.stageB.maxRedundancy || 1);
  });
  for (const f of scored) { if (picked.length >= max || f.s <= 0) break; if (!redundant(f.c)) picked.push(f.c); }
  return picked;
}

// Overall picks plus the top few within each round group, all from training tournaments only.
function chooseFeatures(rawRows, games, cols) {
  const cap = Math.min(CONFIG.stageB.maxFeatures, Math.floor(games.length / (CONFIG.stageB.gamesPerFeature || 1)));
  const chosen = new Set(selectFeatures(rawRows, cols, cap));
  if (CONFIG.stageB.perSegmentFeatures && games.length >= 600) for (const grp of ['early', 'r32', 'late']) {
    const sub = rawRows.filter((r, i) => ROUND_GROUP(games[i].round) === grp);
    for (const c of selectFeatures(sub, cols, CONFIG.stageB.perSegmentFeatures, { already: [...chosen] })) chosen.add(c);
  }
  return [...chosen];
}

const recencyWeights = (games, testYear) => (CONFIG.stageB.recencyHalfLife
  ? games.map(g => Math.pow(0.5, (testYear - 1 - g.year) / CONFIG.stageB.recencyHalfLife)) : null);

function trainEnsemble(xs, ys, opts, weights) {
  const nets = [];
  for (let s = 0; s < opts.nets; s++) nets.push(NN.train(xs, ys, { ...opts, seed: 2000 + s * 17, weights }));
  return nets;
}
const ensembleP = (nets, x) => NN.sigmoid(nets.reduce((s, n) => s + NN.logit(n, x), 0) / nets.length);
const scaleFit = (xs) => xs[0].map((_, j) => Math.sqrt(xs.reduce((s, x) => s + x[j] * x[j], 0) / xs.length) || 1);

// Stage A for test season Y: regular-season (+ other postseason) games of seasons <= Y, weighted by importance
// (build/lib/importance.js), plus earlier NCAA tournaments at extra weight.
function stageA(ctx, testYear, shared, { importance = IMPORTANCE.current().imp, nets: nNets } = {}) {
  if (shared) {
    const m = read('data/model.json');
    const model = { scale: m.model.scale, nets: m.model.nets.map(NN.fromJSON) };
    return (g) => NN.predict(model, ctx.dataset.teams[g.year][g.a], ctx.dataset.teams[g.year][g.b], 0);
  }
  const sp = split(ctx.dataset.years, testYear);
  const cal = IMPORTANCE.caliberEM(ctx.dataset);
  const xs = [], ys = [], ws = [];
  for (const [key, a, b, loc, y] of ctx.training.rows) {
    if (+key.slice(0, 4) > testYear) continue;
    const s = ctx.training.snapshots[key];
    xs.push(NN.diff(s[a], s[b], loc)); ys.push(y); ws.push(IMPORTANCE.weight(importance, key, s[a], s[b], loc, cal));
  }
  if (CONFIG.stageA.priorTournamentWeight > 0) for (const g of ctx.dataset.games) if (sp.stageBTournaments.includes(g.year)) {
    xs.push(NN.diff(ctx.dataset.teams[g.year][g.a], ctx.dataset.teams[g.year][g.b], 0)); ys.push(g.sa > g.sb ? 1 : 0); ws.push(CONFIG.stageA.priorTournamentWeight);
  }
  const scale = NN.fitScale(xs);
  const X = xs.map(x => x.map((v, j) => v / scale[j]));
  const nets = trainEnsemble(X, ys, { ...CONFIG.stageA, nets: nNets || CONFIG.stageA.nets }, IMPORTANCE.normalize(ws));
  return (g) => NN.predict({ scale, nets }, ctx.dataset.teams[g.year][g.a], ctx.dataset.teams[g.year][g.b], 0);
}

// Linear model on point margin from the same regular-season games and inputs as stage A (seasons <= Y).
function fitMarginA(ctx, testYear) {
  const xs = [], ms = [];
  for (const [key, a, b, loc, , m] of ctx.training.rows) {
    if (testYear != null && +key.slice(0, 4) > testYear) continue;
    const s = ctx.training.snapshots[key]; xs.push(NN.diff(s[a], s[b], loc)); ms.push(m);
  }
  const scale = NN.fitScale(xs);
  const { w, sigma } = fitMargin(xs.map(x => x.map((v, j) => v / scale[j])), ms);
  return { w, sigma, scale };
}
const marginAP = (M, ctx, g) => normCdf(dot(M.w, NN.diff(ctx.dataset.teams[g.year][g.a], ctx.dataset.teams[g.year][g.b], 0).map((v, j) => v / M.scale[j])) / M.sigma);

// ---- Simple benchmarks, fit on earlier tournaments only. A model that can't beat these isn't learning much. ----
const BASELINES = {
  seed: (ctx, g) => [ctx.dataset.teams[g.year][g.b].seed - ctx.dataset.teams[g.year][g.a].seed],
  em: (ctx, g) => [(ctx.dataset.teams[g.year][g.a].adjEM - ctx.dataset.teams[g.year][g.b].adjEM) / 10],
  elo: (ctx, g) => { const T = ctx.kaggle.teams[g.year] || {}, a = (T[g.a] || {}).elo, b = (T[g.b] || {}).elo;
    return [Number.isFinite(a) && Number.isFinite(b) ? (a - b) / 100 : 0]; },
};
function fitBaselines(ctx, games, ys) {
  return Object.fromEntries(Object.entries(BASELINES).map(([k, f]) => [k, fitLogistic(games.map(g => f(ctx, g)), ys, { l2: 1e-4 })]));
}
const baselineP = (ctx, name, w, g) => NN.sigmoid(dot(w, BASELINES[name](ctx, g)));

// ---- Ridge stage B: logistic regression on the same inputs as the tournament network ----
// It shrinks toward "trust stage A" (coefficient 1 on stage A's logit, 0 on everything else), with each input's
// penalty scaled by its kind. The penalty strength is picked by leave-one-tournament-out inside the training years.
const RIDGE_GRID = [0.006, 0.02, 0.06, 0.2, 0.6, 2, 6, 20];
function fitRidge(X, ys, years, mult) {
  const prior = Float64Array.from({ length: X[0].length }, (_, j) => (j === 0 ? 1 : 0));
  const uniq = [...new Set(years)];
  let best = null;
  for (const lam of RIDGE_GRID) {
    const l2 = mult.map(m => m * lam);
    let loss = 0, n = 0;
    for (const hold of uniq) {
      const tr = [], te = [];
      years.forEach((y, i) => (y === hold ? te : tr).push(i));
      const w = fitLogistic(tr.map(i => X[i]), tr.map(i => ys[i]), { l2, prior, iters: 12 });
      for (const i of te) { loss += logLoss(NN.sigmoid(dot(w, X[i])), ys[i]); n++; }
    }
    if (!best || loss / n < best.cv) best = { lam, cv: loss / n };
  }
  return { lam: best.lam, cv: best.cv, w: fitLogistic(X, ys, { l2: mult.map(m => m * best.lam), prior }) };
}

// ---- Stacking: a weighted average of the three models' logits, weights learned on earlier test seasons' ----
// out-of-sample predictions only, shrunk toward an equal split. Before 3 such seasons exist it is the plain average.
const STACK = ['stageA', 'marginA', 'nnB', 'ridgeB', 'gbmB'];
function fitStack(items) {
  if (!items.length) return STACK.map(() => 1 / STACK.length);
  return fitLogistic(items.map(it => STACK.map(m => logitP(it[m]))), items.map(it => it.y), { l2: 0.02, prior: STACK.map(() => 1 / STACK.length) });
}
const stackP = (w, it) => NN.sigmoid(dot(w, STACK.map(m => logitP(it[m]))));

// Lower = simpler. The one-standard-error rule picks the simplest model within one SE of the best.
const COMPLEXITY = { seed: 0, em: 1, elo: 1, marginA: 1.5, stageA: 2, ridgeB: 3, nnB: 4, gbmB: 4.5, blend: 5 };

// Boosted trees on a wider input list; the number of trees is picked on the last few training tournaments.
function fitGBM(ctx, games, ys, cols, base, rawRows) {
  const C = CONFIG.stageB.gbm;
  const gcols = selectFeatures(rawRows, cols, C.maxFeatures, { z: 0 });
  if (!gcols.length) return { cols: [], model: { trees: [] }, n: 0 };
  const rows = games.map(g => { const z = base(g).z; return { x: Array.from(stageBRow(g, ctx, gcols, z).x).slice(1, 1 + gcols.length), z }; });
  const uniq = [...new Set(games.map(g => g.year))].sort((a, b) => a - b);
  let n = 0;
  if (uniq.length >= C.valYears + 2) {
    const val = new Set(uniq.slice(-C.valYears)), tr = [], te = [];
    games.forEach((g, i) => (val.has(g.year) ? te : tr).push(i));
    const pick = (I) => ({ X: I.map(i => rows[i].x), y: I.map(i => ys[i]), z: I.map(i => rows[i].z) });
    const T = pick(tr), V = pick(te);
    const { valLoss } = GBM.fit(T.X, T.y, T.z, C, V);
    n = valLoss.indexOf(Math.min(...valLoss));
  }
  const model = n ? GBM.fit(rows.map(r => r.x), ys, rows.map(r => r.z), { ...C, trees: n }).model : { trees: [] };
  return { cols: gcols, model, n };
}

// Pick the network's L2 and epochs on the last few training tournaments, trained on the ones before them.
function tuneNN(X, ys, years, opts, weights) {
  const T = CONFIG.stageB.tune, uniq = [...new Set(years)].sort((a, b) => a - b);
  if (!T || uniq.length < T.valYears + 2) return {};
  const val = new Set(uniq.slice(-T.valYears));
  const tr = [], te = [];
  years.forEach((y, i) => (val.has(y) ? te : tr).push(i));
  let best = null;
  for (const l2 of T.l2) for (const epochs of T.epochs) {
    const nets = trainEnsemble(tr.map(i => X[i]), tr.map(i => ys[i]), { ...opts, l2, epochs, nets: T.nets }, weights && tr.map(i => weights[i]));
    const loss = te.reduce((s, i) => s + logLoss(ensembleP(nets, X[i]), ys[i]), 0) / te.length;
    if (!best || loss < best.val) best = { l2, epochs, val: loss };
  }
  return best;
}

// Everything stage B learns from one set of training tournaments: chosen inputs, scale, network, ridge, baselines.
function fitStageB(ctx, games, ys, cols, base) {
  const rawRows = games.map(g => {
    const r = stageBRow(g, ctx, cols, base(g).z);
    return { raw: Array.from(r.x).slice(1, 1 + cols.length), present: r.present, y: g.sa > g.sb ? 1 : 0, pA: base(g).p, year: g.year };
  });
  const chosen = chooseFeatures(rawRows, games, cols);
  const rows = games.map(g => stageBRow(g, ctx, chosen, base(g).z));
  const na = rows[0].na, scale = scaleFit(rows.map(r => r.x));
  scale[0] = 1; // stage A's logit keeps its natural scale so both models start from it
  const X = rows.map(r => r.x.map((v, j) => v / scale[j]));
  const mult = l2For(chosen, ctx.kaggle, rows[0].x.length);
  const rw = recencyWeights(games, Math.max(...games.map(g => g.year)) + 1);
  const nnOpts = { ...CONFIG.stageB, na, l2Input: mult, offset: 0, ...tuneNN(X, ys, games.map(g => g.year), { ...CONFIG.stageB, na, l2Input: mult, offset: 0 }, rw) };
  const nets = trainEnsemble(X, ys, nnOpts, rw);
  const ridge = fitRidge(X.map(x => x.slice(0, na)), ys, games.map(g => g.year), Array.from(mult.slice(0, na)));
  const gbm = fitGBM(ctx, games, ys, cols, base, rawRows);
  return { chosen, scale, na, nets, gbm, nnTune: { l2: nnOpts.l2, epochs: nnOpts.epochs, val: nnOpts.val }, ridge, baselines: fitBaselines(ctx, games, ys), trainX: X };
}
function stageBParts(ctx, fit, base, g) {
  const b = base(g), r = stageBRow(g, ctx, fit.chosen, b.z), x = r.x.map((v, j) => v / fit.scale[j]);
  const out = { base: b.p, nnB: ensembleP(fit.nets, x), ridgeB: NN.sigmoid(dot(fit.ridge.w, x.slice(0, r.na))) };
  const gb = fit.gbm || { cols: [], model: { trees: [] } };
  out.gbmB = gb.model.trees.length ? GBM.predict(gb.model, Array.from(stageBRow(g, ctx, gb.cols, b.z).x).slice(1, 1 + gb.cols.length), b.z) : b.p;
  for (const [k, w] of Object.entries(fit.baselines)) out[k] = baselineP(ctx, k, w, g);
  return out;
}

// years / write are for the smoke test: a short run that saves nothing.
function run({ dry = true, sharedA = false, cachedA = false, control = null, years = null, write = true } = {}) {
  const ctx = {
    dataset: read('data/dataset.json'),
    training: dry ? { rows: [] } : read('data/training.json'),
    kaggle: require('./lib/features').loadFeatures(),
    factors: {},
  };
  if (fs.existsSync(path.join(ROOT, 'data', 'news-factors')))
    for (const f of fs.readdirSync(path.join(ROOT, 'data', 'news-factors'))) Object.assign(ctx.factors, read(`data/news-factors/${f}`).games);
  // Run/program history uses the base model's pregame chances as the expectation.
  // Run/program history measures results against an expectation. In a training run the expectation for each game
  // comes from a margin model fit only on seasons up to that game's season, so no later season informs it.
  if (ctx.training.rows.length) {
    const byYear = {}, mFor = (y) => byYear[y] || (byYear[y] = fitMarginA(ctx, y));
    ctx.history = makeHistory(ctx.dataset, (g) => marginAP(mFor(g.year), ctx, g));
  } else if (exists('data/model.json')) ctx.history = makeHistory(ctx.dataset, stageA(ctx, null, true));
  const cols = columnsFor(ctx.kaggle, CONFIG.groups, ctx.dataset);
  const testYears = years || ctx.dataset.years.filter(y => y >= CONFIG.firstTestYear);

  if (dry) {
    const trainingRows = exists('data/training.json') ? read('data/training.json').rows : [];
    const byKind = {};
    for (const c of cols) { const k = kindOfColumn(c, ctx.kaggle); byKind[k] = (byKind[k] || 0) + 1; }
    console.log(`Walk-forward plan (dry run; add --run to train). Candidate stage B columns: ${cols.length}`);
    console.log(`  by kind: ${Object.entries(byKind).map(([k, n]) => `${k} ${n} (L2 x${CONFIG.stageB.kindL2[k]})`).join(', ')}` +
      (CONFIG.stageB.excludeKinds.length ? `; excluded: ${CONFIG.stageB.excludeKinds.join(', ')}` : ''));
    console.log(`  stage A game importance: ${IMPORTANCE.current().name}`);
    console.log(`  models compared: ${Object.keys(COMPLEXITY).join(', ')} (one-SE rule over season-bootstrap)`);
    for (const [name, g] of Object.entries(CONFIG.groups)) console.log(`  group ${name}: ${g.on ? 'on' : 'off'}`);
    for (const y of testYears) {
      const sp = split(ctx.dataset.years, y);
      const aRows = trainingRows.filter(r => +r[0].slice(0, 4) <= y).length;
      const bGames = ctx.dataset.games.filter(g => sp.stageBTournaments.includes(g.year)).length;
      const testGames = ctx.dataset.games.filter(g => g.year === y).length;
      console.log(`  test ${y}: stage A ${aRows} games (seasons ${sp.stageASeasons[0]}–${y}) + ${bGames} prior tournament games x${CONFIG.stageA.priorTournamentWeight}; ` +
        `stage B ${bGames} games from ${sp.stageBTournaments.length} tournaments; predict ${testGames}`);
    }
    return null;
  }

  // Stage A predictions per test season are cached so the control and ablation runs reuse exactly the same base
  // model as the main run (like-for-like comparisons) without retraining it.
  const cacheFile = path.join(ROOT, 'data', 'stageA-cache.json');
  const cache = cachedA ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const report = { config: CONFIG, importance: IMPORTANCE.current().name, sharedA, cachedA, control, excludeKinds: CONFIG.stageB.excludeKinds, years: {}, selected: {}, ridge: {} };
  const oos = []; // one item per test game: { year, key, y, <model>: p }
  const t0 = Date.now();
  for (const y of testYears) {
    const sp = split(ctx.dataset.years, y);
    let pA;
    if (cachedA) {
      if (!cache[y]) throw new Error(`no cached stage A for ${y}: run the main walk-forward first`);
      pA = (g) => { const p = cache[y][gameKey(g)]; if (p == null) throw new Error(`no cached stage A prediction for ${gameKey(g)}`); return p; };
    } else {
      const fresh = stageA(ctx, y, sharedA);
      cache[y] = Object.fromEntries(ctx.dataset.games.filter(g => g.year <= y).map(g => [gameKey(g), +fresh(g).toPrecision(8)]));
      pA = (g) => cache[y][gameKey(g)] ?? fresh(g);
    }
    const M = ctx.training.rows.length ? fitMarginA(ctx, y) : null;
    const baseP = (g) => (CONFIG.stageB.base === 'margin' && M ? marginAP(M, ctx, g) : pA(g));
    const base = (g) => { const p = baseP(g); return { p, z: logitP(p) }; };
    const trainGames = ctx.dataset.games.filter(g => sp.stageBTournaments.includes(g.year));
    const testGames = ctx.dataset.games.filter(g => g.year === y);
    let ys = trainGames.map(g => (g.sa > g.sb ? 1 : 0));
    if (control === 'shuffled') { const r = NN.rng(y); ys = ys.map(() => (r() < 0.5 ? 1 : 0)); }
    const fit = fitStageB(ctx, trainGames, ys, cols, base);
    report.selected[y] = fit.chosen;
    report.ridge[y] = { lam: fit.ridge.lam, cv: fit.ridge.cv };
    (report.nnTune = report.nnTune || {})[y] = fit.nnTune;
    (report.gbm = report.gbm || {})[y] = { trees: fit.gbm.n, inputs: fit.gbm.cols.length, cols: fit.gbm.cols };
    for (const g of testGames) oos.push({ year: y, key: gameKey(g), y: g.sa > g.sb ? 1 : 0, ...stageBParts(ctx, fit, base, g), stageA: pA(g), marginA: M ? marginAP(M, ctx, g) : 0.5 });
    const trainNN = fit.trainX.reduce((s, x, i) => s + logLoss(ensembleP(fit.nets, x), ys[i]), 0) / ys.length;
    const mine = oos.filter(o => o.year === y), m = (k) => mine.reduce((s, o) => s + logLoss(o[k], o.y), 0) / mine.length;
    report.years[y] = { n: mine.length, llA: m('stageA'), llB: m('nnB'), llRidge: m('ridgeB'), accA: mine.filter(o => (o.stageA > 0.5) === (o.y === 1)).length / mine.length,
      accB: mine.filter(o => (o.nnB > 0.5) === (o.y === 1)).length / mine.length, trainLLB: trainNN, features: fit.chosen.length };
    console.log(`${y}: A ${m("stageA").toFixed(4)}  margin ${m("marginA").toFixed(4)}  NN-B ${m('nnB').toFixed(4)}  ridge-B ${m('ridgeB').toFixed(4)} (λ ${fit.ridge.lam}; NN l2 ${fit.nnTune.l2}/${fit.nnTune.epochs}ep)  GBM ${m("gbmB").toFixed(4)} (${fit.gbm.n} trees)  seed ${m("seed").toFixed(4)}  ` +
      `(train NN-B ${trainNN.toFixed(4)}, ${fit.chosen.length} features) ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  // Stacked blend, walk-forward: weights for season Y come from earlier test seasons only.
  for (const y of testYears) {
    const prior = oos.filter(o => o.year < y);
    const w = new Set(prior.map(o => o.year)).size >= 3 ? fitStack(prior) : fitStack([]);
    for (const o of oos) if (o.year === y) o.blend = stackP(w, o);
  }

  const names = Object.keys(COMPLEXITY);
  const lossesBy = (name) => Object.fromEntries(testYears.map(y => [y, oos.filter(o => o.year === y).map(o => logLoss(o[name], o.y))]));
  report.models = Object.fromEntries(names.map(n => [n, { ...score(oos.map(o => ({ p: o[n], y: o.y }))),
    reliability: reliability(oos.map(o => ({ p: o[n], y: o.y }))).bins,
    vsStageA: pairedBootstrap(Object.fromEntries(testYears.map(y => [y, oos.filter(o => o.year === y).map(o => ({ x: logLoss(o[n], o.y), y: logLoss(o.stageA, o.y) }))]))) }]));
  report.selection = oneSERule(names.map(n => ({ name: n, complexity: COMPLEXITY[n], losses: lossesBy(n) })));
  const ys2 = Object.values(report.years);
  const tot = (k) => ys2.reduce((s, v) => s + v[k] * v.n, 0) / ys2.reduce((s, v) => s + v.n, 0);
  report.summary = { llA: tot('llA'), llB: tot('llB'), llRidge: tot('llRidge'), accA: tot('accA'), accB: tot('accB'), trainLLB: tot('trainLLB'),
    yearsBWins: ys2.filter(v => v.llB < v.llA).length / ys2.length, llAdopted: report.models[report.selection.chosen].logLoss };
  report.adopted = control ? 'none (control run)' : report.selection.chosen;
  const preds = { models: Object.fromEntries(names.map(n => [n, Object.fromEntries(oos.map(o => [o.key, o[n]]))])), preds: {} };
  // Back-compat names used by review and checks.
  preds.stageA = preds.models.stageA; preds.stageB = preds.models.nnB;
  for (const o of oos) preds.preds[o.key] = o[report.selection.chosen];
  for (const r of report.selection.rows.sort((a, b) => a.logLoss - b.logLoss))
    console.log(`  ${r.name.padEnd(7)} ${r.logLoss.toFixed(4)}  vs best ${r.vsBest.mean >= 0 ? '+' : ''}${r.vsBest.mean.toFixed(4)} ± ${r.vsBest.se.toFixed(4)}`);
  console.log(`best ${report.selection.best}; adopted (one-SE rule) ${report.adopted}`);
  if (!write) return { report, preds };
  const ablation = CONFIG.stageB.excludeKinds.length > 0;
  if (!control && !ablation) saveFinal(ctx, cols, report, oos);
  const suffix = (control ? `-${control}` : '') + CONFIG.stageB.excludeKinds.map(k => `-no-${k}`).join('');
  fs.writeFileSync(path.join(ROOT, 'data', `walkforward-report${suffix}.json`), JSON.stringify(report, null, 1));
  if (!control && !ablation) fs.writeFileSync(path.join(ROOT, 'data', 'walkforward-preds.json'), JSON.stringify(preds));
  if (!cachedA && !sharedA && !years) fs.writeFileSync(cacheFile, JSON.stringify(cache));
  return { report, preds };
}

// Final tournament model for next season: stage B fit on every tournament in the data (stage A = shipped model),
// stack weights from all walk-forward out-of-sample predictions, and the adopted model's name.
function saveFinal(ctx, cols, report, oos) {
  const pA = stageA(ctx, null, true), M = fitMarginA(ctx, null);
  const base = (g) => { const p = CONFIG.stageB.base === 'margin' ? marginAP(M, ctx, g) : pA(g); return { p, z: logitP(p) }; };
  const games = ctx.dataset.games, ys = games.map(g => (g.sa > g.sb ? 1 : 0));
  const fit = fitStageB(ctx, games, ys, cols, base);
  const saved = { adopted: report.selection.chosen, trainedThrough: Math.max(...ctx.dataset.years), importance: report.importance,
    chosen: fit.chosen, scale: fit.scale, na: fit.na, groups: CONFIG.groups, nets: fit.nets.map(n => NN.toJSON(n)),
    ridge: { w: fit.ridge.w, lam: fit.ridge.lam }, gbm: fit.gbm, baselines: fit.baselines, marginA: M, base: CONFIG.stageB.base, stack: { models: STACK, w: fitStack(oos) },
    walkforward: { logLoss: report.summary.llAdopted, best: report.selection.best } };
  fs.writeFileSync(path.join(ROOT, 'data', 'model-stageB.json'), JSON.stringify(saved));
  console.log(`saved data/model-stageB.json (adopted ${saved.adopted}; ${fit.chosen.length} stage B features; ridge λ ${fit.ridge.lam})`);
}

// Pairwise predictor from the saved model, for brackets and single matchups. Uses whichever model was adopted.
function stageBPredictor(saved, ctx, pA) {
  const fit = { ...saved, nets: saved.nets.map(NN.fromJSON) };
  const baseP = (g) => (saved.base === 'margin' && saved.marginA ? marginAP(saved.marginA, ctx, g) : pA(g));
  const base = (g) => { const p = baseP(g); return { p, z: logitP(p) }; };
  return (g) => {
    const parts = { ...stageBParts(ctx, fit, base, g), stageA: pA(g), marginA: saved.marginA ? marginAP(saved.marginA, ctx, g) : pA(g) };
    if (saved.adopted === 'blend') return stackP(saved.stack.w, parts);
    return parts[saved.adopted] != null ? parts[saved.adopted] : parts.stageA;
  };
}

if (require.main === module) {
  const ci = process.argv.indexOf('--control'), xi = process.argv.indexOf('--exclude-kind');
  if (xi > 0) CONFIG.stageB.excludeKinds = process.argv[xi + 1].split(',');
  run({ dry: !process.argv.includes('--run'), sharedA: process.argv.includes('--shared-a'), cachedA: process.argv.includes('--cached-a'), control: ci > 0 ? process.argv[ci + 1] : null });
}

module.exports = { CONFIG, COMPLEXITY, GAME_COLUMNS, VARIANCE_COLUMNS, split, columnsFor, kindOfColumn, l2For, selectFeatures, stageBRow, stageA, stageBPredictor, fitRidge, run };
