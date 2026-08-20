---
description: Configure ClaudeMeter as your Claude Code statusline
allowed-tools: Bash, Read, Edit, Write, AskUserQuestion
---

# ClaudeMeter Setup

Install ClaudeMeter as the user's statusline. Follow the steps in order — each one exists for a
reason that is stated inline. Talk to the user in whatever language they are using.

## 1. Locate the runtime and the plugin

```bash
node -e "console.log(process.execPath)"
```

Take the **absolute path** to Node. Never write a bare `node` into `settings.json`: the statusline
runs as a child process of Claude Code, whose `PATH` may not include an nvm- or Homebrew-managed
Node. A bare command fails silently on many machines — the statusline simply never appears, with
no error anywhere.

If that command fails, Node is not on `PATH`. Tell the user ClaudeMeter needs Node.js 18 or later,
then stop.

The plugin root is `${CLAUDE_PLUGIN_ROOT}`; the launcher source is at
`${CLAUDE_PLUGIN_ROOT}/bin/launcher.mjs`.

## 2. Install the launcher at a stable path

```bash
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
mkdir -p "$CONFIG_DIR/claudemeter"
cp "${CLAUDE_PLUGIN_ROOT}/bin/launcher.mjs" "$CONFIG_DIR/claudemeter/launcher.mjs"
echo "installed: $CONFIG_DIR/claudemeter/launcher.mjs"
```

Why the extra indirection: `${CLAUDE_PLUGIN_ROOT}` is **not** expanded inside the `statusLine`
command in `settings.json`, and the plugin cache path contains a version number
(`plugins/cache/<marketplace>/claudemeter/<version>/`), so it changes on every upgrade. The
launcher resolves the highest installed version at runtime, which means **plugin upgrades take
effect without re-running setup**.

## 3. Check for and back up an existing statusline

```bash
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
node -e "
const fs=require('fs'), p=process.argv[1];
try { const s=JSON.parse(fs.readFileSync(p,'utf8'));
  console.log(JSON.stringify(s.statusLine ?? null, null, 2)); }
catch (e) { console.log('null'); }
" "$CONFIG_DIR/settings.json"
```

- Output is `null` → nothing configured, go straight to step 4.
- Output mentions `claudemeter` → this plugin installed it before, overwrite without asking.
- **Anything else** → the user already runs a different statusline. Show them the current value,
  then use AskUserQuestion to confirm the replacement. If they decline, stop and change nothing.

Once you have consent (or there was nothing there), back up first:

```bash
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if [ -f "$CONFIG_DIR/settings.json" ]; then
  cp "$CONFIG_DIR/settings.json" "$CONFIG_DIR/settings.json.claudemeter-backup.$(date +%Y%m%d%H%M%S)"
  node -e "
  const fs=require('fs'), p=process.argv[1], out=process.argv[2];
  try { const s=JSON.parse(fs.readFileSync(p,'utf8'));
    if (s.statusLine) fs.writeFileSync(out, JSON.stringify(s.statusLine, null, 2)); } catch {}
  " "$CONFIG_DIR/settings.json" "$CONFIG_DIR/claudemeter/previous-statusline.json"
  echo "backed up"
fi
```

`previous-statusline.json` lets the user restore their old statusline by hand at any time, which
is the minimum courtesy when replacing someone else's.

## 4. Ask about the refresh interval

Use AskUserQuestion to pick a `refreshInterval` in seconds. Explain what it actually controls:
usage percentages are **event-driven** — Claude Code re-runs the statusline after every model
response — so this timer only keeps the **reset countdowns and the cache-age marker** moving while
the session is idle.

Options:

- **10 seconds (recommended)** — countdowns look alive; each tick costs roughly 50 ms
- **30 seconds** — cheaper, countdowns lag slightly
- **60 seconds** — cheapest; countdowns are minute-resolution anyway, so this loses little
- **None** — update only on responses; countdowns freeze while idle

## 5. Write `settings.json`

Use the script below rather than hand-assembling JSON — hand-editing risks destroying other keys
in the user's `settings.json`. Substitute `__NODE__` with the absolute path from step 1 and
`__INTERVAL__` with the seconds from step 4. If the user chose "None", delete the
`refreshInterval` line entirely.

```bash
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
node -e "
const fs=require('fs'), path=process.argv[1], node=process.argv[2], interval=process.argv[3];
let settings={};
try { settings=JSON.parse(fs.readFileSync(path,'utf8')); } catch {}
settings.statusLine={
  type:'command',
  command:JSON.stringify(node)+' '+JSON.stringify(process.argv[4]),
  ...(interval ? {refreshInterval:Number(interval)} : {}),
};
fs.writeFileSync(path, JSON.stringify(settings,null,2)+'\n');
console.log(JSON.stringify(settings.statusLine,null,2));
" "$CONFIG_DIR/settings.json" "__NODE__" "__INTERVAL__" "$CONFIG_DIR/claudemeter/launcher.mjs"
```

Both paths inside the command string are wrapped by `JSON.stringify`, so paths containing spaces
survive shell word-splitting.

## 6. Verify

```bash
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
COLUMNS=120 node "$CONFIG_DIR/claudemeter/launcher.mjs" --demo
```

This should print two coloured lines. If it prints nothing, the launcher found no installed
version — have the user confirm that `/plugin install claudemeter@claudemeter` succeeded.

Then verify against real data (this reads the user's actual `~/.claude.json`):

```bash
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
echo '{"model":{"display_name":"Opus 5"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"context_window_size":1000000,"used_percentage":25}}' \
  | COLUMNS=120 node "$CONFIG_DIR/claudemeter/launcher.mjs"
```

A Claude.ai subscriber should see `5H` and `WEEK`, plus any per-model windows such as `FABLE`.
Seeing **no usage segments** is legitimate — in order of likelihood:

1. Not a Pro/Max subscriber (API key, Bedrock, or Vertex) — those accounts have no subscription
   quota windows at all
2. Claude Code has not written its usage cache yet — running `/usage` once in any session fixes it
3. The cached data is more than 6 hours old — same fix

## 7. Wrap up

Tell the user:

- Restart Claude Code or run `/reload-plugins` for the statusline to appear
- Use `/claudemeter:configure` to change what is displayed
- Disable temporarily with `CLAUDEMETER_DISABLE=1 claude`
- To restore the previous statusline: a timestamped copy of the whole file is at
  `{config dir}/settings.json.claudemeter-backup.*`, and the old `statusLine` object alone is at
  `{config dir}/claudemeter/previous-statusline.json`
