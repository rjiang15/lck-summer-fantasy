import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { DEFAULT_SCORING } from "./scoring";

export const ACTIVE_LEAGUE_COOKIE = "activeLeague";
export const MANAGER_ROLES = ["OWNER", "COMMISSIONER"] as const;

export const DEFAULT_CRYSTAL_BALL = [
  { prompt: "Who will win the split?", answerType: "team", points: 20 },
  { prompt: "Who will be regular-season MVP?", answerType: "player", points: 15 },
  { prompt: "Which champion will be picked most?", answerType: "champion", points: 10 },
  { prompt: "Will there be a pentakill?", answerType: "yes_no", points: 10 },
  { prompt: "Who will have the most kills?", answerType: "player", points: 15 },
];

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
    const league = await tx.league.create({
      data: {
        name: input.name,
        slug,
        inviteCode,
        tournamentId: input.tournamentId,
        isSimulation: input.isSimulation,
        scoringConfig: JSON.stringify(DEFAULT_SCORING),
        memberships: { create: { userId: input.ownerId, role: "OWNER" } },
        cbQuestions: { create: DEFAULT_CRYSTAL_BALL },
        ...(input.teamName ? { fantasyTeams: { create: { userId: input.ownerId, name: input.teamName } } } : {}),
      },
    });
    const firstWeek = await tx.week.findFirst({
      where: { tournamentId: input.tournamentId, scheduleImportedAt: { not: null } },
      orderBy: { number: "asc" },
    });
    if (firstWeek) {
      await tx.leagueWeek.create({
        data: { leagueId: league.id, weekId: firstWeek.id, status: "OPEN", picksOpenAt: new Date() },
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
