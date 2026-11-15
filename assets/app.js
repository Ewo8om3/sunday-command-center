/* Sunday Command Center - the board. Static, no build step, no dependencies, no server.
 * Data, scoring and every rule that can be tested without a browser live in assets/core.js (tested with
 * `node --test`). This file fetches, keeps state, and draws.
 *
 * URL switches (all optional):
 *   ?demo=1                 offline demo (fantasy only)   &dfs=1 (or &dfs=8)   add demo DraftKings lineups
 *   &leagues=1..5           how many demo leagues          &t=40                fast-forward the demo 40 plays (default 20)
 *   &freeze=1               stop the demo clock
 *   ?view=board|rail|strip  force a layout (default: chosen from the window's shape; the old view=all = board)
 *   ?show=fantasy|both|dfs  what this window shows when DraftKings is on (remembered per window)
 *   ?onboard=1              show first-run setup          ?open=settings       open Settings on load
 *   ?state=norz|stale|loading|empty|notupdating          preview an edge state (demo)
 *   ?season= &week= &season_type=post                   look at another week (real data)
 */
(function () {
  "use strict";
  var LS = { settings: "scc2.settings", dk: "scc2.dk", feed: "scc2.feed", prev: "scc2.prev", good: "scc2.lastgood" };
  var OLD = { settings: "scc.settings.v1", dk: "scc.dk.v1", feed: "scc.feed.v1", prev: "scc.prev.v1" };
  var qs = new URLSearchParams(location.search);
  var DEMO = qs.has("demo") && !!window.SCC_DEMO;
  var FORCE_VIEW = qs.get("view"), FORCE_STATE = DEMO ? qs.get("state") : null;
  var demoLeagues = Math.max(0, Math.min(5, qs.has("leagues") ? +qs.get("leagues") || 0 : 3));
  var demoDfs = qs.has("dfs") ? (+qs.get("dfs") > 1 ? Math.min(150, +qs.get("dfs")) : 6) : 0;
  var DEFAULTS = { username: "", userId: "", displayName: "", hidden: [], espn: [], espnS2: "", espnSwid: "", proxyUrl: "http://localhost:8766",
    scoresViaHelper: false, dfsOn: false, redzoneUrl: "", sound: false, banners: true, textSize: 1, minDelta: 1.5, poll: 15, order: [], noWake: false };
  var esc = SCC.esc;   // every user-, file- or API-supplied string that goes into innerHTML passes through esc()

  function loadRaw(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function load(k, d) { var v = loadRaw(k); return v == null || typeof v !== "object" ? clone(d) : Object.assign(Array.isArray(d) ? [] : {}, clone(d), v); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function save(k, v) { if (DEMO) return; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn("localStorage", e); } }

  /* settings: the redesign's keys, or a one-time copy of the first version's (the old keys are left alone) */
  var settings, dkData;
  (function () {
    if (DEMO) { settings = clone(DEFAULTS); dkData = { lineups: [], salaries: {}, files: [], importedAt: null }; return; }
    var cur = loadRaw(LS.settings), oldS = loadRaw(OLD.settings), oldDk = loadRaw(OLD.dk);
    if (!cur && oldS) {
      settings = Object.assign(clone(DEFAULTS), SCC.migrateSettings(oldS, oldDk));
      save(LS.settings, settings);
      if (oldDk && !loadRaw(LS.dk)) save(LS.dk, oldDk);
      [["feed", "feed"], ["prev", "prev"]].forEach(function (p) { var v = loadRaw(OLD[p[0]]); if (v && !loadRaw(LS[p[1]])) save(LS[p[1]], v); });
    } else settings = load(LS.settings, DEFAULTS);
    dkData = load(LS.dk, { lineups: [], salaries: {}, files: [], importedAt: null });
    if (!Array.isArray(settings.order)) settings.order = [];
    if (!Array.isArray(settings.hidden)) settings.hidden = [];
    if (!Array.isArray(settings.espn)) settings.espn = [];
  })();

  /* feed, last snapshot and last good league cards are saved with their season + week, and dropped when the
     week changes, so a new week starts clean. Demo mode never touches any of them. */
  var feedRaw = DEMO ? null : loadRaw(LS.feed), prevRaw = DEMO ? null : loadRaw(LS.prev), goodRaw = DEMO ? null : loadRaw(LS.good);
  var feed = [], prevInterest = null, lastGood = {}, weekKey = null;
  function adoptWeek(st) {
    var k = st.season + "|" + st.seasonType + "|" + st.week;
    if (k === weekKey) return;
    if (weekKey === null && !DEMO) {
      feed = SCC.scoped(feedRaw, st.season, st.week, st.seasonType) || [];
      prevInterest = SCC.scoped(prevRaw, st.season, st.week, st.seasonType);
      lastGood = SCC.scoped(goodRaw, st.season, st.week, st.seasonType) || {};
    } else { feed = []; prevInterest = null; hot = {}; lastGood = {}; moment = null; }
    weekKey = k;
  }
  function scopedSave(k, data) { if (!DEMO && S) save(k, { season: S.season, week: S.week, seasonType: S.seasonType, data: data }); }

  var curM = "fantasy", S = null, lastErr = "", focus = null, hot = {}, busy = false, timer = null, moment = null;
  var fails = 0, tickStarted = 0, paused = false, nextAt = 0, sbLive = true, sbVia = "espn", failedLeagues = {};
  var showMode = qs.get("show") || recall();
  var app = document.getElementById("app");

  /* what this window shows (leagues, both, DraftKings) is remembered per window, so a rail and a strip can differ */
  function recall() { try { return sessionStorage.getItem("scc2.show"); } catch (e) { return null; } }
  function remember(v) { try { v ? sessionStorage.setItem("scc2.show", v) : sessionStorage.removeItem("scc2.show"); } catch (e) { } }
  function f1(x) { return (Math.round((+x || 0) * 10) / 10).toFixed(1); }
  function signed(x) { x = +x || 0; return (x > 0.04 ? "+" : x < -0.04 ? "\u2212" : "") + f1(Math.abs(x)); }
  function plural(n, w) { n = +n || 0; return n + " " + w + (n === 1 ? "" : "s"); }
  function dfsOn() { return DEMO ? demoDfs > 0 : !!(settings.dfsOn && dkData.lineups.length); }
  function hasLeagues() { return DEMO ? demoLeagues > 0 : !!(settings.userId || (settings.espn || []).length); }
  function isLoopback(u) { return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(String(u || "").trim()); }
  function proxyBase() { return String(settings.proxyUrl || "").trim().replace(/\/$/, ""); }

  /* ---------------------------------------------------------------- fetch with timeout, TTL cache and per-source health */
  var cache = {}, health = {}, tickId = 0, TIMEOUT_MS = 12000, forceFresh = false;   // forceFresh: skip the TTL once, keep cached copies as fallback
  function fetchT(url, opts) {   // fetch with a timeout, so one hung request can't stop refreshes
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null, t;
    opts = Object.assign({}, opts || {}, ctl ? { signal: ctl.signal } : {});
    if (ctl) t = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS);
    return fetch(url, opts).then(function (r) { clearTimeout(t); return r; }, function (e) {
      clearTimeout(t); throw (e && e.name === "AbortError") ? new Error("timed out") : e;
    });
  }
  function mark(src, critical, okAt, err) {
    if (!src) return;
    var h = health[src] || (health[src] = { ok: 0, fails: 0, err: "", critical: !!critical });
    h.critical = !!critical; h.seen = tickId;
    if (err) { h.fails++; h.err = err; } else if (okAt) { h.ok = Math.max(h.ok, okAt); h.fails = 0; h.err = ""; }
  }
  /* opt: {src: name for the status line, critical: counts toward the data age, stale: false to throw instead of
     falling back to the cached copy, onFail: called when the fetch failed (even if a cached copy is returned)}.
     A fallback to cache is recorded as a failure, never as fresh. */
  function getJSON(url, ttl, opt) {
    opt = opt || {};
    var c = cache[url], now = Date.now();
    if (c && !forceFresh && now - c.t < ttl * 1000) { mark(opt.src, opt.critical, c.t); return Promise.resolve(c.v); }
    return fetchT(url, Object.assign({ cache: "no-store" }, opt.fetch || {})).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (v) { var t = Date.now(); cache[url] = { t: t, v: v }; mark(opt.src, opt.critical, t); return v; })
      .catch(function (e) {
        mark(opt.src, opt.critical, 0, (e && e.message) || "failed");
        if (opt.onFail) opt.onFail(e);
        if (c && opt.stale !== false) return c.v;
        throw e;
      });
  }

  /* ESPN fantasy: public leagues load directly (ESPN allows it). Private leagues try your browser's own ESPN
     login, then the optional helper on this computer (proxy/espn_proxy.py), which adds espn_s2/SWID. */
  var espnMode = {};
  function espnFetch(path, key, src, onFail) {
    var c = cache[path];
    if (c && !forceFresh && Date.now() - c.t < 20000) { mark(src, true, c.t); return Promise.resolve(c.v); }
    function get(url, opts) {
      return fetchT(url, opts).then(function (r) {
        if (r.status === 401 || r.status === 403) { var e = new Error("private"); e.auth = true; throw e; }
        if (r.status === 404) { var n = new Error("not found"); n.notFound = true; throw n; }
        if (!r.ok) throw new Error("ESPN " + r.status);
        return r.json();
      });
    }
    function viaProxy() {
      var h = {};
      // cookies only ever go to a helper on this computer, never to another host typed into the helper field
      if (!isLoopback(settings.proxyUrl)) { var x = new Error("the helper address must be http://localhost:<port> or http://127.0.0.1:<port>"); x.auth = true; return Promise.reject(x); }
      if (settings.espnS2 && settings.espnSwid) { h["X-Espn-S2"] = settings.espnS2; h["X-Espn-Swid"] = settings.espnSwid; }
      return get(proxyBase() + "/espn" + path, { headers: h, credentials: "omit" })
        .catch(function (e) {
          var x = new Error(e.auth ? (settings.espnS2 && settings.espnSwid ? "the helper is running but ESPN rejected the login cookies (expired? copy them again)"
            : "the helper is running but has no ESPN login cookies yet") : "private league, and the helper isn't running");
          x.auth = true; x.proxy = !!e.auth; throw x;
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
    return p.then(function (v) { var t = Date.now(); cache[path] = { t: t, v: v }; mark(src, true, t); return v; })
      .catch(function (e) { mark(src, true, 0, e.message || "failed"); if (onFail) onFail(e); if (c) return c.v; throw e; });
  }

  /* The live game feed (clock, possession, red zone): ESPN's public scoreboard, read straight from the browser.
     If it fails and the helper is switched on for scores, the helper fetches it. Otherwise Sleeper's schedule
     stands in (scores and status, no clock or red zone) and the board says so where the red zone would be. */
  function scoreboard(U) {
    return getJSON(U.scoreboard, 10, { src: "Live game feed", critical: true, stale: false }).then(function (sb) { return { sb: sb, live: true, via: "espn" }; })
      .catch(function (e1) {
        var viaHelper = settings.scoresViaHelper && isLoopback(settings.proxyUrl)
          ? getJSON(proxyBase() + "/scores" + U.scoreboard.replace(/^[^?]*/, ""), 10, { src: "Live game feed", critical: true, stale: false, fetch: { credentials: "omit" } })
            .then(function (sb) { return { sb: sb, live: true, via: "helper" }; })
          : Promise.reject(e1);
        return viaHelper.catch(function () {
          return getJSON(U.schedule, 60, { src: "Sleeper schedule" }).then(function (sc) { return { schedule: sc, live: false, via: "sleeper" }; })
            .catch(function () { var c = cache[U.scoreboard]; if (c) return { sb: c.v, live: false, via: "old" }; throw e1; });
        });
      });
  }

  function gather() {
    var failed = {};
    return getJSON("https://api.sleeper.app/v1/state/nfl", 600, { src: "Sleeper week" }).then(function (st) {
      var season = qs.get("season") || st.league_season || st.season, week = qs.get("week") || st.display_week || st.week;
      var seasonType = qs.get("season_type") || (st.season_type === "post" ? "post" : "regular");
      var U = SCC.urls(season, week, seasonType, qs.get("week"));
      var sleeperP = !settings.userId ? Promise.resolve(null) : getJSON(U.leagues(settings.userId), 1800, { src: "Sleeper leagues",
        onFail: function () { Object.keys(lastGood).forEach(function (id) { if (lastGood[id].m.platform === "sleeper") failed[id] = true; }); } })
        .then(function (ls) {
          ls = (ls || []).filter(function (l) { return (l.status === "in_season" || l.status === "post_season") && settings.hidden.indexOf(String(l.league_id)) < 0; });
          return Promise.all(ls.map(function (l) {
            var nm = "Sleeper: " + String(l.name || l.league_id).trim(), id = String(l.league_id), bad = function () { failed[id] = true; };
            return Promise.all([getJSON(U.rosters(id), 900, { src: nm + " rosters", onFail: bad }), getJSON(U.users(id), 3600, { src: nm + " members", onFail: bad }),
              getJSON(U.matchups(id), 15, { src: nm, critical: true, onFail: bad })])
              .then(function (a) { return { league: l, rosters: a[0], users: a[1], matchups: a[2] }; })
              .catch(function (e) { failed[id] = true; lastErr = String(l.name || "A Sleeper league") + ": " + e.message; return null; });
          }));
        }).then(function (L) { return { userId: settings.userId, leagues: L.filter(Boolean) }; })
        .catch(function (e) { lastErr = "Sleeper leagues: " + e.message; return null; });
      var espnP = Promise.all((settings.espn || []).map(function (cfg) {
        var id = String(cfg.leagueId), bad = function () { failed[id] = true; };
        return espnFetch(SCC.espnPath(cfg.season || season, cfg.leagueId, week), cfg.leagueId + ":" + cfg.season, "ESPN: " + (cfg.leagueName || cfg.leagueId), bad)
          .then(function (d) { return { cfg: cfg, data: d }; })
          .catch(function (e) { failed[id] = true; lastErr = (cfg.leagueName || "ESPN league") + ": " + e.message; return null; });
      })).then(function (a) { return a.filter(Boolean); });
      return Promise.all([scoreboard(U), getJSON(U.stats, 15, { src: "Sleeper stats", critical: true }), getJSON(U.projections, 1800, { src: "Sleeper projections" }), sleeperP, espnP])
        .then(function (a) {
          var st2 = SCC.buildState({ season: season, week: week, seasonType: seasonType, scoreboard: a[0].sb || null, schedule: a[0].schedule, stats: a[1], projections: a[2],
            sleeper: a[3], espn: a[4], dk: dfsOn() ? dkData : { lineups: [], salaries: {} } });
          return { st: st2, live: a[0].live, via: a[0].via, failed: failed };
        });
    });
  }
  function demoState() {
    var st = SCC.buildState(SCC_DEMO.raw({ leagues: FORCE_STATE === "empty" ? 0 : demoLeagues, dfs: demoDfs }));
    st.sleeper.forEach(function (m) { m.platform = SCC_DEMO.platform(m.leagueId); });
    if (FORCE_STATE === "norz") { st.scoreSource = "sleeper-schedule"; st.games.forEach(function (g) { g.rz = false; g.poss = null; g.dd = ""; if (g.state === "in") g.detail = "Live"; }); }
    var failed = {};
    if (FORCE_STATE === "notupdating" && st.sleeper[1]) failed[st.sleeper[1].leagueId] = true;
    return { st: st, live: FORCE_STATE !== "norz", via: "espn", failed: failed };
  }

  /* ---------------------------------------------------------------- refresh loop */
  function absorb(r, now, quiet) {
    var st = r.st;
    adoptWeek(st);
    var ev = SCC.diffEvents(prevInterest, st.interest, settings.minDelta);
    ev.forEach(function (e) {
      e.t = now; hot[e.pid] = now;
      if (!dfsOn()) { e.dk = 0; if (!e.mine.length && !e.opp.length) return; }
      feed.unshift(e);
      if (e.td || Math.abs(e.delta) >= 5 || Math.abs(e.dkDelta || 0) >= 5) {
        if (!moment || !moment.td || e.td || now - moment.t > 30000) { moment = e; if (!quiet) flash(e.tone); }
      }
    });
    if (ev.length && settings.sound && !quiet) chime(ev.some(function (e) { return e.tone === "good"; }));
    feed = feed.slice(0, 80);
    prevInterest = st.interest;
    /* league order: the order leagues first showed up (= the order you added them), kept in settings */
    var changed = false;
    st.sleeper.forEach(function (m) { var id = String(m.leagueId); if (settings.order.indexOf(id) < 0) { settings.order.push(id); changed = true; } });
    if (changed) save(LS.settings, settings);
    /* "not updating": remember each league's last good card; a failed league keeps its card with a tag */
    var t = Date.now();
    if (DEMO && FORCE_STATE === "notupdating") Object.keys(r.failed).forEach(function (id) {
      if (!lastGood[id]) st.sleeper.forEach(function (m) { if (String(m.leagueId) === id) lastGood[id] = { m: clone(m), t: t - 180000 }; });
    });
    st.sleeper.forEach(function (m) { if (!r.failed[String(m.leagueId)]) lastGood[String(m.leagueId)] = { m: m, t: t }; });
    Object.keys(lastGood).forEach(function (id) { if (!stillConnected(lastGood[id].m)) delete lastGood[id]; });
    st.sleeper = SCC.keepStale(st.sleeper, lastGood, r.failed, settings.order);
    failedLeagues = r.failed; sbLive = r.live; sbVia = r.via;
    S = st;
  }
  function stillConnected(m) {
    if (DEMO) return true;
    if (m.platform === "espn") return (settings.espn || []).some(function (c) { return String(c.leagueId) === String(m.leagueId); });
    return !!settings.userId && settings.hidden.indexOf(String(m.leagueId)) < 0;
  }
  /* setTimeout chain: polls at your rate while games are live, slows to every minute / 5 minutes when nothing
     is live, backs off after failures, and pauses while the tab is hidden. */
  function schedule(ms) { clearTimeout(timer); nextAt = Date.now() + ms; timer = setTimeout(tick, ms); }
  function tick() {
    if (FORCE_STATE === "loading") return;
    if (busy && Date.now() - tickStarted < 60000) return;
    if (!DEMO && document.hidden && S) { paused = true; clearTimeout(timer); nextAt = 0; return; }
    paused = false; busy = true; tickStarted = Date.now(); tickId++; lastErr = "";
    var p = DEMO ? Promise.resolve().then(function () { if (S && !qs.has("freeze")) SCC_DEMO.step(); return demoState(); }) : gather();
    p.then(function (r) {
      Object.keys(health).forEach(function (k) { if (health[k].seen !== tickId) delete health[k]; });   // removed leagues
      absorb(r, Date.now(), false);
      scopedSave(LS.feed, feed); scopedSave(LS.prev, r.st.interest); scopedSave(LS.good, lastGood);
      var ds = SCC.dataStatus(health, Date.now(), settings.poll);
      fails = ds.level === "offline" ? fails + 1 : ds.failing.length ? 1 : 0;
    }).catch(function (e) {
      /* couldn't even start (e.g. no connection at all): nothing on the board is fresh any more */
      Object.keys(health).forEach(function (k) { if (health[k].seen !== tickId) mark(k, health[k].critical, 0, "not reached"); });
      fails++; lastErr = (e && e.message) || String(e); console.warn(e);
    })
      .then(function () {
        busy = false; forceFresh = false;
        if (!sheet || !sheet.classList.contains("onboarding")) render();
        schedule(DEMO ? 5000 : SCC.pollDelay(S ? S.games : [], Date.now(), settings.poll, fails));
      });
  }
  function refreshNow() { forceFresh = true; busy = false; tick(); }
  function start() {
    if (DEMO) {                                       /* fast-forward so the feed and scores aren't empty */
      var n = Math.min(400, qs.has("t") ? +qs.get("t") || 0 : 20), now = Date.now();
      if (n) {
        absorb(demoState(), now - n * 20000, true);
        for (var i = 1; i <= n; i++) { SCC_DEMO.step(); absorb(demoState(), now - (n - i) * 20000 - 9000, true); }
      }
    }
    tick();
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && paused) tick(); keepAwake(); });
  setInterval(function () { var c = document.getElementById("clock"); if (c) c.textContent = clockStr(); if (S && !sheet) paintAges(); }, 1000);

  /* ---------------------------------------------------------------- layout: decided by the window's own shape */
  function layout() { return SCC.chooseLayout(innerWidth, innerHeight, FORCE_VIEW); }
  function mode(L) {
    if (!dfsOn()) return "fantasy";
    if (showMode === "fantasy" || showMode === "dfs" || showMode === "both") return showMode;
    if (!hasLeagues()) return "dfs";
    return L === "strip" ? "dfs" : "both";
  }
  function sizeRoot(L, M) {
    var w = innerWidth, h = innerHeight, u;
    if (L === "rail") u = Math.min(w / (M === "both" ? 33 : 31), h / (M === "both" ? 78 : 70));
    else if (L === "strip") u = Math.min(h / 17.5, w / 104);
    else u = Math.min(w / (M === "both" ? 124 : 108), h / 58);
    document.documentElement.style.fontSize = Math.max(11, u * (settings.textSize || 1)).toFixed(2) + "px";
  }

  /* ---------------------------------------------------------------- view-model helpers */
  var dupLast = {};
  function nameIndex() {
    var seen = {}; dupLast = {};
    Object.keys(S.interest).forEach(function (pid) { var l = SCC.lastName(S.interest[pid].name); if (seen[l] && seen[l] !== pid) dupLast[l] = 1; seen[l] = pid; });
  }
  function nm(name) {
    var l = SCC.lastName(name), n = String(name == null ? "" : name);
    if (SCC.NICK[SCC.norm(l)]) return l;                         // team defense -> nickname
    return dupLast[l] && n.length > l.length ? n.charAt(0) + ". " + l : l;
  }
  function clockStr() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M/i, ""); }
  function ago(t) { var s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 45 ? "now" : s < 3600 ? Math.max(1, Math.round(s / 60)) + "m" : Math.round(s / 3600) + "h"; }
  function since(t) { return Date.now() - t < 45000 ? "" : " for " + ago(t); }
  function kickDate(g) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(g.kick || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(g.kick); }
  function gameClock(g) {
    if (g.state === "pre") {
      if (g.kickTBD) { var k = kickDate(g); return new Date().toDateString() === k.toDateString() ? "Today" : k.toLocaleDateString([], { weekday: "short" }); }
      var d = new Date(g.kick), today = new Date().toDateString() === d.toDateString();
      return (today ? "" : d.toLocaleDateString([], { weekday: "short" }) + " ") + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M/i, "");
    }
    var m = /^(\d+:\d+) - (\w+)$/.exec(g.detail || "");
    return m ? "Q" + parseInt(m[2], 10) + " " + m[1] : String(g.detail || "").replace("Halftime", "Half");
  }
  function leagueShort(n) { return String(n == null ? "" : n).replace(/^The /, "").replace(/ (League|Dynasty)$/, ""); }
  function freshness() {
    if (DEMO) return null;
    var ds = SCC.dataStatus(health, Date.now(), settings.poll);
    var fail = ds.failing.map(function (k) { return k + " (" + health[k].err + ")"; });
    var age = ds.age == null ? "" : ds.age < 90 ? ds.age + "s" : ds.age < 5400 ? Math.round(ds.age / 60) + "m" : Math.round(ds.age / 3600) + "h";
    var next = nextAt && !busy ? Math.max(0, Math.round((nextAt - Date.now()) / 1000)) : null;
    var txt = ds.level === "connecting" ? "Connecting" : ds.level === "ok" ? "Updated " + age + " ago" : ds.level === "stale" ? "Some data " + age + " old" : "Offline";
    if (paused) txt += ", paused while hidden"; else if (ds.level === "ok" && next != null && next > 45) txt += ", next in " + Math.round(next / 60) + "m";
    return { level: ds.level, age: ds.age, text: txt, title: fail.length ? "Not answering: " + fail.join(", ") : "Every feed answered on the last refresh" };
  }

  /* ---------------------------------------------------------------- pieces */
  var MARK = { good: "\u25B2", bad: "\u25BC", mix: "\u25C6" };
  function header(L, M) {
    var live = 0;
    S.games.forEach(function (g) { if (g.state === "in") live++; });
    var v = SCC.verdict(S.sleeper);
    var first = S.games.filter(function (g) { return g.state === "pre"; }).sort(function (a, b) { return String(a.kick).localeCompare(String(b.kick)); })[0];
    var slate = live ? plural(live, "game") + " live" : first ? (first.kickTBD ? "Next game " + gameClock(first) : "Kickoff " + gameClock(first)) : S.games.length ? "All games final" : "No games this week";
    var modes = !dfsOn() ? "" : '<div class="seg" role="group" aria-label="What to show">' + [["fantasy", "Leagues"], ["both", "Both"], ["dfs", "DraftKings"]].map(function (x) {
      return '<button data-act="mode" data-v="' + x[0] + '"' + (x[0] === M ? ' aria-pressed="true"' : "") + ">" + x[1] + "</button>"; }).join("") + "</div>";
    var fr = freshness();
    var frHtml = fr ? '<span class="fresh ' + esc(fr.level) + '" id="fresh" title="' + esc(fr.title) + '"><i aria-hidden="true"></i><span>' + esc(fr.text) + "</span></span>" : "";
    return '<header class="top"><div class="slate"><b>Week ' + esc(S.week) + "</b><span>" + esc(slate) + "</span>" +
      (S.seasonType === "post" ? '<span class="demo" title="Built and tested for the regular season">Playoffs, experimental</span>' : "") +
      (DEMO ? '<span class="demo">Demo data</span>' : "") + "</div>" +
      (M === "dfs" ? '<div class="verdict">' + dfsVerdict() + "</div>" :
        '<div class="verdict">' + (v.text ? '<span class="pips">' + v.pips.map(function (s) { return '<i class="' + esc(s) + '"></i>'; }).join("") + "</span><strong>" + esc(v.text) + "</strong>" +
        (v.toss ? "<span>" + (+v.toss) + " too close to call</span>" : "") : "") + "</div>") +
      '<div class="tools">' + frHtml + modes + (SCC.safeUrl(settings.redzoneUrl) ? '<a class="rzlink" target="redzone" rel="noopener" href="' + esc(SCC.safeUrl(settings.redzoneUrl)) + '">RedZone</a>' : "") +
      '<span class="clock num" id="clock">' + clockStr() + '</span><button class="icon" data-act="settings" aria-label="Settings" title="Settings (S)">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/></svg></button></div></header>';
  }
  function dfsVerdict() {
    var dk = S.dk; if (!dk.lineups.length) return "";
    var best = dk.lineups.reduce(function (a, b) { return b.pts > a.pts ? b : a; });
    return "<strong>Best lineup " + f1(best.pts) + "</strong><span>" + plural(dk.lineups.length, "lineup") + " in play</span>";
  }

  function playerRow(r) {
    var g = r.game && S.gameById[r.game], rz = r.status === "in" && r.rz && r.poss && sbLive;
    var cls = ["pl", r.status, rz ? "rz" : "", r.poss && r.status === "in" && sbLive ? "ball" : "", hot[r.id] && Date.now() - hot[r.id] < 90000 ? "hot" : "",
      focus && r.game === focus ? "focus" : "", r.inj === "Out" || r.inj === "IR" || r.inj === "OUT" ? "out" : ""].join(" ");
    var val = r.status === "pre" ? '<span class="pt when">' + esc(g ? gameClock(g) : "") + "</span>" : r.status === "bye" ? '<span class="pt when">bye</span>' : '<span class="pt num">' + f1(r.pts) + "</span>";
    return '<li class="' + esc(cls) + '" title="' + esc(r.name + (r.team ? ", " + r.team : "") + (r.inj ? ", " + r.inj : "")) + '"><span class="pos">' + esc(r.pos) + '</span><span class="nm">' + esc(nm(r.name)) + "</span>" +
      (rz ? '<span class="flag rzf" title="In the red zone"></span>' : r.poss && r.status === "in" && sbLive ? '<span class="flag ballf" title="Has the ball"></span>' : "") + val + "</li>";
  }
  function sortPlayers(rows) {
    var ord = { in: 0, pre: 1, post: 2, bye: 3 }, o = function (s) { return ord[s] == null ? 4 : ord[s]; };
    return (rows || []).slice().sort(function (a, b) { return o(a.status) - o(b.status) || (b.rz && b.poss) - (a.rz && a.poss) || b.pts - a.pts; });
  }
  function sideSub(x) {
    if (!x.playing && !x.yet) return "all done";
    return (x.playing ? (+x.playing) + " playing" : "") + (x.playing && x.yet ? ", " : "") + (x.yet ? (+x.yet) + " to go" : "");
  }
  function matchupCard(m) {
    var me = m.me, op = m.opp, st = SCC.muStatus(m), stale = m.notUpdating;
    var tag = stale ? '<span class="warn" title="This league\'s feed isn\'t answering. Showing its last numbers.">not updating<span class="num since" data-t="' + (+stale) + '">' + since(stale) + "</span></span>" : "";
    if (!op) return '<article class="mu bye' + (stale ? " notupd" : "") + '"><div class="mu-top"><span class="lg">' + esc(m.league) + "</span>" + tag + '</div><p class="quiet">No opponent this week. ' + esc(me.name) + " has " + f1(me.pts) + ".</p></article>";
    var wp = Math.max(0, Math.min(100, Math.round((+m.winProb || 0) * 100))), diff = me.pts - op.pts, pre = !me.pts && !op.pts && !me.playing && !op.playing, fin = SCC.muFinished(m);
    var margin = pre ? '<span class="lbl">projected</span>' + signed(me.live - op.live) : Math.abs(diff) < 0.05 ? "Tied" : signed(diff);
    return '<article class="mu ' + esc(st) + (fin ? " final" : "") + (stale ? " notupd" : "") + '">' +
      '<div class="mu-top"><span class="lg">' + esc(m.league) + '</span><span class="plat">' + (m.platform === "espn" ? "ESPN" : "Sleeper") + "</span>" + tag +
      '<span class="wp">' + (fin ? (diff >= 0 ? "Won" : "Lost") : '<b class="num">' + wp + '%</b><span> to win</span>') + "</span></div>" +
      '<div class="mu-score"><div class="side me"><span class="team">' + esc(me.name) + '</span><span class="pts num">' + f1(me.pts) + "</span></div>" +
      '<div class="margin num">' + margin + "</div>" +
      '<div class="side op"><span class="pts num">' + f1(op.pts) + '</span><span class="team">' + esc(op.name) + "</span></div></div>" +
      '<div class="field" role="img" aria-label="' + wp + ' percent chance to win"><i class="drive" style="width:' + wp + '%"></i><i class="ball" style="left:' + wp + '%"></i></div>' +
      '<div class="mu-sub num"><span>' + sideSub(me) + "<em> \u00B7 on pace for " + f1(me.live) + "</em></span><span><em>on pace for " + f1(op.live) + " \u00B7 </em>" + sideSub(op) + "</span></div>" +
      '<div class="mu-players"><ul class="me">' + sortPlayers(me.starters).map(playerRow).join("") + (me.empty ? '<li class="pl empty">' + plural(me.empty, "empty slot") + "</li>" : "") +
      '</ul><ul class="op">' + sortPlayers(op.starters).map(playerRow).join("") + "</ul></div></article>";
  }
  function matchups(L) {
    var ms = S.sleeper;
    if (!ms.length) {
      var any = hasLeagues(), down = any && Object.keys(failedLeagues).length;
      return '<section class="matchups empty"><div class="blank"><h2>' + (down ? "Your leagues aren't answering" : any ? "No matchups this week" : "Add a league to get started") + "</h2><p>" +
        (down ? "Sleeper or ESPN didn't answer. This page keeps trying by itself." : any ? "Your leagues don't have a game on the schedule for week " + esc(S.week) + ". Scores and red-zone alerts still run." : "Connect Sleeper or ESPN and your matchups show up here.") +
        "</p>" + (down ? "" : '<button class="btn primary" data-act="' + (any ? "settings" : "onboard") + '">' + (any ? "Check my leagues" : "Add a league") + "</button>") + "</div></section>";
    }
    var cols = L === "strip" ? Math.ceil(ms.length / (ms.length > 3 ? 2 : 1)) : L === "board" && ms.length >= 4 ? 2 : 1;
    var cls = (L === "board" && curM === "fantasy" && cols === 1 && ms.length >= 3 ? " wide" : "") + (L !== "board" || cols > 1 || curM === "both" ? " stack" : "");
    return '<section class="matchups fit' + cls + '" style="--cols:' + (+cols) + '">' + ms.map(matchupCard).join("") + "</section>";
  }

  function whoLine(e, long) {
    var bits = [], lg = curM !== "dfs", dk = curM !== "fantasy" && e.dk, mine = e.mine || [], opp = e.opp || [];
    if (long) {
      if (!lg) return "In " + plural(e.dk, "DraftKings lineup");
      if (mine.length) bits.push("Yours in " + (mine.length > 1 ? mine.length + " leagues" : esc(leagueShort(mine[0]))));
      if (opp.length) bits.push((bits.length ? "against" : "Against") + " you in " + (opp.length > 1 ? opp.length + " leagues" : esc(leagueShort(opp[0]))));
      if (dk) bits.push((bits.length ? "in " : "In ") + plural(e.dk, "DraftKings lineup"));
      return bits.join(", ");
    }
    if (lg && mine.length) bits.push('<span class="you">' + MARK.good + " " + (mine.length > 1 ? mine.length + " leagues" : esc(leagueShort(mine[0]))) + "</span>");
    if (lg && opp.length) bits.push('<span class="them">' + MARK.bad + " " + (opp.length > 1 ? opp.length + " leagues" : esc(leagueShort(opp[0]))) + "</span>");
    if (dk) bits.push('<span class="cash">\u25CF ' + (lg ? (+e.dk) : plural(e.dk, "lineup")) + "</span>");
    return bits.join(" ");
  }
  /* a leagues-only window never mentions DraftKings; a DraftKings-only window never mentions leagues */
  function relevant(e) { return curM === "both" ? true : curM === "dfs" ? e.dk > 0 : (e.mine || []).length + (e.opp || []).length > 0; }
  function tone(e) { return MARK[e.tone] ? e.tone : "mix"; }
  function nowPanel() {
    var out = "", fresh = moment && settings.banners !== false && Date.now() - moment.t < 150000 && relevant(moment);
    if (fresh) {
      out += '<div class="moment ' + (curM === "dfs" ? "cashy" : tone(moment)) + '"><span class="mark">' + (curM === "dfs" ? "\u25CF" : MARK[tone(moment)]) + "</span><div><strong>" + (moment.td ? "Touchdown " : "") + esc(moment.name) +
        ' <span class="num">' + signed(curM === "dfs" ? moment.dkDelta || moment.delta : moment.delta) + "</span></strong><p>" + whoLine(moment, true) + '</p></div><span class="ago" data-t="' + (+moment.t) + '">' + ago(moment.t) + "</span></div>";
    }
    var rz = SCC.redZone(S, sbLive, curM);
    if (rz.status === "offline") {
      out += '<div class="notice"><strong>Red-zone tracking is offline</strong><p>The live game feed isn\'t answering, so there\'s no clock, possession or red zone right now. ' +
        (document.body.classList.contains("stale") ? "" : curM === "dfs" ? "Lineup points still update." : "Fantasy points still update.") + "</p></div>";
    } else {
      rz.staked.forEach(function (r) {
        out += '<div class="rzcard" data-game="' + esc(r.game) + '"><div class="rz-head"><span class="rz-tag">Red zone</span><b>' + esc(r.team) + "</b><span>" + esc(r.dd) + "</span></div>" +
          '<div class="rz-who">' + (r.mine.length ? '<span class="you">' + MARK.good + " " + esc(r.mine.join(", ")) + "</span>" : "") +
          (r.opp.length ? '<span class="them">' + MARK.bad + " " + esc(r.opp.join(", ")) + "</span>" : "") +
          (r.cash.length ? '<span class="cash">\u25CF ' + esc(r.cash.join(", ")) + "</span>" : "") + "</div></div>";
      });
      if (rz.other.length) out += '<p class="rz-other">' + (rz.staked.length ? "Also inside the 20: " : "Inside the 20, none of your players: ") + rz.other.map(function (r) { return "<b>" + esc(r.team) + "</b>"; }).join(", ") + "</p>";
      if (rz.status === "none" && !fresh) out += '<p class="rz-other">Nobody is inside the 20 right now.</p>';
      if (rz.status === "pregame" && !fresh) out += '<p class="rz-other">Red-zone alerts start at kickoff.</p>';
      if (rz.status === "active" && sbVia === "helper") out += '<p class="rz-other">Live game feed is coming through the helper on this computer.</p>';
    }
    return '<section class="now">' + out + "</section>";
  }
  function feedPanel() {
    var rows = feed.filter(relevant).slice(0, 24).map(function (e) {
      var t = curM === "dfs" ? "cashy" : tone(e);
      return '<li class="ev ' + t + (e.td ? " td" : "") + '"><span class="ago num" data-t="' + (+e.t) + '">' + ago(e.t) + '</span><span class="mark">' + (curM === "dfs" ? "\u25CF" : MARK[tone(e)]) + '</span><span class="what"><b>' + esc(nm(e.name)) + "</b>" +
        (e.td ? " touchdown" : "") + '</span><span class="delta num">' + signed(curM === "dfs" ? e.dkDelta || e.delta : e.delta) + '</span><span class="who">' + whoLine(e) + "</span></li>";
    }).join("");
    return '<section class="feed"><h2>' + (curM === "dfs" ? "Last plays that moved your lineups" : "Last plays that moved your score") + "</h2>" + (rows ? "<ol>" + rows + "</ol>" :
      '<p class="quiet">Nothing yet. Every catch, run and score by ' + (curM === "dfs" ? "a lineup player" : "one of your players") + " lands here.</p>") + "</section>";
  }
  function gamesPanel() {
    var ord = { in: 0, pre: 1, post: 2 }, showDk = curM !== "fantasy", showLg = curM !== "dfs";
    var gs = S.games.slice().sort(function (a, b) { return (ord[a.state] || 0) - (ord[b.state] || 0) || ((b.rz && sbLive) - (a.rz && sbLive)) || ((b.mine + b.against > 0) - (a.mine + a.against > 0)) || String(a.kick).localeCompare(String(b.kick)); });
    var key = (showLg ? '<span class="you">' + MARK.good + ' yours</span><span class="them">' + MARK.bad + " theirs</span>" : "") + (showDk ? '<span class="cash">\u25CF lineups</span>' : "");
    return '<section class="games"><h2><span>Games' + (sbLive ? "" : ' <span class="quiet" title="The live game feed is down. Scores come from Sleeper and can lag.">\u00B7 no clock right now</span>') + '</span><span class="key">' + key + '</span></h2><div class="glist">' +
      gs.map(function (g) {
        var rz = g.rz && sbLive, stake = (showLg ? g.mine + g.against : 0) + (showDk ? g.dk : 0);
        var t = function (tm, sc, other) {
          return '<span class="tm' + (g.state !== "pre" && sc > other ? " lead" : "") + (sbLive && g.poss === tm ? " poss" : "") + '">' + esc(tm) + (g.state === "pre" ? "" : ' <b class="num">' + (+sc || 0) + "</b>") + "</span>";
        };
        return '<button class="g ' + esc(g.state) + (rz ? " rz" : "") + (stake ? "" : " nostake") + (focus === g.id ? " focus" : "") + '" data-game="' + esc(g.id) + '" title="' + esc(g.last || "") + '">' +
          t(g.away, g.as, g.hs) + t(g.home, g.hs, g.as) + '<span class="clk num">' + esc(gameClock(g)) + '</span><span class="stake num">' +
          (showLg && g.mine ? '<span class="you">' + MARK.good + (+g.mine) + "</span>" : "") + (showLg && g.against ? '<span class="them">' + MARK.bad + (+g.against) + "</span>" : "") +
          (showDk && g.dk ? '<span class="cash">\u25CF' + (+g.dk) + "</span>" : "") + "</span></button>";
      }).join("") + "</div></section>";
  }

  /* ---------------------------------------------------------------- DraftKings deck (only exists when lineups are in play) */
  function dfsDeck() {
    var dk = S.dk;
    if (!dk.lineups.length) return '<section class="dfs"><div class="dfs-head"><h2>DraftKings</h2></div><p class="quiet">No lineups loaded. Settings, Daily fantasy.</p></section>';
    var ranked = dk.lineups.slice().sort(function (a, b) { return b.live - a.live; });
    var top = Math.max.apply(null, ranked.map(function (l) { return Math.max(l.live, l.pts); }).concat([1]));
    var fees = dk.contests.reduce(function (a, c) { return a + (+c.fees || 0); }, 0), bestPts = Math.max.apply(null, dk.lineups.map(function (l) { return l.pts; }));
    var avg = dk.lineups.reduce(function (a, l) { return a + l.pts; }, 0) / dk.lineups.length;
    var warn = [];
    if (dk.incomplete.length) warn.push("Missing players: " + dk.incomplete.map(function (x) { return "lineup " + (+x.n) + " (" + x.slots.join(", ") + ")"; }).join("; ") + ". Those totals are too low. Re-export the file.");
    if (dk.lineups.some(function (l) { return l.showdown; })) warn.push("Showdown: captain counts 1.5\u00D7, kickers aren't scored.");
    var head = '<div class="dfs-head"><h2>DraftKings</h2><span>' + plural(dk.lineups.length, "lineup") + (fees ? ", $" + (+fees) + " in play" : "") + '</span><span class="avg num">average ' + f1(avg) + "</span>" +
      '<a href="https://www.draftkings.com/mycontests" target="dkmc" rel="noopener">Contest standings</a></div>' + (warn.length ? '<p class="dfs-warn">' + esc(warn.join(" ")) + "</p>" : "");
    var ladder = '<ol class="ladder">' + ranked.map(function (lu, i) {
      return '<li class="' + (lu.pts === bestPts ? "best" : "") + '"><span class="rk num">' + (i + 1) + '</span><span class="id">Lineup ' + (+lu.n) + (lu.missing.length ? " \u2020" : "") + '</span><span class="bar"><i class="got" style="width:' + (100 * Math.max(0, lu.pts) / top).toFixed(1) +
        '%"></i><i class="rest" style="width:' + (100 * Math.max(0, lu.live - lu.pts) / top).toFixed(1) + '%"></i></span><span class="pts num">' + f1(lu.pts) + '</span><span class="pace num">on pace ' + f1(lu.live) +
        '</span><span class="left num">' + (lu.playing || lu.yet ? (+lu.playing) + " playing, " + (+lu.yet) + " to go" : "done") + "</span></li>";
    }).join("") + "</ol>";
    var ord = { in: 0, pre: 1, post: 2, bye: 3 }, o = function (s) { return ord[s] == null ? 3 : ord[s]; };
    var sweat = dk.exposure.slice().sort(function (a, b) { return o(a.status) - o(b.status) || (b.rz && b.poss) - (a.rz && a.poss) || b.count - a.count || b.pts - a.pts; });
    var sw = '<div class="sweat"><h2>Who you\'re sweating <span>most-used players, live first</span></h2><ol>' + sweat.slice(0, 30).map(function (e) {
      var rz = e.status === "in" && e.rz && e.poss && sbLive;
      return '<li class="pl ' + esc(e.status) + (rz ? " rz" : "") + (e.sid && hot[e.sid] && Date.now() - hot[e.sid] < 90000 ? " hot" : "") + (e.matched ? "" : " unmatched") + '"><span class="nm">' + esc(nm(e.name)) + " <small>" + esc(e.team || "") + "</small></span>" +
        (rz ? '<span class="flag rzf" title="In the red zone"></span>' : "<span></span>") + '<span class="expo"><i style="width:' + Math.max(0, Math.min(100, +e.pct || 0)) + '%"></i></span><span class="cnt num">' + (+e.count) + " of " + dk.lineups.length + '</span><span class="pt num">' +
        (e.status === "pre" ? "" : f1(e.pts)) + "</span></li>";
    }).join("") + "</ol>" + (dk.unmatched.length ? '<p class="warn-line">Couldn\'t match: ' + esc(dk.unmatched.join(", ")) + "</p>" : "") + "</div>";
    var cards = "";
    if (dk.lineups.length <= 10) {
      var n = dk.lineups.length;
      cards = '<div class="lineups" style="--n:' + n + ";--per:" + (n <= 3 ? n : n <= 6 ? 3 : n <= 8 ? 4 : 5) + '">' + ranked.map(function (lu) {
        return '<div class="lu' + (lu.pts === bestPts ? " best" : "") + '"><div class="lu-h"><span class="id"><span class="w">Lineup </span>' + (+lu.n) + '</span><b class="num">' + f1(lu.pts) + '</b></div><div class="lu-s num">on pace ' + f1(lu.live) + "<span> \u00B7 " + (+lu.yet) + " to go</span></div><ul>" +
          lu.players.map(function (p) {
            var rz = p.status === "in" && p.rz && p.poss && sbLive;
            return '<li class="pl ' + esc(p.status) + (rz ? " rz" : "") + (p.sid && hot[p.sid] && Date.now() - hot[p.sid] < 90000 ? " hot" : "") + '"><span class="pos">' + esc(p.slot) + '</span><span class="nm">' + esc(nm(p.name)) +
              '</span><span class="pt num">' + (p.status === "pre" ? "" : f1(p.pts)) + "</span></li>";
          }).join("") + (lu.missing || []).map(function (x) { return '<li class="pl missing"><span class="pos">' + esc(x.slot) + '</span><span class="nm">not in the file</span><span class="pt"></span></li>'; }).join("") + "</ul></div>";
      }).join("") + "</div>";
    }
    return '<section class="dfs">' + head + '<div class="dfs-body">' + ladder + cards + sw + "</div>" +
      '<p class="fine">Points are worked out here from live stats with DraftKings scoring, so they can trail the official numbers by a play or two. The order is your lineups against each other, not contest standings.</p></section>';
  }

  /* ---------------------------------------------------------------- render + fit */
  function render() {
    var L = layout(), M = S ? mode(L) : "fantasy";
    curM = M; sizeRoot(L, M);
    var fr = S ? freshness() : null, offline = !!S && (FORCE_STATE === "stale" || !!(fr && fr.level === "offline"));
    document.body.classList.toggle("stale", offline);
    if (!S) {
      app.className = "boot"; app.removeAttribute("data-tier");
      app.innerHTML = lastErr ? '<div class="blank"><h2>Can\'t reach the scores</h2><p>Check your connection. This page retries by itself.</p><p class="fine">' + esc(lastErr) + "</p></div>" :
        '<div class="blank"><div class="spinner"></div><h2>Getting this week\'s games</h2></div>';
      return;
    }
    nameIndex();
    S.gameById = {}; S.games.forEach(function (g) { S.gameById[g.id] = g; });
    app.className = "L-" + L + " M-" + M;
    var stAge = !offline ? "" : FORCE_STATE === "stale" ? " 3m ago" : !fr || fr.age == null || fr.age < 45 ? "" : " " + ago(Date.now() - fr.age * 1000) + " ago";
    var stale = offline ? '<div class="stalebar" role="status">Scores stopped updating' + stAge + ". Retrying.</div>" : "";
    var side = '<div class="side-col">' + nowPanel() + feedPanel() + gamesPanel() + "</div>";
    var html;
    if (M === "dfs") html = header(L, M) + stale + '<main class="grid">' + dfsDeck() + side + "</main>";
    else if (M === "both") html = header(L, M) + stale + '<main class="grid">' + matchups(L) + side + dfsDeck() + "</main>";
    else html = header(L, M) + stale + '<main class="grid">' + matchups(L) + side + "</main>";
    app.innerHTML = html;
    fit();
  }
  function over(el) {
    var g = app.querySelector(".grid");
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1 || (g && g.scrollHeight > g.clientHeight + 1)) return true;
    var names = el.querySelectorAll(".mu-players .nm"), i;            /* a clipped player name counts as not fitting */
    for (i = 0; i < names.length; i++) if (names[i].offsetParent && names[i].scrollWidth > names[i].clientWidth + 1) return true;
    return false;
  }
  /* Detail tiers: 4 = every starter, 3 = players on the field now, 2 = counts only, 1 = score and win chance.
     The games list can also shrink to live games only. Try the richest combination first, take the first one
     that fits with no clipped names, then let the type grow into whatever room is left. Nothing scrolls. */
  var STEPS = [[4, 0], [3, 0], [4, 1], [3, 1], [2, 0], [2, 1], [1, 0], [1, 1]];
  function fit() {
    var el = app.querySelector(".fit");
    if (!el) { app.setAttribute("data-tier", 4); app.setAttribute("data-games", "all"); return; }
    var i, k, ks = [1.6, 1.45, 1.3, 1.2, 1.1, 1];
    for (i = 0; i < STEPS.length; i++) {
      app.setAttribute("data-tier", STEPS[i][0]);
      app.setAttribute("data-games", STEPS[i][1] ? "live" : "all");
      el.style.setProperty("--k", STEPS[i][0] === 4 ? 1.1 : 1);
      if (!over(el)) break;
    }
    for (k = 0; k < ks.length; k++) { el.style.setProperty("--k", ks[k]); if (!over(el)) break; }
    /* the strip's games column clips: drop whole rows from the end (finals and late games) instead of cutting one in half */
    var gm = app.classList.contains("L-strip") && app.querySelector(".games");
    if (gm) {
      var rows = [].slice.call(gm.querySelectorAll(".g")).filter(function (r) { return r.offsetParent !== null; });
      while (rows.length > 1 && gm.scrollHeight > gm.clientHeight + 1) rows.pop().style.display = "none";
    }
  }
  function paintAges() {
    app.querySelectorAll("[data-t]").forEach(function (el) { var t = +el.getAttribute("data-t"); el.textContent = el.classList.contains("since") ? since(t) : ago(t); });
    var f = document.getElementById("fresh"), fr = freshness();
    if (f && fr) {
      if ((fr.level === "offline") !== document.body.classList.contains("stale")) { render(); return; }
      f.className = "fresh " + fr.level; f.title = fr.title; f.lastChild.textContent = fr.text;
    }
  }

  /* ---------------------------------------------------------------- alerts */
  function flash(t) {
    if (settings.banners === false) return;
    var f = document.getElementById("flash"); if (!f) return;
    f.className = ""; void f.offsetWidth; f.className = "go " + (MARK[t] ? t : "mix");
  }
  var actx;
  function chime(good) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      (good ? [660, 880] : [440, 330]).forEach(function (hz, i) {
        var o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.16;
        o.type = "triangle"; o.frequency.value = hz; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.32);
      });
    } catch (e) { }
  }

  /* ---------------------------------------------------------------- first run + settings */
  var sheet = null, ob = { step: "welcome" };
  var GUIDE = "https://github.com/Ewo8om3/sunday-command-center/blob/main/SETUP.md";
  function closeSheet() { if (sheet) { sheet.remove(); sheet = null; } }
  function openSheet(cls, html) {
    var y = sheet && sheet.classList.contains(cls) ? sheet.scrollTop : 0;
    closeSheet();
    sheet = document.createElement("div");
    sheet.className = "overlay " + cls;
    sheet.setAttribute("role", "dialog");
    sheet.innerHTML = html;
    document.body.appendChild(sheet);
    sheet.scrollTop = y;
    var f = sheet.querySelector("[autofocus]"); if (f) f.focus();
  }
  function connected() {
    if (DEMO) return SCC_DEMO.leaguesList(demoLeagues);
    var out = (ob.sleeperLeagues || []).filter(function (l) { return settings.hidden.indexOf(String(l.id)) < 0; });
    return out.concat((settings.espn || []).map(function (c) { return { id: c.leagueId, name: c.leagueName, team: c.teamName, platform: "espn" }; }));
  }
  function onboard(step, msg) {
    ob.step = step || ob.step;
    var h = '<div class="ob"><div class="ob-mark" aria-hidden="true"><i></i><i></i><i></i></div>';
    if (ob.step === "welcome") {
      h += "<h1>Every matchup you care about, right next to the game.</h1>" +
        "<p>Connect a league and this board keeps score all Sunday: who's winning, who's in the red zone, and what just happened. There's nothing to install and no account. Your details stay in this browser.</p>" +
        '<div class="ob-choices"><button class="choice" data-act="ob" data-v="sleeper"><b>I play on Sleeper</b><span>You\'ll need your username</span></button>' +
        '<button class="choice" data-act="ob" data-v="espn"><b>I play on ESPN</b><span>You\'ll need your league\'s web address</span></button></div>' +
        '<p class="fine">In leagues on both? Start with either and add the rest after. <a href="?demo=1">Look around with demo data first</a> \u00B7 <button class="link" data-act="obdone">' +
        (hasLeagues() ? "Back to the board" : "Not now") + "</button></p>";
    } else if (ob.step === "sleeper") {
      h += "<h1>What's your Sleeper username?</h1><p>It's on your profile in the Sleeper app. No password needed: Sleeper leagues can be read by anyone who knows the name.</p>" +
        '<form class="ob-row" data-form="sleeper"><input id="ob-user" autofocus autocomplete="off" spellcheck="false" aria-label="Sleeper username" placeholder="Sleeper username" value="' + esc(ob.typed || settings.username) + '"><button class="btn primary">Find my leagues</button></form>' +
        (msg ? '<p class="ob-msg" role="status">' + msg + "</p>" : "") + '<p class="fine"><button class="link" data-act="ob" data-v="welcome">Back</button></p>';
    } else if (ob.step === "espn") {
      h += "<h1>Paste your ESPN league's web address</h1><p>Open your league at fantasy.espn.com, copy the address from the top of the browser, and paste it here. The league number on its own works too.</p>" +
        '<form class="ob-row" data-form="espn"><input id="ob-espn" autofocus autocomplete="off" spellcheck="false" aria-label="ESPN league address" placeholder="fantasy.espn.com/football/league?leagueId=..." value="' + esc(ob.typedEspn || "") + '"><button class="btn primary">Find my league</button></form>' +
        (msg ? '<div class="ob-msg" role="status">' + msg + "</div>" : "") + '<p class="fine"><button class="link" data-act="ob" data-v="' + (connected().length ? "ready" : "welcome") + '">Back</button></p>';
    } else if (ob.step === "espnteam") {
      var hint = String(ob.espn.teamHint || "");
      h += "<h1>Which team is yours in " + esc(ob.espn.leagueName) + "?</h1>" + '<div class="ob-list">' + ob.espn.teams.map(function (t) {
        var mine = hint && String(t.id) === hint;
        return '<button class="choice slim' + (mine ? " hint" : "") + '" data-act="espnpick" data-v="' + esc(t.id) + '"><b>' + esc(t.name) + "</b><span>" + esc(t.owner || "") + (mine ? " \u00B7 from your link" : "") + "</span></button>"; }).join("") + "</div>" +
        (ob.espn.via && ob.espn.via !== "direct" ? '<p class="fine">This league is private. It loads through ' + (ob.espn.via === "proxy" ? "the helper on this computer" : "your ESPN login in this browser") + ".</p>" : "") +
        '<p class="fine"><button class="link" data-act="ob" data-v="espn">Back</button></p>';
    } else if (ob.step === "ready") {
      var ls = connected();
      h += "<h1>" + (ls.length ? "You're set. " + plural(ls.length, "league") + " connected." : "No leagues found") + "</h1>" +
        (ls.length ? "" : "<p>That account doesn't have a league this season yet. Add another, or check the username.</p>") + '<ul class="ob-leagues">' + ls.map(function (l) {
        return "<li><b>" + esc(l.name) + "</b><span>" + esc(l.team || "") + '</span><span class="plat">' + (l.platform === "espn" ? "ESPN" : "Sleeper") + "</span></li>"; }).join("") + "</ul>" +
        '<div class="ob-tip"><div class="ob-diagram" aria-hidden="true"><i class="tv">RedZone</i><i class="me">This board</i></div><p><b>Put this window beside RedZone.</b> Drag it to the edge of your screen, or press <kbd>Win</kbd> + <kbd>\u2192</kbd> (on a Mac, hover the green button and choose a side). ' +
        "The board rearranges itself to fit any shape: tall and narrow, short and wide, or full screen.</p></div>" +
        '<div class="ob-row"><button class="btn primary" data-act="obdone" autofocus>Start watching</button><button class="btn" data-act="ob" data-v="welcome">Add another league</button></div>' +
        '<p class="fine">Play DraftKings too? You can add lineups later in Settings.</p>';
    }
    openSheet("onboarding", h + "</div>");
  }
  function findSleeper(u) {
    if (!u) return;
    ob.typed = u;
    if (DEMO) { onboard("ready"); return; }
    onboard("sleeper", "Looking for <b>" + esc(u) + "</b>\u2026");
    fetchT("https://api.sleeper.app/v1/user/" + encodeURIComponent(u)).then(function (r) { if (!r.ok && r.status !== 404) throw new Error("HTTP " + r.status); return r.status === 404 ? null : r.json(); }).then(function (x) {
      if (!x || !x.user_id) { onboard("sleeper", "Sleeper doesn't have a user called <b>" + esc(u) + "</b>. Check the spelling: it's the name after the @ on your Sleeper profile."); return; }
      settings.username = x.username || u; settings.userId = String(x.user_id); settings.displayName = x.display_name || u;
      save(LS.settings, settings);
      return sleeperLeagues().then(function () { onboard("ready"); refreshNow(); });
    }).catch(function () { onboard("sleeper", "Couldn't reach Sleeper. Check your connection and try again."); });
  }
  function sleeperLeagues() {
    if (DEMO || !settings.userId) { ob.sleeperLeagues = []; return Promise.resolve([]); }
    return getJSON("https://api.sleeper.app/v1/state/nfl", 600).then(function (st) { return getJSON(SCC.urls(st.league_season || st.season, st.week).leagues(settings.userId), 60); }).then(function (ls) {
      ob.sleeperLeagues = (ls || []).map(function (l) { return { id: String(l.league_id), name: l.name, team: (+l.total_rosters || 0) + " teams", platform: "sleeper" }; });
      return ob.sleeperLeagues;
    }).catch(function () { ob.sleeperLeagues = ob.sleeperLeagues || []; return ob.sleeperLeagues; });
  }
  var seasonGuess = String(new Date().getMonth() < 2 ? new Date().getFullYear() - 1 : new Date().getFullYear());
  function findEspn(text) {
    ob.typedEspn = text;
    var id = (/leagueId=(\d+)/i.exec(text) || /^\s*(\d{3,})\s*$/.exec(text) || /(\d{4,})/.exec(text) || [])[1];
    var season = (/seasonId=(\d{4})/i.exec(text) || [])[1] || (S && S.season) || seasonGuess, teamHint = (/teamId=(\d+)/i.exec(text) || [])[1];
    if (!id) { onboard("espn", "That doesn't look like a league address. It should contain <b>leagueId=</b> followed by a number."); return; }
    if (DEMO) { ob.espn = { leagueId: id, season: season, leagueName: "Work Rivals", teams: [{ id: 1, name: "Kelce Grammar", owner: "You" }, { id: 2, name: "Chubb Hub", owner: "Sam" }, { id: 3, name: "Dak to the Future", owner: "Priya" }] }; onboard("espnteam"); return; }
    onboard("espn", "Looking up league <b>" + esc(id) + "</b>\u2026");
    var key = id + ":" + season;
    espnFetch(SCC.espnPath(season, id, null).replace(/&view=mBoxscore|&view=mMatchupScore|&view=mRoster/g, ""), key).then(function (d) {
      ob.espn = { leagueId: id, season: String(season), leagueName: (d.settings || {}).name || "ESPN league " + id, teams: SCC.espnTeams(d), teamHint: teamHint, via: espnMode[key] };
      onboard("espnteam");
    }).catch(function (e) {
      onboard("espn", e.auth ? "<p><b>This league is private</b>, so ESPN only shows it to its members. Two ways forward:</p><ol><li>Ask your commissioner to make the league viewable to the public (League Settings, Basic Settings). Easiest, and nothing else to set up.</li>" +
        '<li>Or keep it private and run the small helper program on this computer. <a href="' + GUIDE + '#private-espn-leagues" target="_blank" rel="noopener">Step-by-step guide</a></li></ol>' +
        (e.proxy ? '<p class="fine">The helper answered, but ESPN turned it away: ' + esc(e.message) + ".</p>" : "") :
        e.notFound ? "ESPN doesn't have league <b>" + esc(id) + "</b> for the " + esc(season) + " season. Double-check the address." :
        /* ESPN answers an unknown league with a 404 that browsers can't read (no CORS header), so a wrong number
           and a network problem look the same from here */
        "Couldn't load league <b>" + esc(id) + "</b>. Either it isn't an ESPN league for the " + esc(season) + " season, or ESPN isn't answering. Double-check the address and try again.");
    });
  }
  function pickEspn(teamId) {
    var t = ob.espn.teams.filter(function (x) { return String(x.id) === String(teamId); })[0];
    if (!DEMO) {
      var c = { leagueId: String(ob.espn.leagueId), season: ob.espn.season, leagueName: ob.espn.leagueName, teamId: +teamId, teamName: t ? t.name : "" };
      settings.espn = (settings.espn || []).filter(function (x) { return !(String(x.leagueId) === c.leagueId && String(x.season) === c.season); }).concat([c]);
      if (settings.order.indexOf(c.leagueId) < 0) settings.order.push(c.leagueId);
      save(LS.settings, settings); refreshNow();
    }
    onboard("ready");
  }

  var dkMsg = "";
  function openSettings() {
    var ls = connected(), nLu = DEMO ? demoDfs : dkData.lineups.length, on = DEMO ? demoDfs > 0 : settings.dfsOn;
    var sizes = [[0.9, "Small"], [1, "Regular"], [1.12, "Large"], [1.25, "Largest"]], polls = [[10, "10 s"], [15, "15 s"], [30, "30 s"], [60, "1 min"]];
    var fr = freshness();
    openSheet("settings", '<div class="sheet"><div class="sheet-head"><h1>Settings</h1><button class="btn" data-act="close">Done</button></div>' +
      (DEMO ? '<p class="fine">You\'re looking at demo data, so nothing here is saved. <a href="./">Open the real board</a></p>' : "") +
      "<h2>Your leagues</h2>" + (ls.length ? '<ul class="set-list">' + ls.map(function (l) {
        return "<li><b>" + esc(l.name) + "</b><span>" + esc(l.team || "") + '</span><span class="plat">' + (l.platform === "espn" ? "ESPN" : "Sleeper") + '</span><button class="link" data-act="rmleague" data-p="' + (l.platform === "espn" ? "espn" : "sleeper") + '" data-v="' + esc(l.id) + '">Remove</button></li>'; }).join("") + "</ul>" : '<p class="fine">No leagues yet.</p>') +
      '<div class="set-row"><button class="btn" data-act="onboard">Add a league</button>' + (!DEMO && settings.hidden.length ? '<button class="link" data-act="unhide">Bring back ' + plural(settings.hidden.length, "removed Sleeper league") + "</button>" : "") +
      (!DEMO && settings.userId ? '<span class="fine">Sleeper account: ' + esc(settings.displayName || settings.username) + ' \u00B7 <button class="link" data-act="forgetsleeper">Disconnect</button></span>' : "") + "</div>" +
      "<h2>Alerts</h2>" +
      '<label class="check"><input type="checkbox" data-set="banners"' + (settings.banners !== false ? " checked" : "") + "><span><b>Flash the board on big plays</b>A touchdown or a swing of 5 or more points lights the edge of the window: gold when it helps you, blue when it hurts. The play then stays at the top of the board for a couple of minutes.</span></label>" +
      '<label class="check"><input type="checkbox" data-set="sound"' + (settings.sound ? " checked" : "") + "><span><b>Play a sound</b>Two rising notes for good news, two falling for bad.</span></label>" +
      "<h2>Display</h2>" +
      '<div class="set-row"><span class="lab">Text size</span><div class="seg">' + sizes.map(function (s) { return '<button data-act="size" data-v="' + s[0] + '"' + (Math.abs((settings.textSize || 1) - s[0]) < 0.01 ? ' aria-pressed="true"' : "") + ">" + s[1] + "</button>"; }).join("") + "</div></div>" +
      '<div class="set-row"><span class="lab">RedZone link</span><input id="set-rz" aria-label="RedZone link" placeholder="Where you watch, e.g. https://tv.youtube.com" value="' + esc(settings.redzoneUrl) + '"></div>' +
      '<div class="set-row"><span class="lab">Windows</span><button class="btn" data-act="launch">Open my Sunday layout</button><span class="fine">Opens ' + (SCC.safeUrl(settings.redzoneUrl) ? "RedZone and " : "") + "this board in side-by-side windows sized for your screen. For exact placement use FancyZones (Windows) or Rectangle (Mac): see the guide.</span></div>" +
      (DEMO ? "" : '<div class="set-row"><span class="lab">Refresh</span><div class="seg">' + polls.map(function (s) { return '<button data-act="poll" data-v="' + s[0] + '"' + (+settings.poll === s[0] ? ' aria-pressed="true"' : "") + ">" + s[1] + "</button>"; }).join("") + '</div><span class="fine">How often scores refresh while games are live. It slows down by itself when nothing is on.</span></div>') +
      (fr ? '<div class="set-row"><span class="lab">Status</span><span>' + esc(fr.text) + '</span><span class="fine">' + esc(fr.title) + "</span></div>" : "") +
      '<h2>Daily fantasy <span class="opt">optional</span></h2>' +
      '<label class="check"><input type="checkbox" data-set="dfs"' + (on ? " checked" : "") + "><span><b>Track my DraftKings lineups</b>Adds a separate DraftKings view alongside your leagues. Leave it off and you'll never see it. Turning it off keeps your lineups for next time.</span></label>" +
      (on ? '<div class="dk-import"><div class="drop" id="drop"><b>Drop your DraftKings file here</b><span>DKEntries.csv: on the DraftKings website, Lineups, Edit Entries, pick the slate, Download. Your bulk-upload CSV works too. Or <label class="link">choose a file<input type="file" id="files" accept=".csv,text/csv,text/plain" multiple hidden></label></span></div>' +
        (DEMO ? "" : '<details class="paste"><summary>Or paste lineups</summary><textarea id="paste" rows="4" aria-label="Paste lineups" placeholder="One lineup per line: Name (ID), Name (ID), \u2026  or paste the CSV itself"></textarea><div class="set-row"><button class="btn" data-act="importpaste">Add these lineups</button></div></details>') +
        '<p class="fine" id="dkmsg">' + (dkMsg || (nLu ? esc(plural(nLu, "lineup") + " loaded" + (dkData.files.length && !DEMO ? " from " + dkData.files.join(", ") : "") + ".") : "No lineups loaded yet.")) +
        (nLu && !DEMO ? ' <button class="link" data-act="cleardk">Remove them</button>' : "") + "</p></div>" : "") +
      (DEMO ? "" : '<details class="adv"' + (settings.espnS2 || settings.scoresViaHelper ? " open" : "") + '><summary>Private ESPN league helper</summary><p class="fine">Only needed if your ESPN league is private, and only with the small helper program running on this computer. Safest: put your ESPN cookies in the helper\'s own config.json and leave these boxes empty. Anything typed here is kept in this browser and sent only to the helper at a localhost address. <a href="' + GUIDE + '#private-espn-leagues" target="_blank" rel="noopener">Guide</a></p>' +
        '<div class="set-row"><input id="set-s2" type="password" autocomplete="off" aria-label="espn_s2" placeholder="espn_s2" value="' + esc(settings.espnS2) + '"><input id="set-swid" type="password" autocomplete="off" aria-label="SWID" placeholder="SWID" value="' + esc(settings.espnSwid) + '"></div>' +
        '<div class="set-row"><span class="lab">Helper</span><input id="set-proxy" aria-label="Helper address" value="' + esc(settings.proxyUrl) + '"><button class="btn" data-act="proxytest">Test</button><span class="fine" id="proxymsg"></span></div>' +
        '<label class="check"><input type="checkbox" data-set="scoresViaHelper"' + (settings.scoresViaHelper ? " checked" : "") + "><span><b>Also get live game scores through the helper</b>Only if the live game feed won't load in this browser (the board says \u201cRed-zone tracking is offline\u201d all game). The helper fetches ESPN's public scoreboard; no cookies go with it.</span></label></details>" +
        '<p class="fine keys">Keys: <kbd>S</kbd> settings \u00B7 <kbd>D</kbd> Leagues / Both / DraftKings \u00B7 <kbd>1</kbd>\u2013<kbd>9</kbd> outline your players in a live game \u00B7 <kbd>Esc</kbd> clear \u00B7 <kbd>+</kbd> <kbd>\u2212</kbd> text size \u00B7 <kbd>R</kbd> refresh now \u00B7 <kbd>M</kbd> sound</p>' +
        '<p class="fine">Not affiliated with the NFL, Sleeper, ESPN or DraftKings. Scores and stats come from public but undocumented feeds that can change or stop without notice.</p>' +
        '<div class="danger"><button class="link" data-act="wipe">Forget everything on this browser</button><span class="fine">Removes your username, leagues, lineups and settings from this browser. Nothing is stored anywhere else.</span></div>') +
      "</div>");
    var drop = sheet.querySelector("#drop");
    if (drop) {
      drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
      drop.addEventListener("drop", function (e) { e.preventDefault(); drop.classList.remove("over"); importFiles(e.dataTransfer.files); });
      sheet.querySelector("#files").addEventListener("change", function (e) { importFiles(e.target.files); });
    }
  }
  function importParsed(items) {   // items: [{name, r: parseDK result}]
    if (items.some(function (x) { return x.r.lineups.length; })) dkData = { lineups: [], salaries: {}, files: [], importedAt: null };
    var warns = [];
    items.forEach(function (x) {
      dkData.lineups = dkData.lineups.concat(x.r.lineups); Object.assign(dkData.salaries, x.r.salaries); dkData.files.push(x.name);
      (x.r.warnings || []).forEach(function (w) { warns.push(x.name + ": " + w); });
    });
    dkData.importedAt = Date.now();
    save(LS.dk, dkData);
    dkMsg = (dkData.lineups.length ? esc(plural(dkData.lineups.length, "lineup") + " loaded" + (Object.keys(dkData.salaries).length ? ", " + Object.keys(dkData.salaries).length + " players with salaries" : "") + ".") :
      "No lineups found. Use DKEntries.csv (Lineups, Edit Entries, Download) or your upload CSV.") + (warns.length ? '<span class="dk-warns">' + warns.map(esc).join("<br>") + "</span>" : "");
    openSettings();
    dkMsg = "";
    refreshNow();
  }
  function importFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (DEMO) { var m = sheet && sheet.querySelector("#dkmsg"); if (m) m.textContent = "Demo data can't import files. Open the board without ?demo=1 to use your own."; return; }
    Promise.all(files.map(function (f) { return f.text().then(function (t) { return { name: f.name, r: SCC.parseDK(t) }; }); })).then(importParsed);
  }
  function saveInputs() {
    if (!sheet || DEMO) return;
    var g = function (id) { var el = sheet.querySelector(id); return el ? el.value.trim() : null; };
    if (g("#set-rz") != null) settings.redzoneUrl = SCC.safeUrl(g("#set-rz"));   // http(s) links only
    if (g("#set-s2") != null) { settings.espnS2 = g("#set-s2"); settings.espnSwid = g("#set-swid"); settings.proxyUrl = g("#set-proxy") || "http://localhost:8766"; }
    save(LS.settings, settings);
  }
  function proxyTest() {
    saveInputs();
    var msg = sheet.querySelector("#proxymsg");
    if (!isLoopback(settings.proxyUrl)) { msg.textContent = "The helper address must be http://localhost:<port> or http://127.0.0.1:<port>."; return; }
    msg.textContent = "Checking\u2026";
    fetchT(proxyBase() + "/health").then(function (r) { return r.json(); }).then(function (h) {
      msg.textContent = h && h.ok ? "The helper is running" + (h.cookiesInConfig ? ", with cookies in its config.json." : settings.espnS2 ? ", using the cookies above." : ", but it has no ESPN cookies yet.") +
        (h.scores ? "" : " It's an older version without live scores; get the new one from the repo.") : "Something answered, but it isn't the helper.";
    }).catch(function () { msg.textContent = "No helper at " + settings.proxyUrl + ". Is it running?"; });
  }
  function launchLayout() {
    var W = screen.availWidth, H = screen.availHeight, X = screen.availLeft || 0, Y = screen.availTop || 0;
    var frac = W >= 3000 ? 0.6667 : W >= 2300 ? 0.7 : 0.75, w2 = Math.round(W * frac), h2 = Math.round(w2 * 9 / 16);
    var spec = function (x, y, w, h) { return "popup=yes,left=" + (X + x) + ",top=" + (Y + y) + ",width=" + w + ",height=" + h; };
    var base = location.href.split("?")[0] + "?" + (DEMO ? "demo=1&" + (demoDfs ? "dfs=" + demoDfs + "&" : "") : "");
    var rz = SCC.safeUrl(settings.redzoneUrl);
    var opened = [window.open(base + "view=rail&show=fantasy", "scc-rail", spec(w2, 0, W - w2, H))];
    if (H - h2 > 180) opened.push(window.open(base + "view=strip&show=" + (dfsOn() ? "dfs" : "fantasy"), "scc-strip", spec(0, h2, w2, H - h2)));
    if (rz) opened.push(window.open(rz, "redzone", spec(0, 0, w2, h2)));
    if (opened.some(function (w) { return !w; })) {
      var m = sheet && sheet.querySelector("[data-act=launch]");
      if (m && !sheet.querySelector(".popmsg")) m.insertAdjacentHTML("afterend", '<span class="ob-msg popmsg">Your browser blocked the new windows. Allow pop-ups for this page, then try again.</span>');
    }
  }
  function wipe() {
    Object.keys(LS).forEach(function (k) { localStorage.removeItem(LS[k]); });
    Object.keys(OLD).forEach(function (k) { localStorage.removeItem(OLD[k]); });
    try { sessionStorage.removeItem("scc2.show"); } catch (e) { }
    location.href = location.pathname;
  }

  /* ---------------------------------------------------------------- events */
  document.addEventListener("submit", function (e) {
    var f = e.target.getAttribute("data-form");
    if (!f) return;
    e.preventDefault();
    if (f === "sleeper") findSleeper(sheet.querySelector("#ob-user").value.trim());
    else if (f === "espn") findEspn(sheet.querySelector("#ob-espn").value.trim());
  });
  document.addEventListener("change", function (e) {
    var k = e.target.getAttribute && e.target.getAttribute("data-set");
    if (!k) return;
    if (k === "dfs") {
      saveInputs();
      if (DEMO) demoDfs = e.target.checked ? 6 : 0; else settings.dfsOn = e.target.checked;
      showMode = null; remember(null); save(LS.settings, settings); openSettings(); prevInterest = null; refreshNow(); return;
    }
    settings[k] = e.target.checked; save(LS.settings, settings);
    if (k === "sound" && e.target.checked) chime(true);
    if (k === "banners" && e.target.checked) flash("good");
    if (k === "scoresViaHelper") { saveInputs(); refreshNow(); }
  });
  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-act]"), g = e.target.closest("[data-game]");
    if (a) {
      var act = a.getAttribute("data-act"), v = a.getAttribute("data-v");
      if (act === "settings") { sleeperLeagues().then(openSettings); }
      else if (act === "close") { saveInputs(); closeSheet(); render(); }
      else if (act === "mode") { showMode = v; remember(v); render(); }
      else if (act === "onboard") { saveInputs(); onboard("welcome"); }
      else if (act === "ob") onboard(v);
      else if (act === "obdone") { closeSheet(); render(); }
      else if (act === "espnpick") pickEspn(v);
      else if (act === "size") { settings.textSize = +v; save(LS.settings, settings); saveInputs(); render(); openSettings(); }
      else if (act === "poll") { settings.poll = +v; save(LS.settings, settings); saveInputs(); openSettings(); refreshNow(); }
      else if (act === "launch") { saveInputs(); launchLayout(); }
      else if (act === "proxytest") proxyTest();
      else if (act === "importpaste") { var t = sheet.querySelector("#paste").value; if (t.trim()) importParsed([{ name: "pasted", r: SCC.parseDK(t) }]); }
      else if (act === "cleardk") { dkData = { lineups: [], salaries: {}, files: [], importedAt: null }; save(LS.dk, dkData); openSettings(); refreshNow(); }
      else if (act === "unhide") { settings.hidden = []; save(LS.settings, settings); refreshNow(); sleeperLeagues().then(openSettings); }
      else if (act === "forgetsleeper") { settings.userId = ""; settings.username = ""; settings.displayName = ""; settings.hidden = []; ob.sleeperLeagues = []; save(LS.settings, settings); openSettings(); refreshNow(); }
      else if (act === "rmleague") {
        if (DEMO) return;
        if (a.getAttribute("data-p") === "espn") settings.espn = settings.espn.filter(function (c) { return String(c.leagueId) !== v; }); else if (settings.hidden.indexOf(v) < 0) settings.hidden.push(v);
        delete lastGood[v];
        save(LS.settings, settings); openSettings(); refreshNow();
      }
      else if (act === "wipe") {
        if (a.getAttribute("data-sure")) wipe();
        else { a.setAttribute("data-sure", "1"); a.textContent = "Tap again to forget everything"; }
      }
      return;
    }
    if (g && !sheet) { var id = g.getAttribute("data-game"); focus = focus === id ? null : id; render(); }
  });
  document.addEventListener("keydown", function (e) {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;   // leave Ctrl+R, Cmd+S... alone
    var k = String(e.key || "").toLowerCase();
    if (e.key === "Escape") { if (sheet && !sheet.classList.contains("onboarding")) { saveInputs(); closeSheet(); } focus = null; render(); }
    else if (sheet) return;
    else if (k === "s") sleeperLeagues().then(openSettings);
    else if (k === "d" && dfsOn()) { var M = mode(layout()); showMode = M === "fantasy" ? "both" : M === "both" ? "dfs" : "fantasy"; remember(showMode); render(); }
    else if (k === "m") { settings.sound = !settings.sound; save(LS.settings, settings); if (settings.sound) chime(true); }
    else if (e.key === "+" || e.key === "=") { settings.textSize = Math.min(1.4, (settings.textSize || 1) + 0.05); save(LS.settings, settings); render(); }
    else if (e.key === "-") { settings.textSize = Math.max(0.8, (settings.textSize || 1) - 0.05); save(LS.settings, settings); render(); }
    else if (k === "r") refreshNow();
    else if (/^[1-9]$/.test(e.key) && S) { var live = S.games.filter(function (g) { return g.state === "in"; }), gm = live[+e.key - 1]; focus = gm ? gm.id : null; render(); }
  });
  var rt; addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(render, 60); });

  /* keep the screen awake while the board is visible (Screen Wake Lock API, where supported) */
  var wake = null;
  function keepAwake() {
    if (settings.noWake || !navigator.wakeLock || document.visibilityState !== "visible" || wake) return;
    navigator.wakeLock.request("screen").then(function (w) { wake = w; w.addEventListener("release", function () { wake = null; }); }).catch(function () { });
  }
  document.addEventListener("click", keepAwake);
  keepAwake();

  render();
  start();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (S && !sheet) render(); });   /* refit once the real font has metrics */
  if (qs.has("onboard") || (!DEMO && !hasLeagues() && !dfsOn())) onboard("welcome");
  if (qs.get("open") === "settings") setTimeout(function () { sleeperLeagues().then(openSettings); }, 50);
})();
