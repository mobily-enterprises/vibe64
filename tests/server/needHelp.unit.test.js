import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createVibe64ActionPolicy, registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import {
  NEED_HELP_LIMITS,
  NEED_HELP_METADATA,
  NEED_HELP_STILL_OPEN_MS,
  needHelpForwardText,
  needHelpState,
  readNeedHelpFlag
} from "@local/vibe64-terminals/shared/needHelp";
import { prepareAgentHelperCommand } from "../../packages/vibe64-terminals/src/server/agentHelperCommand.js";
import { createAgentSessionCommandService, prepareAgentSessionCommand } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { createNeedHelpActions } from "../../packages/vibe64-terminals/src/server/needHelp/needHelpActions.js";
import { createNeedHelpService } from "../../packages/vibe64-terminals/src/server/needHelp/needHelpService.js";
import { registerNeedHelpRoutes } from "../../packages/vibe64-terminals/src/server/needHelp/registerNeedHelpRoutes.js";
import { testRouteApp } from "./vibe64RouteTestHelpers.js";

// Need help end to end on real session records: the session's AI raises it through the real vibe64-helper, the host
// gets it once with the session, project, message and person, a follow-up adds to the same flag, the person answers
// through the session's routes (as the signed-in person, never one the body names) and the AI is told, and the flag
// outlasts a new service until it's cleared. 2026-11-28: a session's AI asked for help three times over 2.5 hours in
// a file nobody read.

const SESSION = "2026-11-28_19-00-00";
const SLUG = "shop";
const ADA = Object.freeze({ uid: 7, username: "ada", role: "member" });
const LOCKED = "The development database is locked by another connection. I tried waiting and restarting Preview. I need the lock cleared.";

async function fixture(t, { host = { forward: async () => null }, forwardMs } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-need-help-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storeFor = () => createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
  const store = storeFor();
  await store.createSession({ sessionId: SESSION, runtimeKind: "genesis", metadata: {
    source_kind: "session_clone", source_path: path.join(root, "sessions", "active", SESSION, "source"), source_path_authority: "managed_session_source"
  } });
  const events = [];
  const notes = [];
  let clock = Date.parse("2026-11-28T19:00:00.000Z");
  const serviceOver = (sessionStore) => createNeedHelpService({
    project: { createRuntimeWithoutSource: async () => ({ store: sessionStore }) },
    host,
    forwardMs,
    logger: silentLogger,
    now: () => clock,
    publishSessionChanged: async (...args) => { events.push(args); },
    noteMainChat: async (...args) => { notes.push(args); return { ok: true }; }
  });
  return {
    root, store, storeFor, events, notes, serviceOver, needHelp: serviceOver(store),
    advance(ms) { clock += ms; },
    now: () => clock,
    flag: async () => readNeedHelpFlag(await store.readMetadataValue(SESSION, NEED_HELP_METADATA))
  };
}

const inProject = (operation) => runWithProjectRequestContext({ slug: SLUG }, operation);

/** Runs the session's own vibe64-helper, as its AI does, with `input` on stdin. */
function helper(wrapperHostDir, env, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(wrapperHostDir, "vibe64-helper"), args, { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test("the session's AI raises Need help with vibe64-helper; the host gets it once; a follow-up adds to the same flag", async (t) => {
  const forwards = [];
  const f = await fixture(t, { host: { forward: async (request) => { forwards.push(request); return { to: "the operator", reference: "PR-ABCD2345" }; } } });
  // The AI works on Ada's request: the flag is raised for her.
  await f.store.writeMetadataValue(SESSION, "assistant_routing_request", JSON.stringify({ submittedBy: ADA, status: "working", turnId: "turn-1" }));
  const wrapperHostDir = path.join(f.root, "wrappers");
  const commands = createAgentSessionCommandService({ logger: silentLogger,
    project: {
      readCurrentProject: async () => ({ slug: SLUG, projectRoot: f.root }),
      createSessionStore: async () => f.store,
      runInProjectContext: async (slug, operation) => runWithProjectRequestContext({ slug }, operation)
    },
    publishSessionChanged: async () => null,
    readNeedHelp: () => f.needHelp
  });
  t.after(() => commands.closeAllForSession(SESSION));
  const prepared = await prepareAgentSessionCommand({ commandService: commands, sessionId: SESSION, wrapperHostDir });
  await prepareAgentHelperCommand({ env: process.env, wrapperHostDir });
  const env = { PATH: process.env.PATH, VIBE64_SESSION_RENAME_CONTROL: prepared.env.VIBE64_SESSION_RENAME_CONTROL };

  const raised = await helper(wrapperHostDir, env, ["need-help", "raise", LOCKED]);
  assert.equal(raised.code, 0, raised.stderr);
  assert.equal(raised.stdout.trim(), "This session now shows Need help. Sent to the operator (reference PR-ABCD2345). "
    + "Keep working on what you can. Read the answer with vibe64-helper need-help read.");
  const flag = await f.flag();
  assert.equal(flag.raisedBy, "agent");
  assert.deepEqual(flag.messages, [{ at: "2026-11-28T19:00:00.000Z", from: "agent", author: "ada", kind: "request", text: LOCKED }]);
  assert.deepEqual(flag.forwarded, { state: "sent", at: "2026-11-28T19:00:00.000Z", to: "the operator", reference: "PR-ABCD2345", message: "" });
  assert.equal(forwards.length, 1);
  assert.deepEqual({ ...forwards[0], flag: forwards[0].flag.id }, { sessionId: SESSION, projectSlug: SLUG, flag: flag.id, message: LOCKED, actor: ADA });
  // The session list carries it, and every change refreshes the list: once raised, once its forward is recorded.
  const [summary] = await f.store.listSessionSummaries();
  assert.deepEqual(readNeedHelpFlag(summary.metadata), flag);
  assert.deepEqual(f.events.map(([sessionId, change]) => [sessionId, change.reason, change.payload.clientRefresh.includeList]),
    [[SESSION, "need-help-changed", true], [SESSION, "need-help-changed", true]]);

  f.advance(60_000);
  const followUp = await helper(wrapperHostDir, env, ["need-help", "raise", "-"], "It's the migration's lock: pg_locks shows pid 4711.\n");
  assert.equal(followUp.code, 0, followUp.stderr);
  assert.match(followUp.stdout, /^Your follow-up is added to this session's Need help\. Sent to the operator \(reference PR-ABCD2345\)\./u);
  const after = await f.flag();
  assert.equal(after.id, flag.id, "a follow-up never raises a second flag");
  assert.deepEqual(after.messages.map(({ kind, text }) => [kind, text]),
    [["request", LOCKED], ["request", "It's the migration's lock: pg_locks shows pid 4711."]]);
  assert.equal(forwards.length, 1, "a flag the host has is not sent again");

  const read = await helper(wrapperHostDir, env, ["need-help", "read"]);
  assert.match(read.stdout, /^Need help, raised 2026-11-28T19:00:00\.000Z by the AI\.\nSent to the operator \(reference PR-ABCD2345\)\.\n/u);
  assert.match(read.stdout, /2026-11-28T19:01:00\.000Z The AI \(request\):\nIt's the migration's lock/u);
  assert.match(read.stdout, /Next: nobody has answered yet\./u);
  assert.deepEqual(JSON.parse((await helper(wrapperHostDir, env, ["need-help", "read", "--json"])).stdout), after);

  // A raise without a message, or with words the command doesn't take, changes nothing.
  for (const args of [["need-help", "raise"], ["need-help", "raise", "   "], ["need-help", "read", "everything"], ["need-help", "shout", "x"]]) {
    const refused = await helper(wrapperHostDir, env, args);
    assert.equal(refused.code, 2, args.join(" "));
    assert.match(refused.stderr, /^Usage: vibe64-helper need-help raise/u);
  }
  const tooLong = await helper(wrapperHostDir, env, ["need-help", "raise", "x".repeat(NEED_HELP_LIMITS.messageCharacters + 1)]);
  assert.notEqual(tooLong.code, 0);
  assert.match(tooLong.stderr, /Keep the message to 2000 characters: it has 2001\./u);
  assert.deepEqual(await f.flag(), after);

  const cleared = await helper(wrapperHostDir, env, ["need-help", "clear"]);
  assert.equal(cleared.stdout.trim(), "This session's Need help is cleared.");
  assert.equal(await f.store.readMetadataValue(SESSION, NEED_HELP_METADATA), "");
  assert.equal((await helper(wrapperHostDir, env, ["need-help", "read"])).stdout.trim(), "This session has no open Need help.");
});

test("a forward that fails keeps its words and is tried again by the follow-up; one that never answers is bounded", async (t) => {
  const outcomes = [
    () => { throw new Error("This workspace isn't linked to vibe64.dev yet"); },
    () => ({ to: "the operator", reference: "PR-2" })
  ];
  const forwards = [];
  const f = await fixture(t, { host: { forward: async (request) => { forwards.push(request); return outcomes.shift()(); } } });
  const first = await inProject(() => f.needHelp.raise(SESSION, { text: LOCKED, from: "person", actor: ADA }));
  assert.equal(first.followUp, false);
  assert.deepEqual(first.needHelp.forwarded, { state: "failed", at: "2026-11-28T19:00:00.000Z", to: "", reference: "",
    message: "This workspace isn't linked to vibe64.dev yet" });
  assert.equal(needHelpForwardText(first.needHelp), "It couldn't be sent to the host: This workspace isn't linked to vibe64.dev yet. A follow-up tries again.");
  assert.equal((await f.flag()).forwarded.state, "failed");
  assert.equal((await f.flag()).raisedBy, "person");

  const second = await inProject(() => f.needHelp.raise(SESSION, { text: "Still locked.", from: "person", actor: ADA }));
  assert.equal(second.followUp, true);
  assert.equal(second.needHelp.forwarded.state, "sent");
  assert.equal(forwards.length, 2);
  assert.deepEqual(forwards.map(({ message, projectSlug }) => [message, projectSlug]), [[LOCKED, SLUG], ["Still locked.", SLUG]]);
  await inProject(() => f.needHelp.raise(SESSION, { text: "And now?", from: "person", actor: ADA }));
  assert.equal(forwards.length, 2);

  // A host that never answers costs the raise its bound, not the session its flag.
  const hung = await fixture(t, { host: { forward: () => new Promise(() => {}) }, forwardMs: 50 });
  const late = await inProject(() => hung.needHelp.raise(SESSION, { text: LOCKED, from: "agent", actor: null }));
  assert.equal(late.needHelp.forwarded.state, "failed");
  assert.equal(late.needHelp.forwarded.message, "The host didn't answer in time.");
  assert.equal((await hung.flag()).messages.length, 1);

  // A host that sends flags nowhere leaves the flag unforwarded.
  const local = await fixture(t);
  const kept = await inProject(() => local.needHelp.raise(SESSION, { text: LOCKED, from: "agent", actor: null }));
  assert.equal(kept.needHelp.forwarded, null);
  assert.equal(kept.text, "This session now shows Need help. Keep working on what you can. Read the answer with vibe64-helper need-help read.");
});

test("the person answers, raises and clears from the session's routes as the signed-in person; the AI is told; the flag outlasts a new service", async (t) => {
  const f = await fixture(t);
  await inProject(() => f.needHelp.raise(SESSION, { text: LOCKED, from: "agent", actor: null }));
  const projectsRoot = path.join(f.root, "projects");
  await mkdir(path.join(projectsRoot, SLUG), { recursive: true });
  const projectContext = {
    projectsRoot,
    currentPracticeProjectScope: () => null,
    readWorkspaceProject: async ({ slug }) => ({ project: { path: path.join(projectsRoot, slug) }, projectsRoot })
  };
  const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: true }) });
  const definitions = createNeedHelpActions({ needHelp: f.needHelp });
  actions.register({ contributorId: "need-help", domain: "vibe64-need-help", actions: definitions });
  registerVibe64ActionContext(actions, { projectContext, resolveUser: async ({ request }) => request?.vibe64User || null, authorizeProject: async () => {} });
  // Pages only: the AI has its own command.
  for (const action of definitions) assert.equal(action.extensions.assistant.exclude, true, action.id);
  const app = testRouteApp();
  registerNeedHelpRoutes(app.http, { localhostCheckBypassed: true, projectContext });
  const server = Fastify();
  t.after(() => server.close());
  server.decorateRequest("executeAction", function executeAction({ actionId, input }) {
    return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request: this } } });
  });
  server.addHook("preHandler", async (request) => { request.vibe64User = ADA; });
  server.setErrorHandler((error, _request, reply) => reply.code(error.statusCode || error.status || 500).send({ code: error.code }));
  for (const route of app.registeredRoutes) server.route({ method: route.method, url: route.path, handler: route.handler });
  const url = `/api/app/${SLUG}/vibe64/sessions/${SESSION}/need-help`;

  f.advance(NEED_HELP_STILL_OPEN_MS - 1);
  assert.equal(needHelpState(await f.flag(), f.now()).stillOpen, false);
  f.advance(1);
  assert.equal(needHelpState(await f.flag(), f.now()).stillOpen, true, "after 15 minutes unanswered the request is still open");

  // The answer is the signed-in person's, whoever the body names.
  const answered = await server.inject({ method: "POST", url: `${url}/answer`,
    payload: { text: "I ended pid 4711; try again.", vibe64User: { username: "mallory" } } });
  assert.equal(answered.statusCode, 200, answered.body);
  const flag = await f.flag();
  assert.deepEqual(flag.messages.at(-1), { at: "2026-11-28T19:15:00.000Z", from: "person", author: "ada", kind: "answer", text: "I ended pid 4711; try again." });
  assert.deepEqual(needHelpState(flag, f.now()), { open: true, request: flag.messages[0], answer: flag.messages[1], answered: true, stillOpen: false, waitingMs: 0 });
  assert.equal(f.notes.length, 1);
  const [noteSession, note, noteOptions] = f.notes[0];
  assert.equal(noteSession, SESSION);
  assert.equal(note.nextTurn, true);
  assert.match(note.message, /^ada answered this session's Need help:\n\nI ended pid 4711; try again\.\n\nRead it all with `vibe64-helper need-help read`/u);
  assert.deepEqual(noteOptions, { vibe64User: ADA });

  // The person's follow-up reopens it.
  assert.equal((await server.inject({ method: "POST", url, payload: { text: "Did that help?" } })).statusCode, 200);
  assert.equal(needHelpState(await f.flag(), f.now()).answered, false);
  assert.equal((await f.flag()).messages.at(-1).author, "ada");

  // A new service, as after a restart, reads the same flag.
  const restarted = f.serviceOver(f.storeFor());
  assert.deepEqual((await restarted.read(SESSION)).needHelp, await f.flag());

  for (const payload of [{ text: "   " }, { text: "x".repeat(NEED_HELP_LIMITS.messageCharacters + 1) }]) {
    const refused = await server.inject({ method: "POST", url: `${url}/answer`, payload });
    assert.equal(refused.statusCode, 400);
    assert.match(JSON.parse(refused.body).code, /^vibe64_need_help_text_(required|too_long)$/u);
  }
  assert.equal((await f.flag()).messages.length, 3);

  assert.equal((await server.inject({ method: "DELETE", url })).statusCode, 200);
  assert.equal(await f.flag(), null);
  const unanswerable = await server.inject({ method: "POST", url: `${url}/answer`, payload: { text: "Hello?" } });
  assert.equal(unanswerable.statusCode, 404);
  assert.equal(JSON.parse(unanswerable.body).code, "vibe64_need_help_missing");
  assert.equal((await restarted.clear(SESSION)).cleared, false);
});

test("a flag keeps its first message and the newest after it, and the AI's command refuses an unknown operation", async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < NEED_HELP_LIMITS.messages + 5; index += 1) {
    f.advance(1000);
    await inProject(() => f.needHelp.raise(SESSION, { text: `Message ${index}`, from: "agent", actor: null }));
  }
  const flag = await f.flag();
  assert.equal(flag.messages.length, NEED_HELP_LIMITS.messages);
  assert.equal(flag.messages[0].text, "Message 0");
  assert.equal(flag.messages[1].text, "Message 6");
  assert.equal(flag.messages.at(-1).text, `Message ${NEED_HELP_LIMITS.messages + 4}`);
  assert.equal(readNeedHelpFlag("{not json"), null);
  assert.equal(readNeedHelpFlag(JSON.stringify({ ...flag, schema: "vibe64.need-help.v0" })), null);

  const commands = createAgentSessionCommandService({ logger: silentLogger,
    project: {
      readCurrentProject: async () => ({ slug: SLUG, projectRoot: f.root }),
      createSessionStore: async () => f.store,
      runInProjectContext: async (_slug, operation) => operation()
    },
    publishSessionChanged: async () => null
  });
  t.after(() => commands.closeAllForSession(SESSION));
  await commands.bindSession(SESSION, { wrapperHostDir: path.join(f.root, "wrappers") });
  await assert.rejects(commands.manageNeedHelp(SESSION, { operation: "shout" }), { code: "vibe64_need_help_operation_invalid" });
  // Without a Need help owner (Vibe64 starting or stopping) the command says so instead of dropping the request.
  await assert.rejects(commands.manageNeedHelp(SESSION, { operation: "raise", text: LOCKED }), { code: "vibe64_need_help_unavailable" });
});
