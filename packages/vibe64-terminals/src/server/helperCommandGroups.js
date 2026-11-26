// A composed host's own vibe64-helper command groups. Each takes the path vibe64-helper's own session commands take:
// the session control's token, generation and binding, then refuseUnreadFields, before the host's run is called, and
// its answer streams back to the caller, who exits with the host's exit status. Without a host the slot is empty and
// vibe64-helper is exactly its own groups.

import path from "node:path";

import { agentControlIdentitySource } from "@local/vibe64-execution/server";
import { refuseUnreadFields } from "@local/vibe64-core/server/commandInput";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { vibe64ErrorResponse } from "@local/vibe64-core/server/serverResponses";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { HELPER_GROUP_CLIENT_NAME, VIBE64_HELPER_GROUP_NAMES } from "./agentHelperCommand.js";
import { SESSION_RENAME_CONTROL_ENV, sessionCommandCwd } from "./agentSessionCommandRun.js";
import { writeExecutableFileIfChanged } from "./writeExecutableFileIfChanged.js";

/** @typedef {import("./types.js").HelperCommandGroup} HelperCommandGroup */

// A composed host registers its own vibe64-helper command groups through this token: a list of { name, summary,
// help, run }. Without one vibe64-helper has only its own groups.
const TERMINALS_HELPER_COMMAND_GROUPS_TOKEN = "vibe64.terminals.helper-command-groups";
// No host's groups: vibe64-helper has only its own.
const NO_HELPER_COMMAND_GROUPS = Object.freeze([]);
const HELPER_GROUP_ROUTE = "/agent-session-command/helper-group";
const GROUP_NAME = /^[a-z][a-z0-9-]{0,23}$/u;
const SUMMARY_MAX_CHARACTERS = 100;
const HELP_MAX_BYTES = 16 * 1024;
// What a host group's request reads, as the session control's route hands it over without its identity.
const HELPER_GROUP_FIELDS = Object.freeze(["group", "args", "cwd"]);

/**
 * Checks a host's groups when they are received: each needs a name of its own, a one-line summary, its help and run.
 * A name vibe64-helper already has is refused, so a host can add a group but never replace one.
 * @param {unknown} groups
 */
function assertHelperCommandGroups(groups) {
  if (groups === null || groups === undefined) return;
  if (!Array.isArray(groups)) {
    throw new TypeError("Host helper command groups must be a list of { name, summary, help, run }, or null.");
  }
  const names = new Set();
  for (const group of groups) {
    const name = group?.name;
    if (typeof name !== "string" || !GROUP_NAME.test(name)) {
      throw new TypeError(`A host helper command group needs a name of a-z, 0-9 and -, starting with a letter, at most 24 characters: ${JSON.stringify(name)} is not one.`);
    }
    if (VIBE64_HELPER_GROUP_NAMES.includes(name)) {
      throw new TypeError(`A host helper command group cannot replace vibe64-helper's own ${name} group: choose another name.`);
    }
    if (names.has(name)) throw new TypeError(`Two host helper command groups are named ${name}.`);
    names.add(name);
    const { summary, help, run } = group;
    if (typeof summary !== "string" || !summary.trim() || summary.length > SUMMARY_MAX_CHARACTERS || /[\p{Cc}]/u.test(summary)) {
      throw new TypeError(`The host helper command group ${name} needs a summary of one line, at most ${SUMMARY_MAX_CHARACTERS} characters.`);
    }
    if (typeof help !== "string" || !help.trim() || Buffer.byteLength(help, "utf8") > HELP_MAX_BYTES) {
      throw new TypeError(`The host helper command group ${name} needs its help, at most ${HELP_MAX_BYTES} bytes.`);
    }
    // readable-check: allow method-probe - input validation: a host's helper command group is checked when it is received
    if (typeof run !== "function") throw new TypeError(`The host helper command group ${name} needs run().`);
  }
}

/**
 * The host's answer as the caller's last frame: its exit status, or "run it yourself", which runs only the words the
 * caller gave after its first `--`.
 * @param {string} name @param {string[]} args @param {unknown} answer
 */
function finalFrame(name, args, answer) {
  const keys = answer && typeof answer === "object" ? Object.keys(answer) : [];
  if (keys.length === 1 && answer.exec === true) {
    const at = args.indexOf("--");
    if (at < 0 || at === args.length - 1) {
      throw vibe64Error(
        `${name} answered "run it yourself", but the command gave nothing to run after --: nothing ran.`,
        "vibe64_helper_group_exec_without_command"
      );
    }
    return { type: "exec" };
  }
  if (keys.length === 1 && Number.isInteger(answer.exit) && answer.exit >= 0 && answer.exit <= 255) {
    return { type: "exit", exitCode: answer.exit };
  }
  throw vibe64Error(
    `The host's ${name} command answered neither { exit } with a status from 0 to 255 nor { exec: true }.`,
    "vibe64_helper_group_answer_invalid"
  );
}

/**
 * The host's answer, or a refusal the moment its run is cancelled: a host that ignores its signal never holds the
 * caller's request, or the session's close, open. Output it writes after that reaches no one.
 * @param {() => unknown} start calls the host's run
 * @param {AbortSignal} signal
 */
function untilCancelled(start, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(vibe64Error(
      "The command was cancelled: its caller went away or its session closed.",
      "vibe64_helper_group_cancelled"
    ));
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener("abort", cancel, { once: true });
    new Promise((answer) => answer(start()))
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", cancel));
  });
}

/**
 * Runs a host's groups for the session commands: `run` checks the session's binding, refuses what a group's request
 * does not read, then calls the group's run with the request and the caller's output, and answers with the last frame.
 * @param {object} dependencies
 * @param {HelperCommandGroup[]} dependencies.groups
 * @param {Function} dependencies.runInSessionProject the session command's own binding check and source
 * @param {Function} dependencies.requestTurn who the session's current request acts for, and its turn
 * @param {ReturnType<typeof import("./sessionCommandRuns.js").createSessionCommandRuns>} dependencies.sessionRuns the
 *   session's command runs, which its close cancels
 */
function createHelperGroupRunner({ groups, runInSessionProject, requestTurn, sessionRuns }) {
  const byName = new Map(groups.map((group) => [group.name, group]));

  /**
   * @param {string} sessionId
   * @param {unknown} fields the caller's fields, without the identity that admitted them
   * @param {{ signal: AbortSignal, stdout: (chunk: string | Uint8Array) => void, stderr: (chunk: string | Uint8Array) => void }} caller
   */
  async function run(sessionId, fields, { signal, stdout, stderr }) {
    const tracked = sessionRuns.track(sessionId, signal);
    try {
      return await runInSessionProject(sessionId, async ({ binding, store, sourceRoot }) => {
        const group = byName.get(typeof fields?.group === "string" ? fields.group : "");
        refuseUnreadFields(fields, { operation: group?.name || "helper group", fields: HELPER_GROUP_FIELDS, required: ["args", "cwd", "group"] });
        if (!group) throw vibe64Error("vibe64-helper has no such group: nothing ran. Use vibe64-helper --help.", "vibe64_helper_group_unknown");
        if (!Array.isArray(fields.args) || fields.args.some((arg) => typeof arg !== "string")) {
          throw vibe64Error(`${group.name} takes its arguments as a list of words: nothing ran.`, "vibe64_helper_group_args_invalid");
        }
        const cwd = await sessionCommandCwd(fields.cwd, sourceRoot);
        if (cwd.ok === false) throw vibe64Error(cwd.error, cwd.code);
        const { actor, turnId } = await requestTurn(store, sessionId, binding);
        const request = {
          sessionId,
          projectSlug: binding.projectSlug,
          actor,
          turnId,
          args: [...fields.args],
          cwd: cwd.cwd,
          sourceRoot,
          signal: tracked.signal
        };
        const answer = await untilCancelled(() => group.run(request, Object.freeze({ stdout, stderr })), tracked.signal);
        return finalFrame(group.name, fields.args, answer);
      });
    } finally {
      tracked.end();
    }
  }

  return Object.freeze({
    listing: Object.freeze(groups.map(({ name, summary, help }) => Object.freeze({ name, summary, help }))),
    run
  });
}

/**
 * The session control's route for a host group: once the control's identity admits the caller, its answer streams as
 * NDJSON frames ({ type: "stdout" | "stderr", data: base64 }, then one { type: "exit", exitCode, code?, error? } or
 * { type: "exec" }), with no time limit of its own; the caller going away cancels the host's run.
 */
async function streamHelperGroup({ commandService, fields, response, sessionId }) {
  const cancellation = new AbortController();
  response.once("close", () => {
    if (!response.writableEnded) cancellation.abort(new Error("The command's caller went away."));
  });
  // Admitted: the caller has its answer's start at once, whenever the host first writes.
  response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
  response.flushHeaders();
  const write = (frame) => {
    if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(frame)}\n`);
  };
  const output = (type) => (chunk) => {
    const data = Buffer.from(typeof chunk === "string" ? chunk : chunk ?? "");
    if (data.length) write({ type, data: data.toString("base64") });
  };
  let final;
  try {
    final = await commandService.runHelperGroup(sessionId, fields, {
      signal: cancellation.signal, stdout: output("stdout"), stderr: output("stderr")
    });
  } catch (error) {
    const payload = vibe64ErrorResponse(error, { fallbackCode: "vibe64_helper_group_failed", fallbackMessage: "The helper command failed." });
    final = { type: "exit", exitCode: 1, code: toText(payload.code), error: toText(payload.error) };
  }
  write(final);
  if (!response.writableEnded) response.end();
}

/**
 * The caller every host group shares, `vibe64-helper <group> [arguments]`: help from the host's own text, else one
 * request to the session control whose frames it writes as they come, exiting with the host's status or running the
 * caller's own command after `--` itself when the host says so. SIGINT, SIGTERM and SIGHUP end the request, so the
 * host's run is cancelled, and reach that command once it runs.
 * @param {string} controlFilePath the session control file (agentControlIdentity.js)
 * @param {{ name: string, help: string }[]} groups
 */
function helperGroupClientSource(controlFilePath, groups) {
  const help = Object.fromEntries(groups.map(({ name, help: text }) => [name, text.endsWith("\n") ? text : `${text}\n`]));
  return `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";

${agentControlIdentitySource(controlFilePath)}
const help = ${JSON.stringify(help)};
const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
const [group = "", ...args] = process.argv.slice(2);
function fail(message, code = 1) {
  process.stderr.write(String(message) + "\\n");
  process.exit(code);
}
if (!Object.hasOwn(help, group)) fail("Unknown Vibe64 helper group. Use vibe64-helper --help.", 2);
if (args[0] === "--help" || args[0] === "-h") {
  process.stdout.write(help[group]);
  process.exit(0);
}
let fromEnvironment = {};
try {
  fromEnvironment = JSON.parse(process.env.${SESSION_RENAME_CONTROL_ENV} || "null") || {};
} catch {}
const control = sessionControlIdentity(fromEnvironment);
if (!control?.socketPath || !control.token || !control.sessionId || !control.generationId) {
  fail("Session control is unavailable. Reconnect the assistant.");
}

// The host's "run it yourself": the caller's own words after its first --, with this command's environment and folder.
function runItYourself() {
  const argv = args.slice(args.indexOf("--") + 1);
  const child = spawn(argv[0], argv.slice(1), { stdio: "inherit" });
  const forwarders = signals.map((signal) => [signal, () => child.kill(signal)]);
  for (const [signal, forward] of forwarders) process.on(signal, forward);
  let ended = false;
  const end = () => {
    if (ended) return false;
    ended = true;
    for (const [signal, forward] of forwarders) process.off(signal, forward);
    return true;
  };
  child.once("error", (error) => {
    if (!end()) return;
    fail(argv[0] + ": " + (error.code === "ENOENT" ? "command not found" : error.message), error.code === "ENOENT" ? 127 : 126);
  });
  child.once("exit", (code, signal) => {
    if (!end()) return;
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

const body = JSON.stringify({ group, args, cwd: process.cwd(), token: control.token, sessionId: control.sessionId,
  generationId: control.generationId });
let final = null;
const request = http.request({
  agent: false,
  headers: { "Content-Length": Buffer.byteLength(body), "Content-Type": "application/json" },
  method: "POST",
  path: ${JSON.stringify(HELPER_GROUP_ROUTE)},
  socketPath: control.socketPath
}, (response) => {
  let buffer = "";
  response.setEncoding("utf8");
  const frame = (line) => {
    if (!line.trim()) return;
    const payload = JSON.parse(line);
    if (payload.type === "stdout") process.stdout.write(Buffer.from(String(payload.data || ""), "base64"));
    else if (payload.type === "stderr") process.stderr.write(Buffer.from(String(payload.data || ""), "base64"));
    else if (payload.type === "exit" || payload.type === "exec") final = payload;
  };
  response.on("data", (chunk) => {
    buffer += chunk;
    if (response.statusCode !== 200) return;
    const lines = buffer.split("\\n");
    buffer = lines.pop();
    lines.forEach(frame);
  });
  response.once("error", () => {});
  response.once("close", () => {
    for (const [signal, cancel] of cancellers) process.off(signal, cancel);
    if (response.statusCode !== 200) {
      let refusal = null;
      try { refusal = JSON.parse(buffer); } catch {}
      fail(refusal?.error || "The session control refused vibe64-helper " + group + ".");
    }
    if (buffer) frame(buffer);
    if (final?.type === "exec") return runItYourself();
    if (!final) fail("vibe64-helper " + group + " ended without its exit status.");
    if (final.error) process.stderr.write(final.error + "\\n");
    process.exitCode = Number.isInteger(final.exitCode) ? final.exitCode : 1;
  });
});
const cancellers = signals.map((signal) => [signal, () => {
  request.destroy();
  process.kill(process.pid, signal);
}]);
for (const [signal, cancel] of cancellers) process.once(signal, cancel);
request.once("error", (error) => {
  if (["ECONNREFUSED", "ENOENT", "ENOTSOCK"].includes(String(error?.code || ""))) {
    fail("Session control is unavailable. Reconnect the assistant.");
  }
  fail(error?.message || "vibe64-helper " + group + " failed.");
});
request.end(body);
`;
}

/**
 * Writes the caller of a host's groups beside vibe64-helper in the session's wrapper directory, when it has any.
 * @param {string} wrapperHostDir @param {string} controlFilePath @param {{ name: string, help: string }[]} groups
 */
async function writeHelperGroupClient(wrapperHostDir, controlFilePath, groups) {
  if (groups.length) {
    const client = helperGroupClientSource(controlFilePath, groups);
    await writeExecutableFileIfChanged(path.join(wrapperHostDir, HELPER_GROUP_CLIENT_NAME), client);
  }
}

export {
  HELPER_GROUP_ROUTE,
  NO_HELPER_COMMAND_GROUPS,
  TERMINALS_HELPER_COMMAND_GROUPS_TOKEN,
  assertHelperCommandGroups,
  createHelperGroupRunner,
  streamHelperGroup,
  writeHelperGroupClient
};
