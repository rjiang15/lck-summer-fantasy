import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createLeague } from "../actions";

export default async function NewLeaguePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser();
  const { error } = await searchParams;
  const tournaments = await prisma.tournament.findMany({
    where: { hidden: false },
    orderBy: [{ seasonOrder: "desc" }, { dateStart: "desc" }, { name: "asc" }],
  });
  const current = tournaments.filter((tournament) => tournament.catalogStatus === "CURRENT");
  const past = tournaments.filter((tournament) => tournament.catalogStatus !== "CURRENT");
  return <>
    <h1>Create a league</h1>
    <p className="muted">You become the owner. The chosen season permanently defines this league&apos;s draft, picks, scoring, and Crystal Ball. A current-season league can also browse every imported older season as read-only research.</p>
    {error && <p className="error card">{error}</p>}
    <form action={createLeague} className="card stack" style={{ maxWidth: 620 }}>
      <label>League name <input name="name" minLength={3} maxLength={60} required placeholder="Friday Night LCK" /></label>
      <label>LCK season <select name="tournamentId" required>
        {current.length > 0 && <optgroup label="Current season">{current.map((tournament) => <option value={tournament.id} key={tournament.id}>{tournament.name}</option>)}</optgroup>}
        {past.length > 0 && <optgroup label="Past seasons (simulation / archive)">{past.map((tournament) => <option value={tournament.id} key={tournament.id}>{tournament.name}</option>)}</optgroup>}
      </select></label>
      <p className="muted small" style={{ margin: 0 }}>Season visibility only runs backward: this league can study older data, but a league created for an older season can never reveal a newer season.</p>
      <label>Your fantasy team name <input name="teamName" minLength={2} maxLength={40} placeholder="Optional if you only commission" /></label>
      <label className="inline-form"><input name="isSimulation" type="checkbox" /> Test / historical simulation league</label>
      <p className="muted small" style={{ margin: 0 }}>A simulation requires a fully stored season. Its complete schedule and draft pool load immediately, while results remain hidden and are revealed one locked week at a time without contacting the API.</p>
      <button type="submit">Create league</button>
    </form>
  </>;
}
