/** What a session's AI task host provides to its buttons and tray. */
const VIBE64_AI_TASKS_KEY = Symbol("vibe64.ai-tasks");
/**
 * What `inject(VIBE64_AI_TASKS_KEY, NO_AI_TASKS)` gives a page that may show outside a session's AI task host:
 * there are no AI tasks to start there, so the page leaves out its AI task buttons.
 */
const NO_AI_TASKS = Object.freeze({ available: false });

export { NO_AI_TASKS, VIBE64_AI_TASKS_KEY };
