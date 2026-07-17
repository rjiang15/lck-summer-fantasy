import assert from "node:assert/strict";
import test from "node:test";
import { decodeIngestionProgress, encodeIngestionProgress } from "./ingestion-progress";

test("ingestion progress summaries round-trip and clamp percentages", () => {
  const now = new Date("2026-07-17T12:00:00.000Z");
  assert.deepEqual(decodeIngestionProgress(encodeIngestionProgress(140, "Finalizing", now)), {
    percent: 100,
    message: "Finalizing",
    updatedAt: now.toISOString(),
  });
});

test("legacy count summaries do not masquerade as live progress", () => {
  assert.equal(decodeIngestionProgress('{"matches":10,"games":21}'), null);
  assert.equal(decodeIngestionProgress("not json"), null);
});
