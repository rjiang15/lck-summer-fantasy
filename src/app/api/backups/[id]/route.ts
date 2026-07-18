import { getCurrentUser } from "@/lib/auth";
import { parseBackupJson } from "@/lib/backup-format";
import { prisma } from "@/lib/db";
import { isManagerRole } from "@/lib/leagues";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await context.params;
  const backupId = Number(id);
  if (!Number.isInteger(backupId)) return Response.json({ error: "Invalid checkpoint" }, { status: 400 });
  const backup = await prisma.leagueBackup.findUnique({ where: { id: backupId } });
  if (!backup) return Response.json({ error: "Checkpoint not found" }, { status: 404 });
  let allowed = user.siteAdmin || backup.ownerUserId === user.id;
  if (!allowed && !backup.sourceDeletedAt) {
    const membership = await prisma.leagueMembership.findUnique({
      where: { leagueId_userId: { leagueId: backup.originalLeagueId, userId: user.id } },
    });
    allowed = Boolean(membership && isManagerRole(membership.role));
  }
  if (!allowed) return Response.json({ error: "Forbidden" }, { status: 403 });
  const snapshot = parseBackupJson(backup.snapshotJson);
  const date = backup.createdAt.toISOString().slice(0, 10);
  const name = backup.originalLeagueName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new Response(JSON.stringify(snapshot, null, 2), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="lck-fantasy-${name}-checkpoint-${backup.id}-${date}.json"`,
    },
  });
}
