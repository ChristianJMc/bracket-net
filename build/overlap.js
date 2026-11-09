// Which inputs measure the same thing? Double counting makes a model lean twice on one idea, and near-duplicates
// make screening look like it found three signals when it found one. Over every tournament game:
//   - groups candidates whose A-minus-B differences correlate at |r| >= 0.9 (and 0.8) into clusters
//   - measures how much of each candidate the base model already knows (|r| with stage A's logit)
//   - checks specific pairs that could double count (seed vs home designation, elevation vs pressure, ...)
// Writes docs/overlap.md and data/overlap.json.
//   node build/overlap.js
const fs = require('fs');
const path = require('path');
const wf = require('./walkforward');
const { loadFeatures } = require('./lib/features');
const { makeHistory } = require('./lib/tourney-history');
const { gameKey } = require('./news/store');
const { NN } = require('./nn');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

function corrMasked(a, b, ma, mb) {
  let n = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) if (ma[i] && mb[i]) { n++; sa += a[i]; sb += b[i]; }
  if (n < 200) return null;
  const xa = sa / n, xb = sb / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) if (ma[i] && mb[i]) { const u = a[i] - xa, v = b[i] - xb; sab += u * v; saa += u * u; sbb += v * v; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
}

function main() {
  const dataset = read('data/dataset.json'), kaggle = loadFeatures();
  const P = read('data/walkforward-preds.json').models.stageA;
  const m = read('data/model.json'), model = { scale: m.model.scale, nets: m.model.nets.map(NN.fromJSON) };
  const ctx = { dataset, kaggle, history: makeHistory(dataset, (g) => NN.predict(model, dataset.teams[g.year][g.a], dataset.teams[g.year][g.b], 0)) };
  const cols = wf.columnsFor(kaggle, wf.CONFIG.groups, dataset);
  const games = dataset.games.filter(g => P[gameKey(g)] != null);
  const X = cols.map(() => new Float64Array(games.length)), M = cols.map(() => new Uint8Array(games.length));
  const z = new Float64Array(games.length), resid = new Float64Array(games.length), all = new Uint8Array(games.length).fill(1);
  games.forEach((g, i) => {
    const p = P[gameKey(g)]; z[i] = Math.log(p / (1 - p)); resid[i] = (g.sa > g.sb ? 1 : 0) - p;
    const r = wf.stageBRow(g, ctx, cols, z[i]);
    cols.forEach((c, j) => { X[j][i] = r.x[1 + j]; M[j][i] = r.present[j]; });
  });
  const relevance = cols.map((c, j) => Math.abs(corrMasked(X[j], resid, M[j], all) || 0));
  const known = cols.map((c, j) => corrMasked(X[j], z, M[j], all));

  const cluster = (thr) => {
    const order = cols.map((c, j) => j).sort((a, b) => relevance[b] - relevance[a]);
    const groups = [];
    for (const j of order) {
      const home = groups.find(gr => { const r = corrMasked(X[j], X[gr[0]], M[j], M[gr[0]]); return r != null && Math.abs(r) >= thr; });
      if (home) home.push(j); else groups.push([j]);
    }
    return groups;
  };
  const g90 = cluster(0.9), g80 = cluster(0.8);
  const pair = (a, b) => { const i = cols.indexOf(a), j = cols.indexOf(b); return i < 0 || j < 0 ? null : corrMasked(X[i], X[j], M[i], M[j]); };
  const PAIRS = [['seed', 'gm_designated_home', 'Seed vs listed home team (home uniforms)'], ['gm_elev_gain', 'gm_pressure_drop', 'Elevation gain vs air-pressure drop'],
    ['g_travel_miles', 'gm_crowd', 'Travel miles vs crowd proxy'], ['g_travel_miles', 'g_travel_tz', 'Travel miles vs time zones crossed'],
    ['kb_kadj_em', 'kb_badj_em', 'KenPom vs Barttorvik efficiency margin'], ['ap_preseason_rank', 'ap_preseason_votes', 'AP preseason rank vs votes'],
    ['kb_eff_hgt', 'btn_eff_hgt', 'Effective height: all games vs neutral-court games'], ['elo', 'kb_kadj_em', 'Our Elo vs KenPom'],
    ['coach_ncaa_prior', 'prog_games5', 'Coach tournament appearances vs program tournament games'], ['gm_h2h_wins', 'gm_h2h_margin', 'Head-to-head wins vs margin'],
    ['gm_body_hour', 'gm_early_body', 'Body-clock hour vs early-tip hours']];
  const pairs = PAIRS.map(([a, b, label]) => ({ a, b, label, r: pair(a, b) }));
  const out = { candidates: cols.length, games: games.length, clusters90: g90.length, clusters80: g80.length,
    biggest: g90.filter(g => g.length > 1).sort((a, b) => b.length - a.length).slice(0, 25).map(g => g.map(j => cols[j])),
    alreadyKnown: cols.map((c, j) => ({ c, r: known[j] })).filter(x => x.r != null && Math.abs(x.r) >= 0.8).sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).map(x => `${x.c} ${x.r.toFixed(2)}`),
    pairs };
  fs.writeFileSync(path.join(ROOT, 'data', 'overlap.json'), JSON.stringify(out, null, 1));
  const md = ['# Overlapping inputs', '',
    `${cols.length} candidate inputs over ${games.length} tournament games collapse into **${g90.length} groups** at |r| ≥ 0.9 and **${g80.length}** at |r| ≥ 0.8.`,
    'Inputs in one group carry nearly the same information. Screening (build/walkforward.js `selectFeatures`) now takes at most one input from a group: a candidate is skipped when it correlates at |r| ≥ 0.8 with one already chosen.', '',
    '## Pairs that could double count', '', '| Pair | r |', '|---|---|', ...pairs.map(p => `| ${p.label} (${p.a}, ${p.b}) | ${p.r == null ? 'n/a' : p.r.toFixed(2)} |`), '',
    `## Already inside the base model (|r| ≥ 0.8 with stage A's logit): ${out.alreadyKnown.length}`, '',
    'These only help if they carry something the base model does not; screening on stage A\'s misses already accounts for that.', '', out.alreadyKnown.slice(0, 40).join(', '), '',
    '## Largest groups of near-duplicates (|r| ≥ 0.9)', '', ...out.biggest.map((g, i) => `${i + 1}. ${g.join(', ')}`), ''];
  fs.writeFileSync(path.join(ROOT, 'docs', 'overlap.md'), md.join('\n'));
  console.log(`${cols.length} candidates → ${g90.length} groups (0.9), ${g80.length} (0.8); ${out.alreadyKnown.length} already known to stage A`);
  for (const p of pairs) console.log(`  ${p.label.padEnd(58)} ${p.r == null ? 'n/a' : p.r.toFixed(2)}`);
}

if (require.main === module) main();
