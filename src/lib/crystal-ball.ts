import { prisma } from "./db";

export const DEFAULT_CRYSTAL_BALL = [
  definition("CHAMP_MOST_BANNED", "Most banned champion", "champion"),
  definition("CHAMP_MOST_PICKED", "Most picked champion", "champion"),
  definition("CHAMP_HIGHEST_WIN_RATE", "Champion with the highest win rate (over 10 games)", "champion", { minimumPicksExclusive: 10 }),
  definition("CHAMP_LOWEST_WIN_RATE", "Champion with the lowest win rate (over 10 games)", "champion", { minimumPicksExclusive: 10 }),
  definition("CHAMP_MOST_KILLS", "Champion with the most kills", "champion"),
  definition("CHAMP_MOST_DEATHS", "Champion with the most deaths", "champion"),
  definition("PLAYER_HIGHEST_KDA", "Player with the highest KDA", "player"),
  definition("PLAYER_WIDEST_POOL", "Player with the most champions played (tiebreak: fewer total games)", "player"),
  definition("PLAYER_MOST_KILLS_GAME", "Player with the most kills in one game", "player"),
  definition("PLAYER_MOST_CS_GAME", "Player with the most CS in one game", "player"),
  definition("TEAM_WIDEST_POOL", "Team with the most unique champions played", "team"),
  definition("TEAM_MOST_ELDERS", "Team with the most Elder Dragons", "team"),
  definition("TEAM_MOST_BARONS", "Team with the most Barons", "team"),
  definition("TEAM_SHORTEST_WIN", "Team with the shortest win time in one game", "team"),
  definition("TEAM_LONGEST_WIN", "Team with the longest win time in one game", "team"),
  definition("GAME_MOST_COMBINED_KILLS", "Most combined kills in one game", "number", undefined, "CLOSEST"),
  definition("GAME_FEWEST_COMBINED_KILLS", "Fewest combined kills in one game", "number", undefined, "CLOSEST"),
  definition("TOTAL_PENTAKILLS", "Number of pentakills", "pentakill_bucket"),
  definition("MOST_KILLED_DRAKE", "Most-killed elemental drake", "drake"),
  definition("DN_SOOPERS_OVER_2_5_WINS", "Will DN SOOPers finish with more than 2.5 series wins?", "yes_no", { teamId: "DN SOOPers", threshold: 2.5 }),
] as const;

function definition(
  metricKey: string,
  prompt: string,
  answerType: string,
  config?: Record<string, string | number>,
  gradingMode = "EXACT",
) {
  return {
    metricKey,
    prompt,
    answerType,
    points: 10,
    gradingMode,
    resolverConfig: config ? JSON.stringify(config) : null,
  };
}

export type CrystalBallSnapshot = {
  matches: Array<{ winner: string | null }>;
  games: Array<{
    id: string;
    winner: string | null;
    lengthSec: number | null;
    playerStats: Array<{
      playerId: string;
      teamId: string;
      champion: string;
      kills: number;
      deaths: number;
      assists: number;
      cs: number | null;
      pentakills: number | null;
      won: boolean;
    }>;
    teamStats: Array<{
      teamId: string;
      barons: number | null;
      elderDragons: number | null;
      cloudDrakes: number | null;
      infernalDrakes: number | null;
      mountainDrakes: number | null;
      oceanDrakes: number | null;
      hextechDrakes: number | null;
      chemtechDrakes: number | null;
    }>;
    draftActions: Array<{ action: string; champion: string }>;
  }>;
};

export type MetricResolution = {
  acceptedAnswers: string[];
  target?: number;
  evidence: string;
  values: Record<string, number>;
};

type ChampionRollup = { picks: number; wins: number; bans: number; kills: number; deaths: number };
type PlayerRollup = { games: number; kills: number; deaths: number; assists: number; champions: Set<string> };
type TeamRollup = { champions: Set<string>; elders: number; barons: number };

export function resolveCrystalBallMetric(
  metricKey: string,
  snapshot: CrystalBallSnapshot,
  config: Record<string, string | number> = {},
): MetricResolution {
  const champions = new Map<string, ChampionRollup>();
  const players = new Map<string, PlayerRollup>();
  const teams = new Map<string, TeamRollup>();
  const individualLines: Array<{ playerId: string; kills: number; cs: number }> = [];
  const combinedKills: Array<{ gameId: string; kills: number }> = [];
  const gameLengths: Array<{ gameId: string; winner: string; seconds: number }> = [];
  const drakes = { Cloud: 0, Infernal: 0, Mountain: 0, Ocean: 0, Hextech: 0, Chemtech: 0 };
  let pentakills = 0;

  for (const game of snapshot.games) {
    let gameKills = 0;
    if (game.winner && game.lengthSec != null) gameLengths.push({ gameId: game.id, winner: game.winner, seconds: game.lengthSec });
    for (const stat of game.playerStats) {
      gameKills += stat.kills;
      pentakills += stat.pentakills ?? 0;
      individualLines.push({ playerId: stat.playerId, kills: stat.kills, cs: stat.cs ?? 0 });

      const champion = champions.get(stat.champion) ?? { picks: 0, wins: 0, bans: 0, kills: 0, deaths: 0 };
      champion.picks++;
      champion.wins += stat.won ? 1 : 0;
      champion.kills += stat.kills;
      champion.deaths += stat.deaths;
      champions.set(stat.champion, champion);

      const player = players.get(stat.playerId) ?? { games: 0, kills: 0, deaths: 0, assists: 0, champions: new Set<string>() };
      player.games++;
      player.kills += stat.kills;
      player.deaths += stat.deaths;
      player.assists += stat.assists;
      player.champions.add(stat.champion);
      players.set(stat.playerId, player);

      const team = teams.get(stat.teamId) ?? { champions: new Set<string>(), elders: 0, barons: 0 };
      team.champions.add(stat.champion);
      teams.set(stat.teamId, team);
    }
    combinedKills.push({ gameId: game.id, kills: gameKills });

    for (const action of game.draftActions) {
      if (action.action !== "BAN") continue;
      const champion = champions.get(action.champion) ?? { picks: 0, wins: 0, bans: 0, kills: 0, deaths: 0 };
      champion.bans++;
      champions.set(action.champion, champion);
    }
    for (const stat of game.teamStats) {
      const team = teams.get(stat.teamId) ?? { champions: new Set<string>(), elders: 0, barons: 0 };
      team.elders += stat.elderDragons ?? 0;
      team.barons += stat.barons ?? 0;
      teams.set(stat.teamId, team);
      drakes.Cloud += stat.cloudDrakes ?? 0;
      drakes.Infernal += stat.infernalDrakes ?? 0;
      drakes.Mountain += stat.mountainDrakes ?? 0;
      drakes.Ocean += stat.oceanDrakes ?? 0;
      drakes.Hextech += stat.hextechDrakes ?? 0;
      drakes.Chemtech += stat.chemtechDrakes ?? 0;
    }
  }

  const championEntries = [...champions.entries()];
  const playerEntries = [...players.entries()];
  const teamEntries = [...teams.entries()];
  const minPicks = Number(config.minimumPicksExclusive ?? 10);

  switch (metricKey) {
    case "CHAMP_MOST_BANNED":
      return extreme(championEntries, ([, row]) => row.bans, "max", "bans");
    case "CHAMP_MOST_PICKED":
      return extreme(championEntries, ([, row]) => row.picks, "max", "picks");
    case "CHAMP_HIGHEST_WIN_RATE":
      return extreme(championEntries.filter(([, row]) => row.picks > minPicks), ([, row]) => row.wins / row.picks, "max", `win rate among champions with more than ${minPicks} picks`, true);
    case "CHAMP_LOWEST_WIN_RATE":
      return extreme(championEntries.filter(([, row]) => row.picks > minPicks), ([, row]) => row.wins / row.picks, "min", `win rate among champions with more than ${minPicks} picks`, true);
    case "CHAMP_MOST_KILLS":
      return extreme(championEntries, ([, row]) => row.kills, "max", "kills");
    case "CHAMP_MOST_DEATHS":
      return extreme(championEntries, ([, row]) => row.deaths, "max", "deaths");
    case "PLAYER_HIGHEST_KDA":
      return extreme(playerEntries, ([, row]) => (row.kills + row.assists) / Math.max(1, row.deaths), "max", "KDA");
    case "PLAYER_WIDEST_POOL": {
      const most = Math.max(...playerEntries.map(([, row]) => row.champions.size));
      const widest = playerEntries.filter(([, row]) => row.champions.size === most);
      const fewestGames = Math.min(...widest.map(([, row]) => row.games));
      const winners = widest.filter(([, row]) => row.games === fewestGames);
      return resolution(winners.map(([id]) => id), `${most} unique champions in ${fewestGames} games`, Object.fromEntries(playerEntries.map(([id, row]) => [id, row.champions.size])));
    }
    case "PLAYER_MOST_KILLS_GAME":
      return extreme(individualLines.map((row) => [row.playerId, row] as const), ([, row]) => row.kills, "max", "kills in one game");
    case "PLAYER_MOST_CS_GAME":
      return extreme(individualLines.map((row) => [row.playerId, row] as const), ([, row]) => row.cs, "max", "CS in one game");
    case "TEAM_WIDEST_POOL":
      return extreme(teamEntries, ([, row]) => row.champions.size, "max", "unique champions");
    case "TEAM_MOST_ELDERS":
      return extreme(teamEntries, ([, row]) => row.elders, "max", "Elder Dragons");
    case "TEAM_MOST_BARONS":
      return extreme(teamEntries, ([, row]) => row.barons, "max", "Barons");
    case "TEAM_SHORTEST_WIN":
      return extreme(gameLengths.map((row) => [row.winner, row] as const), ([, row]) => row.seconds, "min", "seconds in a win");
    case "TEAM_LONGEST_WIN":
      return extreme(gameLengths.map((row) => [row.winner, row] as const), ([, row]) => row.seconds, "max", "seconds in a win");
    case "GAME_MOST_COMBINED_KILLS":
      return numericTarget(combinedKills, "max", "combined kills");
    case "GAME_FEWEST_COMBINED_KILLS":
      return numericTarget(combinedKills, "min", "combined kills");
    case "TOTAL_PENTAKILLS": {
      const bucket = pentakills >= 5 ? "5+" : String(pentakills);
      return resolution([bucket], `${pentakills} total pentakills`, { pentakills });
    }
    case "MOST_KILLED_DRAKE":
      return extreme(Object.entries(drakes), ([, count]) => count, "max", "elemental drake kills");
    case "DN_SOOPERS_OVER_2_5_WINS": {
      const teamId = String(config.teamId ?? "DN SOOPers");
      const threshold = Number(config.threshold ?? 2.5);
      const wins = snapshot.matches.filter((match) => normalizeAnswer(match.winner ?? "") === normalizeAnswer(teamId)).length;
      return resolution([wins > threshold ? "Yes" : "No"], `${teamId} finished with ${wins} series wins`, { [teamId]: wins });
    }
    default:
      throw new Error(`Unknown Crystal Ball metric: ${metricKey}`);
  }
}

function extreme<T>(
  rows: Array<readonly [string, T]>,
  score: (row: readonly [string, T]) => number,
  direction: "min" | "max",
  label: string,
  percentage = false,
): MetricResolution {
  if (rows.length === 0) throw new Error(`Cannot resolve ${label}: no eligible data`);
  const scored = rows.map((row) => ({ row, value: score(row) }));
  const best = direction === "max" ? Math.max(...scored.map(({ value }) => value)) : Math.min(...scored.map(({ value }) => value));
  const values: Record<string, number> = {};
  for (const { row, value } of scored) {
    const previous = values[row[0]];
    values[row[0]] = previous === undefined ? value : direction === "max" ? Math.max(previous, value) : Math.min(previous, value);
  }
  const accepted = [...new Set(rows.filter((row) => Math.abs(score(row) - best) < 1e-10).map(([id]) => id))];
  const shown = percentage ? `${(best * 100).toFixed(1)}%` : Number.isInteger(best) ? String(best) : best.toFixed(2);
  return resolution(accepted, `${shown} ${label}`, values);
}

function numericTarget(rows: Array<{ gameId: string; kills: number }>, direction: "min" | "max", label: string): MetricResolution {
  if (rows.length === 0) throw new Error(`Cannot resolve ${label}: no completed games`);
  const target = direction === "max" ? Math.max(...rows.map((row) => row.kills)) : Math.min(...rows.map((row) => row.kills));
  const gameIds = rows.filter((row) => row.kills === target).map((row) => row.gameId);
  return { acceptedAnswers: [], target, evidence: `${target} ${label} (${gameIds.join(", ")})`, values: Object.fromEntries(rows.map((row) => [row.gameId, row.kills])) };
}

function resolution(acceptedAnswers: string[], evidence: string, values: Record<string, number>): MetricResolution {
  if (acceptedAnswers.length === 0) throw new Error(`Cannot resolve Crystal Ball metric: ${evidence}`);
  return { acceptedAnswers: [...new Set(acceptedAnswers)], evidence, values };
}

export async function settleCrystalBall(leagueId: number) {
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId },
    include: { cbQuestions: true },
  });
  const snapshot = await loadCrystalBallSnapshot(league.tournamentId);
  const games = snapshot.games;
  const matches = snapshot.matches;
  assertCrystalBallDataComplete(snapshot);
  const automatic = league.cbQuestions.filter((question) => question.metricKey);
  if (automatic.length !== DEFAULT_CRYSTAL_BALL.length) {
    throw new Error(`Crystal Ball has ${automatic.length} automatic questions; expected ${DEFAULT_CRYSTAL_BALL.length}. Synchronize the question set before finishing.`);
  }
  const resolvedAt = new Date();
  const updates = automatic.map((question) => {
    const config = question.resolverConfig ? JSON.parse(question.resolverConfig) as Record<string, string | number> : {};
    const result = resolveCrystalBallMetric(question.metricKey!, snapshot, config);
    return prisma.crystalBallQuestion.update({
      where: { id: question.id },
      data: {
        correctAnswer: result.target === undefined ? result.acceptedAnswers[0] : String(result.target),
        resolvedAnswers: JSON.stringify(result.acceptedAnswers),
        resolutionData: JSON.stringify({ ...result, gameCount: games.length, matchCount: matches.filter((match) => match.winner).length }),
        resolvedAt,
        partialAnswers: null,
      },
    });
  });
  await prisma.$transaction(updates);
  return { questions: updates.length, games: games.length };
}

export async function loadCrystalBallSnapshot(tournamentId: string): Promise<CrystalBallSnapshot> {
  const [matches, games] = await Promise.all([
    prisma.match.findMany({ where: { tournamentId }, select: { winner: true } }),
    prisma.game.findMany({
      where: { match: { tournamentId } },
      select: {
        id: true,
        winner: true,
        lengthSec: true,
        playerStats: { select: { playerId: true, teamId: true, champion: true, kills: true, deaths: true, assists: true, cs: true, pentakills: true, won: true } },
        teamStats: { select: { teamId: true, barons: true, elderDragons: true, cloudDrakes: true, infernalDrakes: true, mountainDrakes: true, oceanDrakes: true, hextechDrakes: true, chemtechDrakes: true } },
        draftActions: { select: { action: true, champion: true } },
      },
    }),
  ]);
  return { matches, games };
}

export function assertCrystalBallDataComplete(snapshot: CrystalBallSnapshot, requireFinishedTournament = true) {
  if (snapshot.games.length === 0) throw new Error("Crystal Ball cannot settle without completed games");
  const unfinishedMatches = snapshot.matches.filter((match) => !match.winner).length;
  if (requireFinishedTournament && unfinishedMatches > 0) throw new Error(`Crystal Ball cannot settle while ${unfinishedMatches} tournament series are unfinished`);
  for (const game of snapshot.games) {
    if (!game.winner || game.lengthSec == null) throw new Error(`Crystal Ball data is incomplete for ${game.id}: winner or duration is missing`);
    if (game.playerStats.length !== 10) throw new Error(`Crystal Ball data is incomplete for ${game.id}: expected 10 player stat lines`);
    if (game.teamStats.length !== 2) throw new Error(`Crystal Ball data is incomplete for ${game.id}: expected 2 team stat lines`);
    if (game.draftActions.filter((action) => action.action === "PICK").length !== 10) throw new Error(`Crystal Ball data is incomplete for ${game.id}: expected 10 champion picks`);
    if (game.draftActions.filter((action) => action.action === "BAN").length === 0) throw new Error(`Crystal Ball data is incomplete for ${game.id}: champion bans are missing`);
    if (game.playerStats.some((stat) => stat.cs == null || stat.pentakills == null)) throw new Error(`Crystal Ball data is incomplete for ${game.id}: CS or pentakill fields are missing`);
    if (game.teamStats.some((stat) => [stat.barons, stat.elderDragons, stat.cloudDrakes, stat.infernalDrakes, stat.mountainDrakes, stat.oceanDrakes, stat.hextechDrakes, stat.chemtechDrakes].some((value) => value == null))) {
      throw new Error(`Crystal Ball data is incomplete for ${game.id}: objective fields are missing`);
    }
  }
}

type GradableQuestion = {
  gradingMode: string;
  correctAnswer: string | null;
  resolvedAnswers: string | null;
  partialAnswers: string | null;
  partialRule: string | null;
  points: number;
  answers: Array<{ userId: number; answer: string }>;
};

export function crystalBallPoints(question: GradableQuestion, userId: number) {
  const mine = question.answers.find((answer) => answer.userId === userId);
  if (!mine || !question.correctAnswer) return 0;
  if (question.gradingMode === "CLOSEST") {
    const target = Number(question.correctAnswer);
    const numeric = question.answers.flatMap((answer) => {
      const value = Number(answer.answer);
      return Number.isFinite(value) ? [{ userId: answer.userId, distance: Math.abs(value - target) }] : [];
    });
    if (numeric.length === 0) return 0;
    const closest = Math.min(...numeric.map((answer) => answer.distance));
    return numeric.some((answer) => answer.userId === userId && answer.distance === closest) ? question.points : 0;
  }
  const accepted: string[] = question.resolvedAnswers
    ? JSON.parse(question.resolvedAnswers)
    : [question.correctAnswer];
  if (accepted.some((answer) => normalizeAnswer(answer) === normalizeAnswer(mine.answer))) return question.points;
  const partials: string[] = question.partialAnswers ? JSON.parse(question.partialAnswers) : [];
  const rule = question.partialRule ? JSON.parse(question.partialRule) as { fraction?: number } : null;
  return rule && partials.some((answer) => normalizeAnswer(answer) === normalizeAnswer(mine.answer))
    ? question.points * (rule.fraction ?? 0.5)
    : 0;
}

export function normalizeAnswer(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function parseResolutionEvidence(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as MetricResolution & { gameCount?: number; matchCount?: number };
  } catch {
    return null;
  }
}
