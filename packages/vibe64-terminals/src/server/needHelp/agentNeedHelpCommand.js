import { refuseUnreadFields } from "@local/vibe64-core/server/commandInput";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { agentControlIdentitySource } from "@local/vibe64-execution/server";

/** @typedef {import("../types.js").NeedHelpService} NeedHelpService */

// What each `vibe64-helper need-help` operation reads.
const NEED_HELP_FIELDS = Object.freeze({
  raise: { operation: "need-help raise", fields: ["text"], required: ["text"] },
  read: { operation: "need-help read", fields: [] },
  clear: { operation: "need-help clear", fields: [] }
});

// The usage `vibe64-helper need-help --help` prints, and what each operation is for.
const NEED_HELP_USAGE = [
  'Usage: vibe64-helper need-help raise "What is wrong, what you tried, what you need" | raise - (the message on stdin)',
  "  | read [--json] | clear",
  "raise flags this session Need help, which the person sees on the session and in its session list, and which the",
  "host forwards to whoever can help, when it does. Raise it when something you need is outside your reach (the",
  "platform, a managed service, access you don't have) and you can't fix it yourself, instead of waiting or guessing;",
  "then keep working on whatever you can. A follow-up (raise again) adds to the same flag, never a new one.",
  "read shows the flag's messages, the person's answer and where it was sent. clear ends it once it is resolved."
].join("\n");

/**
 * The session's `vibe64-need-help` command (`vibe64-helper need-help`): it uses the session control socket and identity,
 * the control environment variable's, else the session control file's, as the plan command does.
 * @param {string} controlEnvironmentName
 * @param {string} controlFilePath
 */
function needHelpCommandSource(controlEnvironmentName, controlFilePath) {
  return `#!/usr/bin/env node
import { readFileSync } from "node:fs";
import http from "node:http";

${agentControlIdentitySource(controlFilePath)}
const args = process.argv.slice(2);
const usage = ${JSON.stringify(NEED_HELP_USAGE)};
if (!args.length || ["--help", "-h"].includes(args[0])) {
  console.log(usage);
  process.exit(0);
}
const [operation, ...rest] = args;
const json = operation === "read" && rest.length === 1 && rest[0] === "--json";
const valid = operation === "raise" ? rest.length === 1 && rest[0].trim() !== ""
  : operation === "read" ? rest.length === 0 || json
    : operation === "clear" && rest.length === 0;
if (!valid) {
  console.error(usage);
  process.exit(2);
}
try {
  let text = operation === "raise" ? rest[0] : "";
  if (operation === "raise" && text === "-") {
    text = "";
    for await (const chunk of process.stdin) {
      text += chunk;
      if (Buffer.byteLength(text) > 64 * 1024) throw new Error("The message is too large.");
    }
  }
  const control = sessionControlIdentity(JSON.parse(process.env[${JSON.stringify(controlEnvironmentName)}] || "null") || {});
  if (!control?.socketPath || !control.token || !control.sessionId || !control.generationId) {
    throw new Error("Session control is unavailable. Reconnect the assistant.");
  }
  // Each operation reads only its own fields and refuses any other, so each is sent only those.
  const body = JSON.stringify({ operation, ...(operation === "raise" ? { text } : {}),
    token: control.token, sessionId: control.sessionId, generationId: control.generationId });
  const result = await new Promise((resolve, reject) => {
    const request = http.request({ socketPath: control.socketPath, method: "POST", path: "/agent-session-command/need-help", timeout: 45000,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (response) => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { data += chunk; });
      response.on("error", reject);
      response.on("end", () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("Need help didn't answer in time. Run vibe64-helper need-help read to see whether it is raised.")));
    request.end(body);
  });
  if (result.ok !== true) throw new Error(result.error || "The Need help command failed.");
  console.log(json ? JSON.stringify(result.needHelp) : result.text);
} catch (error) { console.error(error.message); process.exitCode = 1; }
`;
}

/**
 * The session command `vibe64-helper need-help raise|read|clear` reaches: the AI raises this session's Need help, or
 * adds a follow-up to it, for the person whose request it works on, reads the answer and clears it, in the session's
 * bound project. An operation's unread or missing field is refused before Need help is asked.
 * @param {object} dependencies
 * @param {() => NeedHelpService | null} dependencies.readNeedHelp Need help, or null while Vibe64 starts or stops
 * @param {(sessionId: string, operation: (bound: { binding: object, store: object }) => Promise<object>) => Promise<object>} dependencies.runInSessionProject
 * @param {(store: object, sessionId: string, binding: object) => Promise<object | null>} dependencies.requestActor
 */
function createAgentNeedHelpCommand({ readNeedHelp, runInSessionProject, requestActor }) {
  /**
   * @param {string} sessionId
   * @param {{ operation?: string, text?: string }} input
   */
  return function manageNeedHelp(sessionId, input = {}) {
    return runInSessionProject(sessionId, async ({ binding, store }) => {
      const { operation, ...fields } = input;
      const contract = Object.hasOwn(NEED_HELP_FIELDS, operation) ? NEED_HELP_FIELDS[operation] : null;
      if (!contract) {
        throw vibe64Error("Use vibe64-helper need-help raise, read or clear.", "vibe64_need_help_operation_invalid", { status: 400 });
      }
      refuseUnreadFields(fields, contract);
      const needHelp = readNeedHelp();
      if (!needHelp) {
        throw vibe64Error("Need help is unavailable while Vibe64 starts or stops. Try again in a minute.", "vibe64_need_help_unavailable", { status: 503 });
      }
      if (operation === "raise") {
        return needHelp.raise(sessionId, { text: fields.text, from: "agent", actor: await requestActor(store, sessionId, binding) });
      }
      return operation === "read" ? needHelp.read(sessionId) : needHelp.clear(sessionId);
    });
  };
}

export { NEED_HELP_USAGE, createAgentNeedHelpCommand, needHelpCommandSource };
