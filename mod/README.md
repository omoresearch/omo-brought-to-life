# mod/: letting Omo into your world

Omo's body is an ordinary Minecraft client (Mineflayer). Your single-player
world is not open to anyone, and a Fabric world normally refuses plain clients.
Four small commits to the [Omo Space](https://github.com/omoresearch/omo-space)
mod fix that, for local agents only. They are merged upstream and ship in
[Omo Space v1.2.0](https://github.com/omoresearch/omo-space/releases/tag/v1.2.0),
so you don't need to apply anything. The `git format-patch` files and copies of
the changed sources are kept here for reading.

| Patch | What it does |
|---|---|
| `0001` open single-player worlds to LAN for local AI agents | When your world opens, publish it to LAN on port 25566 (`-Domo.agents.port`) with offline logins, write `~/.config/omo/lan.json` for the bridge, and kick any unauthenticated player who is not on this computer. |
| `0002` publish to LAN after the host joins | Publishing signs with the host player's key, so it waits for your client to join and runs on the client thread, like the "Open to LAN" screen. |
| `0003` skip Fabric registry sync for agents | Fabric kicks plain clients from modded worlds ("requires Fabric Loader and Fabric API"). `AgentRegistrySyncMixin` skips that check, only for agent usernames and only while offline auth is on. |
| `0004` Omo skin and `ChatGPT - ` name tag | A scoreboard team puts `ChatGPT - ` (aqua) before agent names over their heads, in the tab list and in chat. `AgentSkinMixin` paints `omo.png` on agent players on your client. |

Agent usernames come from `-Domo.agents.names` (default `omo,teacher`).
`-Domo.agents.lan=false` turns the whole feature off, and
`-Domo.agents.allowRemote=true` admits unauthenticated players from your
network too (off by default; see [SECURITY.md](../SECURITY.md)).

## Apply (only for an older Omo Space checkout)

Omo Space v1.2.0 and newer already include these commits. For an older tree:

```bash
git clone https://github.com/omoresearch/omo-space && cd omo-space
git am /path/to/omo-brought-to-life/mod/patches/*.patch
```

The patches were cut from omo-space `33849af` and apply cleanly with `git am`
on its current `main` (checked against `91f58d5`). Build and install the mod as
its README describes, then restart the game: mixins only load at startup.

## Files

```text
patches/0001..0004-*.patch                                  the commits
src/java/space/omo/life/client/AgentLan.java                LAN publish, loopback guard, agent names, team prefix
src/java/space/omo/life/mixin/AgentRegistrySyncMixin.java   registry-sync skip for agents
src/java/space/omo/life/mixin/AgentSkinMixin.java           client-side Omo skin
src/resources/assets/omolife/textures/entity/omo.png        the skin (64x64)
src/resources/omolife.mixins.json                           mixin list after the patches
```
