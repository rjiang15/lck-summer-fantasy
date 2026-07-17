// Fantasy scoring engine: pure functions over a commissioner-editable config.
// All point values live in ScoringConfig (stored as JSON on League).

export interface ScoringConfig {
  player: {
    kill: number;
    death: number;
    assist: number;
    csPer100: number;
    visionScorePer10: number;
    gameWin: number;
    tripleThreatBonus: number; // 10+ kills or 10+ assists in a game
  };
  pickem: {
    correctWinner: number;
    exactScoreBonus: number;
  };
}

export const DEFAULT_SCORING: ScoringConfig = {
  player: {
    kill: 3,
    death: -1,
    assist: 1.5,
    csPer100: 1,
    visionScorePer10: 0.5,
    gameWin: 1,
    tripleThreatBonus: 2,
  },
  pickem: {
    correctWinner: 2,
    exactScoreBonus: 1,
  },
};

export interface PlayerGameLine {
  kills: number;
  deaths: number;
  assists: number;
  cs: number | null;
  visionScore: number | null;
  won: boolean;
}

export function playerGamePoints(s: PlayerGameLine, cfg: ScoringConfig): number {
  const p = cfg.player;
  let pts =
    s.kills * p.kill +
    s.deaths * p.death +
    s.assists * p.assist +
    ((s.cs ?? 0) / 100) * p.csPer100 +
    ((s.visionScore ?? 0) / 10) * p.visionScorePer10 +
    (s.won ? p.gameWin : 0);
  if (s.kills >= 10 || s.assists >= 10) pts += p.tripleThreatBonus;
  return round2(pts);
}

/** Points for one weekly match prediction. Score strings look like "2-1". */
export function pickemPoints(
  predictedWinner: string,
  predictedScore: string | null,
  actualWinner: string,
  actualScore: string,
  cfg: ScoringConfig,
): number {
  if (predictedWinner !== actualWinner) return 0;
  let pts = cfg.pickem.correctWinner;
  if (predictedScore && predictedScore === actualScore) pts += cfg.pickem.exactScoreBonus;
  return pts;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
