---
description: Adjust what ClaudeMeter shows in your statusline
allowed-tools: Read, Write, Bash, AskUserQuestion
---

# ClaudeMeter Configure

Walk the user through adjusting ClaudeMeter's display configuration. Talk to them in whatever
language they are using.

## 1. Read the current configuration

The config file lives at `{CLAUDE_CONFIG_DIR:-~/.claude}/claudemeter/config.json`.

```bash
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
cat "$CONFIG_DIR/claudemeter/config.json" 2>/dev/null || echo '{}'
```

A missing file is normal and means every value is at its default.

## 2. Ask what they want to change

Use AskUserQuestion, at most four questions at a time. Worthwhile directions:

- **Which segments to show**: line 1 (model / path / branch / cost), the context bar, the 5-hour
  window, the weekly window, per-model windows
- **Only certain models**: `scopedFilter` — e.g. `["Fable"]` shows only Fable's weekly window
- **Bar width**: `auto` (adapts to terminal width), a fixed cell count, or `0` (percentages only)
- **When bars change colour**: `thresholds.warning` (default 50, turns yellow) and
  `thresholds.critical` (default 80, turns light red)
- **Labels**: rename `CTX` / `5H` / `WEEK`
- **Path depth**: `pathLevels`
- **Staleness threshold**: `staleWarnMs`

Show the values currently in effect before asking.

## 3. Write the configuration back

**Change only the keys the user asked about; preserve everything else.** Some advanced keys
(`colors`, `thresholds`, `staleMaxMs`, `maxWidth`) are not part of this guided flow, but if the
user has set them by hand they must survive the write.

```bash
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
mkdir -p "$CONFIG_DIR/claudemeter"
```

Read the existing file, mutate that object, and write it back. Do not rebuild it from scratch.

## 4. Verify

```bash
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
COLUMNS=120 node "$CONFIG_DIR/claudemeter/launcher.mjs" --demo
```

Confirm the change took effect. A malformed config never removes the statusline — it falls back to
defaults silently — so if nothing appears to have changed, check the JSON for syntax errors first.

## Full option reference

```jsonc
{
  "showLine1": true,          // line 1: model / path / branch / cost
  "showContext": true,        // CTX context-window bar
  "showFiveHour": true,       // 5H five-hour window
  "showWeekly": true,         // WEEK weekly window (always shown; there is no percentage gate)
  "showScoped": true,         // per-model weekly windows, e.g. FABLE
  "scopedFilter": [],         // empty shows all; ["Fable"] shows only Fable
  "showUnknownWindows": false,// window kinds this plugin does not yet recognise
  "showCost": true,           // session cost; subscription accounts get a ≈ prefix,
                              // marking it as an API-price estimate rather than a bill
  "showGitBranch": true,
  "pathLevels": 2,            // directory levels to keep (a leading ~ does not count as one)
  "barWidth": "auto",         // "auto" | 0-20; 0 shows percentages only
  "barFilled": "▓",
  "barEmpty": "░",
  "labels": { "context": "CTX", "fiveHour": "5H", "weekly": "WEEK" },
  "thresholds": {             // when bars change colour (percent consumed)
    "warning": 50,            // past halfway -> yellow
    "critical": 80,           // only a fifth left -> light red
    "contextWarning": 50,     // context has its own pair: running out triggers compaction,
    "contextCritical": 80     // which is a different failure mode from a rate limit
  },
  "staleWarnMs": 1200000,     // cached data older than 20 min is marked as approximate
  "staleMaxMs": 21600000,     // cached data older than 6 h is dropped rather than shown
  "showStaleAge": true,       // append the actual age, e.g. ·8m
  "showResetCountdown": true, // show ↻2h14m reset countdowns
  "colors": {
    "context": "green",       // context bar, "plenty" tier
    "usage": "green",         // quota bars, "plenty" tier
    "warning": "yellow",      // past halfway
    "critical": "brightRed",  // only a fifth left
    "barEmpty": "dim",        // the unconsumed part of a bar
    "model": "cyan", "project": "yellow", "git": "magenta",
    "label": "dim", "cost": "green"
  },
  "maxWidth": null            // pin the render width; null uses the terminal width
}
```

Valid colour names: `black` `red` `green` `yellow` `blue` `magenta` `cyan` `white`
`brightRed` `brightGreen` `brightYellow` `brightBlue` `brightMagenta` `dim` `none`.

How colouring works: bars are tiered by remaining headroom (plenty = green, past halfway = yellow,
only a fifth left = light red). The consumed portion carries the tier colour; the remainder uses
`barEmpty`. Claude Code's own severity judgement can **escalate** a window's tier but never pulls
it back down to green.
