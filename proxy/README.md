# ESPN helper (optional)

You only need this for **private** ESPN leagues, or as a backup if ESPN's live scoreboard won't load in your
browser. One file, Python 3.8+, no dependencies.

- Windows: double-click `start-proxy.bat`
- Mac/Linux: `./start-proxy.sh` (or `python3 espn_proxy.py`)

It listens on `http://localhost:8766` (change with `SCC_PROXY_PORT`). It accepts only:

- `/espn/apis/v3/games/ffl/seasons/<year>/segments/0/leagues/<id>?…`, forwarded to
  `lm-api-reads.fantasy.espn.com` with your `espn_s2` + `SWID` cookies;
- `/scores?…`, forwarded to ESPN's public NFL scoreboard (`site.api.espn.com/…/nfl/scoreboard`) with **no**
  cookies. The page uses it only when you tick *Also get live game scores through the helper*;
- `/health`, which says whether it's running, has cookies in its config and has the `/scores` route.

It sends no other requests, writes no logs and stores nothing. Query strings are limited to plain characters.

Cookies come from `config.json` next to this file (recommended: copy `config.example.json`; `config.json` is
git-ignored) or from the page (Settings → Private ESPN helper, sent as headers to localhost only). See
[SETUP.md → Private ESPN leagues](../SETUP.md#private-espn-leagues) for how to find them.

**Who it answers.** Only pages from `https://ewo8om3.github.io`, `http://localhost:<port>` and
`http://127.0.0.1:<port>`; every other website gets `403`, so a site open in another tab can't read your private
league through it. The `Host` header must be `localhost` / `127.0.0.1` (blocks DNS rebinding), and ESPN redirects
are never followed. To allow more:

```json
{
  "espn_s2": "...",
  "SWID": "{...}",
  "allowed_origins": ["https://yourname.github.io"],
  "allow_file_origin": false
}
```

or the env vars `SCC_ALLOWED_ORIGINS=https://a.example,https://b.example` and `SCC_ALLOW_FILE=1`.
`allow_file_origin` lets `index.html` opened from disk (`file://`, sent as Origin `null`) use the helper. Leave it
off unless you need it: sandboxed frames on any website also send `null`. Serving the folder with
`python3 -m http.server` avoids it.
