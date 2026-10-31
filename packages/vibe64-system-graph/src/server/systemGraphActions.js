import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

import { createUsageActions } from "./usageActions.js";

/** @typedef {import("./types.js").SystemGraphService} SystemGraphService */

// An Architecture action on one session: a query reads, a command changes the scan.
function systemGraphAction({ id, kind, execute }) {
  return withVibe64ActionContext({
    id, version: 1,
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
    systemGraphAction({ id: "vibe64.system-graph.status.read", kind: "query", execute: (input) => systemGraph.readStatus(input) }),
    systemGraphAction({ id: "vibe64.system-graph.architecture.read", kind: "query", execute: (input) => systemGraph.readArchitecture(input) }),
    systemGraphAction({ id: "vibe64.system-graph.refresh.cancel", kind: "command", execute: (input) => systemGraph.cancelRefresh(input) }),
    systemGraphAction({ id: "vibe64.system-graph.refresh.status", kind: "query", execute: (input) => systemGraph.readRefreshStatus(input) }),
    systemGraphAction({ id: "vibe64.system-graph.refresh", kind: "command", execute: (input) => systemGraph.refresh(input) })
  ].concat(createUsageActions({ systemGraph })));
}

export { createSystemGraphActions };
