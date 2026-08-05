import assert from "node:assert/strict";
import test from "node:test";
import { assertSequentialIngest } from "./ingest-order";

test("allows the next shared schedule and idempotent refresh", () => {
  assert.doesNotThrow(() => assertSequentialIngest(1, true, []));
  assert.doesNotThrow(() => assertSequentialIngest(1, true, [{ number: 1, scheduleReady: true, resultsReady: false }]));
});

test("requires prior final series results, not detailed stats, before importing the next schedule", () => {
  assert.throws(() => assertSequentialIngest(2, true, [{ number: 1, scheduleReady: true, resultsReady: false }]), /Week 1 results/);
  assert.doesNotThrow(() => assertSequentialIngest(2, true, [{
    number: 1,
    scheduleReady: true,
    resultsReady: false,
    seriesResultsReady: true,
  }]));
  assert.doesNotThrow(() => assertSequentialIngest(2, true, [{ number: 1, scheduleReady: true, resultsReady: true }]));
  assert.throws(() => assertSequentialIngest(3, true, [{ number: 1, scheduleReady: true, resultsReady: true }]), /Week 2 schedule/);
});

test("requires a shared schedule before results", () => {
  assert.throws(() => assertSequentialIngest(1, false, []), /schedule before fetching results/);
  assert.doesNotThrow(() => assertSequentialIngest(1, false, [{ number: 1, scheduleReady: true, resultsReady: false }]));
});

test("prevents refreshing results used by a published league", () => {
  const state = [{ number: 1, scheduleReady: true, resultsReady: true }];
  assert.doesNotThrow(() => assertSequentialIngest(1, false, state, false));
  assert.throws(() => assertSequentialIngest(1, false, state, true), /published league/);
});
