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
"""
import json, os, re, sys, urllib.request, urllib.error
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
UPSTREAM = "https://lm-api-reads.fantasy.espn.com"
ALLOWED = re.compile(r"^/apis/v3/games/ffl/seasons/\d{4}/segments/0/leagues/\d+(\?[A-Za-z0-9_=&%.\-]*)?$")
VERSION = "1"


def file_cookies():
    try:
        with open(os.path.join(HERE, "config.json")) as f:
            c = json.load(f)
        return c.get("espn_s2") or "", c.get("SWID") or c.get("swid") or ""
    except FileNotFoundError:
        return "", ""
    except Exception as e:
        print("config.json unreadable:", e, file=sys.stderr)
        return "", ""


class Handler(BaseHTTPRequestHandler):
    server_version = "SCC-ESPN-Proxy/" + VERSION

    def log_message(self, fmt, *args):  # keep cookies & league ids out of the console
        pass

    def cors(self):
        origin = self.headers.get("Origin") or "*"
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

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        if self.path in ("/health", "/health/"):
            s2, swid = file_cookies()
            return self.reply(200, json.dumps({"ok": True, "app": "sunday-command-center-espn-proxy", "version": VERSION,
                                               "cookiesInConfig": bool(s2 and swid)}).encode())
        if not self.path.startswith("/espn/"):
            return self.reply(404, b'{"error":"use /espn/apis/v3/..."}')
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
            with urllib.request.urlopen(req, timeout=20) as r:
                return self.reply(r.status, r.read())
        except urllib.error.HTTPError as e:
            return self.reply(e.code, e.read() or b"{}")
        except Exception as e:
            return self.reply(502, json.dumps({"error": str(e)}).encode())


def main():
    port = int(os.environ.get("SCC_PROXY_PORT", "8766"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    s2, swid = file_cookies()
    print("Sunday Command Center ESPN proxy on http://localhost:%d  (Ctrl+C to stop)" % port, flush=True)
    print("cookies:", "from proxy/config.json" if s2 and swid else "none in config.json - set them in the page's Settings or create proxy/config.json", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
