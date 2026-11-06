import { AppError } from "@jskit-ai/kernel/server/runtime";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("../types.js").AiTaskKind} AiTaskKind */
/** @typedef {import("@local/vibe64-pages/server/types").PagesService} PagesService */

const HANDOFF = [
  "Return kind=complete with one line saying what changed as soon as `vibe64-helper pages data` has printed the new version. Vibe64 then reads the page back itself.",
  "Return kind=cannot only when the new data can't be found, and say why. Nobody is waiting in this chat: never ask a question."
].join("\n");

function pageRefreshContext() {
  return HANDOFF;
}

function pageRefreshRetryMessage(diagnostic) {
  return [
    "Vibe64 read the page back after your work, and it has no new data yet.",
    `Latest read:\n${diagnostic}`,
    HANDOFF
  ].join("\n\n");
}

/**
 * What the AI is told: what to find, where the saved project is, the data it replaces and the one
 * command that writes it.
 * @param {import("../types.js").AiTaskProblem} problem
 */
function pageRefreshBrief({ facts }) {
  const saved = facts.saved
    ? `Read the project as last saved: commit ${facts.saved.commit} on ${facts.saved.branch} (for example \`git show ${facts.saved.commit}:<path>\`; run \`git fetch\` first if this session doesn't have it). Leave this session's files and Git state as they are.`
    : "Read the project as last saved, not this session's unsaved changes. Leave this session's files and Git state as they are.";
  return [
    `Refresh the page "${facts.title}" (${facts.pageId}). This is a scheduled refresh; nobody is waiting in this chat.`,
    `What the refresh does:\n${facts.prompt}`,
    saved,
    "Only the page's data changes; its layout stays as it is.",
    facts.data ? `Its current data.json:\n\`\`\`json\n${facts.data}\n\`\`\`` : "It has no data.json yet: write one in the shape its index.html reads.",
    `Write the new data.json to a file outside the repository, such as "$TMPDIR/${facts.pageId}-data.json", then run:\nvibe64-helper pages data ${facts.pageId} <that file>\nChange no other page.`,
    HANDOFF
  ].join("\n\n");
}

/**
 * A scheduled prompt refresh of one page. The pages scheduler starts it in the session the refresh
 * was set from and follows it; Vibe64 proves it by reading the page back.
 * @param {{ pages: PagesService }} dependencies
 * @returns {AiTaskKind}
 */
function createPageRefreshKind({ pages }) {
  /**
   * @param {{ runtime: object, sessionId: string }} _context
   * @param {{ pageId?: string, title?: string, prompt?: string, runId?: string, startVersion?: number, saved?: { branch: string, commit: string } | null, data?: string }} input
   */
  async function readRefreshProblem(_context, input) {
    const pageId = normalizeText(input.pageId);
    const prompt = String(input.prompt || "").trim();
    if (!pageId || !prompt || !Number.isInteger(input.startVersion)) {
      throw new AppError(400, "A page refresh needs its page and prompt.", { code: "vibe64_ai_task_no_problem" });
    }
    const { page } = await pages.readPage({ pageId });
    const title = page.title;
    return {
      key: JSON.stringify(["page-refresh", page.id, normalizeText(input.runId)]),
      summary: `Refresh "${title}"`,
      details: prompt,
      facts: {
        pageId: page.id,
        title,
        prompt,
        startVersion: input.startVersion,
        saved: input.saved?.commit ? { branch: normalizeText(input.saved.branch), commit: normalizeText(input.saved.commit) } : null,
        data: String(input.data || "")
      },
      title: `Refresh "${title}"`,
      opening: `Refresh "${title}": ${prompt}`
    };
  }

  return Object.freeze({
    id: "page-refresh",
    title: "Refresh a page",
    noun: "task",
    tray: "Refreshing a page…",
    routing: "fix",
    repository: false,
    busy: "A page refresh is running in this session. Wait for it, or cancel it.",
    opening: "Refresh a page.",
    problem: readRefreshProblem,
    brief: pageRefreshBrief,
    context: pageRefreshContext,
    steps: ["The AI finds the new data", "Vibe64 reads the page back"],
    check: {
      by: "vibe64",
      label: "Reading the page…",
      output: "",
      unstoppable: "Reading the page back can't be interrupted. The task ends as soon as it finishes.",
      async run(_context, task) {
        const { pageId, startVersion } = task.problem.facts;
        const { page } = await pages.readPage({ pageId });
        if (page.version > startVersion) return { passed: true, message: `The page has new data: version ${page.version}.` };
        const diagnostic = `Page ${pageId} is still at version ${page.version}: nothing has run \`vibe64-helper pages data ${pageId} <file>\` yet.`;
        return { passed: false, message: "The page has no new data yet.", retryKey: String(page.version), diagnostic };
      },
      retry: {
        limit: 3,
        display: "Write the page's new data.",
        message: pageRefreshRetryMessage
      }
    },
    done: "The page has new data."
  });
}

export { createPageRefreshKind };
