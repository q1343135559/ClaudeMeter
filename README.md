# ClaudeMeter

*English · [简体中文](README.zh-CN.md)*

A Claude Code statusline that shows your **context usage, 5-hour window, weekly window, and
per-model quota windows such as Fable** — the last of which no other statusline can show today.

```
◈ Opus 5 1M  …/Project/ClaudeMeter  ⎇ main  ≈$0.42
CTX ▓▓▓░░░░░░░ 31%  5H ▓▓░░░░░░░░ 23% ↻2h14m  WEEK ▓▓▓▓▓▓░░░░ 58% ↻2d23h  FABLE ▓▓▓▓▓▓▓▓▓░ 95% ↻1d9h
```

No network calls. No credential access. No subprocesses. Everything comes from files already on
your disk, and a full render takes about 15 ms of work on top of Node's startup.

## Why this exists

Every statusline plugin reads its quota data from the JSON that Claude Code pipes to the statusline
command on stdin. That payload has exactly two rate-limit windows — `five_hour` and `seven_day` —
and **no per-model breakdown at all**. Two consequences follow:

**Per-model quotas are invisible.** On Max plans, Fable draws on a separate weekly cap (roughly 50%
of your weekly allowance). You can be at 95% of it without any indication in your statusline.

**Weekly usage often does not render.** The most popular statusline plugin hides the weekly segment
below an 80% threshold by default, so it only materialises once you are nearly out.

ClaudeMeter reads `cachedUsageUtilization` from `~/.claude.json` instead. That is Claude Code's own
usage cache — the same data behind the `/usage` command — and its `limits[]` array carries
`kind: "weekly_scoped"` entries whose model name lives in `scope.model.display_name`.
ClaudeMeter has no display threshold: weekly usage renders at 0% just as readily as at 99%.

## Install

```
/plugin marketplace add q1343135559/ClaudeMeter
/plugin install claudemeter@claudemeter
/claudemeter:setup
```

`/claudemeter:setup` locates your Node binary, installs a small launcher, backs up any statusline
you already have (asking before it replaces one that is not ClaudeMeter's), and writes
`settings.json`. Restart Claude Code or run `/reload-plugins` afterwards.

Run `/claudemeter:configure` to change what is displayed.

Requires Node.js 18 or later and Claude Code v2.1.153 or later.

## What the statusline shows

### Line 1 — session identity

```
◈ Opus 5 1M  …/Project/ClaudeMeter  ⎇ main  ≈$0.42
```

| Element | Meaning |
| --- | --- |
| `◈ Opus 5` | The model handling this session |
| `1M` | Appended when the model's context window is 1M tokens rather than the default 200K |
| `…/Project/ClaudeMeter` | Working directory, home collapsed to `~`, trimmed to the last two levels. A leading `…` means levels were hidden; a leading `~` means you are seeing the whole path |
| `⎇ main` | Current git branch, or a short SHA when HEAD is detached |
| `≈$0.42` | Estimated cost of this session — see below |

### Line 2 — usage

```
CTX ▓▓▓░░░░░░░ 31%  5H ▓▓░░░░░░░░ 23% ↻2h14m  WEEK ▓▓▓▓▓▓░░░░ 58% ↻2d23h  FABLE ▓▓▓▓▓▓▓▓▓░ 95% ↻1d9h
```

| Segment | Meaning | Source |
| --- | --- | --- |
| `CTX` | How full the current context window is | stdin `context_window` |
| `5H` | The 5-hour rolling rate-limit window | stdin, falling back to the local cache |
| `WEEK` | The weekly rate-limit window | stdin, falling back to the local cache |
| `FABLE` (and any other model name) | That model's own weekly window | local cache only |
| `↻2h14m` | Time until that window resets | — |
| `~95%` and `·22m` | The value came from the local cache and is more than 20 minutes old; `·22m` is its actual age | — |

Segment labels, order, and visibility are all configurable. Model-scoped segments are not
hardcoded to Fable — whatever `weekly_scoped` windows the server reports will appear, so new ones
show up without a plugin update.

### Colours

Bars are coloured by how much headroom is left. The consumed portion carries the colour; the
remainder stays dim.

| Tier | Colour | Default threshold |
| --- | --- | --- |
| Plenty left | green | below 50% used |
| Past halfway | yellow | 50% or more used |
| Only a fifth left | light red | 80% or more used |

Light red is ANSI bright red (91) rather than red (31), which reads as dark brown on most dark
terminal themes and gets lost among the other bars.

Claude Code also reports its own severity judgement (`normal` / `warning` / `critical`) alongside
the quota data. ClaudeMeter takes **whichever of the two is more severe**. The server can escalate
a window — it knows your account's real tier — but a `normal` from the server will not pull a
window that is 58% consumed back to green, which would make the "yellow past halfway" rule almost
never fire.

Context has its own threshold pair (`contextWarning` / `contextCritical`) because running out of
context triggers compaction rather than a rate limit.

### Freshness, and the `~` marker

`5H` and `WEEK` come from stdin whenever it carries them, which means they refresh on every model
response. Per-model windows exist only in the local cache, and Claude Code refreshes that cache on
its own schedule — measured at **10 to 20 minutes** between refreshes.

So ClaudeMeter marks any cached value older than 20 minutes with a `~` prefix and its actual age.
It does not poll, spawn a background refresher, or call the API to work around this; it tells you
the number lags instead of pretending otherwise.

Set `staleWarnMs` to `0` to always see the age, or `showStaleAge` to `false` to never see it.

### Why the cost has a `≈`

Claude Code's session cost is a **client-side estimate against API list prices**, and it resets to
zero when `/clear` starts a new session.

If you are on a Claude.ai subscription (Pro, Max, Team), you do not pay per token — that figure is
"what these tokens would have cost at API rates", not a bill. ClaudeMeter detects subscription
accounts and prefixes the number with `≈` so it is not misread as a charge. API-key accounts get a
plain `$`, since there the number does approximate real spend.

Set `showCost` to `false` to hide it.

## Data and privacy

ClaudeMeter reads three things, all local:

1. The session JSON Claude Code pipes in on stdin.
2. `~/.claude.json` — specifically `cachedUsageUtilization`, plus two non-identifying fields from
   `oauthAccount`: `organizationType` (subscription or not, which decides the `≈` prefix) and
   `organizationRateLimitTier` (plan tier).
3. The nearest `.git/HEAD` at or above your working directory, for the branch name.

What it deliberately does **not** do:

- **No network requests.** In particular it never calls `api.anthropic.com/api/oauth/usage`. That
  endpoint's response *is* what `cachedUsageUtilization` caches, so calling it buys nothing — and
  it is aggressively rate-limited, so a statusline running on every interaction would earn 429s
  that degrade your actual session.
- **No credential access.** It does not read `~/.claude/.credentials.json` or the macOS Keychain.
- **No subprocesses.** The branch name comes from reading `.git/HEAD` directly rather than forking
  `git`.
- **No data leaves your machine.** `~/.claude.json` also holds your email address, account UUID,
  machine ID, and full project history. ClaudeMeter extracts only the allowlisted fields above;
  a test asserts that the returned structure contains none of the rest.

`plugin/dist/index.js` is **not minified**, specifically so you can read it and confirm the above.

Disable it for a single session with `CLAUDEMETER_DISABLE=1 claude`.

## Configuration

Configuration lives at `{CLAUDE_CONFIG_DIR:-~/.claude}/claudemeter/config.json`. A missing or
malformed file falls back to defaults silently — **a broken config never removes your statusline**.
Every field is validated independently, so one bad key does not discard the rest.

Run `/claudemeter:configure` for a guided walkthrough, or edit the file directly. Common changes:

```jsonc
{
  "scopedFilter": ["Fable"],                          // show only Fable's weekly window
  "barWidth": 0,                                      // drop the bars, keep the percentages
  "showLine1": false,                                 // usage line only
  "staleWarnMs": 0,                                   // always show cache age
  "thresholds": { "warning": 60, "critical": 85 },    // when bars turn yellow / red
  "colors": { "critical": "red", "barEmpty": "none" } // recolour
}
```

The full option list is documented in [`commands/configure.md`](commands/configure.md).

Environment variables: `CLAUDEMETER_DISABLE=1` silences the statusline entirely, `NO_COLOR` (or
`CLAUDEMETER_NO_COLOR`) strips ANSI colour, and `CLAUDEMETER_DEBUG=1` sends errors to stderr.

## Width behaviour

ClaudeMeter renders a ladder of progressively more compact layouts and picks the first that fits
the terminal, so it never wraps. As width shrinks it drops reset countdowns, then narrows the bars
from 10 to 6 to 4 cells, then removes the bars entirely, and finally drops windows.

Windows are dropped by **urgency**, not by position: a window the server flagged critical, or one
with a high percentage, outlives a quieter one. A 30-column terminal keeps `CTX` and a 95% `FABLE`
rather than the 41% `WEEK` that happened to come first.

## Troubleshooting

**No usage segments at all.** In order of likelihood:

1. You are not on a Claude.ai subscription — API-key, Bedrock, and Vertex accounts have no
   subscription quota windows, so neither `rate_limits` nor `cachedUsageUtilization` exists.
2. Claude Code has not written its usage cache yet. Run `/usage` once in any session.
3. The cache is more than 6 hours old (`staleMaxMs`), so it was discarded rather than displayed
   as a stale number. Run `/usage` once.

**A window disappeared.** Cached windows whose reset time has already passed are dropped on
purpose. The cache can lag 10+ minutes and routinely straddles a 5-hour reset, at which point the
cached percentage is provably wrong — showing nothing beats showing a number you know is stale.

**The statusline vanished entirely.** Confirm the launcher can find an install:

```bash
COLUMNS=120 node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/claudemeter/launcher.mjs" --demo
```

That renders built-in sample data and needs no stdin. Silence means no installed version was
found — re-run `/plugin install claudemeter@claudemeter`.

**Output wraps or gets cut off.** Claude Code exports `COLUMNS` from v2.1.153 onward; on older
versions ClaudeMeter falls back to 120 columns. Set `maxWidth` in the config to pin it.

## Development

```bash
npm install
npm run build     # esbuild bundle -> plugin/dist/index.js
npm test          # node --test, 64 cases
npm run demo      # render built-in sample data
```

To iterate without reinstalling the plugin, point the launcher at your working tree:

```bash
CLAUDEMETER_DIST=$PWD/plugin/dist/index.js node plugin/bin/launcher.mjs --demo
```

### Repository layout

```
.claude-plugin/marketplace.json   marketplace catalog
plugin/                           ← the only directory an install copies
  .claude-plugin/plugin.json
  commands/                       /claudemeter:setup and :configure
  bin/launcher.mjs                version-resolving launcher
  dist/index.js                   committed build output
src/ tests/ scripts/              build and test tooling, never shipped
```

The build toolchain deliberately stays at the repository root. Claude Code runs `npm install`
inside any installed plugin directory that contains a `package.json` and a lockfile, so keeping
`package.json` out of `plugin/` means installs are about 100 KB instead of pulling 35 MB of
esbuild and TypeScript that nothing uses at runtime.

Zero runtime dependencies — `node:` builtins only. `plugin/dist/` is committed because marketplace
installs copy the repository as-is; CI rebuilds and fails if it has drifted from `src/`.

Code comments and docstrings are written in Chinese, per the repository's convention. User-facing
documentation is in English.

## License

MIT
