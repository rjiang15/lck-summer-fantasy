import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeIngestionProgress,
  encodeIngestionProgress,
  ingestionHeartbeatAt,
  isIngestionRunStale,
} from "./ingestion-progress";

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

test("stale detection uses the most recent backend heartbeat", () => {
  const startedAt = new Date("2026-07-17T12:00:00.000Z");
  const heartbeat = new Date("2026-07-17T12:08:00.000Z");
  const run = { startedAt, summary: encodeIngestionProgress(50, "Fetching games", heartbeat) };
  assert.equal(ingestionHeartbeatAt(run).toISOString(), heartbeat.toISOString());
  assert.equal(isIngestionRunStale(run, new Date("2026-07-17T12:17:59.000Z")), false);
  assert.equal(isIngestionRunStale(run, new Date("2026-07-17T12:18:01.000Z")), true);
});

test("legacy runs fall back to their start time for stale detection", () => {
  const run = { startedAt: new Date("2026-07-17T12:00:00.000Z"), summary: null };
  assert.equal(isIngestionRunStale(run, new Date("2026-07-17T12:11:00.000Z")), true);
});
