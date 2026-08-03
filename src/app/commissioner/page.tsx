import Link from "next/link";
import { requireLeagueManager } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decodeIngestionProgress, isIngestionRunStale } from "@/lib/ingestion-progress";
import {
  finishSeason,
  fetchNextWeekResults,
  fetchNextWeekSchedule,
  lockPicks,
  lockRosters,
  openWeek,
  publishWeek,
  recoverStaleIngestion,
  refreshLiveWeek,
  unlockPicks,
  unlockRosters,
  updateScoringConfig,
  validateAndScoreWeek,
} from "./actions";
import { IngestButton } from "./IngestButton";
import { parseResolutionEvidence } from "@/lib/crystal-ball";
import { parseScoring } from "@/lib/fantasy";
import {
  areWeekSeriesResultsComplete,
  canOpenWeekPicks,
  canUnlockWeekPicks,
} from "@/lib/week-progression";

export const dynamic = "force-dynamic";
// Weekly Gol.gg imports fit inside Vercel Hobby's five-minute Fluid Compute ceiling.
export const maxDuration = 300;

export default async function CommissionerPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const access = await requireLeagueManager();
  const feedback = await searchParams;
  const league = await prisma.league.findUnique({ where: { id: access.league.id }, include: { cbQuestions: true } });
  if (!league) return <p>No league exists.</p>;
  const scoring = parseScoring(league.scoringConfig);
  const weeks = await prisma.leagueWeek.findMany({
    where: { leagueId: league.id },
    orderBy: { week: { number: "asc" } },
    include: {
      week: {
        include: {
          matches: {
            select: {
              bestOf: true,
              team1: true,
              team2: true,
              winner: true,
              team1Score: true,
              team2Score: true,
            },
          },
        },
      },
      weeklyScores: true,
    },
  });
  const runs = await prisma.ingestionRun.findMany({
    where: { tournamentId: league.tournamentId },
    orderBy: { startedAt: "desc" },
    take: 10,
  });
  const targetWeek = league.currentWeek + 1;
  const target = weeks.find((week) => week.week.number === targetWeek);
  const latestPickWeek = [...weeks].reverse().find((week) =>
    week.picksOpenAt !== null && ["OPEN", "LOCKED", "RESULTS_IMPORTED", "SCORED"].includes(week.status),
  ) ?? null;
  const pickTarget = latestPickWeek ?? target;
  const fantasyTeams = await prisma.fantasyTeam.findMany({
    where: { leagueId: league.id },
    include: { user: true },
    orderBy: { id: "asc" },
  });
  const pickTargetMatchCount = pickTarget?.week.matches.length ?? 0;
  const submittedPicks = pickTarget ? await prisma.pickem.findMany({
    where: { leagueId: league.id, match: { weekId: pickTarget.weekId } },
    select: { userId: true },
  }) : [];
  const submittedByUser = submittedPicks.reduce((counts, pick) => {
    counts.set(pick.userId, (counts.get(pick.userId) ?? 0) + 1);
    return counts;
  }, new Map<number, number>());
  const crystalAnswers = pickTarget?.week.number === 1 && league.cbQuestions.length > 0
    ? await prisma.crystalBallAnswer.findMany({
      where: {
        questionId: { in: league.cbQuestions.map((question) => question.id) },
        userId: { in: fantasyTeams.map((team) => team.userId) },
      },
      select: { userId: true },
    })
    : [];
  const crystalAnswersByUser = crystalAnswers.reduce((counts, answer) => {
    counts.set(answer.userId, (counts.get(answer.userId) ?? 0) + 1);
    return counts;
  }, new Map<number, number>());
  const pickTargetIncompletePicks = fantasyTeams.filter((team) => (submittedByUser.get(team.userId) ?? 0) !== pickTargetMatchCount);
  const pickTargetIncompleteCrystalBall = pickTarget?.week.number === 1 && league.cbQuestions.length > 0
    ? fantasyTeams.filter((team) => (crystalAnswersByUser.get(team.userId) ?? 0) !== league.cbQuestions.length)
    : [];
  const activeTargetRun = runs.find(
    (run) => run.tournamentId === league.tournamentId && run.weekNumber === targetWeek && run.status === "RUNNING",
  );
  const importRunning = Boolean(activeTargetRun);
  const staleTargetRun = activeTargetRun && isIngestionRunStale(activeTargetRun) ? activeTargetRun : null;
  const scheduleRunning = runs.some(
    (run) => run.tournamentId === league.tournamentId && run.weekNumber === targetWeek && run.source === "LEAGUEPEDIA_SCHEDULE" && run.status === "RUNNING",
  );
  const resultsRunning = runs.some(
    (run) => run.tournamentId === league.tournamentId && run.weekNumber === targetWeek && run.source === "GAMES_OF_LEGENDS" && run.status === "RUNNING",
  );
  const liveRefreshRunning = runs.some(
    (run) => run.tournamentId === league.tournamentId && run.weekNumber === targetWeek && run.source === "GAMES_OF_LEGENDS_LIVE" && run.status === "RUNNING",
  );
  const scheduleAllowed = !league.isSimulation && league.seasonStatus !== "FINAL" && (
    !target || target.status === "UPCOMING" || (target.status === "OPEN" && !target.picksLockedAt)
  );
  const resultsAllowed =
    league.seasonStatus !== "FINAL" && !!target && ["LOCKED", "RESULTS_IMPORTED"].includes(target.status);
  const liveRefreshAllowed =
    !league.isSimulation &&
    league.seasonStatus !== "FINAL" &&
    target?.status === "LOCKED";
  return (
    <>
      <h1>Commissioner — {league.name}</h1>
      {feedback.notice && <p className="notice card">{feedback.notice}</p>}
      {feedback.error && <p className="error card" role="alert">Couldn&apos;t complete that action: {feedback.error}</p>}
      <p>
        Season: <span className="badge pending">{league.seasonStatus}</span>{" "}
        Published through: <b>Week {league.currentWeek}</b>{" · "}
        Data pipeline: <b>{target ? `Week ${target.week.number}` : "complete"}</b>{" · "}
        Pick&apos;em slate: <b>{latestPickWeek ? `Week ${latestPickWeek.week.number} ${latestPickWeek.status === "OPEN" ? "open" : "locked"}` : "none open"}</b>{" · "}
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
          {!league.rostersLockedAt && league.currentWeek === 0 && league.draftStatus !== "COMPLETE" ? (
            <><button type="button" disabled>Lock roster editing</button><span className="muted small">Complete the Week 0 draft first.</span></>
          ) : (
            <LeagueAction action={league.rostersLockedAt ? unlockRosters : lockRosters} leagueId={league.id} label={`${league.rostersLockedAt ? "Unlock" : "Lock"} roster editing`} />
          )}
          {(league.currentWeek > 0 || (latestPickWeek?.week.number ?? 0) > 1) && <Link href="/commissioner/rosters">Manage current rosters →</Link>}
        </div>
      </section>
      <section className="card stack">
        <div>
          <h2 style={{ margin: 0 }}>Week {targetWeek} data pipeline</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>
            {league.isSimulation
              ? "The full historical schedule and player pool are already loaded. Lock the next week's picks and roster snapshot, then reveal only that week's stored results. No API request is made."
              : "Series scores and detailed stats advance independently. Once every series has a final result, the next Pick'em slate can open; this data pipeline remains on the unpublished week until its missing game stats are backfilled, validated, scored, and published."}
          </p>
        </div>
        <div className="inline-form">
          {league.isSimulation ? (
            <span className="badge win">FULL SCHEDULE LOADED</span>
          ) : scheduleAllowed ? (
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
          {liveRefreshAllowed && (
            <form action={refreshLiveWeek}>
              <input type="hidden" name="leagueId" value={league.id} />
              <IngestButton
                disabled={importRunning}
                running={liveRefreshRunning}
                leagueId={league.id}
                weekNumber={targetWeek}
                source="GAMES_OF_LEGENDS_LIVE"
                label={`Refresh in-progress Week ${targetWeek}`}
              />
            </form>
          )}
          {resultsAllowed && (
            <form action={fetchNextWeekResults}>
              <input type="hidden" name="leagueId" value={league.id} />
              {league.isSimulation ? (
                <button type="submit">{target?.status === "RESULTS_IMPORTED" ? `Re-read stored Week ${targetWeek} results` : `Reveal stored Week ${targetWeek} results`}</button>
              ) : (
                <IngestButton
                  disabled={importRunning}
                  running={resultsRunning}
                  leagueId={league.id}
                  weekNumber={targetWeek}
                  source="GAMES_OF_LEGENDS"
                  label={target?.status === "RESULTS_IMPORTED" ? `Recheck final Week ${targetWeek} results` : `Finalize complete Week ${targetWeek} results`}
                />
              )}
            </form>
          )}
          {liveRefreshAllowed && !importRunning && (
            <span className="muted small">Safe to repeat after each series: unchanged rows are skipped, live points are provisional, and Crystal Ball is not settled.</span>
          )}
          {staleTargetRun ? (
            <form action={recoverStaleIngestion} className="stack">
              <input type="hidden" name="leagueId" value={league.id} />
              <input type="hidden" name="runId" value={staleTargetRun.id} />
              <span className="error small">This import has not sent a backend heartbeat for more than 10 minutes.</span>
              <button type="submit">Recover stale import</button>
              <span className="muted small">This closes the abandoned run without deleting partial rows, so retrying remains safe.</span>
            </form>
          ) : importRunning ? (
            <span className="muted small">An import is already running. Progress and backend heartbeat are shown above.</span>
          ) : null}
          {target?.status === "OPEN" && <span className="muted small">Lock picks to freeze predictions and the scoring roster before results can be fetched.</span>}
          {!target && <span className="muted small">No Week {targetWeek} slate has been fetched yet.</span>}
        </div>
      </section>
      {league.currentWeek === 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Week 0 checklist</h2>
          <ol>
            <li>{league.isSimulation ? "Review the complete stored schedule and preseason player pool; results remain hidden." : "Use the data-pipeline button above to pull the Week 1 slate and preseason player pool without results."}</li>
            <li>Set the snake order and complete all 10 roster picks per participant in the <Link href="/commissioner/draft">Week 0 draft</Link>.</li>
            <li>Submit Week 1 pickems, then lock Week 1 before play begins.</li>
          </ol>
        </section>
      )}
      {weeks.length === 0 && (
        <p className="muted">No weekly slate has been imported yet. The schedule button above creates and opens it automatically.</p>
      )}
      {pickTarget && pickTargetMatchCount > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Week {pickTarget.week.number} pick&apos;em progress</h2>
          <p className="muted small">Only completion counts are shown here. Everyone&apos;s actual selections stay private until you lock the picks.</p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Participant</th><th>Fantasy team</th><th>Completion</th></tr></thead>
              <tbody>
                {fantasyTeams.map((team) => {
                  const submitted = submittedByUser.get(team.userId) ?? 0;
                  const complete = submitted === pickTargetMatchCount;
                  return <tr key={team.id}>
                    <td>{team.user.username}</td>
                    <td>{team.name}</td>
                    <td><span className={`submission-status ${complete ? "complete" : "incomplete"}`}>{submitted} / {pickTargetMatchCount} — {complete ? "complete" : "incomplete"}</span></td>
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
            {weeks.map((lw, index) => {
              const previous = index > 0 ? weeks[index - 1] : null;
              const next = index + 1 < weeks.length ? weeks[index + 1] : null;
              const resultsComplete = !league.isSimulation && areWeekSeriesResultsComplete(lw.week.matches);
              const laterWeekOpened = weeks.some(
                (candidate) => candidate.week.number > lw.week.number && candidate.picksOpenAt !== null,
              );
              const canOpen = canOpenWeekPicks(lw, previous)
                && (!league.isSimulation || previous?.status === "PUBLISHED");
              const picksCanChange = lw.status === "OPEN" || canUnlockWeekPicks({
                status: lw.status,
                picksLockedAt: lw.picksLockedAt,
                matches: resultsComplete ? lw.week.matches : [],
              }, laterWeekOpened);
              return <tr key={lw.id}>
                <td>{lw.week.number}{lw.week.sourceLabel && lw.week.sourceLabel !== `Week ${lw.week.number}` ? <><br /><span className="muted small">LCK {lw.week.sourceLabel}</span></> : null}</td>
                <td>
                  <span className="badge pending">{lw.status}</span>
                  {resultsComplete && lw.status !== "PUBLISHED" && <><br /><span className="badge win">SERIES RESULTS FINAL</span></>}
                </td>
                <td>
                  <LockControl
                    available={lw.status !== "UPCOMING"}
                    locked={Boolean(lw.picksLockedAt)}
                    canChange={picksCanChange}
                    lockAction={lockPicks}
                    unlockAction={unlockPicks}
                    id={lw.id}
                    noun="picks"
                    importRunning={runs.some((run) => run.weekNumber === lw.week.number && run.status === "RUNNING")}
                    incompletePicks={pickTarget?.id === lw.id ? pickTargetIncompletePicks.length : 0}
                    incompleteCrystalBall={pickTarget?.id === lw.id ? pickTargetIncompleteCrystalBall.length : 0}
                  />
                  {lw.picksLockedAt && !picksCanChange && <span className="muted small"> immutable</span>}
                </td>
                <td>
                  <span className={`badge ${lw.rosterLockedAt ? "pending" : "win"}`}>{lw.rosterLockedAt ? "FROZEN" : "NOT FROZEN"}</span>
                </td>
                <td>
                  {lw.status === "UPCOMING" && (canOpen
                    ? <Action action={openWeek} id={lw.id} label={`Open Week ${lw.week.number} Pick'ems`} />
                    : <span className="muted small">opens after Week {lw.week.number - 1} picks are locked and every series result is final</span>)}
                  {lw.status === "OPEN" && <span className="muted small">Lock picks when the deadline arrives.</span>}
                  {lw.status === "LOCKED" && <span className="muted small">{resultsComplete ? "results final; detailed stats can still be backfilled above" : "refresh live above; final series results will unlock the next slate"}</span>}
                  {lw.status === "RESULTS_IMPORTED" && <Action action={validateAndScoreWeek} id={lw.id} label="Validate + score" />}
                  {lw.status === "SCORED" && <Action
                    action={publishWeek}
                    id={lw.id}
                    label={next?.status === "UPCOMING" ? "Publish + open next" : "Publish week"}
                  />}
                  {lw.status === "PUBLISHED" && <span className="muted small">published</span>}
                  {lw.validationError && <span className="error small"> {lw.validationError}</span>}
                  {!lw.validationError && lw.validationJson && <span className="muted small"> data validated</span>}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {league.currentWeek > 0 && league.seasonStatus !== "FINAL" && weeks.length > 0 && weeks.every((week) => week.status === "PUBLISHED") && (
        <form action={finishSeason} className="card">
          <input type="hidden" name="leagueId" value={league.id} />
          <button type="submit">Retry season finish + automatic Crystal Ball grading</button>
        </form>
      )}
      <h2>Ingestion audit</h2>
      {runs.length === 0 ? <p className="muted">New imports will be recorded here.</p> : (
        <div className="tablewrap"><table><thead><tr><th>Started</th><th>Source</th><th>Week</th><th>Status</th><th>Summary</th></tr></thead><tbody>
          {runs.map((run) => {
            const progress = run.status === "RUNNING" ? decodeIngestionProgress(run.summary) : null;
            const summary = progress ? `${progress.percent}% — ${progress.message}` : run.error ?? run.summary ?? "";
            const stale = run.status === "RUNNING" && isIngestionRunStale(run);
            return <tr key={run.id}><td>{run.startedAt.toLocaleString()}</td><td>{run.source}</td><td>{run.weekNumber ?? "all"}</td><td>{stale ? "STALE" : run.status}</td><td className="small">{summary}</td></tr>;
          })}
        </tbody></table></div>
      )}
      <h2>Scoring configuration</h2>
      <form action={updateScoringConfig} className="stack card">
        <input type="hidden" name="leagueId" value={league.id} />
        <textarea name="scoringConfig" rows={22} defaultValue={JSON.stringify(scoring, null, 2)} />
        <button type="submit">Save scoring configuration</button>
        <span className="muted small">Locks permanently after the first published week.</span>
      </form>
      <h2>Crystal Ball settlement</h2>
      <p className="muted small">No manual grading is required. Questions 1–10 use the stored final podium (50 points for first, 30 for second, 10 for third, and zero below third). Questions 11–20 are worth 30 points all-or-nothing, with closest-number questions comparing every submitted answer.</p>
      <div className="tablewrap"><table>
        <thead><tr><th>#</th><th>Question</th><th>Mode</th><th>Result</th><th>Audit</th></tr></thead>
        <tbody>{league.cbQuestions.map((question, index) => {
          const resolution = parseResolutionEvidence(question.resolutionData);
          const accepted = question.resolvedAnswers ? JSON.parse(question.resolvedAnswers) as string[] : [];
          const result = question.gradingMode === "RANKED" && resolution?.ranking
            ? resolution.ranking.slice(0, 3).map((tier) => `${tier.rank}: ${tier.answers.join(" / ")}`).join(" · ")
            : question.gradingMode === "CLOSEST" && question.correctAnswer
            ? `${question.correctAnswer} (closest prediction)`
            : accepted.join(" / ") || "Pending season finish";
          return <tr key={question.id}>
            <td>{index + 1}</td><td style={{ whiteSpace: "normal" }}>{question.prompt}</td><td>{question.gradingMode === "RANKED" ? "Ranked 50/30/10" : question.gradingMode === "CLOSEST" ? "Closest · 30" : "Exact · 30"}</td>
            <td>{question.resolvedAt ? <span className="badge win">{result}</span> : <span className="badge pending">pending</span>}</td>
            <td className="small muted" style={{ whiteSpace: "normal" }}>{resolution?.evidence ?? "Calculated automatically after all weeks are published."}</td>
          </tr>;
        })}</tbody>
      </table></div>
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
  importRunning,
  incompletePicks,
  incompleteCrystalBall,
}: {
  available: boolean;
  locked: boolean;
  canChange: boolean;
  lockAction: (data: FormData) => Promise<void>;
  unlockAction: (data: FormData) => Promise<void>;
  id: number;
  noun: string;
  importRunning: boolean;
  incompletePicks: number;
  incompleteCrystalBall: number;
}) {
  if (!available) return <span className="badge pending">NOT OPEN</span>;
  const incomplete = incompletePicks > 0 || incompleteCrystalBall > 0;
  return <div className="lock-control">
    <span className={`badge ${locked ? "loss" : "win"}`}>{locked ? "LOCKED" : "OPEN"}</span>
    {canChange && importRunning && <span className="muted small">Disabled while data imports</span>}
    {canChange && !importRunning && !locked && incomplete ? (
      <form action={lockAction} className="safety-confirm">
        <input type="hidden" name="leagueWeekId" value={id} />
        <label>
          <input type="checkbox" name="confirmIncomplete" value="true" required />
          <span>
            Lock anyway: {incompletePicks} incomplete pick&apos;em team{incompletePicks === 1 ? "" : "s"}
            {incompleteCrystalBall > 0 ? "; " + incompleteCrystalBall + " incomplete Crystal Ball team" + (incompleteCrystalBall === 1 ? "" : "s") : ""}. Missing entries score zero.
          </span>
        </label>
        <button type="submit">Lock {noun}</button>
      </form>
    ) : canChange && !importRunning ? (
      <Action action={locked ? unlockAction : lockAction} id={id} label={`${locked ? "Unlock" : "Lock"} ${noun}`} />
    ) : null}
  </div>;
}
