"use client";

import { useMemo, useState, type ReactNode } from "react";

type SortDirection = "asc" | "desc";
type SortValue = string | number;

type Column<Row> = {
  key: string;
  label: string;
  numeric?: boolean;
  value: (row: Row) => SortValue;
  render: (row: Row, index: number) => ReactNode;
};

type TeamRow = {
  team: string;
  games: number;
  wins: number;
  kills: number;
  gold: number;
  towers: number;
  dragons: number;
  elders: number;
  barons: number;
  heralds: number;
  grubs: number;
  atakhans: number;
  inhibitors: number;
};

type ChampionRow = {
  champion: string;
  picks: number;
  wins: number;
  bans: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
};

type PlayerRow = {
  id: string;
  name: string;
  team: string;
  role: string;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  vision: number;
  pentas: number;
  champions: string[];
};

const pct = (part: number, total: number) => total === 0 ? "—" : `${((part / total) * 100).toFixed(1)}%`;
const perGame = (value: number, games: number) => games === 0 ? 0 : value / games;
const kda = (kills: number, deaths: number, assists: number) => (kills + assists) / Math.max(1, deaths);

export function TeamMacroTable({ rows }: { rows: TeamRow[] }) {
  const columns: Column<TeamRow>[] = [
    { key: "team", label: "Team", value: (row) => row.team, render: (row, index) => <><span className="macro-rank">{index + 1}</span><b>{row.team}</b></> },
    { key: "games", label: "GP", numeric: true, value: (row) => row.games, render: (row) => row.games },
    { key: "winRate", label: "Win%", numeric: true, value: (row) => row.wins / row.games, render: (row) => <Rate value={row.wins} total={row.games} /> },
    { key: "kills", label: "Kills/G", numeric: true, value: (row) => perGame(row.kills, row.games), render: (row) => perGame(row.kills, row.games).toFixed(1) },
    { key: "gold", label: "Gold/G", numeric: true, value: (row) => perGame(row.gold, row.games), render: (row) => Math.round(perGame(row.gold, row.games)).toLocaleString() },
    objectiveColumn("towers", "Towers"),
    objectiveColumn("dragons", "Dragons"),
    objectiveColumn("elders", "Elders"),
    objectiveColumn("barons", "Barons"),
    objectiveColumn("heralds", "Heralds"),
    objectiveColumn("grubs", "Grubs"),
    objectiveColumn("atakhans", "Atakhan"),
    objectiveColumn("inhibitors", "Inhibitors"),
  ];
  return <SortableTable rows={rows} columns={columns} rowKey={(row) => row.team} initialKey="winRate" initialDirection="desc" />;
}

function objectiveColumn(key: keyof Pick<TeamRow, "towers" | "dragons" | "elders" | "barons" | "heralds" | "grubs" | "atakhans" | "inhibitors">, label: string): Column<TeamRow> {
  return {
    key,
    label,
    numeric: true,
    value: (row) => row[key],
    render: (row) => <><b>{row[key]}</b> <span className="muted small">({perGame(row[key], row.games).toFixed(1)})</span></>,
  };
}

export function ChampionMetaTable({ rows, games }: { rows: ChampionRow[]; games: number }) {
  const maxPresence = Math.max(1, ...rows.map((row) => row.picks + row.bans));
  const columns: Column<ChampionRow>[] = [
    { key: "champion", label: "Champion", value: (row) => row.champion, render: (row) => <><b>{row.champion}</b><span className="macro-presence"><i style={{ width: `${((row.picks + row.bans) / maxPresence) * 100}%` }} /></span></> },
    { key: "picks", label: "Picks", numeric: true, value: (row) => row.picks, render: (row) => row.picks },
    { key: "pickRate", label: "Pick%", numeric: true, value: (row) => row.picks / games, render: (row) => pct(row.picks, games) },
    { key: "bans", label: "Bans", numeric: true, value: (row) => row.bans, render: (row) => row.bans },
    { key: "banRate", label: "Ban%", numeric: true, value: (row) => row.bans / games, render: (row) => pct(row.bans, games) },
    { key: "presence", label: "Presence", numeric: true, value: (row) => (row.picks + row.bans) / games, render: (row) => pct(row.picks + row.bans, games) },
    { key: "record", label: "W-L", numeric: true, value: (row) => row.wins, render: (row) => `${row.wins}-${row.picks - row.wins}` },
    { key: "winRate", label: "Win%", numeric: true, value: (row) => row.picks ? row.wins / row.picks : -1, render: (row) => pct(row.wins, row.picks) },
    { key: "kills", label: "Kills", numeric: true, value: (row) => row.kills, render: (row) => row.kills },
    { key: "kda", label: "KDA", numeric: true, value: (row) => row.picks ? kda(row.kills, row.deaths, row.assists) : -1, render: (row) => row.picks ? kda(row.kills, row.deaths, row.assists).toFixed(2) : "—" },
    { key: "damage", label: "Dmg/G", numeric: true, value: (row) => perGame(row.damage, row.picks), render: (row) => row.picks ? Math.round(perGame(row.damage, row.picks)).toLocaleString() : "—" },
  ];
  return <SortableTable rows={rows} columns={columns} rowKey={(row) => row.champion} initialKey="presence" initialDirection="desc" />;
}

export function PlayerLeaderTable({ rows }: { rows: PlayerRow[] }) {
  const columns: Column<PlayerRow>[] = [
    { key: "name", label: "Player", value: (row) => row.name, render: (row) => <b>{row.name}</b> },
    { key: "team", label: "Team", value: (row) => row.team, render: (row) => row.team },
    { key: "role", label: "Role", value: (row) => row.role, render: (row) => row.role },
    { key: "games", label: "GP", numeric: true, value: (row) => row.games, render: (row) => row.games },
    { key: "winRate", label: "Win%", numeric: true, value: (row) => row.wins / row.games, render: (row) => pct(row.wins, row.games) },
    { key: "kda", label: "KDA", numeric: true, value: (row) => kda(row.kills, row.deaths, row.assists), render: (row) => kda(row.kills, row.deaths, row.assists).toFixed(2) },
    { key: "kills", label: "Kills", numeric: true, value: (row) => row.kills, render: (row) => row.kills },
    { key: "cs", label: "CS/G", numeric: true, value: (row) => perGame(row.cs, row.games), render: (row) => perGame(row.cs, row.games).toFixed(1) },
    { key: "damage", label: "Dmg/G", numeric: true, value: (row) => perGame(row.damage, row.games), render: (row) => Math.round(perGame(row.damage, row.games)).toLocaleString() },
    { key: "vision", label: "Vision/G", numeric: true, value: (row) => perGame(row.vision, row.games), render: (row) => perGame(row.vision, row.games).toFixed(1) },
    { key: "pool", label: "Pool", numeric: true, value: (row) => row.champions.length, render: (row) => <span title={row.champions.join(", ")}>{row.champions.length}</span> },
    { key: "pentas", label: "Pentas", numeric: true, value: (row) => row.pentas, render: (row) => row.pentas },
  ];
  return <SortableTable rows={rows} columns={columns} rowKey={(row) => row.id} initialKey="kda" initialDirection="desc" />;
}

function SortableTable<Row>({
  rows,
  columns,
  rowKey,
  initialKey,
  initialDirection,
}: {
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  initialKey: string;
  initialDirection: SortDirection;
}) {
  const [sort, setSort] = useState({ key: initialKey, direction: initialDirection });
  const activeColumn = columns.find((column) => column.key === sort.key) ?? columns[0];
  const sortedRows = useMemo(() => [...rows].sort((left, right) => {
    const leftValue = activeColumn.value(left);
    const rightValue = activeColumn.value(right);
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue));
    if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
    return rowKey(left).localeCompare(rowKey(right));
  }), [activeColumn, rowKey, rows, sort.direction]);

  function selectColumn(column: Column<Row>) {
    setSort((current) => current.key === column.key
      ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key: column.key, direction: column.numeric ? "desc" : "asc" });
  }

  return <div className="tablewrap"><table className="macro-table sortable-table">
    <thead><tr>{columns.map((column) => {
      const active = sort.key === column.key;
      return <th key={column.key} className={column.numeric ? "num" : undefined} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" onClick={() => selectColumn(column)} title={`Sort by ${column.label}${active ? ` ${sort.direction === "asc" ? "descending" : "ascending"}` : ""}`}>
          <span>{column.label}</span><span className={`sort-indicator ${active ? "active" : ""}`} aria-hidden="true">{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
        </button>
      </th>;
    })}</tr></thead>
    <tbody>{sortedRows.map((row, index) => <tr key={rowKey(row)}>{columns.map((column) => <td key={column.key} className={column.numeric ? "num" : undefined}>{column.render(row, index)}</td>)}</tr>)}</tbody>
  </table></div>;
}

function Rate({ value, total }: { value: number; total: number }) {
  return <span className="macro-rate"><span>{pct(value, total)}</span><i><b style={{ width: `${total ? (value / total) * 100 : 0}%` }} /></i></span>;
}
