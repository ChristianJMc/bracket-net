# Overlapping inputs

443 candidate inputs over 937 tournament games collapse into **242 groups** at |r| ≥ 0.9 and **203** at |r| ≥ 0.8.
Inputs in one group carry nearly the same information. Screening (build/walkforward.js `selectFeatures`) now takes at most one input from a group: a candidate is skipped when it correlates at |r| ≥ 0.8 with one already chosen.

## Pairs that could double count

| Pair | r |
|---|---|
| Seed vs listed home team (home uniforms) (seed, gm_designated_home) | -0.75 |
| Elevation gain vs air-pressure drop (gm_elev_gain, gm_pressure_drop) | 1.00 |
| Travel miles vs crowd proxy (g_travel_miles, gm_crowd) | -0.86 |
| Travel miles vs time zones crossed (g_travel_miles, g_travel_tz) | 0.67 |
| KenPom vs Barttorvik efficiency margin (kb_kadj_em, kb_badj_em) | 0.99 |
| AP preseason rank vs votes (ap_preseason_rank, ap_preseason_votes) | -0.87 |
| Effective height: all games vs neutral-court games (kb_eff_hgt, btn_eff_hgt) | 1.00 |
| Our Elo vs KenPom (elo, kb_kadj_em) | 0.93 |
| Coach tournament appearances vs program tournament games (coach_ncaa_prior, prog_games5) | 0.64 |
| Head-to-head wins vs margin (gm_h2h_wins, gm_h2h_margin) | 0.80 |
| Body-clock hour vs early-tip hours (gm_body_hour, gm_early_body) | -0.45 |

## Already inside the base model (|r| ≥ 0.8 with stage A's logit): 60

These only help if they carry something the base model does not; screening on stage A's misses already accounts for that.

rppf_radj_em 0.98, kb_kadj_em 0.98, tr_tr_rating 0.97, f38_power_rating 0.97, kb_badj_em 0.97, em_relative_rating 0.96, f38_power_rating_rank -0.96, rppf_rppf_rating 0.95, z_z_rating 0.92, z_seed_list -0.92, kb_barthag 0.92, kb_wab 0.92, elo 0.91, z_z_rating_rank -0.91, rppf_npb_rating 0.91, seed -0.91, rppf_radj_em_rank -0.91, res_b_power -0.91, kb_kadj_em_rank -0.90, rppf_strem_rank -0.90, tr_tr_rank -0.90, kb_barthag_rank -0.90, tr_last -0.90, ts_quality_avg -0.90, ts_quality_avg_rank -0.90, ts_kp -0.90, kb_badj_em_rank -0.90, ts_sag -0.90, ts_net -0.90, rppf_rppf_rating_rank -0.90, em_relative_rating_rank -0.89, ts_bpi -0.89, mo_floor 0.89, mo_ceiling 0.89, res_net_rpi -0.88, rppf_npb_rating_rank -0.87, ts_resume_avg -0.86, ts_q1and2_w 0.86, ts_resume_avg_rank -0.86, tr_lo -0.86

## Largest groups of near-duplicates (|r| ≥ 0.9)

1. ts_bpi, rppf_rppf_rating_rank, kb_barthag, ts_quality_avg_rank, ts_quality_avg, kb_badj_em_rank, res_resume, kb_barthag_rank, em_relative_rating_rank, rppf_npb_rating_rank, ts_kp, tr_last, tr_tr_rank, rppf_strem_rank, ts_sag, res_net_rpi, res_b_power, ts_net, kb_kadj_em_rank, rppf_radj_em_rank, ts_kpi
2. conf_elite_sos, kb_elite_sos, kb_elite_sos_rank, rppfconf_npb_rating, conf_badj_o, conf_barthag, conf_badj_em, rppfconf_rppf_rating, conf_badj_d, conf_wab, tr_sos_rating, rppfconf_conf_rank
3. em_true_tempo_rank, em_true_tempo, rppf_r_pace_rank, kb_badjt_rank, kb_kadj_t_rank, kb_badj_t, rppf_r_pace, kb_kadj_t, kb_k_tempo_rank, kb_k_tempo
4. z_z_rating, kb_badj_em, em_relative_rating, rppf_rppf_rating, tr_tr_rating, z_z_rating_rank, kb_kadj_em, rppf_radj_em, f38_power_rating, f38_power_rating_rank
5. em_o_rate, kb_badj_o, kb_kadj_o, rppf_radj_o, rppf_stroe, kb_badj_o_rank, em_o_rate_rank, kb_kadj_o_rank, rppf_radj_o_rank
6. kb_wab, rppf_npb_rating, ts_sor, elo, res_wab_rank, z_seed_list, ts_resume_avg_rank, ts_resume_avg, seed
7. kb_badj_d_rank, em_d_rate_rank, rppf_radj_d_rank, em_d_rate, kb_badj_d, kb_kadj_d_rank, rppf_radj_d, kb_kadj_d
8. kb_2ptrd, kb_3ptrd, shot_threes_d_share, kb_2ptrd_rank, kb_3ptrd_rank, shot_threes_d_share_rank
9. shot_threes_share_rank, kb_2ptr, kb_3ptr, shot_threes_share, kb_3ptr_rank, kb_2ptr_rank
10. btn_badj_em, btn_barthag, btn_barthag_rank, btn_badj_em_rank, trn_tr_rating
11. rppfpre_rppf_preseason_rank, kpre_preseason_kadj_em_rank, kpre_preseason_kadj_d_rank, tr_hi, tr_lo
12. gm_elev_gain, gm_campus_elev, gm_pressure_drop, dv_campus_elev
13. btn_drebpct_rank, btn_op_orebpct_rank, btn_drebpct, btn_op_orebpct
14. em_kill_shots_conceded_per_game, em_kill_shots_conceded_per_game_rank, em_total_kill_shots_conceded, em_total_kill_shots_conceded_rank
15. shot_threes_fgpctd, shot_threes_fgpctd_rank, kb_3ptpctd, kb_3ptpctd_rank
16. kpre_preseason_kadj_o, rppfpre_preseason_rppf_rating, kpre_preseason_kadj_em, kpre_preseason_kadj_o_rank
17. btn_badj_t, btn_raw_t, btn_badjt_rank, btn_raw_t_rank
18. shot_threes_fgpct, shot_threes_fgpct_rank, kb_3ptpct, kb_3ptpct_rank
19. rppf_r_sos_rank, tr_sos_last, tr_sos_rank, conf_winpct
20. ts_q1and2_w, ts_q1_w, res_q1_plus_q2_w, res_q1_w
21. btn_2ptrd_rank, btn_3ptrd_rank, btn_3ptrd, btn_2ptrd
22. kb_exp, btn_exp, kb_exp_rank, btn_exp_rank
23. btn_2ptr, btn_3ptr, btn_2ptr_rank, btn_3ptr_rank
24. btn_eff_hgt_rank, btn_eff_hgt, kb_eff_hgt_rank, kb_eff_hgt
25. btn_avg_hgt_rank, kb_avg_hgt, kb_avg_hgt_rank, btn_avg_hgt
