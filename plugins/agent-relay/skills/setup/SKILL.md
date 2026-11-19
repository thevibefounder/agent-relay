---
name: setup
description: Configure Agent Relay after installation by creating project-bound agent identities, detecting supported agent CLIs, and keeping edits disabled unless the user explicitly opts in.
---

# Set up Agent Relay

Use this onboarding skill when Agent Relay is first installed or when the user asks to change its local authorization.

For a new Claude–Codex connection, follow the repository README's Quick start.
Configure the authorized folder with `--workspace`, add `--allow-edits` if the
user requests coding, then register both CLIs with `--project workspace`.
Use a separate policy file if the user already has a Relay configuration.
The instructions below apply to legacy marketplace registrations.

1. Confirm Node.js 20 or newer is available.
2. Detect `claude`, `codex`, `grok`, and `muse` on `PATH`. Report which are present without asking for credentials.
3. Ask the user which exact project folder or folders Agent Relay may access. Assign each one a stable lowercase project ID. Never authorize a home directory, filesystem root, an ancestor of home, or a folder containing Agent Relay policy data. The setup script enforces these exclusions.
4. Start with only the requested target identities. For the default Codex-to-Claude workflow, create one `claude-reviewer` identity targeting Claude with role reviewer. Codex owns implementation in the current chat; no Grok manager, separate builder bot, tmux session or project registry is required. Grok and Muse are optional.
5. Keep every identity read-only by default. The legacy Claude tool is read-only. Enable writes for other legacy targets only when the user explicitly approves that identity for that project.
6. Locate `scripts/configure.mjs` inside this plugin. Use one `--project id=/absolute/path` per project and one `--agent project:agent:target:role:read|write` per identity. Example:

   ```bash
   node scripts/configure.mjs \
     --project worktrace=/absolute/path/to/WorkTrace \
     --agent worktrace:claude-reviewer:claude:reviewer:read
   ```

7. For an existing version 1 policy, explain that migration intentionally resets every identity to read-only, then run `node scripts/configure.mjs --migrate-v1`. Review the generated identities before enabling any writes. The script preserves a mode-600 version 1 backup.
8. Replacing an existing version 2 policy requires `--force`. Read and preserve the existing projects first, show the complete replacement to the user, and use `--force` only after they approve it.
9. Call `list_available_agents`. Confirm the configuration is ready and show every project identity, provider target, role, and write status.

Never put API keys or tokens in the Agent Relay config. Provider CLIs manage their own authentication.

Explain that project roots are working-directory and write boundaries, not a universal read sandbox for every provider CLI. Claude has a Read/Glob/Grep tool allowlist with plan mode, no prompts, strict MCP, safe mode and user-only settings. Do not add --restricted: it breaks authentication on affected installations. User-level read allow rules and additional directories remain in effect. Read-only does not promise confinement of reads to the selected project. Users still should not delegate secrets. Explain that calls are bounded consultations (15–55 seconds), and a returned provider session ID continues a conversation rather than polling a background job.
