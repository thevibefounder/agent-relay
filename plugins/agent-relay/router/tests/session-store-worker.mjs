#!/usr/bin/env node

import { recordSessionBinding } from "../src/session-store.mjs";

const [directory, sessionId] = process.argv.slice(2);
recordSessionBinding(directory, sessionId, {
  projectId: "project",
  agentId: "codex-project",
  target: "codex",
  root: "/canonical/project"
});
