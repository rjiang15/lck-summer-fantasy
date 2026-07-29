// Leaderboard: participant standings and the running Crystal Ball answer key.
import Link from "next/link";
import { ChampionLabel, TeamLabel, TeamLogo } from "@/components/GameIdentity";
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

type PlayerIdentity = {
  name: string;
  team: string | null;
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
  const playerIdentities = new Map<string, PlayerIdentity>(rosterPlayers.map((row) => [row.playerId, {
    name: row.player.name,
    team: row.teamId ?? row.player.teamId,
  }]));
  const revealPredictions = crystalBallPredictionsPublic(league);
  const hasProvisional = result?.standings.some((standing) => standing.hasProvisional) ?? false;
  const substitutePlayerIds = [...new Set(
    result?.standings.flatMap((standing) =>
      standing.weekly.flatMap((week) =>
        week.roster.flatMap((row) => row.fallback?.substitutePlayerIds ?? []),
      ),
    ) ?? [],
  )];
  const substituteNames = substitutePlayerIds.map(
    (playerId) => playerIdentities.get(playerId)?.name ?? playerId,
  );
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

    {hasProvisional ? <div className="card live-data-note">
      <b>Live standings · provisional</b>
      <span className="muted small">Totals include completed games from Week {result?.standings.find((standing) => standing.provisionalWeek)?.provisionalWeek}. They update after each refresh and become official only when the commissioner validates and publishes the week. Crystal Ball points remain unawarded.</span>
    </div> : view.completedWeek !== null && <p className="muted small">
      Fantasy totals include commissioner-published weeks only. Detailed pro-player scoring and performance metrics are available under Deep Stats.
    </p>}
    {substituteNames.length > 0 && <div className="card substitute-rule-note">
      <b>Substitute scoring active · {substituteNames.join(", ")}</b>
      <span className="muted small">For each affected roster slot, the credited Pts/G is the lower of that professional team&apos;s weekly player average and the same-team, same-role substitute&apos;s performance. Open a participant roster for the exact calculation.</span>
    </div>}

    {result && <section>
      <h2>Fantasy standings {hasProvisional && <span className="badge win">live</span>}</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>#</th><th>Participant</th><th>Team name</th><th className="num">Roster</th><th className="num">Pickems</th><th className="num">Crystal Ball</th><th className="num">Total</th></tr></thead>
          <tbody>{result.standings.map((standing, index) => <tr key={standing.fantasyTeamId}>
            <td>{index + 1}</td>
            <td>{standing.username}</td>
            <td><Link href={`/participants/${standing.fantasyTeamId}`}>{standing.teamName}</Link></td>
            <td className="num">{standing.rosterTotal}</td>
            <td className="num">{standing.pickemTotal}</td>
            <td className="num">{league.seasonStatus === "FINAL" ? standing.crystalBallTotal : <span className="muted" title="Not awarded until season settlement">—</span>}</td>
            <td className="num"><b>{standing.total}</b></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>}

    <section className="leaderboard-crystal-section">
      <div className="macro-section-title">
        <div><span>Crystal Ball</span><h2>Running answer key</h2></div>
        <p>Preview from completed games only. It updates live but is not stored as the final answer key or awarded as points.</p>
      </div>
      {!revealPredictions && <div className="card crystal-privacy-note"><b>Predictions are still private</b><span className="muted small">Participant choices will appear under every question after the commissioner locks Crystal Ball for the season.</span></div>}
      <div className="macro-record-grid leaderboard-answer-grid">
        {answerKey.map((question) => <AnswerKeyCard
          key={question.id}
          number={question.number}
          prompt={question.prompt}
          answerType={question.answerType}
          gradingMode={question.gradingMode}
          resolution={question.resolution}
          answers={question.answers}
          participants={participants}
          playerIdentities={playerIdentities}
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
  gradingMode,
  resolution,
  answers,
  participants,
  playerIdentities,
  revealPredictions,
}: {
  number: number;
  prompt: string;
  answerType: string;
  gradingMode: string;
  resolution: MetricResolution | null;
  answers: Array<{ userId: number; answer: string }>;
  participants: Participant[];
  playerIdentities: Map<string, PlayerIdentity>;
  revealPredictions: boolean;
}) {
  const currentAnswers = resolution
    ? resolution.target === undefined ? resolution.acceptedAnswers : [String(resolution.target)]
    : [];
  const predictions = new Map(answers.map((answer) => [answer.userId, answer.answer]));
  const submitted = participants.filter((participant) => predictions.has(participant.userId)).length;
  const podium = gradingMode === "RANKED" ? resolution?.ranking?.slice(0, 3) ?? [] : [];

  return <article className={`macro-record macro-answer-card leaderboard-answer-card${resolution ? "" : " pending"}`}>
    <span>Question {number} · {gradingMode === "RANKED" ? "50 / 30 / 10" : "30 pts"}</span>
    <h3>{prompt}</h3>
    {podium.length > 0 ? <div className="crystal-podium">
      {podium.map((tier) => <div className={`crystal-podium-tier place-${tier.rank}`} key={tier.rank}>
        <span><b>{ordinal(tier.rank)}</b><small>{tier.rank === 1 ? "50 pts" : tier.rank === 2 ? "30 pts" : "10 pts"}</small></span>
        <div className={`crystal-podium-values${answerType === "player" ? " player-values" : ""}`}>{tier.answers.map((answer) => <PredictionValue answer={answer} answerType={answerType} playerIdentities={playerIdentities} size="xs" key={answer} />)}</div>
      </div>)}
    </div> : <div className="macro-answer-values">
      {currentAnswers.length === 0 ? <strong>Not enough data yet</strong> : currentAnswers.map((answer) => <PredictionValue answer={answer} answerType={answerType} playerIdentities={playerIdentities} size="md" key={answer} />)}
    </div>}
    <small>{resolution?.evidence ?? "This metric cannot be determined from the completed games yet."}</small>
    {revealPredictions ? <div className="crystal-participant-picks">
      <div className="crystal-participant-heading"><b>Participant predictions</b><span>{submitted}/{participants.length} submitted</span></div>
      {participants.map((participant) => {
        const prediction = predictions.get(participant.userId);
        return <div className="crystal-participant-pick" key={participant.userId}>
          <span><b>{participant.username}</b><small>{participant.teamName}</small></span>
          <span className={prediction ? "" : "muted"}>{prediction ? <PredictionValue answer={prediction} answerType={answerType} playerIdentities={playerIdentities} size="xs" /> : "No prediction"}</span>
        </div>;
      })}
    </div> : <div className="crystal-private-progress"><b>{submitted}/{participants.length}</b><span>participants submitted · choices hidden until lock</span></div>}
  </article>;
}

function ordinal(rank: number) {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  return `${rank}rd`;
}

function PredictionValue({
  answer,
  answerType,
  playerIdentities,
  size,
}: {
  answer: string;
  answerType: string;
  playerIdentities: Map<string, PlayerIdentity>;
  size: "xs" | "md";
}) {
  if (answerType === "champion") return <ChampionLabel name={answer} size={size} />;
  if (answerType === "team") return <TeamLabel name={answer} size={size} />;
  if (answerType === "player") {
    const player = playerIdentities.get(answer);
    const fullName = player?.name ?? answer;
    const handle = fullName.replace(/\s*\([^)]*\)\s*$/, "");
    return <span className="crystal-player-value" title={fullName}>
      {player?.team && <TeamLogo name={player.team} size="xs" />}
      <b>{handle}</b>
    </span>;
  }
  return <b>{answer}</b>;
}
