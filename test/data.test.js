const test = require('node:test');
const assert = require('node:assert');
const { read, needs } = require('./helpers');

// Champions from the public record; the pipeline must reproduce them from the raw brackets.
const CHAMPIONS = { 2008: 'Kansas', 2009: 'North Carolina', 2010: 'Duke', 2011: 'Connecticut', 2012: 'Kentucky', 2013: 'Louisville',
  2014: 'Connecticut', 2015: 'Duke', 2016: 'Villanova', 2017: 'North Carolina', 2018: 'Villanova', 2019: 'Virginia',
  2021: 'Baylor', 2022: 'Kansas', 2023: 'Connecticut', 2024: 'Connecticut', 2025: 'Florida', 2026: 'Michigan' };

test('every season has a complete, consistent tournament', needs('data/dataset.json'), () => {
  const d = read('data/dataset.json');
  for (const y of d.years) {
    const games = d.games.filter(g => g.year === y);
    const expected = y <= 2010 ? 64 : y === 2021 ? 66 : 67; // 2021: VCU-Oregon was a no-contest
    assert.strictEqual(games.length, expected, `${y} game count`);
    for (const g of games) {
      assert.ok(d.teams[y][g.a] && d.teams[y][g.b], `${y} ${g.a} vs ${g.b} missing team stats`);
      assert.ok(/^\d{4}-0[34]-\d\d$/.test(g.date), `${y} ${g.a} vs ${g.b} date ${g.date}`);
      assert.notStrictEqual(g.sa, g.sb);
    }
    const final = games.find(g => g.round === 6);
    assert.strictEqual(final.sa > final.sb ? final.a : final.b, CHAMPIONS[y], `${y} champion`);
    const seeds = Object.values(d.teams[y]).map(t => t.seed);
    assert.ok(seeds.every(s => s >= 1 && s <= 16));
  }
});

test('team stats are finite and plausible', needs('data/dataset.json'), () => {
  const d = read('data/dataset.json');
  for (const [y, T] of Object.entries(d.teams)) for (const [n, t] of Object.entries(T)) {
    for (const [k, v] of Object.entries(t)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${y} ${n} ${k}`);
    assert.ok(t.adjO > 80 && t.adjO < 140 && t.adjD > 70 && t.adjD < 130, `${y} ${n} efficiency out of range`);
    assert.ok(t.w + t.l >= (+y === 2021 ? 12 : 20), `${y} ${n} only ${t.w + t.l} games`); // 2021 COVID schedules were short
  }
});
