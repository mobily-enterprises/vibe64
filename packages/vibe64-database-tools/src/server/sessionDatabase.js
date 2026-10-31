import { normalizeText } from "@local/vibe64-core/server/core";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { thisComputerToolFamily } from "@local/vibe64-execution/server";
import { DATABASE_TOOL_ENVIRONMENT_CONTRACT } from "@local/vibe64-project/server/resourceEnvironment";

import { resolveDatabaseConnection } from "./connection.js";
import { databaseError } from "./databaseError.js";
import { inspectDatabaseSchema } from "./databaseDialect.js";
import { checkDatabaseServer } from "./serverCheck.js";
import { actorIdentity, readSchemaSnapshot, writeSchemaSnapshot } from "./sessionState.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

/**
 * A session's database: its read and write connections, its schema snapshot,
 * the audited writes that run on it, and the server this computer runs for it.
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.projectService
 * @param {typeof import("./connection.js").withSessionKnex} dependencies.withKnex
 */
function createSessionDatabase({ logger, projectService, withKnex }) {
  async function sessionContext(input) {
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
      actor: actorIdentity(input.vibe64User),
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

  // The database server this session's project needs and the person runs:
  // its Env names, current values, a real sign-in check and the commands for
  // this computer. Nothing when the Stack declares none or the host supplies it.
  async function checkServer(input) {
    const sessionId = normalizeText(input.sessionId);
    if (!sessionId) {
      throw databaseError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    }
    const store = await projectService.createSessionStore();
    const session = await store.readSession(sessionId);
    const servers = await projectService.localDatabaseServers({ session, sessionId });
    if (servers.managed) return { ok: true, managed: true, databases: [] };
    const family = thisComputerToolFamily();
    const databases = await Promise.all(servers.databases.map(async ({ endpoint, ...database }) => ({
      ...database,
      check: await checkDatabaseServer({ endpoint, kind: database.kind })
    })));
    return { ok: true, managed: false, family, databases };
  }

  return Object.freeze({
    assertWriteQueryConfirmed,
    checkServer,
    currentSchema,
    logOperation,
    refreshSchema,
    runMutation,
    sessionContext
  });
}

export { createSessionDatabase };
