// Sets the split / week-cursor cookies and bounces back to the page you were on.
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tournament = url.searchParams.get("tournament");
  const week = url.searchParams.get("week");
  const back = url.searchParams.get("back") ?? "/";
  const res = NextResponse.redirect(new URL(back, req.url));
  if (tournament) {
    res.cookies.set("viewTournament", tournament, { path: "/" });
    // switching splits resets the week cursor
    res.cookies.set("viewWeek", week ?? "final", { path: "/" });
  } else if (week) {
    res.cookies.set("viewWeek", week, { path: "/" });
  }
  return res;
}
