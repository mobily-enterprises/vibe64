import { NOT_A_TOOL, PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
import { databaseControlTool } from "./assistantContracts.js";
import {
  databaseOverviewInputValidator,
  databaseAssistantInputValidator,
  databaseCancelInputValidator,
  databaseCellUpdateInputValidator,
  databaseLayoutInputValidator,
  databaseLookupInputValidator,
  databaseQueryInputValidator,
  databaseRefreshInputValidator,
  databaseRowDeleteInputValidator,
  databaseRowInsertInputValidator,
  databaseSnippetDeleteInputValidator,
  databaseSnippetSaveInputValidator,
  databaseStateInputValidator
} from "./inputSchemas.js";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";

/** @typedef {import("./types.js").DatabaseToolsService} DatabaseToolsService */

const ACTION_DATABASE_STATE_READ = "vibe64.database.state.read";
const ACTION_DATABASE_OVERVIEW_SAVE = "vibe64.database.overview.save";
const ACTION_DATABASE_SCHEMA_REFRESH = "vibe64.database.schema.refresh";
const ACTION_DATABASE_QUERY_RUN = "vibe64.database.query.run";
const ACTION_DATABASE_QUERY_CANCEL = "vibe64.database.query.cancel";
const ACTION_DATABASE_CELL_UPDATE = "vibe64.database.cell.update";
const ACTION_DATABASE_ROW_INSERT = "vibe64.database.row.insert";
const ACTION_DATABASE_ROW_DELETE = "vibe64.database.row.delete";
const ACTION_DATABASE_LOOKUP_SEARCH = "vibe64.database.lookup.search";
const ACTION_DATABASE_LAYOUT_SAVE = "vibe64.database.layout.save";
const ACTION_DATABASE_SNIPPET_SAVE = "vibe64.database.snippet.save";
const ACTION_DATABASE_SNIPPET_DELETE = "vibe64.database.snippet.delete";
const ACTION_DATABASE_ASSISTANT_ASK = "vibe64.database.assistant.ask";
const ACTION_DATABASE_SERVER_CHECK = "vibe64.database.server.check";

/**
 * @param {object} dependencies
 * @param {DatabaseToolsService} dependencies.databaseTools
 */
function createDatabaseActions({ databaseTools }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_DATABASE_OVERVIEW_SAVE,
      input: databaseOverviewInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => databaseTools.saveOverview(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_DATABASE_SERVER_CHECK,
      input: databaseStateInputValidator,
      extensions: {
        assistant: {
          description: "Check the MySQL/MariaDB or PostgreSQL server this session's project needs and the person runs on their own computer: the exact Env names the Stack declares, the values that apply now (Env over Stack defaults; a password only as set or not) and a real sign-in with a few seconds' timeout. check.state is connected, not-running, unreachable, wrong-login, login-method, database-missing, no-access, incomplete, invalid or failed, with one plain sentence. Use it after the person started their server, created a login or saved connection values, instead of guessing. It changes nothing: it never starts a server or creates users or databases. Save non-secret values the person gives through the Env save action; never ask for, repeat or save a password in chat, and send them to the database server panel's password field instead. managed means the host supplies the database."
        },
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => databaseTools.checkServer(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_DATABASE_STATE_READ,
      input: databaseStateInputValidator,
      extensions: { assistant: databaseControlTool("state.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => databaseTools.readState(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_DATABASE_SCHEMA_REFRESH,
      input: databaseRefreshInputValidator,
      extensions: { assistant: databaseControlTool("schema.refresh"), vibe64: PROJECT_OPERATION },
      execute: (input) => databaseTools.refreshSchema(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_DATABASE_QUERY_RUN,
      input: databaseQueryInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => databaseTools.runQuery(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_DATABASE_QUERY_CANCEL,
      input: databaseCancelInputValidator,
      extensions: { assistant: databaseControlTool("query.cancel"), vibe64: PROJECT_OPERATION },
      execute: (input) => databaseTools.cancelQuery(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_DATABASE_CELL_UPDATE,
      input: databaseCellUpdateInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => databaseTools.updateCell(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_DATABASE_ROW_INSERT,
      input: databaseRowInsertInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => databaseTools.insertRow(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_DATABASE_ROW_DELETE,
      input: databaseRowDeleteInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => databaseTools.deleteRow(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_DATABASE_LOOKUP_SEARCH,
      input: databaseLookupInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => databaseTools.searchLookup(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_DATABASE_LAYOUT_SAVE,
      input: databaseLayoutInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => databaseTools.saveLayout(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_DATABASE_SNIPPET_SAVE,
      input: databaseSnippetSaveInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => databaseTools.saveSnippet(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_DATABASE_SNIPPET_DELETE,
      input: databaseSnippetDeleteInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => databaseTools.deleteSnippet(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_DATABASE_ASSISTANT_ASK,
      input: databaseAssistantInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => databaseTools.askAssistant(input)
    })
  ]);
}

export {
  ACTION_DATABASE_OVERVIEW_SAVE,
  ACTION_DATABASE_ASSISTANT_ASK,
  ACTION_DATABASE_CELL_UPDATE,
  ACTION_DATABASE_LAYOUT_SAVE,
  ACTION_DATABASE_LOOKUP_SEARCH,
  ACTION_DATABASE_QUERY_CANCEL,
  ACTION_DATABASE_QUERY_RUN,
  ACTION_DATABASE_ROW_DELETE,
  ACTION_DATABASE_ROW_INSERT,
  ACTION_DATABASE_SCHEMA_REFRESH,
  ACTION_DATABASE_SERVER_CHECK,
  ACTION_DATABASE_SNIPPET_DELETE,
  ACTION_DATABASE_SNIPPET_SAVE,
  ACTION_DATABASE_STATE_READ,
  createDatabaseActions
};
