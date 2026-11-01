import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { NOT_A_TOOL, PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";

import { createUsageActions } from "./usageActions.js";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";

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
      ...VIBE64_QUERY,
      id: "vibe64.system-graph.status.read",
      input: SESSION_INPUT,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.readStatus(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.system-graph.architecture.read",
      input: SESSION_INPUT,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.readArchitecture(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.system-graph.refresh.cancel",
      input: SESSION_INPUT,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.cancelRefresh(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.system-graph.refresh.status",
      input: SESSION_INPUT,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.readRefreshStatus(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.system-graph.refresh",
      input: SESSION_INPUT,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.refresh(input)
    }),
    ...createUsageActions({ systemGraph })
  ]);
}

export { createSystemGraphActions };
