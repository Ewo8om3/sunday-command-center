/* Sunday Command Center - UI. Static, no build step, no server. */
(function () {
  "use strict";
  var LS = { settings: "scc.settings.v1", dk: "scc.dk.v1", feed: "scc.feed.v1", prev: "scc.prev.v1" };
  var qs = new URLSearchParams(location.search);
  var VIEW = qs.get("view") || "all";             // all | rail | strip
  var DEMO = qs.has("demo");
  var settings = load(LS.settings, { display: "auto", espn: [], espnS2: "", espnSwid: "", proxyUrl: "http://localhost:8766", username: "", userId: "", displayName: "", hidden: [], redzoneUrl: "", sound: false, zoom: 1, minDelta: 1.5, poll: 15 });
  var dkData = load(LS.dk, { lineups: [], salaries: {}, files: [], importedAt: null });
  var feed = load(LS.feed, []);
  var prevInterest = DEMO ? null : load(LS.prev, null);
  /* Display presets: layout split (fractions of the screen) + font divisors + density. */
  var DISPLAYS = {
    "1080p": { label: "1080p (1920×1080)", rz: [0.75, 0.75], rail: 30, strip: 9.5, all: 96, density: "compact" },
    "1440p": { label: "1440p (2560×1440)", rz: [0.70, 0.70], rail: 32, strip: 10, all: 108, density: "cozy" },
    "4k":    { label: "4K (3840×2160)",    rz: [0.6667, 0.6667], rail: 34, strip: 10.5, all: 118, density: "comfortable" }
  };
  function detectDisplay() {
    var px = Math.max(screen.width, innerWidth) * (window.devicePixelRatio || 1);
    return px >= 3000 ? "4k" : px >= 2300 ? "1440p" : "1080p";
  }
  function display() { var k = settings.display && DISPLAYS[settings.display] ? settings.display : detectDisplay(); return Object.assign({ key: k }, DISPLAYS[k]); }
  var S = null, lastOk = 0, lastErr = "", focus = null, hot = {}, busy = false, timer = null;
  var app = document.getElementById("app");

  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : Object.assign(Array.isArray(d) ? [] : {}, d, v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn("localStorage", e); } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  function f2(x) { return (Math.round(x * 100) / 100).toFixed(2); }
  function last(n) { var p = String(n || "").split(" "); return p.length > 1 && !SCC.NICK[SCC.norm(n)] ? p.slice(1).join(" ") : n; }
  function short(n) { var p = String(n || "").split(" "); return p.length > 1 ? p[0][0] + ". " + p.slice(1).join(" ") : n; }

  /* ---------------------------------------------------------------- fetch with TTL */
  var cache = {};
  function getJSON(url, ttl) {
    var c = cache[url], now = Date.now();
    if (c && now - c.t < ttl * 1000) return Promise.resolve(c.v);
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(r.status + " " + url.replace(/\?.*/, ""));
      return r.json();
    }).then(function (v) { cache[url] = { t: now, v: v }; return v; })
      .catch(function (e) { if (c) return c.v; throw e; });
  }

  /* ESPN fantasy: public leagues load directly (ESPN allows CORS). Private leagues try your browser's own
     ESPN login cookies, then the optional local proxy (proxy/espn_proxy.py) which adds espn_s2/SWID. */
  var espnMode = {};
  function espnFetch(path, key) {
    var c = cache[path];
    if (c && Date.now() - c.t < 20000) return Promise.resolve(c.v);
    function get(url, opts) {
      return fetch(url, opts).then(function (r) {
        if (r.status === 401 || r.status === 403) { var e = new Error("private"); e.auth = true; throw e; }
        if (!r.ok) throw new Error("ESPN " + r.status);
        return r.json();
      });
    }
    function viaProxy() {
      var h = {};
      if (settings.espnS2 && settings.espnSwid) { h["X-Espn-S2"] = settings.espnS2; h["X-Espn-Swid"] = settings.espnSwid; }
      return get(settings.proxyUrl.replace(/\/$/, "") + "/espn" + path, { headers: h, credentials: "omit" })
        .catch(function (e) {
          if (e.auth) throw new Error(settings.espnS2 && settings.espnSwid ? "ESPN private league: the proxy is running but ESPN rejected your espn_s2/SWID (expired? re-copy them)"
            : "ESPN private league: proxy is running; add your espn_s2 + SWID in Settings → ESPN (or proxy/config.json)");
          throw new Error("ESPN private league: start proxy/start-proxy (see README) — " + e.message);
        });
    }
    var mode = espnMode[key], url = SCC.ESPN_HOST + path, p;
    if (mode === "proxy") p = viaProxy();
    else if (mode === "cookie") p = get(url, { credentials: "include" });
    else p = get(url, { credentials: "omit" }).then(function (v) { espnMode[key] = "direct"; return v; })
      .catch(function (e) {
        if (!e.auth) throw e;
        return get(url, { credentials: "include" }).then(function (v) { espnMode[key] = "cookie"; return v; })
          .catch(function () { return viaProxy().then(function (v) { espnMode[key] = "proxy"; return v; }); });
      });
    return p.then(function (v) { cache[path] = { t: Date.now(), v: v }; return v; }).catch(function (e) { if (c) return c.v; throw e; });
  }

  function gather() {
    return getJSON("https://api.sleeper.app/v1/state/nfl", 600).then(function (st) {
      var season = qs.get("season") || st.league_season || st.season, week = qs.get("week") || st.display_week || st.week;
      var U = SCC.urls(season, week);
      var sleeperP;
      if (DEMO || !settings.userId) sleeperP = Promise.resolve(null);
      else sleeperP = getJSON(U.leagues(settings.userId), 1800).then(function (ls) {
        ls = ls.filter(function (l) { return (l.status === "in_season" || l.status === "post_season") && settings.hidden.indexOf(l.league_id) < 0; });
        return Promise.all(ls.map(function (l) {
          return Promise.all([getJSON(U.rosters(l.league_id), 900), getJSON(U.users(l.league_id), 3600), getJSON(U.matchups(l.league_id), 15)])
            .then(function (a) { return { league: l, rosters: a[0], users: a[1], matchups: a[2] }; })
            .catch(function (e) { lastErr = l.name + ": " + e.message; return null; });
        }));
      }).then(function (L) { return { userId: settings.userId, leagues: L.filter(Boolean) }; });
      var espnP = DEMO ? Promise.resolve([]) : Promise.all((settings.espn || []).map(function (cfg) {
        return espnFetch(SCC.espnPath(cfg.season || season, cfg.leagueId, week), cfg.leagueId + ":" + cfg.season)
          .then(function (d) { return { cfg: cfg, data: d }; })
          .catch(function (e) { lastErr = (cfg.leagueName || "ESPN " + cfg.leagueId) + ": " + e.message; return null; });
      })).then(function (a) { return a.filter(Boolean); });
      var sbP = getJSON(U.scoreboard, 10).then(function (sb) { return { sb: sb }; }).catch(function () {
        return getJSON(U.schedule, 60).then(function (sc) { return { schedule: sc }; });
      });
      return Promise.all([sbP, getJSON(U.stats, 15), getJSON(U.projections, 1800), sleeperP, espnP])
        .then(function (a) {
          var raw = { season: season, week: week, scoreboard: a[0].sb || null, schedule: a[0].schedule, stats: a[1], projections: a[2], sleeper: a[3], espn: a[4], dk: dkData };
          if (DEMO) Object.assign(raw, makeDemo(raw));
          return SCC.buildState(raw);
        });
    });
  }

  /* ---------------------------------------------------------------- demo data (fictional leagues on real live stats) */
  function makeDemo(raw) {
    var m = SCC.statMaps(raw.stats, raw.projections);
    var byPos = {};
    Object.keys(m.P).forEach(function (pid) {
      var i = m.info[pid]; if (!i) return;
      (byPos[i.pos] = byPos[i.pos] || []).push(pid);
    });
    Object.keys(byPos).forEach(function (p) { byPos[p].sort(function (a, b) { return (m.P[b].pts_ppr || 0) - (m.P[a].pts_ppr || 0); }); });
    var shape = { QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DEF: 1 }, flexPool = ["RB", "WR", "TE"];
    function team(seed) {
      var out = [];
      Object.keys(shape).forEach(function (pos) { for (var k = 0; k < shape[pos]; k++) out.push((byPos[pos] || [])[seed + k * 7 + (pos === "QB" ? 0 : 3)]); });
      out.splice(7, 0, (byPos[flexPool[seed % 3]] || [])[seed + 30]);
      return out.filter(Boolean);
    }
    var names = [["Demo League One", "Taco Corp", "Mahomes Alone"], ["Sunday Scaries Dynasty", "Ja'Marr the Merrier", "Bijan Mustard"], ["The Office League", "CeeDee's Nuts", "Kittle Big Planet"]];
    var leagues = names.map(function (n, li) {
      var a = team(li * 2), b = team(li * 2 + 1);
      var pts = function (ids) { return ids.map(function (pid) { return +(((m.S[pid] || {}).pts_ppr) || 0); }); };
      var sum = function (x) { return x.reduce(function (s, v) { return s + v; }, 0); };
      return { league: { name: n[0], league_id: "demo" + li, scoring_settings: { rec: 1 } },
        users: [{ user_id: "me", display_name: n[1] }, { user_id: "op" + li, display_name: n[2] }],
        rosters: [{ roster_id: 1, owner_id: "me", settings: { wins: 5 + li, losses: 4 - li } }, { roster_id: 2, owner_id: "op" + li, settings: { wins: 6, losses: 3 } }],
        matchups: [{ roster_id: 1, matchup_id: 1, starters: a, starters_points: pts(a), points: sum(pts(a)) }, { roster_id: 2, matchup_id: 1, starters: b, starters_points: pts(b), points: sum(pts(b)) }] };
    });
    var pick = function (pos, k) { var pid = (byPos[pos] || [])[k]; return pid ? { name: m.info[pid].name, dkId: String(9000000 + parseInt(String(pid).replace(/\D/g, "") || k, 10) % 999999) } : null; };
    var lineups = [0, 1, 2, 3, 4, 5].map(function (s) {
      var sl = [["QB", pick("QB", s)], ["RB", pick("RB", s)], ["RB", pick("RB", s + 4)], ["WR", pick("WR", s)], ["WR", pick("WR", s + 5)], ["WR", pick("WR", s + 9)], ["TE", pick("TE", s)], ["FLEX", pick("RB", s + 10)], ["DST", pick("DEF", s)]];
      return { entry: "demo" + s, contest: "Demo $5 GPP", contestId: "demo", fee: 5, players: sl.filter(function (x) { return x[1]; }).map(function (x) { return { slot: x[0], name: x[1].name, dkId: x[1].dkId }; }) };
    });
    return { sleeper: { userId: "me", leagues: leagues }, dk: { lineups: lineups, salaries: {} } };
  }

  /* ---------------------------------------------------------------- refresh loop */
  function tick() {
    if (busy) return;
    busy = true;
    lastErr = "";
    gather().then(function (st) {
      var ev = SCC.diffEvents(prevInterest, st.interest, settings.minDelta);
      var now = Date.now();
      ev.forEach(function (e) {
        e.t = now; hot[e.pid] = now;
        feed.unshift(e);
        if (e.td || Math.abs(e.delta) >= 5) toast(e);
      });
      if (ev.length && settings.sound) beep(ev.some(function (e) { return e.tone === "good"; }));
      feed = feed.slice(0, 80);
      save(LS.feed, feed);
      prevInterest = st.interest;
      if (!DEMO) save(LS.prev, st.interest);
      S = st; lastOk = now;
      render();
    }).catch(function (e) { lastErr = e.message || String(e); render(); console.error(e); })
      .then(function () { busy = false; });
  }
  function start() {
    clearInterval(timer);
    tick();
    timer = setInterval(tick, Math.max(10, settings.poll || 15) * 1000);
    setInterval(function () { var c = document.getElementById("clock"); if (c) c.textContent = clockStr(); renderStatus(); }, 1000);
  }

  /* ---------------------------------------------------------------- render */
  function clockStr() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function sizeRoot() {
    var w = innerWidth, h = innerHeight, z = settings.zoom || 1, fs, D = display();
    document.body.setAttribute("data-density", D.density);
    if (VIEW === "rail") fs = Math.min(w / D.rail, h / 70);
    else if (VIEW === "strip") { var n = S && S.dk.lineups.length ? Math.min(S.dk.lineups.length, 10) : 8; fs = Math.min(w / (n * D.strip + 19), h / 24); }
    else fs = Math.min(w / D.all, h / 58);
    document.documentElement.style.fontSize = Math.max(9, fs * z) + "px";
  }
  function statusHTML() {
    var age = lastOk ? Math.round((Date.now() - lastOk) / 1000) : null;
    var cls = lastErr ? "err" : age == null || age > 60 ? "stale" : "";
    return '<span class="dot ' + cls + '"></span>' + (age == null ? "connecting…" : "updated " + age + "s ago") + (lastErr ? ' · <span class="err">' + esc(lastErr) + "</span>" : "");
  }
  function renderStatus() { var s = document.getElementById("status"); if (s) s.innerHTML = statusHTML(); }

  function header() {
    var live = 0, done = 0, pre = 0;
    (S ? S.games : []).forEach(function (g) { g.state === "in" ? live++ : g.state === "post" ? done++ : pre++; });
    var views = ["all", "rail", "strip"].map(function (v) {
      return '<a class="btn' + (v === VIEW ? " on" : "") + '" href="?' + params({ view: v }) + '">' + v + "</a>";
    }).join(" ");
    return '<div class="panel hdr"><div class="clock num" id="clock">' + clockStr() + '</div>' +
      '<div class="meta"><b>Week ' + esc(S ? S.week : "–") + "</b> · " + live + " live · " + pre + " to go · " + done + " final" +
      (S && S.scoreSource !== "espn" ? ' · <span class="warnline" title="ESPN scoreboard unreachable; using Sleeper schedule">scores: fallback (no clock / red zone)</span>' : "") +
      (DEMO ? ' · <b style="color:var(--warn)">DEMO DATA</b>' : settings.displayName ? " · " + esc(settings.displayName) : "") +
      '<br><span id="status">' + statusHTML() + "</span></div><div class='sp'></div>" +
      (VIEW === "rail" ? "" : views + " ") +
      (settings.redzoneUrl ? '<a class="btn" target="redzone" href="' + esc(settings.redzoneUrl) + '">RedZone ↗</a> ' : "") +
      '<button class="btn" data-act="settings">⚙</button> <button class="btn" data-act="help">?</button></div>';
  }
  function params(o) { var p = new URLSearchParams(location.search); Object.keys(o).forEach(function (k) { p.set(k, o[k]); }); return p.toString(); }

  function radar() {
    var rz = S.games.filter(function (g) { return g.rz; });
    var rows = rz.map(function (g) {
      var mine = [], opp = [];
      Object.keys(S.interest).forEach(function (pid) {
        var x = S.interest[pid];
        if (x.team !== g.poss) return;
        if (x.mine.length || x.dk) mine.push(last(x.name) + (x.dk ? '<sup class="tag dk">DK' + x.dk + "</sup>" : ""));
        if (x.opp.length) opp.push(last(x.name));
      });
      return '<div class="row" data-game="' + g.id + '"><div class="g">' + esc(g.poss) + ' <span style="color:var(--dim)">' + esc(g.dd) + "</span></div>" +
        '<div class="who">' + (mine.length ? '<span style="color:var(--good)">▲ ' + mine.join(", ") + "</span> " : "") +
        (opp.length ? '<span style="color:var(--bad)">▼ ' + esc(opp.join(", ")) + "</span>" : "") + (!mine.length && !opp.length ? '<span style="color:var(--dim)">none of your guys on offense</span>' : "") + "</div></div>";
    });
    return '<div class="panel"><h2>RedZone radar <span>' + rz.length + " in the red zone</span></h2><div class='radar'>" +
      (rows.join("") || '<div class="none">No team inside the 20 right now.</div>') + "</div></div>";
  }

  function games() {
    var order = { in: 0, pre: 1, post: 2 };
    var gs = S.games.slice().sort(function (a, b) { return order[a.state] - order[b.state] || (b.rz - a.rz) || a.kick.localeCompare(b.kick); });
    return '<div class="panel"><h2>Games <span>click to spotlight · Esc clears</span></h2><div class="games">' + gs.map(function (g) {
      var t = function (tm, sc, other) {
        return '<div class="t ' + (g.state !== "pre" ? (sc > other ? "lead" : sc < other ? "trail" : "") : "") + '"><span class="' + (g.poss === tm ? "pos" : "") + '">' + esc(tm) + '</span><span class="num">' + (g.state === "pre" ? "" : sc) + "</span></div>";
      };
      var kick = g.state === "pre" ? new Date(g.kick).toLocaleTimeString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : g.detail;
      return '<div class="game ' + g.state + (g.rz ? " rz" : "") + (focus === g.id ? " focus" : "") + '" data-game="' + g.id + '" title="' + esc(g.last) + '">' +
        t(g.away, g.as, g.hs) + t(g.home, g.hs, g.as) + '<div class="s"><span>' + esc(kick) + (g.state === "in" && g.dd ? " · " + esc(g.dd) : "") + '</span><span class="tags">' +
        (g.rz ? '<span class="tag rz">RZ</span>' : "") + (g.mine ? '<span class="tag me" title="your Sleeper starters">' + g.mine + "</span>" : "") +
        (g.against ? '<span class="tag op" title="opponents\' starters">' + g.against + "</span>" : "") + (g.dk ? '<span class="tag dk" title="DK lineup slots">' + g.dk + "</span>" : "") +
        "</span></div></div>";
    }).join("") + "</div></div>";
  }

  function chip(r) {
    var cls = ["chip", r.status, r.rz && r.status === "in" ? "rz" : "", r.poss ? "ball" : "", hot[r.id] && Date.now() - hot[r.id] < 90000 ? "hot" : "",
      focus && r.game === focus ? "focus" : "", (r.inj === "Out" || r.inj === "IR") ? "inj" : ""].join(" ");
    var tip = r.name + " · " + (r.team || "") + " · proj " + f1(r.proj) + (r.inj ? " · " + r.inj : "");
    return '<span class="' + cls + '" title="' + esc(tip) + '"><span class="p">' + esc(r.pos) + "</span>" + esc(last(r.name)) + '<b class="num">' + f1(r.pts) + "</b></span>";
  }

  function sleeperPanel() {
    if (!S.sleeper.length) {
      return '<div class="panel"><h2>Fantasy</h2><div class="none" style="color:var(--dim)">' +
        (settings.userId || (settings.espn || []).length || DEMO ? "No fantasy matchups this week." : 'Add your Sleeper username or ESPN leagues in <button class="btn" data-act="settings">⚙ Settings</button>') + "</div></div>";
    }
    var sorted = S.sleeper.slice().sort(function (a, b) { return Math.abs((a.winProb || 0.5) - 0.5) - Math.abs((b.winProb || 0.5) - 0.5); });
    var rec = { w: 0, l: 0 };
    S.sleeper.forEach(function (m) { if (m.opp) { if (m.me.live >= m.opp.live) rec.w++; else rec.l++; } });
    return '<div class="panel scroll"><h2>Fantasy matchups <span>projected ' + rec.w + "-" + rec.l + " · closest first</span></h2><div class='mus'>" + sorted.map(function (m) {
      var me = m.me, op = m.opp || { name: "Bye", pts: 0, live: 0, starters: [], yet: 0, playing: 0, record: "" };
      var wp = m.winProb == null ? null : Math.round(m.winProb * 100);
      var share = me.live + op.live > 0 ? 100 * me.live / (me.live + op.live) : 50;
      return '<div class="mu"><div class="top"><span class="plat ' + m.platform + '">' + (m.platform === "espn" ? "ESPN" : "SLPR") + '</span><span class="lg">' + esc(m.league) + "</span>" +
        (m.me.espnProj != null ? '<span class="wp" style="color:var(--dim)" title="ESPN live projection">ESPN proj ' + f1(m.me.espnProj) + "</span>" : "") +
        (wp == null ? "" : '<span class="wp" style="color:' + (wp >= 50 ? "var(--good)" : "var(--bad)") + '">' + wp + "% win</span>") + "</div>" +
        '<div class="score"><span class="nm">' + esc(me.name) + ' <small style="color:var(--dim)">' + esc(me.record) + '</small></span><span class="pts num ' + (me.pts >= op.pts ? "win" : "lose") + '">' + f2(me.pts) +
        '</span><span class="pts num">' + f2(op.pts) + '</span><span class="nm r">' + esc(op.name) + "</span></div>" +
        '<div class="bar"><i style="width:' + share.toFixed(1) + '%"></i></div>' +
        '<div class="sub num"><span>proj ' + f1(me.live) + " · " + me.playing + " live · " + me.yet + " to go" + (me.empty ? ' · <b style="color:var(--bad)">' + me.empty + " EMPTY</b>" : "") +
        '</span><span class="r">' + op.yet + " to go · " + op.playing + " live · proj " + f1(op.live) + "</span></div>" +
        '<div class="chips">' + me.starters.map(chip).join("") + '</div><div class="chips opp">' + op.starters.map(chip).join("") + "</div></div>";
    }).join("") + "</div></div>";
  }

  function feedPanel(limit) {
    var rows = feed.slice(0, limit || 40).map(function (e) {
      var who = [];
      if (e.mine.length) who.push("yours: " + e.mine.length);
      if (e.dk) who.push("DK×" + e.dk);
      if (e.opp.length) who.push("vs you: " + e.opp.length);
      return '<div class="ev ' + e.tone + (e.td ? " td" : "") + '" title="' + esc(e.mine.concat(e.opp.map(function (x) { return "vs: " + x; })).join("\n")) + '"><span class="tm num">' +
        new Date(e.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "</span><span>" + (e.td ? "🏈 TD " : "") + esc(e.name) + " " +
        '<b class="num">' + (e.delta >= 0 ? "+" : "") + f1(e.delta) + "</b> <span style='color:var(--dim)'>" + esc(who.join(" · ")) + "</span></span></div>";
    });
    return '<div class="panel scroll" style="flex:1"><h2>Scoring feed <button class="btn" data-act="clearfeed">clear</button></h2><div class="feed">' +
      (rows.join("") || '<div style="color:var(--dim)">Scoring changes on your players show up here as they happen.</div>') + "</div></div>";
  }

  function dkPanel() {
    var dk = S.dk;
    if (!dk.lineups.length) {
      return '<div class="panel" style="flex:1"><h2>DraftKings</h2><div style="color:var(--dim)">No lineups imported. Open <button class="btn" data-act="settings">⚙ Settings</button> and drop in your DK entries CSV (My Contests → Upcoming/Live → Export to CSV) or your upload CSV.</div></div>';
    }
    var best = dk.lineups.reduce(function (a, b) { return b.pts > a.pts ? b : a; });
    var ranked = dk.lineups.slice().sort(function (a, b) { return b.pts - a.pts; });
    var fees = dk.contests.reduce(function (a, c) { return a + c.fees; }, 0);
    var hdr = '<div class="dkhdr"><span class="big num">' + f2(best.pts) + '</span><span>best of ' + dk.lineups.length + " (#" + best.n + ")</span>" +
      "<span>avg " + f1(dk.lineups.reduce(function (a, l) { return a + l.pts; }, 0) / dk.lineups.length) + "</span>" +
      dk.contests.map(function (c) { return "<span>" + esc(c.name) + " · " + c.entries + " entries" + (c.fees ? " · $" + c.fees : "") + "</span>"; }).join("") +
      '<a target="dkmc" href="https://www.draftkings.com/mycontests">DK My Contests ↗</a>' +
      (dk.unmatched.length ? '<span class="warnline">unmatched: ' + esc(dk.unmatched.join(", ")) + "</span>" : "") + "</div>";
    var many = dk.lineups.length > 12;
    var cols = VIEW === "all" ? Math.min(4, dk.lineups.length) : Math.min(dk.lineups.length, 10);
    var lus = many ? compactLineups(ranked) : '<div class="lus" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">' + dk.lineups.map(function (lu) {
      return '<div class="lu' + (lu === best ? " best" : "") + '"><div class="h"><span class="n">#' + lu.n + " · rank " + (ranked.indexOf(lu) + 1) + '</span><span class="pts num">' + f2(lu.pts) + "</span></div>" +
        '<div class="h2 num"><span>proj ' + f1(lu.live) + "</span><span>" + lu.playing + " live · " + lu.yet + " to go</span></div>" +
        lu.players.map(function (p) {
          var cls = ["pl", p.status, p.rz && p.status === "in" ? "rz" : "", focus && S.games.some(function (g) { return g.id === focus && (g.home === p.team || g.away === p.team); }) ? "focus" : "",
            p.sid && hot[p.sid] && Date.now() - hot[p.sid] < 90000 ? "hot" : ""].join(" ");
          return '<div class="' + cls + '" title="' + esc(p.name + " · " + (p.team || "?") + " · proj " + f1(p.proj) + (p.sal ? " · $" + p.sal : "") + (p.matched ? "" : " · NOT MATCHED")) + '"><span class="sl">' + esc(p.slot) +
            '</span><span class="nm">' + esc(short(p.name)) + (p.poss ? " 🏈" : "") + '</span><span class="num">' + f1(p.pts) + "</span></div>";
        }).join("") + "</div>";
    }).join("") + "</div>";
    var expo = '<div class="expo panel scroll"><h2>Exposure</h2><table class="num"><tr><th>Player</th><th class="r">Lineups</th><th class="r">DK pts</th></tr>' +
      dk.exposure.map(function (e) {
        return '<tr class="' + e.status + (e.rz && e.status === "in" ? " rz" : "") + '"><td>' + esc(short(e.name)) + ' <small style="color:var(--dim)">' + esc(e.team || "") + '</small></td><td class="r">' + e.count + " (" + e.pct + '%)</td><td class="r">' + f1(e.pts) + "</td></tr>";
      }).join("") + "</table></div>";
    return '<div class="panel" style="flex:1;min-height:0"><h2>DraftKings <span>live DK scoring, calculated from Sleeper stats</span></h2>' + hdr + '<div class="dkwrap"><div class="scroll">' + lus + "</div>" + expo + "</div></div>";
  }
  function compactLineups(ranked) {
    return '<table class="num" style="width:100%;font-size:.75em">' + ranked.map(function (lu, i) {
      return "<tr><td>" + (i + 1) + ".</td><td>#" + lu.n + "</td><td><b>" + f2(lu.pts) + "</b></td><td>proj " + f1(lu.live) + "</td><td>" + lu.yet + " to go</td><td style='color:var(--dim)'>" +
        esc(lu.players.map(function (p) { return last(p.name); }).join(", ")) + "</td></tr>";
    }).join("") + "</table>";
  }

  function render() {
    sizeRoot();
    if (!S) { app.className = "loading"; app.innerHTML = lastErr ? '<div class="err">' + esc(lastErr) + "</div>" : "Loading Sunday Command Center…"; return; }
    var sc = {};
    app.querySelectorAll(".scroll").forEach(function (el, i) { sc[i] = el.scrollTop; });
    app.className = "view-" + VIEW;
    if (VIEW === "rail") app.innerHTML = header() + radar() + games() + sleeperPanel() + (display().density === "compact" ? feedPanel(6) : feedPanel(25));
    else if (VIEW === "strip") app.innerHTML = dkPanel();
    else app.innerHTML = header() + '<div class="allgrid3"><div class="col">' + radar() + games() + feedPanel(30) + '</div><div class="col">' + sleeperPanel() + '</div><div class="col">' + dkPanel() + "</div></div>";
    app.querySelectorAll(".scroll").forEach(function (el, i) { if (sc[i]) el.scrollTop = sc[i]; });
  }

  /* ---------------------------------------------------------------- toasts / sound */
  function toast(e) {
    var box = document.getElementById("toast"), d = document.createElement("div");
    d.className = "t " + e.tone;
    d.textContent = (e.td ? "🏈 TOUCHDOWN  " : "") + e.name + "  " + (e.delta >= 0 ? "+" : "") + f1(e.delta) +
      (e.dk ? "  · DK×" + e.dk : "") + (e.mine.length ? "  · yours in " + e.mine.length : "") + (e.opp.length ? "  · against you in " + e.opp.length : "");
    box.appendChild(d);
    setTimeout(function () { d.remove(); }, 7000);
  }
  var actx;
  function beep(good) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = good ? 880 : 220; g.gain.value = 0.06;
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.18);
    } catch (e) { }
  }

  /* ---------------------------------------------------------------- settings */
  var modal;
  function openSettings() {
    if (modal) modal.remove();
    modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = '<div class="box">' +
      '<h1>⚙ Settings <button class="btn" data-act="close" style="float:right">close ✕</button></h1>' +
      '<p class="hint">Everything here is stored only in this browser (localStorage). Nothing is uploaded anywhere.</p>' +
      "<h3>1 · Sleeper</h3>" +
      '<div class="rowf"><input id="su" placeholder="Sleeper username" value="' + esc(settings.username) + '"><button class="btn" data-act="finduser">Find me</button></div>' +
      '<div id="sumsg" class="hint">' + (settings.userId ? "Connected as <b>" + esc(settings.displayName) + "</b>" : "") + "</div><div id=\"leaguelist\"></div>" +
      "<h3>1b · ESPN leagues</h3>" +
      '<div id="espnlist"></div>' +
      '<div class="rowf"><input id="eid" placeholder="ESPN league ID (from the league URL: leagueId=…)" style="width:22em"><input id="eseason" type="number" style="width:6em" value="' + esc(currentSeason()) + '"><button class="btn" data-act="espnload">Load teams</button></div>' +
      '<div class="rowf" id="eteams"></div>' +
      '<details><summary class="hint">Private ESPN league? (espn_s2 / SWID)</summary>' +
      '<p class="hint">Public leagues just work. For private leagues the page first tries your browser\'s own ESPN login. If that\'s blocked, run the tiny local proxy (<code>proxy/start-proxy.bat</code> or <code>.sh</code>) and paste your cookies here (see README). They\'re kept in this browser and only ever sent to the proxy on <code>localhost</code>.</p>' +
      '<div class="rowf"><input id="es2" type="password" placeholder="espn_s2" value="' + esc(settings.espnS2) + '" style="width:18em"><input id="eswid" type="password" placeholder="SWID {…}" value="' + esc(settings.espnSwid) + '" style="width:16em"></div>' +
      '<div class="rowf"><label>Proxy <input id="eproxy" value="' + esc(settings.proxyUrl) + '" style="width:14em"></label><button class="btn" data-act="proxytest">Test proxy</button><span id="proxymsg" class="hint"></span></div></details>' +
      "<h3>2 · DraftKings lineups</h3>" +
      '<p class="hint">Drop or pick any of: your <b>entries export</b> (DK → My Contests → Upcoming → Export to CSV, best: includes contests &amp; teams), the <b>upload CSV</b> you edit for DK bulk upload, and optionally <b>DKSalaries.csv</b> from the lobby. Or paste lineups, one per line: <code>Name (ID), Name (ID), …</code></p>' +
      '<div class="drop" id="drop">Drop CSV files here or <label class="btn">browse<input type="file" id="files" accept=".csv,text/csv,text/plain" multiple hidden></label></div>' +
      '<textarea id="paste" rows="4" placeholder="…or paste CSV / lineups here"></textarea>' +
      '<div class="rowf"><button class="btn" data-act="importpaste">Import pasted</button><label><input type="checkbox" id="replace" checked> replace existing lineups</label><button class="btn" data-act="cleardk">Clear DK data</button></div>' +
      '<div id="dkmsg" class="hint">' + dkSummary() + "</div>" +
      "<h3>3 · Screen</h3>" +
      '<div class="rowf"><label>RedZone link <input id="rz" placeholder="https://tv.youtube.com/ or your NFL+ / Sunday Ticket URL" value="' + esc(settings.redzoneUrl) + '" style="width:28em"></label></div>' +
      '<div class="rowf"><label>Display size <select id="display">' + ["auto"].concat(Object.keys(DISPLAYS)).map(function (k) {
        return '<option value="' + k + '"' + ((settings.display || "auto") === k ? " selected" : "") + ">" + (k === "auto" ? "Auto (detected: " + DISPLAYS[detectDisplay()].label + ")" : DISPLAYS[k].label) + "</option>";
      }).join("") + "</select></label></div>" +
      '<div class="rowf"><label>Zoom <input id="zoom" type="number" step="0.05" min="0.5" max="2" value="' + (settings.zoom || 1) + '" style="width:5em"></label>' +
      '<label>Refresh every <input id="poll" type="number" min="10" max="120" value="' + (settings.poll || 15) + '" style="width:4em"> s</label>' +
      '<label><input type="checkbox" id="sound"' + (settings.sound ? " checked" : "") + "> sound on scoring</label></div>" +
      '<div class="rowf"><button class="btn" data-act="launch">Open layout windows (RedZone + rail + strip)</button><a class="btn" href="?' + params({ view: "rail" }) + '" target="scc-rail">rail ↗</a><a class="btn" href="?' + params({ view: "strip" }) + '" target="scc-strip">strip ↗</a><a class="btn" href="?demo=1">demo ↗</a></div>' +
      '<p class="hint">For a pixel-perfect 4K layout use FancyZones (Windows) or Rectangle (Mac) — see the README.</p>' +
      '<div class="rowf"><button class="btn" data-act="savesettings">Save</button><button class="btn" data-act="wipe">Forget everything</button></div></div>';
    document.body.appendChild(modal);
    var drop = modal.querySelector("#drop");
    drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
    drop.addEventListener("drop", function (e) { e.preventDefault(); drop.classList.remove("over"); importFiles(e.dataTransfer.files); });
    modal.querySelector("#files").addEventListener("change", function (e) { importFiles(e.target.files); });
    if (settings.userId) listLeagues();
    renderEspnList();
  }
  var seasonGuess = String(new Date().getMonth() < 2 ? new Date().getFullYear() - 1 : new Date().getFullYear());
  function currentSeason() { return (S && S.season) || seasonGuess; }
  function renderEspnList() {
    var box = modal && modal.querySelector("#espnlist");
    if (!box) return;
    box.innerHTML = (settings.espn || []).map(function (c, i) {
      return '<div class="lgopt">ESPN · <b>' + esc(c.leagueName || c.leagueId) + "</b> (" + esc(c.season) + ") · " + esc(c.teamName || "team " + c.teamId) +
        ' <button class="btn" data-act="espnremove" data-i="' + i + '">remove</button></div>';
    }).join("") || '<span class="hint">No ESPN leagues added.</span>';
  }
  var espnPending = null;
  function espnLoad() {
    var id = modal.querySelector("#eid").value.replace(/.*leagueId=/, "").replace(/\D.*$/, ""), season = modal.querySelector("#eseason").value || currentSeason();
    var out = modal.querySelector("#eteams");
    if (!id) { out.innerHTML = '<span class="err">Enter a league ID.</span>'; return; }
    readEspnCreds();
    out.innerHTML = '<span class="hint">Loading…</span>';
    espnFetch(SCC.espnPath(season, id, null).replace(/&view=mBoxscore|&view=mMatchupScore|&view=mRoster/g, ""), id + ":" + season).then(function (d) {
      var teams = SCC.espnTeams(d);
      espnPending = { leagueId: id, season: String(season), leagueName: (d.settings || {}).name || ("ESPN " + id) };
      out.innerHTML = "<b>" + esc(espnPending.leagueName) + '</b> <select id="eteam">' + teams.map(function (t) {
        return '<option value="' + t.id + '">' + esc(t.name) + (t.owner ? " — " + esc(t.owner) : "") + "</option>";
      }).join("") + '</select> <button class="btn" data-act="espnadd">Add — this is my team</button>' +
        (espnMode[id + ":" + season] && espnMode[id + ":" + season] !== "direct" ? ' <span class="hint">(private, via ' + espnMode[id + ":" + season] + ")</span>" : "");
    }).catch(function (e) { out.innerHTML = '<span class="err">' + esc(e.message) + "</span>"; });
  }
  function espnAdd() {
    var sel = modal.querySelector("#eteam");
    if (!espnPending || !sel) return;
    var c = Object.assign({}, espnPending, { teamId: +sel.value, teamName: sel.options[sel.selectedIndex].text.split(" — ")[0] });
    settings.espn = (settings.espn || []).filter(function (x) { return !(x.leagueId === c.leagueId && x.season === c.season); }).concat([c]);
    save(LS.settings, settings);
    modal.querySelector("#eteams").innerHTML = '<span class="hint">Added ' + esc(c.leagueName) + ".</span>";
    renderEspnList(); cache = {}; tick();
  }
  function readEspnCreds() {
    if (!modal) return;
    settings.espnS2 = modal.querySelector("#es2").value.trim();
    settings.espnSwid = modal.querySelector("#eswid").value.trim();
    settings.proxyUrl = modal.querySelector("#eproxy").value.trim() || "http://localhost:8766";
    save(LS.settings, settings);
  }
  function proxyTest() {
    readEspnCreds();
    var msg = modal.querySelector("#proxymsg");
    msg.textContent = "checking…";
    fetch(settings.proxyUrl.replace(/\/$/, "") + "/health").then(function (r) { return r.json(); }).then(function (h) {
      msg.innerHTML = h.ok ? '<span style="color:var(--good)">proxy OK</span>' + (h.cookiesInConfig ? " · cookies in config.json" : settings.espnS2 ? " · using cookies from this page" : ' · <span class="err">no cookies yet</span>') : "unexpected reply";
    }).catch(function () { msg.innerHTML = '<span class="err">no proxy at ' + esc(settings.proxyUrl) + "</span>"; });
  }
  function dkSummary() {
    if (!dkData.lineups.length) return "No DK lineups imported yet.";
    return "<b>" + dkData.lineups.length + " lineups</b>, " + Object.keys(dkData.salaries || {}).length + " players with salary/team info" +
      (dkData.files.length ? " · from " + esc(dkData.files.join(", ")) : "") + (dkData.importedAt ? " · " + new Date(dkData.importedAt).toLocaleString() : "");
  }
  function importText(text, name, replaceFirst) {
    var r = SCC.parseDK(text);
    if (replaceFirst) dkData = { lineups: [], salaries: {}, files: [], importedAt: null };
    dkData.lineups = dkData.lineups.concat(r.lineups);
    Object.assign(dkData.salaries, r.salaries);
    dkData.files.push(name);
    dkData.importedAt = Date.now();
    return r;
  }
  function importFiles(list) {
    var files = Array.prototype.slice.call(list || []), replace = modal.querySelector("#replace").checked, msgs = [];
    Promise.all(files.map(function (f) { return f.text().then(function (t) { return { f: f, t: t, r: SCC.parseDK(t) }; }); })).then(function (arr) {
      var hasLineups = arr.some(function (x) { return x.r.lineups.length; });
      if (replace && hasLineups) dkData = { lineups: [], salaries: {}, files: [], importedAt: null };
      arr.forEach(function (x) {
        importText(x.t, x.f.name, false);
        msgs.push(x.f.name + ": " + x.r.lineups.length + " lineups, " + Object.keys(x.r.salaries).length + " salaries");
      });
      finishImport(msgs);
    });
  }
  function finishImport(msgs) {
    save(LS.dk, dkData);
    modal.querySelector("#dkmsg").innerHTML = esc(msgs.join(" · ")) + "<br>" + dkSummary();
    cache = {}; tick();
  }

  function findUser() {
    var u = modal.querySelector("#su").value.trim(), msg = modal.querySelector("#sumsg");
    if (!u) return;
    msg.textContent = "Looking up…";
    fetch("https://api.sleeper.app/v1/user/" + encodeURIComponent(u)).then(function (r) { return r.json(); }).then(function (x) {
      if (!x || !x.user_id) { msg.innerHTML = '<span class="err">No Sleeper user named “' + esc(u) + "”.</span>"; return; }
      settings.username = x.username || u; settings.userId = x.user_id; settings.displayName = x.display_name || u;
      save(LS.settings, settings);
      msg.innerHTML = "Connected as <b>" + esc(settings.displayName) + "</b>";
      listLeagues(); cache = {}; tick();
    }).catch(function (e) { msg.innerHTML = '<span class="err">' + esc(e.message) + "</span>"; });
  }
  function listLeagues() {
    getJSON("https://api.sleeper.app/v1/state/nfl", 600).then(function (st) {
      return getJSON(SCC.urls(st.league_season, st.week).leagues(settings.userId), 60);
    }).then(function (ls) {
      var box = modal && modal.querySelector("#leaguelist");
      if (!box) return;
      box.innerHTML = ls.length ? ls.map(function (l) {
        return '<label class="lgopt"><input type="checkbox" data-lid="' + esc(l.league_id) + '"' + (settings.hidden.indexOf(l.league_id) < 0 ? " checked" : "") + "> " +
          esc(l.name) + ' <small style="color:var(--dim)">' + esc(l.status) + " · " + l.total_rosters + " teams</small></label>";
      }).join("") : '<span class="hint">No leagues found for this season.</span>';
      box.querySelectorAll("input").forEach(function (cb) {
        cb.addEventListener("change", function () {
          var id = cb.getAttribute("data-lid");
          settings.hidden = settings.hidden.filter(function (x) { return x !== id; });
          if (!cb.checked) settings.hidden.push(id);
          save(LS.settings, settings); tick();
        });
      });
    });
  }
  function launchLayout() {
    var W = screen.availWidth, H = screen.availHeight, X = screen.availLeft || 0, Y = screen.availTop || 0;
    var D = display(), w2 = Math.round(W * D.rz[0]), h2 = Math.round(H * D.rz[1]);
    var spec = function (x, y, w, h) { return "popup=yes,left=" + (X + x) + ",top=" + (Y + y) + ",width=" + w + ",height=" + h; };
    var base = location.href.split("?")[0] + "?";
    var opened = [
      window.open(base + params({ view: "rail" }), "scc-rail", spec(w2, 0, W - w2, H)),
      window.open(base + params({ view: "strip" }), "scc-strip", spec(0, h2, w2, H - h2))
    ];
    if (settings.redzoneUrl) opened.push(window.open(settings.redzoneUrl, "redzone", spec(0, 0, w2, h2)));
    if (opened.some(function (w) { return !w; })) alert("Your browser blocked some pop-up windows. Allow pop-ups for this page and click again.");
  }

  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-act]"), g = e.target.closest("[data-game]");
    if (a) {
      var act = a.getAttribute("data-act");
      if (act === "settings") openSettings();
      else if (act === "close") { modal.remove(); modal = null; }
      else if (act === "help") document.querySelector(".help").classList.toggle("on");
      else if (act === "finduser") findUser();
      else if (act === "espnload") espnLoad();
      else if (act === "espnadd") espnAdd();
      else if (act === "espnremove") { settings.espn.splice(+a.getAttribute("data-i"), 1); save(LS.settings, settings); renderEspnList(); tick(); }
      else if (act === "proxytest") proxyTest();
      else if (act === "clearfeed") { feed = []; save(LS.feed, feed); render(); }
      else if (act === "importpaste") { var t = modal.querySelector("#paste").value; if (t.trim()) { var r = importText(t, "pasted", modal.querySelector("#replace").checked); finishImport(["pasted: " + r.lineups.length + " lineups, " + Object.keys(r.salaries).length + " salaries"]); } }
      else if (act === "cleardk") { dkData = { lineups: [], salaries: {}, files: [], importedAt: null }; finishImport(["cleared"]); }
      else if (act === "launch") { saveForm(); launchLayout(); }
      else if (act === "savesettings") { saveForm(); modal.remove(); modal = null; start(); }
      else if (act === "wipe") { if (confirm("Forget your username, lineups and feed in this browser?")) { Object.keys(LS).forEach(function (k) { localStorage.removeItem(LS[k]); }); location.reload(); } }
      return;
    }
    if (g && !modal) { var id = g.getAttribute("data-game"); focus = focus === id ? null : id; render(); }
  });
  function saveForm() {
    if (!modal) return;
    settings.redzoneUrl = modal.querySelector("#rz").value.trim();
    settings.zoom = parseFloat(modal.querySelector("#zoom").value) || 1;
    settings.display = modal.querySelector("#display").value || "auto";
    readEspnCreds();
    settings.poll = Math.max(10, parseInt(modal.querySelector("#poll").value, 10) || 15);
    settings.sound = modal.querySelector("#sound").checked;
    save(LS.settings, settings);
    render();
  }
  document.addEventListener("keydown", function (e) {
    if (/INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === "Escape") { if (modal) { modal.remove(); modal = null; } focus = null; document.querySelector(".help").classList.remove("on"); render(); }
    else if (e.key === "s") openSettings();
    else if (e.key === "m") { settings.sound = !settings.sound; save(LS.settings, settings); }
    else if (e.key === "+" || e.key === "=") { settings.zoom = Math.min(2, (settings.zoom || 1) + 0.05); save(LS.settings, settings); render(); }
    else if (e.key === "-") { settings.zoom = Math.max(0.5, (settings.zoom || 1) - 0.05); save(LS.settings, settings); render(); }
    else if (e.key === "?") document.querySelector(".help").classList.toggle("on");
    else if (e.key === "r") { cache = {}; tick(); }
    else if (/^[1-9]$/.test(e.key) && S) {
      var live = S.games.filter(function (g) { return g.state === "in"; });
      var g = live[+e.key - 1]; focus = g ? g.id : null; render();
    }
  });
  addEventListener("resize", render);
  window.SCC_DISPLAYS = DISPLAYS;

  var help = document.createElement("div");
  help.className = "help";
  help.innerHTML = "<h2>Keys</h2><b>1–9</b> spotlight the Nth live game (your players in it get outlined) · <b>Esc</b> clear · <b>s</b> settings · <b>r</b> refresh now · <b>m</b> sound on/off · <b>+ / −</b> zoom · <b>?</b> this help" +
    "<h2 style='margin-top:1em'>Legend</h2><span class='tag me'>3</span> your Sleeper starters in a game · <span class='tag op'>2</span> opponents' starters · <span class='tag dk'>5</span> DK lineup slots · <span class='tag rz'>RZ</span> offense inside the 20 · 🏈 has the ball · gold ring = just scored" +
    "<p style='margin-top:1em;color:var(--dim)'>DK points are calculated from Sleeper's live stats with DraftKings Classic scoring, so they can lag or differ slightly from DK's official numbers. Contest ranks and payouts live in DK My Contests.</p>";
  document.body.appendChild(help);

  if (!DEMO && !settings.userId && !(settings.espn || []).length && !dkData.lineups.length) { render(); openSettings(); }
  start();
})();
