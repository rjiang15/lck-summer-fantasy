export type FantasyRosterTradeException = {
  id: string;
  tournamentId: string;
  ownerAliases: readonly string[];
  ownerLabel: string;
  playerId: string;
  playerName: string;
  replacesPlayerId?: string;
  replacesPlayerName?: string;
  previousTeamId: string;
  currentTeamId: string;
  role: string;
  retainedGroup: "Legends" | "Rise";
  currentGroup: "Legends" | "Rise";
  effectiveAt: string;
  effectiveLabel: string;
};

const R3_4_TOURNAMENT = "LCK/2026 Season/Rounds 3-4";

/**
 * Commissioner-approved, one-time ownership exceptions for the July 30 ADC
 * trade. These are deliberately scoped to an exact tournament, owner, and
 * player instead of becoming a general cross-group transfer rule.
 */
export const FANTASY_ROSTER_TRADE_EXCEPTIONS: readonly FantasyRosterTradeException[] = [
  {
    id: "2026-07-30-perpetualowl-aiming",
    tournamentId: R3_4_TOURNAMENT,
    ownerAliases: ["perpetualowl"],
    ownerLabel: "PerpetualOwl (Howard)",
    playerId: "Aiming",
    playerName: "Aiming",
    previousTeamId: "KT Rolster",
    currentTeamId: "Kiwoom DRX",
    role: "Bot",
    retainedGroup: "Legends",
    currentGroup: "Rise",
    effectiveAt: "2026-07-30T00:00:00.000Z",
    effectiveLabel: "July 30, 2026",
  },
  {
    id: "2026-07-30-ryan-jiwoo",
    tournamentId: R3_4_TOURNAMENT,
    ownerAliases: ["ryan"],
    ownerLabel: "Ryan",
    playerId: "Jiwoo",
    playerName: "Jiwoo",
    replacesPlayerId: "LazyFeel",
    replacesPlayerName: "LazyFeel",
    previousTeamId: "Kiwoom DRX",
    currentTeamId: "KT Rolster",
    role: "Bot",
    retainedGroup: "Rise",
    currentGroup: "Legends",
    effectiveAt: "2026-07-30T00:00:00.000Z",
    effectiveLabel: "July 30, 2026",
  },
];

const normalizeOwner = (value: string) => value.trim().toLowerCase();

export function fantasyRosterTradeException(
  tournamentId: string,
  ownerUsername: string,
  playerId: string,
) {
  const owner = normalizeOwner(ownerUsername);
  return FANTASY_ROSTER_TRADE_EXCEPTIONS.find((exception) =>
    exception.tournamentId === tournamentId
    && exception.playerId === playerId
    && exception.ownerAliases.some((alias) => normalizeOwner(alias) === owner),
  ) ?? null;
}

/**
 * Finds an exception from either the retained player or the outgoing roster
 * assignment. Ryan's database roster can still contain LazyFeel because
 * historical weekly snapshots must not be rewritten, while his effective
 * current/future assignment is Jiwoo.
 */
export function fantasyRosterTradeExceptionForRosterPlayer(
  tournamentId: string,
  ownerUsername: string,
  rosterPlayerId: string,
) {
  const owner = normalizeOwner(ownerUsername);
  return FANTASY_ROSTER_TRADE_EXCEPTIONS.find((exception) =>
    exception.tournamentId === tournamentId
    && (exception.playerId === rosterPlayerId || exception.replacesPlayerId === rosterPlayerId)
    && exception.ownerAliases.some((alias) => normalizeOwner(alias) === owner),
  ) ?? null;
}

export function effectiveFantasyRosterPlayerId(
  tournamentId: string,
  ownerUsername: string,
  rosterPlayerId: string,
) {
  const exception = fantasyRosterTradeExceptionForRosterPlayer(
    tournamentId,
    ownerUsername,
    rosterPlayerId,
  );
  return exception?.replacesPlayerId === rosterPlayerId
    ? exception.playerId
    : rosterPlayerId;
}

export function rosterPlayerMatchesTradeException(
  exception: FantasyRosterTradeException,
  rosterPlayerIds: readonly string[],
) {
  return rosterPlayerIds.some((playerId) =>
    playerId === exception.playerId || playerId === exception.replacesPlayerId,
  );
}

export function fantasyRosterTradeExceptionsForOwners(
  tournamentId: string,
  ownerUsernames: readonly string[],
) {
  const owners = new Set(ownerUsernames.map(normalizeOwner));
  return FANTASY_ROSTER_TRADE_EXCEPTIONS.filter((exception) =>
    exception.tournamentId === tournamentId
    && exception.ownerAliases.some((alias) => owners.has(normalizeOwner(alias))),
  );
}
