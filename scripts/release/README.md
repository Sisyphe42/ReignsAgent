# ReignsAgent Distribution

This archive contains ReignsAgent, its local API, player preview, and the deployable player builder.

## Requirements

- Node.js 22 or newer
- A modern web browser

## Start Creator

- Windows: double-click `start.cmd`, or run `node start.mjs`.
- macOS/Linux: run `sh start.sh`, or run `node start.mjs`.
- Pass `--no-open` to prevent the launcher from opening a browser automatically.
- Set `HOST` or `PORT` to override the default `127.0.0.1:4321` listener.

Creator configuration and projects persist under `ReignsAgentData` beside this archive. Set `REIGNS_AGENT_DATA_ROOT` to use another directory. Stop the server with `Ctrl+C`.

`config.toml` stores global theme and AI endpoint settings. Project content lives below `projects/<project-id>/`; use the Creator project controls to create, clone the sample, open, or delete projects. API keys are plaintext local configuration, masked by the UI, and never copied into player builds.

## Build a Player Site

```sh
node scripts/build-game.mjs fixtures/content/oss-court.cards.json output/player
```

The output contains `player.html`, `player-runtime.js`, a `*.game.json` bundle, and required static assets. It contains no Creator UI, provider SDK, API key, or network AI integration.
