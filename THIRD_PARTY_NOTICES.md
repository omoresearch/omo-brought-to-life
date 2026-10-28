# Third-party notices

Omo, brought to life's own code (`voice/`, `body/*.mjs`, `brain/`, `mod/`,
`scripts/`, `test/`) is MIT licensed (see [LICENSE](LICENSE)). It builds on the
following work. Thank you.

| Component | By | Licence | How it is used |
|---|---|---|---|
| [Mindcraft](https://github.com/mindcraft-bots/mindcraft) skill library (`skills.js`, `world.js`, `mcdata.js`) | Kolby Nottingham and contributors | MIT | **Vendored** in `body/mindcraft/` from commit e1c1fc3 with small import and shim changes. Licence text in [`body/mindcraft/LICENSE`](body/mindcraft/LICENSE). |
| [Mineflayer](https://github.com/PrismarineJS/mineflayer), minecraft-protocol, prismarine-* | PrismarineJS | MIT | npm dependencies; Omo's body. Not bundled. |
| [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder), [-pvp](https://github.com/PrismarineJS/mineflayer-pvp), [-collectblock](https://github.com/PrismarineJS/mineflayer-collectblock), [-auto-eat](https://github.com/linkle69/mineflayer-auto-eat), [-armor-manager](https://github.com/PrismarineJS/MineflayerArmorManager) | Their authors | MIT | npm dependencies. Not bundled. |
| [minecraft-data](https://github.com/PrismarineJS/minecraft-data) 26.2 data ([Cyverno/minecraft-data](https://github.com/Cyverno/minecraft-data), upstream PR #1339) | PrismarineJS and contributors | MIT | Downloaded at a pinned commit by `body/patch-mc-26.2.mjs` during `npm install`. Not bundled. |
| [ws](https://github.com/websockets/ws) | Its authors | MIT | npm dependency (GPT-Live sideband). |
| [OpenClaw](https://github.com/openclaw/openclaw) | OpenClaw contributors | MIT | Reference only: the GPT-Live (ChatGPT route) wire contract in `voice/server.mjs` follows its `realtime-quicksilver` implementation. No code copied. |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Nous Research | MIT | Omo's brain; installed separately. `voice/codex_token.py` imports Hermes' own auth helpers to read your ChatGPT login. |
| [Omo Space](https://github.com/omoresearch/omo-space) mod | Omo Research | MIT | `mod/` holds patches against it and copies of the changed files. |
| [Fabric Loader / Fabric API](https://fabricmc.net) | FabricMC | Apache-2.0 | The Omo Space mod's platform; not bundled. |
| Omo skin (`mod/src/resources/assets/omolife/textures/entity/omo.png`) | Omo Research | MIT | Original texture. |

GPT-Live and ChatGPT are services of OpenAI, used with your own account under
OpenAI's terms. This project is not affiliated with or endorsed by OpenAI, Nous
Research, PrismarineJS or the Mindcraft authors.

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR
MICROSOFT. Minecraft is a trademark of Mojang/Microsoft.
