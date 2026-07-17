"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

type ProgressStatus = {
  status: string;
  percent: number;
  message: string;
  updatedAt: string | null;
  startedAt: string | null;
};

export function IngestButton({
  label,
  leagueId,
  weekNumber,
  source,
  disabled = false,
  running = false,
}: {
  label: string;
  leagueId: number;
  weekNumber: number;
  source: "LEAGUEPEDIA" | "LEAGUEPEDIA_SCHEDULE";
  disabled?: boolean;
  running?: boolean;
}) {
  const { pending } = useFormStatus();
  const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null);
  const [progress, setProgress] = useState<ProgressStatus | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const active = pending || running;

  useEffect(() => {
    if (!active) return;
    const localStart = pending ? requestStartedAt ?? Date.now() : null;
    let cancelled = false;

    async function poll() {
      const query = new URLSearchParams({
        leagueId: String(leagueId),
        weekNumber: String(weekNumber),
        source,
        ...(localStart ? { since: String(localStart) } : {}),
      });
      try {
        const response = await fetch(`/api/ingestion-status?${query}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Status unavailable");
        const next = await response.json() as ProgressStatus;
        if (!cancelled) setProgress(next);
      } catch {
        if (!cancelled) {
          setProgress((current) => current ?? {
            status: "WAITING",
            percent: 2,
            message: "Waiting for the import status service…",
            updatedAt: null,
            startedAt: localStart ? new Date(localStart).toISOString() : null,
          });
        }
      }
      if (!cancelled) setClock(Date.now());
    }

    void poll();
    const pollTimer = window.setInterval(() => void poll(), 750);
    const clockTimer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      window.clearInterval(clockTimer);
    };
  }, [active, leagueId, pending, requestStartedAt, source, weekNumber]);

  const shown = progress ?? {
    status: "WAITING",
    percent: 2,
    message: "Starting import…",
    updatedAt: null,
    startedAt: requestStartedAt ? new Date(requestStartedAt).toISOString() : null,
  };
  const elapsed = shown.startedAt ? Math.max(0, Math.floor((clock - new Date(shown.startedAt).getTime()) / 1_000)) : 0;
  const heartbeatAge = shown.updatedAt ? Math.max(0, Math.floor((clock - new Date(shown.updatedAt).getTime()) / 1_000)) : null;

  return (
    <div className="ingest-control">
      <button
        type="submit"
        disabled={pending || disabled}
        aria-disabled={pending || disabled}
        onClick={() => {
          setRequestStartedAt(Date.now());
          setProgress(null);
        }}
      >
        {active ? "Fetching…" : label}
      </button>
      {active && (
        <div className="ingest-progress" role="status" aria-live="polite">
          <div className="ingest-progress-label">
            <span>{shown.message}</span>
            <b>{shown.percent}%</b>
          </div>
          <div
            className="ingest-progress-track"
            role="progressbar"
            aria-label="Data import progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={shown.percent}
          >
            <span style={{ width: `${shown.percent}%` }} />
          </div>
          <span className="muted small">
            Elapsed {formatElapsed(elapsed)}
            {heartbeatAge !== null ? ` · backend updated ${heartbeatAge === 0 ? "just now" : `${heartbeatAge}s ago`}` : " · waiting for backend heartbeat"}
          </span>
        </div>
      )}
    </div>
  );
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}
