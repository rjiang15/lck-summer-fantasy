export type IngestionProgress = {
  percent: number;
  message: string;
  updatedAt: string;
};

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
