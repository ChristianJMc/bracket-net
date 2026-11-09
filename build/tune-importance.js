// Chooses how much "important" regular-season games count when training the base network (build/lib/importance.js).
// Each preset trains stage A walk-forward for the tuning seasons (2008-2011, never used as test seasons) and is
// scored on those seasons' NCAA tournaments. A preset replaces uniform weighting only if it wins by more than one
// standard error of the paired difference; otherwise uniform stays (simpler wins ties).
//   node build/tune-importance.js
const fs = require('fs');
const path = require('path');
const { CONFIG, stageA } = require('./walkforward');
const { PRESETS, SETTINGS } = require('./lib/importance');
const { logLoss } = require('./lib/metrics');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const TUNE_YEARS = [2008, 2009, 2010, 2011];

function main() {
  const ctx = { dataset: read('data/dataset.json'), training: read('data/training.json'), kaggle: { teams: {}, columns: {} } };
  const years = TUNE_YEARS.filter(y => y < CONFIG.firstTestYear && ctx.dataset.years.includes(y));
  const games = ctx.dataset.games.filter(g => years.includes(g.year));
  const losses = {};
  for (const [name, imp] of Object.entries(PRESETS)) {
    const l = [];
    for (const y of years) {
      const pA = stageA(ctx, y, false, { importance: imp, nets: 3 });
      for (const g of games.filter(g => g.year === y)) l.push(logLoss(pA(g), g.sa > g.sb ? 1 : 0));
    }
    losses[name] = l;
    console.log(`${name.padEnd(16)} ${(l.reduce((s, v) => s + v, 0) / l.length).toFixed(4)}`);
  }
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const rows = Object.keys(PRESETS).map(name => {
    const d = losses[name].map((v, i) => v - losses.uniform[i]);
    const m = mean(d), se = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (d.length - 1) / d.length);
    return { name, logLoss: mean(losses[name]), vsUniform: m, se: se || 0 };
  });
  const winners = rows.filter(r => r.name !== 'uniform' && r.vsUniform < -Math.max(r.se, 0.002)).sort((a, b) => a.vsUniform - b.vsUniform);
  const chosen = winners.length ? winners[0].name : 'uniform';
  fs.writeFileSync(SETTINGS, JSON.stringify({ chosen, tunedOn: years, games: games.length, rows, note: 'Replace uniform only when better by > 1 SE and > 0.002 log loss on tuning-season tournaments.' }, null, 1));
  console.log(`chosen: ${chosen}`);
}

if (require.main === module) main();
