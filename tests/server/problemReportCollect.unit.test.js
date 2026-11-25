import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createVibe64ActionPolicy, registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { crashRecordId, writeCrashRecordSync } from "@local/vibe64-core/server/crashRecords";
import { saveEnvUserValues } from "@local/vibe64-core/server/envUserValues";
import { flushSessionTimeline, recordSessionTimelineEvent, sessionTimelinePaths } from "@local/vibe64-core/server/sessionTimeline";
import { PROBLEM_REPORT_HIDDEN, PROBLEM_REPORT_SCHEMA, problemReportText } from "@local/vibe64-core/shared/problemReport";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { __testables as workPlanTestables, planProgressUpgradeChanges } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { createReporter } from "../../packages/vibe64-terminals/src/server/problemReport/ProblemReportFeature.js";
import { createProblemReportActions } from "../../packages/vibe64-terminals/src/server/problemReport/problemReportActions.js";
import { NO_PROBLEM_REPORT_HOST } from "../../packages/vibe64-terminals/src/server/problemReport/problemReportHost.js";
import { createProblemReportService } from "../../packages/vibe64-terminals/src/server/problemReport/problemReportService.js";
import { createProblemReportSessionReader } from "../../packages/vibe64-terminals/src/server/problemReport/problemReportSession.js";
import { registerProblemReportRoutes } from "../../packages/vibe64-terminals/src/server/problemReport/registerProblemReportRoutes.js";
import { testRouteApp } from "./vibe64RouteTestHelpers.js";

// Report a problem end to end: real session records (its store, chat, routed request, plan and timeline), the
// project's Env values, the editor's crash records and the host's own state, each holding planted secrets, read
// through the real collect route into the bundle the person reviews, and sent through the send route. No planted
// secret reaches the bundle, the chat's words come only when the person includes them, and a draft is its person's.

const SESSION = "2026-11-25_09-00-00";
const SLUG = "shop";
const ADA = Object.freeze({ uid: 7, username: "ada", role: "member", email: "ada@example.test" });
const BEN = Object.freeze({ uid: 8, username: "ben", role: "owner", email: "ben@example.test" });
const OUTSIDER = Object.freeze({ uid: 9, username: "outsider", role: "member" });
const PEOPLE = { ada: ADA, ben: BEN, outsider: OUTSIDER };

// Key-shaped values built at run time, so no secret-looking literal sits in the repository.
const tail = (length, seed = "a") => Array.from({ length }, (_, index) => String.fromCharCode(97 + ((index + seed.charCodeAt(0)) % 26))).join("");
const PLANTED = Object.freeze({
  envValue: `envsecret-${tail(24, "e")}`,
  longEnvValue: `plain-${tail(30, "l")}`,
  hostValue: `hostsecret-${tail(24, "h")}`,
  githubToken: `ghp_${tail(36, "g")}`,
  stripeKey: `sk_live_${tail(24, "s")}`,
  jwt: `eyJ${tail(20, "h")}.eyJ${tail(30, "p")}.${tail(43, "z")}`,
  bearer: tail(32, "b"),
  dbPassword: tail(16, "u"),
  awsKey: `AKIA${tail(16, "k").toUpperCase()}`
});
// Words that must never leave their records: who submitted a request, and the copies a follow-up keeps.
const NEVER = Object.freeze({
  email: ADA.email,
  followupCopy: `FOLLOWUP-COPY-${tail(12, "f")}`,
  followupRequest: `FOLLOWUP-REQUEST-${tail(12, "r")}`,
  originalRequest: `ORIGINAL-REQUEST-${tail(12, "o")}`,
  chatWords: `CHAT-WORDS-${tail(12, "c")}`
});

async function plantSession(root) {
  const projectPath = path.join(root, "projects", SLUG);
  const projectRuntimeRoot = path.join(root, "runtime", SLUG);
  await mkdir(projectPath, { recursive: true });
  await mkdir(projectRuntimeRoot, { recursive: true });
  const store = createVibe64SessionStore({ projectContextRoot: projectPath, projectRuntimeRoot });
  await store.createSession({ sessionId: SESSION, runtimeKind: "genesis" });

  await store.writeConversationUserMessage(SESSION, {
    messageId: "u-1",
    text: `${NEVER.chatWords} please use ${PLANTED.githubToken}`,
    turnMetadata: { actorDisplayName: "Ada", actorId: "7", engineId: "codex" }
  });
  await store.writeConversationAssistantMessage(SESSION, { messageId: "a-1", text: `Set it to ${PLANTED.envValue}, done.` });

  await store.writeMetadataValue(SESSION, "assistant_routing_request", JSON.stringify({
    schemaVersion: 7,
    messageId: "m-1",
    mode: "auto",
    resolvedMode: "senior",
    stage: "review",
    status: "working",
    delivery: "failed",
    error: `Delivery failed: Authorization: Bearer ${PLANTED.bearer} (${PLANTED.envValue})`,
    steps: 3,
    workflow: true,
    input: { message: NEVER.originalRequest },
    submittedBy: { email: NEVER.email, role: "member", username: "ada" },
    followup: {
      messageId: "f-1",
      planRevision: "rev-1",
      messages: [{ text: NEVER.followupCopy }],
      message: NEVER.followupRequest,
      displayMessage: "Senior review"
    }
  }));

  const session = await store.readSession(SESSION);
  const runtime = { stateRoot: projectRuntimeRoot, store };
  const plan = workPlanTestables.workPlanPath({ runtime, session });
  const planText = `Status: active\n# Ship the shop\n\n- [x] Pages\n- [ ] Checkout with ${PLANTED.stripeKey}\n`;
  await mkdir(path.dirname(plan), { recursive: true });
  await writeFile(plan, planText);
  for (const patch of planProgressUpgradeChanges([{ name: "current.md", text: planText }])) {
    const destination = path.join(path.dirname(plan), patch.name);
    if (patch.text === null) await rm(destination);
    else {
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, patch.text);
    }
  }

  recordSessionTimelineEvent(SESSION, { kind: "request", event: "failed", code: "vibe64_unit_failed", status: 500 }, { projectRuntimeRoot });
  await flushSessionTimeline();
  // A line as an older editor or a hand edit might have left it: a secret, and a field the timeline never keeps.
  await appendFile(sessionTimelinePaths(projectRuntimeRoot, SESSION).current, `${JSON.stringify({
    at: new Date(Date.now() - 60_000).toISOString(),
    kind: "process",
    event: "exited",
    detail: `token ${PLANTED.githubToken}, theme ${PLANTED.longEnvValue}`,
    nested: { kept: NEVER.chatWords }
  })}\n`);

  await saveEnvUserValues({
    projectRuntimeRoot,
    environment: "dev",
    values: {
      STRIPE_SECRET_KEY: { value: PLANTED.envValue, secret: true },
      SHOP_THEME: { value: PLANTED.longEnvValue },
      SHOP_NAME: { value: "Shop" }
    }
  });
  return { projectPath, projectRuntimeRoot, runtime, store };
}

function testHost() {
  const deliveries = [];
  return {
    deliveries,
    async contribute() {
      return {
        sections: [{
          id: "staging",
          title: "Staging",
          state: "failed",
          lastError: { code: "staging_failed", message: `Publish failed: ${PLANTED.stripeKey}`, at: new Date().toISOString() },
          fields: { url: "https://shop.example.test", token: PLANTED.hostValue, nested: { never: NEVER.chatWords } }
        }],
        versions: { platform: "11.0.0" },
        secrets: [PLANTED.hostValue]
      };
    },
    async delivery() {
      return {
        label: "Send to the platform",
        description: "Sends this report.",
        consents: [{ id: "access", label: "Let us look", description: "Read-only, 14 days.", default: true }]
      };
    },
    async deliver(request) {
      deliveries.push(request);
      return { reference: "PR-UNIT0001" };
    }
  };
}

async function harness(t, { host = testHost(), hosted = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-problem-report-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const planted = await plantSession(root);
  const systemRoot = path.join(root, "system");
  const crashAt = new Date(Date.now() - 120_000).toISOString();
  writeCrashRecordSync({
    systemRoot,
    record: {
      id: crashRecordId(crashAt, 4242),
      kind: "fatal-error",
      at: crashAt,
      error: { name: "Error", message: `boom ${PLANTED.envValue} ${PLANTED.awsKey}`, code: "E_BOOM", stack: "at nowhere" },
      acknowledged: null
    }
  });
  const sessions = createProblemReportSessionReader({
    sessionAccess: { sessionContext: async (sessionId) => ({ runtime: planted.runtime, session: await planted.store.readSession(sessionId) }) },
    projectRuntime: {
      outputTargetStatus: async () => ({
        ok: true,
        preview: { state: "failed", message: `Server exited: DATABASE_URL=postgres://app:${PLANTED.dbPassword}@db/shop` },
        outputTargets: [{ id: "web", mode: "preview" }]
      })
    }
  });
  const problemReports = createProblemReportService({ sessions, host, reporter: createReporter(hosted), systemRoot });
  const projectContext = {
    projectsRoot: path.join(root, "projects"),
    currentPracticeProjectScope: () => null,
    readWorkspaceProject: async ({ slug }) => ({
      project: { path: path.join(root, "projects", slug), projectRuntimeRoot: planted.projectRuntimeRoot },
      projectsRoot: path.join(root, "projects")
    })
  };
  const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: true }) });
  actions.register({
    contributorId: "problem-reports",
    domain: "vibe64-problem-reports",
    actions: createProblemReportActions({ problemReports })
  });
  if (hosted) {
    registerVibe64ActionContext(actions, {
      projectContext,
      resolveUser: async ({ request }) => request?.vibe64User || null,
      authorizeProject: async ({ user }) => {
        if (user.username === "outsider") throw Object.assign(new Error("No access to this project."), { statusCode: 403, code: "vibe64_project_forbidden" });
      }
    });
  }
  const app = testRouteApp();
  registerProblemReportRoutes(app.http, { localhostCheckBypassed: true, projectContext });
  const server = Fastify();
  t.after(() => server.close());
  server.decorateRequest("executeAction", function executeAction({ actionId, input }) {
    return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request: this } } });
  });
  server.addHook("preHandler", async (request) => {
    request.vibe64User = PEOPLE[request.headers["x-person"]] || null;
  });
  server.setErrorHandler((error, _request, reply) => reply.code(error.statusCode || error.status || 500).send({ code: error.code }));
  for (const route of app.registeredRoutes) server.route({ method: route.method, url: route.path, handler: route.handler });

  const post = (url, person, payload) => server.inject({
    method: "POST",
    url,
    headers: person ? { "x-person": person } : {},
    payload
  });
  return {
    host,
    collect: (person, payload) => post(`/api/app/${SLUG}/vibe64/problem-report`, person, payload),
    collectOutside: (person, payload) => post("/api/studio/problem-report", person, payload),
    send: (person, payload) => post("/api/studio/problem-report/send", person, payload)
  };
}

const SESSION_PAGE = Object.freeze({
  page: "Session",
  route: `/app/${SLUG}/sessions/${SESSION}?code=${PLANTED.githubToken}`,
  sessionId: SESSION,
  chat: { kind: "main" },
  client: {
    userAgent: "UnitBrowser/1.0",
    viewport: "1280x800",
    errors: [{ at: new Date().toISOString(), source: "window.error", code: "", message: `TypeError near ${PLANTED.jwt} and ${PLANTED.envValue}` }]
  }
});

function assertNoneLeaks(text, label) {
  for (const [name, value] of Object.entries(PLANTED)) assert.ok(!text.includes(value), `${label}: the planted ${name} leaked`);
  for (const [name, value] of Object.entries(NEVER)) assert.ok(!text.includes(value), `${label}: ${name} leaked`);
}

test("the collect route's bundle carries the session's facts and none of the planted secrets", async (t) => {
  const h = await harness(t);
  const answer = await h.collect("ada", { ...SESSION_PAGE, includeChat: false });
  assert.equal(answer.statusCode, 200, answer.body);
  const { bundle, draftId, delivery } = answer.json();
  const text = problemReportText(bundle);
  assertNoneLeaks(text, "the reviewed bundle");
  assertNoneLeaks(answer.body, "the route's answer");

  assert.equal(bundle.schema, PROBLEM_REPORT_SCHEMA);
  assert.match(draftId, /^[0-9a-f-]{36}$/u);
  assert.equal(delivery.label, "Send to the platform");
  assert.deepEqual(bundle.reporter, { username: "ada", role: "member" });
  assert.equal(bundle.place.projectSlug, SLUG);
  assert.equal(bundle.place.sessionId, SESSION);
  assert.ok(bundle.masking.hidden >= 10, `hidden ${bundle.masking.hidden}`);
  assert.equal(bundle.chat, null, "the chat's words only when the person includes them");

  const { routing, plan, turns, events, preview } = bundle.session;
  assert.deepEqual([routing.messageId, routing.mode, routing.role, routing.stage, routing.status, routing.steps, routing.workflow],
    ["m-1", "auto", "senior", "review", "working", 3, true]);
  assert.equal(routing.delivery, "failed");
  assert.match(routing.error, new RegExp(PROBLEM_REPORT_HIDDEN.replace(/[[\]]/gu, "\\$&"), "u"));
  assert.equal(routing.followup.step, "Senior review");
  assert.equal(routing.submittedByRole, "member");
  assert.equal(plan.title, "Ship the shop");
  assert.deepEqual(plan.items, { total: 2, built: 1, proven: 1 });
  assert.equal(plan.step.step, "implementation");
  assert.ok(plan.step.title.includes(PROBLEM_REPORT_HIDDEN));
  assert.equal(turns.length, 1);
  assert.equal(turns[0].actor, "Ada");
  assert.equal(turns[0].answered, true);
  assert.ok(!("text" in turns[0]), "turns are described, never quoted");
  assert.ok(events.some((event) => event.kind === "request" && event.code === "vibe64_unit_failed"));
  const handWritten = events.find((event) => event.kind === "process");
  assert.ok(handWritten.detail.includes(PROBLEM_REPORT_HIDDEN));
  assert.equal(handWritten.nested, undefined, "a timeline event keeps only its plain fields");
  assert.equal(preview.state, "failed");
  assert.equal(bundle.server.crashes.length, 1);
  assert.equal(bundle.server.crashes[0].code, "E_BOOM");
  assert.equal(bundle.server.crashes[0].message, undefined, "a crash's words are the whole server's: they stay on its Crashes page");
  assert.equal(bundle.host[0].state, "failed");
  assert.equal(bundle.host[0].fields.nested, undefined);
  assert.equal(bundle.versions.host.platform, "11.0.0");
  assert.equal(bundle.client.errors.length, 1);
  assert.equal(bundle.client.userAgent, "UnitBrowser/1.0", "ordinary values stay as they are");
});

test("the chat's messages come only when included, masked like the rest", async (t) => {
  const h = await harness(t);
  const answer = await h.collect("ada", { ...SESSION_PAGE, includeChat: true });
  assert.equal(answer.statusCode, 200, answer.body);
  const { bundle } = answer.json();
  assert.equal(bundle.chat.kind, "main");
  assert.deepEqual(bundle.chat.messages.map((message) => message.role), ["user", "assistant"]);
  assert.ok(bundle.chat.messages[0].text.startsWith("CHAT-WORDS-"), "the included chat keeps its words");
  assert.ok(bundle.chat.messages[0].text.includes(PROBLEM_REPORT_HIDDEN));
  assert.ok(bundle.chat.messages[1].text.includes(PROBLEM_REPORT_HIDDEN));
  const text = problemReportText(bundle);
  for (const [name, value] of Object.entries(PLANTED)) assert.ok(!text.includes(value), `the planted ${name} leaked`);
  for (const name of ["email", "followupCopy", "followupRequest", "originalRequest"]) assert.ok(!text.includes(NEVER[name]), `${name} leaked`);
});

test("sending delivers the reviewed draft with the person's masked note and only the consents the host declared", async (t) => {
  const h = await harness(t);
  const { draftId, bundle } = (await h.collect("ada", SESSION_PAGE)).json();
  const sent = await h.send("ada", {
    draftId,
    note: `It broke after I pasted ${PLANTED.envValue} and ${PLANTED.githubToken}`,
    consents: { access: true, everything: true }
  });
  assert.equal(sent.statusCode, 200, sent.body);
  assert.equal(sent.json().reference, "PR-UNIT0001");
  const [delivered] = h.host.deliveries;
  assert.deepEqual(delivered.consents, { access: true }, "only the consents the host declared");
  assert.equal(delivered.actor.username, "ada");
  assert.equal(delivered.bundle.reportId, bundle.reportId, "the draft the person reviewed");
  assert.ok(delivered.bundle.note.startsWith("It broke after I pasted"));
  assert.equal(delivered.bundle.masking.hidden, bundle.masking.hidden + 2);
  assertNoneLeaks(JSON.stringify(delivered.bundle), "the delivered bundle");

  const again = await h.send("ada", { draftId });
  assert.equal(again.statusCode, 404, "a sent draft is gone");
  assert.equal(again.json().code, "vibe64_problem_report_draft_missing");
});

test("a draft is its person's: another person, or nobody, cannot send it", async (t) => {
  const h = await harness(t);
  const { draftId } = (await h.collect("ada", SESSION_PAGE)).json();
  const other = await h.send("ben", { draftId });
  assert.equal(other.statusCode, 404);
  assert.equal(other.json().code, "vibe64_problem_report_draft_missing");
  const nobody = await h.send(null, { draftId });
  assert.equal(nobody.statusCode, 401);
  assert.equal(h.host.deliveries.length, 0);
  assert.equal((await h.send("ada", { draftId })).statusCode, 200, "the draft was still Ada's");
});

test("collecting refuses nobody, and a person without the project; outside a project there is no session", async (t) => {
  const h = await harness(t);
  assert.equal((await h.collect(null, SESSION_PAGE)).statusCode, 401);
  const outsider = await h.collect("outsider", SESSION_PAGE);
  assert.equal(outsider.statusCode, 403);
  assert.equal(outsider.json().code, "vibe64_project_forbidden");
  assert.equal((await h.collectOutside(null, { page: "Projects", route: "/" })).statusCode, 401);

  const outside = await h.collectOutside("outsider", { page: "Projects", route: "/", client: { errors: [] } });
  assert.equal(outside.statusCode, 200, outside.body);
  const { bundle } = outside.json();
  assert.equal(bundle.place.projectSlug, "");
  assert.equal(bundle.session, null);
  assert.equal(bundle.chat, null);
  assertNoneLeaks(problemReportText(bundle), "the workspace bundle");
});

test("a session the project cannot read is named unreadable and the report still comes", async (t) => {
  const h = await harness(t);
  const answer = await h.collect("ada", { ...SESSION_PAGE, sessionId: "2026-01-01_00-00-00" });
  assert.equal(answer.statusCode, 200, answer.body);
  const { session } = answer.json().bundle;
  assert.equal(session.sessionId, "2026-01-01_00-00-00");
  assert.equal(typeof session.unreadable, "string");
  assert.equal(session.routing, undefined);
});

test("without a host, the computer's person reports and nothing is sent", async (t) => {
  const h = await harness(t, { host: NO_PROBLEM_REPORT_HOST, hosted: false });
  const answer = await h.collect(null, SESSION_PAGE);
  assert.equal(answer.statusCode, 200, answer.body);
  const { bundle, draftId, delivery } = answer.json();
  assert.equal(delivery, null);
  assert.equal(bundle.reporter.role, "owner");
  assert.ok(bundle.reporter.username, "this computer's person");
  assert.deepEqual(bundle.host, []);
  assertNoneLeaks(problemReportText(bundle), "the local bundle");
  const sent = await h.send(null, { draftId });
  assert.equal(sent.statusCode, 409);
  assert.equal(sent.json().code, "vibe64_problem_report_no_delivery");
});

test("with a host, a missing person refuses even where no operation context names one", async () => {
  assert.equal(createReporter(true)(null), null);
  assert.equal(createReporter(true)(ADA), ADA);
  assert.equal(createReporter(false)(BEN), BEN);
  // The service itself refuses, before reading anything, whatever its route checked first.
  const reads = [];
  const service = createProblemReportService({
    sessions: { read: async (sessionId) => reads.push(sessionId) },
    host: NO_PROBLEM_REPORT_HOST,
    reporter: createReporter(true)
  });
  const refused = { statusCode: 401, code: "vibe64_problem_report_person_required" };
  for (const vibe64User of [null, undefined, { username: "" }, { uid: 7 }]) {
    await assert.rejects(service.collect({ page: "Session", sessionId: "s-1", vibe64User }, { projectSlug: SLUG }), refused);
    await assert.rejects(service.send({ draftId: "d-1", vibe64User }), refused);
  }
  assert.deepEqual(reads, []);
});
