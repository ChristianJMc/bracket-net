// Campus elevation for every school that appears in the Kaggle locations file, keyed by normalized name, for the
// altitude-informed home-court edges in build/build-data.js. Writes sources/campus-elevation.json (a reference table:
// it changes only when new schools appear, so the ratings don't depend on a later pipeline stage).
//   node build/ingest/campus.js
const fs = require('fs');
const path = require('path');
const { parseCSV } = require('../lib/csv');
const { norm } = require('../lib/names');
const { cachedJSON } = require('../news/store');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'sources', 'campus-elevation.json');

async function build({ log = console.log } = {}) {
  const rows = parseCSV(fs.readFileSync(path.join(ROOT, 'raw', 'kaggle', 'csv', 'Tournament Locations.csv'), 'utf8'));
  const schools = {};
  for (const r of rows) {
    const lat = +r['COLLEGE LATITUDE'], lon = +r['COLLEGE LONGITUDE'];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    schools[norm(String(r.TEAM))] = { team: String(r.TEAM), lat: +lat.toFixed(4), lon: +lon.toFixed(4) };
  }
  const list = Object.entries(schools);
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${chunk.map(([, s]) => s.lat).join(',')}&longitude=${chunk.map(([, s]) => s.lon).join(',')}`;
    const j = await cachedJSON(url, path.join(ROOT, 'raw', 'openmeteo', `campus-${i}-${list.length}.json`), { delayMs: 500 });
    chunk.forEach(([, s], n) => { s.elev = j.elevation[n]; });
  }
  // Keep the hand-entered supplement (programs never in the tournament since 2008) across rebuilds.
  const supplement = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).supplement : undefined;
  fs.writeFileSync(OUT, JSON.stringify({ about: 'Campus elevation (m) by normalized school name; Kaggle coordinates, Open-Meteo elevation.', schools, supplement }, null, 1));
  log(`campus elevations for ${list.length} schools`);
}

if (require.main === module) build().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { build };
