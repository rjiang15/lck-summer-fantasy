import { requireLeagueMember } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveCrystalBall } from "./actions";

export const dynamic = "force-dynamic";

export default async function CrystalBallPage() {
  const { user, league } = await requireLeagueMember();
  const team = await prisma.fantasyTeam.findUnique({
    where: { leagueId_userId: { leagueId: league.id, userId: user.id } },
    include: {
      league: {
        include: {
          cbQuestions: { orderBy: { id: "asc" }, include: { answers: { where: { userId: user.id } } } },
        },
      },
    },
  });
  if (!team) return <p>You are not a member of a fantasy league.</p>;
  const locked = Boolean(team.league.crystalBallLockedAt) || team.league.seasonStatus !== "PRESEASON";
  return (
    <>
      <h1>Crystal Ball</h1>
      <p className="muted small">
        These predictions lock once, for the entire season, when Week 1 is locked.
        {locked && " Answers are now locked."}
      </p>
      <div className="grid2">
        {team.league.cbQuestions.map((question) => {
          const existing = question.answers[0]?.answer ?? "";
          return (
            <section className="card" key={question.id}>
              <h2 style={{ marginTop: 0 }}>{question.prompt}</h2>
              <p className="muted small">{question.points} points · {question.answerType.replaceAll("_", " ")}</p>
              {locked ? <p><b>{existing || "No answer submitted"}</b></p> : (
                <form action={saveCrystalBall} className="inline-form">
                  <input type="hidden" name="questionId" value={question.id} />
                  <input name="answer" defaultValue={existing} maxLength={120} required />
                  <button type="submit">Save</button>
                  {existing && <span className="badge win">saved</span>}
                </form>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
