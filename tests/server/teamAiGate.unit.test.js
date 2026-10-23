import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createStudioProjectContext } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import {
  projectRequestErrorStatusCode,
  resolveProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import { registerTeamAiReadiness } from "../../packages/vibe64-core/src/server/teamAiGate.js";
import { registerWorkspaceTeamReader } from "../../packages/vibe64-core/src/server/workspaceTeam.js";
import { createTeamAiReadiness } from "../../packages/vibe64-accounts/src/server/teamAiReadiness.js";
import { createService as createProjectService } from "../../packages/vibe64-project/src/server/service.js";
import { createVibe64FeatureRoutes } from "../../packages/vibe64-core/src/server/featureRoutes.js";
import { routeProjectParams, testReply, testRouteApp, withLocalRequestBypass, withRouteProject } from "./vibe64RouteTestHelpers.js";

const OWNER = Object.freeze({ uid: 1, username: "tony", role: "owner" });
const MEMBER = Object.freeze({ uid: 42, username: "learner", role: "member" });
const headers = { host: "workspace.example" };
const gated = { code: "vibe64_team_ai_required", statusCode: 403, ownerName: "Tony",
  message: "Ask Tony to set up AI for team members." };

function selection(modelProviderId, modelId, engineId = "claude") {
  return { schema: "vibe64.assistant-selection.v1", engineId, agentId: "build", modelProviderId, modelId,
    variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}`, selectionSource: "explicit" };
}
const DEEPSEEK = selection("deepseek", "deepseek-v4-pro");
const CLAUDE = selection("anthropic", "claude-opus-5-5");
const GLM = selection("zai-coding-plan", "glm-5.3", "codex");

// Live access as the terminals reader answers it: a personal plan is refused
// for a team member, and an unavailable connection is refused for anyone.
function accessReader(access) {
  const reads = [];
  return {
    reads,
    async read(value, { vibe64User }) {
      reads.push([value.modelProviderId, vibe64User?.role]);
      const fact = access[value.modelProviderId] || { available: false, ownerOnly: true };
      if (!fact.available) throw Object.assign(new Error("The selected AI connection is unavailable."), { code: "vibe64_assistant_connection_unavailable" });
      if (fact.ownerOnly && vibe64User?.role !== "owner") throw Object.assign(new Error("Personal."), { code: "vibe64_assistant_owner_required" });
      return { ...fact, connectionIdentity: `${value.modelProviderId}-connection` };
    }
  };
}

function readiness(nonOwner, access, revision = 1) {
  const configuration = { schemaVersion: 5, revision, owner: { senior: CLAUDE }, nonOwner };
  const reader = accessReader(access);
  const teamAi = createTeamAiReadiness({ readRoutingConfiguration: async () => configuration, readSelectionAccess: reader.read });
  return { configuration, reads: reader.reads, teamAi };
}

const LIVE = { deepseek: { available: true, ownerOnly: false }, anthropic: { available: true, ownerOnly: true },
  "zai-coding-plan": { available: true, ownerOnly: true } };

test("team AI is ready only with a usable Workspace-use model in the team setup", async () => {
  const empty = readiness({}, LIVE);
  assert.equal(await empty.teamAi.ready({ actor: MEMBER }), false, "an empty team setup");
  assert.deepEqual(empty.reads, [], "nothing to read without a team selection");

  const personal = readiness({ colleague: CLAUDE, quickHelper: GLM, fix: { follows: "colleague" } }, LIVE);
  assert.equal(await personal.teamAi.ready({ actor: MEMBER }), false, "personal plans only");
  assert.equal(await readiness({ colleague: CLAUDE }, LIVE).teamAi.ready({ actor: OWNER }), false,
    "the owner's view gives the same answer for a personal plan");

  const workspace = readiness({ colleague: CLAUDE, quickHelper: DEEPSEEK }, LIVE);
  assert.equal(await workspace.teamAi.ready({ actor: MEMBER }), true, "one Workspace-use model is enough");
  assert.equal(await readiness({ quickHelper: DEEPSEEK }, LIVE).teamAi.ready({ actor: OWNER }), true);

  const unavailable = readiness({ colleague: DEEPSEEK }, { deepseek: { available: false, ownerOnly: false } });
  assert.equal(await unavailable.teamAi.ready({ actor: MEMBER }), false, "a disconnected key serves no one");

  const off = readiness({ colleague: null, explain: { follows: "quickHelper" } }, LIVE);
  assert.equal(await off.teamAi.ready({ actor: MEMBER }), false, "off roles and Same as an absent role");
});

test("Same as resolves to the followed role's model, and each model is read once", async () => {
  const followed = readiness({ colleague: DEEPSEEK, fix: { follows: "colleague" }, explain: { follows: "colleague" } }, {});
  assert.equal(await followed.teamAi.ready({ actor: MEMBER }), false);
  assert.deepEqual(followed.reads, [["deepseek", "member"]], "three roles, one model, one read");

  const viaFollow = readiness({ colleague: DEEPSEEK, fix: { follows: "colleague" } }, LIVE);
  assert.equal(await viaFollow.teamAi.ready({ actor: MEMBER }), true);
});

test("the answer is kept for the routing revision until accounts or connections change", async () => {
  const access = { deepseek: { available: false, ownerOnly: false } };
  const { configuration, reads, teamAi } = readiness({ colleague: DEEPSEEK }, access);
  assert.equal(await teamAi.ready({ actor: MEMBER }), false);
  access.deepseek = { available: true, ownerOnly: false };
  assert.equal(await teamAi.ready({ actor: MEMBER }), false, "kept: no change event yet");
  assert.equal(reads.length, 1);
  teamAi.invalidate();
  assert.equal(await teamAi.ready({ actor: MEMBER }), true, "a change event reads live access again");
  assert.equal(reads.length, 2);
  access.deepseek = { available: false, ownerOnly: false };
  configuration.revision += 1;
  assert.equal(await teamAi.ready({ actor: MEMBER }), false, "a saved setup is a new revision");
  assert.equal(reads.length, 3);
});

async function withWorkspace(t, ready) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-team-ai-gate-"));
  const projectsRoot = path.join(root, "projects");
  const context = createStudioProjectContext({ explicitProjectsRoot: projectsRoot, explicitSystemRoot: path.join(root, "system"),
    explicitManagedSourceRoot: projectsRoot, env: {}, home: root, learningSpace: { root: path.join(projectsRoot, ".learning") } });
  await context.createWorkspaceProjectRecord({ slug: "hello-node" });
  const asked = [];
  const releaseReadiness = registerTeamAiReadiness(async ({ actor }) => { asked.push(actor?.role || "none"); return ready.value; });
  const releaseTeam = registerWorkspaceTeamReader(async () => ({ available: true, ownerName: "Tony", memberCount: 2 }));
  t.after(async () => {
    releaseReadiness();
    releaseTeam();
    await rm(root, { force: true, recursive: true });
  });
  const open = (request) => resolveProjectRequestContext({ projectContext: context, request: { params: { slug: "hello-node" }, ...request } });
  return { asked, context, open };
}

test("project admission gates only a team member's own requests", async (t) => {
  const ready = { value: false };
  const { asked, open } = await withWorkspace(t, ready);
  for (const request of [{ headers, vibe64User: OWNER }, { headers }, { vibe64User: MEMBER }, {}]) {
    assert.equal((await open(request)).slug, "hello-node", "the owner, local mode and internal work are never gated");
  }
  assert.deepEqual(asked, [], "no readiness read for them");
  const refused = await open({ headers, vibe64User: MEMBER }).catch((error) => error);
  assert.deepEqual({ code: refused.code, statusCode: refused.statusCode, ownerName: refused.ownerName, message: refused.message }, gated);
  assert.deepEqual(refused.details, { ownerName: "Tony" }, "the client reads the owner's name from the refusal");
  assert.equal(projectRequestErrorStatusCode(refused), 403);
  ready.value = true;
  assert.equal((await open({ headers, vibe64User: MEMBER })).slug, "hello-node", "allowed once the team setup is ready");
});

test("the refusal names the workspace owner when the host has no name", async (t) => {
  const { open } = await withWorkspace(t, { value: false });
  const release = registerWorkspaceTeamReader(async () => ({ available: true, ownerName: "", memberCount: 1 }));
  t.after(release);
  await assert.rejects(open({ headers, vibe64User: MEMBER }), {
    code: "vibe64_team_ai_required", message: "Ask the workspace owner to set up AI for team members.", ownerName: ""
  });
});

test("a practice project follows the same rule", async (t) => {
  const ready = { value: false };
  const { context, open } = await withWorkspace(t, ready);
  const learner = MEMBER;
  const training = {
    schemaVersion: 2, learnerKey: Buffer.from("42").toString("base64url"), practiceId: "12345678-1234-4234-8234-123456789abc",
    pin: { course: { courseId: "intro-course", release: "0.1.0" },
      topic: { schemaVersion: 1, topicId: "intro-topic", release: "0.1.0", repository: "example/learn-intro",
        commit: "b".repeat(40), topicHash: "a".repeat(64) },
      lesson: { code: "INTRO-01", hash: "c".repeat(64) } },
    exercise: { kind: "bundled", sourcePath: "training/exercises/app" }
  };
  const slug = `training-${training.practiceId.replaceAll("-", "")}`;
  await context.runWithPracticeProjectScope({ actor: learner, training, access: "create" },
    () => context.createWorkspaceProjectRecord({ slug, training }));
  const practice = (request) => open({ ...request, params: { slug } });
  await assert.rejects(practice({ headers, vibe64User: learner }), { code: "vibe64_team_ai_required" });
  assert.equal((await practice({ vibe64User: learner })).slug, slug, "the lesson's internal work is not gated");
  ready.value = true;
  assert.equal((await practice({ headers, vibe64User: learner })).slug, slug);
});

test("the owner's project list says whether team members can open projects", async (t) => {
  const ready = { value: false };
  const { context } = await withWorkspace(t, ready);
  const project = createProjectService({ projectContext: context });
  const listed = await project.listProjects({ actor: OWNER });
  assert.deepEqual(listed.teamAi, { available: true, ownerName: "Tony", memberCount: 2, ready: false });
  ready.value = true;
  assert.equal((await project.listProjects({ actor: OWNER })).teamAi.ready, true);
  assert.equal(Object.hasOwn(await project.listProjects({ actor: MEMBER }), "teamAi"), false, "only the owner's list");
  const release = registerWorkspaceTeamReader(async () => null);
  t.after(release);
  assert.deepEqual((await project.listProjects({ actor: OWNER })).teamAi,
    { available: false, ownerName: "", memberCount: 0, ready: false }, "a host without team members");
});

test("a project route answers a gated team member with the refusal and the owner's name", async (t) => {
  const releaseReadiness = registerTeamAiReadiness(async () => false);
  const releaseTeam = registerWorkspaceTeamReader(async () => ({ available: true, ownerName: "Tony", memberCount: 1 }));
  t.after(() => { releaseReadiness(); releaseTeam(); });
  await withLocalRequestBypass(() => withRouteProject(async ({ projectContext }) => {
    const app = testRouteApp();
    const routes = createVibe64FeatureRoutes(app.http, { localRequestMessage: "Local only.", projectContext,
      routeRelativePath: "vibe64", routeSurface: "app" });
    routes.actionRoute("GET", "/projects", { actionId: "unit.projects", summary: "List projects." });
    const route = app.registeredRoutes[0];
    const reply = testReply();
    await route.handler({ headers, params: routeProjectParams(), vibe64User: MEMBER,
      async executeAction() { return assert.fail("a gated request runs no action"); } }, reply);
    assert.equal(reply.statusCode, 403);
    assert.deepEqual(reply.payload, { ok: false, code: "vibe64_team_ai_required", details: { ownerName: "Tony" },
      errors: [{ code: "vibe64_team_ai_required", message: "Ask Tony to set up AI for team members." }] });
  }));
});
