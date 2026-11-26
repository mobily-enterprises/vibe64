import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

import { prepareAgentHelperCommand } from "../../packages/vibe64-terminals/src/server/agentHelperCommand.js";
import {
  createAgentSessionCommandService,
  prepareAgentSessionCommand
} from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import {
  TERMINALS_HELPER_COMMAND_GROUPS_TOKEN,
  assertHelperCommandGroups
} from "../../packages/vibe64-terminals/src/server/helperCommandGroups.js";
import { requestUnixJsonCommand } from "../../packages/vibe64-terminals/src/server/unixJsonCommand.js";
import { Vibe64TerminalsFeature } from "../../packages/vibe64-terminals/src/server/Vibe64TerminalsFeature.js";

// A composed host adds its own vibe64-helper groups through one optional token. Each takes the path vibe64-helper's own
// session commands take (the session control's identity, the session's binding, refuseUnreadFields), streams its
// output back as it comes, and the caller exits with its status, or runs its own command itself when the host says so.
// Without a host, vibe64-helper is exactly its own groups.

const PUBLIC_GROUPS = ["preview", "playwright", "env", "staging", "database", "github", "pages", "session", "plan",
  "training", "spec"];
// vibe64-helper --help as it was before hosts could add groups.
const OWN_HELP = `Usage: vibe64-helper <group> [arguments]

Groups:
  preview      Preview lifecycle, opening a page in the Preview pane, browser inspection, screenshots and logs
  playwright   Managed project browser test suites
  env          Project environment settings
  staging      Staging status, and how this session reaches staging itself (ssh staging)
  database     Database refresh, overview and diagram operations
  github       GitHub view refresh
  pages        Publish, update and list pages everyone on the project can open
  session      Session status, Update, Save, setup retry, rename, and listing and messaging project sessions
  plan         Read and maintain the current plan and archived plans
  training     Validate, bundle and pin local teaching content
  spec         Exact Vibe64 contracts: Stack sections and command protocols

Use vibe64-helper <group> --help for that group.
Commands use the current managed session and its access checks.
`;
const INVENTORY_HELP = "Usage: vibe64-helper inventory count | stream | quiet | wait | run -- <command>\n";

async function eventually(check, message) {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function run(command, args, { env, cwd }) {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr).toString()
    }));
  });
  return { child, closed, stdoutText: () => Buffer.concat(stdout).toString() };
}

/**
 * A session whose agent commands are prepared as an engine prepares them, with `groups` as the host's.
 * @param {import("node:test").TestContext} t
 * @param {object[] | undefined} groups
 */
async function fixture(t, groups) {
  // Released last made first, whether the test passed or not: its callers, the session, TMPDIR, then its folders.
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  });
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "vibe64-helper-groups-")));
  cleanups.push(() => rm(root, { force: true, recursive: true }));
  // The editor's TMPDIR, a short folder of its own under /tmp, which holds the session's sockets.
  const editorTemp = await realpath(await mkdtemp("/tmp/v64-hg-"));
  cleanups.push(() => rm(editorTemp, { force: true, recursive: true }));
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = editorTemp;
  cleanups.push(() => {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
  });
  const sessionId = "session-1";
  const sourceRoot = path.join(root, "sessions", "active", sessionId, "source");
  const wrapperHostDir = path.join(root, "wrappers");
  await mkdir(sourceRoot, { recursive: true });
  const descriptor = {
    metadata: { source_kind: "session_clone", source_path: sourceRoot, source_path_authority: "managed_session_source" },
    sessionId
  };
  const state = { projectSlug: "shop", routing: { status: "working", turnId: "turn-7", submittedBy: { id: "person-1" } } };
  const service = createAgentSessionCommandService({
    logger: silentLogger,
    project: {
      async createSessionStore() {
        return {
          async readSessionSourceDescriptor() { return descriptor; },
          async readMetadataValue(_sessionId, name) {
            return name === "assistant_routing_request" ? JSON.stringify(state.routing) : "";
          }
        };
      },
      async readCurrentProject() { return { slug: state.projectSlug, projectRoot: path.join(root, "project") }; },
      async runInProjectContext(_slug, operation) { return operation(); }
    },
    ...(groups ? { helperCommandGroups: groups } : {})
  });
  cleanups.push(() => service.closeAllForSession(sessionId));
  await service.bindSession(sessionId, { wrapperHostDir });
  const prepared = await prepareAgentSessionCommand({ commandService: service, sessionId, wrapperHostDir });
  assert.equal(prepared.ok, true);
  assert.deepEqual(await prepareAgentHelperCommand({ env: process.env, wrapperHostDir, hostGroups: service.helperGroups }), { ok: true });
  const env = { ...process.env, ...prepared.env, PATH: [wrapperHostDir, process.env.PATH].join(path.delimiter) };
  const helper = (args, options = {}) => {
    const caller = run(path.join(wrapperHostDir, "vibe64-helper"), args, { cwd: sourceRoot, env, ...options });
    cleanups.push(() => caller.child.kill("SIGKILL"));
    return caller;
  };
  return { control: JSON.parse(prepared.env.VIBE64_SESSION_RENAME_CONTROL), env, helper, service, sessionId, sourceRoot, state, wrapperHostDir };
}

/** The host's example group: what it was asked, and gates the test opens. */
function inventoryGroup() {
  const calls = [];
  const gates = { streamed: Promise.withResolvers() };
  const group = {
    name: "inventory",
    summary: "Count and list the shop's stock",
    help: INVENTORY_HELP,
    async run(request, output) {
      calls.push(request);
      const [action] = request.args;
      if (action === "count") {
        output.stdout("3 boxes\n");
        output.stderr("1 box is damaged\n");
        return { exit: 3 };
      }
      if (action === "stream") {
        output.stdout("first\n");
        await gates.streamed.promise;
        output.stdout(Buffer.from([0, 1, 255]));
        return { exit: 0 };
      }
      if (action === "quiet") {
        await new Promise((resolve) => setTimeout(resolve, 5500));
        output.stdout("still here\n");
        return { exit: 0 };
      }
      if (action === "wait") {
        await new Promise((resolve) => request.signal.addEventListener("abort", resolve, { once: true }));
        return { exit: 0 };
      }
      // A host that never listens to its signal, and answers only long after.
      if (action === "deaf") {
        await new Promise((resolve) => setTimeout(resolve, 15_000).unref());
        return { exit: 0 };
      }
      // A host asking the caller to run something itself: there is no such answer.
      if (action === "run") return { exec: true };
      return { exit: 0, note: "not an answer" };
    }
  };
  return { calls, gates, group };
}

test("without a host's groups, vibe64-helper lists and refuses exactly as before", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.service.helperGroups, []);
  await assert.rejects(access(path.join(f.wrapperHostDir, "vibe64-helper-group")), { code: "ENOENT" });
  for (const args of [[], ["--help"], ["-h"]]) {
    const listed = await f.helper(args).closed;
    assert.equal(listed.code, 0, listed.stderr);
    assert.equal(listed.stdout.toString(), OWN_HELP);
  }
  const unknown = await f.helper(["inventory", "count"]).closed;
  assert.deepEqual([unknown.code, unknown.stderr, unknown.stdout.length], [2, "Unknown Vibe64 helper group. Use vibe64-helper --help.\n", 0]);
  assert.equal(Vibe64TerminalsFeature.optional.helperCommandGroups, TERMINALS_HELPER_COMMAND_GROUPS_TOKEN);
  assert.equal(TERMINALS_HELPER_COMMAND_GROUPS_TOKEN, "vibe64.terminals.helper-command-groups");
  assertHelperCommandGroups(null);
  assertHelperCommandGroups(undefined);
});

test("a host's group can never replace one of vibe64-helper's own groups: its registration fails, naming it", async () => {
  const { group } = inventoryGroup();
  for (const name of PUBLIC_GROUPS) {
    assert.throws(() => assertHelperCommandGroups([{ ...group, name }]),
      { name: "TypeError", message: `A host helper command group cannot replace vibe64-helper's own ${name} group: choose another name.` });
    // Composition refuses it at the terminals feature's setup, before anything starts.
    await assert.rejects(Vibe64TerminalsFeature.setup({ helperCommandGroups: [{ ...group, name }] }, {}),
      new RegExp(`cannot replace vibe64-helper's own ${name} group`, "u"));
  }
  assert.throws(() => assertHelperCommandGroups([group, { ...group }]), /Two host helper command groups are named inventory/u);
  for (const name of ["", "Inventory", "../preview", "-h", "stock list", "a".repeat(25), 7]) {
    assert.throws(() => assertHelperCommandGroups([{ ...group, name }]), /needs a name of a-z, 0-9 and -/u, String(name));
  }
  assert.throws(() => assertHelperCommandGroups([{ ...group, summary: "two\nlines" }]), /summary of one line/u);
  assert.throws(() => assertHelperCommandGroups([{ ...group, help: "" }]), /needs its help/u);
  assert.throws(() => assertHelperCommandGroups([{ ...group, run: undefined }]), /needs run\(\)/u);
  assert.throws(() => assertHelperCommandGroups({ inventory: group }), /must be a list/u);
  assertHelperCommandGroups([group]);
});

test("a host's group is listed, prints its own help, and gets the session, project, person, turn, words and folders", async (t) => {
  const { calls, group } = inventoryGroup();
  const f = await fixture(t, [group]);
  const listed = await f.helper(["--help"]).closed;
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(listed.stdout.toString(), OWN_HELP.replace(
    "  spec         Exact Vibe64 contracts: Stack sections and command protocols\n",
    "  spec         Exact Vibe64 contracts: Stack sections and command protocols\n  inventory    Count and list the shop's stock\n"
  ));
  for (const flag of ["--help", "-h"]) {
    const help = await f.helper(["inventory", flag]).closed;
    assert.deepEqual([help.code, help.stdout.toString(), help.stderr], [0, INVENTORY_HELP, ""]);
  }
  assert.equal(calls.length, 0, "help never reaches the host");

  const counted = await f.helper(["inventory", "count", "--json", "space and 'quote'"]).closed;
  assert.deepEqual([counted.code, counted.stdout.toString(), counted.stderr], [3, "3 boxes\n", "1 box is damaged\n"]);
  const [request] = calls;
  assert.ok(request.signal instanceof AbortSignal);
  assert.equal(request.signal.aborted, false);
  const { signal: _signal, ...rest } = request;
  assert.deepEqual(rest, {
    sessionId: f.sessionId,
    projectSlug: "shop",
    actor: { id: "person-1" },
    turnId: "turn-7",
    args: ["count", "--json", "space and 'quote'"],
    cwd: f.sourceRoot,
    sourceRoot: f.sourceRoot
  });
  // No turn while the session's request is not working; the binding's person when the request names none.
  f.state.routing = { status: "complete", turnId: "turn-7" };
  assert.equal((await f.helper(["inventory", "count"]).closed).code, 3);
  assert.deepEqual([calls[1].turnId, calls[1].actor], ["", null]);
  // A folder outside the session's source and temporary folder is refused before the host runs.
  const outside = await f.helper(["inventory", "count"], { cwd: path.dirname(f.sourceRoot) }).closed;
  assert.equal(outside.code, 1);
  assert.match(outside.stderr, /inside the active session source or its temporary folder/u);
  assert.equal(calls.length, 2);
});

test("a host's group streams its output as it comes, with no time limit of its own, and the caller exits with its status", async (t) => {
  const { gates, group } = inventoryGroup();
  const f = await fixture(t, [group]);
  const streaming = f.helper(["inventory", "stream"]);
  await eventually(() => streaming.stdoutText() === "first\n", "the first output never reached the caller while the host worked");
  gates.streamed.resolve();
  const streamed = await streaming.closed;
  assert.equal(streamed.code, 0, streamed.stderr);
  assert.deepEqual(streamed.stdout, Buffer.concat([Buffer.from("first\n"), Buffer.from([0, 1, 255])]));
  // Over five seconds without a word, past an HTTP agent's idle limit, and the caller still waits for the answer.
  const quiet = await f.helper(["inventory", "quiet"]).closed;
  assert.deepEqual([quiet.code, quiet.stdout.toString()], [0, "still here\n"]);
  const invalid = await f.helper(["inventory", "other"]).closed;
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /did not answer \{ exit \} with a status from 0 to 255\./u);
});

test("a host's group runs only after the session's binding and refuses a field it does not read, before the host runs", async (t) => {
  const { calls, group } = inventoryGroup();
  const f = await fixture(t, [group]);
  const caller = { signal: new AbortController().signal, stdout() {}, stderr() {} };
  const fields = { group: "inventory", args: ["count"], cwd: f.sourceRoot };
  // An unread or missing field's refusal, as every vibe64-helper operation's, is in helperCommandUnreadFields.unit.test.js.
  await assert.rejects(f.service.runHelperGroup("another-session", fields, caller), { code: "vibe64_agent_session_command_session_unbound" });
  await assert.rejects(f.service.runHelperGroup(f.sessionId, { ...fields, args: "count" }, caller), { code: "vibe64_helper_group_args_invalid" });
  await assert.rejects(f.service.runHelperGroup(f.sessionId, { ...fields, group: "session" }, caller), { code: "vibe64_helper_group_unknown" });
  // The same refusal through the session control, as the caller would get it.
  const { socketPath, sessionId, generationId, token } = f.control;
  const refused = await requestUnixJsonCommand({ socketPath, path: "/agent-session-command/helper-group",
    body: { ...fields, comment: "Looks good.", sessionId, generationId, token } });
  assert.deepEqual([refused.statusCode, refused.payload.type, refused.payload.exitCode, refused.payload.code],
    [200, "exit", 1, "vibe64_command_input_unread"]);
  // Only the session control's own token admits it.
  const forged = await requestUnixJsonCommand({ socketPath, path: "/agent-session-command/helper-group",
    body: { ...fields, sessionId, generationId, token: "forged" } });
  assert.equal(forged.statusCode, 403);
  const denied = await f.helper(["inventory", "count"], { env: { ...f.env, VIBE64_SESSION_RENAME_CONTROL: JSON.stringify({ ...f.control, token: "forged" }) } }).closed;
  assert.equal(denied.code, 1);
  assert.match(denied.stderr, /identity is invalid/u);
  // A session whose project changed under it runs nothing.
  f.state.projectSlug = "garden";
  const moved = await f.helper(["inventory", "count"]).closed;
  assert.equal(moved.code, 1);
  assert.match(moved.stderr, /no longer matches its bound project/u);
  assert.deepEqual(calls, [], "no refused request reached the host");
});

test("SIGINT, SIGTERM or a hangup of the caller, or the session closing, cancels the host's run", async (t) => {
  const { calls, group } = inventoryGroup();
  const f = await fixture(t, [group]);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const before = calls.length;
    const waiting = f.helper(["inventory", "wait"]);
    await eventually(() => calls.length > before, `${signal}: the host never started`);
    const { signal: hostSignal } = calls.at(-1);
    assert.equal(hostSignal.aborted, false, "the host runs while its caller waits");
    waiting.child.kill(signal);
    const ended = await waiting.closed;
    assert.deepEqual([ended.code, ended.signal], [null, signal]);
    await eventually(() => hostSignal.aborted, `${signal}: the host was not told its caller went away`);
  }
  // Closing the session cancels the host's run, and never waits on a host that ignores that: its caller is told.
  const before = calls.length;
  const deaf = f.helper(["inventory", "deaf"]);
  await eventually(() => calls.length > before, "the host never started");
  let closed = false;
  const closing = f.service.closeAllForSession(f.sessionId).then(() => { closed = true; });
  await eventually(() => closed, "closing the session waited on a host that ignores its signal");
  await closing;
  assert.equal(calls.at(-1).signal.aborted, true, "closing the session did not cancel the host's run");
  const ended = await deaf.closed;
  assert.equal(ended.code, 1);
  assert.match(ended.stderr, /The command was cancelled: its caller went away or its session closed\./u);
});

test("the caller never runs a command itself: a host's answer asking it to is refused, and nothing after -- runs", async (t) => {
  const { calls, group } = inventoryGroup();
  const f = await fixture(t, [group]);
  const marker = path.join(f.sourceRoot, "ran-by-caller");
  const script = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`;
  const refused = await f.helper(["inventory", "run", "--", process.execPath, "-e", script]).closed;
  assert.deepEqual([refused.code, refused.stdout.toString()], [1, ""]);
  assert.match(refused.stderr, /did not answer \{ exit \} with a status from 0 to 255\./u);
  assert.deepEqual(calls.at(-1).args, ["run", "--", process.execPath, "-e", script]);
  await assert.rejects(access(marker), { code: "ENOENT" });
});
