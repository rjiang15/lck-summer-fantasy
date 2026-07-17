"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { hashPassword, requireLeagueOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DEFAULT_CRYSTAL_BALL } from "@/lib/crystal-ball";

function back(message: string, error = false): never {
  redirect(`/settings?${error ? "error" : "notice"}=${encodeURIComponent(message)}`);
}

export async function addCommissioner(formData: FormData) {
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

export async function updateMembershipRole(formData: FormData) {
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

export async function resetTestLeague(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  const { league } = await requireLeagueOwner(leagueId);
  if (!league.isSimulation) throw new Error("Only a test league can be reset");
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
    const firstWeek = await tx.week.findFirst({ where: { tournamentId: league.tournamentId, scheduleImportedAt: { not: null } }, orderBy: { number: "asc" } });
    if (firstWeek) await tx.leagueWeek.create({ data: { leagueId, weekId: firstWeek.id, status: "OPEN", picksOpenAt: new Date() } });
    await tx.league.update({ where: { id: leagueId }, data: { currentWeek: 0, seasonStatus: "PRESEASON", crystalBallLockedAt: null, rostersLockedAt: null, draftStatus: "NOT_STARTED", draftOrder: null, draftCurrentPick: 0 } });
  });
  revalidatePath("/", "layout");
  (await cookies()).set(`viewWeek_${leagueId}`, "0", { httpOnly: true, sameSite: "lax", path: "/" });
  back("Test league reset to Week 0; members and teams were kept, and the initial draft was cleared");
}
