export const DRAFT_ROLES = ["Top", "Jungle", "Mid", "Bot", "Support"] as const;
export type DraftRole = (typeof DRAFT_ROLES)[number];

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
