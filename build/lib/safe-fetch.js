// Downloads that are repeatable and can't be quietly swapped:
//   - only hosts on the allowlist, checked again on every redirect
//   - a size cap, so a bad or hostile response can't fill the disk
//   - written to a temp file and renamed only when complete
//   - every file's SHA-256 recorded in sources/lock.json; a later run with a different hash fails loudly
//     (pass { update: true } to accept a new upstream version on purpose)
// Downloaded files are data. Nothing in this project executes, imports or evals them.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const LOCK = path.join(ROOT, 'sources', 'lock.json');

const ALLOWED_HOSTS = [
  'barttorvik.com', 'en.wikipedia.org', 'site.api.espn.com', 'site.web.api.espn.com', 'api.gdeltproject.org',
  'www.kaggle.com', 'storage.googleapis.com',
  // elevation and historical weather (Open-Meteo), season coach pages (Sports-Reference, fetched slowly)
  'api.open-meteo.com', 'archive-api.open-meteo.com', 'www.sports-reference.com',
  // sportsdataverse releases on GitHub (release assets redirect to these)
  'github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com',
];
const hostAllowed = (u) => { const h = new URL(u).hostname; return ALLOWED_HOSTS.some(a => h === a || h.endsWith('.' + a)); };

const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

function readLock() { return fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, 'utf8')) : { files: {} }; }
function writeLock(lock) {
  const sorted = Object.fromEntries(Object.entries(lock.files).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(LOCK, JSON.stringify({ about: 'SHA-256 of every downloaded input. build/pipeline.js verifies these before building.', files: sorted }, null, 1));
}

// Record (or check) a file that arrived some other way, e.g. a Kaggle archive downloaded earlier.
function pin(file, url, { update = false } = {}) {
  const lock = readLock(), k = rel(file), h = sha256File(file);
  const prev = lock.files[k];
  if (prev && prev.sha256 !== h && !update) throw new Error(`${k} changed since it was pinned (lock ${prev.sha256.slice(0, 12)}…, now ${h.slice(0, 12)}…). Re-run with update to accept it.`);
  lock.files[k] = { url, sha256: h, bytes: fs.statSync(file).size, pinned: prev && prev.sha256 === h ? prev.pinned : new Date().toISOString().slice(0, 10) };
  writeLock(lock);
  return h;
}

// fetch() with a deadline covering the whole request, body included, so a host that stops responding fails the step
// with its name instead of hanging the pipeline. Every outbound request in the project goes through this.
const DEFAULT_TIMEOUT_MS = 60_000;
async function fetchWithTimeout(url, opts = {}, ms = DEFAULT_TIMEOUT_MS) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new Error(`${new URL(url).hostname} did not respond within ${Math.round(ms / 1000)} s (${url})`);
    throw e;
  }
}

async function download(url, dest, { maxBytes = 200e6, update = false, headers = {}, timeoutMs = 180_000 } = {}) {
  if (fs.existsSync(dest)) { pin(dest, url, { update }); return dest; }
  let u = url;
  for (let hop = 0; hop < 5; hop++) {
    if (new URL(u).protocol !== 'https:') throw new Error(`refusing non-HTTPS URL ${u}`);
    if (!hostAllowed(u)) throw new Error(`refusing host ${new URL(u).hostname} (not in ALLOWED_HOSTS in build/lib/safe-fetch.js)`);
    const res = await fetchWithTimeout(u, { redirect: 'manual', headers: { 'User-Agent': 'BracketNet/1.0 (personal research)', ...headers } }, timeoutMs);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { u = new URL(res.headers.get('location'), u).href; continue; }
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    const len = +res.headers.get('content-length');
    if (len && len > maxBytes) throw new Error(`${url} is ${len} bytes, over the ${maxBytes} cap`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.part';
    const out = fs.createWriteStream(tmp);
    let n = 0;
    try {
      for await (const chunk of res.body) {
        n += chunk.length;
        if (n > maxBytes) throw new Error(`${url} exceeded the ${maxBytes}-byte cap`);
        if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
      }
    } catch (e) { out.destroy(); fs.rmSync(tmp, { force: true }); throw e; }
    await new Promise((r, j) => out.end(e => (e ? j(e) : r())));
    fs.renameSync(tmp, dest);
    pin(dest, url, { update });
    return dest;
  }
  throw new Error(`too many redirects for ${url}`);
}

// Every pinned file still matches its hash. Returns the list of problems (empty = all good).
function verifyLock({ only } = {}) {
  const problems = [];
  for (const [k, v] of Object.entries(readLock().files)) {
    if (only && !only.test(k)) continue;
    const f = path.join(ROOT, k);
    if (!fs.existsSync(f)) { problems.push(`${k}: missing`); continue; }
    if (sha256File(f) !== v.sha256) problems.push(`${k}: hash differs from sources/lock.json`);
  }
  return problems;
}

module.exports = { download, fetchWithTimeout, pin, verifyLock, hostAllowed, sha256File, ALLOWED_HOSTS, LOCK };
