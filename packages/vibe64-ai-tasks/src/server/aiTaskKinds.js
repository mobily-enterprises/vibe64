import { createSaveKind } from "./kinds/save.js";
import { createUpdateKind } from "./kinds/update.js";

/** @typedef {import("./types.js").AiTaskKind} AiTaskKind */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */

/**
 * Every kind of AI task. A check calls its owner directly: this package sits above them all.
 * @param {object} dependencies
 * @param {SessionsService} dependencies.sessions
 * @returns {Record<string, AiTaskKind>}
 */
function createAiTaskKinds({ sessions }) {
  const kinds = [createUpdateKind({ sessions }), createSaveKind({ sessions })];
  return Object.freeze(Object.fromEntries(kinds.map(kind => [kind.id, kind])));
}

export { createAiTaskKinds };
