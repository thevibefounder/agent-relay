---
name: connect-app
description: Connect, reconnect or create an app project for a Grok manager using Agent Relay project and agent identities. Use for explicit project requests such as "connect to the Pixels project"; not for opening an application or connecting an account.
---

# Connect an app project

This is an optional Grok-manager workflow. Relay's ordinary Codex-to-Claude setup does not depend on it. Read [the manager instructions](references/manager-instructions.md) when attaching or preparing a project manager.

## Establish access and scope

Use an explicit project request. For an ambiguous "connect to X", clarify whether X is a source project before setup. Do not interpret "open Slack" as project creation.

The host must have access to the intended local computer and Relay's stdio MCP tools. A cloud bot does not gain computer access by reading this file. A local Grok MCP connection launches the bundled `router/dist/server.mjs` with `--host grok`; do not change the Codex host's `--host codex` connection. Use the installed host's actual tools and schema, rather than inventing bot-creation or computer-access APIs.

Check existing project/manager records first. Resolve the repository's canonical folder and reuse its existing project and manager identities. A display name, bot ID, CLI provider, tmux session and Relay `agent_id` are different things. Do not create duplicate managers for the same folder.

For an existing app, discover without changing tracked files or switching branches. For a requested new app, establish the parent folder and goal first; do not guess a default parent or generate product code as the manager. Include any folder/repository initialization in the setup scope, with Codex owning product scaffolding.

## Connect to Relay

Call `list_available_agents`. Match the canonical folder to one configured `project_id`, then select its actual target identities. Configure only requested targets: Claude for review, and Codex if delegation to a separate Codex CLI is needed. Grok is the caller; it does not need a Relay Grok target identity merely to coordinate other agents.

If configuration is missing, read the packaged Relay setup skill at `plugins/agent-relay/skills/setup/SKILL.md` from the repository root. Present the concrete setup: folder, project ID, target identities, effective permissions, host connection and any manager creation. Proceed within existing authorization and ask only for uncovered actions. Keep all identities read-only initially; Claude is permanently read-only. Preserve unrelated projects, identities and host settings when editing policy. Never silently replace a policy or reuse a legacy bridge connection with Relay's different schema.

Reuse a dedicated manager when present. Create one only when the setup authorization covers it and the actual host provides that capability. Otherwise use the existing manager or explain the manual step. Bot creation is not a Relay feature.

Store canonical path, transport `agent-relay`, `project_id`, selected target `agent_id` values, manager/bot ID when applicable, and connection status in the manager's existing private state. Do not commit local configuration, invent a new registry dependency or reinterpret legacy tmux/task fields as Relay identities.

## Verify and report

First verify computer access, the exact project mapping and target availability read-only. Before using a new Grok manager profile for write-capable automation, prove it on a disposable project: real Grok-host delegation, a bounded Claude read, same-project continuation, wrong-project/session rejection, write refusal, and timeout/cancellation. Existing Codex-host proof does not establish Grok-host or bot access. Do not enable writes merely to finish setup.

Report the folder, Relay project/target identities, manager reused or created, effective permissions, checks performed and remaining blockers. A saved workflow is not a connected bot; discovered executables are not proof of valid login. Keep setup files in their actual environment and provider session records private.

Read existing task state on reconnect. Start unrelated work without a `session_id`; continue a provider conversation only with its returned, bound ID and a new prompt. Relay calls finish or fail within 15–55 seconds: there is no task polling, DONE-file protocol, tmux requirement or automatic background continuation. Do not substitute the legacy bridge's task IDs or switch transports silently.
