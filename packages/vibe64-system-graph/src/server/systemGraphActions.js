import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

import { createUsageActions } from "./usageActions.js";

/** @typedef {import("./types.js").SystemGraphService} SystemGraphService */

// An Architecture action on one session: a query reads, a command changes the scan.
function systemGraphAction(operation, kind, execute) {
  return withVibe64ActionContext({
    id: `vibe64.system-graph.${operation}`, version: 1,
    kind,
    input: { schema: createSchema({ sessionId: { type: "string", minLength: 1, maxLength: 256, required: true } }), mode: "create" },
    output: null, idempotency: kind === "command" ? "optional" : "none",
    extensions: { assistant: { exclude: true } },
    execute
  });
}

/**
 * @param {object} dependencies
 * @param {SystemGraphService} dependencies.systemGraph
 */
function createSystemGraphActions({ systemGraph }) {
  return Object.freeze([
    systemGraphAction("status.read", "query", (input) => systemGraph.readStatus(input)),
    systemGraphAction("architecture.read", "query", (input) => systemGraph.readArchitecture(input)),
    systemGraphAction("refresh.cancel", "command", (input) => systemGraph.cancelRefresh(input)),
    systemGraphAction("refresh.status", "query", (input) => systemGraph.readRefreshStatus(input)),
    systemGraphAction("refresh", "command", (input) => systemGraph.refresh(input))
  ].concat(createUsageActions({ systemGraph })));
}

export { createSystemGraphActions };
