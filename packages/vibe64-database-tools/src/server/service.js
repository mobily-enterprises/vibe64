// readable-check: allow no-direct-knex - infrastructure: the database tool's service over a project's own database
import { databaseAssistantAvailability } from "./assistant.js";
import { createDatabaseAssistantTasks } from "./assistantTasks.js";
import { databaseError } from "./databaseError.js";
import { databaseResult } from "./databaseResult.js";
import { withSessionKnex } from "./connection.js";
import {
  searchDatabaseLookup
} from "./lookup.js";
import {
  deleteDatabaseRow,
  insertDatabaseRow,
  updateDatabaseCell
} from "./queryExecutor.js";
import {
  deleteSnippet as deleteStoredSnippet,
  readErdLayout,
  readWorkspace,
  recordQueryHistory,
  saveErdLayout,
  saveSnippet as saveStoredSnippet
} from "./sessionState.js";
import { createSessionDatabase } from "./sessionDatabase.js";
import { createSessionQueries } from "./sessionQueries.js";
import {
  dataOverviewDefinition,
  dataOverviewReference,
  qualifiedDataOverviewDefinition,
  readDataOverview
} from "./dataOverview.js";
import { inspectErdLayout, moveErdLayoutTables } from "./erdLayout.js";
import { defaultTableQuery } from "../shared/sqlQuoting.js";
import {
  DATA_OVERVIEW_INSTRUCTIONS,
  DATA_OVERVIEW_MAX_BYTES,
  DATA_OVERVIEW_PATH,
  dataOverviewCoverage,
  validateDataOverview
} from "../shared/dataOverview.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-source-editor/server/types").SourceEditorService} SourceEditorService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {ReturnType<typeof import("./events.js").createDatabaseLayoutChangedPublisher>} PublishLayoutChanged */

function safeConnectionDescriptor(connection, context) {
  return {
    resourceId: (context.resources || []).find(({ resource }) => resource.kind === connection.engine)?.resource.id || "",
    client: connection.client,
    database: connection.database,
    developmentDatabaseScope: context.developmentDatabaseScope || "",
    engine: connection.engine,
    label: connection.label,
    sourceLabel: toText(context.source?.label)
  };
}

function historyEntry(sql, result, readOnly) {
  return {
    affectedRows: Number(result.affectedRows || 0),
    durationMs: Number(result.durationMs || 0),
    kind: result.kind || "",
    ok: result.ok !== false,
    readOnly,
    sql
  };
}

function auditSql(sql) {
  return String(sql || "").slice(0, 32 * 1024);
}

/**
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {PublishLayoutChanged} dependencies.publishLayoutChanged
 * @param {SourceEditorService} dependencies.sourceEditor
 * @param {TerminalsService} dependencies.terminals
 * @param {typeof withSessionKnex} [dependencies.withKnex]
 */
function createService({
  logger,
  project,
  publishLayoutChanged,
  sourceEditor,
  terminals,
  withKnex = withSessionKnex
}) {
  const sessionDatabase = createSessionDatabase({
    logger,
    project,
    withKnex
  });
  const sessionQueries = createSessionQueries({ withKnex });
  const assistantTasks = createDatabaseAssistantTasks({
    logger,
    project,
    sessionDatabase,
    sessionQueries,
    terminals
  });

  function checkServer(input) {
    return databaseResult(() => sessionDatabase.checkServer(input));
  }

  async function readOverview(input) {
    return databaseResult(async () => {
      const context = await sessionDatabase.sessionContext(input);
      const schema = await sessionDatabase.currentSchema(context);
      const overview = await readDataOverview(context.session);
      const reference = (value) => dataOverviewReference(schema, value);
      const relationships = schema.relationships.map((relationship) => ({ ...relationship, reference: reference(relationship.id) }));
      const coverage = dataOverviewCoverage({
        tables: schema.tables.map((table) => ({ qualifiedName: reference(table.qualifiedName) })),
        relationships: relationships.map((relationship) => ({ id: relationship.reference }))
      }, overview.definition);
      return {
        ok: true,
        overview,
        coverage,
        valid: !overview.error && !coverage.missing.length && !coverage.missingRelationships.length,
        instructions: DATA_OVERVIEW_INSTRUCTIONS,
        schema: {
          database: schema.database,
          engine: schema.engine,
          refreshedAt: schema.refreshedAt,
          tables: schema.tables.map((table) => ({
            reference: reference(table.qualifiedName),
            qualifiedName: table.qualifiedName,
            kind: table.kind,
            comment: table.comment,
            keys: table.keys,
            columns: table.columns.map((column) => ({
              name: column.name,
              nativeType: column.nativeType,
              nullable: column.nullable,
              comment: column.comment
            }))
          })),
          relationships
        }
      };
    });
  }

  async function readState(input) {
    return databaseResult(async () => {
      const context = await sessionDatabase.sessionContext(input);
      const schema = await sessionDatabase.currentSchema(context);
      const [layout, workspace, overview] = await Promise.all([
        readErdLayout(context.store, context.sessionId),
        readWorkspace(context.store, context.sessionId, context.vibe64User),
        readDataOverview(context.session, schema)
      ]);
      let decision;
      try {
        decision = await assistantTasks.assistantDecision(context);
      } catch (error) {
        decision = { available: false, message: error.message };
      }
      return {
        activeQueries: sessionQueries.list(context.sessionId),
        assistant: databaseAssistantAvailability(decision),
        connection: safeConnectionDescriptor(context.writeConnection, context),
        layout,
        overview,
        ok: true,
        schema,
        workspace,
        writeAccess: {
          available: true,
          confirmationDatabase: context.writeConnection.database,
          unlocked: false
        }
      };
    });
  }

  async function refreshSchema(input) {
    return databaseResult(async () => {
      const context = await sessionDatabase.sessionContext(input);
      const schema = await sessionDatabase.refreshSchema(context, toText(input.source) || "user");
      await publishLayoutChanged(context.sessionId, context.session);
      return {
        ok: true,
        schema
      };
    });
  }

  async function saveOverview(input) {
    return databaseResult(async () => {
      const context = await sessionDatabase.sessionContext(input);
      const schema = await sessionDatabase.currentSchema(context);
      const definition = validateDataOverview(dataOverviewDefinition(schema, validateDataOverview(input.definition)));
      const resolvedDefinition = qualifiedDataOverviewDefinition(schema, definition);
      const text = `${JSON.stringify(definition, null, 2)}\n`;
      if (Buffer.byteLength(text) > DATA_OVERVIEW_MAX_BYTES) {
        throw databaseError("Data overview is larger than 256 KiB.", "vibe64_database_overview_invalid");
      }
      const current = await readDataOverview(context.session);
      if (current.present && (!input.baseHash || input.baseHash !== current.hash)) {
        throw databaseError("The data overview changed. Reload it before saving your grouping.", "vibe64_database_overview_conflict", {}, {
          messageCode: "vibe64_database_overview_changed"
        });
      }
      if (!current.present && input.baseHash) {
        throw databaseError("The data overview was removed. Reload it before saving.", "vibe64_database_overview_conflict", {}, {
          messageCode: "vibe64_database_overview_removed"
        });
      }
      const payload = {
        sessionId: context.sessionId,
        path: DATA_OVERVIEW_PATH,
        text,
        baseHash: current.hash,
        vibe64User: context.vibe64User
      };
      const result = current.present ? await sourceEditor.saveFile(payload) : await sourceEditor.createFile(payload);
      if (result.ok === false) return result;
      await publishLayoutChanged(context.sessionId, context.session);
      return {
        ok: true,
        overview: { path: DATA_OVERVIEW_PATH, present: true, hash: result.file.hash, error: "", definition: resolvedDefinition }
      };
    });
  }

  async function runQuery(input) {
    return databaseResult(async () => {
      const context = await sessionDatabase.sessionContext(input);
      const schema = await sessionDatabase.currentSchema(context);
      const readOnly = input.readOnly !== false;
      const automaticDefault = input.automatic === true && schema.tables.some((table) => (
        String(input.sql || "").trim() === defaultTableQuery(table, schema.engine)
      ));
      if (!readOnly) {
        sessionDatabase.assertWriteQueryConfirmed(context, input);
      }
      const startedAt = Date.now();
      try {
        const result = await sessionQueries.execute(context, {
          queryId: input.queryId,
          readOnly,
          schema,
          sql: input.sql
        });
        if (!automaticDefault) {
          await recordQueryHistory(
            context.store,
            context.sessionId,
            context.vibe64User,
            historyEntry(input.sql, result, readOnly)
          );
          sessionDatabase.logOperation(context, {
            affectedRows: Number(result.affectedRows || 0),
            durationMs: result.durationMs,
            operation: "query.run",
            queryId: result.queryId,
            readOnly,
            sql: auditSql(input.sql),
            status: "succeeded"
          });
        }
        return result;
      } catch (error) {
        if (!automaticDefault) {
          await recordQueryHistory(
            context.store,
            context.sessionId,
            context.vibe64User,
            historyEntry(input.sql, {
              durationMs: Date.now() - startedAt,
              kind: "error",
              ok: false
            }, readOnly)
          ).catch(() => null);
        }
        // Failures are logged even for the automatic default-table load.
        sessionDatabase.logOperation(context, {
          code: error?.code,
          durationMs: Date.now() - startedAt,
          operation: "query.run",
          queryId: toText(input.queryId),
          readOnly,
          sql: auditSql(input.sql),
          status: "failed"
        }, "warn");
        throw error;
      }
    });
  }

  async function cancelQuery(input) {
    return databaseResult(async () => {
      const context = await sessionDatabase.sessionContext(input);
      const result = await sessionQueries.cancel(context.sessionId, input.queryId);
      sessionDatabase.logOperation(context, {
        cancelled: result.cancelled,
        operation: "query.cancel",
        queryId: result.queryId,
        status: "succeeded"
      });
      return result;
    });
  }

  async function updateCell(input) {
    return databaseResult(() => sessionDatabase.runMutation(input, ({ knex, schema }) => updateDatabaseCell({
      edit: input.edit,
      knex,
      schema,
      value: input.value
    }), {
      operation: "cell.update",
      table: input.edit?.table
    }));
  }

  async function insertRow(input) {
    return databaseResult(() => sessionDatabase.runMutation(input, ({ knex, schema }) => insertDatabaseRow({
      knex,
      schema,
      table: input.table,
      values: input.values
    }), {
      operation: "row.insert",
      table: input.table
    }));
  }

  async function deleteRow(input) {
    return databaseResult(() => sessionDatabase.runMutation(input, ({ knex, schema }) => deleteDatabaseRow({
      confirmed: input.confirmed,
      key: input.key,
      knex,
      schema,
      table: input.table
    }), {
      operation: "row.delete",
      table: input.table
    }));
  }

  async function searchLookup(input) {
    return databaseResult(async () => {
      const context = await sessionDatabase.sessionContext(input);
      const schema = await sessionDatabase.currentSchema(context);
      return withKnex(context.readEndpoint, ({ connection, knex }) => (
        searchDatabaseLookup({
          engine: connection.engine,
          knex,
          relationshipId: input.relationshipId,
          schema,
          search: input.search
        })
      ));
    });
  }

  async function readErd(input) {
    return databaseResult(async () => {
      const context = await sessionDatabase.sessionContext(input);
      const schema = await sessionDatabase.currentSchema(context);
      const layout = await readErdLayout(context.store, context.sessionId);
      const { inspection } = inspectErdLayout(schema, layout);
      return { ok: true, ...inspection };
    });
  }

  async function moveErdTables(input) {
    return databaseResult(async () => {
      const context = await sessionDatabase.sessionContext(input);
      const schema = await sessionDatabase.currentSchema(context);
      const current = await readErdLayout(context.store, context.sessionId);
      const moved = moveErdLayoutTables(schema, current, input.changes);
      const { routes, inspection } = inspectErdLayout(schema, moved.layout);
      const layout = await saveErdLayout(context.store, context.sessionId, { ...moved.layout, routes }, {
        expectedRevision: input.changes.revision
      });
      await publishLayoutChanged(context.sessionId, context.session);
      return { ok: true, ...inspection, revision: layout.revision, previousMoves: moved.previousMoves };
    });
  }

  async function saveLayout(input) {
    return databaseResult(async () => {
      const context = await sessionDatabase.sessionContext(input);
      const layout = await saveErdLayout(context.store, context.sessionId, input.layout);
      await publishLayoutChanged(context.sessionId, context.session);
      return {
        layout,
        ok: true
      };
    });
  }

  async function saveSnippet(input) {
    return databaseResult(async () => {
      const context = await sessionDatabase.sessionContext(input);
      return {
        ok: true,
        workspace: await saveStoredSnippet(
          context.store,
          context.sessionId,
          context.vibe64User,
          input.snippet
        )
      };
    });
  }

  async function deleteSnippet(input) {
    return databaseResult(async () => {
      const context = await sessionDatabase.sessionContext(input);
      return {
        ok: true,
        workspace: await deleteStoredSnippet(
          context.store,
          context.sessionId,
          context.vibe64User,
          input.snippetId
        )
      };
    });
  }

  async function close() {
    const assistantsSettled = assistantTasks.abortAll();
    await sessionQueries.cancelAll();
    await assistantsSettled;
  }

  return Object.freeze({
    checkServer,
    readOverview,
    readState,
    refreshSchema,
    saveOverview,
    runQuery,
    cancelQuery,
    updateCell,
    insertRow,
    deleteRow,
    searchLookup,
    readErd,
    moveErdTables,
    saveLayout,
    saveSnippet,
    deleteSnippet,
    askAssistant: assistantTasks.askAssistant,
    closeAssistantsForSession: assistantTasks.closeAssistantsForSession,
    closeRenewalAssistantsForSession: assistantTasks.closeRenewalAssistantsForSession,
    close
  });
}

export {
  createService
};
