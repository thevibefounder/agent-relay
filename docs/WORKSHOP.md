# Connect Claude and Codex with one command

On a Mac, open Terminal (Command-Space, type Terminal, press Return) and paste:

```sh
curl -fsSL https://github.com/thevibefounder/agent-relay/releases/download/v0.3.0/install.sh | bash
```

Setup installs missing Node.js 24 LTS, Claude Code and Codex into your home
folder using their official downloads. You do not need Homebrew or an
administrator password. Existing working tools are reused. It also adds the
installed tools to your shell PATH for future Terminal windows.

After connecting the CLIs, setup opens the official sign-in flows if needed.
Complete the browser/account choices yourself. Existing Bedrock, other provider
settings and explicit provider launchers are preserved. If a custom provider
requires credentials, keep using its normal setup. Downloads/installations and
account sign-ins still need a working internet connection.

Official sources: [Node LTS](https://nodejs.org/en/download),
[Claude Code](https://code.claude.com/docs/en/setup),
[Codex CLI](https://developers.openai.com/codex/cli/).

The installer checks the v0.3.0 ZIP checksum, installs the bundled router, makes
`~/AgentRelay-Workshop`, and registers both CLIs against the same read-only
project policy. It preserves other Relay connections, provider settings and
credentials. It checks both router connections without making paid model calls.

When setup and sign-in finish, use the printed `cd` and full launch command
to start Codex immediately, then paste the first prompt it shows. Existing CLI
sessions need a restart; future Terminal windows know the installed tools.
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

- **Download/install failed:** check the connection and rerun the same command. Completed installations are reused.
- **No interactive terminal:** open Claude/Codex and sign in when prompted. Automated installs can pass `--no-login` to defer browser sign-in.
- **Existing connection differs:** it was preserved; use a different `--name`.
- **Existing installation differs:** inspect the reported path before replacing it.
- **Provider authentication/model error:** run that CLI directly and fix its sign-in first.
- **No Relay tools:** restart the CLI and check `codex mcp list` or `claude mcp list`.

To disconnect the practice setup, run `codex mcp remove agent-relay-workshop`
and, from its project folder, `claude mcp remove agent-relay-workshop`.
This does not sign you out of either provider.

Automatic prerequisite installation targets macOS on Apple Silicon and Intel.
The fresh installation test runs on Apple Silicon; Intel, Linux and WSL are
not yet verified. Automatic Node installation is limited to macOS.
The v0.3.0 source tag and ZIP remain unchanged; the release's `install.sh`
contains the automatic setup, so the ZIP's older manual command is not used.
