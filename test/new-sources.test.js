// Player box scores, Elo and schedule: coverage, sane ranges, and nothing from the tournament itself.
const test = require('node:test');
const assert = require('node:assert');
const { read, needs } = require('./helpers');

test('roster features cover the field and stay in range', needs('data/features-players.json', 'data/dataset.json'), () => {
  const p = read('data/features-players.json'), d = read('data/dataset.json');
  let teams = 0, with_ = 0;
  for (const y of d.years) for (const t of Object.keys(d.teams[y])) {
    teams++;
    const f = (p.teams[y] || {})[t];
    if (!f || f.pl_star_pts_share == null) continue;
    with_++;
    for (const c of ['pl_star_pts_share', 'pl_top3_pts_share', 'pl_bench_min_share', 'pl_lineup_stability', 'pl_guard_share'])
      assert.ok(f[c] >= 0 && f[c] <= 1, `${y} ${t} ${c} ${f[c]}`);
    assert.ok(f.pl_top3_pts_share >= f.pl_star_pts_share);
    assert.ok(f.pl_avail_last3 > 0 && f.pl_avail_last3 <= 1.25);
    assert.ok(f.pl_experience >= 0 && f.pl_experience <= 3);
  }
  assert.ok(with_ / teams > 0.97, `${with_}/${teams}`);
  assert.ok(!('pl_box_coverage' in p.columns), 'coverage is a data-quality note, not an input');
});

test('roster features come only from games before the tournament', needs('data/features-players.json'), () => {
  // 2024 Purdue reached the final; Zach Edey's pre-tournament share was ~29%. If tournament games had leaked in,
  // his 6 big games would push the team's game count and change the share. Spot-check stable known values instead:
  const p = read('data/features-players.json');
  const purdue = p.teams[2024].Purdue;
  assert.ok(purdue.pl_star_pts_share > 0.27 && purdue.pl_star_pts_share < 0.31);
  assert.strictEqual(purdue.pl_box_coverage, 1);
});

test('Elo covers every tournament team-season', needs('data/features-elo.json', 'data/dataset.json'), () => {
  const e = read('data/features-elo.json'), d = read('data/dataset.json');
  assert.ok(e.settings.K > 0 && e.settings.carry > 0 && e.settings.carry < 1);
  for (const y of d.years) for (const t of Object.keys(d.teams[y])) assert.ok(Number.isFinite(e.teams[y][t].elo), `${y} ${t}`);
});

test('Elo snapshots ignore the tournament they precede: flipping every 2024 NCAA result changes nothing', needs('data/features-elo.json', 'data/dataset.json', 'raw/sked2024.json'), () => {
  const { runElo, load } = require('../build/ingest/elo');
  const e = read('data/features-elo.json'), d = read('data/dataset.json');
  const seasons = load([2023, 2024]);
  const start = Math.min(...d.games.filter(g => g.year === 2024).map(g => Date.parse(g.date)));
  const field = new Set(Object.keys(d.teams[2024]));
  const snap = (flip) => {
    let at = null;
    const ss = seasons.map(s => ({ year: s.year, games: s.games.map(g => (flip && s.year === 2024 && g.date >= start - 43200e3 && field.has(g.t1) && field.has(g.t2)
      ? { ...g, b1: g.b2, b2: g.b1 } : g)) }));
    runElo(ss, e.settings, { beforeGame: (g, R) => { if (!at && ss[1].games.includes(g) && g.date >= start - 43200e3) at = new Map(R); } });
    return at;
  };
  const a = snap(false), b = snap(true);
  for (const t of ['Connecticut', 'Purdue', 'N.C. State']) assert.strictEqual(a.get(t), b.get(t), t);
});

test('schedule features end before each team\'s first NCAA game', needs('data/features-schedule.json', 'data/dataset.json'), () => {
  const s = read('data/features-schedule.json'), d = read('data/dataset.json');
  for (const y of d.years) for (const t of Object.keys(d.teams[y])) {
    const first = d.games.filter(g => g.year === y && (g.a === t || g.b === t) && g.date).map(g => g.date).sort()[0];
    const last = (s.lastGame[y] || {})[t];
    if (!first || !last) continue;
    assert.ok(last < first, `${y} ${t}: last pre-tournament game ${last} vs first NCAA game ${first}`);
    assert.ok(s.teams[y][t].sch_rest_pre >= 1);
  }
});

test('all feature files merge without column clashes', needs('data/features-kaggle.json'), () => {
  const k = require('../build/lib/features').loadFeatures();
  for (const f of ['features-kaggle.json', 'features-players.json', 'features-elo.json', 'features-schedule.json']) assert.ok(k.sources.includes(f), f);
  for (const [c, m] of Object.entries(k.columns)) assert.ok(['stat', 'rating', 'projection', 'hybrid', 'opinion'].includes(m.kind), c);
});

test('Massey ordinals: last list before Selection Sunday, polls kept apart, unknown teams reported', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { build } = require('../build/ingest/mmlm');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmlm-'));
  try {
    fs.writeFileSync(path.join(dir, 'MTeamSpellings.csv'), 'TeamNameSpelling,TeamID\nconnecticut,1163\nuconn,1163\npurdue,1345\nn.c. state,1301\n');
    fs.writeFileSync(path.join(dir, 'MMasseyOrdinals.csv'), [
      'Season,RankingDayNum,SystemName,TeamID,OrdinalRank',
      '2024,120,POM,1163,3', '2024,133,POM,1163,1', '2024,133,POM,1345,2', '2024,133,POM,1301,40',
      '2024,128,SAG,1163,2', '2024,128,SAG,1345,1', '2024,128,SAG,1301,60',
      '2024,140,SAG,1163,99', // after Selection Sunday: must be ignored (it would leak the tournament)
      '2024,133,AP,1163,1', '2024,133,AP,1345,3',
    ].join('\n'));
    const dataset = { years: [2024], teams: { 2024: { Connecticut: {}, Purdue: {}, 'N.C. State': {}, 'Nowhere St.': {} } } };
    const out = await build({ dir, dataset, write: false, log: () => {} });
    const U = out.teams[2024].Connecticut, N = out.teams[2024]['N.C. State'];
    assert.strictEqual(U.ms_median_rank, 1.5, 'POM day 133 (1) and SAG day 128 (2); the day-140 list is ignored');
    assert.strictEqual(U.ms_n_systems, 2);
    assert.strictEqual(U.ms_poll_rank, 1, 'AP is a poll: kept as its own opinion column');
    assert.strictEqual(N.ms_poll_rank, null);
    assert.strictEqual(out.columns.ms_poll_rank.kind, 'opinion');
    assert.strictEqual(out.columns.ms_median_rank.kind, 'rating');
    assert.ok(out.unmatched.some(u => /Nowhere St/.test(u)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
