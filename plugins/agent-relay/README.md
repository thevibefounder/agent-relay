# Agent Relay plugin

Agent Relay connects locally installed coding CLIs over stdio. For the project-bound Claude and Codex workflow, see the [repository quickstart](../../README.md#quick-start).

The marketplace plugin also supports existing Codex configurations that use the legacy `delegate_to_*` tools. A direct registration with `--host` and `--project` exposes `ask_agent`, `get_result`, and `cancel` instead. Each CLI supplies its own login, model, and provider settings.
