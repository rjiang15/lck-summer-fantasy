# Provisional Game 1 scoring estimates

These values are commissioner-directed estimates for exploring fantasy scoring.
They are not Riot- or Games-of-Legends-reported statistics. The source archive
in `player-game-stats.csv` remains unchanged; all inferred and zero-filled values
live in `provisional-scoring-overrides.csv`.

## XP difference at 15

The copied 15:00 broadcast screenshot shows each player's current level and a
121-pixel purple XP bar. For each player, the filled segment was measured using
its color/chroma change point. Fractional level progress is:

`filled pixels / 121`

Estimated cumulative XP is:

`cumulative XP at current level + fractional progress × XP needed for next level`

The Summoner's Rift level thresholds used here are 3,180 cumulative XP at level
7, 6,120 at level 10, and 7,300 at level 11; the next-level requirements are
880, 1,180, and 1,280 respectively. XP difference is estimated player XP minus
the opposing laner's estimated XP, rounded to the nearest whole XP.

Ruler was dead at 15:00, so the observer overlay desaturated his rail. Its
change point remains detectable at crop-local x=55, but his XP estimate is
marked medium confidence. All other XP estimates are high-confidence pixel
measurements, with roughly one-pixel endpoint uncertainty.

## Final vision score

The 30:57 screenshot reports vision scores for all ten players. Each value is
scaled linearly from 1,857 seconds to the verified 1,986-second game duration:

`estimated final vision = round(vision at 30:57 × 1986 / 1857)`

This assumes each player's vision-score rate remained constant for the final
2:09. It is an explicit estimate, not an observed final value.

## Zero-filled categories

For this provisional scoring scenario, every other blank Game 1 field is set to
zero:

- absolute damage to champions;
- damage to towers;
- damage mitigated;
- total healing.

Of these, the current fantasy scorer uses damage to towers and damage mitigated.
It uses Riot's observed damage share rather than absolute champion damage, and
does not score healing. Existing source-reported fields—including KDA, CS, gold,
damage share, gold share, wards destroyed, the lower-bound observed control-ward
count, objectives, and derived multikills—remain in use.

The scoring report uses the repository's default scoring version 5. Game 1 is
scored with these overrides; Game 2 is scored from the complete GoL archive.
The resulting per-category and two-game scores are stored in
`../2026-08-01-gen-vs-dk-series/provisional-score-report.csv`.

## Evidence hashes

- `evidence/broadcast-15-00.png`: `ed1cb7998823219c1475d58a0caed0faee150426c1416029440f7f4e1d4e7da8`
- `evidence/broadcast-30-57.png`: `ec05dc461867dc5a5556691312945e4031770fe352a4b6ff4f341411a1e3c895`
