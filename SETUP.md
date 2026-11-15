# Screen setup

The idea: your RedZone stream gets the big 16:9 zone top-left, the **rail** (`?view=rail`) runs down the right
side, and the bottom-left holds the **strip** (`?view=strip`, your DK lineups) plus an optional DK My Contests
window.

## Display size presets

Settings → **Display size**: `Auto` (default, detected from your screen's physical pixels), `1080p`, `1440p` or `4K`.
The preset is saved in `localStorage` and controls:

| Preset | Rail density | What changes |
|---|---|---|
| 4K (3840×2160) | comfortable | full chips (position tags, opponent row), 2-column game grid, long feed |
| 1440p (2560×1440) | cozy | opponent chips drop position tags, slightly larger type per pixel |
| 1080p (1920×1080) | compact | 3-column game grid, your starters only (no opponent chips), short feed, no stat sub-line |

It also sets the window split used by **Open layout windows** and shown below. **Zoom** (`+`/`−`) fine-tunes on top.

## Layout percentages

Percentages are of the full screen. Pixel sizes assume Windows scaling at 100%. At other scaling levels,
FancyZones works in physical pixels anyway.

| Zone | 4K (3840×2160) | 1440p (2560×1440) | 1080p (1920×1080) |
|---|---|---|---|
| **RedZone** (top-left) | 66.67% × 66.67% → 2560×1440 at 0,0 | **70% × 70% → 1792×1008 at 0,0** | 75% × 75% → 1440×810 at 0,0 |
| **Rail** (right, full height) | 33.33% × 100% → 1280×2160 at 2560,0 | **30% × 100% → 768×1440 at 1792,0** | 25% × 100% → 480×1080 at 1440,0 |
| **Strip** (bottom-left) | 44.44% × 33.33% → 1706×720 at 0,1440 | **46.67% × 30% → 1195×432 at 0,1008** | 50% × 25% → 960×270 at 0,810 |
| **DK My Contests** (bottom, optional) | 22.22% × 33.33% → 854×720 at 1706,1440 | **23.33% × 30% → 597×432 at 1195,1008** | 25% × 25% → 480×270 at 960,810 |

All three RedZone zones are exactly 16:9, so the stream fills its zone with no letterboxing. If you skip
the DK window, stretch the strip across the whole bottom (66.67% / 70% / 75% wide).

## Windows: PowerToys FancyZones

1. Install **Microsoft PowerToys** and turn on **FancyZones**.
2. Press `Win`+`Shift`+`` ` `` (or PowerToys → FancyZones → *Launch layout editor*) and pick the 4K monitor.
3. **Create new layout** → **Canvas** → name it `Sunday`.
4. Delete the default zones and add four, typing the sizes from the table above into each zone's
   width/height/position boxes (Canvas zones show their size while you drag, and you can edit them precisely).
5. Save and apply. While dragging a window, hold **Shift** to drop it into a zone.
6. Open the windows:
   - RedZone: your NFL+ / YouTube TV / Sunday Ticket player → zone 1 (double-click the video, *not* browser
     fullscreen; use the player's theater/"full window" mode).
   - Rail: open `…/index.html?view=rail`. In Chrome/Edge, menu → *Cast, save and share* → **Install page as
     app** (or *Create shortcut → Open as window*) for a border-free window. Drop it into zone 2.
   - Strip: same with `?view=strip` → zone 3.
   - DK: <https://www.draftkings.com/mycontests> → zone 4.
7. FancyZones remembers which zone each app was in, so next Sunday the windows go back to their spots.

Tip: in FancyZones settings enable *"Move newly created windows to their last known zone"*.

## Mac

- **Built-in:** Settings → *Open layout windows* opens the rail and strip (and RedZone, if you set a link)
  as pop-ups sized to your preset. Allow pop-ups for the page.
- **Rectangle / Rectangle Pro / Moom / Magnet:** create custom positions using the percentages above.
  Rectangle Pro and Moom take percentages directly.
- In macOS "Looks like 1920×1080" scaling on a 4K panel, pick the **4K** preset manually if Auto guesses wrong.

## Browser tips

- Turn off "Memory Saver" / tab sleeping for the dashboard so it keeps refreshing when it isn't focused.
- Each view keeps its own scroll position. Data refreshes every 15 s (Settings → Refresh).
- The red-zone flag comes from ESPN's scoreboard. During commercials ESPN sometimes freezes the situation, so
  the radar only counts plays with a real down.
