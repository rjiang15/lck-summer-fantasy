const GOL_ORIGIN = "https://gol.gg";
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_DELAY_MS = 250;
const MAX_RETRIES = 4;

export type GolSeries = {
  summaryGameId: string;
  summaryUrl: string;
  label: string;
  team1: string;
  team2: string;
  team1Score: number;
  team2Score: number;
  weekLabel: string;
  patch: string | null;
  date: string;
};

export type GolSeriesGame = {
  gameId: string;
  gameNumber: number;
};

export type GolPlayerStats = {
  name: string;
  role: "Top" | "Jungle" | "Mid" | "Bot" | "Support";
  side: "Blue" | "Red";
  champion: string;
  stats: Record<string, string | null>;
};

export type GolDraft = {
  side: "Blue" | "Red";
  picks: string[];
  bans: string[];
};

export type GolTeamStats = {
  sourceName: string;
  side: "Blue" | "Red";
  won: boolean;
  kills: number;
  gold: number;
  towers: number;
  dragons: number;
  barons: number;
  turretPlates: number;
  cloudDrakes: number;
  infernalDrakes: number;
  mountainDrakes: number;
  oceanDrakes: number;
  hextechDrakes: number;
  chemtechDrakes: number;
  elderDragons: number;
  heralds: number;
  voidGrubs: number;
  atakhans: number;
  inhibs: number;
  firstBlood: boolean;
  firstDragon: boolean;
  firstHerald: boolean;
  firstBaron: boolean;
  firstTower: boolean;
};

export type GolGameOverview = {
  gameId: string;
  date: string;
  weekLabel: string;
  lengthSec: number;
  patch: string | null;
  teams: [GolTeamStats, GolTeamStats];
  drafts: [GolDraft, GolDraft];
};

type HtmlCell = { html: string; text: string };

const decodeHtml = (value: string) => value
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&apos;|&#39;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">");

const stripHtml = (value: string) => decodeHtml(value
  .replace(/<br\s*\/?\s*>/gi, " ")
  .replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ")
  .trim();

function extractTable(html: string, className: string) {
  const pattern = new RegExp(
    `<table\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/table>`,
    "i",
  );
  return pattern.exec(html)?.[1] ?? null;
}

function extractCells(rowHtml: string, tag = "td"): HtmlCell[] {
  const cells: HtmlCell[] = [];
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  for (const match of rowHtml.matchAll(pattern)) {
    cells.push({ html: match[1], text: stripHtml(match[1]) });
  }
  return cells;
}

function extractRows(tableHtml: string) {
  const rows: string[] = [];
  for (const match of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) rows.push(match[1]);
  return rows;
}

function imageAlts(html: string) {
  const values: string[] = [];
  for (const match of html.matchAll(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/gi)) {
    values.push(decodeHtml(match[1]).trim());
  }
  return values;
}

function int(value: string | null | undefined) {
  if (value == null || value.trim() === "") return null;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function compactNumber(value: string) {
  const match = value.trim().match(/^(-?[\d,.]+)\s*([km])?$/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return null;
  const multiplier = match[2]?.toLowerCase() === "k" ? 1_000 : match[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
  return Math.round(parsed * multiplier);
}

function canonicalRole(value: string): GolPlayerStats["role"] | null {
  switch (value.trim().toUpperCase()) {
    case "TOP": return "Top";
    case "JUNGLE":
    case "JNG": return "Jungle";
    case "MID":
    case "MIDDLE": return "Mid";
    case "ADC":
    case "BOT":
    case "BOTTOM": return "Bot";
    case "SUP":
    case "SUPPORT": return "Support";
    default: return null;
  }
}

export function normalizeGolIdentity(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function golTournamentMatchListUrl(tournamentName: string) {
  return `${GOL_ORIGIN}/tournament/tournament-matchlist/${encodeURIComponent(tournamentName)}/`;
}

export function golGameUrl(gameId: string, page: "summary" | "game" | "fullstats") {
  return `${GOL_ORIGIN}/game/stats/${gameId}/page-${page}/`;
}

export function isGolSeriesComplete(series: Pick<GolSeries, "team1Score" | "team2Score">, bestOf = 3) {
  const winsRequired = Math.floor(bestOf / 2) + 1;
  return Math.max(series.team1Score, series.team2Score) >= winsRequired;
}

export function parseGolMatchList(html: string): GolSeries[] {
  const table = extractTable(html, "table_list");
  if (!table) throw new Error("Games of Legends match-list table was not found");
  const series: GolSeries[] = [];
  for (const row of extractRows(table)) {
    const cells = extractCells(row);
    if (cells.length < 7) continue;
    const link = cells[0].html.match(/href=["'][^"']*\/game\/stats\/(\d+)\/page-summary\/["']/i);
    const score = cells[2].text.match(/(\d+)\s*-\s*(\d+)/);
    const date = cells[6].text.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (!link || !score || !date) continue;
    const summaryGameId = link[1];
    series.push({
      summaryGameId,
      summaryUrl: golGameUrl(summaryGameId, "summary"),
      label: cells[0].text,
      team1: cells[1].text,
      team2: cells[3].text,
      team1Score: Number(score[1]),
      team2Score: Number(score[2]),
      weekLabel: cells[4].text,
      patch: cells[5].text || null,
      date,
    });
  }
  if (series.length === 0) throw new Error("Games of Legends match list contained no series rows");
  return series;
}

export function parseGolSeriesGames(html: string): GolSeriesGame[] {
  const games = new Map<number, string>();
  const pattern = /<a\b[^>]*href=["'][^"']*\/game\/stats\/(\d+)\/page-game\/["'][^>]*>\s*Game\s+(\d+)\s*<\/a>/gi;
  for (const match of html.matchAll(pattern)) games.set(Number(match[2]), match[1]);
  const result = [...games.entries()]
    .sort(([left], [right]) => left - right)
    .map(([gameNumber, gameId]) => ({ gameId, gameNumber }));
  if (result.length === 0) throw new Error("Games of Legends series page contained no game links");
  return result;
}

function parseTeamHeader(html: string, side: "Blue" | "Red") {
  const marker = side.toLowerCase();
  const header = new RegExp(
    `<div\\b[^>]*class=["'][^"']*${marker}-line-header[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`,
    "i",
  ).exec(html)?.[1];
  if (!header) throw new Error(`Games of Legends ${side.toLowerCase()} team header was not found`);
  const text = stripHtml(header);
  const outcome = text.match(/\b(WIN|LOSS)\b/i)?.[1].toUpperCase();
  const name = stripHtml(header.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? text.replace(/\s*-\s*(WIN|LOSS).*$/i, ""));
  if (!name || !outcome) throw new Error(`Games of Legends ${side.toLowerCase()} team result was malformed`);
  return { name, won: outcome === "WIN" };
}

function parseScoreBoxes(html: string, side: "Blue" | "Red") {
  const values = new Map<string, number>();
  const className = `${side.toLowerCase()}_line`;
  const pattern = new RegExp(
    `<span\\b[^>]*class=["'][^"']*score-box[^"']*${className}[^"']*["'][^>]*>\\s*<img\\b[^>]*alt=["']([^"']+)["'][^>]*>\\s*([^<]+)<\\/span>`,
    "gi",
  );
  for (const match of html.matchAll(pattern)) {
    const parsed = compactNumber(stripHtml(match[2]));
    if (parsed !== null) values.set(decodeHtml(match[1]).trim().toLowerCase(), parsed);
  }
  return values;
}

function sideSections(html: string) {
  const blueStart = html.search(/blue-line-header/i);
  const redStart = html.search(/red-line-header/i);
  if (blueStart < 0 || redStart < 0) throw new Error("Games of Legends team sections were not found");
  const playerTable = html.slice(redStart).search(/<th\b[^>]*>\s*Player\s*<\/th>/i);
  const redEnd = playerTable < 0 ? html.length : redStart + playerTable;
  return {
    Blue: html.slice(blueStart, redStart),
    Red: html.slice(redStart, redEnd),
  };
}

function parseDraft(section: string, side: "Blue" | "Red"): GolDraft {
  const extract = (label: "Bans" | "Picks") => {
    const match = new RegExp(
      `<div\\b[^>]*class=["'][^"']*col-2[^"']*["'][^>]*>\\s*${label}[\\s\\S]*?<\\/div>\\s*<div\\b[^>]*class=["'][^"']*col-10[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`,
      "i",
    ).exec(section)?.[1] ?? "";
    const champions: string[] = [];
    for (const image of match.matchAll(/<img\b[^>]*src=["'][^"']*champions_icon[^"']*["'][^>]*alt=["']([^"']+)["'][^>]*>/gi)) {
      champions.push(decodeHtml(image[1]).trim());
    }
    // Some pages put alt before src.
    if (champions.length === 0) {
      for (const image of match.matchAll(/<img\b(?=[^>]*src=["'][^"']*champions_icon)(?=[^>]*alt=["']([^"']+)["'])[^>]*>/gi)) {
        champions.push(decodeHtml(image[1]).trim());
      }
    }
    return champions;
  };
  return { side, bans: extract("Bans"), picks: extract("Picks") };
}

type ObjectiveCounts = {
  cloudDrakes: number;
  infernalDrakes: number;
  mountainDrakes: number;
  oceanDrakes: number;
  hextechDrakes: number;
  chemtechDrakes: number;
  elderDragons: number;
  heralds: number;
  atakhans: number;
  inhibs: number;
  firstBlood: boolean;
  firstDragon: boolean;
  firstHerald: boolean;
  firstBaron: boolean;
  firstTower: boolean;
};

function parseObjectiveEvents(html: string) {
  const initial = (): ObjectiveCounts => ({
    cloudDrakes: 0, infernalDrakes: 0, mountainDrakes: 0, oceanDrakes: 0,
    hextechDrakes: 0, chemtechDrakes: 0, elderDragons: 0, heralds: 0,
    atakhans: 0, inhibs: 0, firstBlood: false, firstDragon: false,
    firstHerald: false, firstBaron: false, firstTower: false,
  });
  const values = { Blue: initial(), Red: initial() };
  let firstDragon: "Blue" | "Red" | null = null;
  let firstHerald: "Blue" | "Red" | null = null;
  let firstBaron: "Blue" | "Red" | null = null;
  const pattern = /<span\b[^>]*class=["'][^"']*\b(blue|red)_action\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
  for (const match of html.matchAll(pattern)) {
    const side = match[1].toLowerCase() === "blue" ? "Blue" : "Red";
    const alt = imageAlts(match[2])[0]?.toLowerCase() ?? "";
    const target = values[side];
    if (alt.includes("first blood")) target.firstBlood = true;
    if (alt.includes("first tower")) target.firstTower = true;
    if (alt.includes("cloud")) target.cloudDrakes++;
    if (alt.includes("infernal")) target.infernalDrakes++;
    if (alt.includes("mountain")) target.mountainDrakes++;
    if (alt.includes("ocean")) target.oceanDrakes++;
    if (alt.includes("hextech")) target.hextechDrakes++;
    if (alt.includes("chemtech")) target.chemtechDrakes++;
    if (alt.includes("elder")) target.elderDragons++;
    const dragon = /cloud|infernal|mountain|ocean|hextech|chemtech|elder/.test(alt);
    if (dragon && !firstDragon) firstDragon = side;
    if (alt.includes("herald")) {
      target.heralds++;
      if (!firstHerald) firstHerald = side;
    }
    if (alt.includes("nashor") && !firstBaron) firstBaron = side;
    if (alt.includes("atakhan")) target.atakhans++;
    if (alt.includes("inhibitor")) target.inhibs++;
  }
  if (firstDragon) values[firstDragon].firstDragon = true;
  if (firstHerald) values[firstHerald].firstHerald = true;
  if (firstBaron) values[firstBaron].firstBaron = true;
  return values;
}

function pairedMetric(html: string, label: string) {
  const pattern = new RegExp(
    `<div\\b[^>]*class=["'][^"']*col-4[^"']*text-center[^"']*["'][^>]*>[\\s\\S]*?\\b${label}\\s*<\\/div>\\s*<div\\b[^>]*class=["'][^"']*col-4[^"']*text-center[^"']*["'][^>]*>\\s*(\\d+)\\s*<\\/div>\\s*<div\\b[^>]*class=["'][^"']*col-4[^"']*text-center[^"']*["'][^>]*>\\s*(\\d+)\\s*<\\/div>`,
    "i",
  );
  const match = pattern.exec(html);
  return match ? { Blue: Number(match[1]), Red: Number(match[2]) } : { Blue: 0, Red: 0 };
}

export function parseGolGameOverview(html: string, gameId: string): GolGameOverview {
  const dateMeta = html.match(/\b(\d{4}-\d{2}-\d{2})\s*\(([^)]+)\)/);
  const duration = html.match(/Game Time\s*<br\s*\/?\s*>\s*<h1>\s*(\d+):(\d+)\s*<\/h1>/i);
  if (!dateMeta || !duration) throw new Error(`Games of Legends game ${gameId} metadata was not found`);
  const lengthSec = Number(duration[1]) * 60 + Number(duration[2]);
  const patch = html.match(/\bv([\d.]+)\s*<\/div>/i)?.[1] ?? null;
  const sections = sideSections(html);
  const headers = { Blue: parseTeamHeader(html, "Blue"), Red: parseTeamHeader(html, "Red") };
  if (headers.Blue.won === headers.Red.won) throw new Error(`Games of Legends game ${gameId} has an invalid winner`);
  const scoreBoxes = { Blue: parseScoreBoxes(html, "Blue"), Red: parseScoreBoxes(html, "Red") };
  const events = parseObjectiveEvents(html);
  const plates = pairedMetric(html, "Plates");
  const voidGrubs = pairedMetric(html, "Voidgrubs");
  const team = (side: "Blue" | "Red"): GolTeamStats => {
    const values = scoreBoxes[side];
    const required = (label: string) => {
      const value = values.get(label.toLowerCase());
      if (value == null) throw new Error(`Games of Legends game ${gameId} is missing ${side} ${label}`);
      return value;
    };
    return {
      sourceName: headers[side].name,
      side,
      won: headers[side].won,
      kills: required("Kills"),
      gold: required("Team Gold"),
      towers: required("Towers"),
      dragons: required("Dragons"),
      barons: required("Nashor"),
      turretPlates: plates[side],
      voidGrubs: voidGrubs[side],
      ...events[side],
    };
  };
  return {
    gameId,
    date: dateMeta[1],
    weekLabel: dateMeta[2],
    lengthSec,
    patch,
    teams: [team("Blue"), team("Red")],
    drafts: [parseDraft(sections.Blue, "Blue"), parseDraft(sections.Red, "Red")],
  };
}

export function parseGolFullStats(html: string, gameId: string): GolPlayerStats[] {
  const table = extractTable(html, "completestats");
  if (!table) throw new Error(`Games of Legends game ${gameId} all-stats table was not found`);
  const thead = table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] ?? "";
  const champions = imageAlts(thead).filter(Boolean);
  const rows = new Map<string, Array<string | null>>();
  for (const row of extractRows(table.replace(/<thead\b[^>]*>[\s\S]*?<\/thead>/i, ""))) {
    const cells = extractCells(row);
    if (cells.length !== 11 || !cells[0].text) continue;
    rows.set(cells[0].text.toLowerCase(), cells.slice(1).map((cell) => cell.text || null));
  }
  const names = rows.get("player");
  const roles = rows.get("role");
  if (!names || !roles || names.length !== 10 || roles.length !== 10 || champions.length !== 10) {
    throw new Error(`Games of Legends game ${gameId} all-stats table did not contain ten players`);
  }
  const players: GolPlayerStats[] = [];
  for (let index = 0; index < 10; index++) {
    const role = canonicalRole(roles[index] ?? "");
    const name = names[index]?.trim();
    if (!role || !name) throw new Error(`Games of Legends game ${gameId} player ${index + 1} was malformed`);
    const stats: Record<string, string | null> = {};
    for (const [label, values] of rows) stats[label] = values[index] ?? null;
    players.push({
      name,
      role,
      side: index < 5 ? "Blue" : "Red",
      champion: champions[index],
      stats,
    });
  }
  return players;
}

export function golStatInt(player: GolPlayerStats, label: string) {
  return int(player.stats[label.toLowerCase()]);
}

export function golStatRatio(player: GolPlayerStats, label: string) {
  const value = player.stats[label.toLowerCase()];
  if (value == null || value.trim() === "") return null;
  const parsed = Number.parseFloat(value.replace(/[% ,]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return value.includes("%") ? parsed / 100 : parsed;
}

let lastRequestAt = 0;

async function throttle() {
  const configured = Number(process.env.GOL_REQUEST_DELAY_MS ?? DEFAULT_REQUEST_DELAY_MS);
  const delay = Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_REQUEST_DELAY_MS;
  const remaining = lastRequestAt + delay - Date.now();
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  lastRequestAt = Date.now();
}

export async function fetchGolHtml(url: string) {
  if (!url.startsWith(`${GOL_ORIGIN}/`)) throw new Error(`Refusing to fetch a non-Gol.gg URL: ${url}`);
  for (let attempt = 1; ; attempt++) {
    await throttle();
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "lck-fantasy/1.0 (private fantasy league data importer)",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt >= MAX_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      continue;
    }
    if (response.ok) return response.text();
    if (attempt >= MAX_RETRIES || (response.status < 500 && response.status !== 429)) {
      throw new Error(`Games of Legends HTTP ${response.status} for ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
}
