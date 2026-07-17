"use server";

import { redirect } from "next/navigation";
import { createSession, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function joinLeague(formData: FormData) {
  const inviteCode = String(formData.get("inviteCode") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const teamName = String(formData.get("teamName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username)) redirect("/join?error=Username+must+be+3-24+letters,+numbers,+underscores,+or+dashes");
  if (teamName.length < 2 || teamName.length > 40 || password.length < 10) redirect("/join?error=Check+the+team+name+and+use+a+10-character+password");
  const league = await prisma.league.findUnique({ where: { inviteCode } });
  if (!league) redirect("/join?error=Invalid+invite+code");
  if (league.seasonStatus !== "PRESEASON") redirect("/join?error=Registration+is+closed+for+this+season");
  if (await prisma.user.findUnique({ where: { username } })) redirect("/join?error=Username+already+exists");
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { username, passwordHash: hashPassword(password) } });
    await tx.fantasyTeam.create({ data: { leagueId: league.id, userId: created.id, name: teamName } });
    return created;
  });
  await createSession(user.id);
  redirect("/picks");
}
