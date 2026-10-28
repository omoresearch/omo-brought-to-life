# Contributing

Issues and PRs are welcome, especially new body skills, an OpenAI Realtime API
key path, in-game push-to-talk, and macOS or Windows test reports.

- **Run the tests**: `npm test`. All suites must pass. They need no game, no
  network and no login.
- **New body tools**: add them to `BODY_TOOLS` in `body/body.mjs`, add a row to
  the abilities table in `README.md` (a test checks the two match), and teach
  Hermes when to use them in `brain/skills/omo-body/SKILL.md`.
- **Long actions** must run through `Body.runJob` so movement can cancel them
  and a fight can pause them. Return a short sentence Omo can say out loud.
- **Test the body on a scratch server first**, not your real world: a vanilla
  26.2 server in offline mode on a spare port, with the bot opped. Body tools
  dig, place and craft for real.
- **Voice changes**: keep answers going to the newest delegation (see
  `LiveCall._deliver`) and keep the bridge bound to 127.0.0.1.
- **Mindcraft updates**: copy the files from upstream again and re-apply the
  edits listed in `body/mindcraft/README.md`.
- **Never commit** logs, recordings, `.env`, `auth.json` or tokens. The hygiene
  test catches the common ones; please do not rely on it alone.

Keep it local-first and loopback-only.
