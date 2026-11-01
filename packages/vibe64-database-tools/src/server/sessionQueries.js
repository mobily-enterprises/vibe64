import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { cancelDatabaseQuery, executeDatabaseQuery } from "./queryExecutor.js";

/**
 * The SQL each project session is running: run through the session's read or
 * write endpoint, listed, cancelled one at a time, per session or all at once.
 * @param {object} dependencies
 * @param {typeof import("./connection.js").withSessionKnex} dependencies.withKnex
 */
function createSessionQueries({ withKnex }) {
  const activeQueries = new Map();

  function sessionQueryKey(sessionId) {
    return `${currentProjectScopeKey()}\0${toText(sessionId)}`;
  }

  function sessionQueries(sessionId) {
    const key = sessionQueryKey(sessionId);
    if (!activeQueries.has(key)) {
      activeQueries.set(key, new Map());
    }
    return activeQueries.get(key);
  }

  function releaseSessionQueries(sessionId, queries) {
    const key = sessionQueryKey(sessionId);
    if (queries?.size === 0 && activeQueries.get(key) === queries) {
      activeQueries.delete(key);
    }
  }

  function execute(context, { queryId, readOnly = true, schema, sql, signal }) {
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

  function list(sessionId) {
    return [...(activeQueries.get(sessionQueryKey(sessionId)) || [])]
      .map(([queryId, query]) => ({
        queryId,
        readOnly: query.readOnly,
        startedAt: query.startedAt,
        cancellable: Boolean(query.cancel)
      }));
  }

  async function cancel(sessionId, queryId) {
    const queries = sessionQueries(sessionId);
    const result = await cancelDatabaseQuery(queries, queryId);
    releaseSessionQueries(sessionId, queries);
    return result;
  }

  async function cancelSession(sessionId) {
    const queries = activeQueries.get(sessionQueryKey(sessionId));
    await Promise.allSettled([...(queries?.values() || [])].filter((query) => query.cancel).map((query) => query.cancel()));
  }

  async function cancelAll() {
    const queries = [...activeQueries.values()].flatMap((session) => [...session.values()]);
    await Promise.allSettled(queries.filter((query) => query.cancel).map((query) => query.cancel()));
    activeQueries.clear();
  }

  return Object.freeze({
    execute,
    list,
    cancel,
    cancelSession,
    cancelAll
  });
}

export {
  createSessionQueries
};
