# Upset anatomy

Out-of-sample predictions for 937 tournament games (2012–2026), adopted model: marginA. "Favorite" means the model's favorite before tip-off.

## Can the model tell near-certain wins from likely upsets?

| Favorite's chance | Games | Upsets expected | Upsets that happened |
|---|---|---|---|
| Coin flip (50–60%) | 275 | 44.9% | 48.7% |
| Lean (60–70%) | 231 | 34.9% | 30.7% |
| Solid (70–80%) | 195 | 25.3% | 25.6% |
| Strong (80–90%) | 118 | 15.2% | 12.7% |
| Heavy (90–97%) | 76 | 6.2% | 5.3% |
| Near-certain (97%+) | 42 | 1.7% | 7.1% |

Ranking games by upset risk: a random upset had been rated more upset-prone than a random favorite win **70.7%** of the time (AUC 0.707; 50% would be guessing).

## What decided the games

For each game, the factor whose swing against both teams' season norms did the most to produce the winning margin.

| Factor | Upsets decided by it | Favorite wins decided by it | Avg. points it gave the winner in upsets | ... in favorite wins |
|---|---|---|---|---|
| Three-point shooting luck | 41.2% | 31.5% | 5.7 | 4.0 |
| Other shooting | 29.6% | 41.1% | 3.5 | 5.6 |
| Turnovers | 5.1% | 2.6% | 0.5 | 0.2 |
| Offensive rebounding | 3.2% | 2.9% | -0.2 | 0.8 |
| Free throws | 20.9% | 22.0% | 2.9 | 3.6 |

- In 48.0% of upsets the underdog made at least 6 more points from three than its norm (against that defense) would predict; in 36.8% that three-point luck alone was bigger than the final margin.
- Possessions: 66.5 in upsets vs 66.9 in favorite wins (fewer possessions, fewer chances for the better team to pull away).
- Margin: upsets were decided by 8.2 points on average, favorite wins by 13.7.

What this means for prediction: a large share of upsets come from shooting variance that no pregame number can see. The model's job is to rate the risk correctly (the tiers above), not to call every upset.

## The biggest upsets and what decided them

| Year | Round | Winner (seed) | Loser (seed) | Score | Model gave the winner | Decided by | Three-point luck (pts) |
|---|---|---|---|---|---|---|---|
| 2023 | Round of 64 | Fairleigh Dickinson (16) | Purdue (1) | 63-58 | 1.6% | Three-point shooting luck | 10.4 |
| 2018 | Round of 64 | UMBC (16) | Virginia (1) | 74-54 | 2.4% | Three-point shooting luck | 24.1 |
| 2012 | Round of 64 | Norfolk St. (15) | Missouri (2) | 86-84 | 2.6% | Offensive rebounding | 2.2 |
| 2021 | Round of 64 | Oral Roberts (15) | Ohio St. (2) | 75-72 | 7.9% | Turnovers | 4.6 |
| 2016 | Round of 64 | Middle Tennessee (15) | Michigan St. (2) | 90-81 | 8.0% | Three-point shooting luck | 8.2 |
| 2015 | Round of 64 | UAB (14) | Iowa St. (3) | 60-59 | 9.8% | Offensive rebounding | -3.9 |
| 2022 | Round of 64 | Saint Peter's (15) | Kentucky (2) | 85-79 | 9.8% | Three-point shooting luck | 12.9 |
| 2022 | Sweet 16 | Saint Peter's (15) | Purdue (3) | 67-64 | 12.4% | Free throws | 3.1 |
| 2013 | Round of 64 | Florida Gulf Coast (15) | Georgetown (2) | 78-68 | 12.4% | Free throws | 9.9 |
| 2014 | Round of 64 | Mercer (14) | Duke (3) | 78-71 | 14.9% | Other shooting | -4.7 |
| 2024 | Round of 64 | Yale (13) | Auburn (4) | 78-76 | 14.9% | Three-point shooting luck | 7.4 |
| 2021 | Round of 32 | Oral Roberts (15) | Florida (7) | 81-78 | 15.3% | Free throws | 1.3 |
| 2018 | Round of 64 | Marshall (13) | Wichita St. (4) | 81-75 | 15.8% | Three-point shooting luck | 10.1 |
| 2013 | Round of 32 | Florida Gulf Coast (15) | San Diego St. (7) | 81-71 | 16.9% | Other shooting | 1.5 |
| 2013 | Round of 64 | Harvard (14) | New Mexico (3) | 68-62 | 17.6% | Other shooting | 9.2 |
| 2016 | Round of 64 | Little Rock (12) | Purdue (5) | 85-83 | 17.8% | Turnovers | -0.3 |
| 2023 | Round of 64 | Princeton (15) | Arizona (2) | 59-55 | 18.2% | Other shooting | -4.9 |
| 2024 | Round of 64 | Oakland (14) | Kentucky (3) | 80-76 | 18.7% | Three-point shooting luck | 18.1 |
| 2012 | Round of 64 | Lehigh (15) | Duke (2) | 75-70 | 18.7% | Free throws | 9.5 |
| 2016 | Round of 64 | Stephen F. Austin (14) | West Virginia (3) | 70-56 | 18.8% | Free throws | 3.5 |
| 2023 | Sweet 16 | Miami FL (5) | Houston (1) | 89-75 | 18.8% | Three-point shooting luck | 13.4 |
| 2022 | Round of 32 | Miami FL (10) | Auburn (2) | 79-61 | 19.7% | Other shooting | 5.2 |
| 2016 | Elite 8 | Syracuse (10) | Virginia (1) | 68-62 | 20.5% | Free throws | -2.8 |
| 2024 | Round of 64 | Duquesne (11) | BYU (6) | 71-67 | 21.6% | Other shooting | 3.2 |
| 2023 | Elite 8 | Miami FL (5) | Texas (2) | 88-81 | 21.9% | Free throws | -7.0 |
