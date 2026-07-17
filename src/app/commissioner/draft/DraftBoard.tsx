"use client";

import { useState } from "react";
import { DRAFT_ROLES } from "@/lib/draft";
import { makeDraftPick, undoDraftPick } from "./actions";
import { TeamLabel } from "@/components/GameIdentity";

type Pick = { id: number; playerId: string; playerName: string; proTeam: string | null; role: string; price: number; overallPick: number };
type Team = { id: number; name: string; username: string; picks: Pick[] };
type Player = { id: string; name: string; teamId: string | null; role: string };

export default function DraftBoard({
  leagueId, status, currentPick, totalPicks, currentTeamId, budget, price, playersPerRole, order, teams, availablePlayers,
}: {
  leagueId: number; status: string; currentPick: number; totalPicks: number; currentTeamId: number | null;
  budget: number; price: number; playersPerRole: number; order: number[]; teams: Team[]; availablePlayers: Player[];
}) {
  const [selection, setSelection] = useState({ teamId: currentTeamId ?? teams[0]?.id ?? 0, atPick: currentPick });
  const [selectedRole, setSelectedRole] = useState<(typeof DRAFT_ROLES)[number]>("Top");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedTeamId = selection.atPick === currentPick ? selection.teamId : currentTeamId ?? selection.teamId;
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0];
  const currentTeam = teams.find((team) => team.id === currentTeamId);
  const rolePlayers = availablePlayers.filter((player) => player.role === selectedRole);

  async function submitPick(formData: FormData) {
    setBusy(true);
    setFeedback(await makeDraftPick(formData));
    setBusy(false);
  }

  async function submitUndo(formData: FormData) {
    setBusy(true);
    setFeedback(await undoDraftPick(formData));
    setBusy(false);
  }

  return <>
    <section className="card draft-status">
      <div>
        <span className="draft-kicker">Snake draft</span>
        <h2>{status === "COMPLETE" ? "Draft complete" : `${currentTeam?.name ?? "No team"} is on the clock`}</h2>
        <p className="muted small">{status === "COMPLETE" ? `${totalPicks} players drafted` : `Pick ${currentPick + 1} of ${totalPicks}`} · {playersPerRole} players per role · {money(price)} each</p>
      </div>
      <div className="draft-status-controls">
        <div className="draft-progress" aria-label={`${currentPick} of ${totalPicks} picks complete`}><span style={{ width: `${totalPicks ? currentPick / totalPicks * 100 : 0}%` }} /></div>
        <form action={submitUndo}><input type="hidden" name="leagueId" value={leagueId} /><button type="submit" disabled={busy || currentPick === 0}>↶ Undo last pick</button></form>
      </div>
    </section>
    {feedback && <p className={`${feedback.ok ? "notice" : "error"} card draft-feedback`} aria-live="polite">{feedback.message}</p>}

    <section>
      <div className="draft-tabs" role="tablist" aria-label="Participant rosters">
        {teams.map((team) => {
          const spent = team.picks.reduce((sum, pick) => sum + pick.price, 0);
          return <button type="button" role="tab" aria-selected={selectedTeam?.id === team.id} className={selectedTeam?.id === team.id ? "active" : ""} onClick={() => setSelection({ teamId: team.id, atPick: currentPick })} key={team.id}>
            <span>{team.username}</span><small>{team.picks.length}/10 · {money(budget - spent)} left</small>
          </button>;
        })}
      </div>
      {selectedTeam && <div className="card draft-roster" role="tabpanel">
        <div className="section-heading"><div><h2>{selectedTeam.name}</h2><p className="muted small">Managed by {selectedTeam.username}</p></div><b>{money(budget - selectedTeam.picks.reduce((sum, pick) => sum + pick.price, 0))} remaining</b></div>
        <div className="draft-role-grid">{DRAFT_ROLES.map((role) => {
          const picks = selectedTeam.picks.filter((pick) => pick.role === role);
          return <div key={role}><h3>{role} <span className="muted">{picks.length}/{playersPerRole}</span></h3>{Array.from({ length: playersPerRole }, (_, index) => {
            const pick = picks[index];
            return pick ? <div className="drafted-player" key={`${role}-${index}`}><b>{pick.playerName}</b><span className="draft-player-team">{pick.proTeam ? <TeamLabel name={pick.proTeam} size="xs" /> : "Free agent"}<i>#{pick.overallPick}</i></span></div> : <div className="drafted-player empty" key={`${role}-${index}`}>Open slot</div>;
          })}</div>;
        })}</div>
      </div>}
    </section>

    {status === "ACTIVE" && <section>
      <div className="section-heading"><div><h2>Available players</h2><p className="muted small">A drafted player immediately disappears from every role pool.</p></div><span className="badge pending">{availablePlayers.length} available</span></div>
      <div className="draft-role-filters" role="tablist" aria-label="Filter available players by role">{DRAFT_ROLES.map((role) => <button type="button" role="tab" aria-selected={selectedRole === role} className={selectedRole === role ? "active" : ""} onClick={() => setSelectedRole(role)} key={role}>{role}<small>{availablePlayers.filter((player) => player.role === role).length}</small></button>)}</div>
      <div className="draft-player-grid">{rolePlayers.map((player) => {
        const roleFull = (currentTeam?.picks.filter((pick) => pick.role === player.role).length ?? 0) >= playersPerRole;
        const insufficientBudget = budget - (currentTeam?.picks.reduce((sum, pick) => sum + pick.price, 0) ?? 0) < price;
        return <form action={submitPick} className="draft-player-card" key={player.id}>
          <input type="hidden" name="leagueId" value={leagueId} /><input type="hidden" name="playerId" value={player.id} />
          <div><b>{player.name}</b>{player.teamId ? <TeamLabel name={player.teamId} size="xs" /> : <span>Free agent</span>}</div>
          <button type="submit" disabled={busy || roleFull || insufficientBudget}>{busy ? "Updating…" : roleFull ? `${player.role} full` : `Draft · ${money(price)}`}</button>
        </form>;
      })}</div>
    </section>}

    <section className="card">
      <h2 style={{ marginTop: 0 }}>Locked draft order</h2>
      <ol className="draft-order">{order.map((teamId) => { const team = teams.find((item) => item.id === teamId); return <li key={teamId}><b>{team?.username}</b><span className="muted small">{team?.name}</span></li>; })}</ol>
      <p className="muted small">Rounds alternate forward and backward. The same participant receives consecutive picks at each turn of the snake.</p>
    </section>
  </>;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}
