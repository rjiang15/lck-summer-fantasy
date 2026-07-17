import Link from "next/link";
import { requireLeagueManager } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decodeIngestionProgress } from "@/lib/ingestion-progress";
import {
  finishSeason,
  fetchNextWeekResults,
  fetchNextWeekSchedule,
  gradeCrystalBall,
  lockPicks,
  lockRosters,
  openWeek,
  publishWeek,
  unlockPicks,
  unlockRosters,
  updateScoringConfig,
  validateAndScoreWeek,
} from "./actions";
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
  const runs = await prisma.ingestionRun.findMany({
    where: { tournamentId: league.tournamentId },
    orderBy: { startedAt: "desc" },
    take: 10,
  });
  const targetWeek = league.currentWeek + 1;
  const target = weeks.find((week) => week.week.number === targetWeek);
  const fantasyTeams = await prisma.fantasyTeam.findMany({
    where: { leagueId: league.id },
    include: { user: true },
    orderBy: { id: "asc" },
  });
  const targetMatchCount = target ? await prisma.match.count({ where: { weekId: target.weekId } }) : 0;
  const submittedPicks = target ? await prisma.pickem.findMany({
    where: { leagueId: league.id, match: { weekId: target.weekId } },
    select: { userId: true },
  }) : [];
  const submittedByUser = submittedPicks.reduce((counts, pick) => {
    counts.set(pick.userId, (counts.get(pick.userId) ?? 0) + 1);
    return counts;
  }, new Map<number, number>());
  const importRunning = runs.some(
    (run) => run.tournamentId === league.tournamentId && run.weekNumber === targetWeek && run.status === "RUNNING",
  );
  const scheduleRunning = runs.some(
    (run) => run.tournamentId === league.tournamentId && run.weekNumber === targetWeek && run.source === "LEAGUEPEDIA_SCHEDULE" && run.status === "RUNNING",
  );
  const resultsRunning = runs.some(
    (run) => run.tournamentId === league.tournamentId && run.weekNumber === targetWeek && run.source === "LEAGUEPEDIA" && run.status === "RUNNING",
  );
  const scheduleAllowed = league.seasonStatus !== "FINAL" && (
    !target || target.status === "UPCOMING" || (target.status === "OPEN" && !target.picksLockedAt)
  );
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
        Picks for: <b>{target ? target.week.number : "none"}</b>{" · "}
        Crystal Ball: <b>{league.crystalBallLockedAt ? "locked" : "open"}</b>{" · "}
        Roster editing: <b>{league.rostersLockedAt ? "locked" : "open"}</b>
      </p>
      <p>{league.currentWeek === 0 && league.seasonStatus === "PRESEASON" ? <Link href="/commissioner/draft">Run the Week 0 roster draft →</Link> : <Link href="/commissioner/rosters">Manage future rosters →</Link>}</p>
      <section className="card stack">
        <div>
          <h2 style={{ margin: 0 }}>Roster editing</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>
            This league-wide switch is independent of weekly pick locks. Unlocking allows current-roster changes; every already locked week keeps its frozen roster and scores.
          </p>
        </div>
        <div className="lock-control">
          <span className={`badge ${league.rostersLockedAt ? "loss" : "win"}`}>{league.rostersLockedAt ? "LOCKED" : "OPEN"}</span>
          <LeagueAction action={league.rostersLockedAt ? unlockRosters : lockRosters} leagueId={league.id} label={`${league.rostersLockedAt ? "Unlock" : "Lock"} roster editing`} />
          {league.currentWeek > 0 && <Link href="/commissioner/rosters">Manage current rosters →</Link>}
        </div>
      </section>
      <section className="card stack">
        <div>
          <h2 style={{ margin: 0 }}>Week {targetWeek} data pipeline</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Imports are restricted to the next unpublished week. Fetch the slate first; locking picks also freezes that week&apos;s roster snapshot, then completed results can be fetched.
          </p>
        </div>
        <div className="inline-form">
          {scheduleAllowed ? (
            <form action={fetchNextWeekSchedule}>
              <input type="hidden" name="leagueId" value={league.id} />
              <IngestButton
                disabled={importRunning}
                running={scheduleRunning}
                leagueId={league.id}
                weekNumber={targetWeek}
                source="LEAGUEPEDIA_SCHEDULE"
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
                running={resultsRunning}
                leagueId={league.id}
                weekNumber={targetWeek}
                source="LEAGUEPEDIA"
                label={target?.status === "RESULTS_IMPORTED" ? `Refresh Week ${targetWeek} results` : `Get Week ${targetWeek} results`}
              />
            </form>
          )}
          {importRunning && <span className="muted small">An import is already running. Reload this page for its latest status.</span>}
          {target?.status === "OPEN" && <span className="muted small">Lock picks to freeze predictions and the scoring roster before results can be fetched.</span>}
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
      {target && targetMatchCount > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Week {target.week.number} pick&apos;em progress</h2>
          <p className="muted small">Only completion counts are shown here. Everyone&apos;s actual selections stay private until you lock the picks.</p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Participant</th><th>Fantasy team</th><th>Completion</th></tr></thead>
              <tbody>
                {fantasyTeams.map((team) => {
                  const submitted = submittedByUser.get(team.userId) ?? 0;
                  const complete = submitted === targetMatchCount;
                  return <tr key={team.id}>
                    <td>{team.user.username}</td>
                    <td>{team.name}</td>
                    <td><span className={`submission-status ${complete ? "complete" : "incomplete"}`}>{submitted} / {targetMatchCount} — {complete ? "complete" : "incomplete"}</span></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="tablewrap">
        <table>
          <thead><tr><th>Week</th><th>Data status</th><th>Pick&apos;ems</th><th>Scoring roster</th><th>Checks / next step</th></tr></thead>
          <tbody>
            {weeks.map((lw) => (
              <tr key={lw.id}>
                <td>{lw.week.number}</td>
                <td><span className="badge pending">{lw.status}</span></td>
                <td>
                  <LockControl
                    available={lw.status !== "UPCOMING"}
                    locked={Boolean(lw.picksLockedAt)}
                    canChange={["OPEN", "LOCKED"].includes(lw.status)}
                    lockAction={lockPicks}
                    unlockAction={unlockPicks}
                    id={lw.id}
                    noun="picks"
                  />
                </td>
                <td>
                  <span className={`badge ${lw.rosterLockedAt ? "pending" : "win"}`}>{lw.rosterLockedAt ? "FROZEN" : "NOT FROZEN"}</span>
                </td>
                <td>
                  {lw.status === "UPCOMING" && <Action action={openWeek} id={lw.id} label="Open week" />}
                  {lw.status === "OPEN" && <span className="muted small">Lock picks when the deadline arrives.</span>}
                  {lw.status === "LOCKED" && <span className="muted small">fetch results above</span>}
                  {lw.status === "RESULTS_IMPORTED" && <Action action={validateAndScoreWeek} id={lw.id} label="Validate + score" />}
                  {lw.status === "SCORED" && <Action action={publishWeek} id={lw.id} label="Publish + open next" />}
                  {lw.status === "PUBLISHED" && <span className="muted small">published</span>}
                  {lw.validationError && <span className="error small"> {lw.validationError}</span>}
                  {!lw.validationError && lw.validationJson && <span className="muted small"> data validated</span>}
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
          {runs.map((run) => {
            const progress = run.status === "RUNNING" ? decodeIngestionProgress(run.summary) : null;
            const summary = progress ? `${progress.percent}% — ${progress.message}` : run.error ?? run.summary ?? "";
            return <tr key={run.id}><td>{run.startedAt.toLocaleString()}</td><td>{run.source}</td><td>{run.weekNumber ?? "all"}</td><td>{run.status}</td><td className="small">{summary}</td></tr>;
          })}
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
  return <form action={action} className="inline-action"><input type="hidden" name="leagueWeekId" value={id} /><button type="submit">{label}</button></form>;
}

function LeagueAction({ action, leagueId, label }: { action: (data: FormData) => Promise<void>; leagueId: number; label: string }) {
  return <form action={action} className="inline-action"><input type="hidden" name="leagueId" value={leagueId} /><button type="submit">{label}</button></form>;
}

function LockControl({
  available,
  locked,
  canChange,
  lockAction,
  unlockAction,
  id,
  noun,
}: {
  available: boolean;
  locked: boolean;
  canChange: boolean;
  lockAction: (data: FormData) => Promise<void>;
  unlockAction: (data: FormData) => Promise<void>;
  id: number;
  noun: string;
}) {
  if (!available) return <span className="badge pending">NOT OPEN</span>;
  return <div className="lock-control">
    <span className={`badge ${locked ? "loss" : "win"}`}>{locked ? "LOCKED" : "OPEN"}</span>
    {canChange && <Action action={locked ? unlockAction : lockAction} id={id} label={`${locked ? "Unlock" : "Lock"} ${noun}`} />}
  </div>;
}
