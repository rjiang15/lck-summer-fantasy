import assert from "node:assert/strict";
import test from "node:test";
import {
  golStatInt,
  golStatRatio,
  isGolSeriesComplete,
  normalizeGolIdentity,
  parseGolFullStats,
  parseGolGameOverview,
  parseGolMatchList,
  parseGolSeriesGames,
} from "./games-of-legends";

test("Gol match-list parsing retains score-side order and rejects an unfinished BO3", () => {
  const html = `
    <table class='table_list footable'>
      <tr><th>Game</th><th></th><th>Score</th><th></th><th></th><th>Patch</th><th>Date</th></tr>
      <tr>
        <td><a href='../game/stats/80675/page-summary/'>Gen.G vs Dplus KIA</a></td>
        <td>Dplus KIA</td><td>1 - 0</td><td>Gen.G</td><td>WEEK10</td><td>16.14</td><td>2026-08-01</td>
      </tr>
      <tr>
        <td><a href='../game/stats/80654/page-summary/'>Kiwoom DRX vs NS</a></td>
        <td>Kiwoom DRX</td><td>0 - 2</td><td>Nongshim RedForce</td><td>WEEK10</td><td>16.14</td><td>2026-07-29</td>
      </tr>
    </table>`;
  const rows = parseGolMatchList(html);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    summaryGameId: "80675",
    summaryUrl: "https://gol.gg/game/stats/80675/page-summary/",
    label: "Gen.G vs Dplus KIA",
    team1: "Dplus KIA",
    team2: "Gen.G",
    team1Score: 1,
    team2Score: 0,
    weekLabel: "WEEK10",
    patch: "16.14",
    date: "2026-08-01",
  });
  assert.equal(isGolSeriesComplete(rows[0]), false);
  assert.equal(isGolSeriesComplete(rows[1]), true);
});

test("Gol summary parsing uses explicit game links rather than assuming consecutive ids", () => {
  const html = `
    <a href='../game/stats/80743/page-game/'>Game 1</a>
    <a href='../game/stats/80799/page-game/'>Game 2</a>
    <a href='../game/stats/80810/page-game/'>Game 3</a>
    <a href='../game/stats/80743/page-summary/'>Summary</a>`;
  assert.deepEqual(parseGolSeriesGames(html), [
    { gameId: "80743", gameNumber: 1 },
    { gameId: "80799", gameNumber: 2 },
    { gameId: "80810", gameNumber: 3 },
  ]);
});

test("Gol game overview parses teams, draft, score boxes, and typed objectives", () => {
  const championImages = (names: string[]) => names
    .map((name) => `<img src='../_img/champions_icon/${name}.png' alt='${name}'/>`)
    .join("");
  const html = `
    <div>2026-07-29 (WEEK10)</div>
    <div class='col-6 text-center'>Game Time<br/><h1>27:28</h1></div>
    <div class='col-3 text-right'> v16.14</div>
    <div class='blue-line-header'><a>Kiwoom DRX</a> - LOSS</div>
    <span class='score-box blue_line'><img alt='Kills'/> 13</span>
    <span class='score-box blue_line'><img alt='Towers'/> 1</span>
    <span class='score-box blue_line'><img alt='Dragons'/> 0</span>
    <span class='score-box blue_line'><img alt='Nashor'/> 0</span>
    <span class='score-box blue_line'><img alt='Team Gold'/> 50.1k</span>
    <div class='col-2'>Bans</div><div class='col-10'>${championImages(["Poppy", "Rumble", "Camille", "Vayne", "Karma"])}</div>
    <div class='col-2'>Picks</div><div class='col-10'>${championImages(["Orianna", "Xin Zhao", "Bard", "Gnar", "Yunara"])}</div>
    <div class='red-line-header'><a>Nongshim RedForce</a> - WIN</div>
    <span class='score-box red_line'><img alt='Kills'/> 28</span>
    <span class='score-box red_line'><img alt='Towers'/> 9</span>
    <span class='score-box red_line'><img alt='Dragons'/> 4</span>
    <span class='score-box red_line'><img alt='Nashor'/> 1</span>
    <span class='score-box red_line'><img alt='Team Gold'/> 59.8k</span>
    <div class='col-2'>Bans</div><div class='col-10'>${championImages(["Vi", "Jayce", "Nocturne", "Caitlyn", "Jhin"])}</div>
    <div class='col-2'>Picks</div><div class='col-10'>${championImages(["Jarvan IV", "Locke", "Ezreal", "Shen", "Varus"])}</div>
    <th>Player</th>
    <span class='red_action'>1:46<br/><img alt='First blood'/></span>
    <span class='red_action'>8:57<br/><img alt='Cloud Drake'/></span>
    <span class='red_action'>13:24<br/><img alt='First Tower'/></span>
    <span class='red_action'>14:20<br/><img alt='Hextech Drake'/></span>
    <span class='blue_action'><img alt='Rift Herald'/><br/>16:50</span>
    <span class='red_action'>19:39<br/><img alt='Mountain Drake'/></span>
    <span class='red_action'>21:36<br/><img alt='Nashor'/></span>
    <span class='red_action'>25:14<br/><img alt='Mountain Drake'/></span>
    <div class='col-4 text-center'>Voidgrubs</div><div class='col-4 text-center'>3</div><div class='col-4 text-center'>0</div>
    <div class='col-4 text-center'>Plates</div><div class='col-4 text-center'>8</div><div class='col-4 text-center'>37</div>`;
  const parsed = parseGolGameOverview(html, "80654");
  assert.equal(parsed.lengthSec, 1648);
  assert.equal(parsed.patch, "16.14");
  assert.deepEqual(parsed.drafts.map((draft) => [draft.picks.length, draft.bans.length]), [[5, 5], [5, 5]]);
  assert.deepEqual(parsed.teams[0], {
    sourceName: "Kiwoom DRX", side: "Blue", won: false, kills: 13, gold: 50100,
    towers: 1, dragons: 0, barons: 0, turretPlates: 8, cloudDrakes: 0,
    infernalDrakes: 0, mountainDrakes: 0, oceanDrakes: 0, hextechDrakes: 0,
    chemtechDrakes: 0, elderDragons: 0, heralds: 1, voidGrubs: 3,
    atakhans: 0, inhibs: 0, firstBlood: false, firstDragon: false,
    firstHerald: true, firstBaron: false, firstTower: false,
  });
  assert.equal(parsed.teams[1].firstBlood, true);
  assert.equal(parsed.teams[1].firstDragon, true);
  assert.equal(parsed.teams[1].firstBaron, true);
  assert.equal(parsed.teams[1].mountainDrakes, 2);
  assert.equal(parsed.teams[1].turretPlates, 37);
});

test("Gol all-stats parsing maps ten columns and numeric ratios", () => {
  const names = ["Frog", "Willer", "Ucal", "LazyFeel", "Andil", "Kingen", "Sponge", "Scout", "Diable", "Lehends"];
  const roles = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT", "TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
  const champions = ["Gnar", "Xin Zhao", "Orianna", "Yunara", "Bard", "Varus", "Jarvan IV", "Locke", "Ezreal", "Shen"];
  const row = (label: string, values: Array<string | number>) => `<tr><td>${label}</td>${values.map((value) => `<td>${value}</td>`).join("")}</tr>`;
  const html = `<table class='completestats tablesaw'>
    <thead><tr><th></th>${champions.map((champion) => `<th><img alt='${champion}'/></th>`).join("")}</tr></thead>
    ${row("Player", names)}
    ${row("Role", roles)}
    ${row("Kills", [3, 4, 1, 5, 0, 3, 4, 12, 7, 2])}
    ${row("GOLD%", Array(10).fill("20.2%"))}
    ${row("GD@15", [-816, -244, -2100, -844, -700, 816, 244, 2100, 844, 700])}
  </table>`;
  const players = parseGolFullStats(html, "80654");
  assert.equal(players.length, 10);
  assert.deepEqual(players[3], {
    name: "LazyFeel",
    role: "Bot",
    side: "Blue",
    champion: "Yunara",
    stats: { player: "LazyFeel", role: "ADC", kills: "5", "gold%": "20.2%", "gd@15": "-844" },
  });
  assert.equal(golStatInt(players[3], "Kills"), 5);
  assert.equal(golStatInt(players[3], "GD@15"), -844);
  assert.ok(Math.abs((golStatRatio(players[3], "GOLD%") ?? 0) - 0.202) < 1e-9);
  assert.equal(normalizeGolIdentity("Dplus KIA"), normalizeGolIdentity("Dplus Kia"));
});
