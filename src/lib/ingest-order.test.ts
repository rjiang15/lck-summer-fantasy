import assert from "node:assert/strict";
import test from "node:test";
import { assertSequentialIngest } from "./ingest-order";

test("permits the next schedule and an OPEN schedule refresh", () => {
  assert.doesNotThrow(() => assertSequentialIngest(1, true, [{ currentWeek: 0, targetStatus: null }]));
  assert.doesNotThrow(() => assertSequentialIngest(1, true, [{ currentWeek: 0, targetStatus: "OPEN" }]));
  assert.doesNotThrow(() => assertSequentialIngest(2, true, [{ currentWeek: 1, targetStatus: "UPCOMING" }]));
});

test("rejects skipped and historical weeks", () => {
  assert.throws(
    () => assertSequentialIngest(2, true, [{ currentWeek: 0, targetStatus: null }]),
    /Week 1 must be fetched next/,
  );
  assert.throws(
    () => assertSequentialIngest(1, true, [{ currentWeek: 1, targetStatus: "PUBLISHED" }]),
    /Week 2 must be fetched next/,
  );
});

test("requires a locked week before result ingestion", () => {
  assert.throws(
    () => assertSequentialIngest(1, false, [{ currentWeek: 0, targetStatus: "OPEN" }]),
    /Lock Week 1/,
  );
  assert.doesNotThrow(() =>
    assertSequentialIngest(1, false, [{ currentWeek: 0, targetStatus: "LOCKED" }]),
  );
  assert.doesNotThrow(() =>
    assertSequentialIngest(1, false, [{ currentWeek: 0, targetStatus: "RESULTS_IMPORTED" }]),
  );
  assert.throws(
    () => assertSequentialIngest(1, false, [{ currentWeek: 0, targetStatus: "SCORED" }]),
    /can no longer be changed/,
  );
});

test("validates every league attached to a tournament", () => {
  assert.throws(
    () => assertSequentialIngest(1, false, [
      { currentWeek: 0, targetStatus: "LOCKED" },
      { currentWeek: 0, targetStatus: "OPEN" },
    ]),
    /Lock Week 1/,
  );
});
