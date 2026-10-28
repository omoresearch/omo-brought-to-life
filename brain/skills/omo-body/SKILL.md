---
name: omo-body
description: "Use when moving, gathering, crafting or fighting as Omo in Minecraft. Maps player requests to the omo-body MCP tools, with recipes and recovery."
version: 0.1.0
metadata:
  hermes:
    tags: [minecraft, mineflayer, omo, voice]
---

# Omo's body (omo-body MCP tools)

You control one Mineflayer player named `OMO` in the player's single-player
world. Every tool returns one short fact you can speak.

## Map the request to a tool

| The player says | Call |
|---|---|
| "where are you", "what have you got", "how are you doing" | `body_state` |
| "come here" | `body_come_to` (teleports with `/tp` if the player is out of sight) |
| "follow me" / "stop" / "stay" | `body_follow` / `body_stop` |
| "go to 120 64 -30" | `body_go_to` |
| "look at me" | `body_look_at` |
| "protect me", "guard me" | `body_guard {on:true}`; "stop guarding" is `{on:false}` |
| "kill that zombie", "help me fight" | `body_attack` |
| "chop some wood", "mine 10 stone", "get iron" | `body_collect` (`block: "wood"` picks the nearest log type) |
| "make a pickaxe", "craft torches" | `body_craft` (count = how many he should end up with) |
| "cook the beef", "smelt the iron" | `body_smelt` (needs fuel) |
| "put a torch here" | `body_place` |
| "give me the logs" | `body_give` |
| "hunt a cow" | `body_hunt` |
| "go to the chest", "find water" | `body_go_to_block` |
| "hold your sword", "wear the armour" | `body_equip` |
| "eat something" | `body_eat` |
| "pick that up" | `body_pickup` |
| "put the cobble away", "grab the iron from the chest" | `body_chest {action, item, count}` |
| "go to bed" | `body_sleep` |
| "what can you make" | `body_craftable` |
| "write the coordinates in chat" | `body_chat` |

## Recipes (plan them yourself)

- Wooden pickaxe: `body_collect wood 3`, `body_craft <wood>_planks`,
  `body_craft stick`, `body_craft crafting_table`, `body_craft wooden_pickaxe`.
  Use the plank type that matches the log he collected.
- Stone tools: mine `stone` with a pickaxe (it drops cobblestone), then craft.
- Iron: mine `iron` (raw_iron), `body_smelt raw_iron` with coal or planks as
  fuel, then craft.

## Recovery

- A failed craft lists the missing ingredients. Gather them, then retry once.
- "Still working on ..." means the job runs in the background. Tell the player
  you are on it; he posts in chat when it finishes. Do not start a new job.
- A monster pauses a job. He fights, then carries on by himself.
- Movement (`body_come_to`, `body_follow`, `body_stop`, `body_go_to`) cancels
  the current job.
- In creative mode, digging drops nothing. On spawn he switches himself to
  survival (LAN cheats on) unless `OMO_BODY_GAMEMODE=keep`.
