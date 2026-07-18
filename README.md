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

## Weekly season workflow

`currentWeek` means the week completed through, not the prediction target.
Therefore Week 0 is preseason and always accepts predictions for Week 1; after
Week 1 is published, the league advances to Week 1 and accepts Week 2 picks.

1. During Week 0, use **Get Week 1 schedule + players**. Participants join,
   create rosters, submit season-long Crystal Ball answers, and predict Week 1.
2. Lock Week 1 before play. This locks picks, snapshots every roster, and locks
   Crystal Ball for the whole season.
3. After Week 1, use **Get Week 1 results** and optionally run the matching
   Oracle's Elixir enrichment.
4. On `/commissioner`, run **Validate + score**, then publish. Public standings
   read only this immutable published snapshot; the league is now at Week 1.
5. Get the Week 2 schedule from the Commissioner UI. It opens automatically for roster changes
   and Week 2 pickems. Repeat the same cycle for every following week.
6. After the last imported week is published, explicitly finish the season in
   the Commissioner UI to settle Crystal Ball points.

The pre-reset populated database is preserved under
`archive/full-season-2026-07-17/dev.db`. `npm run season:reset` clears live LCK
and fantasy-play state while preserving accounts, memberships, scoring config,
and Crystal Ball questions; archive first before running it again.

Run `npm run season:init` once for a league created before lifecycle tracking was
added. Scoring settings can change only before the first published week.

Authentication uses hashed passwords, opaque database-backed sessions, and
HTTP-only cookies. Every server mutation checks both identity and league role.

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
