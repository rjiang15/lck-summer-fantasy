// Participant page: their roster, weekly predictions, and crystal ball.
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  parseScoring,
  loadWeeks,
  computeStandings,
  fmtDate,
  round1,
  SLOT_ORDER,
} from "@/lib/fantasy";
import { playerGamePoints, pickemPoints } from "@/lib/scoring";
import { getViewState, isFinished } from "@/lib/view";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ParticipantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ft = await prisma.fantasyTeam.findUnique({
    where: { id: Number(id) },
    include: {
      user: true,
      league: {
        include: {
          cbQuestions: { include: { answers: true } },
          leagueWeeks: { include: { week: true, weeklyRosters: true } },
        },
      },
      roster: { include: { player: true } },
    },
  });
  if (!ft) notFound();

  const view = await getViewState();
  const viewer = await getCurrentUser();
  const cutoff = view?.cutoff ?? null;
  const cfg = parseScoring(ft.league.scoringConfig);
  const weeks = await loadWeeks(ft.league.tournamentId);
  const pickems = await prisma.pickem.findMany({
    where: { userId: ft.userId },
    include: { match: { include: { week: true } } },
  });
  const standings = await computeStandings(cutoff);
  const mine = standings?.standings.find((s) => s.fantasyTeamId === ft.id);

  const publishedWeekIds = new Set(
    ft.league.leagueWeeks.filter((week) => week.status === "PUBLISHED").map((week) => week.weekId),
  );
  const viewerIsMember = viewer ? await prisma.fantasyTeam.count({ where: { leagueId: ft.leagueId, userId: viewer.id } }) > 0 : false;
  // Per-current-slot totals include published weeks only. Weekly score records
  // remain authoritative when historical rosters differ.
  const slotTotals = new Map<number, number>();
  for (const week of weeks) {
    if (!publishedWeekIds.has(week.id)) continue;
    for (const match of week.matches) {
      if (cutoff !== null && match.scheduledAt >= cutoff) continue;
      for (const game of match.games) {
        for (const slot of ft.roster) {
          if (slot.slot === "BENCH") continue;
          const ps = game.playerStats.find((p) => p.playerId === slot.playerId);
          if (ps)
            slotTotals.set(
              slot.id,
              (slotTotals.get(slot.id) ?? 0) + playerGamePoints(ps, cfg),
            );
        }
      }
    }
  }

  const sortedRoster = [...ft.roster].sort(
    (a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot),
  );
  const visiblePickems = pickems.filter((pick) =>
    viewer?.id === ft.userId || (pick.match.weekId !== null && publishedWeekIds.has(pick.match.weekId)),
  );
  const sortedPickems = [...visiblePickems].sort(
    (a, b) => a.match.scheduledAt.getTime() - b.match.scheduledAt.getTime(),
  );

  return (
    <>
      <p className="small">
        <Link href="/participants">← all participants</Link>
      </p>
      <h1>
        {ft.user.username} — {ft.name}
      </h1>
      {mine && (
        <p className="muted small">
          Season total <b>{mine.total}</b> (roster {mine.rosterTotal} · pickems{" "}
          {mine.pickemTotal} · crystal ball {mine.crystalBallTotal})
        </p>
      )}

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Roster</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Player</th>
                  <th>Pro team</th>
                  <th className="num">Season pts</th>
                </tr>
              </thead>
              <tbody>
                {sortedRoster.map((slot) => (
                  <tr key={slot.id}>
                    <td className="muted">{slot.slot}</td>
                    <td>{slot.player.name}</td>
                    <td>{slot.player.teamId ?? "?"}</td>
                    <td className="num">
                      <b>{round1(slotTotals.get(slot.id) ?? 0)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Crystal ball</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Answer</th>
                  <th className="num">Pts</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ft.league.cbQuestions.map((q) => {
                  const answer = q.answers.find((a) => a.userId === ft.userId);
                  const canSeeAnswer = viewer?.id === ft.userId || (viewerIsMember && Boolean(ft.league.crystalBallLockedAt));
                  let status = <span className="badge pending">pending</span>;
                  let earned: number | null = null;
                  if (ft.league.seasonStatus === "FINAL" && q.correctAnswer && answer) {
                    const partials: string[] = q.partialAnswers
                      ? JSON.parse(q.partialAnswers)
                      : [];
                    const rule = q.partialRule ? JSON.parse(q.partialRule) : null;
                    if (answer.answer === q.correctAnswer) earned = q.points;
                    else if (rule && partials.includes(answer.answer))
                      earned = q.points * (rule.fraction ?? 0.5);
                    else earned = 0;
                    status =
                      earned > 0 ? (
                        <span className="badge win">+{earned}</span>
                      ) : (
                        <span className="badge loss">0</span>
                      );
                  }
                  return (
                    <tr key={q.id}>
                      <td style={{ whiteSpace: "normal" }}>{q.prompt}</td>
                      <td>{canSeeAnswer ? answer?.answer ?? "—" : <span className="muted">hidden until lock</span>}</td>
                      <td className="num">{q.points}</td>
                      <td>{status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <h2>Weekly predictions</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Series</th>
              <th>Predicted</th>
              <th>Actual</th>
              <th className="num">Pts</th>
            </tr>
          </thead>
          <tbody>
            {sortedPickems.map((p) => {
              const m = p.match;
              const finished =
                m.weekId !== null && publishedWeekIds.has(m.weekId) && isFinished(m, cutoff) && m.team1Score !== null && m.team2Score !== null;
              const actualScore = finished ? `${m.team1Score}-${m.team2Score}` : null;
              const pts = finished
                ? pickemPoints(p.predictedWinner, p.predictedScore, m.winner!, actualScore!, cfg)
                : null;
              return (
                <tr key={p.id}>
                  <td>{fmtDate(m.scheduledAt)}</td>
                  <td>
                    {m.team1} vs {m.team2}
                  </td>
                  <td>
                    {p.predictedWinner}{" "}
                    <span className="muted">({p.predictedScore ?? "no score"})</span>
                  </td>
                  <td>
                    {finished ? (
                      <>
                        {m.winner} <span className="muted">({actualScore})</span>
                      </>
                    ) : (
                      <span className="badge pending">upcoming</span>
                    )}
                  </td>
                  <td className="num">
                    {pts === null ? (
                      "—"
                    ) : pts > 0 ? (
                      <span className="badge win">+{pts}</span>
                    ) : (
                      <span className="badge loss">0</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
