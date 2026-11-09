const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { read, needs, ROOT } = require('./helpers');
const { parseCSV } = require('../build/lib/csv');
const { FILES } = require('../build/ingest/kaggle-files');

test('CSV parser handles quotes, commas, newlines and percents', () => {
  const rows = parseCSV('﻿A,B,C\r\n"x, y","say ""hi""",12%\n"multi\nline",,-3.5\n');
  assert.deepStrictEqual(rows[0], { A: 'x, y', B: 'say "hi"', C: 12 });
  assert.deepStrictEqual(rows[1], { A: 'multi\nline', B: null, C: -3.5 });
});

test('every registry source documents access and timing', () => {
  const { sources } = read('sources/registry.json');
  for (const s of sources) for (const k of ['id', 'name', 'url', 'access', 'how', 'timing']) assert.ok(s[k], `${s.id} missing ${k}`);
  assert.strictEqual(new Set(sources.map(s => s.id)).size, sources.length);
});

test('every Kaggle file is configured, and every configured file exists', (t) => {
  const dir = path.join(ROOT, 'raw', 'kaggle', 'csv');
  if (!fs.existsSync(dir)) return t.skip('Kaggle CSVs not downloaded');
  const onDisk = fs.readdirSync(dir).filter(f => f.endsWith('.csv')).sort();
  assert.deepStrictEqual(FILES.map(f => f.file).sort(), onDisk);
  assert.strictEqual(new Set(FILES.map(f => f.prefix)).size, FILES.length, 'prefixes must be unique');
});

test('Kaggle team names all resolve to one team each', needs('data/features-kaggle.json'), () => {
  const k = read('data/features-kaggle.json');
  assert.deepStrictEqual(k.unmatched, []);
  for (const c of k.coverage.filter(c => c.role === 'team_season')) assert.ok(c.matched / c.rows > 0.99, `${c.file} ${c.matched}/${c.rows}`);
});
