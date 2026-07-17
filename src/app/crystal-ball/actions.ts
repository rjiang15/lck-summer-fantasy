"use server";

import { revalidatePath } from "next/cache";
import { requireLeagueMember } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DRAKE_ANSWERS, PENTAKILL_ANSWERS, YES_NO_ANSWERS } from "@/lib/crystal-ball-options";

export type CrystalBallSaveState = { ok: boolean; message: string; saved: number } | null;

type CrystalQuestion = {
  id: number;
  answerType: string;
};

function validateAnswer(
  question: CrystalQuestion,
  rawAnswer: string,
  teams: Set<string>,
  players: Set<string>,
) {
  let answer = rawAnswer.trim();
  if (!answer || answer.length > 120) throw new Error("Choose an answer for every prediction you want to save");

  if (question.answerType === "number") {
    const value = Number(answer);
    if (!Number.isInteger(value) || value < 0 || value > 200) throw new Error("Enter a whole number from 0 to 200");
    answer = String(value);
  } else if (question.answerType === "yes_no") {
    if (!(YES_NO_ANSWERS as readonly string[]).includes(answer)) throw new Error("Choose Yes or No");
  } else if (question.answerType === "pentakill_bucket") {
    if (!(PENTAKILL_ANSWERS as readonly string[]).includes(answer)) throw new Error("Choose a listed pentakill total");
  } else if (question.answerType === "drake") {
    if (!(DRAKE_ANSWERS as readonly string[]).includes(answer)) throw new Error("Choose a listed elemental drake");
  } else if (question.answerType === "team") {
    if (!teams.has(answer)) throw new Error("Choose a team from this tournament");
  } else if (question.answerType === "player") {
    if (!players.has(answer)) throw new Error("Choose a player from this tournament");
  } else if (question.answerType === "champion") {
    if (!/^[A-Za-z0-9 '&.\-]+$/.test(answer) || answer.length > 40) throw new Error("Choose a valid champion");
  } else {
    throw new Error("Unsupported Crystal Ball answer type");
  }

  return answer;
}

export async function saveAllCrystalBall(
  _previous: CrystalBallSaveState,
  formData: FormData,
): Promise<CrystalBallSaveState> {
  try {
    const leagueId = Number(formData.get("leagueId"));
    if (!Number.isInteger(leagueId)) throw new Error("Invalid league");

    const { user, league } = await requireLeagueMember(leagueId);
    if (league.crystalBallLockedAt || league.seasonStatus !== "PRESEASON") {
      throw new Error("Crystal Ball answers are locked for the season");
    }

    const [questions, matches, tournamentPlayers] = await Promise.all([
      prisma.crystalBallQuestion.findMany({
        where: { leagueId },
        select: { id: true, answerType: true },
      }),
      prisma.match.findMany({
        where: { tournamentId: league.tournamentId },
        select: { team1: true, team2: true },
      }),
      prisma.tournamentPlayer.findMany({
        where: { tournamentId: league.tournamentId },
        select: { playerId: true },
      }),
    ]);

    const teams = new Set(matches.flatMap((match) => [match.team1, match.team2]));
    const players = new Set(tournamentPlayers.map((player) => player.playerId));
    const updates = questions.flatMap((question) => {
      const rawAnswer = String(formData.get(`answer_${question.id}`) ?? "").trim();
      if (!rawAnswer) return [];
      return [{ questionId: question.id, answer: validateAnswer(question, rawAnswer, teams, players) }];
    });

    if (updates.length === 0) throw new Error("Choose at least one prediction before saving");

    await prisma.$transaction(async (tx) => {
      const currentLeague = await tx.league.findUnique({
        where: { id: leagueId },
        select: { crystalBallLockedAt: true, seasonStatus: true },
      });
      if (!currentLeague || currentLeague.crystalBallLockedAt || currentLeague.seasonStatus !== "PRESEASON") {
        throw new Error("Crystal Ball answers were locked while this form was being saved");
      }
      for (const update of updates) {
        await tx.crystalBallAnswer.upsert({
          where: { questionId_userId: { questionId: update.questionId, userId: user.id } },
          create: { questionId: update.questionId, userId: user.id, answer: update.answer },
          update: { answer: update.answer },
        });
      }
    });

    revalidatePath("/crystal-ball");
    return {
      ok: true,
      saved: updates.length,
      message: `Saved ${updates.length} of ${questions.length} predictions.`,
    };
  } catch (error) {
    return { ok: false, saved: 0, message: error instanceof Error ? error.message : String(error) };
  }
}
