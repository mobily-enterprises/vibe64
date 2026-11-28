import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { NOT_A_TOOL, PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
import { VIBE64_COMMAND } from "@local/vibe64-core/shared/actionFields";
import { NEED_HELP_LIMITS } from "../../shared/needHelp.js";

// Need help's operations for the person, from the session's pages: raise it (or add to the one it has), answer it, and
// clear it. Pages only: the session's AI has its own vibe64-helper need-help, and Colleague explains it.

const ACTION_RAISE_NEED_HELP = "vibe64.sessions.need-help.raise";
const ACTION_ANSWER_NEED_HELP = "vibe64.sessions.need-help.answer";
const ACTION_CLEAR_NEED_HELP = "vibe64.sessions.need-help.clear";

const sessionId = { type: "string", noTrim: false, minLength: 1, maxLength: 256, required: true };
// The service trims it and says what an empty or long one lacks; the schema only bounds what arrives.
const message = { type: "string", noTrim: true, maxLength: NEED_HELP_LIMITS.messageCharacters * 2, required: true };

const needHelpMessageBodyValidator = deepFreeze({ schema: createSchema({ text: message }), mode: "create" });
const needHelpMessageInputValidator = deepFreeze({ schema: createSchema({ sessionId, text: message }) });
const needHelpSessionInputValidator = deepFreeze({ schema: createSchema({ sessionId }) });

/**
 * @param {object} dependencies
 * @param {ReturnType<typeof import("./needHelpService.js").createNeedHelpService>} dependencies.needHelp
 */
function createNeedHelpActions({ needHelp }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_RAISE_NEED_HELP,
      input: { ...needHelpMessageInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => needHelp.raise(input.sessionId, { text: input.text, from: "person", actor: input.vibe64User || null })
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_ANSWER_NEED_HELP,
      input: { ...needHelpMessageInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => needHelp.answer(input.sessionId, { text: input.text, actor: input.vibe64User || null })
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CLEAR_NEED_HELP,
      input: { ...needHelpSessionInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => needHelp.clear(input.sessionId)
    })
  ]);
}

export {
  ACTION_ANSWER_NEED_HELP,
  ACTION_CLEAR_NEED_HELP,
  ACTION_RAISE_NEED_HELP,
  createNeedHelpActions,
  needHelpMessageBodyValidator
};
