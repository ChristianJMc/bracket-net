// One table of team-season inputs from every data/features-*.json file, so a new source is a new file and
// nothing else changes. Each file has the same shape:
//   { teams: { [year]: { [team]: { column: number } } }, columns: { column: { source, kind, ... } } }
// The Kaggle file also carries game-level travel, conference membership and AP poll extras, kept as-is.
// Column names must be unique across files (each source uses its own prefix); a clash is an error, not an overwrite.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
const ORDER = ['features-kaggle.json']; // first; others follow alphabetically

// raw: true skips the validation quarantine (validate.js itself needs the untouched values).
function loadFeatures({ only, raw = false } = {}) {
  const files = fs.existsSync(DATA) ? fs.readdirSync(DATA).filter(f => /^features-[a-z0-9-]+\.json$/.test(f)) : [];
  files.sort((a, b) => (ORDER.includes(b) - ORDER.includes(a)) || a.localeCompare(b));
  const out = { teams: {}, columns: {}, conf: {}, travel: {}, sources: [] };
  for (const f of files) {
    if (only && !only.includes(f)) continue;
    const d = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
    for (const [c, meta] of Object.entries(d.columns || {})) {
      if (out.columns[c]) throw new Error(`column ${c} is defined by both ${out.columns[c].from} and ${f}`);
      out.columns[c] = { ...meta, from: f };
    }
    for (const [y, T] of Object.entries(d.teams || {})) {
      const Y = out.teams[y] = out.teams[y] || {};
      for (const [team, v] of Object.entries(T)) Object.assign(Y[team] = Y[team] || {}, v);
    }
    if (d.conf) Object.assign(out.conf, d.conf);
    if (d.travel) Object.assign(out.travel, d.travel);
    if (d.lastGame) out.lastGame = Object.assign(out.lastGame || {}, d.lastGame);
    if (d.games) out.games = Object.assign(out.games || {}, d.games); // per-game, per-team values (level: 'game')
    for (const k of ['public', 'coverage', 'quarantined', 'unmatched']) if (d[k] && f === 'features-kaggle.json') out[k] = d[k];
    out.sources.push(f);
  }
  // Season-columns that failed build/lib/validate.js (written by build/pipeline.js) are treated as missing.
  const vf = path.join(DATA, 'validation.json');
  if (!raw && fs.existsSync(vf)) for (const { column, year } of JSON.parse(fs.readFileSync(vf, 'utf8')).quarantine || [])
    for (const v of Object.values(out.teams[year] || {})) if (column in v) v[column] = null;
  return out;
}

module.exports = { loadFeatures };
