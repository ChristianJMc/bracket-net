# Bracket Net

NCAA men's tournament forecasts from a neural network, plus the pipeline that learns from past tournaments and builds bracket sets.

- Site: `site/index.html` (published privately as an Artifact).
- What matters and why: [docs/RESEARCH.md](docs/RESEARCH.md).
- Misses and upset patterns: [docs/miss-review.md](docs/miss-review.md).

## Getting the data

The repository holds the code, tests, docs and the built site. Downloaded third-party files (`raw/`) and everything built from them (`data/`) are left out: they aren't ours to redistribute, and the pipeline rebuilds them. `sources/lock.json` records the SHA-256 each download must match, and `sources/registry.json` lists every source and how to get it. Two inputs are manual: the Kaggle "March Madness Data" CSVs (`raw/kaggle/csv/`) and, optionally, the Kaggle competition files (`raw/mmlm/`). Both need your own free Kaggle account.

```bash
npm ci
```

## One command

```bash
node build/pipeline.js --full
```

Verifies every raw input against its pinned hash, rebuilds only what changed, validates the data, trains, runs the walk-forward with every model side by side, runs the shuffled-label control and the leave-one-kind-out ablations, then the gates. Each run leaves a record in `runs/` (code, input and config hashes, versions, timings, results). The first time on a new machine, add `--pin` to record the raw files already on disk; add `--tune` to re-test the game-importance weights.

## Security

- **Dependencies:** three, pinned to exact versions in `package.json` with integrity hashes in `package-lock.json`. Each is at least a few weeks old, and `npm audit` is clean.
- **Downloads:** through `build/lib/safe-fetch.js`: HTTPS only, a host allowlist re-checked on every redirect, size caps, and a SHA-256 for every file in `sources/lock.json`. A file that changes upstream fails the next run instead of slipping in.
- **Poisoned data:** `build/lib/validate.js` runs before training. Non-numbers and unknown teams stop the pipeline. A season whose column suddenly disagrees with our own ratings (a bad join or a swapped file) is set aside. Outliers are listed in `docs/data-validation.md`.
- **Prompt injection:** news text is untrusted. `build/news/sanitize.js` strips markup and invisible characters, and flags text that addresses an AI or tries to give instructions; flagged items are never sent. `extract.mjs` wraps each item in a randomly named tag, gives the model no tools and a fixed schema with length caps, and keeps only claims whose evidence quote really appears in the source. Whatever survives is just one more input that has to earn its place out of sample.
- **Secrets:** the only one is the Anthropic API key for news extraction, read from the environment and never written to disk.

## Layout

| Path | What |
|---|---|
| `build/pipeline.js` | The whole build, staged and cached by hash |
| `build/ingest/players.mjs` | ESPN player box scores → roster features (`data/features-players.json`) |
| `build/ingest/elo.js` | Margin-of-victory Elo across seasons (`data/features-elo.json`) |
| `build/ingest/schedule.js` | Workload, rest and road share (`data/features-schedule.json`) |
| `build/lib/features.js` | Merges every `data/features-*.json`; a new source is a new file |
| `build/lib/validate.js` | Data checks before training |
| `build/lib/metrics.js` | Log loss, Brier, calibration, season bootstrap, one-SE rule, ridge logistic |
| `build/lib/importance.js`, `build/tune-importance.js` | Game-importance weights for the base network, chosen on tuning seasons |
| `build/lib/safe-fetch.js`, `sources/lock.json` | Allowlisted, hash-pinned downloads |
| `build/news/sanitize.js` | News cleaning, injection screening, evidence checks |
| `build/ingest/gamesite.js` | Venue, tip time, attendance, home designation, altitude, air pressure, body clock, head-to-head (`data/features-gamectx.json`) |
| `build/ingest/coaches.js` | Coach tenure and record before each season (`data/features-coach.json`) |
| `build/ingest/mmlm.js` | Kaggle competition files → Massey ordinals at Selection Sunday (`data/features-massey.json`); runs once you've downloaded them |
| `build/ingest/derived.js` | Engineered inputs: home-floor boost, neutral-court gap, campus elevation (`data/features-derived.json`) |
| `build/overlap.js` | Near-duplicate inputs and double counting → `docs/overlap.md` |
| `build/explain.js` | What decided each game, upset tiers, upset anatomy → `docs/upset-anatomy.md` |
| `build/capacity.js` | Network size and margin-vs-win/loss test on a time split |
| `build/build-data.js` | Box scores + brackets → `data/dataset.json` (pre-tournament team profiles, games) and `data/training.json` |
| `build/train.js` | Base network (stage A) → `data/model.json` |
| `build/ingest/` | Kaggle multi-source ingest → `data/features-kaggle.json`; per-file rules in `kaggle-files.js` |
| `build/news/` | `espn.js` recaps + box minutes, `wiki.js` write-ups, `gdelt.js` live pregame news, `extract.mjs` structured factors via Claude |
| `build/review.js` | Miss review: upset signatures pooled and per slice, with chance baselines |
| `build/lib/segments.js` | The slices (seed line, round, era, conference type, ...) |
| `build/upset-watch.js` | Historical lookalikes and firing signatures per game; `--backtest` scores it walk-forward |
| `build/walkforward.js` | Two-stage walk-forward training (dry run unless `--run`) |
| `build/checks.js` | Post-training gates |
| `build/predict.js` | One matchup with everything known before tip-off: chance, reasons, spark stats, tournament run, closest past games |
| `build/lib/tourney-history.js` | This tournament's run so far and the program's earlier tournaments |
| `build/brackets.js` | The N most probable brackets and their odds |
| `sources/registry.json` | Every source: access, timing, notes |
| `test/` | `npm test` |

## Checks to run any time

```bash
npm test
```

```bash
node build/walkforward.js
```

## March 2027 runbook

1. Selection Sunday: add 2027 to `YEARS` in `build/build-data.js`, download `raw/sked2027.json` and `raw/wiki/2027.txt`, then rebuild.
   ```bash
   node build/build-data.js
   ```
2. Refresh the Kaggle data when its author updates it, then ingest. For the competition data (Massey ordinals), sign in to Kaggle yourself, open the current March Machine Learning Mania competition → Data → accept the rules → Download All, and unzip the CSVs into `raw/mmlm/`; the pipeline picks them up and pins their hashes (`node build/pipeline.js --pin` once after adding them).
   ```bash
   npm run kaggle
   ```
3. Collect news for past tournaments and extract factors. Extraction calls the Claude API and costs money; try `--dry-run` and `--limit` first.
   ```bash
   node build/news/espn.js
   ```
   ```bash
   node build/news/extract.mjs --year 2024 --misses-only --controls 15 --dry-run
   ```
4. Train walk-forward, run the leakage control, then the gates. `node build/pipeline.js --full` does all of this step; the individual commands are below.
   ```bash
   node build/walkforward.js --run
   ```
   ```bash
   node build/walkforward.js --run --cached-a --control shuffled
   ```
   Check whether opinion, hybrid and projection inputs earn their place:
   ```bash
   node build/walkforward.js --run --cached-a --exclude-kind opinion
   ```
   ```bash
   node build/walkforward.js --run --cached-a --exclude-kind hybrid
   ```
   ```bash
   node build/walkforward.js --run --cached-a --exclude-kind projection
   ```
   ```bash
   node build/checks.js
   ```
5. Before tip-off, pull pregame injury news for the 2027 field. This needs tip-off times from `espn.js 2027`.
   ```bash
   node build/news/gdelt.js 2027
   ```
6. Refresh the miss review and upset watch with the new season's field (lookalikes come from earlier seasons only).
   ```bash
   node build/review.js
   ```
   ```bash
   node build/upset-watch.js --backtest
   ```
   ```bash
   node build/upset-watch.js --year 2027
   ```
7. During the tournament, predict each matchup as it comes up. Earlier rounds' results go into `data/dataset.json` first, so the run stats are current.
   ```bash
   node build/predict.js --year 2027 --a "Team A" --b "Team B" --round 2
   ```
8. After the First Four, generate the bracket set.
   ```bash
   node build/brackets.js --year 2027 --n 20 --after-first-four
   ```
