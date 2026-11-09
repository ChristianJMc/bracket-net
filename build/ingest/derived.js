// Engineered inputs: combinations of existing columns that express an idea no single column does.
// Writes data/features-derived.json. All are built from pre-tournament values only.
//   dv_home_boost      home efficiency minus away efficiency (Barttorvik splits): how much a team's rating leans on
//                      its home floor. Altitude programs and loud arenas inflate season ratings this way, and the
//                      tournament is played away from home.
//   dv_neutral_gap     neutral-court efficiency minus overall efficiency: how the team actually played on neutral floors
//   dv_road_gap        away + neutral efficiency minus overall efficiency
//   dv_tr_home_boost   the same home-minus-away idea from TeamRankings' ratings (a second, independent calculation)
//   dv_campus_elev     campus elevation in km (the altitude part of the home boost; Open-Meteo via build/ingest/gamesite.js)
//   node build/ingest/derived.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

function build({ log = console.log } = {}) {
  const k = read('data/features-kaggle.json');
  const ctxFile = path.join(ROOT, 'data', 'features-gamectx.json');
  const gctx = fs.existsSync(ctxFile) ? read('data/features-gamectx.json') : { games: {} };
  // Campus elevation per team-year from any of that team's tournament games.
  const elev = {};
  for (const [key, G] of Object.entries(gctx.games)) {
    const y = +key.slice(0, 4);
    for (const [team, v] of Object.entries(G)) if (Number.isFinite(v.gm_campus_elev)) (elev[y] = elev[y] || {})[team] = v.gm_campus_elev;
  }
  const out = { about: 'Engineered combinations of existing pre-tournament columns.', teams: {}, columns: {} };
  const cols = { dv_home_boost: 'rating', dv_neutral_gap: 'rating', dv_road_gap: 'rating', dv_tr_home_boost: 'rating', dv_campus_elev: 'stat' };
  for (const [c, kind] of Object.entries(cols)) out.columns[c] = { file: 'derived', column: c, source: 'derived', kind };
  const d = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? a - b : null);
  let n = 0;
  for (const [y, T] of Object.entries(k.teams)) {
    out.teams[y] = {};
    for (const [team, v] of Object.entries(T)) {
      out.teams[y][team] = {
        dv_home_boost: d(v.bth_badj_em, v.bta_badj_em),
        dv_neutral_gap: d(v.btn_badj_em, v.kb_badj_em),
        dv_road_gap: d(v.btan_badj_em, v.kb_badj_em),
        dv_tr_home_boost: d(v.trh_tr_rating, v.tra_tr_rating),
        dv_campus_elev: (elev[y] || {})[team] ?? null,
      };
      n++;
    }
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'features-derived.json'), JSON.stringify(out));
  log(`derived features for ${n} team-seasons`);
  return out;
}

if (require.main === module) build();
module.exports = { build };
