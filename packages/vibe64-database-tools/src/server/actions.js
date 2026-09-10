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

function action({ execute, id, input, kind = "command" }) {
  return Object.freeze({
    audit: {
      actionName: id
    },
    events: [],
    execute,
    id,
    idempotency: kind === "query" ? "none" : "optional",
    input,
    kind,
    observability: {},
    output: null,
    version: 1
  });
}

function createDatabaseActions({ databaseTools } = {}) {
  if (!databaseTools) {
    throw new TypeError("createDatabaseActions requires databaseTools.");
  }
  return Object.freeze([
    action({
      execute: (input) => databaseTools.saveOverview(input),
      id: ACTION_DATABASE_OVERVIEW_SAVE,
      input: databaseOverviewInputValidator
    }),
    action({
      execute: (input) => databaseTools.readState(input),
      id: ACTION_DATABASE_STATE_READ,
      input: databaseStateInputValidator,
      kind: "query"
    }),
    action({
      execute: (input) => databaseTools.refreshSchema(input),
      id: ACTION_DATABASE_SCHEMA_REFRESH,
      input: databaseRefreshInputValidator
    }),
    action({
      execute: (input) => databaseTools.runQuery(input),
      id: ACTION_DATABASE_QUERY_RUN,
      input: databaseQueryInputValidator
    }),
    action({
      execute: (input) => databaseTools.cancelQuery(input),
      id: ACTION_DATABASE_QUERY_CANCEL,
      input: databaseCancelInputValidator
    }),
    action({
      execute: (input) => databaseTools.updateCell(input),
      id: ACTION_DATABASE_CELL_UPDATE,
      input: databaseCellUpdateInputValidator
    }),
    action({
      execute: (input) => databaseTools.insertRow(input),
      id: ACTION_DATABASE_ROW_INSERT,
      input: databaseRowInsertInputValidator
    }),
    action({
      execute: (input) => databaseTools.deleteRow(input),
      id: ACTION_DATABASE_ROW_DELETE,
      input: databaseRowDeleteInputValidator
    }),
    action({
      execute: (input) => databaseTools.searchLookup(input),
      id: ACTION_DATABASE_LOOKUP_SEARCH,
      input: databaseLookupInputValidator,
      kind: "query"
    }),
    action({
      execute: (input) => databaseTools.saveLayout(input),
      id: ACTION_DATABASE_LAYOUT_SAVE,
      input: databaseLayoutInputValidator
    }),
    action({
      execute: (input) => databaseTools.saveSnippet(input),
      id: ACTION_DATABASE_SNIPPET_SAVE,
      input: databaseSnippetSaveInputValidator
    }),
    action({
      execute: (input) => databaseTools.deleteSnippet(input),
      id: ACTION_DATABASE_SNIPPET_DELETE,
      input: databaseSnippetDeleteInputValidator
    }),
    action({
      execute: (input) => databaseTools.askAssistant(input),
      id: ACTION_DATABASE_ASSISTANT_ASK,
      input: databaseAssistantInputValidator
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
  ACTION_DATABASE_SNIPPET_DELETE,
  ACTION_DATABASE_SNIPPET_SAVE,
  ACTION_DATABASE_STATE_READ,
  createDatabaseActions
};
