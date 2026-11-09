const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const has = (f) => fs.existsSync(path.join(ROOT, f));
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
// Tests that need built data skip (rather than fail) when it hasn't been built yet.
const needs = (...files) => (files.every(has) ? {} : { skip: `missing ${files.filter(f => !has(f)).join(', ')}` });

module.exports = { ROOT, has, read, needs };
