# Connect Claude and Codex with one command

On a Mac, open Terminal (Command-Space, type Terminal, press Return) and paste:

```sh
curl -fsSL https://github.com/thevibefounder/agent-relay/releases/download/v0.3.0/install.sh | bash
```

You need Node.js 20+ and both coding CLIs. If something is missing, setup prints
its official installation link and stops. Install it, open a new Terminal, and
run the same command again. Links: [Node LTS](https://nodejs.org/en/download),
[Claude Code](https://code.claude.com/docs/en/setup),
[Codex CLI](https://developers.openai.com/codex/cli/).

The installer checks the v0.3.0 ZIP checksum, installs the bundled router, makes
`~/AgentRelay-Workshop`, and registers both CLIs against the same read-only
project policy. It preserves other Relay connections, provider settings and
credentials. It checks both router connections without making paid model calls.

When it says **Connected Claude and Codex**, restart any CLI sessions already
open. Run the printed `cd` command, then `codex`, and paste the prompt it shows.
It asks Claude to review README.md, waits for the completed job, and shows the
answer. You may need to sign in or approve an MCP tool call in your CLI.
Use your own account; usage and model access come from that account.

For the reverse direction, run `claude` in the same folder and ask it to use
`agent-relay-workshop` to ask Codex for a review. Both CLIs need working logins
for reviews in both directions. A job ID alone means the review is still running.

## Your own project

Use an existing project folder instead of the practice project:

```sh
curl -fsSL https://github.com/thevibefounder/agent-relay/releases/download/v0.3.0/install.sh | bash -s -- --project "/absolute/path/to/project" --name agent-relay-project
```

If you want agents to code there, add `--allow-edits` to that command and
explicitly ask for an edit. Use a new connection name when connecting a different
project or changing its write policy. Keep the initiating CLI open until jobs
finish; tasks can run for up to 30 minutes. Cancelled tasks may leave edits.

For an existing provider launcher, add `--codex /absolute/path/to/launcher` or
`--claude /absolute/path/to/launcher`. Configure and verify the CLI's provider
before using Relay. Bedrock is optional. Relay does not supply provider access
or translate API protocols. Keep keys in your normal provider settings.

## If setup stops

- **Missing Node/CLI:** follow the printed official link, reopen Terminal and retry.
- **Existing connection differs:** it was preserved; use a different `--name`.
- **Existing installation differs:** inspect the reported path before replacing it.
- **Provider authentication/model error:** run that CLI directly and fix its sign-in first.
- **No Relay tools:** restart the CLI and check `codex mcp list` or `claude mcp list`.

To disconnect the practice setup, run `codex mcp remove agent-relay-workshop`
and, from its project folder, `claude mcp remove agent-relay-workshop`.
This does not sign you out of either provider.

The installer has been tested on macOS. Linux and WSL are not yet verified.
The v0.3.0 source tag and ZIP remain unchanged; the release's `install.sh`
contains the automatic setup, so the ZIP's older manual command is not used.
