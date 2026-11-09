// Player box scores (ESPN, via the sportsdataverse data releases) → roster features for every tournament team.
// Only games before the team's first NCAA tournament game count, so every number was knowable on Selection Sunday.
// Writes data/features-players.json in the same shape as the other data/features-*.json files.
//
//   node build/ingest/players.mjs            download what's missing (hash-pinned in sources/lock.json), then build
//
// What it measures (all counted from box scores, kind "stat"):
//   pl_star_pts_share     top scorer's share of team points: one-man teams are fragile and streaky
//   pl_top3_pts_share     top three scorers' share
//   pl_bench_min_share    minutes outside the five biggest-minute players: depth, foul-trouble insurance
//   pl_rotation           players averaging 10+ minutes
//   pl_continuity         share of minutes from players who played for this team last season
//   pl_transfer_share     share of minutes from players who played for another D-I team last season
//   pl_experience         minutes-weighted prior seasons in D-I box scores (capped at 3 so every era is comparable)
//   pl_avail_last3        how much of their usual minutes the top five played in the last 3 games before the tournament:
//                         a box-score injury signal that needs no news (1 = everyone playing as usual)
//   pl_top3_absent_last   how many of the top three by minutes missed the last game before the tournament
//   pl_lineup_stability   how often the usual starting five started
//   pl_guard_share        share of minutes played by guards
//   pl_box_coverage       share of the team's games that have player box scores (low coverage → features left out)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { parquetReadObjects } from 'hyparquet';

const require = createRequire(import.meta.url);
const { download } = require('../lib/safe-fetch');
const { makeMatcher, linkHint } = require('../lib/names');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const URL_OF = (y) => `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_mens_college_basketball_player_boxscores/player_box_${y}.parquet`;
const FILE_OF = (y) => path.join(ROOT, 'raw', 'players', `player_box_${y}.parquet`);
const COLS = ['game_id', 'season_type', 'game_date', 'athlete_id', 'team_id', 'team_location', 'team_display_name',
  'minutes', 'points', 'starter', 'did_not_play', 'athlete_position_abbreviation'];
const MIN_COVERAGE = 0.6;
const FIRST_HISTORY_YEAR = 2005; // the releases start in earnest here

export const COLUMNS = ['pl_star_pts_share', 'pl_top3_pts_share', 'pl_bench_min_share', 'pl_rotation', 'pl_continuity',
  'pl_transfer_share', 'pl_experience', 'pl_avail_last3', 'pl_top3_absent_last', 'pl_lineup_stability', 'pl_guard_share', 'pl_box_coverage'];

async function readSeason(year) {
  await download(URL_OF(year), FILE_OF(year), { maxBytes: 40e6 });
  const buf = fs.readFileSync(FILE_OF(year));
  const file = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  // Later seasons are ZSTD-compressed; Node has a built-in decoder, so no extra dependency.
  const compressors = { ZSTD: (input) => new Uint8Array(zlib.zstdDecompressSync(input)) };
  return parquetReadObjects({ file, columns: COLS, compressors });
}

// Who played for whom in a season, by ESPN athlete and team id (regular season and postseason both count here,
// since this only feeds the *next* season's continuity and experience).
function rosterOf(rows) {
  const m = new Map(); // athlete -> Map(team -> minutes)
  for (const r of rows) {
    if (r.did_not_play || !(r.minutes > 0)) continue;
    const t = m.get(r.athlete_id) || m.set(r.athlete_id, new Map()).get(r.athlete_id);
    t.set(r.team_id, (t.get(r.team_id) || 0) + r.minutes);
  }
  return m;
}

function teamFeatures(rows, prevRoster, seasonsPlayed, teamGamesExpected) {
  const games = [...new Set(rows.map(r => r.game_id))];
  const dateOf = new Map(rows.map(r => [r.game_id, +r.game_date]));
  games.sort((a, b) => dateOf.get(a) - dateOf.get(b));
  const coverage = teamGamesExpected ? Math.min(1, games.length / teamGamesExpected) : 0;
  const players = new Map();
  for (const r of rows) {
    const p = players.get(r.athlete_id) || players.set(r.athlete_id, { id: r.athlete_id, min: 0, pts: 0, pos: r.athlete_position_abbreviation, byGame: new Map(), starts: new Set() }).get(r.athlete_id);
    const mins = r.did_not_play ? 0 : (r.minutes || 0);
    p.min += mins; p.pts += r.points || 0;
    p.byGame.set(r.game_id, mins);
    if (r.starter) p.starts.add(r.game_id);
  }
  const list = [...players.values()];
  const totMin = list.reduce((s, p) => s + p.min, 0), totPts = list.reduce((s, p) => s + p.pts, 0);
  if (!totMin || !totPts || games.length < 8) return { pl_box_coverage: coverage };
  const byMin = [...list].sort((a, b) => b.min - a.min), byPts = [...list].sort((a, b) => b.pts - a.pts);
  const share = (f) => list.reduce((s, p) => s + (f(p) ? p.min : 0), 0) / totMin;
  const top5 = byMin.slice(0, 5), top3 = byMin.slice(0, 3);
  const last3 = games.slice(-3), lastG = games[games.length - 1];
  const avail = top5.reduce((s, p) => {
    const usual = p.min / games.length;
    const recent = last3.reduce((q, g) => q + (p.byGame.get(g) || 0), 0) / last3.length;
    return s + p.min * Math.min(usual ? recent / usual : 1, 1.25);
  }, 0) / top5.reduce((s, p) => s + p.min, 0);
  // The usual starting five: the five players with the most starts.
  const usualFive = new Set([...list].sort((a, b) => b.starts.size - a.starts.size).slice(0, 5).map(p => p.id));
  const stability = games.reduce((s, g) => s + list.filter(p => p.starts.has(g) && usualFive.has(p.id)).length / 5, 0) / games.length;
  const prevTeam = (p) => { const t = prevRoster && prevRoster.get(p.id); if (!t) return null; return [...t.entries()].sort((a, b) => b[1] - a[1])[0][0]; };
  const teamId = rows[0].team_id;
  return {
    pl_star_pts_share: byPts[0].pts / totPts,
    pl_top3_pts_share: byPts.slice(0, 3).reduce((s, p) => s + p.pts, 0) / totPts,
    pl_bench_min_share: 1 - top5.reduce((s, p) => s + p.min, 0) / totMin,
    pl_rotation: list.filter(p => p.min / games.length >= 10).length,
    pl_continuity: prevRoster ? share(p => prevRoster.get(p.id) && prevRoster.get(p.id).has(teamId)) : null,
    pl_transfer_share: prevRoster ? share(p => { const t = prevTeam(p); return t != null && t !== teamId; }) : null,
    pl_experience: list.reduce((s, p) => s + p.min * Math.min(3, seasonsPlayed.get(p.id) || 0), 0) / totMin,
    pl_avail_last3: avail,
    pl_top3_absent_last: top3.filter(p => !(p.byGame.get(lastG) > 0)).length,
    pl_lineup_stability: stability,
    pl_guard_share: share(p => /G/.test(p.pos || '')),
    pl_box_coverage: coverage,
  };
}

export async function ingest({ log = console.log } = {}) {
  const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dataset.json'), 'utf8'));
  const out = { about: 'Roster features from ESPN player box scores; games before each team\'s first NCAA tournament game only.',
    teams: {}, columns: {}, coverage: {}, unmatched: [] };
  // pl_box_coverage is a data-quality note, not an input.
  for (const c of COLUMNS.filter(c => c !== 'pl_box_coverage')) out.columns[c] = { file: 'player_box', column: c, source: 'espn_player_box', kind: 'stat' };
  const seasonsPlayed = new Map(); // athlete -> seasons with minutes, before the current one
  let prevRoster = null;
  const last = Math.max(...dataset.years);
  for (let y = FIRST_HISTORY_YEAR; y <= last; y++) {
    // 2020 had no tournament but its season still feeds continuity and experience for 2021.
    const rows = await readSeason(y);
    if (dataset.teams[y]) {
      const start = Math.min(...dataset.games.filter(g => g.year === y && g.date).map(g => Date.parse(g.date)));
      const pre = rows.filter(r => +r.game_date < start && r.season_type !== 3);
      // Map ESPN team ids to Barttorvik names for this year's field.
      const field = new Set(Object.keys(dataset.teams[y]));
      const match = makeMatcher(field);
      const idOf = new Map();
      // Strict: the school name (or a nickname hint for Miami / Loyola / USC), never a loose prefix match.
      for (const r of pre) if (!idOf.has(r.team_id)) {
        const hint = linkHint(r.team_display_name);
        idOf.set(r.team_id, hint ? (field.has(hint) ? hint : null) : match(r.team_location || ''));
      }
      const byName = new Map();
      for (const [id, name] of idOf) if (name) (byName.get(name) || byName.set(name, []).get(name)).push(id);
      out.teams[y] = {};
      let used = 0;
      for (const name of field) {
        const ids = byName.get(name) || [];
        if (ids.length !== 1) { out.unmatched.push(`${y} ${name}: ${ids.length} ESPN ids`); continue; }
        const T = dataset.teams[y][name];
        const f = teamFeatures(pre.filter(r => r.team_id === ids[0]), prevRoster, seasonsPlayed, T.w + T.l);
        if (f.pl_box_coverage < MIN_COVERAGE) { out.teams[y][name] = { pl_box_coverage: f.pl_box_coverage }; continue; }
        out.teams[y][name] = f; used++;
      }
      out.coverage[y] = { field: field.size, withFeatures: used };
      log(`${y}: ${rows.length} player rows, ${used}/${field.size} tournament teams with features`);
    }
    const roster = rosterOf(rows);
    for (const id of roster.keys()) seasonsPlayed.set(id, (seasonsPlayed.get(id) || 0) + 1);
    prevRoster = roster;
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'features-players.json'), JSON.stringify(out));
  if (out.unmatched.length) log('UNMATCHED:\n' + out.unmatched.join('\n'));
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await ingest();
