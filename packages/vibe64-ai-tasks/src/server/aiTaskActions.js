import { PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";
import {
  aiTaskCheckInput,
  aiTaskInput,
  aiTaskSessionInput,
  aiTaskStartInput
} from "./inputSchemas.js";

/** @typedef {import("./types.js").AiTasksService} AiTasksService */

const AI_TASK_ACTIONS = Object.freeze({
  LIST: "vibe64.ai-tasks.list",
  START: "vibe64.ai-tasks.start",
  READ: "vibe64.ai-tasks.read",
  CANCEL: "vibe64.ai-tasks.cancel",
  CHECK: "vibe64.ai-tasks.check",
  CONTINUE: "vibe64.ai-tasks.continue",
  FINISH: "vibe64.ai-tasks.finish",
  CLOSE: "vibe64.ai-tasks.close"
});

// Colleague reaches these with the free and Colleague kinds; until then they serve the person's page.
const extensions = { vibe64: PROJECT_OPERATION };

/**
 * @param {object} dependencies
 * @param {AiTasksService} dependencies.aiTasks
 */
function createAiTaskActions({ aiTasks }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_QUERY,
      id: AI_TASK_ACTIONS.LIST,
      input: aiTaskSessionInput,
      extensions,
      execute: input => aiTasks.list(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: AI_TASK_ACTIONS.READ,
      input: aiTaskInput,
      extensions,
      execute: input => aiTasks.read(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: AI_TASK_ACTIONS.START,
      input: aiTaskStartInput,
      extensions,
      execute: input => aiTasks.start(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: AI_TASK_ACTIONS.CANCEL,
      input: aiTaskInput,
      extensions,
      execute: input => aiTasks.cancel(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: AI_TASK_ACTIONS.CHECK,
      input: aiTaskCheckInput,
      extensions,
      execute: input => aiTasks.check(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: AI_TASK_ACTIONS.CONTINUE,
      input: aiTaskInput,
      extensions,
      execute: input => aiTasks.continueTask(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: AI_TASK_ACTIONS.FINISH,
      input: aiTaskInput,
      extensions,
      execute: input => aiTasks.finish(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: AI_TASK_ACTIONS.CLOSE,
      input: aiTaskInput,
      extensions,
      execute: input => aiTasks.close(input.sessionId, input)
    })
  ]);
}

export {
  AI_TASK_ACTIONS,
  createAiTaskActions
};
