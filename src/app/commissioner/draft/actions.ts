"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireLeagueManager } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DRAFT_ROLES, isDraftRole, ROLE_SLOT, snakeTeamId, totalDraftPicks } from "@/lib/draft";

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
    const teamIds = league.fantasyTeams.map((team) => team.id);
    if (order.length !== teamIds.length || new Set(order).size !== teamIds.length || teamIds.some((id) => !order.includes(id))) {
      throw new Error("Draft order must include every fantasy team exactly once");
    }
    if (teamIds.length === 0) throw new Error("Add at least one participant fantasy team before starting the draft");
    for (const role of DRAFT_ROLES) {
      const available = await prisma.tournamentPlayer.count({ where: { tournamentId: league.tournamentId, role } });
      if (available < teamIds.length * league.draftPlayersPerRole) {
        throw new Error(`Not enough eligible ${role} players for this draft`);
      }
    }
    await prisma.$transaction(async (tx) => {
      await tx.draftPick.deleteMany({ where: { leagueId } });
      await tx.rosterSlot.deleteMany({ where: { fantasyTeam: { leagueId } } });
      await tx.league.update({ where: { id: leagueId }, data: { draftStatus: "ACTIVE", draftOrder: JSON.stringify(order), draftCurrentPick: 0 } });
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
      const eligibility = await tx.tournamentPlayer.findUnique({
        where: { tournamentId_playerId: { tournamentId: league.tournamentId, playerId } },
        include: { player: true },
      });
      const role = eligibility?.role ?? eligibility?.player.role;
      if (!eligibility || !isDraftRole(role)) throw new Error("That player is not eligible for this draft");
      const alreadyDrafted = await tx.draftPick.findUnique({ where: { leagueId_playerId: { leagueId, playerId } } });
      if (alreadyDrafted) throw new Error("That player has already been drafted");
      const teamPicks = await tx.draftPick.findMany({ where: { leagueId, fantasyTeamId: team.id } });
      if (teamPicks.filter((pick) => pick.role === role).length >= league.draftPlayersPerRole) {
        throw new Error(`${team.name} already has ${league.draftPlayersPerRole} ${role} players`);
      }
      const spent = teamPicks.reduce((sum, pick) => sum + pick.price, 0);
      if (spent + league.draftPlayerPrice > league.draftBudget) throw new Error(`${team.name} does not have enough budget`);
      const pickIndex = league.draftCurrentPick;
      const total = totalDraftPicks(order.length, league.draftPlayersPerRole);
      if (pickIndex >= total) throw new Error("The draft is already complete");
      await tx.draftPick.create({ data: {
        leagueId, fantasyTeamId: team.id, playerId, overallPick: pickIndex + 1,
        round: Math.floor(pickIndex / order.length) + 1, role, price: league.draftPlayerPrice,
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
      await tx.league.update({ where: { id: leagueId }, data: { draftStatus: "NOT_STARTED", draftOrder: null, draftCurrentPick: 0 } });
    });
    revalidatePath("/commissioner/draft");
  } catch (error) {
    unstable_rethrow(error);
    draftRedirect("error", error instanceof Error ? error.message : String(error));
  }
  draftRedirect("notice", "Draft reset. Choose a new order before the first pick.");
}
