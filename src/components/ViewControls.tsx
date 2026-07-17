"use client";

// Split dropdown + week cursor, top-right of the nav.
// "Week X" = stats after all of week X's games (Week 0 = preseason).
import { usePathname } from "next/navigation";

export default function ViewControls({
  leagueId,
  completedWeek,
  maxWeek,
  isLive,
}: {
  leagueId: number;
  completedWeek: number | null; // null = Final
  maxWeek: number;
  isLive: boolean;
}) {
  const pathname = usePathname();
  const go = (params: string) => {
    window.location.href = `/api/view?leagueId=${leagueId}&${params}&back=${encodeURIComponent(pathname)}`;
  };

  const prev = completedWeek === null ? maxWeek - 1 : Math.max(0, completedWeek - 1);
  const next =
    completedWeek === null ? null : completedWeek + 1 >= maxWeek ? "final" : completedWeek + 1;
  const label = isLive
    ? completedWeek === 0
      ? "Live · preseason"
      : `Live · after Week ${completedWeek}`
    :
    completedWeek === null
      ? "Final"
      : completedWeek === 0
        ? "Week 0 · preseason"
        : `After Week ${completedWeek}`;

  return (
    <span className="view-controls">
      {!isLive && <button
          onClick={() => go(`week=${prev}`)}
          disabled={completedWeek === 0}
          title="back one week"
        >
          ◀
        </button>}
      <b className="view-label">{label}</b>
      {!isLive && <button
          onClick={() => next !== null && go(`week=${next}`)}
          disabled={completedWeek === null}
          title="forward one week"
        >
          ▶
        </button>}
    </span>
  );
}
