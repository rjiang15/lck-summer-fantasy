import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ACTIVE_LEAGUE_COOKIE } from "@/lib/leagues";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const slug = request.nextUrl.searchParams.get("slug") ?? "";
  const back = request.nextUrl.searchParams.get("back") ?? "/";
  const membership = await prisma.leagueMembership.findFirst({ where: { userId: user.id, league: { slug } } });
  if (!membership) return NextResponse.json({ error: "You are not a member of that league" }, { status: 403 });
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back : "/";
  const response = NextResponse.redirect(new URL(safeBack, request.url));
  response.cookies.set(ACTIVE_LEAGUE_COOKIE, slug, { httpOnly: true, sameSite: "lax", path: "/" });
  return response;
}
