import { createDatabaseOverviewKind } from "./kinds/databaseOverview.js";
import { createPageRefreshKind } from "./kinds/pageRefresh.js";
import { createPreviewIdentityKind } from "./kinds/previewIdentity.js";
import { createProjectSetupKind } from "./kinds/projectSetup.js";
import { createRequestKinds } from "./kinds/request.js";
import { createSaveKind } from "./kinds/save.js";
import { createUpdateKind } from "./kinds/update.js";
import { createWorkspaceSetupKind } from "./kinds/workspaceSetup.js";

/** @typedef {import("./types.js").AiTaskKind} AiTaskKind */
/** @typedef {import("@local/vibe64-database-tools/server/types").DatabaseToolsService} DatabaseToolsService */
/** @typedef {import("@local/vibe64-pages/server/types").PagesService} PagesService */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

/**
 * Every kind of AI task. A check calls its owner directly: this package sits above them all.
 * @param {object} dependencies
 * @param {DatabaseToolsService} dependencies.databaseTools
 * @param {PagesService} dependencies.pages
 * @param {ProjectService} dependencies.project
 * @param {SessionsService} dependencies.sessions
 * @param {TerminalsService} dependencies.terminals
 * @returns {Record<string, AiTaskKind>}
 */
function createAiTaskKinds({ databaseTools, pages, project, sessions, terminals }) {
  const kinds = [
    createUpdateKind({ sessions }),
    createSaveKind({ sessions, terminals }),
    createWorkspaceSetupKind({ sessions }),
    createPreviewIdentityKind({ terminals }),
    createProjectSetupKind({ project }),
    createDatabaseOverviewKind({ databaseTools }),
    createPageRefreshKind({ pages }),
    ...createRequestKinds()
  ];
  return Object.freeze(Object.fromEntries(kinds.map(kind => [kind.id, kind])));
}

export { createAiTaskKinds };
