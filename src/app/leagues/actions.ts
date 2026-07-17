"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createLeagueForOwner, ACTIVE_LEAGUE_COOKIE } from "@/lib/leagues";
import { prisma } from "@/lib/db";

export async function createLeague(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const tournamentId = String(formData.get("tournamentId") ?? "");
  const teamName = String(formData.get("teamName") ?? "").trim();
  if (name.length < 3 || name.length > 60) redirect("/leagues/new?error=League+name+must+be+3-60+characters");
  if (teamName && (teamName.length < 2 || teamName.length > 40)) redirect("/leagues/new?error=Fantasy+team+name+must+be+2-40+characters");
  if (!await prisma.tournament.findUnique({ where: { id: tournamentId } })) redirect("/leagues/new?error=Choose+a+valid+tournament");
  const league = await createLeagueForOwner({
    ownerId: user.id,
    name,
    tournamentId,
    isSimulation: formData.get("isSimulation") === "on",
    teamName: teamName || undefined,
  });
  const jar = await cookies();
  jar.set(ACTIVE_LEAGUE_COOKIE, league.slug, { httpOnly: true, sameSite: "lax", path: "/" });
  if (league.isSimulation) jar.set(`viewWeek_${league.id}`, "0", { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/commissioner");
}
