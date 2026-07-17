import { NextResponse } from "next/server";
import { exportLeague } from "@/lib/backup";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.isCommish) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const backup = await exportLeague();
  if (!backup) {
    return NextResponse.json({ error: "No league to export" }, { status: 404 });
  }
  const date = backup.exportedAt.slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="lck-fantasy-backup-${date}.json"`,
    },
  });
}
