import http from "node:http";
import {
  mkdir,
  rm
} from "node:fs/promises";
import path from "node:path";

import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  logOperationalEvent
} from "@local/vibe64-core/server/logging";
import {
  vibe64ErrorResponse,
  vibe64StatusCode
} from "@local/vibe64-core/server/serverResponses";

import {
  readJsonCommandRequest,
  sendJsonCommandResponse,
  shortCommandHash
} from "./unixJsonCommand.js";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";

const AGENT_DATABASE_COMMAND_NAME = "vibe64-database";
const AGENT_DATABASE_COMMAND_SOCKET_NAME = "database-command.sock";
const AGENT_DATABASE_COMMAND_CONTRACT_VERSION = "1";
const AGENT_DATABASE_COMMAND_REQUEST_MAX_BYTES = 64 * 1024;
const VIBE64_AGENT_DATABASE_COMMAND_CONTRACT_VERSION_ENV = "VIBE64_AGENT_DATABASE_COMMAND_CONTRACT_VERSION";
const VIBE64_AGENT_DATABASE_COMMAND_SESSION_ID_ENV = "VIBE64_AGENT_DATABASE_COMMAND_SESSION_ID";
const VIBE64_AGENT_DATABASE_COMMAND_SOCKET_ENV = "VIBE64_AGENT_DATABASE_COMMAND_SOCKET";
const VIBE64_AGENT_DATABASE_COMMAND_TOKEN_ENV = "VIBE64_AGENT_DATABASE_COMMAND_TOKEN";
const commandServers = new Map();

function normalizedProjectContextRoot(project = {}) {
  const root = normalizeText(project?.projectRoot || project?.path);
  return root ? path.resolve(root) : "";
}

function wrapperHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_DATABASE_COMMAND_NAME);
}

function commandSocketHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_DATABASE_COMMAND_SOCKET_NAME);
}

function usageText() {
  return [
    "Usage:",
    "  vibe64-database refresh [--json]",
    "  vibe64-database overview [--json]",
    "",
    "Run this once after a migration or any other database schema change.",
    "It refreshes the session Database tool's tables, relationships, indexes, and ERD source.",
    "Overview reads the current schema, data-overview.json grouping, coverage and authoring instructions. It does not run queries or alter data."
  ].join("\n") + "\n";
}

function responseError(message = "", code = "vibe64_agent_database_command_failed", {
  exitCode = 1,
  usage = false
} = {}) {
  return {
    code,
    error: message,
    exitCode,
    ok: false,
    stderr: `${message}\n${usage ? `\n${usageText()}` : ""}`
  };
}

function parseArgs(args = []) {
  const values = Array.isArray(args) ? args.map((arg) => String(arg || "")) : [];
  const flags = values.filter((arg) => arg.startsWith("-"));
  const positionals = values.filter((arg) => !arg.startsWith("-"));
  return {
    command: normalizeText(positionals[0]).toLowerCase(),
    help: flags.includes("--help") || flags.includes("-h") || positionals[0] === "help",
    json: flags.includes("--json"),
    positionals,
    unsupportedFlag: flags.find((flag) => !["--help", "-h", "--json"].includes(flag)) || ""
  };
}

function validateCommand(parsed = {}) {
  if (parsed.unsupportedFlag) {
    return responseError(`Unsupported option: ${parsed.unsupportedFlag}`, "vibe64_agent_database_command_usage", {
      exitCode: 2,
      usage: true
    });
  }
  if (!parsed.command || parsed.help) {
    return {
      exitCode: 0,
      ok: true,
      stdout: usageText()
    };
  }
  if (!["refresh", "overview"].includes(parsed.command) || parsed.positionals.length !== 1) {
    return responseError("The database command accepts refresh or overview.", "vibe64_agent_database_command_usage", {
      exitCode: 2,
      usage: true
    });
  }
  return null;
}

function commandWrapperSource() {
  return `#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import process from "node:process";

const commandName = path.basename(process.argv[1] || "");
const expectedVersion = ${JSON.stringify(AGENT_DATABASE_COMMAND_CONTRACT_VERSION)};
const socketPath = String(process.env.${VIBE64_AGENT_DATABASE_COMMAND_SOCKET_ENV} || "").trim();
const sessionId = String(process.env.${VIBE64_AGENT_DATABASE_COMMAND_SESSION_ID_ENV} || "").trim();
const token = String(process.env.${VIBE64_AGENT_DATABASE_COMMAND_TOKEN_ENV} || "").trim();
const version = String(process.env.${VIBE64_AGENT_DATABASE_COMMAND_CONTRACT_VERSION_ENV} || "").trim();

function fail(message, code = 1) {
  process.stderr.write(String(message || "Vibe64 database command failed.") + "\\n");
  process.exit(code);
}

function requestSocket(body) {
  const requestBody = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(requestBody),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: "/agent-database-command/run",
      socketPath
    }, (response) => {
      let responseText = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { responseText += chunk; });
      response.once("end", () => resolve(responseText));
    });
    request.once("error", reject);
    request.end(requestBody);
  });
}

if (commandName !== ${JSON.stringify(AGENT_DATABASE_COMMAND_NAME)}) fail("Unsupported Vibe64 database command wrapper.");
if (!socketPath || !sessionId || !token) fail("Vibe64 database command identity is unavailable for this session.");
if (version !== expectedVersion) fail("Vibe64 database command contract does not match this session.");

const responseText = await requestSocket({
  args: process.argv.slice(2),
  sessionId,
  token
}).catch((error) => fail(error?.message || error));
let payload;
try {
  payload = JSON.parse(responseText || "{}");
} catch {
  fail("Vibe64 database command returned invalid JSON.");
}
if (payload.stdout) process.stdout.write(String(payload.stdout).endsWith("\\n") ? String(payload.stdout) : String(payload.stdout) + "\\n");
if (payload.stderr) process.stderr.write(String(payload.stderr).endsWith("\\n") ? String(payload.stderr) : String(payload.stderr) + "\\n");
else if (payload.ok === false && payload.error) process.stderr.write(String(payload.error) + "\\n");
process.exit(Number.isInteger(payload.exitCode) ? payload.exitCode : (payload.ok === false ? 1 : 0));
`;
}

function commandServerToken({ sessionId = "", socketPath = "", wrapperHostDir = "" } = {}) {
  return shortCommandHash([
    "agent-database-command-token",
    normalizeText(sessionId),
    normalizeText(socketPath),
    normalizeText(wrapperHostDir)
  ].join("\n"));
}

async function closeCommandServersForSession(sessionId = "") {
  const normalizedSessionId = normalizeText(sessionId);
  let closed = 0;
  for (const [socketPath, entryValue] of [...commandServers.entries()]) {
    const entry = entryValue?.promise ? await entryValue.promise.catch(() => null) : entryValue;
    if (normalizeText(entry?.sessionId) !== normalizedSessionId) continue;
    if (entry?.server) {
      await new Promise((resolve) => entry.server.close(() => resolve())).catch(() => null);
      closed += 1;
    }
    commandServers.delete(socketPath);
    await rm(socketPath, { force: true }).catch(() => null);
  }
  return closed;
}

async function ensureCommandServer({ commandService, sessionId = "", wrapperHostDir = "" } = {}) {
  const socketPath = commandSocketHostPath(wrapperHostDir);
  const existing = commandServers.get(socketPath);
  if (existing?.commandService === commandService) return existing.promise || existing;
  if (existing?.promise) {
    await existing.promise.catch(() => null);
    const current = commandServers.get(socketPath);
    if (current?.commandService === commandService) return current.promise || current;
  }
  if (existing?.server) {
    await new Promise((resolve) => existing.server.close(() => resolve())).catch(() => null);
    commandServers.delete(socketPath);
  }
  const promise = (async () => {
    await mkdir(path.dirname(socketPath), { recursive: true });
    await rm(socketPath, { force: true });
    const token = commandServerToken({ sessionId, socketPath, wrapperHostDir });
    const server = http.createServer(async (request, response) => {
      try {
        if (request.method !== "POST" || request.url !== "/agent-database-command/run") {
          sendJsonCommandResponse(response, 404, responseError("Unknown Vibe64 database command route.", "vibe64_agent_database_command_route_not_found"));
          return;
        }
        const input = await readJsonCommandRequest(request, {
          invalidJsonError: { code: "vibe64_agent_database_command_invalid_json", message: "Vibe64 database command input must be valid JSON." },
          maxBytes: AGENT_DATABASE_COMMAND_REQUEST_MAX_BYTES,
          tooLargeError: { code: "vibe64_agent_database_command_input_too_large", message: "Vibe64 database command input is too large." }
        });
        if (normalizeText(input.token) !== token || normalizeText(input.sessionId) !== normalizeText(sessionId)) {
          sendJsonCommandResponse(response, 403, responseError("Vibe64 database command token is invalid.", "vibe64_agent_database_command_token_invalid"));
          return;
        }
        sendJsonCommandResponse(response, 200, await commandService.run(input));
      } catch (error) {
        const payload = vibe64ErrorResponse(error, {
          fallbackCode: "vibe64_agent_database_command_request_failed",
          fallbackMessage: "Vibe64 database command request failed."
        });
        sendJsonCommandResponse(response, vibe64StatusCode(payload), {
          ...payload,
          exitCode: 1,
          stderr: `${payload.error}\n`
        });
      }
    });
    await new Promise((resolve, reject) => {
      const handleError = (error) => reject(error);
      server.once("error", handleError);
      server.listen(socketPath, () => {
        server.off("error", handleError);
        resolve();
      });
    });
    server.unref?.();
    const stored = { commandService, server, sessionId: normalizeText(sessionId), socketPath, token };
    commandServers.set(socketPath, stored);
    return stored;
  })();
  commandServers.set(socketPath, { commandService, promise });
  try {
    return await promise;
  } catch (error) {
    if (commandServers.get(socketPath)?.promise === promise) commandServers.delete(socketPath);
    throw error;
  }
}

function createAgentDatabaseCommandService({ logger = null, projectService } = {}) {
  if (!projectService || typeof projectService.readCurrentProject !== "function" || typeof projectService.runInProjectContext !== "function") {
    throw new TypeError("createAgentDatabaseCommandService requires the Vibe64 Project API.");
  }
  const sessionProjects = new Map();
  let databaseToolsProvider = null;

  function setDatabaseToolsProvider(provider = null) {
    if (provider !== null && typeof provider?.refreshSchema !== "function") {
      throw new TypeError("The database tools provider must expose refreshSchema(), or be null.");
    }
    databaseToolsProvider = provider;
  }

  async function bindSession(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) throw vibe64Error("Vibe64 database command session id is required.", "vibe64_agent_database_command_session_required");
    const project = await projectService.readCurrentProject();
    const projectSlug = normalizeText(project?.slug || project?.name);
    if (!projectSlug) throw vibe64Error("Vibe64 database command could not bind this session to a project.", "vibe64_agent_database_command_project_required");
    const binding = {
      projectContextRoot: normalizedProjectContextRoot(project),
      projectSlug
    };
    sessionProjects.set(normalizedSessionId, binding);
    return {
      ok: true,
      projectContextRoot: binding.projectContextRoot,
      projectSlug,
      sessionId: normalizedSessionId
    };
  }

  async function runInSessionProject(sessionId = "", operation) {
    const binding = sessionProjects.get(normalizeText(sessionId));
    if (!binding?.projectSlug) {
      throw vibe64Error("This database command is not bound to an active session.", "vibe64_agent_database_command_session_unbound");
    }
    return projectService.runInProjectContext(binding.projectSlug, async () => {
      const currentProject = await projectService.readCurrentProject();
      const currentSlug = normalizeText(currentProject?.slug || currentProject?.name);
      const currentProjectContextRoot = normalizedProjectContextRoot(currentProject);
      if (
        currentSlug !== binding.projectSlug ||
        binding.projectContextRoot && currentProjectContextRoot !== binding.projectContextRoot
      ) {
        throw vibe64Error(
          "Vibe64 database command session project no longer matches its bound project.",
          "vibe64_agent_database_command_project_binding_changed"
        );
      }
      return operation(binding);
    });
  }

  async function run(input = {}) {
    const startedAt = Date.now();
    const parsed = parseArgs(input.args);
    const sessionId = normalizeText(input.sessionId);
    let result;
    try {
      result = validateCommand(parsed);
      if (!result) {
        if (!databaseToolsProvider) throw vibe64Error("The session Database tool is unavailable.", "vibe64_agent_database_command_unavailable");
        if (parsed.command === "overview") {
          const overview = await runInSessionProject(sessionId, () => databaseToolsProvider.readOverview({ sessionId }));
          if (overview?.ok === false) throw vibe64Error(overview.error, overview.code);
          result = { exitCode: 0, ok: true, stdout: `${JSON.stringify(overview, null, 2)}\n` };
        } else {
          const refreshed = await runInSessionProject(sessionId, () => databaseToolsProvider.refreshSchema({
            sessionId,
            source: "agent"
          }));
          if (refreshed?.ok === false) throw vibe64Error(refreshed.error || "Database schema refresh failed.", refreshed.code || "vibe64_agent_database_command_failed");
          const payload = {
            ok: true,
            refreshedAt: refreshed.schema?.refreshedAt || "",
            tableCount: Number(refreshed.schema?.tables?.length || 0)
          };
          result = {
            exitCode: 0,
            ok: true,
            stdout: parsed.json ? `${JSON.stringify(payload, null, 2)}\n` : `Database schema refreshed: ${payload.tableCount} tables/views.\n`
          };
        }
      }
    } catch (error) {
      const payload = vibe64ErrorResponse(error, {
        fallbackCode: "vibe64_agent_database_command_failed",
        fallbackMessage: "Vibe64 database command failed."
      });
      result = { ...payload, exitCode: 1, stderr: `${payload.error}\n` };
    }
    logOperationalEvent(logger, result?.ok === false ? "warn" : "info", {
      code: normalizeText(result?.code),
      command: parsed.command,
      component: "vibe64.agent_database_command",
      durationMs: Date.now() - startedAt,
      event: "vibe64.agent_database_command.finished",
      exitCode: Number(result?.exitCode ?? (result?.ok === false ? 1 : 0)),
      ok: result?.ok !== false,
      sessionId
    }, "Vibe64 agent database command finished.");
    return result;
  }

  async function closeAllForSession(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const bound = sessionProjects.delete(normalizedSessionId);
    const closed = await closeCommandServersForSession(normalizedSessionId);
    return { closed: closed + (bound && closed === 0 ? 1 : 0), ok: true };
  }

  return Object.freeze({ bindSession, closeAllForSession, run, setDatabaseToolsProvider });
}

async function prepareAgentDatabaseCommand({ commandService, sessionId = "", wrapperHostDir = "" } = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const normalizedWrapperHostDir = normalizeText(wrapperHostDir);
  if (!commandService || !normalizedSessionId || !normalizedWrapperHostDir) return { env: {}, ok: false };
  await commandService.bindSession(normalizedSessionId);
  await writeExecutableFileIfChanged(wrapperHostPath(normalizedWrapperHostDir), commandWrapperSource());
  const server = await ensureCommandServer({ commandService, sessionId: normalizedSessionId, wrapperHostDir: normalizedWrapperHostDir });
  return {
    env: {
      [VIBE64_AGENT_DATABASE_COMMAND_CONTRACT_VERSION_ENV]: AGENT_DATABASE_COMMAND_CONTRACT_VERSION,
      [VIBE64_AGENT_DATABASE_COMMAND_SESSION_ID_ENV]: normalizedSessionId,
      [VIBE64_AGENT_DATABASE_COMMAND_SOCKET_ENV]: commandSocketHostPath(normalizedWrapperHostDir),
      [VIBE64_AGENT_DATABASE_COMMAND_TOKEN_ENV]: server.token
    },
    hostSocketPath: commandSocketHostPath(normalizedWrapperHostDir),
    hostWrapperPath: wrapperHostPath(normalizedWrapperHostDir),
    ok: true
  };
}

export {
  AGENT_DATABASE_COMMAND_NAME,
  VIBE64_AGENT_DATABASE_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_DATABASE_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_DATABASE_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_DATABASE_COMMAND_TOKEN_ENV,
  createAgentDatabaseCommandService,
  prepareAgentDatabaseCommand
};
