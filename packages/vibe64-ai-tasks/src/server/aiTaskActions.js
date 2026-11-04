import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";
import {
  aiTaskCheckInput,
  aiTaskInput,
  aiTaskRenameInput,
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
  CLOSE: "vibe64.ai-tasks.close",
  RENAME: "vibe64.ai-tasks.rename"
});

// Check now and Continue are the person's, from the window: Colleague asks the person instead.
const extensions = { vibe64: PROJECT_OPERATION };

const shortText = { type: "string", maxLength: 256, required: false };
const longText = { type: "string", maxLength: 2000, required: false };
const taskSchema = createSchema({
  id: shortText,
  kind: shortText,
  title: shortText,
  phase: shortText,
  reason: shortText,
  summary: longText,
  message: longText,
  report: longText
});
const taskOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true },
    task: { type: "object", required: false, schema: taskSchema },
    tasks: { type: "array", items: taskSchema, required: false },
    closed: { type: "boolean", required: false }
  })
};

/** What Colleague reads of a task: where it is and how it ended, bounded. */
function taskSummary(task) {
  return {
    ...Object.fromEntries(["id", "kind", "title", "phase", "reason"].map(key => [key, String(task[key] || "").slice(0, 256)])),
    summary: String(task.problem?.summary || "").slice(0, 2000),
    message: String(task.message || "").slice(0, 2000),
    report: String(task.report || "").slice(0, 2000)
  };
}

/** @param {string} description */
function aiTaskTool(description) {
  return {
    description,
    output: taskOutput,
    transformResult(result) {
      return {
        ok: result.ok === true,
        ...(result.task ? { task: taskSummary(result.task) } : {}),
        ...(Array.isArray(result.tasks) ? { tasks: result.tasks.slice(0, 10).map(taskSummary) } : {}),
        ...(typeof result.closed === "boolean" ? { closed: result.closed } : {})
      };
    }
  };
}

const SESSION_RUNS_ONE = "A session runs one AI task at a time.";
const TOOLS = Object.freeze({
  list: aiTaskTool(`List the AI tasks of an exact session: the open one, and any that ended and wait for Close. ${SESSION_RUNS_ONE}`),
  read: aiTaskTool(
    "Read one AI task's phase, why it needs someone when it does, and how it ended. needs_you with reason your_turn means the AI's turn ended. " +
      "Read the task's messages with the ai-task-conversation read tool, using the task id as conversationId."
  ),
  start: aiTaskTool(
    "Start an AI task in an exact session only when the user asked for this work or accepted your offer. kind colleague runs your request in its own " +
      "conversation: input.message is the request, input.title names it, input.includeRecentChatContext=true gives it recent Main messages, and " +
      "input.assistantRouting picks its chat mode as ai-task-conversation update describes. kind project-setup runs the setup screen's request: " +
      "input.mode is create, inspect, adopt (with the user's input.purpose) or repair; Vibe64 inspects the project itself when the AI finishes. " +
      "Supply a stable taskId so a retry returns the same task. " + SESSION_RUNS_ONE +
      " Another open task refuses this with vibe64_ai_task_open: tell the user and offer to wait. Send follow-ups with the ai-task-conversation turn " +
      "tool and the task id as conversationId. A colleague task ends only when it is finished."
  ),
  cancel: aiTaskTool("Cancel an AI task only when the user asks. Cancel is always accepted; the task shows Cancelling until its running turn or check stops."),
  finish: aiTaskTool("Finish a colleague task once its request is done and the AI's turn has ended (phase needs_you, reason your_turn)."),
  close: aiTaskTool("Close an ended AI task (done or not_done), which removes its conversation. Read its result first. Closing it again does nothing."),
  rename: aiTaskTool(
    "Rename a New AI task (kind free) only when the user asks. name is the new name, one line of at most 80 characters; an empty " +
      "name gives back AI task. It works in any phase until the task is closed and sends nothing to the AI. Other kinds refuse it with " +
      "vibe64_ai_task_not_renamable."
  )
});

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
      extensions: { ...extensions, assistant: TOOLS.list },
      execute: input => aiTasks.list(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: AI_TASK_ACTIONS.READ,
      input: aiTaskInput,
      extensions: { ...extensions, assistant: TOOLS.read },
      execute: input => aiTasks.read(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: AI_TASK_ACTIONS.START,
      input: aiTaskStartInput,
      extensions: { ...extensions, assistant: TOOLS.start },
      execute: input => aiTasks.start(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: AI_TASK_ACTIONS.CANCEL,
      input: aiTaskInput,
      extensions: { ...extensions, assistant: TOOLS.cancel },
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
      extensions: { ...extensions, assistant: TOOLS.finish },
      execute: input => aiTasks.finish(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: AI_TASK_ACTIONS.CLOSE,
      input: aiTaskInput,
      extensions: { ...extensions, assistant: TOOLS.close },
      execute: input => aiTasks.close(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: AI_TASK_ACTIONS.RENAME,
      input: aiTaskRenameInput,
      extensions: { ...extensions, assistant: TOOLS.rename },
      execute: input => aiTasks.rename(input.sessionId, input)
    })
  ]);
}

export {
  AI_TASK_ACTIONS,
  createAiTaskActions
};
