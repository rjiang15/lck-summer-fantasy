import assert from "node:assert/strict";
import test from "node:test";
import { gameDetailHref } from "./routes";

test("game detail links encode source-qualified ids as one dynamic segment", () => {
  assert.equal(gameDetailHref("gol:80666"), "/games/gol%3A80666");
  assert.equal(gameDetailHref("LCK/2026 Game 1"), "/games/LCK%2F2026%20Game%201");
});
