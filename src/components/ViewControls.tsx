"use client";

// Split dropdown + week cursor, top-right of the nav.
// "Week X" = stats after all of week X's games (Week 0 = preseason).
import { usePathname } from "next/navigation";

export default function ViewControls({
  tournaments,
  tournamentId,
  completedWeek,
  maxWeek,
  isLive,
}: {
  tournaments: { id: string; name: string }[];
  tournamentId: string;
  completedWeek: number | null; // null = Final
  maxWeek: number;
  isLive: boolean;
}) {
  const pathname = usePathname();
  const go = (params: string) => {
    window.location.href = `/api/view?${params}&back=${encodeURIComponent(pathname)}`;
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
    <span
      style={{
        marginLeft: "auto",
        display: "inline-flex",
        gap: "0.5rem",
        alignItems: "center",
      }}
    >
      <select
        value={tournamentId}
        onChange={(e) => go(`tournament=${encodeURIComponent(e.target.value)}`)}
        style={{ maxWidth: "220px" }}
      >
        {tournaments.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {!isLive && <button
          onClick={() => go(`week=${prev}`)}
          disabled={completedWeek === 0}
          title="back one week"
        >
          ◀
        </button>}
      <b style={{ minWidth: "7.5rem", textAlign: "center", fontSize: "0.9rem" }}>{label}</b>
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
