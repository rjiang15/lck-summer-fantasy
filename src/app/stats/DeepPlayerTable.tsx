"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChampionLabel, TeamLabel } from "@/components/GameIdentity";

export type DeepPlayerRow = {
  id: string;
  name: string;
  team: string;
  role: string;
  fantasyPoints: number;
  fantasyPerGame: number;
  combatPointsPerGame: number;
  farmPointsPerGame: number;
  visionPointsPerGame: number;
  winPointsPerGame: number;
  killParticipationPointsPerGame: number;
  efficiencyPointsPerGame: number;
  jungleObjectivePointsPerGame: number;
  games: number;
  wins: number;
  winRate: number;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  killsPerGame: number;
  deathsPerGame: number;
  assistsPerGame: number;
  killParticipation: number | null;
  maxKills: number;
  damagePerGame: number | null;
  damageShare: number | null;
  objectiveDamagePerGame: number | null;
  towerDamagePerGame: number | null;
  damageTakenPerGame: number | null;
  damageMitigatedPerGame: number | null;
  healingPerGame: number | null;
  cs: number;
  csPerGame: number;
  maxCs: number;
  minionsPerGame: number | null;
  monstersPerGame: number | null;
  ownJungleMonstersPerGame: number | null;
  enemyJungleMonstersPerGame: number | null;
  goldPerGame: number | null;
  goldEarnedPerGame: number | null;
  goldSpentPerGame: number | null;
  goldShare: number | null;
  teamKillsPerGame: number | null;
  teamGoldPerGame: number | null;
  visionPerGame: number | null;
  wardsPlacedPerGame: number | null;
  wardsKilledPerGame: number | null;
  controlWardsPerGame: number | null;
  championPool: number;
  mostPlayedChampion: string;
  doubleKills: number | null;
  tripleKills: number | null;
  quadraKills: number | null;
  pentakills: number | null;
  firstBloodKills: number | null;
  firstBloodAssists: number | null;
  firstBloodVictims: number | null;
  csDiff15: number | null;
  goldDiff15: number | null;
  xpDiff15: number | null;
};

type SortDirection = "asc" | "desc";
type Column = {
  key: keyof DeepPlayerRow;
  label: string;
  group: string;
  numeric?: boolean;
  render: (row: DeepPlayerRow, index: number) => ReactNode;
};

const number = (value: number | null, digits = 1) => value == null ? "—" : value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const percent = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const integer = (value: number | null) => value == null ? "—" : value.toLocaleString();

const columns: Column[] = [
  { key: "name", label: "Player", group: "Identity", render: (row, index) => <span className="deep-player-name"><span>{index + 1}</span><b>{row.name}</b></span> },
  { key: "team", label: "Team", group: "Identity", render: (row) => <TeamLabel name={row.team} size="xs" /> },
  { key: "role", label: "Role", group: "Identity", render: (row) => row.role },
  { key: "fantasyPerGame", label: "Pts/G", group: "Fantasy score", numeric: true, render: (row) => <b>{row.fantasyPerGame.toFixed(1)}</b> },
  { key: "fantasyPoints", label: "Raw pts", group: "Fantasy score", numeric: true, render: (row) => row.fantasyPoints.toFixed(1) },
  { key: "efficiencyPointsPerGame", label: "Eff/G", group: "Fantasy score", numeric: true, render: (row) => number(row.efficiencyPointsPerGame) },
  { key: "killParticipationPointsPerGame", label: "KP pts/G", group: "Fantasy score", numeric: true, render: (row) => number(row.killParticipationPointsPerGame) },
  { key: "combatPointsPerGame", label: "Combat/G", group: "Fantasy score", numeric: true, render: (row) => number(row.combatPointsPerGame) },
  { key: "farmPointsPerGame", label: "Farm/G", group: "Fantasy score", numeric: true, render: (row) => number(row.farmPointsPerGame) },
  { key: "visionPointsPerGame", label: "Vision pts/G", group: "Fantasy score", numeric: true, render: (row) => number(row.visionPointsPerGame) },
  { key: "jungleObjectivePointsPerGame", label: "Obj pts/G", group: "Fantasy score", numeric: true, render: (row) => number(row.jungleObjectivePointsPerGame) },
  { key: "winPointsPerGame", label: "Win pts/G", group: "Fantasy score", numeric: true, render: (row) => number(row.winPointsPerGame) },
  { key: "games", label: "GP", group: "Record", numeric: true, render: (row) => row.games },
  { key: "wins", label: "W-L", group: "Record", numeric: true, render: (row) => `${row.wins}-${row.games - row.wins}` },
  { key: "winRate", label: "Win%", group: "Record", numeric: true, render: (row) => percent(row.winRate) },
  { key: "kills", label: "K", group: "Combat", numeric: true, render: (row) => row.kills },
  { key: "deaths", label: "D", group: "Combat", numeric: true, render: (row) => row.deaths },
  { key: "assists", label: "A", group: "Combat", numeric: true, render: (row) => row.assists },
  { key: "kda", label: "KDA", group: "Combat", numeric: true, render: (row) => row.kda.toFixed(2) },
  { key: "killsPerGame", label: "K/G", group: "Combat", numeric: true, render: (row) => number(row.killsPerGame) },
  { key: "deathsPerGame", label: "D/G", group: "Combat", numeric: true, render: (row) => number(row.deathsPerGame) },
  { key: "assistsPerGame", label: "A/G", group: "Combat", numeric: true, render: (row) => number(row.assistsPerGame) },
  { key: "killParticipation", label: "KP", group: "Combat", numeric: true, render: (row) => percent(row.killParticipation) },
  { key: "maxKills", label: "Max K", group: "Combat", numeric: true, render: (row) => row.maxKills },
  { key: "damagePerGame", label: "Dmg/G", group: "Combat", numeric: true, render: (row) => number(row.damagePerGame, 0) },
  { key: "damageShare", label: "Dmg%", group: "Combat", numeric: true, render: (row) => percent(row.damageShare) },
  { key: "objectiveDamagePerGame", label: "Obj Dmg/G", group: "Combat", numeric: true, render: (row) => number(row.objectiveDamagePerGame, 0) },
  { key: "towerDamagePerGame", label: "Tower Dmg/G", group: "Combat", numeric: true, render: (row) => number(row.towerDamagePerGame, 0) },
  { key: "damageTakenPerGame", label: "Taken/G", group: "Combat", numeric: true, render: (row) => number(row.damageTakenPerGame, 0) },
  { key: "damageMitigatedPerGame", label: "Mitigated/G", group: "Combat", numeric: true, render: (row) => number(row.damageMitigatedPerGame, 0) },
  { key: "healingPerGame", label: "Heal/G", group: "Combat", numeric: true, render: (row) => number(row.healingPerGame, 0) },
  { key: "cs", label: "CS", group: "Economy", numeric: true, render: (row) => row.cs.toLocaleString() },
  { key: "csPerGame", label: "CS/G", group: "Economy", numeric: true, render: (row) => number(row.csPerGame) },
  { key: "maxCs", label: "Max CS", group: "Economy", numeric: true, render: (row) => row.maxCs },
  { key: "minionsPerGame", label: "Lane CS/G", group: "Economy", numeric: true, render: (row) => number(row.minionsPerGame) },
  { key: "monstersPerGame", label: "Jungle CS/G", group: "Economy", numeric: true, render: (row) => number(row.monstersPerGame) },
  { key: "ownJungleMonstersPerGame", label: "Own Jng/G", group: "Economy", numeric: true, render: (row) => number(row.ownJungleMonstersPerGame) },
  { key: "enemyJungleMonstersPerGame", label: "Enemy Jng/G", group: "Economy", numeric: true, render: (row) => number(row.enemyJungleMonstersPerGame) },
  { key: "goldPerGame", label: "Gold/G", group: "Economy", numeric: true, render: (row) => number(row.goldPerGame, 0) },
  { key: "goldEarnedPerGame", label: "Earned/G", group: "Economy", numeric: true, render: (row) => number(row.goldEarnedPerGame, 0) },
  { key: "goldSpentPerGame", label: "Spent/G", group: "Economy", numeric: true, render: (row) => number(row.goldSpentPerGame, 0) },
  { key: "goldShare", label: "Gold%", group: "Economy", numeric: true, render: (row) => percent(row.goldShare) },
  { key: "teamKillsPerGame", label: "Team K/G", group: "Economy", numeric: true, render: (row) => number(row.teamKillsPerGame) },
  { key: "teamGoldPerGame", label: "Team Gold/G", group: "Economy", numeric: true, render: (row) => number(row.teamGoldPerGame, 0) },
  { key: "visionPerGame", label: "Vision/G", group: "Vision", numeric: true, render: (row) => number(row.visionPerGame) },
  { key: "wardsPlacedPerGame", label: "Wards/G", group: "Vision", numeric: true, render: (row) => number(row.wardsPlacedPerGame) },
  { key: "wardsKilledPerGame", label: "Cleared/G", group: "Vision", numeric: true, render: (row) => number(row.wardsKilledPerGame) },
  { key: "controlWardsPerGame", label: "Control/G", group: "Vision", numeric: true, render: (row) => number(row.controlWardsPerGame) },
  { key: "championPool", label: "Champs", group: "Pool", numeric: true, render: (row) => row.championPool },
  { key: "mostPlayedChampion", label: "Most played", group: "Pool", render: (row) => <ChampionLabel name={row.mostPlayedChampion} size="xs" /> },
  { key: "doubleKills", label: "2K", group: "Milestones", numeric: true, render: (row) => integer(row.doubleKills) },
  { key: "tripleKills", label: "3K", group: "Milestones", numeric: true, render: (row) => integer(row.tripleKills) },
  { key: "quadraKills", label: "4K", group: "Milestones", numeric: true, render: (row) => integer(row.quadraKills) },
  { key: "pentakills", label: "5K", group: "Milestones", numeric: true, render: (row) => integer(row.pentakills) },
  { key: "firstBloodKills", label: "FB Kills", group: "Milestones", numeric: true, render: (row) => integer(row.firstBloodKills) },
  { key: "firstBloodAssists", label: "FB Assists", group: "Milestones", numeric: true, render: (row) => integer(row.firstBloodAssists) },
  { key: "firstBloodVictims", label: "FB Deaths", group: "Milestones", numeric: true, render: (row) => integer(row.firstBloodVictims) },
  { key: "csDiff15", label: "CSD", group: "Lane @15", numeric: true, render: (row) => number(row.csDiff15) },
  { key: "goldDiff15", label: "GD", group: "Lane @15", numeric: true, render: (row) => number(row.goldDiff15, 0) },
  { key: "xpDiff15", label: "XPD", group: "Lane @15", numeric: true, render: (row) => number(row.xpDiff15, 0) },
];

export default function DeepPlayerTable({ rows }: { rows: DeepPlayerRow[] }) {
  const [sort, setSort] = useState<{ key: keyof DeepPlayerRow; direction: SortDirection }>({ key: "fantasyPerGame", direction: "desc" });
  const sorted = useMemo(() => [...rows].sort((left, right) => {
    const leftValue = left[sort.key];
    const rightValue = right[sort.key];
    if (leftValue == null && rightValue == null) return left.name.localeCompare(right.name);
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue));
    return comparison === 0 ? left.name.localeCompare(right.name) : sort.direction === "asc" ? comparison : -comparison;
  }), [rows, sort]);

  function select(column: Column) {
    setSort((current) => current.key === column.key
      ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key: column.key, direction: column.numeric ? "desc" : "asc" });
  }

  const groups = columns.reduce<Array<{ label: string; span: number }>>((result, column) => {
    const last = result[result.length - 1];
    if (last?.label === column.group) last.span++;
    else result.push({ label: column.group, span: 1 });
    return result;
  }, []);

  return <div className="tablewrap deep-stats-wrap"><table className="sortable-table deep-stats-table">
    <thead>
      <tr className="deep-stat-groups">{groups.map((group) => <th colSpan={group.span} key={group.label}>{group.label}</th>)}</tr>
      <tr>{columns.map((column) => {
        const active = sort.key === column.key;
        return <th key={column.key} className={column.numeric ? "num" : undefined} aria-sort={active ? sort.direction === "asc" ? "ascending" : "descending" : "none"}>
          <button type="button" onClick={() => select(column)} title={`Sort by ${column.label}`}>
            <span>{column.label}</span><span className={`sort-indicator ${active ? "active" : ""}`} aria-hidden="true">{active ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span>
          </button>
        </th>;
      })}</tr>
    </thead>
    <tbody>{sorted.map((row, index) => <tr key={row.id}>{columns.map((column) => <td className={column.numeric ? "num" : undefined} key={column.key}>{column.render(row, index)}</td>)}</tr>)}</tbody>
  </table></div>;
}
