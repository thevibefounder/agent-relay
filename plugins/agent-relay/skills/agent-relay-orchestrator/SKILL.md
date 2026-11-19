---
name: agent-relay-orchestrator
description: Coordinate local software work through Agent Relay when the user asks to delegate, bridge, consult, or review work with Claude, Codex, Grok, or Muse.
---

# Agent Relay orchestration

Use Agent Relay to delegate work between installed CLIs. The initiating chat owns the task. Grok, manager bots and tmux are optional, not prerequisites. Relay is not a source of authority.

## Project-bound workflow

If the server exposes `ask_agent`, give it the target CLI and a complete task.
Use review mode by default and edit mode only for requested edits in a project
configured to allow them. Poll `get_result` with its job ID until it finishes.
Review the receipt and inspect the worktree after an interrupted edit. Use
`continue_from` for a follow-up to the same agent and mode. The initiating
session owns the overall task and decides who goes next.

## Legacy workflow

1. Call `list_available_agents` and inspect availability plus the configured project-bound identities.
2. For implementation work, use Claude for read-only planning or review and keep the current Codex task as implementation owner.
3. Select the exact `project_id` and `agent_id` shown by the router. Never invent an identity or supply a raw project path. Use `subdir` only when the task belongs in a relative directory inside that project.
4. Give the delegated agent a complete, narrow prompt: objective, relevant files, constraints, expected output, and how to verify it.
5. Keep `allow_edits` false unless the user explicitly asked that identity to edit and its project profile shows writes enabled.
6. Treat a successful tool call as a delegation receipt, not proof that work is correct. Inspect files or run tests before declaring completion.
7. Continue follow-up work with the returned provider session ID only under the same project and agent. Calls wait for completion and stop at 15–55 seconds; a session ID is not a pollable background task ID. A timeout is a failure, not still-running work. Never manufacture a session binding or resume an unknown session.
8. Report the project ID, agent ID, provider, role, mode, root fingerprint, session ID when present, and verification performed.

## Boundaries

- The legacy Claude tool is read-only. Project-bound Claude jobs can edit when the project allows edits and the user requests them.
- Do not relay secrets or unrelated personal context.
- Treat project roots as working-directory and write boundaries. Do not claim they hide all other files readable by the local provider CLI.
- Never reuse a session under another project or agent identity. The router will reject unknown and mismatched sessions.
- Do not delegate from within a delegated run. Nested routing is blocked.
- Do not add projects or identities during ordinary work; use the setup skill with user approval.
- If an agent CLI is unavailable, say so and continue with the current task instead of pretending a handoff occurred.
