// Barttorvik season game files (raw/skedYYYY.json) → one record per D-I game with both box scores.
// Game dates are calendar dates with no time, so they're kept as UTC midnight: the same timestamp on every machine,
// whatever its time zone (local midnight would put a game on the previous day anywhere east of UTC).
function parseDate(s) {
  const [m, d, y] = s.split('/').map(Number);
  return Date.UTC(y < 100 ? 2000 + y : y, m - 1, d);
}

function seasonGames(sked) {
  const out = [];
  for (const r of sked) {
    const gs = r[50];
    if (!Array.isArray(gs) || gs.length < 35) continue;
    if (r[6] === 99) continue; // games against non-D-I opponents
    const box = (o) => ({ fgm: +gs[o], fga: +gs[o + 1], tpm: +gs[o + 2], tpa: +gs[o + 3], ftm: +gs[o + 4], fta: +gs[o + 5],
      orb: +gs[o + 6], drb: +gs[o + 7], ast: +gs[o + 9], stl: +gs[o + 10], blk: +gs[o + 11], tov: +gs[o + 12], pts: +gs[o + 14] });
    const t1 = gs[2], t2 = gs[3];
    const poss = +gs[34];
    if (!(poss > 30)) continue;
    let home = null;
    const at = String(r[3]).match(/ at \d*\s*(.+)$/);
    if (at) home = at[1].trim();
    out.push({ date: parseDate(r[1]), type: r[6], t1, t2, b1: box(4), b2: box(19), poss,
      loc1: home === t1 ? 1 : home === t2 ? -1 : 0 });
  }
  return out;
}

module.exports = { parseDate, seasonGames };
