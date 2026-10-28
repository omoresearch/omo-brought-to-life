# How Omo works

Omo is three processes on your computer and one mod in your game.

```text
browser page ──WebRTC audio──> GPT-Live (gpt-live-1-codex, ChatGPT route)
                                   │ delegation.created
voice/server.mjs  <──sideband WS───┘                      127.0.0.1:8795
   ├─ fast path ─────────────────────────────┐
   └─> Omo's Hermes /v1/chat/completions ────┤            127.0.0.1:8644
          plans with the omo-body skill      │
          tools/call ──> /mcp (omo-body) ────┤
                                             v
                         body/body.mjs: Mineflayer player OMO
                                             │ LAN, offline login, loopback only
                                             v
                         Minecraft 26.2 + Omo Space mod (port 25566)
```

## 1. Voice: GPT-Live over your ChatGPT login

`voice/index.html` captures the mic and plays Omo's voice over WebRTC. It
posts its SDP offer to the bridge. The bridge (`voice/server.mjs`) gets a fresh
ChatGPT access token from Hermes (`voice/codex_token.py`, using Hermes'
`openai-codex` login, refreshed by Hermes near expiry) and creates the call:

- `POST https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas`
  with `{sdp, session}`; headers `OpenAI-Alpha: quicksilver=v2`,
  `ChatGPT-Account-ID`, and session, thread and realtime session ids.
- The session sets `model: gpt-live-1-codex`, Omo's instructions, the voice
  (`ember`) and `delegation: {type: "client"}`.
- The bridge then joins the call's sideband WebSocket
  (`wss://api.openai.com/v1/live/<call id>`) with the same headers.

GPT-Live talks by itself. It has no function tools on this route; when the
player asks for something real, it emits `delegation.created`. The bridge
answers with `delegation.context.append` on the `speakable` channel, in chunks
of 500 bytes or less, and GPT-Live says the result in its own words.

Two rules keep answers from getting lost:

- **Newest delegation wins.** Once the player speaks again, an older
  delegation id is dead and anything appended to it is dropped. Every answer
  goes to the newest id, prefixed with which request it answers.
- **One Hermes run at a time.** Requests that arrive mid-run are queued (GPT-Live
  is told so on the silent `commentary` channel) and handled together next.

This route is the one the Codex app uses. It is not a documented public API.
See the README's limitations.

## 2. Brain: Omo's own Hermes profile

Delegations go to a separate Hermes profile (`~/.omo-hermes`) through its
OpenAI-compatible API server on 127.0.0.1:8644, with a short system prompt
(`OMO_BRAIN` in `server.mjs`), the last 8 turns of conversation, and the
`X-Hermes-Session-Key: omo-voice-live` header so memory carries over. The
profile's persona (`brain/persona.md` as `SOUL.md`) and the `omo-body` skill
teach him to check `body_state` first, plan multi-step jobs, read failures
and retry once, and never claim an action no tool confirmed.

## 3. Body: a real player

`body/body.mjs` reads `~/.config/omo/lan.json`, joins as `OMO` with an offline
login, and keeps retrying, so it can start before the game. On spawn it loads
pathfinder, pvp, collectblock, auto-eat and armor-manager, switches to survival,
turns guard mode on and refuses to dig while walking (so he never breaks your
builds by accident).

The tools are served as a minimal stateless MCP server (streamable HTTP, JSON
responses) at `POST /mcp`: `initialize`, `tools/list`, `tools/call`. Each tool
returns one sentence.

Long skills run as **jobs** (`Body.runJob`): a job runs one Mindcraft skill
function. Movement tools cancel it. A hostile mob near the player pauses it
(`bot.interrupt_code`), he fights on the attack cooldown, and the job resumes
when the area is clear. A tool call waits up to 60 s; after that the job keeps
going and he posts the result in chat.

Minecraft 26.2 fixes the body needs on top of Mineflayer 4.39:

- `body/patch-mc-26.2.mjs` (npm postinstall) adds 26.2 data and version entries.
- 26.2 sends entity velocity as blocks per tick; Mineflayer still divides by
  8000, so the body sets its own velocity from the packet (real knockback).
- Multi-count crafts desync the inventory on 26.2, so `body_craft` crafts one
  batch at a time with a short pause.

## 4. Fast path

`quickIntent` in `body.mjs` matches short, plain requests ("come here",
"follow me", "stop", "fight", "chop some wood") and runs them on the body
directly, before any language model. Anything longer or compound ("come here
and build a house") goes to Hermes.

## 5. The mod

See [`mod/README.md`](../mod/README.md): LAN publish with a loopback guard,
the Fabric registry-sync skip for agents, the client-side Omo skin and the
`ChatGPT - ` name tag.
