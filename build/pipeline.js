// One command from raw files to a trained, checked model, the same way every time.
//
//   node build/pipeline.js              verify inputs, rebuild what changed, validate, train, walk-forward, checks
//   node build/pipeline.js --full       also the shuffled-label control and the leave-one-kind-out ablations
//   node build/pipeline.js --tune       also re-tune game-importance weights (build/tune-importance.js)
//   node build/pipeline.js --pin        first run only: record hashes of the raw files already on disk
//   node build/pipeline.js --force      rerun every stage even if nothing changed
//   node build/pipeline.js --until validate     stop after a stage
//
// Repeatable: every raw input is hash-pinned in sources/lock.json and checked before anything builds; every random
// choice uses a fixed seed; each run writes runs/<time>.json with the code, input and config hashes, tool versions,
// stage timings and the results, so any result can be traced to exactly what produced it.
// Scalable: each stage runs in its own process and is skipped when its inputs and code are unchanged (hashes in
// data/pipeline-state.json). A new source is a new ingest stage writing data/features-<name>.json.
// Secure: downloads go through build/lib/safe-fetch.js (host allowlist, size caps, hashes); data is validated before
// training (build/lib/validate.js); news text is screened for prompt injection before any model sees it
// (build/news/sanitize.js); nothing here executes downloaded content.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { verifyLock, pin, LOCK } = require('./lib/safe-fetch');

const ROOT = path.join(__dirname, '..');
const STATE = path.join(ROOT, 'data', 'pipeline-state.json');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const untilI = args.indexOf('--until'), until = untilI >= 0 ? args[untilI + 1] : null;

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
function listFiles(spec) {
  // spec: a file, a directory (all files inside), or "dir/*.ext"
  const abs = path.join(ROOT, spec);
  const m = spec.match(/^(.*)\/\*(\.[a-z0-9]+)$/i);
  if (m) { const d = path.join(ROOT, m[1]); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(m[2])).map(f => path.join(d, f)) : []; }
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isDirectory()) return fs.readdirSync(abs, { recursive: true }).map(f => path.join(abs, f)).filter(f => fs.statSync(f).isFile());
  return [abs];
}
function hashOf(specs) {
  const h = crypto.createHash('sha256');
  for (const f of specs.flatMap(listFiles).sort()) { h.update(rel(f)); h.update(fs.readFileSync(f)); }
  return h.digest('hex');
}

const node = (script, ...a) => ({ cmd: process.execPath, args: ['--max-old-space-size=4096', path.join(ROOT, script), ...a] });
// Outputs of later stages, which must not count as inputs of the stages that read data/*.json.
const DERIVED = /validation\.json|walkforward|model|pipeline-state|brackets|misses|signatures|upset|importance-settings/;
// inputs: data and code this stage depends on (its hash decides whether to rerun); outputs: what it must produce.
const STAGES = [
  { name: 'campus', run: node('build/ingest/campus.js'), inputs: ['raw/kaggle/csv/Tournament Locations.csv', 'build/ingest/campus.js'], outputs: ['sources/campus-elevation.json'] },
  { name: 'dataset', run: node('build/build-data.js'), inputs: ['raw/*.json', 'raw/wiki', 'build/build-data.js', 'build/lib/sked.js', 'build/lib/names.js', 'sources/campus-elevation.json'], outputs: ['data/dataset.json', 'data/training.json'] },
  { name: 'kaggle', run: node('build/ingest/kaggle.js'), inputs: ['raw/kaggle/csv', 'build/ingest', 'build/lib/csv.js', 'build/lib/names.js', 'data/dataset.json'], outputs: ['data/features-kaggle.json'] },
  { name: 'players', run: node('build/ingest/players.mjs'), inputs: ['raw/players/*.parquet', 'build/ingest/players.mjs', 'build/lib/names.js', 'data/dataset.json'], outputs: ['data/features-players.json'] },
  { name: 'elo', run: node('build/ingest/elo.js'), inputs: ['raw/*.json', 'build/ingest/elo.js', 'build/lib/sked.js', 'data/dataset.json'], outputs: ['data/features-elo.json'] },
  { name: 'schedule', run: node('build/ingest/schedule.js'), inputs: ['raw/*.json', 'build/ingest/schedule.js', 'data/dataset.json'], outputs: ['data/features-schedule.json'] },
  { name: 'gamectx', run: node('build/ingest/gamesite.js'), inputs: ['raw/espn/scoreboard', 'raw/openmeteo', 'raw/kaggle/csv/Tournament Locations.csv', 'build/ingest/gamesite.js', 'data/dataset.json'], outputs: ['data/features-gamectx.json'] },
  // Kaggle competition files (Massey ordinals): only once you've downloaded them into raw/mmlm/ (see build/ingest/mmlm.js).
  { name: 'massey', run: node('build/ingest/mmlm.js'), when: () => fs.existsSync(path.join(ROOT, 'raw', 'mmlm', 'MMasseyOrdinals.csv')),
    inputs: ['raw/mmlm', 'build/ingest/mmlm.js', 'data/dataset.json'], outputs: ['data/features-massey.json'] },
  { name: 'derived', run: node('build/ingest/derived.js'), inputs: ['data/features-kaggle.json', 'data/features-gamectx.json', 'build/ingest/derived.js'], outputs: ['data/features-derived.json'] },
  { name: 'tune-importance', run: node('build/tune-importance.js'), when: () => flag('--tune') || !fs.existsSync(path.join(ROOT, 'data', 'importance-settings.json')),
    inputs: ['data/dataset.json', 'data/training.json', 'build/tune-importance.js', 'build/lib/importance.js', 'build/nn.js'], outputs: ['data/importance-settings.json'] },
  { name: 'train-base', run: node('build/train.js'), inputs: ['data/dataset.json', 'data/training.json', 'data/importance-settings.json', 'build/train.js', 'build/nn.js', 'build/lib/importance.js'], outputs: ['data/model.json'] },
  // Coach tournament residuals use the base model's pregame chances, so this runs after it.
  { name: 'coaches', run: node('build/ingest/coaches.js'), inputs: ['raw/coaches', 'build/ingest/coaches.js', 'data/dataset.json', 'data/model.json'], outputs: ['data/features-coach.json'] },
  // Validation runs after every feature file exists and before anything reads them for the tournament models.
  { name: 'validate', fn: validateStage, inputs: ['data/*.json', 'build/lib/validate.js', 'build/lib/features.js'], outputs: ['data/validation.json'], exclude: DERIVED },
  { name: 'walkforward', run: node('build/walkforward.js', '--run'),
    inputs: ['data/*.json', 'data/model.json', 'data/importance-settings.json', 'data/validation.json', 'build/walkforward.js', 'build/nn.js', 'build/lib'],
    exclude: /walkforward|model-stageB|pipeline-state|brackets|misses|signatures|upset/, outputs: ['data/walkforward-report.json', 'data/model-stageB.json'] },
  { name: 'control', run: node('build/walkforward.js', '--run', '--cached-a', '--control', 'shuffled'), when: () => flag('--full'), inputs: ['data/walkforward-report.json'], outputs: ['data/walkforward-report-shuffled.json'] },
  ...['opinion', 'hybrid', 'projection'].map(k => ({ name: `ablate-${k}`, run: node('build/walkforward.js', '--run', '--cached-a', '--exclude-kind', k), when: () => flag('--full'),
    inputs: ['data/walkforward-report.json'], outputs: [`data/walkforward-report-no-${k}.json`] })),
  { name: 'explain', run: node('build/explain.js'), inputs: ['data/walkforward-preds.json', 'build/explain.js'], outputs: ['docs/upset-anatomy.md'] },
  { name: 'overlap', run: node('build/overlap.js'), inputs: ['data/walkforward-preds.json', 'build/overlap.js'], outputs: ['docs/overlap.md'] },
  { name: 'inventory', run: node('build/inventory.js'), inputs: ['data/walkforward-preds.json', 'data/walkforward-report.json', 'build/inventory.js'], outputs: ['docs/data-inventory.md'] },
  { name: 'checks', run: node('build/checks.js'), always: true, inputs: [], outputs: [], allowFail: true },
];

function validateStage() {
  const { validate } = require('./lib/validate');
  const { loadFeatures } = require('./lib/features');
  const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dataset.json'), 'utf8'));
  const r = validate(dataset, loadFeatures({ raw: true }));
  fs.writeFileSync(path.join(ROOT, 'data', 'validation.json'), JSON.stringify(r, null, 1));
  const md = ['# Data validation', '', `Run by build/pipeline.js before training. ${r.problems.length} problems, ${r.quarantine.length} quarantined season-columns, ${r.warnings.length} warnings.`, '',
    '## Problems (stop the pipeline)', '', ...(r.problems.length ? r.problems.map(p => `- ${p}`) : ['None.']), '',
    '## Quarantined (treated as missing)', '', ...(r.quarantine.length ? r.quarantine.map(q => `- ${q.column} ${q.year}: ${q.reason}`) : ['None.']), '',
    '## Warnings', '', ...(r.warnings.length ? r.warnings.map(w => `- ${w}`) : ['None.']), ''];
  fs.writeFileSync(path.join(ROOT, 'docs', 'data-validation.md'), md.join('\n'));
  console.log(`validation: ${r.problems.length} problems, ${r.quarantine.length} quarantined, ${r.warnings.length} warnings (docs/data-validation.md)`);
  if (r.problems.length) { console.log(r.problems.slice(0, 20).join('\n')); return 1; }
  return 0;
}

function main() {
  const t0 = Date.now(), runLog = { started: new Date().toISOString(), node: process.version, args, stages: [] };
  const deps = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies;
  runLog.dependencies = deps;

  // 1. Inputs are what they were when pinned.
  if (flag('--pin')) {
    for (const f of ['raw/*.json', 'raw/wiki/*.txt', 'raw/kaggle/mm.zip', 'raw/kaggle/csv/*.csv', 'raw/players/*.parquet', 'raw/mmlm/*.csv'].flatMap(listFiles)) pin(f, 'local (pinned by pipeline --pin)');
    console.log('pinned raw inputs in sources/lock.json');
  }
  const bad = verifyLock();
  if (bad.length) { console.error('Input check failed:\n' + bad.join('\n') + '\nIf an upstream change is expected, re-download and re-pin.'); process.exit(1); }
  const pinned = fs.existsSync(LOCK) ? Object.keys(JSON.parse(fs.readFileSync(LOCK, 'utf8')).files).length : 0;
  console.log(`inputs verified against sources/lock.json (${pinned} files)`);
  if (!pinned) console.log('  nothing pinned yet: run once with --pin to record the raw files on disk');

  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
  for (const st of STAGES) {
    if (st.when && !st.when()) { runLog.stages.push({ name: st.name, status: 'not requested' }); continue; }
    const specs = st.exclude ? st.inputs.flatMap(s => listFiles(s)).filter(f => !st.exclude.test(f)).map(rel) : st.inputs;
    const h = hashOf(specs);
    const have = st.outputs.every(o => fs.existsSync(path.join(ROOT, o)));
    if (!st.always && !flag('--force') && have && state[st.name] === h) { runLog.stages.push({ name: st.name, status: 'unchanged' }); console.log(`· ${st.name}: unchanged`); }
    else {
      console.log(`▶ ${st.name}`);
      const s0 = Date.now();
      const code = st.fn ? st.fn() : spawnSync(st.run.cmd, st.run.args, { cwd: ROOT, stdio: 'inherit' }).status;
      runLog.stages.push({ name: st.name, status: code === 0 ? 'ok' : 'failed', seconds: Math.round((Date.now() - s0) / 1000) });
      if (code !== 0 && !st.allowFail) { saveRun(runLog, t0); console.error(`${st.name} failed (exit ${code})`); process.exit(1); }
      if (code === 0 && !st.always) { state[st.name] = hashOf(specs); fs.writeFileSync(STATE, JSON.stringify(state, null, 1)); }
    }
    if (until === st.name) break;
  }
  saveRun(runLog, t0);
}

function saveRun(runLog, t0) {
  const R = (f) => (fs.existsSync(path.join(ROOT, f)) ? JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')) : null);
  const wf = R('data/walkforward-report.json');
  runLog.seconds = Math.round((Date.now() - t0) / 1000);
  runLog.hashes = { code: hashOf(['build', 'package-lock.json']), inputs: hashOf(['sources/lock.json']), config: wf ? crypto.createHash('sha256').update(JSON.stringify(wf.config)).digest('hex') : null };
  runLog.results = wf ? { adopted: wf.adopted, logLoss: Object.fromEntries(Object.entries(wf.models || {}).map(([k, v]) => [k, +v.logLoss.toFixed(4)])) } : null;
  fs.mkdirSync(path.join(ROOT, 'runs'), { recursive: true });
  const f = path.join(ROOT, 'runs', runLog.started.replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(f, JSON.stringify(runLog, null, 1));
  console.log(`run record: ${rel(f)}`);
}

if (require.main === module) main();
module.exports = { STAGES };
