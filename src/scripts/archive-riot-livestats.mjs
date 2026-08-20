import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const GAME_ID = "115548147900553474";
const MATCH_ID = "115548147900553473";
const START_TIME = "2026-08-01T11:10:10Z";
// Calibrated by subtracting the published 33:06 duration from Riot's first
// finished frame. The resulting 15:00 snapshot also exactly matches the VOD
// scoreboard (KDA and CS for all ten players).
const GAME_CLOCK_ZERO = "2026-08-01T11:10:23.795Z";
const END_TIME = "2026-08-01T11:44:00Z";
const DEFAULT_OUTPUT = "data/manual/2026-08-01-gen-vs-dk-game-1";
const OUTPUT_DIR = process.argv[2] || DEFAULT_OUTPUT;
const BASE_URL = "https://feed.lolesports.com/livestats/v1";
const CONCURRENCY = 8;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const alignedTimes = (start, end) => {
  const values = [];
  for (let ms = Date.parse(start); ms <= Date.parse(end); ms += 10_000) {
    values.push(new Date(ms).toISOString().replace(".000Z", "Z"));
  }
  return values;
};

async function fetchSlice(endpoint, startingTime) {
  const url = new URL(`${BASE_URL}/${endpoint}/${GAME_ID}`);
  url.searchParams.set("startingTime", startingTime);
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "lck-fantasy-riot-archive/1.0" },
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
      }
      return {
        endpoint,
        requestedStartingTime: startingTime,
        sourceUrl: url.toString(),
        response: await response.json(),
      };
    } catch (error) {
      lastError = error;
      await sleep(250 * attempt);
    }
  }
  throw new Error(`Failed ${endpoint} ${startingTime}: ${lastError}`);
}

async function mapConcurrent(values, mapper, concurrency) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
      if ((index + 1) % 25 === 0) {
        process.stdout.write(`downloaded ${index + 1}/${values.length}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

const csvCell = (value) => {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const toCsv = (rows, columns) => [
  columns.join(","),
  ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
].join("\n") + "\n";

const uniqueFrames = (requests) => {
  const byTimestamp = new Map();
  for (const request of requests) {
    for (const frame of request.response.frames || []) {
      byTimestamp.set(frame.rfc460Timestamp, frame);
    }
  }
  return [...byTimestamp.values()].sort(
    (a, b) => Date.parse(a.rfc460Timestamp) - Date.parse(b.rfc460Timestamp),
  );
};

const nearestFrame = (frames, targetMs) => frames.reduce((best, frame) => {
  if (!best) return frame;
  const currentDistance = Math.abs(Date.parse(frame.rfc460Timestamp) - targetMs);
  const bestDistance = Math.abs(Date.parse(best.rfc460Timestamp) - targetMs);
  return currentDistance < bestDistance ? frame : best;
}, null);

const participantFromWindow = (frame, participantId) => [
  ...(frame.blueTeam?.participants || []),
  ...(frame.redTeam?.participants || []),
].find((participant) => participant.participantId === participantId);

const participantFromDetails = (frame, participantId) =>
  frame.participants?.find((participant) => participant.participantId === participantId);

const countItem = (items, itemId) => (items || []).filter((value) => value === itemId).length;

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const times = alignedTimes(START_TIME, END_TIME);
  const jobs = times.flatMap((startingTime) => [
    { endpoint: "window", startingTime },
    { endpoint: "details", startingTime },
  ]);

  const downloadedAt = new Date().toISOString();
  const requests = await mapConcurrent(
    jobs,
    ({ endpoint, startingTime }) => fetchSlice(endpoint, startingTime),
    CONCURRENCY,
  );
  const windowRequests = requests.filter((request) => request.endpoint === "window");
  const detailsRequests = requests.filter((request) => request.endpoint === "details");
  const windowFrames = uniqueFrames(windowRequests);
  const detailsFrames = uniqueFrames(detailsRequests);

  const windowRaw = Buffer.from(JSON.stringify({
    archivedAt: downloadedAt,
    gameId: GAME_ID,
    matchId: MATCH_ID,
    requests: windowRequests,
  }));
  const detailsRaw = Buffer.from(JSON.stringify({
    archivedAt: downloadedAt,
    gameId: GAME_ID,
    matchId: MATCH_ID,
    requests: detailsRequests,
  }));
  const windowGzip = gzipSync(windowRaw, { level: 9 });
  const detailsGzip = gzipSync(detailsRaw, { level: 9 });
  await writeFile(`${OUTPUT_DIR}/riot-window-responses.json.gz`, windowGzip);
  await writeFile(`${OUTPUT_DIR}/riot-details-responses.json.gz`, detailsGzip);

  const metadataResponse = windowRequests.find((request) => request.response.gameMetadata)?.response;
  if (!metadataResponse?.gameMetadata) throw new Error("Riot metadata was not present");
  const metadata = metadataResponse.gameMetadata;
  const participants = [
    ...metadata.blueTeamMetadata.participantMetadata.map((participant) => ({
      ...participant,
      team: "Gen.G",
      side: "Blue",
      won: false,
    })),
    ...metadata.redTeamMetadata.participantMetadata.map((participant) => ({
      ...participant,
      team: "Dplus KIA",
      side: "Red",
      won: true,
    })),
  ];

  const firstFinishedFrame = windowFrames.find((frame) => frame.gameState === "finished");
  const finalWindowFrame = firstFinishedFrame || windowFrames.at(-1);
  const finalDetailsFrame = detailsFrames.at(-1);
  const clockZeroMs = Date.parse(GAME_CLOCK_ZERO);
  const durationSec = Math.round(
    (Date.parse(finalWindowFrame.rfc460Timestamp) - clockZeroMs) / 1000,
  );
  const target15Ms = clockZeroMs + 15 * 60_000;
  const frameAt15 = nearestFrame(windowFrames, target15Ms);
  const detailsAt15 = nearestFrame(detailsFrames, target15Ms);

  const controlWardEvents = [];
  const controlWardMinimums = new Map(participants.map((participant) => [participant.participantId, 0]));
  for (const participant of participants) {
    let previousCount = 0;
    for (const frame of detailsFrames) {
      const current = participantFromDetails(frame, participant.participantId);
      if (!current) continue;
      const currentCount = countItem(current.items, 2055);
      if (currentCount > previousCount) {
        const quantity = currentCount - previousCount;
        controlWardMinimums.set(
          participant.participantId,
          controlWardMinimums.get(participant.participantId) + quantity,
        );
        controlWardEvents.push({
          timestamp: frame.rfc460Timestamp,
          elapsed_sec: Number(((Date.parse(frame.rfc460Timestamp) - clockZeroMs) / 1000).toFixed(3)),
          participant_id: participant.participantId,
          player: participant.summonerName.replace(/^(GEN|DK)\s+/, ""),
          team: participant.team,
          item_id: 2055,
          quantity,
          confidence: "observed_inventory_increase_lower_bound",
        });
      }
      previousCount = currentCount;
    }
  }

  const killEvents = [];
  for (const participant of participants) {
    let previousKills = 0;
    for (const frame of windowFrames) {
      const current = participantFromWindow(frame, participant.participantId);
      if (!current) continue;
      if (current.kills > previousKills) {
        killEvents.push({
          timestamp: frame.rfc460Timestamp,
          elapsed_sec: Number(((Date.parse(frame.rfc460Timestamp) - clockZeroMs) / 1000).toFixed(3)),
          participant_id: participant.participantId,
          player: participant.summonerName.replace(/^(GEN|DK)\s+/, ""),
          team: participant.team,
          kills_added: current.kills - previousKills,
          cumulative_kills: current.kills,
          confidence: "derived_from_riot_kill_counter_increase",
        });
      }
      previousKills = current.kills;
    }
  }
  killEvents.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const firstBloodEvent = killEvents[0] || null;
  const multikillClusters = [];
  const multikillsByParticipant = new Map();
  for (const participant of participants) {
    const expanded = killEvents
      .filter((event) => event.participant_id === participant.participantId)
      .flatMap((event) => Array.from({ length: event.kills_added }, () => event));
    const clusters = [];
    let currentCluster = [];
    for (const event of expanded) {
      const previous = currentCluster.at(-1);
      if (!previous || event.elapsed_sec - previous.elapsed_sec <= 10) {
        currentCluster.push(event);
      } else {
        if (currentCluster.length >= 2) clusters.push(currentCluster);
        currentCluster = [event];
      }
    }
    if (currentCluster.length >= 2) clusters.push(currentCluster);
    const summary = { double: 0, triple: 0, quadra: 0, penta: 0, largest: 1 };
    for (const cluster of clusters) {
      const size = Math.min(cluster.length, 5);
      summary.largest = Math.max(summary.largest, size);
      if (size === 2) summary.double += 1;
      if (size === 3) summary.triple += 1;
      if (size === 4) summary.quadra += 1;
      if (size >= 5) summary.penta += 1;
      multikillClusters.push({
        participant_id: participant.participantId,
        player: participant.summonerName.replace(/^(GEN|DK)\s+/, ""),
        team: participant.team,
        start_timestamp: cluster[0].timestamp,
        end_timestamp: cluster.at(-1).timestamp,
        start_elapsed_sec: cluster[0].elapsed_sec,
        end_elapsed_sec: cluster.at(-1).elapsed_sec,
        kill_count: size,
        classification: [null, null, "double", "triple", "quadra", "penta"][size],
        confidence: "derived_using_10_second_consecutive_kill_window",
      });
    }
    multikillsByParticipant.set(participant.participantId, summary);
  }

  const byRole = new Map();
  for (const participant of participants) {
    byRole.set(`${participant.side}:${participant.role}`, participant);
  }

  const teamFinal = {
    Blue: finalWindowFrame.blueTeam,
    Red: finalWindowFrame.redTeam,
  };
  const playerRows = participants.map((participant) => {
    const final = participantFromDetails(finalDetailsFrame, participant.participantId);
    const at15 = participantFromWindow(frameAt15, participant.participantId);
    const detail15 = participantFromDetails(detailsAt15, participant.participantId);
    const opponentSide = participant.side === "Blue" ? "Red" : "Blue";
    const opponent = byRole.get(`${opponentSide}:${participant.role}`);
    const opponentAt15 = participantFromWindow(frameAt15, opponent.participantId);
    const team = teamFinal[participant.side];
    const teamGold = team.participants.reduce((sum, value) => sum + value.totalGold, 0);
    const playerName = participant.summonerName.replace(/^(GEN|DK)\s+/, "");
    const multikills = multikillsByParticipant.get(participant.participantId);
    return {
      source_game_id: GAME_ID,
      source_match_id: MATCH_ID,
      participant_id: participant.participantId,
      esports_player_id: participant.esportsPlayerId,
      player: playerName,
      team: participant.team,
      side: participant.side,
      champion: participant.championId,
      role: participant.role,
      won: participant.won,
      duration_sec: durationSec,
      final_timestamp: finalDetailsFrame.rfc460Timestamp,
      level: final.level,
      kills: final.kills,
      deaths: final.deaths,
      assists: final.assists,
      kda: final.deaths === 0 ? "Perfect" : Number(((final.kills + final.assists) / final.deaths).toFixed(4)),
      cs: final.creepScore,
      total_gold: final.totalGoldEarned,
      team_kills: team.totalKills,
      team_gold: teamGold,
      kill_participation_feed: final.killParticipation,
      kill_participation_derived: team.totalKills > 0 ? (final.kills + final.assists) / team.totalKills : null,
      champion_damage_share: final.championDamageShare,
      gold_share: teamGold > 0 ? final.totalGoldEarned / teamGold : null,
      damage_to_champions: null,
      gpm: Number((final.totalGoldEarned / (durationSec / 60)).toFixed(3)),
      csm: Number((final.creepScore / (durationSec / 60)).toFixed(3)),
      wards_placed: final.wardsPlaced,
      wards_destroyed: final.wardsDestroyed,
      control_wards_bought_observed_min: controlWardMinimums.get(participant.participantId),
      control_wards_confidence: "lower_bound_from_item_2055_inventory_increases",
      first_blood_kill_observed: firstBloodEvent?.participant_id === participant.participantId,
      double_kill_clusters_observed: multikills.double,
      triple_kill_clusters_observed: multikills.triple,
      quadra_kill_clusters_observed: multikills.quadra,
      penta_kill_clusters_observed: multikills.penta,
      largest_multikill_observed: multikills.largest,
      multikill_confidence: "derived_using_10_second_consecutive_kill_window",
      item_ids: final.items,
      primary_rune_style_id: final.perkMetadata?.styleId,
      secondary_rune_style_id: final.perkMetadata?.subStyleId,
      perk_ids: final.perkMetadata?.perks,
      ability_order: final.abilities,
      attack_damage_final: final.attackDamage,
      ability_power_final: final.abilityPower,
      armor_final: final.armor,
      magic_resistance_final: final.magicResistance,
      attack_speed_final: final.attackSpeed,
      level_at_15: detail15?.level ?? at15?.level,
      kills_at_15: at15?.kills,
      deaths_at_15: at15?.deaths,
      assists_at_15: at15?.assists,
      cs_at_15: at15?.creepScore,
      gold_at_15: at15?.totalGold,
      lane_opponent: opponent.summonerName.replace(/^(GEN|DK)\s+/, ""),
      cs_diff_at_15: at15.creepScore - opponentAt15.creepScore,
      gold_diff_at_15: at15.totalGold - opponentAt15.totalGold,
      xp_diff_at_15: null,
      vision_score: null,
      damage_to_towers: null,
      damage_mitigated: null,
      total_heal: null,
      source_notes: "Riot live-stat frames; null means not exposed by this feed",
    };
  });

  const playerColumns = Object.keys(playerRows[0]);
  await writeFile(`${OUTPUT_DIR}/player-game-stats.csv`, toCsv(playerRows, playerColumns));

  const teamRows = [
    {
      source_game_id: GAME_ID,
      team: "Gen.G",
      side: "Blue",
      won: false,
      kills: finalWindowFrame.blueTeam.totalKills,
      gold: finalWindowFrame.blueTeam.participants.reduce((sum, value) => sum + value.totalGold, 0),
      towers: finalWindowFrame.blueTeam.towers,
      inhibitors: finalWindowFrame.blueTeam.inhibitors,
      dragons: finalWindowFrame.blueTeam.dragons.length,
      dragon_types: finalWindowFrame.blueTeam.dragons,
      barons: finalWindowFrame.blueTeam.barons,
      heralds: 0,
      void_grubs: 3,
      atakhans: null,
      supplemental_objective_source: "Reddit post-match table for heralds/void grubs",
    },
    {
      source_game_id: GAME_ID,
      team: "Dplus KIA",
      side: "Red",
      won: true,
      kills: finalWindowFrame.redTeam.totalKills,
      gold: finalWindowFrame.redTeam.participants.reduce((sum, value) => sum + value.totalGold, 0),
      towers: finalWindowFrame.redTeam.towers,
      inhibitors: finalWindowFrame.redTeam.inhibitors,
      dragons: finalWindowFrame.redTeam.dragons.length,
      dragon_types: finalWindowFrame.redTeam.dragons,
      barons: finalWindowFrame.redTeam.barons,
      heralds: 1,
      void_grubs: 0,
      atakhans: null,
      supplemental_objective_source: "Reddit post-match table for heralds/void grubs",
    },
  ];
  await writeFile(`${OUTPUT_DIR}/team-game-stats.csv`, toCsv(teamRows, Object.keys(teamRows[0])));

  const playerTimelineRows = [];
  for (const frame of windowFrames) {
    const elapsed = Number(((Date.parse(frame.rfc460Timestamp) - clockZeroMs) / 1000).toFixed(3));
    for (const participant of participants) {
      const value = participantFromWindow(frame, participant.participantId);
      if (!value) continue;
      playerTimelineRows.push({
        timestamp: frame.rfc460Timestamp,
        elapsed_sec: elapsed,
        game_state: frame.gameState,
        participant_id: participant.participantId,
        player: participant.summonerName.replace(/^(GEN|DK)\s+/, ""),
        team: participant.team,
        level: value.level,
        kills: value.kills,
        deaths: value.deaths,
        assists: value.assists,
        cs: value.creepScore,
        gold: value.totalGold,
        current_health: value.currentHealth,
        max_health: value.maxHealth,
      });
    }
  }
  await writeFile(
    `${OUTPUT_DIR}/player-timeline.csv`,
    toCsv(playerTimelineRows, Object.keys(playerTimelineRows[0])),
  );

  const minuteRows = [];
  for (let minute = 0; minute <= Math.ceil(durationSec / 60); minute += 1) {
    const frame = nearestFrame(windowFrames, clockZeroMs + minute * 60_000);
    const details = nearestFrame(detailsFrames, Date.parse(frame.rfc460Timestamp));
    for (const participant of participants) {
      const value = participantFromWindow(frame, participant.participantId);
      const detail = participantFromDetails(details, participant.participantId);
      minuteRows.push({
        minute,
        timestamp: frame.rfc460Timestamp,
        participant_id: participant.participantId,
        player: participant.summonerName.replace(/^(GEN|DK)\s+/, ""),
        team: participant.team,
        level: value?.level ?? detail?.level,
        kills: value?.kills ?? detail?.kills,
        deaths: value?.deaths ?? detail?.deaths,
        assists: value?.assists ?? detail?.assists,
        cs: value?.creepScore ?? detail?.creepScore,
        gold: value?.totalGold ?? detail?.totalGoldEarned,
        wards_placed: detail?.wardsPlaced,
        wards_destroyed: detail?.wardsDestroyed,
        item_ids: detail?.items,
      });
    }
  }
  await writeFile(
    `${OUTPUT_DIR}/player-minute-snapshots.csv`,
    toCsv(minuteRows, Object.keys(minuteRows[0])),
  );

  const objectiveEvents = [];
  let previous = null;
  for (const frame of windowFrames) {
    if (!previous) {
      previous = frame;
      continue;
    }
    for (const [sideKey, side, team] of [["blueTeam", "Blue", "Gen.G"], ["redTeam", "Red", "Dplus KIA"]]) {
      const before = previous[sideKey];
      const after = frame[sideKey];
      const elapsed = Number(((Date.parse(frame.rfc460Timestamp) - clockZeroMs) / 1000).toFixed(3));
      for (let index = before.dragons.length; index < after.dragons.length; index += 1) {
        objectiveEvents.push({ timestamp: frame.rfc460Timestamp, elapsed_sec: elapsed, team, side, objective: "dragon", subtype: after.dragons[index], new_total: index + 1 });
      }
      for (const field of ["barons", "towers", "inhibitors"]) {
        if (after[field] > before[field]) {
          objectiveEvents.push({ timestamp: frame.rfc460Timestamp, elapsed_sec: elapsed, team, side, objective: field.slice(0, -1), subtype: "", new_total: after[field] });
        }
      }
    }
    previous = frame;
  }
  await writeFile(
    `${OUTPUT_DIR}/objective-events.csv`,
    toCsv(objectiveEvents, ["timestamp", "elapsed_sec", "team", "side", "objective", "subtype", "new_total"]),
  );
  await writeFile(
    `${OUTPUT_DIR}/control-ward-purchase-events.csv`,
    toCsv(controlWardEvents, ["timestamp", "elapsed_sec", "participant_id", "player", "team", "item_id", "quantity", "confidence"]),
  );
  await writeFile(
    `${OUTPUT_DIR}/kill-events.csv`,
    toCsv(killEvents, ["timestamp", "elapsed_sec", "participant_id", "player", "team", "kills_added", "cumulative_kills", "confidence"]),
  );
  await writeFile(
    `${OUTPUT_DIR}/multikill-clusters.csv`,
    toCsv(multikillClusters, ["participant_id", "player", "team", "start_timestamp", "end_timestamp", "start_elapsed_sec", "end_elapsed_sec", "kill_count", "classification", "confidence"]),
  );

  const archiveMetadata = {
    archivedAt: downloadedAt,
    esportsGameId: GAME_ID,
    esportsMatchId: MATCH_ID,
    patchVersion: metadata.patchVersion,
    requestedRange: { start: START_TIME, end: END_TIME, intervalSeconds: 10 },
    gameClockZero: GAME_CLOCK_ZERO,
    firstFinishedTimestamp: firstFinishedFrame?.rfc460Timestamp || null,
    derivedDurationSeconds: durationSec,
    finalScore: { "Gen.G": finalWindowFrame.blueTeam.totalKills, "Dplus KIA": finalWindowFrame.redTeam.totalKills },
    counts: {
      requestCount: requests.length,
      windowRequestCount: windowRequests.length,
      detailsRequestCount: detailsRequests.length,
      uniqueWindowFrames: windowFrames.length,
      uniqueDetailsFrames: detailsFrames.length,
      playerTimelineRows: playerTimelineRows.length,
      controlWardEvents: controlWardEvents.length,
      killEvents: killEvents.length,
      multikillClusters: multikillClusters.length,
      objectiveEvents: objectiveEvents.length,
    },
    rawArchives: {
      "riot-window-responses.json.gz": { bytes: windowGzip.length, sha256: sha256(windowGzip) },
      "riot-details-responses.json.gz": { bytes: detailsGzip.length, sha256: sha256(detailsGzip) },
    },
    sourceUrls: {
      window: `${BASE_URL}/window/${GAME_ID}`,
      details: `${BASE_URL}/details/${GAME_ID}`,
      redditPostMatch: "https://www.reddit.com/r/leagueoflegends/comments/1vcm8sk/geng_vs_dplus_kia_lck_2026_season_rounds_34/",
    },
    caveats: [
      "Riot exposes champion damage share but not absolute damage-to-champions in this feed.",
      "XP, vision score, damage to towers, damage mitigated, and healing are not exposed and remain blank.",
      "Control ward purchases are a lower bound detected from item 2055 inventory increases.",
      "Multikills are derived from successive Riot kill-counter increases no more than ten seconds apart.",
      "Herald and void-grub totals come from the post-match table because the Riot window schema omits them.",
      "The game clock was calibrated from the 33:06 post-match duration and cross-checked against the VOD's 15:00 scoreboard; a third-party result screenshot displayed 32:19.",
    ],
  };
  await writeFile(`${OUTPUT_DIR}/archive-metadata.json`, JSON.stringify(archiveMetadata, null, 2) + "\n");
  process.stdout.write(JSON.stringify(archiveMetadata, null, 2) + "\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
