// Weekly history: week-by-week fantasy scores and running totals.
import Link from "next/link";
import { computeStandings, fmtDate, round1 } from "@/lib/fantasy";
import { getViewState } from "@/lib/view";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const view = await getViewState();
  const result = await computeStandings(view?.cutoff ?? null);
  if (!result) return <p>No league set up yet. Run the seed script.</p>;
  const { standings } = result;
  // With a week cursor, only completed weeks belong in the history
  const weeks =
    view?.completedWeek == null
      ? result.weeks
      : result.weeks.filter((w) => w.number <= view.completedWeek!);

  // Running totals per team per week (roster + pickems)
  const running = standings.map((s) => {
    let acc = 0;
    return {
      ...s,
      cumulative: s.weekly.map((w) => {
        acc = round1(acc + w.rosterPts + w.pickemPts);
        return acc;
      }),
    };
  });

  return (
    <>
      <h1>Weekly history</h1>
      <p className="muted small">
        Roster + pickem points per week for each participant (crystal ball settles at the
        end of the split).
      </p>

      {weeks.map((week, wi) => {
        const rows = [...running].sort(
          (a, b) =>
            b.weekly[wi].rosterPts +
            b.weekly[wi].pickemPts -
            (a.weekly[wi].rosterPts + a.weekly[wi].pickemPts),
        );
        return (
          <section key={week.number}>
            <h2>
              Week {week.number}{" "}
              <span className="muted small">
                {fmtDate(week.startsAt)} – {fmtDate(week.endsAt)}
              </span>
            </h2>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Participant</th>
                    <th className="num">Roster pts</th>
                    <th className="num">Pickem pts</th>
                    <th className="num">Week total</th>
                    <th className="num">Running total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s, i) => {
                    const w = s.weekly[wi];
                    return (
                      <tr key={s.fantasyTeamId}>
                        <td>{i + 1}</td>
                        <td>
                          <Link href={`/participants/${s.fantasyTeamId}`}>{s.username}</Link>
                        </td>
                        <td className="num">{w.rosterPts}</td>
                        <td className="num">{w.pickemPts}</td>
                        <td className="num">
                          <b>{round1(w.rosterPts + w.pickemPts)}</b>
                        </td>
                        <td className="num">{s.cumulative[wi]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
