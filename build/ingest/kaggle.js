// Ingests the Kaggle "March Madness Data" CSVs into data/features-kaggle.json:
//   teams[year][bartName] = { "<prefix>_<column>": value, ... }   (pre-tournament features)
//   travel[year][bartName][round] = { mi, tz }                   (game-level)
//   public[year][bartName] = { R64: pct, ... }                   (labels unpopular wins; never a feature)
//   conf[year][bartName] = 'ACC'                                 (for segmenting games)
// plus a coverage report. Outcome columns and quarantined files never reach the feature table.
const fs = require('fs');
const path = require('path');
const { parseCSV } = require('../lib/csv');
const { makeMatcher } = require('../lib/names');
const { FILES, OUTCOME_COLUMNS, ROUND_CODE, kindOf } = require('./kaggle-files');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'raw', 'kaggle', 'csv');

function slug(col) {
  return col.toLowerCase().replace(/%/g, 'pct').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// Kaggle spells some schools differently from Barttorvik.
const KAGGLE_ALIASES = { 'North Carolina St.': 'N.C. State', 'College of Charleston': 'Charleston', 'Prarie View A&M': 'Prairie View A&M', 'Texas A&M Corpus Christi': 'Texas A&M Corpus Chris',
  'Louisiana Lafayette': ['Louisiana Lafayette', 'Louisiana'], 'Detroit': 'Detroit Mercy', 'LIU Brooklyn': 'LIU',
  'Cal St. Bakersfield': 'Cal St. Bakersfield', 'Arkansas Little Rock': 'Little Rock', 'Miami (FL)': 'Miami FL', 'Miami (OH)': 'Miami OH',
  'Saint Francis (PA)': 'Saint Francis', 'Southeast Missouri St': 'Southeast Missouri St.', 'Mississippi Valley St': 'Mississippi Valley St.' };

function ingest({ dataset, dir = DIR } = {}) {
  dataset = dataset || JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dataset.json'), 'utf8'));
  const field = {};
  for (const y of dataset.years) field[y] = new Set(Object.keys(dataset.teams[y]));
  const matchers = {};
  const resolve = (year, name) => {
    if (!field[year]) return null;
    matchers[year] = matchers[year] || makeMatcher(field[year]);
    const alias = [].concat(KAGGLE_ALIASES[name] || []).find(n => field[year].has(n));
    return alias || matchers[year](String(name), null);
  };
  const out = { teams: {}, travel: {}, public: {}, columns: {}, coverage: [], quarantined: [], unmatched: [] };
  const put = (year, team, key, value) => {
    ((out.teams[year] = out.teams[year] || {})[team] = out.teams[year][team] || {})[key] = value;
  };
  const teamConf = {}; // year -> team -> conference, from the KenPom file

  for (const spec of FILES) {
    const file = path.join(dir, spec.file);
    if (!fs.existsSync(file)) { out.coverage.push({ file: spec.file, missing: true }); continue; }
    if (spec.role === 'quarantine' || spec.role === 'labels') { out.quarantined.push({ file: spec.file, reason: spec.note || spec.role }); continue; }
    const rows = parseCSV(fs.readFileSync(file, 'utf8'));
    const cols = Object.keys(rows[0] || {}).filter(c => !OUTCOME_COLUMNS.test(c) && !/^(W|L|AP VOTES|AP RANK)$/.test(c) || spec.role === 'team_season' && /^(W|L)$/.test(c));
    const stats = { file: spec.file, role: spec.role, rows: rows.length, matched: 0, years: {} };

    if (spec.role === 'team_season') {
      for (const r of rows) {
        const team = resolve(r.YEAR, r.TEAM);
        if (!team) { if (field[r.YEAR]) out.unmatched.push(`${spec.file}: ${r.YEAR} ${r.TEAM}`); continue; }
        stats.matched++; stats.years[r.YEAR] = (stats.years[r.YEAR] || 0) + 1;
        if (r.CONF) (teamConf[r.YEAR] = teamConf[r.YEAR] || {})[team] = r.CONF;
        for (const c of cols) if (typeof r[c] === 'number') {
          const key = `${spec.prefix}_${slug(c)}`;
          out.columns[key] = out.columns[key] || { file: spec.file, column: c, source: spec.source, kind: kindOf(spec, c) };
          put(r.YEAR, team, key, r[c]);
        }
      }
      // Flag files list only the teams that got a flag: an unlisted team in a covered season is a 0, not missing.
      if (spec.unlistedIs != null) {
        const keys = Object.keys(out.columns).filter(c => out.columns[c].file === spec.file);
        for (const [y, n] of Object.entries(stats.years)) {
          if (n < (spec.minRowsPerYear || 1) || !field[y]) continue;
          for (const team of Object.keys(dataset.teams[y] || {})) for (const key of keys) {
            const T = (out.teams[y] = out.teams[y] || {})[team] = out.teams[y][team] || {};
            if (T[key] == null) T[key] = spec.unlistedIs;
          }
        }
      }
    } else if (spec.role === 'ap_poll') {
      // The file's last week each season is the post-tournament poll. Keep only weeks where no team's
      // record is past its Selection Sunday record.
      const byYear = {};
      for (const r of rows) (byYear[r.YEAR] = byYear[r.YEAR] || []).push(r);
      for (const [y, list] of Object.entries(byYear)) {
        const weeks = [...new Set(list.map(r => r.WEEK))].sort((a, b) => a - b);
        const ok = weeks.filter(wk => list.filter(r => r.WEEK === wk).every(r => {
          const t = resolve(+y, r.TEAM); const pre = t && dataset.teams[y][t];
          return !pre || r.W == null || r.W <= pre.w;
        }));
        const lastWeek = Math.max(...ok), firstWeek = Math.min(...weeks);
        stats.years[y] = { weeks: weeks.length, usableThrough: lastWeek };
        const teams = {};
        for (const r of list) {
          if (r.WEEK > lastWeek) continue;
          const t = resolve(+y, r.TEAM); if (!t) continue;
          (teams[t] = teams[t] || []).push(r);
        }
        for (const t of field[y] || []) {
          const wks = (teams[t] || []).sort((a, b) => a.WEEK - b.WEEK);
          const rank = (r) => (r && r['AP RANK'] ? r['AP RANK'] : 26);
          const pre = wks.find(r => r.WEEK === firstWeek), fin = wks.find(r => r.WEEK === lastWeek);
          put(+y, t, 'ap_preseason_rank', rank(pre));
          put(+y, t, 'ap_preseason_votes', pre ? pre['AP VOTES'] || 0 : 0);
          put(+y, t, 'ap_final_rank', rank(fin));
          put(+y, t, 'ap_final_votes', fin ? fin['AP VOTES'] || 0 : 0);
          put(+y, t, 'ap_peak_rank', Math.min(26, ...wks.map(rank)));
          put(+y, t, 'ap_weeks_ranked', wks.filter(r => r['AP RANK'] && r['AP RANK'] <= 25).length);
          stats.matched++;
        }
      }
      for (const k of ['ap_preseason_rank', 'ap_preseason_votes', 'ap_final_rank', 'ap_final_votes', 'ap_peak_rank', 'ap_weeks_ranked'])
        out.columns[k] = { file: spec.file, column: k, source: spec.source, kind: 'opinion' };
    } else if (spec.role === 'conference') {
      const conf = {};
      for (const r of rows) (conf[r.YEAR] = conf[r.YEAR] || {})[r.CONF] = r;
      out._conf = out._conf || [];
      out._conf.push({ spec, conf, cols });
    } else if (spec.role === 'travel') {
      for (const r of rows) {
        const team = resolve(r.YEAR, r.TEAM); const rd = ROUND_CODE[r['CURRENT ROUND']];
        if (!team || rd == null) continue;
        stats.matched++;
        (((out.travel[r.YEAR] = out.travel[r.YEAR] || {})[team] = out.travel[r.YEAR][team] || {}))[rd] =
          { mi: r['DISTANCE (MI)'], tz: r['TIME ZONES CROSSED VALUE'] };
      }
    } else if (spec.role === 'public') {
      for (const r of rows) {
        const team = resolve(r.YEAR, r.TEAM); if (!team) continue;
        stats.matched++;
        (out.public[r.YEAR] = out.public[r.YEAR] || {})[team] = { R64: r.R64, R32: r.R32, S16: r.S16, E8: r.E8, F4: r.F4, FINALS: r.FINALS };
      }
    }
    out.coverage.push(stats);
  }

  // Conference tables join through each team's conference (taken from the KenPom file).
  for (const { spec, conf, cols } of out._conf || []) {
    for (const [y, teams] of Object.entries(teamConf)) for (const [t, c] of Object.entries(teams)) {
      const r = conf[y] && conf[y][c]; if (!r) continue;
      for (const col of cols) if (typeof r[col] === 'number' && !/^(G|W|L)$/.test(col)) {
        const key = `${spec.prefix}_${slug(col)}`;
        out.columns[key] = out.columns[key] || { file: spec.file, column: col, source: spec.source, kind: kindOf(spec, col) };
        put(+y, t, key, r[col]);
      }
    }
  }
  delete out._conf;
  out.conf = teamConf; // year -> team -> conference abbreviation, for segmenting games
  return out;
}

if (require.main === module) {
  const out = ingest();
  fs.writeFileSync(path.join(ROOT, 'data', 'features-kaggle.json'), JSON.stringify(out));
  const nTeams = Object.values(out.teams).reduce((s, t) => s + Object.keys(t).length, 0);
  console.log(`features: ${Object.keys(out.columns).length} columns for ${nTeams} team-seasons`);
  for (const c of out.coverage) if (!c.missing) console.log(`  ${c.file}: ${c.matched}/${c.rows} rows matched`);
  console.log(`quarantined: ${out.quarantined.map(q => q.file).join(', ')}`);
  console.log(`unmatched rows: ${out.unmatched.length}`, out.unmatched.slice(0, 15));
}

module.exports = { ingest, slug };
