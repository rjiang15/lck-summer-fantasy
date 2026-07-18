export const DRAFT_ROLES = ["Top", "Jungle", "Mid", "Bot", "Support"] as const;
export type DraftRole = (typeof DRAFT_ROLES)[number];
export const DRAFT_PRICING_MODES = ["UNIFORM", "DYNAMIC"] as const;
export type DraftPricingMode = (typeof DRAFT_PRICING_MODES)[number];
export type DraftGroup = "LEGENDS" | "RISE";

export type DraftFormat = {
  tournamentId: string;
  pricingSourceTournamentId: string;
  groups: Array<{ key: DraftGroup; label: string; teams: readonly string[] }>;
};

export const LCK_2026_R3_4_DRAFT_FORMAT: DraftFormat = {
  tournamentId: "LCK/2026 Season/Rounds 3-4",
  pricingSourceTournamentId: "LCK/2026 Season/Rounds 1-2",
  groups: [
    {
      key: "LEGENDS",
      label: "Legends",
      teams: ["T1", "Hanwha Life Esports", "Gen.G", "KT Rolster", "Dplus Kia"],
    },
    {
      key: "RISE",
      label: "Rise",
      teams: ["HANJIN BRION", "Kiwoom DRX", "BNK FEARX", "Nongshim RedForce", "DN SOOPers"],
    },
  ],
};

export function draftFormatForTournament(tournamentId: string): DraftFormat | null {
  return tournamentId === LCK_2026_R3_4_DRAFT_FORMAT.tournamentId
    ? LCK_2026_R3_4_DRAFT_FORMAT
    : null;
}

export function draftGroupForTeam(format: DraftFormat | null, teamId: string | null | undefined): DraftGroup | null {
  if (!format || !teamId) return null;
  return format.groups.find((group) => group.teams.includes(teamId))?.key ?? null;
}

export function isDraftPricingMode(value: string | null | undefined): value is DraftPricingMode {
  return DRAFT_PRICING_MODES.includes(value as DraftPricingMode);
}

export const ROLE_SLOT: Record<DraftRole, string> = {
  Top: "TOP",
  Jungle: "JNG",
  Mid: "MID",
  Bot: "BOT",
  Support: "SUP",
};

export function isDraftRole(value: string | null | undefined): value is DraftRole {
  return DRAFT_ROLES.includes(value as DraftRole);
}

export function snakeTeamId(order: number[], zeroBasedPick: number) {
  if (order.length === 0 || zeroBasedPick < 0) return null;
  const roundIndex = Math.floor(zeroBasedPick / order.length);
  const position = zeroBasedPick % order.length;
  return roundIndex % 2 === 0 ? order[position] : order[order.length - 1 - position];
}

export function totalDraftPicks(teamCount: number, playersPerRole: number) {
  return teamCount * DRAFT_ROLES.length * playersPerRole;
}

export type DraftCompositionPlayer = {
  playerId: string;
  role: DraftRole;
  group: DraftGroup | null;
  price: number;
};

export function draftRequirementKey(
  player: Pick<DraftCompositionPlayer, "role" | "group">,
  groupKeys: readonly DraftGroup[],
) {
  return groupKeys.length > 0 ? `${player.group ?? "UNMAPPED"}:${player.role}` : player.role;
}

function requiredDraftSlots(playersPerRole: number, groupKeys: readonly DraftGroup[]) {
  const required = new Map<string, number>();
  if (groupKeys.length > 0) {
    for (const group of groupKeys) for (const role of DRAFT_ROLES) required.set(`${group}:${role}`, 1);
  } else {
    for (const role of DRAFT_ROLES) required.set(role, playersPerRole);
  }
  return required;
}

export function draftSlotAvailable(
  picks: readonly DraftCompositionPlayer[],
  candidate: Pick<DraftCompositionPlayer, "role" | "group">,
  playersPerRole: number,
  groupKeys: readonly DraftGroup[],
) {
  if (groupKeys.length > 0 && !candidate.group) return false;
  const required = requiredDraftSlots(playersPerRole, groupKeys);
  const key = draftRequirementKey(candidate, groupKeys);
  const capacity = required.get(key) ?? 0;
  return picks.filter((pick) => draftRequirementKey(pick, groupKeys) === key).length < capacity;
}

/**
 * Cheapest possible cost to finish the roster from the currently available
 * pool. Null means at least one required group/role slot has no candidate.
 */
export function minimumDraftCompletionCost(
  picks: readonly DraftCompositionPlayer[],
  available: readonly DraftCompositionPlayer[],
  playersPerRole: number,
  groupKeys: readonly DraftGroup[],
): number | null {
  const required = requiredDraftSlots(playersPerRole, groupKeys);
  for (const pick of picks) {
    const key = draftRequirementKey(pick, groupKeys);
    const remaining = required.get(key);
    if (remaining === undefined || remaining < 1) return null;
    required.set(key, remaining - 1);
  }
  let total = 0;
  for (const [key, count] of required) {
    if (count === 0) continue;
    const prices = available
      .filter((player) => draftRequirementKey(player, groupKeys) === key)
      .map((player) => player.price)
      .sort((left, right) => left - right);
    if (prices.length < count) return null;
    total += prices.slice(0, count).reduce((sum, price) => sum + price, 0);
  }
  return total;
}

/**
 * Verifies that the remaining global pool can satisfy every still-open roster
 * requirement across the entire league. Group-role requirements are disjoint,
 * so a count check per requirement is both necessary and sufficient.
 */
export function draftPoolSupportsAllTeams(
  teamPicks: readonly (readonly DraftCompositionPlayer[])[],
  available: readonly DraftCompositionPlayer[],
  playersPerRole: number,
  groupKeys: readonly DraftGroup[],
) {
  const requiredAcrossLeague = new Map<string, number>();
  for (const picks of teamPicks) {
    const remaining = requiredDraftSlots(playersPerRole, groupKeys);
    for (const pick of picks) {
      const key = draftRequirementKey(pick, groupKeys);
      const count = remaining.get(key);
      if (count === undefined || count < 1) return false;
      remaining.set(key, count - 1);
    }
    for (const [key, count] of remaining) {
      requiredAcrossLeague.set(key, (requiredAcrossLeague.get(key) ?? 0) + count);
    }
  }
  for (const [key, count] of requiredAcrossLeague) {
    if (available.filter((player) => draftRequirementKey(player, groupKeys) === key).length < count) return false;
  }
  return true;
}

/**
 * Completion reserve for one team that does not assume it will win every race
 * for the cheapest remaining player. For each requirement, the league's N
 * cheapest candidates are enough to fill the league's N open slots; this team
 * reserves the most expensive share it could receive from that safe set.
 */
export function conservativeDraftCompletionCost(
  teamIndex: number,
  teamPicks: readonly (readonly DraftCompositionPlayer[])[],
  available: readonly DraftCompositionPlayer[],
  playersPerRole: number,
  groupKeys: readonly DraftGroup[],
): number | null {
  if (teamIndex < 0 || teamIndex >= teamPicks.length) return null;
  const remainingByTeam = teamPicks.map((picks) => {
    const remaining = requiredDraftSlots(playersPerRole, groupKeys);
    for (const pick of picks) {
      const key = draftRequirementKey(pick, groupKeys);
      const count = remaining.get(key);
      if (count === undefined || count < 1) return null;
      remaining.set(key, count - 1);
    }
    return remaining;
  });
  if (remainingByTeam.some((remaining) => remaining === null)) return null;

  let total = 0;
  for (const [key, ownCount] of remainingByTeam[teamIndex]!) {
    if (ownCount === 0) continue;
    const leagueCount = remainingByTeam.reduce((sum, remaining) => sum + remaining!.get(key)!, 0);
    const prices = available
      .filter((player) => draftRequirementKey(player, groupKeys) === key)
      .map((player) => player.price)
      .sort((left, right) => left - right);
    if (prices.length < leagueCount) return null;
    total += prices.slice(leagueCount - ownCount, leagueCount).reduce((sum, price) => sum + price, 0);
  }
  return total;
}

export function minimumSafeOpeningBudget(
  teamCount: number,
  available: readonly DraftCompositionPlayer[],
  playersPerRole: number,
  groupKeys: readonly DraftGroup[],
): number | null {
  if (!Number.isInteger(teamCount) || teamCount < 1) return null;
  const emptyRosters: DraftCompositionPlayer[][] = Array.from({ length: teamCount }, () => []);
  if (!draftPoolSupportsAllTeams(emptyRosters, available, playersPerRole, groupKeys)) return null;
  let minimum = Number.POSITIVE_INFINITY;
  for (const candidate of available) {
    if (!draftSlotAvailable([], candidate, playersPerRole, groupKeys)) continue;
    const afterPick = emptyRosters.map((picks, index) => index === 0 ? [candidate] : picks);
    const remaining = available.filter((player) => player.playerId !== candidate.playerId);
    if (!draftPoolSupportsAllTeams(afterPick, remaining, playersPerRole, groupKeys)) continue;
    const reserve = conservativeDraftCompletionCost(0, afterPick, remaining, playersPerRole, groupKeys);
    if (reserve !== null) minimum = Math.min(minimum, candidate.price + reserve);
  }
  return Number.isFinite(minimum) ? minimum : null;
}

export function roundDraftBudget(rawBudget: number, denomination = 1_000) {
  if (!Number.isFinite(rawBudget) || rawBudget < 0 || !Number.isInteger(denomination) || denomination < 1) {
    throw new Error("Draft budget inputs are invalid");
  }
  return Math.ceil(rawBudget / denomination) * denomination;
}

export function maximumDraftRosterCost(
  available: readonly DraftCompositionPlayer[],
  playersPerRole: number,
  groupKeys: readonly DraftGroup[],
): number | null {
  const required = requiredDraftSlots(playersPerRole, groupKeys);
  let total = 0;
  for (const [key, count] of required) {
    const prices = available
      .filter((player) => draftRequirementKey(player, groupKeys) === key)
      .map((player) => player.price)
      .sort((left, right) => right - left);
    if (prices.length < count) return null;
    total += prices.slice(0, count).reduce((sum, price) => sum + price, 0);
  }
  return total;
}
