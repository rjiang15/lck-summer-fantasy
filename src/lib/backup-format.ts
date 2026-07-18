export const CURRENT_BACKUP_VERSION = 7 as const;
export const MAX_BACKUP_BYTES = 4_000_000;

export interface Backup {
  version: 3 | 4 | 5 | 6 | 7;
  exportedAt: string;
  league: {
    name: string; tournamentId: string; scoringConfig: string; currentWeek: number;
    seasonStatus: string; crystalBallLockedAt: string | null; rostersLockedAt?: string | null; isSimulation: boolean;
    draftStatus?: string; draftOrder?: string[]; draftCurrentPick?: number;
    draftBudget?: number; draftPlayerPrice?: number; draftPlayersPerRole?: number;
    draftPricingMode?: string; draftBudgetGuardEnabled?: boolean;
    draftPriceSourceTournamentId?: string | null; draftPriceSheet?: string | null;
  };
  // New backups intentionally omit passwordHash. It remains optional only so
  // older v3-v6 files can still be restored.
  users: { username: string; passwordHash?: string; role: string; joinedAt?: string }[];
  fantasyTeams: { username: string; name: string; roster: { playerId: string; slot: string }[] }[];
  draftPicks?: { username: string; playerId: string; overallPick: number; round: number; role: string; price: number; pickedAt: string }[];
  pickems: { username: string; matchId: string; predictedWinner: string; predictedScore: string | null; createdAt?: string; updatedAt?: string }[];
  cbQuestions: {
    prompt: string; answerType: string; points: number; partialRule: string | null;
    correctAnswer: string | null; partialAnswers: string | null;
    metricKey?: string | null; gradingMode?: string; resolverConfig?: string | null;
    resolvedAnswers?: string | null; resolutionData?: string | null; resolvedAt?: string | null;
    answers: { username: string; answer: string; createdAt?: string; updatedAt?: string }[];
  }[];
  leagueWeeks: {
    weekNumber: number; status: string; picksOpenAt: string | null; picksLockedAt: string | null;
    rosterLockedAt: string | null; resultsImportedAt: string | null; scoredAt: string | null;
    publishedAt: string | null; validationJson: string | null; validationError: string | null;
    rosters: { username: string; playerId: string; slot: string; lockedAt?: string }[];
    scores: { username: string; rosterPts: number; pickemPts: number; total: number; breakdown: string; calculatedAt?: string; publishedAt: string | null }[];
  }[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > max) throw new Error(`${label} exceeds the ${max.toLocaleString("en-US")} item safety limit`);
  return value;
}

function string(value: unknown, label: string, max = 100_000): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  if (value.length > max) throw new Error(`${label} is too long`);
  return value;
}

function nullableString(value: unknown, label: string, max = 1_000_000): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > max) throw new Error(`${label} must be a string or null`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  const parsed = finiteNumber(value, label);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`${label} must be an integer of at least ${minimum}`);
  return parsed;
}

function optionalInteger(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : integer(value, label);
}

function date(value: unknown, label: string, nullable = false): string | null {
  if (nullable && (value === null || value === undefined)) return null;
  const text = string(value, label, 64);
  if (Number.isNaN(Date.parse(text))) throw new Error(`${label} is not a valid date`);
  return text;
}

function username(value: unknown, label: string): string {
  const text = string(value, label, 64);
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(text)) throw new Error(`${label} is not a valid account username`);
  return text;
}

function optionalJson(value: unknown, label: string): string | null {
  const text = nullableString(value, label);
  if (text) {
    try { JSON.parse(text); } catch { throw new Error(`${label} contains invalid JSON`); }
  }
  return text;
}

export function parseBackup(value: unknown): Backup {
  const root = record(value, "Backup");
  const version = integer(root.version, "Backup version", 3);
  if (![3, 4, 5, 6, 7].includes(version)) throw new Error("Only version 3 through 7 league backups can be imported");
  date(root.exportedAt, "Exported timestamp");

  const league = record(root.league, "League");
  string(league.name, "League name", 60);
  string(league.tournamentId, "Tournament id", 200);
  const scoringConfig = string(league.scoringConfig, "Scoring config", 250_000);
  try { JSON.parse(scoringConfig); } catch { throw new Error("Scoring config contains invalid JSON"); }
  integer(league.currentWeek, "Current week");
  const seasonStatus = string(league.seasonStatus, "Season status", 32);
  if (!["PRESEASON", "ACTIVE", "FINAL"].includes(seasonStatus)) throw new Error("Season status is invalid");
  if (typeof league.isSimulation !== "boolean") throw new Error("Simulation flag must be boolean");
  date(league.crystalBallLockedAt, "Crystal Ball lock", true);
  date(league.rostersLockedAt, "Roster lock", true);
  if (league.draftStatus !== undefined && !["NOT_STARTED", "ACTIVE", "COMPLETE"].includes(string(league.draftStatus, "Draft status", 32))) {
    throw new Error("Draft status is invalid");
  }
  if (league.draftOrder !== undefined) array(league.draftOrder, "Draft order", 500).forEach((item, index) => username(item, `Draft order ${index + 1}`));
  optionalInteger(league.draftCurrentPick, "Draft current pick");
  optionalInteger(league.draftBudget, "Draft budget");
  optionalInteger(league.draftPlayerPrice, "Draft player price");
  optionalInteger(league.draftPlayersPerRole, "Draft players per role");
  if (league.draftPricingMode !== undefined && !["UNIFORM", "DYNAMIC"].includes(string(league.draftPricingMode, "Draft pricing mode", 32))) {
    throw new Error("Draft pricing mode is invalid");
  }
  if (league.draftBudgetGuardEnabled !== undefined && typeof league.draftBudgetGuardEnabled !== "boolean") {
    throw new Error("Draft budget safeguard must be boolean");
  }
  nullableString(league.draftPriceSourceTournamentId, "Draft price source tournament", 200);
  optionalJson(league.draftPriceSheet, "Draft price sheet");

  const users = array(root.users, "Users", 500);
  const usernames = new Set<string>();
  let owners = 0;
  users.forEach((item, index) => {
    const user = record(item, `User ${index + 1}`);
    const name = username(user.username, `User ${index + 1} username`);
    if (usernames.has(name)) throw new Error(`Duplicate user ${name}`);
    usernames.add(name);
    const role = string(user.role, `User ${name} role`, 32);
    if (!["OWNER", "COMMISSIONER", "PARTICIPANT"].includes(role)) throw new Error(`User ${name} has an invalid role`);
    if (role === "OWNER") owners += 1;
    if (user.passwordHash !== undefined) string(user.passwordHash, `User ${name} password hash`, 1_000);
    if (user.joinedAt !== undefined) date(user.joinedAt, `User ${name} joined timestamp`);
  });
  if (owners !== 1) throw new Error("A backup must contain exactly one league owner");

  const teams = array(root.fantasyTeams, "Fantasy teams", 500);
  const teamUsers = new Set<string>();
  teams.forEach((item, index) => {
    const team = record(item, `Fantasy team ${index + 1}`);
    const name = username(team.username, `Fantasy team ${index + 1} username`);
    if (!usernames.has(name)) throw new Error(`Fantasy team references unknown user ${name}`);
    if (teamUsers.has(name)) throw new Error(`Duplicate fantasy team for ${name}`);
    teamUsers.add(name);
    string(team.name, `Fantasy team ${name} name`, 40);
    array(team.roster, `Fantasy team ${name} roster`, 100).forEach((slot, slotIndex) => {
      const row = record(slot, `Roster slot ${slotIndex + 1}`);
      string(row.playerId, "Roster player id", 200);
      string(row.slot, "Roster slot", 32);
    });
  });
  for (const name of (league.draftOrder ?? []) as string[]) {
    if (!teamUsers.has(name)) throw new Error(`Draft order references unknown fantasy team ${name}`);
  }

  array(root.draftPicks ?? [], "Draft picks", 5_000).forEach((item, index) => {
    const pick = record(item, `Draft pick ${index + 1}`);
    const name = username(pick.username, "Draft pick username");
    if (!teamUsers.has(name)) throw new Error(`Draft pick references unknown team ${name}`);
    string(pick.playerId, "Draft pick player", 200);
    integer(pick.overallPick, "Draft overall pick", 1);
    integer(pick.round, "Draft round", 1);
    string(pick.role, "Draft role", 32);
    integer(pick.price, "Draft price");
    date(pick.pickedAt, "Draft pick timestamp");
  });

  array(root.pickems, "Pickems", 100_000).forEach((item, index) => {
    const pick = record(item, `Pickem ${index + 1}`);
    const name = username(pick.username, "Pickem username");
    if (!usernames.has(name)) throw new Error(`Pickem references unknown user ${name}`);
    string(pick.matchId, "Pickem match", 200);
    string(pick.predictedWinner, "Predicted winner", 200);
    nullableString(pick.predictedScore, "Predicted score", 32);
    if (pick.createdAt !== undefined) date(pick.createdAt, "Pickem creation timestamp");
    if (pick.updatedAt !== undefined) date(pick.updatedAt, "Pickem update timestamp");
  });

  array(root.cbQuestions, "Crystal Ball questions", 200).forEach((item, index) => {
    const question = record(item, `Crystal Ball question ${index + 1}`);
    string(question.prompt, "Crystal Ball prompt", 1_000);
    string(question.answerType, "Crystal Ball answer type", 64);
    integer(question.points, "Crystal Ball points");
    nullableString(question.partialRule, "Crystal Ball partial rule");
    nullableString(question.correctAnswer, "Crystal Ball correct answer");
    nullableString(question.partialAnswers, "Crystal Ball partial answers");
    nullableString(question.metricKey, "Crystal Ball metric key", 200);
    if (question.gradingMode !== undefined) string(question.gradingMode, "Crystal Ball grading mode", 64);
    optionalJson(question.resolverConfig, "Crystal Ball resolver config");
    nullableString(question.resolvedAnswers, "Crystal Ball resolved answers");
    nullableString(question.resolutionData, "Crystal Ball resolution data");
    date(question.resolvedAt, "Crystal Ball resolution timestamp", true);
    array(question.answers, "Crystal Ball answers", 500).forEach((answerValue) => {
      const answer = record(answerValue, "Crystal Ball answer");
      const name = username(answer.username, "Crystal Ball answer username");
      if (!usernames.has(name)) throw new Error(`Crystal Ball answer references unknown user ${name}`);
      string(answer.answer, "Crystal Ball answer", 10_000);
      if (answer.createdAt !== undefined) date(answer.createdAt, "Crystal Ball answer creation timestamp");
      if (answer.updatedAt !== undefined) date(answer.updatedAt, "Crystal Ball answer update timestamp");
    });
  });

  const weekNumbers = new Set<number>();
  array(root.leagueWeeks, "League weeks", 100).forEach((item, index) => {
    const week = record(item, `League week ${index + 1}`);
    const number = integer(week.weekNumber, "League week number", 1);
    if (weekNumbers.has(number)) throw new Error(`Duplicate league week ${number}`);
    weekNumbers.add(number);
    const status = string(week.status, "League week status", 32);
    if (!["UPCOMING", "OPEN", "LOCKED", "RESULTS_IMPORTED", "SCORED", "PUBLISHED"].includes(status)) {
      throw new Error(`League week ${number} has an invalid status`);
    }
    for (const field of ["picksOpenAt", "picksLockedAt", "rosterLockedAt", "resultsImportedAt", "scoredAt", "publishedAt"] as const) {
      date(week[field], `League week ${number} ${field}`, true);
    }
    nullableString(week.validationJson, "League week validation JSON");
    nullableString(week.validationError, "League week validation error");
    array(week.rosters, `League week ${number} rosters`, 10_000).forEach((slotValue) => {
      const slot = record(slotValue, "Weekly roster slot");
      const name = username(slot.username, "Weekly roster username");
      if (!teamUsers.has(name)) throw new Error(`Weekly roster references unknown team ${name}`);
      string(slot.playerId, "Weekly roster player", 200);
      string(slot.slot, "Weekly roster slot", 32);
      if (slot.lockedAt !== undefined) date(slot.lockedAt, "Weekly roster lock timestamp");
    });
    array(week.scores, `League week ${number} scores`, 500).forEach((scoreValue) => {
      const score = record(scoreValue, "Weekly score");
      const name = username(score.username, "Weekly score username");
      if (!teamUsers.has(name)) throw new Error(`Weekly score references unknown team ${name}`);
      finiteNumber(score.rosterPts, "Roster points");
      finiteNumber(score.pickemPts, "Pickem points");
      finiteNumber(score.total, "Total points");
      string(score.breakdown, "Score breakdown", 1_000_000);
      if (score.calculatedAt !== undefined) date(score.calculatedAt, "Score calculation timestamp");
      date(score.publishedAt, "Score publication timestamp", true);
    });
  });

  return value as Backup;
}

export function parseBackupJson(text: string): Backup {
  if (Buffer.byteLength(text, "utf8") > MAX_BACKUP_BYTES) {
    throw new Error(`Backup exceeds the ${Math.round(MAX_BACKUP_BYTES / 1_000_000)} MB safety limit`);
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Backup is not valid JSON"); }
  return parseBackup(value);
}

export function backupOwnerUsername(backup: Backup): string {
  return backup.users.find((user) => user.role === "OWNER")!.username;
}
