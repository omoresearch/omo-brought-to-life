# body/: Omo's player body

| File | What it is |
|---|---|
| `body.mjs` | `Body`: the Mineflayer player `OMO`, its jobs, guard mode and reflexes; `BODY_TOOLS`: the 22 `omo-body` MCP tools; `quickIntent`: the fast path; `handleMcp`: the MCP server. |
| `mindcraft/` | Mindcraft's skill library (MIT), vendored. See its README for the local edits. |
| `patch-mc-26.2.mjs` | npm postinstall: teaches Mineflayer and the PrismarineJS stack Minecraft 26.2. Idempotent; re-run after any `npm install`. |
| `body.test.mjs` | LAN file, MCP, readable errors before a world opens, follow, fast-path intents, jobs pausing for a fight and resuming. |

The body starts with the bridge (`OMO_BODY=0` turns it off) and waits for
`~/.config/omo/lan.json`, which the mod writes when your world opens.

Try new skills on a scratch server before your real world: a vanilla 26.2
server in offline mode on a spare port, with a `lan.json` pointing at it
(`OMO_LAN_FILE`) and the bot opped.
