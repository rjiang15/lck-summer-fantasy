import { proLeaderboard } from "./fantasy";
import { prisma } from "./db";
import type { ScoringConfig } from "./scoring";
import { draftFormatForTournament, isDraftRole } from "./draft";

export const DYNAMIC_PRICE_AVERAGE = 1_000;
export const DYNAMIC_PRICE_STANDARD_DEVIATION = 200;
export const DYNAMIC_PRICE_MIN = 600;
export const DYNAMIC_PRICE_MAX = 1_400;
export const DYNAMIC_PRICE_STEP = 25;

export type HistoricalPlayerValue = {
  playerId: string;
  ppg: number | null;
  games: number;
};

export type DraftPriceSheetPlayer = HistoricalPlayerValue & {
  price: number;
};

export type DraftPriceSheet = {
  version: 1;
  targetTournamentId: string;
  sourceTournamentId: string;
  generatedAt: string;
  averagePrice: number;
  priceStandardDeviation: number;
  sourceAveragePpg: number;
  sourceStandardDeviationPpg: number;
  players: Record<string, DraftPriceSheetPlayer>;
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round2 = (value: number) => Math.round(value * 100) / 100;

export function calculateDynamicPrices(values: readonly HistoricalPlayerValue[]) {
  if (values.length === 0) throw new Error("Cannot calculate prices without an eligible player pool");
  const observed = values.filter((row): row is HistoricalPlayerValue & { ppg: number } => row.ppg !== null && Number.isFinite(row.ppg));
  if (observed.length < 2) throw new Error("Dynamic pricing requires at least two players with historical results");
  const averagePpg = mean(observed.map((row) => row.ppg));
  const ppgStdDev = Math.sqrt(mean(observed.map((row) => (row.ppg - averagePpg) ** 2)));
  if (!Number.isFinite(ppgStdDev) || ppgStdDev <= 0) throw new Error("Historical player values have no usable variation");

  const clipped = observed.map((row) => Math.max(-2, Math.min(2, (row.ppg - averagePpg) / ppgStdDev)));
  const clippedMean = mean(clipped);
  const centered = clipped.map((value) => value - clippedMean);
  const scale = Math.min(1, 2 / Math.max(...centered.map(Math.abs)));
  const rawById = new Map(observed.map((row, index) => [
    row.playerId,
    DYNAMIC_PRICE_AVERAGE + centered[index] * scale * DYNAMIC_PRICE_STANDARD_DEVIATION,
  ]));

  const prices = new Map<string, number>();
  for (const row of values) {
    const raw = row.ppg === null ? DYNAMIC_PRICE_AVERAGE : rawById.get(row.playerId)!;
    prices.set(row.playerId, Math.max(
      DYNAMIC_PRICE_MIN,
      Math.min(DYNAMIC_PRICE_MAX, Math.round(raw / DYNAMIC_PRICE_STEP) * DYNAMIC_PRICE_STEP),
    ));
  }

  // Rounding can move the mean by a few dollars. Correct it in $25 steps,
  // leaving no-history players fixed at the neutral $1,000 baseline.
  const targetTotal = values.length * DYNAMIC_PRICE_AVERAGE;
  let difference = targetTotal - [...prices.values()].reduce((sum, price) => sum + price, 0);
  const adjustable = observed.map((row) => row.playerId);
  while (difference !== 0) {
    const step = Math.sign(difference) * DYNAMIC_PRICE_STEP;
    const candidates = adjustable.filter((id) => {
      const next = prices.get(id)! + step;
      return next >= DYNAMIC_PRICE_MIN && next <= DYNAMIC_PRICE_MAX;
    });
    if (candidates.length === 0) throw new Error("Could not center the dynamic price sheet");
    candidates.sort((left, right) => {
      const penalty = (id: string) => {
        const current = prices.get(id)!;
        const raw = rawById.get(id)!;
        return Math.abs(current + step - raw) - Math.abs(current - raw);
      };
      return penalty(left) - penalty(right) || left.localeCompare(right);
    });
    prices.set(candidates[0], prices.get(candidates[0])! + step);
    difference -= step;
  }

  return {
    averagePpg: round2(averagePpg),
    ppgStdDev: round2(ppgStdDev),
    players: Object.fromEntries(values.map((row) => [row.playerId, {
      ...row,
      ppg: row.ppg === null ? null : round2(row.ppg),
      price: prices.get(row.playerId)!,
    }])),
  };
}

export async function buildDraftPriceSheet(
  targetTournamentId: string,
  scoring: ScoringConfig,
): Promise<DraftPriceSheet> {
  const format = draftFormatForTournament(targetTournamentId);
  if (!format) throw new Error("Dynamic pricing is not configured for this tournament");
  const [eligible, leaderboard] = await Promise.all([
    prisma.tournamentPlayer.findMany({
      where: { tournamentId: targetTournamentId },
      include: { player: { select: { role: true } } },
    }),
    proLeaderboard(format.pricingSourceTournamentId, scoring),
  ]);
  const history = new Map(leaderboard.map((row) => [row.id, row]));
  const draftEligible = eligible.filter((row) => isDraftRole(row.role ?? row.player.role));
  const calculated = calculateDynamicPrices(draftEligible.map(({ playerId }) => ({
    playerId,
    ppg: history.get(playerId)?.pts ?? null,
    games: history.get(playerId)?.games ?? 0,
  })));
  return {
    version: 1,
    targetTournamentId,
    sourceTournamentId: format.pricingSourceTournamentId,
    generatedAt: new Date().toISOString(),
    averagePrice: DYNAMIC_PRICE_AVERAGE,
    priceStandardDeviation: DYNAMIC_PRICE_STANDARD_DEVIATION,
    sourceAveragePpg: calculated.averagePpg,
    sourceStandardDeviationPpg: calculated.ppgStdDev,
    players: calculated.players,
  };
}

export function parseDraftPriceSheet(value: string | null | undefined): DraftPriceSheet | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as DraftPriceSheet;
    if (parsed.version !== 1 || !parsed.players || typeof parsed.players !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function playerDraftPrice(
  mode: string,
  sheet: DraftPriceSheet | null,
  playerId: string,
  uniformPrice: number,
) {
  if (mode !== "DYNAMIC") return uniformPrice;
  const price = sheet?.players[playerId]?.price;
  if (!Number.isInteger(price) || price! < 0) throw new Error(`Dynamic price is missing for ${playerId}`);
  return price!;
}
