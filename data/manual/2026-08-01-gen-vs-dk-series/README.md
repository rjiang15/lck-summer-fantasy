# GEN.G vs Dplus KIA provisional scoring report

This report is an exploratory scoring scenario, not published league data.

- Scoring configuration: default version 5
- Game 1: Riot source fields plus pixel-estimated XP difference at 15,
  linearly extrapolated final vision, and zero for every other missing category
- Game 2: complete Games of Legends archive
- Two-game contribution: arithmetic mean of the two game scores, matching the
  repository's points-per-game aggregation

The reviewed rows are also compiled into
`src/data/manual-series/2026-08-01-gen-dk.json`. The normal commissioner import
recognizes only this exact tournament/date/team/source-ID combination and
loads it instead of corrupt GoL game `80675`. Rebuild the deployable fixture
from these archives with `npm run fixture:gen-dk`.

| Team | Player | Role | Game 1 source-only | Game 1 provisional | Estimate delta | Game 2 GoL | Two-game PPG |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Gen.G | Kiin | top | 21.06 | 22.55 | 1.49 | 22.16 | 22.36 |
| Gen.G | Canyon | jungle | 6.33 | 5.33 | -1.00 | 9.70 | 7.52 |
| Gen.G | Chovy | mid | 15.43 | 15.89 | 0.46 | 13.51 | 14.70 |
| Gen.G | Ruler | bottom | -2.40 | -1.38 | 1.02 | 13.47 | 6.05 |
| Gen.G | Duro | support | 13.03 | 18.36 | 5.33 | 20.11 | 19.24 |
| Dplus KIA | Siwoo | top | -0.71 | 0.78 | 1.49 | 0.78 | 0.78 |
| Dplus KIA | Lucid | jungle | 38.97 | 44.57 | 5.60 | 35.61 | 40.09 |
| Dplus KIA | ShowMaker | mid | 27.78 | 30.56 | 2.78 | 25.50 | 28.03 |
| Dplus KIA | Smash | bottom | 35.35 | 36.78 | 1.43 | 19.66 | 28.22 |
| Dplus KIA | Career | support | 15.81 | 21.71 | 5.90 | 32.84 | 27.28 |

The source-only Game 1 column shows what the scorer produces when every missing
input is unavailable and therefore contributes zero. The provisional column
adds only the estimated vision and XP-at-15 inputs; tower damage and mitigation
remain explicit zeros. Full category breakdowns are in
`provisional-score-report.csv`.
