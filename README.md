# LCK Fantasy

A local-first LCK fantasy league built with Next.js 16 and Prisma 7. Local development uses SQLite; the prepared Vercel deployment uses Neon PostgreSQL. It imports professional match data, computes fantasy standings from raw game lines, supports weekly historical replay, and includes player, champion-draft, and team-macro analytics.

## Run locally

```bash
npm install
npx prisma migrate dev
npm run dev
```

`DATABASE_URL` defaults to `file:./dev.db`. Put optional Leaguepedia bot credentials in `.env` as `LP_BOT_USERNAME` and `LP_BOT_PASSWORD` to avoid the strict anonymous API limit.

## Deployment preparation

The repository includes a provider-native PostgreSQL schema, a guarded
SQLite-to-PostgreSQL copier, content verification, Vercel environment checks,
and CI. Local SQLite continues to work during the migration. Follow
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) after creating the free Neon and Vercel
accounts.

## Data ingestion

Leaguepedia is the primary source. Commissioners normally use the **Get Week X
schedule + players** and **Get Week X results** buttons on `/commissioner`.
The equivalent maintenance commands are:

```bash
# Before predictions: roster pool + schedule, deliberately excluding results
npm run ingest -- "LCK/2026 Season/Rounds 1-2" --week=1 --schedule-only

# After that week is played and picks are locked: complete results and stats
npm run ingest -- "LCK/2026 Season/Rounds 1-2" --week=1

# While a locked week is underway: import only newly completed/changed rows
npm run ingest -- "LCK/2026 Season/Rounds 3-4" --week=1 --live
```

The schedule-only pull imports tournament roster membership before any games
exist and strips any historical results from the schedule. The full pull adds
games, end-game scoreboards, builds, runes, pentakills, patches, typed
objectives, and ordered champion picks/bans.

Oracle's Elixir enriches the same canonical Leaguepedia games (it does not
create a duplicate tournament):

```bash
npm run ingest:oe -- /path/to/match-data.csv "Rounds 1-2" --week=3
```

When present in the CSV, it additionally imports multikills, first objectives, warding, damage/gold shares, and player/team snapshots at 10, 15, 20, and 25 minutes. Every source row is also retained as JSON so newly added source columns are not lost.

Both commands create an `IngestionRun` audit record. Per-game provenance records
which fields came from Leaguepedia and which were enriched by Oracle's Elixir.
Unmatched OE games are reported and never inserted as duplicate games.

Live refreshes are change-aware: existing source rows are compared before an
update is issued, unchanged rows and provenance timestamps are left alone, and
the audit summary reports created, updated, and skipped counts. They expose
completed games, locked pick&apos;ems, provisional roster/pick&apos;em totals, and the
running Crystal Ball answer-key preview without advancing the week, persisting
`WeeklyScore`, or settling Crystal Ball.

## Weekly season workflow

`currentWeek` means the week completed through, not the prediction target.
Therefore Week 0 is preseason and always accepts predictions for Week 1; after
Week 1 is published, the league advances to Week 1 and accepts Week 2 picks.

1. During Week 0, use **Get Week 1 schedule + players**. Participants join,
   create rosters, submit season-long Crystal Ball answers, and predict Week 1.
2. Lock Week 1 before play. This locks picks, snapshots every roster, and locks
   Crystal Ball for the whole season.
3. During Week 1, use **Refresh in-progress Week 1** after each series or day.
   The button is safe to repeat because unchanged source rows are skipped.
4. After Week 1 ends, refresh until every Leaguepedia scoreboard is present,
   run the matching Oracle's Elixir enrichment, then use **Finalize complete
   Week 1 results**. Final validation blocks scoring when advanced v5 inputs
   are still missing.
5. On `/commissioner`, run **Validate + score**, then publish. Public standings
   read only this immutable published snapshot; the league is now at Week 1.
6. Get the Week 2 schedule from the Commissioner UI. It opens automatically for roster changes
   and Week 2 pickems. Repeat the same cycle for every following week.
7. After the last imported week is published, explicitly finish the season in
   the Commissioner UI to settle Crystal Ball points.

If a frozen starter records zero games while a same-team, same-role substitute
plays, the roster slot receives the lower of (a) that professional team&apos;s
weekly player-line average and (b) the substitute&apos;s own PPG. The participant
roster page shows the detected substitute, both inputs, and the awarded value.
This applies automatically to cases such as Frog playing DRX Top or Fenir
playing KT Bot; no player-specific exception is hard-coded.

The pre-reset populated database is preserved under
`archive/full-season-2026-07-17/dev.db`. `npm run season:reset` clears live LCK
and fantasy-play state while preserving accounts, memberships, scoring config,
and Crystal Ball questions; archive first before running it again.

Run `npm run season:init` once for a league created before lifecycle tracking was
added. Scoring settings can change only before the first published week.

Authentication uses hashed passwords, opaque database-backed sessions, and
HTTP-only cookies. Every server mutation checks both identity and league role.

## R3-4 roster draft

LCK 2026 Rounds 3-4 uses the split's two competitive groups. Every fantasy
team drafts exactly one Top, Jungle, Mid, Bot, and Support from **Legends**
(T1, HLE, Gen.G, KT, and Dplus Kia), plus the same five roles from **Rise**
(HANJIN BRION, KRX, BNK FEARX, Nongshim RedForce, and DN SOOPers).

Before the first pick, the commissioner chooses uniform $1,000 pricing or
dynamic pricing derived from Rounds 1-2 fantasy points per game. Dynamic prices
average exactly $1,000 across the eligible R3-4 pool, use a $200 standard
deviation with $25 increments, are bounded to $600-$1,400, and assign new or
no-history players the rounded average price for their group and role. The calculated sheet is frozen
when the draft starts and is included in league checkpoints and exports.

Every pick is checked for the required group/role slot, the hard draft budget,
and the league-wide player pool. Before starting, the commissioner can also
enable the budget-reserve safeguard, which blocks a purchase that would leave
the current team unable to afford a safe completion of its remaining slots.
The hard budget and structural safeguards cannot be disabled. The live board
supports card and group-colored table views with shared group, role, and
"draftable only" filters. Players who share the same professional team and role
are explicitly marked. If a drafted player records zero games in a week, their
roster credit is the lower of that team-role substitute's fantasy points per
game and the professional team's player-line average for the week; if no
same-role teammate plays, the credit remains zero. Published weekly score
snapshots preserve both the credit and its audit details.

The July 30 Aiming/Jiwoo trade has one commissioner-approved exception, scoped
to this R3-4 tournament and the exact fantasy owner/player pairs. PerpetualOwl
(Howard) retains Aiming as his signed Legends ADC after Aiming moves to KRX,
and Ryan's signed Rise ADC changes from LazyFeel to Jiwoo after Jiwoo moves to
KT. Starting July 30, a zero-game Aiming uses KRX's Bot substitute fallback and
a zero-game Jiwoo uses KT's Bot substitute fallback. Current and future roster
views resolve Ryan's former LazyFeel slot to Jiwoo; earlier match lines retain
the prior assignment, and existing published score snapshots are never rewritten.

Leaguepedia roster omissions needed for drafting are kept in a small,
idempotent tournament override list. `npm run roster:sync` applies those
overrides to local SQLite, while `npm run roster:sync:postgres` applies them to
the configured PostgreSQL database. Re-run
the real-data three-participant greedy snake check with:

```bash
npm run test:draft-pricing
```

For dynamic pricing, the draft budget is calculated from the frozen price sheet
and participant count. It uses the smallest completion-safe amount rounded up
to the next $1,000 while remaining below the price of the most expensive player
in every required slot. The current R3-4 pool supports at most five fantasy
teams because Legends has five eligible players at its scarcest role. League
owners can remove a participant and their unscored preseason entries from
Settings during Week 0 before the initial draft begins; accounts and shared LCK
data are never deleted.

## League checkpoints and recovery

Commissioners can save named checkpoints from `/settings`; league owners can
also download the current state as JSON, import a compatible JSON backup, roll
the active league back to a checkpoint, or delete the league. Every file import
and rollback first creates an automatic safety checkpoint. League deletion is
atomic: the database saves a final recovery point before it removes the live
league, so a failed snapshot prevents the deletion.

Deleted-league checkpoints appear on `/leagues`. The owner can restore one as a
new league with a new invite code, download it for offline storage, or
permanently purge it. Checkpoints include memberships, teams, rosters, draft
history, pickems, Crystal Ball state, weekly lifecycle records, frozen roster
history, scores, and their audit timestamps. Shared LCK catalog/game data and
user accounts are referenced rather than duplicated, and new exports never
contain password hashes.

For full event and per-minute timelines, provide a Riot-style timeline with an explicit participant mapping:

```bash
npm run ingest:timeline -- "<database-game-id>" /path/to/timeline.json
```

The accepted envelope is:

```json
{
  "timeline": { "info": { "frames": [] } },
  "participants": [
    {
      "participantId": 1,
      "riotTeamId": 100,
      "playerId": "Zeus",
      "teamId": "T1"
    }
  ]
}
```

This populates normalized events and player/team timeline snapshots while retaining each complete raw event payload.

After migrating an existing database, recompute every statistic that can be derived from its old scoreboards:

```bash
npm run backfill:stats
```

This derived-data backfill repairs team totals, KP, damage/gold share, and
reconstructed draft picks. It cannot invent lane-at-15, tower damage, damage
mitigation, warding, or multikill data that the stored Leaguepedia rows never
contained. Run `npm run ingest:oe -- <csv> "<split>" [tournament-id]
--week=N` against the matching Oracle's Elixir CSV to backfill those source
metrics. The deep-stats page reports coverage explicitly and leaves an advanced
score component blank until all of that player's games have the required input.

## Statistics model

- Player game lines: champion, role, side, K/D/A, CS, gold, damage, objectives damage, damage taken/mitigated, healing, vision, wards, multikills, first blood involvement, builds, spells, and runes.
- Team game lines: side, kills/deaths, gold, towers/plates, every dragon type, Elder, Baron, Herald, Void Grubs, Atakhan, inhibitors, and first-objective flags.
- Draft actions: normalized picks and bans with side-local order and pick role/player where available.
- Timeline snapshots: arbitrary minute checkpoints for players and teams, including CS/gold/XP differentials.
- Game events: timestamped kills, objectives, buildings, positions, participants, and complete source payloads.

The `/stats` page aggregates player performance, champion presence, and team macro. Game pages show drafts, opponent differentials, advanced scoreboards, checkpoints, and event coverage.

## Other commands

```bash
npm run report
npm run lint
npm run build
npx tsx src/scripts/seed-demo.ts
npx tsx src/scripts/backup.ts export
```
