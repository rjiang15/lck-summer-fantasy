import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { claimAccount, login } from "./actions";
import Link from "next/link";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getCurrentUser()) redirect("/");
  const { error } = await searchParams;
  return (
    <>
      <h1>Sign in</h1>
      <p className="muted small">New participant? <Link href="/join">Join with an invite code</Link>.</p>
      {error && <p className="error">{error}</p>}
      <div className="card-grid">
        <section className="card">
          <h2>Existing account</h2>
          <form action={login} className="stack">
            <label>Username <input name="username" required autoComplete="username" /></label>
            <label>Password <input name="password" type="password" required autoComplete="current-password" /></label>
            <button type="submit">Sign in</button>
          </form>
        </section>
        <section className="card">
          <h2>Claim a seeded account</h2>
          <p className="muted small">Use this once to set the password for an account created by the commissioner.</p>
          <form action={claimAccount} className="stack">
            <label>Username <input name="username" required autoComplete="username" /></label>
            <label>New password <input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
            <label>Confirm password <input name="confirm" type="password" minLength={10} required autoComplete="new-password" /></label>
            <button type="submit">Claim account</button>
          </form>
        </section>
      </div>
    </>
  );
}
