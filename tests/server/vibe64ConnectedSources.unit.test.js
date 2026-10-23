import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { sessionConnectedSources, sessionRepositoryDestination } from "@local/vibe64-core/server/projectRepository";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { createService } from "../../packages/vibe64-sessions/src/server/service.js";
import { createSessionRenewalDraft, createSessionRenewalState } from "../../packages/vibe64-sessions/src/server/sessionRenewalState.js";
import { withRouteProject } from "./vibe64RouteTestHelpers.js";

test("connected preparation reauthorizes the receiver and retries its reserved source through normal session creation", async () => {
  await withRouteProject(async ({ projectContext, slug }) => {
    await mkdir(path.join(projectContext.projectsRoot, "library"));
    const actor = { username: "developer", role: "owner" };
    const source = { repository: "example/library", integrationBranch: "main", baseCommit: "a".repeat(40) };
    const parent = { sessionId: "parent", status: "active", sourceReady: true, metadata: {
      assistant_routing: JSON.stringify({ mode: "senior", review: false })
    } };
    const sessionsByProject = { [slug]: new Map([["parent", parent]]), library: new Map() };
    const sourceFor = projectSlug => ({ ...source, repository: `example/${projectSlug}` });
    let preparingSession = parent;
    let preparingProject = slug;
    let setupStarts = 0;
    // The receiving checkout's state for the automatic update during preparation.
    const receiving = { agentActive: false, behind: 0, conflict: false, published: "", ahead: 0 };
    const receivingUpdates = [];
    const calls = [];
    let allowReceiver = false;
    let allowWrite = true;
    let loseCreateResponse = true;
    let createCount = 0;
    let includeOther = false;
    let connectedPreparation;
    let automaticMode = "";
    let incomingReview;
    let incomingState = "discarded";
    const renewalStates = new Map();
    let expectedSourceSessionId = "";
    const runtimeFor = projectSlug => ({
      async resolvePromptEnvironment() { return {}; },
      store: {
        async readSessionRenewalStateRecord(id) { return renewalStates.get(id) || ""; },
        async readBackgroundTask() { return null; },
        async writeBackgroundTaskEvent(_id, _key, { patch }) { return patch; },
        async writeMetadataValue(id, key, value) { sessionsByProject[projectSlug].get(id).metadata[key] = value; },
        async readMetadataValue(id, key) { return sessionsByProject[projectSlug].get(id).metadata[key] || ""; },
        async writeSessionLabel(id, name) { sessionsByProject[projectSlug].get(id).sessionName = name; return name; },
        async assertSessionCreationAbsent(id) { assert.equal(sessionsByProject[projectSlug].has(id), false); }
      },
      async getSession(id) { return structuredClone(sessionsByProject[projectSlug].get(id) || null); },
      async listSessionSummaries() { return [...sessionsByProject[projectSlug].values()]; },
      async createSession(input) {
        createCount++;
        assert.notEqual(projectSlug, preparingProject);
        assert.equal(input.sourceContext.expectedCommit, JSON.parse(input.metadata.connected_contribution).baseCommit);
        assert.equal(input.sourceContext.vibe64User.username, actor.username);
        assert.equal(sessionConnectedSources(preparingSession).length, 1, "reserve the origin binding before creating source");
        assert.equal(input.metadata.connected_sources, undefined, "a fresh contribution does not inherit origin source bindings");
        assert.equal(input.metadata.connected_submissions, undefined, "a fresh contribution does not inherit origin merge requirements");
        const session = { sessionId: input.sessionId, metadata: input.metadata, sourceReady: true, status: "active" };
        sessionsByProject[projectSlug].set(session.sessionId, session);
        if (loseCreateResponse) { loseCreateResponse = false; throw new Error("lost creation acknowledgement"); }
        return session;
      }
    });
    const project = {
      async inspectConnectedDevelopmentInputs({ session, projects }) {
        assert.equal(session.sessionId, preparingSession.sessionId);
        assert.equal(projects.length, 1);
        assert.equal(projects[0].session.sessionId, expectedSourceSessionId || sessionConnectedSources(session)[0].contribution.id);
        calls.push("inspect connected source inputs");
        return { sourcesFile: ".development/sources.json", status: "inputs-prepared", recipeHash: "test-recipe" };
      },
      async prepareConnectedDevelopmentInputs({ session, projects }) {
        assert.equal(session.sessionId, preparingSession.sessionId);
        assert.equal(projects.length, 1);
        assert.equal(projects[0].repository, `https://github.com/example/${preparingProject === "library" ? slug : "library"}`);
        assert.equal(projects[0].session.sourceReady, true);
        calls.push("project connected source inputs");
        return { sourcesFile: ".development/sources.json", status: "inputs-prepared", recipeHash: "test-recipe" };
      },
      async createRuntime() { return runtimeFor(currentProjectRequestContext().slug); },
      async connectedProjectTargets() {
        const receivingProject = currentProjectRequestContext().slug === "library" ? slug : "library";
        return [
        { name: "Connected", repository: `https://github.com/example/${receivingProject}`, relationship: "dependency", projectSlug: receivingProject },
        ...(includeOther ? [{ name: "Other", repository: "https://github.com/example/other", relationship: "dependency", projectSlug: "other" }] : [])
      ]; },
      async connectedContributionSource() {
        assert.notEqual(currentProjectRequestContext().slug, preparingProject);
        if (!allowWrite) throw Object.assign(new Error("Repository write access revoked"), { code: "vibe64_connections_access_required" });
        return sourceFor(currentProjectRequestContext().slug);
      },
      async readCurrentProject() { return { repositoryMode: "github", repository: { defaultBranch: "main",
        github: { fullName: sourceFor(currentProjectRequestContext().slug).repository } } }; },
      async runProjectSessionPolicyExclusive(operation) { calls.push("receiving capacity admission"); return operation(); },
      async developmentDatabasePolicy() { return { creation: { canCreate: true }, limits: {} }; }
    };
    const actions = createActionCatalogue();
    const service = createService({ actions, project, initializeModelRouting: async () => ({ ok: true }),
      workspaceSetupRunner: { start: async () => { setupStarts++; return { completion: null }; } },
      terminals: {
        async inspectSessionWork(id, { session, inspectContributionPublication }) {
          calls.push(`inspect work:${id}`);
          return { ok: true, unsaved: false, ahead: receiving.ahead, baseCommit: "a".repeat(40),
            ...(inspectContributionPublication ? { publishedCommit: receiving.published } : {}),
            destination: sessionRepositoryDestination(await project.readCurrentProject(), session) };
        },
        async agentSessionState() { return { turn: { active: receiving.agentActive } }; },
        async checkSessionUpdates() {
          return { ok: true, ahead: receiving.ahead, behind: receiving.behind, canonicalCommit: "e".repeat(40) };
        },
        async updateSessionWork(id, { onRepositoryWriteAcquired }) {
          receivingUpdates.push(id);
          await onRepositoryWriteAcquired();
          if (receiving.conflict) {
            throw Object.assign(new Error("conflict"), { code: "vibe64_session_update_conflict",
              details: { conflictPaths: ["src/a.js"], conflictRecovery: { conflictPaths: ["src/a.js"] } } });
          }
          return { canonicalCommit: "e".repeat(40), reconciled: true, status: "updated" };
        },
        async saveSessionWork(id, input) {
          calls.push(`save work:${id}`);
          assert.equal(input.destinationReview.sessionId, id);
          return { ok: true, saveCommit: "d".repeat(40), reconciled: true, status: "saved" };
        },
        async inspectIncomingContributions(id) {
          assert.equal(currentProjectRequestContext().slug, "library");
          assert.equal(id, incomingReview.id);
          return { ok: true, repository: source.repository, contributions: [{ id, status: incomingState,
            activeHead: incomingReview.activeHead, discardedHead: incomingReview.discardedHead, review: incomingReview }] };
        },
        setConnectedPreparation(prepare) { connectedPreparation = prepare; },
        openBrowserConversation() { throw new Error("Source preparation must not start a conversation."); },
        async runConnectedSourcePreparation(id, _input, operation) {
          assert.equal(currentProjectRequestContext().slug, preparingProject);
          assert.equal(id, preparingSession.sessionId);
          const source = { runtime: runtimeFor(preparingProject), session: preparingSession };
          return automaticMode ? connectedPreparation({ ...source, mode: automaticMode }) : operation(source);
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
        if (target === "library" && (definition.id.endsWith(".allocate") || definition.id.includes(".work.")) && !allowReceiver) {
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
    assert.equal(result.development.status, "inputs-prepared");
    assert.equal(result.development.sourcesFile, ".development/sources.json");
    assert.equal(createCount, 1, "retry reuses the exact existing source");
    assert.equal(parent.metadata.connected_sources, reserved);
    assert.ok(calls.includes("receiving capacity admission"));

    const inspectInputs = () => actions.execute({ actionId: "vibe64.sessions.connected.inputs.inspect",
      input: { sessionId: "parent" }, context: { ...context, channel: "internal" } });
    const beforeInspection = calls.filter(value => value === "project connected source inputs").length;
    assert.equal((await inspectInputs()).status, "inputs-prepared");
    assert.equal(calls.filter(value => value === "project connected source inputs").length, beforeInspection);
    assert.equal(createCount, 1, "readiness inspection neither allocates nor prepares source");
    allowReceiver = false;
    assert.equal((await inspectInputs()).code, "receiver_forbidden", "readiness reauthorizes the receiving project");
    allowReceiver = true;

    automaticMode = "prepare";
    assert.equal((await prepare()).ok, true, "ordinary setup reuses the already-admitted preparation operation");
    automaticMode = "inspect";
    assert.equal((await prepare()).status, "inputs-prepared", "the runner retains the original action request for fresh inspection");
    allowReceiver = false;
    assert.equal((await prepare()).code, "receiver_forbidden", "retained request metadata never caches receiving access");
    allowReceiver = true;
    automaticMode = "";

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

    const updateOf = async () => (await prepare()).prepared[0].update;
    const startsBefore = setupStarts;
    assert.deepEqual(await updateOf(), { status: "current", commit: "e".repeat(40) });
    assert.equal(receivingUpdates.length, 0, "a checkout already on its branch's latest commit is left alone");
    receiving.behind = 2;
    receiving.agentActive = true;
    assert.deepEqual(await updateOf(), { status: "skipped", reason: "Its agent is working. Update it once the agent finishes." });
    receiving.agentActive = false;
    receiving.published = "b".repeat(40);
    receiving.ahead = 1;
    assert.deepEqual(await updateOf(), { status: "skipped",
      reason: "Its published contribution is not on main yet. Merge it through Incoming changes, then update again." });
    assert.equal(receivingUpdates.length, 0, "a contribution awaiting acceptance is not rewritten");
    receiving.published = "";
    receiving.conflict = true;
    assert.deepEqual(await updateOf(), { status: "skipped",
      reason: "Updating it to main conflicts with its changes in src/a.js. Open its session to review the conflict." });
    assert.equal(setupStarts, startsBefore, "a conflicting update changes nothing");
    receiving.conflict = false;
    assert.deepEqual(await updateOf(), { status: "updated", commit: "e".repeat(40) },
      "unpublished work, including unsaved edits, is carried onto the branch's latest commit");
    assert.equal(receivingUpdates.length, 2);
    assert.equal(setupStarts, startsBefore + 1, "an updated checkout is rebuilt before the consumer links it");
    Object.assign(receiving, { behind: 0, ahead: 0 });

    assert.equal(received.sessionName, "parent", "a receiving session carries its parent's name, not a random identity");
    parent.sessionName = "Payments";
    assert.equal((await prepare()).ok, true);
    assert.equal(received.sessionName, "Payments", "it follows the parent's later name");
    received.sessionName = "Library tweaks";
    parent.sessionName = "Billing";
    assert.equal((await prepare()).ok, true);
    assert.equal(received.sessionName, "Library tweaks", "a name given to the receiving session itself is kept");

    allowWrite = false;
    assert.equal((await prepare()).code, "vibe64_connections_access_required");
    assert.equal(createCount, 1);
    allowWrite = true;
    received.metadata.connected_contribution = JSON.stringify({ ...binding.contribution, baseCommit: "c".repeat(40) });
    assert.equal((await prepare()).code, "vibe64_contribution_authority_changed");
    assert.equal(createCount, 1);
    await assert.rejects(actions.execute({ actionId: "vibe64.sessions.connected.allocate",
      input: { projectSlug: "library", contribution: binding.contribution }, context: { ...context, requestMeta: undefined } }));

    received.metadata.connected_contribution = JSON.stringify(binding.contribution);
    received.unsavedFixture = "Preserve unpublished edits in the original source";
    const oldSource = structuredClone(received);
    parent.metadata.connected_submissions = JSON.stringify({ schemaVersion: 1, submissions: [{
      contribution: binding.contribution, submittedCommit: "b".repeat(40)
    }] });
    const originalSubmissions = parent.metadata.connected_submissions;
    incomingReview = { repository: source.repository, targetBranch: "main", targetHead: source.baseCommit,
      id: binding.contribution.id, activeHead: "", discardedHead: "b".repeat(40) };
    const reviewReplacement = () => actions.execute({ actionId: "vibe64.sessions.connected.replacement.inspect",
      input: { sessionId: "parent", repository: source.repository }, context });
    const replace = (review = incomingReview) => actions.execute({ actionId: "vibe64.sessions.connected.replace",
      input: { sessionId: "parent", repository: source.repository, review }, context });
    allowReceiver = false;
    assert.equal((await reviewReplacement()).code, "receiver_forbidden");
    assert.equal((await replace()).code, "receiver_forbidden");
    assert.equal(parent.metadata.connected_sources, reserved);
    allowReceiver = true;
    incomingState = "pending";
    assert.equal((await replace()).code, "vibe64_connected_replacement_changed");
    incomingState = "discarded";
    assert.equal((await reviewReplacement()).contributions[0].review.discardedHead, "b".repeat(40));
    assert.equal((await replace({ ...incomingReview, discardedHead: "c".repeat(40) })).code,
      "vibe64_connected_replacement_changed");
    assert.equal(parent.metadata.connected_sources, reserved);

    loseCreateResponse = true;
    const lostReplacement = await replace();
    assert.equal(lostReplacement.ok, false);
    assert.match(lostReplacement.error, /lost creation acknowledgement/u);
    const replacementBinding = sessionConnectedSources(parent)[0];
    assert.notEqual(replacementBinding.contribution.id, binding.contribution.id);
    assert.equal(replacementBinding.contribution.replaces, binding.contribution.id);
    assert.equal(replacementBinding.contribution.baseCommit, incomingReview.discardedHead);
    assert.equal(createCount, 2);
    allowWrite = false;
    assert.equal((await replace()).code, "vibe64_connections_access_required", "retry rechecks receiving write access");
    allowWrite = true;
    const replacement = await replace();
    assert.equal(replacement.ok, true, JSON.stringify(replacement));
    assert.equal(replacement.prepared[0].sessionId, replacementBinding.contribution.id);
    assert.equal(createCount, 2, "retry reuses the replacement reserved before allocation");
    assert.deepEqual(sessionsByProject.library.get(binding.contribution.id), oldSource);
    assert.equal(parent.metadata.connected_submissions, originalSubmissions, "replacement cannot erase the original integration gate");
    assert.equal((await prepare()).prepared[0].sessionId, replacementBinding.contribution.id);

    const completeRenewal = (predecessor, successorId) => {
      const state = createSessionRenewalState({ sessionId: predecessor.sessionId, operationKey: `renew-${successorId}` });
      Object.assign(state, { status: "completed", stage: "completed", predecessorArchivedAt: state.createdAt,
        approved: createSessionRenewalDraft("Preserve this contribution and its source."),
        successor: { sessionId: successorId, availableAt: state.createdAt },
        commit: { committedAt: state.createdAt, sourceSessionId: predecessor.sessionId,
          successorSessionId: successorId, selectedBeforeArchive: "none" },
        maintenance: { status: "pending", attempt: 0, steps: {}, updatedAt: state.createdAt }
      });
      const successor = { ...structuredClone(predecessor), sessionId: successorId, status: "active", sourceReady: true,
        metadata: { ...predecessor.metadata, renewed_from: predecessor.sessionId, renewal_id: state.renewalId } };
      delete successor.metadata.renewed_to;
      predecessor.status = "archived";
      predecessor.sourceReady = false;
      Object.assign(predecessor.metadata, { renewed_to: successorId, renewal_id: state.renewalId });
      sessionsByProject.library.set(successorId, successor);
      renewalStates.set(predecessor.sessionId, JSON.stringify(state));
      return successor;
    };
    const firstSuccessor = completeRenewal(sessionsByProject.library.get(replacementBinding.contribution.id), "renewed-library-1");
    const successor = completeRenewal(firstSuccessor, "renewed-library-2");
    expectedSourceSessionId = successor.sessionId;
    assert.equal((await prepare()).prepared[0].sessionId, successor.sessionId, "allocation follows completed reciprocal renewals");
    assert.equal((await inspectInputs()).status, "inputs-prepared");
    assert.equal(createCount, 2, "renewal never creates a new contribution or checkout during allocation");
    const connectedWork = operation => actions.execute({ actionId: `vibe64.sessions.connected.work.${operation}`,
      input: { projectSlug: "library", contribution: replacementBinding.contribution,
        ...(operation === "save" ? { destinationReview: { sessionId: successor.sessionId, mode: "github",
          repository: source.repository, branch: `vibe64-incoming/${replacementBinding.contribution.id}` } } : {}) },
      context: { ...context, channel: "internal", requestMeta: { request: {
        ...request, headers: request.headers, params: { slug: "library" }
      } } } });
    const work = await connectedWork("inspect");
    assert.equal(work.sessionId, successor.sessionId);
    assert.equal(work.destination.sessionId, successor.sessionId);
    assert.equal(work.destination.branch, `vibe64-incoming/${replacementBinding.contribution.id}`);
    const saved = await connectedWork("save");
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.sessionId, successor.sessionId);
    assert.ok(calls.includes(`save work:${successor.sessionId}`));
    assert.equal(JSON.parse(successor.metadata.connected_contribution).id, replacementBinding.contribution.id);
    assert.equal(parent.metadata.connected_submissions, originalSubmissions);
    allowReceiver = false;
    assert.equal((await prepare()).code, "receiver_forbidden");
    await assert.rejects(connectedWork("save"), { code: "receiver_forbidden" });
    allowReceiver = true;
    allowWrite = false;
    assert.equal((await connectedWork("save")).code, "vibe64_connections_access_required");
    allowWrite = true;

    const priorState = renewalStates.get(firstSuccessor.sessionId);
    renewalStates.delete(firstSuccessor.sessionId);
    assert.equal((await prepare()).code, "vibe64_connected_source_unavailable", "a link without completed state is not authority");
    renewalStates.set(firstSuccessor.sessionId, JSON.stringify({ ...JSON.parse(priorState),
      status: "running", stage: "successor_activating" }));
    assert.equal((await prepare()).code, "vibe64_connected_source_unavailable", "committed but unpublished renewal remains unavailable");
    renewalStates.set(firstSuccessor.sessionId, priorState);
    successor.metadata.renewed_from = "unrelated";
    assert.equal((await prepare()).code, "vibe64_connected_source_unavailable", "the successor must acknowledge its predecessor");
    successor.metadata.renewed_from = firstSuccessor.sessionId;
    successor.metadata.connected_contribution = JSON.stringify({ ...replacementBinding.contribution, baseCommit: "e".repeat(40) });
    assert.equal((await prepare()).code, "vibe64_contribution_authority_changed");
    successor.metadata.connected_contribution = JSON.stringify(replacementBinding.contribution);
    successor.status = "archived";
    assert.equal((await prepare()).code, "vibe64_connected_source_unavailable", "ordinary archive is not a renewal alias");
    successor.status = "active";
    sessionsByProject.library.delete(successor.sessionId);
    assert.equal((await prepare()).code, "vibe64_connected_source_unavailable", "missing successor cannot fall back to the old checkout");
    sessionsByProject.library.set(successor.sessionId, successor);
    assert.equal((await prepare()).prepared[0].sessionId, successor.sessionId);

    const originalBindings = parent.metadata.connected_sources;
    const setupStartsBeforeReturn = setupStarts;
    preparingProject = "library";
    preparingSession = successor;
    const returningContext = { ...context, requestMeta: { request: {
      headers: request.headers, params: { slug: "library" }
    } } };
    const prepareReturn = () => actions.execute({ actionId: "vibe64.sessions.connected.prepare",
      input: { sessionId: successor.sessionId }, context: returningContext });
    loseCreateResponse = true;
    assert.match((await prepareReturn()).error, /lost creation acknowledgement/u);
    const returnBinding = sessionConnectedSources(successor)[0];
    assert.equal(returnBinding.contribution.repository, `example/${slug}`);
    assert.notEqual(returnBinding.contribution.id, parent.sessionId, "B connecting back to repository A cannot attach A's originating session");
    assert.notEqual(returnBinding.contribution.id, replacementBinding.contribution.id);
    assert.notEqual(returnBinding.contribution.id, successor.sessionId);
    const returnedSource = sessionsByProject[slug].get(returnBinding.contribution.id);
    assert.equal(returnedSource.metadata.connected_sources, undefined);
    assert.equal(returnedSource.metadata.connected_submissions, undefined);
    assert.equal(setupStarts, setupStartsBeforeReturn, "A→B→A configuration never automatically recurses into the next contribution's setup");
    assert.equal((await prepareReturn()).prepared[0].sessionId, returnBinding.contribution.id);
    assert.equal(createCount, 3, "retry reuses the newly reserved A contribution after acknowledgement loss");
    preparingProject = slug;
    preparingSession = parent;
    assert.equal((await prepare()).prepared[0].sessionId, successor.sessionId);
    assert.equal(parent.metadata.connected_sources, originalBindings);
    assert.equal(createCount, 3, "the original A→B edge also keeps its reserved contribution on retry");

    const original = sessionsByProject.library.get(replacementBinding.contribution.id);
    const cycle = completeRenewal(successor, original.sessionId);
    cycle.status = "archived";
    cycle.metadata = { ...original.metadata, renewed_from: successor.sessionId };
    assert.equal((await prepare()).code, "vibe64_connected_source_unavailable", "a reciprocal cycle never resolves an active checkout");
  });
});
