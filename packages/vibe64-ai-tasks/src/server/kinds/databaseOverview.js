import { AppError } from "@jskit-ai/kernel/server/runtime";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { buildOverviewAssistantRequest } from "@local/vibe64-database-tools/shared/databaseOverviewPrompt";

/** @typedef {import("../types.js").AiTaskKind} AiTaskKind */
/** @typedef {import("../types.js").AiTaskCheckResult} AiTaskCheckResult */
/** @typedef {import("@local/vibe64-database-tools/server/types").DatabaseToolsService} DatabaseToolsService */

const OVERVIEW_HANDOFF = [
  "Return kind=complete with a factual report as soon as data-overview.json is saved. Vibe64 then reads the overview back against the refreshed schema itself and returns anything still invalid to this same conversation.",
  "Return kind=question only when you need the person's answer. Return kind=cannot only when this cannot be done, and say why."
].join("\n");
const SCOPES = Object.freeze(["all", "new", "ungrouped"]);
const VALID_MESSAGE = "The data overview is valid.";

function overviewRetryMessage(diagnostic) {
  return [
    "Vibe64 read the data overview back after your work, and it is not valid yet. Your edits remain. Fix only what is still wrong.",
    `Latest read:\n${diagnostic}`,
    OVERVIEW_HANDOFF
  ].join("\n\n");
}

/**
 * How the saved overview reads against the refreshed schema. A whole or new-tables review also leaves no table
 * unreviewed.
 * @param {string} scope
 * @param {{ ok?: boolean, code?: string, error?: string, overview?: object, coverage?: object }} read
 * @returns {AiTaskCheckResult}
 */
function overviewCheckResult(scope, read) {
  if (read?.ok === false) {
    // The database itself could not be read: nothing in the overview for the AI to repair.
    const error = normalizeText(read.error) || "The database could not be read.";
    return { passed: false, message: `The data overview could not be read: ${error} Check now once the database is available.`, retryKey: "", diagnostic: error };
  }
  const { overview = {}, coverage = {} } = read || {};
  const problems = [
    overview.present ? "" : "data-overview.json is missing.",
    normalizeText(overview.error),
    coverage.missing?.length ? `Tables missing from the refreshed schema: ${coverage.missing.join(", ")}.` : "",
    coverage.missingRelationships?.length ? `Main connections missing from the refreshed schema: ${coverage.missingRelationships.join(", ")}.` : "",
    scope !== "ungrouped" && coverage.unreviewed?.length ? `Tables not yet reviewed: ${coverage.unreviewed.join(", ")}.` : ""
  ].filter(Boolean);
  if (!problems.length) return { passed: true, message: VALID_MESSAGE };
  const diagnostic = problems.join("\n");
  return { passed: false, message: `The data overview still needs work: ${problems[0]}`, retryKey: JSON.stringify(problems), diagnostic };
}

function overviewBrief(problem) {
  return [problem.facts.message, OVERVIEW_HANDOFF].join("\n\n");
}

function overviewContext() {
  return OVERVIEW_HANDOFF;
}

/**
 * Create or review the Data overview: the AI groups the tables, then Vibe64 reads the overview back itself.
 * @param {{ databaseTools: DatabaseToolsService }} dependencies
 * @returns {AiTaskKind}
 */
function createDatabaseOverviewKind({ databaseTools }) {
  /**
   * The person's request is the problem: the abstraction and scope they chose, against the schema Vibe64 reads.
   * @param {{ runtime: object, sessionId: string }} context
   * @param {{ abstraction?: string, scope?: string, tables?: string[] }} input
   */
  async function readOverviewProblem({ sessionId }, input) {
    const scope = SCOPES.includes(input.scope) ? input.scope : "all";
    const tables = (Array.isArray(input.tables) ? input.tables : []).map(normalizeText).filter(Boolean).slice(0, 500);
    if (scope === "ungrouped" && !tables.length) {
      throw new AppError(400, "Choose the ungrouped tables to review.", { code: "vibe64_ai_task_no_problem" });
    }
    const read = await databaseTools.readOverview({ sessionId });
    if (read?.ok === false) {
      throw new AppError(409, normalizeText(read.error) || "The database could not be read.", { code: read.code || "vibe64_ai_task_no_problem" });
    }
    const request = buildOverviewAssistantRequest({ abstraction: normalizeText(input.abstraction), scope, schemaTables: read.schema.tables, tables });
    return {
      key: JSON.stringify(["database-overview", scope, request.abstraction, tables, read.overview.hash]),
      summary: request.displayMessage,
      details: request.displayMessage,
      facts: { scope, message: request.message },
      title: read.overview.present ? "Review the data overview" : "Create the data overview",
      opening: request.displayMessage
    };
  }

  return Object.freeze({
    id: "database-overview",
    title: "Data overview",
    noun: "task",
    tray: "Grouping the tables…",
    routing: "fix",
    repository: true,
    busy: "The data overview is being worked on. Finish that first.",
    opening: "Create or review the data overview.",
    problem: readOverviewProblem,
    brief: overviewBrief,
    context: overviewContext,
    steps: ["The AI groups the tables", "Vibe64 reads the overview back"],
    check: {
      by: "vibe64",
      label: "Reading the overview…",
      output: "",
      unstoppable: "Reading the overview can't be interrupted. The task ends as soon as it finishes.",
      async run({ sessionId }, task) {
        return overviewCheckResult(task.problem.facts.scope, await databaseTools.readOverview({ sessionId }));
      },
      retry: {
        limit: 3,
        display: "Continue with what the data overview still needs.",
        message: overviewRetryMessage
      }
    },
    done: VALID_MESSAGE
  });
}

export {
  createDatabaseOverviewKind,
  overviewCheckResult
};
