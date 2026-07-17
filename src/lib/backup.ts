// League-scoped fantasy backup. Shared esports data is intentionally excluded.
import { prisma } from "./db";

export interface Backup {
  version: 3;
  exportedAt: string;
  league: {
    name: string; tournamentId: string; scoringConfig: string; currentWeek: number;
    seasonStatus: string; crystalBallLockedAt: string | null; isSimulation: boolean;
  };
  users: { username: string; passwordHash: string; role: string }[];
  fantasyTeams: { username: string; name: string; roster: { playerId: string; slot: string }[] }[];
  pickems: { username: string; matchId: string; predictedWinner: string; predictedScore: string | null }[];
  cbQuestions: {
    prompt: string; answerType: string; points: number; partialRule: string | null;
    correctAnswer: string | null; partialAnswers: string | null;
    answers: { username: string; answer: string }[];
  }[];
  leagueWeeks: {
    weekNumber: number; status: string; picksOpenAt: string | null; picksLockedAt: string | null;
    rosterLockedAt: string | null; resultsImportedAt: string | null; scoredAt: string | null;
    publishedAt: string | null; validationJson: string | null; validationError: string | null;
    rosters: { username: string; playerId: string; slot: string }[];
    scores: { username: string; rosterPts: number; pickemPts: number; total: number; breakdown: string; publishedAt: string | null }[];
  }[];
}

export async function exportLeague(leagueId: number): Promise<Backup | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      memberships: { include: { user: true } },
      fantasyTeams: { include: { user: true, roster: true } },
      cbQuestions: { include: { answers: { include: { user: true } } } },
      leagueWeeks: { include: { week: true, weeklyRosters: { include: { fantasyTeam: { include: { user: true } } } }, weeklyScores: { include: { fantasyTeam: { include: { user: true } } } } } },
    },
  });
  if (!league) return null;
  const pickems = await prisma.pickem.findMany({ where: { leagueId }, include: { user: true } });
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    league: {
      name: league.name, tournamentId: league.tournamentId, scoringConfig: league.scoringConfig,
      currentWeek: league.currentWeek, seasonStatus: league.seasonStatus,
      crystalBallLockedAt: league.crystalBallLockedAt?.toISOString() ?? null, isSimulation: league.isSimulation,
    },
    users: league.memberships.map((m) => ({ username: m.user.username, passwordHash: m.user.passwordHash, role: m.role })),
    fantasyTeams: league.fantasyTeams.map((ft) => ({ username: ft.user.username, name: ft.name, roster: ft.roster.map((r) => ({ playerId: r.playerId, slot: r.slot })) })),
    pickems: pickems.map((p) => ({ username: p.user.username, matchId: p.matchId, predictedWinner: p.predictedWinner, predictedScore: p.predictedScore })),
    cbQuestions: league.cbQuestions.map((q) => ({
      prompt: q.prompt, answerType: q.answerType, points: q.points, partialRule: q.partialRule,
      correctAnswer: q.correctAnswer, partialAnswers: q.partialAnswers,
      answers: q.answers.map((a) => ({ username: a.user.username, answer: a.answer })),
    })),
    leagueWeeks: league.leagueWeeks.map((lw) => ({
      weekNumber: lw.week.number, status: lw.status,
      picksOpenAt: lw.picksOpenAt?.toISOString() ?? null, picksLockedAt: lw.picksLockedAt?.toISOString() ?? null,
      rosterLockedAt: lw.rosterLockedAt?.toISOString() ?? null, resultsImportedAt: lw.resultsImportedAt?.toISOString() ?? null,
      scoredAt: lw.scoredAt?.toISOString() ?? null, publishedAt: lw.publishedAt?.toISOString() ?? null,
      validationJson: lw.validationJson, validationError: lw.validationError,
      rosters: lw.weeklyRosters.map((s) => ({ username: s.fantasyTeam.user.username, playerId: s.playerId, slot: s.slot })),
      scores: lw.weeklyScores.map((s) => ({ username: s.fantasyTeam.user.username, rosterPts: s.rosterPts, pickemPts: s.pickemPts, total: s.total, breakdown: s.breakdown, publishedAt: s.publishedAt?.toISOString() ?? null })),
    })),
  };
}

export async function importLeague(leagueId: number, backup: Backup): Promise<{ ok: boolean; error?: string }> {
  if (backup.version !== 3 || !backup.league || !Array.isArray(backup.users)) return { ok: false, error: "Only version 3 league backups can be imported." };
  const target = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!target) return { ok: false, error: "Target league does not exist." };
  if (target.tournamentId !== backup.league.tournamentId) return { ok: false, error: "Backup tournament does not match this league." };
  const rosterIds = [...new Set(backup.fantasyTeams.flatMap((ft) => ft.roster.map((r) => r.playerId)))];
  const found = await prisma.proPlayer.findMany({ where: { id: { in: rosterIds } }, select: { id: true } });
  const foundIds = new Set(found.map((p) => p.id));
  const missing = rosterIds.filter((id) => !foundIds.has(id));
  if (missing.length) return { ok: false, error: `Ingest the referenced player data first: ${missing.slice(0, 5).join(", ")}` };

  await prisma.$transaction(async (tx) => {
    await tx.weeklyScore.deleteMany({ where: { leagueWeek: { leagueId } } });
    await tx.weeklyRosterSlot.deleteMany({ where: { leagueWeek: { leagueId } } });
    await tx.leagueWeek.deleteMany({ where: { leagueId } });
    await tx.crystalBallAnswer.deleteMany({ where: { question: { leagueId } } });
    await tx.crystalBallQuestion.deleteMany({ where: { leagueId } });
    await tx.pickem.deleteMany({ where: { leagueId } });
    await tx.rosterSlot.deleteMany({ where: { fantasyTeam: { leagueId } } });
    await tx.fantasyTeam.deleteMany({ where: { leagueId } });
    await tx.leagueMembership.deleteMany({ where: { leagueId } });
    await tx.league.update({ where: { id: leagueId }, data: {
      scoringConfig: backup.league.scoringConfig, currentWeek: backup.league.currentWeek,
      seasonStatus: backup.league.seasonStatus, crystalBallLockedAt: backup.league.crystalBallLockedAt ? new Date(backup.league.crystalBallLockedAt) : null,
    } });
    const userIds = new Map<string, number>();
    for (const saved of backup.users) {
      const user = await tx.user.upsert({ where: { username: saved.username }, create: { username: saved.username, passwordHash: saved.passwordHash }, update: {} });
      userIds.set(saved.username, user.id);
      await tx.leagueMembership.create({ data: { leagueId, userId: user.id, role: saved.role } });
    }
    const teamIds = new Map<string, number>();
    for (const saved of backup.fantasyTeams) {
      const userId = userIds.get(saved.username); if (!userId) throw new Error(`Unknown user: ${saved.username}`);
      const team = await tx.fantasyTeam.create({ data: { leagueId, userId, name: saved.name, roster: { create: saved.roster } } });
      teamIds.set(saved.username, team.id);
    }
    for (const saved of backup.pickems) {
      const userId = userIds.get(saved.username); if (!userId) continue;
      await tx.pickem.create({ data: { leagueId, userId, matchId: saved.matchId, predictedWinner: saved.predictedWinner, predictedScore: saved.predictedScore } });
    }
    for (const saved of backup.cbQuestions) await tx.crystalBallQuestion.create({ data: {
      leagueId, prompt: saved.prompt, answerType: saved.answerType, points: saved.points, partialRule: saved.partialRule,
      correctAnswer: saved.correctAnswer, partialAnswers: saved.partialAnswers,
      answers: { create: saved.answers.filter((a) => userIds.has(a.username)).map((a) => ({ userId: userIds.get(a.username)!, answer: a.answer })) },
    } });
    for (const saved of backup.leagueWeeks) {
      const week = await tx.week.findUniqueOrThrow({ where: { tournamentId_number: { tournamentId: target.tournamentId, number: saved.weekNumber } } });
      const lw = await tx.leagueWeek.create({ data: { leagueId, weekId: week.id, status: saved.status,
        picksOpenAt: saved.picksOpenAt ? new Date(saved.picksOpenAt) : null, picksLockedAt: saved.picksLockedAt ? new Date(saved.picksLockedAt) : null,
        rosterLockedAt: saved.rosterLockedAt ? new Date(saved.rosterLockedAt) : null, resultsImportedAt: saved.resultsImportedAt ? new Date(saved.resultsImportedAt) : null,
        scoredAt: saved.scoredAt ? new Date(saved.scoredAt) : null, publishedAt: saved.publishedAt ? new Date(saved.publishedAt) : null,
        validationJson: saved.validationJson, validationError: saved.validationError } });
      for (const row of saved.rosters) await tx.weeklyRosterSlot.create({ data: { leagueWeekId: lw.id, fantasyTeamId: teamIds.get(row.username)!, playerId: row.playerId, slot: row.slot } });
      for (const row of saved.scores) await tx.weeklyScore.create({ data: { leagueWeekId: lw.id, fantasyTeamId: teamIds.get(row.username)!, rosterPts: row.rosterPts, pickemPts: row.pickemPts, total: row.total, breakdown: row.breakdown, publishedAt: row.publishedAt ? new Date(row.publishedAt) : null } });
    }
  });
  return { ok: true };
}
