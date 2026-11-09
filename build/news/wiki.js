// Pulls the narrative paragraphs from each year's Wikipedia tournament page (already in raw/wiki/)
// that mention both teams of a game. These are written after the fact: postgame analysis only.
// Usage: node build/news/wiki.js [years...]
const fs = require('fs');
const path = require('path');
const { ROOT, gameKey, load, save, addItem } = require('./store');
const { norm } = require('../lib/names');

const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dataset.json'), 'utf8'));

function paragraphs(wikitext) {
  return wikitext.split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 200 && !/^[{|!=*#]/.test(p) && !/^\{\{/.test(p))
    .map(p => p.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\{\{[^}]*\}\}/g, '').replace(/'''?/g, '')
      .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

// A team counts as mentioned when its normalized name (or a common short form) appears in the paragraph.
function mentions(text, team) {
  const t = norm(text);
  const forms = [norm(team), norm(team.replace(/ St\.$/, ' State')), team === 'Connecticut' ? 'uconn' : null, team === 'N.C. State' ? 'nc state' : null].filter(Boolean);
  return forms.some(f => new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t));
}

function collectYear(year) {
  const file = path.join(ROOT, 'raw', 'wiki', `${year}.txt`);
  if (!fs.existsSync(file)) return;
  const paras = paragraphs(fs.readFileSync(file, 'utf8'));
  const store = load(year);
  let n = 0;
  for (const g of dataset.games.filter(x => x.year === year)) {
    const hits = paras.filter(p => mentions(p, g.a) && mentions(p, g.b));
    if (!hits.length) continue;
    const key = gameKey(g);
    const entry = store.games[key] = store.games[key] || { year, round: g.round, a: g.a, b: g.b };
    for (const [i, text] of hits.entries()) if (addItem(entry, { source: 'wikipedia', title: `${year} tournament page, paragraph ${i + 1}`, published: null, text, timing: 'postgame' })) n++;
  }
  save(store);
  console.log(`${year}: ${n} Wikipedia paragraphs attached`);
}

if (require.main === module) {
  const years = process.argv.slice(2).map(Number).filter(Boolean);
  for (const y of years.length ? years : dataset.years) collectYear(y);
}

module.exports = { paragraphs, mentions, collectYear };
