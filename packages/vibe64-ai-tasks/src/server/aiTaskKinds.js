import { createDatabaseOverviewKind } from "./kinds/databaseOverview.js";
import { createIncomingMergeKind } from "./kinds/incomingMerge.js";
import { createPreviewIdentityKind } from "./kinds/previewIdentity.js";
import { createProjectSetupKind } from "./kinds/projectSetup.js";
import { createSaveKind } from "./kinds/save.js";
import { createUpdateKind } from "./kinds/update.js";
import { createWorkspaceSetupKind } from "./kinds/workspaceSetup.js";

/** @typedef {import("./types.js").AiTaskKind} AiTaskKind */
/** @typedef {import("@local/vibe64-database-tools/server/types").DatabaseToolsService} DatabaseToolsService */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

/**
 * Every kind of AI task. A check calls its owner directly: this package sits above them all.
 * @param {object} dependencies
 * @param {DatabaseToolsService} dependencies.databaseTools
 * @param {ProjectService} dependencies.project
 * @param {SessionsService} dependencies.sessions
 * @param {TerminalsService} dependencies.terminals
 * @returns {Record<string, AiTaskKind>}
 */
function createAiTaskKinds({ databaseTools, project, sessions, terminals }) {
  const kinds = [
    createUpdateKind({ sessions }),
    createSaveKind({ sessions }),
    createWorkspaceSetupKind({ sessions }),
    createPreviewIdentityKind({ terminals }),
    createIncomingMergeKind({ sessions }),
    createProjectSetupKind({ project }),
    createDatabaseOverviewKind({ databaseTools })
  ];
  return Object.freeze(Object.fromEntries(kinds.map(kind => [kind.id, kind])));
}

export { createAiTaskKinds };
