# Install AgentRelay 0.3.0

AgentRelay lets Claude Code and Codex ask each other for a review or a coding
task in one project. Each CLI uses your own account and provider settings.
Bedrock is optional. Grok is optional.

These steps use Terminal on a Mac. Linux users can use the same shell commands.
On Windows, use a WSL terminal with Node, Claude Code and Codex installed inside
WSL; native PowerShell installation is not covered by this release guide.
The release install was tested on macOS; Linux and WSL are not yet verified.

## 1. Install the prerequisites

1. Install the current **LTS** release from [Node.js](https://nodejs.org/en/download).
   The router requires Node 20 or later; choose a currently supported LTS.
2. Install [Claude Code](https://code.claude.com/docs/en/setup) and
   [Codex CLI](https://developers.openai.com/codex/cli/). The desktop apps alone
   do not guarantee that the terminal commands are installed.
3. Open **Terminal** (on a Mac, press Command-Space, type Terminal, press Return).
   Run these commands one at a time:

```sh
node --version
claude --version
codex --version
```

If any command says `command not found`, finish that tool's installation and
open a new Terminal window before continuing.

Run `claude` once, complete its sign-in, then exit. Do the same with `codex`.
Check that each can answer a short question on its own before adding Relay.
Model access and usage charges come from your own accounts.

## 2. Download the release

Open the [v0.3.0 release](https://github.com/thevibefounder/agent-relay/releases/tag/v0.3.0)
and click **agent-relay-v0.3.0.zip** under **Assets**. Double-click the ZIP in
Downloads to extract it. Keep the extracted folder in a permanent location.
You do not need a GitHub account or an npm install to run the bundled router.

In Terminal, type `cd ` (including the space), drag the extracted
`agent-relay-v0.3.0` folder from Finder into Terminal, then press Return.
Run:

```sh
RELAY_DIR="$PWD"
NODE_BIN="$(command -v node)"
CLAUDE_BIN="$(command -v claude)"
CODEX_BIN="$(command -v codex)"
RELAY_POLICY="$HOME/.agent-relay/workshop.json"
```

Keep using this Terminal window for the next steps.

## 3. Make a small practice project

Paste this block. It creates a disposable practice folder, without changing
your existing project files:

```sh
PROJECT_DIR="$(mktemp -d "$HOME/agent-relay-practice.XXXXXX")"
printf '# Practice project\nThe goal is to test a read-only agent review.\n' > "$PROJECT_DIR/README.md"
node "$RELAY_DIR/plugins/agent-relay/scripts/configure.mjs" \
  --config "$RELAY_POLICY" \
  --workspace "$PROJECT_DIR" \
  --claude "$CLAUDE_BIN" --codex "$CODEX_BIN"
```

Expected output includes `Projects: 1` and `Agent identities: 2`.
If `workshop.json` already exists, setup stops to protect it. Use a new policy
filename in `RELAY_POLICY` and rerun the configure command. Do not use `--force`
unless you intend to replace that policy.

To connect your own project instead, set `PROJECT_DIR` to that existing
folder's absolute path and create a new policy with the same configure command.
Start with a project you trust. Both CLIs receive its task and project context.

## 4. Connect both CLIs

The `--env`/`-e` setting below matters: it makes both CLIs load the same policy.
The project ID is exactly `workspace`, which the setup command just created.
Run:

```sh
codex mcp add agent-relay-workshop \
  --env "AGENT_RELAY_CONFIG=$RELAY_POLICY" \
  -- "$NODE_BIN" "$RELAY_DIR/plugins/agent-relay/router/dist/server.mjs" \
  --host codex --project workspace

cd "$PROJECT_DIR"
claude mcp add --scope local -e "AGENT_RELAY_CONFIG=$RELAY_POLICY" \
  agent-relay-workshop -- "$NODE_BIN" \
  "$RELAY_DIR/plugins/agent-relay/router/dist/server.mjs" \
  --host claude --project workspace
```

If that MCP name is already registered, inspect it with `codex mcp get
agent-relay-workshop` or `claude mcp get agent-relay-workshop`. Remove only that
registration with the matching `mcp remove agent-relay-workshop` command before
registering it again. Restart any Claude or Codex session already open.

## 5. Ask for the first review

From the practice folder, start `codex` and paste:

> Use agent-relay-workshop to ask Claude to review README.md in read-only mode.
> Wait for the job to finish with get_result and show me Claude's actual answer.
> Do not edit files.

You may need to approve the MCP tool call in the initiating CLI. A successful
result includes `status: completed`, the reviewer answer and its model.
A job ID alone means the review is still running.

To try the reverse direction, start `claude` in the same practice folder and
ask it to use `agent-relay-workshop` to ask Codex for a read-only review.
Codex needs working authentication for the reverse direction too.

## Optional: let them code

Create a separate policy for your intended project using the same configure
command with `--allow-edits` added. Register that policy in both CLIs. Then
explicitly ask for an edit, for example:

> Ask the other agent to fix the failing test in this project, wait for it to
> finish, and show me the changes and verification.

The initiating agent still owns the task. One delegated writer can run per
checkout. Keep the initiating CLI open while a job runs; jobs can take up to
30 minutes. Cancellation can leave edits to inspect. Headless provider runs
can refuse commands that require interactive approval.

## Optional: Bedrock or another provider

Configure and verify your CLI with that provider first. Relay reuses the CLI's
existing model, provider and authentication. It does not supply Bedrock access,
translate API protocols, or choose a provider for you.

For a Codex provider launcher, use `--codex /absolute/path/to/your-launcher`
in the configure command. Keep credentials in the provider's normal local
settings or secure environment. Never paste keys into the Relay policy or repo.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `Unknown connected project: workspace` | Both registrations must point to the policy created in step 3 through `AGENT_RELAY_CONFIG`; check that it contains the project ID `workspace`. |
| Claude or Codex unavailable | Run its `--version` command. Rerun setup with a new policy and the explicit `--claude` / `--codex` executable paths. |
| No Relay tools | Check `codex mcp list` or `claude mcp list`, then restart the CLI. |
| Authentication or model error | Run the target CLI directly and fix its account/provider setup first. |
| Review still running | Keep the initiating session open and have it poll `get_result`; polling does not start another review. |
| Edit denied | Use a policy created with `--allow-edits` and explicitly request edit mode. |

To disconnect the workshop, run `codex mcp remove agent-relay-workshop` and,
from the connected project, `claude mcp remove agent-relay-workshop`.
Removing Relay does not sign you out of either provider.
