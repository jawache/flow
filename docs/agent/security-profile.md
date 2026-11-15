---
summary: "which kind of app flow is, and who counts as able to reach a hole; secops reads it first"
---

# Security profile

**Kind: local tool.** flow runs on its owner's machine, for the owner and their agent sessions. This is the page `secops` reads first, to rate who can reach a hole.

- flow runs as Claude Code hooks and as a git pre-commit gate, under its user's own login.
- It opens no port and serves nothing.
- It is published to npm, and every install runs locally.
- The hooks run `node_modules/@jawache/flow/dist/flow.mjs` from the session's project folder, `$CLAUDE_PROJECT_DIR`. That built file is part of what the guard trusts.
