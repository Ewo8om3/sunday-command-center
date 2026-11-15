# Sunday Command Center: Setup Guide

This guide covers every way to run the dashboard, how to lay it out next to RedZone on any screen setup,
and how to connect your leagues and DFS lineups.

> **Menu names change.** Browsers and operating systems rename menus often. Where a path below might differ
> on your version, it's written generically ("the browser menu → install / open as window"). Look for the
> closest match.

---

## Quick start (3 steps)

1. **Open the dashboard:** <https://ewo8om3.github.io/sunday-command-center/>. Nothing to install. Try
   `?demo=1` on the end of the URL first if you want a preview with fake leagues.
2. **Connect your stuff:** Settings (⚙, or press `s`) → type your **Sleeper username** → *Find me*, add **ESPN
   leagues** by league ID, and drop in your **DraftKings CSV**.
3. **Put it next to RedZone:** open your RedZone stream in its own window and snap it into the big zone, then
   snap the dashboard's `rail` and `strip` views beside it (see [Layouts](#3-layouts) for your screens).

---

## Contents

1. [Ways to run it](#1-ways-to-run-it)
2. [The three views and display presets](#2-the-three-views-and-display-presets)
3. [Layouts](#3-layouts): single 4K / 1440p / 1080p, ultrawide 21:9 and 32:9, dual, triple, laptop + TV, tablet/phone
4. [Window snapping](#4-window-snapping): Windows, Mac, Linux
5. [RedZone sources](#5-redzone-sources): getting the stream into its own window
6. [Browser notes](#6-browser-notes)
7. [Connecting leagues](#7-connecting-leagues): Sleeper, ESPN public, ESPN private
8. [DraftKings lineups](#8-draftkings-lineups)
9. [Troubleshooting](#9-troubleshooting)
10. [FAQ](#10-faq)
11. [Disclaimer](#11-disclaimer)

---

## 1. Ways to run it

The dashboard is a static web page (HTML + JavaScript). It talks straight to the public Sleeper and ESPN data
feeds from your browser. There's no server, no account and no API key.

### A. GitHub Pages link (easiest)

Open <https://ewo8om3.github.io/sunday-command-center/>. Bookmark it, or install it as an app window (see
[§6](#6-browser-notes)). Updates show up automatically.

### B. Download the zip

1. On the GitHub repo page, click **Code → Download ZIP**.
2. Unzip it anywhere, e.g. `Documents\sunday-command-center`.
3. Double-click `index.html`. It opens in your default browser as a `file://` page. (For private ESPN leagues
   through the proxy, serve the folder as below instead; the proxy doesn't answer `file://` pages unless you
   opt in, see §1.D.)

Settings are saved per browser *and* per address, so the zip copy and the GitHub Pages copy have separate
settings.

If a browser refuses to load data from a `file://` page (rare; some locked-down setups do), serve the folder
locally instead. In a terminal in that folder run `python3 -m http.server 8000` (Windows: `py -m http.server 8000`)
and open <http://localhost:8000>.

### C. Clone it (for tinkerers)

```bash
git clone https://github.com/Ewo8om3/sunday-command-center.git
cd sunday-command-center
python3 -m http.server 8000      # or just open index.html
node --test                      # optional: run the tests (Node 20+)
```

To get updates later, run `git pull`.

### D. Optional: ESPN private-league proxy

You only need this for **private ESPN leagues** (public ESPN leagues and all Sleeper leagues work without it).
It's one Python file (`proxy/espn_proxy.py`) with no dependencies. It runs only on your computer at
`http://localhost:8766` and forwards nothing but ESPN fantasy-football league reads.

**Check that Python 3 is installed**

- **Windows:** open *Command Prompt* or *PowerShell* and run `py --version` (or `python --version`). You should
  see `Python 3.8` or newer. If not, install it from <https://www.python.org/downloads/> and tick **"Add
  python.exe to PATH"** in the installer. You can also get it from the Microsoft Store.
- **Mac:** open *Terminal* and run `python3 --version`. If macOS offers to install the Command Line Developer
  Tools, accept, or install Python from python.org.
- **Linux:** `python3 --version`. It's preinstalled on almost every distro.

**Start it**

- **Windows:** double-click `proxy\start-proxy.bat`. A console window opens and says
  `ESPN proxy on http://localhost:8766`. Leave it open during games. If Windows SmartScreen warns about the file,
  choose *More info → Run anyway* (it's a 7-line text file, so open it in Notepad first if you want to check).
- **Mac/Linux:** in Terminal run `cd path/to/sunday-command-center/proxy` and then `./start-proxy.sh`. If it says
  "permission denied", run `chmod +x start-proxy.sh` once, or start it with `python3 espn_proxy.py`. On a Mac you can
  also right-click `start-proxy.sh` → *Open With* → *Terminal*.
- To use a different port, run `SCC_PROXY_PORT=9000 python3 espn_proxy.py` and set
  `http://localhost:9000` in Settings → ESPN → *Proxy*.

**Check it:** Settings → ESPN → *Private ESPN league* → **Test proxy** should say *proxy OK*. You can also open
<http://localhost:8766/health> in your browser.

**Who it answers:** only pages served from `https://ewo8om3.github.io`, `http://localhost:<any port>` and
`http://127.0.0.1:<any port>`. Any other website open in your browser gets `403`, so it can't use your cookies.
- Your own fork on GitHub Pages: start it with `SCC_ALLOWED_ORIGINS=https://yourname.github.io` (Windows
  PowerShell: `$env:SCC_ALLOWED_ORIGINS="https://yourname.github.io"; py -3 espn_proxy.py`), or add
  `"allowed_origins": ["https://yourname.github.io"]` to `proxy/config.json`.
- `index.html` opened straight from disk (`file://`): set `SCC_ALLOW_FILE=1` or `"allow_file_origin": true` in
  `config.json`. Serving the folder with `python3 -m http.server 8000` is safer and needs no opt-in.

Stop it by closing the window or pressing `Ctrl+C`. Cookie setup is in [§7](#7-connecting-leagues).

---

## 2. The three views and display presets

| View | URL | What it shows | Best shape |
|---|---|---|---|
| **all** | `index.html` or `?view=all` | everything: radar, games, feed, fantasy, DK | a full monitor or a big zone |
| **rail** | `?view=rail` | header, RedZone radar, games, fantasy matchups, scoring feed | tall and narrow (portrait-ish) |
| **strip** | `?view=strip` | DraftKings lineups + exposure, with its own status dot and ⚙ button | wide and short |

Add `&demo=1` to any of them for fake data. You can open the same view in several windows, and they all share
the same settings.

**Display size** (Settings → Screen): `Auto` (default; detected from your screen's physical pixels), `1080p`,
`1440p` or `4K`. The preset sets the rail's text size and density (comfortable, cozy or compact) and the window
split used by the **Open layout windows** button. **Zoom** (`+`/`−` keys, or the Zoom box) fine-tunes on top of
that. Text also scales with each window's size, so a bigger zone means bigger text.

| Preset | Density | What changes in the rail |
|---|---|---|
| 4K | comfortable | position tags, your row *and* your opponent's row of player chips, 2-column game grid, long feed |
| 1440p | cozy | opponent chips drop position tags |
| 1080p | compact | 3-column game grid, your starters only, no stat sub-line, short feed |

---

## 3. Layouts

All percentages are of the **whole screen** (width × height) and are measured from the top-left corner. Pixel
values assume the screen's native resolution. RedZone zones are kept at **16:9** so the video fills its zone
without black bars.

### 3.1 Single 4K monitor (3840×2160): the default

```
┌──────────────────────────────┬──────────┐
│                              │          │
│        RedZone 16:9          │   rail   │
│        2560 × 1440           │  1280 ×  │
│                              │   2160   │
├───────────────────┬──────────┤          │
│ strip 1706 × 720  │ DK site  │          │
└───────────────────┴──────────┴──────────┘
```

| Zone | x, y | Width × height | % of screen |
|---|---|---|---|
| RedZone | 0, 0 | 2560 × 1440 | 66.67% × 66.67% |
| Rail (`?view=rail`) | 2560, 0 | 1280 × 2160 | 33.33% × 100% |
| Strip (`?view=strip`) | 0, 1440 | 1706 × 720 | 44.44% × 33.33% |
| DK My Contests (optional) | 1706, 1440 | 854 × 720 | 22.22% × 33.33% |

No DK window? Make the strip 2560 × 720 (66.67% × 33.33%). Display preset: **4K**.

### 3.2 Single 1440p monitor (2560×1440)

| Zone | x, y | Width × height | % of screen |
|---|---|---|---|
| RedZone | 0, 0 | 1792 × 1008 | 70% × 70% |
| Rail | 1792, 0 | 768 × 1440 | 30% × 100% |
| Strip | 0, 1008 | 1195 × 432 | 46.67% × 30% |
| DK My Contests (optional) | 1195, 1008 | 597 × 432 | 23.33% × 30% |

Display preset: **1440p**. In a strip this short, the DK panel shows one line per lineup (rank, points,
projection, players) instead of side-by-side cards, so the text stays readable (about 16 px). Want the full cards?
Skip the DK window and give the strip 70% × 30%.

### 3.3 Single 1080p monitor (1920×1080)

| Zone | x, y | Width × height | % of screen |
|---|---|---|---|
| RedZone | 0, 0 | 1440 × 810 | 75% × 75% |
| Rail | 1440, 0 | 480 × 1080 | 25% × 100% |
| Strip | 0, 810 | 1440 × 270 | 75% × 25% |

Display preset: **1080p** (compact). The 270-px-tall strip shows one line per lineup (rank, points, projection,
players; about 17 px text) rather than side-by-side cards, which would be too small to read here. At 1080p, skip
the separate DK window and check DK on your phone.
Alternative: RedZone **fullscreen** on the TV or monitor, with the dashboard on a second device (see 3.7/3.8).

### 3.4 Ultrawide 21:9 (3440×1440 or 2560×1080)

**Option A, video first** (3440×1440):

| Zone | x, y | Width × height | % of screen |
|---|---|---|---|
| RedZone | 0, 0 | 2560 × 1440 | 74.42% × 100% |
| Rail | 2560, 0 | 880 × 940 | 25.58% × 65.28% |
| Strip | 2560, 940 | 880 × 500 | 25.58% × 34.72% |

The strip is narrow here, so its lineup columns get tight. Use Zoom, or replace rail + strip with a single
`?view=all` zone (25.58% × 100%).

**Option B, balanced:**

| Zone | x, y | Width × height | % of screen |
|---|---|---|---|
| RedZone | 0, 0 | 1920 × 1080 | 55.81% × 75% |
| Strip | 0, 1080 | 1920 × 360 | 55.81% × 25% |
| Rail | 1920, 0 | 1520 × 1440 | 44.19% × 100% |

On a 2560×1080 ultrawide, use the same percentages. Display preset: **1440p** for 3440×1440 and **1080p** for 2560×1080.

### 3.5 Super-ultrawide 32:9 (5120×1440 or 3840×1080)

Basically two monitors side by side. Put the video in the middle:

| Zone | x, y | Width × height | % of screen |
|---|---|---|---|
| Rail | 0, 0 | 1280 × 1440 | 25% × 100% |
| RedZone | 1280, 0 | 2560 × 1440 | 50% × 100% |
| Strip | 3840, 0 | 1280 × 960 | 25% × 66.67% |
| DK My Contests | 3840, 960 | 1280 × 480 | 25% × 33.33% |

For 3840×1080, use the same percentages. Display preset: **1440p** (5120×1440) or **1080p** (3840×1080).

### 3.6 Dual monitors

- **Monitor 1 (main or TV-facing):** RedZone **fullscreen** (the player's own fullscreen button, see §5).
- **Monitor 2:** `?view=all` maximized or in browser fullscreen (`F11`). If monitor 2 is a big screen (4K), you
  can instead split it 60/40: rail on the left 40% × 100%, strip on the right 60% × 60%, DK My Contests on the right
  60% × 40%.
- Pick the display preset for **monitor 2's** resolution.
- If monitor 2 is in **portrait** orientation, `?view=rail` fills it nicely. Put the strip on monitor 1 under a
  non-fullscreen RedZone, or skip it.

### 3.7 Triple monitors

| Monitor | What goes on it |
|---|---|
| Left | `?view=rail`, maximized (portrait orientation is ideal) |
| Center | RedZone fullscreen |
| Right | top 50%: `?view=strip`, bottom 50%: DK My Contests (or `?view=all` maximized) |

### 3.8 Laptop beside a TV showing RedZone

- **TV:** play RedZone on the TV itself: a cable box, a streaming stick/box app (YouTube TV, NFL+, your TV
  provider's app), or cast from your phone (§5). The TV doesn't need a browser at all.
- **Laptop:** open the dashboard with `?view=all`, press `F11` (Mac: *View → Enter Full Screen*, or `Ctrl`+`Cmd`+`F`)
  and pick the display preset matching the laptop's resolution (usually **1080p**). Use Zoom if it's hard to read
  from the couch.
- Plug the laptop into power, or the screen may dim (see §6 *Keep the screen awake*).

### 3.9 Tablet or phone as a second screen

- Open the GitHub Pages URL on the device. **Settings are stored per device and per browser**, so enter your Sleeper
  username and ESPN leagues again there. For DK, get the CSV onto the device (AirDrop, email, cloud drive), then
  Settings → browse, or paste the lineups.
- **Tablet in portrait:** `?view=rail`. **Tablet in landscape:** `?view=all` (bump Zoom down) or `?view=strip`.
- **Phone:** `?view=rail` in portrait is the most readable. The layout isn't tuned for phones yet.
- Add it to the home screen for a full-screen, app-like window: iPhone/iPad Safari → *Share → Add to Home Screen*;
  Android Chrome → the menu → *Add to Home screen* / *Install app*.
- The page asks the device to keep the screen on while it's visible (where the browser supports it). If the
  screen still sleeps, raise *Auto-Lock* (iOS) or *Screen timeout* (Android) for game day.

---

## 4. Window snapping

### Windows: PowerToys FancyZones (exact zones, recommended)

1. Install **Microsoft PowerToys** (Microsoft Store, or `winget install Microsoft.PowerToys`).
2. Open PowerToys → **FancyZones** → make sure it's enabled.
3. Open the **layout editor**: press `Win`+`Shift`+`` ` `` (backtick), or click *Launch layout editor*.
4. If you have several monitors, pick the monitor at the top of the editor.
5. Choose **Create new layout** → **Canvas** (free-form zones with exact sizes) → name it `Sunday`.
6. Add one zone per row of your layout table in §3 (RedZone, rail, strip, DK). In the Canvas editor, drag or
   resize each zone. Its size is shown on the zone, and the edit dialog lets you type exact values where your
   PowerToys version supports it. Within a few pixels is fine.
   - *Grid alternative:* create a **Grid** layout, then split and merge cells to get roughly the same shape.
7. Save and **apply** the layout to that monitor.
8. To snap a window: start dragging it by the title bar, hold **Shift** (default setting), and drop it on a
   highlighted zone.
9. In FancyZones settings, turn on *"Move newly created windows to their last known zone"* so next Sunday
   your windows go back to their zones.
10. Turn **off** *"Show zone number"* and leave a small zone spacing if you like gaps between windows.

### Windows: built-in Snap (no install)

- **Snap Layouts (Windows 11):** hover the window's maximize button (or press `Win`+`Z`) and pick a layout, e.g.
  the big-left + two-stacked-right layout gives roughly RedZone (left) + rail and strip (right).
- **Keyboard:** `Win`+`←`/`→` snaps to a half, then `Win`+`↑`/`↓` makes a quarter.
- Built-in Snap uses fixed fractions (halves, thirds, quarters), not the exact 16:9 RedZone zones. Use FancyZones
  for a pixel-perfect layout.

### Mac: Rectangle (free)

1. Install **Rectangle** (<https://rectangleapp.com>, or `brew install --cask rectangle`) and give it
   Accessibility permission when asked.
2. Out of the box, use its keyboard shortcuts for halves, thirds ("first two-thirds" for RedZone, "last third"
   for the rail) and "bottom" positions, or drag a window to a screen edge.
3. For exact percentages, use Rectangle's custom-size options (some are in its preferences, more in **Rectangle
   Pro**), or a tool like **Moom** or **Magnet** that accepts custom sizes. Enter the percentages from §3.

### Mac: built-in tiling (macOS 15 Sequoia and later)

- Drag a window to a screen edge or corner and release to tile it. Holding **Option** while dragging shows the
  tile targets right away.
- Or use the menu bar **Window → Move & Resize** for halves, quarters and arrangements, or hover the green
  full-screen button for the same options.
- Like Windows Snap, these are fixed fractions. They're good enough for "RedZone left ⅔, dashboard right ⅓".

### Mac notes

- On a 4K display in a scaled mode ("looks like 1920×1080" or "2560×1440"), **Auto** may guess the preset from
  the scaled size. Pick **4K** manually if text looks off.
- `Ctrl`+`Cmd`+`F` (or the green button) puts a window in its own full-screen Space. For tiles, use a zoomed/tiled
  window instead of full screen.

### Linux

- **GNOME:** drag to edges for halves (`Super`+`←`/`→`). For custom zones, install a tiling extension (e.g.
  *Tiling Shell* or *Tiling Assistant*).
- **KDE Plasma:** built-in KWin tiling (`Meta`+`T` opens the tile editor in recent Plasma versions) lets you draw
  custom zones.
- Tiling window managers (i3, sway, Hyprland) can reproduce any table in §3 with splits.

### Built-in fallback: "Open layout windows"

Settings → **Open layout windows** opens the rail, the strip and (if you set a RedZone link) the RedZone page as
pop-up windows, sized and placed for your display preset. Allow pop-ups for the page when the browser asks
(usually an icon at the right of the address bar), then click the button again.

---

## 5. RedZone sources

**RedZone can't be embedded in the dashboard.** All legit RedZone streams use DRM and block being framed by
other sites. So the stream runs in its *own* window and the dashboard sits next to it. The dashboard never
touches the video.

### The general recipe (works for any browser-based source)

1. Open the source's site and start RedZone.
2. Put it in an **app-style window** with no tabs or address bar, so it fits the zone cleanly:
   - **Chrome:** the browser menu (⋮) → *Cast, save, and share* → **Install page as app…**, or *Create
     shortcut…* with **Open as window** ticked. (Older versions: *More tools → Create shortcut*.)
   - **Edge:** the browser menu (…) → *Apps* → **Install this site as an app**.
   - **Safari (macOS 14+):** *File → Add to Dock*.
   - **Firefox:** no built-in "install as app" on most versions. Use a separate window and `F11`, or use Chrome/Edge
     for the video.
   - **Any browser:** the dashboard's Settings → RedZone link + **Open layout windows** opens it as a pop-up
     window without tabs.
3. Snap that window into the RedZone zone (§4).
4. Use the player's **full-window / theater** mode (not full screen) so the video fills the window.
   Pressing the player's **full screen** button takes over the whole monitor. That's what you want on a
   dedicated RedZone monitor or TV, not inside a zone.

### NFL+ Premium (NFL RedZone included)

- In a browser: sign in at NFL+ on nfl.com, open the RedZone channel, and apply the recipe above. Install the
  page as an app in Chrome/Edge so it gets its own window.
- On a TV: use the NFL app on your streaming device or smart TV (see *NFL app* below).

### YouTube TV with the NFL RedZone add-on (or Sunday Ticket)

- In a browser: tv.youtube.com → Live → NFL RedZone. Chrome and Edge both offer **install as app** for YouTube TV,
  which gives a clean window. Double-clicking the video toggles full screen.
- Put `https://tv.youtube.com/` into Settings → RedZone link to get a one-click **RedZone ↗** button in the
  dashboard header.

### Cable / TV-provider apps (NFL RedZone on Xfinity, Spectrum, DIRECTV, Fubo, Sling and others)

- Many providers have a web player: sign in on the provider's website, find the NFL RedZone channel, and apply
  the recipe. Some providers only allow RedZone in their TV/box apps. In that case use the **laptop + TV**
  layout (§3.8).
- Some web players block full-window mode or need a specific browser. Try Chrome or Edge first.

### The NFL app (phones, tablets, streaming devices)

- On a phone or tablet, play RedZone (with NFL+ Premium) and **cast** or **AirPlay** it to the TV (below), then run
  the dashboard on your computer or another tablet.
- On a streaming device or smart TV, open the NFL app directly on the TV.

### Casting to a TV

- **Chromecast / Google TV:** from the provider's app or Chrome, use the Cast icon. In Chrome, the menu → *Cast…*
  → *Cast tab* mirrors a tab (quality depends on your Wi-Fi). Casting from the provider's own app is smoother.
- **AirPlay:** from an iPhone/iPad/Mac app, tap AirPlay and choose the TV.
- Some providers block casting or mirroring of DRM streams. If you get a black screen, use the TV's own app.
- Once RedZone is on the TV, the computer screen is free for `?view=all`.

---

## 6. Browser notes

| Browser | Notes |
|---|---|
| **Chrome** | Best tested. Install as app / open as window for clean zones. On a GitHub Pages copy, Chrome may ask to allow access to devices on your local network the first time the page reaches the optional ESPN proxy. Allow it. |
| **Edge** | Same engine as Chrome, so everything works the same. *Apps → Install this site as an app*. "Sleeping tabs" can pause background tabs (see below). |
| **Firefox** | Works. No install-as-app on most versions; use a separate window + `F11`. Strict tracking protection doesn't block the data feeds, but if a feed fails, check the shield icon in the address bar. |
| **Safari** | Works on Mac, iPhone and iPad. *File → Add to Dock* (macOS 14+) for an app window. Private-league ESPN login via your browser's cookies usually won't work in Safari (it blocks third-party cookies), so use the proxy. |

**Full screen:** `F11` on Windows/Linux, `Ctrl`+`Cmd`+`F` on Mac (or *View → Enter Full Screen*). For tiled zones,
skip browser full screen and use an app-style window instead.

**Page zoom for 4K / 1440p:** first pick the right **display preset**, then fine-tune with the dashboard's own
Zoom (`+`/`−`), which is saved. Browser zoom (`Ctrl`/`Cmd` + `+`/`−`/`0`) also works, but it's remembered per site
and applies to every view of the dashboard at once. Windows display scaling (125%/150%) also makes everything
bigger. The presets account for that.

**Keep the tab running:**
- Chrome: *Settings → Performance → Memory Saver*: add the dashboard's site to "Always keep these sites active".
- Edge: *Settings → System and performance → Sleeping tabs*: add the site to "Never put these sites to sleep".
- Background tabs may refresh less often in any browser. Keep each view in its own visible window.

**Keep the screen awake:**
- The page uses the browser's Screen Wake Lock (Chrome, Edge, Safari 16.4+, recent Firefox) while it's visible. A
  playing video usually keeps the screen awake too.
- Otherwise, raise the OS sleep timer for game day: Windows *Settings → System → Power* (screen and sleep
  timeouts), or PowerToys **Awake**; Mac *System Settings → Lock Screen / Displays*, or run `caffeinate -d` in
  Terminal; phones as in §3.9.

---

## 7. Connecting leagues

You can mix platforms: all your Sleeper leagues plus any number of ESPN leagues appear in the same "Fantasy
matchups" list, labeled **SLPR** or **ESPN**.

### Sleeper

1. Settings → **Sleeper** → type your **username** (the @handle shown in the Sleeper app profile, not your email)
   → **Find me**.
2. All your leagues for the current season appear with checkboxes. Untick any you don't want on screen (e.g.
   leagues that haven't drafted yet).
3. Nothing else is needed. Sleeper data is public by username.

### ESPN public league

1. Open your league at fantasy.espn.com. The address looks like
   `https://fantasy.espn.com/football/league?leagueId=12345678&seasonId=2026`.
2. Copy the number after `leagueId=` (or paste the whole URL; the dashboard extracts the ID).
3. Settings → **ESPN leagues** → paste it, check the **season** → **Load teams**.
4. Pick **your team** from the list (team name and owner) → **Add, this is my team**.
5. Repeat for each ESPN league. Use *remove* to delete one.

(Whether a league is public is set by the league manager in the ESPN league settings, usually under something like
"Make league viewable to public".)

### ESPN private league (espn_s2 + SWID)

If **Load teams** says the league is private, the dashboard needs your two ESPN login cookies, **`espn_s2`** and
**`SWID`**:

1. Start the proxy (§1.D). Settings → ESPN → *Private ESPN league* → **Test proxy** should say *proxy OK*.
2. Sign in at <https://fantasy.espn.com> and open your league.
3. Copy the two cookie values:
   - **Chrome / Edge:** press `F12` (or the browser menu → *More tools → Developer tools*) → **Application** tab →
     left sidebar **Storage → Cookies** → select `https://fantasy.espn.com` (or `https://www.espn.com`) → find
     `espn_s2` and `SWID` in the list → double-click the **Value** cell and copy it.
   - **Firefox:** press `F12` → **Storage** tab → **Cookies** → `https://fantasy.espn.com` → copy the Value
     of each.
   - **Safari:** first enable the developer menu (*Safari → Settings → Advanced → "Show features for web
     developers"*, called *"Show Develop menu"* on older versions). Then *Develop → Show Web Inspector* →
     **Storage** tab → **Cookies** → copy the values.
4. Paste them into Settings → ESPN → *Private ESPN league*: **espn_s2** (a long string) and **SWID** (looks like
   `{ABCDEF12-3456-...}`, braces included).
5. Click **Load teams** again → pick your team → **Add**.

**Safer alternative (recommended):** copy `proxy/config.example.json` to `proxy/config.json` and put the values
there, and leave the boxes in the page empty. Then the cookies never sit in the browser at all.

> **Security note:** `espn_s2` and `SWID` act like a logged-in session for **your ESPN account**. Anyone who has
> them can read your leagues, and possibly do more, as you. Never post them, screenshot them, commit them or share
> them with your buddies. Each person uses their own. If you paste them into the page, they're stored in your
> browser's `localStorage` for that page's address and sent only to a proxy at `localhost` / `127.0.0.1` (the page
> refuses any other Proxy address). On the hosted GitHub Pages copy that storage is shared by every project page
> under the same `github.io` account, so `proxy/config.json` is the safer place. It's git-ignored. To revoke them,
> sign out of ESPN on all devices (or change your password), which invalidates the cookies. They also expire on
> their own after a while, so re-copy them if private leagues stop loading.

Before you reach for the proxy: if you're signed in to ESPN in the *same* browser and it allows third-party
cookies, private leagues may load without it. The dashboard tries that first.

---

## 8. DraftKings lineups

DraftKings has no public API for your entries, so you give the dashboard a CSV. It stays in your browser.

### Import

Settings → **DraftKings lineups** → drop files on the box (or **browse**), or paste:

| Source | How to get it | What it adds |
|---|---|---|
| **Entries file `DKEntries.csv` (best)** | DraftKings website (desktop) → **Lineups** → **Edit Entries** → pick the NFL slate → **Download**. DK renames menus from time to time; you want the bulk "edit entries" download, which is the same file you'd upload back to DK. | lineups + contest name, fee, entry IDs + a player/team table |
| **Upload CSV** | the file you edit for DK's bulk lineup upload (`QB,RB,RB,WR,WR,WR,TE,FLEX,DST` with `Name (ID)` cells) | lineups |
| **DKSalaries.csv** (optional) | contest lobby → the contest → *Export to CSV* / download player list | exact teams + salaries for matching |
| **Paste** | one lineup per line: `Name (ID), Name (ID), …` in QB, RB, RB, WR, WR, WR, TE, FLEX, DST order | lineups |

You can drop several files at once (e.g. upload CSV + DKSalaries.csv). Keep **replace existing lineups** ticked
to swap in a new set, or untick it to add to what's there.

If the DK panel lists any **unmatched** players, add DKSalaries.csv so the dashboard knows their teams.

After kickoff DraftKings is reported to tag started players as `Name (ID) (LOCKED)`. Tags like that are ignored.
If a slot still can't be read (empty, or a format the dashboard doesn't know), the lineup is kept, the import
message lists the slot, and the lineup shows **⚠ N missing** with the panel saying **incomplete**, because its
total is too low until you re-export or paste it.

### Refreshing each week

1. After you finalize lineups (or after late swap), export again from DK.
2. Settings → DraftKings → drop the new file with **replace existing lineups** ticked.
3. Settings → **Clear DK data** wipes old lineups if you're not playing DFS that week.

The feed and the live scoring reset with the NFL week automatically (the feed is saved per season and week, so
the first load of a new week starts empty). Only the lineups need re-importing.

What the DK panel shows: live DK Classic points calculated from Sleeper's stats (including the 300/100/100 yard
bonuses, defensive and special-teams fumble recoveries, and DST points-allowed tiers, which only count once that
DST's game has kicked off, so a DST shows 0 until then), your best lineup, ranks among your own entries, players live / to go, and
exposure. **Contest standings and payouts are only on DraftKings**, which is what the optional DK My Contests
window is for.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| **Amber status dot / "data 40s old · failing: …"** | One feed is failing, so part of the page is showing older data. The line names the feed and shows the real age. It retries on its own (slower after repeated errors). |
| **Red status dot / "OFFLINE" / "Failed to fetch"** | Nothing fresh is getting through. Something blocked the requests. Check your internet connection, then disable ad/tracker blockers *for this page* (uBlock, Privacy Badger, Brave Shields, a Pi-hole, a corporate firewall). The page needs `api.sleeper.app`, `api.sleeper.com`, `site.api.espn.com` and (ESPN leagues) `lm-api-reads.fantasy.espn.com`. |
| **"scores: fallback (no clock / red zone)"** | ESPN's scoreboard was unreachable, so scores come from Sleeper's schedule. Usually temporary. If it persists, an extension or network is blocking `site.api.espn.com`. |
| **Stale data / "paused (tab hidden)"** | The tab was hidden or asleep; it refreshes as soon as it's visible again. Press `r` to refresh now, and exclude the site from Memory Saver / Sleeping tabs (§6). |
| **"next refresh 5 min (no games live)"** | Normal. With no game live it checks every 5 minutes (every minute on game days before kickoff), then switches back to your refresh rate. Press `r` any time. |
| **DK "⚠ incomplete" / "N missing"** | A lineup slot couldn't be read from the file (see §8). Re-export `DKEntries.csv`, or paste that lineup. |
| **Proxy says "origin or host not allowed"** | The page isn't on an allowed address (§1.D). Use the GitHub Pages link or `http://localhost`, or add your fork's address. |
| **Player shows 0 while you can see he scored** | The live stats feed can lag a play or two. Give it 15–30 s. Stat corrections after games can change totals. |
| **ESPN 401 / "private league"** | The league is private. Follow §7 ESPN private league. Check the **season** is right (a league ID from last year with this year's season, or the reverse, gives 401/404). |
| **ESPN "rejected your espn_s2/SWID"** | The cookies expired or were copied wrong (SWID needs its `{braces}`). Re-copy both. |
| **ESPN 403** | Usually the same as 401 (no access). If it appears for public leagues, ESPN may be blocking automated-looking traffic from your network for a while. Try again later or from another network. |
| **"no proxy at http://localhost:8766"** | The proxy window isn't running, or it's on another port. Start it (§1.D). On a GitHub Pages copy in Chrome, allow the local-network permission prompt. |
| **Wrong week** | The week comes from Sleeper's NFL state and flips early in the week. To force one, add `&week=10` (and optionally `&season=2026`) to the URL. |
| **Sleeper "No user named …"** | Use the username (handle), not the display name or email. |
| **DK "unmatched" players** | Add DKSalaries.csv, or check spelling in pasted lines. DST can be the nickname ("Colts") or full name. |
| **Pop-up windows don't open** | Allow pop-ups for the page (address-bar icon), then click *Open layout windows* again. |
| **Text too small/big** | Pick the right **display preset**, then `+`/`−`. Make sure browser zoom is 100% (`Ctrl`/`Cmd`+`0`). |
| **Reset everything** | Settings → **Forget everything**. Or clear site data for the page in the browser settings. Settings for the zip copy and the GitHub Pages copy are separate. |

---

## 10. FAQ

**Is it free? Do I need an account?** Yes and no. It's free and open source (MIT). You just need your Sleeper
username and/or ESPN league IDs.

**Does it upload my data anywhere?** No. Everything is stored in your browser (`localStorage`). The page only
*reads* from Sleeper, ESPN and (if you run it) your own local proxy.

**Can it show the RedZone video inside the dashboard?** No. DRM-protected streams can't be embedded in other
pages. Run the stream in its own window next to it (§5).

**Are the DraftKings points official?** No. They're calculated from live Sleeper stats with DK Classic scoring
rules, and are usually spot-on during games. Your official score, rank and winnings are only on DraftKings.

**Does it support Yahoo, NFL Fantasy, CBS, FanDuel or DK Showdown?** Not yet. Sleeper, ESPN and DK Classic.
Showdown files import with the 1.5× captain applied, but kickers score 0, so treat Showdown totals as rough.

**Will the data feeds keep working?** Hopefully, but no promises. Only Sleeper's `api.sleeper.app/v1` API is
officially documented. Sleeper's stats, projections and schedule feeds and both ESPN APIs are undocumented and can
change or be blocked at any time. The dashboard keeps its traffic light (slower when nothing is live) to stay a
polite client.

**Can my buddies use it?** Yes. Send them the GitHub Pages link. Everyone enters their own leagues, and nothing is
shared between people.

**Why does a matchup's projection differ from Sleeper's or ESPN's app?** Sleeper cards use Sleeper's weekly
projections scaled by game time remaining. ESPN cards show ESPN's own projection next to it. The win % is a
simple estimate, not either app's model (except ESPN cards, which use ESPN's own win probability when ESPN
provides it).

**Can I run it on a TV browser?** It's a normal web page, so smart-TV browsers that support modern JavaScript can
load `?view=all`. Text entry is painful there, so set it up on a phone or computer first. Note that settings don't
transfer between devices.

---

## 11. Disclaimer

Sunday Command Center is an independent fan project. It is **not affiliated with, endorsed by, or sponsored by**
the NFL, NFL RedZone, NFL+, Sleeper, ESPN, DraftKings, YouTube TV, or any TV provider. All trademarks belong to
their owners. It does not embed, restream, record or proxy any video. It reads publicly available sports and
fantasy data for personal use. You're responsible for following each service's terms. Daily fantasy involves
real money: always verify lineups, scores and results in the official apps. Provided "as is" under the
[MIT License](LICENSE), without warranty of any kind.
