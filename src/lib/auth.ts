import "server-only";

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { getPreferredMembership, isManagerRole } from "./leagues";

const COOKIE_NAME = "lck_session";
const SESSION_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, encoded] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { userId, tokenHash: tokenHash(token), expiresAt },
  });
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  }
  jar.delete(COOKIE_NAME);
}

export async function getCurrentUser() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.session.delete({ where: { id: session.id } });
    return null;
  }
  return session.user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireLeagueMember(leagueId?: number) {
  const user = await requireUser();
  const membership = leagueId
    ? await prisma.leagueMembership.findUnique({
        where: { leagueId_userId: { leagueId, userId: user.id } },
        include: { league: true },
      })
    : await getPreferredMembership(user.id);
  if (!membership) throw new Error("League membership required");
  return { user, membership, league: membership.league };
}

export async function requireLeagueManager(leagueId?: number) {
  const access = await requireLeagueMember(leagueId);
  if (!access.user.siteAdmin && !isManagerRole(access.membership.role)) {
    throw new Error("Commissioner access required for this league");
  }
  return access;
}

export async function requireLeagueOwner(leagueId: number) {
  const access = await requireLeagueMember(leagueId);
  if (!access.user.siteAdmin && access.membership.role !== "OWNER") {
    throw new Error("League owner access required");
  }
  return access;
}

export const isUnclaimedPassword = (hash: string) => hash === "mock-no-login-yet";
