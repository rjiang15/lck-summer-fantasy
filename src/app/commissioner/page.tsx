import Link from "next/link";
import { requireLeagueManager } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { finishSeason, fetchNextWeekResults, fetchNextWeekSchedule, gradeCrystalBall, lockWeek, openWeek, publishWeek, updateScoringConfig, validateAndScoreWeek } from "./actions";
import { IngestButton } from "./IngestButton";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

export default async function CommissionerPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const access = await requireLeagueManager();
  const feedback = await searchParams;
  const league = await prisma.league.findUnique({ where: { id: access.league.id }, include: { cbQuestions: true } });
  if (!league) return <p>No league exists.</p>;
  const weeks = await prisma.leagueWeek.findMany({
    where: { leagueId: league.id },
    orderBy: { week: { number: "asc" } },
    include: { week: true, weeklyScores: true },
  });
  const runs = await prisma.ingestionRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 });
  const targetWeek = league.currentWeek + 1;
  const target = weeks.find((week) => week.week.number === targetWeek);
  const importRunning = runs.some(
    (run) => run.tournamentId === league.tournamentId && run.weekNumber === targetWeek && run.status === "RUNNING",
  );
  const scheduleAllowed =
    league.seasonStatus !== "FINAL" && (!target || ["UPCOMING", "OPEN"].includes(target.status));
  const resultsAllowed =
    league.seasonStatus !== "FINAL" && !!target && ["LOCKED", "RESULTS_IMPORTED"].includes(target.status);
  return (
    <>
      <h1>Commissioner — {league.name}</h1>
      {feedback.notice && <p className="notice card">{feedback.notice}</p>}
      {feedback.error && <p className="error card">Import failed: {feedback.error}</p>}
      <p>
        Season: <span className="badge pending">{league.seasonStatus}</span>{" "}
        Current week: <b>{league.currentWeek}{league.currentWeek === 0 ? " (preseason)" : ""}</b>{" · "}
        Picks for: <b>{weeks.find((week) => week.status === "OPEN")?.week.number ?? "none"}</b>{" · "}
        Crystal Ball: <b>{league.crystalBallLockedAt ? "locked" : "open"}</b>
      </p>
      <p>{league.currentWeek === 0 && league.seasonStatus === "PRESEASON" ? <Link href="/commissioner/draft">Run the Week 0 roster draft →</Link> : <Link href="/commissioner/rosters">Manage future rosters →</Link>}</p>
      <section className="card stack">
        <div>
          <h2 style={{ margin: 0 }}>Week {targetWeek} data pipeline</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Imports are restricted to the next unpublished week. Fetch the slate first; after everyone submits and you lock picks and rosters, fetch the completed results.
          </p>
        </div>
        <div className="inline-form">
          {scheduleAllowed ? (
            <form action={fetchNextWeekSchedule}>
              <input type="hidden" name="leagueId" value={league.id} />
              <IngestButton
                disabled={importRunning}
                label={target ? `Refresh Week ${targetWeek} schedule + players` : `Get Week ${targetWeek} schedule + players`}
              />
            </form>
          ) : (
            <span className="muted small">Week {targetWeek} schedule is locked.</span>
          )}
          {resultsAllowed && (
            <form action={fetchNextWeekResults}>
              <input type="hidden" name="leagueId" value={league.id} />
              <IngestButton
                disabled={importRunning}
                label={target?.status === "RESULTS_IMPORTED" ? `Refresh Week ${targetWeek} results` : `Get Week ${targetWeek} results`}
              />
            </form>
          )}
          {importRunning && <span className="muted small">An import is already running. Reload this page for its latest status.</span>}
          {target?.status === "OPEN" && <span className="muted small">Lock picks and rosters before results can be fetched.</span>}
          {!target && <span className="muted small">No Week {targetWeek} slate has been fetched yet.</span>}
        </div>
      </section>
      {league.currentWeek === 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Week 0 checklist</h2>
          <ol>
            <li>Use the data-pipeline button above to pull the Week 1 slate and preseason player pool without results.</li>
            <li>Set the snake order and complete all 10 roster picks per participant in the <Link href="/commissioner/draft">Week 0 draft</Link>.</li>
            <li>Submit Week 1 pickems, then lock Week 1 before play begins.</li>
          </ol>
        </section>
      )}
      {weeks.length === 0 && (
        <p className="muted">No weekly slate has been imported yet. The schedule button above creates and opens it automatically.</p>
      )}
      <div className="tablewrap">
        <table>
          <thead><tr><th>Week</th><th>Status</th><th>Checks</th><th>Action</th></tr></thead>
          <tbody>
            {weeks.map((lw) => (
              <tr key={lw.id}>
                <td>{lw.week.number}</td>
                <td><span className="badge pending">{lw.status}</span></td>
                <td className={lw.validationError ? "error small" : "muted small"}>
                  {lw.validationError ?? (lw.validationJson ? "data validated" : "not validated")}
                </td>
                <td>
                  {lw.status === "UPCOMING" && <Action action={openWeek} id={lw.id} label="Open picks" />}
                  {lw.status === "OPEN" && <Action action={lockWeek} id={lw.id} label="Lock picks + rosters" />}
                  {lw.status === "LOCKED" && <span className="muted small">fetch results above</span>}
                  {lw.status === "RESULTS_IMPORTED" && <Action action={validateAndScoreWeek} id={lw.id} label="Validate + score" />}
                  {lw.status === "SCORED" && <Action action={publishWeek} id={lw.id} label="Publish + open next" />}
                  {lw.status === "PUBLISHED" && <span className="muted small">published</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {league.currentWeek > 0 && league.seasonStatus !== "FINAL" && weeks.length > 0 && weeks.every((week) => week.status === "PUBLISHED") && (
        <form action={finishSeason} className="card">
          <input type="hidden" name="leagueId" value={league.id} />
          <button type="submit">Finish season and settle Crystal Ball</button>
        </form>
      )}
      <h2>Ingestion audit</h2>
      {runs.length === 0 ? <p className="muted">New imports will be recorded here.</p> : (
        <div className="tablewrap"><table><thead><tr><th>Started</th><th>Source</th><th>Week</th><th>Status</th><th>Summary</th></tr></thead><tbody>
          {runs.map((run) => <tr key={run.id}><td>{run.startedAt.toLocaleString()}</td><td>{run.source}</td><td>{run.weekNumber ?? "all"}</td><td>{run.status}</td><td className="small">{run.error ?? run.summary ?? ""}</td></tr>)}
        </tbody></table></div>
      )}
      <h2>Scoring configuration</h2>
      <form action={updateScoringConfig} className="stack card">
        <input type="hidden" name="leagueId" value={league.id} />
        <textarea name="scoringConfig" rows={14} defaultValue={JSON.stringify(JSON.parse(league.scoringConfig), null, 2)} />
        <button type="submit">Save scoring configuration</button>
        <span className="muted small">Locks permanently after the first published week.</span>
      </form>
      <h2>Crystal Ball grading</h2>
      <div className="grid2">
        {league.cbQuestions.map((question) => <form action={gradeCrystalBall} className="card stack" key={question.id}>
          <b>{question.prompt}</b><input type="hidden" name="questionId" value={question.id} />
          <label>Correct answer <input name="correctAnswer" defaultValue={question.correctAnswer ?? ""} required /></label>
          <label>Partial-credit answers (comma separated) <input name="partialAnswers" defaultValue={question.partialAnswers ? (JSON.parse(question.partialAnswers) as string[]).join(", ") : ""} /></label>
          <button type="submit">Save grading</button>
        </form>)}
      </div>
    </>
  );
}

function Action({ action, id, label }: { action: (data: FormData) => Promise<void>; id: number; label: string }) {
  return <form action={action}><input type="hidden" name="leagueWeekId" value={id} /><button type="submit">{label}</button></form>;
}
