---
summary: "which kind of app flow is, and who counts as able to reach a hole; secops reads it first"
---

# Security profile

**Kind: local tool.** flow runs on its owner's machine, for the owner and their agent sessions. This is the page `secops` reads first, to rate who can reach a hole.

- flow runs as the hooks of a harness, Claude Code or Codex, and as a git hook, under its user's own login.
- It opens no port and serves nothing.
- `flow facts` sends each prompt a person typed, and the end of the agent's message before it, to Jev at `https://api.typesafe.ai/v1/systemone`, with the key `TYPESAFE_API_KEY`. `--no-prompts` sends nothing.
- A project installs it from GitHub, at a tag that holds the built files, and every install runs locally. It is not published to npm.
- The hooks run `node_modules/@jawache/flow/dist/flow.mjs` from the session's project folder. That built file is part of what the guard trusts.
