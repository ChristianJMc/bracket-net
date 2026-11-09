// Tournament context known before a game tips off:
//   this run so far   wins, how far the team has beaten the model's expectations, margins, upset wins
//   program history   tournament games, wins and over/under-performance in earlier seasons
// "Expectation" is the base model's pregame chance (it never trained on a tournament game).
// Only games strictly before the one being predicted are used: earlier rounds of the same tournament,
// and earlier seasons' tournaments.

function makeHistory(dataset, pFn) {
  const byTeam = new Map(); // "year|team" -> games in that tournament, in round order
  const byProgram = new Map(); // team -> [{ year, won, p, margin }]
  for (const g of dataset.games) {
    const p = pFn(g);
    for (const [team, opp, pts, oppPts, pt] of [[g.a, g.b, g.sa, g.sb, p], [g.b, g.a, g.sb, g.sa, 1 - p]]) {
      const rec = { year: g.year, round: g.round, opp, won: pts > oppPts ? 1 : 0, p: pt, margin: pts - oppPts };
      const k = g.year + '|' + team;
      (byTeam.get(k) || byTeam.set(k, []).get(k)).push(rec);
      (byProgram.get(team) || byProgram.set(team, []).get(team)).push(rec);
    }
  }
  const cache = new Map();
  return function features(year, round, team) {
    const key = `${year}|${round}|${team}`;
    if (cache.has(key)) return cache.get(key);
    const run = (byTeam.get(year + '|' + team) || []).filter(r => r.round < round);
    const prog = (byProgram.get(team) || []).filter(r => r.year < year);
    const last5 = prog.filter(r => r.year >= year - 5);
    const sum = (list, f) => list.reduce((s, r) => s + f(r), 0);
    const f = {
      run_wins: sum(run, r => r.won),
      run_resid: sum(run, r => r.won - r.p),
      run_margin: run.length ? sum(run, r => r.margin) / run.length : 0,
      run_upset_wins: run.filter(r => r.won && r.p < 0.5).length,
      run_last_margin: run.length ? run[run.length - 1].margin : 0,
      prog_games5: last5.length,
      prog_wins5: sum(last5, r => r.won),
      prog_resid5: sum(last5, r => r.won - r.p),
      prog_resid_all: sum(prog, r => r.won - r.p),
    };
    cache.set(key, f);
    return f;
  };
}

const HISTORY_COLUMNS = ['run_wins', 'run_resid', 'run_margin', 'run_upset_wins', 'run_last_margin', 'prog_games5', 'prog_wins5', 'prog_resid5', 'prog_resid_all'];

module.exports = { makeHistory, HISTORY_COLUMNS };
