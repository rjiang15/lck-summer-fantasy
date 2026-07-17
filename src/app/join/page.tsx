import Link from "next/link";
import { joinLeague } from "./actions";

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <>
    <h1>Join a fantasy league</h1>
    {error && <p className="error">{error}</p>}
    <form action={joinLeague} className="card stack" style={{ maxWidth: 480 }}>
      <label>Invite code <input name="inviteCode" required /></label>
      <label>Username <input name="username" minLength={3} maxLength={24} required autoComplete="username" /></label>
      <label>Fantasy team name <input name="teamName" minLength={2} maxLength={40} required /></label>
      <label>Password <input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
      <button type="submit">Join league</button>
      <span className="muted small">Already joined? <Link href="/login">Sign in</Link>.</span>
    </form>
  </>;
}
