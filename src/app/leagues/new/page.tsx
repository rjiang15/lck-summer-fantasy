import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createLeague } from "../actions";

export default async function NewLeaguePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser();
  const { error } = await searchParams;
  const tournaments = await prisma.tournament.findMany({ where: { hidden: false }, orderBy: [{ dateStart: "desc" }, { name: "asc" }] });
  return <>
    <h1>Create a league</h1>
    <p className="muted">You become the owner. Commissioners, participants, picks, rosters, scoring, and week progress stay isolated to this league.</p>
    {error && <p className="error card">{error}</p>}
    <form action={createLeague} className="card stack" style={{ maxWidth: 620 }}>
      <label>League name <input name="name" minLength={3} maxLength={60} required placeholder="Friday Night LCK" /></label>
      <label>LCK tournament <select name="tournamentId" required>{tournaments.map((t) => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label>
      <label>Your fantasy team name <input name="teamName" minLength={2} maxLength={40} placeholder="Optional if you only commission" /></label>
      <label className="inline-form"><input name="isSimulation" type="checkbox" /> Test / simulation league</label>
      <button type="submit">Create league</button>
    </form>
  </>;
}
