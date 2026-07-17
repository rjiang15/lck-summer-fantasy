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
        <header className="site-header">
          <div className="topnav">
            <Link href="/" className="brand">LCK Fantasy</Link>
            <div className="topnav-tools">
              {view && (
                <ViewControls
                  tournaments={tournaments}
                  tournamentId={view.tournamentId}
                  completedWeek={view.completedWeek}
                  maxWeek={view.maxWeek}
                  isLive={view.isLive}
                />
              )}
              {user ? (
                <form action={logout} className="nav-auth">
                  <span className="muted small">{user.username}</span>
                  <button type="submit">Log out</button>
                </form>
              ) : <Link href="/login" className="nav-signin">Sign in</Link>}
            </div>
          </div>
          <nav className="nav-sections" aria-label="Primary navigation">
            <NavGroup label="Game data">
              <Link href="/">Games</Link>
              <Link href="/stats">Deep Stats</Link>
            </NavGroup>
            <NavGroup label="League">
              <Link href="/leaderboard">Leaderboard</Link>
              <Link href="/participants">Participants</Link>
              <Link href="/history">Weekly History</Link>
            </NavGroup>
            <NavGroup label="My league">
              <Link href="/picks">Picks</Link>
              <Link href="/crystal-ball">Crystal Ball</Link>
              {user?.isCommish && <Link href="/commissioner">Commissioner</Link>}
              {user?.isCommish && <Link href="/settings">Settings</Link>}
            </NavGroup>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="nav-group">
      <span className="nav-group-label">{label}</span>
      <div className="nav-group-links">{children}</div>
    </div>
  );
}
