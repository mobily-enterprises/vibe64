import path from "node:path";

import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  logOperationalEvent
} from "@local/vibe64-core/server/logging";
import {
  vibe64ErrorResponse
} from "@local/vibe64-core/server/serverResponses";

import { createAgentCommandProjectBinding } from "./agentCommandProjectBinding.js";
import {
  createSessionCommandServers,
  unixCommandSocketPath
} from "./unixJsonCommand.js";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";

const AGENT_DATABASE_COMMAND_NAME = "vibe64-database";
const AGENT_DATABASE_COMMAND_SOCKET_NAME = "database-command.sock";
const AGENT_DATABASE_COMMAND_CONTRACT_VERSION = "1";
const AGENT_DATABASE_COMMAND_REQUEST_MAX_BYTES = 528 * 1024;
const VIBE64_AGENT_DATABASE_COMMAND_CONTRACT_VERSION_ENV = "VIBE64_AGENT_DATABASE_COMMAND_CONTRACT_VERSION";
const VIBE64_AGENT_DATABASE_COMMAND_GENERATION_ENV = "VIBE64_AGENT_DATABASE_COMMAND_GENERATION";
const VIBE64_AGENT_DATABASE_COMMAND_SESSION_ID_ENV = "VIBE64_AGENT_DATABASE_COMMAND_SESSION_ID";
const VIBE64_AGENT_DATABASE_COMMAND_SOCKET_ENV = "VIBE64_AGENT_DATABASE_COMMAND_SOCKET";
const VIBE64_AGENT_DATABASE_COMMAND_TOKEN_ENV = "VIBE64_AGENT_DATABASE_COMMAND_TOKEN";
function wrapperHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_DATABASE_COMMAND_NAME);
}

function commandSocketHostPath(wrapperHostDir = "") {
  return unixCommandSocketPath(path.join(wrapperHostDir, AGENT_DATABASE_COMMAND_SOCKET_NAME));
}

function usageText() {
  return [
    "Usage:",
    "  vibe64-helper database refresh [--json]",
    "  vibe64-helper database overview [--json]",
    "  vibe64-helper database erd [--json]",
    "  vibe64-helper database erd apply [--json] < moves.json",
    "",
    "Run this once after a migration or any other database schema change.",
    "It refreshes the session Database tool's tables, relationships, indexes, and ERD source.",
    "Overview reads the current schema, data-overview.json grouping, coverage and authoring instructions. It does not run queries or alter data.",
    "ERD reads saved table bounds, pins and routed connection paths. Its response includes the exact revision and move format. Apply accepts that revision and a batch of table moves as JSON on stdin; it changes only the session diagram."
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
  const singleCommand = ["refresh", "overview", "erd"].includes(parsed.command) && parsed.positionals.length === 1;
  const applyMoves = parsed.command === "erd" && parsed.positionals.length === 2 && parsed.positionals[1] === "apply";
  if (!singleCommand && !applyMoves) {
    return responseError("The database command accepts refresh, overview, erd or erd apply.", "vibe64_agent_database_command_usage", {
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
const generationId = String(process.env.${VIBE64_AGENT_DATABASE_COMMAND_GENERATION_ENV} || "").trim();
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
if (!socketPath || !sessionId || !token || !generationId) fail("Vibe64 database command identity is unavailable for this session.");
if (version !== expectedVersion) fail("Vibe64 database command contract does not match this session.");

const args = process.argv.slice(2);
const positionals = args.filter((arg) => !arg.startsWith("-"));
let changes;
if (positionals[0]?.trim().toLowerCase() === "erd" && positionals[1] === "apply" && !args.includes("--help") && !args.includes("-h")) {
  let source = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    source += chunk;
    if (Buffer.byteLength(source) > 512 * 1024) fail("ERD moves exceed 512 KiB.");
  }
  try { changes = JSON.parse(source); } catch { fail("Provide ERD moves as valid JSON on stdin."); }
}
const responseText = await requestSocket({
  args,
  changes,
  generationId,
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

const commandServers = createSessionCommandServers({
  routePrefix: "/agent-database-command",
  routes: {
    "/agent-database-command/run": { handle: ({ commandService, input }) => commandService.run(input) }
  },
  label: "database",
  maxBytes: AGENT_DATABASE_COMMAND_REQUEST_MAX_BYTES,
  invalidJsonError: { code: "vibe64_agent_database_command_invalid_json", message: "Vibe64 database command input must be valid JSON." },
  tooLargeError: { code: "vibe64_agent_database_command_input_too_large", message: "Vibe64 database command input is too large." },
  notFound: responseError("Unknown Vibe64 database command route.", "vibe64_agent_database_command_route_not_found"),
  rejection: {
    statusCode: 409,
    payload: responseError("Managed database control generation is no longer current. Reconnect the assistant.", "vibe64_agent_control_unavailable")
  },
  requestFailure: {
    fallbackCode: "vibe64_agent_database_command_request_failed",
    fallbackMessage: "Vibe64 database command request failed."
  },
  errorBody: (payload) => ({ ...payload, exitCode: 1, stderr: `${payload.error}\n` })
});

function createAgentDatabaseCommandService({ logger = null, projectService } = {}) {
  if (!projectService || typeof projectService.readCurrentProject !== "function" || typeof projectService.runInProjectContext !== "function") {
    throw new TypeError("createAgentDatabaseCommandService requires the Vibe64 Project API.");
  }
  const projectBinding = createAgentCommandProjectBinding(projectService, {
    sessionRequired: ["Vibe64 database command session id is required.", "vibe64_agent_database_command_session_required"],
    projectRequired: ["Vibe64 database command could not bind this session to a project.", "vibe64_agent_database_command_project_required"],
    unbound: ["This database command is not bound to an active session.", "vibe64_agent_database_command_session_unbound"],
    changed: ["Vibe64 database command session project no longer matches its bound project.", "vibe64_agent_database_command_project_binding_changed"]
  });
  let databaseToolsProvider = null;

  function setDatabaseToolsProvider(provider = null) {
    if (provider !== null && typeof provider?.refreshSchema !== "function") {
      throw new TypeError("The database tools provider must expose refreshSchema(), or be null.");
    }
    databaseToolsProvider = provider;
  }

  async function bindSession(sessionId = "") {
    const binding = await projectBinding.bind(sessionId);
    return {
      ok: true,
      projectContextRoot: binding.projectContextRoot,
      projectSlug: binding.projectSlug,
      sessionId: normalizeText(sessionId)
    };
  }

  const runInSessionProject = (sessionId, operation) => projectBinding.run(sessionId, operation);

  async function run(input = {}) {
    const startedAt = Date.now();
    const parsed = parseArgs(input.args);
    const sessionId = normalizeText(input.sessionId);
    let result;
    try {
      result = validateCommand(parsed);
      if (!result) {
        if (!databaseToolsProvider) throw vibe64Error("The session Database tool is unavailable.", "vibe64_agent_database_command_unavailable");
        if (parsed.command === "erd" || parsed.command === "overview") {
          const payload = await runInSessionProject(sessionId, () => {
            if (parsed.command === "overview") return databaseToolsProvider.readOverview({ sessionId });
            if (parsed.positionals[1] === "apply") return databaseToolsProvider.moveErdTables({ sessionId, changes: input.changes });
            return databaseToolsProvider.readErd({ sessionId });
          });
          if (payload?.ok === false) throw vibe64Error(payload.error, payload.code);
          result = { exitCode: 0, ok: true, stdout: `${JSON.stringify(payload, null, 2)}\n` };
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
    const bound = Boolean(projectBinding.forget(normalizedSessionId));
    const closed = await commandServers.closeForSession(normalizedSessionId);
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
  const server = await commandServers.ensure({
    commandService, sessionId: normalizedSessionId, socketPath: commandSocketHostPath(normalizedWrapperHostDir)
  });
  return {
    env: {
      [VIBE64_AGENT_DATABASE_COMMAND_CONTRACT_VERSION_ENV]: AGENT_DATABASE_COMMAND_CONTRACT_VERSION,
      [VIBE64_AGENT_DATABASE_COMMAND_GENERATION_ENV]: server.generationId,
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
  VIBE64_AGENT_DATABASE_COMMAND_GENERATION_ENV,
  VIBE64_AGENT_DATABASE_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_DATABASE_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_DATABASE_COMMAND_TOKEN_ENV,
  createAgentDatabaseCommandService,
  prepareAgentDatabaseCommand
};
