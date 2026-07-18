import { NextRequest, NextResponse } from "next/server";
import { importLeague } from "@/lib/backup";
import { parseBackupJson } from "@/lib/backup-format";
import { requireLeagueOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const leagueId = Number(req.nextUrl.searchParams.get("leagueId"));
  let access: Awaited<ReturnType<typeof requireLeagueOwner>>;
  try { access = await requireLeagueOwner(leagueId); } catch { return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }); }
  let body: ReturnType<typeof parseBackupJson>;
  try {
    body = parseBackupJson(await req.text());
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid backup" }, { status: 400 });
  }
  const result = await importLeague(leagueId, body, access.user.id);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
