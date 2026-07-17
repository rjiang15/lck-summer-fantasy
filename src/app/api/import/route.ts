import { NextRequest, NextResponse } from "next/server";
import { importLeague, type Backup } from "@/lib/backup";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.isCommish) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  let body: Backup;
  try {
    body = (await req.json()) as Backup;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const result = await importLeague(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
