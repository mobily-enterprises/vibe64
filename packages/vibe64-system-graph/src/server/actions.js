import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

// A practice lesson's Architecture reads and refreshes its own project's Cities.
const LEARNING_ACCESS = Object.freeze({
  "subsystems.read": "observe", "status.read": "observe", "machine.read": "observe",
  "program.read": "observe", "architecture.read": "observe", "refresh.status": "observe",
  "refresh.cancel": "control", refresh: "write"
});

function createSystemGraphActions({ systemGraph }) {
  return [
    ["subsystems.read", "readSubsystems"],
    ["status.read", "readStatus"],
    ["machine.read", "readMachineCity"],
    ["program.read", "readProgramCity"],
    ["architecture.read", "readArchitecture"],
    ["refresh.cancel", "cancelRefresh"],
    ["refresh.status", "readRefreshStatus"],
    ["refresh", "refresh"]
  ].map(([operation, method]) => withVibe64ActionContext({
    id: `vibe64.system-graph.${operation}`, version: 1,
    kind: ["refresh", "cancelRefresh"].includes(method) ? "command" : "query",
    input: { schema: createSchema({ sessionId: { type: "string", minLength: 1, maxLength: 256, required: true } }), mode: "create" },
    output: null, idempotency: ["refresh", "cancelRefresh"].includes(method) ? "optional" : "none",
    extensions: { assistant: { exclude: true } },
    execute: (input, context) => {
      const learning = context?.vibe64Action?.learning;
      if (learning && learning.learningScope.noExercise !== false) {
        throw Object.assign(new Error("This lesson has no practice project."), {
          code: "vibe64_learning_source_required", statusCode: 409
        });
      }
      return systemGraph[method](input);
    }
  }, { learningAccess: LEARNING_ACCESS[operation] }));
}

export { createSystemGraphActions };
