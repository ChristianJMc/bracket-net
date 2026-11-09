// Who is coaching, and what they had done before this season. Writes data/features-coach.json.
// Source: Sports-Reference season coach pages (one page per season, fetched slowly and cached, hash-pinned).
// Their career columns run through the end of that season, tournament included, so for season Y every career number
// comes from the coach's row on an EARLIER season's page; tournament over/under-performance is counted here from
// our own games, walk-forward. Only the coach's identity and start year come from season Y's own page.
//   coach_tenure          seasons at this school, including this one
//   coach_ncaa_prior      NCAA tournament appearances before this season (career, any school)
//   coach_ff_prior        Final Fours before this season
//   coach_champ_prior     titles before this season
//   coach_wins_prior      career wins before this season (hundreds)
//   coach_wpct_prior      career win % before this season
//   coach_first_ncaa      1 if this is the coach's first tournament
//   coach_tourney_resid   tournament wins above the base model's expectation in earlier tournaments (since 2008)
//   node build/ingest/coaches.js
const fs = require('fs');
const path = require('path');
const { download } = require('../lib/safe-fetch');
const { makeMatcher } = require('../lib/names');

const ROOT = path.join(__dirname, '..', '..');
const FIRST = 2006;
const URL_OF = (y) => `https://www.sports-reference.com/cbb/seasons/men/${y}-coaches.html`;
const FILE_OF = (y) => path.join(ROOT, 'raw', 'coaches', `${y}-coaches.html`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const cell = (row, stat) => { const m = row.match(new RegExp(`data-stat="${stat}"[^>]*>(.*?)</t[dh]>`)); return m ? m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim() : null; };
const num = (s) => (s == null || s === '' ? 0 : +s.replace(/,/g, '') || 0);

function parse(html) {
  const rows = [];
  for (const m of html.matchAll(/<tr[^>]*><th scope="row"[^>]*data-stat="coach"[\s\S]*?<\/tr>/g)) {
    const r = m[0];
    const id = (r.match(/href='\/cbb\/coaches\/([a-z0-9-]+)\.html'/) || [])[1];
    if (!id) continue;
    rows.push({ id, coach: cell(r, 'coach'), school: cell(r, 'school'), since: num((cell(r, 'since') || '').slice(0, 4)) + 1, // "2019-20" is the 2020 season
      gamesSeas: num(cell(r, 'wins_seas')) + num(cell(r, 'losses_seas')),
      winsCar: num(cell(r, 'wins_car')), lossesCar: num(cell(r, 'losses_car')), ncaaCar: num(cell(r, 'ncaa_car')), ffCar: num(cell(r, 'ff_car')), champCar: num(cell(r, 'champ_car')) });
  }
  return rows;
}

const SR_ALIASES = { 'nc state': 'N.C. State', 'saint marys ca': "Saint Mary's", 'st marys ca': "Saint Mary's", 'miami fl': 'Miami FL', 'miami oh': 'Miami OH',
  'loyola il': 'Loyola Chicago', 'loyola md': 'Loyola MD', 'texas am corpus christi': 'Texas A&M Corpus Chris', 'unc': 'North Carolina', 'uconn': 'Connecticut',
  'long island university': 'LIU', 'liu': 'LIU', 'cal state fullerton': 'Cal St. Fullerton', 'cal state bakersfield': 'Cal St. Bakersfield', 'cal state northridge': 'Cal St. Northridge',
  'louisiana': ['Louisiana Lafayette', 'Louisiana'], 'louisiana lafayette': ['Louisiana Lafayette', 'Louisiana'], 'ut arlington': 'UT Arlington', 'detroit': 'Detroit Mercy', 'detroit mercy': 'Detroit Mercy',
  'st francis pa': 'Saint Francis', 'saint francis pa': 'Saint Francis', 'sam houston': ['Sam Houston St.', 'Sam Houston'], 'sam houston state': ['Sam Houston St.', 'Sam Houston'], 'albany ny': 'Albany',
  'texas am commerce': 'Texas A&M Commerce', 'mcneese': 'McNeese St.', 'nicholls': 'Nicholls St.', 'grambling': 'Grambling St.', 'omaha': 'Nebraska Omaha', 'purdue fort wayne': 'Purdue Fort Wayne',
  'st johns ny': "St. John's", 'college of charleston': ['College of Charleston', 'Charleston'],
  'kansas city': 'UMKC', 'fdu': 'Fairleigh Dickinson', 'queens nc': 'Queens', 'southeast missouri state': 'Southeast Missouri St.', 'charleston': 'Charleston' };

async function build({ log = console.log } = {}) {
  const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dataset.json'), 'utf8'));
  const last = Math.max(...dataset.years);
  const pages = {};
  for (let y = FIRST; y <= last; y++) {
    const fresh = !fs.existsSync(FILE_OF(y));
    await download(URL_OF(y), FILE_OF(y), { maxBytes: 5e6 });
    if (fresh) await sleep(4000); // Sports-Reference asks for fewer than 20 requests a minute
    pages[y] = parse(fs.readFileSync(FILE_OF(y), 'utf8'));
  }
  // Career numbers as of the end of each season, by coach id.
  const asOf = {};
  for (const [y, rows] of Object.entries(pages)) for (const r of rows) (asOf[r.id] = asOf[r.id] || {})[y] = r;
  const prior = (id, y) => { const seasons = Object.keys(asOf[id] || {}).map(Number).filter(s => s < y); return seasons.length ? asOf[id][Math.max(...seasons)] : null; };

  // Walk-forward tournament residual per coach, using the shipped base model's pregame chances.
  let pFn = () => 0.5;
  const mf = path.join(ROOT, 'data', 'model.json');
  if (fs.existsSync(mf)) {
    const { NN } = require('../nn');
    const m = JSON.parse(fs.readFileSync(mf, 'utf8')), model = { scale: m.model.scale, nets: m.model.nets.map(NN.fromJSON) };
    pFn = (g) => NN.predict(model, dataset.teams[g.year][g.a], dataset.teams[g.year][g.b], 0);
  }

  const out = { about: 'Coach identity, tenure and record before each season; tournament residual counted walk-forward.', teams: {}, coachOf: {}, columns: {}, unmatched: [] };
  for (const c of ['coach_tenure', 'coach_ncaa_prior', 'coach_ff_prior', 'coach_champ_prior', 'coach_wins_prior', 'coach_wpct_prior', 'coach_first_ncaa', 'coach_tourney_resid'])
    out.columns[c] = { file: 'coach', column: c, source: 'sports_reference', kind: 'stat' };
  const residByCoach = {}; // coach id -> [{ year, resid }]
  for (const year of dataset.years) {
    const field = new Set(Object.keys(dataset.teams[year]));
    const match = makeMatcher(field);
    const resolve = (school) => {
      const k = school.toLowerCase().replace(/[().'’&]/g, '').replace(/[-–]/g, ' ').replace(/\bstate\b/g, 'st').replace(/\s+/g, ' ').trim();
      const viaSR = [].concat(SR_ALIASES[school.toLowerCase().replace(/[().'’&]/g, '').replace(/\s+/g, ' ').trim()] || SR_ALIASES[k] || []).find(n => field.has(n));
      return viaSR || match(school);
    };
    // The coach of record: most games this season at that school.
    const bySchool = {};
    for (const r of pages[year] || []) { const t = resolve(r.school); if (!t) continue; if (!bySchool[t] || r.gamesSeas > bySchool[t].gamesSeas) bySchool[t] = r; }
    out.teams[year] = {}; out.coachOf[year] = {};
    for (const team of field) {
      const r = bySchool[team];
      if (!r) { out.unmatched.push(`${year} ${team}`); continue; }
      const p = prior(r.id, year);
      const games = (p ? p.winsCar + p.lossesCar : 0);
      out.coachOf[year][team] = r.coach;
      out.teams[year][team] = {
        coach_tenure: r.since ? year - r.since + 1 : null,
        coach_ncaa_prior: p ? p.ncaaCar : 0, coach_ff_prior: p ? p.ffCar : 0, coach_champ_prior: p ? p.champCar : 0,
        coach_wins_prior: p ? p.winsCar / 100 : 0, coach_wpct_prior: games >= 30 ? p.winsCar / games : null,
        coach_first_ncaa: p && p.ncaaCar > 0 ? 0 : 1,
        coach_tourney_resid: (residByCoach[r.id] || []).reduce((s, x) => s + x.resid, 0),
      };
      r._team = team;
    }
    // Add this year's tournament to each coach's record only after the season's features are written.
    for (const g of dataset.games.filter(x => x.year === year)) {
      const p = pFn(g);
      for (const [team, won, pt] of [[g.a, g.sa > g.sb, p], [g.b, g.sb > g.sa, 1 - p]]) {
        const r = bySchool[team]; if (!r) continue;
        (residByCoach[r.id] = residByCoach[r.id] || []).push({ year, resid: (won ? 1 : 0) - pt });
      }
    }
    log(`${year}: coaches for ${Object.keys(out.teams[year]).length}/${field.size} teams`);
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'features-coach.json'), JSON.stringify(out));
  if (out.unmatched.length) log('UNMATCHED: ' + out.unmatched.join('; '));
  return out;
}

if (require.main === module) build().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { build, parse };
