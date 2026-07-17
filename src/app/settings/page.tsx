// Settings: backup (export/import) and a look at the data sources & scoring config.
import { getDemoLeague, parseScoring } from "@/lib/fantasy";
import { prisma } from "@/lib/db";
import ImportForm from "@/components/ImportForm";
import { startMockSeason } from "./actions";
import { requireCommish } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireCommish();
  const league = await getDemoLeague();
  const cfg = parseScoring(league?.scoringConfig);
  const tournaments = await prisma.tournament.findMany({ orderBy: { id: "asc" } });

  return (
    <>
      <h1>Settings</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Mock season</h2>
        <p className="small muted">
          Resets the league on the currently selected split: you + 3 bots, rosters
          auto-drafted, bots pre-fill their predictions, and Week 1 opens for play. Use the
          Commissioner page to lock, score, publish, and advance each week. Replaces the
          current league (export a backup first if you care about it).
        </p>
        <form action={startMockSeason}>
          <button type="submit">▶ Start mock season</button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Backup</h2>
        <p className="small muted">
          The backup contains the fantasy side only: league config, users, rosters,
          pickems, crystal ball, weekly roster snapshots, and published scores. Game data
          always re-ingests from the sources, so it isn&apos;t included. Importing replaces
          everything in the backup&apos;s scope.
        </p>
        <p>
          <a href="/api/export">⬇ Export backup (JSON)</a>
        </p>
        <ImportForm />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Ingested data</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Tournament</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="muted">
                    {t.id.startsWith("OE:") ? "Oracle's Elixir CSV" : "Leaguepedia API"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Leaguepedia schedule and result pulls are available from the <a href="/commissioner">Commissioner data pipeline</a>.
          Oracle&apos;s Elixir enrichment remains an optional advanced import: <code>npm run ingest:oe -- &lt;csv&gt; &quot;&lt;split&gt;&quot; --week=1</code>.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Scoring config (league: {league?.name ?? "none"})</h2>
        <p className="small muted">
          Stored as JSON on the league and editable on the Commissioner page until the
          first week is published. Published weekly scores remain immutable snapshots.
        </p>
        <pre className="card small" style={{ overflowX: "auto" }}>
          {JSON.stringify(cfg, null, 2)}
        </pre>
      </div>
    </>
  );
}
