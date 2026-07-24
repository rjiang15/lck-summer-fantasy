import Link from "next/link";
import { requireLeagueManager } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DRAFT_ROLES, draftFormatForTournament, draftGroupForTeam, maximumDraftRosterCost, minimumSafeOpeningBudget, roundDraftBudget, snakeTeamId, totalDraftPicks, type DraftCompositionPlayer } from "@/lib/draft";
import { buildDraftPriceSheet, DYNAMIC_PRICE_MAX, DYNAMIC_PRICE_MIN, parseDraftPriceSheet, playerDraftPrice } from "@/lib/draft-pricing";
import { parseScoring } from "@/lib/fantasy";
import { TeamLabel } from "@/components/GameIdentity";
import DraftBoard from "./DraftBoard";
import { resetDraft, startDraft } from "./actions";

export const dynamic = "force-dynamic";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

export default async function DraftPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const access = await requireLeagueManager();
  const feedback = await searchParams;
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: access.league.id },
    include: {
      fantasyTeams: { orderBy: { id: "asc" }, include: { user: true, draftPicks: { orderBy: { overallPick: "asc" }, include: { player: { include: { tournamentRosters: { where: { tournamentId: access.league.tournamentId } } } } } } } },
    },
  });
  if (league.currentWeek !== 0 || league.seasonStatus !== "PRESEASON") return <><p><Link href="/commissioner">← Commissioner</Link></p><h1>Initial roster draft</h1><p className="card">The initial draft is available only during Week 0, before Week 1 is locked.</p></>;

  const format = draftFormatForTournament(league.tournamentId);
  const order = league.draftOrder ? JSON.parse(league.draftOrder) as number[] : league.fantasyTeams.map((team) => team.id);
  const draftedIds = new Set(league.fantasyTeams.flatMap((team) => team.draftPicks.map((pick) => pick.playerId)));
  const tournamentRoster = await prisma.tournamentPlayer.findMany({
    where: { tournamentId: league.tournamentId, role: { in: [...DRAFT_ROLES] } },
    include: { player: true }, orderBy: [{ role: "asc" }, { player: { name: "asc" } }],
  });
  const eligible = tournamentRoster.filter((row) => !draftedIds.has(row.playerId));
  const frozenSheet = parseDraftPriceSheet(league.draftPriceSheet);
  let previewSheet = frozenSheet;
  let previewError: string | null = null;
  if (league.draftStatus === "NOT_STARTED" && format) {
    try {
      previewSheet = await buildDraftPriceSheet(league.tournamentId, parseScoring(league.scoringConfig));
    } catch (error) {
      previewError = error instanceof Error ? error.message : "Dynamic pricing preview failed";
    }
  }
  const teams = league.fantasyTeams.map((team) => ({
    id: team.id, name: team.name, username: team.user.username,
    picks: team.draftPicks.map((pick) => {
      const proTeam = pick.player.tournamentRosters[0]?.teamId ?? null;
      return { id: pick.id, playerId: pick.playerId, playerName: pick.player.name, proTeam, role: pick.role, group: draftGroupForTeam(format, proTeam), price: pick.price, overallPick: pick.overallPick };
    }),
  }));
  const totalPicks = totalDraftPicks(teams.length, league.draftPlayersPerRole);
  const currentTeamId = league.draftStatus === "ACTIVE" ? snakeTeamId(order, league.draftCurrentPick) : null;
  const groupKeys = format?.groups.map((group) => group.key) ?? [];
  const previewPool = format && previewSheet ? eligible.flatMap((row): DraftCompositionPlayer[] => {
    const role = row.role ?? row.player.role;
    const group = draftGroupForTeam(format, row.teamId ?? row.player.teamId);
    const value = previewSheet.players[row.playerId];
    if (!role || !DRAFT_ROLES.includes(role as (typeof DRAFT_ROLES)[number]) || !group || !value) return [];
    return [{ playerId: row.playerId, role: role as (typeof DRAFT_ROLES)[number], group, price: value.price }];
  }) : [];
  const rawPreviewBudget = format && previewSheet
    ? minimumSafeOpeningBudget(teams.length, previewPool, league.draftPlayersPerRole, groupKeys)
    : null;
  const dynamicPreviewBudget = rawPreviewBudget === null ? null : roundDraftBudget(rawPreviewBudget);
  const maximumPreviewRoster = format && previewSheet
    ? maximumDraftRosterCost(previewPool, league.draftPlayersPerRole, groupKeys)
    : null;

  return <>
    <p className="small"><Link href="/commissioner">← Commissioner</Link></p>
    <div className="section-heading"><div><h1>Week 0 roster draft</h1><p className="muted">Commissioner-only controls for drafting every participant&apos;s initial roster.</p></div><span className="badge pending">{league.draftStatus.replaceAll("_", " ")}</span></div>
    {feedback.notice && <p className="notice card">{feedback.notice}</p>}
    {feedback.error && <p className="error card">{feedback.error}</p>}

    {format && <section className="card draft-format-card">
      <div><span className="draft-kicker">R3–4 format</span><h2>One Legends roster + one Rise roster</h2><p className="muted small">Every fantasy team must draft exactly one player from each group at Top, Jungle, Mid, Bot, and Support.</p></div>
      <div className="draft-group-overview">{format.groups.map((group) => <div className={`draft-group-panel draft-group-${group.key.toLowerCase()}`} key={group.key}>
        <b>{group.label}</b><div>{group.teams.map((team) => <TeamLabel name={team} size="xs" key={team} />)}</div>
      </div>)}</div>
    </section>}

    {league.draftStatus === "NOT_STARTED" ? <section className="card stack">
      <div><h2 style={{ marginTop: 0 }}>Set the draft order and pricing</h2><p className="muted small">Choose each participant exactly once. The order, pricing mode, and calculated price sheet lock when the draft starts. Starting also clears manually assigned preseason roster slots.</p></div>
      <form action={startDraft} className="stack" style={{ maxWidth: 720 }}><input type="hidden" name="leagueId" value={league.id} />
        <fieldset className="draft-pricing-choices"><legend>Player pricing</legend>
          <label><input type="radio" name="draftPricingMode" value="UNIFORM" defaultChecked /><span><b>Uniform pricing</b><small>Every player costs {money(league.draftPlayerPrice)}.</small></span></label>
          <label><input type="radio" name="draftPricingMode" value="DYNAMIC" disabled={!format || !previewSheet} /><span><b>Dynamic R1–2 pricing</b><small>R1–2 fantasy Pts/G standardized to a {money(1_000)} average; no-history players use their group-and-role average.</small></span></label>
        </fieldset>
        <label className="draft-guard-choice"><input type="checkbox" name="draftBudgetGuardEnabled" value="true" defaultChecked /><span><b>Protect every team&apos;s remaining budget</b><small>Blocks a pick when its price would leave that team unable to afford the cheapest safe completion of its remaining slots. The hard budget cap, role rules, and player-pool protections always remain active.</small></span></label>
        {format && previewSheet && dynamicPreviewBudget !== null && <p className="notice small">For {teams.length} participant{teams.length === 1 ? "" : "s"}, dynamic pricing will set the minimum safe rounded budget at <b>{money(dynamicPreviewBudget)}</b>. The most expensive possible one-player-per-slot roster costs {money(maximumPreviewRoster ?? 0)}, so premium choices still compete for limited budget.</p>}
        {format && previewSheet && dynamicPreviewBudget === null && <p className="error small">This split does not have enough eligible players to complete {teams.length} fantasy rosters. Remove participants before starting the draft.</p>}
        {previewError && <p className="error small">Dynamic pricing unavailable: {previewError}</p>}
        {teams.map((_, index) => <label key={index}>Pick position {index + 1}<select name="teamId" defaultValue={teams[index]?.id}>{teams.map((team) => <option value={team.id} key={team.id}>{team.username} — {team.name}</option>)}</select></label>)}
        <button type="submit">Lock setup and start draft</button>
      </form>
      {format && previewSheet && <details className="draft-price-preview"><summary>Preview the dynamic price sheet</summary>
        <p className="muted small">Source: LCK 2026 Rounds 1–2 · observed mean {previewSheet.sourceAveragePpg.toFixed(2)} Pts/G · prices use a {money(previewSheet.priceStandardDeviation)} standard deviation and are bounded at {money(DYNAMIC_PRICE_MIN)}–{money(DYNAMIC_PRICE_MAX)}.</p>
        <div className="tablewrap"><table><thead><tr><th>Player</th><th>Group</th><th>Role</th><th>R1–2 Pts/G</th><th>Games</th><th>Price</th></tr></thead><tbody>{eligible
          .map((row) => ({ row, group: draftGroupForTeam(format, row.teamId), value: previewSheet.players[row.playerId] }))
          .sort((left, right) => (right.value?.price ?? 0) - (left.value?.price ?? 0) || left.row.player.name.localeCompare(right.row.player.name))
          .map(({ row, group, value }) => <tr key={row.playerId}><td>{row.player.name}</td><td><span className={`draft-group-badge draft-group-${group?.toLowerCase()}`}>{group === "LEGENDS" ? "Legends" : "Rise"}</span></td><td>{row.role}</td><td>{value?.ppg?.toFixed(1) ?? "New / no data"}</td><td>{value?.games ?? 0}</td><td><b>{money(value?.price ?? 1_000)}</b></td></tr>)}</tbody></table></div>
      </details>}
    </section> : league.draftPricingMode === "DYNAMIC" && !frozenSheet ? <p className="error card">This draft&apos;s frozen dynamic price sheet is missing. Reset the draft before making another pick.</p> : <>
      <DraftBoard
        leagueId={league.id}
        status={league.draftStatus}
        currentPick={league.draftCurrentPick}
        totalPicks={totalPicks}
        currentTeamId={currentTeamId}
        budget={league.draftBudget}
        uniformPrice={league.draftPlayerPrice}
        pricingMode={league.draftPricingMode}
        budgetGuardEnabled={league.draftBudgetGuardEnabled}
        priceSource={league.draftPriceSourceTournamentId}
        playersPerRole={league.draftPlayersPerRole}
        groupKeys={groupKeys}
        groups={format?.groups.map(({ key, label }) => ({ key, label })) ?? []}
        order={order}
        teams={teams}
        availablePlayers={eligible.flatMap((row) => {
          const role = row.role ?? row.player.role;
          if (!role || !DRAFT_ROLES.includes(role as (typeof DRAFT_ROLES)[number])) return [];
          const teamId = row.teamId ?? row.player.teamId;
          const group = draftGroupForTeam(format, teamId);
          if (format && !group) return [];
          const sharedWith = tournamentRoster.filter((peer) => {
            const peerRole = peer.role ?? peer.player.role;
            return peer.playerId !== row.playerId && (peer.teamId ?? peer.player.teamId) === teamId && peerRole === role;
          }).map((peer) => peer.player.name);
          return [{
            id: row.playerId,
            name: row.player.name,
            teamId,
            role: role as (typeof DRAFT_ROLES)[number],
            group,
            sharedWith,
            price: playerDraftPrice(league.draftPricingMode, frozenSheet, row.playerId, league.draftPlayerPrice),
            ppg: frozenSheet?.players[row.playerId]?.ppg ?? null,
            games: frozenSheet?.players[row.playerId]?.games ?? 0,
          }];
        })}
      />
      <form action={resetDraft} className="card safety-confirm"><input type="hidden" name="leagueId" value={league.id} /><label><input type="checkbox" name="confirmReset" value="true" required /><span>Clear every draft pick, initial roster slot, and the frozen pricing configuration in this league.</span></label><button type="submit">Reset draft and choose a new setup</button></form>
    </>}
  </>;
}
