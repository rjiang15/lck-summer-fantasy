import type { FantasyRosterTradeException } from "@/lib/roster-trade-exceptions";
import { TeamLabel } from "./GameIdentity";

export default function RosterTradeExceptionNotice({
  exceptions,
}: {
  exceptions: readonly FantasyRosterTradeException[];
}) {
  if (exceptions.length === 0) return null;
  const effectiveLabel = exceptions[0].effectiveLabel;
  return <aside className="notice card roster-trade-exception-note" aria-label="One-time ADC trade exception">
    <div>
      <span className="badge pending">One-time exception</span>
      <h2>July 30 ADC trade ruling</h2>
    </div>
    <p>
      Effective {effectiveLabel}, these signed-player rights cross the original
      draft groups. Match lines before the effective date keep their former team
      assignment, and already-published fantasy scores remain unchanged.
    </p>
    <ul>
      {exceptions.map((exception) => <li key={exception.id}>
        {exception.replacesPlayerName ? <>
          <b>{exception.ownerLabel}</b> replaces <b>{exception.replacesPlayerName}</b> with{" "}
          <b>{exception.playerName}</b> as the signed {exception.retainedGroup} ADC after{" "}
          {exception.playerName}&apos;s move to <TeamLabel name={exception.currentTeamId} size="xs" />{" "}
          ({exception.currentGroup}).
        </> : <>
          <b>{exception.ownerLabel}</b> keeps <b>{exception.playerName}</b> as the{" "}
          {exception.retainedGroup} ADC after the move to <TeamLabel name={exception.currentTeamId} size="xs" />{" "}
          ({exception.currentGroup}).
        </>} If {exception.playerName} logs no games, the normal capped substitute credit
        uses the ADC fielded by {exception.currentTeamId}.
      </li>)}
    </ul>
  </aside>;
}
