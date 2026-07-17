"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createSession, getCurrentUser, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ACTIVE_LEAGUE_COOKIE } from "@/lib/leagues";

export async function joinLeague(formData: FormData) {
  const inviteCode = String(formData.get("inviteCode") ?? "").trim();
  const teamName = String(formData.get("teamName") ?? "").trim();
  if (teamName.length < 2 || teamName.length > 40) redirect("/join?error=Fantasy+team+name+must+be+2-40+characters");
  const league = await prisma.league.findUnique({ where: { inviteCode } });
  if (!league) redirect("/join?error=Invalid+invite+code");
  if (league.seasonStatus !== "PRESEASON") redirect("/join?error=Registration+is+closed+for+this+season");
  let user = await getCurrentUser();
  let createdAccount = false;
  if (!user) {
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username) || password.length < 10) redirect("/join?error=Check+the+username+and+use+a+10-character+password");
    if (await prisma.user.findUnique({ where: { username } })) redirect("/join?error=Username+already+exists;+sign+in+first+to+join+another+league");
    user = await prisma.user.create({ data: { username, passwordHash: hashPassword(password) } });
    createdAccount = true;
  }
  if (await prisma.leagueMembership.findUnique({ where: { leagueId_userId: { leagueId: league.id, userId: user.id } } })) redirect("/join?error=You+already+belong+to+this+league");
  await prisma.$transaction(async (tx) => {
    await tx.leagueMembership.create({ data: { leagueId: league.id, userId: user.id, role: "PARTICIPANT" } });
    await tx.fantasyTeam.create({ data: { leagueId: league.id, userId: user.id, name: teamName } });
  });
  if (createdAccount) await createSession(user.id);
  (await cookies()).set(ACTIVE_LEAGUE_COOKIE, league.slug, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/picks");
}
