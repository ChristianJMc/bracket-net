// Builds data/dataset.json from the raw downloads:
//   raw/skedYYYY.json  - Barttorvik full-season game files (box scores for every D-I game)
//   raw/wiki/YYYY.txt  - Wikipedia wikitext for each NCAA tournament (bracket, seeds, scores)
// Team ratings are computed only from games played BEFORE that year's tournament began,
// so nothing the model trains on knows how the tournament turned out.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Per-team home-court edges (empirical Bayes, pooled over seasons). false = one league-wide edge.
let venueBeta = null; // last fitted altitude slope, for the log
const TEAM_HCA = true;
const VENUE_DECAY = 0.7; // weight on last season's home games when pooling venue evidence
// Campus elevation (km) by school, from sources/campus-elevation.json (build/ingest/campus.js): altitude is the one
// venue trait that measurably moves home edges, so edges are shrunk toward an altitude-informed prior.
const ELEV = (() => {
  const f = path.join(__dirname, '..', 'sources', 'campus-elevation.json');
  if (!fs.existsSync(f)) return {};
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  return Object.fromEntries(Object.entries({ ...j.schools, ...((j.supplement || {}).schools || {}) }).map(([k, v]) => [k, v.elev / 1000]));
})();
const elevOf = (name) => { const { norm } = require('./lib/names'); const e = ELEV[norm(name)]; return Number.isFinite(e) ? e : null; };
const YEARS = [2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2021, 2022, 2023, 2024, 2025, 2026];
const POSITION_SEEDS = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

// ---------- Wikipedia bracket parsing ----------

function cleanCell(v) {
  let s = v.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  s = s.replace(/<sup>.*?<\/sup>/g, '').replace(/<[^>]+>/g, '');
  let link = null;
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, (m, a, b) => { link = link || a; return b; });
  s = s.replace(/\[\[([^\]]*)\]\]/g, (m, a) => { link = link || a; return a; });
  s = s.replace(/\{\{[^}|]*\|([^}]*)\}\}/g, (m, a) => a.split('|').pop()); // {{strikethrough|Louisville}} -> Louisville
  s = s.replace(/\{\{[^}]*\}\}/g, '').replace(/'''?/g, '').replace(/&nbsp;/g, ' ').replace(/[*†#^]/g, '');
  return { text: s.replace(/\s+/g, ' ').trim(), link };
}

function parseWiki(txt) {
  const lines = txt.split('\n');
  const blocks = [];
  let cur = null;
  let heading = '';
  for (const line of lines) {
    const h = line.match(/^=+\s*(.*?)\s*=+\s*$/);
    if (h) heading = h[1].replace(/<[^>]+>/g, '');
    const start = line.match(/\{\{(16TeamBracket|2TeamBracket|4TeamBracket)[\w-]*/);
    if (start) {
      cur = { type: start[1], heading, header: line, p: {} };
      blocks.push(cur);
    }
    if (!cur) continue;
    const re = /\|\s*(RD\d-(?:seed|team|score)\d+)\s*=\s*([\s\S]*?)(?=\|\s*RD\d-(?:seed|team|score)\d+\s*=|$)/g;
    let m;
    while ((m = re.exec(line))) cur.p[m[1].replace(/(\D)0+(\d)/, '$1$2')] = m[2].trim();
    if (/^\s*\}\}/.test(line) && !start) cur = null;
  }
  return blocks;
}

function score(v) {
  if (v == null) return null;
  const m = cleanCell(v).text.match(/\d+/);
  return m ? +m[0] : null;
}

function regionOf(text) {
  const m = text.match(/(East|West|South|Midwest|Southeast|Southwest)\s+[Rr]egion/);
  return m ? m[1] : null;
}

const { makeMatcher } = require('./lib/names');
const { seasonGames } = require('./lib/sked');

// ---------- Tournament games from the bracket ----------

function tournamentFromWiki(year, txt, match, unmatched) {
  const blocks = parseWiki(txt);
  const teams = new Map(); // bart name -> {seed, region}
  const games = [];
  const resolve = (raw) => {
    const c = cleanCell(raw);
    const n = match(c.text, c.link);
    if (!n) unmatched.add(`${year}: "${c.text}" (${c.link || ''})`);
    return n;
  };
  const seedNum = (v) => { const m = v && cleanCell(v).text.match(/\d+/); return m ? +m[0] : null; };

  const regionBlocks = blocks.filter(b => b.type === '16TeamBracket');
  const regions = [];
  for (const b of regionBlocks) {
    let region = regionOf(b.heading) || regionOf(b.header);
    if (!region || regions.includes(region)) {
      // Heading missing or reused (e.g. an "all-tournament team" subheading): take the region no other block claimed.
      const set = /Southeast|Southwest/.test(txt) && year === 2011 ? ['East', 'West', 'Southeast', 'Southwest'] : ['East', 'West', 'South', 'Midwest'];
      region = set.find(r => !regions.includes(r));
    }
    regions.push(region);
    for (let rd = 1; rd <= 4; rd++) {
      const slots = 16 >> (rd - 1);
      for (let i = 1; i <= slots; i += 2) {
        const side = (j) => {
          const raw = b.p[`RD${rd}-team${j}`];
          if (!raw) return null;
          const name = resolve(raw);
          let seed = seedNum(b.p[`RD${rd}-seed${j}`]);
          if (seed == null && rd === 1) seed = POSITION_SEEDS[j - 1];
          if (seed == null && teams.has(name)) seed = teams.get(name).seed;
          if (rd === 1 && name) teams.set(name, { seed, region });
          return { name, seed, pts: score(b.p[`RD${rd}-score${j}`]) };
        };
        const a = side(i), c = side(i + 1);
        if (a && c) games.push({ year, round: rd, region, a, b: c });
      }
    }
  }

  for (const b of blocks.filter(b => b.type === '2TeamBracket')) {
    const a = b.p['RD1-team1'], c = b.p['RD1-team2'];
    if (!a || !c) continue;
    const ga = { name: resolve(a), seed: seedNum(b.p['RD1-seed1']), pts: score(b.p['RD1-score1']) };
    const gc = { name: resolve(c), seed: seedNum(b.p['RD1-seed2']), pts: score(b.p['RD1-score2']) };
    const winner = ga.pts > gc.pts ? ga : gc;
    const region = (teams.get(winner.name) || {}).region || regionOf(b.header);
    for (const t of [ga, gc]) if (!teams.has(t.name)) teams.set(t.name, { seed: t.seed, region });
    games.push({ year, round: 0, region, a: ga, b: gc });
  }

  // Final Four: the 4-team bracket whose RD1 teams are region champions.
  const champs = new Map();
  for (const g of games.filter(g => g.round === 4)) champs.set(g.region, g.a.pts > g.b.pts ? g.a.name : g.b.name);
  const champNames = new Set(champs.values());
  const ffBlock = blocks.filter(b => b.type === '4TeamBracket').find(b =>
    [1, 2, 3, 4].every(j => b.p[`RD1-team${j}`] && champNames.has(resolve(b.p[`RD1-team${j}`]))));
  const finalFour = [];
  if (ffBlock) {
    for (let rd = 1; rd <= 2; rd++) {
      for (let i = 1; i <= (rd === 1 ? 4 : 2); i += 2) {
        const side = (j) => {
          const name = resolve(ffBlock.p[`RD${rd}-team${j}`]);
          return { name, seed: (teams.get(name) || {}).seed, pts: score(ffBlock.p[`RD${rd}-score${j}`]) };
        };
        games.push({ year, round: rd + 4, region: 'Final Four', a: side(i), b: side(i + 1) });
      }
    }
    for (let j = 1; j <= 4; j++) finalFour.push((teams.get(resolve(ffBlock.p[`RD1-team${j}`])) || {}).region);
  }
  return { teams, games, regions, finalFour };
}

// ---------- Ratings from box scores ----------

// venuePrior: per-team { S, N } home-court residual sums from earlier seasons (already decayed), so a venue's edge
// (altitude, a loud gym) can be estimated from more than one season of home games.
function computeRatings(games, minGames = 10, venuePrior = null) {
  const teams = new Map();
  const T = (n) => {
    if (!teams.has(n)) teams.set(n, { games: [], f: {}, a: {}, w: 0, l: 0, poss: 0 });
    return teams.get(n);
  };
  const add = (acc, b) => { for (const k in b) acc[k] = (acc[k] || 0) + b[k]; };
  for (const g of games) {
    const A = T(g.t1), B = T(g.t2);
    add(A.f, g.b1); add(A.a, g.b2); add(B.f, g.b2); add(B.a, g.b1);
    A.poss += g.poss; B.poss += g.poss;
    if (g.b1.pts > g.b2.pts) { A.w++; B.l++; } else { B.w++; A.l++; }
    const o1 = 100 * g.b1.pts / g.poss, o2 = 100 * g.b2.pts / g.poss;
    A.games.push({ opp: g.t2, off: o1, def: o2, loc: g.loc1, poss: g.poss, date: g.date, type: g.type, margin: g.b1.pts - g.b2.pts, tpm: g.b1.tpm, tpa: g.b1.tpa });
    B.games.push({ opp: g.t1, off: o2, def: o1, loc: -g.loc1, poss: g.poss, date: g.date, type: g.type, margin: g.b2.pts - g.b1.pts, tpm: g.b2.tpm, tpa: g.b2.tpa });
  }
  // Additive opponent adjustment: off = mu + O_i + D_j + h*loc, solved by alternating averages.
  let mu = 0, n = 0;
  for (const t of teams.values()) for (const g of t.games) { mu += g.off; n++; }
  mu /= n;
  let tempoMu = 0;
  for (const t of teams.values()) for (const g of t.games) tempoMu += g.poss;
  tempoMu /= n;
  for (const t of teams.values()) { t.O = 0; t.D = 0; t.Tm = 0; }
  let h = 0;
  for (let it = 0; it < 60; it++) {
    for (const t of teams.values()) {
      let so = 0, sd = 0, st = 0;
      for (const g of t.games) {
        const o = teams.get(g.opp);
        so += g.off - mu - o.D - h * g.loc;
        sd += g.def - mu - o.O + h * g.loc;
        st += g.poss - tempoMu - o.Tm;
      }
      const k = t.games.length + 2; // light shrinkage toward average for teams with few games
      t.O = so / k; t.D = sd / k; t.Tm = st / k;
    }
    let hs = 0, hn = 0;
    for (const t of teams.values()) for (const g of t.games) if (g.loc) {
      const o = teams.get(g.opp);
      hs += g.loc * (g.off - mu - t.O - o.D); hn++;
    }
    h = hs / hn;
  }
  // Per-team home-court edge. The league-wide h treats every home floor alike; altitude gyms and some arenas are
  // worth more, which inflates those teams' ratings and shows up as underperformance on neutral courts. For each host,
  // the home team's margin residual over its home games estimates 2 x its edge. Empirical Bayes shrinks each edge
  // toward h by how noisy it is: B = tau^2 / (tau^2 + sigma^2 / 4N).
  const venue = {};
  let ev = 0, en = 0;
  for (const [name, t] of teams) for (const g of t.games) if (g.loc === 1) {
    const o = teams.get(g.opp), e = (g.off - g.def) - ((t.O + o.D) - (o.O + t.D));
    const v = venue[name] = venue[name] || { S: 0, N: 0, SS: 0 }; v.S += e; v.N++; v.SS += e * e; ev += (e - 2 * h) ** 2; en++;
  }
  const sigma2 = en ? ev / en : 1;
  const hca = {};
  if (TEAM_HCA && en) {
    const est = [];
    for (const name of teams.keys()) {
      const v = venue[name] || { S: 0, N: 0 }, p = (venuePrior && venuePrior[name]) || { S: 0, N: 0 };
      const N = v.N + p.N;
      if (N >= 5) est.push({ name, raw: (v.S + p.S) / (2 * N), samp: sigma2 / (4 * N), elev: elevOf(name) });
    }
    const m = est.reduce((s, x) => s + x.raw, 0) / (est.length || 1);
    // Prior for each venue: the league edge plus beta x (elevation above the average known campus), beta fit by
    // precision-weighted least squares across all venues with a known elevation (hundreds of venues, so it's precise).
    const known = est.filter(x => x.elev != null), ebar = known.reduce((s, x) => s + x.elev, 0) / (known.length || 1);
    let sxy = 0, sxx = 0;
    for (const x of known) { const w = 1 / x.samp; sxy += w * (x.elev - ebar) * (x.raw - m); sxx += w * (x.elev - ebar) ** 2; }
    const beta = sxx ? sxy / sxx : 0;
    const prior = (x) => m + (x.elev != null ? beta * (x.elev - ebar) : 0);
    const tau2 = Math.max(0.05, est.reduce((s, x) => s + (x.raw - prior(x)) ** 2, 0) / (est.length || 1) - est.reduce((s, x) => s + x.samp, 0) / (est.length || 1));
    for (const x of est) hca[x.name] = h + (prior(x) - m) + (tau2 / (tau2 + x.samp)) * (x.raw - prior(x));
    venueBeta = beta;
    if (process.env.HCA_DEBUG && minGames === 10) console.log(`  venue edges: altitude slope ${beta.toFixed(2)} per km, tau ${Math.sqrt(tau2).toFixed(2)}`);
    // Re-solve the ratings with each game's venue edge belonging to the host.
    const hostH = (t, g) => (g.loc === 1 ? (hca[t.name] ?? h) : g.loc === -1 ? (hca[g.opp] ?? h) : 0);
    for (const [name, t] of teams) t.name = name;
    for (let it = 0; it < 40; it++) for (const t of teams.values()) {
      let so = 0, sd = 0;
      for (const g of t.games) { const o = teams.get(g.opp), hv = hostH(t, g); so += g.off - mu - o.D - hv * g.loc; sd += g.def - mu - o.O + hv * g.loc; }
      const k = t.games.length + 2; t.O = so / k; t.D = sd / k;
    }
  }
  const out = {};
  for (const [name, t] of teams) {
    if (t.games.length < minGames) continue;
    const f = t.f, a = t.a;
    const adjO = mu + t.O, adjD = mu + t.D;
    const sorted = t.games.slice().sort((x, y) => x.date - y.date);
    const hv = (g) => (g.loc === 1 ? (hca[name] ?? h) : g.loc === -1 ? (hca[g.opp] ?? h) : 0);
    const gameEM = (g) => {
      const o = teams.get(g.opp);
      return (g.off - o.D - hv(g) * g.loc) - (g.def - o.O + hv(g) * g.loc);
    };
    const last = sorted.slice(-10);
    const sos = t.games.reduce((s, g) => s + (teams.get(g.opp).O - teams.get(g.opp).D), 0) / t.games.length;
    const rawO = 100 * f.pts / t.poss, rawD = 100 * a.pts / t.poss;
    const pyth = Math.pow(rawO, 11.5) / (Math.pow(rawO, 11.5) + Math.pow(rawD, 11.5));
    const wp = t.w / (t.w + t.l);
    const emList = t.games.map(gameEM);
    const emMean = emList.reduce((s, x) => s + x, 0) / emList.length;
    const emSd = Math.sqrt(emList.reduce((s, x) => s + (x - emMean) ** 2, 0) / emList.length);
    out[name] = {
      w: t.w, l: t.l,
      adjO, adjD, adjEM: adjO - adjD, adjT: tempoMu + t.Tm,
      efgO: (f.fgm + 0.5 * f.tpm) / f.fga, efgD: (a.fgm + 0.5 * a.tpm) / a.fga,
      toO: f.tov / t.poss, toD: a.tov / t.poss,
      orbO: f.orb / (f.orb + a.drb), orbD: a.orb / (a.orb + f.drb),
      ftrO: f.fta / f.fga, ftrD: a.fta / a.fga,
      tprO: f.tpa / f.fga, tprD: a.tpa / a.fga,
      tpO: f.tpm / f.tpa, tpD: a.tpm / a.tpa,
      twoO: (f.fgm - f.tpm) / (f.fga - f.tpa), twoD: (a.fgm - a.tpm) / (a.fga - a.tpa),
      ftp: f.ftm / f.fta, astR: f.ast / f.fgm,
      blkR: f.blk / (a.fga - a.tpa), stlR: f.stl / t.poss,
      winPct: wp, sos, luck: wp - pyth,
      form: last.reduce((s, g) => s + gameEM(g), 0) / last.length,
      consistency: emSd,
      hca: hca[name] ?? h, // this team's home-court edge (points per 100 possessions, each side)
      ...momentum(sorted, gameEM, adjO - adjD, teams, f.tpm / f.tpa),
    };
  }
  return { ratings: out, homeAdv: h, mu, hca, venue };
}

// "Spark" stats from the game log, in date order: how high a team can play, whether its form runs hot
// and cold, where it's trending, how it does in close games and against better teams. Prefixed mo_ and
// kept out of the base network's inputs; the tournament stage decides whether they help.
function momentum(sorted, gameEM, ownEM, teams, seasonTp) {
  const em = sorted.map(gameEM), n = em.length;
  const mean = em.reduce((s, x) => s + x, 0) / n;
  const pct = (q) => { const a = em.slice().sort((x, y) => x - y); return a[Math.min(n - 1, Math.floor(q * (n - 1)))]; };
  // Lag-1 autocorrelation of performance: positive = good games follow good games (streaky).
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { den += (em[i] - mean) ** 2; if (i) num += (em[i] - mean) * (em[i - 1] - mean); }
  const last10 = em.slice(-10), xm = (last10.length - 1) / 2, ym = last10.reduce((s, x) => s + x, 0) / last10.length;
  let sxy = 0, sxx = 0;
  last10.forEach((y, i) => { sxy += (i - xm) * (y - ym); sxx += (i - xm) ** 2; });
  let streak = 0, longest = 0, run = 0;
  for (const g of sorted) { if (g.margin > 0) { run++; longest = Math.max(longest, run); } else run = 0; }
  for (let i = sorted.length - 1; i >= 0 && sorted[i].margin > 0; i--) streak++;
  const close = sorted.filter(g => Math.abs(g.margin) <= 5);
  const tpGames = sorted.filter(g => g.tpa >= 10).map(g => g.tpm / g.tpa);
  const tpMean = tpGames.reduce((s, x) => s + x, 0) / (tpGames.length || 1);
  const recentTp = sorted.slice(-5).reduce((s, g) => [s[0] + g.tpm, s[1] + g.tpa], [0, 0]);
  const tougher = sorted.filter(g => { const o = teams.get(g.opp); return o.O - o.D >= ownEM + 5; });
  return {
    mo_ceiling: pct(0.9), mo_floor: pct(0.1),
    mo_streaky: den ? num / den : 0,
    mo_slope: sxx ? sxy / sxx : 0,
    mo_last5: em.slice(-5).reduce((s, x) => s + x, 0) / Math.min(5, n) - mean,
    mo_win_streak: streak, mo_long_streak: longest,
    mo_close_wp: close.length >= 3 ? close.filter(g => g.margin > 0).length / close.length : 0.5,
    mo_close_games: close.length,
    mo_tp_sd: tpGames.length > 2 ? Math.sqrt(tpGames.reduce((s, x) => s + (x - tpMean) ** 2, 0) / tpGames.length) : 0,
    mo_tp_hot: recentTp[1] ? recentTp[0] / recentTp[1] - seasonTp : 0,
    mo_conf_tourney_w: sorted.filter(g => g.type === 2 && g.margin > 0).length,
    mo_giant_wins: tougher.filter(g => g.margin > 0).length,
    mo_giant_rate: tougher.length >= 3 ? tougher.filter(g => g.margin > 0).length / tougher.length : 0,
  };
}

// ---------- Main ----------

const dataset = { years: [], teams: {}, games: [], brackets: {} };
// Training set: rolling two-week snapshots. Ratings use only games before the snapshot date;
// rows are the games played in the following two weeks.
const training = { snapshots: {}, rows: [] };
const DAY = 864e5;
const pick = (r) => { const o = {}; for (const k in r) o[k] = +r[k].toPrecision(5); return o; };
const unmatched = new Set();
// Home-court evidence from earlier seasons (decayed), per team: lets venue edges use more than one season of games.
let venuePrior = {};
for (const year of YEARS) {
  const sked = JSON.parse(fs.readFileSync(path.join(ROOT, 'raw', `sked${year}.json`), 'utf8'));
  const all = seasonGames(sked);
  const bartNames = new Set(all.flatMap(g => [g.t1, g.t2]));
  const match = makeMatcher(bartNames);
  const wiki = fs.readFileSync(path.join(ROOT, 'raw', 'wiki', `${year}.txt`), 'utf8');
  const tour = tournamentFromWiki(year, wiki, match, unmatched);

  // Cutoff: the first postseason game between two NCAA tournament teams.
  const field = new Set(tour.teams.keys());
  const ncaa = all.filter(g => g.type === 3 && field.has(g.t1) && field.has(g.t2));
  const cutoff = Math.min(...ncaa.map(g => g.date));
  const pre = all.filter(g => g.date < cutoff && g.type !== 3);
  const { ratings, homeAdv, venue } = computeRatings(pre, 10, venuePrior);

  // Cross-check bracket scores against the box-score file.
  let checked = 0, mismatched = 0;
  for (const g of tour.games) {
    const hit = ncaa.find(x => (x.t1 === g.a.name && x.t2 === g.b.name) || (x.t1 === g.b.name && x.t2 === g.a.name));
    if (!hit) continue;
    checked++;
    const pa = hit.t1 === g.a.name ? hit.b1.pts : hit.b2.pts;
    const pb = hit.t1 === g.a.name ? hit.b2.pts : hit.b1.pts;
    g.date = hit.date;
    if (g.a.pts == null || g.b.pts == null) { g.a.pts = pa; g.b.pts = pb; }
    else if (g.a.pts !== pa || g.b.pts !== pb) mismatched++;
  }

  let snaps = 0;
  for (let D = Date.UTC(year, 0, 1); D < cutoff; D += 14 * DAY) { // UTC, like the game dates (build/lib/sked.js)
    const end = Math.min(D + 14 * DAY, cutoff);
    const snap = computeRatings(all.filter(g => g.date < D && g.type !== 3), 8, venuePrior).ratings;
    const key = `${year}-${snaps++}`;
    const used = new Set();
    for (const g of all) {
      if (g.date < D || g.date >= end || g.type === 3 || !snap[g.t1] || !snap[g.t2]) continue;
      training.rows.push([key, g.t1, g.t2, g.loc1, g.b1.pts > g.b2.pts ? 1 : 0, g.b1.pts - g.b2.pts]);
      used.add(g.t1); used.add(g.t2);
    }
    training.snapshots[key] = {};
    for (const n of used) training.snapshots[key][n] = pick(snap[n]);
  }
  // Other postseason events (NIT, CBI, ...) are played after the cutoff, so pre-tournament ratings are fair game.
  const preKey = `${year}-pre`;
  training.snapshots[preKey] = {};
  let other = 0;
  for (const g of all) {
    if (g.type !== 3 || (field.has(g.t1) && field.has(g.t2)) || !ratings[g.t1] || !ratings[g.t2]) continue;
    training.rows.push([preKey, g.t1, g.t2, g.loc1, g.b1.pts > g.b2.pts ? 1 : 0, g.b1.pts - g.b2.pts]);
    training.snapshots[preKey][g.t1] = pick(ratings[g.t1]); training.snapshots[preKey][g.t2] = pick(ratings[g.t2]);
    other++;
  }
  console.log(`   ${year}: ${snaps} snapshots, other postseason games ${other}, training rows so far ${training.rows.length}`);

  // Carry this season's pre-tournament home games forward for next season's venue edges.
  const nextPrior = {};
  for (const t of new Set([...Object.keys(venuePrior), ...Object.keys(venue)])) {
    const p = venuePrior[t] || { S: 0, N: 0 }, v = venue[t] || { S: 0, N: 0 };
    nextPrior[t] = { S: VENUE_DECAY * p.S + v.S, N: VENUE_DECAY * p.N + v.N };
  }
  venuePrior = nextPrior;
  dataset.years.push(year);
  dataset.teams[year] = {};
  for (const [name, t] of tour.teams) {
    if (!ratings[name]) { unmatched.add(`${year}: no ratings for ${name}`); continue; }
    dataset.teams[year][name] = { seed: t.seed, region: t.region, ...ratings[name] };
  }
  const good = tour.games.filter(g => g.a.name && g.b.name && g.a.pts != null && g.b.pts != null && g.a.pts !== g.b.pts
    && dataset.teams[year][g.a.name] && dataset.teams[year][g.b.name]);
  for (const g of good) dataset.games.push({ year, round: g.round, region: g.region,
    a: g.a.name, b: g.b.name, sa: g.a.pts, sb: g.b.pts,
    date: g.date ? new Date(g.date).toISOString().slice(0, 10) : null });
  dataset.brackets[year] = { regions: tour.regions, finalFour: tour.finalFour };
  console.log(`${year}: field ${tour.teams.size}, bracket games ${tour.games.length}, usable ${good.length}, ` +
    `box-score check ${checked - mismatched}/${checked}, pre-tourney games ${pre.length}, home adv ${homeAdv.toFixed(2)}, ` +
    `regions ${tour.regions.join('/')}, FF ${tour.finalFour.join('-')}`);
}
if (unmatched.size) console.log('UNMATCHED:\n' + [...unmatched].join('\n'));
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'dataset.json'), JSON.stringify(dataset));
fs.writeFileSync(path.join(ROOT, 'data', 'training.json'), JSON.stringify(training));
console.log(`tournament games: ${dataset.games.length}, training rows: ${training.rows.length}`);
