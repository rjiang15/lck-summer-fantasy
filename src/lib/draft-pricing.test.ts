import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDynamicPrices,
  DYNAMIC_PRICE_AVERAGE,
  DYNAMIC_PRICE_MAX,
  DYNAMIC_PRICE_MIN,
  DYNAMIC_PRICE_STEP,
  extendDraftPriceSheetWithPeerValues,
  type DraftPriceSheet,
} from "./draft-pricing";

test("dynamic prices are monotonic, bounded, stepped, and average exactly $1,000", () => {
  const result = calculateDynamicPrices([
    { playerId: "best", ppg: 30, games: 20, peerGroup: "LEGENDS:Mid" },
    { playerId: "high", ppg: 24, games: 20, peerGroup: "LEGENDS:Mid" },
    { playerId: "middle", ppg: 18, games: 20, peerGroup: "RISE:Jungle" },
    { playerId: "low", ppg: 12, games: 20, peerGroup: "RISE:Jungle" },
    { playerId: "lowest", ppg: 6, games: 20, peerGroup: "RISE:Jungle" },
    { playerId: "new", ppg: null, games: 0, peerGroup: "RISE:Jungle" },
  ]);
  const prices = Object.values(result.players).map((player) => player.price);
  assert.equal(prices.reduce((sum, price) => sum + price, 0) / prices.length, DYNAMIC_PRICE_AVERAGE);
  assert.ok(prices.every((price) => price >= DYNAMIC_PRICE_MIN && price <= DYNAMIC_PRICE_MAX));
  assert.ok(prices.every((price) => price % DYNAMIC_PRICE_STEP === 0));
  assert.ok(result.players.best.price > result.players.high.price);
  assert.ok(result.players.high.price > result.players.middle.price);
  assert.ok(result.players.middle.price > result.players.low.price);
  assert.ok(result.players.low.price > result.players.lowest.price);
  const peerAverage = ["middle", "low", "lowest"].reduce((sum, id) => sum + result.players[id].price, 0) / 3;
  assert.equal(result.players.new.price, Math.round(peerAverage / DYNAMIC_PRICE_STEP) * DYNAMIC_PRICE_STEP);
});

test("price calculation rejects unusable historical samples", () => {
  assert.throws(() => calculateDynamicPrices([]), /eligible player pool/);
  assert.throws(() => calculateDynamicPrices([
    { playerId: "only", ppg: 20, games: 1 },
    { playerId: "new", ppg: null, games: 0 },
  ]), /at least two players/);
  assert.throws(() => calculateDynamicPrices([
    { playerId: "one", ppg: 20, games: 1 },
    { playerId: "two", ppg: 20, games: 1 },
  ]), /no usable variation/);
});

test("a frozen sheet can add a missing no-history player without repricing existing players", () => {
  const sheet: DraftPriceSheet = {
    version: 1,
    targetTournamentId: "target",
    sourceTournamentId: "source",
    generatedAt: "2026-07-01T00:00:00.000Z",
    averagePrice: 1_000,
    priceStandardDeviation: 200,
    sourceAveragePpg: 20,
    sourceStandardDeviationPpg: 5,
    players: {
      first: { playerId: "first", ppg: 20, games: 20, peerGroup: "RISE:Support", price: 775 },
      second: { playerId: "second", ppg: 22, games: 20, peerGroup: "RISE:Support", price: 825 },
      other: { playerId: "other", ppg: 30, games: 20, peerGroup: "LEGENDS:Mid", price: 1_300 },
    },
  };
  const extended = extendDraftPriceSheetWithPeerValues(sheet, [
    { playerId: "Peter", ppg: null, games: 0, peerGroup: "RISE:Support" },
  ]);
  assert.deepEqual(extended.players.first, sheet.players.first);
  assert.deepEqual(extended.players.second, sheet.players.second);
  assert.equal(extended.players.Peter.price, 800);
  assert.equal(extended.players.Peter.ppg, null);
  assert.equal(extended.players.Peter.games, 0);
  assert.equal(sheet.players.Peter, undefined);
});
