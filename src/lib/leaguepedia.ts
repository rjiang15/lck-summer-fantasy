// Minimal Leaguepedia Cargo API client.
// Docs: https://lol.fandom.com/wiki/Help:API_Documentation
//
// Anonymous access is heavily rate limited by Fandom. For sustained use, create
// a free Fandom account, generate a bot password at
// https://lol.fandom.com/wiki/Special:BotPasswords, and set LP_BOT_USERNAME
// ("YourUser@botname") and LP_BOT_PASSWORD in .env — the client logs in
// automatically and gets much higher limits.

import "dotenv/config";

const API_URL = "https://lol.fandom.com/api.php";
const USER_AGENT =
  "lck-fantasy-mvp/0.1 (hobby fantasy league; contact: santouka72101@gmail.com)";
const PAGE_SIZE = 500; // cargo max for anonymous users
const THROTTLE_MS = 1500;

// ---- session (cookies + optional bot login) ----

const cookies = new Map<string, string>();
let loginAttempted = false;

function storeCookies(res: Response) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": USER_AGENT };
  if (cookies.size > 0) {
    h.Cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  return h;
}

async function loginIfConfigured() {
  if (loginAttempted) return;
  loginAttempted = true;
  const user = process.env.LP_BOT_USERNAME;
  const pass = process.env.LP_BOT_PASSWORD;
  if (!user || !pass) return;

  const tokenRes = await fetch(
    `${API_URL}?action=query&meta=tokens&type=login&format=json`,
    { headers: headers() },
  );
  storeCookies(tokenRes);
  const tokenJson = (await tokenRes.json()) as {
    query?: { tokens?: { logintoken?: string } };
  };
  const token = tokenJson.query?.tokens?.logintoken;
  if (!token) throw new Error("Leaguepedia login: could not fetch login token");

  const body = new URLSearchParams({
    action: "login",
    format: "json",
    lgname: user,
    lgpassword: pass,
    lgtoken: token,
  });
  const loginRes = await fetch(API_URL, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  storeCookies(loginRes);
  const loginJson = (await loginRes.json()) as { login?: { result?: string } };
  if (loginJson.login?.result !== "Success") {
    throw new Error(`Leaguepedia login failed: ${loginJson.login?.result}`);
  }
  console.log(`  logged in to Leaguepedia as ${user}`);
}

let lastRequestAt = 0;

async function throttle() {
  const wait = lastRequestAt + THROTTLE_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

export interface CargoParams {
  tables: string;
  fields: string;
  where?: string;
  joinOn?: string;
  orderBy?: string;
  onProgress?: (event: CargoProgressEvent) => Promise<void> | void;
}

export type CargoProgressEvent = {
  kind: "request" | "page" | "retry";
  offset: number;
  rows: number;
  attempt?: number;
  retryInSeconds?: number;
};

type CargoRow = Record<string, string>;

const MAX_RETRIES = 8;
// Fandom's anonymous rate limit has a long reset window and rejected requests
// appear to re-trip it, so back off hard: 2min, 4min, then 5min flat.
const backoffMs = (attempt: number) =>
  Math.min(120_000 * 2 ** (attempt - 1), 300_000);

async function fetchPage(
  search: URLSearchParams,
  offset: number,
  rows: number,
  onProgress?: CargoParams["onProgress"],
): Promise<{ title: CargoRow }[]> {
  await loginIfConfigured();
  for (let attempt = 1; ; attempt++) {
    await onProgress?.({ kind: "request", offset, rows, attempt });
    const res = await fetch(`${API_URL}?${search}`, { headers: headers() });
    storeCookies(res);
    if (!res.ok) throw new Error(`Leaguepedia HTTP ${res.status}`);
    const json = (await res.json()) as {
      cargoquery?: { title: CargoRow }[];
      error?: { code: string; info: string };
    };
    if (json.error?.code === "ratelimited" && attempt <= MAX_RETRIES) {
      const wait = backoffMs(attempt);
      console.warn(`  rate limited, waiting ${wait / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
      let remaining = Math.ceil(wait / 1000);
      while (remaining > 0) {
        await onProgress?.({ kind: "retry", offset, rows, attempt, retryInSeconds: remaining });
        const slice = Math.min(15, remaining);
        await new Promise((r) => setTimeout(r, slice * 1000));
        remaining -= slice;
      }
      continue;
    }
    if (json.error) {
      throw new Error(`Leaguepedia API error ${json.error.code}: ${json.error.info}`);
    }
    return json.cargoquery ?? [];
  }
}

/** Run a cargoquery, transparently paginating until all rows are fetched. */
export async function cargoQuery(params: CargoParams): Promise<CargoRow[]> {
  const rows: CargoRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    await throttle();
    // Alias every field to itself ("DateTime_UTC=DateTime_UTC"): Cargo
    // otherwise replaces underscores with spaces in result keys.
    const fields = params.fields
      .split(",")
      .map((f) => (f.includes("=") ? f : `${f.trim()}=${f.trim()}`))
      .join(",");
    const search = new URLSearchParams({
      action: "cargoquery",
      format: "json",
      tables: params.tables,
      fields,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (params.where) search.set("where", params.where);
    if (params.joinOn) search.set("join_on", params.joinOn);
    if (params.orderBy) search.set("order_by", params.orderBy);

    const page = (await fetchPage(search, offset, rows.length, params.onProgress)).map((r) => r.title);
    rows.push(...page);
    await params.onProgress?.({ kind: "page", offset, rows: rows.length });
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** Parse Leaguepedia's "YYYY-MM-DD HH:MM:SS" (UTC) timestamps. */
export function parseUtc(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? null : d;
}
