# voice/: GPT-Live bridge

| File | What it is |
|---|---|
| `server.mjs` | The bridge on 127.0.0.1:8795: serves the talk page, creates GPT-Live calls with your ChatGPT login, joins the sideband, sends delegations to Omo's Hermes (or the body's fast path) and speaks the answers. Also mounts the body's MCP tools at `/mcp`. |
| `index.html` | The talk page: mic, speaker, live transcript and tool calls. |
| `codex_token.py` | Prints a fresh ChatGPT access token and account headers from Hermes' `openai-codex` login, as JSON on stdout. Run with Hermes' Python; the bridge calls it per call and never stores the token. |
| `server.test.mjs` | Session, headers, call ids, delegation parsing, chunked appends, Hermes requests, newest-delegation delivery and queueing. |

Run it with `npm start` from the repo root (or `scripts/start.sh`, which also
starts Omo's Hermes). Endpoints: `GET /` page, `GET /events` (server-sent
events for the page), `POST /offer` (SDP), `POST /hangup`, `POST /mcp`,
`GET /health`.

The ChatGPT route needs `HERMES_HOME` pointing at a Hermes home that is logged
in with `openai-codex`, and a plan with GPT-Live access. An OpenAI API key path
is not implemented yet. Details: [docs/how-it-works.md](../docs/how-it-works.md).
