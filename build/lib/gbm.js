// Gradient-boosted decision trees for "does A beat B?", starting from a base model's logit (offset), like LightGBM's
// init_score. Newton boosting on log loss with shallow trees, L2 on leaf values, row subsampling and a small learning
// rate. Symmetric by construction: trained on both orientations of every game, and the prediction is
// offset + (f(x) - f(-x)) / 2, so P(A beats B) = 1 - P(B beats A) exactly.
// How many trees to keep is chosen on held-out data by the caller (fit returns the loss after every tree).
const { NN } = require('../nn');

function buildTree(X, g, h, idx, cols, depth, opts, r) {
  let G = 0, H = 0;
  for (const i of idx) { G += g[i]; H += h[i]; }
  const leaf = { v: -opts.lr * G / (H + opts.lambda) };
  if (depth === 0 || idx.length < 2 * opts.minLeaf) return leaf;
  let best = null;
  const parent = G * G / (H + opts.lambda);
  for (const j of cols) {
    const order = idx.slice().sort((a, b) => X[a][j] - X[b][j]);
    let GL = 0, HL = 0;
    for (let k = 0; k < order.length - 1; k++) {
      const i = order[k]; GL += g[i]; HL += h[i];
      if (k + 1 < opts.minLeaf || order.length - k - 1 < opts.minLeaf) continue;
      const a = X[i][j], b = X[order[k + 1]][j];
      if (a === b) continue;
      const GR = G - GL, HR = H - HL;
      const gain = GL * GL / (HL + opts.lambda) + GR * GR / (HR + opts.lambda) - parent;
      if (gain > opts.minGain && (!best || gain > best.gain)) best = { gain, j, t: (a + b) / 2 };
    }
  }
  if (!best) return leaf;
  const L = idx.filter(i => X[i][best.j] <= best.t), R = idx.filter(i => X[i][best.j] > best.t);
  return { j: best.j, t: best.t, l: buildTree(X, g, h, L, cols, depth - 1, opts, r), r: buildTree(X, g, h, R, cols, depth - 1, opts, r) };
}
const evalTree = (t, x) => { while (t.v === undefined) t = x[t.j] <= t.t ? t.l : t.r; return t.v; };
const raw = (model, x, n = model.trees.length) => { let s = 0; for (let k = 0; k < n; k++) s += evalTree(model.trees[k], x); return s; };
// Symmetric logit for orientation x (A minus B differences) with base logit z.
const logitOf = (model, x, z, n) => z + (raw(model, x, n) - raw(model, x.map(v => -v), n)) / 2;

// X: rows of A-minus-B inputs; y: 0/1; z: base logits. val: optional { X, y, z } scored after every tree.
function fit(X, y, z, { trees = 300, depth = 2, lr = 0.03, lambda = 5, minLeaf = 30, minGain = 0, subsample = 0.7, colsample = 1, seed = 1 } = {}, val = null) {
  const opts = { lr, lambda, minLeaf, minGain };
  const D = [...X, ...X.map(x => x.map(v => -v))], Y = [...y, ...y.map(v => 1 - v)], Z = [...z, ...z.map(v => -v)];
  const F = Float64Array.from(Z), r = NN.rng(seed), nf = X[0] ? X[0].length : 0;
  const model = { trees: [] }, valLoss = [];
  const loss = (V, n) => V.X.reduce((s, x, i) => { const p = NN.sigmoid(logitOf(model, x, V.z[i], n)); return s - (V.y[i] ? Math.log(p) : Math.log(1 - p)); }, 0) / V.X.length;
  if (val) valLoss.push(loss(val, 0));
  for (let k = 0; k < trees && nf; k++) {
    const g = new Float64Array(D.length), h = new Float64Array(D.length);
    for (let i = 0; i < D.length; i++) { const p = NN.sigmoid(F[i]); g[i] = p - Y[i]; h[i] = Math.max(p * (1 - p), 1e-6); }
    const idx = []; for (let i = 0; i < D.length; i++) if (r() < subsample) idx.push(i);
    const cols = []; for (let j = 0; j < nf; j++) if (r() < colsample) cols.push(j);
    const tree = buildTree(D, g, h, idx, cols.length ? cols : [0], depth, opts, r);
    model.trees.push(tree);
    for (let i = 0; i < D.length; i++) F[i] += evalTree(tree, D[i]);
    if (val) valLoss.push(loss(val, model.trees.length));
  }
  return { model, valLoss };
}

const predict = (model, x, z, n) => NN.sigmoid(logitOf(model, x, z, n == null ? model.trees.length : n));
module.exports = { fit, predict, logitOf };
