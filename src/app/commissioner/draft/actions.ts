"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireLeagueManager } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseScoring } from "@/lib/fantasy";
import {
  DRAFT_ROLES,
  conservativeDraftCompletionCost,
  draftBudgetBlockReason,
  draftFormatForTournament,
  draftGroupForTeam,
  draftPoolSupportsAllTeams,
  draftSlotAvailable,
  isDraftPricingMode,
  isDraftRole,
  minimumSafeOpeningBudget,
  minimumDraftCompletionCost,
  roundDraftBudget,
  ROLE_SLOT,
  snakeTeamId,
  totalDraftPicks,
  type DraftCompositionPlayer,
} from "@/lib/draft";
import { buildDraftPriceSheet, parseDraftPriceSheet, playerDraftPrice } from "@/lib/draft-pricing";

function draftRedirect(kind: "notice" | "error", message: string): never {
  redirect(`/commissioner/draft?${kind}=${encodeURIComponent(message.slice(0, 240))}`);
}

function assertWeekZero(league: { currentWeek: number; seasonStatus: string }) {
  if (league.currentWeek !== 0 || league.seasonStatus !== "PRESEASON") {
    throw new Error("The initial roster draft is available only during Week 0");
  }
}

export async function startDraft(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  try {
    await requireLeagueManager(leagueId);
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, include: { fantasyTeams: true } });
    assertWeekZero(league);
    if (league.draftStatus !== "NOT_STARTED") throw new Error("The draft order is locked once drafting begins");
    const order = formData.getAll("teamId").map(Number);
    const pricingMode = String(formData.get("draftPricingMode") ?? "UNIFORM");
    const budgetGuardEnabled = formData.get("draftBudgetGuardEnabled") === "true";
    if (!isDraftPricingMode(pricingMode)) throw new Error("Choose a valid draft pricing mode");
    const teamIds = league.fantasyTeams.map((team) => team.id);
    if (order.length !== teamIds.length || new Set(order).size !== teamIds.length || teamIds.some((id) => !order.includes(id))) {
      throw new Error("Draft order must include every fantasy team exactly once");
    }
    if (teamIds.length === 0) throw new Error("Add at least one participant fantasy team before starting the draft");
    const format = draftFormatForTournament(league.tournamentId);
    const eligible = await prisma.tournamentPlayer.findMany({
      where: { tournamentId: league.tournamentId },
      include: { player: { select: { role: true } } },
    });
    let calculatedBudget = DRAFT_ROLES.length * league.draftPlayersPerRole * league.draftPlayerPrice;
    if (format) {
      if (league.draftPlayersPerRole !== format.groups.length) {
        throw new Error(`This split requires exactly ${format.groups.length} players per role`);
      }
      const unmapped = eligible.filter((row) => !draftGroupForTeam(format, row.teamId));
      if (unmapped.length > 0) throw new Error(`Some tournament players are not assigned to Legends or Rise: ${unmapped.slice(0, 3).map((row) => row.playerId).join(", ")}`);
      for (const group of format.groups) for (const role of DRAFT_ROLES) {
        const available = eligible.filter((row) => draftGroupForTeam(format, row.teamId) === group.key && (row.role ?? row.player.role) === role).length;
        if (available < teamIds.length) throw new Error(`${group.label} has only ${available} eligible ${role} players; ${teamIds.length} are required`);
      }
    } else {
      for (const role of DRAFT_ROLES) {
        const available = eligible.filter((row) => (row.role ?? row.player.role) === role).length;
        if (available < teamIds.length * league.draftPlayersPerRole) {
          throw new Error(`Not enough eligible ${role} players for this draft`);
        }
      }
    }
    if (pricingMode === "DYNAMIC" && !format) throw new Error("Dynamic pricing is not configured for this tournament");
    const priceSheet = pricingMode === "DYNAMIC"
      ? await buildDraftPriceSheet(league.tournamentId, parseScoring(league.scoringConfig))
      : null;
    if (format) {
      const groupKeys = format.groups.map((group) => group.key);
      const emptyRosters: DraftCompositionPlayer[][] = teamIds.map(() => []);
      const pool = eligible.flatMap((row): DraftCompositionPlayer[] => {
        const role = row.role ?? row.player.role;
        const group = draftGroupForTeam(format, row.teamId);
        if (!isDraftRole(role) || !group) return [];
        return [{
          playerId: row.playerId,
          role,
          group,
          price: playerDraftPrice(pricingMode, priceSheet, row.playerId, league.draftPlayerPrice),
        }];
      });
      if (!draftPoolSupportsAllTeams(emptyRosters, pool, league.draftPlayersPerRole, groupKeys)) {
        throw new Error("The eligible player pool cannot complete every Legends and Rise roster");
      }
      const minimumBudget = minimumSafeOpeningBudget(teamIds.length, pool, league.draftPlayersPerRole, groupKeys);
      if (minimumBudget === null) throw new Error("The eligible player pool cannot provide a safe draft path for this many participants");
      calculatedBudget = pricingMode === "DYNAMIC" ? roundDraftBudget(minimumBudget) : calculatedBudget;
    }
    await prisma.$transaction(async (tx) => {
      await tx.draftPick.deleteMany({ where: { leagueId } });
      await tx.rosterSlot.deleteMany({ where: { fantasyTeam: { leagueId } } });
      await tx.league.update({ where: { id: leagueId }, data: {
        draftStatus: "ACTIVE",
        draftOrder: JSON.stringify(order),
        draftCurrentPick: 0,
        draftBudget: calculatedBudget,
        draftPricingMode: pricingMode,
        draftBudgetGuardEnabled: budgetGuardEnabled,
        draftPriceSourceTournamentId: priceSheet?.sourceTournamentId ?? null,
        draftPriceSheet: priceSheet ? JSON.stringify(priceSheet) : null,
      } });
    });
    revalidatePath("/commissioner/draft");
  } catch (error) {
    unstable_rethrow(error);
    draftRedirect("error", error instanceof Error ? error.message : String(error));
  }
  draftRedirect("notice", "Draft order locked. Pick 1 is ready.");
}

export async function makeDraftPick(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  const playerId = String(formData.get("playerId") ?? "");
  let pickedName = playerId;
  let nextMessage = "Draft complete";
  try {
    await requireLeagueManager(leagueId);
    await prisma.$transaction(async (tx) => {
      const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId } });
      assertWeekZero(league);
      if (league.draftStatus !== "ACTIVE" || !league.draftOrder) throw new Error("Start the draft before making a pick");
      const order = JSON.parse(league.draftOrder) as number[];
      const expectedTeamId = snakeTeamId(order, league.draftCurrentPick);
      if (!expectedTeamId) throw new Error("Draft order is invalid");
      const team = await tx.fantasyTeam.findUniqueOrThrow({ where: { id: expectedTeamId }, include: { user: true } });
      if (team.leagueId !== leagueId) throw new Error("Draft order contains a team from another league");
      const format = draftFormatForTournament(league.tournamentId);
      const groupKeys = format?.groups.map((group) => group.key) ?? [];
      const priceSheet = parseDraftPriceSheet(league.draftPriceSheet);
      if (league.draftPricingMode === "DYNAMIC" && !priceSheet) throw new Error("The frozen dynamic price sheet is missing or invalid");
      const tournamentPlayers = await tx.tournamentPlayer.findMany({
        where: { tournamentId: league.tournamentId },
        include: { player: { select: { name: true, role: true } } },
      });
      const eligibilityById = new Map(tournamentPlayers.map((row) => [row.playerId, row]));
      const eligibility = eligibilityById.get(playerId);
      const role = eligibility?.role ?? eligibility?.player.role;
      if (!eligibility || !isDraftRole(role)) throw new Error("That player is not eligible for this draft");
      const group = draftGroupForTeam(format, eligibility.teamId);
      if (format && !group) throw new Error("That player's team is not assigned to Legends or Rise");
      const alreadyDrafted = await tx.draftPick.findUnique({ where: { leagueId_playerId: { leagueId, playerId } } });
      if (alreadyDrafted) throw new Error("That player has already been drafted");
      const allPicks = await tx.draftPick.findMany({ where: { leagueId } });
      const toComposition = (pick: (typeof allPicks)[number]): DraftCompositionPlayer => {
        const row = eligibilityById.get(pick.playerId);
        const pickRole = row?.role ?? row?.player.role;
        if (!row || !isDraftRole(pickRole)) throw new Error(`Drafted player ${pick.playerId} is no longer eligible`);
        return { playerId: pick.playerId, role: pickRole, group: draftGroupForTeam(format, row.teamId), price: pick.price };
      };
      const teamPicks = allPicks.filter((pick) => pick.fantasyTeamId === team.id);
      const composition = teamPicks.map(toComposition);
      if (!draftSlotAvailable(composition, { role, group }, league.draftPlayersPerRole, groupKeys)) {
        throw new Error(format ? `${team.name} already filled its ${group === "LEGENDS" ? "Legends" : "Rise"} ${role} slot` : `${team.name} already has ${league.draftPlayersPerRole} ${role} players`);
      }
      const price = playerDraftPrice(league.draftPricingMode, priceSheet, playerId, league.draftPlayerPrice);
      const spent = teamPicks.reduce((sum, pick) => sum + pick.price, 0);
      const globallyDrafted = new Set(allPicks.map((pick) => pick.playerId));
      globallyDrafted.add(playerId);
      const available = tournamentPlayers.flatMap((row): DraftCompositionPlayer[] => {
        const availableRole = row.role ?? row.player.role;
        if (globallyDrafted.has(row.playerId) || !isDraftRole(availableRole)) return [];
        const availableGroup = draftGroupForTeam(format, row.teamId);
        if (format && !availableGroup) return [];
        return [{
          playerId: row.playerId,
          role: availableRole,
          group: availableGroup,
          price: playerDraftPrice(league.draftPricingMode, priceSheet, row.playerId, league.draftPlayerPrice),
        }];
      });
      const reserve = minimumDraftCompletionCost(
        [...composition, { playerId, role, group, price }],
        available,
        league.draftPlayersPerRole,
        groupKeys,
      );
      if (reserve === null) throw new Error("That pick would make the required roster impossible to complete");
      const everyTeamComposition = order.map((teamId) => allPicks.filter((pick) => pick.fantasyTeamId === teamId).map(toComposition));
      const currentTeamIndex = order.indexOf(team.id);
      everyTeamComposition[currentTeamIndex] = [...composition, { playerId, role, group, price }];
      if (!draftPoolSupportsAllTeams(everyTeamComposition, available, league.draftPlayersPerRole, groupKeys)) {
        throw new Error("That pick would consume a player another fantasy team still needs to complete its required roster");
      }
      const conservativeReserve = league.draftBudgetGuardEnabled
        ? conservativeDraftCompletionCost(currentTeamIndex, everyTeamComposition, available, league.draftPlayersPerRole, groupKeys)
        : 0;
      const budgetBlock = draftBudgetBlockReason(spent, price, league.draftBudget, league.draftBudgetGuardEnabled, conservativeReserve);
      if (budgetBlock === "OVER_BUDGET") {
        throw new Error(`${team.name} has only $${(league.draftBudget - spent).toLocaleString("en-US")} remaining`);
      }
      if (budgetBlock === "BREAKS_RESERVE") {
        if (conservativeReserve === null) throw new Error("That pick would leave no safe league-wide budget path");
        throw new Error(`${team.name} must preserve at least $${conservativeReserve.toLocaleString("en-US")} for its remaining required slots`);
      }
      const pickIndex = league.draftCurrentPick;
      const total = totalDraftPicks(order.length, league.draftPlayersPerRole);
      if (pickIndex >= total) throw new Error("The draft is already complete");
      await tx.draftPick.create({ data: {
        leagueId, fantasyTeamId: team.id, playerId, overallPick: pickIndex + 1,
        round: Math.floor(pickIndex / order.length) + 1, role, price,
      } });
      await tx.rosterSlot.create({ data: { fantasyTeamId: team.id, playerId, slot: ROLE_SLOT[role] } });
      const nextPick = pickIndex + 1;
      const update = await tx.league.updateMany({
        where: { id: leagueId, draftStatus: "ACTIVE", draftCurrentPick: pickIndex },
        data: { draftCurrentPick: nextPick, draftStatus: nextPick === total ? "COMPLETE" : "ACTIVE" },
      });
      if (update.count !== 1) throw new Error("The draft changed in another window; reload and try again");
      pickedName = eligibility.player.name;
      if (nextPick < total) {
        const nextTeamId = snakeTeamId(order, nextPick);
        const nextTeam = await tx.fantasyTeam.findUniqueOrThrow({ where: { id: nextTeamId! } });
        nextMessage = `Pick ${nextPick + 1}: ${nextTeam.name} is on the clock`;
      }
    });
    revalidatePath("/commissioner/draft");
    revalidatePath("/commissioner/rosters");
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, message: `${pickedName} drafted. ${nextMessage}.` };
}

export async function undoDraftPick(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  let message = "Last pick undone";
  try {
    await requireLeagueManager(leagueId);
    await prisma.$transaction(async (tx) => {
      const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId } });
      assertWeekZero(league);
      if (!["ACTIVE", "COMPLETE"].includes(league.draftStatus) || !league.draftOrder || league.draftCurrentPick < 1) {
        throw new Error("There is no draft pick to undo");
      }
      const last = await tx.draftPick.findUniqueOrThrow({
        where: { leagueId_overallPick: { leagueId, overallPick: league.draftCurrentPick } },
        include: { player: true, fantasyTeam: true },
      });
      await tx.rosterSlot.deleteMany({ where: { fantasyTeamId: last.fantasyTeamId, playerId: last.playerId } });
      await tx.draftPick.delete({ where: { id: last.id } });
      const update = await tx.league.updateMany({
        where: { id: leagueId, draftCurrentPick: league.draftCurrentPick, draftStatus: { in: ["ACTIVE", "COMPLETE"] } },
        data: { draftCurrentPick: league.draftCurrentPick - 1, draftStatus: "ACTIVE" },
      });
      if (update.count !== 1) throw new Error("The draft changed in another window; reload and try again");
      message = `Undid ${last.player.name} from ${last.fantasyTeam.name}. That team is back on the clock.`;
    });
    revalidatePath("/commissioner/draft");
    revalidatePath("/commissioner/rosters");
    return { ok: true, message };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function resetDraft(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  try {
    await requireLeagueManager(leagueId);
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
    assertWeekZero(league);
    if (formData.get("confirmReset") !== "true") throw new Error("Confirm that you want to clear the entire draft");
    await prisma.$transaction(async (tx) => {
      await tx.draftPick.deleteMany({ where: { leagueId } });
      await tx.rosterSlot.deleteMany({ where: { fantasyTeam: { leagueId } } });
      await tx.league.update({ where: { id: leagueId }, data: { draftStatus: "NOT_STARTED", draftOrder: null, draftCurrentPick: 0, draftPricingMode: "UNIFORM", draftBudgetGuardEnabled: true, draftPriceSourceTournamentId: null, draftPriceSheet: null } });
    });
    revalidatePath("/commissioner/draft");
  } catch (error) {
    unstable_rethrow(error);
    draftRedirect("error", error instanceof Error ? error.message : String(error));
  }
  draftRedirect("notice", "Draft reset. Choose a new order before the first pick.");
}
