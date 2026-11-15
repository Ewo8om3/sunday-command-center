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
  assert.strictEqual(SCC.dkPoints({}, "DST", "in"), 10);    // live and nothing allowed yet = shutout tier
  assert.strictEqual(SCC.dkPoints({}, "DST", "pre"), 0);    // not started: no points-allowed tier
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

test("ESPN league -> normalized matchup card", () => {
  const pe = (id, name, team, pos, act, proj) => ({ playerPoolEntry: { appliedStatTotal: act, player: { id, fullName: name, proTeamId: team, defaultPositionId: pos,
    stats: [{ statSourceId: 1, scoringPeriodId: 10, appliedTotal: proj }] } } });
  const data = { scoringPeriodId: 10, status: { currentMatchupPeriod: 10 }, settings: { name: "ESPN Test" },
    members: [{ id: "{A}", displayName: "alice" }, { id: "{B}", displayName: "bob" }],
    teams: [{ id: 1, name: "Alpha", owners: ["{A}"], record: { overall: { wins: 6, losses: 3 } } }, { id: 2, location: "Beta", nickname: "Bots", owners: ["{B}"], record: { overall: {} } }],
    schedule: [{ matchupPeriodId: 10, home: { teamId: 2, totalPointsLive: 9, rosterForCurrentScoringPeriod: { entries: [Object.assign({ lineupSlotId: 0 }, pe(9, "Some QB", 6, 1, 9, 18))] } },
      away: { teamId: 1, totalPointsLive: 22.4, winProbability: 0.7, rosterForCurrentScoringPeriod: { entries: [
        Object.assign({ lineupSlotId: 20 }, pe(8, "Bench Guy", 12, 3, 30, 10)),
        Object.assign({ lineupSlotId: 2 }, pe(7, "Rob Runner Jr.", 1, 2, 20.4, 15)),
        Object.assign({ lineupSlotId: 0 }, pe(6, "Pat Passer", 12, 1, 22.4, 20))] } } }] };
  assert.deepStrictEqual(SCC.espnTeams(data).map(t => t.name + "/" + t.owner), ["Alpha/alice", "Beta Bots/bob"]);
  const s = SCC.buildState({ week: 10, season: "2026", scoreboard, stats, projections, espn: [{ cfg: { leagueId: "1", teamId: 1 }, data }] });
  const m = s.sleeper[0];
  assert.strictEqual(m.platform, "espn");
  assert.strictEqual(m.me.name, "Alpha");
  assert.strictEqual(m.me.record, "6-3");
  assert.deepStrictEqual(m.me.starters.map(r => r.pos), ["QB", "RB"]);   // bench skipped, slot order
  assert.strictEqual(m.me.starters[0].id, "100");                          // mapped to the Sleeper id
  assert.strictEqual(m.me.starters[1].team, "ATL");
  assert.strictEqual(m.winProb, 0.7);
  assert.strictEqual(m.opp.name, "Beta Bots");
  assert.deepStrictEqual(s.interest["100"].mine, ["ESPN Test"]);
});

/* ---------------------------------------------------------------- review fixes */

test("M1: DST points-allowed tier only once the game is live or final", () => {
  assert.strictEqual(SCC.dkPoints({}, "DST"), 0);                         // no stats, no state: not started
  assert.strictEqual(SCC.dkPoints({}, "DST", "pre"), 0);
  assert.strictEqual(SCC.dkPoints({}, "DST", "bye"), 0);
  assert.strictEqual(SCC.dkPoints({ sack: 2 }, "DST", "pre"), 2);
  assert.strictEqual(SCC.dkPoints({}, "DST", "post"), 10);                // real shutout (Sleeper omits pts_allow = 0)
  assert.strictEqual(SCC.dkPoints({ gp: 1, pts_allow_0: 1 }, "DST"), 10); // no state, stats show it played
  assert.strictEqual(SCC.dkPoints({ pts_allow: 17 }, "DST"), 1);
  assert.strictEqual(SCC.dkPoints({ pts_allow: 3 }, "DST", "proj"), 7);
});

test("M1: a pre-game DST adds 0 to a DK lineup until kickoff", () => {
  const sal = { "4000090": { name: "Cowboys", pos: "DST", team: "DAL" } };
  const st = [{ player_id: "DAL", team: "DAL", player: { first_name: "Dallas", last_name: "Cowboys", position: "DEF", team: "DAL" }, stats: {} }];
  const dk = { lineups: [{ players: [{ slot: "DST", name: "Cowboys", dkId: "4000090" }] }], salaries: sal };
  const pre = SCC.buildState({ week: 10, season: "2026", scoreboard, stats: st, projections: [], dk });
  assert.strictEqual(pre.games.find(g => g.home === "DAL").state, "pre");
  assert.strictEqual(pre.dk.lineups[0].players[0].pts, 0);
  assert.strictEqual(pre.dk.lineups[0].pts, 0);
  assert.strictEqual(pre.interest.DAL.dkpts, 0);
  const live = JSON.parse(JSON.stringify(scoreboard));
  live.events[1].status = { period: 1, clock: 800, type: { state: "in", shortDetail: "13:20 - 1st" } };
  const inG = SCC.buildState({ week: 10, season: "2026", scoreboard: live, stats: st, projections: [], dk });
  assert.strictEqual(inG.dk.lineups[0].players[0].pts, 10);
});

test("DK DST: every points-allowed tier boundary and all DST events", () => {
  const t = pa => SCC.dkPoints({ pts_allow: pa }, "DST", "post");
  assert.deepStrictEqual([0, 1, 6, 7, 13, 14, 20, 21, 27, 28, 34, 35, 50].map(t), [10, 7, 7, 4, 4, 1, 1, 0, 0, -1, -1, -4, -4]);
  // sack 1, int 2, fumble recoveries (defense + special teams) 2 each, TDs 6, safety 2, blocked kick 2, 2pt return 2
  const all = { pts_allow: 24, sack: 3, int: 1, fum_rec: 1, def_st_fum_rec: 1, def_td: 1, def_st_td: 1, safe: 1, blk_kick: 1, def_2pt: 1 };
  assert.strictEqual(SCC.dkPoints(all, "DST", "post"), 3 + 2 + 2 + 2 + 6 + 6 + 2 + 2 + 2 + 0);
});

test("S3: special-teams fumble recoveries count for the DST", () => {
  assert.strictEqual(SCC.dkPoints({ pts_allow: 24, def_st_fum_rec: 1 }, "DST", "post"), 2);
  assert.strictEqual(SCC.dkPoints({ pts_allow: 24, fum_rec: 2, def_st_fum_rec: 1 }, "DST", "post"), 6);
});

test("DK offense: bonuses at the edges, 2-pt conversions, return and fumble-recovery TDs", () => {
  const p = s => SCC.dkPoints(s, "WR");
  assert.strictEqual(p({ pass_yd: 299 }), 11.96);
  assert.strictEqual(p({ pass_yd: 300 }), 15);
  assert.strictEqual(p({ rush_yd: 99 }), 9.9);
  assert.strictEqual(p({ rush_yd: 100 }), 13);
  assert.strictEqual(p({ rec_yd: 99, rec: 5 }), 14.9);
  assert.strictEqual(p({ rec_yd: 100, rec: 5 }), 18);
  assert.strictEqual(p({ pass_2pt: 1, rush_2pt: 1, rec_2pt: 1 }), 6);
  assert.strictEqual(p({ kr_td: 1, pr_td: 1 }), 12);
  assert.strictEqual(p({ fum_rec_td: 1 }), 6);                 // offensive fumble recovery TD
  assert.strictEqual(p({ pass_int: 2, fum_lost: 1 }), -3);
  assert.strictEqual(SCC.tdCount({ rec_td: 1, fum_rec_td: 1, kr_td: 1 }), 3);
});

const LOCK_HDR = "Entry ID,Contest Name,Contest ID,Entry Fee,QB,RB,RB,WR,WR,WR,TE,FLEX,DST,,Instructions\n";
const lockedRow = "556,NFL $5 Test GPP,999,$5,Pat Passer (4000010) (LOCKED),Rob Runner Jr. (4000020) (LOCKED),A B (4000030) (LOCKED),Will Wideout (4000040) (LOCKED)," +
  "C D (4000050),E F (4000060),G H (4000070),I J (4000080),Chiefs (4000090) (LOCKED),,\n";

test("M2: ' (LOCKED)' and similar tags are stripped; no lineup is dropped", () => {
  const r = SCC.parseDK(LOCK_HDR + lockedRow);
  assert.strictEqual(r.lineups.length, 1);
  assert.strictEqual(r.lineups[0].players.length, 9);
  assert.strictEqual(r.lineups[0].players[0].name, "Pat Passer");
  assert.strictEqual(r.lineups[0].players[8].slot, "DST");
  assert.strictEqual(r.lineups[0].players[8].dkId, "4000090");
  assert.deepStrictEqual(r.lineups[0].missing, []);
  assert.deepStrictEqual(r.warnings, []);
  assert.deepStrictEqual(SCC.parseCell("Pat Passer (LOCKED) (4000010)"), { name: "Pat Passer", dkId: "4000010" });
  assert.deepStrictEqual(SCC.parseCell("Pat Passer (4000010) (Locked) (Q)"), { name: "Pat Passer", dkId: "4000010" });
  // pasted line with locked tags
  const pasted = SCC.parseDK(lockedRow.split(",").slice(4, 13).join(","));
  assert.strictEqual(pasted.lineups[0].players.length, 9);
});

test("M2: unreadable or empty slots are kept and reported, never silently dropped", () => {
  const row = "557,NFL $5 Test GPP,999,$5,Pat Passer (4000010),,A B (4000030),LOCKED,LOCKED,LOCKED,LOCKED,I J (4000080),Chiefs (4000090),,\n";
  const r = SCC.parseDK(LOCK_HDR + row);
  assert.strictEqual(r.lineups.length, 1);                      // 4 bad cells: previously the whole lineup vanished
  assert.strictEqual(r.lineups[0].players.length, 4);
  assert.deepStrictEqual(r.lineups[0].missing.map(x => x.slot), ["RB", "WR", "WR", "WR", "TE"]);
  assert.strictEqual(r.warnings.length, 1);
  assert.match(r.warnings[0], /entry 557.*5 slots not read: RB \(empty\), WR .LOCKED./);
  const s = SCC.buildState({ week: 10, season: "2026", scoreboard, stats, projections, dk: r });
  assert.deepStrictEqual(s.dk.incomplete, [{ n: 1, entry: "557", slots: ["RB", "WR", "WR", "WR", "TE"], cells: ["", "LOCKED", "LOCKED", "LOCKED", "LOCKED"] }]);
  // an older saved lineup with fewer players lists the Classic slots that are absent
  const old = SCC.buildDK({ lineups: [{ players: [{ slot: "QB", name: "Pat Passer", dkId: "4000010" }, { slot: "DST", name: "Chiefs", dkId: "4000090" }] }] },
    SCC.statMaps(stats, projections), {});
  assert.deepStrictEqual(old.incomplete[0].slots, ["RB", "RB", "WR", "WR", "WR", "TE", "FLEX"]);
  // a short pasted Classic lineup is flagged too
  const short = SCC.parseDK("Pat Passer (4000010), Rob Runner Jr. (4000020)");
  assert.strictEqual(short.lineups.length, 1);
  assert.strictEqual(short.lineups[0].missing.length, 7);
  assert.strictEqual(short.warnings.length, 1);
});

test("parseDK: DKSalaries.csv alone gives salaries, not fake lineups", () => {
  const sal = "Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\n" +
    "QB,Pat Passer (4000010),Pat Passer,4000010,QB,7000,KC@ATL 11/15/2026 01:00PM ET,KC,21.1\n" +
    "DST,Chiefs (4000090),Chiefs,4000090,DST,3000,KC@ATL 11/15/2026 01:00PM ET,KC,7.0\n";
  const r = SCC.parseDK(sal);
  assert.strictEqual(r.lineups.length, 0);
  assert.strictEqual(r.salaries["4000090"].pos, "DST");
});

test("Showdown: captain scores 1.5x and the import says so", () => {
  const sd = "CPT,FLEX,FLEX,FLEX,FLEX,FLEX\nPat Passer (4000010),Rob Runner Jr. (4000020),A B (4000030),C D (4000050),E F (4000060),G H (4000070)\n";
  const r = SCC.parseDK(sd);
  assert.strictEqual(r.lineups[0].showdown, true);
  assert.ok(r.warnings.some(w => /Showdown/.test(w)));
  const s = SCC.buildState({ week: 10, season: "2026", scoreboard, stats, projections, dk: r });
  assert.strictEqual(s.dk.lineups[0].players[0].pts, 35.4);     // 23.6 x 1.5
  assert.deepStrictEqual(s.dk.incomplete, []);
});

const XSS = "<img src=x onerror=alert(1)>";
test("M4: crafted names are escaped in the red-zone radar", () => {
  // the reported attack: a DST cell that ends in a team nickname resolves to that team and keeps the raw name
  const csv = LOCK_HDR + "558,G,1,$5,Pat Passer (4000010),,,,,,,,X " + XSS + " Chiefs (1000009),,\n";
  const s = SCC.buildState({ week: 10, season: "2026", scoreboard, stats, projections, dk: SCC.parseDK(csv) });
  const dst = s.dk.lineups[0].players.find(p => p.slot === "DST");
  assert.strictEqual(dst.sid, "KC");
  assert.ok(s.interest.KC);
  assert.strictEqual(s.interest.KC.name, "X " + XSS + " Chiefs");   // the raw name reaches the radar's data
  assert.strictEqual(s.interest.KC.dk, 1);
  const r = SCC.radarHTML(s.games, s.interest);                       // KC is in the red zone in the fixture
  assert.strictEqual(r.count, 1);
  assert.ok(!/<img/i.test(r.html), r.html);
  assert.match(r.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  // player names and opponents' names too
  const html = SCC.radarHTML([{ id: '1"><script>', rz: true, poss: "KC", dd: XSS }], {
    a: { name: "Pat " + XSS, team: "KC", mine: ["L"], opp: [], dk: 0 },
    b: { name: "Opp <script>alert(1)</script>", team: "KC", mine: [], opp: ["L"], dk: 0 } }).html;
  assert.ok(!/<img|<script/i.test(html), html);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("esc() and safeUrl()", () => {
  assert.strictEqual(SCC.esc(XSS), "&lt;img src=x onerror=alert(1)&gt;");
  assert.strictEqual(SCC.esc('"\'`&'), "&quot;&#39;&#96;&amp;");
  assert.strictEqual(SCC.esc(null), "");
  assert.strictEqual(SCC.safeUrl("javascript:alert(1)"), "");
  assert.strictEqual(SCC.safeUrl(" data:text/html,x"), "");
  assert.strictEqual(SCC.safeUrl("https://tv.youtube.com/"), "https://tv.youtube.com/");
  assert.strictEqual(SCC.safeUrl('https://x.com/" onmouseover="a'), "");
});

test("M3: data status reflects the real age and failures, never green during an outage", () => {
  const now = 1000000000;
  const ok = (age, extra) => Object.assign({ ok: now - age * 1000, fails: 0, err: "", critical: true }, extra);
  assert.strictEqual(SCC.dataStatus({}, now, 15).level, "connecting");
  assert.strictEqual(SCC.dataStatus({ s: ok(5), e: ok(8) }, now, 15).level, "ok");
  assert.strictEqual(SCC.dataStatus({ s: ok(5), e: ok(8) }, now, 15).age, 8);           // oldest critical source
  // 45 s outage of one feed: cached data is shown, but amber with its real age
  const out = SCC.dataStatus({ s: ok(50, { fails: 3, err: "timed out" }), e: ok(4) }, now, 15);
  assert.strictEqual(out.level, "stale");
  assert.strictEqual(out.age, 50);
  assert.deepStrictEqual(out.failing, ["s"]);
  // everything failing -> red
  assert.strictEqual(SCC.dataStatus({ s: ok(50, { fails: 3 }), e: ok(40, { fails: 2 }) }, now, 15).level, "offline");
  assert.strictEqual(SCC.dataStatus({ s: { ok: 0, fails: 1, critical: true } }, now, 15).level, "offline");
  // one league that never loads doesn't hide the age of the feeds that work
  const one = SCC.dataStatus({ s: ok(6), espn: { ok: 0, fails: 4, err: "ESPN 404", critical: true } }, now, 15);
  assert.strictEqual(one.level, "stale");
  assert.strictEqual(one.age, 6);
  // no failures but data too old
  assert.strictEqual(SCC.dataStatus({ s: ok(70) }, now, 15).level, "stale");
  assert.strictEqual(SCC.dataStatus({ s: ok(400) }, now, 15).level, "offline");
  // a non-critical failure (projections) still shows amber
  assert.strictEqual(SCC.dataStatus({ s: ok(5), p: { ok: now, fails: 1, critical: false } }, now, 15).level, "stale");
});

test("S5: polling slows down when no game is live, and backs off on errors", () => {
  const now = Date.parse("2026-11-15T15:00:00Z");
  const g = (state, kickIso) => ({ state, kick: kickIso });
  assert.strictEqual(SCC.pollDelay([g("in", "2026-11-15T14:00:00Z")], now, 15, 0), 15000);
  assert.strictEqual(SCC.pollDelay([g("pre", "2026-11-15T15:10:00Z")], now, 15, 0), 15000);  // kickoff in 10 min
  assert.strictEqual(SCC.pollDelay([g("pre", "2026-11-15T17:00:00Z")], now, 15, 0), 60000);  // later today
  assert.strictEqual(SCC.pollDelay([g("post", "2026-11-15T12:00:00Z"), g("pre", "2026-11-19T01:00:00Z")], now, 15, 0), 300000);
  assert.strictEqual(SCC.pollDelay([], now, 15, 0), 300000);
  assert.strictEqual(SCC.pollDelay([g("in", "x")], now, 15, 1), 30000);
  assert.strictEqual(SCC.pollDelay([g("in", "x")], now, 15, 9), 120000);   // capped at 8x
  assert.strictEqual(SCC.pollDelay([], now, 15, 9), 300000);               // never more than 5 min
});

test("S4: feed and snapshot are week-scoped, so a new week starts clean", () => {
  const stored = { season: "2026", week: 9, seasonType: "regular", data: [{ name: "x" }] };
  assert.deepStrictEqual(SCC.scoped(stored, "2026", "9", "regular"), [{ name: "x" }]);
  assert.strictEqual(SCC.scoped(stored, "2026", 10, "regular"), null);
  assert.strictEqual(SCC.scoped(stored, "2026", 9, "post"), null);
  assert.strictEqual(SCC.scoped([{ name: "old unscoped feed" }], "2026", 9), null);
  assert.strictEqual(SCC.scoped(null, "2026", 9), null);
});

test("URLs: season type and week override reach every feed", () => {
  const u = SCC.urls("2026", 2, "post", 2);
  assert.match(u.stats, /season_type=post/);
  assert.match(u.schedule, /\/post\/2026$/);
  assert.match(u.scoreboard, /seasontype=3&week=2&dates=2026/);
  assert.ok(!/\?/.test(SCC.urls("2026", 10).scoreboard));
});

test("display names: team defenses are not clipped", () => {
  assert.strictEqual(SCC.lastName("New York Giants"), "Giants");
  assert.strictEqual(SCC.lastName("Green Bay Packers"), "Packers");
  assert.strictEqual(SCC.lastName("Chiefs"), "Chiefs");
  assert.strictEqual(SCC.lastName("Amon-Ra St. Brown"), "St. Brown");
});
