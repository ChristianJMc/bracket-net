# Upset watch backtest

Every season 2012–2026, each judged using only earlier seasons. Predictions: shipped base model.

## Does each idea improve the underdog chances?

| Adjustment | Log loss (lower is better) | vs model |
|---|---|---|
| model alone | 0.5481 | |
| signatures only | 0.5488 | worse by 0.0008 |
| lookalikes only | 0.5487 | worse by 0.0007 |
| both | 0.5502 | worse by 0.0022 |

In use for upset-watch reports: **none**.

## Where underdogs beat the model

| Games | Count | Model said underdogs win | Underdogs actually won |
|---|---|---|---|
| a signature fired | 167 | 34.6% | 40.7% |
| lookalikes beat the model by 8+ pts | 238 | 33.6% | 39.9% |
| neither | 597 | 25.6% | 24.5% |