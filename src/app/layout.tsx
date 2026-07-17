import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import ViewControls from "@/components/ViewControls";
import { getViewState, listTournaments } from "@/lib/view";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/app/login/actions";

export const metadata: Metadata = {
  title: "LCK Fantasy",
  description: "Fantasy league for the LCK — rosters, pickems, crystal ball",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const view = await getViewState();
  const tournaments = await listTournaments();
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body>
        <nav className="topnav">
          <span className="brand">LCK Fantasy</span>
          <Link href="/">Games</Link>
          <Link href="/leaderboard">Leaderboard</Link>
          <Link href="/stats">Deep Stats</Link>
          <Link href="/participants">Participants</Link>
          <Link href="/history">Weekly History</Link>
          <Link href="/picks">Picks</Link>
          <Link href="/crystal-ball">Crystal Ball</Link>
          {user?.isCommish && <Link href="/commissioner">Commissioner</Link>}
          {user?.isCommish && <Link href="/settings">Settings</Link>}
          {user ? (
            <form action={logout} className="nav-auth">
              <span className="muted small">{user.username}</span>
              <button type="submit">Log out</button>
            </form>
          ) : <Link href="/login">Sign in</Link>}
          {view && (
            <ViewControls
              tournaments={tournaments}
              tournamentId={view.tournamentId}
              completedWeek={view.completedWeek}
              maxWeek={view.maxWeek}
              isLive={view.isLive}
            />
          )}
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
