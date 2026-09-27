import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

function createSystemGraphActions({ systemGraph }) {
  return [
    ["subsystems.read", "readSubsystems"],
    ["status.read", "readStatus"],
    ["machine.read", "readMachineCity"],
    ["program.read", "readProgramCity"],
    ["refresh", "refresh"]
  ].map(([operation, method]) => withVibe64ActionContext({
    id: `vibe64.system-graph.${operation}`, version: 1,
    kind: method === "refresh" ? "command" : "query",
    input: { schema: createSchema({ sessionId: { type: "string", minLength: 1, maxLength: 256, required: true } }), mode: "create" },
    output: null, idempotency: method === "refresh" ? "optional" : "none",
    extensions: { assistant: { exclude: true } },
    execute: (input) => systemGraph[method](input)
  }));
}

export { createSystemGraphActions };
