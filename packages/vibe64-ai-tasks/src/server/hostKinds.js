// A host's own kinds of AI task. A feature set up before vibe64.ai-tasks provides an array of
// AiTaskKind through this token; each runs like public's own kinds, in the same window, through the
// same machine, runner and check. A kind whose repair must be saved before its check saves through
// createAiTaskSave, the same Save that Fix Save runs.
const AI_TASK_HOST_KINDS_TOKEN = "vibe64.ai-tasks.host-kinds";

export { AI_TASK_HOST_KINDS_TOKEN };
export { createAiTaskSave, saveCheckResult } from "./kinds/save.js";
