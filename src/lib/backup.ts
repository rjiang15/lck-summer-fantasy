// Export/import of the fantasy side of the DB (league, users, rosters,
// pickems, crystal ball). Esports data (games/stats) is NOT included — that
// always re-ingests from Leaguepedia / Oracle's Elixir.
// Everything is keyed by username / external ids so a backup restores cleanly
// into a fresh database.

import { prisma } from "./db";

export interface Backup {
  version: 1 | 2;
  exportedAt: string;
  league: {
    name: string;
    inviteCode: string;
    tournamentId: string;
    scoringConfig: string;
    currentWeek?: number;
    seasonStatus?: string;
    crystalBallLockedAt?: string | null;
    isSimulation?: boolean;
  };
  users: { username: string; passwordHash: string; isCommish: boolean }[];
  fantasyTeams: {
    username: string;
    name: string;
    roster: { playerId: string; slot: string }[];
  }[];
  pickems: {
    username: string;
    matchId: string;
    predictedWinner: string;
    predictedScore: string | null;
  }[];
  cbQuestions: {
    prompt: string;
    answerType: string;
    points: number;
    partialRule: string | null;
    correctAnswer: string | null;
    partialAnswers: string | null;
    answers: { username: string; answer: string }[];
  }[];
  leagueWeeks?: {
    weekNumber: number;
    status: string;
    picksOpenAt: string | null;
    picksLockedAt: string | null;
    rosterLockedAt: string | null;
    resultsImportedAt: string | null;
    scoredAt: string | null;
    publishedAt: string | null;
    validationJson: string | null;
    validationError: string | null;
    rosters: { username: string; playerId: string; slot: string }[];
    scores: { username: string; rosterPts: number; pickemPts: number; total: number; breakdown: string; publishedAt: string | null }[];
  }[];
}

export async function exportLeague(): Promise<Backup | null> {
  const league = await prisma.league.findFirst({
    include: {
      fantasyTeams: { include: { user: true, roster: true } },
      cbQuestions: { include: { answers: { include: { user: true } } } },
      leagueWeeks: {
        include: {
          week: true,
          weeklyRosters: { include: { fantasyTeam: { include: { user: true } } } },
          weeklyScores: { include: { fantasyTeam: { include: { user: true } } } },
        },
      },
    },
  });
  if (!league) return null;
  const users = await prisma.user.findMany();
  const pickems = await prisma.pickem.findMany({ include: { user: true } });

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    league: {
      name: league.name,
      inviteCode: league.inviteCode,
      tournamentId: league.tournamentId,
      scoringConfig: league.scoringConfig,
      currentWeek: league.currentWeek,
      seasonStatus: league.seasonStatus,
      crystalBallLockedAt: league.crystalBallLockedAt?.toISOString() ?? null,
      isSimulation: league.isSimulation,
    },
    users: users.map((u) => ({
      username: u.username,
      passwordHash: u.passwordHash,
      isCommish: u.isCommish,
    })),
    fantasyTeams: league.fantasyTeams.map((ft) => ({
      username: ft.user.username,
      name: ft.name,
      roster: ft.roster.map((r) => ({ playerId: r.playerId, slot: r.slot })),
    })),
    pickems: pickems.map((p) => ({
      username: p.user.username,
      matchId: p.matchId,
      predictedWinner: p.predictedWinner,
      predictedScore: p.predictedScore,
    })),
    cbQuestions: league.cbQuestions.map((q) => ({
      prompt: q.prompt,
      answerType: q.answerType,
      points: q.points,
      partialRule: q.partialRule,
      correctAnswer: q.correctAnswer,
      partialAnswers: q.partialAnswers,
      answers: q.answers.map((a) => ({ username: a.user.username, answer: a.answer })),
    })),
    leagueWeeks: league.leagueWeeks.map((lw) => ({
      weekNumber: lw.week.number,
      status: lw.status,
      picksOpenAt: lw.picksOpenAt?.toISOString() ?? null,
      picksLockedAt: lw.picksLockedAt?.toISOString() ?? null,
      rosterLockedAt: lw.rosterLockedAt?.toISOString() ?? null,
      resultsImportedAt: lw.resultsImportedAt?.toISOString() ?? null,
      scoredAt: lw.scoredAt?.toISOString() ?? null,
      publishedAt: lw.publishedAt?.toISOString() ?? null,
      validationJson: lw.validationJson,
      validationError: lw.validationError,
      rosters: lw.weeklyRosters.map((slot) => ({
        username: slot.fantasyTeam.user.username, playerId: slot.playerId, slot: slot.slot,
      })),
      scores: lw.weeklyScores.map((score) => ({
        username: score.fantasyTeam.user.username,
        rosterPts: score.rosterPts,
        pickemPts: score.pickemPts,
        total: score.total,
        breakdown: score.breakdown,
        publishedAt: score.publishedAt?.toISOString() ?? null,
      })),
    })),
  };
}

/** Replaces ALL fantasy-side data with the backup's contents. */
export async function importLeague(backup: Backup): Promise<{ ok: boolean; error?: string }> {
  if (![1, 2].includes(backup.version) || !backup.league || !Array.isArray(backup.users)) {
    return { ok: false, error: "Not a valid backup file (missing version/league/users)." };
  }

  // Referenced pro players must exist (esports data is not part of the backup)
  const rosterPlayerIds = new Set(
    backup.fantasyTeams.flatMap((ft) => ft.roster.map((r) => r.playerId)),
  );
  const found = await prisma.proPlayer.findMany({
    where: { id: { in: [...rosterPlayerIds] } },
    select: { id: true },
  });
  const missing = [...rosterPlayerIds].filter((id) => !found.some((f) => f.id === id));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Roster references players not in the database (ingest the split first): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany();
    await tx.weeklyScore.deleteMany();
    await tx.weeklyRosterSlot.deleteMany();
    await tx.leagueWeek.deleteMany();
    await tx.crystalBallAnswer.deleteMany();
    await tx.crystalBallQuestion.deleteMany();
    await tx.pickem.deleteMany();
    await tx.rosterSlot.deleteMany();
    await tx.fantasyTeam.deleteMany();
    await tx.league.deleteMany();
    await tx.user.deleteMany();

    const league = await tx.league.create({
      data: {
        name: backup.league.name,
        inviteCode: backup.league.inviteCode,
        tournamentId: backup.league.tournamentId,
        scoringConfig: backup.league.scoringConfig,
        currentWeek: backup.league.currentWeek ?? 0,
        seasonStatus: backup.league.seasonStatus ?? "PRESEASON",
        crystalBallLockedAt: backup.league.crystalBallLockedAt ? new Date(backup.league.crystalBallLockedAt) : null,
        isSimulation: backup.league.isSimulation ?? false,
      },
    });
    const userIdByName = new Map<string, number>();
    const fantasyTeamIdByName = new Map<string, number>();
    for (const u of backup.users) {
      const created = await tx.user.create({ data: u });
      userIdByName.set(u.username, created.id);
    }
    for (const ft of backup.fantasyTeams) {
      const userId = userIdByName.get(ft.username);
      if (userId === undefined) throw new Error(`Unknown user in fantasyTeams: ${ft.username}`);
      const created = await tx.fantasyTeam.create({
        data: {
          leagueId: league.id,
          userId,
          name: ft.name,
          roster: { create: ft.roster },
        },
      });
      fantasyTeamIdByName.set(ft.username, created.id);
    }
    for (const p of backup.pickems) {
      const userId = userIdByName.get(p.username);
      if (userId === undefined) continue;
      await tx.pickem.create({
        data: {
          userId,
          matchId: p.matchId,
          predictedWinner: p.predictedWinner,
          predictedScore: p.predictedScore,
        },
      });
    }
    for (const q of backup.cbQuestions) {
      await tx.crystalBallQuestion.create({
        data: {
          leagueId: league.id,
          prompt: q.prompt,
          answerType: q.answerType,
          points: q.points,
          partialRule: q.partialRule,
          correctAnswer: q.correctAnswer,
          partialAnswers: q.partialAnswers,
          answers: {
            create: q.answers
              .filter((a) => userIdByName.has(a.username))
              .map((a) => ({ userId: userIdByName.get(a.username)!, answer: a.answer })),
          },
        },
      });
    }
    for (const saved of backup.leagueWeeks ?? []) {
      const week = await tx.week.findUnique({
        where: { tournamentId_number: { tournamentId: league.tournamentId, number: saved.weekNumber } },
      });
      if (!week) throw new Error(`Backup references missing week ${saved.weekNumber}`);
      const leagueWeek = await tx.leagueWeek.create({
        data: {
          leagueId: league.id,
          weekId: week.id,
          status: saved.status,
          picksOpenAt: saved.picksOpenAt ? new Date(saved.picksOpenAt) : null,
          picksLockedAt: saved.picksLockedAt ? new Date(saved.picksLockedAt) : null,
          rosterLockedAt: saved.rosterLockedAt ? new Date(saved.rosterLockedAt) : null,
          resultsImportedAt: saved.resultsImportedAt ? new Date(saved.resultsImportedAt) : null,
          scoredAt: saved.scoredAt ? new Date(saved.scoredAt) : null,
          publishedAt: saved.publishedAt ? new Date(saved.publishedAt) : null,
          validationJson: saved.validationJson,
          validationError: saved.validationError,
        },
      });
      for (const slot of saved.rosters) {
        const fantasyTeamId = fantasyTeamIdByName.get(slot.username);
        if (fantasyTeamId === undefined) throw new Error(`Unknown roster owner: ${slot.username}`);
        await tx.weeklyRosterSlot.create({
          data: { leagueWeekId: leagueWeek.id, fantasyTeamId, playerId: slot.playerId, slot: slot.slot },
        });
      }
      for (const score of saved.scores) {
        const fantasyTeamId = fantasyTeamIdByName.get(score.username);
        if (fantasyTeamId === undefined) throw new Error(`Unknown score owner: ${score.username}`);
        await tx.weeklyScore.create({
          data: {
            leagueWeekId: leagueWeek.id, fantasyTeamId, rosterPts: score.rosterPts,
            pickemPts: score.pickemPts, total: score.total, breakdown: score.breakdown,
            publishedAt: score.publishedAt ? new Date(score.publishedAt) : null,
          },
        });
      }
    }
  });
  return { ok: true };
}
