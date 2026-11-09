// Context around each tournament game, beyond the teams' season stats. Writes data/features-gamectx.json with
// per-game, per-team values (so a difference A minus B is meaningful for every column):
//   gm_elev_gain        game-site elevation minus campus elevation (km): playing high above home
//   gm_campus_elev      campus elevation (km): altitude-acclimated programs (BYU, Utah St., Colorado, New Mexico...)
//   gm_pressure_drop    usual air pressure at campus minus the site's pressure at tip-off (hPa / 10)
//   gm_body_hour        tip-off time on the team's body clock (hour, home time zone)
//   gm_early_body       hours before 2 p.m. body-clock time (a 12:15 ET tip is 9:15 for a Pacific team)
//   gm_crowd            attendance (10,000s) x closeness to campus: who the crowd is likely to be for
//   gm_designated_home  listed as the home team (better seed: home uniforms, home bench); a proxy for jersey colour
//   gm_h2h_wins         wins over this opponent earlier this season (conference rivals meet 2-3 times)
//   gm_h2h_margin       average margin in those meetings
//   gm_common_opp       average margin against opponents both teams played this season, home edge removed:
//                       a direct comparison that doesn't rely on the rating model's opponent adjustment
// Sources: ESPN scoreboards (tip time, venue, attendance, home/away), the Kaggle locations file (coordinates,
// time zones), Open-Meteo (elevation; hourly surface pressure from its historical archive), Barttorvik game files.
// Floors and actual jersey colours are not recorded anywhere usable: tournament floors are a single NCAA design.
//   node build/ingest/gamesite.js
const fs = require('fs');
const path = require('path');
const { cachedJSON, gameKey } = require('../news/store');
const { makeMatcher } = require('../lib/names');
const { parseCSV } = require('../lib/csv');
const { seasonGames } = require('../lib/sked');
const { ROUND_CODE } = require('./kaggle-files');

const ROOT = path.join(__dirname, '..', '..');
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';
const DAY = 86400e3;
// UTC offset during the tournament (daylight saving time is always in effect by then), by Kaggle time-zone name.
const UTC_OFFSET = { Eastern: -4, Central: -5, Mountain: -6, Pacific: -7, Alaska: -8, Hawaii: -10 };
const offsetOf = (zone, dst) => (UTC_OFFSET[zone] == null ? null : UTC_OFFSET[zone] - (dst === 0 && zone !== 'Hawaii' ? 1 : 0));
// Standard-atmosphere pressure at an elevation (m), in hPa.
const stdPressure = (m) => 1013.25 * Math.pow(1 - 2.25577e-5 * m, 5.25588);
const key3 = (lat, lon) => `${(+lat).toFixed(3)},${(+lon).toFixed(3)}`;

async function elevations(coords) {
  const out = {}, list = [...coords];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100).map(k => k.split(','));
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${chunk.map(c => c[0]).join(',')}&longitude=${chunk.map(c => c[1]).join(',')}`;
    const j = await cachedJSON(url, path.join(ROOT, 'raw', 'openmeteo', `elev-${i}-${list.length}.json`), { delayMs: 500 });
    chunk.forEach((c, n) => { out[c.join(',')] = j.elevation[n]; });
  }
  return out;
}

const HOME_PTS = 3.5; // points of home edge removed from each margin before comparing
function marginsVs(sked, start, team) {
  const m = {};
  for (const x of sked) {
    if (x.date >= start - DAY / 2 || (x.t1 !== team && x.t2 !== team)) continue;
    const me1 = x.t1 === team, opp = me1 ? x.t2 : x.t1, loc = me1 ? x.loc1 : -x.loc1;
    const margin = (me1 ? x.b1.pts - x.b2.pts : x.b2.pts - x.b1.pts) - HOME_PTS * loc;
    (m[opp] = m[opp] || []).push(margin);
  }
  return m;
}
// Half of (A's common-opponent margin minus B's), signed for this team, so A minus B is the full difference.
function commonOpp(sked, start, team, opp) {
  const a = marginsVs(sked, start, team), b = marginsVs(sked, start, opp);
  const common = Object.keys(a).filter(o => b[o] && o !== team && o !== opp);
  if (common.length < 3) return null;
  const avg = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  return common.reduce((s, o) => s + avg(a[o]) - avg(b[o]), 0) / common.length / 2;
}

async function build({ log = console.log } = {}) {
  const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dataset.json'), 'utf8'));
  const out = { about: 'Game context per tournament game and team: altitude, air pressure, body clock, crowd, home designation, head-to-head.', games: {}, columns: {}, coverage: {} };
  const COLS = { gm_elev_gain: 'stat', gm_campus_elev: 'stat', gm_pressure_drop: 'stat', gm_body_hour: 'stat', gm_early_body: 'stat',
    gm_crowd: 'stat', gm_designated_home: 'hybrid', gm_h2h_wins: 'stat', gm_h2h_margin: 'stat', gm_common_opp: 'stat' };
  for (const [c, kind] of Object.entries(COLS)) out.columns[c] = { file: 'gamectx', column: c, source: 'espn+kaggle+openmeteo', kind, level: 'game' };

  // Coordinates and time zones from the Kaggle locations file, per year / team / round.
  const loc = {};
  const rows = parseCSV(fs.readFileSync(path.join(ROOT, 'raw', 'kaggle', 'csv', 'Tournament Locations.csv'), 'utf8'));
  for (const r of rows) {
    const y = r.YEAR, T = dataset.teams[y]; if (!T) continue;
    const team = makeMatcher(new Set(Object.keys(T)))(String(r.TEAM));
    const rd = ROUND_CODE[r['CURRENT ROUND']];
    if (!team || rd == null) continue;
    ((loc[y] = loc[y] || {})[team] = loc[y][team] || {})[rd] = {
      campus: key3(r['COLLEGE LATITUDE'], r['COLLEGE LONGITUDE']), site: key3(r['GAME LATITUDE'], r['GAME LONGITUDE']),
      tz: offsetOf(r['COLLEGE TIME ZONE'], r['COLLEGE DAYLIGHT SAVINGS TIME']), mi: r['DISTANCE (MI)'] };
  }
  const coords = new Set();
  for (const Y of Object.values(loc)) for (const R of Object.values(Y)) for (const v of Object.values(R)) { coords.add(v.campus); coords.add(v.site); }
  const elev = await elevations(coords);
  log(`elevations for ${coords.size} campus and site coordinates`);

  for (const year of dataset.years) {
    const games = dataset.games.filter(g => g.year === year);
    const match = makeMatcher(new Set(Object.keys(dataset.teams[year])));
    const sked = seasonGames(JSON.parse(fs.readFileSync(path.join(ROOT, 'raw', `sked${year}.json`), 'utf8')));
    const start = Math.min(...games.filter(g => g.date).map(g => Date.parse(g.date)));
    const pressureCache = {};
    let espnHit = 0;
    for (const date of [...new Set(games.map(g => g.date).filter(Boolean))]) {
      const ymd = date.replace(/-/g, '');
      const sb = await cachedJSON(`${ESPN}/scoreboard?dates=${ymd}&groups=100&limit=200`, path.join(ROOT, 'raw', 'espn', 'scoreboard', `${ymd}.json`));
      for (const ev of sb.events || []) {
        const comp = ev.competitions[0];
        const sides = comp.competitors.map(c => [c.team.location, c.team.shortDisplayName, c.team.displayName].filter(Boolean).map(n => match(n)).find(Boolean));
        const g = games.find(x => x.date === date && sides.includes(x.a) && sides.includes(x.b));
        if (!g) continue;
        espnHit++;
        const k = gameKey(g), tip = Date.parse(ev.date), att = +comp.attendance || null;
        out.games[k] = {};
        for (const [i, team] of sides.entries()) {
          const opp = team === g.a ? g.b : g.a;
          const L = ((loc[year] || {})[team] || {})[g.round];
          const v = { gm_designated_home: comp.competitors[i].homeAway === 'home' ? 1 : 0 };
          if (L) {
            const ce = elev[L.campus], se = elev[L.site];
            if (Number.isFinite(ce) && Number.isFinite(se)) { v.gm_elev_gain = (se - ce) / 1000; v.gm_campus_elev = ce / 1000; }
            if (L.tz != null) { const h = ((new Date(tip).getUTCHours() + new Date(tip).getUTCMinutes() / 60 + L.tz) % 24 + 24) % 24; v.gm_body_hour = h; v.gm_early_body = Math.max(0, 14 - h); }
            if (att && Number.isFinite(L.mi)) v.gm_crowd = (att / 10000) * Math.exp(-L.mi / 250);
            // Surface pressure at the site, at the tip-off hour (Open-Meteo archive, one request per site and year).
            const pk = L.site;
            if (!pressureCache[pk]) {
              const [lat, lon] = pk.split(',');
              const s = new Date(start - 3 * DAY).toISOString().slice(0, 10), e = new Date(start + 25 * DAY).toISOString().slice(0, 10);
              try {
                pressureCache[pk] = await cachedJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${s}&end_date=${e}&hourly=surface_pressure&timezone=GMT`,
                  path.join(ROOT, 'raw', 'openmeteo', `p-${year}-${pk.replace(/[,.-]/g, '_')}.json`), { delayMs: 300 });
              } catch (err) { pressureCache[pk] = { error: err.message }; }
            }
            const P = pressureCache[pk].hourly;
            if (P && Number.isFinite(ce)) {
              const i = P.time.indexOf(new Date(Math.floor(tip / 3600e3) * 3600e3).toISOString().slice(0, 13) + ':00');
              if (i >= 0 && Number.isFinite(P.surface_pressure[i])) v.gm_pressure_drop = (stdPressure(ce) - P.surface_pressure[i]) / 10;
            }
          }
          // Earlier meetings this season (before the tournament): conference rivals, early-season tournaments.
          const met = sked.filter(x => x.date < start - DAY / 2 && ((x.t1 === team && x.t2 === opp) || (x.t1 === opp && x.t2 === team)));
          v.gm_h2h_wins = met.filter(x => (x.t1 === team ? x.b1.pts > x.b2.pts : x.b2.pts > x.b1.pts)).length;
          v.gm_h2h_margin = met.length ? met.reduce((s, x) => s + (x.t1 === team ? x.b1.pts - x.b2.pts : x.b2.pts - x.b1.pts), 0) / met.length : 0;
          // Common opponents: this team's average margin (home edge removed) against each opponent both teams faced.
          v.gm_common_opp = commonOpp(sked, start, team, opp, team === g.a ? g.b : g.a);
          out.games[k][team] = v;
        }
      }
    }
    out.coverage[year] = { games: games.length, espn: espnHit };
    log(`${year}: ESPN context for ${espnHit}/${games.length} games`);
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'features-gamectx.json'), JSON.stringify(out));
  return out;
}

if (require.main === module) build().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { build, stdPressure, offsetOf };
