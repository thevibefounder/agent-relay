# Agent Relay

Ask another coding agent for help without leaving your current one. Agent Relay is a local Codex plugin that delegates to installed coding-agent CLIs and returns structured completion receipts.

Claude and Codex can ask each other to review or edit one connected project. The agent you started with owns the task and receives the result.

## Quick start

**New here? Follow the [step-by-step install guide](docs/WORKSHOP.md).** It covers
Node, CLI sign-in, a practice project, both registrations and your first review.

Download [AgentRelay v0.3.0](https://github.com/thevibefounder/agent-relay/releases/tag/v0.3.0).
**Use the corrected `INSTALL-v0.3.0.md` guide attached to the release**; the
original ZIP contains an older Claude registration example. The guide on this
main branch includes the correction too.
The release includes the bundled router and needs no consumer npm dependencies.
Use your own Claude and Codex logins. Bedrock and Grok are optional.

Already have Node 20+, Claude Code and Codex CLI? From this extracted checkout:

```sh
RELAY_DIR="$PWD"
RELAY_POLICY="$HOME/.agent-relay/my-project.json"
node plugins/agent-relay/scripts/configure.mjs \
  --config "$RELAY_POLICY" --workspace /absolute/path/to/project \
  --claude "$(command -v claude)" --codex "$(command -v codex)"

codex mcp add agent-relay \
  --env "AGENT_RELAY_CONFIG=$RELAY_POLICY" \
  -- "$(command -v node)" "$RELAY_DIR/plugins/agent-relay/router/dist/server.mjs" \
  --host codex --project workspace

cd /absolute/path/to/project
claude mcp add --scope local agent-relay \
  -e "AGENT_RELAY_CONFIG=$RELAY_POLICY" -- "$(command -v node)" \
  "$RELAY_DIR/plugins/agent-relay/router/dist/server.mjs" \
  --host claude --project workspace
```

Use an unused policy filename; setup refuses to overwrite an existing policy.
Restart the CLIs. Ask either agent to use Relay to ask the other for a review,
wait with `get_result`, and show the completed answer. Setup is read-only by
default. Add `--allow-edits` during setup only for a project where you want to
explicitly request coding tasks.

Relay starts each installed CLI with its existing model and provider settings.
For a Codex provider launcher, pass `--codex /absolute/path/to/your-launcher`.
Keep credentials in your provider setup, outside this repository and Relay policy.

## How a handoff works

- `ask_agent` takes an agent, a task and `review` or `edit` mode. Relay supplies
  the configured project folder and the same short scope instruction each time.
- The call returns a job ID immediately. `get_result` can wait up to 30 seconds
  per call, while the job can run for up to 30 minutes. Keep the initiating CLI
  connected until the job finishes. Jobs and receipts live in that connection.
- Use `continue_from` with a completed job ID to resume the same agent in the
  same mode. The initiating agent reads results and decides who goes next.
- Relay permits one delegated writer per checkout. Edit results include Git
  status and diff stats before and after the job, plus the agent's answer.
  Cancellation and failure can leave edits in place. Inspect the checkout
  before starting another job. If Relay is killed abruptly, a writer lock may
  remain in the temp directory. Verify the job and its child processes have
  stopped before removing the lock path shown in the error.

Review mode uses each CLI's read-only tools. Edit mode uses Codex workspace
write or Claude's accept-edits mode with its sandbox. Shell commands that
require approval can be denied in headless sessions. The project is a working
directory and write scope, and read access still depends on the CLI.
Run provider code only in projects you trust. The CLI's provider handles
model requests and billing.

Existing registrations without `--project` still expose the legacy
`delegate_to_*` tools with their original time limits and policy checks.
Version 1 policies still require `--migrate-v1`.

## Optional workflows

The optional [`connect-app` workflow](integrations/grok/connect-app/SKILL.md) connects app projects to a Grok manager using Relay identities. Keep it in this repository so Grok can read it; it is not installed by the default Codex plugin and does not create a bot or grant computer access.

To add Grok to the project tools, include `--with-grok` when creating the policy and starting the server. Grok can also use those tools with `--host grok`. Additional provider CLIs and identities are optional. A manager's bot creation, registry, approval workflow and terminal UI sit above Relay; they are not part of its core setup. The separate legacy visible bridge has its own asynchronous task IDs and tmux contract. Do not pass those IDs to Relay or silently fall back between the two transports.

## Develop and verify

```bash
cd plugins/agent-relay/router
npm ci
npm test
cd ../../..
node plugins/agent-relay/scripts/validate-package.mjs
```

`npm test` includes a build and hermetic source/bundle tests; it makes no paid model calls. The distributable `router/dist/server.mjs` is committed and needs no consumer npm dependencies.

Opt-in real-provider proof (uses your Claude login and API usage):

```bash
cd plugins/agent-relay/router
npm run live-test -- --claude /absolute/path/to/claude --output /private/path/proof.json
```

It uses a disposable Git project and temporary policy to verify a real read, session continuation, wrong-project rejection and write refusal through `--host codex`. It does not require Grok, tmux or a bot and does not replace user policy. The disposable project/policy are removed; Claude retains its session history in its normal local storage.

## License

You may download, install, run and locally adapt this release for your own
projects under the [distribution and use notice](LICENSE). A broader open-source
license has not been selected. Bundled dependencies retain their own licenses;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). This public release is a
clean source snapshot of v0.3.0, with no private repository history or local settings.
