# Agent sessions

## 2026-11-19 — Codex — Public 0.3.0 release

- Prepared a clean source snapshot of AgentRelay 0.3.0 for public distribution.
- Included project-bound jobs, bundled local stdio router, setup instructions and third-party notices.
- Private repository history, local policies, authentication, provider receipts and internal review notes are excluded.
- Verified the full source/bundle test suite outside the sandbox, including process ancestry, jobs, permissions, continuation and writer locks. Package validation and a clean bundle rebuild passed; locked dependency audit reported zero vulnerabilities. Public-download verification is performed after publishing the tagged artifact.

## 2026-11-19 — Codex — Install guide correction

- The anonymous fresh-install test exposed Claude CLI option parsing: its variadic `-e` flag consumed the following server name. Moved the name before `-e` in both install examples.
- Preserved the original v0.3.0 tag and source ZIP. Supplied a separately named corrected guide on the release page; router behavior is unchanged.
- Final public-download verification passed on macOS / Node v24.22.1. Anonymous ZIP and guide download, checksum, fresh setup, isolated Claude and Codex registrations, bundled MCP discovery, and a real read-only Claude-on-Bedrock review all succeeded. The reviewer read the fresh fixture, identified its arithmetic bug, completed a bound session without permission denials and left files unchanged. No consumer npm dependencies or bundled provider credentials were used. The end-to-end request used a direct MCP test client; an initiating interactive Codex turn was not part of this fresh-download check.

## 2026-11-19 — Codex — One-command workshop setup

- Added a one-command macOS installer for the existing v0.3.0 release. It checks prerequisites, verifies the pinned ZIP checksum, creates a read-only practice project, checks both stdio router connections, and registers Claude/Codex with a shared policy and explicit CLI paths. Provider logins/settings are retained; setup makes no model calls.
- Replaced the workshop instructions with the single command and optional existing-project/edit arguments. The original v0.3.0 tag and ZIP remain unchanged.
- Verified real CLI registration in isolated profiles with spaces in paths, idempotent reruns, connection/policy collision preservation, missing-CLI handling, home-root rejection and explicit edit opt-in. Full source/bundle tests, shell syntax and reproducible package validation passed.
- Final public-asset test passed: the exact anonymous curl-to-bash command created both isolated CLI registrations; a real Claude Opus 5.5 review through Bedrock then read the installed project, found its intentional bug, returned a bound completion with no permission denials and left files unchanged. The request used a direct MCP test client. Sent the verified command/download path to the workshop slide owner.

## 2026-11-19 — Codex — Automatic prerequisites and sign-in handoff

- Extended the same workshop command to install a user-local Node 24 LTS runtime when needed, plus missing Claude Code and Codex through their official installers. Node downloads are SHA-256 verified. Setup appends a small shell environment hook and preserves existing working CLI/provider choices. No administrator password or Homebrew is needed.
- Added official sign-in handoff through the controlling terminal, including when installation is piped into Bash. Existing Claude authentication, custom Codex providers, explicit launchers and API credentials skip the standard login flow. Automated installs may pass `--no-login`.
- Tested from an isolated macOS home and PATH with all three tools absent: Node v24.22.3, Claude Code 2.1.329 and Codex 0.170.0 installed and both Relay registrations/discovery passed. The freshly installed Node and Claude completed a real read-only Bedrock review with a bound result, no permission denials and unchanged fixture files.
- Verified the terminal handoff with mock sign-in commands, existing-provider skip, shell-content preservation and duplicate-hook prevention. Full source/bundle suites, package validation, shell syntax and credential/personal-path scans passed. Browser sign-in itself remains an attendee action; tests do not sign into new accounts.
