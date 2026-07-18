import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAFT_ROLES,
  LCK_2026_R3_4_DRAFT_FORMAT,
  conservativeDraftCompletionCost,
  draftBudgetBlockReason,
  draftFormatForTournament,
  draftGroupForTeam,
  draftPoolSupportsAllTeams,
  draftSlotAvailable,
  minimumDraftCompletionCost,
  minimumSafeOpeningBudget,
  maximumDraftRosterCost,
  roundDraftBudget,
  snakeTeamId,
  totalDraftPicks,
  type DraftCompositionPlayer,
} from "./draft";

test("snake order reverses every round", () => {
  const order = [10, 20, 30];
  assert.deepEqual(Array.from({ length: 9 }, (_, pick) => snakeTeamId(order, pick)), [
    10, 20, 30, 30, 20, 10, 10, 20, 30,
  ]);
});

test("ten-player rosters require two picks at each of five roles", () => {
  assert.equal(totalDraftPicks(3, 2), 30);
});

test("R3-4 maps the five Legends and five Rise teams", () => {
  const format = draftFormatForTournament("LCK/2026 Season/Rounds 3-4");
  assert.equal(format, LCK_2026_R3_4_DRAFT_FORMAT);
  assert.deepEqual(format?.groups.map((group) => [group.key, group.teams.length]), [["LEGENDS", 5], ["RISE", 5]]);
  assert.equal(draftGroupForTeam(format, "T1"), "LEGENDS");
  assert.equal(draftGroupForTeam(format, "Dplus Kia"), "LEGENDS");
  assert.equal(draftGroupForTeam(format, "HANJIN BRION"), "RISE");
  assert.equal(draftGroupForTeam(format, "DN SOOPers"), "RISE");
  assert.equal(draftGroupForTeam(format, "Unknown Team"), null);
});

test("grouped drafts allow exactly one Legends and one Rise player per role", () => {
  const groups = ["LEGENDS", "RISE"] as const;
  const first: DraftCompositionPlayer = { playerId: "legend-top", role: "Top", group: "LEGENDS", price: 1_100 };
  assert.equal(draftSlotAvailable([], first, 2, groups), true);
  assert.equal(draftSlotAvailable([first], { role: "Top", group: "LEGENDS" }, 2, groups), false);
  assert.equal(draftSlotAvailable([first], { role: "Top", group: "RISE" }, 2, groups), true);
  assert.equal(draftSlotAvailable([first], { role: "Jungle", group: "LEGENDS" }, 2, groups), true);
  assert.equal(draftSlotAvailable([first], { role: "Top", group: null }, 2, groups), false);
});

test("budget reserve uses the cheapest available player for every missing group-role slot", () => {
  const groups = ["LEGENDS", "RISE"] as const;
  const picks: DraftCompositionPlayer[] = [{ playerId: "chosen", role: "Top", group: "LEGENDS", price: 1_400 }];
  const pool: DraftCompositionPlayer[] = [];
  for (const group of groups) for (const role of DRAFT_ROLES) {
    if (group === "LEGENDS" && role === "Top") continue;
    pool.push({ playerId: `${group}-${role}-cheap`, group, role, price: 800 });
    pool.push({ playerId: `${group}-${role}-expensive`, group, role, price: 1_200 });
  }
  assert.equal(minimumDraftCompletionCost(picks, pool, 2, groups), 7_200);
  assert.equal(minimumDraftCompletionCost(picks, pool.filter((player) => !(player.group === "RISE" && player.role === "Support")), 2, groups), null);
});

test("league-wide pool checks prevent one team consuming another team's last required option", () => {
  const groups = ["LEGENDS", "RISE"] as const;
  const almostComplete = (prefix: string): DraftCompositionPlayer[] => groups.flatMap((group) => DRAFT_ROLES.flatMap((role) =>
    group === "RISE" && role === "Support" ? [] : [{ playerId: `${prefix}-${group}-${role}`, group, role, price: 1_000 }],
  ));
  const pool: DraftCompositionPlayer[] = [
    { playerId: "rise-support-a", group: "RISE", role: "Support", price: 900 },
    { playerId: "rise-support-b", group: "RISE", role: "Support", price: 1_100 },
  ];
  assert.equal(draftPoolSupportsAllTeams([almostComplete("one"), almostComplete("two")], pool, 2, groups), true);
  assert.equal(draftPoolSupportsAllTeams([
    [...almostComplete("one"), pool[0]],
    almostComplete("two"),
  ], [pool[1]], 2, groups), true);
  assert.equal(draftPoolSupportsAllTeams([
    almostComplete("one"),
    almostComplete("two"),
  ], [pool[1]], 2, groups), false);
});

test("conservative reserve does not assume every team receives the same cheapest player", () => {
  const groups = ["LEGENDS", "RISE"] as const;
  const completeExceptRiseSupport = (prefix: string): DraftCompositionPlayer[] => groups.flatMap((group) => DRAFT_ROLES.flatMap((role) =>
    group === "RISE" && role === "Support" ? [] : [{ playerId: `${prefix}-${group}-${role}`, group, role, price: 1_000 }],
  ));
  const pool: DraftCompositionPlayer[] = [800, 900, 1_050, 1_200].map((price, index) => ({
    playerId: `support-${index}`, group: "RISE", role: "Support", price,
  }));
  const teams = [completeExceptRiseSupport("one"), completeExceptRiseSupport("two"), completeExceptRiseSupport("three")];
  assert.equal(conservativeDraftCompletionCost(0, teams, pool, 2, groups), 1_050);
  assert.equal(conservativeDraftCompletionCost(1, teams, pool, 2, groups), 1_050);
});

test("dynamic budget is the smallest safe opening amount rounded up to $1,000", () => {
  const groups = ["LEGENDS", "RISE"] as const;
  const pool: DraftCompositionPlayer[] = groups.flatMap((group) => DRAFT_ROLES.flatMap((role) => [900, 1_000, 1_100].map((price, index) => ({
    playerId: `${group}-${role}-${index}`, group, role, price,
  }))));
  const raw = minimumSafeOpeningBudget(3, pool, 2, groups);
  assert.equal(raw, 10_800);
  assert.equal(roundDraftBudget(raw!), 11_000);
  assert.equal(maximumDraftRosterCost(pool, 2, groups), 11_000);
  assert.equal(minimumSafeOpeningBudget(4, pool, 2, groups), null);
});

test("budget rounding always rounds upward so it cannot invalidate the safe amount", () => {
  assert.equal(roundDraftBudget(10_001), 11_000);
  assert.equal(roundDraftBudget(11_000), 11_000);
  assert.throws(() => roundDraftBudget(Number.NaN), /invalid/);
});

test("budget safeguard is optional while the hard budget cap is always enforced", () => {
  assert.equal(draftBudgetBlockReason(8_500, 1_000, 10_000, true, 750), "BREAKS_RESERVE");
  assert.equal(draftBudgetBlockReason(8_500, 1_000, 10_000, false, 750), null);
  assert.equal(draftBudgetBlockReason(9_500, 750, 10_000, false, 0), "OVER_BUDGET");
  assert.equal(draftBudgetBlockReason(8_500, 1_000, 10_000, true, null), "BREAKS_RESERVE");
});
