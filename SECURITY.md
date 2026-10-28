# Security

Omo runs on your computer, holds a live microphone and acts with your ChatGPT
login, so everything is local and loopback-only by default.

## The model

- **The bridge listens on 127.0.0.1 only** (port 8795: the talk page, the API
  and the `omo-body` MCP endpoint). It has no auth of its own, so do not
  port-forward or reverse-proxy it. Requests from any page origin other than
  `http://127.0.0.1` or `http://localhost` are refused; `OMO_LIVE_ALLOWED_ORIGINS`
  adds origins explicitly (for example your own tailnet HTTPS URL).
- **Omo's Hermes listens on 127.0.0.1 only** (port 8644) and needs a bearer key
  (`API_SERVER_KEY`). `scripts/setup-brain.sh` generates a random one into
  `~/.omo-hermes/.env` (mode 600) and never prints it.
- **No secrets in this repo.** The ChatGPT token is never stored by Omo: the
  bridge asks Hermes for a fresh one per call through `voice/codex_token.py`
  and keeps it in memory. `test/hygiene.test.mjs` fails the build if a token,
  key or machine path appears in the tree.
- **The LAN world is loopback-only.** The mod patch publishes your single-player
  world with offline logins (a bot has no Microsoft account) but kicks any
  unauthenticated player who is not on this computer. `-Domo.agents.allowRemote=true`
  changes that; only set it on a network you trust.
- **What Hermes may do.** Omo's brain is a full Hermes agent with file and
  terminal tools. The persona tells him to use them only when you explicitly
  ask, and to confirm before sending, publishing, buying or deleting anything.
  Treat it like any agent with shell access: review `brain/config.example.yaml`
  and remove toolsets you do not want.
- **Voice is spoken, not typed.** Anyone near your microphone can talk to Omo.
  Hang up from the page when you are done.

## Reporting

Please report vulnerabilities privately to **harry@omo.space** with the subject
"Omo security", not in a public issue. Include the version, what an attacker
needs, and how to reproduce it. We aim to reply within a few days.
