// Mock season setup: wipes the fantasy side and creates a league on the given
// tournament with auto-drafted rosters and (for bots) predictions for every
// match. Combined with the week cursor at Week 0, this lets you play through
// a past split: make your own picks each week, advance, watch them grade.

import { prisma } from "./db";
import { DEFAULT_SCORING, playerGamePoints } from "./scoring";

// Deterministic PRNG so reruns produce the same mock picks
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROLE_TO_SLOT: Record<string, string> = {
  Top: "TOP",
  Jungle: "JNG",
  Mid: "MID",
  Bot: "BOT",
  Support: "SUP",
};

export interface MockOptions {
  /** Bots predict every match; the human (first user) predicts via the Picks page. */
  humanUsername?: string;
  botUsernames?: string[];
  humanPasswordHash?: string;
}

export async function seedMockSeason(tournamentId: string, opts: MockOptions = {}) {
  const rand = mulberry32(20260716);
  const human = opts.humanUsername ?? "ryan";
  const bots = opts.botUsernames ?? ["bot_alpha", "bot_beta", "bot_gamma"];

  // Wipe fantasy-side data only (never touches ingested esports data)
  await prisma.session.deleteMany();
  await prisma.weeklyScore.deleteMany();
  await prisma.weeklyRosterSlot.deleteMany();
  await prisma.leagueWeek.deleteMany();
  await prisma.crystalBallAnswer.deleteMany();
  await prisma.crystalBallQuestion.deleteMany();
  await prisma.pickem.deleteMany();
  await prisma.rosterSlot.deleteMany();
  await prisma.fantasyTeam.deleteMany();
  await prisma.league.deleteMany();
  await prisma.user.deleteMany();

  const league = await prisma.league.create({
    data: {
      name: "Mock Season",
      slug: "mock-season",
      inviteCode: "MOCK",
      tournamentId,
      scoringConfig: JSON.stringify(DEFAULT_SCORING),
      currentWeek: 0,
      isSimulation: true,
    },
  });

  const usernames = [human, ...bots];
  const users = [];
  for (const username of usernames) {
    users.push(
      await prisma.user.create({
        data: {
          username,
          passwordHash: username === human && opts.humanPasswordHash ? opts.humanPasswordHash : "mock-no-login-yet",
          siteAdmin: false,
        },
      }),
    );
  }
  for (const [index, user] of users.entries()) {
    await prisma.leagueMembership.create({ data: { leagueId: league.id, userId: user.id, role: index === 0 ? "OWNER" : "PARTICIPANT" } });
  }
  const teams = [];
  for (const u of users) {
    teams.push(
      await prisma.fantasyTeam.create({
        data: {
          leagueId: league.id,
          userId: u.id,
          name: u.username === human ? `${human}'s team` : `${u.username} (bot)`,
        },
      }),
    );
  }

  const weeks = await prisma.week.findMany({ where: { tournamentId }, orderBy: { number: "asc" } });
  for (const [index, week] of weeks.entries()) {
    await prisma.leagueWeek.create({
      data: {
        leagueId: league.id,
        weekId: week.id,
        status: index === 0 ? "OPEN" : "UPCOMING",
        picksOpenAt: index === 0 ? new Date() : null,
      },
    });
  }

  // ---- Snake draft: rank players per role by fantasy points ----
  const stats = await prisma.playerGameStat.findMany({
    where: { game: { match: { tournamentId } } },
  });
  const totals = new Map<string, { pts: number; role: string; games: number }>();
  for (const s of stats) {
    const row = totals.get(s.playerId) ?? { pts: 0, role: s.role ?? "?", games: 0 };
    row.pts += playerGamePoints(s, DEFAULT_SCORING);
    row.games++;
    if (s.role) row.role = s.role;
    totals.set(s.playerId, row);
  }
  const byRole = new Map<string, string[]>();
  for (const [playerId, t] of totals) {
    if (t.games < 10) continue; // skip subs
    if (!byRole.has(t.role)) byRole.set(t.role, []);
    byRole.get(t.role)!.push(playerId);
  }
  for (const list of byRole.values()) {
    list.sort((a, b) => totals.get(b)!.pts - totals.get(a)!.pts);
  }
  const roleRounds = ["Mid", "Bot", "Jungle", "Support", "Top"];
  for (const [round, role] of roleRounds.entries()) {
    const order = round % 2 === 0 ? teams : [...teams].reverse(); // snake
    for (const team of order) {
      const pick = (byRole.get(role) ?? []).shift();
      if (!pick) continue;
      await prisma.rosterSlot.create({
        data: { fantasyTeamId: team.id, playerId: pick, slot: ROLE_TO_SLOT[role] },
      });
    }
  }

  // ---- Bot pickems for every finished match (the human picks in-app) ----
  const matches = await prisma.match.findMany({
    where: { tournamentId, winner: { not: null } },
  });
  let pickemCount = 0;
  for (const u of users) {
    if (u.username === human) continue;
    for (const m of matches) {
      if (!m.winner || m.team1Score === null || m.team2Score === null) continue;
      const correct = rand() < 0.62; // bots are decent, not psychic
      const predictedWinner = correct ? m.winner : m.winner === m.team1 ? m.team2 : m.team1;
      const winsNeeded = m.bestOf === 5 ? 3 : 2;
      const loserGames = Math.floor(rand() * winsNeeded);
      const predictedScore =
        predictedWinner === m.team1
          ? `${winsNeeded}-${loserGames}`
          : `${loserGames}-${winsNeeded}`;
      await prisma.pickem.create({
        data: { leagueId: league.id, userId: u.id, matchId: m.id, predictedWinner, predictedScore },
      });
      pickemCount++;
    }
  }

  return {
    league: league.name,
    tournamentId,
    users: usernames,
    botPickems: pickemCount,
  };
}
