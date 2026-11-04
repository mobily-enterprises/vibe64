import { defineFeature } from "@jskit-ai/kernel/server/features";

/** @typedef {import("./types.js").AiTasksService} AiTasksService */

/** One job for an agent, held by the server from its problem to Done or Not done. */
const Vibe64AiTasksFeature = defineFeature({
  id: "vibe64.ai-tasks",
  domain: "vibe64-ai-tasks",
  requires: {
    logger: "runtime.logger"
  },
  provides: {
    aiTasks: "vibe64.ai-tasks"
  },
  setup() {
    /** @type {AiTasksService} */
    const aiTasks = Object.freeze({});
    return { aiTasks };
  }
});

export {
  Vibe64AiTasksFeature
};
