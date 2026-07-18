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
    midEfficiencyMultiplier: number;
    supportDenialLowThreshold: number;
    supportDenialMidThreshold: number;
    supportDenialHighThreshold: number;
    supportDenialLowBonus: number;
    supportDenialMidBonus: number;
    supportDenialHighBonus: number;
    laneCsWeight: number;
    laneGoldWeight: number;
    laneXpWeight: number;
    laneImpactLowThreshold: number;
    laneImpactHighThreshold: number;
    laneImpactLowBonus: number;
    laneImpactHighBonus: number;
    towerPressureMedianBonus: number;
    towerPressureHighBonus: number;
    towerPressureEliteBonus: number;
    durabilityHighBonus: number;
    durabilityEliteBonus: number;
    tripleKillBonus: number;
    quadraKillBonus: number;
    pentaKillBonus: number;
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
 * Scoring v5 adds early-lane impact, tower pressure, durability, multikills,
 * and support vision denial. Role-specific scale and threshold constants were
 * backtested against all 2,040 player-games from LCK 2026 Rounds 1-2. They
 * measure performance relative to the normal workload for each position rather
 * than simply giving a role a flat point multiplier.
 */
export const DEFAULT_SCORING: ScoringConfig = {
  version: 5,
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
    midEfficiencyMultiplier: 0.75,
    supportDenialLowThreshold: 16,
    supportDenialMidThreshold: 20,
    supportDenialHighThreshold: 24,
    supportDenialLowBonus: 3,
    supportDenialMidBonus: 6,
    supportDenialHighBonus: 9,
    laneCsWeight: 0.2,
    laneGoldWeight: 0.5,
    laneXpWeight: 0.3,
    laneImpactLowThreshold: 0.75,
    laneImpactHighThreshold: 1.5,
    laneImpactLowBonus: 1,
    laneImpactHighBonus: 3,
    towerPressureMedianBonus: 1,
    towerPressureHighBonus: 2,
    towerPressureEliteBonus: 3,
    durabilityHighBonus: 0.5,
    durabilityEliteBonus: 1,
    tripleKillBonus: 1,
    quadraKillBonus: 2,
    pentaKillBonus: 4,
    jungleDragon: 0.5,
    jungleElder: 2.5,
    jungleBaron: 1.5,
    jungleHerald: 0.75,
    jungleVoidGrub: 0.25,
    jungleAtakhan: 1,
  },
  pickem: {
    correctWinner: 10,
    exactScoreBonus: 5,
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
  damageToTowers?: number | null;
  damageMitigated?: number | null;
  wardsKilled?: number | null;
  controlWardsBought?: number | null;
  tripleKills?: number | null;
  quadraKills?: number | null;
  pentakills?: number | null;
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
  laneAt15?: {
    csDiff?: number | null;
    goldDiff?: number | null;
    xpDiff?: number | null;
  } | null;
}

export interface PlayerGameScoreBreakdown {
  combat: number;
  farm: number;
  vision: number;
  win: number;
  killParticipation: number;
  efficiency: number;
  jungleObjectives: number;
  laneImpact: number;
  towerPressure: number;
  durability: number;
  multikill: number;
  total: number;
  killParticipationRate: number | null;
  efficiencyRate: number | null;
}

type CanonicalRole = "Top" | "Jungle" | "Mid" | "Bot" | "Support";

// Standard deviations and upper workload percentiles measured from R1-2.
// Using role baselines prevents the extra categories from inherently favoring
// lanes that naturally farm, hit towers, or absorb more damage.
const ROLE_CALIBRATION: Record<CanonicalRole, {
  csDiff15Scale: number;
  goldDiff15Scale: number;
  xpDiff15Scale: number;
  tower: [number, number, number];
  mitigation: [number, number];
}> = {
  Top: { csDiff15Scale: 18.7, goldDiff15Scale: 826.1, xpDiff15Scale: 890.7, tower: [6531.5, 10213.3, 14345.5], mitigation: [43536.4, 67218.3] },
  Jungle: { csDiff15Scale: 14.6, goldDiff15Scale: 768.4, xpDiff15Scale: 836.7, tower: [1318.5, 3646.3, 5754.1], mitigation: [34973.8, 43532.1] },
  Mid: { csDiff15Scale: 16.7, goldDiff15Scale: 878.6, xpDiff15Scale: 752.7, tower: [5811.1, 8818.6, 11641.4], mitigation: [17032.5, 21812.6] },
  Bot: { csDiff15Scale: 20, goldDiff15Scale: 1122.5, xpDiff15Scale: 724.5, tower: [6948.8, 11134.3, 14804.1], mitigation: [14681.3, 18010.1] },
  Support: { csDiff15Scale: 7.6, goldDiff15Scale: 484.8, xpDiff15Scale: 577.5, tower: [469.5, 1205, 2011.8], mitigation: [12945.3, 22691.8] },
};

const canonicalRole = (role: string | null | undefined): CanonicalRole | null => {
  const normalized = role?.trim().toLowerCase();
  if (normalized === "top") return "Top";
  if (normalized === "jungle" || normalized === "jng") return "Jungle";
  if (normalized === "mid" || normalized === "middle") return "Mid";
  if (normalized === "bot" || normalized === "bottom" || normalized === "adc") return "Bot";
  if (normalized === "support" || normalized === "sup") return "Support";
  return null;
};

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
  const role = canonicalRole(s.role);
  const cs30 = normalizedTo30(s.cs, context.lengthSec);
  const vision30 = normalizedTo30(s.visionScore, context.lengthSec);
  const kp = s.killParticipation ??
    (s.teamKills && s.teamKills > 0 ? (s.kills + s.assists) / s.teamKills : null);
  const combat = s.kills * p.kill + s.deaths * p.death + s.assists * p.assist;
  const farm = cs30 * p.csPer30;
  const vision = vision30 * p.visionScorePer30;
  const win = s.won ? p.gameWin : 0;
  const isTop = role === "Top";
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

  const isSupport = role === "Support";
  const isJungle = role === "Jungle";
  const damageGoldRatio = s.damageShare != null && s.goldShare != null && s.goldShare > 0
    ? s.damageShare / s.goldShare
    : null;
  const supportDenial30 = s.wardsKilled == null || s.controlWardsBought == null
    ? null
    : normalizedTo30(s.wardsKilled + s.controlWardsBought * 0.5, context.lengthSec);
  const efficiencyRate = isSupport ? supportDenial30 : damageGoldRatio;
  let efficiency = 0;
  if (efficiencyRate != null) {
    if (isSupport) {
      efficiency = thresholdBonus(
        efficiencyRate,
        p.supportDenialLowThreshold,
        p.supportDenialMidThreshold,
        p.supportDenialHighThreshold,
        p.supportDenialLowBonus,
        p.supportDenialMidBonus,
        p.supportDenialHighBonus,
      );
    } else {
      const low = isJungle ? p.jungleEfficiencyLowThreshold : p.efficiencyLowThreshold;
      const mid = isJungle ? p.jungleEfficiencyMidThreshold : p.efficiencyMidThreshold;
      const high = isJungle ? p.jungleEfficiencyHighThreshold : p.efficiencyHighThreshold;
      if (efficiencyRate >= high) efficiency = p.efficiencyHighBonus;
      else if (efficiencyRate >= mid) efficiency = p.efficiencyMidBonus;
      else if (efficiencyRate >= low) efficiency = p.efficiencyBaseBonus;
      else efficiency = p.efficiencyLowPenalty;
      if (role === "Mid") efficiency *= p.midEfficiencyMultiplier;
    }
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

  let laneImpact = 0;
  const lane = context.laneAt15;
  const calibration = role ? ROLE_CALIBRATION[role] : null;
  if (calibration && lane?.csDiff != null && lane.goldDiff != null && lane.xpDiff != null) {
    const laneRate =
      (lane.csDiff / calibration.csDiff15Scale) * p.laneCsWeight +
      (lane.goldDiff / calibration.goldDiff15Scale) * p.laneGoldWeight +
      (lane.xpDiff / calibration.xpDiff15Scale) * p.laneXpWeight;
    if (laneRate >= p.laneImpactHighThreshold) laneImpact = p.laneImpactHighBonus;
    else if (laneRate >= p.laneImpactLowThreshold) laneImpact = p.laneImpactLowBonus;
    else if (laneRate <= -p.laneImpactHighThreshold) laneImpact = -p.laneImpactHighBonus;
    else if (laneRate <= -p.laneImpactLowThreshold) laneImpact = -p.laneImpactLowBonus;
  }

  const tower30 = s.damageToTowers == null ? null : normalizedTo30(s.damageToTowers, context.lengthSec);
  const towerPressure = calibration && tower30 != null
    ? thresholdBonus(
      tower30,
      calibration.tower[0],
      calibration.tower[1],
      calibration.tower[2],
      p.towerPressureMedianBonus,
      p.towerPressureHighBonus,
      p.towerPressureEliteBonus,
    )
    : 0;

  const mitigation30 = s.damageMitigated == null ? null : normalizedTo30(s.damageMitigated, context.lengthSec);
  let durability = 0;
  if (calibration && mitigation30 != null) {
    if (mitigation30 >= calibration.mitigation[1]) durability = p.durabilityEliteBonus;
    else if (mitigation30 >= calibration.mitigation[0]) durability = p.durabilityHighBonus;
  }

  // Oracle's Elixir records a penta in the triple and quadra columns too.
  // Score only the highest achieved tier for each streak rather than stacking
  // 3K + 4K + 5K bonuses for the same five kills.
  const pentas = s.pentakills ?? 0;
  const quadrasOnly = Math.max(0, (s.quadraKills ?? 0) - pentas);
  const triplesOnly = Math.max(0, (s.tripleKills ?? 0) - (s.quadraKills ?? 0));
  const multikill =
    triplesOnly * p.tripleKillBonus +
    quadrasOnly * p.quadraKillBonus +
    pentas * p.pentaKillBonus;

  const rounded = {
    combat: round2(combat),
    farm: round2(farm),
    vision: round2(vision),
    win: round2(win),
    killParticipation: round2(killParticipation),
    efficiency: round2(efficiency),
    jungleObjectives: round2(jungleObjectives),
    laneImpact: round2(laneImpact),
    towerPressure: round2(towerPressure),
    durability: round2(durability),
    multikill: round2(multikill),
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
