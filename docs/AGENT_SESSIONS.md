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
