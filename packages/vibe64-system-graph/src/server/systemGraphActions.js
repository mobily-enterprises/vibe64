import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { NOT_A_TOOL, PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";

import { createUsageActions } from "./usageActions.js";

/** @typedef {import("./types.js").SystemGraphService} SystemGraphService */

const ACTION_SYSTEM_GRAPH_STATUS_READ = "vibe64.system-graph.status.read";
const ACTION_SYSTEM_GRAPH_ARCHITECTURE_READ = "vibe64.system-graph.architecture.read";
const ACTION_SYSTEM_GRAPH_REFRESH_CANCEL = "vibe64.system-graph.refresh.cancel";
const ACTION_SYSTEM_GRAPH_REFRESH_STATUS = "vibe64.system-graph.refresh.status";
const ACTION_SYSTEM_GRAPH_REFRESH = "vibe64.system-graph.refresh";

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
      id: ACTION_SYSTEM_GRAPH_STATUS_READ,
      input: SESSION_INPUT,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.readStatus(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_SYSTEM_GRAPH_ARCHITECTURE_READ,
      input: SESSION_INPUT,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.readArchitecture(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SYSTEM_GRAPH_REFRESH_CANCEL,
      input: SESSION_INPUT,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.cancelRefresh(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_SYSTEM_GRAPH_REFRESH_STATUS,
      input: SESSION_INPUT,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.readRefreshStatus(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SYSTEM_GRAPH_REFRESH,
      input: SESSION_INPUT,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.refresh(input)
    }),
    ...createUsageActions({ systemGraph })
  ]);
}

export {
  ACTION_SYSTEM_GRAPH_ARCHITECTURE_READ,
  ACTION_SYSTEM_GRAPH_REFRESH,
  ACTION_SYSTEM_GRAPH_REFRESH_CANCEL,
  ACTION_SYSTEM_GRAPH_REFRESH_STATUS,
  ACTION_SYSTEM_GRAPH_STATUS_READ,
  createSystemGraphActions
};
