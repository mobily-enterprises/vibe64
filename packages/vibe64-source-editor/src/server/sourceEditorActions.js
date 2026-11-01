import { NOT_A_TOOL, PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";
import { integrationReadTool, integrationSetupTool } from "./integrationAssistantContracts.js";
import { sourceEditorFileCreatedEvent, sourceEditorFileSavedEvent, sourceEditorIntegrationsWrittenEvent } from "./events.js";
import {
  areaArchiveInputValidator,
  areaConflictsInputValidator,
  areaCreateInputValidator,
  areaPathInputValidator,
  areaRenameInputValidator,
  areaSaveInputValidator,
  areaTransferInputValidator,
  areaTreeInputValidator,
  areaUploadInputValidator,
  explanationInputValidator,
  explanationsCleanupInputValidator,
  integrationProvidersInputValidator,
  integrationSetupInputValidator,
  integrationsSaveInputValidator,
  n8nDiscoveryInputValidator,
  oauthClientInputValidator,
  pathResolveInputValidator,
  sessionInputValidator,
  sourceFileCreateInputValidator,
  sourceFileSaveInputValidator,
  sourcePathInputValidator,
  sourceQueryInputValidator,
  sourceTreeInputValidator,
  starSetInputValidator
} from "./inputSchemas.js";

/** @typedef {import("./types.js").SourceEditorService} SourceEditorService */

const ACTION_READ_FILE_AREAS = "vibe64.source-editor.file-areas.read";
const ACTION_READ_AREA_TREE = "vibe64.source-editor.file-area.tree";
const ACTION_READ_AREA_FILE = "vibe64.source-editor.file-area.file";
const ACTION_DOWNLOAD_AREA_FILE = "vibe64.source-editor.file-area.download";
const ACTION_DOWNLOAD_AREA_ARCHIVE = "vibe64.source-editor.file-area.archive";
const ACTION_FIND_AREA_CONFLICTS = "vibe64.source-editor.file-area.conflicts";
const ACTION_UPLOAD_AREA_FILE = "vibe64.source-editor.file-area.upload";
const ACTION_CREATE_AREA_FILE = "vibe64.source-editor.file-area.create";
const ACTION_SAVE_AREA_FILE = "vibe64.source-editor.file-area.save";
const ACTION_RENAME_AREA_ITEM = "vibe64.source-editor.file-area.rename";
const ACTION_CREATE_AREA_FOLDER = "vibe64.source-editor.file-area.mkdir";
const ACTION_DELETE_AREA_ITEM = "vibe64.source-editor.file-area.delete";
const ACTION_TRANSFER_AREA_ITEM = "vibe64.source-editor.file-area.transfer";
const ACTION_READ_INTEGRATIONS = "vibe64.source-editor.integrations.read";
const ACTION_READ_INTEGRATION_PROVIDERS = "vibe64.source-editor.integrations.providers.read";
const ACTION_DISCOVER_N8N_INTEGRATION = "vibe64.source-editor.integrations.n8n.discover";
const ACTION_SAVE_INTEGRATIONS = "vibe64.source-editor.integrations.save";
const ACTION_REGISTER_OAUTH_INTEGRATION = "vibe64.source-editor.integrations.oauth-client.register";
const ACTION_RUN_INTEGRATION_SETUP = "vibe64.source-editor.integrations.setup";
const ACTION_READ_SOURCE_TREE = "vibe64.source-editor.tree.read";
const ACTION_FIND_SOURCE_FILES = "vibe64.source-editor.files.find";
const ACTION_DOWNLOAD_SOURCE_FILE = "vibe64.source-editor.file.download";
const ACTION_READ_STARRED_FILES = "vibe64.source-editor.stars.read";
const ACTION_SET_STARRED_FILE = "vibe64.source-editor.star.set";
const ACTION_SEARCH_SOURCE = "vibe64.source-editor.search";
const ACTION_RESOLVE_SOURCE_PATH = "vibe64.source-editor.path.resolve";
const ACTION_CLEANUP_EXPLANATIONS = "vibe64.source-editor.explanations.cleanup";
const ACTION_DELETE_EXPLANATION = "vibe64.source-editor.explanation.delete";
const ACTION_STOP_EXPLANATION = "vibe64.source-editor.explanation.stop";
const ACTION_READ_SOURCE_FILE = "vibe64.source-editor.file.read";
const ACTION_CREATE_SOURCE_FILE = "vibe64.source-editor.file.create";
const ACTION_SAVE_SOURCE_FILE = "vibe64.source-editor.file.save";

/**
 * The source editor's actions. Only explicit product controls are exposed; source work stays with coding agents. A
 * saved change is announced to the editors open on its session as the action's event.
 * @param {object} dependencies
 * @param {SourceEditorService} dependencies.sourceEditor
 */
function createSourceEditorActions({ sourceEditor }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_FILE_AREAS,
      input: sessionInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readFileAreas(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_AREA_TREE,
      input: areaTreeInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readAreaTree(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_AREA_FILE,
      input: areaPathInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readAreaFile(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_DOWNLOAD_AREA_FILE,
      input: areaPathInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.downloadAreaFile(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_DOWNLOAD_AREA_ARCHIVE,
      input: areaArchiveInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.downloadAreaArchive(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_FIND_AREA_CONFLICTS,
      input: areaConflictsInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.findAreaConflicts(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_UPLOAD_AREA_FILE,
      input: areaUploadInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input, context) => sourceEditor.uploadAreaFile(input, { readUpload: context.sourceEditorUpload?.readUpload })
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CREATE_AREA_FILE,
      input: areaCreateInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.createAreaFile(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SAVE_AREA_FILE,
      input: areaSaveInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.saveAreaFile(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_RENAME_AREA_ITEM,
      input: areaRenameInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.renameAreaItem(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CREATE_AREA_FOLDER,
      input: areaPathInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.createAreaFolder(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_DELETE_AREA_ITEM,
      input: areaPathInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.deleteAreaItem(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_TRANSFER_AREA_ITEM,
      input: areaTransferInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.transferAreaItem(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_INTEGRATIONS,
      input: sessionInputValidator,
      extensions: { assistant: integrationReadTool("integrations.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readIntegrations(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_INTEGRATION_PROVIDERS,
      input: integrationProvidersInputValidator,
      extensions: { assistant: integrationReadTool("integrations.providers.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readIntegrationProviders(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_DISCOVER_N8N_INTEGRATION,
      input: n8nDiscoveryInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.discoverN8nIntegration(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SAVE_INTEGRATIONS,
      input: integrationsSaveInputValidator,
      extensions: { assistant: integrationReadTool("integrations.save"), vibe64: PROJECT_OPERATION },
      events: [sourceEditorIntegrationsWrittenEvent],
      execute: (input) => sourceEditor.saveIntegrations(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_REGISTER_OAUTH_INTEGRATION,
      input: oauthClientInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      events: [sourceEditorIntegrationsWrittenEvent],
      execute: (input) => sourceEditor.registerOAuthIntegration(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_RUN_INTEGRATION_SETUP,
      input: integrationSetupInputValidator,
      extensions: { assistant: integrationSetupTool(), vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.runIntegrationSetup(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_SOURCE_TREE,
      input: sourceTreeInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readTree(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_FIND_SOURCE_FILES,
      input: sourceQueryInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.listFiles(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_DOWNLOAD_SOURCE_FILE,
      input: sourcePathInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.downloadFile(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_STARRED_FILES,
      input: sessionInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readStarredFiles(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SET_STARRED_FILE,
      input: starSetInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.setStarredFile(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_SEARCH_SOURCE,
      input: sourceQueryInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.search(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_RESOLVE_SOURCE_PATH,
      input: pathResolveInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.resolvePath(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CLEANUP_EXPLANATIONS,
      input: explanationsCleanupInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.cleanupExplanations(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_DELETE_EXPLANATION,
      input: explanationInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.deleteExplanation(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_STOP_EXPLANATION,
      input: explanationInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.stopExplanation(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_SOURCE_FILE,
      input: sourcePathInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readFile(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CREATE_SOURCE_FILE,
      input: sourceFileCreateInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      events: [sourceEditorFileCreatedEvent],
      execute: (input) => sourceEditor.createFile(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SAVE_SOURCE_FILE,
      input: sourceFileSaveInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      events: [sourceEditorFileSavedEvent],
      execute: (input) => sourceEditor.saveFile(input)
    })
  ]);
}

export {
  ACTION_CLEANUP_EXPLANATIONS,
  ACTION_CREATE_AREA_FILE,
  ACTION_CREATE_AREA_FOLDER,
  ACTION_CREATE_SOURCE_FILE,
  ACTION_DELETE_AREA_ITEM,
  ACTION_DELETE_EXPLANATION,
  ACTION_DISCOVER_N8N_INTEGRATION,
  ACTION_DOWNLOAD_AREA_ARCHIVE,
  ACTION_DOWNLOAD_AREA_FILE,
  ACTION_DOWNLOAD_SOURCE_FILE,
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
  ACTION_TRANSFER_AREA_ITEM,
  ACTION_UPLOAD_AREA_FILE,
  createSourceEditorActions
};
