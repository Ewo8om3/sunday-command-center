// Run: node --test   (Node 20+). Synthetic fixtures only.
const test = require("node:test");
const assert = require("node:assert");
const SCC = require("../assets/core.js");

const stats = [
  { player_id: "100", team: "KC", player: { first_name: "Pat", last_name: "Passer", position: "QB", team: "KC" },
    stats: { pass_yd: 310, pass_td: 2, pass_int: 1, rush_yd: 12, pts_ppr: 22.4 } },
  { player_id: "200", team: "ATL", player: { first_name: "Rob", last_name: "Runner Jr.", position: "RB", team: "ATL" },
    stats: { rush_yd: 104, rush_td: 1, rec: 3, rec_yd: 20, fum_lost: 1, pts_ppr: 20.4 } },
  { player_id: "KC", team: "KC", player: { first_name: "Kansas City", last_name: "Chiefs", position: "DEF", team: "KC" },
    stats: { sack: 3, int: 1, pts_allow: 17, pts_ppr: 6 } }
];
const projections = [
  { player_id: "100", team: "KC", player: { first_name: "Pat", last_name: "Passer", position: "QB", team: "KC" }, stats: { pts_ppr: 20, pass_yd: 260, pass_td: 2 } },
  { player_id: "200", team: "ATL", player: { first_name: "Rob", last_name: "Runner Jr.", position: "RB", team: "ATL" }, stats: { pts_ppr: 15, rush_yd: 80, rush_td: 0.6 } },
  { player_id: "300", team: "DAL", player: { first_name: "Will", last_name: "Wideout", position: "WR", team: "DAL" }, stats: { pts_ppr: 14, rec: 6, rec_yd: 70 } }
];
const scoreboard = { events: [
  { id: "1", date: "2026-11-15T18:00Z", status: { period: 3, clock: 450, type: { state: "in", shortDetail: "7:30 - 3rd" } },
    competitions: [{ competitors: [
      { homeAway: "home", score: "17", team: { id: "1", abbreviation: "ATL" } },
      { homeAway: "away", score: "24", team: { id: "12", abbreviation: "KC" } }],
      situation: { down: 2, possession: "12", possessionText: "ATL 14", isRedZone: false, downDistanceText: "2nd & 6 at ATL 14" } }] },
  { id: "2", date: "2026-11-15T21:25Z", status: { period: 0, clock: 0, type: { state: "pre", shortDetail: "4:25 PM" } },
    competitions: [{ competitors: [
      { homeAway: "home", score: "0", team: { id: "6", abbreviation: "DAL" } },
      { homeAway: "away", score: "0", team: { id: "28", abbreviation: "WSH" } }] }] }
] };

test("DK scoring incl. bonuses, fumbles and DST tiers", () => {
  assert.strictEqual(SCC.dkPoints(stats[0].stats, "QB"), 23.6);
  assert.strictEqual(SCC.dkPoints(stats[1].stats, "RB"), 10.4 + 6 + 3 + 2 - 1 + 3);
  assert.strictEqual(SCC.dkPoints(stats[2].stats, "DEF"), 3 + 2 + 1);
  assert.strictEqual(SCC.dkPoints({}, "DST"), 10);
});

test("ESPN scoreboard parsing, red-zone inference, WSH->WAS", () => {
  const sb = SCC.parseScoreboard(scoreboard);
  const g = sb.teamGame.KC;
  assert.strictEqual(g.rz, true);
  assert.strictEqual(g.poss, "KC");
  assert.strictEqual(g.remain, 0.375);
  assert.ok(sb.teamGame.WAS);
});

test("CSV parser handles quotes and CRLF", () => {
  assert.deepStrictEqual(SCC.parseCSV('a,"b,c","d ""e"""\r\n1,2,3'), [["a", "b,c", 'd "e"'], ["1", "2", "3"]]);
});

const upload = "QB,RB,RB,WR,WR,WR,TE,FLEX,DST\n" +
  "Pat Passer (4000010),Rob Runner Jr. (4000020),A B (4000030),Will Wideout (4000040),C D (4000050),E F (4000060),G H (4000070),I J (4000080),Chiefs (4000090)\n";
const entries = "Entry ID,Contest Name,Contest ID,Entry Fee,QB,RB,RB,WR,WR,WR,TE,FLEX,DST,,Instructions\n" +
  "555,NFL $5 Test GPP,999,$5,Pat Passer (4000010),Rob Runner Jr. (4000020),A B (4000030),Will Wideout (4000040),C D (4000050),E F (4000060),G H (4000070),I J (4000080),Chiefs (4000090),,1. Column A\n" +
  ",,,,,,,,,,,,,,,Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\n" +
  ",,,,,,,,,,,,,,,QB,Pat Passer (4000010),Pat Passer,4000010,QB,7000,KC@ATL 11/15/2026 01:00PM ET,KC,21.1\n" +
  ",,,,,,,,,,,,,,,DST,Chiefs (4000090),Chiefs,4000090,DST,3000,KC@ATL 11/15/2026 01:00PM ET,KC,7.0\n";

test("parseDK: upload CSV, entries export w/ salary table, pasted lines", () => {
  const a = SCC.parseDK(upload);
  assert.strictEqual(a.lineups.length, 1);
  assert.strictEqual(a.lineups[0].players[8].slot, "DST");
  const b = SCC.parseDK(entries);
  assert.strictEqual(b.lineups.length, 1);
  assert.strictEqual(b.lineups[0].contest, "NFL $5 Test GPP");
  assert.strictEqual(b.lineups[0].fee, 5);
  assert.strictEqual(b.salaries["4000010"].team, "KC");
  assert.strictEqual(b.salaries["4000010"].sal, 7000);
  const c = SCC.parseDK(upload.split("\n")[1]);
  assert.strictEqual(c.lineups.length, 1);
  assert.strictEqual(c.lineups[0].players[0].slot, "QB");
});

test("buildState: Sleeper matchup + DK live scoring + interest", () => {
  const sleeper = { userId: "u1", leagues: [{
    league: { name: "Test League", league_id: "L1", scoring_settings: { rec: 1 } },
    users: [{ user_id: "u1", display_name: "me" }, { user_id: "u2", display_name: "them", metadata: { team_name: "Their Team" } }],
    rosters: [{ roster_id: 1, owner_id: "u1", settings: { wins: 3, losses: 1 } }, { roster_id: 2, owner_id: "u2", settings: {} }],
    matchups: [{ roster_id: 1, matchup_id: 4, starters: ["100", "0"], starters_points: [22.4, 0], points: 22.4 },
               { roster_id: 2, matchup_id: 4, starters: ["200", "300"], starters_points: [20.4, 0], points: 20.4 }] }] };
  const s = SCC.buildState({ week: 10, season: "2026", scoreboard, stats, projections, sleeper, dk: SCC.parseDK(entries) });
  const m = s.sleeper[0];
  assert.strictEqual(m.opp.name, "Their Team");
  assert.strictEqual(m.me.empty, 1);
  assert.strictEqual(m.opp.yet, 1);           // WR on DAL hasn't kicked off
  assert.ok(m.winProb > 0 && m.winProb < 1);
  const lu = s.dk.lineups[0];
  assert.strictEqual(lu.players[0].sid, "100");
  assert.strictEqual(lu.players[1].sid, "200"); // matched by name (suffix-insensitive), no team info
  assert.strictEqual(lu.players[8].sid, "KC");  // DST via salary table
  assert.strictEqual(lu.players[0].pts, 23.6);
  assert.deepStrictEqual(s.interest["100"].mine, ["Test League"]);
  assert.strictEqual(s.interest["200"].dk, 1);
  assert.strictEqual(s.games.find(g => g.home === "ATL").dk, 3);
});

test("diffEvents flags TDs and tone", () => {
  const prev = { "100": { name: "P", team: "KC", mine: ["L"], opp: [], dk: 0, pts: 10, dkpts: 10, tds: 1 } };
  const next = { "100": { name: "P", team: "KC", mine: ["L"], opp: [], dk: 0, pts: 14, dkpts: 14, tds: 2 } };
  const ev = SCC.diffEvents(prev, next);
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].td, true);
  assert.strictEqual(ev[0].tone, "good");
});

test("schedule fallback builds games from Sleeper data", () => {
  const sb = SCC.scheduleToScoreboard([{ week: 10, status: "in_game", date: "2026-11-15", home: "ATL", away: "KC", game_id: "g" }], 10, stats);
  assert.strictEqual(sb.games[0].hs, 17);
  assert.strictEqual(sb.teamGame.KC.state, "in");
});
