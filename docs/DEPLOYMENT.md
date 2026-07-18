# Free Vercel + Neon deployment

The application intentionally supports two database runtimes:

- local development uses the existing SQLite `dev.db`;
- Vercel production and previews use Neon PostgreSQL.

The PostgreSQL schema mirrors the canonical SQLite schema. CI and
`npm run deploy:check` fail if their model blocks differ.

## 1. Create isolated Neon databases

Create a Neon Free project. Use its primary branch only for production. Create
a second branch for Vercel Preview deployments so preview forms, draft actions,
and tests can never mutate the real league.

Neon provides two useful connection strings:

- pooled: set this as Vercel's `DATABASE_URL` runtime variable;
- direct: use this locally as `POSTGRES_DIRECT_URL` for Prisma migrations and
  the one-time SQLite copy.

Never prefix either variable with `NEXT_PUBLIC_`, commit it, paste it into chat,
or place it in a command that will be committed to shell history. Put the direct
URL in a temporary ignored `.env.local`, then remove it after cutover.

## 2. Deploy the empty PostgreSQL schema

With `POSTGRES_DIRECT_URL` available locally:

```bash
npm run db:postgres:deploy
npm run db:postgres:status
```

The checked-in PostgreSQL history starts with a provider-native initial
migration. The old SQLite migrations remain unchanged for local development.

## 3. Plan and copy data

First inspect the exact source row counts without connecting to Neon:

```bash
npm run db:migrate:plan
```

For the real launch, copy only the LCK catalog, schedules, games, players, raw
stats, timelines, drafts, provenance, and ingestion audit:

```bash
npm run db:migrate:catalog
npm run db:migrate:verify
```

`catalog` mode deliberately excludes users, password hashes, sessions, leagues,
fantasy teams, rosters, pickems, Crystal Ball answers, and scores. Production
therefore starts clean while preserving all LCK research data.

`npm run db:migrate:all` exists for an intentional staging clone. Do not use it
for production unless retaining every local account and test league is desired.

Safety properties of the copy:

- requires an explicit confirmation token;
- refuses a target where any selected application table already has rows;
- serializes copy attempts with a PostgreSQL transaction lock;
- copies in foreign-key order within one transaction;
- rolls the whole copy back on any failure;
- resets PostgreSQL autoincrement sequences;
- verifies every table count during the copy;
- provides a separate deterministic SHA-256 content verification afterward.

Keep an untouched copy of `dev.db` until the production season has been smoke
tested. The migration never writes to SQLite.

## 4. Configure Vercel environments

Connect the GitHub repository to a Vercel Hobby project. Configure environment
variables separately:

| Variable | Production | Preview |
| --- | --- | --- |
| `DATABASE_URL` | Neon production pooled URL | Neon preview pooled URL |
| `LP_BOT_USERNAME` | rotated bot username | optional test bot username |
| `LP_BOT_PASSWORD` | rotated bot password | optional test bot password |

Do not add `POSTGRES_DIRECT_URL` to the application unless a controlled
migration job specifically needs it. The web runtime only needs the pooled URL.

The build gate refuses a Vercel production deployment backed by SQLite or one
missing Leaguepedia credentials. `/api/health` returns HTTP 200 only when the
application can query its database.

## 5. Release workflow after launch

1. Develop locally against SQLite or the Neon preview branch.
2. Push a feature branch and use Vercel's preview URL.
3. Run CI and smoke-test the preview database.
4. Apply a reviewed, backward-compatible production migration when required.
5. Merge to `main`; Vercel updates the stable production URL.

Application rollback does not automatically reverse a database migration.
Prefer additive migrations (new nullable columns/tables), deploy compatible app
code, backfill data, and remove old fields only in a later release.

League checkpoints are an application-level recovery feature, not a substitute
for Neon database backups. They deliberately preserve fantasy-league state but
reference the shared tournament catalog and existing user accounts. Apply the
`LeagueBackup` migration before deploying app code that renders `/settings` or
`/leagues`.

## Future schema changes

Edit `prisma/schema.prisma` first, then run:

```bash
npm run db:postgres:schema:sync
npm run prisma:generate
npm test
```

Create the corresponding SQLite and PostgreSQL migration files in their own
migration directories. Never edit a migration already applied to production.
