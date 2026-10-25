import mysql from "mysql2/promise";
import pg from "pg";

import { normalizeText } from "@local/vibe64-core/server/core";

// One real sign-in to the database server a project uses, with the values the
// project's processes get. Nothing counts as working unless the server
// answered, accepted the login and opened the database. Every failure becomes
// one plain sentence and a short state the screen can act on.
const CHECK_TIMEOUT_MS = 5_000;

const LABELS = Object.freeze({ mysql: "MySQL or MariaDB", postgresql: "PostgreSQL" });

function where(endpoint = {}) {
  if (endpoint.url) {
    try {
      const url = new URL(endpoint.url);
      return `${url.hostname}${url.port ? `:${url.port}` : ""}`;
    } catch {
      return "the address in your settings";
    }
  }
  return `${normalizeText(endpoint.host)}:${endpoint.port}`;
}

function nameIn(endpoint = {}, field = "") {
  if (!endpoint.url) return normalizeText(endpoint[field]);
  try {
    const url = new URL(endpoint.url);
    return decodeURIComponent(field === "database" ? url.pathname.replace(/^\/+/u, "") : url.username);
  } catch {
    return "";
  }
}

function withTimeout(promise, ms, onTimeout) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        onTimeout?.();
        reject(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }));
      }, ms);
    })
  ]).finally(() => clearTimeout(timer));
}

const NETWORK_UNREACHABLE = new Set(["EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "ECONNRESET", "EPIPE"]);

/**
 * Maps a driver error to { state, message }. States:
 * not-running, unreachable, wrong-login, login-method, database-missing,
 * no-access, invalid, failed.
 */
function describeFailure(error = {}, { kind, endpoint }) {
  const code = String(error?.code || "");
  const errno = Number(error?.errno || 0);
  const message = String(error?.message || "");
  const label = LABELS[kind] || "database";
  const user = nameIn(endpoint, "username");
  const database = nameIn(endpoint, "database");
  const address = where(endpoint);
  if (code === "ECONNREFUSED") {
    return { state: "not-running", message: `Nothing is answering at ${address}. Start your ${label} server, or put its address in the settings below.` };
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { state: "unreachable", message: `Vibe64 can't find a computer called ${normalizeText(endpoint.host) || address}. Check the host in the settings below.` };
  }
  if (NETWORK_UNREACHABLE.has(code)) {
    return { state: "unreachable", message: `${address} didn't answer in time. Check that the server is running and the host and port are right.` };
  }
  if (kind === "mysql") {
    // 1698: the account signs in only through the system account (unix_socket or auth_socket).
    if (errno === 1698 || /unix_socket|auth_socket/u.test(message)) {
      return { state: "login-method", message: `${user ? `“${user}”` : "This user"} can only sign in from the computer's own administrator account, not with a password. Create a separate user for this project with the command below.` };
    }
    if (errno === 1251 || code === "AUTH_SWITCH_PLUGIN_ERROR" || /authentication plugin|auth(?:entication)? method/iu.test(message)) {
      return { state: "login-method", message: `The server asks ${user ? `“${user}”` : "this user"} to sign in a way Vibe64 can't use. Create the user with a password, as in the command below.` };
    }
    if (errno === 1045) {
      return { state: "wrong-login", message: `The server is running, but it didn't accept the user ${user ? `“${user}”` : ""} with that password.` };
    }
    if (errno === 1049) {
      return { state: "database-missing", message: `Your login works, but there's no database called ${database} yet. Create it with the command below.` };
    }
    if (errno === 1044) {
      return { state: "no-access", message: `${user ? `“${user}”` : "This user"} can sign in but isn't allowed to use the database ${database}.` };
    }
  }
  if (kind === "postgresql") {
    if (code === "3D000") {
      return { state: "database-missing", message: `Your login works, but there's no database called ${database} yet. Create it with the command below.` };
    }
    if (code === "28P01" || /password authentication failed/iu.test(message)) {
      return { state: "wrong-login", message: `The server is running, but it didn't accept the user ${user ? `“${user}”` : ""} with that password.` };
    }
    if (/client password must be a string|password must be a string/iu.test(message)) {
      return { state: "wrong-login", message: `The server wants a password for ${user ? `“${user}”` : "this user"}. Add it in the settings below.` };
    }
    if (/(peer|ident) authentication failed/iu.test(message)) {
      return { state: "login-method", message: `${user ? `“${user}”` : "This user"} can only sign in from the computer's own account with that name, not with a password. Create a separate user for this project with the command below.` };
    }
    if (code === "28000" && /role .* does not exist/iu.test(message)) {
      return { state: "wrong-login", message: `The server is running, but it has no user called “${user}”.` };
    }
    if (code === "28000" && /pg_hba\.conf/iu.test(message)) {
      return { state: "login-method", message: `The server doesn't accept password sign-ins from this computer for ${user ? `“${user}”` : "this user"}.` };
    }
    if (code === "42501") {
      return { state: "no-access", message: `${user ? `“${user}”` : "This user"} can sign in but isn't allowed to use the database ${database}.` };
    }
  }
  if (/invalid url|invalid connection string/iu.test(message)) {
    return { state: "invalid", message: "The database address in your settings isn't a valid address." };
  }
  return { state: "failed", message: `The ${label} server answered with an error: ${message.split("\n")[0].slice(0, 200) || "unknown error"}.` };
}

async function mysqlCheck(endpoint, { timeoutMs }) {
  const options = endpoint.url
    ? { uri: endpoint.url, connectTimeout: timeoutMs }
    : {
        connectTimeout: timeoutMs,
        database: endpoint.database,
        host: endpoint.host,
        password: endpoint.password,
        port: endpoint.port,
        user: endpoint.username
      };
  let connection;
  try {
    connection = await withTimeout(mysql.createConnection(options), timeoutMs + 500);
    const [rows] = await withTimeout(connection.query("SELECT VERSION() AS version"), timeoutMs);
    const version = String(rows?.[0]?.version || "");
    return { product: /mariadb/iu.test(version) ? "MariaDB" : "MySQL", version: /^\d+(?:\.\d+)*/u.exec(version)?.[0] || version };
  } finally {
    connection?.destroy();
  }
}

function pgClient(endpoint, timeoutMs) {
  return new pg.Client(endpoint.url
    ? { connectionString: endpoint.url, connectionTimeoutMillis: timeoutMs }
    : {
        connectionTimeoutMillis: timeoutMs,
        database: endpoint.database,
        host: endpoint.host,
        password: endpoint.password,
        port: endpoint.port,
        user: endpoint.username
      });
}

async function postgresqlCheck(endpoint, { timeoutMs }) {
  const client = pgClient(endpoint, timeoutMs);
  client.on("error", () => {});
  try {
    await withTimeout(client.connect(), timeoutMs + 500, () => client.end().catch(() => {}));
    const result = await withTimeout(client.query("SHOW server_version"), timeoutMs);
    return { product: "PostgreSQL", version: String(result.rows?.[0]?.server_version || "").split(" ")[0] };
  } finally {
    await client.end().catch(() => {});
  }
}

const CHECKS = Object.freeze({
  mysql: mysqlCheck,
  postgresql: postgresqlCheck
});

/**
 * Signs in to the server with exactly these values. Resolves (never rejects)
 * to { state: "connected", product, version } or { state, message }.
 */
async function checkDatabaseServer({ endpoint, kind, timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  const check = CHECKS[kind];
  if (!check || !endpoint) {
    return { state: "incomplete", message: "Some connection settings are still empty." };
  }
  try {
    return { state: "connected", ...(await check(endpoint, { timeoutMs })) };
  } catch (error) {
    return describeFailure(error, { endpoint, kind });
  }
}

export {
  CHECK_TIMEOUT_MS,
  checkDatabaseServer,
  describeFailure
};
