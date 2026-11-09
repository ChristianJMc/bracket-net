// Data checks that run before anything trains, to catch broken joins, upstream changes and tampering
// (a poisoned value is just a bad number that looks plausible, so the checks compare each season with the others):
//   1. every input is a finite number or missing; no strings, no Infinity
//   2. outliers: a value more than OUTLIER_Z robust z-scores (median / MAD over all seasons) from the rest
//   3. a season whose column suddenly disagrees with our own efficiency margin (a wrong team join or a swapped file
//      shows up as a correlation that collapses for one year)
//   4. coverage: a source that silently lost most of a season's teams
// Returns { problems, quarantine, warnings }. Problems (non-numbers, unknown teams) stop the pipeline. Quarantined
// season-columns (check 3) are set to missing by build/lib/features.js. Warnings are listed in docs/data-validation.md.
const OUTLIER_Z = 10;

const median = (v) => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function pearson(x, y) {
  const n = x.length; if (n < 10) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

function validate(dataset, features) {
  const problems = [], warnings = [], quarantine = [];
  const years = dataset.years;
  for (const c of Object.keys(features.columns)) {
    const all = [], perYear = {};
    for (const y of years) {
      const T = features.teams[y] || {};
      perYear[y] = [];
      for (const [team, v] of Object.entries(T)) {
        const x = v[c];
        if (x == null) continue;
        if (typeof x !== 'number' || !Number.isFinite(x)) { problems.push(`${c} ${y} ${team}: not a finite number (${JSON.stringify(x).slice(0, 40)})`); continue; }
        if (!dataset.teams[y] || !dataset.teams[y][team]) { problems.push(`${c} ${y}: "${team}" is not in that season's field`); continue; }
        all.push(x); perYear[y].push([x, dataset.teams[y][team].adjEM]);
      }
    }
    if (all.length < 30) continue;
    const med = median(all), mad = median(all.map(v => Math.abs(v - med))) * 1.4826;
    const zeroInflated = all.filter(v => v === med).length > 0.3 * all.length; // vote counts, flags: MAD means little
    if (mad > 0 && !zeroInflated) {
      const out = [];
      for (const y of years) for (const [team, v] of Object.entries(features.teams[y] || {})) {
        if (typeof v[c] === 'number' && Math.abs(v[c] - med) / mad > OUTLIER_Z) out.push(`${y} ${team} ${+v[c].toPrecision(4)}`);
      }
      if (out.length) warnings.push(`${c}: ${out.length} value(s) over ${OUTLIER_Z} robust SDs from the median: ${out.slice(0, 4).join('; ')}`);
    }
    // Agreement with our own efficiency margin, season by season (only for columns that track team strength).
    const rs = years.map(y => [y, pearson(perYear[y].map(p => p[0]), perYear[y].map(p => p[1]))]).filter(([, r]) => r != null);
    if (rs.length >= 5) {
      const typical = median(rs.map(([, r]) => r));
      if (Math.abs(typical) >= 0.6) for (const [y, r] of rs) {
        if (Math.sign(r) !== Math.sign(typical) || Math.abs(r) < Math.abs(typical) - 0.45)
          quarantine.push({ column: c, year: y, reason: `correlation with our efficiency margin ${r.toFixed(2)} vs ${typical.toFixed(2)} in a typical season` });
      }
    }
    // Coverage drop.
    const counts = years.map(y => perYear[y].length).filter(n => n > 0);
    if (counts.length >= 3) {
      const typ = median(counts);
      for (const y of years) if (perYear[y].length > 0 && perYear[y].length < 0.5 * typ)
        warnings.push(`${c} ${y}: only ${perYear[y].length} teams (typically ${typ})`);
    }
  }
  return { problems, quarantine, warnings };
}

module.exports = { validate, OUTLIER_Z };
