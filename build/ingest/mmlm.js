// Kaggle "March Machine Learning Mania" competition files → Massey ordinals: dozens of independent computer rating
// systems, frozen at Selection Sunday. Writes data/features-massey.json. Skips quietly until the files exist.
//
// Getting the files (needs your own free Kaggle account; the pipeline never logs in for you):
//   kaggle.com → March Machine Learning Mania (current year) → Data → accept the rules → Download All,
//   then unzip the CSVs into raw/mmlm/. Re-run `node build/pipeline.js --full`.
//
// From MMasseyOrdinals.csv (Season, RankingDayNum, SystemName, TeamID, OrdinalRank), for each season the last ranking
// each system published on or before day 133 (Selection Sunday is day 132; the tournament starts after):
//   ms_median_rank   median rank across computer systems (the consensus)
//   ms_mean_logrank  mean of log(rank): the consensus with the long tail of low ranks compressed
//   ms_best_rank, ms_worst_rank, ms_rank_sd   how much the systems disagree about a team
//   ms_n_systems     how many systems rated the team
//   ms_poll_rank     human polls (AP, USA Today/coaches), kept apart and tagged opinion
//   ms_sys_<NAME>    the long-running individual systems that cover nearly every season
// Team names come from MTeamSpellings.csv; unmatched teams are listed, never guessed.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { parseCSV } = require('../lib/csv');
const { norm, ALIASES } = require('../lib/names');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'raw', 'mmlm');
const CUTOFF_DAY = 133;
const POLLS = new Set(['AP', 'USA']);
const MIN_SEASON_COVERAGE = 0.9; // an individual system becomes its own column only if it covers 90% of our seasons

async function readOrdinals(file, seasons) {
  // Last ranking per (season, system) on or before the cutoff. The file is large, so stream it.
  const lastDay = new Map(), ranks = new Map(); // "season|sys" -> day ; "season|sys|team" -> { day, rank }
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    if (!header) { header = line.replace(/^﻿/, '').split(','); continue; }
    const [season, day, sys, team, rank] = line.split(',');
    const s = +season, d = +day;
    if (!seasons.has(s) || !(d <= CUTOFF_DAY)) continue;
    const k = `${s}|${sys}`;
    if (!lastDay.has(k) || d > lastDay.get(k)) lastDay.set(k, d);
    const t = `${k}|${team}`, prev = ranks.get(t);
    if (!prev || d >= prev.day) ranks.set(t, { day: d, rank: +rank });
  }
  const out = {}; // season -> teamId -> { sys: rank }
  for (const [t, v] of ranks) {
    const [s, sys, team] = t.split('|');
    if (v.day !== lastDay.get(`${s}|${sys}`)) continue; // only each system's final pre-tournament list
    ((out[s] = out[s] || {})[team] = out[s][team] || {})[sys] = v.rank;
  }
  return out;
}

function spellingMap(file) {
  const m = new Map();
  for (const r of parseCSV(fs.readFileSync(file, 'utf8'))) m.set(norm(String(r.TeamNameSpelling)), String(r.TeamID));
  return m;
}

function teamId(name, spell) {
  const k = norm(name);
  if (spell.has(k)) return spell.get(k);
  for (const [alias, target] of Object.entries(ALIASES)) if ([].concat(target).includes(name) && spell.has(norm(alias))) return spell.get(norm(alias));
  return null;
}

async function build({ log = console.log, dir = DIR, dataset = null, write = true } = {}) {
  const ord = path.join(dir, 'MMasseyOrdinals.csv'), sp = path.join(dir, 'MTeamSpellings.csv');
  if (!fs.existsSync(ord) || !fs.existsSync(sp)) { log(`no Kaggle competition files in ${path.relative(ROOT, dir) || dir}; skipping (see the header of build/ingest/mmlm.js)`); return null; }
  dataset = dataset || JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dataset.json'), 'utf8'));
  const seasons = new Set(dataset.years.map(Number));
  const ranks = await readOrdinals(ord, seasons), spell = spellingMap(sp);
  // Which individual systems run nearly every season.
  const seasonsOf = {};
  for (const [s, T] of Object.entries(ranks)) for (const R of Object.values(T)) for (const sys of Object.keys(R)) (seasonsOf[sys] = seasonsOf[sys] || new Set()).add(s);
  const longRunning = Object.keys(seasonsOf).filter(sys => !POLLS.has(sys) && seasonsOf[sys].size >= MIN_SEASON_COVERAGE * seasons.size).sort();
  const out = { about: 'Massey ordinals at Selection Sunday (Kaggle March Machine Learning Mania).', teams: {}, columns: {}, systems: longRunning, unmatched: [] };
  const col = (c, kind) => { out.columns[c] = { file: 'MMasseyOrdinals', column: c, source: 'kaggle_mmlm', kind }; };
  for (const c of ['ms_median_rank', 'ms_mean_logrank', 'ms_best_rank', 'ms_worst_rank', 'ms_rank_sd', 'ms_n_systems']) col(c, 'rating');
  col('ms_poll_rank', 'opinion');
  for (const sys of longRunning) col(`ms_sys_${sys.toLowerCase()}`, 'rating');
  for (const y of dataset.years) {
    out.teams[y] = {};
    for (const name of Object.keys(dataset.teams[y])) {
      const id = teamId(name, spell);
      const R = id && ranks[y] && ranks[y][id];
      if (!R) { out.unmatched.push(`${y} ${name}${id ? ' (no rankings)' : ''}`); continue; }
      const comp = Object.entries(R).filter(([sys]) => !POLLS.has(sys)).map(([, r]) => r).sort((a, b) => a - b);
      if (!comp.length) continue;
      const mean = comp.reduce((s, v) => s + v, 0) / comp.length;
      const polls = Object.entries(R).filter(([sys]) => POLLS.has(sys)).map(([, r]) => r);
      const v = {
        ms_median_rank: comp.length % 2 ? comp[comp.length >> 1] : (comp[comp.length / 2 - 1] + comp[comp.length / 2]) / 2,
        ms_mean_logrank: comp.reduce((s, r) => s + Math.log(r), 0) / comp.length,
        ms_best_rank: comp[0], ms_worst_rank: comp[comp.length - 1],
        ms_rank_sd: Math.sqrt(comp.reduce((s, r) => s + (r - mean) ** 2, 0) / comp.length),
        ms_n_systems: comp.length,
        ms_poll_rank: polls.length ? Math.min(...polls) : null,
      };
      for (const sys of longRunning) v[`ms_sys_${sys.toLowerCase()}`] = R[sys] ?? null;
      out.teams[y][name] = v;
    }
  }
  if (write) fs.writeFileSync(path.join(ROOT, 'data', 'features-massey.json'), JSON.stringify(out));
  log(`Massey ordinals: ${Object.values(out.teams).reduce((s, T) => s + Object.keys(T).length, 0)} team-seasons, ${longRunning.length} long-running systems (${longRunning.join(', ')})` +
    (out.unmatched.length ? `; unmatched: ${out.unmatched.slice(0, 10).join('; ')}${out.unmatched.length > 10 ? ' …' : ''}` : ''));
  return out;
}

if (require.main === module) build().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { build, readOrdinals, CUTOFF_DAY };
