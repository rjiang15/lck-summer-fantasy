import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { login } from "./actions";
import Link from "next/link";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getCurrentUser()) redirect("/leagues");
  const { error } = await searchParams;
  return (
    <>
      <h1>Sign in</h1>
      <p className="muted small">New here? <Link href="/signup">Create an account</Link>, then create a league or join with an invite code.</p>
      {error && <p className="error">{error}</p>}
      <div className="card-grid">
        <section className="card" style={{ maxWidth: 480 }}>
          <h2>Existing account</h2>
          <form action={login} className="stack">
            <label>Username <input name="username" required autoComplete="username" /></label>
            <label>Password <input name="password" type="password" required autoComplete="current-password" /></label>
            <button type="submit">Sign in</button>
          </form>
        </section>
      </div>
    </>
  );
}
