"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireLeagueManager } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isIngestionRunStale } from "@/lib/ingestion-progress";
import { calculateWeeklyScores, ensureLeagueWeeks, snapshotWeeklyRosters, validateLeagueWeek } from "@/lib/season";
import { DEFAULT_SCORING } from "@/lib/scoring";
import { settleCrystalBall } from "@/lib/crystal-ball";
import { runLeaguepediaIngest } from "@/scripts/ingest";
import { runGamesOfLegendsIngest } from "@/scripts/ingest-gol";
import { rosterLockError } from "@/lib/roster-readiness";
import {
  areWeekSeriesResultsComplete,
  canManageFutureRosters,
  canOpenWeekPicks,
  canUnlockWeekPicks,
  shouldOpenNextWeekOnPublication,
} from "@/lib/week-progression";

async function futureRosterManagementAvailable(leagueId: number, currentWeek: number) {
  if (currentWeek > 0) return true;
  const latestOpened = await prisma.leagueWeek.findFirst({
    where: { leagueId, picksOpenAt: { not: null } },
    orderBy: { week: { number: "desc" } },
    select: { week: { select: { number: true } } },
  });
  return canManageFutureRosters(currentWeek, latestOpened?.week.number ?? null);
}

async function authorizedWeek(id: number) {
  const week = await prisma.leagueWeek.findUniqueOrThrow({
    where: { id },
    include: {
      league: true,
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
    },
  });
  await requireLeagueManager(week.leagueId);
  return week;
}

async function runningWeekIngestion(tournamentId: string, weekNumber: number) {
  return prisma.ingestionRun.findFirst({
    where: { tournamentId, weekNumber, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
}

async function assertNoWeekIngestion(tournamentId: string, weekNumber: number) {
  const run = await runningWeekIngestion(tournamentId, weekNumber);
  if (run) {
    throw new Error("Week " + weekNumber + " has an active data import. Wait for it to finish before changing the weekly lifecycle.");
  }
}

async function weekSubmissionReadiness(leagueId: number, weekId: number, weekNumber: number) {
  const [teams, matchCount, picks, questions] = await Promise.all([
    prisma.fantasyTeam.findMany({ where: { leagueId }, select: { userId: true, user: { select: { username: true } } } }),
    prisma.match.count({ where: { weekId } }),
    prisma.pickem.findMany({ where: { leagueId, match: { weekId } }, select: { userId: true } }),
    weekNumber === 1
      ? prisma.crystalBallQuestion.findMany({ where: { leagueId }, select: { id: true } })
      : Promise.resolve([]),
  ]);
  const pickCounts = new Map<number, number>();
  for (const pick of picks) pickCounts.set(pick.userId, (pickCounts.get(pick.userId) ?? 0) + 1);
  const incompletePicks = teams.filter((team) => (pickCounts.get(team.userId) ?? 0) !== matchCount);

  let incompleteCrystalBall: typeof teams = [];
  if (questions.length > 0) {
    const answers = await prisma.crystalBallAnswer.findMany({
      where: { questionId: { in: questions.map((question) => question.id) }, userId: { in: teams.map((team) => team.userId) } },
      select: { userId: true },
    });
    const answerCounts = new Map<number, number>();
    for (const answer of answers) answerCounts.set(answer.userId, (answerCounts.get(answer.userId) ?? 0) + 1);
    incompleteCrystalBall = teams.filter((team) => (answerCounts.get(team.userId) ?? 0) !== questions.length);
  }
  return { matchCount, incompletePicks, incompleteCrystalBall };
}

const SLOT_ROLE: Record<string, string> = { TOP: "Top", JNG: "Jungle", MID: "Mid", BOT: "Bot", SUP: "Support" };

function revalidateDataPages() {
  for (const path of ["/", "/commissioner", "/picks", "/stats", "/macro", "/leaderboard"]) {
    revalidatePath(path);
  }
  revalidatePath("/games/[id]", "page");
  revalidatePath("/participants/[id]", "page");
}

function commissionerRedirect(kind: "notice" | "error", message: string): never {
  const params = new URLSearchParams({ [kind]: message.slice(0, 300) });
  redirect(`/commissioner?${params.toString()}`);
}

function actionRedirect(path: string, kind: "notice" | "error", message: string): never {
  const params = new URLSearchParams({ [kind]: message.slice(0, 300) });
  redirect(`${path}?${params.toString()}`);
}

async function handleExpectedActionError(work: () => Promise<void>, path = "/commissioner") {
  try {
    await work();
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof Error && error.message.trim()
      ? error.message
      : "That action could not be completed. Reload the page and try again.";
    actionRedirect(path, "error", message);
  }
}

async function runNextWeekIngest(leagueId: number, scheduleOnly: boolean, live = false) {
  await requireLeagueManager(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  if (league.seasonStatus === "FINAL") throw new Error("The season is already final");
  const weekNumber = league.currentWeek + 1;
  if (live && league.isSimulation) {
    throw new Error("Historical simulations do not contact the live data source");
  }
  if (league.isSimulation && scheduleOnly) {
    throw new Error("Historical simulations load their complete stored schedule when the league is created");
  }
  await assertNoWeekIngestion(league.tournamentId, weekNumber);
  let week = await prisma.week.findUnique({ where: { tournamentId_number: { tournamentId: league.tournamentId, number: weekNumber } } });
  if (!scheduleOnly) {
    if (!week) throw new Error(`Fetch the Week ${weekNumber} schedule before fetching results`);
    const leagueWeek = await prisma.leagueWeek.findUnique({ where: { leagueId_weekId: { leagueId, weekId: week.id } } });
    if (!leagueWeek || !["LOCKED", "RESULTS_IMPORTED"].includes(leagueWeek.status) || !leagueWeek.picksLockedAt || !leagueWeek.rosterLockedAt) {
      throw new Error(`Lock Week ${weekNumber} picks to freeze its predictions and roster snapshot before fetching results`);
    }
  }
  const globallyReady = !live && (scheduleOnly ? Boolean(week?.scheduleImportedAt) : Boolean(week?.resultsImportedAt));
  if (league.isSimulation && !globallyReady) {
    throw new Error(`Week ${weekNumber} is missing stored historical results; simulations never call the live API`);
  }
  const counts = globallyReady ? {
    matches: await prisma.match.count({ where: { weekId: week!.id } }),
    games: await prisma.game.count({ where: { match: { weekId: week!.id } } }),
    players: 0,
    rosterPlayers: await prisma.tournamentPlayer.count({ where: { tournamentId: league.tournamentId } }),
    playerStats: await prisma.playerGameStat.count({ where: { game: { match: { weekId: week!.id } } } }),
    draftActions: await prisma.draftAction.count({ where: { game: { match: { weekId: week!.id } } } }),
    pendingScoreboards: [],
    writes: { created: 0, updated: 0, unchanged: 0 },
  } : scheduleOnly
    ? await runLeaguepediaIngest({ overviewPage: league.tournamentId, weekNumber, scheduleOnly: true })
    : await runGamesOfLegendsIngest({ tournamentId: league.tournamentId, weekNumber, live });
  week = await prisma.week.findUniqueOrThrow({ where: { tournamentId_number: { tournamentId: league.tournamentId, number: weekNumber } } });
  if (live) {
    // Live refreshes leave lifecycle, persistent scores, and Crystal Ball
    // settlement untouched. Public pages calculate the provisional view.
  } else if (scheduleOnly) {
    const existingOpen = await prisma.leagueWeek.findFirst({ where: { leagueId, status: "OPEN" } });
    await prisma.leagueWeek.upsert({
      where: { leagueId_weekId: { leagueId, weekId: week.id } },
      create: { leagueId, weekId: week.id, status: existingOpen ? "UPCOMING" : "OPEN", ...(existingOpen ? {} : { picksOpenAt: new Date() }) },
      update: {},
    });
  } else {
    const leagueWeek = await prisma.leagueWeek.findUniqueOrThrow({ where: { leagueId_weekId: { leagueId, weekId: week.id } } });
    if (!["LOCKED", "RESULTS_IMPORTED"].includes(leagueWeek.status) || !leagueWeek.picksLockedAt || !leagueWeek.rosterLockedAt) {
      throw new Error("Week " + weekNumber + " changed while results were importing. Its data is saved, but the weekly lifecycle was not advanced.");
    }
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
    unstable_rethrow(error);
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
    unstable_rethrow(error);
    commissionerRedirect("error", error instanceof Error ? error.message : String(error));
  }
  commissionerRedirect(
    "notice",
    `Week ${result.weekNumber} results ready${result.reused ? " (reused shared LCK data)" : ""}: ${result.counts.games} games, ${result.counts.playerStats} player lines, and ${result.counts.draftActions} draft actions.`,
  );
}

export async function refreshLiveWeek(formData: FormData) {
  let result: Awaited<ReturnType<typeof runNextWeekIngest>>;
  try {
    result = await runNextWeekIngest(Number(formData.get("leagueId")), false, true);
  } catch (error) {
    unstable_rethrow(error);
    commissionerRedirect("error", error instanceof Error ? error.message : String(error));
  }
  const writes = result.counts.writes;
  const pending = result.counts.pendingScoreboards;
  const sourceStatus = pending.length > 0
    ? ` Source pending: ${pending.slice(0, 2).map((match) =>
      `${match.label} (${match.gamesFound}/${match.expectedGames} games, ${match.playerLinesFound}/${match.expectedPlayerLines} player lines)`,
    ).join("; ")}${pending.length > 2 ? `; +${pending.length - 2} more` : ""}. Refresh again after Games of Legends publishes a completed series score.`
    : " All completed series currently published by Games of Legends are loaded.";
  commissionerRedirect(
    "notice",
    `Week ${result.weekNumber} Games of Legends view refreshed: ${result.counts.games} games and ${result.counts.playerStats} player lines. Wrote ${writes.created + writes.updated} changed rows; skipped ${writes.unchanged} unchanged rows.${sourceStatus} Crystal Ball remains provisional.`,
  );
}

async function initializeWeeksImpl(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  await requireLeagueManager(leagueId);
  await ensureLeagueWeeks(leagueId);
  revalidatePath("/commissioner");
}

async function openWeekImpl(formData: FormData) {
  const lw = await authorizedWeek(Number(formData.get("leagueWeekId")));
  await assertNoWeekIngestion(lw.league.tournamentId, lw.week.number);
  if (lw.status !== "UPCOMING") throw new Error("Only an upcoming week can be opened");
  if (lw.week.matches.length === 0) throw new Error(`Week ${lw.week.number} has no scheduled matches`);
  const previous = lw.week.number === 1 ? null : await prisma.leagueWeek.findFirst({
    where: { leagueId: lw.leagueId, week: { number: lw.week.number - 1 } },
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
    },
  });
  if (previous) await assertNoWeekIngestion(lw.league.tournamentId, previous.week.number);
  const canOpen = canOpenWeekPicks(lw, previous)
    && (!lw.league.isSimulation || previous?.status === "PUBLISHED");
  if (!canOpen) {
    throw new Error(
      lw.week.number === 1
        ? "Week 1 must be the first Pick'em slate"
        : `Lock Week ${lw.week.number - 1} picks and import every final series result before opening Week ${lw.week.number}`,
    );
  }
  const otherOpen = await prisma.leagueWeek.findFirst({
    where: { leagueId: lw.leagueId, status: "OPEN", NOT: { id: lw.id } },
  });
  if (otherOpen) throw new Error("Publish or lock the currently open week first");
  await prisma.leagueWeek.update({
    where: { id: lw.id },
    data: { status: "OPEN", picksOpenAt: new Date(), picksLockedAt: null, rosterLockedAt: null },
  });
  revalidatePath("/commissioner");
  revalidatePath("/picks");
}

async function lockPicksImpl(formData: FormData) {
  const lw = await authorizedWeek(Number(formData.get("leagueWeekId")));
  await assertNoWeekIngestion(lw.league.tournamentId, lw.week.number);
  if (lw.status !== "OPEN") throw new Error("Only an open week's picks can be locked");
  if (lw.picksLockedAt) throw new Error(`Week ${lw.week.number} picks are already locked`);
  const teams = await prisma.fantasyTeam.count({ where: { leagueId: lw.leagueId } });
  if (teams === 0) throw new Error("Add at least one participant fantasy team before locking picks");
  if (lw.week.number === 1) {
    if (teams > 0 && lw.league.draftStatus !== "COMPLETE") {
      throw new Error("Complete the Week 0 roster draft before locking Week 1 picks");
    }
  }
  const readiness = await weekSubmissionReadiness(lw.leagueId, lw.weekId, lw.week.number);
  if (readiness.matchCount === 0) throw new Error("Week " + lw.week.number + " has no scheduled matches and cannot be locked");
  const incomplete = new Set([
    ...readiness.incompletePicks.map((team) => team.userId),
    ...readiness.incompleteCrystalBall.map((team) => team.userId),
  ]);
  if (incomplete.size > 0 && formData.get("confirmIncomplete") !== "true") {
    const details = [
      readiness.incompletePicks.length > 0 ? readiness.incompletePicks.length + " incomplete pick'em submission(s)" : "",
      readiness.incompleteCrystalBall.length > 0 ? readiness.incompleteCrystalBall.length + " incomplete Crystal Ball submission(s)" : "",
    ].filter(Boolean).join(" and ");
    throw new Error("Cannot lock yet: " + details + ". Explicitly confirm that incomplete participants will score zero.");
  }
  // This is a scoring snapshot, not a roster editing lock. Future roster
  // changes cannot alter this week's player ownership after this point.
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
        ...(lw.week.number === 1 ? { crystalBallLockedAt: now } : {}),
      },
    }),
  ]);
  revalidateDataPages();
  revalidatePath("/crystal-ball");
}

async function unlockPicksImpl(formData: FormData) {
  const lw = await authorizedWeek(Number(formData.get("leagueWeekId")));
  await assertNoWeekIngestion(lw.league.tournamentId, lw.week.number);
  if (!["OPEN", "LOCKED"].includes(lw.status)) throw new Error("Picks cannot be unlocked after results are imported");
  if (!lw.picksLockedAt) throw new Error(`Week ${lw.week.number} picks are already open`);
  const laterWeekOpened = await prisma.leagueWeek.count({
    where: {
      leagueId: lw.leagueId,
      picksOpenAt: { not: null },
      week: { number: { gt: lw.week.number } },
    },
  }) > 0;
  const visibleFinalResults = !lw.league.isSimulation && areWeekSeriesResultsComplete(lw.week.matches);
  if (!canUnlockWeekPicks({
    status: lw.status,
    picksLockedAt: lw.picksLockedAt,
    matches: visibleFinalResults ? lw.week.matches : [],
  }, laterWeekOpened)) {
    if (visibleFinalResults) {
      throw new Error(`Week ${lw.week.number} picks are immutable because every series result is final`);
    }
    throw new Error(`Week ${lw.week.number} picks are immutable because a later Pick'em slate has opened`);
  }
  await prisma.$transaction([
    prisma.weeklyRosterSlot.deleteMany({ where: { leagueWeekId: lw.id } }),
    prisma.leagueWeek.update({ where: { id: lw.id }, data: { status: "OPEN", picksLockedAt: null, rosterLockedAt: null } }),
    ...(lw.week.number === 1 && lw.league.currentWeek === 0
      ? [prisma.league.update({
          where: { id: lw.leagueId },
          data: { seasonStatus: "PRESEASON", crystalBallLockedAt: null },
        })]
      : []),
  ]);
  revalidateDataPages();
  revalidatePath("/crystal-ball");
}

async function lockRostersImpl(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  await requireLeagueManager(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  if (league.rostersLockedAt) throw new Error("Roster editing is already locked");
  const teams = await prisma.fantasyTeam.findMany({ where: { leagueId }, include: { roster: true } });
  const readinessError = rosterLockError({ currentWeek: league.currentWeek, draftStatus: league.draftStatus, teams });
  if (readinessError) throw new Error(readinessError);
  await prisma.league.update({ where: { id: leagueId }, data: { rostersLockedAt: new Date() } });
  revalidateDataPages();
  revalidatePath("/commissioner/rosters");
}

async function unlockRostersImpl(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  await requireLeagueManager(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  if (!league.rostersLockedAt) throw new Error("Roster editing is already unlocked");
  if (league.seasonStatus === "FINAL") throw new Error("Rosters cannot be unlocked after the season is final");
  await prisma.league.update({ where: { id: leagueId }, data: { rostersLockedAt: null } });
  revalidateDataPages();
  revalidatePath("/commissioner/rosters");
}

async function validateAndScoreWeekImpl(formData: FormData) {
  const lw = await authorizedWeek(Number(formData.get("leagueWeekId")));
  await assertNoWeekIngestion(lw.league.tournamentId, lw.week.number);
  if (!['RESULTS_IMPORTED', 'SCORED'].includes(lw.status)) throw new Error("Fetch the week's results before scoring it");
  const result = await validateLeagueWeek(lw.id);
  if (!result.ok) {
    await prisma.leagueWeek.update({
      where: { id: lw.id },
      data: { validationJson: JSON.stringify(result), validationError: result.errors.join("; ") },
    });
    throw new Error(`Week ${lw.week.number} data failed validation: ${result.errors.slice(0, 3).join("; ")}`);
  }
  if ((await prisma.weeklyRosterSlot.count({ where: { leagueWeekId: lw.id } })) === 0) {
    throw new Error("The frozen weekly roster snapshot is missing; scoring was stopped to protect historical ownership");
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

async function publishWeekImpl(formData: FormData) {
  const lw = await authorizedWeek(Number(formData.get("leagueWeekId")));
  await assertNoWeekIngestion(lw.league.tournamentId, lw.week.number);
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
    if (next && shouldOpenNextWeekOnPublication(next.status)) {
      await tx.leagueWeek.update({ where: { id: next.id }, data: { status: "OPEN", picksOpenAt: now } });
    }
    if (next) {
      await tx.league.update({ where: { id: lw.leagueId }, data: { currentWeek: lw.week.number, seasonStatus: "ACTIVE" } });
    } else {
      // In a week-by-week database, the next Week row may not exist until its
      // schedule is pulled. Finishing the season is therefore an explicit action.
      await tx.league.update({ where: { id: lw.leagueId }, data: { currentWeek: lw.week.number, seasonStatus: "ACTIVE" } });
    }
  });
  if (!next && lw.league.isSimulation) {
    // Publishing the final week is the natural end of the replay. Crystal Ball
    // was submission-locked with Week 1; now resolve it from the complete
    // season data and expose the final scores without an extra lifecycle step.
    await settleCrystalBall(lw.leagueId);
    await prisma.league.update({
      where: { id: lw.leagueId },
      data: { seasonStatus: "FINAL", crystalBallLockedAt: lw.league.crystalBallLockedAt ?? now },
    });
  }
  revalidatePath("/commissioner");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  revalidatePath("/crystal-ball");
}

async function finishSeasonImpl(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  await requireLeagueManager(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const activeImport = await prisma.ingestionRun.findFirst({ where: { tournamentId: league.tournamentId, status: "RUNNING" } });
  if (activeImport) throw new Error("An LCK data import is still running; wait for it to finish before finalizing the season");
  const unfinished = await prisma.leagueWeek.count({ where: { leagueId, status: { not: "PUBLISHED" } } });
  const published = await prisma.leagueWeek.count({ where: { leagueId, status: "PUBLISHED" } });
  if (unfinished > 0 || published === 0) throw new Error("Publish every imported week before finishing the season");
  await settleCrystalBall(leagueId);
  await prisma.league.update({ where: { id: league.id }, data: { seasonStatus: "FINAL" } });
  revalidatePath("/commissioner");
  revalidatePath("/leaderboard");
  revalidatePath("/crystal-ball");
}

export async function recoverStaleIngestion(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  const runId = Number(formData.get("runId"));
  try {
    await requireLeagueManager(leagueId);
    const [league, run] = await Promise.all([
      prisma.league.findUniqueOrThrow({ where: { id: leagueId } }),
      prisma.ingestionRun.findUniqueOrThrow({ where: { id: runId } }),
    ]);
    if (run.tournamentId !== league.tournamentId) throw new Error("That import does not belong to this league's tournament");
    if (run.status !== "RUNNING") throw new Error("That import has already finished");
    if (!isIngestionRunStale(run)) throw new Error("The importer still has a recent backend heartbeat and cannot be recovered yet");
    const recovered = await prisma.ingestionRun.updateMany({
      where: { id: run.id, status: "RUNNING" },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: "Recovered by a commissioner after the backend heartbeat became stale. Partial rows were retained for a safe idempotent retry.",
      },
    });
    if (recovered.count !== 1) throw new Error("The import changed while recovery was requested; reload and try again");
  } catch (error) {
    unstable_rethrow(error);
    commissionerRedirect("error", error instanceof Error ? error.message : String(error));
  }
  revalidatePath("/commissioner");
  commissionerRedirect("notice", "The stale import was closed safely. You can retry the same week; existing partial rows will be updated rather than duplicated.");
}

async function updateRosterSlotImpl(formData: FormData) {
  const rosterSlotId = Number(formData.get("rosterSlotId"));
  const playerId = String(formData.get("playerId"));
  const slot = await prisma.rosterSlot.findUniqueOrThrow({
    where: { id: rosterSlotId },
    include: { fantasyTeam: { include: { league: true } } },
  });
  await requireLeagueManager(slot.fantasyTeam.leagueId);
  if (!await futureRosterManagementAvailable(slot.fantasyTeam.leagueId, slot.fantasyTeam.league.currentWeek)) {
    throw new Error("Week 0 rosters can only be changed through the snake draft");
  }
  if (slot.fantasyTeam.league.seasonStatus === "FINAL") throw new Error("Rosters cannot change after the season is final");
  if (slot.fantasyTeam.league.rostersLockedAt) throw new Error("Roster editing is locked by the commissioner");
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
  const ownedByAnotherTeam = await prisma.rosterSlot.findFirst({
    where: {
      playerId,
      fantasyTeam: { leagueId: slot.fantasyTeam.leagueId, id: { not: slot.fantasyTeamId } },
    },
    include: { fantasyTeam: true },
  });
  if (ownedByAnotherTeam) throw new Error(`${playerId} is already rostered by ${ownedByAnotherTeam.fantasyTeam.name}`);
  await prisma.rosterSlot.update({ where: { id: slot.id }, data: { playerId } });
  revalidatePath("/commissioner/rosters");
}

async function addRosterSlotImpl(formData: FormData) {
  const fantasyTeamId = Number(formData.get("fantasyTeamId"));
  const playerId = String(formData.get("playerId"));
  const slotName = String(formData.get("slot"));
  if (!['TOP', 'JNG', 'MID', 'BOT', 'SUP', 'BENCH'].includes(slotName)) throw new Error("Invalid roster slot");
  const team = await prisma.fantasyTeam.findUniqueOrThrow({ where: { id: fantasyTeamId }, include: { league: true } });
  await requireLeagueManager(team.leagueId);
  if (!await futureRosterManagementAvailable(team.leagueId, team.league.currentWeek)) {
    throw new Error("Week 0 rosters can only be changed through the snake draft");
  }
  if (team.league.seasonStatus === "FINAL") throw new Error("Rosters cannot change after the season is final");
  if (team.league.rostersLockedAt) throw new Error("Roster editing is locked by the commissioner");
  const existingSlot = await prisma.rosterSlot.findFirst({ where: { fantasyTeamId, slot: slotName } });
  if (existingSlot) throw new Error(`${slotName} is already filled`);
  const eligibility = await prisma.tournamentPlayer.findUnique({ where: { tournamentId_playerId: { tournamentId: team.league.tournamentId, playerId } }, include: { player: true } });
  if (!eligibility) throw new Error("Player is not eligible for this league");
  if (SLOT_ROLE[slotName] && (eligibility.role ?? eligibility.player.role) !== SLOT_ROLE[slotName]) throw new Error(`Player must be a ${SLOT_ROLE[slotName]}`);
  if (await prisma.rosterSlot.findFirst({ where: { fantasyTeamId, playerId } })) throw new Error("That player is already on this roster");
  const ownedByAnotherTeam = await prisma.rosterSlot.findFirst({
    where: { playerId, fantasyTeam: { leagueId: team.leagueId, id: { not: fantasyTeamId } } },
    include: { fantasyTeam: true },
  });
  if (ownedByAnotherTeam) throw new Error(`${playerId} is already rostered by ${ownedByAnotherTeam.fantasyTeam.name}`);
  await prisma.rosterSlot.create({ data: { fantasyTeamId, playerId, slot: slotName } });
  revalidatePath("/commissioner/rosters");
}

async function updateScoringConfigImpl(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  await requireLeagueManager(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const published = await prisma.leagueWeek.count({ where: { leagueId, status: "PUBLISHED" } });
  if (published > 0) throw new Error("Scoring cannot change after the first week is published");
  const raw = String(formData.get("scoringConfig") ?? "");
  let parsed: { version?: unknown; player?: Record<string, unknown>; pickem?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error("Scoring configuration must be valid JSON");
  }
  if (parsed.version !== DEFAULT_SCORING.version) throw new Error(`Scoring version must be ${DEFAULT_SCORING.version}`);
  for (const section of ["player", "pickem"] as const) {
    const defaults = DEFAULT_SCORING[section];
    const supplied = parsed[section];
    if (!supplied) throw new Error(`Missing scoring section: ${section}`);
    for (const key of Object.keys(defaults)) {
      if (typeof supplied[key] !== "number" || !Number.isFinite(supplied[key])) throw new Error(`Invalid scoring value: ${section}.${key}`);
    }
  }
  await prisma.league.update({ where: { id: league.id }, data: { scoringConfig: JSON.stringify(parsed) } });
  revalidatePath("/commissioner");
  revalidatePath("/settings");
}

export async function initializeWeeks(formData: FormData) {
  await handleExpectedActionError(() => initializeWeeksImpl(formData));
}

export async function openWeek(formData: FormData) {
  await handleExpectedActionError(() => openWeekImpl(formData));
}

export async function lockPicks(formData: FormData) {
  await handleExpectedActionError(() => lockPicksImpl(formData));
}

export async function unlockPicks(formData: FormData) {
  await handleExpectedActionError(() => unlockPicksImpl(formData));
}

export async function lockRosters(formData: FormData) {
  await handleExpectedActionError(() => lockRostersImpl(formData));
}

export async function unlockRosters(formData: FormData) {
  await handleExpectedActionError(() => unlockRostersImpl(formData));
}

export async function validateAndScoreWeek(formData: FormData) {
  await handleExpectedActionError(() => validateAndScoreWeekImpl(formData));
}

export async function publishWeek(formData: FormData) {
  await handleExpectedActionError(() => publishWeekImpl(formData));
}

export async function finishSeason(formData: FormData) {
  await handleExpectedActionError(() => finishSeasonImpl(formData));
}

export async function updateRosterSlot(formData: FormData) {
  await handleExpectedActionError(() => updateRosterSlotImpl(formData), "/commissioner/rosters");
}

export async function addRosterSlot(formData: FormData) {
  await handleExpectedActionError(() => addRosterSlotImpl(formData), "/commissioner/rosters");
}

export async function updateScoringConfig(formData: FormData) {
  await handleExpectedActionError(() => updateScoringConfigImpl(formData));
}
