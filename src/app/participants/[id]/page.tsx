// Participant page: their roster, weekly predictions, and crystal ball.
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  parseScoring,
  computeStandings,
  fmtDate,
  round1,
  SLOT_ORDER,
} from "@/lib/fantasy";
import { pickemPoints } from "@/lib/scoring";
import { getViewState, isFinished } from "@/lib/view";
import { requireLeagueMember } from "@/lib/auth";
import { areWeeklyPicksPublic } from "@/lib/pick-privacy";
import { TeamLabel } from "@/components/GameIdentity";
import { crystalBallPoints } from "@/lib/crystal-ball";
import {
  fantasyRosterTradeExceptionForRosterPlayer,
  fantasyRosterTradeExceptionsForOwners,
  rosterPlayerMatchesTradeException,
} from "@/lib/roster-trade-exceptions";
import RosterTradeExceptionNotice from "@/components/RosterTradeExceptionNotice";

export const dynamic = "force-dynamic";

export default async function ParticipantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const access = await requireLeagueMember();
  const ft = await prisma.fantasyTeam.findUnique({
    where: { id: Number(id) },
    include: {
      user: true,
      league: {
        include: {
          cbQuestions: { include: { answers: true } },
          leagueWeeks: {
            include: {
              week: true,
              weeklyRosters: {
                include: {
                  player: {
                    include: {
                      tournamentRosters: { where: { tournamentId: access.league.tournamentId } },
                    },
                  },
                },
              },
              weeklyScores: true,
            },
          },
        },
      },
      roster: { include: { player: { include: { tournamentRosters: { where: { tournamentId: access.league.tournamentId } } } } } },
    },
  });
  if (!ft || ft.leagueId !== access.league.id) notFound();

  const view = await getViewState();
  const viewer = access.user;
  const cutoff = view?.cutoff ?? null;
  const cfg = parseScoring(ft.league.scoringConfig);
  const pickems = await prisma.pickem.findMany({
    where: { leagueId: ft.leagueId, userId: ft.userId },
    include: { match: { include: { week: true } } },
  });
  const standings = await computeStandings(cutoff, ft.leagueId);
  const mine = standings?.standings.find((s) => s.fantasyTeamId === ft.id);

  const publicPickWeekIds = new Set(
    ft.league.leagueWeeks.filter(areWeeklyPicksPublic).map((week) => week.weekId),
  );
  const viewerIsMember = viewer ? await prisma.fantasyTeam.count({ where: { leagueId: ft.leagueId, userId: viewer.id } }) > 0 : false;
  const weeklyRosterAudits = (mine?.weekly ?? []).flatMap((weekScore) => {
    const leagueWeek = ft.league.leagueWeeks.find(
      (candidate) => candidate.week.number === weekScore.weekNumber,
    );
    if (!leagueWeek) return [];
    const rows = leagueWeek.weeklyRosters
      .filter((row) => row.fantasyTeamId === ft.id && row.slot !== "BENCH")
      .sort((left, right) => SLOT_ORDER.indexOf(left.slot) - SLOT_ORDER.indexOf(right.slot))
      .map((row) => {
        const exception = fantasyRosterTradeExceptionForRosterPlayer(
          ft.league.tournamentId,
          ft.user.username,
          row.playerId,
        );
        const effectivePlayerId = exception?.replacesPlayerId === row.playerId
          ? exception.playerId
          : row.playerId;
        const contribution = weekScore.roster.find((item) =>
          item.playerId === row.playerId || item.playerId === effectivePlayerId,
        );
        return {
          ...row,
          effectivePlayerId,
          effectivePlayerName: contribution?.playerName
            ?? (effectivePlayerId === exception?.playerId ? exception.playerName : row.player.name),
          gamesPlayed: contribution?.gamesPlayed ?? 0,
          pointsPerGame: contribution?.pointsPerGame ?? 0,
          creditedPoints: contribution?.creditedPoints ?? contribution?.pointsPerGame ?? 0,
          fallback: contribution?.fallback ?? null,
          rosterException: contribution?.rosterException ?? null,
        };
      });
    return [{
      leagueWeekId: leagueWeek.id,
      weekNumber: leagueWeek.week.number,
      provisional: weekScore.provisional,
      rows,
    }];
  });

  // Contributions come from immutable published snapshots plus the request-time
  // provisional score for the locked live week. This prevents a midseason
  // acquisition from inheriting points earned before they were rostered.
  const slotTotals = new Map<number, number>();
  const slotFallbackWeeks = new Map<number, number>();
  for (const weeklyRoster of weeklyRosterAudits) {
    for (const row of weeklyRoster.rows) {
      const currentSlot = ft.roster.find((slot) => {
        if (slot.slot === "BENCH") return false;
        const exception = fantasyRosterTradeExceptionForRosterPlayer(
          ft.league.tournamentId,
          ft.user.username,
          slot.playerId,
        );
        return row.playerId === slot.playerId
          || row.playerId === exception?.playerId
          || row.playerId === exception?.replacesPlayerId;
      });
      if (!currentSlot) continue;
      slotTotals.set(currentSlot.id, (slotTotals.get(currentSlot.id) ?? 0) + row.creditedPoints);
      if (row.fallback) slotFallbackWeeks.set(currentSlot.id, (slotFallbackWeeks.get(currentSlot.id) ?? 0) + 1);
    }
  }
  const substituteAdjustments = weeklyRosterAudits.flatMap((week) =>
    week.rows.flatMap((row) => row.fallback
      ? [{ weekNumber: week.weekNumber, provisional: week.provisional, row, fallback: row.fallback }]
      : []),
  );
  const substitutePlayerIds = [...new Set(
    substituteAdjustments.flatMap(({ fallback }) => fallback.substitutePlayerIds),
  )];
  const substitutePlayers = substitutePlayerIds.length > 0
    ? await prisma.proPlayer.findMany({
        where: { id: { in: substitutePlayerIds } },
        select: { id: true, name: true },
      })
    : [];
  const substituteNames = new Map(substitutePlayers.map((player) => [player.id, player.name]));

  const rosterTradeExceptions = fantasyRosterTradeExceptionsForOwners(
    ft.league.tournamentId,
    [ft.user.username],
  ).filter((exception) =>
    rosterPlayerMatchesTradeException(
      exception,
      ft.roster.map((slot) => slot.playerId),
    ),
  );
  const replacementPlayerIds = rosterTradeExceptions.flatMap((exception) =>
    exception.replacesPlayerId
      && ft.roster.some((slot) => slot.playerId === exception.replacesPlayerId)
      ? [exception.playerId]
      : [],
  );
  const replacementPlayers = replacementPlayerIds.length > 0
    ? await prisma.proPlayer.findMany({
        where: { id: { in: replacementPlayerIds } },
        include: {
          tournamentRosters: { where: { tournamentId: access.league.tournamentId } },
        },
      })
    : [];
  const replacementPlayerById = new Map(replacementPlayers.map((player) => [player.id, player]));
  const sortedRoster = ft.roster.map((slot) => {
    const exception = fantasyRosterTradeExceptionForRosterPlayer(
      ft.league.tournamentId,
      ft.user.username,
      slot.playerId,
    );
    const replacement = exception?.replacesPlayerId === slot.playerId
      ? replacementPlayerById.get(exception.playerId)
      : null;
    return replacement
      ? { ...slot, playerId: replacement.id, player: replacement }
      : slot;
  }).sort(
    (a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot),
  );
  const visiblePickems = pickems.filter((pick) =>
    viewer?.id === ft.userId || (pick.match.weekId !== null && publicPickWeekIds.has(pick.match.weekId)),
  );
  const sortedPickems = [...visiblePickems].sort(
    (a, b) => a.match.scheduledAt.getTime() - b.match.scheduledAt.getTime(),
  );
  return (
    <>
      <p className="small">
        <Link href="/leaderboard">← leaderboard</Link>
      </p>
      <h1>
        {ft.user.username} — {ft.name}
      </h1>
      {mine && (
        <p className="muted small">
          Season total <b>{mine.total}</b> {mine.hasProvisional && <span className="badge win">live provisional</span>} (roster {mine.rosterTotal} · pickems{" "}
          {mine.pickemTotal} · crystal ball {ft.league.seasonStatus === "FINAL" ? mine.crystalBallTotal : "pending"})
        </p>
      )}

      <RosterTradeExceptionNotice exceptions={rosterTradeExceptions} />

      {substituteAdjustments.length > 0 && <div className="card substitute-rule-note">
        <b>Substitute points adjustment</b>
        <span className="muted small">When a rostered player logs zero games and a same-team, same-role substitute plays, the credited Pts/G is the lower of that professional team&apos;s weekly player average and the substitute&apos;s individual performance.</span>
        <div className="substitute-calculations">
          {substituteAdjustments.map(({ weekNumber, provisional, row, fallback }) => (
            <div key={`${weekNumber}:${row.effectivePlayerId}:${fallback.substitutePlayerIds.join(":")}`}>
              <span><b>{row.effectivePlayerName}</b> · Week {weekNumber}{provisional ? " live provisional" : ""} · {fallback.teamId} {fallback.role}</span>
              <span>
                {(fallback.substitutePlayerIds.map((playerId) => substituteNames.get(playerId) ?? playerId)).join(" / ")}:
                {" "}min(team avg {round1(fallback.teamAveragePointsPerGame)}, substitute {round1(fallback.substitutePointsPerGame)}) = <b>{round1(fallback.creditedPoints)} Pts/G</b>
              </span>
            </div>
          ))}
        </div>
      </div>}

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
                  <th className="num">Season roster points</th>
                </tr>
              </thead>
              <tbody>
                {sortedRoster.map((slot) => (
                  <tr key={slot.id}>
                    <td className="muted">{slot.slot}</td>
                    <td>{slot.player.name}</td>
                    <td>{slot.player.tournamentRosters[0]?.teamId ? <TeamLabel name={slot.player.tournamentRosters[0].teamId!} size="xs" /> : "?"}</td>
                    <td className="num">
                      <b>{round1(slotTotals.get(slot.id) ?? 0)}</b>
                      {(slotFallbackWeeks.get(slot.id) ?? 0) > 0 && <span className="fallback-credit-badge">{slotFallbackWeeks.get(slot.id)} fallback week{slotFallbackWeeks.get(slot.id) === 1 ? "" : "s"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>Team totals retain points earned by players no longer on the current roster. Live-week values update as completed games arrive.</p>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Crystal ball</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Answer</th>
                  <th className="num">Max pts</th>
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
                    earned = crystalBallPoints(q, ft.userId);
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

      <h2>Weekly roster scoring</h2>
      <p className="muted small">
        This is the frozen roster used for each published week plus any live provisional week. A highlighted substitute credit means the drafted player logged zero games and received the lower of the same-role substitute&apos;s production or that professional team&apos;s weekly player average.
      </p>
      {weeklyRosterAudits.length === 0 ? <p className="card muted">No published or live weekly roster scores yet.</p> : <div className="tablewrap weekly-roster-audit">
        <table>
          <thead>
            <tr>
              <th>Week</th>
              <th>Slot</th>
              <th>Player</th>
              <th>Pro team</th>
              <th className="num">Games</th>
              <th className="num">Own Pts/G</th>
              <th className="num">Credited</th>
              <th>Scoring status</th>
            </tr>
          </thead>
          <tbody>
            {weeklyRosterAudits.flatMap((weeklyRoster) => weeklyRoster.rows.map((row) => {
              const teamId = row.fallback?.teamId
                ?? row.rosterException?.currentTeamId
                ?? row.player.tournamentRosters[0]?.teamId
                ?? row.player.teamId;
              return <tr className={row.fallback ? "roster-fallback-row" : ""} key={`${weeklyRoster.leagueWeekId}-${row.id}`}>
                <td><b>Week {weeklyRoster.weekNumber}</b>{weeklyRoster.provisional && <span className="badge win">live</span>}</td>
                <td className="muted">{row.slot}</td>
                <td><b>{row.effectivePlayerName}</b></td>
                <td>{teamId ? <TeamLabel name={teamId} size="xs" /> : "?"}</td>
                <td className="num">{row.gamesPlayed}</td>
                <td className="num">{round1(row.pointsPerGame)}</td>
                <td className="num"><b>{round1(row.creditedPoints)}</b></td>
                <td className="weekly-roster-status">
                  {row.fallback ? <>
                    <span className="fallback-credit-badge">{row.rosterException ? "Trade-exception substitute credit" : "Substitute credit applied"}</span>
                    <small>
                      {row.fallback.substitutePlayerIds.map((playerId) => substituteNames.get(playerId) ?? playerId).join(", ")}: {round1(row.fallback.substitutePointsPerGame)} Pts/G · team average: {round1(row.fallback.teamAveragePointsPerGame)} · min = {round1(row.fallback.creditedPoints)} credited
                    </small>
                  </> : row.gamesPlayed > 0 ? <span className="muted small">{row.rosterException ? "Trade exception · played normally · no penalty" : "Played normally"}</span> : <>
                    <span className="badge loss">No games · 0 points</span>
                    <small>{row.rosterException ? "No eligible ADC substitute recorded a game under the trade exception." : "No same-team, same-role substitute recorded a game."}</small>
                  </>}
                </td>
              </tr>;
            }))}
          </tbody>
        </table>
      </div>}

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
                m.weekId !== null && publicPickWeekIds.has(m.weekId) && isFinished(m, cutoff) && m.team1Score !== null && m.team2Score !== null;
              const actualScore = finished ? `${m.team1Score}-${m.team2Score}` : null;
              const pts = finished
                ? pickemPoints(p.predictedWinner, p.predictedScore, m.winner!, actualScore!, cfg)
                : null;
              return (
                <tr key={p.id}>
                  <td>{fmtDate(m.scheduledAt)}</td>
                  <td><span className="entity-matchup"><TeamLabel name={m.team1} size="xs" /><em>vs</em><TeamLabel name={m.team2} size="xs" /></span></td>
                  <td>
                    <TeamLabel name={p.predictedWinner} size="xs" />{" "}
                    <span className="muted">({p.predictedScore ?? "no score"})</span>
                  </td>
                  <td>
                    {finished ? (
                      <>
                        <TeamLabel name={m.winner!} size="xs" /> <span className="muted">({actualScore})</span>
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
