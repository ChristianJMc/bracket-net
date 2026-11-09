// Things outside the games themselves, from the schedule: workload and rest going into the tournament.
// Writes data/features-schedule.json.
//   sch_games_last7    games in the 7 days before the team's first NCAA game (a long conference-tournament run)
//   sch_games_last14   same over 14 days
//   sch_rest_pre       days between the last pre-tournament game and the first NCAA game
//   sch_road_share     share of the season's games played away from home (battle-tested on the road)
// Game-level rest during the tournament (days since each team's previous game) comes from lastGame plus the
// tournament dates and is computed in build/walkforward.js stageBRow.
const fs = require('fs');
const path = require('path');
const { seasonGames } = require('../lib/sked');

const ROOT = path.join(__dirname, '..', '..');
const DAY = 86400e3;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

function build({ log = console.log } = {}) {
  const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dataset.json'), 'utf8'));
  const out = { about: 'Workload, rest and road share from the schedule, before each team\'s first NCAA game.', teams: {}, columns: {}, lastGame: {} };
  for (const c of ['sch_games_last7', 'sch_games_last14', 'sch_rest_pre', 'sch_road_share'])
    out.columns[c] = { file: 'schedule', column: c, source: 'barttorvik_boxscores', kind: 'stat' };
  for (const year of dataset.years) {
    const games = seasonGames(JSON.parse(fs.readFileSync(path.join(ROOT, 'raw', `sked${year}.json`), 'utf8')));
    out.teams[year] = {}; out.lastGame[year] = {};
    for (const team of Object.keys(dataset.teams[year])) {
      const first = dataset.games.filter(g => g.year === year && (g.a === team || g.b === team) && g.date).map(g => Date.parse(g.date)).sort((a, b) => a - b)[0];
      if (!first) continue;
      // sked dates are local midnight, tournament dates UTC midnight: compare with half a day of slack.
      const mine = games.filter(g => (g.t1 === team || g.t2 === team) && g.date < first - DAY / 2).sort((a, b) => a.date - b.date);
      if (!mine.length) continue;
      const last = mine[mine.length - 1].date;
      const days = (t) => Math.round((first - t) / DAY);
      out.teams[year][team] = {
        sch_games_last7: mine.filter(g => days(g.date) <= 7).length,
        sch_games_last14: mine.filter(g => days(g.date) <= 14).length,
        sch_rest_pre: Math.min(days(last), 14),
        sch_road_share: mine.filter(g => (g.t1 === team ? g.loc1 : -g.loc1) === -1).length / mine.length,
      };
      out.lastGame[year][team] = iso(last + DAY / 2);
    }
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'features-schedule.json'), JSON.stringify(out));
  const ex = out.teams[2024]['N.C. State'];
  log(`schedule features for ${Object.values(out.teams).reduce((s, T) => s + Object.keys(T).length, 0)} team-seasons; 2024 N.C. State ${JSON.stringify(ex)}`);
  return out;
}

if (require.main === module) build();
module.exports = { build };
