"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function saveCrystalBall(formData: FormData) {
  const user = await requireUser();
  const questionId = Number(formData.get("questionId"));
  const answer = String(formData.get("answer") ?? "").trim();
  if (!questionId || !answer || answer.length > 120) throw new Error("Invalid answer");
  const question = await prisma.crystalBallQuestion.findUniqueOrThrow({
    where: { id: questionId },
    include: { league: true },
  });
  const membership = await prisma.leagueMembership.findUnique({
    where: { leagueId_userId: { leagueId: question.leagueId, userId: user.id } },
  });
  if (!membership) throw new Error("You are not a member of this league");
  if (question.league.crystalBallLockedAt || question.league.seasonStatus !== "PRESEASON") {
    throw new Error("Crystal Ball answers are locked for the season");
  }
  await prisma.crystalBallAnswer.upsert({
    where: { questionId_userId: { questionId, userId: user.id } },
    create: { questionId, userId: user.id, answer },
    update: { answer },
  });
  revalidatePath("/crystal-ball");
}
