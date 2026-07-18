import assert from "node:assert/strict";
import test from "node:test";
import { resolveCompletedWeek } from "./view-cursor";

test("active simulations cannot preview stored future results with a view cookie", () => {
  assert.equal(resolveCompletedWeek({
    seasonStatus: "ACTIVE",
    currentWeek: 2,
    requestedWeek: "final",
    maxWeek: 9,
  }), 2);
  assert.equal(resolveCompletedWeek({
    seasonStatus: "PRESEASON",
    currentWeek: 0,
    requestedWeek: "8",
    maxWeek: 9,
  }), 0);
});

test("finished leagues may browse their historical week cursor", () => {
  assert.equal(resolveCompletedWeek({ seasonStatus: "FINAL", currentWeek: 9, requestedWeek: "3", maxWeek: 9 }), 3);
  assert.equal(resolveCompletedWeek({ seasonStatus: "FINAL", currentWeek: 9, requestedWeek: "final", maxWeek: 9 }), null);
});
