// Fantasy scoring engine: pure functions over a commissioner-editable config.
// All point values live in ScoringConfig (stored as JSON on League).

export interface ScoringConfig {
  version: number;
  player: {
    kill: number;
    death: number;
    assist: number;
    csPer30: number;
    visionScorePer30: number;
    gameWin: number;
    kpLowThreshold: number;
    kpMidThreshold: number;
    kpHighThreshold: number;
    topKpLowThreshold: number;
    topKpMidThreshold: number;
    topKpHighThreshold: number;
    kpLowBonus: number;
    kpMidBonus: number;
    kpHighBonus: number;
    efficiencyLowThreshold: number;
    efficiencyMidThreshold: number;
    efficiencyHighThreshold: number;
    jungleEfficiencyLowThreshold: number;
    jungleEfficiencyMidThreshold: number;
    jungleEfficiencyHighThreshold: number;
    efficiencyLowPenalty: number;
    efficiencyBaseBonus: number;
    efficiencyMidBonus: number;
    efficiencyHighBonus: number;
    supportVisionLowThreshold: number;
    supportVisionMidThreshold: number;
    supportVisionHighThreshold: number;
    jungleDragon: number;
    jungleElder: number;
    jungleBaron: number;
    jungleHerald: number;
    jungleVoidGrub: number;
    jungleAtakhan: number;
  };
  pickem: {
    correctWinner: number;
    exactScoreBonus: number;
  };
}

/**
 * Scoring v3 emphasizes repeatable impact over raw series length.
 * KP has broad, meaningful buckets; efficiency can outweigh the raw K/D/A
 * component; farming and vision are normalized to a 30-minute game. The
 * position-specific thresholds reflect genuinely different role duties and
 * were calibrated against the current LCK split without flat role multipliers.
 */
export const DEFAULT_SCORING: ScoringConfig = {
  version: 3,
  player: {
    kill: 1.25,
    death: -1.75,
    assist: 0.75,
    csPer30: 0.01,
    visionScorePer30: 0.035,
    gameWin: 1.5,
    kpLowThreshold: 0.5,
    kpMidThreshold: 0.65,
    kpHighThreshold: 0.8,
    topKpLowThreshold: 0.35,
    topKpMidThreshold: 0.5,
    topKpHighThreshold: 0.65,
    kpLowBonus: 3,
    kpMidBonus: 6,
    kpHighBonus: 10,
    efficiencyLowThreshold: 0.85,
    efficiencyMidThreshold: 1.05,
    efficiencyHighThreshold: 1.25,
    jungleEfficiencyLowThreshold: 0.75,
    jungleEfficiencyMidThreshold: 1,
    jungleEfficiencyHighThreshold: 1.2,
    efficiencyLowPenalty: -4,
    efficiencyBaseBonus: 5,
    efficiencyMidBonus: 10,
    efficiencyHighBonus: 15,
    supportVisionLowThreshold: 100,
    supportVisionMidThreshold: 120,
    supportVisionHighThreshold: 140,
    jungleDragon: 0.5,
    jungleElder: 2.5,
    jungleBaron: 1.5,
    jungleHerald: 0.75,
    jungleVoidGrub: 0.25,
    jungleAtakhan: 1,
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
  role?: string | null;
  teamKills?: number | null;
  killParticipation?: number | null;
  damageShare?: number | null;
  goldShare?: number | null;
}

export interface TeamObjectiveLine {
  dragons?: number | null;
  elderDragons?: number | null;
  barons?: number | null;
  heralds?: number | null;
  voidGrubs?: number | null;
  atakhans?: number | null;
}

export interface PlayerGameContext {
  lengthSec?: number | null;
  teamObjectives?: TeamObjectiveLine | null;
}

export interface PlayerGameScoreBreakdown {
  combat: number;
  farm: number;
  vision: number;
  win: number;
  killParticipation: number;
  efficiency: number;
  jungleObjectives: number;
  total: number;
  killParticipationRate: number | null;
  efficiencyRate: number | null;
}

const normalizedTo30 = (value: number | null | undefined, lengthSec: number | null | undefined) => {
  if (value == null) return 0;
  return lengthSec && lengthSec > 0 ? value * (1800 / lengthSec) : value;
};

function thresholdBonus(
  value: number,
  lowThreshold: number,
  midThreshold: number,
  highThreshold: number,
  lowBonus: number,
  midBonus: number,
  highBonus: number,
) {
  if (value >= highThreshold) return highBonus;
  if (value >= midThreshold) return midBonus;
  if (value >= lowThreshold) return lowBonus;
  return 0;
}

export function playerGameScore(
  s: PlayerGameLine,
  cfg: ScoringConfig,
  context: PlayerGameContext = {},
): PlayerGameScoreBreakdown {
  const p = cfg.player;
  const cs30 = normalizedTo30(s.cs, context.lengthSec);
  const vision30 = normalizedTo30(s.visionScore, context.lengthSec);
  const kp = s.killParticipation ??
    (s.teamKills && s.teamKills > 0 ? (s.kills + s.assists) / s.teamKills : null);
  const combat = s.kills * p.kill + s.deaths * p.death + s.assists * p.assist;
  const farm = cs30 * p.csPer30;
  const vision = vision30 * p.visionScorePer30;
  const win = s.won ? p.gameWin : 0;
  const isTop = s.role?.toLowerCase() === "top";
  const kpLow = isTop ? p.topKpLowThreshold : p.kpLowThreshold;
  const kpMid = isTop ? p.topKpMidThreshold : p.kpMidThreshold;
  const kpHigh = isTop ? p.topKpHighThreshold : p.kpHighThreshold;
  const killParticipation = kp == null ? 0 : thresholdBonus(
    kp,
    kpLow,
    kpMid,
    kpHigh,
    p.kpLowBonus,
    p.kpMidBonus,
    p.kpHighBonus,
  );

  const isSupport = s.role?.toLowerCase() === "support";
  const isJungle = s.role?.toLowerCase() === "jungle";
  const damageGoldRatio = s.damageShare != null && s.goldShare != null && s.goldShare > 0
    ? s.damageShare / s.goldShare
    : null;
  const efficiencyRate = isSupport ? (s.visionScore == null ? null : vision30) : damageGoldRatio;
  let efficiency = 0;
  if (efficiencyRate != null) {
    const low = isSupport
      ? p.supportVisionLowThreshold
      : isJungle ? p.jungleEfficiencyLowThreshold : p.efficiencyLowThreshold;
    const mid = isSupport
      ? p.supportVisionMidThreshold
      : isJungle ? p.jungleEfficiencyMidThreshold : p.efficiencyMidThreshold;
    const high = isSupport
      ? p.supportVisionHighThreshold
      : isJungle ? p.jungleEfficiencyHighThreshold : p.efficiencyHighThreshold;
    if (efficiencyRate >= high) efficiency = p.efficiencyHighBonus;
    else if (efficiencyRate >= mid) efficiency = p.efficiencyMidBonus;
    else if (efficiencyRate >= low) efficiency = p.efficiencyBaseBonus;
    else efficiency = p.efficiencyLowPenalty;
  }

  let jungleObjectives = 0;
  if (isJungle && context.teamObjectives) {
    const objectives = context.teamObjectives;
    const elders = objectives.elderDragons ?? 0;
    // Some feeds include elders in the total dragon count; do not double count them.
    const elementalDragons = Math.max(0, (objectives.dragons ?? 0) - elders);
    jungleObjectives =
      elementalDragons * p.jungleDragon +
      elders * p.jungleElder +
      (objectives.barons ?? 0) * p.jungleBaron +
      (objectives.heralds ?? 0) * p.jungleHerald +
      (objectives.voidGrubs ?? 0) * p.jungleVoidGrub +
      (objectives.atakhans ?? 0) * p.jungleAtakhan;
  }

  const rounded = {
    combat: round2(combat),
    farm: round2(farm),
    vision: round2(vision),
    win: round2(win),
    killParticipation: round2(killParticipation),
    efficiency: round2(efficiency),
    jungleObjectives: round2(jungleObjectives),
  };
  return {
    ...rounded,
    total: round2(Object.values(rounded).reduce((sum, value) => sum + value, 0)),
    killParticipationRate: kp,
    efficiencyRate,
  };
}

export function playerGamePoints(
  s: PlayerGameLine,
  cfg: ScoringConfig,
  context: PlayerGameContext = {},
): number {
  return playerGameScore(s, cfg, context).total;
}

/** A player's official contribution is their average score, not their raw game total. */
export function playerPointsPerGame(gamePoints: number[]): number {
  if (gamePoints.length === 0) return 0;
  return round2(gamePoints.reduce((sum, points) => sum + points, 0) / gamePoints.length);
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
