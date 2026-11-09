# Miss review

Predictions: shipped base model. 1196 tournament games, 357 misses (29.8%).

## How to read the signatures

A signature is a stat whose underdog-minus-favorite gap goes with upsets more (or less) often than the model expects. It counts only if it clears two standard errors in odd and even seasons separately. "By chance" is how many stats pass when the results are shuffled at random (average, and the 95th percentile). A slice is trusted only when it beats chance; a slice that doesn't may still hold one real pattern, but it can't be told apart from luck yet.

## All games pooled

2 of 716 stats pass; by chance 0.8 on average (95th percentile 4). not above chance (p = 0.169).

| Stat | r | Odd yrs | Even yrs | Games | Passes |
|---|---|---|---|---|---|
| hc_tough_draw (Heat Check Ratings: TOUGH DRAW) | -0.236 | -0.155 | -0.391 | 187 |  |
| ap_preseason_rank (AP Poll Data: ap_preseason_rank) | -0.121 | -0.108 | -0.136 | 1194 | ✓ |
| ap_preseason_votes (AP Poll Data: ap_preseason_votes) | 0.126 | 0.107 | 0.145 | 1194 | ✓ |
| z_z_rating (Z Rating Teams: Z RATING) | 0.098 | 0.107 | 0.094 | 735 |  |
| em_relative_rating (EvanMiya: RELATIVE RATING) | 0.079 | 0.076 | 0.083 | 1003 |  |
| shot_threes_fgpctd (Shooting Splits: THREES FG%D) | -0.092 | -0.076 | -0.107 | 1067 |  |
| btn_badj_em (Barttorvik Neutral: BADJ EM) | 0.078 | 0.083 | 0.074 | 1152 |  |
| ap_peak_rank (AP Poll Data: ap_peak_rank) | -0.083 | -0.094 | -0.072 | 1194 |  |
| prog_wins5 | 0.074 | 0.072 | 0.076 | 1194 |  |
| trn_v_1_25_wins (TeamRankings Neutral: V 1-25 WINS) | 0.084 | 0.099 | 0.071 | 1194 |  |
| prog_games5 | 0.072 | 0.075 | 0.071 | 1194 |  |
| kpre_kadj_em_change (KenPom Preseason: KADJ EM CHANGE) | 0.109 | 0.144 | 0.070 | 934 |  |
| ap_final_votes (AP Poll Data: ap_final_votes) | 0.070 | 0.073 | 0.067 | 1194 |  |
| ap_final_rank (AP Poll Data: ap_final_rank) | -0.076 | -0.065 | -0.088 | 1194 |  |
| kb_talent (KenPom Barttorvik: TALENT) | 0.077 | 0.064 | 0.091 | 1194 |  |
| bth_talent (Barttorvik Home: TALENT) | 0.077 | 0.064 | 0.091 | 1194 |  |
| bta_talent (Barttorvik Away: TALENT) | 0.077 | 0.064 | 0.091 | 1194 |  |
| btan_talent (Barttorvik Away-Neutral: TALENT) | 0.077 | 0.064 | 0.091 | 1194 |  |
| em_kill_shots_conceded_per_game (EvanMiya: KILL SHOTS CONCEDED PER GAME) | -0.088 | -0.063 | -0.109 | 267 |  |
| btan_badj_o (Barttorvik Away-Neutral: BADJ O) | 0.071 | 0.079 | 0.063 | 1194 |  |

## By segment

Verdicts for slices use Benjamini–Hochberg q-values (q ≤ 0.10 = beats chance) because about two dozen slices are tested at once.

| Segment | Level | Games | Upsets | Stats passing | By chance (avg / 95th) | p | q | Verdict |
|---|---|---|---|---|---|---|---|---|
| seed_line | 1v16 | 72 | 2 | too few to test | | | | |
| seed_line | 8v9 | 72 | 40 | 0 of 664 | 0.7 / 4 | 1.000 | 1.00 | not above chance |
| seed_line | 5v12 | 72 | 28 | 3 of 664 | 0.7 / 4 | 0.085 | 0.42 | not above chance |
| seed_line | 4v13 | 72 | 15 | 0 of 664 | 0.9 / 4 | 1.000 | 1.00 | not above chance |
| seed_line | 6v11 | 72 | 31 | 0 of 664 | 0.8 / 5 | 1.000 | 1.00 | not above chance |
| seed_line | 3v14 | 72 | 8 | too few to test | | | | |
| seed_line | 7v10 | 71 | 25 | 0 of 664 | 0.9 / 6 | 1.000 | 1.00 | not above chance |
| seed_line | 2v15 | 72 | 7 | too few to test | | | | |
| later_round_gap | gap 6+ | 223 | 52 | 0 of 698 | 0.7 / 3 | 1.000 | 1.00 | not above chance |
| later_round_gap | gap 0-2 | 154 | 59 | 4 of 677 | 0.8 / 4 | 0.080 | 0.42 | not above chance |
| later_round_gap | gap 3-5 | 181 | 61 | 0 of 698 | 1.0 / 5 | 1.000 | 1.00 | not above chance |
| round | Round of 64 | 575 | 156 | 2 of 716 | 0.8 / 4 | 0.149 | 0.50 | not above chance |
| round | Round of 32 | 288 | 73 | 5 of 708 | 0.7 / 4 | 0.030 | 0.30 | promising (not after correction) |
| round | Sweet 16+ | 270 | 99 | 1 of 708 | 1.1 / 4 | 0.284 | 0.60 | not above chance |
| round | First Four | 63 | 29 | 0 of 664 | 1.0 / 6 | 1.000 | 1.00 | not above chance |
| era | 2008-2014 | 460 | 138 | 0 of 664 | 0.5 / 2 | 1.000 | 1.00 | not above chance |
| era | 2015-2019 | 335 | 96 | 0 of 682 | 0.3 / 1 | 1.000 | 1.00 | not above chance |
| era | 2021-2026 (portal/NIL) | 401 | 123 | 0 of 716 | 0.5 / 3 | 1.000 | 1.00 | not above chance |
| underdog_conference | mid-major underdog | 658 | 154 | 1 of 716 | 0.8 / 4 | 0.274 | 0.60 | not above chance |
| underdog_conference | power underdog | 538 | 203 | 1 of 716 | 0.7 / 4 | 0.239 | 0.60 | not above chance |
| favorite_strength | heavy (80%+) | 347 | 37 | 1 of 708 | 0.9 / 4 | 0.299 | 0.60 | not above chance |
| favorite_strength | close (50-65%) | 458 | 207 | 7 of 714 | 0.5 / 2 | 0.010 | 0.20 | promising (not after correction) |
| favorite_strength | clear (65-80%) | 391 | 113 | 2 of 713 | 0.5 / 3 | 0.114 | 0.46 | not above chance |

## Do tournament runs carry forward?

Rounds 2 and later for this-tournament stats; all games for program history. r > 0 means teams with more of it win more often than the model expects. "Passes" uses the same two-halves rule as above.

| Stat | Games | r | Odd yrs | Even yrs | Passes |
|---|---|---|---|---|---|
| run_wins | 558 | 0.042 | 0.099 | -0.029 |  |
| run_resid | 558 | 0.039 | 0.089 | -0.015 |  |
| run_margin | 558 | 0.081 | 0.066 | 0.099 |  |
| run_upset_wins | 558 | 0.040 | 0.072 | 0.008 |  |
| run_last_margin | 558 | 0.084 | 0.036 | 0.136 |  |
| prog_games5 | 1196 | 0.072 | 0.075 | 0.070 |  |
| prog_wins5 | 1196 | 0.074 | 0.072 | 0.076 |  |
| prog_resid5 | 1196 | 0.020 | 0.052 | -0.010 |  |
| prog_resid_all | 1196 | 0.061 | 0.103 | 0.021 |  |

### seed_line: 5v12 (not above chance, p = 0.085, q = 0.42)

| Stat | r | Odd yrs | Even yrs | Games |
|---|---|---|---|---|
| btn_ftrd (Barttorvik Neutral: FTRD) | 0.377 | 0.391 | 0.377 | 71 |
| btn_ftrd_rank (Barttorvik Neutral: FTRD RANK) | 0.389 | 0.413 | 0.374 | 71 |
| trn_last (TeamRankings Neutral: LAST) | 0.338 | 0.346 | 0.347 | 72 |

### later_round_gap: gap 0-2 (not above chance, p = 0.080, q = 0.42)

| Stat | r | Odd yrs | Even yrs | Games |
|---|---|---|---|---|
| em_relative_rating_rank (EvanMiya: RELATIVE RATING RANK) | -0.293 | -0.292 | -0.285 | 122 |
| em_relative_rating (EvanMiya: RELATIVE RATING) | 0.291 | 0.277 | 0.309 | 122 |
| em_o_rate (EvanMiya: O RATE) | 0.283 | 0.276 | 0.304 | 122 |
| ap_weeks_ranked (AP Poll Data: ap_weeks_ranked) | 0.260 | 0.256 | 0.275 | 154 |

### round: Round of 64 (not above chance, p = 0.149, q = 0.50)

| Stat | r | Odd yrs | Even yrs | Games |
|---|---|---|---|---|
| hc_tough_draw (Heat Check Ratings: TOUGH DRAW) | -0.342 | -0.289 | -0.456 | 96 |
| ap_preseason_votes (AP Poll Data: ap_preseason_votes) | 0.158 | 0.190 | 0.127 | 575 |

### round: Round of 32 (promising (not after correction), p = 0.030, q = 0.30)

| Stat | r | Odd yrs | Even yrs | Games |
|---|---|---|---|---|
| kb_eff_hgt (KenPom Barttorvik: EFF HGT) | 0.213 | 0.209 | 0.216 | 288 |
| bth_eff_hgt (Barttorvik Home: EFF HGT) | 0.213 | 0.209 | 0.216 | 288 |
| bta_eff_hgt (Barttorvik Away: EFF HGT) | 0.213 | 0.209 | 0.216 | 288 |
| btan_eff_hgt (Barttorvik Away-Neutral: EFF HGT) | 0.213 | 0.209 | 0.216 | 288 |
| btn_eff_hgt (Barttorvik Neutral: EFF HGT) | 0.211 | 0.209 | 0.213 | 285 |

### round: Sweet 16+ (not above chance, p = 0.284, q = 0.60)

| Stat | r | Odd yrs | Even yrs | Games |
|---|---|---|---|---|
| trn_v_1_25_wins (TeamRankings Neutral: V 1-25 WINS) | 0.210 | 0.197 | 0.230 | 270 |

### underdog_conference: mid-major underdog (not above chance, p = 0.274, q = 0.60)

| Stat | r | Odd yrs | Even yrs | Games |
|---|---|---|---|---|
| trn_v_1_25_loss (TeamRankings Neutral: V 1-25 LOSS) | 0.116 | 0.122 | 0.112 | 658 |

### underdog_conference: power underdog (not above chance, p = 0.239, q = 0.60)

| Stat | r | Odd yrs | Even yrs | Games |
|---|---|---|---|---|
| tr_luck_v_26_50_loss (TeamRankings: LUCK V 26-50 LOSS) | -0.142 | -0.141 | -0.145 | 538 |

### favorite_strength: heavy (80%+) (not above chance, p = 0.299, q = 0.60)

| Stat | r | Odd yrs | Even yrs | Games |
|---|---|---|---|---|
| ap_preseason_votes (AP Poll Data: ap_preseason_votes) | 0.195 | 0.190 | 0.199 | 347 |

### favorite_strength: close (50-65%) (promising (not after correction), p = 0.010, q = 0.20)

| Stat | r | Odd yrs | Even yrs | Games |
|---|---|---|---|---|
| em_relative_rating (EvanMiya: RELATIVE RATING) | 0.169 | 0.153 | 0.189 | 381 |
| btn_talent_rank (Barttorvik Neutral: TALENT RANK) | -0.159 | -0.153 | -0.164 | 451 |
| kpre_preseason_kadj_em_rank (KenPom Preseason: PRESEASON KADJ EM RANK) | -0.160 | -0.149 | -0.173 | 355 |
| kb_talent (KenPom Barttorvik: TALENT) | 0.138 | 0.134 | 0.141 | 458 |
| bth_talent (Barttorvik Home: TALENT) | 0.138 | 0.134 | 0.141 | 458 |
| bta_talent (Barttorvik Away: TALENT) | 0.138 | 0.134 | 0.141 | 458 |
| btan_talent (Barttorvik Away-Neutral: TALENT) | 0.138 | 0.134 | 0.141 | 458 |

### favorite_strength: clear (65-80%) (not above chance, p = 0.114, q = 0.46)

| Stat | r | Odd yrs | Even yrs | Games |
|---|---|---|---|---|
| kpre_kadj_em_change (KenPom Preseason: KADJ EM CHANGE) | 0.189 | 0.212 | 0.158 | 317 |
| btn_badj_em (Barttorvik Neutral: BADJ EM) | 0.157 | 0.149 | 0.180 | 384 |

## Misses by round

| Round | Games | Misses | Miss rate |
|---|---|---|---|
| First Four | 63 | 29 | 46% |
| Round of 64 | 575 | 156 | 27% |
| Round of 32 | 288 | 73 | 25% |
| Sweet 16 | 144 | 54 | 38% |
| Elite 8 | 72 | 26 | 36% |
| Final Four | 36 | 14 | 39% |
| Championship | 18 | 5 | 28% |

## Biggest misses

| Year | Round | Winner (seed) | Favorite (seed) | Model gave winner | Score |
|---|---|---|---|---|---|
| 2012 | Round of 64 | Norfolk St. (15) | Missouri (2) | 5% | 86-84 |
| 2018 | Round of 64 | UMBC (16) | Virginia (1) | 6% | 74-54 |
| 2023 | Round of 64 | Fairleigh Dickinson (16) | Purdue (1) | 6% | 63-58 |
| 2015 | Round of 64 | UAB (14) | Iowa St. (3) | 8% | 60-59 |
| 2022 | Round of 64 | Saint Peter's (15) | Kentucky (2) | 8% | 85-79 |
| 2016 | Round of 64 | Middle Tennessee (15) | Michigan St. (2) | 9% | 90-81 |
| 2021 | Round of 64 | Oral Roberts (15) | Ohio St. (2) | 10% | 75-72 |
| 2011 | Elite 8 | VCU (11) | Kansas (1) | 10% | 71-61 |
| 2022 | Sweet 16 | Saint Peter's (15) | Purdue (3) | 12% | 67-64 |
| 2013 | Round of 64 | Florida Gulf Coast (15) | Georgetown (2) | 13% | 78-68 |
| 2024 | Round of 64 | Yale (13) | Auburn (4) | 13% | 78-76 |
| 2014 | Round of 64 | Mercer (14) | Duke (3) | 13% | 78-71 |
| 2011 | Round of 32 | VCU (11) | Purdue (3) | 13% | 94-76 |
| 2023 | Sweet 16 | Miami FL (5) | Houston (1) | 14% | 89-75 |
| 2009 | Round of 64 | Dayton (11) | West Virginia (6) | 14% | 68-60 |
| 2010 | Round of 32 | Cornell (12) | Wisconsin (4) | 14% | 87-69 |
| 2023 | Round of 64 | Princeton (15) | Arizona (2) | 14% | 59-55 |
| 2024 | Round of 64 | Oakland (14) | Kentucky (3) | 14% | 80-76 |
| 2018 | Round of 64 | Marshall (13) | Wichita St. (4) | 15% | 81-75 |
| 2010 | Round of 64 | Ohio (14) | Georgetown (3) | 15% | 97-83 |
| 2010 | Round of 32 | Northern Iowa (9) | Kansas (1) | 15% | 69-67 |
| 2008 | Round of 64 | San Diego (13) | Connecticut (4) | 15% | 70-69 |
| 2013 | Round of 32 | Florida Gulf Coast (15) | San Diego St. (7) | 16% | 81-71 |
| 2013 | Round of 64 | Harvard (14) | New Mexico (3) | 16% | 68-62 |
| 2011 | Round of 64 | Morehead St. (13) | Louisville (4) | 16% | 62-61 |
| 2015 | Round of 32 | N.C. State (8) | Villanova (1) | 16% | 71-68 |
| 2016 | Round of 64 | Little Rock (12) | Purdue (5) | 17% | 85-83 |
| 2011 | Sweet 16 | Butler (8) | Wisconsin (4) | 17% | 61-54 |
| 2021 | Round of 64 | Oregon St. (12) | Tennessee (5) | 17% | 70-56 |
| 2026 | Elite 8 | Connecticut (2) | Duke (1) | 17% | 73-72 |
| 2022 | Round of 64 | Richmond (12) | Iowa (5) | 18% | 67-63 |
| 2022 | Round of 32 | Saint Peter's (15) | Murray St. (7) | 18% | 70-60 |
| 2011 | Round of 32 | Butler (8) | Pittsburgh (1) | 18% | 71-70 |
| 2021 | Round of 32 | Oral Roberts (15) | Florida (7) | 18% | 81-78 |
| 2024 | Round of 64 | Duquesne (11) | BYU (6) | 19% | 71-67 |
| 2021 | Elite 8 | UCLA (11) | Michigan (1) | 19% | 51-49 |
| 2011 | Sweet 16 | Arizona (5) | Duke (1) | 20% | 93-77 |
| 2021 | Round of 64 | Ohio (13) | Virginia (4) | 20% | 62-58 |
| 2026 | Round of 32 | Iowa (9) | Florida (1) | 20% | 73-72 |
| 2014 | Round of 32 | Dayton (11) | Syracuse (3) | 21% | 55-53 |