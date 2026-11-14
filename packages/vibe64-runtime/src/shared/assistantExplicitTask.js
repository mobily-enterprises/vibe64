// The pass a person's message starts by itself: the Genesis task its sender
// named, "Deslop" alone, or a typed UI pass message, and the Senior purpose
// each such pass runs under.

// "UI pass" alone, or with a scope after a colon, a dash, "on", "of" or "for".
const UI_PASS_MESSAGE = /^\s*ui[\s-]?pass(?:(?:\s*[:–—-]\s*|\s+(?:on|of|for)\s+)([^?]+?))?\s*[.!]?\s*$/iu;
const UI_PASS_CHANGES = /^(?:(?:the|this|my|your(?:\s+own)?)\s+)?(?:(?:current|last)\s+)?(?:task(?:['’]s)?\s+)?changes(?:\s+(?:the|this)\s+task\s+made|\s+for\s+the\s+current\s+task)?$/iu;
const UI_PASS_APP = /^(?:the\s+)?(?:whole|entire|full)\s+app(?:lication)?$/iu;

/**
 * The request Genesis's ui-pass task receives for a typed UI pass message: the
 * changes the current task made (no scope), the whole app, or a named section.
 * @param {string} message
 * @returns {string} the request, or "" for any other message
 */
function uiPassRequest(message) {
  const match = UI_PASS_MESSAGE.exec(String(message || ""));
  if (!match) return "";
  const scope = (match[1] || "").trim().replace(/[.!]+$/u, "").trim();
  if (!scope || UI_PASS_CHANGES.test(scope)) return "Run the UI pass on the changes the current task made.";
  if (UI_PASS_APP.test(scope)) return "Run the UI pass on the whole app.";
  return `Run the UI pass on this section of the app: ${scope}.`;
}

// The purposes of the passes a person starts in their own Senior turn: Deslop and the UI pass have
// their own, and every other pass is a "pass" (admission accepts only a pass Genesis lists).
const ASSISTANT_TASK_PURPOSES = Object.freeze({ deslop: "deslop", "ui-pass": "ui_pass" });
const assistantTaskPurpose = (task) => !task ? "" : Object.hasOwn(ASSISTANT_TASK_PURPOSES, task) ? ASSISTANT_TASK_PURPOSES[task] : "pass";

/**
 * The pass a message starts explicitly: the Genesis task its sender named,
 * "Deslop" alone, or a UI pass message.
 */
function assistantExplicitTask(input = {}) {
  if (typeof input.genesisTask === "string" && input.genesisTask.trim()) return input.genesisTask.trim();
  if (/^\s*deslop[.!]?\s*$/iu.test(String(input.message || ""))) return "deslop";
  return uiPassRequest(input.message) ? "ui-pass" : "";
}

export {
  ASSISTANT_TASK_PURPOSES,
  assistantExplicitTask,
  assistantTaskPurpose,
  uiPassRequest
};
