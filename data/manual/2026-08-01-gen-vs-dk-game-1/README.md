# Gen.G vs Dplus KIA — Game 1 Riot live-stats archive

This directory is a local snapshot of Riot's public live-stats feeds for the
missing first game of the August 1, 2026 LCK Rounds 3-4 series.

- Riot esports game ID: `115548147900553474`
- Riot esports match ID: `115548147900553473`
- Patch: `16.14.794.9266`
- Result: Dplus KIA defeated Gen.G, 21 kills to 14
- Calibrated duration: 33:06
- Feed range requested: `2026-08-01T11:10:10Z` through
  `2026-08-01T11:44:00Z`, at every supported ten-second starting time
- Archive coverage: 204 window responses, 204 details responses, and 8,928
  unique frames from each feed

## Files

| File | Contents |
| --- | --- |
| `player-game-stats.csv` | One final row per player, including KDA, CS, gold, shares, wards, items, runes, level-15 lane comparisons, and derived event fields |
| `team-game-stats.csv` | Final team totals and objective counts |
| `player-minute-snapshots.csv` | One row per player at each available game-minute boundary |
| `player-timeline.csv` | All 89,280 player-frame rows retained from the de-duplicated window feed |
| `kill-events.csv` | The 35 player kill-counter increases, with calibrated game times |
| `multikill-clusters.csv` | Derived consecutive-kill clusters: two Chovy doubles and one Smash triple |
| `objective-events.csv` | Timestamped Riot objective-counter increases |
| `control-ward-purchase-events.csv` | Item `2055` inventory increases; a lower-bound estimate, not an exact shop log |
| `riot-window-responses.json.gz` | All 204 raw Riot window endpoint responses |
| `riot-details-responses.json.gz` | All 204 raw Riot details endpoint responses |
| `archive-metadata.json` | Provenance, coverage counts, SHA-256 hashes, and caveats |
| `evidence/broadcast-15-00.png` | Broadcast evidence used for the provisional XP-bar estimates |
| `evidence/broadcast-30-57.png` | Broadcast evidence used for the provisional vision estimates |
| `provisional-scoring-overrides.csv` | Pixel-derived XP differences, linearly extrapolated vision, and explicit zero overrides |
| `provisional-scoring-notes.md` | Estimation method, assumptions, confidence, and scoring treatment |

The verified Game 1 bans and pick phases used by the deployable reconciliation
come from the [post-match record](https://www.reddit.com/r/leagueoflegends/comments/1vcm8sk/geng_vs_dplus_kia_lck_2026_season_rounds_34/):
Gen.G banned Vi, Jayce, Orianna, Ryze, and Ziggs; Dplus KIA banned Nocturne,
Poppy, Galio, Ezreal, and Vayne. GoL game `80675` is not used for draft data.

The raw archives can be inspected without deleting or replacing them:

```sh
gzip -dc riot-window-responses.json.gz
gzip -dc riot-details-responses.json.gz
```

## Provenance and confidence

Direct Riot fields include player identity, champion, final level, KDA, CS,
gold, team objectives exposed by the feed, wards placed/destroyed, items,
runes, ability order, combat attributes, kill participation, and champion
damage **share**. The complete frame history also supports the minute snapshots
and 15-minute CS/gold comparisons.

Derived fields are explicitly labeled in their column names or confidence
columns. Multikills are reconstructed from consecutive kill-counter increases
no more than ten seconds apart. Control-ward purchases are a lower bound based
on increases in the visible inventory count of item `2055`. Herald and void-grub
totals are supplemental post-match-table values because Riot's window schema
does not expose them.

Riot's feeds do not expose absolute damage to champions, XP, vision score,
damage to towers, damage mitigated, or healing here. Those columns are left
blank rather than estimated. A checked OP.GG response was not used because its
team kill totals disagreed with its own player rows and its damage, gold, ward,
and multikill fields were zero.

## Provisional scoring scenario

The source CSV above intentionally retains those blank fields. A separate,
commissioner-directed scenario estimates XP difference at 15 from broadcast XP
bar pixels, extrapolates final vision score from the 30:57 broadcast overlay,
and treats every other missing category as zero. See
`provisional-scoring-notes.md`; these estimates must not be treated as source
truth or silently merged into the Riot archive.

The game-clock zero was calibrated from the 33:06 post-match duration and
cross-checked against the broadcast scoreboard at exactly 15:00. A third-party
result screenshot showing 32:19 was inconsistent with that verified frame and
was not used for timing.

## Recreating the archive

Run the repository exporter while Riot's endpoints remain available:

```sh
node src/scripts/archive-riot-livestats.mjs
```

It rewrites this directory from fresh feed responses and regenerates the
metadata hashes.

After regenerating either source archive, rebuild the statically imported
commissioner fixture with `npm run fixture:gen-dk`.
