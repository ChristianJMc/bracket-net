// Ways to slice tournament games so patterns aren't hidden by pooling. A stat can push upsets one way in
// 5-vs-12 games and the other way in 2-vs-15, or matter only since the transfer-portal era; lumping all
// games together averages that away. Each segmenter maps a game to a level (or null when it doesn't apply).
//
// Game shape: { year, round, seedFav, seedDog, pFav, confFav, confDog }

const POWER = new Set(['ACC', 'B10', 'B12', 'BE', 'SEC', 'P12']);

const SEGMENTS = {
  // First-round seed lines are the classic upset slots; later rounds group by seed gap.
  seed_line: (g) => g.round === 1 ? `${Math.min(g.seedFav, g.seedDog)}v${Math.max(g.seedFav, g.seedDog)}` : null,
  later_round_gap: (g) => g.round >= 2 ? (Math.abs(g.seedDog - g.seedFav) <= 2 ? 'gap 0-2' : Math.abs(g.seedDog - g.seedFav) <= 5 ? 'gap 3-5' : 'gap 6+') : null,
  round: (g) => ['First Four', 'Round of 64', 'Round of 32', 'Sweet 16+', 'Sweet 16+', 'Sweet 16+', 'Sweet 16+'][g.round],
  // 2021 brought the one-time transfer rule, NIL and the COVID extra year (older rosters through 2025).
  era: (g) => g.year <= 2014 ? '2008-2014' : g.year <= 2019 ? '2015-2019' : '2021-2026 (portal/NIL)',
  underdog_conference: (g) => g.confDog == null ? null : POWER.has(g.confDog) ? 'power underdog' : 'mid-major underdog',
  favorite_strength: (g) => g.pFav < 0.65 ? 'close (50-65%)' : g.pFav < 0.8 ? 'clear (65-80%)' : 'heavy (80%+)',
};

function levels(g) {
  const out = {};
  for (const [name, f] of Object.entries(SEGMENTS)) { const v = f(g); if (v != null) out[name] = v; }
  return out;
}

module.exports = { SEGMENTS, POWER, levels };
