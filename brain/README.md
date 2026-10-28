# brain/: Omo's Hermes profile

Omo thinks with his own [Hermes Agent](https://hermes-agent.nousresearch.com/docs)
profile, separate from your main one, so his memory, persona and tools stay his.

| File | Goes to | What it is |
|---|---|---|
| `persona.md` | `~/.omo-hermes/SOUL.md` | Who Omo is and how he speaks and acts |
| `skills/omo-body/SKILL.md` | `~/.omo-hermes/skills/omo-body/` | Request-to-tool map, recipes, recovery rules |
| `config.example.yaml` | `~/.omo-hermes/config.yaml` | Loopback API server on 8644, toolsets, the `omo-body` MCP server |

`scripts/setup-brain.sh` copies them (never overwriting) and creates a random
`API_SERVER_KEY` in `~/.omo-hermes/.env`. Then log the profile in to ChatGPT:

```bash
HERMES_HOME=~/.omo-hermes hermes auth     # provider openai-codex
HERMES_HOME=~/.omo-hermes hermes model
```

Start the voice bridge **before** this Hermes gateway (`scripts/start.sh` does
that), or Hermes registers `omo-body` with 0 tools. After you add body tools,
restart the gateway: Hermes caches the MCP tool list.
