"use server";

import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createLeagueForOwner, ACTIVE_LEAGUE_COOKIE } from "@/lib/leagues";
import { prisma } from "@/lib/db";

export async function createLeague(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const tournamentId = String(formData.get("tournamentId") ?? "");
  const teamName = String(formData.get("teamName") ?? "").trim();
  const isSimulation = formData.get("isSimulation") === "on";
  if (name.length < 3 || name.length > 60) redirect("/leagues/new?error=League+name+must+be+3-60+characters");
  if (teamName && (teamName.length < 2 || teamName.length > 40)) redirect("/leagues/new?error=Fantasy+team+name+must+be+2-40+characters");
  if (!await prisma.tournament.findFirst({ where: { id: tournamentId, hidden: false } })) redirect("/leagues/new?error=Choose+a+valid+tournament");
  let league: Awaited<ReturnType<typeof createLeagueForOwner>>;
  try {
    league = await createLeagueForOwner({
      ownerId: user.id,
      name,
      tournamentId,
      isSimulation,
      teamName: teamName || undefined,
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("League creation failed", error);
    const message = error instanceof Error && error.message
      ? error.message
      : "League creation failed. Nothing was saved; please retry.";
    redirect(`/leagues/new?error=${encodeURIComponent(message)}`);
  }
  const jar = await cookies();
  jar.set(ACTIVE_LEAGUE_COOKIE, league.slug, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/commissioner");
}
