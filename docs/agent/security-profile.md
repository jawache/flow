---
summary: "which kind of app flow is, and who counts as able to reach a hole; secops reads it first"
---

# Security profile

**Kind: local tool.** flow runs on its owner's machine, for the owner and their agent sessions. This is the page `secops` reads first, to rate who can reach a hole.

- flow runs as the hooks of a harness, Claude Code or Codex, and as two git hooks, under its user's own login.
- It opens no port and serves nothing.
- A project installs it from GitHub, at a tag that holds the built files, and every install runs locally. It is not published to npm.
- The hooks run `node_modules/@jawache/flow/dist/flow.mjs` from the session's project folder. That built file is part of what the guard trusts.
