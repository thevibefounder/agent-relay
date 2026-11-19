# Agent Relay

Ask another coding agent for help without leaving your current one. Agent Relay is a local Codex plugin that delegates to installed coding-agent CLIs and returns structured completion receipts.

Claude and Codex can ask each other to review or edit one connected project. The agent you started with owns the task and receives the result.

## Quick start

On a Mac, open Terminal and paste this **one command**:

```sh
curl -fsSL https://github.com/thevibefounder/agent-relay/releases/download/v0.3.0/install.sh | bash
```

The Mac installer adds Node.js 24 LTS, Claude Code and Codex if they are missing,
then opens their official sign-in flows when needed. No Homebrew or administrator
password is required. Existing working tools and provider settings are reused.
Sign in with your own accounts; Relay does not supply model access or credits.

The installer downloads and checksum-verifies v0.3.0, creates
`~/AgentRelay-Workshop`, and connects both CLIs to that practice project in
read-only mode. It prints the folder, immediate launch command and first prompt. Existing CLI
sessions need a restart; new Terminal windows pick up the installed tools. Each CLI
keeps its existing login, model and provider settings. Bedrock and Grok are
optional. No model calls or npm installs happen during setup. Sign-in stays with the official CLIs.

For an existing project, use:

```sh
curl -fsSL https://github.com/thevibefounder/agent-relay/releases/download/v0.3.0/install.sh | bash -s -- --project "/absolute/path/to/project" --name agent-relay-project
```

Add `--allow-edits` only if you want to explicitly request coding tasks in that
project. For a Codex provider launcher, add `--codex /absolute/path/to/launcher`.
Existing connections and differing policies are preserved; use a different
`--name` when connecting a different project. Rerunning the same install reuses
matching files and connections.

[Download the ZIP](https://github.com/thevibefounder/agent-relay/releases/tag/v0.3.0)
or read [setup details](docs/WORKSHOP.md). The one-command installer handles both
registrations, including the Claude command correction; no separate corrected
guide is needed.

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
