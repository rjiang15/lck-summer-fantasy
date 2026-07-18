import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import ViewControls from "@/components/ViewControls";
import LeagueSwitcher from "@/components/LeagueSwitcher";
import { getDataViewState, listResearchTournaments } from "@/lib/view";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { prisma } from "@/lib/db";
import { isManagerRole } from "@/lib/leagues";

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
  const view = await getDataViewState();
  const user = await getCurrentUser();
  const memberships = user ? await prisma.leagueMembership.findMany({
    where: { userId: user.id }, include: { league: true }, orderBy: { joinedAt: "asc" },
  }) : [];
  const activeMembership = view ? memberships.find((row) => row.leagueId === view.leagueId) : undefined;
  const researchTournaments = view ? await listResearchTournaments(view.leagueTournamentId) : [];
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="topnav">
            <Link href="/" className="brand">LCK Fantasy</Link>
            <div className="topnav-tools">
              {user && <LeagueSwitcher leagues={memberships.map((row) => ({ slug: row.league.slug, name: row.league.name }))} activeSlug={view?.leagueSlug} />}
              {view && (
                <ViewControls
                  leagueId={view.leagueId}
                  completedWeek={view.completedWeek}
                  maxWeek={view.maxWeek}
                  isLive={view.isLive}
                  isSimulation={view.isSimulation}
                  isResearch={view.isResearch}
                  selectedTournamentId={view.tournamentId}
                  leagueTournamentId={view.leagueTournamentId}
                  tournaments={researchTournaments.map((tournament) => ({
                    id: tournament.id,
                    name: tournament.name,
                    status: tournament.catalogStatus,
                  }))}
                />
              )}
              {user ? (<>
                <Link href="/leagues" className="nav-signin">My leagues</Link>
                <form action={logout} className="nav-auth">
                  <span className="muted small">{user.username}</span>
                  <button type="submit">Log out</button>
                </form></>
              ) : <Link href="/login" className="nav-signin">Sign in</Link>}
            </div>
          </div>
          {view && <nav className="nav-sections" aria-label="Primary navigation">
            <NavGroup label="Game data">
              <Link href="/">Games</Link>
              <Link href="/macro">Macro Dashboard</Link>
              <Link href="/stats">Deep Stats</Link>
            </NavGroup>
            <NavGroup label="League">
              <Link href="/leaderboard">Leaderboard</Link>
              <Link href="/history">Weekly History</Link>
            </NavGroup>
            <NavGroup label="My league">
              <Link href="/picks">Picks</Link>
              <Link href="/crystal-ball">Crystal Ball</Link>
              {activeMembership && isManagerRole(activeMembership.role) && activeMembership.league.currentWeek === 0 && activeMembership.league.seasonStatus === "PRESEASON" && <Link href="/commissioner/draft">Draft</Link>}
              {activeMembership && isManagerRole(activeMembership.role) && <Link href="/commissioner">Commissioner</Link>}
              {activeMembership && isManagerRole(activeMembership.role) && <Link href="/settings">Settings</Link>}
            </NavGroup>
          </nav>}
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
