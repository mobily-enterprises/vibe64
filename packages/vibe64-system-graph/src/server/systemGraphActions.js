import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";

import { createUsageActions } from "./usageActions.js";

/** @typedef {import("./types.js").SystemGraphService} SystemGraphService */

// Every Architecture action works on one session: a query reads, a command changes the scan.
const SESSION_INPUT = Object.freeze({
  schema: createSchema({ sessionId: { type: "string", minLength: 1, maxLength: 256, required: true } }),
  mode: "create"
});

/**
 * @param {object} dependencies
 * @param {SystemGraphService} dependencies.systemGraph
 */
function createSystemGraphActions({ systemGraph }) {
  return Object.freeze([
    Object.freeze({
      id: "vibe64.system-graph.status.read",
      version: 1,
      kind: "query",
      input: SESSION_INPUT,
      output: null,
      idempotency: "none",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.readStatus(input)
    }),
    Object.freeze({
      id: "vibe64.system-graph.architecture.read",
      version: 1,
      kind: "query",
      input: SESSION_INPUT,
      output: null,
      idempotency: "none",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.readArchitecture(input)
    }),
    Object.freeze({
      id: "vibe64.system-graph.refresh.cancel",
      version: 1,
      kind: "command",
      input: SESSION_INPUT,
      output: null,
      idempotency: "optional",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.cancelRefresh(input)
    }),
    Object.freeze({
      id: "vibe64.system-graph.refresh.status",
      version: 1,
      kind: "query",
      input: SESSION_INPUT,
      output: null,
      idempotency: "none",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.readRefreshStatus(input)
    }),
    Object.freeze({
      id: "vibe64.system-graph.refresh",
      version: 1,
      kind: "command",
      input: SESSION_INPUT,
      output: null,
      idempotency: "optional",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.refresh(input)
    }),
    ...createUsageActions({ systemGraph })
  ]);
}

export { createSystemGraphActions };
