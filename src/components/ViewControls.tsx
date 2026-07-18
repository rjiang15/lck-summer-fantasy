"use client";

// Split dropdown + week cursor, top-right of the nav.
// "Week X" = stats after all of week X's games (Week 0 = preseason).
import { usePathname } from "next/navigation";

export default function ViewControls({
  leagueId,
  completedWeek,
  maxWeek,
  isLive,
  isResearch,
  selectedTournamentId,
  leagueTournamentId,
  tournaments,
}: {
  leagueId: number;
  completedWeek: number | null; // null = Final
  maxWeek: number;
  isLive: boolean;
  isResearch: boolean;
  selectedTournamentId: string;
  leagueTournamentId: string;
  tournaments: { id: string; name: string; status: string }[];
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

  const dataPath = pathname === "/" || pathname === "/macro" || pathname === "/stats" || pathname.startsWith("/games/")
    ? pathname
    : "/";

  return (
    <span className="view-controls">
      <label className="season-picker">
        <span>Stats season</span>
        <select
          aria-label="Stats season"
          value={selectedTournamentId}
          onChange={(event) => {
            window.location.href = `/api/view?leagueId=${leagueId}&tournament=${encodeURIComponent(event.target.value)}&back=${encodeURIComponent(dataPath)}`;
          }}
        >
          {tournaments.map((tournament) => (
            <option value={tournament.id} key={tournament.id}>
              {tournament.id === leagueTournamentId ? "Current league · " : "Past data · "}{tournament.name}
            </option>
          ))}
        </select>
      </label>
      {!isLive && !isResearch && <button
          onClick={() => go(`week=${prev}`)}
          disabled={completedWeek === 0}
          title="back one week"
        >
          ◀
        </button>}
      <b className="view-label">{isResearch ? "Past season · final" : label}</b>
      {!isLive && !isResearch && <button
          onClick={() => next !== null && go(`week=${next}`)}
          disabled={completedWeek === null}
          title="forward one week"
        >
          ▶
        </button>}
    </span>
  );
}
