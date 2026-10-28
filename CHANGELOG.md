# Changelog

## v0.1.0 (2026-10-28): First breath

The first public release of Omo as one repo: voice, brain, body and the mod
changes that let him in.

- **Voice** (`voice/`): GPT-Live (`gpt-live-1-codex`) over your ChatGPT login,
  full duplex in a local WebRTC page, voice `ember` with an old-grandad style.
  Delegations go to Omo's Hermes; answers always land on the newest delegation,
  and requests that arrive mid-job are queued and answered together.
  Transcripts are logged.
- **Body** (`body/`): a Mineflayer player `OMO` that joins your single-player
  world over LAN and serves 22 `omo-body` MCP tools (see the README). Mindcraft's
  skill library runs as jobs that movement cancels and fights pause and resume.
  Guard mode, auto-eat, armour, lava/drowning reflexes, low-health retreat, real
  knockback on 26.2, `/tp` when you are out of range, survival mode on spawn,
  one-batch-at-a-time crafting for 26.2.
- **Fast path**: "come here", "follow me", "stop", "fight" and "chop some wood"
  move him without waiting on a language model.
- **Brain** (`brain/`): persona, the `omo-body` Hermes skill and a config
  example; `scripts/setup-brain.sh` creates a separate Hermes profile.
- **Mod** (`mod/`): patches for the Omo Space mod: open single-player worlds to
  LAN for local agents (loopback-only), skip Fabric registry sync for agent
  names, the Omo skin and the `ChatGPT - ` name tag.
- **Tests**: 18 (voice 7, body 8, repo hygiene 3).
