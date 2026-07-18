import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  backupOwnerUsername,
  CURRENT_BACKUP_VERSION,
  parseBackup,
  parseBackupJson,
  type Backup,
} from "./backup-format";

export type { Backup } from "./backup-format";

type BackupDb = typeof prisma | Prisma.TransactionClient;

const transactionOptions = { maxWait: 5_000, timeout: 30_000 };

const slugify = (value: string) =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "league";
const newInviteCode = () => randomBytes(5).toString("base64url").toUpperCase();

function checkpointLabel(value: string): string {
  const label = value.trim();
  if (label.length < 2 || label.length > 80) throw new Error("Checkpoint label must be 2-80 characters");
  return label;
}

export async function exportLeague(leagueId: number, database: BackupDb = prisma): Promise<Backup | null> {
  const league = await database.league.findUnique({
    where: { id: leagueId },
    include: {
      memberships: { include: { user: true }, orderBy: { id: "asc" } },
      fantasyTeams: { include: { user: true, roster: { orderBy: { id: "asc" } }, draftPicks: { orderBy: { overallPick: "asc" } } }, orderBy: { id: "asc" } },
      cbQuestions: { include: { answers: { include: { user: true }, orderBy: { id: "asc" } } }, orderBy: { id: "asc" } },
      leagueWeeks: { include: { week: true, weeklyRosters: { include: { fantasyTeam: { include: { user: true } } }, orderBy: { id: "asc" } }, weeklyScores: { include: { fantasyTeam: { include: { user: true } } }, orderBy: { id: "asc" } } }, orderBy: { weekId: "asc" } },
    },
  });
  if (!league) return null;
  const pickems = await database.pickem.findMany({ where: { leagueId }, include: { user: true }, orderBy: { id: "asc" } });
  return {
    version: CURRENT_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    league: {
      name: league.name, tournamentId: league.tournamentId, scoringConfig: league.scoringConfig,
      currentWeek: league.currentWeek, seasonStatus: league.seasonStatus,
      crystalBallLockedAt: league.crystalBallLockedAt?.toISOString() ?? null, isSimulation: league.isSimulation,
      rostersLockedAt: league.rostersLockedAt?.toISOString() ?? null,
      draftStatus: league.draftStatus,
      draftOrder: league.draftOrder ? (JSON.parse(league.draftOrder) as number[]).map((teamId) => league.fantasyTeams.find((team) => team.id === teamId)?.user.username).filter((name): name is string => Boolean(name)) : [],
      draftCurrentPick: league.draftCurrentPick, draftBudget: league.draftBudget,
      draftPlayerPrice: league.draftPlayerPrice, draftPlayersPerRole: league.draftPlayersPerRole,
      draftPricingMode: league.draftPricingMode,
      draftBudgetGuardEnabled: league.draftBudgetGuardEnabled,
      draftPriceSourceTournamentId: league.draftPriceSourceTournamentId,
      draftPriceSheet: league.draftPriceSheet,
    },
    // Password hashes are deliberately excluded from v7 exports. Restores
    // reconnect memberships to the accounts already present in this database.
    users: league.memberships.map((membership) => ({ username: membership.user.username, role: membership.role, joinedAt: membership.joinedAt.toISOString() })),
    fantasyTeams: league.fantasyTeams.map((team) => ({ username: team.user.username, name: team.name, roster: team.roster.map((slot) => ({ playerId: slot.playerId, slot: slot.slot })) })),
    draftPicks: league.fantasyTeams.flatMap((team) => team.draftPicks.map((pick) => ({ username: team.user.username, playerId: pick.playerId, overallPick: pick.overallPick, round: pick.round, role: pick.role, price: pick.price, pickedAt: pick.pickedAt.toISOString() }))),
    pickems: pickems.map((pick) => ({ username: pick.user.username, matchId: pick.matchId, predictedWinner: pick.predictedWinner, predictedScore: pick.predictedScore, createdAt: pick.createdAt.toISOString(), updatedAt: pick.updatedAt.toISOString() })),
    cbQuestions: league.cbQuestions.map((question) => ({
      prompt: question.prompt, answerType: question.answerType, points: question.points, partialRule: question.partialRule,
      correctAnswer: question.correctAnswer, partialAnswers: question.partialAnswers,
      metricKey: question.metricKey, gradingMode: question.gradingMode, resolverConfig: question.resolverConfig,
      resolvedAnswers: question.resolvedAnswers, resolutionData: question.resolutionData,
      resolvedAt: question.resolvedAt?.toISOString() ?? null,
      answers: question.answers.map((answer) => ({ username: answer.user.username, answer: answer.answer, createdAt: answer.createdAt.toISOString(), updatedAt: answer.updatedAt.toISOString() })),
    })),
    leagueWeeks: league.leagueWeeks.map((leagueWeek) => ({
      weekNumber: leagueWeek.week.number, status: leagueWeek.status,
      picksOpenAt: leagueWeek.picksOpenAt?.toISOString() ?? null, picksLockedAt: leagueWeek.picksLockedAt?.toISOString() ?? null,
      rosterLockedAt: leagueWeek.rosterLockedAt?.toISOString() ?? null, resultsImportedAt: leagueWeek.resultsImportedAt?.toISOString() ?? null,
      scoredAt: leagueWeek.scoredAt?.toISOString() ?? null, publishedAt: leagueWeek.publishedAt?.toISOString() ?? null,
      validationJson: leagueWeek.validationJson, validationError: leagueWeek.validationError,
      rosters: leagueWeek.weeklyRosters.map((slot) => ({ username: slot.fantasyTeam.user.username, playerId: slot.playerId, slot: slot.slot, lockedAt: slot.lockedAt.toISOString() })),
      scores: leagueWeek.weeklyScores.map((score) => ({ username: score.fantasyTeam.user.username, rosterPts: score.rosterPts, pickemPts: score.pickemPts, total: score.total, breakdown: score.breakdown, calculatedAt: score.calculatedAt.toISOString(), publishedAt: score.publishedAt?.toISOString() ?? null })),
    })),
  };
}

async function ownerMembership(database: BackupDb, leagueId: number) {
  return database.leagueMembership.findFirst({
    where: { leagueId, role: "OWNER" },
    include: { user: true, league: true },
  });
}

async function assertManager(database: BackupDb, leagueId: number, actorUserId: number) {
  const actor = await database.user.findUnique({ where: { id: actorUserId }, select: { siteAdmin: true } });
  if (actor?.siteAdmin) return;
  const membership = await database.leagueMembership.findUnique({ where: { leagueId_userId: { leagueId, userId: actorUserId } } });
  if (!membership || !["OWNER", "COMMISSIONER"].includes(membership.role)) throw new Error("Commissioner access required for this league");
}

async function assertOwner(database: BackupDb, leagueId: number, actorUserId: number) {
  const actor = await database.user.findUnique({ where: { id: actorUserId }, select: { siteAdmin: true } });
  if (actor?.siteAdmin) return;
  const membership = await database.leagueMembership.findUnique({ where: { leagueId_userId: { leagueId, userId: actorUserId } } });
  if (membership?.role !== "OWNER") throw new Error("League owner access required");
}

async function storeSnapshot(
  database: Prisma.TransactionClient,
  leagueId: number,
  actorUserId: number,
  label: string,
) {
  const owner = await ownerMembership(database, leagueId);
  if (!owner) throw new Error("League owner is missing; a recovery checkpoint cannot be created");
  const snapshot = await exportLeague(leagueId, database);
  if (!snapshot) throw new Error("League does not exist");
  return database.leagueBackup.create({
    data: {
      originalLeagueId: owner.league.id,
      originalLeagueName: owner.league.name,
      originalLeagueSlug: owner.league.slug,
      tournamentId: owner.league.tournamentId,
      label: checkpointLabel(label),
      snapshotVersion: snapshot.version,
      snapshotJson: JSON.stringify(snapshot),
      ownerUserId: owner.userId,
      createdByUserId: actorUserId,
    },
  });
}

export async function createStoredLeagueBackup(leagueId: number, actorUserId: number, label: string, database = prisma) {
  return database.$transaction(async (tx) => {
    await assertManager(tx, leagueId, actorUserId);
    return storeSnapshot(tx, leagueId, actorUserId, label);
  }, transactionOptions);
}

async function validateReferences(database: BackupDb, tournamentId: string, backup: Backup) {
  const playerIds = [...new Set([
    ...backup.fantasyTeams.flatMap((team) => team.roster.map((slot) => slot.playerId)),
    ...(backup.draftPicks ?? []).map((pick) => pick.playerId),
    ...backup.leagueWeeks.flatMap((week) => week.rosters.map((slot) => slot.playerId)),
  ])];
  const eligiblePlayers = await database.tournamentPlayer.findMany({
    where: { tournamentId, playerId: { in: playerIds } },
    select: { playerId: true },
  });
  const eligibleIds = new Set(eligiblePlayers.map((row) => row.playerId));
  const missingPlayers = playerIds.filter((id) => !eligibleIds.has(id));
  if (missingPlayers.length > 0) throw new Error(`Tournament player data is missing: ${missingPlayers.slice(0, 5).join(", ")}`);

  const matchIds = [...new Set(backup.pickems.map((pick) => pick.matchId))];
  const matches = await database.match.findMany({ where: { tournamentId, id: { in: matchIds } }, select: { id: true } });
  const foundMatches = new Set(matches.map((match) => match.id));
  const missingMatches = matchIds.filter((id) => !foundMatches.has(id));
  if (missingMatches.length > 0) throw new Error(`Tournament match data is missing: ${missingMatches.slice(0, 5).join(", ")}`);

  const weekNumbers = backup.leagueWeeks.map((week) => week.weekNumber);
  const weeks = await database.week.findMany({ where: { tournamentId, number: { in: weekNumbers } }, select: { number: true } });
  const foundWeeks = new Set(weeks.map((week) => week.number));
  const missingWeeks = weekNumbers.filter((number) => !foundWeeks.has(number));
  if (missingWeeks.length > 0) throw new Error(`Tournament weeks are missing: ${missingWeeks.join(", ")}`);
}

async function resolveUsers(database: Prisma.TransactionClient, backup: Backup) {
  const userIds = new Map<string, number>();
  const missingAccounts: string[] = [];
  for (const saved of backup.users) {
    let user = await database.user.findUnique({ where: { username: saved.username } });
    if (!user && saved.passwordHash && backup.version <= 6) {
      user = await database.user.create({ data: { username: saved.username, passwordHash: saved.passwordHash } });
    }
    if (!user) missingAccounts.push(saved.username);
    else userIds.set(saved.username, user.id);
  }
  if (missingAccounts.length > 0) {
    throw new Error(`These accounts must sign up before this backup can be restored: ${missingAccounts.slice(0, 8).join(", ")}`);
  }
  return userIds;
}

async function applyBackup(
  tx: Prisma.TransactionClient,
  leagueId: number,
  tournamentId: string,
  backup: Backup,
) {
  await validateReferences(tx, tournamentId, backup);
  const userIds = await resolveUsers(tx, backup);

  await tx.weeklyScore.deleteMany({ where: { leagueWeek: { leagueId } } });
  await tx.weeklyRosterSlot.deleteMany({ where: { leagueWeek: { leagueId } } });
  await tx.leagueWeek.deleteMany({ where: { leagueId } });
  await tx.crystalBallAnswer.deleteMany({ where: { question: { leagueId } } });
  await tx.crystalBallQuestion.deleteMany({ where: { leagueId } });
  await tx.pickem.deleteMany({ where: { leagueId } });
  await tx.draftPick.deleteMany({ where: { leagueId } });
  await tx.rosterSlot.deleteMany({ where: { fantasyTeam: { leagueId } } });
  await tx.fantasyTeam.deleteMany({ where: { leagueId } });
  await tx.leagueMembership.deleteMany({ where: { leagueId } });
  await tx.league.update({ where: { id: leagueId }, data: {
    scoringConfig: backup.league.scoringConfig, currentWeek: backup.league.currentWeek,
    seasonStatus: backup.league.seasonStatus, isSimulation: backup.league.isSimulation,
    crystalBallLockedAt: backup.league.crystalBallLockedAt ? new Date(backup.league.crystalBallLockedAt) : null,
    rostersLockedAt: backup.league.rostersLockedAt ? new Date(backup.league.rostersLockedAt) : null,
  } });

  for (const saved of backup.users) {
    await tx.leagueMembership.create({ data: { leagueId, userId: userIds.get(saved.username)!, role: saved.role, joinedAt: saved.joinedAt ? new Date(saved.joinedAt) : undefined } });
  }
  const teamIds = new Map<string, number>();
  for (const saved of backup.fantasyTeams) {
    const team = await tx.fantasyTeam.create({ data: { leagueId, userId: userIds.get(saved.username)!, name: saved.name, roster: { create: saved.roster } } });
    teamIds.set(saved.username, team.id);
  }
  const restoredOrder = (backup.league.draftOrder ?? []).map((username) => teamIds.get(username)).filter((id): id is number => id !== undefined);
  await tx.league.update({ where: { id: leagueId }, data: {
    draftStatus: backup.league.draftStatus ?? (backup.fantasyTeams.some((team) => team.roster.length > 0) ? "COMPLETE" : "NOT_STARTED"),
    draftOrder: restoredOrder.length > 0 ? JSON.stringify(restoredOrder) : null,
    draftCurrentPick: backup.league.draftCurrentPick ?? 0,
    draftBudget: backup.league.draftBudget ?? 10_000,
    draftPlayerPrice: backup.league.draftPlayerPrice ?? 1_000,
    draftPlayersPerRole: backup.league.draftPlayersPerRole ?? 2,
    draftPricingMode: backup.league.draftPricingMode ?? "UNIFORM",
    draftBudgetGuardEnabled: backup.league.draftBudgetGuardEnabled ?? true,
    draftPriceSourceTournamentId: backup.league.draftPriceSourceTournamentId ?? null,
    draftPriceSheet: backup.league.draftPriceSheet ?? null,
  } });
  for (const saved of backup.draftPicks ?? []) {
    await tx.draftPick.create({ data: { leagueId, fantasyTeamId: teamIds.get(saved.username)!, playerId: saved.playerId, overallPick: saved.overallPick, round: saved.round, role: saved.role, price: saved.price, pickedAt: new Date(saved.pickedAt) } });
  }
  for (const saved of backup.pickems) {
    await tx.pickem.create({ data: { leagueId, userId: userIds.get(saved.username)!, matchId: saved.matchId, predictedWinner: saved.predictedWinner, predictedScore: saved.predictedScore, createdAt: saved.createdAt ? new Date(saved.createdAt) : undefined, updatedAt: saved.updatedAt ? new Date(saved.updatedAt) : undefined } });
  }
  for (const saved of backup.cbQuestions) {
    await tx.crystalBallQuestion.create({ data: {
      leagueId, prompt: saved.prompt, answerType: saved.answerType, points: saved.points, partialRule: saved.partialRule,
      correctAnswer: saved.correctAnswer, partialAnswers: saved.partialAnswers,
      metricKey: saved.metricKey ?? null, gradingMode: saved.gradingMode ?? "EXACT", resolverConfig: saved.resolverConfig ?? null,
      resolvedAnswers: saved.resolvedAnswers ?? null, resolutionData: saved.resolutionData ?? null,
      resolvedAt: saved.resolvedAt ? new Date(saved.resolvedAt) : null,
      answers: { create: saved.answers.map((answer) => ({ userId: userIds.get(answer.username)!, answer: answer.answer, createdAt: answer.createdAt ? new Date(answer.createdAt) : undefined, updatedAt: answer.updatedAt ? new Date(answer.updatedAt) : undefined })) },
    } });
  }
  for (const saved of backup.leagueWeeks) {
    const week = await tx.week.findUniqueOrThrow({ where: { tournamentId_number: { tournamentId, number: saved.weekNumber } } });
    const leagueWeek = await tx.leagueWeek.create({ data: {
      leagueId, weekId: week.id, status: saved.status,
      picksOpenAt: saved.picksOpenAt ? new Date(saved.picksOpenAt) : null,
      picksLockedAt: saved.picksLockedAt ? new Date(saved.picksLockedAt) : null,
      rosterLockedAt: saved.rosterLockedAt ? new Date(saved.rosterLockedAt) : null,
      resultsImportedAt: saved.resultsImportedAt ? new Date(saved.resultsImportedAt) : null,
      scoredAt: saved.scoredAt ? new Date(saved.scoredAt) : null,
      publishedAt: saved.publishedAt ? new Date(saved.publishedAt) : null,
      validationJson: saved.validationJson, validationError: saved.validationError,
    } });
    for (const row of saved.rosters) {
      await tx.weeklyRosterSlot.create({ data: { leagueWeekId: leagueWeek.id, fantasyTeamId: teamIds.get(row.username)!, playerId: row.playerId, slot: row.slot, lockedAt: row.lockedAt ? new Date(row.lockedAt) : undefined } });
    }
    for (const row of saved.scores) {
      await tx.weeklyScore.create({ data: { leagueWeekId: leagueWeek.id, fantasyTeamId: teamIds.get(row.username)!, rosterPts: row.rosterPts, pickemPts: row.pickemPts, total: row.total, breakdown: row.breakdown, calculatedAt: row.calculatedAt ? new Date(row.calculatedAt) : undefined, publishedAt: row.publishedAt ? new Date(row.publishedAt) : null } });
    }
  }
}

export async function importLeague(
  leagueId: number,
  input: unknown,
  actorUserId: number,
  database = prisma,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const backup = parseBackup(input);
    await database.$transaction(async (tx) => {
      await assertOwner(tx, leagueId, actorUserId);
      const target = await tx.league.findUniqueOrThrow({ where: { id: leagueId } });
      if (target.tournamentId !== backup.league.tournamentId) throw new Error("Backup tournament does not match this league");
      const actor = await tx.user.findUniqueOrThrow({ where: { id: actorUserId } });
      if (backupOwnerUsername(backup) !== actor.username && !actor.siteAdmin) {
        throw new Error("The signed-in owner must also be the owner recorded in the backup");
      }
      await storeSnapshot(tx, leagueId, actorUserId, "Automatic safety checkpoint before file import");
      await applyBackup(tx, leagueId, target.tournamentId, backup);
    }, transactionOptions);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Backup import failed" };
  }
}

export async function restoreStoredBackupOverLeague(backupId: number, leagueId: number, actorUserId: number, database = prisma) {
  return database.$transaction(async (tx) => {
    await assertOwner(tx, leagueId, actorUserId);
    const [row, target, actor] = await Promise.all([
      tx.leagueBackup.findUniqueOrThrow({ where: { id: backupId } }),
      tx.league.findUniqueOrThrow({ where: { id: leagueId } }),
      tx.user.findUniqueOrThrow({ where: { id: actorUserId } }),
    ]);
    if (!actor.siteAdmin && row.ownerUserId !== actorUserId) throw new Error("You do not own this checkpoint");
    if (row.originalLeagueId !== leagueId) throw new Error("This checkpoint belongs to a different league");
    if (row.tournamentId !== target.tournamentId) throw new Error("Checkpoint tournament does not match this league");
    const backup = parseBackupJson(row.snapshotJson);
    if (!actor.siteAdmin && backupOwnerUsername(backup) !== actor.username) throw new Error("Checkpoint owner does not match your account");
    await storeSnapshot(tx, leagueId, actorUserId, "Automatic safety checkpoint before rollback");
    await applyBackup(tx, leagueId, target.tournamentId, backup);
    await tx.leagueBackup.update({ where: { id: row.id }, data: { restoredAt: new Date(), restoredLeagueId: leagueId } });
    return target;
  }, transactionOptions);
}

async function uniqueRestoredSlug(tx: Prisma.TransactionClient, preferred: string) {
  const base = slugify(preferred);
  let slug = base;
  let suffix = 2;
  while (await tx.league.findUnique({ where: { slug }, select: { id: true } })) slug = `${base}-${suffix++}`;
  return slug;
}

async function uniqueInviteCode(tx: Prisma.TransactionClient) {
  let inviteCode = newInviteCode();
  while (await tx.league.findUnique({ where: { inviteCode }, select: { id: true } })) inviteCode = newInviteCode();
  return inviteCode;
}

export async function restoreStoredBackupAsLeague(backupId: number, actorUserId: number, database = prisma) {
  return database.$transaction(async (tx) => {
    const [row, actor] = await Promise.all([
      tx.leagueBackup.findUniqueOrThrow({ where: { id: backupId } }),
      tx.user.findUniqueOrThrow({ where: { id: actorUserId } }),
    ]);
    if (!actor.siteAdmin && row.ownerUserId !== actorUserId) throw new Error("You do not own this checkpoint");
    if (row.restoredLeagueId) {
      const existing = await tx.league.findUnique({ where: { id: row.restoredLeagueId }, select: { id: true } });
      if (existing) throw new Error("This checkpoint has already been restored; open the restored league instead");
    }
    const backup = parseBackupJson(row.snapshotJson);
    if (!actor.siteAdmin && backupOwnerUsername(backup) !== actor.username) throw new Error("Checkpoint owner does not match your account");
    if (!await tx.tournament.findUnique({ where: { id: backup.league.tournamentId }, select: { id: true } })) {
      throw new Error("The checkpoint's LCK tournament data is not available");
    }
    const slug = await uniqueRestoredSlug(tx, row.originalLeagueSlug || backup.league.name);
    const inviteCode = await uniqueInviteCode(tx);
    const league = await tx.league.create({ data: {
      name: backup.league.name,
      slug,
      inviteCode,
      tournamentId: backup.league.tournamentId,
      scoringConfig: backup.league.scoringConfig,
      isSimulation: backup.league.isSimulation,
    } });
    await applyBackup(tx, league.id, league.tournamentId, backup);
    await tx.leagueBackup.update({ where: { id: row.id }, data: { restoredAt: new Date(), restoredLeagueId: league.id } });
    return league;
  }, transactionOptions);
}

export async function deleteLeagueWithRecovery(leagueId: number, actorUserId: number, database = prisma) {
  return database.$transaction(async (tx) => {
    await assertOwner(tx, leagueId, actorUserId);
    const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId } });
    const recovery = await storeSnapshot(tx, leagueId, actorUserId, "Automatic recovery checkpoint before deletion");
    const deletedAt = new Date();
    await tx.leagueBackup.updateMany({ where: { originalLeagueId: leagueId }, data: { sourceDeletedAt: deletedAt } });
    await tx.league.delete({ where: { id: leagueId } });
    return { league, recoveryBackupId: recovery.id };
  }, transactionOptions);
}

export async function deleteStoredLeagueBackup(backupId: number, actorUserId: number, database = prisma) {
  const actor = await database.user.findUniqueOrThrow({ where: { id: actorUserId } });
  const backup = await database.leagueBackup.findUniqueOrThrow({ where: { id: backupId } });
  if (!actor.siteAdmin && backup.ownerUserId !== actorUserId) throw new Error("You do not own this checkpoint");
  await database.leagueBackup.delete({ where: { id: backup.id } });
}
