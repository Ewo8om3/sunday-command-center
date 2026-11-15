/* Sunday Command Center prototype - offline demo.
 * Takes the frozen week snapshot in demo-data.js and plays a seeded, made-up second half on top of it:
 * drives, red-zone trips, touchdowns, field goals and turnovers. Output is the same raw shape the real
 * fetchers hand to SCC.buildState, so the demo exercises the real scoring and matching code.
 * Leagues, team names and lineups are fictional. */
(function () {
  "use strict";
  var D = window.SCC_DEMO_DATA;
  if (!D) return;

  /* seeded PRNG so every run (and every screenshot) plays out the same way */
  var seed = 20261115;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function pick(arr, w) {
    var tot = 0, i; for (i = 0; i < arr.length; i++) tot += w(arr[i]);
    var r = rnd() * tot; for (i = 0; i < arr.length; i++) { r -= w(arr[i]); if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  }
  function r2(x) { return Math.round(x * 100) / 100; }

  var sb = JSON.parse(JSON.stringify(D.scoreboard));
  var statById = {}, projById = {}, byTeam = {}, byPos = {};
  D.projections.forEach(function (r) {
    projById[r.player_id] = r;
    var p = r.player.position;
    (byPos[p] = byPos[p] || []).push(r);
    if (p !== "DEF") ((byTeam[r.team] = byTeam[r.team] || {})[p] = (byTeam[r.team] || {})[p] || []).push(r);
  });
  Object.keys(byPos).forEach(function (p) { byPos[p].sort(function (a, b) { return (b.stats.pts_ppr || 0) - (a.stats.pts_ppr || 0); }); });
  var stats = JSON.parse(JSON.stringify(D.stats));
  stats.forEach(function (r) { statById[r.player_id] = r; });
  function stat(pid) {
    if (!statById[pid]) { var p = projById[pid]; statById[pid] = { player_id: pid, team: p.team, stats: {}, player: p.player }; stats.push(statById[pid]); }
    return statById[pid].stats;
  }
  function add(pid, d, pts) {
    var s = stat(pid);
    Object.keys(d).forEach(function (k) { s[k] = r2((s[k] || 0) + d[k]); });
    ["pts_ppr", "pts_half_ppr", "pts_std"].forEach(function (k, i) { s[k] = r2((s[k] || 0) + pts[i]); });
  }

  /* ---------------------------------------------------------------- game simulation */
  var ORD = ["", "1st", "2nd", "3rd", "4th"];
  var sim = {};
  sb.events.forEach(function (e) {
    var c = e.competitions[0], t = {};
    c.competitors.forEach(function (x) { t[x.homeAway] = x; });
    sim[e.id] = { e: e, c: c, away: t.away, home: t.home, poss: rnd() < 0.5 ? "away" : "home", yard: 40 + Math.floor(rnd() * 40), down: 1, togo: 10 };
  });
  function abbr(x) { return x.team.abbreviation; }
  function slp(a) { return a === "WSH" ? "WAS" : a; }
  function players(team, pos) { return ((byTeam[slp(team)] || {})[pos] || []); }
  function w(r) { return Math.max(1, r.stats.pts_ppr || 1); }
  function flip(g, yard) { g.poss = g.poss === "away" ? "home" : "away"; g.yard = yard; g.down = 1; g.togo = 10; }
  function score(g, n) { var x = g[g.poss]; x.score = String(parseInt(x.score, 10) + n); }

  function play(g) {
    var st = g.e.status, off = g[g.poss], def = g[g.poss === "away" ? "home" : "away"], team = abbr(off), text = "";
    st.clock -= 22 + Math.floor(rnd() * 22);
    if (st.clock <= 0) {
      st.period++; st.clock = 900;
      if (st.period > 4) { st.type.state = "post"; st.type.shortDetail = "Final"; g.c.situation = { lastPlay: { text: "" } }; return; }
    }
    var qb = players(team, "QB")[0], isPass = rnd() < 0.58;
    var gain = Math.round(isPass ? (rnd() < 0.36 ? 0 : 3 + rnd() * rnd() * 34) : -2 + rnd() * rnd() * 16);
    if (g.yard <= 20) gain = Math.round(gain * 0.75);
    var td = gain >= g.yard; if (td) gain = g.yard;
    var kicker = players(team, "K")[0];
    if (rnd() < 0.022 && qb && isPass) {                                  /* interception */
      add(qb.player_id, { pass_int: 1 }, [-1, -1, -1]);
      text = qb.player.last_name + " pass intercepted";
      flip(g, Math.max(20, Math.min(80, 100 - g.yard)));
    } else {
      if (isPass && qb && gain > 0) {
        var rc = pick(players(team, "WR").concat(players(team, "TE"), players(team, "RB").slice(0, 1)), w);
        if (rc) add(rc.player_id, { rec: 1, rec_yd: gain, rec_td: td ? 1 : 0 }, [1 + gain * 0.1 + (td ? 6 : 0), 0.5 + gain * 0.1 + (td ? 6 : 0), gain * 0.1 + (td ? 6 : 0)]);
        var qp = gain * 0.04 + (td ? 4 : 0);
        add(qb.player_id, { pass_yd: gain, pass_td: td ? 1 : 0 }, [qp, qp, qp]);
        text = qb.player.last_name + " pass to " + (rc ? rc.player.last_name : "receiver") + " for " + gain + " yards" + (td ? ", TOUCHDOWN" : "");
      } else if (!isPass) {
        var rb = pick(players(team, "RB").concat(qb ? [qb] : []), function (r) { return r === qb ? 2 : w(r); });
        if (rb) { var rp = gain * 0.1 + (td ? 6 : 0); add(rb.player_id, { rush_yd: gain, rush_td: td ? 1 : 0 }, [rp, rp, rp]); }
        text = (rb ? rb.player.last_name : team) + " run for " + gain + " yards" + (td ? ", TOUCHDOWN" : "");
      } else text = (qb ? qb.player.last_name : team) + " pass incomplete";
      if (td) {
        score(g, 7);
        if (kicker) add(kicker.player_id, { xpm: 1 }, [1, 1, 1]);
        flip(g, 75);
      } else {
        g.yard -= gain; g.togo -= gain; g.down++;
        if (g.togo <= 0) { g.down = 1; g.togo = Math.min(10, g.yard); }
        else if (g.down > 4) {
          if (g.yard <= 36) { score(g, 3); if (kicker) add(kicker.player_id, { fgm: 1 }, [3, 3, 3]); text = (kicker ? kicker.player.last_name : team) + " " + (g.yard + 17) + " yard field goal is GOOD"; flip(g, 75); }
          else { text = team + " punts"; flip(g, Math.max(15, Math.min(90, 100 - g.yard + 42))); }
        }
      }
    }
    off = g[g.poss]; def = g[g.poss === "away" ? "home" : "away"];
    var where = g.yard <= 50 ? abbr(def) + " " + g.yard : abbr(off) + " " + (100 - g.yard);
    g.c.situation = { down: g.down, isRedZone: g.yard <= 20, possession: off.team.id, possessionText: where,
      downDistanceText: ORD[g.down] + " & " + (g.togo >= g.yard ? "Goal" : g.togo) + " at " + where, lastPlay: { text: text } };
    var m = Math.floor(st.clock / 60), s = Math.floor(st.clock % 60);
    st.type.shortDetail = m + ":" + (s < 10 ? "0" : "") + s + " - " + ORD[st.period];
  }
  var ticks = 0;
  function step() {
    ticks++;
    Object.keys(sim).forEach(function (id) { var g = sim[id]; if (g.e.status.type.state === "in" && rnd() < 0.6) play(g); });
  }

  /* ---------------------------------------------------------------- fictional leagues */
  var NAMES = [
    ["The Office League", "Taco Corp", "Mahomes Alone", "espn"],
    ["Sunday Scaries Dynasty", "Ja'Marr the Merrier", "Bijan Mustard", "sleeper"],
    ["College Buddies", "Lamb Chop", "Kittle Big Planet", "sleeper"],
    ["Family Feud", "Hurts So Good", "Dak to the Future", "sleeper"],
    ["Work Rivals", "Kelce Grammar", "Chubb Hub", "espn"]
  ];
  var SHAPE = [["QB", 1], ["RB", 2], ["WR", 2], ["TE", 1], ["FLEX", 1], ["K", 1], ["DEF", 1]];
  /* each league is a little two-team snake draft from the projection rankings, so the matchups are fair fights */
  var OFFSET = [0, 7, 3, 11, 5], MEFIRST = [1, 0, 0, 1, 1];
  function draft(li) {
    var taken = {}, sides = [[], []], turn = MEFIRST[li] ? 0 : 1;
    SHAPE.forEach(function (sh, si) {
      var pool = sh[0] === "FLEX" ? byPos.WR.concat(byPos.RB).sort(function (a, b) { return (b.stats.pts_ppr || 0) - (a.stats.pts_ppr || 0); }) : byPos[sh[0]];
      var i = (OFFSET[li] + si * 2 + (sh[0] === "FLEX" ? 22 : 0)) % Math.max(1, pool.length - 8);
      for (var k = 0; k < sh[1] * 2; i++) {
        var r = pool[i % pool.length];
        if (taken[r.player_id]) continue;
        taken[r.player_id] = 1; sides[turn].push(r.player_id); turn = 1 - turn; k++;
      }
    });
    return sides;
  }
  var leagueDefs = NAMES.map(function (n, li) { var d = draft(li); return { n: n, mine: d[0], theirs: d[1] }; });
  /* a little overlap, so one player can matter in two leagues at once - and help in one while hurting in another */
  if (leagueDefs[1] && leagueDefs[0]) { leagueDefs[1].mine[3] = leagueDefs[0].mine[3]; leagueDefs[2].theirs[1] = leagueDefs[0].mine[1]; }

  function sleeperRaw(n) {
    var rec = [[6, 3], [4, 5], [7, 2], [5, 4], [3, 6]];
    return { userId: "me", leagues: leagueDefs.slice(0, n).map(function (L, li) {
      var key = li === 2 ? "pts_half_ppr" : "pts_ppr";
      var pts = function (ids) { return ids.map(function (pid) { return +((statById[pid] || { stats: {} }).stats[key] || 0); }); };
      var sum = function (x) { return r2(x.reduce(function (s, v) { return s + v; }, 0)); };
      return { league: { name: L.n[0], league_id: "demo" + li, scoring_settings: { rec: li === 2 ? 0.5 : 1 } },
        users: [{ user_id: "me", display_name: L.n[1] }, { user_id: "op" + li, display_name: L.n[2] }],
        rosters: [{ roster_id: 1, owner_id: "me", settings: { wins: rec[li][0], losses: rec[li][1] } }, { roster_id: 2, owner_id: "op" + li, settings: { wins: rec[4 - li][0], losses: rec[4 - li][1] } }],
        matchups: [{ roster_id: 1, matchup_id: 1, starters: L.mine, starters_points: pts(L.mine), points: sum(pts(L.mine)) },
          { roster_id: 2, matchup_id: 1, starters: L.theirs, starters_points: pts(L.theirs), points: sum(pts(L.theirs)) }] };
    }) };
  }

  /* ---------------------------------------------------------------- fictional DraftKings lineups */
  function dkRaw(n) {
    var salaries = {}, lineups = [];
    function p(pos, i) {
      var pool = byPos[pos], r = pool[i % pool.length], id = String(40000000 + (pos.charCodeAt(0) * 1000 + (i % pool.length)) * 7);
      var name = pos === "DEF" ? r.player.last_name : r.player.first_name + " " + r.player.last_name;
      salaries[id] = { name: name, pos: pos === "DEF" ? "DST" : pos, sal: Math.round((3000 + (r.stats.pts_ppr || 5) * 260) / 100) * 100, team: r.team, avg: r.stats.pts_ppr || 0 };
      return { name: name, dkId: id };
    }
    for (var s = 0; s < n; s++) {
      var core = s % 3;                           /* three QB stacks shared across lineups, so exposure means something */
      var sl = [["QB", p("QB", core * 2)], ["RB", p("RB", core)], ["RB", p("RB", 3 + s)], ["WR", p("WR", core * 2)], ["WR", p("WR", 5 + s)],
        ["WR", p("WR", 11 + s * 2)], ["TE", p("TE", s % 4)], ["FLEX", p(s % 2 ? "RB" : "WR", 16 + s)], ["DST", p("DEF", s % 5)]];
      lineups.push({ entry: "demo" + s, contest: s < 4 || n <= 4 ? "Sunday $5 Tournament" : "Sunday $20 Double Up", contestId: s < 4 || n <= 4 ? "d1" : "d2", fee: s < 4 || n <= 4 ? 5 : 20,
        players: sl.map(function (x) { return { slot: x[0], name: x[1].name, dkId: x[1].dkId }; }) });
    }
    return { lineups: lineups, salaries: salaries };
  }

  window.SCC_DEMO = {
    step: step,
    ticks: function () { return ticks; },
    platform: function (leagueId) { var i = +String(leagueId).replace("demo", ""); return NAMES[i] ? NAMES[i][3] : "sleeper"; },
    leaguesList: function (n) { return NAMES.slice(0, n).map(function (x, i) { return { id: "demo" + i, name: x[0], team: x[1], platform: x[3] }; }); },
    raw: function (opts) {
      return { season: D.season, week: D.week, scoreboard: opts.noScoreboard ? null : sb, schedule: [], stats: stats, projections: D.projections,
        sleeper: opts.leagues > 0 ? sleeperRaw(opts.leagues) : null, espn: [], dk: opts.dfs ? dkRaw(opts.dfs) : { lineups: [], salaries: {} } };
    }
  };
})();
