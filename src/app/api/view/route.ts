// Sets the split / week-cursor cookies and bounces back to the page you were on.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canViewTournament } from "@/lib/view";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const user = await getCurrentUser();
  const leagueId = Number(url.searchParams.get("leagueId"));
  if (!user || !Number.isInteger(leagueId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const membership = await prisma.leagueMembership.findUnique({
    where: { leagueId_userId: { leagueId, userId: user.id } },
    include: { league: true },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const week = url.searchParams.get("week");
  const tournamentId = url.searchParams.get("tournament");
  const back = url.searchParams.get("back") ?? "/";
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back : "/";
  const res = NextResponse.redirect(new URL(safeBack, req.url));
  if (week) res.cookies.set(`viewWeek_${leagueId}`, week, { path: "/", httpOnly: true, sameSite: "lax" });
  if (tournamentId) {
    if (!await canViewTournament(membership.league.tournamentId, tournamentId)) {
      return NextResponse.json({ error: "This season is newer than the league and cannot be viewed" }, { status: 403 });
    }
    res.cookies.set(`dataTournament_${leagueId}`, tournamentId, { path: "/", httpOnly: true, sameSite: "lax" });
  }
  return res;
}
