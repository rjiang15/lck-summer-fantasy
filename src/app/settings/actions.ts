"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { seedMockSeason } from "@/lib/mock";
import { getViewState } from "@/lib/view";
import { createSession, requireCommish } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function startMockSeason() {
  const commissioner = await requireCommish();
  const view = await getViewState();
  if (!view) return;
  await seedMockSeason(view.tournamentId, { humanUsername: commissioner.username, humanPasswordHash: commissioner.passwordHash });
  const replacement = await prisma.user.findUniqueOrThrow({ where: { username: commissioner.username } });
  await createSession(replacement.id);
  const jar = await cookies();
  jar.set("viewWeek", "0", { path: "/" }); // rewind to preseason
  redirect("/picks");
}
