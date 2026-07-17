"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireLeagueManager } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { calculateWeeklyScores, ensureLeagueWeeks, snapshotWeeklyRosters, validateLeagueWeek } from "@/lib/season";
import { DEFAULT_SCORING } from "@/lib/scoring";
import { runLeaguepediaIngest } from "@/scripts/ingest";

async function authorizedWeek(id: number) {
  const week = await prisma.leagueWeek.findUniqueOrThrow({ where: { id }, include: { league: true, week: true } });
  await requireLeagueManager(week.leagueId);
  return week;
}

const SLOT_ROLE: Record<string, string> = { TOP: "Top", JNG: "Jungle", MID: "Mid", BOT: "Bot", SUP: "Support" };

function revalidateDataPages() {
  for (const path of ["/", "/commissioner", "/picks", "/stats", "/participants", "/leaderboard"]) {
    revalidatePath(path);
  }
}

function commissionerRedirect(kind: "notice" | "error", message: string): never {
  const params = new URLSearchParams({ [kind]: message.slice(0, 300) });
  redirect(`/commissioner?${params.toString()}`);
}

async function runNextWeekIngest(leagueId: number, scheduleOnly: boolean) {
  await requireLeagueManager(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  if (league.seasonStatus === "FINAL") throw new Error("The season is already final");
  const weekNumber = league.currentWeek + 1;
  let week = await prisma.week.findUnique({ where: { tournamentId_number: { tournamentId: league.tournamentId, number: weekNumber } } });
  if (!scheduleOnly) {
    if (!week) throw new Error(`Fetch the Week ${weekNumber} schedule before fetching results`);
    const leagueWeek = await prisma.leagueWeek.findUnique({ where: { leagueId_weekId: { leagueId, weekId: week.id } } });
    if (!leagueWeek || !["LOCKED", "RESULTS_IMPORTED"].includes(leagueWeek.status)) {
      throw new Error(`Lock Week ${weekNumber} picks and rosters before fetching results`);
    }
  }
  const globallyReady = scheduleOnly ? Boolean(week?.scheduleImportedAt) : Boolean(week?.resultsImportedAt);
  const counts = globallyReady ? {
    matches: await prisma.match.count({ where: { weekId: week!.id } }),
    games: await prisma.game.count({ where: { match: { weekId: week!.id } } }),
    players: 0,
    rosterPlayers: await prisma.tournamentPlayer.count({ where: { tournamentId: league.tournamentId } }),
    playerStats: await prisma.playerGameStat.count({ where: { game: { match: { weekId: week!.id } } } }),
    draftActions: await prisma.draftAction.count({ where: { game: { match: { weekId: week!.id } } } }),
  } : await runLeaguepediaIngest({ overviewPage: league.tournamentId, weekNumber, scheduleOnly });
  week = await prisma.week.findUniqueOrThrow({ where: { tournamentId_number: { tournamentId: league.tournamentId, number: weekNumber } } });
  if (scheduleOnly) {
    const existingOpen = await prisma.leagueWeek.findFirst({ where: { leagueId, status: "OPEN" } });
    await prisma.leagueWeek.upsert({
      where: { leagueId_weekId: { leagueId, weekId: week.id } },
      create: { leagueId, weekId: week.id, status: existingOpen ? "UPCOMING" : "OPEN", ...(existingOpen ? {} : { picksOpenAt: new Date() }) },
      update: {},
    });
  } else {
    const leagueWeek = await prisma.leagueWeek.findUniqueOrThrow({ where: { leagueId_weekId: { leagueId, weekId: week.id } } });
    await prisma.leagueWeek.update({ where: { id: leagueWeek.id }, data: { status: "RESULTS_IMPORTED", resultsImportedAt: new Date() } });
  }
  revalidateDataPages();
  return { weekNumber, counts, reused: globallyReady };
}

export async function fetchNextWeekSchedule(formData: FormData) {
  let result: Awaited<ReturnType<typeof runNextWeekIngest>>;
  try {
    result = await runNextWeekIngest(Number(formData.get("leagueId")), true);
  } catch (error) {
    commissionerRedirect("error", error instanceof Error ? error.message : String(error));
  }
  commissionerRedirect(
    "notice",
    `Week ${result.weekNumber} schedule ready${result.reused ? " (reused shared LCK data)" : ""}: ${result.counts.matches} matches and ${result.counts.rosterPlayers} eligible players.`,
  );
}

export async function fetchNextWeekResults(formData: FormData) {
  let result: Awaited<ReturnType<typeof runNextWeekIngest>>;
  try {
    result = await runNextWeekIngest(Number(formData.get("leagueId")), false);
  } catch (error) {
    commissionerRedirect("error", error instanceof Error ? error.message : String(error));
  }
  commissionerRedirect(
    "notice",
    `Week ${result.weekNumber} results ready${result.reused ? " (reused shared LCK data)" : ""}: ${result.counts.games} games, ${result.counts.playerStats} player lines, and ${result.counts.draftActions} draft actions.`,
  );
}

export async function initializeWeeks(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  await requireLeagueManager(leagueId);
  await ensureLeagueWeeks(leagueId);
  revalidatePath("/commissioner");
}

export async function openWeek(formData: FormData) {
  const lw = await authorizedWeek(Number(formData.get("leagueWeekId")));
  if (!['UPCOMING', 'OPEN'].includes(lw.status)) throw new Error("Only an upcoming week can be opened");
  if (lw.week.number !== lw.league.currentWeek + 1) {
    throw new Error(`Week ${lw.league.currentWeek + 1} must be opened next`);
  }
  const unfinishedPrior = await prisma.leagueWeek.count({
    where: { leagueId: lw.leagueId, week: { number: { lt: lw.week.number } }, status: { not: "PUBLISHED" } },
  });
  if (unfinishedPrior > 0) throw new Error("Publish every prior week before opening this one");
  const otherOpen = await prisma.leagueWeek.findFirst({
    where: { leagueId: lw.leagueId, status: "OPEN", NOT: { id: lw.id } },
  });
  if (otherOpen) throw new Error("Publish or lock the currently open week first");
  await prisma.leagueWeek.update({ where: { id: lw.id }, data: { status: "OPEN", picksOpenAt: new Date() } });
  revalidatePath("/commissioner");
  revalidatePath("/picks");
}

export async function lockWeek(formData: FormData) {
  const lw = await authorizedWeek(Number(formData.get("leagueWeekId")));
  if (lw.status !== "OPEN") throw new Error("Only an open week can be locked");
  if (lw.week.number === 1) {
    const teams = await prisma.fantasyTeam.count({ where: { leagueId: lw.leagueId } });
    if (teams > 0 && lw.league.draftStatus !== "COMPLETE") throw new Error("Complete the Week 0 roster draft before locking Week 1");
  }
  await snapshotWeeklyRosters(lw.id);
  const now = new Date();
  await prisma.$transaction([
    prisma.leagueWeek.update({
      where: { id: lw.id },
      data: { status: "LOCKED", picksLockedAt: now, rosterLockedAt: now },
    }),
    prisma.league.update({
      where: { id: lw.leagueId },
      data: {
        seasonStatus: "ACTIVE",
        ...(lw.week.number === 1 && !lw.league.crystalBallLockedAt ? { crystalBallLockedAt: now } : {}),
      },
    }),
  ]);
  revalidatePath("/commissioner");
  revalidatePath("/picks");
  revalidatePath("/crystal-ball");
}

export async function validateAndScoreWeek(formData: FormData) {
  const lw = await authorizedWeek(Number(formData.get("leagueWeekId")));
  if (!['RESULTS_IMPORTED', 'SCORED'].includes(lw.status)) throw new Error("Fetch the week's results before scoring it");
  const result = await validateLeagueWeek(lw.id);
  if (!result.ok) {
    await prisma.leagueWeek.update({
      where: { id: lw.id },
      data: { validationJson: JSON.stringify(result), validationError: result.errors.join("; ") },
    });
    revalidatePath("/commissioner");
    return;
  }
  if ((await prisma.weeklyRosterSlot.count({ where: { leagueWeekId: lw.id } })) === 0) {
    await snapshotWeeklyRosters(lw.id);
  }
  await prisma.leagueWeek.update({
    where: { id: lw.id },
    data: { status: "RESULTS_IMPORTED", resultsImportedAt: new Date(), validationJson: JSON.stringify(result), validationError: null },
  });
  await calculateWeeklyScores(lw.id);
  await prisma.leagueWeek.update({ where: { id: lw.id }, data: { status: "SCORED", scoredAt: new Date() } });
  revalidatePath("/commissioner");
  revalidatePath("/leaderboard");
}

export async function publishWeek(formData: FormData) {
  const lw = await authorizedWeek(Number(formData.get("leagueWeekId")));
  if (lw.status !== "SCORED") throw new Error("Validate and score the week before publishing it");
  const next = await prisma.leagueWeek.findFirst({
    where: { leagueId: lw.leagueId, week: { number: { gt: lw.week.number } } },
    orderBy: { week: { number: "asc" } },
    include: { week: true },
  });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.weeklyScore.updateMany({ where: { leagueWeekId: lw.id }, data: { publishedAt: now } });
    await tx.leagueWeek.update({ where: { id: lw.id }, data: { status: "PUBLISHED", publishedAt: now } });
    if (next) {
      await tx.leagueWeek.update({ where: { id: next.id }, data: { status: "OPEN", picksOpenAt: now } });
      await tx.league.update({ where: { id: lw.leagueId }, data: { currentWeek: lw.week.number, seasonStatus: "ACTIVE" } });
    } else {
      // In a week-by-week database, the next Week row may not exist until its
      // schedule is pulled. Finishing the season is therefore an explicit action.
      await tx.league.update({ where: { id: lw.leagueId }, data: { currentWeek: lw.week.number, seasonStatus: "ACTIVE" } });
    }
  });
  revalidatePath("/commissioner");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
}

export async function finishSeason(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  await requireLeagueManager(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const unfinished = await prisma.leagueWeek.count({ where: { leagueId, status: { not: "PUBLISHED" } } });
  const published = await prisma.leagueWeek.count({ where: { leagueId, status: "PUBLISHED" } });
  if (unfinished > 0 || published === 0) throw new Error("Publish every imported week before finishing the season");
  await prisma.league.update({ where: { id: league.id }, data: { seasonStatus: "FINAL" } });
  revalidatePath("/commissioner");
  revalidatePath("/leaderboard");
}

export async function updateRosterSlot(formData: FormData) {
  const rosterSlotId = Number(formData.get("rosterSlotId"));
  const playerId = String(formData.get("playerId"));
  const slot = await prisma.rosterSlot.findUniqueOrThrow({
    where: { id: rosterSlotId },
    include: { fantasyTeam: { include: { league: true } } },
  });
  await requireLeagueManager(slot.fantasyTeam.leagueId);
  if (slot.fantasyTeam.league.currentWeek === 0) throw new Error("Week 0 rosters can only be changed through the snake draft");
  const rosterWindow = await prisma.leagueWeek.findFirst({ where: { leagueId: slot.fantasyTeam.leagueId, status: "OPEN" } });
  if (!rosterWindow || rosterWindow.rosterLockedAt) throw new Error("Roster changes are only allowed while next week's slate is open");
  const eligibility = await prisma.tournamentPlayer.findUnique({
    where: { tournamentId_playerId: { tournamentId: slot.fantasyTeam.league.tournamentId, playerId } },
    include: { player: true },
  });
  if (!eligibility) throw new Error("Player is not eligible for this league");
  if (SLOT_ROLE[slot.slot] && (eligibility.role ?? eligibility.player.role) !== SLOT_ROLE[slot.slot]) throw new Error(`Player must be a ${SLOT_ROLE[slot.slot]}`);
  const duplicate = await prisma.rosterSlot.findFirst({
    where: { fantasyTeamId: slot.fantasyTeamId, playerId, NOT: { id: slot.id } },
  });
  if (duplicate) throw new Error("That player is already on this roster");
  await prisma.rosterSlot.update({ where: { id: slot.id }, data: { playerId } });
  revalidatePath("/commissioner/rosters");
}

export async function addRosterSlot(formData: FormData) {
  const fantasyTeamId = Number(formData.get("fantasyTeamId"));
  const playerId = String(formData.get("playerId"));
  const slotName = String(formData.get("slot"));
  if (!['TOP', 'JNG', 'MID', 'BOT', 'SUP', 'BENCH'].includes(slotName)) throw new Error("Invalid roster slot");
  const team = await prisma.fantasyTeam.findUniqueOrThrow({ where: { id: fantasyTeamId }, include: { league: true } });
  await requireLeagueManager(team.leagueId);
  if (team.league.currentWeek === 0) throw new Error("Week 0 rosters can only be changed through the snake draft");
  const rosterWindow = await prisma.leagueWeek.findFirst({ where: { leagueId: team.leagueId, status: "OPEN" } });
  if (!rosterWindow || rosterWindow.rosterLockedAt) throw new Error("Roster changes are only allowed while next week's slate is open");
  const existingSlot = await prisma.rosterSlot.findFirst({ where: { fantasyTeamId, slot: slotName } });
  if (existingSlot) throw new Error(`${slotName} is already filled`);
  const eligibility = await prisma.tournamentPlayer.findUnique({ where: { tournamentId_playerId: { tournamentId: team.league.tournamentId, playerId } }, include: { player: true } });
  if (!eligibility) throw new Error("Player is not eligible for this league");
  if (SLOT_ROLE[slotName] && (eligibility.role ?? eligibility.player.role) !== SLOT_ROLE[slotName]) throw new Error(`Player must be a ${SLOT_ROLE[slotName]}`);
  if (await prisma.rosterSlot.findFirst({ where: { fantasyTeamId, playerId } })) throw new Error("That player is already on this roster");
  await prisma.rosterSlot.create({ data: { fantasyTeamId, playerId, slot: slotName } });
  revalidatePath("/commissioner/rosters");
}

export async function updateScoringConfig(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  await requireLeagueManager(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const published = await prisma.leagueWeek.count({ where: { leagueId, status: "PUBLISHED" } });
  if (published > 0) throw new Error("Scoring cannot change after the first week is published");
  const raw = String(formData.get("scoringConfig") ?? "");
  const parsed = JSON.parse(raw) as { player?: Record<string, unknown>; pickem?: Record<string, unknown> };
  for (const [section, defaults] of Object.entries(DEFAULT_SCORING)) {
    const supplied = parsed[section as keyof typeof parsed];
    if (!supplied) throw new Error(`Missing scoring section: ${section}`);
    for (const key of Object.keys(defaults)) {
      if (typeof supplied[key] !== "number" || !Number.isFinite(supplied[key])) throw new Error(`Invalid scoring value: ${section}.${key}`);
    }
  }
  await prisma.league.update({ where: { id: league.id }, data: { scoringConfig: JSON.stringify(parsed) } });
  revalidatePath("/commissioner");
  revalidatePath("/settings");
}

export async function gradeCrystalBall(formData: FormData) {
  const questionId = Number(formData.get("questionId"));
  const question = await prisma.crystalBallQuestion.findUniqueOrThrow({ where: { id: questionId } });
  await requireLeagueManager(question.leagueId);
  const correctAnswer = String(formData.get("correctAnswer") ?? "").trim();
  const partialAnswers = String(formData.get("partialAnswers") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!correctAnswer) throw new Error("A correct answer is required");
  await prisma.crystalBallQuestion.update({
    where: { id: questionId },
    data: { correctAnswer, partialAnswers: JSON.stringify(partialAnswers) },
  });
  revalidatePath("/commissioner");
  revalidatePath("/leaderboard");
}
