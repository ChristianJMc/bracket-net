# What matters for tournament prediction

Findings from setting up the multi-source pipeline (November 2026). Nothing here comes from training a new model. It comes from profiling the data, the miss review of the existing model, and the leak checks. See [miss-review.md](miss-review.md) and [kaggle-profile.md](kaggle-profile.md) for the full tables.

## The perfect-bracket math

A full bracket's chance is the product of its 63 game probabilities. Different brackets can't both be perfect, so:

> **P(at least one of N brackets is perfect) = the sum of those N brackets' probabilities.**

So the best set of N brackets is exactly the N most probable complete brackets. `build/brackets.js` finds them by dynamic programming, which handles the knock-on effects of each upset (flipping a Sweet 16 game changes every later matchup). Flipping coin-flip games one at a time can't account for that.

With the current base model on 2026, after the First Four:

| Set | Chance one is perfect |
|---|---|
| Most likely bracket | 1 in 765 million |
| Best 20 brackets | 1 in 42 million |
| What actually happened in 2026 | 1 in 2.5 trillion (10^12.4) under this model |

Better models raise these numbers, but no realistic model gets near even odds. About 30% of tournament games go against any sensible favorite, and that is the floor every source here runs into. The pipeline's job is to squeeze out the part that is predictable and be honest about the rest.

## Valuable

Ranked by the evidence so far.

1. **Team strength from several rating systems.** These are KenPom, Barttorvik, EvanMiya, 538, TeamRankings, RPPF and our own box-score ratings. They measure the same thing with different methods and time windows, and they disagree just enough that combining them helps. In the miss review, EvanMiya's relative rating, Z rating and Barttorvik's neutral-site margin all lean the same way after accounting for the base model. Every version is kept with its own prefix (`kb_kadj_em`, `kb_badj_em`, `em_relative_rating`, ...) so the tournament model can weigh them.
2. **Preseason expectations.** Preseason rank and votes in the AP poll are the only stats that **replicate** in the residual analysis. Underdogs that were highly rated in the preseason win more often than their March numbers say, in odd and even seasons alike. KenPom preseason ratings point the same way. Preseason polls encode roster talent and coaching that a few months of games don't fully reveal.
3. **Talent, experience, height** (Barttorvik `TALENT`, `EXP`, `AVG HGT`, `EFF HGT`). Talent leans consistently toward upsets the model misses but doesn't clear the bar alone.
4. **Neutral-site splits.** Tournament games are neutral. Barttorvik and TeamRankings neutral splits are closer to tournament conditions than full-season numbers.
5. **Three-point defense.** Underdogs that hold opponents to a low 3-point percentage win slightly more than expected.
6. **Availability (injuries, illness, suspensions).** This is the biggest gap in public data. Heat Check and EvanMiya injury ranks exist from 2013. The news pipeline adds per-game availability from text.
7. **Travel distance and time zones** (Kaggle Tournament Locations). This is a plausible small effect, now available per team per round.

Worth adding when possible:

- **Player-level minutes.** These are now collected from ESPN box scores. Comparing a team's tournament rotation with its season rotation measures who was missing objectively.

## Not valuable, or actively harmful

| Item | Why |
|---|---|
| `ROUND` and `CURRENT ROUND` in every Kaggle file | How far the team went: the answer. Stripped by the ingest. |
| AP poll's last week each season | Post-tournament poll (UConn shows 37–3 in 2024). The ingest keeps only weeks no later than Selection Sunday records. |
| Heat Check Tournament Index `WINS` | Correlates 0.98 with actual tournament wins. Quarantined. |
| Coach, Team, Conference, Seed Results; Z Rating Cumulative; PAKE/PASE | All-time totals that include the tournament being predicted. Quarantined; recompute walk-forward if wanted. |
| Game recaps as features | Written after the game. They explain misses but can't be inputs. Availability that a recap says was "known before tip-off" stays off by default (`news_availability` in `build/walkforward.js`). |
| Team names or IDs as inputs | The model would memorize programs ("Duke usually wins") instead of learning why. Never used; a test enforces it. |
| Luck | Win % minus expected win %: the network gave it no weight. |
| Rank columns | Monotonic copies of the values. Kept because you asked to include duplicates, but they add nothing on their own. |
| Seeds | Mostly a function of the ratings. Kept as a stage B feature. |
| Betting lines, public pick shares | Opinion about the teams rather than facts about them, and the public is often wrong. Never inputs. Public picks only label which wins were unpopular. |

## What the misses look like

The base model missed 357 of 1,196 tournament games (29.8%). The miss rate is lowest in the first two rounds (25–27%), where strength gaps are widest, and highest in the First Four (46%), Sweet 16 and later (36–39%), where teams are evenly matched.

The biggest misses were 15-over-2 and 16-over-1 upsets the model gave 5–10%: Norfolk State 2012, UMBC 2018, Fairleigh Dickinson 2023, Saint Peter's 2022. Recaps for games like these usually describe hot shooting (Oakland's Jack Gohlke made 10 threes against Kentucky in 2024) or a late-game coin flip. That is variance, not a missed signal, and the extraction schema labels it (`mostly_variance`) so it doesn't get treated as a pattern to learn.

## Facts vs opinions

Every input is tagged by where it comes from:

| Kind | Meaning | Examples | Count | Penalty |
|---|---|---|---|---|
| stat | Counted from games | Shooting %, rebounds, wins vs top 25, travel miles, spark stats | 473+ | 1× |
| rating | An algorithm applied to stats | KenPom/Barttorvik AdjEM, NET, Elo, BPI | 154 | 1× |
| projection | A stats-based forecast | KenPom and RPPF preseason ratings | 16 | 1.5× |
| hybrid | Human judgment informed by stats | Committee seeds, recruiting-based talent, Z rating | 14 | 2× |
| opinion | Human judgment | AP poll, Heat Check dark horse / upset alert / Cinderella picks | 11 | 4× |

Nothing is banned. Inputs with a heavier penalty need more evidence before the tournament network leans on them, so an opinion that tracks something real can still be used. On top of that, `--exclude-kind` reruns the whole walk-forward without one kind, and `build/checks.js` keeps the kind only if leaving it out makes predictions worse.

## Spark stats

From each team's game log before the tournament (`mo_` columns in `data/dataset.json`):
- ceiling and floor (90th and 10th percentile game);
- streakiness (do good games follow good games?);
- trend over the last 10 games, and last 5 games vs season level;
- win streak entering March, and longest streak;
- close-game record;
- game-to-game 3-point swing, and recent 3-point heat;
- conference-tournament wins;
- wins over clearly better teams.

Example: 2024 N.C. State (11 seed, Final Four) entered +13.9 above its season level over its last 5, trending up, with 5 conference-tournament wins and 3 wins over clearly better teams. Duke, its Elite 8 opponent, was flat and had won 22% of its close games. The base model gave Duke 76%; N.C. State won.

## Do tournament runs carry forward?

Each matchup is predicted when it happens, so earlier rounds of the same tournament are fair inputs. So is a program's record in earlier tournaments. Measured against what the model already expected ([miss-review.md](miss-review.md)):

| Stat | Odd / even seasons | Read |
|---|---|---|
| Average winning margin so far | +0.07 / +0.10 | Promising: teams that win big early keep beating expectations |
| Program's tournament wins, last 5 years | +0.07 / +0.08 | Promising: recent March programs outperform their numbers |
| Upset wins so far ("Cinderella" momentum) | +0.07 / +0.01 | Weak |
| Beating expectations so far | +0.09 / −0.02 | Not supported: inconsistent |

How a team has been winning seems to matter more than the bare fact that it pulled an upset. None of these clear the significance bar alone yet. They feed the tournament network as the `tourney_run` group, and the walk-forward run decides.

## Slices instead of one pool

Pooling every game can hide a pattern that lives in one kind of game, or that points opposite ways in two kinds. So the miss review also runs inside each slice:
- first-round seed line (5v12, 6v11, ...);
- later-round seed gap;
- round;
- era (2008–14, 2015–19, 2021–26 portal/NIL);
- power vs mid-major underdog;
- favorite strength.

A test proves the method works: a pattern planted only in 5-vs-12 games is invisible pooled and found sliced.

Slicing has a cost. Each slice is small (72 5-vs-12 games in 18 years), and testing about two dozen slices means some look good by luck. So each slice gets a shuffled-results baseline, and the slices together get a false-discovery correction. Current standing ([miss-review.md](miss-review.md)):

| Slice | What shows up | Evidence |
|---|---|---|
| Close games (favorite 50–65%) | Talent, EvanMiya rating, preseason KenPom | Best of all slices, q = 0.23 |
| Round of 32 | Effective height | q = 0.34 |
| 5 vs 12 | Neutral-site free-throw rate allowed | q = 0.48 |
| 1 vs 16 | 2 upsets in 72 games | Too few to test |

None clear the bar yet. They are a watch list, and each new tournament either strengthens or retires them.

The tournament model uses slices the same cautious way. It gets each game's seeds, round, era and conference type as context, plus the top features within each round group. Heavy regularization keeps thin slices close to the overall pattern unless the data insists (partial pooling).

## Upset watch

`build/upset-watch.js` takes each game and:
- finds the 12 most similar past tournament games in the same slice;
- counts how often those underdogs won compared with what the model expected;
- lists which upset signatures learned from earlier seasons fire.

It is backtested walk-forward over 2012–2026 ([upset-watch-backtest.md](upset-watch-backtest.md)):

| Games | Count | Model said | Underdogs won |
|---|---|---|---|
| A learned signature fired | 167 | 34.6% | 40.7% |
| Lookalikes beat the model by 8+ pts | 238 | 33.6% | 39.9% |
| Neither | 597 | 25.6% | 24.5% |

Flagged underdogs do win about 6 points more often than predicted. But turning that into adjusted probabilities, with the trust level picked each season from earlier seasons only, didn't improve predictions. Signatures alone, lookalikes alone and both together all came out slightly worse than the model (log loss +0.0007 to +0.0022). The effect is about 1.6 standard errors: a real hint, not yet proof.

So the watch reports evidence without changing the numbers. The backtest re-decides that automatically each time it runs.

## How the learning avoids memorizing

- **Walk-forward evaluation.** Each season is predicted using only earlier tournaments and that season's pre-tournament data, the same position we'll be in in March 2027. Seasons, not games, are the unit of evidence.
- **Two stages, stacked properly.**
  - Stage A learns from about 59,000 regular-season games of seasons up to the test season. It no longer trains on earlier tournaments: stage B learns from stage A's predictions on those tournaments, and a second stage must only ever see out-of-sample first-stage predictions. Training stage A on them made its errors there look smaller than they are, and stage B then learned the wrong corrections.
  - Stage B learns tournament-specific corrections from earlier tournaments only, as a correction on top of stage A (an offset), so regularization pulls it back to "trust stage A" rather than toward 50/50.
- **Screening that accounts for how many inputs were tried.** Stage B can choose from 413 candidate inputs but has only a few hundred training games. An input gets in only if its correlation with stage A's misses clears |r| ≥ 3.3/√n (about p < 0.001 per test) and holds with the same sign in odd and even seasons separately, with at most one input per 25 training games. Before this rule, the screen picked noise like "rank of opponents' three-point %" and stage B did worse than stage A in 2013 and 2014.
- **Regularization chosen out of sample.**
  - The network's L2 and training length are picked on the two most recent training tournaments, held out.
  - The ridge model's penalty is picked by leave-one-tournament-out.
  - Opinion and hybrid inputs carry larger penalties.
- **Gates** (`build/checks.js`): the adopted model must beat the seed-only and efficiency-only benchmarks in 90% of season resamples, stay calibrated, keep its train/test gap small, not collapse in any season, and show no gain on **shuffled labels**.

## Statistical principles used

| Principle | Where |
|---|---|
| Proper scoring rules (log loss first, Brier too); accuracy is reported but never used to choose | `build/lib/metrics.js` |
| Out-of-sample by time: walk-forward, never random splits of games | `build/walkforward.js` |
| Stacking only on out-of-sample predictions | stage A without tournaments; the blend's weights are fit on earlier test seasons only |
| Benchmarks: seed-only, efficiency-margin-only, Elo-only logistic models | every walk-forward season |
| Several model families side by side: neural network, ridge logistic regression, stacked blend | every walk-forward season |
| Uncertainty by season block bootstrap, because games in a season aren't independent | paired comparisons, gates |
| One-standard-error rule: the simplest model within one SE of the best is adopted | model choice |
| Multiple-testing control for input screening | `selectFeatures` |
| Shrinkage toward a sensible prior (stage A) instead of toward zero | ridge prior, network offset |
| Calibration measured (reliability bins, ECE) | report and gates |
| Negative control: the same pipeline on shuffled labels must learn nothing | `--control shuffled` |
| Ablation: each kind of input must earn its place | `--exclude-kind` |
| Fixed seeds, pinned inputs, recorded runs | `build/pipeline.js`, `runs/` |

## Training results (walk-forward, 2012–2026, 937 tournament games)

Every number is out of sample: each season was predicted by models that had seen only earlier tournaments and that season's pre-tournament data. This is the latest run (`node build/pipeline.js --full`; the run record is in `runs/`).

| Model | Log loss | Brier | Accuracy | Calibration error (pts) | vs base network |
|---|---|---|---|---|---|
| Stacked blend of five models | 0.5467 | 0.1857 | 70.2% | 2.9 | -0.0022 ± 0.0038 |
| Linear on point margin (adopted) | 0.5482 | 0.1860 | 70.4% | 2.7 | -0.0006 ± 0.0043 |
| Base network (26 stats) | 0.5489 | 0.1868 | 69.6% | 2.3 | — |
| Tournament network | 0.5489 | 0.1865 | 70.0% | 1.9 | +0.0001 ± 0.0044 |
| Ridge tournament model | 0.5499 | 0.1870 | 69.8% | 3.4 | +0.0010 ± 0.0047 |
| Efficiency margin only (logistic) | 0.5511 | 0.1877 | 70.8% | 0.9 | +0.0022 ± 0.0029 |
| Boosted trees (tournament) | 0.5528 | 0.1879 | 70.8% | 3.0 | +0.0040 ± 0.0059 |
| Elo only (logistic) | 0.5718 | 0.1949 | 69.6% | 2.3 | +0.0229 ± 0.0067 |
| Seed only (logistic) | 0.5764 | 0.1972 | 71.7% | 1.6 | +0.0276 ± 0.0063 |

- **Adopted:** marginA, the simplest model within one standard error of the best (the blend).
- **Seeds are the weakest signal.** Every rating-based model beats them in 100% of season resamples.
- **Tournament-specific inputs** add little on their own. What survives screening: height (effective and average), altitude, KenPom's preseason-to-now change, and AP preseason rank.
- **Calibration** is good for every model: 1–3 points of expected calibration error.

## Learning from margins, not just wins

A game won by 25 says more about two teams than a game won by 1. The base network learned only win or lose. A linear model trained on **point margin** (P(win) = Φ(predicted margin / σ), σ ≈ 10.7 points) uses the same inputs and games:

| Model | 2021+ regular season (19,345 games) | Walk-forward tournaments 2012–2026 (937 games) |
|---|---|---|
| Linear on point margin (29 parameters) | **0.5712** | **0.5487** |
| Linear on win/loss | 0.5720 | — |
| Base network on win/loss (1,032 parameters) | 0.5725 | 0.5493 |
| Efficiency margin alone (1 parameter, adopted by the one-SE rule) | — | 0.5517 |

The margin model is now the best single model, and the tournament models build on it (`CONFIG.stageB.base`). That choice was made on the regular-season time split, which uses no tournament results. The one-SE rule still adopts the one-parameter model, because the season-to-season spread (±0.0033) makes even a 0.003 gap uncertain.

## Game context, coaches and rivals: tested

Added: altitude (Open-Meteo elevation for every campus and site), air pressure at tip-off (Open-Meteo archive), body-clock tip time (ESPN tip time and campus time zone), a crowd proxy (attendance × closeness to campus), the listed home team (home uniforms), earlier meetings this season, the coach's tenure and record before the season (Sports-Reference, previous season's page to avoid leaks), and three "variance" interactions from tempo-free analysis: pace, three-point volume and same-conference opponents, each times stage A's logit. Each is checked against the base model's out-of-sample misses (937 games; the bar is |r| ≥ 0.11):

| Input | r | Odd seasons | Even seasons | Reading |
|---|---|---|---|---|
| Campus elevation | −0.097 | −0.078 | −0.117 | High-altitude programs underperform the model; enters the screen from 2024 |
| Elevation gain at the site | +0.097 | +0.078 | +0.117 | The same fact from the other side (r = 1.00 within a game) |
| Coach's prior tournaments | +0.049 | +0.081 | +0.021 | Small, consistent |
| Coach tenure | +0.047 | +0.052 | +0.041 | Small, consistent |
| Crowd proxy | +0.046 | +0.013 | +0.088 | Weak; attendance exists for only 406 team-games |
| Head-to-head wins this season | +0.042 | −0.029 | +0.111 | Flips between halves: nothing |
| Pace × favorite strength | +0.025 | +0.020 | +0.032 | Nothing: slow games don't help underdogs here |
| Same conference × favorite strength | −0.026 | +0.009 | −0.053 | Nothing |
| Listed home team (uniforms) | −0.020 | +0.045 | −0.082 | Nothing; also r = −0.75 with seed |
| Body-clock tip time (early tips) | +0.013 | +0.092 | −0.083 | Flips between halves: nothing |
| Three-point volume × favorite strength | −0.006 | +0.013 | −0.021 | Nothing |
| Coach's tournament over/under-performance | +0.004 | +0.056 | −0.050 | Nothing; "coaches who win in March" doesn't carry forward beyond the team |

**Altitude.** High-altitude programs (BYU, Utah St., Colorado, New Mexico, Air Force, Wyoming, Colorado St.) win more at home than other teams because visitors aren't acclimated. That inflates their season ratings, and on a sea-level neutral court they come in below them. A fixed home-court term in the ratings can't see this. A per-team home-court term in the ratings would be the principled fix.

**Air pressure.** Indoors, pressure is altitude plus weather, and weather adds nothing: the pressure drop correlates 1.00 with elevation gain. It stays as a candidate, but the redundancy filter will never take both.

**Floors and jerseys.** Tournament floors are one NCAA design, so there is no variation to learn from. The listed home team (who wears home uniforms) is almost entirely seed order.

**Referees.** Crew assignments aren't public until shortly before tip-off, and their effect would need each official's regular-season foul history. Not added.

## Overlap and double counting

Full table: `docs/overlap.md` (regenerated by the pipeline). The 436 candidates collapse into about 200 distinct ideas at |r| ≥ 0.8.
- **Exact duplicates:** effective height over all games vs neutral-court games (1.00), elevation gain vs pressure drop (1.00), KenPom vs Barttorvik efficiency margin (0.99). The tournament model had been using both effective-height columns, counting height twice.
- **Already known to the base model:** 60 candidates correlate at |r| ≥ 0.8 with its estimate. Screening on the base model's misses already discounts them.
- **The fix:** screening now takes at most one input per idea, skipping a candidate that correlates at |r| ≥ 0.8 with one already chosen.

## Upset anatomy

Full table: `docs/upset-anatomy.md` (regenerated by the pipeline). Out of sample, favorites the model put at 60–70% won 65%, at 80–90% won 85%, and at 90–97% won 96%. Ranking games by upset risk, a random upset had been rated riskier than a random favorite win about 72% of the time.

What happened in the games, measured against both teams' season norms:
- **Three-point luck** decided 41% of upsets but 32% of favorite wins.
- **Hot underdog shooting:** in 48% of upsets the underdog made at least 6 more points from three than expected. In 36% that luck alone was bigger than the final margin.
- **Turnovers and offensive rebounding** rarely decide either kind of game.
- **Pace:** upsets don't have fewer possessions (66.3 vs 67.0).

So most upsets are shooting variance that no pregame number can see. The realistic goal is rating the risk correctly, and the tiers show the model does.

## A caution about the forking paths

Every design choice in this round was made while looking at the same 2012–2026 walk-forward results. Even with honest walk-forward, choosing among many variants that way overfits a little to those seasons, so differences of about 0.001–0.002 between variants shouldn't be trusted. The configuration is now fixed and recorded in `runs/`. The 2027 tournament, scored before any further changes, is the real test.

## Per-team home-court edges

The ratings used one league-wide home edge. Estimating each team's own edge from its home results, with empirical Bayes pooled over seasons, shows two things.

- **Generic venue differences are noise.** Across teams, the raw home edges vary exactly as much as sampling noise predicts (spread 1.0 against noise 1.05 points per 100 possessions), so empirical Bayes shrinks them all back to the league edge. "Loud gyms" can't be told apart from luck.
- **Altitude is real.** Raw home edges rise 0.1–0.9 points per km of campus elevation on each side of the ball, consistently in every season, and correlate +0.20 with elevation. Each venue is now shrunk toward an altitude-informed prior: league edge + β × elevation, plus a heavily shrunk team-specific part. Elevations are in `sources/campus-elevation.json` (Kaggle coordinates and Open-Meteo, plus six altitude programs entered by hand).

With the rebuilt ratings, **every** model improved by about 0.0005 log loss (margin model 0.5487 → 0.5482, base network 0.5493 → 0.5489, efficiency margin 0.5517 → 0.5511). All of them moving the same way is more convincing than one variant winning.

## More complex, or simpler?

Every comparison so far points the same way. With about 60 tournament games a year, flexibility costs more than it buys.

| Comparison | Simpler | More complex | Winner |
|---|---|---|---|
| Base model, 2021+ regular season (19,345 games) | Linear on margin 0.5712 | Network 96-48 0.5735 | Simpler |
| Base model, 2021+ tournaments | Linear on margin 0.5589 | Network 24-12 0.5645 | Simpler |
| Tournament stage, 2012–2026 walk-forward | Ridge 0.5499 | Boosted trees 0.5540 (best in 2019, worst in 2021–2022) | Simpler |
| Inputs | Screened, one per idea | All 442 candidates | Screened (unscreened travel and rest had cost up to 0.010 in a season) |
| Combining models | One model | Stacked blend of five | **Blend** (0.5474, best overall) |

So the answer isn't more layers or more columns. It's:
- **More information per game:** margins instead of win/loss.
- **Better measurements:** altitude-aware ratings, roster availability from box scores.
- **Careful screening and shrinkage.**
- **Averaging several different simple models.**

The one kind of "more" that would clearly help is more independent tournament games to learn from.

## Sources: what exists, what we use, what's missing

| Source | What it offers | Status |
|---|---|---|
| Barttorvik game files | Every D-I box score since 2008 | **Used** (our ratings, Elo, schedule, head-to-head) |
| Kaggle "March Madness Data" (CC0) | KenPom, Barttorvik, EvanMiya, Heat Check, 538, AP, TeamRankings, NET and more | **Used** (pre-tournament checks, quarantines) |
| ESPN player box scores (sportsdataverse) | Every player, every game, 2005–2026 | **Used** (roster shape, continuity, transfers, availability) |
| ESPN scoreboards and summaries | Tip time, venue, attendance, home listing, recaps | **Used** |
| Open-Meteo | Elevation; historical weather | **Used** |
| Sports-Reference | Coaches by season | **Used** (careful about career columns that include the season) |
| Wikipedia | Brackets, seeds | **Used** |
| GDELT | Live pregame news | **Ready** for 2027 |
| Kaggle "March Machine Learning Mania" | Results since 1985 (box scores since 2003), Massey ordinals (dozens of computer rankings weekly), coaches | **Missing; needs your Kaggle login and accepting the competition rules.** This is the most valuable addition: about twice as many tournament games to learn from, and a consensus of rating systems. |
| CollegeBasketballData.com API | Games, box scores, lineups and ratings since 2003 | **Missing; free key needed.** Would let our ratings reach back to 2003 (5 more tournaments). |
| cbbdata (Barttorvik API) | Day-by-day Barttorvik ratings | Needs a KenPom subscription to activate |
| Massey Ratings archive | Composite of computer rankings | Behind a bot check (not bypassed); the same data comes with the Kaggle competition files |
| Sportradar, SportsDataIO, ShotQuality, Synergy | Play-by-play, shot quality, injuries | Paid |
| Historical injury reports | No public archive found; the NCAA Injury Surveillance Program is research-only | Our box-score availability signal stands in for it |
| Betting lines, Polymarket, public picks | Market and crowd opinion | **Excluded by policy** |

## Audit: what was wrong, what's fixed, what to watch

Fixed in these rounds:
- **Stacking leak:** stage A trained on earlier tournaments that stage B then learned from.
- **Winner's curse in input screening:** the screen picked noise.
- **Double counting:** effective height was used twice, and near-duplicates everywhere.
- **Unscreened inputs:** travel and rest went in without passing the screen.
- **Flag files:** Heat Check lists only flagged teams. Unlisted teams were treated as missing instead of "no", which dropped 80% of games and inflated the apparent effect.
- **Run/program history:** expectations came from a model that had seen later regular seasons.
- **A single league-wide home edge:** altitude inflated some teams' ratings.

Still to watch:
- **Forking paths:** all of these choices were made looking at 2012–2026, so small differences are overfit a little. 2027 is the clean test.
- **Small samples:** about 60 games a year. More seasons (Kaggle competition data, CollegeBasketballData.com) is the biggest available lever.
- **One upstream aggregator:** most outside ratings come from one Kaggle author's files. The main file and the neutral-court splits are verified pre-tournament; the leakage tests cover the rest.
- **Near-certain tournament favorites:** at 97%+ under the margin model, they lost 3 of 42, against 0.7 expected (UMBC over Virginia is one). On held-out regular-season games the normal curve is calibrated even in the tails (3 upsets in 159 games at 97–99%, against 3.4 expected) and beats a fatter-tailed logistic link. So it stays; changing it because of 3 tournament games would be fitting to noise. Recheck after 2027.
- **Coach tournament residuals** still use the shipped base model's expectations, a mild version of the history issue above. The coach residual is never selected.

## Game importance

Idea: games between two tournament-calibre teams, on neutral floors, or late in the season look more like March and should count more when training the base network. The presets (`build/lib/importance.js`) were tested on the 2008–2011 tournaments, which are never test seasons:

| Weighting | Log loss vs uniform |
|---|---|
| Two tournament-calibre teams ×3 (one ×1.5) | −0.0026 ± 0.0028 |
| Both of those, plus neutral floor ×2 | −0.0012 ± 0.0039 |
| Neutral floor ×2 | −0.0002 ± 0.0019 |
| Late season ×2 | 0.0000 ± 0.0019 |
| All of them | +0.0009 ± 0.0051 |

Weighting quality matchups points the right way but is within one standard error, so uniform weights stay for now. The test reruns with `node build/pipeline.js --tune`, and the weighting will be adopted automatically if more data backs it up. The tournament stage already learns only from tournament games, which may be why extra weighting adds little.

Home court is part of every regular-season rating. In the tournament, travel distance and time zones (Kaggle) and days of rest before each game are inputs, alongside workload in the last 7 and 14 days.

## New sources added in this round

| Source | What it adds | Kind | Why it is safe |
|---|---|---|---|
| ESPN player box scores (sportsdataverse releases, 2005–2026) | Star dependence, depth, rotation size, lineup stability, guard minutes, roster continuity, transfer minutes, experience, and a **box-score injury signal**: did the top five play their usual minutes in the last three games before the tournament | stat | Games before each team's first NCAA game only; hash-pinned files |
| Our own margin-of-victory Elo | A rating that remembers last season (program strength), its 30-day trend, and the preseason prior | rating | Tuned on regular-season games only; flipping every tournament result leaves the snapshot unchanged (tested) |
| Schedule | Games in the last 7 and 14 days (conference-tournament workload), rest before the first game, share of games on the road, and rest before every tournament game | stat | Dates known before tip-off |

The box-score injury signal matters because news extraction needs an API key and covers only some games, while box scores cover every team. A star who sat out the conference tournament shows up here with no article needed.

### Considered and not used

- **Kaggle "March Machine Learning Mania" competition data:** needs a Kaggle account and accepting the competition rules. You can download it and drop it in; the ingest pattern is the same.
- **Betting lines and public pick shares:** excluded by policy.
- **Season RAPM and player-value files:** the season totals include postseason games, which would leak the tournament.
- **KenPom and EvanMiya directly:** subscription sites. Their numbers arrive through the Kaggle files.
- **Sports-Reference:** rate-limited and largely duplicates the ratings we already have.

## Where each source enters

See `sources/registry.json`. In short:
- **Automated:** Barttorvik box scores, Wikipedia brackets, the Kaggle dataset (CC0), ESPN game data.
- **Through the Kaggle files:** the subscription sites (KenPom, EvanMiya) and the article sites. None are scraped directly.
- **Live pregame news:** the GDELT news API for next season.
