# ESPN private-league proxy (optional)

You only need this for **private** ESPN leagues. One file, Python 3.8+, no dependencies.

- Windows: double-click `start-proxy.bat`
- Mac/Linux: `./start-proxy.sh` (or `python3 espn_proxy.py`)

It listens on `http://localhost:8766` (change with `SCC_PROXY_PORT`). It only accepts
`/espn/apis/v3/games/ffl/seasons/<year>/segments/0/leagues/<id>?…` and forwards those to
`lm-api-reads.fantasy.espn.com` with your `espn_s2` + `SWID` cookies. It sends no other requests, writes no logs and stores nothing.

Cookies come from the page (Settings → ESPN, sent as headers to localhost only) or from `config.json` next to
this file (copy `config.example.json`; `config.json` is git-ignored). See the main README for how to find them.
