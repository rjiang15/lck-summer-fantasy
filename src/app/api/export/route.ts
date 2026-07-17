import { NextResponse } from "next/server";
import { exportLeague } from "@/lib/backup";
import { requireLeagueManager } from "@/lib/auth";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const leagueId = Number(req.nextUrl.searchParams.get("leagueId"));
  try { await requireLeagueManager(leagueId); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  const backup = await exportLeague(leagueId);
  if (!backup) {
    return NextResponse.json({ error: "No league to export" }, { status: 404 });
  }
  const date = backup.exportedAt.slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="lck-fantasy-${backup.league.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${date}.json"`,
    },
  });
}
