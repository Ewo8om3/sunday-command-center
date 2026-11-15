#!/usr/bin/env python3
"""Sunday Command Center - optional ESPN private-league proxy.

Zero dependencies (Python 3.8+). Listens on 127.0.0.1 only and forwards GET requests
for ESPN *fantasy* league data, adding your espn_s2 / SWID cookies so private leagues load.

  python3 espn_proxy.py            # port 8766
  SCC_PROXY_PORT=9000 python3 espn_proxy.py

Cookies come from (first match wins):
  1. X-Espn-S2 / X-Espn-Swid request headers (sent by the page from your browser's localStorage), or
  2. proxy/config.json  {"espn_s2": "...", "SWID": "{...}"}   (git-ignored), or
  3. env vars ESPN_S2 / ESPN_SWID.
Nothing is logged or stored. Only lm-api-reads.fantasy.espn.com league reads are allowed, so this is not an open proxy.

Optional: GET /scores?dates=...&seasontype=...&week=... returns ESPN's public NFL scoreboard
(site.api.espn.com), for a browser that can't load it directly. No cookies are ever sent with it.

Who may call it (so other websites open in your browser can't use your cookies):
  - pages served from https://ewo8om3.github.io, http://localhost:<any port> or http://127.0.0.1:<any port>
  - extra origins (e.g. your own fork's GitHub Pages) in SCC_ALLOWED_ORIGINS (comma-separated) or
    "allowed_origins": ["https://you.github.io"] in config.json
  - index.html opened straight from disk (file://, Origin "null") only if you opt in with SCC_ALLOW_FILE=1 or
    "allow_file_origin": true in config.json. Serving the folder with `python3 -m http.server` is safer.
Everything else gets 403. The Host header must be localhost / 127.0.0.1 (blocks DNS rebinding), and ESPN
redirects are never followed (so cookies can't be forwarded to another host).
"""
import json, os, re, sys, urllib.request, urllib.error
from urllib.parse import urlsplit
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
UPSTREAM = "https://lm-api-reads.fantasy.espn.com"
ALLOWED = re.compile(r"^/apis/v3/games/ffl/seasons/\d{4}/segments/0/leagues/\d+(\?[A-Za-z0-9_=&%.\-]*)?$")
SCORES_UPSTREAM = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
SCORES_QUERY = re.compile(r"^(\?[A-Za-z0-9_=&%.\-]*)?$")
VERSION = "3"
DEFAULT_ORIGINS = {"https://ewo8om3.github.io"}
LOOPBACK_ORIGIN = re.compile(r"^http://(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$")
LOOPBACK_HOST = re.compile(r"^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$")


def load_config():
    try:
        with open(os.path.join(HERE, "config.json")) as f:
            return json.load(f) or {}
    except FileNotFoundError:
        return {}
    except Exception as e:
        print("config.json unreadable:", e, file=sys.stderr)
        return {}


def allowed_origins():
    extra = [o.strip().rstrip("/") for o in os.environ.get("SCC_ALLOWED_ORIGINS", "").split(",") if o.strip()]
    extra += [str(o).strip().rstrip("/") for o in (load_config().get("allowed_origins") or []) if str(o).strip()]
    return DEFAULT_ORIGINS | set(extra)


def allow_file_origin():
    return os.environ.get("SCC_ALLOW_FILE") == "1" or load_config().get("allow_file_origin") is True


def origin_ok(origin):
    if origin is None:
        return True  # same-origin navigation or curl; cross-site fetches always carry an Origin (see check below)
    if origin == "null":
        return allow_file_origin()
    origin = origin.rstrip("/")
    return origin in allowed_origins() or bool(LOOPBACK_ORIGIN.match(origin))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # never follow: the Cookie header must only ever go to UPSTREAM


OPENER = urllib.request.build_opener(NoRedirect)


def file_cookies():
    c = load_config()
    s2, swid = c.get("espn_s2") or "", c.get("SWID") or c.get("swid") or ""
    if s2.startswith("PASTE") or swid.startswith("{PASTE"):  # untouched example values
        return "", ""
    return s2, swid


class Handler(BaseHTTPRequestHandler):
    server_version = "SCC-ESPN-Proxy/" + VERSION

    def log_message(self, fmt, *args):  # keep cookies & league ids out of the console
        pass

    def allowed(self):
        host = (self.headers.get("Host") or "").strip().lower()
        if not LOOPBACK_HOST.match(host):
            return False
        origin = self.headers.get("Origin")
        if origin is None and (self.headers.get("Sec-Fetch-Site") or "") == "cross-site":
            return False
        return origin_ok(origin)

    def cors(self):
        origin = self.headers.get("Origin")
        if origin is None or not origin_ok(origin):
            return
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-Espn-S2, X-Espn-Swid, Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")

    def reply(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def forbidden(self):
        body = b'{"error":"origin or host not allowed (see proxy/README.md)"}'
        self.send_response(403)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Vary", "Origin")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self.allowed():
            return self.forbidden()
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        if not self.allowed():
            return self.forbidden()
        if self.path in ("/health", "/health/"):
            s2, swid = file_cookies()
            return self.reply(200, json.dumps({"ok": True, "app": "sunday-command-center-espn-proxy", "version": VERSION,
                                               "cookiesInConfig": bool(s2 and swid), "scores": True}).encode())
        if self.path == "/scores" or self.path.startswith("/scores?"):
            q = self.path[len("/scores"):]
            if not SCORES_QUERY.match(q):
                return self.reply(403, b'{"error":"bad scoreboard query"}')
            req = urllib.request.Request(SCORES_UPSTREAM + q, headers={"User-Agent": "Mozilla/5.0 (SundayCommandCenter helper)", "Accept": "application/json"})
            try:
                with OPENER.open(req, timeout=20) as r:
                    return self.reply(r.status, r.read())
            except urllib.error.HTTPError as e:
                return self.reply(502 if 300 <= e.code < 400 else e.code, b'{"error":"scoreboard unavailable"}')
            except Exception as e:
                return self.reply(502, json.dumps({"error": str(e)}).encode())
        if not self.path.startswith("/espn/"):
            return self.reply(404, b'{"error":"use /espn/apis/v3/... or /scores"}')
        path = self.path[len("/espn"):]
        if not ALLOWED.match(path):
            return self.reply(403, b'{"error":"only ESPN fantasy football league reads are proxied"}')
        s2 = self.headers.get("X-Espn-S2") or ""
        swid = self.headers.get("X-Espn-Swid") or ""
        if not (s2 and swid):
            s2, swid = file_cookies()
        if not (s2 and swid):
            s2, swid = os.environ.get("ESPN_S2", ""), os.environ.get("ESPN_SWID", "")
        headers = {"User-Agent": "Mozilla/5.0 (SundayCommandCenter proxy)", "Accept": "application/json"}
        if s2 and swid:
            swid = swid if swid.startswith("{") else "{" + swid.strip("{}") + "}"
            headers["Cookie"] = "espn_s2=%s; SWID=%s" % (s2.strip(), swid)
        req = urllib.request.Request(UPSTREAM + path, headers=headers)
        try:
            with OPENER.open(req, timeout=20) as r:
                return self.reply(r.status, r.read())
        except urllib.error.HTTPError as e:
            if 300 <= e.code < 400:
                return self.reply(502, b'{"error":"ESPN answered with a redirect; not followed"}')
            return self.reply(e.code, e.read() or b"{}")
        except Exception as e:
            return self.reply(502, json.dumps({"error": str(e)}).encode())


def main():
    port = int(os.environ.get("SCC_PROXY_PORT", "8766"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    s2, swid = file_cookies()
    print("Sunday Command Center ESPN proxy on http://localhost:%d  (Ctrl+C to stop)" % port, flush=True)
    print("cookies:", "from proxy/config.json" if s2 and swid else "none in config.json - set them in the page's Settings or create proxy/config.json", flush=True)
    print("allowed pages:", ", ".join(sorted(allowed_origins())) + ", http://localhost:*, http://127.0.0.1:*" +
          (", file:// (null)" if allow_file_origin() else ""), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
