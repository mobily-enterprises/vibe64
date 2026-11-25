import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { NOT_A_TOOL, PROJECT_OPERATION, WORKSPACE_OPERATION } from "@local/vibe64-core/server/actionContext";
import { VIBE64_COMMAND } from "@local/vibe64-core/shared/actionFields";
import { PROBLEM_REPORT_CHAT_KINDS, PROBLEM_REPORT_LIMITS } from "@local/vibe64-core/shared/problemReport";

// Report a problem's operations: collect a report for the person to review (inside a project, where it may describe
// a session and its chat, or outside one), and send a reviewed report through the host's delivery. Collecting keeps
// the report as that person's draft, so it is a command too. Pages only: none is offered to an assistant.

const ACTION_COLLECT_PROJECT_PROBLEM_REPORT = "vibe64.problem-report.collect";
const ACTION_COLLECT_WORKSPACE_PROBLEM_REPORT = "vibe64.problem-report.collect-workspace";
const ACTION_SEND_PROBLEM_REPORT = "vibe64.problem-report.send";

const text = (maxLength) => ({ type: "string", noTrim: false, required: false, maxLength });
const vibe64UserField = { type: "object", additionalProperties: true, required: false };
// What the page says of itself. Its error list is cut to the newest PROBLEM_REPORT_LIMITS.clientErrors by the
// service; the route's body limit bounds what arrives.
const clientField = {
  type: "object",
  required: false,
  schema: createSchema({
    userAgent: text(400),
    viewport: text(40),
    language: text(40),
    timeZone: text(80),
    errors: {
      type: "array",
      required: false,
      items: createSchema({ at: text(40), source: text(200), code: text(200), message: text(PROBLEM_REPORT_LIMITS.textCharacters) })
    }
  })
};
const placeFields = {
  page: text(200),
  route: text(PROBLEM_REPORT_LIMITS.textCharacters),
  client: clientField,
  vibe64User: vibe64UserField
};

const collectWorkspaceInputValidator = deepFreeze({ schema: createSchema(placeFields), mode: "create" });
const collectProjectInputValidator = deepFreeze({
  schema: createSchema({
    ...placeFields,
    sessionId: { type: "string", required: false, maxLength: 128, pattern: "^(?:[A-Za-z0-9][A-Za-z0-9_-]{0,127})?$" },
    chat: {
      type: "object",
      required: false,
      schema: createSchema({
        kind: { type: "string", required: true, enum: [...PROBLEM_REPORT_CHAT_KINDS] },
        id: text(128)
      })
    },
    includeChat: { type: "boolean", required: false }
  }),
  mode: "create"
});
const sendInputValidator = deepFreeze({
  schema: createSchema({
    draftId: { type: "string", required: true, minLength: 36, maxLength: 36 },
    note: text(PROBLEM_REPORT_LIMITS.noteCharacters),
    consents: { type: "object", required: false, values: { type: "boolean" } },
    vibe64User: vibe64UserField
  }),
  mode: "create"
});

/** @param {Record<string, any>} input */
/**
 * @param {object} dependencies
 * @param {ReturnType<typeof import("./problemReportService.js").createProblemReportService>} dependencies.problemReports
 */
function createProblemReportActions({ problemReports }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_COLLECT_PROJECT_PROBLEM_REPORT,
      input: collectProjectInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => problemReports.collectInProject(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_COLLECT_WORKSPACE_PROBLEM_REPORT,
      input: collectWorkspaceInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      execute: (input) => problemReports.collect(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SEND_PROBLEM_REPORT,
      input: sendInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      execute: (input) => problemReports.send(input)
    })
  ]);
}

export {
  ACTION_COLLECT_PROJECT_PROBLEM_REPORT,
  ACTION_COLLECT_WORKSPACE_PROBLEM_REPORT,
  ACTION_SEND_PROBLEM_REPORT,
  collectProjectInputValidator,
  collectWorkspaceInputValidator,
  createProblemReportActions,
  sendInputValidator
};
