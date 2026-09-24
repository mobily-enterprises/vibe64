import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { vibe64AssistantSelectionFromMetadata, vibe64AgentExecutionProfileAuditSnapshot } from "@local/vibe64-runtime/shared";
import {
  logOperationalEvent
} from "@local/vibe64-core/server/logging";
import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  DATABASE_TOOL_ENVIRONMENT_CONTRACT
} from "@local/vibe64-project/server/resourceEnvironment";
import {
  databaseAssistantAvailability,
  DATABASE_ASSISTANT_EXECUTION_PROFILE,
  runDatabaseAssistant
} from "./assistant.js";
import {
  resolveDatabaseConnection,
  withSessionKnex
} from "./connection.js";
import {
  inspectDatabaseSchema
} from "./databaseDialect.js";
import {
  searchDatabaseLookup
} from "./lookup.js";
import {
  cancelDatabaseQuery,
  deleteDatabaseRow,
  executeDatabaseQuery,
  insertDatabaseRow,
  updateDatabaseCell
} from "./queryExecutor.js";
import {
  deleteSnippet as deleteStoredSnippet,
  actorKey,
  readErdLayout,
  readSchemaSnapshot,
  readWorkspace,
  recordQueryHistory,
  saveErdLayout,
  saveLookupDisplayColumn,
  saveSnippet as saveStoredSnippet,
  writeSchemaSnapshot
} from "./sessionState.js";
import {
  quoteQualifiedTable
} from "./sqlPolicy.js";
import { dataOverviewDefinition, dataOverviewReference, readDataOverview } from "./dataOverview.js";
import { inspectErdLayout, moveErdTables } from "./erdLayout.js";
import { DATA_OVERVIEW_INSTRUCTIONS, DATA_OVERVIEW_MAX_BYTES, DATA_OVERVIEW_PATH, dataOverviewCoverage, validateDataOverview } from "../shared/dataOverview.js";

function databaseResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_database_operation_failed",
    fallbackMessage: "The session database operation failed."
  });
}

function databaseError(message, code, details = {}) {
  const error = vibe64Error(message, code);
  error.details = details;
  return error;
}

function actorId(vibe64User = null) {
  return normalizeText(
    vibe64User?.username ||
    vibe64User?.id ||
    vibe64User?.email ||
    "local-owner"
  );
}

function safeConnectionDescriptor(connection = {}, context = {}) {
  return {
    resourceId: (context.resources || []).find(({ resource }) => resource.kind === connection.engine)?.resource.id || "",
    client: connection.client,
    database: connection.database,
    developmentDatabaseScope: context.developmentDatabaseScope || "",
    engine: connection.engine,
    label: connection.label,
    sourceLabel: normalizeText(context.source?.label)
  };
}

function defaultQuery(table = {}, engine = "postgresql") {
  return `SELECT *\nFROM ${quoteQualifiedTable(table, engine)};`;
}

function historyEntry(sql = "", result = {}, readOnly = true) {
  return {
    affectedRows: Number(result.affectedRows || 0),
    durationMs: Number(result.durationMs || 0),
    kind: result.kind || "",
    ok: result.ok !== false,
    readOnly,
    sql
  };
}

function auditSql(sql = "") {
  return String(sql || "").slice(0, 32 * 1024);
}

function createService({
  logger = null,
  projectService,
  publishLayoutChanged = async () => {},
  sourceEditor = null,
  terminalService = null,
  withKnex = withSessionKnex
} = {}) {
  if (
    !projectService ||
    typeof projectService.createSessionStore !== "function" ||
    typeof projectService.sessionDatabaseEnvironment !== "function"
  ) {
    throw new TypeError("createService requires the Vibe64 Project API with session database resolution.");
  }
  if (typeof withKnex !== "function") {
    throw new TypeError("createService requires a Knex session operation boundary.");
  }

  const activeQueries = new Map();
  const activeAssistants = new Set();

  async function assistantDecision(context) {
    const workflowEngineId = assistantRoutingFromMetadata(context.session.metadata)?.workflowEngineId ||
      vibe64AssistantSelectionFromMetadata(context.session.metadata).engineId;
    return terminalService.resolveAssistantPurpose({ purpose: "database_assistant", workflowEngineId }, {
      session: context.session, vibe64User: context.vibe64User
    });
  }

  async function cleanupAssistant(runtime, sessionId, artifact, vibe64User) {
    const saved = await runtime.store.readArtifact(sessionId, artifact);
    const helper = saved ? JSON.parse(saved) : null;
    if (!helper) return;
    const root = path.join(runtime.stateRoot, "assistant-helpers", helper.scope.id);
    if (!/^database_[a-f0-9-]+$/u.test(helper.scope.id) || helper.scope.workdir !== path.join(root, "workdir") ||
        helper.scope.runtimeRoot !== path.join(root, "runtime")) throw new Error("The database helper has invalid cleanup paths.");
    const result = await terminalService.deleteEphemeralAgentConversation(helper.scope, {
      conversationId: helper.conversationId, cleanupExecutionId: helper.executionId,
      ...(helper.executionProfile ? { executionProfile: helper.executionProfile } : {})
    }, { assistantSelection: helper.selection, vibe64User });
    if (result?.ok !== true) throw databaseError(result?.error || "The database helper could not be closed. Retry cleanup before asking again.",
      result?.code || "vibe64_database_assistant_cleanup_failed");
    await runtime.store.mutateSession(sessionId, (paths) => rm(path.join(paths.artifactsRoot, artifact), { force: true }));
    await rm(root, { recursive: true, force: true });
  }

  async function closeAssistantsForSession(sessionId) {
    const scope = currentProjectScopeKey();
    const tasks = [...activeAssistants].filter((task) => task.sessionId === sessionId && task.projectScope === scope);
    for (const task of tasks) task.controller.abort();
    const queries = activeQueries.get(`${scope}\0${normalizeText(sessionId)}`);
    await Promise.allSettled([...(queries?.values() || [])].filter((query) => query.cancel).map((query) => query.cancel()));
    await Promise.allSettled(tasks.map((task) => task.promise));
    const runtime = await projectService.createRuntime({ inspectSource: false });
    const files = await runtime.store.withReadableSessionPaths(sessionId, async (paths) => {
      try { return await readdir(path.join(paths.artifactsRoot, "database/assistant-tasks")); }
      catch (error) { if (error.code === "ENOENT") return []; throw error; }
    });
    for (const file of files) if (/^[a-f0-9]{20}\.json$/u.test(file)) {
      await cleanupAssistant(runtime, sessionId, `database/assistant-tasks/${file}`, null);
    }
    return { ok: true };
  }

  function sessionQueries(sessionId = "") {
    const key = `${currentProjectScopeKey()}\0${normalizeText(sessionId)}`;
    if (!activeQueries.has(key)) {
      activeQueries.set(key, new Map());
    }
    return activeQueries.get(key);
  }

  function releaseSessionQueries(sessionId = "", queries) {
    const key = `${currentProjectScopeKey()}\0${normalizeText(sessionId)}`;
    if (queries?.size === 0 && activeQueries.get(key) === queries) {
      activeQueries.delete(key);
    }
  }

  function executeSessionQuery(context, { queryId, readOnly = true, schema, sql, signal }) {
    const endpoint = readOnly ? context.readEndpoint : context.writeEndpoint;
    return withKnex(endpoint, async ({ connection, knex }) => {
      const queries = sessionQueries(context.sessionId);
      try {
        return await executeDatabaseQuery({
          activeQueries: queries,
          connection,
          knex,
          queryId,
          signal,
          readOnly,
          schema,
          sql
        });
      } finally {
        releaseSessionQueries(context.sessionId, queries);
      }
    });
  }

  async function sessionContext(input = {}) {
    const sessionId = normalizeText(input.sessionId);
    if (!sessionId) {
      throw databaseError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    }
    const store = await projectService.createSessionStore();
    const session = await store.readSession(sessionId);
    const database = await projectService.sessionDatabaseEnvironment({
      session,
      sessionId
    });
    const toolEnvironment = database.databaseToolEnvironment;
    if (toolEnvironment?.contract !== DATABASE_TOOL_ENVIRONMENT_CONTRACT) {
      throw databaseError(
        "The selected session has no canonical database-tool connection.",
        "vibe64_session_database_unavailable"
      );
    }
    const readEndpoint = {
      kind: toolEnvironment.kind,
      ...toolEnvironment.read
    };
    const writeEndpoint = {
      kind: toolEnvironment.kind,
      ...toolEnvironment.write
    };
    const readConnection = resolveDatabaseConnection(readEndpoint);
    const writeConnection = resolveDatabaseConnection(writeEndpoint);
    return {
      ...database,
      actor: actorId(input.vibe64User),
      readConnection,
      readEndpoint,
      session,
      sessionId,
      store,
      vibe64User: input.vibe64User || null,
      writeEndpoint,
      writeConnection
    };
  }

  function logOperation(context = {}, fields = {}, level = "info") {
    logOperationalEvent(logger, level, {
      actor: context.actor,
      component: "vibe64-database-tools",
      database: context.writeConnection?.database,
      engine: context.writeConnection?.engine,
      event: "vibe64.database.operation",
      sessionId: context.sessionId,
      ...fields
    }, "Vibe64 session database operation");
  }

  async function refreshSchema(context, source = "user") {
    const startedAt = Date.now();
    try {
      const schema = await withKnex(context.readEndpoint, ({ connection, knex }) => (
        inspectDatabaseSchema({ connection, knex })
      ));
      await writeSchemaSnapshot(context.store, context.sessionId, schema);
      logOperation(context, {
        durationMs: Date.now() - startedAt,
        operation: "schema.refresh",
        source,
        status: "succeeded",
        tableCount: schema.tables.length
      });
      return schema;
    } catch (error) {
      logOperation(context, {
        code: error?.code,
        durationMs: Date.now() - startedAt,
        operation: "schema.refresh",
        source,
        status: "failed"
      }, "warn");
      throw error;
    }
  }

  async function currentSchema(context, { initialize = true } = {}) {
    const schema = await readSchemaSnapshot(context.store, context.sessionId);
    const matchesConnection = schema &&
      schema.engine === context.readConnection.engine &&
      schema.database === context.readConnection.database;
    if (matchesConnection || !initialize) {
      return schema;
    }
    return refreshSchema(
      context,
      schema ? "database-identity-changed" : "initial-missing-snapshot"
    );
  }

  function assertWriteQueryConfirmed(context, input = {}) {
    if (input.writeUnlocked !== true || input.confirmed !== true) {
      throw databaseError(
        "Unlock writes and confirm this statement before running it.",
        "vibe64_database_write_confirmation_required"
      );
    }
    if (normalizeText(input.confirmationDatabase) !== context.writeConnection.database) {
      throw databaseError(
        "The write confirmation does not match the selected session database.",
        "vibe64_database_write_target_mismatch",
        {
          database: context.writeConnection.database
        }
      );
    }
  }

  async function runMutation(input, operation, audit = {}) {
    const context = await sessionContext(input);
    const schema = await currentSchema(context);
    const startedAt = Date.now();
    try {
      const result = await withKnex(context.writeEndpoint, ({ knex }) => operation({
        context,
        knex,
        schema
      }));
      logOperation(context, {
        affectedRows: Number(result.affectedRows || 0),
        durationMs: Date.now() - startedAt,
        status: "succeeded",
        ...audit
      });
      return result;
    } catch (error) {
      logOperation(context, {
        code: error?.code,
        durationMs: Date.now() - startedAt,
        status: "failed",
        ...audit
      }, "warn");
      throw error;
    }
  }

  return Object.freeze({
    async readOverview(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        const schema = await currentSchema(context);
        const overview = await readDataOverview(context.session);
        const reference = (value) => dataOverviewReference(schema, value);
        const relationships = schema.relationships.map((relationship) => ({ ...relationship, reference: reference(relationship.id) }));
        const coverage = dataOverviewCoverage({
          tables: schema.tables.map((table) => ({ qualifiedName: reference(table.qualifiedName) })),
          relationships: relationships.map((relationship) => ({ id: relationship.reference }))
        }, overview.definition);
        return {
          ok: true, overview, coverage, valid: !overview.error && !coverage.missing.length && !coverage.missingRelationships.length,
          instructions: DATA_OVERVIEW_INSTRUCTIONS,
          schema: {
            database: schema.database, engine: schema.engine, refreshedAt: schema.refreshedAt,
            tables: schema.tables.map((table) => ({
              reference: reference(table.qualifiedName), qualifiedName: table.qualifiedName, kind: table.kind, comment: table.comment,
              keys: table.keys,
              columns: table.columns.map((column) => ({ name: column.name, nativeType: column.nativeType, nullable: column.nullable, comment: column.comment }))
            })),
            relationships
          }
        };
      });
    },
    async readState(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        const schema = await currentSchema(context);
        const [layout, workspace, overview] = await Promise.all([
          readErdLayout(context.store, context.sessionId, context.vibe64User),
          readWorkspace(context.store, context.sessionId, context.vibe64User),
          readDataOverview(context.session, schema)
        ]);
        let decision;
        try { decision = await assistantDecision(context); }
        catch (error) { decision = { available: false, message: error.message }; }
        return {
          assistant: databaseAssistantAvailability(decision),
          connection: safeConnectionDescriptor(context.writeConnection, context),
          defaultQuery: schema.tables[0]
            ? defaultQuery(schema.tables[0], schema.engine)
            : "",
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
    },

    async refreshSchema(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        const schema = await refreshSchema(context, normalizeText(input.source) || "user");
        await publishLayoutChanged(context.sessionId, context.session);
        return {
          ok: true,
          schema
        };
      });
    },

    async saveOverview(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        const schema = await currentSchema(context);
        const definition = validateDataOverview(dataOverviewDefinition(schema, validateDataOverview(input.definition)));
        const resolvedDefinition = dataOverviewDefinition(schema, definition, { qualified: true });
        const text = `${JSON.stringify(definition, null, 2)}\n`;
        if (Buffer.byteLength(text) > DATA_OVERVIEW_MAX_BYTES) {
          throw databaseError("Data overview is larger than 256 KiB.", "vibe64_database_overview_invalid");
        }
        const current = await readDataOverview(context.session);
        if (current.present && (!input.baseHash || input.baseHash !== current.hash)) {
          throw databaseError("The data overview changed. Reload it before saving your grouping.", "vibe64_database_overview_conflict");
        }
        if (!current.present && input.baseHash) {
          throw databaseError("The data overview was removed. Reload it before saving.", "vibe64_database_overview_conflict");
        }
        const payload = { sessionId: context.sessionId, path: DATA_OVERVIEW_PATH, text, baseHash: current.hash, vibe64User: context.vibe64User };
        const result = current.present ? await sourceEditor.saveFile(payload) : await sourceEditor.createFile(payload);
        if (result.ok === false) return result;
        await publishLayoutChanged(context.sessionId, context.session);
        return { ok: true, overview: { path: DATA_OVERVIEW_PATH, present: true, hash: result.file.hash, error: "", definition: resolvedDefinition } };
      });
    },

    async runQuery(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        const schema = await currentSchema(context);
        const readOnly = input.readOnly !== false;
        const automaticDefault = input.automatic === true && schema.tables.some((table) => (
          String(input.sql || "").trim() === defaultQuery(table, schema.engine)
        ));
        if (!readOnly) {
          assertWriteQueryConfirmed(context, input);
        }
        const startedAt = Date.now();
        try {
          const result = await executeSessionQuery(context, {
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
          }
          if (!automaticDefault) {
            logOperation(context, {
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
          logOperation(context, {
            code: error?.code,
            durationMs: Date.now() - startedAt,
            operation: "query.run",
            queryId: normalizeText(input.queryId),
            readOnly,
            sql: auditSql(input.sql),
            status: "failed"
          }, "warn");
          throw error;
        }
      });
    },

    async cancelQuery(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        const queries = sessionQueries(context.sessionId);
        const result = await cancelDatabaseQuery(queries, input.queryId);
        releaseSessionQueries(context.sessionId, queries);
        logOperation(context, {
          cancelled: result.cancelled,
          operation: "query.cancel",
          queryId: result.queryId,
          status: "succeeded"
        });
        return result;
      });
    },

    async updateCell(input = {}) {
      return databaseResult(() => runMutation(input, ({ knex, schema }) => updateDatabaseCell({
        edit: input.edit,
        knex,
        schema,
        value: input.value
      }), {
        operation: "cell.update",
        table: input.edit?.table
      }));
    },

    async insertRow(input = {}) {
      return databaseResult(() => runMutation(input, ({ knex, schema }) => insertDatabaseRow({
        knex,
        schema,
        table: input.table,
        values: input.values
      }), {
        operation: "row.insert",
        table: input.table
      }));
    },

    async deleteRow(input = {}) {
      return databaseResult(() => runMutation(input, ({ knex, schema }) => deleteDatabaseRow({
        confirmed: input.confirmed,
        key: input.key,
        knex,
        schema,
        table: input.table
      }), {
        operation: "row.delete",
        table: input.table
      }));
    },

    async searchLookup(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        const schema = await currentSchema(context);
        const preferred = normalizeText(input.displayColumn) || (
          await readWorkspace(context.store, context.sessionId, context.vibe64User)
        ).lookupDisplayColumns?.[normalizeText(input.relationshipId)] || "";
        const result = await withKnex(context.readEndpoint, ({ connection, knex }) => (
          searchDatabaseLookup({
            displayColumn: preferred,
            engine: connection.engine,
            knex,
            relationshipId: input.relationshipId,
            schema,
            search: input.search
          })
        ));
        if (normalizeText(input.displayColumn)) {
          await saveLookupDisplayColumn(
            context.store,
            context.sessionId,
            context.vibe64User,
            input.relationshipId,
            result.displayColumn
          );
        }
        return result;
      });
    },

    async readErd(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        const schema = await currentSchema(context);
        const layout = await readErdLayout(context.store, context.sessionId, input.vibe64User);
        const { inspection } = inspectErdLayout(schema, layout);
        return { ok: true, ...inspection };
      });
    },

    async moveErdTables(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        const schema = await currentSchema(context);
        const current = await readErdLayout(context.store, context.sessionId, input.vibe64User);
        const moved = moveErdTables(schema, current, input.changes);
        const { routes, inspection } = inspectErdLayout(schema, moved.layout);
        const layout = await saveErdLayout(context.store, context.sessionId, { ...moved.layout, routes }, {
          expectedRevision: input.changes.revision
        });
        await publishLayoutChanged(context.sessionId, context.session);
        return { ok: true, ...inspection, revision: layout.revision, previousMoves: moved.previousMoves };
      });
    },

    async saveLayout(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        const layout = await saveErdLayout(context.store, context.sessionId, input.layout);
        await publishLayoutChanged(context.sessionId, context.session);
        return {
          layout,
          ok: true
        };
      });
    },

    async saveSnippet(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
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
    },

    async deleteSnippet(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
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
    },

    askAssistant(input = {}) {
      const task = { sessionId: normalizeText(input.sessionId), projectScope: currentProjectScopeKey(),
        actor: actorKey(input.vibe64User), controller: new AbortController() };
      task.promise = databaseResult(async () => {
        if (
          typeof terminalService?.deleteEphemeralAgentConversation !== "function" ||
          typeof terminalService?.resolveAssistantPurpose !== "function" ||
          typeof terminalService?.runEphemeralAgentChatTurn !== "function"
        ) {
          throw databaseError(
            "The selected session assistant is not available for the database copilot.",
            "vibe64_database_assistant_unavailable"
          );
        }
        if ([...activeAssistants].some((other) => other !== task && other.sessionId === task.sessionId &&
            other.projectScope === task.projectScope && other.actor === task.actor)) {
          throw databaseError("Wait for your current database question to finish.", "vibe64_database_assistant_busy");
        }
        const context = await sessionContext(input);
        task.controller.signal.throwIfAborted();
        const decision = await assistantDecision(context);
        if (!decision.available) throw databaseError(decision.message, decision.reasonCode);
        const runtime = await projectService.createRuntime({ inspectSource: false });
        const admitted = await runtime.store.runSessionExclusive(context.sessionId, `database-assistant-${task.actor}`, async () => {
          const schema = await currentSchema(context);
          const artifact = `database/assistant-tasks/${task.actor}.json`;
          await cleanupAssistant(runtime, context.sessionId, artifact, context.vibe64User);
          task.controller.signal.throwIfAborted();
          const id = `database_${randomUUID()}`;
          const root = path.join(runtime.stateRoot, "assistant-helpers", id);
          const helper = { scope: { id, environment: {}, runtimeRoot: path.join(root, "runtime"), workdir: path.join(root, "workdir"),
            stableContext: "Answer only from the supplied database information. You have no tools or project access." },
            selection: decision.effectiveSelection, connectionIdentity: decision.connectionIdentity,
            conversationId: "", runId: "", executionId: "" };
          const retain = () => runtime.store.writeJsonArtifact(context.sessionId, artifact, helper);
          await retain();
          let cleanupAttempted = false;
          const cleanup = async () => {
            cleanupAttempted = true;
            await cleanupAssistant(runtime, context.sessionId, artifact, context.vibe64User);
            return { ok: true };
          };
          const options = { assistantSelection: helper.selection, vibe64User: context.vibe64User,
            expectedConnectionIdentity: helper.connectionIdentity, signal: task.controller.signal,
            async onEvent(event) {
              if (event.type === "thread") helper.conversationId = event.threadId;
              else if (event.type === "turn") helper.runId = event.turnId;
              else if (event.type === "helper-execution") helper.executionId = event.executionId;
              else return;
              await retain();
            } };
          const startedAt = Date.now();
          try {
            await mkdir(helper.scope.workdir, { recursive: true, mode: 0o700 });
            await mkdir(helper.scope.runtimeRoot, { recursive: true, mode: 0o700 });
            const profile = await terminalService.resolveEphemeralAgentExecutionProfile(helper.scope, { ...DATABASE_ASSISTANT_EXECUTION_PROFILE }, options);
            helper.executionProfile = vibe64AgentExecutionProfileAuditSnapshot(profile);
            await retain();
            task.controller.signal.throwIfAborted();
            const result = await runDatabaseAssistant({
              agentContext: options,
              assistant: databaseAssistantAvailability(decision),
              deleteThread: cleanup,
              executeReadQuery: (sql) => {
                task.controller.signal.throwIfAborted();
                return executeSessionQuery(context, { schema, sql, signal: task.controller.signal });
              },
              messages: input.messages,
              runAgentTurn: (turnInput, turnOptions) => terminalService.runEphemeralAgentChatTurn(helper.scope,
                { ...turnInput, executionProfile: profile }, turnOptions),
              schema
            });
            logOperation(context, {
              durationMs: Date.now() - startedAt,
              model: result.model,
              operation: "assistant.ask",
              queryCount: result.queries.length,
              schemaLookupCount: result.schemaLookups.length,
              status: "succeeded"
            });
            return result;
          } catch (error) {
            logOperation(context, {
              code: error?.code,
              durationMs: Date.now() - startedAt,
              operation: "assistant.ask",
              status: "failed"
            }, "warn");
            throw error;
          } finally {
            if (!cleanupAttempted) await cleanup();
          }
        });
        if (!admitted.acquired) throw databaseError(admitted.value?.error || "The session is unavailable for a database question.",
          admitted.value?.code || "vibe64_database_assistant_busy");
        return admitted.value;
      }).finally(() => activeAssistants.delete(task));
      activeAssistants.add(task);
      return task.promise;
    },

    closeAssistantsForSession,

    async close() {
      const tasks = [...activeAssistants];
      for (const task of tasks) task.controller.abort();
      const queries = [...activeQueries.values()].flatMap((session) => [...session.values()]);
      await Promise.allSettled(queries.filter((query) => query.cancel).map((query) => query.cancel()));
      activeQueries.clear();
      await Promise.allSettled(tasks.map((task) => task.promise));
    }
  });
}

export {
  createService,
  defaultQuery
};
