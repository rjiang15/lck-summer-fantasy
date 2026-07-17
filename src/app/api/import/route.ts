import { NextRequest, NextResponse } from "next/server";
import { importLeague, type Backup } from "@/lib/backup";
import { requireLeagueOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const leagueId = Number(req.nextUrl.searchParams.get("leagueId"));
  try { await requireLeagueOwner(leagueId); } catch { return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }); }
  let body: Backup;
  try {
    body = (await req.json()) as Backup;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const result = await importLeague(leagueId, body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
