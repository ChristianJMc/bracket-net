// Guards against the model seeing tournament results through its inputs.
const test = require('node:test');
const assert = require('node:assert');
const { read, needs } = require('./helpers');
const { timing } = require('../build/news/store');
const { split, columnsFor, CONFIG } = require('../build/walkforward');
const { FILES } = require('../build/ingest/kaggle-files');

const OUTCOME_WORDS = /(^|_)(round|current_round|score|champ|f4|e8|s16|r32|r64|finals|top2|pake|pase|upset|seed_won|seed_lost)(_|$)/;

function tournamentWins(d) {
  const w = {};
  for (const g of d.games) if (g.round > 0) { const k = g.year + '|' + (g.sa > g.sb ? g.a : g.b); w[k] = (w[k] || 0) + 1; }
  return w;
}

function corr(xs, ys) {
  const n = xs.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) { a += (xs[i] - mx) * (ys[i] - my); b += (xs[i] - mx) ** 2; c += (ys[i] - my) ** 2; }
  return b && c ? a / Math.sqrt(b * c) : 0;
}

test('no outcome columns reach the feature table', needs('data/features-kaggle.json'), () => {
  const k = read('data/features-kaggle.json');
  // Pre-tournament values whose names look like outcomes: the resume score, and Heat Check's analyst "upset alert" pick.
  const ALLOWED = new Set(['res_r_score', 'hc_upset_alert']);
  const bad = Object.keys(k.columns).filter(c => OUTCOME_WORDS.test(c) && !ALLOWED.has(c));
  assert.deepStrictEqual(bad, []);
  const quarantined = FILES.filter(f => f.role === 'quarantine' || f.role === 'labels').map(f => f.prefix + '_');
  assert.deepStrictEqual(Object.keys(k.columns).filter(c => quarantined.some(p => c.startsWith(p))), []);
});

test('KenPom/Barttorvik records are pre-tournament for every team-season', needs('data/features-kaggle.json', 'data/dataset.json'), () => {
  const k = read('data/features-kaggle.json'), d = read('data/dataset.json');
  let checked = 0, after = 0;
  for (const [y, T] of Object.entries(k.teams)) for (const [n, f] of Object.entries(T)) {
    if (f.kb_w == null) continue;
    checked++;
    if (f.kb_w > d.teams[y][n].w) after++;
  }
  assert.ok(checked > 1000);
  assert.strictEqual(after, 0, `${after} team-seasons have more wins than their Selection Sunday record`);
});

test('no single feature predicts tournament success suspiciously well', needs('data/features-kaggle.json', 'data/dataset.json'), (t) => {
  // The best honest predictors (efficiency margins) correlate about 0.6 with tournament wins.
  // A column far above that almost certainly encodes the result.
  const k = read('data/features-kaggle.json'), d = read('data/dataset.json');
  const wins = tournamentWins(d);
  const flagged = [];
  for (const c of Object.keys(k.columns)) {
    const xs = [], ys = [];
    for (const [y, T] of Object.entries(k.teams)) for (const [n, f] of Object.entries(T)) {
      if (typeof f[c] === 'number' && Number.isFinite(f[c])) { xs.push(f[c]); ys.push(wins[y + '|' + n] || 0); }
    }
    if (xs.length < 200) continue;
    const r = corr(xs, ys);
    if (Math.abs(r) > 0.8) flagged.push(`${c} r=${r.toFixed(2)}`);
  }
  t.diagnostic(`checked ${Object.keys(k.columns).length} columns`);
  assert.deepStrictEqual(flagged, []);
});

test('quarantined Heat Check WINS column: report whether it tracks actual tournament wins', needs('data/dataset.json'), (t) => {
  const fs = require('fs'), path = require('path');
  const { parseCSV } = require('../build/lib/csv');
  const { makeMatcher } = require('../build/lib/names');
  const file = path.join(__dirname, '..', 'raw', 'kaggle', 'csv', 'Heat Check Tournament Index.csv');
  if (!fs.existsSync(file)) return t.skip('Kaggle CSVs not downloaded');
  const d = read('data/dataset.json'), wins = tournamentWins(d);
  const xs = [], ys = [];
  for (const r of parseCSV(fs.readFileSync(file, 'utf8'))) {
    if (!d.teams[r.YEAR]) continue;
    const n = makeMatcher(new Set(Object.keys(d.teams[r.YEAR])))(r.TEAM, null);
    if (n && typeof r.WINS === 'number') { xs.push(r.WINS); ys.push(wins[r.YEAR + '|' + n] || 0); }
  }
  const r = corr(xs, ys);
  t.diagnostic(`Heat Check WINS vs actual tournament wins: r = ${r.toFixed(2)} over ${xs.length} team-seasons`);
  assert.ok(FILES.find(f => f.file === 'Heat Check Tournament Index.csv').role === 'quarantine' || r < 0.8,
    'WINS tracks real results: it must stay quarantined');
});

test('news timing: only text published before tip-off is pregame', () => {
  assert.strictEqual(timing('2024-03-21T20:00:00Z', '2024-03-21T23:20Z'), 'pregame');
  assert.strictEqual(timing('2024-03-22T01:00:00Z', '2024-03-21T23:20Z'), 'postgame');
  assert.strictEqual(timing(null, '2024-03-21T23:20Z'), 'postgame');
});

test('stored news items respect tip-off', (t) => {
  const fs = require('fs'), path = require('path');
  const dir = path.join(__dirname, '..', 'data', 'news');
  if (!fs.existsSync(dir)) return t.skip('no news collected yet');
  let n = 0;
  for (const f of fs.readdirSync(dir)) for (const g of Object.values(read(`data/news/${f}`).games)) for (const it of g.items || []) {
    n++;
    if (it.timing === 'pregame') assert.ok(it.published && g.tipoff && new Date(it.published) < new Date(g.tipoff), `${it.title}`);
    if (it.source === 'wikipedia' || it.source === 'espn_recap') assert.strictEqual(it.timing, 'postgame', `${it.source} must be postgame`);
  }
  t.diagnostic(`${n} news items checked`);
});

test('walk-forward never trains on the test tournament or later', () => {
  const years = [2008, 2009, 2010, 2011, 2012, 2013, 2014];
  for (const y of years) {
    const s = split(years, y);
    assert.ok(s.stageBTournaments.every(t => t < y));
    assert.ok(s.stageASeasons.every(t => t <= y));
  }
});

test('stage B inputs contain no team identity', needs('data/features-kaggle.json', 'data/dataset.json'), () => {
  const cols = columnsFor(read('data/features-kaggle.json'), CONFIG.groups, read('data/dataset.json'));
  assert.deepStrictEqual(cols.filter(c => /team_no|team_id|conf_id|quad|by_year/.test(c)), []);
});
