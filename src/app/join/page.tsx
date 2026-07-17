import Link from "next/link";
import { joinLeague } from "./actions";
import { getCurrentUser } from "@/lib/auth";

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const user = await getCurrentUser();
  return <>
    <h1>Join a fantasy league</h1>
    {error && <p className="error">{error}</p>}
    <form action={joinLeague} className="card stack" style={{ maxWidth: 480 }}>
      <label>Invite code <input name="inviteCode" required /></label>
      <label>Fantasy team name <input name="teamName" minLength={2} maxLength={40} required /></label>
      {!user && <><label>Username <input name="username" minLength={3} maxLength={24} required autoComplete="username" /></label>
      <label>Password <input name="password" type="password" minLength={10} required autoComplete="new-password" /></label></>}
      <button type="submit">Join league</button>
      <span className="muted small">{user ? `Joining as ${user.username}.` : <>Already registered? <Link href="/login">Sign in first</Link> to add this league to your account.</>}</span>
    </form>
  </>;
}
