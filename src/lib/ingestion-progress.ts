export type IngestionProgress = {
  percent: number;
  message: string;
  updatedAt: string;
};

// A live importer writes a heartbeat before every API request and while it is
// backing off for rate limits. Network requests are capped at one minute, so a
// ten-minute silence is safely outside normal operation.
export const INGESTION_STALE_MS = 10 * 60 * 1000;

export function encodeIngestionProgress(percent: number, message: string, updatedAt = new Date()) {
  return JSON.stringify({
    progress: {
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      message,
      updatedAt: updatedAt.toISOString(),
    },
  });
}

export function decodeIngestionProgress(summary: string | null): IngestionProgress | null {
  if (!summary) return null;
  try {
    const parsed = JSON.parse(summary) as { progress?: Partial<IngestionProgress> };
    const progress = parsed.progress;
    if (!progress || typeof progress.percent !== "number" || typeof progress.message !== "string" || typeof progress.updatedAt !== "string") {
      return null;
    }
    return {
      percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      message: progress.message,
      updatedAt: progress.updatedAt,
    };
  } catch {
    return null;
  }
}

export function ingestionHeartbeatAt(run: { summary: string | null; startedAt: Date }) {
  const progress = decodeIngestionProgress(run.summary);
  if (!progress) return run.startedAt;
  const heartbeat = new Date(progress.updatedAt);
  return Number.isNaN(heartbeat.getTime()) ? run.startedAt : heartbeat;
}

export function isIngestionRunStale(
  run: { summary: string | null; startedAt: Date },
  now = new Date(),
  staleAfterMs = INGESTION_STALE_MS,
) {
  return now.getTime() - ingestionHeartbeatAt(run).getTime() > staleAfterMs;
}
