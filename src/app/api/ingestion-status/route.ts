import { requireLeagueManager } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decodeIngestionProgress, isIngestionRunStale } from "@/lib/ingestion-progress";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const leagueId = Number(params.get("leagueId"));
  const weekNumber = Number(params.get("weekNumber"));
  const source = params.get("source");
  const since = Number(params.get("since"));
  if (!Number.isInteger(leagueId) || !Number.isInteger(weekNumber) || !["GAMES_OF_LEGENDS", "GAMES_OF_LEGENDS_LIVE", "LEAGUEPEDIA_SCHEDULE"].includes(source ?? "")) {
    return Response.json({ error: "Invalid ingestion status request" }, { status: 400 });
  }

  try {
    const { league } = await requireLeagueManager(leagueId);
    const run = await prisma.ingestionRun.findFirst({
      where: {
        tournamentId: league.tournamentId,
        weekNumber,
        source: source!,
        ...(Number.isFinite(since) && since > 0 ? { startedAt: { gte: new Date(since - 2_000) } } : {}),
      },
      orderBy: { startedAt: "desc" },
    });
    if (!run) {
      return Response.json({ status: "WAITING", percent: 2, message: "Starting import…", updatedAt: null, startedAt: null });
    }
    const progress = decodeIngestionProgress(run.summary);
    return Response.json({
      id: run.id,
      status: run.status,
      percent: run.status === "SUCCEEDED" ? 100 : progress?.percent ?? (run.status === "FAILED" ? 100 : 3),
      message: run.status === "SUCCEEDED" ? "Import complete" : run.status === "FAILED" ? run.error ?? "Import failed" : progress?.message ?? "Import is running…",
      updatedAt: progress?.updatedAt ?? run.startedAt.toISOString(),
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      stale: run.status === "RUNNING" && isIngestionRunStale(run),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Commissioner access required" }, { status: 403 });
  }
}
