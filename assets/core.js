/* Sunday Command Center - core logic (no DOM). Works in the browser and in Node for tests.
 * Data sources (all public, CORS-enabled, no keys):
 *   Sleeper  https://api.sleeper.app/v1/...      users, leagues, rosters, matchups
 *   Sleeper  https://api.sleeper.com/stats|projections/nfl/{season}/{week}
 *   ESPN     https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SCC = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ESPN2SLP = { WSH: "WAS" };
  var DK2SLP = { WSH: "WAS", JAC: "JAX", LA: "LAR" };
  var NICK = { cardinals: "ARI", falcons: "ATL", ravens: "BAL", bills: "BUF", panthers: "CAR", bears: "CHI", bengals: "CIN",
    browns: "CLE", cowboys: "DAL", broncos: "DEN", lions: "DET", packers: "GB", texans: "HOU", colts: "IND", jaguars: "JAX",
    chiefs: "KC", raiders: "LV", chargers: "LAC", rams: "LAR", dolphins: "MIA", vikings: "MIN", patriots: "NE", saints: "NO",
    giants: "NYG", jets: "NYJ", eagles: "PHI", steelers: "PIT", "49ers": "SF", seahawks: "SEA", buccaneers: "TB", titans: "TEN",
    commanders: "WAS" };
  var POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

  function urls(season, week) {
    var pos = POSITIONS.map(function (p) { return "position[]=" + p; }).join("&");
    return {
      state: "https://api.sleeper.app/v1/state/nfl",
      user: function (u) { return "https://api.sleeper.app/v1/user/" + encodeURIComponent(u); },
      leagues: function (uid) { return "https://api.sleeper.app/v1/user/" + uid + "/leagues/nfl/" + season; },
      rosters: function (lid) { return "https://api.sleeper.app/v1/league/" + lid + "/rosters"; },
      users: function (lid) { return "https://api.sleeper.app/v1/league/" + lid + "/users"; },
      matchups: function (lid) { return "https://api.sleeper.app/v1/league/" + lid + "/matchups/" + week; },
      stats: "https://api.sleeper.com/stats/nfl/" + season + "/" + week + "?season_type=regular&" + pos,
      projections: "https://api.sleeper.com/projections/nfl/" + season + "/" + week + "?season_type=regular&" + pos,
      scoreboard: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
      schedule: "https://api.sleeper.com/schedule/nfl/regular/" + season
    };
  }

  function norm(name) {
    return String(name || "").toLowerCase().replace(/[.'’]/g, "").replace(/-/g, " ")
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();
  }
  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }

  /* ------------------------------------------------------------ scoring */
  function dkPoints(s, pos) {
    s = s || {};
    var g = function (k) { return num(s[k]); };
    if (pos === "DEF" || pos === "DST") {
      var pa = g("pts_allow");
      var tier = pa === 0 ? 10 : pa <= 6 ? 7 : pa <= 13 ? 4 : pa <= 20 ? 1 : pa <= 27 ? 0 : pa <= 34 ? -1 : -4;
      return round2(g("sack") + 2 * g("int") + 2 * g("fum_rec") + 6 * (g("def_td") + g("def_st_td")) +
        2 * g("safe") + 2 * g("blk_kick") + 2 * g("def_2pt") + tier);
    }
    var p = 0.04 * g("pass_yd") + 4 * g("pass_td") - g("pass_int") + 0.1 * g("rush_yd") + 6 * g("rush_td") +
      g("rec") + 0.1 * g("rec_yd") + 6 * g("rec_td") + 2 * (g("pass_2pt") + g("rush_2pt") + g("rec_2pt")) -
      g("fum_lost") + 6 * (g("kr_td") + g("pr_td") + g("fum_rec_td") + g("st_td"));
    if (g("pass_yd") >= 300) p += 3;
    if (g("rush_yd") >= 100) p += 3;
    if (g("rec_yd") >= 100) p += 3;
    return round2(p);
  }
  function tdCount(s) {
    s = s || {};
    return ["pass_td", "rush_td", "rec_td", "def_td", "def_st_td", "kr_td", "pr_td", "fum_rec_td"]
      .reduce(function (a, k) { return a + Math.round(num(s[k])); }, 0);
  }
  function round2(x) { return Math.round(x * 100) / 100; }
  function round1(x) { return Math.round(x * 10) / 10; }
  function leaguePtsKey(scoring) {
    var r = scoring ? num(scoring.rec) : 1;
    return r >= 0.99 ? "pts_ppr" : r >= 0.49 ? "pts_half_ppr" : "pts_std";
  }

  /* ------------------------------------------------------------ CSV / DK import */
  function parseCSV(text) {
    var rows = [], row = [], cell = "", q = false, i, c;
    text = String(text || "").replace(/^\uFEFF/, "");
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  var NAMEID = /^\s*(.+?)\s*\((\d{5,})\)\s*$/;
  var SLOTS = ["QB", "RB", "WR", "TE", "FLEX", "DST", "CPT", "SUPERFLEX", "SFLEX", "K"];

  /* Accepts: DK upload template / edited upload CSV, the "Export to CSV" of your entries
   * (Entry ID, Contest Name, Contest ID, Entry Fee, QB...DST + embedded salary table),
   * DKSalaries.csv, or pasted text with one lineup per line ("Name (ID), Name (ID), ...").
   * Returns {lineups:[...], salaries:{dkId:{...}}} */
  function parseDK(text) {
    var rows = parseCSV(text), sal = {}, lineups = [], hdr = null, salCol = -1, r, i;
    for (r = 0; r < rows.length; r++) {
      var row = rows[r];
      var k = row.indexOf("Name + ID");
      if (k >= 0 && row[k + 2] === "ID") { salCol = k - 1; continue; }
      if (salCol >= 0 && row[salCol + 3] && /^\d+$/.test(row[salCol + 3])) {
        var t = row[salCol + 7];
        sal[row[salCol + 3]] = { name: row[salCol + 2], pos: row[salCol], sal: num(row[salCol + 5]), game: row[salCol + 6],
          team: DK2SLP[t] || t, avg: num(row[salCol + 8]) };
      }
    }
    for (r = 0; r < rows.length; r++) {
      var rw = rows[r], lim = salCol > 0 ? salCol : rw.length;
      if (!hdr && rw.slice(0, lim).some(function (c) { return SLOTS.indexOf(String(c).trim().toUpperCase()) >= 0; }) &&
          !rw.slice(0, lim).some(function (c) { return NAMEID.test(c); })) { hdr = rw; continue; }
      var cells = [];
      for (i = 0; i < lim; i++) if (NAMEID.test(rw[i] || "")) cells.push(i);
      if (cells.length < 6) continue;
      var lu = { entry: "", contest: "", contestId: "", fee: 0, players: [] };
      if (hdr) {
        var get = function (name) { var j = hdr.indexOf(name); return j >= 0 ? (rw[j] || "") : ""; };
        lu.entry = get("Entry ID"); lu.contest = get("Contest Name"); lu.contestId = get("Contest ID");
        lu.fee = num(String(get("Entry Fee")).replace(/[$,]/g, ""));
      }
      cells.forEach(function (ci) {
        var m = NAMEID.exec(rw[ci]);
        var slot = hdr && hdr[ci] ? String(hdr[ci]).trim().toUpperCase() : "";
        lu.players.push({ slot: slot, name: m[1], dkId: m[2] });
      });
      if (!hdr) { // pasted lines: classic slot order
        var cls = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"];
        lu.players.forEach(function (p, j) { p.slot = cls[j] || ""; });
      }
      lineups.push(lu);
    }
    return { lineups: lineups, salaries: sal };
  }

  /* ------------------------------------------------------------ ESPN */
  function parseScoreboard(sb, nowMs) {
    var games = [], teamGame = {};
    ((sb && sb.events) || []).forEach(function (e) {
      var c = e.competitions[0], st = e.status, comp = {}, ids = {};
      c.competitors.forEach(function (x) {
        comp[x.homeAway] = x;
        ids[x.team.id] = ESPN2SLP[x.team.abbreviation] || x.team.abbreviation;
      });
      var sit = c.situation || {}, state = st.type.state, per = st.period || 0, clock = num(st.clock), frac;
      if (state === "pre") frac = 1; else if (state === "post") frac = 0;
      else { var el = per <= 4 ? (per - 1) * 900 + (900 - clock) : 3600; frac = Math.max(0, Math.min(1, 1 - el / 3600)); }
      var rz = false;
      if (state === "in" && num(sit.down) > 0) {
        rz = !!sit.isRedZone;
        var m = /^([A-Z]{2,3}) (\d+)$/.exec(sit.possessionText || "");
        if (!rz && m) { var side = ESPN2SLP[m[1]] || m[1]; rz = side !== ids[sit.possession] && +m[2] <= 20; }
      }
      var g = {
        id: e.id, kick: e.date, away: ids[comp.away.team.id], home: ids[comp.home.team.id],
        as: Math.round(num(comp.away.score)), hs: Math.round(num(comp.home.score)),
        state: state, detail: st.type.shortDetail || "", poss: state === "in" ? (ids[sit.possession] || null) : null,
        rz: rz, dd: sit.downDistanceText || "", last: ((sit.lastPlay || {}).text || "").slice(0, 180),
        tv: (c.broadcasts || []).map(function (b) { return (b.names || []).join(", "); }).join(", "), remain: Math.round(frac * 1000) / 1000
      };
      games.push(g); teamGame[g.away] = g; teamGame[g.home] = g;
    });
    return { games: games, teamGame: teamGame };
  }

  /* Fallback when ESPN is unreachable: Sleeper's schedule (status only) + DEF points allowed as the score. */
  function scheduleToScoreboard(schedule, week, stats) {
    var pa = {};
    (stats || []).forEach(function (r) { if (/^[A-Z]+$/.test(r.player_id)) pa[r.player_id] = num((r.stats || {}).pts_allow); });
    var games = [], teamGame = {};
    (schedule || []).filter(function (g) { return String(g.week) === String(week); }).forEach(function (s) {
      var state = s.status === "complete" ? "post" : s.status === "in_game" ? "in" : "pre";
      var g = { id: s.game_id, kick: s.date + "T17:00:00Z", away: s.away, home: s.home, as: Math.round(pa[s.home] || 0), hs: Math.round(pa[s.away] || 0),
        state: state, detail: state === "in" ? "Live" : state === "post" ? "Final" : s.date, poss: null, rz: false, dd: "", last: "", tv: "",
        remain: state === "pre" ? 1 : state === "post" ? 0 : 0.5, fallback: true };
      games.push(g); teamGame[g.away] = g; teamGame[g.home] = g;
    });
    return { games: games, teamGame: teamGame };
  }

  /* ------------------------------------------------------------ Sleeper stats */
  function statMaps(stats, projs) {
    var S = {}, P = {}, info = {};
    [[projs, P], [stats, S]].forEach(function (pair) {
      (pair[0] || []).forEach(function (r) {
        pair[1][r.player_id] = r.stats || {};
        var pl = r.player || {};
        if (pl.first_name || pl.last_name) {
          info[r.player_id] = { name: ((pl.first_name || "") + " " + (pl.last_name || "")).trim(),
            pos: pl.position || (pl.fantasy_positions || ["?"])[0], team: r.team || pl.team, inj: pl.injury_status || null };
        }
      });
    });
    return { S: S, P: P, info: info };
  }

  function playerRow(pid, pts, m, teamGame, key) {
    var i = m.info[pid] || { name: pid, pos: /^[A-Z]+$/.test(pid) ? "DEF" : "?", team: /^[A-Z]+$/.test(pid) ? pid : null };
    var g = teamGame[i.team];
    var proj = num((m.P[pid] || {})[key || "pts_ppr"]);
    var remain = g ? g.remain : 0;
    pts = num(pts);
    return { id: pid, name: i.name, pos: i.pos, team: i.team, pts: round2(pts), proj: round1(proj),
      live: round1(pts + proj * remain), remainProj: proj * remain, status: g ? g.state : "bye", rz: !!(g && g.rz),
      poss: !!(g && g.poss === i.team), inj: i.inj, game: g ? g.id : null };
  }

  function erf(x) { // Abramowitz-Stegun
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  }
  function winProb(me, opp) {
    var rem = me.remainProj + opp.remainProj;
    if (rem < 0.5) return me.pts > opp.pts ? 1 : me.pts < opp.pts ? 0 : 0.5;
    var sd = 1.1 * Math.sqrt(rem) + 1;
    return 0.5 * (1 + erf((me.live - opp.live) / (sd * Math.SQRT2)));
  }

  /* raw = {userId, leagues:[{league, rosters, users, matchups}]} */
  function buildSleeper(raw, m, teamGame) {
    var out = [];
    (raw.leagues || []).forEach(function (L) {
      var lg = L.league, uid = raw.userId, key = leaguePtsKey(lg.scoring_settings);
      var mine = (L.rosters || []).filter(function (r) { return r.owner_id === uid || (r.co_owners || []).indexOf(uid) >= 0; })[0];
      if (!mine) return;
      var mu = (L.matchups || []).filter(function (x) { return x.roster_id === mine.roster_id; })[0];
      if (!mu) return;
      var om = (L.matchups || []).filter(function (x) { return x.matchup_id && x.matchup_id === mu.matchup_id && x.roster_id !== mu.roster_id; })[0];
      var orost = om ? (L.rosters || []).filter(function (r) { return r.roster_id === om.roster_id; })[0] : null;
      var uname = {};
      (L.users || []).forEach(function (u) { uname[u.user_id] = (u.metadata && u.metadata.team_name) || u.display_name; });
      function side(x, roster) {
        if (!x) return null;
        var starters = x.starters || [], sp = x.starters_points || [], rows = [];
        starters.forEach(function (pid, j) { if (pid && pid !== "0") rows.push(playerRow(pid, sp[j], m, teamGame, key)); });
        var pts = num(x.custom_points != null ? x.custom_points : x.points);
        var remainProj = rows.reduce(function (a, r) { return a + r.remainProj; }, 0);
        var st = (roster && roster.settings) || {};
        return { name: (roster && uname[roster.owner_id]) || "Opponent", pts: round2(pts), live: round1(pts + remainProj), remainProj: remainProj,
          proj: round1(rows.reduce(function (a, r) { return a + r.proj; }, 0)), starters: rows,
          empty: starters.filter(function (p) { return !p || p === "0"; }).length,
          yet: rows.filter(function (r) { return r.status === "pre"; }).length,
          playing: rows.filter(function (r) { return r.status === "in"; }).length,
          record: (st.wins || 0) + "-" + (st.losses || 0) + (st.ties ? "-" + st.ties : "") };
      }
      var me = side(mu, mine), opp = side(om, orost);
      out.push({ league: String(lg.name || "").trim(), leagueId: lg.league_id, me: me, opp: opp,
        winProb: opp ? winProb(me, opp) : null, scoring: key });
    });
    return out;
  }

  /* dk = {lineups:[...], salaries:{...}} from parseDK (possibly merged across files) */
  function buildDK(dk, m, teamGame) {
    dk = dk || { lineups: [], salaries: {} };
    var byName = {}, sal = dk.salaries || {};
    Object.keys(m.info).forEach(function (pid) {
      var i = m.info[pid], k = norm(i.name);
      (byName[k] = byName[k] || []).push(pid);
      if (i.pos === "DEF") byName["def:" + pid] = [pid];
    });
    function resolve(p) {
      var s = sal[p.dkId] || {}, pos = s.pos || p.slot, team = s.team;
      var nick = NICK[norm(p.name)] || NICK[norm(p.name).split(" ").pop()];
      var isDef = pos === "DST" || p.slot === "DST" || (nick && norm(p.name).split(" ").length <= 3 && !byName[norm(p.name)]);
      if (isDef) {
        var t = team || nick || null;
        return { sid: t && byName["def:" + t] ? t : null, team: t, pos: "DST" };
      }
      var c = byName[norm(p.name)] || [];
      if (c.length > 1 && team) c = c.filter(function (pid) { return m.info[pid].team === team; });
      if (c.length > 1) c = c.filter(function (pid) { return ["QB", "RB", "WR", "TE"].indexOf(m.info[pid].pos) >= 0; });
      var sid = c[0] || null;
      return { sid: sid, team: team || (sid ? m.info[sid].team : null), pos: pos || (sid ? m.info[sid].pos : "") };
    }
    var lineups = (dk.lineups || []).map(function (lu, n) {
      var players = lu.players.map(function (p) {
        var r = resolve(p), st = r.sid ? (m.S[r.sid] || {}) : {}, g = teamGame[r.team];
        var pts = r.sid ? dkPoints(st, r.pos) : 0;
        var proj = r.sid && m.P[r.sid] ? dkPoints(m.P[r.sid], r.pos) : num((sal[p.dkId] || {}).avg);
        var remain = g ? g.remain : 0;
        return { slot: p.slot, name: p.name, dkId: p.dkId, sid: r.sid, pos: r.pos, team: r.team, sal: (sal[p.dkId] || {}).sal || null,
          pts: pts, proj: round1(proj), live: round1(pts + proj * remain), tds: tdCount(st),
          status: g ? g.state : (r.team ? "bye" : "?"), rz: !!(g && g.rz), poss: !!(g && g.poss === r.team), matched: !!r.sid };
      });
      var sum = function (f) { return players.reduce(function (a, x) { return a + (f(x) || 0); }, 0); };
      return { n: n + 1, entry: lu.entry, contest: lu.contest, contestId: lu.contestId, fee: lu.fee, players: players,
        pts: round2(sum(function (x) { return x.pts; })), proj: round1(sum(function (x) { return x.proj; })),
        live: round1(sum(function (x) { return x.live; })), sal: sum(function (x) { return x.sal; }),
        yet: players.filter(function (x) { return x.status === "pre"; }).length,
        playing: players.filter(function (x) { return x.status === "in"; }).length };
    });
    var ex = {};
    lineups.forEach(function (lu) { lu.players.forEach(function (p) {
      var e = ex[p.dkId] || (ex[p.dkId] = Object.assign({}, p, { count: 0 })); e.count++; }); });
    var exposure = Object.keys(ex).map(function (k) { return ex[k]; })
      .sort(function (a, b) { return b.count - a.count || b.pts - a.pts; });
    exposure.forEach(function (e) { e.pct = Math.round(100 * e.count / Math.max(1, lineups.length)); });
    var contests = {};
    lineups.forEach(function (lu) {
      var k = lu.contestId || lu.contest || "Imported lineups";
      var c = contests[k] || (contests[k] = { name: lu.contest || "Imported lineups", id: lu.contestId, entries: 0, fees: 0 });
      c.entries++; c.fees += lu.fee || 0;
    });
    return { lineups: lineups, exposure: exposure, contests: Object.keys(contests).map(function (k) { return contests[k]; }),
      unmatched: exposure.filter(function (e) { return !e.matched; }).map(function (e) { return e.name; }) };
  }

  function buildInterest(sleeper, dk, m, teamGame, games) {
    var it = {};
    function add(pid, row) {
      return it[pid] || (it[pid] = { name: row.name, team: row.team, mine: [], opp: [], dk: 0, pts: 0, dkpts: 0, tds: 0 });
    }
    sleeper.forEach(function (mu) {
      [["me", "mine"], ["opp", "opp"]].forEach(function (pair) {
        ((mu[pair[0]] || {}).starters || []).forEach(function (r) { add(r.id, r)[pair[1]].push(mu.league); });
      });
    });
    dk.lineups.forEach(function (lu) { lu.players.forEach(function (p) { if (p.sid) add(p.sid, p).dk++; }); });
    Object.keys(it).forEach(function (pid) {
      var st = m.S[pid] || {}, x = it[pid];
      x.pts = round2(num(st.pts_ppr)); x.tds = tdCount(st); x.dkpts = dkPoints(st, /^[A-Z]+$/.test(pid) ? "DEF" : "");
    });
    games.forEach(function (g) { g.mine = 0; g.against = 0; g.dk = 0; g.names = []; });
    Object.keys(it).forEach(function (pid) {
      var x = it[pid], g = teamGame[x.team];
      if (!g) return;
      g.mine += x.mine.length; g.against += x.opp.length; g.dk += x.dk;
      if (x.mine.length || x.dk) g.names.push(x.name);
    });
    return it;
  }

  /* everything -> one view-model */
  function buildState(raw) {
    var sb = raw.scoreboard ? parseScoreboard(raw.scoreboard) : scheduleToScoreboard(raw.schedule, raw.week, raw.stats);
    var m = statMaps(raw.stats, raw.projections);
    var sleeper = raw.sleeper ? buildSleeper(raw.sleeper, m, sb.teamGame) : [];
    var dk = buildDK(raw.dk, m, sb.teamGame);
    var interest = buildInterest(sleeper, dk, m, sb.teamGame, sb.games);
    return { week: raw.week, season: raw.season, scoreSource: raw.scoreboard ? "espn" : "sleeper-schedule", games: sb.games, sleeper: sleeper, dk: dk, interest: interest };
  }

  /* diff two interest maps -> scoring events */
  function diffEvents(prev, next, minDelta) {
    var ev = [];
    if (!prev) return ev;
    minDelta = minDelta || 1.5;
    Object.keys(next).forEach(function (pid) {
      var a = prev[pid], b = next[pid];
      if (!a) return;
      var d = round2(b.pts - a.pts), dd = round2(b.dkpts - a.dkpts), td = b.tds > a.tds;
      if (Math.abs(d) < minDelta && Math.abs(dd) < minDelta && !td) return;
      var good = b.mine.length + b.dk > 0, bad = b.opp.length > 0;
      ev.push({ pid: pid, name: b.name, team: b.team, delta: d, dkDelta: dd, td: td, mine: b.mine, opp: b.opp, dk: b.dk,
        tone: good && bad ? "mix" : good ? (d < 0 ? "bad" : "good") : (d < 0 ? "good" : "bad") });
    });
    return ev;
  }

  return { urls: urls, norm: norm, dkPoints: dkPoints, tdCount: tdCount, parseCSV: parseCSV, parseDK: parseDK,
    parseScoreboard: parseScoreboard, scheduleToScoreboard: scheduleToScoreboard, statMaps: statMaps, buildSleeper: buildSleeper, buildDK: buildDK,
    buildState: buildState, diffEvents: diffEvents, winProb: winProb, leaguePtsKey: leaguePtsKey, NICK: NICK };
});
