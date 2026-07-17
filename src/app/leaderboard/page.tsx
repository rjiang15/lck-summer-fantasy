// Leaderboard: participant standings and the running Crystal Ball answer key.
import Link from "next/link";
import { ChampionLabel, TeamLabel } from "@/components/GameIdentity";
import { prisma } from "@/lib/db";
import { computeStandings } from "@/lib/fantasy";
import { crystalBallPredictionsPublic, loadCrystalBallSnapshot, resolveCrystalBallMetric, type MetricResolution } from "@/lib/crystal-ball";
import { getViewState } from "@/lib/view";

export const dynamic = "force-dynamic";

type Participant = {
  userId: number;
  username: string;
  teamName: string;
  rank: number;
};

export default async function LeaderboardPage() {
  const view = await getViewState();
  if (!view) return <p>No data ingested yet.</p>;

  const [result, league, snapshot, rosterPlayers] = await Promise.all([
    computeStandings(view.cutoff, view.leagueId),
    prisma.league.findUnique({
      where: { id: view.leagueId },
      include: {
        fantasyTeams: { include: { user: true }, orderBy: { id: "asc" } },
        cbQuestions: { include: { answers: true }, orderBy: { id: "asc" } },
      },
    }),
    loadCrystalBallSnapshot(view.tournamentId, view.cutoff),
    prisma.tournamentPlayer.findMany({
      where: { tournamentId: view.tournamentId },
      include: { player: true },
    }),
  ]);
  if (!league) return <p>Fantasy league not found.</p>;

  const ranks = new Map(result?.standings.map((standing, index) => [standing.fantasyTeamId, index + 1]) ?? []);
  const participants: Participant[] = league.fantasyTeams.map((team) => ({
    userId: team.userId,
    username: team.user.username,
    teamName: team.name,
    rank: ranks.get(team.id) ?? Number.MAX_SAFE_INTEGER,
  })).sort((left, right) => left.rank - right.rank || left.username.localeCompare(right.username));
  const playerNames = new Map(rosterPlayers.map((row) => [row.playerId, row.player.name]));
  const revealPredictions = crystalBallPredictionsPublic(league);
  const answerKey = league.cbQuestions.filter((question) => question.metricKey).map((question, index) => {
    let resolution: MetricResolution | null = null;
    try {
      const config = question.resolverConfig ? JSON.parse(question.resolverConfig) as Record<string, string | number> : {};
      resolution = resolveCrystalBallMetric(question.metricKey!, snapshot, config);
    } catch {
      resolution = null;
    }
    return { ...question, number: index + 1, resolution };
  });

  return <div className="leaderboard-page">
    <header className="section-heading">
      <div><h1>Leaderboard</h1><p className="muted small">Fantasy standings and everyone&apos;s season-long Crystal Ball calls.</p></div>
    </header>

    {view.completedWeek !== null && <p className="muted small">
      Fantasy totals include commissioner-published weeks only. Detailed pro-player scoring and performance metrics are available under Deep Stats.
    </p>}

    {result && <section>
      <h2>Fantasy standings</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>#</th><th>Participant</th><th>Team name</th><th className="num">Roster</th><th className="num">Pickems</th><th className="num">Crystal Ball</th><th className="num">Total</th></tr></thead>
          <tbody>{result.standings.map((standing, index) => <tr key={standing.fantasyTeamId}>
            <td>{index + 1}</td>
            <td><Link href={`/participants/${standing.fantasyTeamId}`}>{standing.username}</Link></td>
            <td>{standing.teamName}</td>
            <td className="num">{standing.rosterTotal}</td>
            <td className="num">{standing.pickemTotal}</td>
            <td className="num">{standing.crystalBallTotal}</td>
            <td className="num"><b>{standing.total}</b></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>}

    <section className="leaderboard-crystal-section">
      <div className="macro-section-title">
        <div><span>Crystal Ball</span><h2>Running answer key</h2></div>
        <p>If the season ended at the selected cutoff, these are the answers the automatic grader would use.</p>
      </div>
      {!revealPredictions && <div className="card crystal-privacy-note"><b>Predictions are still private</b><span className="muted small">Participant choices will appear under every question after the commissioner locks Crystal Ball for the season.</span></div>}
      <div className="macro-record-grid leaderboard-answer-grid">
        {answerKey.map((question) => <AnswerKeyCard
          key={question.id}
          number={question.number}
          prompt={question.prompt}
          answerType={question.answerType}
          resolution={question.resolution}
          answers={question.answers}
          participants={participants}
          playerNames={playerNames}
          revealPredictions={revealPredictions}
        />)}
      </div>
    </section>
  </div>;
}

function AnswerKeyCard({
  number,
  prompt,
  answerType,
  resolution,
  answers,
  participants,
  playerNames,
  revealPredictions,
}: {
  number: number;
  prompt: string;
  answerType: string;
  resolution: MetricResolution | null;
  answers: Array<{ userId: number; answer: string }>;
  participants: Participant[];
  playerNames: Map<string, string>;
  revealPredictions: boolean;
}) {
  const currentAnswers = resolution
    ? resolution.target === undefined ? resolution.acceptedAnswers : [String(resolution.target)]
    : [];
  const predictions = new Map(answers.map((answer) => [answer.userId, answer.answer]));
  const submitted = participants.filter((participant) => predictions.has(participant.userId)).length;

  return <article className={`macro-record macro-answer-card leaderboard-answer-card${resolution ? "" : " pending"}`}>
    <span>Question {number}</span>
    <h3>{prompt}</h3>
    <div className="macro-answer-values">
      {currentAnswers.length === 0 ? <strong>Not enough data yet</strong> : currentAnswers.map((answer) => <PredictionValue answer={answer} answerType={answerType} playerNames={playerNames} size="md" key={answer} />)}
    </div>
    <small>{resolution?.evidence ?? "This metric cannot be determined from the completed games yet."}</small>
    {revealPredictions ? <div className="crystal-participant-picks">
      <div className="crystal-participant-heading"><b>Participant predictions</b><span>{submitted}/{participants.length} submitted</span></div>
      {participants.map((participant) => {
        const prediction = predictions.get(participant.userId);
        return <div className="crystal-participant-pick" key={participant.userId}>
          <span><b>{participant.username}</b><small>{participant.teamName}</small></span>
          <span className={prediction ? "" : "muted"}>{prediction ? <PredictionValue answer={prediction} answerType={answerType} playerNames={playerNames} size="xs" /> : "No prediction"}</span>
        </div>;
      })}
    </div> : <div className="crystal-private-progress"><b>{submitted}/{participants.length}</b><span>participants submitted · choices hidden until lock</span></div>}
  </article>;
}

function PredictionValue({
  answer,
  answerType,
  playerNames,
  size,
}: {
  answer: string;
  answerType: string;
  playerNames: Map<string, string>;
  size: "xs" | "md";
}) {
  if (answerType === "champion") return <ChampionLabel name={answer} size={size} />;
  if (answerType === "team") return <TeamLabel name={answer} size={size} />;
  return <b>{answerType === "player" ? playerNames.get(answer) ?? answer : answer}</b>;
}
