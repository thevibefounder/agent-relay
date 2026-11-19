# Agent Relay contributor instructions

Read `README.md` and the latest entry in `docs/AGENT_SESSIONS.md` before changing the project. When this repository is nested inside a larger workspace, follow that workspace's inherited instructions too.

Safety invariants:

- Keep the transport local stdio. Do not add public listeners or tunnels.
- Require exact authorized project roots. Never fall back to a home directory.
- Keep the legacy Claude tool read-only. Project-bound jobs can use Claude's native edit mode.
- Enable edits only for an explicitly authorized project and an explicit edit request.
- Do not commit credentials, personal paths, generated `node_modules`, or local configuration.
- Preserve loop prevention, timeouts, and output limits.

Before committing, run `npm test` from `plugins/agent-relay/router` and `node plugins/agent-relay/scripts/validate-package.mjs`. When `gitleaks` is installed, also run `gitleaks detect --source . --no-git --redact --no-banner`. Append a concise session entry to `docs/AGENT_SESSIONS.md`. Commit with the active agent handle.
