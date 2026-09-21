import knexFactory from "knex";
import path from "node:path";
import { SQLiteClient } from "./sqliteClient.js";

import {
  vibe64Error
} from "@local/vibe64-core/server/core";

import {
  databaseDialect
} from "./databaseDialect.js";

const DATABASE_POOL_MAX = 3;
const DATABASE_POOL_ACQUIRE_TIMEOUT_MS = 8_000;

function text(value = "") {
  return String(value ?? "").trim();
}

function urlProtocol(value = "") {
  if (!value) {
    return "";
  }
  try {
    return new URL(value).protocol.replace(/:$/u, "").toLowerCase();
  } catch {
    throw vibe64Error(
      "The session database URL is invalid.",
      "vibe64_session_database_url_invalid"
    );
  }
}

function databaseNameFromUrl(connectionUrl = "") {
  if (!connectionUrl) {
    return "";
  }
  try {
    return decodeURIComponent(new URL(connectionUrl).pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

function safeConnectionUrl(connectionUrl = "", engine = "") {
  if (!connectionUrl) {
    return connectionUrl;
  }
  return databaseDialect(engine).sanitizeConnectionUrl(connectionUrl);
}

function structuredConnection(endpoint = {}, dialect = {}) {
  const host = text(endpoint.host);
  const database = text(endpoint.database);
  const user = text(endpoint.username);
  const password = String(endpoint.password ?? "");
  const port = Number(endpoint.port);
  if (!host || !database || !user || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw vibe64Error(
      "The session database configuration is incomplete.",
      "vibe64_session_database_configuration_incomplete"
    );
  }
  return {
    database,
    host,
    password,
    port,
    user,
    ...dialect.connectionOptions()
  };
}

function resolveDatabaseConnection(endpoint = {}) {
  const dialect = databaseDialect(endpoint.kind);
  if (dialect.engine === "sqlite") {
    if (!path.isAbsolute(text(endpoint.database)) || text(endpoint.database).includes("\0") ||
        typeof endpoint.readOnly !== "boolean" ||
        Object.keys(endpoint).some((name) => !["kind", "database", "readOnly"].includes(name))) {
      throw vibe64Error("SQLite requires an absolute filename and explicit access mode.", "vibe64_session_database_configuration_incomplete");
    }
    return Object.freeze({
      client: dialect.client,
      connection: { filename: endpoint.database, readOnly: endpoint.readOnly },
      database: path.basename(endpoint.database),
      engine: dialect.engine,
      label: dialect.label
    });
  }
  const connectionUrl = text(endpoint.url);
  if (connectionUrl) {
    const protocol = urlProtocol(connectionUrl);
    if (!dialect.urlProtocols.includes(protocol) || Object.keys(endpoint).some((name) => !["kind", "url"].includes(name))) {
      throw vibe64Error(
        "The canonical database-tool URL does not match its declared database kind.",
        "vibe64_session_database_url_kind_mismatch"
      );
    }
  } else if (Object.keys(endpoint).some((name) => ![
    "database",
    "host",
    "kind",
    "password",
    "port",
    "username"
  ].includes(name))) {
    throw vibe64Error(
      "The canonical database-tool connection contains unsupported fields.",
      "vibe64_session_database_connection_invalid"
    );
  }
  const name = connectionUrl
    ? databaseNameFromUrl(connectionUrl)
    : text(endpoint.database);
  if (!name) {
    throw vibe64Error(
      "The session database name is missing.",
      "vibe64_session_database_name_missing"
    );
  }
  return Object.freeze({
    client: dialect.client,
    connection: connectionUrl
      ? safeConnectionUrl(connectionUrl, dialect.engine)
      : structuredConnection(endpoint, dialect),
    database: name,
    engine: dialect.engine,
    label: dialect.label
  });
}

function createSessionKnex(connection = {}) {
  return knexFactory({
    acquireConnectionTimeout: DATABASE_POOL_ACQUIRE_TIMEOUT_MS,
    client: connection.engine === "sqlite" ? SQLiteClient : connection.client,
    connection: connection.connection,
    ...(connection.engine === "sqlite" ? { useNullAsDefault: true } : {}),
    pool: {
      idleTimeoutMillis: 10_000,
      max: connection.engine === "sqlite" ? 1 : DATABASE_POOL_MAX,
      min: 0
    }
  });
}

async function withSessionKnex(endpoint = {}, operation) {
  if (typeof operation !== "function") {
    throw new TypeError("withSessionKnex requires an operation.");
  }
  const connection = resolveDatabaseConnection(endpoint);
  const knex = createSessionKnex(connection);
  try {
    return await operation({
      connection,
      knex
    });
  } finally {
    await knex.destroy();
  }
}

export {
  DATABASE_POOL_ACQUIRE_TIMEOUT_MS,
  DATABASE_POOL_MAX,
  createSessionKnex,
  resolveDatabaseConnection,
  safeConnectionUrl,
  withSessionKnex
};
