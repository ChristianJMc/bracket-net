// Scoring and comparison tools used by the walk-forward and checks.
//   Proper scoring rules: log loss (main) and Brier score. Accuracy is reported but never used to choose.
//   Calibration: reliability bins and expected calibration error.
//   Uncertainty: block bootstrap over seasons. Games within a season share a bracket and conditions, so seasons,
//   not games, are the independent units; resampling games would overstate confidence.
//   Model choice: the one-standard-error rule. Pick the simplest model whose loss is within one bootstrap SE of the
//   best, because with ~15 test seasons small gaps are mostly noise.
//   Logistic regression with L2 and sample weights (Newton's method), for baselines, ridge models and stacking.
const { NN } = require('../nn');

const clamp = (p) => Math.min(1 - 1e-9, Math.max(1e-9, p));
const logLoss = (p, y) => -(y ? Math.log(clamp(p)) : Math.log(1 - clamp(p)));
const brier = (p, y) => (p - y) ** 2;
const logit = (p) => Math.log(clamp(p) / (1 - clamp(p)));

function score(items) { // items: [{ p, y }]
  const n = items.length;
  if (!n) return { n: 0 };
  let ll = 0, br = 0, acc = 0;
  for (const { p, y } of items) { ll += logLoss(p, y); br += brier(p, y); acc += (p > 0.5) === (y === 1) ? 1 : (p === 0.5 ? 0.5 : 0); }
  return { n, logLoss: ll / n, brier: br / n, accuracy: acc / n, ece: reliability(items).ece };
}

// Bins on the favorite's chance (0.5–1), so both orientations of a game land in the same bin.
function reliability(items, edges = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001]) {
  const bins = edges.slice(0, -1).map((lo, i) => ({ lo, hi: Math.min(1, edges[i + 1]), n: 0, predicted: 0, actual: 0 }));
  for (const { p, y } of items) {
    const pf = Math.max(p, 1 - p), won = (p >= 0.5 ? y : 1 - y);
    const b = bins.find(b => pf >= b.lo && pf < (b.hi === 1 ? 1.0001 : b.hi)); b.n++; b.predicted += pf; b.actual += won;
  }
  const n = items.length;
  let ece = 0;
  for (const b of bins) if (b.n) { b.predicted /= b.n; b.actual /= b.n; ece += Math.abs(b.predicted - b.actual) * b.n / n; }
  return { bins, ece };
}

// Paired season-block bootstrap of mean log-loss difference (model X minus model Y), game-weighted.
// byYear: { year: [{ x, y }] } with per-game losses. Returns mean, SE, 90% interval and P(diff < 0).
function pairedBootstrap(byYear, { B = 2000, seed = 7 } = {}) {
  const years = Object.keys(byYear), r = NN.rng(seed);
  const tot = (ys) => { let s = 0, n = 0; for (const y of ys) for (const d of byYear[y]) { s += d.x - d.y; n++; } return s / n; };
  const mean = tot(years), draws = [];
  for (let b = 0; b < B; b++) draws.push(tot(years.map(() => years[Math.floor(r() * years.length)])));
  draws.sort((a, b) => a - b);
  const m = draws.reduce((s, v) => s + v, 0) / B;
  const se = Math.sqrt(draws.reduce((s, v) => s + (v - m) ** 2, 0) / (B - 1));
  return { mean, se, lo90: draws[Math.floor(0.05 * B)], hi90: draws[Math.floor(0.95 * B)], pBetter: draws.filter(v => v < 0).length / B };
}

// models: [{ name, complexity, losses: { year: [loss per game] } }] (same games, same order, for every model).
function oneSERule(models) {
  const mean = (m) => { let s = 0, n = 0; for (const v of Object.values(m.losses)) for (const l of v) { s += l; n++; } return s / n; };
  const best = models.reduce((a, b) => (mean(b) < mean(a) ? b : a));
  const rows = models.map(m => {
    const byYear = Object.fromEntries(Object.keys(m.losses).map(y => [y, m.losses[y].map((l, i) => ({ x: l, y: best.losses[y][i] }))]));
    return { name: m.name, complexity: m.complexity, logLoss: mean(m), vsBest: pairedBootstrap(byYear) };
  });
  const within = rows.filter(r => r.vsBest.mean <= r.vsBest.se || r.name === best.name).sort((a, b) => a.complexity - b.complexity);
  return { best: best.name, chosen: within[0].name, rows };
}

// Weighted L2-penalized logistic regression without intercept (so it stays symmetric in A/B for antisymmetric x).
// l2 is per coefficient (number or array); penalty = 0.5 * l2 * w^2 * n. Returns coefficients.
function fitLogistic(xs, ys, { l2 = 0, weights = null, prior = null, iters = 25 } = {}) {
  const k = xs[0].length, n = xs.length, w = prior ? Float64Array.from(prior) : new Float64Array(k);
  const lam = (j) => (Array.isArray(l2) || ArrayBuffer.isView(l2) ? l2[j] : l2) * n;
  const center = prior || new Float64Array(k); // shrink toward the prior coefficients, not toward zero
  for (let it = 0; it < iters; it++) {
    const g = new Float64Array(k), H = Array.from({ length: k }, () => new Float64Array(k));
    for (let i = 0; i < n; i++) {
      const x = xs[i], sw = weights ? weights[i] : 1;
      let z = 0; for (let a = 0; a < k; a++) z += w[a] * x[a];
      const p = 1 / (1 + Math.exp(-z)), q = p * (1 - p) * sw;
      for (let a = 0; a < k; a++) { g[a] += (p - ys[i]) * x[a] * sw; for (let b = a; b < k; b++) H[a][b] += q * x[a] * x[b]; }
    }
    for (let a = 0; a < k; a++) { for (let b = 0; b < a; b++) H[a][b] = H[b][a]; g[a] += lam(a) * (w[a] - center[a]); H[a][a] += lam(a) + 1e-9 * n; }
    const d = solve(H, g);
    let step = 0; for (let a = 0; a < k; a++) { w[a] -= d[a]; step = Math.max(step, Math.abs(d[a])); }
    if (step < 1e-8) break;
  }
  return Array.from(w);
}
const dot = (w, x) => { let z = 0; for (let a = 0; a < w.length; a++) z += w[a] * x[a]; return z; };

function solve(A, b) {
  const k = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c] / M[c][c]; if (f) for (let cc = c; cc <= k; cc++) M[r][cc] -= f * M[c][cc]; }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[k] / row[i]));
}

// Standard normal CDF (Abramowitz-Stegun 7.1.26).
function normCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
  return 0.5 * (1 + (z >= 0 ? y : -y));
}

// Least squares on point margin without an intercept (so it stays symmetric in A and B), plus the residual SD:
// P(A wins) = Phi(predicted margin / sigma). Margins carry more information per game than wins and losses.
function fitMargin(xs, margins, { l2 = 1e-6, weights = null } = {}) {
  const k = xs[0].length, A = Array.from({ length: k }, () => new Float64Array(k)), b = new Float64Array(k);
  xs.forEach((x, i) => { const w = weights ? weights[i] : 1; for (let a = 0; a < k; a++) { b[a] += w * x[a] * margins[i]; for (let c = a; c < k; c++) A[a][c] += w * x[a] * x[c]; } });
  for (let a = 0; a < k; a++) { for (let c = 0; c < a; c++) A[a][c] = A[c][a]; A[a][a] += l2 * xs.length; }
  const w = solve(A.map(r => Array.from(r)), Array.from(b));
  const sigma = Math.sqrt(xs.reduce((s, x, i) => s + (margins[i] - dot(w, x)) ** 2, 0) / xs.length);
  return { w, sigma };
}

module.exports = { logLoss, brier, logit, score, reliability, pairedBootstrap, oneSERule, fitLogistic, fitMargin, normCdf, dot };
