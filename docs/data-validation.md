# Data validation

Run by build/pipeline.js before training. 0 problems, 5 quarantined season-columns, 18 warnings.

## Problems (stop the pipeline)

None.

## Quarantined (treated as missing)

- tra_lo 2008: correlation with our efficiency margin -0.12 vs -0.71 in a typical season
- tra_lo 2009: correlation with our efficiency margin -0.11 vs -0.71 in a typical season
- tra_lo 2010: correlation with our efficiency margin -0.08 vs -0.71 in a typical season
- tra_lo 2011: correlation with our efficiency margin -0.05 vs -0.71 in a typical season
- tra_lo 2012: correlation with our efficiency margin -0.25 vs -0.71 in a typical season

## Warnings

- kb_games: 2 value(s) over 10 robust SDs from the median: 2021 Colgate 15; 2021 Iona 17
- hc_easy_draw 2026: only 2 teams (typically 68)
- hc_tough_draw 2026: only 2 teams (typically 68)
- hc_dark_horse 2026: only 2 teams (typically 68)
- hc_upset_alert 2026: only 2 teams (typically 68)
- hc_cinderella 2026: only 2 teams (typically 68)
- res_q3_q4_l: 2 value(s) over 10 robust SDs from the median: 2013 Liberty 16; 2016 Holy Cross 18
- tr_hi: 1 value(s) over 10 robust SDs from the median: 2025 Saint Francis 314
- tr_sos_hi: 14 value(s) over 10 robust SDs from the median: 2008 Coppin St. 229; 2009 Binghamton 196; 2013 North Carolina A&T 224; 2016 Cal St. Bakersfield 211
- tr_luck_hi: 17 value(s) over 10 robust SDs from the median: 2015 Hampton 134; 2016 Stephen F. Austin 153; 2017 South Dakota St. 150; 2017 Vanderbilt 208
- tr_consistency_hi: 58 value(s) over 10 robust SDs from the median: 2008 Kentucky 319; 2015 Duke 110; 2015 Georgia St. 102; 2015 Harvard 91
- trh_hi: 111 value(s) over 10 robust SDs from the median: 2015 Albany 98; 2015 Belmont 95; 2015 Hampton 160; 2015 North Dakota St. 135
- tra_hi: 82 value(s) over 10 robust SDs from the median: 2008 Siena 82; 2015 Hampton 160; 2015 Manhattan 128; 2015 North Dakota St. 135
- trn_hi: 71 value(s) over 10 robust SDs from the median: 2015 Eastern Washington 79; 2015 Texas Southern 110; 2015 UAB 95; 2016 Austin Peay 119
- ap_preseason_votes: 495 value(s) over 10 robust SDs from the median: 2008 Arizona 499; 2008 Arkansas 468; 2008 Butler 114; 2008 Clemson 83
- ap_final_votes: 462 value(s) over 10 robust SDs from the median: 2008 Butler 841; 2008 BYU 327; 2008 Connecticut 736; 2008 Davidson 334
- coach_tourney_resid: 12 value(s) over 10 robust SDs from the median: 2013 Butler 4.848; 2015 Kentucky 4.734; 2016 Kentucky 4.643; 2016 Michigan St. 5.016
- dv_campus_elev: 7 value(s) over 10 robust SDs from the median: 2012 Colorado 1.627; 2013 Colorado 1.627; 2014 Colorado 1.627; 2015 Wyoming 2.186
