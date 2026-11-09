// How each Kaggle file is used. Every team-season file is joined on (YEAR, TEAM) and its columns are
// namespaced with `prefix`, so the same stat from different sites stays separate (KenPom AdjEM and
// Barttorvik AdjEM are different calculations; the model decides which helps).
//
// role:
//   team_season - one row per tournament team per year, frozen before the tournament: features
//   ap_poll     - weekly poll; reduced to preseason / final / peak features
//   conference  - one row per conference per year; joined through the team's conference
//   travel      - per team per round distance to the game site: game-level features
//   public      - who-picked-whom percentages: for pool strategy and "unpopular win" labels, not features
//   labels      - tournament results: used to check our own labels, never features
//   quarantine  - all-time aggregates or unverified columns that may contain tournament outcomes
//
// Columns matching OUTCOME_COLUMNS are dropped from every file no matter the role.
//
// kind: where a number comes from, so the model can be warier of human judgment.
//   stat        counted from games (shooting %, rebounds, wins vs top-25, travel miles)
//   rating      an algorithm applied to stats (KenPom AdjEM, NET, Elo)
//   projection  a stats-based forecast made before or during the season (KenPom preseason)
//   hybrid      human judgment informed by stats (committee seeds, recruiting-based talent)
//   opinion     human judgment (AP votes, analysts' "upset alert" / "Cinderella" picks)
// A file sets a default kind; `kinds` overrides it per column by regex.

const OUTCOME_COLUMNS = /^(ROUND|CURRENT ROUND|SCORE|BY YEAR NO|TEAM NO|TEAM ID|TEAM|YEAR|SEED|CONF|CONF ID|QUAD NO|QUAD ID|WEEK|BID TYPE|RANK\?)$/;

const FILES = [
  { file: 'KenPom Barttorvik.csv', kind: 'rating', kinds: [[/^(W|L|WIN%|GAMES|EFG|FTR|TOV|OREB|DREB|OP |RAW T|2PT|3PT|BLK|AST|FT%|PPP|EXP|AVG HGT|EFF HGT)/, 'stat'], [/^TALENT/, 'hybrid']], role: 'team_season', prefix: 'kb', source: 'kenpom+barttorvik', since: 2008,
    note: 'KenPom KADJ* plus Barttorvik BADJ*, four factors, height, experience, talent, WAB. Verified pre-tournament.' },
  { file: 'Barttorvik Home.csv', kind: 'rating', kinds: 'KB', role: 'team_season', prefix: 'bth', source: 'barttorvik', since: 2008, note: 'Home-game splits' },
  { file: 'Barttorvik Away.csv', kind: 'rating', kinds: 'KB', role: 'team_season', prefix: 'bta', source: 'barttorvik', since: 2008, note: 'Away-game splits' },
  { file: 'Barttorvik Neutral.csv', kind: 'rating', kinds: 'KB', role: 'team_season', prefix: 'btn', source: 'barttorvik', since: 2008, note: 'Neutral-site splits: closest to tournament conditions' },
  { file: 'Barttorvik Away-Neutral.csv', kind: 'rating', kinds: 'KB', role: 'team_season', prefix: 'btan', source: 'barttorvik', since: 2008, note: 'Away + neutral splits' },
  { file: 'KenPom Preseason.csv', kind: 'projection', role: 'team_season', prefix: 'kpre', source: 'kenpom', since: 2012, note: 'Preseason ratings and the change since' },
  { file: '538 Ratings.csv', kind: 'rating', role: 'team_season', prefix: 'f38', source: 'fivethirtyeight', since: 2016, note: 'Discontinued after 2024' },
  { file: 'EvanMiya.csv', kind: 'rating', kinds: [[/KILL/, 'stat']], role: 'team_season', prefix: 'em', source: 'evanmiya', since: 2011, note: 'Includes injury, roster and home ranks, kill shots' },
  { file: 'Heat Check Ratings.csv', kind: 'opinion', role: 'team_season', prefix: 'hc', source: 'heatcheck', since: 2013,
    // Only flagged teams are listed; 2026 has 2 rows (incomplete), so it stays missing rather than all-zero.
    unlistedIs: 0, minRowsPerYear: 5, note: 'Easy/tough draw, dark horse, upset alert, Cinderella flags' },
  { file: 'Heat Check Tournament Index.csv', kind: 'opinion', role: 'quarantine', prefix: 'hcti', source: 'heatcheck', since: 2013,
    note: 'WINS looks like tournament wins for champions (6) but is 5 for a 2024 first-round loser. Unverified: test/leakage.test.js must clear it first.' },
  { file: 'Resumes.csv', kind: 'rating', kinds: [[/^(Q[1-4]|PLUS)/, 'stat']], role: 'team_season', prefix: 'res', source: 'resume', since: 2008, note: 'NET, ELO, quad wins, resume score' },
  { file: 'Teamsheet Ranks.csv', kind: 'rating', kinds: [[/^Q[1-4]/, 'stat']], role: 'team_season', prefix: 'ts', source: 'ncaa_teamsheet', since: 2019, note: 'NET, KPI, SOR, BPI, KenPom, Sagarin, T-Rank ranks' },
  { file: 'TeamRankings.csv', kind: 'rating', kinds: [[/V [0-9]|HI|LO|LAST/, 'stat']], role: 'team_season', prefix: 'tr', source: 'teamrankings', since: 2008, note: 'Ratings, SOS, luck, consistency' },
  { file: 'TeamRankings Home.csv', kind: 'rating', kinds: [[/V [0-9]|HI|LO|LAST/, 'stat']], role: 'team_season', prefix: 'trh', source: 'teamrankings', since: 2008, note: '' },
  { file: 'TeamRankings Away.csv', kind: 'rating', kinds: [[/V [0-9]|HI|LO|LAST/, 'stat']], role: 'team_season', prefix: 'tra', source: 'teamrankings', since: 2008, note: '' },
  { file: 'TeamRankings Neutral.csv', kind: 'rating', kinds: [[/V [0-9]|HI|LO|LAST/, 'stat']], role: 'team_season', prefix: 'trn', source: 'teamrankings', since: 2008, note: '' },
  { file: 'RPPF Ratings.csv', kind: 'rating', role: 'team_season', prefix: 'rppf', source: 'basketunderreview', since: 2012, note: '' },
  { file: 'RPPF Preseason Ratings.csv', kind: 'projection', role: 'team_season', prefix: 'rppfpre', source: 'basketunderreview', since: 2015, note: '' },
  { file: 'Shooting Splits.csv', kind: 'stat', role: 'team_season', prefix: 'shot', source: 'barttorvik', since: 2010, note: 'Dunks, close twos, far twos, threes: share and FG%' },
  { file: 'Z Rating Teams.csv', kind: 'hybrid', role: 'team_season', prefix: 'z', source: 'adambrackets', since: 2015, note: '' },
  { file: 'AP Poll Data.csv', kind: 'opinion', role: 'ap_poll', prefix: 'ap', source: 'ap_poll', since: 2008, note: 'Weekly AP poll' },
  { file: 'Conference Stats.csv', kind: 'rating', kinds: [[/^(W|L|WIN%|G|EFG|FTR|TOV|OREB|DREB|OP |RAW T|2PT|3PT|BLK|AST|FT%|PPP|EXP|AVG HGT|EFF HGT)/, 'stat'], [/^TALENT/, 'hybrid']], role: 'conference', prefix: 'conf', source: 'barttorvik', since: 2008, note: 'Conference averages' },
  { file: 'RPPF Conference Ratings.csv', kind: 'rating', role: 'conference', prefix: 'rppfconf', source: 'basketunderreview', since: 2012, note: '' },
  { file: 'Tournament Locations.csv', kind: 'stat', role: 'travel', prefix: 'trav', source: 'kaggle', since: 2008, note: 'Distance and time zones from campus to game site' },
  { file: 'Public Picks.csv', kind: 'opinion', role: 'public', prefix: 'pick', source: 'espn', since: 2026, note: 'Share of ESPN brackets picking each team to reach each round' },
  { file: 'Tournament Matchups.csv', role: 'labels', prefix: 'tm', source: 'kaggle', since: 2008, note: 'Cross-check for our bracket labels' },
  // All-time aggregates include every tournament, including the one being predicted. The pipeline
  // recomputes coach/program/seed history walk-forward from our own game list instead.
  { file: 'Coach Results.csv', role: 'quarantine', prefix: 'coach', source: 'aggregate', note: 'All-time; recompute walk-forward' },
  { file: 'Team Results.csv', role: 'quarantine', prefix: 'prog', source: 'aggregate', note: 'All-time; recompute walk-forward' },
  { file: 'Conference Results.csv', role: 'quarantine', prefix: 'confres', source: 'aggregate', note: 'All-time' },
  { file: 'Seed Results.csv', role: 'quarantine', prefix: 'seedres', source: 'aggregate', note: 'All-time' },
  { file: 'Z Rating Cumulative.csv', role: 'quarantine', prefix: 'zcum', source: 'aggregate', note: 'All-time' },
  { file: 'Upset Count.csv', role: 'quarantine', prefix: 'upc', source: 'aggregate', note: 'Outcome summary' },
  { file: 'Upset Seed Info.csv', role: 'quarantine', prefix: 'ups', source: 'aggregate', note: 'Outcome summary' },
  { file: 'Tournament Simulation.csv', role: 'quarantine', prefix: 'sim', source: 'kaggle', note: '2026 only; someone else\'s forecast' },
  { file: 'Conference Stats Home.csv', role: 'quarantine', prefix: 'confh', source: 'barttorvik', note: 'Redundant with Conference Stats; enable if wanted' },
  { file: 'Conference Stats Away.csv', role: 'quarantine', prefix: 'confa', source: 'barttorvik', note: 'Redundant with Conference Stats; enable if wanted' },
  { file: 'Conference Stats Neutral.csv', role: 'quarantine', prefix: 'confn', source: 'barttorvik', note: 'Redundant with Conference Stats; enable if wanted' },
  { file: 'Conference Stats Away Neutral.csv', role: 'quarantine', prefix: 'confan', source: 'barttorvik', note: 'Redundant with Conference Stats; enable if wanted' },
];

// Kaggle round codes -> our round numbers (0 = First Four ... 6 = championship).
const ROUND_CODE = { 68: 0, 64: 1, 32: 2, 16: 3, 8: 4, 4: 5, 2: 6 };

const KB_KINDS = FILES[0].kinds;
function kindOf(spec, column) {
  const rules = spec.kinds === 'KB' ? KB_KINDS : spec.kinds || [];
  const hit = rules.find(([re]) => re.test(column));
  return hit ? hit[1] : spec.kind || 'stat';
}

module.exports = { FILES, OUTCOME_COLUMNS, ROUND_CODE, kindOf };
