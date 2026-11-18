// Add a service: what a session's Stack can add (a database, Redis, a bucket or
// another App Service), Genesis's own `stack add` writing it, and who may ask.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext, createVibe64ActionPolicy } from "@local/vibe64-core/server/actionContext";
import { createStudioProjectContext } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { addGenesisStack, initializeGenesisProject } from "../../packages/vibe64-genesis/src/server/index.js";
import { createProjectActions } from "../../packages/vibe64-project/src/server/projectActions.js";
import { registerRoutes } from "../../packages/vibe64-project/src/server/registerRoutes.js";
import { createService } from "../../packages/vibe64-project/src/server/service.js";
import { STACK_SERVICE_KINDS } from "../../packages/vibe64-project/src/server/stackServices.js";
import { findRegisteredRoute, routeProjectParams, testReply, testRouteApp, withRouteProject } from "./vibe64RouteTestHelpers.js";
import { projectServiceCollaborators, sourceMetadata, sourcePath, withTemporaryRoot } from "./vibe64TestHelpers.js";

const exec = promisify(execFile);
const SESSION = "2026-11-19_01-00-00";
const DB_NAMES = { database: "DB_NAME", host: "DB_HOST", password: "DB_PASSWORD", port: "DB_PORT", username: "DB_USER" };

/** A session whose source is a Genesis project with these Stack pieces. */
async function fixture(targetRoot, pieces) {
  const root = sourcePath(targetRoot, SESSION);
  await mkdir(root, { recursive: true });
  await exec("git", ["init", "--quiet", "--initial-branch=main"], { cwd: root });
  await initializeGenesisProject({ projectRoot: root });
  await addGenesisStack({ projectRoot: root, pieces });
  const service = createService({ ...projectServiceCollaborators(), logger: console, env: {},
    projectContext: createStudioProjectContext({
      env: process.env,
      explicitManagedSourceRoot: path.join(path.dirname(targetRoot), "managed-source"),
      explicitSystemRoot: path.join(path.dirname(targetRoot), "system"),
      explicitTargetRoot: targetRoot,
      home: path.dirname(targetRoot)
    }) });
  const store = await service.createSessionStore();
  await store.createSession({ runtimeKind: "genesis", sessionId: SESSION, metadata: sourceMetadata(targetRoot, SESSION) });
  return { root, service, store };
}

const choice = (answer, kind) => answer.choices.find((entry) => entry.kind === kind);

test("a JSKIT session offers each kind through the catalogue's piece, with the Env names the app reads", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { service } = await fixture(targetRoot, ["jskit"]);
    const answer = await service.readStackServiceChoices({ sessionId: SESSION });
    assert.equal(answer.ok, true, JSON.stringify(answer));
    assert.deepEqual(answer.choices.map(({ kind }) => kind), [...STACK_SERVICE_KINDS, "service"]);
    assert.equal(answer.managed, false, "a local editor supplies no development values");
    assert.match(answer.stackHash, /\S/u);
    const postgresql = choice(answer, "postgresql");
    assert.deepEqual({ ...postgresql, alternatives: undefined }, {
      kind: "postgresql",
      piece: "jskit-postgresql",
      resourceId: "database",
      bindings: DB_NAMES,
      alternatives: undefined,
      present: false,
      needsAi: false,
      refused: ""
    });
    assert.deepEqual(postgresql.alternatives, [{ url: "DATABASE_URL" }]);
    assert.equal(choice(answer, "mysql").piece, "jskit-mysql");
    assert.equal(choice(answer, "mysql").refused, "");
    assert.deepEqual(choice(answer, "redis"), { kind: "redis", piece: "jskit-redis", resourceId: "redis",
      bindings: { url: "REALTIME_REDIS_URL" }, alternatives: [], present: false, needsAi: false, refused: "" });
    assert.equal(choice(answer, "bucket").piece, "jskit-bucket");
    assert.equal(choice(answer, "bucket").resourceId, "files");
    assert.equal(choice(answer, "bucket").bindings.driver, "JSKIT_STORAGE_DRIVER");
    assert.equal(choice(answer, "bucket").bindings.secretAccessKey, "JSKIT_STORAGE_S3_SECRET_ACCESS_KEY");
    assert.deepEqual(choice(answer, "service"), {
      kind: "service", piece: null, resourceId: null, bindings: {}, alternatives: [], present: false, needsAi: true, refused: "",
      services: [{ id: "web", exposure: "public" }]
    });
  });
});

test("with MySQL declared, MySQL is already added and PostgreSQL is refused: a project has one database", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { service } = await fixture(targetRoot, ["jskit-mysql"]);
    const answer = await service.readStackServiceChoices({ sessionId: SESSION });
    assert.equal(answer.ok, true, JSON.stringify(answer));
    assert.equal(choice(answer, "mysql").present, true);
    assert.equal(choice(answer, "mysql").refused, "Already added: database (mysql)");
    assert.equal(choice(answer, "postgresql").present, false);
    assert.equal(choice(answer, "postgresql").refused, "A project has one database: this one has database (mysql)");
    const refused = await service.addStackService({ sessionId: SESSION, kind: "postgresql" });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "vibe64_stack_service_refused");
    assert.equal(refused.error, "A project has one database: this one has database (mysql)");
  });
});

test("a stack the catalogue has no ready entry for leaves the declaration to the AI; public names no framework", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { root, service } = await fixture(targetRoot, ["laravel"]);
    const answer = await service.readStackServiceChoices({ sessionId: SESSION });
    assert.equal(answer.ok, true, JSON.stringify(answer));
    // The same rule finds Laravel's own PostgreSQL entry, and none for Redis.
    assert.equal(choice(answer, "postgresql").piece, "laravel-postgresql");
    const redis = choice(answer, "redis");
    assert.equal(redis.piece, null);
    assert.equal(redis.needsAi, true);
    assert.equal(redis.refused, "");
    assert.equal(redis.resourceId, "redis");
    const before = await readFile(path.join(root, "genesis/stack.md"), "utf8");
    const added = await service.addStackService({ sessionId: SESSION, kind: "redis" });
    assert.equal(added.ok, true, JSON.stringify(added));
    assert.equal(added.added, null);
    assert.equal(added.needsAi, true);
    assert.deepEqual(added.aiTask, { kind: "add-service", input: { kind: "redis", resourceId: "redis" } });
    assert.equal(await readFile(path.join(root, "genesis/stack.md"), "utf8"), before, "nothing is written without a ready entry");
  });
});

test("Add writes genesis/stack.md through Genesis's stack add: its component line and its resource block", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { root, service } = await fixture(targetRoot, ["jskit"]);
    const before = await service.readStackServiceChoices({ sessionId: SESSION });
    const added = await service.addStackService({ sessionId: SESSION, kind: "postgresql", vibe64User: { role: "member" } });
    assert.equal(added.ok, true, JSON.stringify(added));
    assert.equal(added.needsAi, false);
    assert.deepEqual(added.added, { component: "jskit-postgresql", id: "database", kind: "postgresql", bindings: DB_NAMES,
      alternatives: [{ url: "DATABASE_URL" }] });
    assert.deepEqual(added.aiTask, { kind: "add-service", input: { kind: "postgresql", resourceId: "database" } });
    assert.ok(added.changedFiles.includes("genesis/stack.md"), JSON.stringify(added.changedFiles));
    const stack = await readFile(path.join(root, "genesis/stack.md"), "utf8");
    assert.match(stack, /^- `jskit-postgresql`$/mu);
    assert.match(stack, /```json genesis-resource\n\{\n {2}"id": "database",\n {2}"kind": "postgresql"/u);
    const after = await service.readStackServiceChoices({ sessionId: SESSION });
    assert.notEqual(after.stackHash, before.stackHash);
    assert.equal(added.stackHash, after.stackHash);
    assert.equal(choice(after, "postgresql").refused, "Already added: database (postgresql)");
    assert.equal(choice(after, "mysql").refused, "A project has one database: this one has database (postgresql)");
    const again = await service.addStackService({ sessionId: SESSION, kind: "postgresql" });
    assert.equal(again.code, "vibe64_stack_service_refused", "adding it twice is refused, not written twice");
  });
});

test("a piece already selected whose resource the project removed leaves the declaration to the AI", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { root, service } = await fixture(targetRoot, ["jskit-postgresql"]);
    const stackPath = path.join(root, "genesis/stack.md");
    const stack = await readFile(stackPath, "utf8");
    await writeFile(stackPath, stack.replace(/## Resources\n[\s\S]*?(?=\n## |$)/u, ""));
    assert.doesNotMatch(await readFile(stackPath, "utf8"), /## Resources/u);
    const postgresql = choice(await service.readStackServiceChoices({ sessionId: SESSION }), "postgresql");
    assert.deepEqual([postgresql.piece, postgresql.needsAi, postgresql.present, postgresql.refused], [null, true, false, ""]);
    assert.equal(postgresql.bindings.host, "DB_HOST", "the AI is shown the piece's Env names");
    const added = await service.addStackService({ sessionId: SESSION, kind: "postgresql" });
    assert.deepEqual([added.ok, added.added, added.needsAi], [true, null, true], JSON.stringify(added));
  });
});

test("Add adopts the piece's resource into a Resources section the project already has", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { root, service } = await fixture(targetRoot, ["jskit"]);
    const stackPath = path.join(root, "genesis/stack.md");
    const bucket = { id: "files", kind: "bucket", environmentAlternatives: [{ preferred: true, bindings: {
      bucket: "STORAGE_BUCKET", region: "STORAGE_REGION", endpoint: "STORAGE_ENDPOINT", accessKeyId: "STORAGE_KEY_ID",
      secretAccessKey: "STORAGE_SECRET" } }] };
    const resources = `## Resources\n\n\`\`\`json genesis-resource\n${JSON.stringify(bucket, null, 2)}\n\`\`\`\n`;
    await writeFile(stackPath, `${(await readFile(stackPath, "utf8")).trimEnd()}\n\n${resources}`);
    assert.equal(choice(await service.readStackServiceChoices({ sessionId: SESSION }), "bucket").refused, "Already added: files (bucket)");
    const added = await service.addStackService({ sessionId: SESSION, kind: "postgresql" });
    assert.equal(added.ok, true, JSON.stringify(added));
    assert.equal(added.added?.id, "database", "Genesis adds the new piece's resource beside the project's own");
    const stack = await readFile(stackPath, "utf8");
    assert.ok(stack.includes(JSON.stringify(bucket, null, 2)), "the project's own bucket block is left as it was");
  });
});

test("Add is refused while an AI task runs in the session, and in a session this project does not have", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { root, service, store } = await fixture(targetRoot, ["jskit"]);
    const before = await readFile(path.join(root, "genesis/stack.md"), "utf8");
    await store.writeSessionConversation(SESSION, "task-1", { task: { active: true, repository: true, title: "Fix Update" } });
    const busy = await service.addStackService({ sessionId: SESSION, kind: "postgresql" });
    assert.equal(busy.ok, false);
    assert.equal(busy.code, "vibe64_ai_task_active");
    assert.equal(busy.error, "Fix Update is still running. Wait for it to finish first.");
    assert.equal(await readFile(path.join(root, "genesis/stack.md"), "utf8"), before);
    for (const answer of [
      await service.readStackServiceChoices({ sessionId: "another-session" }),
      await service.addStackService({ sessionId: "another-session", kind: "postgresql" })
    ]) {
      assert.equal(answer.ok, false);
      assert.equal(answer.code, "vibe64_session_not_found");
    }
    const unknown = await service.addStackService({ sessionId: SESSION, kind: "mongodb" });
    assert.equal(unknown.code, "vibe64_stack_service_kind_unknown");
  });
});

test("another App Service is the AI's to declare: Add checks its name and who reaches it, and writes nothing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { root, service } = await fixture(targetRoot, ["jskit"]);
    const before = await readFile(path.join(root, "genesis/stack.md"), "utf8");
    const added = await service.addStackService({ sessionId: SESSION, kind: "service", serviceId: "worker", reachedBy: "web" });
    assert.equal(added.ok, true, JSON.stringify(added));
    assert.deepEqual(added.aiTask, { kind: "add-service",
      input: { kind: "service", serviceId: "worker", exposure: "internal", reachedBy: "web" } });
    assert.equal(await readFile(path.join(root, "genesis/stack.md"), "utf8"), before);
    for (const [input, error] of [
      [{ serviceId: "web", reachedBy: "web" }, "This Deployment already has a service named web."],
      [{ serviceId: "Worker!", reachedBy: "web" }, "A service name is lowercase letters, digits and dashes, starting with a letter, up to 16 characters."],
      [{ serviceId: "worker", reachedBy: "api" }, "This Deployment has no service api to reach worker: its services are web."]
    ]) {
      const refused = await service.addStackService({ sessionId: SESSION, kind: "service", ...input });
      assert.equal(refused.code, "vibe64_stack_service_refused", JSON.stringify(input));
      assert.equal(refused.error, error);
    }
  });
});

test("the routes run their actions for the URL's session; a non-member is refused before the input is validated", async () => {
  await withRouteProject(async ({ apiRouteBase, projectContext }) => {
    const calls = [];
    let member = true;
    let answer = { ok: true };
    const project = {
      readStackServiceChoices: async (input) => { calls.push(["choices", input]); return answer; },
      addStackService: async (input) => { calls.push(["add", input]); return answer; }
    };
    const user = { uid: 7, username: "member", role: "member" };
    const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: false }) });
    actions.register({ contributorId: "project", domain: "project", actions: createProjectActions({ project })
      .map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => user,
      authorizeProject: async () => { if (!member) throw Object.assign(new Error("Not a member of this project."), { statusCode: 403 }); } });
    const app = testRouteApp();
    registerRoutes(app.http, { localhostCheckBypassed: true, projectContext });
    const route = (method, suffix) => findRegisteredRoute(app, { method, path: `${apiRouteBase}/vibe64/sessions/:sessionId/stack/${suffix}` });
    const request = (actionId, body) => ({
      params: routeProjectParams({ sessionId: SESSION }),
      input: { body: { ...body, sessionId: "forged-session", vibe64User: { role: "owner" } } },
      vibe64User: user,
      executeAction({ actionId: dispatched, input }) {
        assert.equal(dispatched, actionId);
        return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request: this } } });
      }
    });
    const read = route("GET", "service-choices");
    const add = route("POST", "services");
    assert.ok(read && add);
    await read.handler(request("vibe64.project.stack.services.read", {}), testReply());
    await add.handler(request("vibe64.project.stack.services.add", { kind: "postgresql" }), testReply());
    assert.deepEqual(calls, [
      ["choices", { sessionId: SESSION, vibe64User: user }],
      ["add", { sessionId: SESSION, kind: "postgresql", vibe64User: user }]
    ], "the URL names the session; the body's session and user are never taken");
    calls.length = 0;
    member = false;
    await assert.rejects(read.handler(request("vibe64.project.stack.services.read", {}), testReply()), { statusCode: 403 });
    await assert.rejects(add.handler(request("vibe64.project.stack.services.add", { kind: "mongodb" }), testReply()), { statusCode: 403 },
      "a non-member's refusal comes before the unknown kind's");
    assert.equal(calls.length, 0);
    member = true;
    await assert.rejects(add.handler(request("vibe64.project.stack.services.add", { kind: "mongodb" }), testReply()),
      { code: "ACTION_VALIDATION_FAILED" });
    assert.equal(calls.length, 0, "an unknown kind never reaches the service");
    for (const [code, status] of [["vibe64_session_not_found", 404], ["vibe64_stack_service_refused", 409], ["vibe64_ai_task_active", 409]]) {
      answer = { ok: false, code, error: "Refused." };
      const reply = testReply();
      await add.handler(request("vibe64.project.stack.services.add", { kind: "postgresql" }), reply);
      assert.equal(reply.statusCode, status, code);
    }
  });
});
