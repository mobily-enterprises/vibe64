// The session agent's `vibe64-helper pages` command: it publishes an HTML file
// or a folder as one of the project's pages, updates a page with a new version,
// and lists them. The wrapper reads the files with the agent's own access and
// sends them to the installed pages service, which owns storage and limits.
import path from "node:path";

import { vibe64Error } from "@local/vibe64-core/server/core";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { vibe64ErrorResponse } from "@local/vibe64-core/server/serverResponses";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

import { createAgentCommandProjectBinding } from "./agentCommandProjectBinding.js";
import { commandLineFailure } from "./commandFailure.js";
import { conversationActorMetadata } from "./conversationActor.js";
import {
  createSessionCommandServers,
  unixCommandSocketPath
} from "./unixJsonCommand.js";
import { writeExecutableFileIfChanged } from "./writeExecutableFileIfChanged.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-runtime/server/types").Vibe64SessionStore} Vibe64SessionStore */
/** @typedef {import("./types.js").AgentPagesCommandService} AgentPagesCommandService */

const AGENT_PAGES_COMMAND_NAME = "vibe64-pages";
const AGENT_PAGES_COMMAND_SOCKET_NAME = "pages-command.sock";
const AGENT_PAGES_COMMAND_CONTRACT_VERSION = "1";
// A page's files travel as base64: the pages service's 20 MiB, and room to spare.
const AGENT_PAGES_COMMAND_REQUEST_MAX_BYTES = 28 * 1024 * 1024;
const VIBE64_AGENT_PAGES_COMMAND_CONTRACT_VERSION_ENV = "VIBE64_AGENT_PAGES_COMMAND_CONTRACT_VERSION";
const VIBE64_AGENT_PAGES_COMMAND_GENERATION_ENV = "VIBE64_AGENT_PAGES_COMMAND_GENERATION";
const VIBE64_AGENT_PAGES_COMMAND_SESSION_ID_ENV = "VIBE64_AGENT_PAGES_COMMAND_SESSION_ID";
const VIBE64_AGENT_PAGES_COMMAND_SOCKET_ENV = "VIBE64_AGENT_PAGES_COMMAND_SOCKET";
const VIBE64_AGENT_PAGES_COMMAND_TOKEN_ENV = "VIBE64_AGENT_PAGES_COMMAND_TOKEN";

function wrapperHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PAGES_COMMAND_NAME);
}

/** The command's socket, under this server process's temporary directory. */
function commandSocketHostPath(wrapperHostDir = "") {
  return unixCommandSocketPath(path.join(wrapperHostDir, AGENT_PAGES_COMMAND_SOCKET_NAME), { env: process.env });
}

function usageText() {
  return [
    "Usage:",
    "  vibe64-helper pages publish <file.html | folder> [--title \"Title\"] [--json]",
    "  vibe64-helper pages update <page-id> <file.html | folder> [--title \"Title\"] [--json]",
    "  vibe64-helper pages revert <page-id> <version> [--json]",
    "  vibe64-helper pages list [--json]",
    "  vibe64-helper pages guide",
    "",
    "Read the guide before writing a page: how to build one from Vibe64's stylesheet so it looks finished.",
    "A page is one HTML file, or a folder with an index.html and its own scripts, styles, data and images.",
    "It runs sandboxed: it can load only its own files, never other addresses or Vibe64 itself.",
    "Link _vibe64/page.css for Vibe64's colours, font, light and dark modes and page components.",
    "Everyone with access to the project can open a page: never put secrets in one.",
    "Publish and update print the page's link first; give it in the chat as a Markdown link.",
    "Update a current page instead of publishing a second one about the same thing; list shows them.",
    "A page keeps its last ten versions; revert brings an earlier one back as the newest (list --json shows them)."
  ].join("\n") + "\n";
}

/**
 * The command line, as both the wrapper (to find the files to read) and the
 * service read it. The wrapper embeds this function's source.
 * @param {unknown} args
 */
function parsePagesArgs(args) {
  const values = Array.isArray(args) ? args.map((arg) => String(arg ?? "")) : [];
  const parsed = { help: false, json: false, positionals: [], title: null, unsupportedFlag: "" };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help" || value === "-h") {
      parsed.help = true;
    } else if (value === "--json") {
      parsed.json = true;
    } else if (value === "--title") {
      parsed.title = values[index + 1] ?? "";
      index += 1;
    } else if (value.startsWith("--title=")) {
      parsed.title = value.slice("--title=".length);
    } else if (value.startsWith("-")) {
      parsed.unsupportedFlag ||= value;
    } else {
      parsed.positionals.push(value);
    }
  }
  const command = (parsed.positionals[0] || "").trim().toLowerCase();
  return {
    ...parsed,
    command,
    help: parsed.help || command === "help",
    source: command === "publish" ? parsed.positionals[1] || "" : command === "update" ? parsed.positionals[2] || "" : ""
  };
}

function usageFailure(message, code) {
  return commandLineFailure(message, code, { exitCode: 2, stderr: `${message}\n\n${usageText()}` });
}

function validateCommand(parsed) {
  if (parsed.unsupportedFlag) {
    return usageFailure(`Unsupported option: ${parsed.unsupportedFlag}`, "vibe64_agent_pages_command_option_unsupported");
  }
  if (!parsed.command || parsed.help) return { exitCode: 0, ok: true, stdout: usageText() };
  const expected = { guide: 1, list: 1, publish: 2, revert: 3, update: 3 }[parsed.command];
  if (!expected || parsed.positionals.length !== expected) {
    return usageFailure("The pages command accepts publish, update, revert, list or guide.", "vibe64_agent_pages_command_usage");
  }
  if (parsed.title !== null && (!["publish", "update"].includes(parsed.command) || !parsed.title.trim())) {
    return usageFailure("--title takes a title, for publish or update.", "vibe64_agent_pages_command_title_usage");
  }
  if (parsed.command === "revert" && !/^[1-9]\d{0,8}$/u.test(parsed.positionals[2])) {
    return usageFailure("revert takes the page id and the version number to bring back.", "vibe64_agent_pages_command_version_usage");
  }
  return null;
}

function commandWrapperSource() {
  return `#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";

const commandName = path.basename(process.argv[1] || "");
const expectedVersion = ${JSON.stringify(AGENT_PAGES_COMMAND_CONTRACT_VERSION)};
const socketPath = String(process.env.${VIBE64_AGENT_PAGES_COMMAND_SOCKET_ENV} || "").trim();
const sessionId = String(process.env.${VIBE64_AGENT_PAGES_COMMAND_SESSION_ID_ENV} || "").trim();
const token = String(process.env.${VIBE64_AGENT_PAGES_COMMAND_TOKEN_ENV} || "").trim();
const generationId = String(process.env.${VIBE64_AGENT_PAGES_COMMAND_GENERATION_ENV} || "").trim();
const version = String(process.env.${VIBE64_AGENT_PAGES_COMMAND_CONTRACT_VERSION_ENV} || "").trim();
// The pages service checks the exact limits; these stop reading early.
const MAX_FILES = 500;
const MAX_BYTES = 20 * 1024 * 1024;

function fail(message, code = 1) {
  process.stderr.write(String(message || "Vibe64 pages command failed.") + "\\n");
  process.exit(code);
}

${parsePagesArgs.toString()}

function requestSocket(body) {
  const requestBody = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(requestBody),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: "/agent-pages-command/run",
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

async function readPageSource(source) {
  const root = path.resolve(source);
  const stat = await fs.stat(root).catch(() => fail("There is no file or folder at " + source + ".", 2));
  if (stat.isFile()) {
    if (!/\\.html?$/iu.test(root)) fail("Publish an HTML file, or a folder with an index.html.", 2);
    if (stat.size > MAX_BYTES) fail("A page holds at most 20 MiB.", 2);
    return {
      fallbackTitle: path.basename(root).replace(/\\.html?$/iu, "").replace(/[-_]+/gu, " ").trim(),
      files: [{ path: "index.html", base64: (await fs.readFile(root)).toString("base64") }]
    };
  }
  if (!stat.isDirectory()) fail("Publish an HTML file, or a folder with an index.html.", 2);
  const files = [];
  let total = 0;
  async function walk(folder, prefix) {
    const entries = (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relative = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isSymbolicLink()) fail(relative + " is a link; a page folder holds only its own files.", 2);
      if (entry.isDirectory()) {
        await walk(path.join(folder, entry.name), relative);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= MAX_FILES) fail("A page holds at most " + MAX_FILES + " files.", 2);
      const content = await fs.readFile(path.join(folder, entry.name));
      total += content.length;
      if (total > MAX_BYTES) fail("A page holds at most 20 MiB.", 2);
      files.push({ path: relative, base64: content.toString("base64") });
    }
  }
  await walk(root, "");
  return { fallbackTitle: path.basename(root).replace(/[-_]+/gu, " ").trim(), files };
}

if (commandName !== ${JSON.stringify(AGENT_PAGES_COMMAND_NAME)}) fail("Unsupported Vibe64 pages command wrapper.");
if (!socketPath || !sessionId || !token || !generationId) fail("Vibe64 pages command identity is unavailable for this session.");
if (version !== expectedVersion) fail("Vibe64 pages command contract does not match this session.");

const args = process.argv.slice(2);
const parsed = parsePagesArgs(args);
const page = parsed.source && !parsed.help && !parsed.unsupportedFlag ? await readPageSource(parsed.source) : {};
const responseText = await requestSocket({
  args,
  ...page,
  generationId,
  sessionId,
  token
}).catch((error) => fail(error?.message || error));
let payload;
try {
  payload = JSON.parse(responseText || "{}");
} catch {
  fail("Vibe64 pages command returned invalid JSON.");
}
if (payload.stdout) process.stdout.write(String(payload.stdout).endsWith("\\n") ? String(payload.stdout) : String(payload.stdout) + "\\n");
if (payload.stderr) process.stderr.write(String(payload.stderr).endsWith("\\n") ? String(payload.stderr) : String(payload.stderr) + "\\n");
else if (payload.ok === false && payload.error) process.stderr.write(String(payload.error) + "\\n");
process.exit(Number.isInteger(payload.exitCode) ? payload.exitCode : (payload.ok === false ? 1 : 0));
`;
}

const commandServers = createSessionCommandServers({
  routePrefix: "/agent-pages-command",
  routes: {
    "/agent-pages-command/run": { handle: ({ commandService, input }) => commandService.run(input) }
  },
  label: "pages",
  maxBytes: AGENT_PAGES_COMMAND_REQUEST_MAX_BYTES,
  invalidJsonError: { code: "vibe64_agent_pages_command_invalid_json", message: "Vibe64 pages command input must be valid JSON." },
  tooLargeError: { code: "vibe64_agent_pages_command_input_too_large", message: "Vibe64 pages command input is too large." },
  notFound: commandLineFailure("Unknown Vibe64 pages command route.", "vibe64_agent_pages_command_route_not_found"),
  rejection: {
    statusCode: 409,
    payload: commandLineFailure(
      "Managed pages control generation is no longer current. Reconnect the assistant.",
      "vibe64_agent_control_unavailable",
      { messageCode: "vibe64_agent_pages_control_stale" }
    )
  },
  requestFailure: {
    fallbackCode: "vibe64_agent_pages_command_request_failed",
    fallbackMessage: "Vibe64 pages command request failed."
  },
  errorBody: (payload) => ({ ...payload, exitCode: 1, stderr: `${payload.error}\n` })
});

/**
 * Who a page from this session is by: the person behind its latest message,
 * else whoever runs Vibe64 here.
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 */
async function pageAuthor(store, sessionId) {
  const turns = await store.readConversationTail(sessionId, { userLimit: 3 });
  const metadata = turns.findLast((turn) => turn?.user && turn.metadata?.actorId && turn.metadata.actorId !== "app")?.metadata;
  const actor = metadata || await conversationActorMetadata();
  return { id: toText(actor.actorId), name: toText(actor.actorDisplayName) };
}

function pageLine(page) {
  return [page.id, page.title, `version ${page.version}`, `updated ${page.updatedAt}`, page.archived ? "archived" : "", page.link]
    .filter(Boolean).join("  ");
}

function publishedText(done, page) {
  return [
    page.link,
    `${done} Page ${page.id} is now at version ${page.version}.`,
    `Give it in the chat as: [${page.title}](${page.link})`
  ].join("\n") + "\n";
}

/**
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {() => object | null} dependencies.readPages the installed pages service, or null without one
 */
function createAgentPagesCommandService({ logger, project, readPages }) {
  const projectBinding = createAgentCommandProjectBinding(project, {
    sessionRequired: ["Vibe64 pages command session id is required.", "vibe64_agent_pages_command_session_required"],
    projectRequired: [
      "Vibe64 pages command could not bind this session to a project.",
      "vibe64_agent_pages_command_project_required"
    ],
    unbound: ["This pages command is not bound to an active session.", "vibe64_agent_pages_command_session_unbound"],
    changed: [
      "Vibe64 pages command session project no longer matches its bound project.",
      "vibe64_agent_pages_command_project_binding_changed"
    ]
  });

  async function bindSession(sessionId = "") {
    const binding = await projectBinding.bind(sessionId);
    return {
      ok: true,
      projectContextRoot: binding.projectContextRoot,
      projectSlug: binding.projectSlug,
      sessionId: toText(sessionId)
    };
  }

  async function runPagesCommand(parsed, input, sessionId) {
    const pages = readPages();
    if (!pages) throw vibe64Error("Vibe64 pages are unavailable here.", "vibe64_agent_pages_command_unavailable");
    if (parsed.command === "guide") return { guide: await pages.designGuide() };
    return projectBinding.run(sessionId, async () => {
      if (parsed.command === "list") return pages.listPages();
      const store = await project.createSessionStore({ sessionId });
      const by = await pageAuthor(store, sessionId);
      const title = parsed.title?.trim() || "";
      if (parsed.command === "publish") {
        return pages.publishPage({ title, fallbackTitle: toText(input.fallbackTitle), files: input.files, by, sessionId });
      }
      if (parsed.command === "revert") {
        return pages.restorePageVersion({ pageId: parsed.positionals[1], version: Number(parsed.positionals[2]), by, sessionId });
      }
      return pages.updatePage({ pageId: parsed.positionals[1], title, files: input.files, by, sessionId });
    });
  }

  function commandOutput(parsed, payload) {
    if (parsed.json) return `${JSON.stringify(payload, null, 2)}\n`;
    if (parsed.command === "guide") return payload.guide;
    if (parsed.command === "list") {
      const current = payload.pages.filter((page) => !page.archived);
      const archived = payload.pages.filter((page) => page.archived);
      if (!payload.pages.length) return "This project has no pages yet.\n";
      return [...current, ...archived].map(pageLine).join("\n") + "\n";
    }
    const done = {
      publish: `Published "${payload.page.title}".`,
      revert: `Brought back version ${parsed.positionals[2]} of "${payload.page.title}".`,
      update: `Updated "${payload.page.title}".`
    }[parsed.command];
    return publishedText(done, payload.page);
  }

  async function run(input = {}) {
    const startedAt = Date.now();
    const parsed = parsePagesArgs(input.args);
    const sessionId = toText(input.sessionId);
    let result;
    try {
      result = validateCommand(parsed);
      if (!result) {
        const payload = await runPagesCommand(parsed, input, sessionId);
        result = { exitCode: 0, ok: true, stdout: commandOutput(parsed, payload) };
      }
    } catch (error) {
      const payload = vibe64ErrorResponse(error, {
        fallbackCode: "vibe64_agent_pages_command_failed",
        fallbackMessage: "Vibe64 pages command failed."
      });
      result = { ...payload, exitCode: 1, stderr: `${payload.error}\n` };
    }
    logOperationalEvent(logger, result?.ok === false ? "warn" : "info", {
      code: toText(result?.code),
      command: parsed.command,
      component: "vibe64.agent_pages_command",
      durationMs: Date.now() - startedAt,
      event: "vibe64.agent_pages_command.finished",
      exitCode: Number(result?.exitCode ?? (result?.ok === false ? 1 : 0)),
      ok: result?.ok !== false,
      sessionId
    }, "Vibe64 agent pages command finished.");
    return result;
  }

  async function closeAllForSession(sessionId = "") {
    const normalizedSessionId = toText(sessionId);
    const bound = Boolean(projectBinding.forget(normalizedSessionId));
    const closed = await commandServers.closeForSession(normalizedSessionId);
    return { closed: closed + (bound && closed === 0 ? 1 : 0), ok: true };
  }

  return Object.freeze({
    bindSession,
    closeAllForSession,
    logger,
    run
  });
}

/**
 * @param {object} options
 * @param {AgentPagesCommandService} options.commandService
 * @param {string} [options.sessionId]
 * @param {string} [options.wrapperHostDir]
 */
async function prepareAgentPagesCommand({ commandService, sessionId = "", wrapperHostDir = "" }) {
  const normalizedSessionId = toText(sessionId);
  const normalizedWrapperHostDir = toText(wrapperHostDir);
  if (!normalizedSessionId || !normalizedWrapperHostDir) return { env: {}, ok: false };
  await commandService.bindSession(normalizedSessionId);
  await writeExecutableFileIfChanged(wrapperHostPath(normalizedWrapperHostDir), commandWrapperSource());
  const server = await commandServers.ensure({
    commandService,
    sessionId: normalizedSessionId,
    socketPath: commandSocketHostPath(normalizedWrapperHostDir)
  });
  return {
    env: {
      [VIBE64_AGENT_PAGES_COMMAND_CONTRACT_VERSION_ENV]: AGENT_PAGES_COMMAND_CONTRACT_VERSION,
      [VIBE64_AGENT_PAGES_COMMAND_GENERATION_ENV]: server.generationId,
      [VIBE64_AGENT_PAGES_COMMAND_SESSION_ID_ENV]: normalizedSessionId,
      [VIBE64_AGENT_PAGES_COMMAND_SOCKET_ENV]: commandSocketHostPath(normalizedWrapperHostDir),
      [VIBE64_AGENT_PAGES_COMMAND_TOKEN_ENV]: server.token
    },
    hostSocketPath: commandSocketHostPath(normalizedWrapperHostDir),
    hostWrapperPath: wrapperHostPath(normalizedWrapperHostDir),
    ok: true
  };
}

const __testables = Object.freeze({
  AGENT_PAGES_COMMAND_NAME,
  parsePagesArgs,
  VIBE64_AGENT_PAGES_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_PAGES_COMMAND_GENERATION_ENV,
  VIBE64_AGENT_PAGES_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_PAGES_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_PAGES_COMMAND_TOKEN_ENV
});

export {
  createAgentPagesCommandService,
  prepareAgentPagesCommand,
  __testables
};
