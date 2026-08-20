# Gen.G vs Dplus KIA — Game 2 Games of Legends archive

This directory is a local snapshot of Games of Legends game `80676`, the
second game of the August 1, 2026 LCK Rounds 3-4 series.

- Result: Dplus KIA defeated Gen.G, 7 kills to 2
- Duration: 28:46
- Patch: 16.14
- GoL game ID: `80676`
- Important: GoL game `80675` is the known-corrupted Game 1 record and is not
  copied or used here.

## Files

| File | Contents |
| --- | --- |
| `player-game-stats.csv` | Ten final player rows with KDA, CS, gold, vision, damage, lane differences, and other GoL all-stats fields |
| `team-game-stats.csv` | Final team result, exact gold, towers, inhibitors, objectives, and first-objective flags |
| `draft-actions.csv` | Five bans and five picks per team |
| `timeline-events.csv` | GoL's timestamped kill, objective, turret, plate, inhibitor, and nexus events |
| `player-minute-gold-cs.csv` | The ten per-player gold and CS graph series, including the final 28:46 sample |
| `player-builds.json` | Final items, summoners, runes, skill order, spell casts, and item purchase/destroy/sell/undo events for all ten players |
| `gol-*.html.gz` | Raw GoL overview, all-stats, timeline, and builds pages |
| `archive-metadata.json` | Source URLs, counts, hashes, corrections, and caveats |

## Source notes

GoL's final-stat table is complete for this game and includes fields that Riot's
Game 1 live feed does not expose, including absolute champion damage, vision
score, XP difference at 15, damage to turrets, damage mitigated, damage taken,
and healing. The timeline is less granular than the Riot archive: its graph has
gold and CS at minute boundaries, while its event table records discrete game
events.

Siwoo's champion is normalized to `KSante`. GoL's raw full-stats HTML contains
an unescaped apostrophe in `alt='K'Sante'`; the draft, image filename, builds
button, and player row all independently identify the champion.

After regenerating this archive, rebuild the statically imported commissioner
fixture with `npm run fixture:gen-dk`.
