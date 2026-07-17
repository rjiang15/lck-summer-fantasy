# Archived data

`full-season-2026-07-17/dev.db` is a complete SQLite snapshot taken before the
live database was reset for a clean week-by-week pipeline test.

Snapshot contents:

- 2 tournaments
- 185 matches
- 428 games
- 82 pro players
- 4,280 player-game stat rows
- all team stats, drafts, timeline checkpoints, ingestion audits, fantasy
  rosters, pickems, and Crystal Ball answers that existed at archive time

SHA-256:

`976e59ffa79e5bf7c4c181c6df932f6bdd2659699399ba456e89d5fdc4e85c37`

To inspect it without changing the live app:

```bash
sqlite3 archive/full-season-2026-07-17/dev.db
```

Do not copy it over `dev.db` while the application is running.
