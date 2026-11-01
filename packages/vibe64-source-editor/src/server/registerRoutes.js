import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import { VIBE64_PROJECT_ROUTE_BASE, vibe64RouteHandler, vibe64RouteHttp } from "@local/vibe64-core/server/featureRoutes";
import {
  ACTION_CLEANUP_EXPLANATIONS,
  ACTION_CREATE_AREA_FILE,
  ACTION_CREATE_AREA_FOLDER,
  ACTION_CREATE_SOURCE_FILE,
  ACTION_DELETE_AREA_ITEM,
  ACTION_DELETE_EXPLANATION,
  ACTION_DISCOVER_N8N_INTEGRATION,
  ACTION_FIND_AREA_CONFLICTS,
  ACTION_FIND_SOURCE_FILES,
  ACTION_READ_AREA_FILE,
  ACTION_READ_AREA_TREE,
  ACTION_READ_FILE_AREAS,
  ACTION_READ_INTEGRATIONS,
  ACTION_READ_INTEGRATION_PROVIDERS,
  ACTION_READ_SOURCE_FILE,
  ACTION_READ_SOURCE_TREE,
  ACTION_READ_STARRED_FILES,
  ACTION_REGISTER_OAUTH_INTEGRATION,
  ACTION_RENAME_AREA_ITEM,
  ACTION_RESOLVE_SOURCE_PATH,
  ACTION_RUN_INTEGRATION_SETUP,
  ACTION_SAVE_AREA_FILE,
  ACTION_SAVE_INTEGRATIONS,
  ACTION_SAVE_SOURCE_FILE,
  ACTION_SEARCH_SOURCE,
  ACTION_SET_STARRED_FILE,
  ACTION_STOP_EXPLANATION,
  ACTION_TRANSFER_AREA_ITEM
} from "./sourceEditorActions.js";
import {
  areaBodyInput,
  areaPathQueryInput,
  areaTreeQueryInput,
  explanationBodyInput,
  integrationBodyInput,
  sessionBodyInput,
  sessionInput,
  sessionQueryInput,
  sessionSearchInput
} from "./routeInputs.js";
import { registerFileTransferRoutes } from "./fileTransferRoutes.js";
import { registerStreamRoutes } from "./streamRoutes.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */
/** @typedef {import("./types.js").SourceEditorService} SourceEditorService */

const FILE_AREA_BODY_LIMIT = 2 * 1024 * 1024;

/**
 * Session file-area routes reach every area, so project areas can be
 * destinations; project file-area routes reach only the project's areas.
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {StudioProjectContext} [options.projectContext]
 * @param {SourceEditorService} options.sourceEditor
 */
function registerRoutes(http, {
  projectContext,
  sourceEditor
}) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-source-editor"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localRequestMessage: "Vibe64 source editor routes only accept loopback Studio requests.",
      projectContext
    })
  });
  routes.actionRoute("GET", "/sessions/:sessionId/files", {
    actionId: ACTION_READ_FILE_AREAS,
    buildInput: sessionInput,
    summary: "Read the session file areas available to this caller."
  });
  routes.actionRoute("GET", "/sessions/:sessionId/files/:area/tree", {
    actionId: ACTION_READ_AREA_TREE,
    buildInput: areaTreeQueryInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("GET", "/sessions/:sessionId/files/:area/file", {
    actionId: ACTION_READ_AREA_FILE,
    buildInput: areaPathQueryInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("PUT", "/sessions/:sessionId/files/:area/file", {
    actionId: ACTION_SAVE_AREA_FILE,
    buildInput: areaBodyInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/files/:area/file", {
    actionId: ACTION_CREATE_AREA_FILE,
    buildInput: areaBodyInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/files/:area/rename", {
    actionId: ACTION_RENAME_AREA_ITEM,
    buildInput: areaBodyInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/files/:area/directory", {
    actionId: ACTION_CREATE_AREA_FOLDER,
    buildInput: areaBodyInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("DELETE", "/sessions/:sessionId/files/:area/file", {
    actionId: ACTION_DELETE_AREA_ITEM,
    buildInput: areaBodyInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/files/:area/conflicts", {
    actionId: ACTION_FIND_AREA_CONFLICTS,
    buildInput: areaBodyInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/files/:area/transfer", {
    actionId: ACTION_TRANSFER_AREA_ITEM,
    buildInput: areaBodyInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Move or copy an item between authorized file areas without downloading it."
  });
  routes.actionRoute("GET", "/project-files/:area/tree", {
    actionId: ACTION_READ_AREA_TREE,
    buildInput: areaTreeQueryInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("GET", "/project-files/:area/file", {
    actionId: ACTION_READ_AREA_FILE,
    buildInput: areaPathQueryInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("PUT", "/project-files/:area/file", {
    actionId: ACTION_SAVE_AREA_FILE,
    buildInput: areaBodyInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("POST", "/project-files/:area/file", {
    actionId: ACTION_CREATE_AREA_FILE,
    buildInput: areaBodyInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("POST", "/project-files/:area/rename", {
    actionId: ACTION_RENAME_AREA_ITEM,
    buildInput: areaBodyInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("POST", "/project-files/:area/directory", {
    actionId: ACTION_CREATE_AREA_FOLDER,
    buildInput: areaBodyInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("DELETE", "/project-files/:area/file", {
    actionId: ACTION_DELETE_AREA_ITEM,
    buildInput: areaBodyInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("POST", "/project-files/:area/conflicts", {
    actionId: ACTION_FIND_AREA_CONFLICTS,
    buildInput: areaBodyInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Access files within an authorized file area."
  });
  routes.actionRoute("POST", "/project-files/:area/transfer", {
    actionId: ACTION_TRANSFER_AREA_ITEM,
    buildInput: areaBodyInput,
    bodyLimit: FILE_AREA_BODY_LIMIT,
    summary: "Move or copy an item between authorized file areas without downloading it."
  });
  registerFileTransferRoutes(routes);

  routes.actionRoute("GET", "/sessions/:sessionId/integrations", {
    actionId: ACTION_READ_INTEGRATIONS,
    buildInput: sessionInput,
    summary: "Read portable integration configuration."
  });
  routes.actionRoute("GET", "/sessions/:sessionId/integrations/providers", {
    actionId: ACTION_READ_INTEGRATION_PROVIDERS,
    buildInput: sessionQueryInput,
    summary: "Search available integration providers."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/integrations/n8n/discovery", {
    actionId: ACTION_DISCOVER_N8N_INTEGRATION,
    buildInput: sessionBodyInput,
    bodyLimit: 4096,
    summary: "Discover public n8n OAuth metadata."
  });
  routes.actionRoute("PUT", "/sessions/:sessionId/integrations", {
    actionId: ACTION_SAVE_INTEGRATIONS,
    buildInput: sessionBodyInput,
    bodyLimit: 2 * 1024 * 1024,
    summary: "Validate and save integration configuration."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/integrations/:integrationId/oauth-client", {
    actionId: ACTION_REGISTER_OAUTH_INTEGRATION,
    buildInput: integrationBodyInput,
    bodyLimit: 2 * 1024 * 1024,
    summary: "Register a supported OAuth client and save its project configuration and private Env."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/integrations/:integrationId/setup", {
    actionId: ACTION_RUN_INTEGRATION_SETUP,
    buildInput: integrationBodyInput,
    bodyLimit: 32768,
    summary: "Run the application's declared development integration setup operation."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/source-editor/tree", {
    actionId: ACTION_READ_SOURCE_TREE,
    buildInput: sessionQueryInput,
    summary: "Read the editable source tree."
  });
  routes.actionRoute("GET", "/sessions/:sessionId/source-editor/files", {
    actionId: ACTION_FIND_SOURCE_FILES,
    buildInput: sessionSearchInput,
    summary: "Find editable source files."
  });
  routes.actionRoute("GET", "/sessions/:sessionId/source-editor/search", {
    actionId: ACTION_SEARCH_SOURCE,
    buildInput: sessionSearchInput,
    summary: "Search editable source files."
  });
  routes.actionRoute("GET", "/sessions/:sessionId/source-editor/stars", {
    actionId: ACTION_READ_STARRED_FILES,
    buildInput: sessionInput,
    summary: "Read this account's starred files."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/source-editor/stars", {
    actionId: ACTION_SET_STARRED_FILE,
    buildInput: sessionBodyInput,
    bodyLimit: 16 * 1024,
    summary: "Star or unstar a file."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/source-editor/resolve-path", {
    actionId: ACTION_RESOLVE_SOURCE_PATH,
    buildInput: sessionBodyInput,
    bodyLimit: 32 * 1024,
    summary: "Resolve a source path reference."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/source-editor/explanations/cleanup", {
    actionId: ACTION_CLEANUP_EXPLANATIONS,
    buildInput: sessionBodyInput,
    bodyLimit: 16 * 1024,
    summary: "Clean abandoned source explanation chats."
  });
  routes.actionRoute("DELETE", "/sessions/:sessionId/source-editor/explanations/:explanationId", {
    actionId: ACTION_DELETE_EXPLANATION,
    buildInput: explanationBodyInput,
    bodyLimit: 128 * 1024,
    summary: "Operate the selected temporary source explanation."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/source-editor/explanations/:explanationId/stop", {
    actionId: ACTION_STOP_EXPLANATION,
    buildInput: explanationBodyInput,
    bodyLimit: 128 * 1024,
    summary: "Operate the selected temporary source explanation."
  });
  routes.actionRoute("GET", "/sessions/:sessionId/source-editor/file", {
    actionId: ACTION_READ_SOURCE_FILE,
    buildInput: sessionQueryInput,
    summary: "Read an editable source file."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/source-editor/file", {
    actionId: ACTION_CREATE_SOURCE_FILE,
    buildInput: sessionBodyInput,
    bodyLimit: 32 * 1024,
    summary: "Create an editable source file."
  });
  routes.actionRoute("PUT", "/sessions/:sessionId/source-editor/file", {
    actionId: ACTION_SAVE_SOURCE_FILE,
    buildInput: sessionBodyInput,
    bodyLimit: 2 * 1024 * 1024,
    summary: "Autosave an editable source file."
  });

  registerStreamRoutes(routes, { sourceEditor });
}

export { registerRoutes };
