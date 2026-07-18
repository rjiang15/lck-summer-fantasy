import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { DEFAULT_SCORING } from "./scoring";
import { DEFAULT_CRYSTAL_BALL } from "./crystal-ball";
import { initialLeagueWeekRows } from "./league-setup";

export const ACTIVE_LEAGUE_COOKIE = "activeLeague";
export const MANAGER_ROLES = ["OWNER", "COMMISSIONER"] as const;

export function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "league";
}

export async function uniqueLeagueSlug(name: string) {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  while (await prisma.league.findUnique({ where: { slug }, select: { id: true } })) slug = `${base}-${suffix++}`;
  return slug;
}

export function newInviteCode() {
  return randomBytes(5).toString("base64url").toUpperCase();
}

export async function createLeagueForOwner(input: {
  ownerId: number;
  name: string;
  tournamentId: string;
  isSimulation: boolean;
  teamName?: string;
}) {
  const slug = await uniqueLeagueSlug(input.name);
  const inviteCode = newInviteCode();
  return prisma.$transaction(async (tx) => {
    const [weeks, rosterPlayers] = await Promise.all([
      tx.week.findMany({
        where: { tournamentId: input.tournamentId },
        orderBy: { number: "asc" },
      }),
      tx.tournamentPlayer.count({ where: { tournamentId: input.tournamentId } }),
    ]);
    const scheduledWeeks = weeks.filter((week) => week.scheduleImportedAt !== null);
    if (input.isSimulation) {
      if (weeks.length === 0 || scheduledWeeks.length !== weeks.length) {
        throw new Error("Simulation leagues require the complete stored season schedule");
      }
      if (weeks.some((week) => week.resultsImportedAt === null)) {
        throw new Error("Simulation leagues require stored results for every week");
      }
      if (rosterPlayers === 0) {
        throw new Error("Simulation leagues require an imported tournament player roster");
      }
    }
    const league = await tx.league.create({
      data: {
        name: input.name,
        slug,
        inviteCode,
        tournamentId: input.tournamentId,
        isSimulation: input.isSimulation,
        scoringConfig: JSON.stringify(DEFAULT_SCORING),
        memberships: { create: { userId: input.ownerId, role: "OWNER" } },
        cbQuestions: { create: [...DEFAULT_CRYSTAL_BALL] },
        ...(input.teamName ? { fantasyTeams: { create: { userId: input.ownerId, name: input.teamName } } } : {}),
      },
    });
    if (scheduledWeeks.length > 0) {
      const now = new Date();
      await tx.leagueWeek.createMany({
        data: initialLeagueWeekRows(league.id, scheduledWeeks, now),
      });
    }
    return league;
  });
}

export async function getPreferredMembership(userId: number) {
  const preferredSlug = (await cookies()).get(ACTIVE_LEAGUE_COOKIE)?.value;
  const preferred = await prisma.leagueMembership.findFirst({
    where: { userId, ...(preferredSlug ? { league: { slug: preferredSlug } } : {}) },
    include: { league: true },
  });
  if (preferred) return preferred;
  return prisma.leagueMembership.findFirst({
    where: { userId },
    include: { league: true },
    orderBy: { joinedAt: "asc" },
  });
}

export function isManagerRole(role: string) {
  return MANAGER_ROLES.includes(role as (typeof MANAGER_ROLES)[number]);
}
