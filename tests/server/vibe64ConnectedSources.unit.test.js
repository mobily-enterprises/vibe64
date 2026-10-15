import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { sessionConnectedSources } from "@local/vibe64-core/server/projectRepository";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { createService } from "../../packages/vibe64-sessions/src/server/service.js";
import { withRouteProject } from "./vibe64RouteTestHelpers.js";

test("connected preparation reauthorizes the receiver and retries its reserved source through normal session creation", async () => {
  await withRouteProject(async ({ projectContext, slug }) => {
    await mkdir(path.join(projectContext.projectsRoot, "library"));
    const actor = { username: "developer", role: "owner" };
    const source = { repository: "example/library", integrationBranch: "main", baseCommit: "a".repeat(40) };
    const parent = { sessionId: "parent", status: "active", sourceReady: true, metadata: {
      assistant_routing: JSON.stringify({ mode: "senior", review: false, workflowEngineId: "opencode" })
    } };
    const sessionsByProject = { [slug]: new Map([["parent", parent]]), library: new Map() };
    const calls = [];
    let allowReceiver = false;
    let allowWrite = true;
    let loseCreateResponse = true;
    let createCount = 0;
    let includeOther = false;
    const runtimeFor = projectSlug => ({
      store: {
        async writeMetadataValue(id, key, value) { sessionsByProject[projectSlug].get(id).metadata[key] = value; },
        async assertSessionCreationAbsent(id) { assert.equal(sessionsByProject[projectSlug].has(id), false); }
      },
      async getSession(id) { return sessionsByProject[projectSlug].get(id) || null; },
      async listSessionSummaries() { return [...sessionsByProject[projectSlug].values()]; },
      async createSession(input) {
        createCount++;
        assert.equal(projectSlug, "library");
        assert.equal(input.sourceContext.expectedCommit, source.baseCommit);
        assert.equal(input.sourceContext.vibe64User.username, actor.username);
        assert.equal(sessionConnectedSources(parent).length, 1, "reserve the origin binding before creating source");
        const session = { sessionId: input.sessionId, metadata: input.metadata, sourceReady: true, status: "active" };
        sessionsByProject[projectSlug].set(session.sessionId, session);
        if (loseCreateResponse) { loseCreateResponse = false; throw new Error("lost creation acknowledgement"); }
        return session;
      }
    });
    const project = {
      async createRuntime() { return runtimeFor(currentProjectRequestContext().slug); },
      async connectedProjectTargets() { return [
        { name: "Library", repository: "https://github.com/example/library", relationship: "dependency", projectSlug: "library" },
        ...(includeOther ? [{ name: "Other", repository: "https://github.com/example/other", relationship: "dependency", projectSlug: "other" }] : [])
      ]; },
      async connectedContributionSource() {
        assert.equal(currentProjectRequestContext().slug, "library");
        if (!allowWrite) throw Object.assign(new Error("Repository write access revoked"), { code: "vibe64_connections_access_required" });
        return source;
      },
      async readCurrentProject() { return { repositoryMode: "github", repository: { defaultBranch: "main", github: { fullName: source.repository } } }; },
      async runProjectSessionPolicyExclusive(operation) { calls.push("receiving capacity admission"); return operation(); },
      async developmentDatabasePolicy() { return { creation: { canCreate: true }, limits: {} }; }
    };
    const actions = createActionCatalogue();
    const service = createService({ actions, project, initializeModelRouting: async () => ({ ok: true }),
      workspaceSetupRunner: { start: async () => ({ completion: null }) },
      terminals: {
        openBrowserConversation() { throw new Error("Source preparation must not start a conversation."); },
        async runConnectedSourcePreparation(id, _input, operation) {
          assert.equal(currentProjectRequestContext().slug, slug);
          assert.equal(id, parent.sessionId);
          return operation({ runtime: runtimeFor(slug), session: parent });
        },
        async resolveAssistantPurpose() { return { available: true, connectionIdentity: "account", effectiveSelection: {
          agentId: "build", catalogRevision: `sha256:${"b".repeat(64)}`, engineId: "opencode", modelId: "big-pickle",
          modelProviderId: "opencode", schema: "vibe64.assistant-selection.v1", variantId: ""
        } }; },
        async requireAssistantSelectionAccess() {}
      }
    });
    actions.register({ contributorId: "connected", domain: "sessions", actions: createSessionActions({ sessions: service }).map(action => ({
      channels: ["api", "internal"], surfaces: ["app"], ...action
    })) });
    registerVibe64ActionContext(actions, { projectContext,
      async resolveUser({ request }) {
        assert.equal(request.headers.cookie, "original-connection");
        return actor;
      },
      async authorizeProject({ slug: target, definition }) {
        calls.push(`${definition.id}:${target}`);
        if (target === "other") throw Object.assign(new Error("Other project access unavailable"), { code: "other_unavailable" });
        if (target === "library" && definition.id.endsWith(".allocate") && !allowReceiver) {
          throw Object.assign(new Error("Receiving project access revoked"), { code: "receiver_forbidden" });
        }
      }
    });
    const request = Object.assign(Object.create({ headers: { cookie: "original-connection" } }), { params: { slug } });
    const context = { channel: "api", surface: "app", requestMeta: { request } };
    const prepare = () => actions.execute({ actionId: "vibe64.sessions.connected.prepare", input: { sessionId: "parent" }, context });
    const denied = await prepare();
    assert.equal(denied.code, "receiver_forbidden");
    assert.deepEqual(denied.prepared, []);
    assert.equal(denied.failedRepository, "https://github.com/example/library");
    assert.equal(createCount, 0);
    const reserved = parent.metadata.connected_sources;
    const [binding] = sessionConnectedSources(parent);
    assert.equal(binding.projectSlug, "library");
    assert.deepEqual(Object.keys(binding.contribution).sort(), ["baseCommit", "id", "integrationBranch", "repository", "schemaVersion"]);

    allowReceiver = true;
    const interrupted = await prepare();
    assert.equal(interrupted.ok, false);
    assert.match(interrupted.error, /lost creation acknowledgement/u);
    assert.equal(createCount, 1);
    assert.equal(parent.metadata.connected_sources, reserved);
    const result = await prepare();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.prepared[0].sessionId, binding.contribution.id);
    assert.equal(result.prepared[0].sourceReady, true);
    assert.equal(createCount, 1, "retry reuses the exact existing source");
    assert.equal(parent.metadata.connected_sources, reserved);
    assert.ok(calls.includes("receiving capacity admission"));

    await mkdir(path.join(projectContext.projectsRoot, "other"));
    includeOther = true;
    const partial = await prepare();
    assert.equal(partial.code, "other_unavailable");
    assert.equal(partial.failedRepository, "https://github.com/example/other");
    assert.deepEqual(partial.prepared, result.prepared, "an exception for a later receiver retains earlier preparation results");
    assert.equal(parent.metadata.connected_sources, reserved);
    includeOther = false;

    const received = sessionsByProject.library.get(binding.contribution.id);
    received.sourceReady = false;
    const unavailable = await prepare();
    assert.equal(unavailable.ok, false);
    assert.equal(unavailable.code, "vibe64_connected_source_unavailable");
    assert.equal(unavailable.prepared[0].sessionId, binding.contribution.id);
    assert.equal(unavailable.prepared[0].sourceReady, false);
    assert.equal(createCount, 1, "failed source remains owned by its original recovery session");
    received.sourceReady = true;

    allowWrite = false;
    assert.equal((await prepare()).code, "vibe64_connections_access_required");
    assert.equal(createCount, 1);
    allowWrite = true;
    received.metadata.connected_contribution = JSON.stringify({ ...binding.contribution, baseCommit: "c".repeat(40) });
    assert.equal((await prepare()).code, "vibe64_contribution_authority_changed");
    assert.equal(createCount, 1);
    await assert.rejects(actions.execute({ actionId: "vibe64.sessions.connected.allocate",
      input: { projectSlug: "library", contribution: binding.contribution }, context: { ...context, requestMeta: undefined } }));
  });
});
