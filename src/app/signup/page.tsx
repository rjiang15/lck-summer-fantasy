import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { signup } from "./actions";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect("/leagues");
  const { error } = await searchParams;
  return <>
    <h1>Create your account</h1>
    <p className="muted">One account can join, own, or commission any number of fantasy leagues.</p>
    {error && <p className="error card">{error}</p>}
    <form action={signup} className="card stack" style={{ maxWidth: 480 }}>
      <label>Username <input name="username" minLength={3} maxLength={24} required autoComplete="username" /></label>
      <label>Password <input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
      <label>Confirm password <input name="confirm" type="password" minLength={10} required autoComplete="new-password" /></label>
      <button type="submit">Create account</button>
      <span className="muted small">Already registered? <Link href="/login">Sign in</Link>.</span>
    </form>
  </>;
}
