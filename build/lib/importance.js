// How much each regular-season game counts when training the base network. Games that look like tournament games
// (two tournament-calibre teams, a neutral floor, late in the season or other postseason) can count more than a
// November blowout of a low-major. The weights are not hand-picked: build/tune-importance.js tries the presets on
// seasons that are never test years and writes the winner to data/importance-settings.json (uniform if none wins).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SETTINGS = path.join(ROOT, 'data', 'importance-settings.json');

const PRESETS = {
  uniform: null,
  caliber: { both: 2, one: 0.5 },
  neutral: { neutral: 1 },
  late: { late: 1 },
  caliber_neutral: { both: 2, one: 0.5, neutral: 1 },
  all: { both: 2, one: 0.5, neutral: 1, late: 1 },
};

// "Tournament calibre": efficiency margin at or above the 25th percentile of tournament teams.
function caliberEM(dataset) {
  const v = Object.values(dataset.teams).flatMap(T => Object.values(T).map(t => t.adjEM)).sort((a, b) => a - b);
  return v[Math.floor(0.25 * v.length)];
}

// key is the training snapshot key: "YEAR-i" (two-week windows from Jan 1; i >= 4 is about March) or "YEAR-pre"
// (other postseason events). A and B are the teams' ratings in that snapshot.
function weight(imp, key, A, B, loc, cal) {
  if (!imp) return 1;
  const ca = A.adjEM >= cal, cb = B.adjEM >= cal;
  const idx = key.slice(key.indexOf('-') + 1), late = idx === 'pre' || +idx >= 4;
  return (1 + (ca && cb ? imp.both || 0 : 0) + (ca !== cb ? imp.one || 0 : 0)) * (1 + (loc === 0 ? imp.neutral || 0 : 0)) * (1 + (late ? imp.late || 0 : 0));
}

// Rescale to mean 1, so weighting changes which games matter, not the effective learning rate.
function normalize(ws) { const m = ws.reduce((s, v) => s + v, 0) / ws.length; return ws.map(v => v / m); }

function current() {
  if (!fs.existsSync(SETTINGS)) return { name: 'uniform', imp: null };
  const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  return { name: s.chosen, imp: PRESETS[s.chosen] || null };
}

module.exports = { PRESETS, caliberEM, weight, normalize, current, SETTINGS };
