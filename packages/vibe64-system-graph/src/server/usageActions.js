import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { NOT_A_TOOL, PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
import { VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";

import { USAGE_ENTRY_KINDS } from "./usageIndex.js";

/** @typedef {import("./types.js").SystemGraphService} SystemGraphService */

const ACTION_SYSTEM_GRAPH_USAGE_ENTRIES_READ = "vibe64.system-graph.usage.entries.read";
const ACTION_SYSTEM_GRAPH_USAGE_WEB_READ = "vibe64.system-graph.usage.web.read";
const ACTION_SYSTEM_GRAPH_USAGE_FUNCTION_READ = "vibe64.system-graph.usage.function.read";
const ACTION_SYSTEM_GRAPH_USAGE_JOIN = "vibe64.system-graph.usage.join";

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

/**
 * Usage reads share Architecture's session read authority. Like the other
 * System Graph reads they are not offered to the assistant; Colleague explains
 * how to use the view instead.
 * @param {object} dependencies
 * @param {SystemGraphService} dependencies.systemGraph
 */
function createUsageActions({ systemGraph }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_SYSTEM_GRAPH_USAGE_ENTRIES_READ,
      input: {
        schema: createSchema({
          sessionId,
          kind: { type: "string", enum: USAGE_ENTRY_KINDS, required: false },
          q: optionalText(80),
          cursor: optionalText(32),
          limit: { type: "integer", min: 1, max: 200, required: false }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.readUsageEntries(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_SYSTEM_GRAPH_USAGE_WEB_READ,
      input: {
        schema: createSchema({
          sessionId,
          entryId: { type: "string", minLength: 1, maxLength: 2048, required: true },
          mode: { type: "string", enum: ["imports", "calls"], required: true },
          certainty: { type: "string", enum: ["all", "exact"], required: false },
          subsystemId: optionalText(2048),
          maxNodes: { type: "integer", min: 1, max: 1000, required: false }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.readUsageWeb(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_SYSTEM_GRAPH_USAGE_FUNCTION_READ,
      input: {
        schema: createSchema({
          sessionId,
          functionId: { type: "string", minLength: 1, maxLength: 4096, required: true }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.readUsageFunction(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_SYSTEM_GRAPH_USAGE_JOIN,
      input: {
        schema: createSchema({
          sessionId,
          functions: { type: "array", items: recordedFunction, required: true }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => systemGraph.joinUsage(input)
    })
  ]);
}

export {
  ACTION_SYSTEM_GRAPH_USAGE_ENTRIES_READ,
  ACTION_SYSTEM_GRAPH_USAGE_FUNCTION_READ,
  ACTION_SYSTEM_GRAPH_USAGE_JOIN,
  ACTION_SYSTEM_GRAPH_USAGE_WEB_READ,
  createUsageActions
};
