import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext, createVibe64ActionPolicy } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { sessionConnectedSources, sessionRepositoryDestination } from "@local/vibe64-core/server/projectRepository";
import { ACTION_CHECK_SESSION_UPDATES, ACTION_RETRY_WORKSPACE_SETUP, createSessionActions } from "../../packages/vibe64-sessions/src/server/sessionActions.js";
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
    const world = { afterList: () => {}, aiRunning: false, created: [], library: new Map(sessions.map(session => [session.sessionId, session])),
      parent, beforeBind: () => {}, duringCheck: () => {}, failNextCreate: false, readSession: (runtime, id) => runtime.getSession(id),
      readWork: () => ({}), setupRunning: false, setupStarts: [] };
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
      getSessionWithoutSource(sessionId) { return world.readSession(this, sessionId); },
      async listSessionSummaries() {
        const listed = structuredClone([...sessionsByProject[projectSlug].values()].filter(session => session.status === "active"));
        await world.afterList();
        return listed;
      },
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
      async runProjectSourceExclusive(operation) { return operation(); },
      async developmentDatabasePolicy() { return { creation: { canCreate: true }, limits: {} }; }
    };
    const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: false }) });
    const service = createService({ project, initializeModelRouting: async () => ({ ok: true }),
      actions: Object.create(actions, { execute: { value(request) {
        if (world.loseBindResponse && request.actionId === "vibe64.sessions.connected.sessions.bind") throw new Error("The response was lost.");
        return actions.execute(request);
      } } }),
      setupRunner: { start: async (input) => { world.setupStarts.push(input); return { completion: null }; }, isRunning: () => world.setupRunning },
      terminals: {
        async inspectSessionWork(_id, { session, inspectContributionPublication }) {
          return { ok: true, unsaved: false, ahead: 0, baseCommit: BASE, sessionHead: session.metadata.base_commit,
            ...(inspectContributionPublication ? { publishedCommit: "" } : {}),
            destination: sessionRepositoryDestination(await project.readCurrentProject(), session),
            ...world.readWork(session) };
        },
        async agentSessionState() { return { turn: { active: false } }; },
        async sessionAiWorkRunning() { return world.aiRunning; },
        async checkSessionUpdates() {
          await world.duringCheck();
          return { ok: true, ahead: 0, behind: 0, canonicalCommit: world.mainCommit || BASE };
        },
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
    const action = (name, input = {}, channel = "api") => actions.execute({ actionId: `vibe64.sessions.connected.${name}`,
      input: { sessionId: "parent", ...input }, context: { ...context, channel } });
    actions.register({ contributorId: "connected-test", domain: "sessions", actions: [{
      ...createSessionActions({ sessions: service }).find(item => item.id === "vibe64.sessions.connected.choices"),
      channels: ["api", "internal"], id: "vibe64.sessions.connected.test.linkProblem", surfaces: ["app"],
      execute: (input, requestContext) => service.connectedLinkProblem(input.sessionId, input, requestContext)
    }] });
    const inLibrary = { ...context, requestMeta: { request: { headers: request.headers, params: { slug: "library" } } } };
    await run(Object.assign(world, {
      checkLibrary: sessionId => actions.execute({ actionId: ACTION_CHECK_SESSION_UPDATES, input: { sessionId, force: true }, context: inLibrary }),
      choices: () => action("choices"),
      linkProblem: () => action("test.linkProblem"),
      link: (connectedSessionId, repository = "example/library") => action("link", { repository, connectedSessionId }),
      prepare: channel => action("prepare", {}, channel),
      retry: channel => actions.execute({ actionId: ACTION_RETRY_WORKSPACE_SETUP, input: { sessionId: "parent" },
        context: { ...context, channel } }),
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
      assert.deepEqual(prepared.linked, [{ reason: "", repository: "example/library", projectSlug: "library", sessionId: "only",
        sessionName: "Library work" }]);
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

for (const [name, change, reason] of [
  ["commits of its own", world => { world.readWork = () => ({ sessionHead: "e".repeat(40), ahead: 1 }); }, "it has commits of its own."],
  ["unsaved changes", world => { world.readWork = () => ({ unsaved: true }); }, "it has unsaved changes."],
  ["AI work running", world => { world.aiRunning = true; }, "AI work is running in it."],
  ["a pin", world => { world.library.get("only").pinnedSessionId = "only"; }, "it is pinned."],
  ["a close under way", world => { world.library.get("only").metadata.session_closing_reason = "archiving"; }, "it is closing."],
  ["a work check that fails", world => { world.readWork = () => ({ ok: false, error: "fatal: not a git repository" }); },
    "its work could not be checked."],
  ["a work check that throws", world => { world.readWork = () => { throw new Error("fatal: bad object HEAD"); }; },
    "its work could not be checked."]
]) {
  test(`the only free session is left for a person with ${name}, who can still choose it knowingly`, async () => {
    await withConnectedLibrary([librarySession("only", { sessionName: "Library work" })], async world => {
      const { choices, created, library, link, parent, prepare } = world;
      change(world);
      const stopped = await prepare();
      assert.equal(stopped.code, LINK_REQUIRED, "preparation never links on anything but a clear answer");
      assert.equal(stopped.error, `library needs a connected session. Its only free session, Library work, was not linked by itself: ${reason} ` +
        "Choose in the workspace preparation notice to continue.");
      assert.deepEqual(stopped.linked, []);
      assert.deepEqual(sessionConnectedSources(parent), [], "the refused link leaves no reservation");
      assert.equal(library.get("only").metadata.connected_contribution, undefined);
      assert.deepEqual((await choices()).choices[0].sessions, [{ sessionId: "only", sessionName: "Library work" }]);

      assert.equal((await link("only")).ok, true, "the picker is unchanged: a person may take a session with work in it");
      assert.equal(sessionConnectedSources(parent)[0].contribution.sessionId, "only");
      assert.equal(created.length, 0);
    });
  });
}

test("Retry after an archived link takes the only free session and keeps the reason in its output", async () => {
  await withConnectedLibrary([librarySession("first", { sessionName: "Library work" }), librarySession("second")],
    async ({ created, library, link, parent, prepare }) => {
    assert.equal((await link("first")).ok, true);
    const stale = sessionConnectedSources(parent)[0].contribution.id;
    library.get("first").status = "archived";

    const retried = await prepare();
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.prepared[0].sessionId, "second");
    assert.deepEqual(retried.linked.map(item => item.sessionId), ["second"]);
    assert.equal(retried.linked[0].reason, "Its connected session Library work in example/library was archived.");
    const bindings = sessionConnectedSources(parent);
    assert.equal(bindings.length, 1, "the new link replaces the stale one");
    assert.notEqual(bindings[0].contribution.id, stale);
    assert.equal(created.length, 0);
  });
});

test("work already submitted to a project keeps its next session a person's choice, and its gate stays", async () => {
  await withConnectedLibrary([librarySession("first"), librarySession("second")], async ({ library, link, parent, prepare }) => {
    assert.equal((await link("first")).ok, true);
    const [{ contribution }] = sessionConnectedSources(parent);
    const gates = JSON.stringify({ schemaVersion: 1, submissions: [{ contribution, submittedCommit: "d".repeat(40) }] });
    parent.metadata.connected_submissions = gates;
    library.get("first").status = "archived";

    const stopped = await prepare();
    assert.equal(stopped.code, LINK_REQUIRED, "the new session decides whether the submitted work is in the Preview");
    assert.match(stopped.error, /Its connected session first in example\/library was archived\. Its only free session, second, was not linked/u);
    assert.match(stopped.error, /work this session already submitted there has to stay in view/u);

    assert.equal((await link("second")).ok, true);
    assert.equal(parent.metadata.connected_submissions, gates, "a new link does not lift what the old revision still requires");
  });
});

test("only a person's own request lets preparation link by itself", async () => {
  await withConnectedLibrary([librarySession("only")], async ({ library, parent, prepare, retry, setupStarts }) => {
    parent.workspaceSetup = { status: "ambiguous", connectedChoiceRequired: true };
    await retry("automation");
    await retry("internal");
    await retry("api");
    assert.deepEqual(setupStarts.map(item => item.agentRequested), [true, true, false]);

    assert.equal((await prepare("internal")).code, LINK_REQUIRED, "without a person the choice stays open");
    assert.equal(library.get("only").metadata.connected_contribution, undefined);
    assert.equal((await prepare("api")).ok, true);
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

test("an update check in flight during a link leaves the linked session on its contribution", async () => {
  await withConnectedLibrary([librarySession("wanted"), librarySession("sibling")], async world => {
    const { checkLibrary, library, link, parent } = world;
    world.mainCommit = "c".repeat(40);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    world.duringCheck = async () => { entered.resolve(); await release.promise; };

    const check = checkLibrary("wanted");
    await entered.promise;
    assert.equal((await link("wanted")).ok, true);
    release.resolve();
    assert.equal((await check).ok, true);

    const session = library.get("wanted");
    assert.equal(session.metadata.canonical_commit, BASE, "the late check does not write main's commit over the contribution's base");
    assert.equal(session.metadata.repository_update_check, undefined, "its answer about the old branch is not kept");
    assert.equal(sessionConnectedSources(parent)[0].contribution.sessionId, "wanted");
  });
});

test("a canonical commit spread to the project's sessions skips one linked since the list was read", async () => {
  await withConnectedLibrary([librarySession("checked"), librarySession("linked-late"), librarySession("plain")], async world => {
    const { checkLibrary, library } = world;
    const contribution = JSON.stringify({ schemaVersion: 1, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", sessionId: "linked-late",
      repository: "example/library", integrationBranch: "main", baseCommit: BASE });
    world.mainCommit = "c".repeat(40);
    world.afterList = () => {
      world.afterList = () => {};
      Object.assign(library.get("linked-late").metadata, { canonical_commit: BASE, connected_contribution: contribution });
    };

    assert.equal((await checkLibrary("checked")).ok, true);
    assert.equal(library.get("linked-late").metadata.canonical_commit, BASE);
    assert.equal(library.get("plain").metadata.canonical_commit, "c".repeat(40), "an unlinked session still follows main");
  });
});

test("the last link carries preparation on from the server, with no browser left to ask", async () => {
  await withConnectedLibrary([librarySession("first"), librarySession("first-b")], async ({ link, parent, setupStarts }) => {
    parent.workspaceSetup = { connectedChoiceRequired: true, status: "ambiguous" };
    assert.equal((await link("first")).ok, true);
    assert.equal(setupStarts.length, 0, "the other project still needs its choice");
    assert.equal((await link("two", "example/other")).ok, true);
    assert.equal(setupStarts.length, 1);
    assert.equal(setupStarts[0].retry, true);
    assert.equal(setupStarts[0].agentRequested, false);
  }, [librarySession("two"), librarySession("three")]);
});

test("a link saved just before a restart carries on at the next look, and an ordinary session is left alone", async () => {
  await withConnectedLibrary([librarySession("wanted"), librarySession("zother")], async world => {
    const { choices, link, parent, setupStarts } = world;
    assert.equal((await link("wanted")).ok, true);
    assert.deepEqual((await choices()).choices, []);
    assert.equal(setupStarts.length, 0, "nothing was waiting, so nothing starts");

    parent.workspaceSetup = { connectedChoiceRequired: true, status: "ambiguous" };
    assert.deepEqual((await choices()).choices, []);
    assert.equal(setupStarts.length, 1, "the wait outlived the link, and the server ends it");

    world.setupRunning = true;
    assert.deepEqual((await choices()).choices, []);
    assert.equal(setupStarts.length, 1, "a running preparation is not started twice");
  });
});

test("a person's link waits for a running preparation, which may be linking too", async () => {
  await withConnectedLibrary([librarySession("wanted"), librarySession("zother")], async world => {
    world.setupRunning = true;
    assert.equal((await world.link("wanted")).code, "vibe64_workspace_setup_running");
    assert.deepEqual(sessionConnectedSources(world.parent), []);
  });
});

test("a reservation that crashed before its session was taken by someone else asks again, naming the project", async () => {
  const taken = { schemaVersion: 1, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", repository: "example/library",
    integrationBranch: "main", baseCommit: BASE };
  await withConnectedLibrary([librarySession("wanted", { sessionName: "Library work" }), librarySession("spare"), librarySession("spare-2")],
    async ({ choices, library, link, parent, prepare }) => {
      assert.equal((await link("wanted")).ok, true);
      library.get("wanted").metadata.connected_contribution = JSON.stringify(taken);

      const stopped = await prepare();
      assert.equal(stopped.code, LINK_REQUIRED, "Prepare is not stuck on a refusal with no way out");
      assert.match(stopped.error, /Library work in example\/library went to another contribution before this link was finished\./u);
      const [choice] = (await choices()).choices;
      assert.deepEqual(choice.sessions.map(item => item.sessionId), ["spare", "spare-2"]);
      assert.equal((await link("spare")).ok, true);
      assert.equal(sessionConnectedSources(parent)[0].contribution.sessionId, "spare");
    });
});

test("a link that was made stays made when announcing it fails", async () => {
  await withConnectedLibrary([librarySession("wanted"), librarySession("zother")], async world => {
    const { library, link, parent, prepare } = world;
    world.readSession = (runtime, id) => {
      if (id === "wanted" && library.get("wanted").metadata.connected_contribution) throw new Error("The session could not be read.");
      return runtime.getSession(id);
    };
    assert.equal((await link("wanted")).ok, true);
    world.readSession = (runtime, id) => runtime.getSession(id);

    const [binding] = sessionConnectedSources(parent);
    assert.deepEqual(JSON.parse(library.get("wanted").metadata.connected_contribution), binding.contribution,
      "the origin keeps the link its session took, so neither side is left bound to nothing");
    assert.equal((await prepare()).prepared[0].sessionId, "wanted");
  });
});

test("a link the receiving project may have taken keeps its reservation, for Prepare to settle", async () => {
  await withConnectedLibrary([librarySession("wanted"), librarySession("zother")], async world => {
    const { link, parent, prepare } = world;
    world.loseBindResponse = true;
    assert.match((await link("wanted")).error, /response was lost/u);
    world.loseBindResponse = false;

    assert.equal(sessionConnectedSources(parent)[0].contribution.sessionId, "wanted", "an unknown outcome is not a refusal");
    assert.equal((await prepare()).code, LINK_REQUIRED, "it never bound, so Prepare asks again");
  });
});

test("a connected link that no longer holds stops a renewal before anything is frozen, naming the project and reason", async () => {
  await withConnectedLibrary([librarySession("first", { sessionName: "Library work" }), librarySession("second")], async world => {
    const { library, link, linkProblem, parent } = world;
    assert.equal(await linkProblem(), "", "a session using nothing has nothing to carry over");
    assert.equal((await link("first")).ok, true);
    assert.equal(await linkProblem(), "");
    library.get("first").status = "archived";
    assert.equal(await linkProblem(), "library needs a connected session. Its connected session Library work in example/library was archived. " +
      "Use Prepare workspace here, choose in its notice, then confirm this renewal again.");
    assert.equal(sessionConnectedSources(parent).length, 1);
  });
});
