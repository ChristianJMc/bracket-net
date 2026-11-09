// Gates to run after `node build/walkforward.js --run` (and its --control shuffled run).
// Each check prints PASS / FAIL / SKIP; the exit code is 1 if any FAIL.
//   node build/checks.js
const fs = require('fs');
const path = require('path');
const { CONFIG } = require('./walkforward');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const has = (f) => fs.existsSync(path.join(ROOT, f));
const results = [];
const check = (name, fn) => {
  try { const r = fn(); results.push({ name, ...r }); } catch (e) { results.push({ name, status: e.skip ? 'SKIP' : 'FAIL', detail: e.message }); }
};

const wf = has('data/walkforward-report.json') ? read('data/walkforward-report.json') : null;
const ctl = has('data/walkforward-report-shuffled.json') ? read('data/walkforward-report-shuffled.json') : null;
const need = (x, what) => { if (!x) throw Object.assign(new Error(`${what} not found`), { skip: true }); };
const G = CONFIG.gates;

check('Tournament model beats the base model (walk-forward log loss)', () => {
  need(wf, 'walk-forward report');
  const gain = wf.summary.llA - wf.summary.llB;
  return { status: gain >= G.minLogLossGain ? 'PASS' : 'FAIL', detail: `A ${wf.summary.llA.toFixed(4)} → B ${wf.summary.llB.toFixed(4)} (gain ${gain.toFixed(4)}, need ${G.minLogLossGain})` };
});

check('Tournament model wins most seasons', () => {
  need(wf, 'walk-forward report');
  return { status: wf.summary.yearsBWins >= G.minYearsWon ? 'PASS' : 'FAIL', detail: `${(wf.summary.yearsBWins * 100).toFixed(0)}% of seasons (need ${G.minYearsWon * 100}%)` };
});

check('No season gets much worse', () => {
  need(wf, 'walk-forward report');
  const worst = Object.entries(wf.years).map(([y, v]) => [y, v.llB - v.llA]).sort((a, b) => b[1] - a[1])[0];
  return { status: worst[1] <= G.maxYearRegression ? 'PASS' : 'FAIL', detail: `worst: ${worst[0]} (+${worst[1].toFixed(4)})` };
});

check('Not memorizing: train vs test log loss gap', () => {
  need(wf, 'walk-forward report');
  const gap = wf.summary.llB - wf.summary.trainLLB;
  return { status: gap <= G.maxTrainTestGap ? 'PASS' : 'FAIL', detail: `train ${wf.summary.trainLLB.toFixed(4)}, test ${wf.summary.llB.toFixed(4)} (gap ${gap.toFixed(4)}, max ${G.maxTrainTestGap})` };
});

check('Leakage control: stage B on shuffled labels learns nothing', () => {
  need(ctl, 'shuffled-label control report (run with --control shuffled)');
  // With random labels the model can only match stage A by ignoring them; doing better means leakage.
  const ok = ctl.summary.llB >= ctl.summary.llA - 0.001;
  return { status: ok ? 'PASS' : 'FAIL', detail: `shuffled B ${ctl.summary.llB.toFixed(4)} vs A ${ctl.summary.llA.toFixed(4)}` };
});

// The adopted model has to beat the benchmarks a casual fan could build: the better seed, and efficiency margin alone.
// Seasons are the resampling unit (season block bootstrap), and it must win in at least 90% of resamples.
for (const bench of ['seed', 'em']) {
  check(`Adopted model beats the ${bench === 'seed' ? 'seed-only' : 'efficiency-margin-only'} benchmark`, () => {
    need(wf && wf.models, 'walk-forward report with model comparison');
    need(has('data/walkforward-preds.json') ? 1 : 0, 'walk-forward predictions');
    if (wf.adopted === bench) throw Object.assign(new Error(`the adopted model is this benchmark: nothing more complex beat it by more than one standard error`), { skip: true });
    const { pairedBootstrap, logLoss } = require('./lib/metrics');
    const { gameKey } = require('./news/store');
    const P = read('data/walkforward-preds.json').models, d = read('data/dataset.json');
    const byYear = {};
    for (const g of d.games) {
      const k = gameKey(g), a = P[wf.adopted] && P[wf.adopted][k], b = P[bench][k];
      if (a == null || b == null) continue;
      const y = g.sa > g.sb ? 1 : 0;
      (byYear[g.year] = byYear[g.year] || []).push({ x: logLoss(a, y), y: logLoss(b, y) });
    }
    const r = pairedBootstrap(byYear);
    return { status: r.pBetter >= 0.9 ? 'PASS' : 'FAIL',
      detail: `${wf.adopted} minus ${bench}: ${r.mean.toFixed(4)} (90% interval ${r.lo90.toFixed(4)} to ${r.hi90.toFixed(4)}); better in ${(r.pBetter * 100).toFixed(0)}% of season resamples` };
  });
}

check('Calibration of the adopted predictions', () => {
  need(has('data/walkforward-preds.json') ? 1 : 0, 'walk-forward predictions');
  const preds = read('data/walkforward-preds.json').preds, d = read('data/dataset.json');
  const { gameKey } = require('./news/store');
  const bins = Array.from({ length: 5 }, () => ({ n: 0, p: 0, w: 0 }));
  for (const g of d.games) {
    const p = preds[gameKey(g)]; if (p == null) continue;
    const pf = Math.max(p, 1 - p), won = (p >= 0.5) === (g.sa > g.sb);
    const b = bins[Math.min(4, Math.floor((pf - 0.5) / 0.1))]; b.n++; b.p += pf; b.w += won ? 1 : 0;
  }
  const n = bins.reduce((s, b) => s + b.n, 0);
  const ece = bins.reduce((s, b) => s + (b.n ? Math.abs(b.p / b.n - b.w / b.n) * b.n / n : 0), 0);
  return { status: ece <= 0.04 ? 'PASS' : 'FAIL', detail: `expected calibration error ${(ece * 100).toFixed(1)} pts (max 4.0)` };
});

check('Feature choice is stable across seasons', () => {
  need(wf, 'walk-forward report');
  const sets = Object.values(wf.selected).map(s => new Set(s));
  let sim = 0, pairs = 0;
  for (let i = 1; i < sets.length; i++) {
    const a = sets[i - 1], b = sets[i], inter = [...a].filter(x => b.has(x)).length, uni = new Set([...a, ...b]).size;
    sim += uni ? inter / uni : 1; pairs++;
  }
  const avg = sim / pairs;
  return { status: avg >= 0.4 ? 'PASS' : 'FAIL', detail: `average overlap between consecutive seasons ${(avg * 100).toFixed(0)}% (unstable choices suggest noise)` };
});

// Each kind of input must earn its place: compare the main run with a run that leaves that kind out
// (node build/walkforward.js --run --exclude-kind <kind>). If leaving it out is as good or better,
// the model is better off without it.
for (const kind of ['opinion', 'hybrid', 'projection']) {
  check(`${kind[0].toUpperCase() + kind.slice(1)} inputs earn their place`, () => {
    need(wf, 'walk-forward report');
    const f = `data/walkforward-report-no-${kind}.json`;
    need(has(f) ? 1 : 0, `${f} (run with --exclude-kind ${kind})`);
    const without = read(f).summary.llB, withIt = wf.summary.llB;
    const gain = without - withIt;
    if (Math.abs(gain) < 1e-9) throw Object.assign(new Error(`no ${kind} input was ever selected, so there is nothing to drop`), { skip: true });
    return { status: gain > 0 ? 'PASS' : 'FAIL',
      detail: `with ${withIt.toFixed(4)} vs without ${without.toFixed(4)}: ${gain > 0 ? 'helps by ' + gain.toFixed(4) : 'no help; set excludeKinds to drop it'}` };
  });
}

let failed = false;
for (const r of results) {
  const status = r.status;
  if (status === 'FAIL') failed = true;
  console.log(`${status.padEnd(4)}  ${r.name}\n      ${r.detail}`);
}
process.exit(failed ? 1 : 0);
