import { prisma } from "../lib/db";
import {
  DRAFT_ROLES,
  conservativeDraftCompletionCost,
  draftFormatForTournament,
  draftGroupForTeam,
  draftPoolSupportsAllTeams,
  draftSlotAvailable,
  minimumDraftCompletionCost,
  snakeTeamId,
  type DraftCompositionPlayer,
  type DraftGroup,
  type DraftRole,
} from "../lib/draft";
import { buildDraftPriceSheet } from "../lib/draft-pricing";
import { DEFAULT_SCORING } from "../lib/scoring";

const TARGET = "LCK/2026 Season/Rounds 3-4";
const TEAM_COUNT = 3;
const BUDGET = 10_000;

type Candidate = DraftCompositionPlayer & {
  name: string;
  teamId: string;
  ppg: number | null;
};

type SimulatedTeam = {
  id: number;
  spent: number;
  picks: Candidate[];
  lastPickFundsBefore: number | null;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const format = draftFormatForTournament(TARGET);
  assert(format, `No grouped draft format configured for ${TARGET}`);
  const groupKeys = format.groups.map((group) => group.key);
  const [sheet, tournamentPlayers] = await Promise.all([
    buildDraftPriceSheet(TARGET, DEFAULT_SCORING),
    prisma.tournamentPlayer.findMany({
      where: { tournamentId: TARGET, role: { in: [...DRAFT_ROLES] } },
      include: { player: { select: { name: true, role: true } } },
    }),
  ]);

  const candidates = tournamentPlayers.flatMap((row): Candidate[] => {
    const role = (row.role ?? row.player.role) as DraftRole | null;
    const group = draftGroupForTeam(format, row.teamId);
    if (!role || !DRAFT_ROLES.includes(role) || !group || !row.teamId) return [];
    const value = sheet.players[row.playerId];
    assert(value, `No dynamic price for ${row.player.name}`);
    return [{ playerId: row.playerId, name: row.player.name, teamId: row.teamId, role, group, price: value.price, ppg: value.ppg }];
  });
  assert(candidates.length === tournamentPlayers.length, "Every target player must have a valid group, role, and price");

  const average = candidates.reduce((sum, player) => sum + player.price, 0) / candidates.length;
  assert(average === 1_000, `Eligible-pool average was $${average}, expected exactly $1,000`);

  const teams: SimulatedTeam[] = Array.from({ length: TEAM_COUNT }, (_, index) => ({
    id: index + 1, spent: 0, picks: [], lastPickFundsBefore: null,
  }));
  const order = teams.map((team) => team.id);
  const drafted = new Set<string>();
  const log: Array<{ pick: number; team: number; player: Candidate; remaining: number }> = [];

  for (let pickIndex = 0; pickIndex < TEAM_COUNT * DRAFT_ROLES.length * groupKeys.length; pickIndex++) {
    const teamId = snakeTeamId(order, pickIndex);
    const team = teams.find((row) => row.id === teamId);
    assert(team, `No team at pick ${pickIndex + 1}`);
    const globallyAvailable = candidates.filter((candidate) => !drafted.has(candidate.playerId));

    // Each participant overfits to R1-2: take the highest historical Pts/G
    // selection that still passes the same composition and budget reserve used
    // by the live server action.
    const options = globallyAvailable
      .filter((candidate) => draftSlotAvailable(team.picks, candidate, 2, groupKeys))
      .map((candidate) => {
        const poolAfterPick = globallyAvailable.filter((row) => row.playerId !== candidate.playerId);
        const reserve = minimumDraftCompletionCost([...team.picks, candidate], poolAfterPick, 2, groupKeys);
        const everyTeamComposition = teams.map((row) => row.id === team.id ? [...row.picks, candidate] : row.picks);
        const supportsLeague = draftPoolSupportsAllTeams(everyTeamComposition, poolAfterPick, 2, groupKeys);
        const conservativeReserve = supportsLeague ? conservativeDraftCompletionCost(teams.indexOf(team), everyTeamComposition, poolAfterPick, 2, groupKeys) : null;
        return { candidate, reserve, conservativeReserve, supportsLeague };
      });
    const valid = options
      .filter((option): option is { candidate: Candidate; reserve: number; conservativeReserve: number; supportsLeague: true } => option.reserve !== null && option.conservativeReserve !== null && option.supportsLeague && team.spent + option.candidate.price + option.conservativeReserve <= BUDGET)
      .sort((left, right) =>
        (right.candidate.ppg ?? Number.NEGATIVE_INFINITY) - (left.candidate.ppg ?? Number.NEGATIVE_INFINITY) ||
        right.candidate.price - left.candidate.price ||
        left.candidate.name.localeCompare(right.candidate.name),
      );
    if (valid.length === 0) {
      console.error(`Team ${team.id} state at failed pick ${pickIndex + 1}: spent $${team.spent}; ${team.picks.length} players`);
      for (const option of options) console.error(`${option.candidate.name} ${option.candidate.group}/${option.candidate.role}: $${option.candidate.price} + conservative reserve $${option.conservativeReserve ?? "impossible"}; league pool ${option.supportsLeague ? "ok" : "blocked"}`);
    }
    assert(valid.length > 0, `Team ${team.id} had no legal completion-safe pick at overall pick ${pickIndex + 1}`);
    const selected = valid[0].candidate;
    if (team.picks.length === 9) team.lastPickFundsBefore = BUDGET - team.spent;
    team.picks.push(selected);
    team.spent += selected.price;
    drafted.add(selected.playerId);
    log.push({ pick: pickIndex + 1, team: team.id, player: selected, remaining: BUDGET - team.spent });
  }

  for (const team of teams) {
    assert(team.picks.length === 10, `Team ${team.id} finished with ${team.picks.length} players`);
    assert(team.spent <= BUDGET, `Team ${team.id} exceeded its budget`);
    for (const group of groupKeys) for (const role of DRAFT_ROLES) {
      assert(team.picks.filter((player) => player.group === group && player.role === role).length === 1, `Team ${team.id} did not fill exactly one ${group} ${role}`);
    }
    const finalPick = team.picks.at(-1)!;
    assert(team.lastPickFundsBefore !== null && team.lastPickFundsBefore >= finalPick.price, `Team ${team.id} could not afford its last player`);
  }

  const groupSummary = (group: DraftGroup) => candidates.filter((player) => player.group === group);
  console.log(`Dynamic pricing source: ${sheet.sourceTournamentId}`);
  console.log(`Eligible players: ${candidates.length}; exact pool average: $${average.toFixed(0)}`);
  for (const group of groupKeys) {
    const rows = groupSummary(group);
    const groupAverage = rows.reduce((sum, player) => sum + player.price, 0) / rows.length;
    console.log(`${format.groups.find((row) => row.key === group)!.label}: ${rows.length} players, $${groupAverage.toFixed(0)} average, $${Math.min(...rows.map((row) => row.price))}–$${Math.max(...rows.map((row) => row.price))}`);
  }
  console.log("\nGreedy three-team snake result");
  for (const team of teams) {
    const last = team.picks.at(-1)!;
    console.log(`Team ${team.id}: spent $${team.spent}; $${BUDGET - team.spent} left; last pick ${last.name} cost $${last.price} with $${team.lastPickFundsBefore} available`);
  }
  console.log("\nLast six overall picks");
  for (const row of log.slice(-6)) console.log(`#${row.pick} Team ${row.team}: ${row.player.name} (${row.player.group} ${row.player.role}) $${row.player.price}; $${row.remaining} left`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
