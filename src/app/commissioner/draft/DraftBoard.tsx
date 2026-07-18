"use client";

import { useState } from "react";
import {
  DRAFT_ROLES,
  conservativeDraftCompletionCost,
  draftBudgetBlockReason,
  draftSlotAvailable,
  draftPoolSupportsAllTeams,
  type DraftCompositionPlayer,
  type DraftGroup,
  type DraftRole,
} from "@/lib/draft";
import { makeDraftPick, undoDraftPick } from "./actions";
import { TeamLabel } from "@/components/GameIdentity";

type Pick = { id: number; playerId: string; playerName: string; proTeam: string | null; role: string; group: DraftGroup | null; price: number; overallPick: number };
type Team = { id: number; name: string; username: string; picks: Pick[] };
type Player = { id: string; name: string; teamId: string | null; role: DraftRole; group: DraftGroup | null; price: number; ppg: number | null; games: number };

export default function DraftBoard({
  leagueId, status, currentPick, totalPicks, currentTeamId, budget, uniformPrice, pricingMode, priceSource,
  budgetGuardEnabled, playersPerRole, groupKeys, groups, order, teams, availablePlayers,
}: {
  leagueId: number; status: string; currentPick: number; totalPicks: number; currentTeamId: number | null;
  budget: number; uniformPrice: number; pricingMode: string; priceSource: string | null; budgetGuardEnabled: boolean; playersPerRole: number;
  groupKeys: DraftGroup[]; groups: Array<{ key: DraftGroup; label: string }>;
  order: number[]; teams: Team[]; availablePlayers: Player[];
}) {
  const [selection, setSelection] = useState({ teamId: currentTeamId ?? teams[0]?.id ?? 0, atPick: currentPick });
  const [selectedRole, setSelectedRole] = useState<"ALL" | DraftRole>("ALL");
  const [selectedGroup, setSelectedGroup] = useState<"ALL" | DraftGroup>("ALL");
  const [showDraftableOnly, setShowDraftableOnly] = useState(false);
  const [viewMode, setViewMode] = useState<"CARDS" | "TABLE">("CARDS");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedTeamId = selection.atPick === currentPick ? selection.teamId : currentTeamId ?? selection.teamId;
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0];
  const currentTeam = teams.find((team) => team.id === currentTeamId);

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

  const currentComposition: DraftCompositionPlayer[] = currentTeam?.picks.flatMap((pick) => {
    if (!DRAFT_ROLES.includes(pick.role as DraftRole)) return [];
    return [{ playerId: pick.playerId, role: pick.role as DraftRole, group: pick.group, price: pick.price }];
  }) ?? [];
  const currentSpent = currentComposition.reduce((sum, pick) => sum + pick.price, 0);
  const everyTeamComposition = teams.map((team) => team.picks.flatMap((pick): DraftCompositionPlayer[] => {
    if (!DRAFT_ROLES.includes(pick.role as DraftRole)) return [];
    return [{ playerId: pick.playerId, role: pick.role as DraftRole, group: pick.group, price: pick.price }];
  }));
  const currentTeamIndex = teams.findIndex((team) => team.id === currentTeamId);
  const draftOptions = availablePlayers.map((player) => {
    const candidate: DraftCompositionPlayer = { playerId: player.id, role: player.role, group: player.group, price: player.price };
    const slotAvailable = draftSlotAvailable(currentComposition, candidate, playersPerRole, groupKeys);
    const remainingPool = availablePlayers.filter((row) => row.id !== player.id).map((row): DraftCompositionPlayer => ({ playerId: row.id, role: row.role, group: row.group, price: row.price }));
    const nextCompositions = everyTeamComposition.map((picks) => [...picks]);
    if (currentTeamIndex >= 0) nextCompositions[currentTeamIndex] = [...currentComposition, candidate];
    const preservesLeaguePool = slotAvailable && currentTeamIndex >= 0 && draftPoolSupportsAllTeams(nextCompositions, remainingPool, playersPerRole, groupKeys);
    const conservativeReserve = preservesLeaguePool && budgetGuardEnabled
      ? conservativeDraftCompletionCost(currentTeamIndex, nextCompositions, remainingPool, playersPerRole, groupKeys)
      : 0;
    const budgetBlock = draftBudgetBlockReason(currentSpent, player.price, budget, budgetGuardEnabled, conservativeReserve);
    const draftable = slotAvailable && preservesLeaguePool && budgetBlock === null;
    const groupLabel = groups.find((group) => group.key === player.group)?.label;
    const statusLabel = !slotAvailable
      ? `${groupLabel ? `${groupLabel} ` : ""}${player.role} full`
      : !preservesLeaguePool
        ? "Needed by another roster"
        : budgetBlock === "OVER_BUDGET"
          ? "Over remaining budget"
          : budgetBlock === "BREAKS_RESERVE"
            ? "Would break budget reserve"
            : "Draftable";
    return { player, draftable, groupLabel, statusLabel };
  });
  const filteredOptions = draftOptions.filter(({ player, draftable }) =>
    (selectedRole === "ALL" || player.role === selectedRole)
    && (selectedGroup === "ALL" || player.group === selectedGroup)
    && (!showDraftableOnly || draftable));

  return <>
    <section className="card draft-status">
      <div>
        <span className="draft-kicker">Snake draft · {pricingMode === "DYNAMIC" ? "dynamic prices" : "uniform prices"} · budget reserve {budgetGuardEnabled ? "on" : "off"}</span>
        <h2>{status === "COMPLETE" ? "Draft complete" : `${currentTeam?.name ?? "No team"} is on the clock`}</h2>
        <p className="muted small">{status === "COMPLETE" ? `${totalPicks} players drafted` : `Pick ${currentPick + 1} of ${totalPicks}`} · {playersPerRole} players per role · {pricingMode === "DYNAMIC" ? `frozen from ${priceSource?.includes("1-2") ? "R1–2 Pts/G" : "historical Pts/G"}` : `${money(uniformPrice)} each`}</p>
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
          return <div key={role}><h3>{role} <span className="muted">{picks.length}/{playersPerRole}</span></h3>
            {groups.length > 0 ? groups.map((group) => <DraftedSlot pick={picks.find((pick) => pick.group === group.key)} group={group} role={role} key={group.key} />) : Array.from({ length: playersPerRole }, (_, index) => <DraftedSlot pick={picks[index]} role={role} key={`${role}-${index}`} />)}
          </div>;
        })}</div>
      </div>}
    </section>

    {status === "ACTIVE" && <section>
      <div className="section-heading"><div><h2>Available players</h2><p className="muted small">Drafted players disappear immediately. Role and league-wide pool safeguards stay active; the future-slot budget reserve is {budgetGuardEnabled ? "on" : "off"}.</p></div><span className="badge pending">{filteredOptions.length} shown · {draftOptions.filter((option) => option.draftable).length} draftable</span></div>
      <div className="draft-view-controls">
        <div className="draft-view-toggle" role="group" aria-label="Player view">
          <button type="button" className={viewMode === "CARDS" ? "active" : ""} aria-pressed={viewMode === "CARDS"} onClick={() => setViewMode("CARDS")}>Cards</button>
          <button type="button" className={viewMode === "TABLE" ? "active" : ""} aria-pressed={viewMode === "TABLE"} onClick={() => setViewMode("TABLE")}>Table</button>
        </div>
        <label className="draft-available-toggle"><input type="checkbox" checked={showDraftableOnly} onChange={(event) => setShowDraftableOnly(event.target.checked)} /><span>Show draftable only</span></label>
      </div>
      {groups.length > 0 && <div className="draft-group-filters" role="tablist" aria-label="Filter available players by group">
        <button type="button" role="tab" aria-selected={selectedGroup === "ALL"} className={selectedGroup === "ALL" ? "active" : ""} onClick={() => setSelectedGroup("ALL")}>All groups</button>
        {groups.map((group) => <button type="button" role="tab" aria-selected={selectedGroup === group.key} className={`draft-group-${group.key.toLowerCase()} ${selectedGroup === group.key ? "active" : ""}`} onClick={() => setSelectedGroup(group.key)} key={group.key}>{group.label}<small>{availablePlayers.filter((player) => player.group === group.key).length}</small></button>)}
      </div>}
      <div className="draft-role-filters" role="tablist" aria-label="Filter available players by role">
        <button type="button" role="tab" aria-selected={selectedRole === "ALL"} className={selectedRole === "ALL" ? "active" : ""} onClick={() => setSelectedRole("ALL")}>All roles<small>{availablePlayers.filter((player) => selectedGroup === "ALL" || player.group === selectedGroup).length}</small></button>
        {DRAFT_ROLES.map((role) => <button type="button" role="tab" aria-selected={selectedRole === role} className={selectedRole === role ? "active" : ""} onClick={() => setSelectedRole(role)} key={role}>{role}<small>{availablePlayers.filter((player) => player.role === role && (selectedGroup === "ALL" || player.group === selectedGroup)).length}</small></button>)}
      </div>
      {filteredOptions.length === 0 ? <p className="card muted">No players match these filters.</p> : viewMode === "CARDS" ? <div className="draft-player-grid">{filteredOptions.map(({ player, draftable, groupLabel, statusLabel }) => <form action={submitPick} className={`draft-player-card ${player.group ? `draft-group-${player.group.toLowerCase()}` : ""}`} key={player.id}>
        <input type="hidden" name="leagueId" value={leagueId} /><input type="hidden" name="playerId" value={player.id} />
        <div className="draft-player-card-title"><div><b>{player.name}</b>{player.teamId ? <TeamLabel name={player.teamId} size="xs" /> : <span>Free agent</span>}</div>{groupLabel && <span className={`draft-group-badge draft-group-${player.group?.toLowerCase()}`}>{groupLabel}</span>}</div>
        <div className="draft-player-value"><b>{money(player.price)}</b><span>{player.ppg === null ? "No R1–2 data · peer average" : `${player.ppg.toFixed(1)} Pts/G · ${player.games} games`}</span></div>
        <button type="submit" disabled={busy || !draftable}>{busy ? "Updating…" : draftable ? `Draft · ${money(player.price)}` : statusLabel}</button>
      </form>)}</div> : <div className="tablewrap draft-player-table"><table>
        <thead><tr><th>Player</th><th>Team</th><th>Group</th><th>Role</th><th>R1–2 Pts/G</th><th>Price</th><th>Status</th></tr></thead>
        <tbody>{filteredOptions.map(({ player, draftable, groupLabel, statusLabel }) => <tr className={player.group ? `draft-group-${player.group.toLowerCase()}` : ""} key={player.id}>
          <td><b>{player.name}</b></td><td>{player.teamId ? <TeamLabel name={player.teamId} size="xs" /> : "Free agent"}</td><td>{groupLabel && <span className={`draft-group-badge draft-group-${player.group?.toLowerCase()}`}>{groupLabel}</span>}</td><td>{player.role}</td><td>{player.ppg === null ? <span className="muted">Peer average</span> : <><b>{player.ppg.toFixed(1)}</b><span className="muted small"> · {player.games} games</span></>}</td><td><b>{money(player.price)}</b></td><td><form action={submitPick} className="inline-form"><input type="hidden" name="leagueId" value={leagueId} /><input type="hidden" name="playerId" value={player.id} /><button type="submit" disabled={busy || !draftable}>{busy ? "Updating…" : draftable ? "Draft" : statusLabel}</button></form></td>
        </tr>)}</tbody>
      </table></div>}
    </section>}

    <section className="card">
      <h2 style={{ marginTop: 0 }}>Locked draft order</h2>
      <ol className="draft-order">{order.map((teamId) => { const team = teams.find((item) => item.id === teamId); return <li key={teamId}><b>{team?.username}</b><span className="muted small">{team?.name}</span></li>; })}</ol>
      <p className="muted small">Rounds alternate forward and backward. The same participant receives consecutive picks at each turn of the snake.</p>
    </section>
  </>;
}

function DraftedSlot({ pick, group, role }: { pick?: Pick; group?: { key: DraftGroup; label: string }; role: DraftRole }) {
  return pick ? <div className={`drafted-player ${group ? `draft-group-${group.key.toLowerCase()}` : ""}`}><span className="drafted-player-label">{group?.label ?? role}</span><b>{pick.playerName}</b><span className="draft-player-team">{pick.proTeam ? <TeamLabel name={pick.proTeam} size="xs" /> : "Free agent"}<i>#{pick.overallPick} · {money(pick.price)}</i></span></div> : <div className={`drafted-player empty ${group ? `draft-group-${group.key.toLowerCase()}` : ""}`}><span className="drafted-player-label">{group?.label ?? role}</span>Open slot</div>;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}
