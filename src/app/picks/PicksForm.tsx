"use client";

import { useActionState, useState } from "react";
import { savePicks, type PickSaveState } from "./actions";

type MatchPick = {
  id: string;
  team1: string;
  team2: string;
  bestOf: number;
  dateLabel: string;
  started: boolean;
  existingWinner: string | null;
  existingLoserGames: number;
};

type Selection = { winner: string | null; loserGames: number };

export default function PicksForm({ leagueId, leagueWeekId, matches, weekLocked }: { leagueId: number; leagueWeekId: number; matches: MatchPick[]; weekLocked: boolean }) {
  const [result, formAction, pending] = useActionState<PickSaveState, FormData>(savePicks, null);
  const [selections, setSelections] = useState<Record<string, Selection>>(() => Object.fromEntries(matches.map((match) => [match.id, {
    winner: match.existingWinner,
    loserGames: match.existingLoserGames,
  }])));
  const editable = matches.filter((match) => !match.started);
  const selectedCount = editable.filter((match) => selections[match.id]?.winner).length;

  function chooseWinner(match: MatchPick, winner: string) {
    setSelections((current) => ({ ...current, [match.id]: { winner, loserGames: current[match.id]?.loserGames ?? 0 } }));
  }

  function adjustLoserGames(match: MatchPick, delta: number) {
    const max = Math.floor(match.bestOf / 2);
    setSelections((current) => {
      const selection = current[match.id] ?? { winner: null, loserGames: 0 };
      return { ...current, [match.id]: { ...selection, loserGames: Math.max(0, Math.min(max, selection.loserGames + delta)) } };
    });
  }

  return <form action={formAction} className="pickem-form">
    <input type="hidden" name="leagueId" value={leagueId} />
    <input type="hidden" name="leagueWeekId" value={leagueWeekId} />
    <div className="pickem-list">{matches.map((match) => {
      const selection = selections[match.id] ?? { winner: null, loserGames: 0 };
      const loser = selection.winner === match.team1 ? match.team2 : selection.winner === match.team2 ? match.team1 : null;
      const needed = Math.floor(match.bestOf / 2) + 1;
      const score = selection.winner === match.team1 ? `${needed}-${selection.loserGames}` : `${selection.loserGames}-${needed}`;
      return <article className={`card pickem-card${match.started ? " locked" : ""}`} key={match.id}>
        <div className="pickem-meta"><span>{match.dateLabel}</span><span>Best of {match.bestOf}</span>{match.started && <span className="badge pending">locked</span>}</div>
        <div className="pickem-teams" aria-label={`${match.team1} versus ${match.team2}`}>
          {[match.team1, match.team2].map((team) => <button type="button" aria-pressed={selection.winner === team} className={selection.winner === team ? "selected" : ""} disabled={match.started} onClick={() => chooseWinner(match, team)} key={team}><span>{team}</span><small>{selection.winner === team ? "Your winner" : "Pick to win"}</small></button>)}
        </div>
        {match.started ? <p className="pickem-result">{selection.winner ? <><b>{selection.winner}</b> to win {score}</> : "No pick submitted"}</p> : selection.winner && loser ? <div className="loser-counter">
          <span><b>{loser}</b> will get</span>
          <div className="counter-control">
            <button type="button" aria-label={`Decrease ${loser} games`} disabled={selection.loserGames === 0} onClick={() => adjustLoserGames(match, -1)}>−</button>
            <strong aria-live="polite">{selection.loserGames}</strong>
            <button type="button" aria-label={`Increase ${loser} games`} disabled={selection.loserGames >= needed - 1} onClick={() => adjustLoserGames(match, 1)}>＋</button>
          </div>
          <span>game{selection.loserGames === 1 ? "" : "s"}</span><span className="pickem-score">Prediction: {selection.winner} {score}</span>
        </div> : <p className="pickem-prompt">Click the team you think will win.</p>}
        <input type="hidden" name={`winner_${match.id}`} value={selection.winner ?? ""} />
        <input type="hidden" name={`loserGames_${match.id}`} value={selection.loserGames} />
      </article>;
    })}</div>
    <section className="card pickem-save">
      {weekLocked ? <div><b>Week locked</b><span className="muted small">Your submitted picks can no longer be changed.</span></div> : <>
        <div><b>{selectedCount} of {editable.length} unlocked series selected</b><span className="muted small">One click saves the entire upcoming slate.</span></div>
        <button type="submit" disabled={pending || editable.length === 0}>{pending ? "Saving…" : "Save all picks"}</button>
      </>}
    </section>
    {result && <p className={`${result.ok ? "notice" : "error"} card`} aria-live="polite">{result.message}</p>}
  </form>;
}
