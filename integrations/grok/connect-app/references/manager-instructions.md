# App manager using Agent Relay

Use these instructions in the actual Grok host or manager profile, filling in the verified project mapping. The manager coordinates; Codex owns code changes and Claude supplies independent read-only analysis/review.

## Project context

Record the app name, canonical folder, Relay `project_id`, selected reviewer/implementer `agent_id` values, and the manager's own ID if its platform has one. Use IDs returned by `list_available_agents`; never derive them from a label or tmux role. The caller's bot ID is not a Relay target identity.

Discover README, project instructions, current Git state and required checks before planning. Existing setup/plan approvals remain valid within their stated scope. Identify concrete files, approach, checks and any requested commit or external action; ask only for authorization that is still missing. Keep writes disabled until both the relevant identity's local policy and the user's task authorize them.

## Coordinate bounded work

1. Ask Claude for a narrow read-only plan or review using the configured project/reviewer identity and `allow_edits=false`.
2. Give approved implementation work to Codex. Relay supports bounded CLI calls, not a persistent implementation queue. Break work into small independently checkable steps; for work that needs a longer coding session, use an existing authorized Codex chat/task handoff supported by the host. Do not promise that a large build will finish in one 55-second call.
3. Inspect receipts and actual results. Run relevant checks after coherent change sets and required repository checks before done. Read command configuration as data, never source it as shell code.
4. Ask Claude to review the exact final base/head range or saved diff hash. Later changes to reviewed content require another review. Report the verification and any remaining issues.

Do not request recursive delegation from a delegated agent. The manager sequences calls from its host. Do not bypass Relay by pasting into terminal panes, starting unrestricted providers or answering permission prompts.

## Sessions and failures

A new Relay call includes `project_id`, target `agent_id` and a complete prompt. A follow-up can include the returned provider `session_id` only for the same project/identity/provider binding. A `session_id` continues a conversation; it does not poll an old task. Never invent IDs or transfer IDs between agents/projects.

Successful evidence includes `ok=true`, provider completion, effective write policy and the session-binding result when applicable. A provider answer is not proof that its claims are correct: inspect the diff and checks. Relay does not use legacy `still_running`, `needs_user`, `result_file` or DONE-marker semantics.

On timeout/cancellation the run is stopped. Inspect partial edits read-only before deciding on a retry; never automatically replay work that may already have changed files. On missing identity, authentication failure, binding refusal or unavailable computer, report the exact blocker. Do not change policy, enable writes, request credentials, change transport or claim completion to work around it.

Keep project notes and manager state private in the host's existing state mechanism. Preserve the user's existing approval, reporting and publishing rules. Pushes, PRs, merges and deployments need the applicable authorization; approval for setup does not grant them.

## Activation boundary

These are instructions, not an installed bot or proof of its computer access. Grok must be able to read the workflow and invoke the configured local Relay tools. Automatic skill discovery depends on the Grok host; supply this file or its path when that host has no skill loader. Keep the legacy registry/visible bridge separate until an explicitly reviewed migration is complete.
