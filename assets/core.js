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

  /* seasonType: "regular" (default) or "post"; sbWeek: only set when the week is overridden (?week=) so the
   * ESPN scoreboard shows the same week as the stats. */
  function urls(season, week, seasonType, sbWeek) {
    var pos = POSITIONS.map(function (p) { return "position[]=" + p; }).join("&");
    var st = seasonType === "post" ? "post" : "regular";
    return {
      state: "https://api.sleeper.app/v1/state/nfl",
      user: function (u) { return "https://api.sleeper.app/v1/user/" + encodeURIComponent(u); },
      leagues: function (uid) { return "https://api.sleeper.app/v1/user/" + uid + "/leagues/nfl/" + season; },
      rosters: function (lid) { return "https://api.sleeper.app/v1/league/" + lid + "/rosters"; },
      users: function (lid) { return "https://api.sleeper.app/v1/league/" + lid + "/users"; },
      matchups: function (lid) { return "https://api.sleeper.app/v1/league/" + lid + "/matchups/" + week; },
      stats: "https://api.sleeper.com/stats/nfl/" + season + "/" + week + "?season_type=" + st + "&" + pos,
      projections: "https://api.sleeper.com/projections/nfl/" + season + "/" + week + "?season_type=" + st + "&" + pos,
      scoreboard: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard" +
        (sbWeek ? "?seasontype=" + (st === "post" ? 3 : 2) + "&week=" + encodeURIComponent(sbWeek) + "&dates=" + encodeURIComponent(season) : ""),
      schedule: "https://api.sleeper.com/schedule/nfl/" + st + "/" + season
    };
  }

  function norm(name) {
    return String(name || "").toLowerCase().replace(/[.'’]/g, "").replace(/-/g, " ")
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();
  }
  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
  /* HTML-escape anything that came from a user, a file or an API before it goes into innerHTML. */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"'`]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c];
    });
  }
  /* Only http(s) links are allowed for user-entered URLs (blocks javascript:, data:, etc.). */
  function safeUrl(u) {
    u = String(u || "").trim();
    return /^https?:\/\/[^\s"'<>`]+$/i.test(u) ? u : "";
  }

  /* ------------------------------------------------------------ scoring */
  /* DraftKings NFL Classic scoring.
   * state = the team's game state ("pre" | "in" | "post" | "bye"), or "proj" for projections.
   * DST points-allowed tiers only apply once the game is live or final: Sleeper omits pts_allow when it is 0,
   * so a defense that hasn't played yet would otherwise get the 10-point shutout tier. With no state given,
   * the tier applies only if the stats show the team has played (gp / pts_allow / pts_allow_0). */
  function dstTierApplies(s, state) {
    if (state === "in" || state === "post" || state === "proj") return true;
    if (state === "pre" || state === "bye") return false;
    return num(s.gp) > 0 || s.pts_allow != null || num(s.pts_allow_0) > 0;
  }
  function paTier(pa) {
    return pa <= 0 ? 10 : pa <= 6 ? 7 : pa <= 13 ? 4 : pa <= 20 ? 1 : pa <= 27 ? 0 : pa <= 34 ? -1 : -4;
  }
  function dkPoints(s, pos, state) {
    s = s || {};
    var g = function (k) { return num(s[k]); };
    if (pos === "DEF" || pos === "DST") {
      var tier = dstTierApplies(s, state) ? paTier(g("pts_allow")) : 0;
      // fum_rec = defensive recoveries; def_st_fum_rec = special-teams recoveries (Sleeper splits them, DK counts both)
      return round2(g("sack") + 2 * g("int") + 2 * (g("fum_rec") + g("def_st_fum_rec")) + 6 * (g("def_td") + g("def_st_td")) +
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

  /* "Name (12345678)" with optional extra tags in parentheses before or after the ID, e.g. DraftKings'
   * "Name (12345678) (LOCKED)" for players whose game has started. Tags are stripped. */
  var NAMEID = /^\s*(.+?)\s*(?:\((?!\d{5,}\))[^()]*\)\s*)*\((\d{5,})\)\s*(?:\([^()]*\)\s*)*$/;
  var SLOTS = ["QB", "RB", "WR", "TE", "FLEX", "DST", "CPT", "SUPERFLEX", "SFLEX", "K"];
  var CLASSIC = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"];
  function parseCell(c) {
    var m = NAMEID.exec(String(c || ""));
    if (!m) return null;
    var name = m[1].replace(/\s*\([^()]*\)\s*$/g, "").trim();
    return name ? { name: name, dkId: m[2] } : null;
  }

  /* Accepts: DKEntries.csv (Lineups -> Edit Entries -> Download: Entry ID, Contest Name, Contest ID, Entry Fee,
   * QB...DST + embedded player table), the bulk upload template / edited upload CSV, DKSalaries.csv, or pasted
   * text with one lineup per line ("Name (ID), Name (ID), ...").
   * Never drops a lineup silently: a lineup with empty or unreadable slots is kept, and each problem is listed
   * in lu.missing and in the returned warnings.
   * Returns {lineups:[...], salaries:{dkId:{...}}, warnings:[string]} */
  function parseDK(text) {
    var rows = parseCSV(text), sal = {}, lineups = [], hdr = null, salCol = -1, r, i, warnings = [];
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
    var slotCols = [];
    for (r = 0; r < rows.length; r++) {
      var rw = rows[r], lim = salCol >= 0 ? salCol : rw.length;   // DKSalaries.csv: salCol 0 -> no lineup columns
      var isSlot = function (c) { return SLOTS.indexOf(String(c).trim().toUpperCase()) >= 0; };
      if (!hdr && rw.slice(0, lim).some(isSlot) && !rw.slice(0, lim).some(function (c) { return !!parseCell(c); })) {
        hdr = rw; slotCols = [];
        for (i = 0; i < Math.min(hdr.length, lim); i++) if (isSlot(hdr[i])) slotCols.push(i);
        continue;
      }
      var cells = [];
      for (i = 0; i < lim; i++) if (parseCell(rw[i])) cells.push(i);
      var lu = { entry: "", contest: "", contestId: "", fee: 0, players: [], missing: [] };
      if (hdr && slotCols.length) {
        var get = function (name) { var j = hdr.indexOf(name); return j >= 0 ? (rw[j] || "") : ""; };
        lu.entry = get("Entry ID"); lu.contest = get("Contest Name"); lu.contestId = get("Contest ID");
        lu.fee = num(String(get("Entry Fee")).replace(/[$,]/g, ""));
        var anySlotText = slotCols.some(function (ci) { return String(rw[ci] || "").trim(); });
        // an entry row (has an Entry ID or anything in a slot column); skip the blank rows next to the player table
        if (!cells.length && !(lu.entry && /\d/.test(lu.entry)) && !anySlotText) continue;
        slotCols.forEach(function (ci) {
          var slot = String(hdr[ci]).trim().toUpperCase(), p = parseCell(rw[ci]);
          if (p) lu.players.push({ slot: slot, name: p.name, dkId: p.dkId });
          else lu.missing.push({ slot: slot, cell: String(rw[ci] || "").trim().slice(0, 60) });
        });
        if (hdr.some(function (c) { return String(c).trim().toUpperCase() === "CPT"; })) lu.showdown = true;
      } else {
        if (!cells.length) continue;
        if (cells.length < 6 && !/\(\d{5,}\)/.test(rw.join(" "))) continue;
        cells.forEach(function (ci, j) { var p = parseCell(rw[ci]); lu.players.push({ slot: CLASSIC[j] || "", name: p.name, dkId: p.dkId }); });
        for (i = lu.players.length; i < CLASSIC.length; i++) lu.missing.push({ slot: CLASSIC[i], cell: "" });
      }
      if (!lu.players.length && !lu.missing.length) continue;
      lu.showdown = !!lu.showdown || lu.players.some(function (p) { return p.slot === "CPT"; });
      lineups.push(lu);
      var label = "Lineup " + lineups.length + (lu.entry ? " (entry " + lu.entry + ")" : "");
      if (lu.missing.length) {
        warnings.push(label + ": " + lu.missing.length + " slot" + (lu.missing.length > 1 ? "s" : "") + " not read: " +
          lu.missing.map(function (x) { return x.slot + (x.cell ? " \u201c" + x.cell + "\u201d" : " (empty)"); }).join(", "));
      }
    }
    if (lineups.some(function (l) { return l.showdown; })) {
      warnings.push("Showdown lineups detected: scored with Classic rules and the 1.5\u00d7 captain multiplier; kickers score 0.");
    }
    return { lineups: lineups, salaries: sal, warnings: warnings };
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

  /* Fallback when ESPN is unreachable: Sleeper's schedule (status only) + DEF points allowed as the score.
   * Sleeper's schedule has a date but no kickoff time, so kick is a placeholder (used only for polling) and
   * kickTBD tells the UI not to show it as a time. */
  function scheduleToScoreboard(schedule, week, stats) {
    var pa = {};
    (stats || []).forEach(function (r) { if (/^[A-Z]+$/.test(r.player_id)) pa[r.player_id] = num((r.stats || {}).pts_allow); });
    var games = [], teamGame = {};
    (schedule || []).filter(function (g) { return String(g.week) === String(week); }).forEach(function (s) {
      var state = s.status === "complete" ? "post" : s.status === "in_game" ? "in" : "pre";
      var g = { id: s.game_id, kick: s.date + "T17:00:00Z", away: s.away, home: s.home, as: Math.round(pa[s.home] || 0), hs: Math.round(pa[s.away] || 0),
        state: state, detail: state === "in" ? "Live" : state === "post" ? "Final" : s.date, poss: null, rz: false, dd: "", last: "", tv: "",
        remain: state === "pre" ? 1 : state === "post" ? 0 : 0.5, fallback: true, kickTBD: true };   // Sleeper gives a date, not a time
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


  /* ------------------------------------------------------------ ESPN fantasy */
  var ESPN_HOST = "https://lm-api-reads.fantasy.espn.com";
  var ESPN_TEAM = { 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND",
    12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT",
    24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU" };
  var ESPN_POS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF", 9: "DL", 10: "LB", 11: "DL", 12: "DB", 13: "DB", 14: "DB", 15: "DL" };
  var ESPN_BENCH = { 20: 1, 21: 1, 24: 1 };   // bench, IR, (unused)
  var ESPN_SLOT_ORDER = { 0: 0, 7: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 23: 7, 16: 8, 17: 9 };

  function slotRank(id) { return id in ESPN_SLOT_ORDER ? ESPN_SLOT_ORDER[id] : 50; }
  function espnPath(season, leagueId, week) {
    return "/apis/v3/games/ffl/seasons/" + season + "/segments/0/leagues/" + encodeURIComponent(leagueId) +
      "?view=mMatchupScore&view=mTeam&view=mRoster&view=mBoxscore&view=mSettings" + (week ? "&scoringPeriodId=" + week : "");
  }
  function espnTeamName(t) {
    return t.name || ((t.location || "") + " " + (t.nickname || "")).trim() || t.abbrev || ("Team " + t.id);
  }
  /* list of {id, name, owner} for the team picker */
  function espnTeams(data) {
    var mem = {};
    (data.members || []).forEach(function (m) { mem[m.id] = m.displayName || ((m.firstName || "") + " " + (m.lastName || "")).trim(); });
    return (data.teams || []).map(function (t) {
      return { id: t.id, name: espnTeamName(t), owner: (t.owners || []).map(function (o) { return mem[o]; }).filter(Boolean).join(", ") };
    });
  }

  /* raw = [{cfg:{leagueId, season, teamId}, data:<league json>}] -> same card shape as buildSleeper */
  function buildESPN(raw, m, teamGame) {
    var idx = {};
    Object.keys(m.info).forEach(function (pid) { var i = m.info[pid]; idx[norm(i.name) + "|" + i.team] = pid; if (i.pos === "DEF") idx["def|" + pid] = pid; });
    var out = [];
    (raw || []).forEach(function (L) {
      var d = L.data, cfg = L.cfg;
      if (!d || !d.teams) return;
      var week = d.scoringPeriodId, period = (d.status || {}).currentMatchupPeriod;
      var mu = (d.schedule || []).filter(function (x) {
        return x.matchupPeriodId === period && ((x.home || {}).teamId === +cfg.teamId || (x.away || {}).teamId === +cfg.teamId);
      })[0];
      if (!mu) return;
      var mineSide = mu.home && mu.home.teamId === +cfg.teamId ? "home" : "away", oppSide = mineSide === "home" ? "away" : "home";
      var teams = {};
      d.teams.forEach(function (t) { teams[t.id] = t; });
      function side(x) {
        if (!x) return null;
        var t = teams[x.teamId] || {}, rec = (t.record || {}).overall || {};
        var roster = x.rosterForCurrentScoringPeriod || x.rosterForMatchupPeriod || { entries: [] };
        var rows = (roster.entries || []).filter(function (e) { return !ESPN_BENCH[e.lineupSlotId]; })
          .sort(function (a, b) { return slotRank(a.lineupSlotId) - slotRank(b.lineupSlotId); })
          .map(function (e) {
            var pe = e.playerPoolEntry || {}, pl = pe.player || {};
            var team = ESPN_TEAM[pl.proTeamId] || null, pos = ESPN_POS[pl.defaultPositionId] || "?";
            var stats = pl.stats || [], act = 0, proj = 0;
            stats.forEach(function (st) {
              if (st.scoringPeriodId !== week) return;
              if (st.statSourceId === 0) act = num(st.appliedTotal); else if (st.statSourceId === 1) proj = num(st.appliedTotal);
            });
            if (pe.appliedStatTotal != null) act = num(pe.appliedStatTotal);
            var sid = pos === "DEF" ? (idx["def|" + team] || team) : (idx[norm(pl.fullName) + "|" + team] || ("espn:" + pl.id));
            var g = teamGame[team], remain = g ? g.remain : 0;
            var name = pos === "DEF" ? ((m.info[team] || {}).name || pl.fullName) : pl.fullName;
            return { id: sid, name: name, pos: pos, team: team, pts: round2(act), proj: round1(proj), live: round1(act + proj * remain),
              remainProj: proj * remain, status: g ? g.state : "bye", rz: !!(g && g.rz), poss: !!(g && g.poss === team),
              inj: pl.injuryStatus && pl.injuryStatus !== "ACTIVE" ? pl.injuryStatus : null, game: g ? g.id : null };
          });
        var pts = num(x.totalPointsLive != null ? x.totalPointsLive : x.totalPoints);
        var remainProj = rows.reduce(function (a, r) { return a + r.remainProj; }, 0);
        return { name: espnTeamName(t), pts: round2(pts), live: round1(pts + remainProj), remainProj: remainProj,
          espnProj: x.totalProjectedPointsLive != null ? round1(num(x.totalProjectedPointsLive)) : null,
          proj: round1(rows.reduce(function (a, r) { return a + r.proj; }, 0)), starters: rows, empty: 0,
          yet: rows.filter(function (r) { return r.status === "pre"; }).length, playing: rows.filter(function (r) { return r.status === "in"; }).length,
          record: (rec.wins || 0) + "-" + (rec.losses || 0) + (rec.ties ? "-" + rec.ties : ""), espnWin: x.winProbability };
      }
      var me = side(mu[mineSide]), opp = side(mu[oppSide]);
      var wp = opp ? (me.espnWin != null && isFinite(me.espnWin) ? num(me.espnWin) : winProb(me, opp)) : null;
      out.push({ platform: "espn", league: ((d.settings || {}).name || ("ESPN " + cfg.leagueId)).trim(), leagueId: String(cfg.leagueId),
        me: me, opp: opp, winProb: wp, scoring: "league" });
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
        var gs = g ? g.state : (r.team ? "bye" : undefined), mult = p.slot === "CPT" ? 1.5 : 1;
        var pts = r.sid ? round2(mult * dkPoints(st, r.pos, gs)) : 0;
        var proj = mult * (r.sid && m.P[r.sid] ? dkPoints(m.P[r.sid], r.pos, "proj") : num((sal[p.dkId] || {}).avg));
        var remain = g ? g.remain : 0;
        return { slot: p.slot, name: p.name, dkId: p.dkId, sid: r.sid, pos: r.pos, team: r.team, sal: (sal[p.dkId] || {}).sal || null,
          pts: pts, proj: round1(proj), live: round1(pts + proj * remain), tds: tdCount(st),
          status: g ? g.state : (r.team ? "bye" : "?"), rz: !!(g && g.rz), poss: !!(g && g.poss === r.team), matched: !!r.sid };
      });
      var sum = function (f) { return players.reduce(function (a, x) { return a + (f(x) || 0); }, 0); };
      var missing = (lu.missing || []).slice();
      if (!lu.showdown && players.length + missing.length < CLASSIC.length) {   // e.g. older saved imports: list the absent Classic slots
        var left = CLASSIC.slice();
        players.concat(missing).forEach(function (x) { var j = left.indexOf(x.slot); if (j >= 0) left.splice(j, 1); else left.pop(); });
        left.forEach(function (sl) { missing.push({ slot: sl, cell: "" }); });
      }
      return { n: n + 1, entry: lu.entry, contest: lu.contest, contestId: lu.contestId, fee: lu.fee, players: players, missing: missing,
        showdown: !!lu.showdown,
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
    var incomplete = lineups.filter(function (lu) { return lu.missing.length; }).map(function (lu) {
      return { n: lu.n, entry: lu.entry, slots: lu.missing.map(function (x) { return x.slot; }), cells: lu.missing.map(function (x) { return x.cell; }) };
    });
    return { lineups: lineups, exposure: exposure, contests: Object.keys(contests).map(function (k) { return contests[k]; }),
      unmatched: exposure.filter(function (e) { return !e.matched; }).map(function (e) { return e.name; }), incomplete: incomplete };
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
      var tg = teamGame[x.team];
      x.pts = round2(num(st.pts_ppr)); x.tds = tdCount(st); x.dkpts = dkPoints(st, /^[A-Z]+$/.test(pid) ? "DEF" : "", tg ? tg.state : "bye");
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
    var sleeper = (raw.sleeper ? buildSleeper(raw.sleeper, m, sb.teamGame) : []).map(function (x) { x.platform = "sleeper"; return x; })
      .concat(raw.espn ? buildESPN(raw.espn, m, sb.teamGame) : []);
    var dk = buildDK(raw.dk, m, sb.teamGame);
    var interest = buildInterest(sleeper, dk, m, sb.teamGame, sb.games);
    return { week: raw.week, season: raw.season, seasonType: raw.seasonType || "regular", scoreSource: raw.scoreboard ? "espn" : "sleeper-schedule", games: sb.games, sleeper: sleeper, dk: dk, interest: interest };
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

  /* ------------------------------------------------------------ UI helpers (pure, tested in Node) */
  /* Display name: last name for players, nickname for team defenses ("New York Giants" -> "Giants"). */
  function lastName(n) {
    n = String(n == null ? "" : n).trim();
    var p = n.split(/\s+/), w = norm(n).split(" ");
    if (p.length > 1 && w.length <= 4 && NICK[w[w.length - 1]]) return p[p.length - 1];
    if (NICK[norm(n)]) return n;
    return p.length > 1 ? p.slice(1).join(" ") : n;
  }
  /* ------------------------------------------------------------ UI view-model helpers (pure, tested in Node) */
  /* Layout from the window's shape. ?view= forces one; the old ?view=all maps to board. */
  function chooseLayout(w, h, force) {
    force = String(force || "").toLowerCase();
    if (force === "all") force = "board";
    if (force === "board" || force === "rail" || force === "strip") return force;
    var a = w / Math.max(1, h);
    return a < 0.85 ? "rail" : a > 2.5 ? "strip" : "board";
  }
  function muStatus(m) { var wp = m.winProb; return wp == null || !m.opp ? "bye" : wp >= 0.6 ? "ahead" : wp <= 0.4 ? "behind" : "toss"; }
  function muFinished(m) { return !!m.opp && m.me.remainProj + m.opp.remainProj < 0.5 && (m.me.pts > 0 || m.opp.pts > 0) && !m.me.yet && !m.opp.yet && !m.me.playing && !m.opp.playing; }
  /* The header sentence. Uses win probability, not the current score; after the last game, wins and losses. */
  function verdict(matchups) {
    var ms = (matchups || []).filter(function (m) { return m.opp; }), n = ms.length, a = 0, t = 0, b = 0, fin = n > 0 && ms.every(muFinished);
    var won = 0;
    ms.forEach(function (m) { var s = muStatus(m); s === "ahead" ? a++ : s === "toss" ? t++ : b++; if (m.me.pts >= m.opp.pts) won++; });
    var text;
    if (!n) text = "";
    else if (fin) text = n === 1 ? (won ? "You won" : "You lost") : "Won " + won + ", lost " + (n - won);
    else if (n === 1) text = a ? "Favored to win" : t ? "Too close to call" : "Behind right now";
    else if (a === n) text = "Favored in all " + n;
    else if (b === n) text = "Behind in all " + n;
    else text = "Favored in " + a + " of " + n;
    return { text: text, toss: !fin && n > 1 ? t : 0, pips: ms.map(muStatus), final: fin };
  }
  /* "Not updating": a league whose feed failed keeps its last good card, tagged with when it last updated.
   * ms: matchups built this refresh; lastGood: {leagueId: {m, t}} from earlier refreshes; failed: {leagueId: true}
   * for leagues whose fetch failed this refresh; order: league ids in the order they were added.
   * Returns the cards to show, in that order, with m.notUpdating = ms timestamp for stale ones. */
  function keepStale(ms, lastGood, failed, order) {
    lastGood = lastGood || {}; failed = failed || {}; order = order || [];
    var out = [], seen = {};
    (ms || []).forEach(function (m) {
      var id = String(m.leagueId);
      seen[id] = 1;
      if (failed[id]) m.notUpdating = lastGood[id] ? lastGood[id].t : (m.notUpdating || Date.now());
      else delete m.notUpdating;
      out.push(m);
    });
    Object.keys(failed).forEach(function (id) {
      if (seen[id] || !failed[id] || !lastGood[id]) return;
      var m = JSON.parse(JSON.stringify(lastGood[id].m));
      m.notUpdating = lastGood[id].t;
      out.push(m);
    });
    var rank = function (m) { var i = order.indexOf(String(m.leagueId)); return i < 0 ? 1e6 : i; };
    return out.map(function (m, i) { return { m: m, i: i }; })
      .sort(function (x, y) { return rank(x.m) - rank(y.m) || x.i - y.i; }).map(function (x) { return x.m; });
  }
  /* Red-zone slot. feedLive is false when the live game feed (ESPN scoreboard) is down or only stale data is
   * left, and then the answer is "offline", never "nobody is inside the 20".
   * mode: "fantasy" | "both" | "dfs" decides whose players are named. */
  function redZone(state, feedLive, mode) {
    mode = mode || "fantasy";
    var games = (state && state.games) || [], interest = (state && state.interest) || {};
    if (!state || state.scoreSource !== "espn" || !feedLive) return { status: "offline", staked: [], other: [] };
    var staked = [], other = [];
    games.filter(function (g) { return g.rz && g.state === "in" && g.poss; }).forEach(function (g) {   // no possessing team (timeout, review): nothing to name
      var mine = [], opp = [], cash = [];
      Object.keys(interest).forEach(function (pid) {
        var x = interest[pid];
        if (x.team !== g.poss || /^[A-Z]+$/.test(pid)) return;     // team defenses aren't on the field for a drive
        var nm = lastName(x.name);
        if (mode !== "dfs" && x.mine.length) mine.push(nm);
        if (mode !== "dfs" && x.opp.length) opp.push(nm);
        if (mode !== "fantasy" && x.dk && !(mode === "both" && x.mine.length)) cash.push(nm);
      });
      (mine.length || opp.length || cash.length ? staked : other).push({ game: g.id, team: g.poss, dd: g.dd, mine: mine, opp: opp, cash: cash });
    });
    var live = games.some(function (g) { return g.state === "in"; });
    var status = staked.length || other.length ? "active" : live ? "none" : games.some(function (g) { return g.state === "pre"; }) ? "pregame" : "done";
    return { status: status, staked: staked, other: other };
  }
  /* One-time move from the first version's storage keys (scc.*.v1) to the redesign's (scc2.*). */
  function migrateSettings(old, oldDk) {
    if (!old || typeof old !== "object") return null;
    var out = {};
    ["username", "userId", "displayName", "espnS2", "espnSwid", "proxyUrl", "redzoneUrl", "sound", "minDelta", "poll", "noWake"].forEach(function (k) {
      if (old[k] != null && old[k] !== "") out[k] = old[k];
    });
    if (Array.isArray(old.hidden)) out.hidden = old.hidden.map(String);
    if (Array.isArray(old.espn)) out.espn = old.espn.filter(function (c) { return c && c.leagueId; });
    var z = parseFloat(old.zoom);
    if (isFinite(z) && z > 0 && Math.abs(z - 1) > 0.001) out.textSize = Math.max(0.8, Math.min(1.4, Math.round(z * 100) / 100));
    if (out.redzoneUrl) out.redzoneUrl = safeUrl(out.redzoneUrl);
    out.dfsOn = !!(oldDk && Array.isArray(oldDk.lineups) && oldDk.lineups.length);   // they were using DraftKings
    return out;
  }

  /* ------------------------------------------------------------ data freshness + polling */
  /* health = {source: {ok: last success ms, fails: consecutive failures, err: last error, critical: bool}}
   * -> {level: "connecting" | "ok" | "stale" | "offline", age: seconds since the OLDEST critical source last
   *     succeeded (null if never), failing: [source names whose last attempt failed]} */
  function dataStatus(health, now, intervalSec) {
    var crit = Object.keys(health || {}).filter(function (k) { return health[k].critical; });
    var failing = Object.keys(health || {}).filter(function (k) { return health[k].fails > 0; });
    var oks = crit.map(function (k) { return health[k].ok || 0; }).filter(Boolean);   // never-loaded sources show as failing
    var oldest = oks.length ? Math.min.apply(null, oks) : 0;
    var age = oldest ? Math.max(0, Math.round((now - oldest) / 1000)) : null;
    var iv = Math.max(10, intervalSec || 15);
    var critFailing = crit.filter(function (k) { return health[k].fails > 0; });
    var level;
    if (age == null) level = critFailing.length ? "offline" : "connecting";
    else if ((crit.length && critFailing.length === crit.length) || age > Math.max(180, 6 * iv)) level = "offline";
    else if (failing.length || age > 2.5 * iv + 15) level = "stale";
    else level = "ok";
    return { level: level, age: age, failing: failing };
  }
  /* Next refresh delay in ms: the user's rate while a game is live or about to start, every minute when a
   * game starts within 3 hours, every 5 minutes otherwise. After failed refreshes it backs off: doubled per
   * consecutive failure, up to 8x (2 min at the default 15 s), never more than 5 minutes. */
  function pollDelay(games, now, baseSec, fails) {
    var base = Math.max(10, baseSec || 15), d = 300;
    (games || []).forEach(function (g) {
      if (g.state === "in") { d = Math.min(d, base); return; }
      if (g.state !== "pre") return;
      var t = Date.parse(g.kick), mins = isFinite(t) ? (t - now) / 60000 : Infinity;
      if (mins <= 20) d = Math.min(d, base);            // about to start, or past kickoff but not flagged live yet
      else if (mins <= 180) d = Math.min(d, 60);
    });
    if (fails > 0) d = Math.min(300, Math.max(d, base) * Math.pow(2, Math.min(fails, 3)));
    return Math.round(d * 1000);
  }
  /* Week-scoped storage: values saved with {season, week, seasonType}; anything from another week is discarded. */
  function scoped(stored, season, week, seasonType) {
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
    if (String(stored.season) !== String(season) || String(stored.week) !== String(week) ||
        String(stored.seasonType || "regular") !== String(seasonType || "regular")) return null;
    return stored.data == null ? null : stored.data;
  }

  return { ESPN_HOST: ESPN_HOST, espnPath: espnPath, espnTeams: espnTeams, buildESPN: buildESPN, urls: urls, norm: norm, dkPoints: dkPoints, tdCount: tdCount, parseCSV: parseCSV, parseDK: parseDK,
    parseScoreboard: parseScoreboard, scheduleToScoreboard: scheduleToScoreboard, statMaps: statMaps, buildSleeper: buildSleeper, buildDK: buildDK,
    buildState: buildState, diffEvents: diffEvents, winProb: winProb, leaguePtsKey: leaguePtsKey, NICK: NICK,
    esc: esc, safeUrl: safeUrl, parseCell: parseCell, lastName: lastName, dataStatus: dataStatus,
    pollDelay: pollDelay, scoped: scoped, buildInterest: buildInterest,
    chooseLayout: chooseLayout, verdict: verdict, muStatus: muStatus, muFinished: muFinished, keepStale: keepStale, redZone: redZone,
    migrateSettings: migrateSettings };
});
