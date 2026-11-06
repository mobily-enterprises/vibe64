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
    "  vibe64-helper pages data <page-id> <data.json> [--json]",
    "  vibe64-helper pages refresh <page-id> (--every 30m|2h | --daily 07:30 [--time-zone Area/City]) (--command <script> | --prompt \"what to do\") [--json]",
    "  vibe64-helper pages refresh <page-id> --off [--json]",
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
    "A page keeps its last ten versions; revert brings an earlier one back as the newest (list --json shows them).",
    "data replaces only the page's data.json in a new version: the layout stays as it is.",
    "refresh keeps a page up to date on Vibe64's server, at most every 15 minutes. --command runs your script (.mjs, .js, .cjs, .py or .sh)",
    "in a fresh checkout of the saved project, with no AI and no installed packages, for at most 5 minutes; it writes the new data.json",
    "to the file $VIBE64_PAGE_DATA names. --prompt asks the AI in this session instead, for refreshes that need judgement.",
    "The guide says how to build a page that refreshes."
  ].join("\n") + "\n";
}

/**
 * The command line, as both the wrapper (to find the files to read) and the
 * service read it. The wrapper embeds this function's source.
 * @param {unknown} args
 */
function parsePagesArgs(args) {
  const values = Array.isArray(args) ? args.map((arg) => String(arg ?? "")) : [];
  const valueOptions = ["title", "every", "daily", "time-zone", "command", "prompt"];
  const parsed = { help: false, json: false, off: false, options: {}, positionals: [], unsupportedFlag: "" };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const option = /^--([a-z-]+)(?:=([\s\S]*))?$/u.exec(value);
    if (value === "--help" || value === "-h") {
      parsed.help = true;
    } else if (value === "--json") {
      parsed.json = true;
    } else if (value === "--off") {
      parsed.off = true;
    } else if (option && valueOptions.includes(option[1])) {
      if (option[2] === undefined) index += 1;
      parsed.options[option[1]] = option[2] ?? values[index] ?? "";
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
    title: Object.hasOwn(parsed.options, "title") ? parsed.options.title : null,
    source: command === "publish" ? parsed.positionals[1] || "" : command === "update" ? parsed.positionals[2] || "" : "",
    dataFile: command === "data" ? parsed.positionals[2] || "" : "",
    scriptFile: command === "refresh" ? parsed.options.command || "" : ""
  };
}

function usageFailure(message, code) {
  return commandLineFailure(message, code, { exitCode: 2, stderr: `${message}\n\n${usageText()}` });
}

/**
 * What `pages refresh` was given, or why it can't be used.
 * @param {ReturnType<typeof parsePagesArgs>} parsed
 */
function refreshUsageProblem(parsed) {
  const { options } = parsed;
  const named = Object.keys(options).filter((name) => name !== "title");
  if (parsed.off) return named.length ? "--off takes no other option." : "";
  if (Boolean(options.every) === Boolean(options.daily)) return "refresh takes --every (such as 30m or 2h) or --daily (such as 07:30).";
  if (Boolean(options.command) === Boolean(options.prompt)) return "refresh takes --command <script> or --prompt \"what to do\".";
  if (options["time-zone"] !== undefined && !options.daily) return "--time-zone goes with --daily.";
  return "";
}

function validateCommand(parsed) {
  if (parsed.unsupportedFlag) {
    return usageFailure(`Unsupported option: ${parsed.unsupportedFlag}`, "vibe64_agent_pages_command_option_unsupported");
  }
  if (!parsed.command || parsed.help) return { exitCode: 0, ok: true, stdout: usageText() };
  const expected = { data: 3, guide: 1, list: 1, publish: 2, refresh: 2, revert: 3, update: 3 }[parsed.command];
  if (!expected || parsed.positionals.length !== expected) {
    return usageFailure("The pages command accepts publish, update, revert, data, refresh, list or guide.", "vibe64_agent_pages_command_usage");
  }
  if (parsed.title !== null && (!["publish", "update"].includes(parsed.command) || !parsed.title.trim())) {
    return usageFailure("--title takes a title, for publish or update.", "vibe64_agent_pages_command_title_usage");
  }
  if (parsed.command === "refresh") {
    const problem = refreshUsageProblem(parsed);
    if (problem) return usageFailure(problem, "vibe64_agent_pages_command_refresh_usage");
  } else if (parsed.off || Object.keys(parsed.options).some((name) => name !== "title")) {
    return usageFailure("--every, --daily, --time-zone, --command, --prompt and --off go with refresh.", "vibe64_agent_pages_command_refresh_usage");
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

async function readSmallFile(source, limit, tooLarge) {
  const file = path.resolve(source);
  const stat = await fs.stat(file).catch(() => fail("There is no file at " + source + ".", 2));
  if (!stat.isFile()) fail(source + " is not a file.", 2);
  if (stat.size > limit) fail(tooLarge, 2);
  return { name: path.basename(file), base64: (await fs.readFile(file)).toString("base64") };
}

if (commandName !== ${JSON.stringify(AGENT_PAGES_COMMAND_NAME)}) fail("Unsupported Vibe64 pages command wrapper.");
if (!socketPath || !sessionId || !token || !generationId) fail("Vibe64 pages command identity is unavailable for this session.");
if (version !== expectedVersion) fail("Vibe64 pages command contract does not match this session.");

const args = process.argv.slice(2);
const parsed = parsePagesArgs(args);
const reading = !parsed.help && !parsed.unsupportedFlag;
const page = parsed.source && reading ? await readPageSource(parsed.source) : {};
const data = parsed.dataFile && reading ? { data: (await readSmallFile(parsed.dataFile, 5 * 1024 * 1024, "A page's data.json holds at most 5 MiB.")).base64 } : {};
const script = parsed.scriptFile && reading ? { script: await readSmallFile(parsed.scriptFile, 256 * 1024, "A refresh script holds at most 256 KiB.") } : {};
const responseText = await requestSocket({
  args,
  ...page,
  ...data,
  ...script,
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

/** A schedule such as "Daily at 07:30 (Europe/Rome)" inside a sentence. */
const inSentence = (schedule) => `${schedule.charAt(0).toLowerCase()}${schedule.slice(1)}`;

/**
 * How a page's refresh reads in one line of the list.
 * @param {object | null} refresh
 */
function refreshLine(refresh) {
  if (!refresh) return "";
  const how = refresh.kind === "command" ? "script" : "AI";
  if (refresh.paused) return `refresh paused (${refresh.pausedReason})`;
  const last = refresh.lastRun?.outcome === "failed" ? `, last refresh failed: ${refresh.lastRun.message}` : "";
  return `refreshes ${inSentence(refresh.schedule)} by ${how}, next ${refresh.nextAt}${last}`;
}

function pageLine(page) {
  return [page.id, page.title, `version ${page.version}`, `updated ${page.updatedAt}`, page.archived ? "archived" : "", refreshLine(page.refresh), page.link]
    .filter(Boolean).join("  ");
}

function refreshText(parsed, page) {
  const { refresh } = page;
  if (!refresh) return `Page ${page.id} no longer refreshes; it keeps version ${page.version}.\n`;
  const how = refresh.kind === "command" ? `by running ${parsed.options.command.split("/").at(-1)} on Vibe64's server` : "by asking the AI in this session";
  return [
    `Page ${page.id} now refreshes ${inSentence(refresh.schedule)} ${how}, as ${refresh.scheduledBy.name || refresh.scheduledBy.id}.`,
    `The next refresh is at ${refresh.nextAt}. The Pages list shows each refresh, with Refresh now, Pause and the log.`
  ].join("\n") + "\n";
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
      if (parsed.command === "data") return pages.updatePageData({ pageId: parsed.positionals[1], data: input.data, by, sessionId });
      if (parsed.command === "refresh") {
        if (parsed.off) return pages.removePageRefresh({ pageId: parsed.positionals[1] });
        const { options } = parsed;
        return pages.setPageRefresh({
          pageId: parsed.positionals[1],
          kind: options.command ? "command" : "prompt",
          every: options.every || "",
          daily: options.daily || "",
          timeZone: options["time-zone"] || "",
          script: input.script,
          prompt: options.prompt || "",
          by,
          sessionId
        });
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
    if (parsed.command === "refresh") return refreshText(parsed, payload.page);
    const done = {
      data: `Updated the data of "${payload.page.title}".`,
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
