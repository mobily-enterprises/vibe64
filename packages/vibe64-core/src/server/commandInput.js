import { isPlainObject } from "./isPlainObject.js";
import { vibe64Error } from "./core.js";

// The refusals of a command's input: a field the operation does not read, a field it needs that is missing, and input
// that is not a JSON object.
const COMMAND_INPUT_UNREAD = "vibe64_command_input_unread";
const COMMAND_INPUT_MISSING = "vibe64_command_input_missing";
const COMMAND_INPUT_NOT_OBJECT = "vibe64_command_input_not_object";

/**
 * Refuses a command's input that has a field the operation does not read, lacks one it needs, or is not an object,
 * naming the fields it takes, before anything changes. An agent's field under a name the operation does not read is
 * never ignored: its value would be lost while the command answers ok (a Progress sent under another name once kept
 * an empty Progress).
 * @param {unknown} input the agent's own fields, without the identity the command adds
 * @param {{ operation: string, fields: string[], required?: string[] }} contract operation: how the agent names it, as
 *   `plan progress-write`; fields: every field it reads; required: those it needs, missing when absent or null
 */
function refuseUnreadFields(input, { operation, fields, required = [] }) {
  const takes = `It takes ${fields.length ? fields.join(", ") : "no input"}.`;
  if (!isPlainObject(input)) {
    const message = `${operation} takes a JSON object: nothing changed. ${takes}`;
    throw vibe64Error(message, COMMAND_INPUT_NOT_OBJECT, { status: 400, params: { fields } });
  }
  const unread = Object.keys(input).filter((name) => !fields.includes(name));
  const missing = required.filter((name) => input[name] === undefined || input[name] === null);
  if (!unread.length && !missing.length) return;
  const problems = [
    ...(unread.length ? [`does not read ${unread.join(", ")}`] : []),
    ...(missing.length ? [`needs ${missing.join(", ")}`] : [])
  ].join(" and ");
  const code = unread.length ? COMMAND_INPUT_UNREAD : COMMAND_INPUT_MISSING;
  throw vibe64Error(`${operation} ${problems}: nothing changed. ${takes}`, code, { status: 400, params: { fields, missing, unread } });
}

export { COMMAND_INPUT_MISSING, COMMAND_INPUT_NOT_OBJECT, COMMAND_INPUT_UNREAD, refuseUnreadFields };
