import { requireLeagueMember } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { crystalBallPoints, parseResolutionEvidence } from "@/lib/crystal-ball";
import { ChampionLabel, TeamLabel } from "@/components/GameIdentity";
import CrystalBallForm from "./CrystalBallForm";

export const dynamic = "force-dynamic";

export default async function CrystalBallPage() {
  const { user, league } = await requireLeagueMember();
  const team = await prisma.fantasyTeam.findUnique({
    where: { leagueId_userId: { leagueId: league.id, userId: user.id } },
    include: {
      league: {
        include: {
          cbQuestions: { orderBy: { id: "asc" }, include: { answers: true } },
        },
      },
    },
  });
  if (!team) return <p>You are not a member of a fantasy league.</p>;

  const [rosterPlayers, matches, pickedChampions, draftedChampions] = await Promise.all([
    prisma.tournamentPlayer.findMany({
      where: { tournamentId: team.league.tournamentId },
      include: { player: true },
      orderBy: { player: { name: "asc" } },
    }),
    prisma.match.findMany({
      where: { tournamentId: team.league.tournamentId },
      select: { team1: true, team2: true },
    }),
    prisma.playerGameStat.findMany({
      where: { game: { match: { tournamentId: team.league.tournamentId } } },
      select: { champion: true },
      distinct: ["champion"],
    }),
    prisma.draftAction.findMany({
      where: { game: { match: { tournamentId: team.league.tournamentId } } },
      select: { champion: true },
      distinct: ["champion"],
    }),
  ]);
  const teamOptions = [...new Set(matches.flatMap((match) => [match.team1, match.team2]))].sort();
  const storedChampions = [...new Set([...pickedChampions, ...draftedChampions].map((row) => row.champion))].sort();
  const championOptions = await loadChampionOptions(storedChampions);
  const playerOptions = rosterPlayers.map((row) => ({
    value: row.playerId,
    label: row.player.name,
    team: row.teamId ?? row.player.teamId,
    role: row.role ?? row.player.role,
  }));
  const playerNames = new Map(playerOptions.map((player) => [player.value, player.label]));
  const locked = Boolean(team.league.crystalBallLockedAt) || team.league.seasonStatus !== "PRESEASON";
  const final = team.league.seasonStatus === "FINAL";
  const questions = team.league.cbQuestions.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    answerType: question.answerType,
    points: question.points,
    gradingMode: question.gradingMode,
    existing: question.answers.find((answer) => answer.userId === user.id)?.answer ?? "",
  }));

  return (
    <div className="crystal-page">
      <header className="section-heading crystal-heading">
        <div><h1>Crystal Ball</h1><p className="muted small">Twenty season-long predictions with podium scoring for champion and player questions.</p></div>
        <span className={`badge ${final ? "win" : locked ? "pending" : "win"}`}>{final ? "settled" : locked ? "locked for season" : "open in Week 0"}</span>
      </header>
      <div className="card crystal-rules">
        <b>Automatic grading</b>
        <span className="muted small">Questions 1–10 award 50 points for a first-place result, 30 for second, and 10 for any lower eligible rank. Ties share a rank. Questions 11–20 are worth 30 points with no partial credit; Questions 16 and 17 award it to every participant tied for closest.</span>
      </div>
      {!locked ? <CrystalBallForm
        key={team.league.id}
        leagueId={team.league.id}
        questions={questions}
        teams={teamOptions}
        players={playerOptions}
        champions={championOptions}
      /> : <div className="crystal-grid">
        {team.league.cbQuestions.map((question, index) => {
          const existing = questions[index].existing;
          const earned = final ? crystalBallPoints(question, user.id) : null;
          const resolution = parseResolutionEvidence(question.resolutionData);
          const podium = question.gradingMode === "RANKED" ? resolution?.ranking?.slice(0, 3) ?? [] : [];
          const resolved = question.gradingMode === "CLOSEST"
            ? question.correctAnswer ? [question.correctAnswer] : []
            : question.resolvedAnswers ? JSON.parse(question.resolvedAnswers) as string[] : [];
          return <section className="card crystal-question" key={question.id}>
            <div className="crystal-question-title"><span>{index + 1}</span><div><h2>{question.prompt}</h2><p>{questionScoreLabel(question)}</p></div></div>
            {locked ? <div className="crystal-answer-block">
              <span>Your prediction</span>
              <AnswerValue value={existing} answerType={question.answerType} playerNames={playerNames} empty="No answer submitted" />
            </div> : null}
            {final && <div className="crystal-result">
              <span>{question.gradingMode === "RANKED" ? "Final podium" : question.gradingMode === "CLOSEST" ? "Actual total" : resolved.length > 1 ? "Accepted results" : "Result"}</span>
              {podium.length > 0 ? <div className="crystal-final-podium">{podium.map((tier) => <div key={tier.rank}>
                <small>{tier.rank === 1 ? "1st · 50" : tier.rank === 2 ? "2nd · 30" : "3rd · 10"}</small>
                <span>{tier.answers.map((answer) => <AnswerValue key={answer} value={answer} answerType={question.answerType} playerNames={playerNames} />)}</span>
              </div>)}</div> : <div className="crystal-resolved-values">{resolved.map((answer) => <AnswerValue key={answer} value={answer} answerType={question.answerType} playerNames={playerNames} />)}</div>}
              <b className={earned && earned > 0 ? "win-text" : "loss-text"}>{earned && earned > 0 ? `+${earned} points` : "0 points"}</b>
            </div>}
          </section>;
        })}
      </div>}
    </div>
  );
}

function questionScoreLabel(question: { gradingMode: string; points: number }) {
  if (question.gradingMode === "RANKED") return "50 points for 1st · 30 for 2nd · 10 for lower ranks";
  if (question.gradingMode === "CLOSEST") return `${question.points} points · closest prediction wins`;
  return `${question.points} points · all or nothing`;
}

async function loadChampionOptions(fallback: string[]) {
  try {
    const response = await fetch("https://ddragon.leagueoflegends.com/cdn/16.14.1/data/en_US/champion.json", {
      next: { revalidate: 86_400 },
    });
    if (!response.ok) return fallback;
    const payload = await response.json() as { data?: Record<string, { name: string }> };
    const champions = Object.values(payload.data ?? {}).map((champion) => champion.name).sort();
    return champions.length ? champions : fallback;
  } catch {
    return fallback;
  }
}

function AnswerValue({ value, answerType, playerNames, empty = "—" }: { value: string; answerType: string; playerNames: Map<string, string>; empty?: string }) {
  if (!value) return <b className="muted">{empty}</b>;
  if (answerType === "team") return <TeamLabel name={value} size="sm" />;
  if (answerType === "champion") return <ChampionLabel name={value} size="sm" />;
  return <b>{answerType === "player" ? playerNames.get(value) ?? value : value}</b>;
}
