// Bracket math shared by the generator and the tests.
//
// A bracket is a binary tree over `leaves` (64 slots, each a list of 1 team or 2 play-in teams).
// P(a, b, round) is the probability a beats b in that round (most models ignore the round). A full bracket's probability is the product of its game
// probabilities, and different brackets are mutually exclusive, so
//   P(at least one of N brackets is perfect) = sum of their probabilities.
// The best N brackets are therefore exactly the N most probable ones, which kBest finds by dynamic
// programming: for every subtree and every possible winner, keep that subtree's K most probable outcomes.

const POS_SEEDS = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

function leavesOf(teams, finalFour) {
  return finalFour.flatMap(region => POS_SEEDS.map(seed =>
    Object.keys(teams).filter(n => teams[n].region === region && teams[n].seed === seed)));
}

// Merge two descending lists of candidates, keeping the top k.
function topK(cands, k) {
  cands.sort((a, b) => b.p - a.p);
  return cands.length > k ? cands.slice(0, k) : cands;
}

// Returns the K most probable complete brackets, each { p, picks } where picks maps
// "round:lo" -> winner (round 0 = play-in, 1..6 = round of 64 .. championship).
function kBest(leaves, P, K = 10) {
  function solve(lo, hi) {
    if (hi - lo === 1) {
      const s = leaves[lo];
      if (s.length === 1) return new Map([[s[0], [{ p: 1, node: null }]]]);
      return new Map([
        [s[0], [{ p: P(s[0], s[1], 0), node: { key: `0:${lo}`, w: s[0] } }]],
        [s[1], [{ p: P(s[1], s[0], 0), node: { key: `0:${lo}`, w: s[1] } }]],
      ]);
    }
    const mid = (lo + hi) / 2, L = solve(lo, mid), R = solve(mid, hi);
    const round = Math.log2(hi - lo), key = `${round}:${lo}`;
    const out = new Map();
    const side = (A, B) => {
      for (const [w, listA] of A) {
        const cands = [];
        for (const [u, listB] of B) {
          const pw = P(w, u, round);
          for (const a of listA) for (const b of listB) cands.push({ p: a.p * b.p * pw, node: { key, w, left: a, right: b } });
        }
        out.set(w, topK(cands, K));
      }
    };
    side(L, R); side(R, L);
    return out;
  }
  const root = solve(0, leaves.length);
  const all = topK([...root.values()].flat(), K);
  const picksOf = (entry) => {
    const picks = {};
    const walk = (e) => { if (!e || !e.node) return; picks[e.node.key] = e.node.w; walk(e.node.left); walk(e.node.right); };
    walk(entry);
    return picks;
  };
  return all.map(e => ({ p: e.p, picks: picksOf(e) }));
}

// Games of one bracket (from its picks), with each game's participants and win probability.
function gamesOf(leaves, picks, P) {
  const games = [];
  function go(lo, hi) {
    if (hi - lo === 1) {
      const s = leaves[lo];
      if (s.length === 1) return s[0];
      const w = picks[`0:${lo}`], l = s[0] === w ? s[1] : s[0];
      games.push({ key: `0:${lo}`, round: 0, w, l, p: P(w, l, 0) });
      return w;
    }
    const mid = (lo + hi) / 2, a = go(lo, mid), b = go(mid, hi), round = Math.log2(hi - lo), key = `${round}:${lo}`;
    const w = picks[key], l = w === a ? b : a;
    games.push({ key, round, w, l, p: P(w, l, round) });
    return w;
  }
  go(0, leaves.length);
  return games;
}

// Exhaustive enumeration for small brackets (tests only).
function bruteForce(leaves, P) {
  const results = [];
  function go(lo, hi) {
    if (hi - lo === 1) {
      const s = leaves[lo];
      if (s.length === 1) return [{ w: s[0], p: 1, picks: {} }];
      return s.map(t => ({ w: t, p: P(t, s.find(x => x !== t)), picks: { [`0:${lo}`]: t } }));
    }
    const mid = (lo + hi) / 2, A = go(lo, mid), B = go(mid, hi), key = `${Math.log2(hi - lo)}:${lo}`, out = [];
    for (const a of A) for (const b of B) {
      out.push({ w: a.w, p: a.p * b.p * P(a.w, b.w), picks: { ...a.picks, ...b.picks, [key]: a.w } });
      out.push({ w: b.w, p: a.p * b.p * P(b.w, a.w), picks: { ...a.picks, ...b.picks, [key]: b.w } });
    }
    return out;
  }
  for (const r of go(0, leaves.length)) results.push({ p: r.p, picks: r.picks });
  return results.sort((a, b) => b.p - a.p);
}

const ESPN_POINTS = [0, 10, 20, 40, 80, 160, 320];

module.exports = { POS_SEEDS, leavesOf, kBest, gamesOf, bruteForce, ESPN_POINTS };
