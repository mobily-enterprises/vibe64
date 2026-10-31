import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

import { USAGE_ENTRY_KINDS } from "./usageWeb.js";

/** @typedef {import("./types.js").SystemGraphService} SystemGraphService */

const sessionId = { type: "string", minLength: 1, maxLength: 256, required: true };
const optionalText = (maxLength) => ({ type: "string", maxLength, required: false });
const point = createSchema({
  line: { type: "integer", min: 1, required: true },
  column: { type: "integer", min: 1, required: true }
});
const recordedFunction = createSchema({
  path: { type: "string", minLength: 1, maxLength: 4096, required: true },
  hash: { type: "string", minLength: 1, maxLength: 128, required: true },
  name: { type: "string", maxLength: 512, required: true },
  start: { type: "object", schema: point, required: true }
});

// A usage read on one session's scan, with the fields its query takes.
function usageAction(operation, execute, fields) {
  return withVibe64ActionContext({
    id: `vibe64.system-graph.${operation}`, version: 1,
    kind: "query",
    input: { schema: createSchema({ sessionId, ...fields }), mode: "create" },
    output: null, idempotency: "none",
    extensions: { assistant: { exclude: true } },
    execute
  });
}

/**
 * Usage reads share Architecture's session read authority. Like the other
 * System Graph reads they are not offered to the assistant; Colleague explains
 * how to use the view instead.
 * @param {object} dependencies
 * @param {SystemGraphService} dependencies.systemGraph
 */
function createUsageActions({ systemGraph }) {
  return Object.freeze([
    usageAction("usage.entries.read", (input) => systemGraph.readUsageEntries(input), {
      kind: { type: "string", enum: USAGE_ENTRY_KINDS, required: false },
      q: optionalText(80),
      cursor: optionalText(32),
      limit: { type: "integer", min: 1, max: 200, required: false }
    }),
    usageAction("usage.web.read", (input) => systemGraph.readUsageWeb(input), {
      entryId: { type: "string", minLength: 1, maxLength: 2048, required: true },
      mode: { type: "string", enum: ["imports", "calls"], required: true },
      certainty: { type: "string", enum: ["all", "exact"], required: false },
      subsystemId: optionalText(2048),
      maxNodes: { type: "integer", min: 1, max: 1000, required: false }
    }),
    usageAction("usage.function.read", (input) => systemGraph.readUsageFunction(input), {
      functionId: { type: "string", minLength: 1, maxLength: 4096, required: true }
    }),
    usageAction("usage.join", (input) => systemGraph.joinUsage(input), {
      functions: { type: "array", items: recordedFunction, required: true }
    })
  ]);
}

export { createUsageActions };
