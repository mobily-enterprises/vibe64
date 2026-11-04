import { AppError } from "@jskit-ai/kernel/server/runtime";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("../types.js").AiTaskKind} AiTaskKind */

const MESSAGE_LIMIT = 24_000;
const TITLE_LIMIT = 80;

function requestBrief(problem) {
  return problem.facts.message;
}

function requestContext() {
  return "";
}

/**
 * A task's name as one line of at most TITLE_LIMIT characters: line breaks and runs of spaces become one space.
 * @param {unknown} value
 */
function taskTitle(value) {
  return normalizeText(value).replace(/[\s\p{Cc}]+/gu, " ").slice(0, TITLE_LIMIT).trimEnd();
}

/**
 * A task that is someone's own request: the person's New AI task, or what Colleague asks for. Nothing in Vibe64
 * can prove such a request is done, so whoever asked ends it with Finish. Each turn simply ends, so Colleague can
 * keep asking in the same conversation. A renamable kind lets a person rename the task; an empty name gives it back
 * the kind's title.
 * @param {{ id: string, title: string, tray: string, opening: string, startsIdle?: boolean, renamable?: boolean }} kind
 * @returns {AiTaskKind}
 */
function requestKind({ id, title, tray, opening, startsIdle = false, renamable = false }) {
  /**
   * The request is the problem. A routing or recent chat context choice applies to the conversation itself.
   * @param {{ runtime: object, sessionId: string }} _context
   * @param {{ message?: string, title?: string, includeRecentChatContext?: boolean, assistantRouting?: object }} input
   */
  async function readRequest(_context, input) {
    const message = String(input.message || "").trim().slice(0, MESSAGE_LIMIT);
    if (!message && !startsIdle) throw new AppError(400, "Say what the AI should do.", { code: "vibe64_ai_task_message_missing" });
    const named = taskTitle(input.title);
    const summary = message.split("\n")[0].slice(0, 200) || opening;
    return {
      key: JSON.stringify([id, named, message]),
      summary,
      details: message || opening,
      facts: { message },
      title: named || title,
      opening: message || opening,
      conversation: {
        includeRecentChatContext: input.includeRecentChatContext === true,
        ...(input.assistantRouting ? { assistantRouting: input.assistantRouting } : {})
      }
    };
  }

  return Object.freeze({
    id,
    title,
    noun: "task",
    tray,
    routing: "inherit",
    busy: `${title} is still open. Finish it first.`,
    opening,
    problem: readRequest,
    brief: requestBrief,
    context: requestContext,
    steps: ["The AI works on the request", "You finish the task"],
    check: { by: "person" },
    done: "You finished this task.",
    ...(renamable ? { rename: name => taskTitle(name) || title } : {})
  });
}

/** The person's New AI task, Colleague's own requests, and the review conversation of a Colleague assignment. */
function createRequestKinds() {
  return [
    requestKind({ id: "free", title: "AI task", tray: "Working on your request…", opening: "Work on this request.", renamable: true }),
    requestKind({ id: "colleague", title: "Colleague task", tray: "Working on Colleague's request…", opening: "Work on Colleague's request." }),
    requestKind({
      id: "colleague-review",
      title: "Colleague review",
      tray: "Reviewing for Colleague…",
      opening: "Colleague's review waits for its first request.",
      startsIdle: true
    })
  ];
}

export { createRequestKinds };
