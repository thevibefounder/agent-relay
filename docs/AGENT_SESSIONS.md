# Agent sessions

## 2026-11-19 — Codex — Public 0.3.0 release

- Prepared a clean source snapshot of AgentRelay 0.3.0 for public distribution.
- Included project-bound jobs, bundled local stdio router, setup instructions and third-party notices.
- Private repository history, local policies, authentication, provider receipts and internal review notes are excluded.
- Verified the full source/bundle test suite outside the sandbox, including process ancestry, jobs, permissions, continuation and writer locks. Package validation and a clean bundle rebuild passed; locked dependency audit reported zero vulnerabilities. Public-download verification is performed after publishing the tagged artifact.

## 2026-11-19 — Codex — Install guide correction

- The anonymous fresh-install test exposed Claude CLI option parsing: its variadic `-e` flag consumed the following server name. Moved the name before `-e` in both install examples.
- Preserved the original v0.3.0 tag and source ZIP. Supplied a separately named corrected guide on the release page; router behavior is unchanged.
