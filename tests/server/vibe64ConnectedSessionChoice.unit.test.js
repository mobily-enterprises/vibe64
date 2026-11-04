import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext, createVibe64ActionPolicy } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { sessionConnectedSources, sessionRepositoryDestination } from "@local/vibe64-core/server/projectRepository";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/sessionActions.js";
import { createSessionsService as createService } from "./vibe64SessionsTestHelpers.js";
import { withRouteProject } from "./vibe64RouteTestHelpers.js";

const BASE = "a".repeat(40);
const LINK_REQUIRED = "vibe64_connected_link_required";
const NOT_FREE = "vibe64_connected_session_not_free";

function librarySession(sessionId, { metadata = {}, ...rest } = {}) {
  return { sessionId, sessionName: sessionId, status: "active", sourceReady: true,
    metadata: { base_commit: BASE, ...metadata }, ...rest };
}

/**
 * A working session in one project, connected to "library" and, when `other`
 * is given, to "other", whose sessions are the ones given. The real connected
 * actions run; only the stores, Git and the session creation behind them are
 * doubles.
 * @param {object[]} sessions
 * @param {(world: object) => Promise<void>} run
 * @param {object[]} [other]
 */
async function withConnectedLibrary(sessions, run, other) {
  await withRouteProject(async ({ projectContext, slug }) => {
    await mkdir(path.join(projectContext.projectsRoot, "library"));
    await mkdir(path.join(projectContext.projectsRoot, "other"));
    const parent = { sessionId: "parent", sessionName: "Payments", status: "active", sourceReady: true, metadata: {
      assistant_routing: JSON.stringify({ mode: "senior", review: false })
    } };
    const world = { created: [], library: new Map(sessions.map(session => [session.sessionId, session])), parent,
      beforeBind: () => {}, failNextCreate: false };
    const sessionsByProject = { [slug]: new Map([["parent", parent]]), library: world.library,
      other: new Map((other || []).map(session => [session.sessionId, session])) };
    const runtimeFor = projectSlug => ({
      async resolvePromptEnvironment() { return {}; },
      store: {
        async writeMetadataValue(id, key, value) { sessionsByProject[projectSlug].get(id).metadata[key] = value; },
        async readMetadataValue(id, key) { return sessionsByProject[projectSlug].get(id).metadata[key] || ""; },
        async writeSessionLabel(id, name) { sessionsByProject[projectSlug].get(id).sessionName = name; return name; },
        async assertSessionCreationAbsent(id) { assert.equal(sessionsByProject[projectSlug].has(id), false); },
        async listSessionsForRenewal() { return []; }
      },
      async getSession(id) {
        const session = sessionsByProject[projectSlug].get(id);
        if (!session) throw Object.assign(new Error("Session not found."), { code: "vibe64_session_not_found" });
        return structuredClone(session);
      },
      getSessionWithoutSource(sessionId) { return this.getSession(sessionId); },
      async listSessionSummaries() { return [...sessionsByProject[projectSlug].values()].filter(session => session.status === "active"); },
      async createSession(input) {
        if (world.failNextCreate) {
          world.failNextCreate = false;
          throw new Error("The new session could not start.");
        }
        const session = { sessionId: input.sessionId, metadata: input.metadata, sourceReady: true, status: "active" };
        world.created.push(session);
        sessionsByProject[projectSlug].set(session.sessionId, session);
        return session;
      }
    });
    const project = {
      async inspectConnectedDevelopmentInputs() { return { sourcesFile: ".development/sources.json", status: "inputs-prepared", recipeHash: "test-recipe" }; },
      async prepareConnectedDevelopmentInputs() { return { sourcesFile: ".development/sources.json", status: "inputs-prepared", recipeHash: "test-recipe" }; },
      async createRuntime() { return runtimeFor(currentProjectRequestContext().slug); },
      createRuntimeWithoutSource(options) { return this.createRuntime(options); },
      async connectedProjectTargets() {
        return (other ? ["library", "other"] : ["library"]).map(name => ({ name, repository: `https://github.com/example/${name}`,
          fullName: `example/${name}`, relationship: "dependency", projectSlug: name }));
      },
      async connectedContributionSource() {
        return { repository: `example/${currentProjectRequestContext().slug}`, integrationBranch: "main", baseCommit: "c".repeat(40) };
      },
      async readCurrentProject() { return { repositoryMode: "github", repository: { defaultBranch: "main",
        github: { fullName: `example/${currentProjectRequestContext().slug}` } } }; },
      async runProjectSessionPolicyExclusive(operation) { return operation(); },
      async developmentDatabasePolicy() { return { creation: { canCreate: true }, limits: {} }; }
    };
    const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: false }) });
    const service = createService({ actions, project, initializeModelRouting: async () => ({ ok: true }),
      setupRunner: { start: async () => ({ completion: null }) },
      terminals: {
        async inspectSessionWork(_id, { session, inspectContributionPublication }) {
          return { ok: true, unsaved: false, ahead: 0, baseCommit: BASE, ...(inspectContributionPublication ? { publishedCommit: "" } : {}),
            destination: sessionRepositoryDestination(await project.readCurrentProject(), session) };
        },
        async agentSessionState() { return { turn: { active: false } }; },
        async checkSessionUpdates() { return { ok: true, ahead: 0, behind: 0, canonicalCommit: BASE }; },
        async inspectIncomingContributions(_sessionId, { id }) {
          return { ok: true, repository: "example/library", contributions: [{ id, status: "discarded", activeHead: "",
            discardedHead: "b".repeat(40), review: world.incomingReview }] };
        },
        setConnectedPreparation() {},
        openBrowserConversation() { throw new Error("Source preparation must not start a conversation."); },
        async runConnectedSourcePreparation(id, _input, operation) {
          const projectSlug = currentProjectRequestContext().slug;
          if (projectSlug !== slug) await world.beforeBind();
          return operation({ runtime: runtimeFor(projectSlug), session: sessionsByProject[projectSlug].get(id) });
        },
        async recordSessionGitCommandActor() { return { ok: true }; },
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
      async resolveUser() { return { username: "developer", role: "owner" }; },
      async authorizeProject() {}
    });
    const request = Object.assign(Object.create({ headers: { cookie: "original-connection" } }), { params: { slug } });
    const context = { channel: "api", surface: "app", requestMeta: { request } };
    const action = (name, input = {}) => actions.execute({ actionId: `vibe64.sessions.connected.${name}`,
      input: { sessionId: "parent", ...input }, context });
    await run(Object.assign(world, {
      choices: () => action("choices"),
      link: (connectedSessionId, repository = "example/library") => action("link", { repository, connectedSessionId }),
      prepare: () => action("prepare"),
      replace: review => action("replace", { repository: "example/library", review })
    }));
  });
}

test("a first connection stops Prepare, offers the free sessions and uses the one a person links", async () => {
  const bound = JSON.stringify({ schemaVersion: 1, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", repository: "example/library",
    integrationBranch: "main", baseCommit: BASE });
  await withConnectedLibrary([
    librarySession("archived", { status: "archived" }),
    librarySession("bound", { metadata: { connected_contribution: bound } }),
    librarySession("free-1", { sessionName: "First free" }),
    librarySession("free-2", { sessionName: "Second free", metadata: { canonical_commit: "e".repeat(40) } }),
    librarySession("no-source", { sourceReady: false }),
    librarySession("on-a-branch", { metadata: { repository_branch: "feature" } }),
    librarySession("on-a-pull-request", { metadata: { github_pull_request: "{}" } }),
    librarySession("renewing", { metadata: { renewed_to: "elsewhere" } })
  ], async ({ choices, created, library, link, parent, prepare }) => {
    const stopped = await prepare();
    assert.equal(stopped.code, LINK_REQUIRED, "two free sessions are a person's choice");
    assert.equal(stopped.error, "library needs a connected session. Choose in the workspace preparation notice to continue.");
    assert.deepEqual(stopped.linked, []);
    assert.equal(parent.metadata.connected_sources, undefined, "stopping reserves nothing");

    assert.deepEqual((await choices()).choices, [{ name: "library", projectSlug: "library", reason: "", repository: "example/library",
      sessions: [{ sessionId: "free-1", sessionName: "First free" }, { sessionId: "free-2", sessionName: "Second free" }] }]);

    assert.equal((await link("free-2")).ok, true);
    const [binding] = sessionConnectedSources(parent);
    assert.equal(binding.contribution.sessionId, "free-2");
    assert.equal(binding.contribution.baseCommit, BASE, "the contribution starts where the session's own work starts");
    const session = library.get("free-2");
    assert.deepEqual(JSON.parse(session.metadata.connected_contribution), binding.contribution);
    assert.equal(session.metadata.canonical_commit, BASE, "the session now follows its contribution, not main");

    const prepared = await prepare();
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.equal(prepared.prepared[0].sessionId, "free-2");
    assert.deepEqual((await choices()).choices, []);
    assert.equal(session.sessionName, "Second free", "a linked session keeps its own name");
    assert.equal(created.length, 0, "no session was created");
  });
});

test("an archived or vanished link stops Prepare with its reason until a person relinks", async () => {
  const archivedOn = "2026-10-28T15:30:53.722Z";
  await withConnectedLibrary([librarySession("first", { sessionName: "Library work" }), librarySession("second"),
    librarySession("third"), librarySession("fourth")],
    async ({ choices, created, library, link, parent, prepare }) => {
      assert.equal((await link("first")).ok, true);
      Object.assign(library.get("first"), { status: "archived", archivedAt: archivedOn });

      const stopped = await prepare();
      assert.equal(stopped.code, LINK_REQUIRED, "a stale link never survives into preparation");
      const [choice] = (await choices()).choices;
      assert.equal(choice.reason, "Its connected session Library work in example/library was archived on 2026-10-28.");
      assert.deepEqual(choice.sessions.map(item => item.sessionId), ["second", "third", "fourth"]);
      assert.equal(created.length, 0, "an archived link creates nothing");

      assert.equal((await link("second")).ok, true);
      assert.equal(sessionConnectedSources(parent).length, 1, "the new link replaces the stale one");
      assert.equal((await prepare()).prepared[0].sessionId, "second");

      library.delete("second");
      assert.equal((await prepare()).code, LINK_REQUIRED);
      assert.equal((await choices()).choices[0].reason, "The connected session in example/library no longer exists.");
      assert.equal(created.length, 0);
    });
});

test("exactly one free session is linked by Prepare, which carries on and says which one", async () => {
  await withConnectedLibrary([librarySession("only", { sessionName: "Library work" }), librarySession("not-ready", { sourceReady: false })],
    async ({ choices, created, library, parent, prepare }) => {
      const prepared = await prepare();
      assert.equal(prepared.ok, true, JSON.stringify(prepared));
      assert.equal(prepared.prepared[0].sessionId, "only");
      assert.deepEqual(prepared.linked, [{ repository: "example/library", projectSlug: "library", sessionId: "only", sessionName: "Library work" }]);
      const [binding] = sessionConnectedSources(parent);
      assert.equal(binding.contribution.sessionId, "only");
      assert.deepEqual(JSON.parse(library.get("only").metadata.connected_contribution), binding.contribution);
      assert.deepEqual((await choices()).choices, []);
      assert.equal(created.length, 0, "linking the only free session creates nothing");

      const again = await prepare();
      assert.deepEqual(again.linked, [], "only the attempt that links reports it");
      assert.equal(sessionConnectedSources(parent)[0].contribution.id, binding.contribution.id);
    });
});

test("Retry after an archived link takes the only free session", async () => {
  await withConnectedLibrary([librarySession("first"), librarySession("second")], async ({ created, library, link, parent, prepare }) => {
    assert.equal((await link("first")).ok, true);
    const stale = sessionConnectedSources(parent)[0].contribution.id;
    library.get("first").status = "archived";

    const retried = await prepare();
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.prepared[0].sessionId, "second");
    assert.deepEqual(retried.linked.map(item => item.sessionId), ["second"]);
    const bindings = sessionConnectedSources(parent);
    assert.equal(bindings.length, 1, "the new link replaces the stale one");
    assert.notEqual(bindings[0].contribution.id, stale);
    assert.equal(created.length, 0);
  });
});

test("a session taken at the last moment falls back to the choice instead of failing", async () => {
  const taken = JSON.stringify({ schemaVersion: 1, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", repository: "example/library",
    integrationBranch: "main", baseCommit: BASE });
  await withConnectedLibrary([librarySession("only")], async world => {
    const { choices, library, parent, prepare } = world;
    world.beforeBind = () => { library.get("only").metadata.connected_contribution = taken; };
    const stopped = await prepare();
    assert.equal(stopped.code, LINK_REQUIRED);
    assert.deepEqual(stopped.linked, []);
    assert.deepEqual(sessionConnectedSources(parent), [], "the refused link leaves no reservation");
    assert.equal(library.get("only").metadata.connected_contribution, taken, "the winner keeps its link");
    assert.deepEqual((await choices()).choices[0].sessions, []);
  });
});

test("each connected project is settled on its own, and preparation carries on after the last one", async () => {
  await withConnectedLibrary([librarySession("only")], async ({ choices, link, parent, prepare }) => {
    const stopped = await prepare();
    assert.equal(stopped.code, LINK_REQUIRED);
    assert.equal(stopped.error, "other needs a connected session. Choose in the workspace preparation notice to continue.");
    assert.deepEqual(stopped.linked.map(item => item.sessionId), ["only"], "the stop still reports the automatic link");
    assert.deepEqual(stopped.prepared.map(item => item.sessionId), ["only"]);
    assert.deepEqual((await choices()).choices.map(item => item.name), ["other"]);

    assert.equal((await link("two", "example/other")).ok, true);
    const prepared = await prepare();
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.deepEqual(prepared.prepared.map(item => item.sessionId), ["only", "two"]);
    assert.equal(sessionConnectedSources(parent).length, 2);
  }, [librarySession("one"), librarySession("two")]);

  await withConnectedLibrary([librarySession("only")], async ({ parent, prepare }) => {
    const prepared = await prepare();
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.deepEqual(prepared.linked.map(item => item.sessionId).sort(), ["only", "single"]);
    assert.equal(sessionConnectedSources(parent).length, 2, "two links at once keep each other's binding");
  }, [librarySession("single")]);
});

test("no free session is said plainly, and nothing is created or reserved", async () => {
  await withConnectedLibrary([], async ({ choices, created, link, parent, prepare }) => {
    const stopped = await prepare();
    assert.equal(stopped.code, LINK_REQUIRED);
    assert.deepEqual(stopped.linked, []);
    assert.deepEqual((await choices()).choices[0].sessions, []);
    assert.equal((await link("invented")).code, NOT_FREE);
    assert.equal(parent.metadata.connected_sources, undefined);
    assert.equal(created.length, 0);
  });
});

test("the server decides again when a choice is saved", async () => {
  const taken = JSON.stringify({ schemaVersion: 1, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", repository: "example/library",
    integrationBranch: "main", baseCommit: BASE });
  await withConnectedLibrary([librarySession("wanted"), librarySession("other")], async world => {
    const { choices, library, link, parent, prepare } = world;
    assert.equal((await link("not-offered")).code, NOT_FREE, "only an offered session can be linked");

    world.beforeBind = () => { library.get("wanted").metadata.connected_contribution = taken; };
    assert.equal((await link("wanted")).code, NOT_FREE, "another contribution won the session while this one was choosing");
    assert.equal(library.get("wanted").metadata.connected_contribution, taken, "the winner keeps its link");
    assert.deepEqual(sessionConnectedSources(parent), [], "the refused link leaves no reservation");
    delete library.get("wanted").metadata.connected_contribution;

    world.beforeBind = () => { library.get("wanted").metadata.base_commit = "e".repeat(40); };
    assert.equal((await link("wanted")).code, NOT_FREE, "a session that moved is chosen again, on its new commit");
    assert.deepEqual(sessionConnectedSources(parent), []);
    assert.equal(library.get("wanted").metadata.connected_contribution, undefined);

    world.beforeBind = () => {};
    assert.equal((await link("wanted")).ok, true);
    assert.equal((await link("other")).code, "vibe64_connected_already_linked", "a healthy link is not changed from here");
    assert.deepEqual((await choices()).choices, []);
    assert.equal((await prepare()).prepared[0].sessionId, "wanted");
  });
});

test("a contribution session is offered only sessions that use nothing, so links can never wait in a cycle", async () => {
  const contribution = { schemaVersion: 1, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", repository: "example/other",
    integrationBranch: "main", baseCommit: BASE };
  const consumer = librarySession("consumer", { metadata: { connected_sources: JSON.stringify({ schemaVersion: 1,
    sources: [{ projectSlug: "other", contribution }] }) } });
  await withConnectedLibrary([consumer, librarySession("plain")], async ({ choices, link, parent, prepare }) => {
    const offered = async () => (await choices()).choices[0].sessions.map(item => item.sessionId);
    assert.deepEqual(await offered(), ["consumer", "plain"], "nothing links to an ordinary session, so it cannot close a cycle");
    assert.equal((await prepare()).code, LINK_REQUIRED);
    parent.metadata.connected_contribution = JSON.stringify({ ...contribution, id: "ffffffff-ffff-4fff-8fff-ffffffffffff" });
    assert.deepEqual(await offered(), ["plain"]);
    assert.equal((await link("consumer")).code, NOT_FREE);
    assert.deepEqual((await prepare()).linked.map(item => item.sessionId), ["plain"], "Prepare links from the list a person is offered");
  });
});

test("a link interrupted before its session took it asks again, and that session is still offered", async () => {
  await withConnectedLibrary([librarySession("wanted"), librarySession("zother")], async ({ choices, library, link, parent, prepare }) => {
    assert.equal((await link("wanted")).ok, true);
    delete library.get("wanted").metadata.connected_contribution;

    assert.equal((await prepare()).code, LINK_REQUIRED);
    const [choice] = (await choices()).choices;
    assert.equal(choice.reason, "The link to wanted in example/library was not finished.");
    assert.deepEqual(choice.sessions.map(item => item.sessionId), ["wanted", "zother"]);
    const before = sessionConnectedSources(parent)[0].contribution.id;
    assert.equal((await link("wanted")).ok, true);
    assert.notEqual(sessionConnectedSources(parent)[0].contribution.id, before);
    assert.equal((await prepare()).prepared[0].sessionId, "wanted");
  });
});

test("a confirmed replacement that was never created is finished from the choice, not by Prepare", async () => {
  await withConnectedLibrary([librarySession("original"), librarySession("free")], async world => {
    const { choices, created, link, parent, prepare, replace } = world;
    assert.equal((await link("original")).ok, true);
    const [binding] = sessionConnectedSources(parent);
    world.incomingReview = { repository: "example/library", targetBranch: "main", targetHead: "c".repeat(40),
      id: binding.contribution.id, activeHead: "", discardedHead: "b".repeat(40) };

    world.failNextCreate = true;
    assert.match((await replace(world.incomingReview)).error, /could not start/u);
    const reserved = sessionConnectedSources(parent)[0].contribution;
    assert.equal(reserved.replaces, binding.contribution.id);

    assert.equal((await prepare()).code, LINK_REQUIRED,
      "Prepare creates nothing for a confirmed replacement, and does not drop it for the only free session");
    assert.equal(created.length, 0);
    const [choice] = (await choices()).choices;
    assert.equal(choice.reason, "The replacement contribution for example/library was confirmed but not created.");
    assert.deepEqual(choice.replacementReview, world.incomingReview);
    assert.deepEqual(choice.sessions.map(item => item.sessionId), ["free"]);

    const finished = await replace(choice.replacementReview);
    assert.equal(finished.ok, true, JSON.stringify(finished));
    assert.equal(finished.sessionId, reserved.id);
    assert.equal(created.length, 1);
    assert.deepEqual((await choices()).choices, []);
  });
});
