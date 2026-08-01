export type AdvancedPlayerInputs = {
  role?: string | null;
  damageShare?: number | null;
  goldShare?: number | null;
  wardsKilled?: number | null;
  controlWardsBought?: number | null;
  damageToTowers?: number | null;
  damageMitigated?: number | null;
  tripleKills?: number | null;
  quadraKills?: number | null;
  pentakills?: number | null;
};

export type LaneImpactInputs = {
  csDiff?: number | null;
  goldDiff?: number | null;
  xpDiff?: number | null;
} | null | undefined;

export type AdvancedScoreAvailability = {
  efficiency: boolean;
  laneImpact: boolean;
  towerPressure: boolean;
  durability: boolean;
  multikill: boolean;
};

export function advancedScoreAvailability(
  stat: AdvancedPlayerInputs,
  laneAt15: LaneImpactInputs,
): AdvancedScoreAvailability {
  const support = ["support", "sup"].includes(stat.role?.trim().toLowerCase() ?? "");
  return {
    efficiency: support
      ? stat.wardsKilled != null && stat.controlWardsBought != null
      : stat.damageShare != null && stat.goldShare != null && stat.goldShare > 0,
    laneImpact:
      laneAt15?.csDiff != null &&
      laneAt15.goldDiff != null &&
      laneAt15.xpDiff != null,
    towerPressure: stat.damageToTowers != null,
    durability: stat.damageMitigated != null,
    // Leaguepedia supplies pentakills but not triples or quadras. Requiring all
    // three prevents a partial feed from making the aggregate look complete.
    multikill:
      stat.tripleKills != null &&
      stat.quadraKills != null &&
      stat.pentakills != null,
  };
}
