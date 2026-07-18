"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { cookies } from "next/headers";
import { hashPassword, requireLeagueManager, requireLeagueOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createStoredLeagueBackup, deleteLeagueWithRecovery, deleteStoredLeagueBackup, restoreStoredBackupOverLeague } from "@/lib/backup";
import { DEFAULT_CRYSTAL_BALL } from "@/lib/crystal-ball";
import { initialLeagueWeekRows } from "@/lib/league-setup";
import { ACTIVE_LEAGUE_COOKIE } from "@/lib/leagues";

function back(message: string, error = false): never {
  redirect(`/settings?${error ? "error" : "notice"}=${encodeURIComponent(message)}`);
}

async function handleSettingsError(work: () => Promise<void>) {
  try {
    await work();
  } catch (error) {
    unstable_rethrow(error);
    back(error instanceof Error && error.message ? error.message : "That settings change could not be completed", true);
  }
}

async function addCommissionerImpl(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  await requireLeagueOwner(leagueId);
  const username = String(formData.get("username") ?? "").trim();
  const temporaryPassword = String(formData.get("temporaryPassword") ?? "");
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username)) back("Username must be 3-24 letters, numbers, underscores, or dashes", true);
  let user = await prisma.user.findUnique({ where: { username } });
  if (!user && temporaryPassword.length < 10) back("A new account needs a temporary password of at least 10 characters", true);
  user ??= await prisma.user.create({ data: { username, passwordHash: hashPassword(temporaryPassword) } });
  const existing = await prisma.leagueMembership.findUnique({ where: { leagueId_userId: { leagueId, userId: user.id } } });
  if (existing?.role === "OWNER") back("The league owner already has full access", true);
  await prisma.leagueMembership.upsert({
    where: { leagueId_userId: { leagueId, userId: user.id } },
    create: { leagueId, userId: user.id, role: "COMMISSIONER" },
    update: { role: "COMMISSIONER" },
  });
  revalidatePath("/settings");
  back(`${username} can now commission this league`);
}

async function updateMembershipRoleImpl(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  await requireLeagueOwner(leagueId);
  const membershipId = Number(formData.get("membershipId"));
  const role = String(formData.get("role"));
  if (!['PARTICIPANT', 'COMMISSIONER'].includes(role)) throw new Error("Invalid role");
  const membership = await prisma.leagueMembership.findUniqueOrThrow({ where: { id: membershipId } });
  if (membership.leagueId !== leagueId || membership.role === "OWNER") throw new Error("That membership cannot be changed");
  await prisma.leagueMembership.update({ where: { id: membership.id }, data: { role } });
  revalidatePath("/settings");
}

async function resetTestLeagueImpl(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  const { league } = await requireLeagueOwner(leagueId);
  if (!league.isSimulation) throw new Error("Only a test league can be reset");
  if (formData.get("confirmReset") !== "true") throw new Error("Confirm that you want to reset this entire test league");
  await prisma.$transaction(async (tx) => {
    await tx.crystalBallAnswer.deleteMany({ where: { question: { leagueId } } });
    await tx.crystalBallQuestion.deleteMany({ where: { leagueId } });
    await tx.crystalBallQuestion.createMany({ data: DEFAULT_CRYSTAL_BALL.map((question) => ({ leagueId, ...question })) });
    await tx.pickem.deleteMany({ where: { leagueId } });
    await tx.draftPick.deleteMany({ where: { leagueId } });
    await tx.rosterSlot.deleteMany({ where: { fantasyTeam: { leagueId } } });
    await tx.weeklyScore.deleteMany({ where: { leagueWeek: { leagueId } } });
    await tx.weeklyRosterSlot.deleteMany({ where: { leagueWeek: { leagueId } } });
    await tx.leagueWeek.deleteMany({ where: { leagueId } });
    const weeks = await tx.week.findMany({
      where: { tournamentId: league.tournamentId, scheduleImportedAt: { not: null } },
      orderBy: { number: "asc" },
    });
    const now = new Date();
    if (weeks.length > 0) await tx.leagueWeek.createMany({
      data: initialLeagueWeekRows(leagueId, weeks, now),
    });
    await tx.league.update({ where: { id: leagueId }, data: { currentWeek: 0, seasonStatus: "PRESEASON", crystalBallLockedAt: null, rostersLockedAt: null, draftStatus: "NOT_STARTED", draftOrder: null, draftCurrentPick: 0, draftPricingMode: "UNIFORM", draftPriceSourceTournamentId: null, draftPriceSheet: null } });
  });
  revalidatePath("/", "layout");
  (await cookies()).delete(`viewWeek_${leagueId}`);
  back("Test league reset to Week 0; members and teams were kept, and the initial draft was cleared");
}

export async function addCommissioner(formData: FormData) {
  await handleSettingsError(() => addCommissionerImpl(formData));
}

export async function updateMembershipRole(formData: FormData) {
  await handleSettingsError(() => updateMembershipRoleImpl(formData));
}

export async function resetTestLeague(formData: FormData) {
  await handleSettingsError(() => resetTestLeagueImpl(formData));
}

async function createCheckpointImpl(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  const access = await requireLeagueManager(leagueId);
  const label = String(formData.get("label") ?? "");
  await createStoredLeagueBackup(leagueId, access.user.id, label);
  revalidatePath("/settings");
}

async function restoreCheckpointImpl(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  const access = await requireLeagueOwner(leagueId);
  if (formData.get("confirmRestore") !== "true") throw new Error("Confirm that you want to replace the league with this checkpoint");
  await restoreStoredBackupOverLeague(Number(formData.get("backupId")), leagueId, access.user.id);
  revalidatePath("/", "layout");
  (await cookies()).delete(`viewWeek_${leagueId}`);
}

async function deleteCheckpointImpl(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  const access = await requireLeagueOwner(leagueId);
  if (formData.get("confirmDeleteBackup") !== "true") throw new Error("Confirm that you want to permanently delete this checkpoint");
  await deleteStoredLeagueBackup(Number(formData.get("backupId")), access.user.id);
  revalidatePath("/settings");
}

export async function createCheckpoint(formData: FormData) {
  await handleSettingsError(() => createCheckpointImpl(formData));
  back("Checkpoint saved");
}

export async function restoreCheckpoint(formData: FormData) {
  await handleSettingsError(() => restoreCheckpointImpl(formData));
  back("League restored to the selected checkpoint; a pre-restore safety checkpoint was also saved");
}

export async function deleteCheckpoint(formData: FormData) {
  await handleSettingsError(() => deleteCheckpointImpl(formData));
  back("Checkpoint permanently deleted");
}

export async function deleteLeague(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  let name = "League";
  try {
    const access = await requireLeagueOwner(leagueId);
    name = access.league.name;
    if (formData.get("confirmDeleteLeague") !== "true") throw new Error("Confirm that you understand this deletes the active league");
    if (String(formData.get("leagueName") ?? "").trim() !== access.league.name) throw new Error("Type the exact league name to confirm deletion");
    await deleteLeagueWithRecovery(leagueId, access.user.id);
  } catch (error) {
    unstable_rethrow(error);
    back(error instanceof Error && error.message ? error.message : "League deletion failed", true);
  }
  const jar = await cookies();
  jar.delete(ACTIVE_LEAGUE_COOKIE);
  jar.delete(`viewWeek_${leagueId}`);
  revalidatePath("/", "layout");
  redirect(`/leagues?notice=${encodeURIComponent(`${name} was deleted. Its recovery checkpoints are available below.`)}`);
}
