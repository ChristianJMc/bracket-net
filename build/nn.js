// A small antisymmetric neural network for "does team A beat team B?".
// Input x = (A - B) stat differences plus a venue term (+1 A home, -1 B home, 0 neutral), followed by
// context inputs c that describe the game rather than either team (how many games the ratings rest on,
// neutral site or not). The net computes
//   z = g(x, c) - g(-x, c),  P(A wins) = sigmoid(z)
// where g is a 2-hidden-layer tanh MLP, so P(A beats B) = 1 - P(B beats A) exactly.
// Shared by the Node training script and the browser page.
(function (root) {
  const FEATURES = [
    ['adjEM', 'Adjusted efficiency margin'], ['adjO', 'Adjusted offense'], ['adjD', 'Adjusted defense'],
    ['adjT', 'Adjusted tempo'], ['efgO', 'Effective FG%'], ['efgD', 'Opponent effective FG%'],
    ['toO', 'Turnover rate'], ['toD', 'Forced turnover rate'], ['orbO', 'Offensive rebound rate'],
    ['orbD', 'Opponent off. rebound rate'], ['ftrO', 'Free throw rate'], ['ftrD', 'Opponent free throw rate'],
    ['tprO', '3-point attempt rate'], ['tpO', '3-point %'], ['tpD', 'Opponent 3-point %'],
    ['twoO', '2-point %'], ['twoD', 'Opponent 2-point %'], ['ftp', 'Free throw %'],
    ['astR', 'Assist rate'], ['blkR', 'Block rate'], ['stlR', 'Steal rate'],
    ['winPct', 'Win %'], ['sos', 'Strength of schedule'], ['luck', 'Luck (win % vs. expected)'],
    ['form', 'Last-10-game form'], ['consistency', 'Game-to-game volatility'],
  ];
  const ANTI = FEATURES.length + 1; // stat differences + venue: these flip sign when A and B swap
  const CONTEXT = [['games', 'Games behind the ratings'], ['neutral', 'Neutral site']];
  const INPUTS = ANTI + CONTEXT.length;

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function diff(a, b, loc) {
    const x = new Float64Array(INPUTS);
    for (let j = 0; j < FEATURES.length; j++) x[j] = a[FEATURES[j][0]] - b[FEATURES[j][0]];
    x[FEATURES.length] = loc || 0;
    x[ANTI] = (a.w + a.l + b.w + b.l) / 2;
    x[ANTI + 1] = loc ? 0 : 1;
    return x;
  }

  // Scale each input by its root-mean-square across training games (differences have mean zero by symmetry).
  function fitScale(xs) {
    const s = new Array(INPUTS).fill(0);
    for (const x of xs) for (let j = 0; j < INPUTS; j++) s[j] += x[j] * x[j];
    return s.map(v => Math.sqrt(v / xs.length) || 1);
  }

  // Parameters live in one flat array: W1 (h1 x n), b1, W2 (h2 x h1), b2, W3 (h2). The output
  // bias of g cancels in g(x) - g(-x), so it is omitted.
  function layout(n, h1, h2) {
    const o = { n, h1, h2 };
    o.W1 = 0; o.b1 = h1 * n; o.W2 = o.b1 + h1; o.b2 = o.W2 + h2 * h1; o.W3 = o.b2 + h2; o.size = o.W3 + h2;
    return o;
  }

  // na = how many leading inputs flip sign when A and B swap (the rest are shared context).
  function initNet(n, h1, h2, seed, na = ANTI) {
    const L = layout(n, h1, h2), r = rng(seed), w = new Float64Array(L.size);
    for (let i = 0; i < h1 * n; i++) w[L.W1 + i] = (r() * 2 - 1) * Math.sqrt(3 / n);
    for (let i = 0; i < h2 * h1; i++) w[L.W2 + i] = (r() * 2 - 1) * Math.sqrt(3 / h1);
    for (let i = 0; i < h2; i++) w[L.W3 + i] = (r() * 2 - 1) * Math.sqrt(3 / h2);
    return { n, h1, h2, na, w };
  }

  function makeScratch(net) {
    return { a1: new Float64Array(net.h1), a2: new Float64Array(net.h2), b1: new Float64Array(net.h1),
      b2: new Float64Array(net.h2), d1: new Float64Array(net.h1), d2: new Float64Array(net.h2) };
  }

  // g(sign * x, c); writes hidden activations into a1/a2.
  function g(net, L, x, sign, a1, a2) {
    const w = net.w, n = net.n, h1 = net.h1, h2 = net.h2, na = net.na == null ? ANTI : net.na;
    for (let i = 0; i < h1; i++) {
      let sa = 0, sc = 0;
      const base = L.W1 + i * n;
      for (let k = 0; k < na; k++) sa += w[base + k] * x[k];
      for (let k = na; k < n; k++) sc += w[base + k] * x[k];
      a1[i] = Math.tanh(w[L.b1 + i] + sign * sa + sc);
    }
    let out = 0;
    for (let i = 0; i < h2; i++) {
      let s = w[L.b2 + i];
      const base = L.W2 + i * h1;
      for (let j = 0; j < h1; j++) s += w[base + j] * a1[j];
      a2[i] = Math.tanh(s);
      out += w[L.W3 + i] * a2[i];
    }
    return out;
  }

  const layouts = new Map();
  function layoutOf(net) {
    const k = net.n + ',' + net.h1 + ',' + net.h2;
    if (!layouts.has(k)) layouts.set(k, layout(net.n, net.h1, net.h2));
    return layouts.get(k);
  }

  // offset: index of an input added straight to the logit (a base model's logit), so the net learns only a
  // correction to it and regularization pulls it back toward the base model rather than toward 50/50.
  const offsetOf = (net, x) => (net.offset != null && net.offset >= 0 ? x[net.offset] : 0);

  function logit(net, x, sc) {
    const L = layoutOf(net);
    sc = sc || makeScratch(net);
    return g(net, L, x, 1, sc.a1, sc.a2) - g(net, L, x, -1, sc.b1, sc.b2) + offsetOf(net, x);
  }

  function backward(net, L, G, x, sign, a1, a2, scale, d1, d2) {
    const w = net.w, n = net.n, h1 = net.h1, h2 = net.h2, na = net.na == null ? ANTI : net.na;
    d1.fill(0);
    for (let i = 0; i < h2; i++) {
      G[L.W3 + i] += scale * a2[i];
      const di = scale * w[L.W3 + i] * (1 - a2[i] * a2[i]);
      G[L.b2 + i] += di;
      const base = L.W2 + i * h1;
      for (let j = 0; j < h1; j++) { G[base + j] += di * a1[j]; d1[j] += di * w[base + j]; }
    }
    for (let j = 0; j < h1; j++) {
      const dj = d1[j] * (1 - a1[j] * a1[j]);
      G[L.b1 + j] += dj;
      const base = L.W1 + j * n, sdj = sign * dj;
      for (let k = 0; k < na; k++) G[base + k] += sdj * x[k];
      for (let k = na; k < n; k++) G[base + k] += dj * x[k];
    }
  }

  const sigmoid = (z) => 1 / (1 + Math.exp(-z));

  // Trains one net with Adam + L2, yielding after every epoch.
  // xs: array of Float64Array inputs (already scaled), ys: 0/1 labels.
  function* trainSteps(xs, ys, opts) {
    // l2Input: optional per-input multiplier on L2 for first-layer weights, so some inputs (opinions)
    // need more evidence than others before the net leans on them.
    const { h1 = 24, h2 = 12, epochs = 20, lr = 0.002, l2 = 1e-4, batch = 128, seed = 1, na = ANTI, weights = null, l2Input = null, offset = null } = opts;
    const net = initNet(xs[0].length, h1, h2, seed, na), L = layoutOf(net), sc = makeScratch(net);
    if (offset != null) net.offset = offset;
    const G = new Float64Array(L.size), M = new Float64Array(L.size), V = new Float64Array(L.size);
    const l2w = new Float64Array(L.size);
    for (let i = 0; i < L.size; i++) l2w[i] = i < L.b1 ? (l2Input ? l2Input[i % net.n] : 1) : (i >= L.W2 && i < L.b2) || i >= L.W3 ? 1 : 0;
    const r = rng(seed * 7919 + 13);
    const idx = Array.from(xs, (_, i) => i);
    let t = 0;
    for (let ep = 0; ep < epochs; ep++) {
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp; }
      const rate = lr * 0.5 * (1 + Math.cos(Math.PI * ep / epochs)); // cosine decay
      let loss = 0;
      for (let s = 0; s < idx.length; s += batch) {
        const end = Math.min(s + batch, idx.length), bn = end - s;
        for (let q = s; q < end; q++) {
          const x = xs[idx[q]], y = ys[idx[q]];
          const z = g(net, L, x, 1, sc.a1, sc.a2) - g(net, L, x, -1, sc.b1, sc.b2) + offsetOf(net, x);
          const p = sigmoid(z);
          loss -= y ? Math.log(p + 1e-12) : Math.log(1 - p + 1e-12);
          const dz = (p - y) * (weights ? weights[idx[q]] : 1) / bn;
          backward(net, L, G, x, 1, sc.a1, sc.a2, dz, sc.d1, sc.d2);
          backward(net, L, G, x, -1, sc.b1, sc.b2, -dz, sc.d1, sc.d2);
        }
        t++;
        const c1 = 1 / (1 - Math.pow(0.9, t)), c2 = 1 / (1 - Math.pow(0.999, t));
        const w = net.w;
        for (let i = 0; i < L.size; i++) {
          const gg = G[i] + l2 * l2w[i] * w[i];
          M[i] = 0.9 * M[i] + 0.1 * gg;
          V[i] = 0.999 * V[i] + 0.001 * gg * gg;
          w[i] -= rate * (M[i] * c1) / (Math.sqrt(V[i] * c2) + 1e-8);
          G[i] = 0;
        }
      }
      yield { epoch: ep + 1, loss: loss / idx.length, net };
    }
  }

  function train(xs, ys, opts) {
    let last;
    for (const s of trainSteps(xs, ys, opts)) last = s;
    return last.net;
  }

  // Ensemble probability that team A beats team B (neutral court unless loc is given).
  function predict(model, a, b, loc) {
    const x = diff(a, b, loc);
    for (let j = 0; j < x.length; j++) x[j] /= model.scale[j];
    let z = 0;
    for (const n of model.nets) z += logit(n, x);
    return sigmoid(z / model.nets.length);
  }

  // Plain-array form for JSON, and back.
  const toJSON = (net, digits = 5) => ({ n: net.n, h1: net.h1, h2: net.h2, na: net.na, offset: net.offset, w: Array.from(net.w, v => +v.toPrecision(digits)) });
  const fromJSON = (o) => ({ n: o.n, h1: o.h1, h2: o.h2, na: o.na, offset: o.offset, w: Float64Array.from(o.w) });

  root.NN = { FEATURES, CONTEXT, ANTI, INPUTS, rng, diff, fitScale, initNet, logit, trainSteps, train, predict, sigmoid, toJSON, fromJSON };
})(typeof module !== 'undefined' ? module.exports : window);
