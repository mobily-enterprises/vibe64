import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fsPromises, { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createService
} from "../../packages/vibe64-project/src/server/service.js";
import {
  createService as createCurrentAppService
} from "../../packages/current-app/src/server/service.js";
import {
  createService as createSessionsService
} from "../../packages/vibe64-sessions/src/server/service.js";
import {
  createStudioProjectContext
} from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import {
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  addGenesisStack,
  initializeGenesisProject
} from "../../packages/vibe64-genesis/src/server/index.js";
import {
  runVibe64RenewalAgentWriteExclusive
} from "../../packages/vibe64-runtime/src/server/agentWriteLock.js";
import {
  sourceMetadata,
  sourcePath,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

function projectService(targetRoot, options = {}) {
  return createService({
    env: {},
    projectContext: createStudioProjectContext({
      explicitManagedSourceRoot: path.join(path.dirname(targetRoot), "managed-source"),
      explicitSystemRoot: path.join(path.dirname(targetRoot), "system"),
      explicitTargetRoot: targetRoot,
      home: path.dirname(targetRoot)
    }),
    ...options
  });
}

function collaborationHarness() {
  const states = new Map();
  const defaults = Object.freeze({
    experience: "comfortable",
    explanationStyle: "concise",
    requirements: "",
    responseLength: "concise",
    tone: "encouraging"
  });
  return {
    async inspectCollaboration({ projectRoot }) {
      return {
        ...(states.get(projectRoot) || defaults),
        choices: {},
        status: states.has(projectRoot) ? "configured" : "defaulted"
      };
    },
    state(projectRoot) {
      return states.get(projectRoot) || null;
    },
    async setCollaboration(input) {
      if (/^#{1,6}(?:\s|$)/mu.test(input.requirements || "")) {
        const error = new Error("Project collaboration requirements cannot contain Markdown headings.");
        error.code = "COLLABORATION_REQUIREMENTS_INVALID";
        throw error;
      }
      states.set(input.projectRoot, {
        experience: input.experience,
        explanationStyle: input.explanationStyle,
        requirements: input.requirements,
        responseLength: input.responseLength,
        tone: input.tone
      });
      return { status: "updated" };
    }
  };
}

test("prepared execution reuses confirmed resources without source admission and keeps cold resources locked", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "prepared-environment";
    const sourceRoot = sourcePath(targetRoot, sessionId);
    await mkdir(path.join(sourceRoot, ".git", "info"), { recursive: true });
    const resource = {
      component: "example", resource: {
        id: "service", kind: "example", environmentAlternatives: [{
          preferred: true, bindings: { endpoint: "SERVICE_ENDPOINT" }
        }]
      }
    };
    let prepared = false;
    let provisions = 0;
    const service = projectService(targetRoot, {
      inspectEnvironment: () => ({
        components: [], environmentDefaults: [], files: [{ format: "dotenv", path: ".env" }],
        resources: [resource], status: "ready"
      })
    });
    const provided = () => ({
      contract: "vibe64.resource-environment.v2", ok: true, prepared,
      resourceValues: [{
        declaration: { component: "example", id: "service", kind: "example" },
        values: { endpoint: "https://service.example.test" }
      }]
    });
    service.setResourceEnvironmentProvider({
      managedDevelopmentDatabase: true,
      environmentForProvisionedResources: provided,
      async environmentForResources() { provisions += 1; prepared = true; return provided(); }
    });
    const runtime = await service.createRuntime({ inspectSource: false });
    await runtime.store.createSession({ metadata: sourceMetadata(targetRoot, sessionId), runtimeKind: "genesis", sessionId });
    const input = { sessionId, reusePrepared: true };
    await service.projectExecutionEnvironment(input);
    assert.equal(provisions, 1);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const holding = runtime.store.runSessionExclusive(sessionId, "agent-write-mode", async () => {
      entered.resolve(); await release.promise;
    });
    await entered.promise;
    try {
      assert.deepEqual(await service.projectExecutionEnvironment(input), { SERVICE_ENDPOINT: "https://service.example.test" });
      prepared = false;
      await assert.rejects(() => service.projectExecutionEnvironment(input), { code: "vibe64_agent_write_mode_busy" });
      assert.equal(provisions, 1);
    } finally { release.resolve(); await holding; }
    await service.projectExecutionEnvironment(input);
    assert.equal(provisions, 2);
  });
});

test("execution preparation rechecks current declarations after acquiring source admission", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "environment-recheck";
    const sourceRoot = sourcePath(targetRoot, sessionId);
    await mkdir(path.join(sourceRoot, ".git", "info"), { recursive: true });
    let inspections = 0;
    const service = projectService(targetRoot, {
      inspectEnvironment: () => ({
        components: [], environmentDefaults: [{ name: "SETTING", value: ++inspections === 1 ? "stale" : "current" }],
        files: [{ format: "dotenv", path: ".env" }], resources: [], status: "ready"
      })
    });
    const store = await service.createSessionStore();
    await store.createSession({ metadata: sourceMetadata(targetRoot, sessionId), runtimeKind: "genesis", sessionId });
    assert.deepEqual(await service.projectExecutionEnvironment({ sessionId, reusePrepared: true }), { SETTING: "current" });
    assert.equal(inspections, 2);
    assert.match(await readFile(path.join(sourceRoot, ".env"), "utf8"), /SETTING=current/u);
  });
});

test("an explicit project exposes one plain Genesis project", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot);
    const response = await service.listProjects();

    assert.equal(response.ok, true);
    assert.equal(response.hasSelection, true);
    assert.equal(response.projects.length, 1);
    assert.equal(response.currentProject.path, targetRoot);
    assert.equal(response.currentProject.selected, true);
    assert.equal("workflowRepositoryProfile" in response.currentProject, false);
    assert.equal("adapter" in response.currentProject, false);
  });
});

test("a catalog project can be created and selected without project-type setup", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectsRoot = path.join(temporaryRoot, "projects");
    const projectContext = createStudioProjectContext({
      explicitManagedSourceRoot: path.join(temporaryRoot, "managed-source"),
      explicitProjectsRoot: projectsRoot,
      explicitSystemRoot: path.join(temporaryRoot, "system"),
      home: temporaryRoot
    });
    const service = createService({
      env: {},
      projectContext
    });

    const created = await service.createProject({
      name: "Book catalogue"
    });

    assert.equal(created.ok, true);
    assert.equal(created.currentProject.slug, "book-catalogue");
    assert.equal((await service.listProjects()).projects.length, 1);
    assert.equal(service.currentTargetRoot(), path.join(projectsRoot, "book-catalogue"));
  });
});

test("a catalog project without a baseline checkout does not inspect its metadata directory", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectsRoot = path.join(temporaryRoot, "projects");
    const projectContext = createStudioProjectContext({
      explicitManagedSourceRoot: path.join(temporaryRoot, "managed-source"),
      explicitProjectsRoot: projectsRoot,
      explicitSystemRoot: path.join(temporaryRoot, "system"),
      home: temporaryRoot
    });
    let inspections = 0;
    const service = createService({
      env: {},
      inspectEnvironment() {
        inspections += 1;
        throw new Error("the project metadata directory is not source");
      },
      projectContext
    });
    await service.createProject({ name: "Remote catalogue" });
    const hostedNamespace = path.join(projectsRoot, "remote-catalogue");
    await mkdir(path.join(hostedNamespace, ".git"), {
      recursive: true
    });
    await writeFile(path.join(hostedNamespace, ".git", "config"), "must-not-be-inspected\n", "utf8");

    const response = await service.readEnv();

    assert.equal(response.ok, true);
    assert.equal(response.env.configSource.sourceRoot, "");
    assert.equal(response.env.stackWarning, undefined);
    assert.equal(inspections, 0);
  });
});

test("repository identities require a real project source", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectContext = createStudioProjectContext({
      explicitManagedSourceRoot: path.join(temporaryRoot, "managed-source"),
      explicitProjectsRoot: path.join(temporaryRoot, "projects"),
      explicitSystemRoot: path.join(temporaryRoot, "system"),
      home: temporaryRoot
    });
    const service = createService({
      env: {},
      projectContext
    });
    await service.createProject({ name: "Remote catalogue" });

    const response = await service.readPreviewApplicationIdentities();

    assert.equal(response.ok, false);
    assert.equal(
      response.errors[0].code,
      "vibe64_preview_application_identities_source_required"
    );
  });
});

test("hosted engineering settings follow the selected session source and save through Genesis", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectContext = createStudioProjectContext({
      explicitManagedSourceRoot: path.join(temporaryRoot, "managed-source"),
      explicitProjectsRoot: path.join(temporaryRoot, "projects"),
      explicitSystemRoot: path.join(temporaryRoot, "system"),
      home: temporaryRoot
    });
    const inspections = [];
    const selections = [];
    let selectedProfile = "focused.v1";
    const profiles = [
      {
        description: "Small, direct changes for ordinary product work.",
        id: "focused.v1",
        name: "Focused"
      },
      {
        description: "Long-lived product work with explicit compatibility and operational care.",
        id: "durable.v1",
        name: "Durable product"
      }
    ];
    const service = createService({
      env: {},
      async inspectEngineering({ projectRoot }) {
        inspections.push(projectRoot);
        return {
          profile: profiles.find((profile) => profile.id === selectedProfile),
          profiles,
          status: "configured"
        };
      },
      projectContext,
      async setEngineeringProfile(input) {
        selections.push(input);
        selectedProfile = input.profile;
        return { status: "updated" };
      }
    });
    await service.createProject({ name: "Engineering catalogue" });

    const unavailable = await service.readEngineeringSettings();
    assert.equal(unavailable.ok, true);
    assert.equal(unavailable.engineering.available, false);
    assert.match(unavailable.engineering.unavailableReason, /Create or select an AI session/u);
    assert.deepEqual(inspections, []);

    const sessionId = "engineering-session";
    const sessionSource = path.join(
      temporaryRoot,
      "managed-source",
      "sessions",
      "active",
      sessionId,
      "source"
    );
    await mkdir(sessionSource, { recursive: true });
    const store = await service.createSessionStore();
    await store.createSession({
      metadata: {
        source_kind: "session_clone",
        source_path: sessionSource,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      runtimeKind: "genesis",
      sessionId
    });
    await store.updateCurrentSession(sessionId);

    const initial = await service.readEngineeringSettings();
    assert.equal(initial.engineering.available, true);
    assert.equal(initial.engineering.profile.id, "focused.v1");
    assert.equal(initial.engineering.source.sessionId, sessionId);
    assert.deepEqual(inspections, [sessionSource]);

    const saved = await service.saveEngineeringProfile({
      profile: "durable.v1",
      sessionId
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.engineering.profile.id, "durable.v1");
    assert.deepEqual(selections, [{
      profile: "durable.v1",
      projectRoot: sessionSource
    }]);
    assert.equal(saved.projectSlug, "engineering-catalogue");
  });
});

test("managed database defaults persist an explicit shared scope and provider-owned name", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectsRoot = path.join(temporaryRoot, "projects");
    const projectContext = createStudioProjectContext({
      explicitManagedSourceRoot: path.join(temporaryRoot, "managed-source"),
      explicitProjectsRoot: projectsRoot,
      explicitSystemRoot: path.join(temporaryRoot, "system"),
      home: temporaryRoot
    });
    const service = createService({
      env: {},
      projectContext
    });
    const projectContextRoot = path.join(projectsRoot, "shared-default");
    const providerCalls = [];

    assert.deepEqual(await service.managedDevelopmentDatabaseDefaults({
      projectContextRoot,
      slug: "shared-default"
    }), {});

    service.setResourceEnvironmentProvider({
      developmentDatabaseNameForProject(input) {
        providerCalls.push(input);
        return "unit_shared_default";
      },
      async environmentForResources() {
        return { environment: {} };
      },
      managedDevelopmentDatabase: true
    });
    await assert.rejects(
      () => service.managedDevelopmentDatabaseDefaults({
        projectContextRoot: "relative-project",
        slug: "shared-default"
      }),
      {
        code: "vibe64_managed_development_database_project_root_invalid"
      }
    );
    assert.deepEqual(providerCalls, []);
    const defaults = await service.managedDevelopmentDatabaseDefaults({
      projectContextRoot,
      slug: "shared-default"
    });
    assert.deepEqual(defaults, {
      developmentDatabaseName: "unit_shared_default",
      developmentDatabaseScope: "project"
    });
    assert.deepEqual(providerCalls, [{
      projectContextRoot,
      serviceDataRoot: projectContext.serviceDataRoot,
      slug: "shared-default"
    }]);

    const created = await service.createProject({
      ...defaults,
      name: "Shared default"
    });
    assert.equal(created.ok, true);
    assert.equal(created.currentProject.developmentDatabaseName, "unit_shared_default");
    assert.equal(created.currentProject.developmentDatabaseScope, "project");

    const persisted = await projectContext.readWorkspaceProject({
      slug: "shared-default"
    });
    assert.equal(persisted.project.developmentDatabaseName, "unit_shared_default");
    assert.equal(persisted.project.developmentDatabaseScope, "project");
  });
});

test("managed development database scope is project state and changes only without open sessions", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectsRoot = path.join(temporaryRoot, "projects");
    const projectContext = createStudioProjectContext({
      explicitManagedSourceRoot: path.join(temporaryRoot, "managed-source"),
      explicitProjectsRoot: projectsRoot,
      explicitSystemRoot: path.join(temporaryRoot, "system"),
      home: temporaryRoot
    });
    const service = createService({
      env: {},
      projectContext
    });
    await service.createProject({ name: "Shared catalogue" });
    let nameRequests = 0;
    const nameRequestInputs = [];
    service.setResourceEnvironmentProvider({
      developmentDatabaseNameForProject(input) {
        nameRequests += 1;
        nameRequestInputs.push(input);
        return "merc_shared_catalogue";
      },
      async environmentForResources() {
        return { environment: {} };
      },
      managedDevelopmentDatabase: true
    });

    const initial = await service.readSettings();
    assert.deepEqual(initial.developmentDatabase, {
      canChange: true,
      managed: true,
      openSessionCount: 0,
      options: {
        project: { available: true },
        session: { available: true }
      },
      scope: "session"
    });
    const saved = await service.saveDevelopmentDatabaseScope({
      scope: "project"
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.scope, "project");
    assert.equal(nameRequests, 1);
    assert.deepEqual(nameRequestInputs, [{
      projectContextRoot: path.join(projectsRoot, "shared-catalogue"),
      serviceDataRoot: projectContext.serviceDataRoot,
      slug: "shared-catalogue"
    }]);
    assert.equal(
      (await service.listProjects()).currentProject.developmentDatabaseName,
      "merc_shared_catalogue"
    );

    const store = await service.createSessionStore();
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "ghost-session"
    });
    assert.deepEqual((await service.readSettings()).developmentDatabase, {
      canChange: true,
      managed: true,
      openSessionCount: 0,
      options: {
        project: { available: true },
        session: { available: true }
      },
      scope: "project"
    });

    const sessionSource = path.join(temporaryRoot, "managed-source", "sessions", "active", "open-session", "source");
    await mkdir(sessionSource, { recursive: true });
    await store.createSession({
      metadata: {
        source_kind: "session_clone",
        source_path: sessionSource,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      runtimeKind: "genesis",
      sessionId: "open-session"
    });
    const oneOpen = (await service.readSettings()).developmentDatabase;
    assert.equal(oneOpen.canChange, false);
    assert.equal(oneOpen.openSessionCount, 1);
    assert.equal(oneOpen.options.project.available, true);
    assert.equal(oneOpen.options.session.available, true);
    assert.match(oneOpen.disabledReason, /open-session/u);

    const secondSessionSource = path.join(
      temporaryRoot,
      "managed-source",
      "sessions",
      "active",
      "second-open-session",
      "source"
    );
    await mkdir(secondSessionSource, { recursive: true });
    await store.createSession({
      metadata: {
        label: "Second task",
        source_kind: "session_clone",
        source_path: secondSessionSource,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      runtimeKind: "genesis",
      sessionId: "second-open-session"
    });
    const twoOpen = (await service.readSettings()).developmentDatabase;
    assert.equal(twoOpen.canChange, false);
    assert.equal(twoOpen.openSessionCount, 2);
    assert.equal(twoOpen.options.project.available, false);
    assert.equal(twoOpen.options.session.available, true);
    assert.match(twoOpen.options.project.disabledReason, /open-session, Second task/u);

    const blocked = await service.saveDevelopmentDatabaseScope({
      scope: "session"
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errors[0].code, "vibe64_development_database_scope_busy");

    await store.writeStatus("open-session", "archived");
    await store.publishSessionArchive("open-session");
    await store.writeStatus("second-open-session", "archived");
    await store.publishSessionArchive("second-open-session");
    assert.deepEqual((await service.readSettings()).developmentDatabase, {
      canChange: true,
      managed: true,
      openSessionCount: 0,
      options: {
        project: { available: true },
        session: { available: true }
      },
      scope: "project"
    });
    const savedAgain = await service.saveDevelopmentDatabaseScope({
      scope: "project"
    });
    assert.equal(savedAgain.ok, true);
    assert.equal(nameRequests, 1);
  });
});

test("scope saving and session creation share one project policy boundary", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectContext = createStudioProjectContext({
      explicitManagedSourceRoot: path.join(temporaryRoot, "managed-source"),
      explicitProjectsRoot: path.join(temporaryRoot, "projects"),
      explicitSystemRoot: path.join(temporaryRoot, "system"),
      home: temporaryRoot
    });
    const projectService = createService({
      env: {},
      projectContext
    });
    await projectService.createProject({ name: "Serialized database" });

    let reportNamingStarted;
    let releaseNaming;
    const namingStarted = new Promise((resolve) => {
      reportNamingStarted = resolve;
    });
    const namingCanFinish = new Promise((resolve) => {
      releaseNaming = resolve;
    });
    projectService.setResourceEnvironmentProvider({
      async developmentDatabaseNameForProject() {
        reportNamingStarted();
        await namingCanFinish;
        return "unit_serialized_database";
      },
      async environmentForResources() {
        return { environment: {} };
      },
      managedDevelopmentDatabase: true
    });

    const openSessions = [];
    let createCalls = 0;
    const runtime = {
      async createSession() {
        createCalls += 1;
        const session = {
          sessionId: "serialized-session",
          status: "active",
          workspaceSetup: { status: "unconfigured" }
        };
        openSessions.push(session);
        return session;
      },
      async getSession() {
        return { ...openSessions[0] };
      },
      async listSessionSummaries() {
        return openSessions.map((session) => ({ ...session }));
      }
    };
    const sessionsService = createSessionsService({
      initializeModelRouting: async () => ({ ok: true }),
      project: {
        async createRuntime() {
          return runtime;
        },
        developmentDatabasePolicy(input) {
          return projectService.developmentDatabasePolicy(input);
        },
        runProjectSessionPolicyExclusive(operation, options) {
          return projectService.runProjectSessionPolicyExclusive(operation, options);
        }
      },
      terminals: {
        async resolveAssistantPurpose() {
          return { available: true, connectionIdentity: "workspace-ai", effectiveSelection: {
            engineId: "opencode", agentId: "build", modelProviderId: "opencode", modelId: "big-pickle",
            variantId: "", catalogRevision: `sha256:${"a".repeat(64)}`
          } };
        },
        async requireAssistantSelectionAccess() {
          return { ok: true };
        }
      },
      workspaceSetupRunner: {
        isRunning: () => false,
        start: () => ({ completion: null }),
        wait: () => null
      }
    });

    const saving = projectService.saveDevelopmentDatabaseScope({
      scope: "project"
    });
    await namingStarted;
    const creating = sessionsService.createSession();
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(createCalls, 0);

    releaseNaming();
    const [saved, created] = await Promise.all([saving, creating]);
    assert.equal(saved.ok, true);
    assert.equal(saved.scope, "project");
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.sessionId, "serialized-session");
    assert.equal(created.creation.canCreate, false);
    assert.deepEqual(created.limits, {
      maxOpenSessions: 1,
      openSessionCount: 1
    });
    assert.equal(createCalls, 1);
    assert.equal(
      (await projectService.listProjects()).currentProject.developmentDatabaseScope,
      "project"
    );
  });
});

test("project settings keep Genesis collaboration and Vibe64 prompt hints separate", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const collaboration = collaborationHarness();
    const service = projectService(targetRoot, collaboration);
    const initial = await service.readSettings({
      vibe64User: { role: "member" }
    });
    assert.equal(initial.ok, true);
    assert.equal(initial.collaboration.canEdit, false);
    assert.equal(initial.collaboration.available, true);
    assert.deepEqual(initial.collaboration, {
      available: true,
      canEdit: false,
      choices: {},
      experience: "comfortable",
      explanationStyle: "concise",
      requirements: "",
      responseLength: "concise",
      source: {
        rootKind: "standalone-source",
        sessionId: ""
      },
      status: "defaulted",
      tone: "encouraging",
      unavailableReason: ""
    });
    assert.deepEqual(initial.promptHints, { canEdit: false, enabled: true });

    const denied = await service.saveCollaborationSettings({
      experience: "expert",
      explanationStyle: "conclusions",
      requirements: "Keep it practical.",
      responseLength: "very_short",
      tone: "direct",
      vibe64User: { role: "member" }
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "vibe64_owner_required");
    assert.equal(collaboration.state(targetRoot), null);

    const saved = await service.saveCollaborationSettings({
      experience: "expert",
      explanationStyle: "conclusions",
      requirements: "Keep it practical.",
      responseLength: "very_short",
      tone: "direct",
      vibe64User: { role: "owner" }
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.collaboration.canEdit, true);
    assert.equal(saved.collaboration.requirements, "Keep it practical.");
    assert.deepEqual(collaboration.state(targetRoot), {
      experience: "expert",
      explanationStyle: "conclusions",
      requirements: "Keep it practical.",
      responseLength: "very_short",
      tone: "direct"
    });
    const promptHints = await service.savePromptHints({
      promptHints: false,
      vibe64User: { role: "owner" }
    });
    assert.deepEqual(promptHints.promptHints, { canEdit: true, enabled: false });

    const memberRead = await service.readSettings({
      vibe64User: { role: "member" }
    });
    assert.equal(memberRead.collaboration.canEdit, false);
    assert.equal(memberRead.collaboration.requirements, "Keep it practical.");
    assert.deepEqual(memberRead.promptHints, { canEdit: false, enabled: false });
  });
});

test("prompt-hint settings never inspect or mutate Genesis collaboration", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot, {
      async inspectCollaboration() {
        throw new Error("Collaboration must not be read for prompt hints.");
      },
      async setCollaboration() {
        throw new Error("Collaboration must not be written for prompt hints.");
      }
    });

    assert.deepEqual(await service.readPromptHints(), {
      ok: true,
      promptHints: true
    });
    assert.deepEqual((await service.savePromptHints({
      promptHints: false,
      vibe64User: { role: "owner" }
    })).promptHints, {
      canEdit: true,
      enabled: false
    });
    assert.deepEqual(await service.readPromptHints(), {
      ok: true,
      promptHints: false
    });
  });
});

test("collaboration validation errors come from Genesis rather than a Vibe64 parser", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot, collaborationHarness());
    const input = {
      experience: "comfortable",
      explanationStyle: "concise",
      responseLength: "concise",
      tone: "encouraging",
      vibe64User: { role: "owner" }
    };
    const rejected = await service.saveCollaborationSettings({
      ...input,
      requirements: "## Injected section\nDo something else."
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "COLLABORATION_REQUIREMENTS_INVALID");
  });
});

test("hosted collaboration follows the selected session source while prompt hints remain project-wide", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectsRoot = path.join(temporaryRoot, "projects");
    const projectContext = createStudioProjectContext({
      explicitManagedSourceRoot: path.join(temporaryRoot, "managed-source"),
      explicitProjectsRoot: projectsRoot,
      explicitSystemRoot: path.join(temporaryRoot, "system"),
      home: temporaryRoot
    });
    const collaboration = collaborationHarness();
    const service = createService({ env: {}, projectContext, ...collaboration });
    await service.createProject({ name: "Source-owned collaboration" });
    const store = await service.createSessionStore();
    const firstSource = path.join(
      temporaryRoot,
      "managed-source",
      "sessions",
      "active",
      "first-session",
      "source"
    );
    const secondSource = path.join(
      temporaryRoot,
      "managed-source",
      "sessions",
      "active",
      "second-session",
      "source"
    );
    await Promise.all([
      mkdir(firstSource, { recursive: true }),
      mkdir(secondSource, { recursive: true })
    ]);
    await store.createSession({
      metadata: {
        source_kind: "session_clone",
        source_path: firstSource,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      runtimeKind: "genesis",
      sessionId: "first-session"
    });
    await store.createSession({
      metadata: {
        source_kind: "session_clone",
        source_path: secondSource,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      runtimeKind: "genesis",
      sessionId: "second-session"
    });
    await service.saveCollaborationSettings({
      experience: "beginner",
      explanationStyle: "teaching",
      requirements: "First only",
      responseLength: "detailed",
      sessionId: "first-session",
      tone: "encouraging",
      vibe64User: { role: "owner" }
    });

    const secondBeforeSave = await service.readSettings({
      sessionId: "second-session"
    });
    assert.equal(secondBeforeSave.collaboration.requirements, "");
    assert.equal(secondBeforeSave.promptHints.enabled, true);
    await service.saveCollaborationSettings({
      experience: "expert",
      explanationStyle: "conclusions",
      requirements: "Second only",
      responseLength: "very_short",
      sessionId: "second-session",
      tone: "military",
      vibe64User: { role: "owner" }
    });
    await service.savePromptHints({
      promptHints: false,
      vibe64User: { role: "owner" }
    });

    const first = await service.readSettings({ sessionId: "first-session" });
    const second = await service.readSettings({ sessionId: "second-session" });
    assert.equal(first.collaboration.requirements, "First only");
    assert.equal(second.collaboration.requirements, "Second only");
    assert.equal(first.promptHints.enabled, false);
    assert.equal(second.promptHints.enabled, false);
  });
});

for (const setting of ["collaboration", "engineering"]) {
  test(`real Genesis ${setting} settings preserve source identity, validation, and renewal exclusion`, async (t) => {
    await withTemporaryRoot(async (targetRoot) => {
      const service = projectService(targetRoot);
      const store = await service.createSessionStore();
      const sessionId = `${setting}-selected`;
      const siblingSessionId = `${setting}-sibling`;
      const sessionSource = sourcePath(targetRoot, sessionId);
      const siblingSource = sourcePath(targetRoot, siblingSessionId);
      for (const projectRoot of [targetRoot, sessionSource, siblingSource]) {
        await mkdir(projectRoot, { recursive: true });
        await execFileAsync("git", ["init"], { cwd: projectRoot });
        await initializeGenesisProject({ projectRoot });
      }
      for (const id of [sessionId, siblingSessionId]) {
        await store.createSession({
          metadata: sourceMetadata(targetRoot, id),
          runtimeKind: "genesis",
          sessionId: id
        });
      }
      await store.updateCurrentSession(siblingSessionId);
      const fileName = `${setting}.md`;
      const selectedFile = path.join(sessionSource, "genesis", fileName);
      const siblingFile = path.join(siblingSource, "genesis", fileName);
      const standaloneFile = path.join(targetRoot, "genesis", fileName);
      const siblingBefore = await readFile(siblingFile);
      const standaloneBefore = await readFile(standaloneFile);
      const selectedBefore = await readFile(selectedFile);
      const read = setting === "collaboration"
        ? service.readSettings
        : service.readEngineeringSettings;
      const save = setting === "collaboration"
        ? service.saveCollaborationSettings
        : service.saveEngineeringProfile;
      const input = {
        ...(setting === "collaboration"
          ? {
              experience: "expert",
              explanationStyle: "conclusions",
              requirements: "- Keep this session's explanations practical.",
              responseLength: "very_short",
              tone: "direct"
            }
          : { profile: "durable.v1" }),
        sessionId,
        vibe64User: { role: setting === "collaboration" ? "owner" : "member" }
      };
      if (setting === "collaboration") {
        const denied = await save({ ...input, vibe64User: { role: "member" } });
        assert.equal(denied.ok, false);
        assert.equal(denied.code, "vibe64_owner_required");
        assert.deepEqual(await readFile(selectedFile), selectedBefore);
      }
      const saved = await save(input);
      assert.equal(saved.ok, true);
      assert.equal(saved[setting].source.sessionId, sessionId);
      assert.equal(saved[setting].source.rootKind, "session-source");
      if (setting === "collaboration") {
        for (const field of ["experience", "explanationStyle", "requirements", "responseLength", "tone"]) {
          assert.equal(saved.collaboration[field], input[field]);
        }
      } else {
        assert.equal(saved.engineering.profile.id, input.profile);
      }
      const readBack = await read(input);
      assert.equal(readBack.ok, true);
      assert.deepEqual(readBack[setting], saved[setting]);
      assert.notDeepEqual(await readFile(selectedFile), selectedBefore);
      assert.deepEqual(await readFile(siblingFile), siblingBefore);
      assert.deepEqual(await readFile(standaloneFile), standaloneBefore);

      const savedBytes = await readFile(selectedFile);
      const invalid = await save({
        ...input,
        ...(setting === "collaboration"
          ? { requirements: "## Unexpected section\nDo something else." }
          : { profile: "missing-profile.v1" })
      });
      assert.equal(invalid.ok, false);
      assert.equal(invalid.code, setting === "collaboration"
        ? "COLLABORATION_INVALID"
        : "ENGINEERING_PROFILE_UNKNOWN");
      assert.deepEqual(await readFile(selectedFile), savedBytes);
      const retryInput = {
        ...input,
        ...(setting === "collaboration"
          ? { requirements: "- A valid retry for this source." }
          : { profile: "high-assurance.v1" })
      };
      const retried = await save(retryInput);
      assert.equal(retried.ok, true);
      assert.deepEqual((await read(retryInput))[setting], retried[setting]);
      const retryBytes = await readFile(selectedFile);
      assert.notDeepEqual(retryBytes, savedBytes);

      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const exclusive = runVibe64RenewalAgentWriteExclusive({ store }, sessionId, async () => {
        entered.resolve();
        await release.promise;
      });
      const exclusiveOutcome = exclusive.then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      try {
        await Promise.race([
          entered.promise,
          exclusiveOutcome.then((outcome) => assert.fail(
            `Renewal write exclusion ended before its held operation: ${JSON.stringify(outcome)}`
          ))
        ]);
        const blocked = await save(input);
        assert.equal(blocked.ok, false);
        assert.equal(blocked.code, "vibe64_agent_write_mode_busy");
        assert.deepEqual(await readFile(selectedFile), retryBytes);
      } finally {
        release.resolve();
        await exclusiveOutcome;
      }
      assert.equal((await exclusiveOutcome).value.acquired, true);
      const afterRelease = await save(input);
      assert.equal(afterRelease.ok, true);
      assert.deepEqual((await read(input))[setting], afterRelease[setting]);

      const beforeQuiesce = await readFile(selectedFile);
      const renewalId = `${setting}-renewal`;
      await store.quiesceSessionForRenewal({ renewalId, sourceSessionId: sessionId });
      const quiesced = await save(retryInput);
      assert.equal(quiesced.ok, false);
      assert.equal(quiesced.code, "vibe64_session_renewal_quiesced");
      assert.deepEqual(await readFile(selectedFile), beforeQuiesce);
      await store.restoreSessionAfterRenewalCancellation({ renewalId, sourceSessionId: sessionId });
      assert.equal((await save(retryInput)).ok, true);

      const beforeSourceLock = await readFile(selectedFile);
      const sourceLockEntered = Promise.withResolvers();
      const releaseSourceLock = Promise.withResolvers();
      const contended = Promise.withResolvers();
      const lockPath = path.join(service.currentProjectRuntimeRoot(), "locks", "source-mutation.lock");
      const open = fsPromises.open;
      const observedOpen = t.mock.method(fsPromises, "open", async (...args) => {
        try {
          return await open(...args);
        } catch (error) {
          if (args[0] === lockPath && args[1] === "wx" && error.code === "EEXIST") {
            contended.resolve();
          }
          throw error;
        }
      });
      syncBuiltinESMExports();
      const sourceLock = service.runProjectSourceExclusive(async () => {
        sourceLockEntered.resolve();
        await releaseSourceLock.promise;
      }, { operation: "settings-acceptance-held-source-write" });
      const sourceLockOutcome = sourceLock.then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      let sourceSave;
      let sourceSaveSettled = false;
      try {
        await Promise.race([
          sourceLockEntered.promise,
          sourceLockOutcome.then((outcome) => assert.fail(
            `Project source exclusion ended before its held operation: ${JSON.stringify(outcome)}`
          ))
        ]);
        sourceSave = save(input);
        const sourceSaveOutcome = sourceSave.then(
          (value) => {
            sourceSaveSettled = true;
            return { value };
          },
          (error) => {
            sourceSaveSettled = true;
            return { error };
          }
        );
        await Promise.race([
          contended.promise,
          sourceSaveOutcome.then((outcome) => assert.fail(
            `Settings save settled without contending on the held source lock: ${JSON.stringify(outcome)}`
          ))
        ]);
        assert.equal(sourceSaveSettled, false);
        assert.deepEqual(await readFile(selectedFile), beforeSourceLock);
      } finally {
        releaseSourceLock.resolve();
        await Promise.allSettled([sourceLock, sourceSave]);
        observedOpen.mock.restore();
        syncBuiltinESMExports();
      }
      assert.equal((await sourceLockOutcome).error, undefined);
      const afterSourceLock = await sourceSave;
      assert.equal(afterSourceLock.ok, true);
      assert.deepEqual(afterSourceLock[setting], saved[setting]);
      assert.deepEqual((await read(input))[setting], afterSourceLock[setting]);
      assert.deepEqual(await readFile(selectedFile), savedBytes);

      const beforeUnavailableSource = await readFile(selectedFile);
      for (const operation of [read, save]) {
        const missing = await operation({ ...input, sessionId: `${setting}-unknown` });
        assert.equal(missing.ok, false);
        assert.equal(missing.code, "vibe64_session_not_found");
      }
      const unavailableSessionId = `${setting}-without-source`;
      await store.createSession({ runtimeKind: "genesis", sessionId: unavailableSessionId });
      const unavailable = await read({ ...input, sessionId: unavailableSessionId });
      assert.equal(unavailable.ok, true);
      assert.equal(unavailable[setting].available, false);
      assert.equal(unavailable[setting].source.sessionId, unavailableSessionId);
      const unavailableSave = await save({ ...input, sessionId: unavailableSessionId });
      assert.equal(unavailableSave.ok, false);
      assert.equal(unavailableSave.code, `vibe64_${setting}_source_required`);
      assert.deepEqual(await readFile(selectedFile), beforeUnavailableSource);

      await rm(sessionSource, { recursive: true });
      for (const operation of [read, save]) {
        const removed = await operation(input);
        assert.equal(removed.ok, false);
        assert.equal(removed.code, "vibe64_project_path_not_accessible");
      }
      await assert.rejects(stat(sessionSource), { code: "ENOENT" });
      assert.deepEqual(await readFile(siblingFile), siblingBefore);
      assert.deepEqual(await readFile(standaloneFile), standaloneBefore);
    });
  });
}

test("standalone collaboration is keyed to the exact local source folder", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const systemRoot = path.join(temporaryRoot, "system");
    const firstRoot = path.join(temporaryRoot, "first", "same-name");
    const secondRoot = path.join(temporaryRoot, "second", "same-name");
    await Promise.all([
      mkdir(firstRoot, { recursive: true }),
      mkdir(secondRoot, { recursive: true })
    ]);
    const collaboration = collaborationHarness();
    const standaloneService = (targetRoot) => createService({
      ...collaboration,
      env: {},
      projectContext: createStudioProjectContext({
        explicitManagedSourceRoot: path.join(temporaryRoot, "managed-source"),
        explicitSystemRoot: systemRoot,
        explicitTargetRoot: targetRoot,
        home: temporaryRoot,
        runtimeProfile: {
          local: true,
          mode: "local"
        }
      })
    });
    const firstService = standaloneService(firstRoot);
    const secondService = standaloneService(secondRoot);
    await firstService.saveCollaborationSettings({
      experience: "comfortable",
      explanationStyle: "concise",
      requirements: "First folder",
      responseLength: "concise",
      tone: "playful"
    });

    assert.equal((await firstService.readSettings()).collaboration.requirements, "First folder");
    assert.equal((await secondService.readSettings()).collaboration.requirements, "");
    await assert.rejects(stat(path.join(firstRoot, "settings", "ai-policy.json")), {
      code: "ENOENT"
    });
  });
});

test("the project service exposes the selected session source without leaking its storage layout", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot);
    const store = await service.createSessionStore();
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "selected-session"
    });

    assert.equal(await service.readSelectedSessionSource(), null);
    await store.updateCurrentSession("selected-session");
    await assert.rejects(
      service.readSelectedSessionSource(),
      { code: "vibe64_selected_session_source_unavailable" }
    );
    await store.writeMetadataValue("selected-session", "source_kind", "session_clone");
    await store.writeMetadataValue("selected-session", "source_path_authority", "managed_session_source");
    await store.writeMetadataValue(
      "selected-session",
      "source_path",
      path.join(targetRoot, "sessions", "active", "selected-session", "source")
    );

    assert.deepEqual(await service.readSelectedSessionSource(), {
      sessionId: "selected-session",
      sourceRoot: path.join(targetRoot, "sessions", "active", "selected-session", "source")
    });
  });
});

test("Env is user-owned and reaches Genesis sessions without an adapter", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let environmentInspections = 0;
    const service = projectService(targetRoot, {
      inspectEnvironment() {
        environmentInspections += 1;
        return { components: [], environmentDefaults: [], files: [], resources: [], status: "ready" };
      },
      env: {
        PLATFORM_VALUE: "platform"
      }
    });

    const saved = await service.saveEnvUserValues({
      environment: "dev",
      values: {
        BOOKS_API_KEY: {
          secret: true,
          value: "secret-value"
        },
        BOOKS_ORIGIN: {
          secret: false,
          value: "http://books.test"
        }
      }
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.env.records.find((record) => record.key === "BOOKS_API_KEY").value, "********");
    assert.deepEqual(await service.revealEnvSecret({
      environment: "dev",
      key: "BOOKS_API_KEY"
    }), {
      key: "BOOKS_API_KEY",
      ok: true,
      value: "secret-value"
    });
    const publicValueReveal = await service.revealEnvSecret({
      environment: "dev",
      key: "BOOKS_ORIGIN"
    });
    assert.equal(publicValueReveal.code, "vibe64_env_variable_not_secret");
    assert.equal(publicValueReveal.ok, false);
    const projectRuntimeRoot = service.currentProjectRuntimeRoot();
    assert.notEqual(projectRuntimeRoot, targetRoot);
    assert.equal((await stat(path.join(projectRuntimeRoot, "env", "user-values.json"))).mode & 0o777, 0o600);
    await assert.rejects(
      stat(path.join(targetRoot, "env", "user-values.json")),
      { code: "ENOENT" }
    );
    assert.deepEqual(await service.projectExecutionEnvironment({
      scope: "dev"
    }), {
      BOOKS_API_KEY: "secret-value",
      BOOKS_ORIGIN: "http://books.test"
    });

    const beforeRuntime = environmentInspections;
    const runtime = await service.createRuntime();
    await runtime.store.createSession({ runtimeKind: "genesis", sessionId: "env-lazy-read" });
    await runtime.getSession("env-lazy-read", { inspectSource: false });
    assert.equal(environmentInspections, beforeRuntime);
    const promptEnvironment = await runtime.resolvePromptEnvironment();
    assert.equal(promptEnvironment.PLATFORM_VALUE, "platform");
    assert.equal(promptEnvironment.BOOKS_API_KEY, "secret-value");
    assert.equal(environmentInspections, beforeRuntime + 1);
    assert.equal(runtime.adapter, undefined);
  });
});

test("lazy prompt environment stays with the runtime's project when resolved from another request", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const contexts = ["alpha", "beta"].map((slug) => ({
      projectRuntimeRoot: path.join(targetRoot, slug, "runtime"),
      slug,
      sourceRoot: path.join(targetRoot, slug, "source"),
      targetRoot: path.join(targetRoot, slug, "source")
    }));
    for (const context of contexts) {
      await mkdir(context.sourceRoot, { recursive: true });
    }
    const service = projectService(targetRoot, {
      inspectEnvironment() {
        return { components: [], environmentDefaults: [], files: [], resources: [], status: "ready" };
      }
    });
    const runtime = await runWithProjectRequestContext(contexts[0], async () => {
      await service.saveEnvUserValues({
        environment: "dev",
        values: { PROJECT_VALUE: { secret: false, value: "alpha" } }
      });
      return service.createRuntime({ inspectSource: false });
    });
    await runWithProjectRequestContext(contexts[1], async () => {
      await service.saveEnvUserValues({
        environment: "dev",
        values: { PROJECT_VALUE: { secret: false, value: "beta" } }
      });
      assert.equal((await runtime.resolvePromptEnvironment()).PROJECT_VALUE, "alpha");
      const otherRuntime = await service.createRuntime({ inspectSource: false });
      assert.equal((await otherRuntime.resolvePromptEnvironment()).PROJECT_VALUE, "beta");
    });
  });
});

test("saving or removing Env values immediately refreshes declared environment files", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await mkdir(path.join(targetRoot, ".git", "info"), {
      recursive: true
    });
    const service = projectService(targetRoot, {
      inspectEnvironment() {
        return {
          components: ["example-stack"],
          environmentDefaults: [],
          files: [{ format: "dotenv", path: ".env" }],
          resources: [],
          status: "ready"
        };
      }
    });

    const saved = await service.saveEnvUserValues({
      environment: "dev",
      values: {
        PREVIEW_AUTH_SECRET: {
          secret: true,
          value: "temporary-secret"
        }
      }
    });
    assert.equal(saved.ok, true);
    assert.match(await readFile(path.join(targetRoot, ".env"), "utf8"), /PREVIEW_AUTH_SECRET=temporary-secret/u);

    const removed = await service.saveEnvUserValues({
      environment: "dev",
      values: {
        PREVIEW_AUTH_SECRET: {
          remove: true
        }
      }
    });
    assert.equal(removed.ok, true);
    assert.doesNotMatch(await readFile(path.join(targetRoot, ".env"), "utf8"), /PREVIEW_AUTH_SECRET/u);
  });
});

test("reserved Vibe64 Env names require an explicit Genesis Stack declaration", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot);
    const response = await service.saveEnvUserValues({
      values: {
        VIBE64_INTERNAL_OVERRIDE: "unsafe"
      }
    });

    assert.equal(response.ok, false);
    assert.equal(response.errors[0].code, "vibe64_env_reserved_key");
  });
});

test("Genesis Stack resources define expected Env names without technology checks in Vibe64", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot, {
      inspectEnvironment() {
        return {
          components: ["example-stack"],
          environmentDefaults: [],
          files: [],
          resources: [{
            component: "example-stack",
            resource: {
              environmentAlternatives: [{
                allowEmpty: [],
                bindings: {
                  origin: "EXAMPLE_ORIGIN",
                  token: "VIBE64_EXAMPLE_TOKEN"
                },
                preferred: true
              }],
              id: "example-service",
              kind: "example-service"
            }
          }],
          status: "missing-inputs"
        };
      }
    });

    const read = await service.readEnv();
    assert.deepEqual(read.env.records.map((record) => record.key), [
      "EXAMPLE_ORIGIN",
      "VIBE64_EXAMPLE_TOKEN"
    ]);
    assert.equal(read.env.records.every((record) => record.valuePresent === false), true);
    assert.equal(read.env.records.every((record) => record.requiredFor.includes("server")), true);

    const saved = await service.saveEnvUserValues({
      values: {
        VIBE64_EXAMPLE_TOKEN: {
          secret: true,
          value: "allowed-by-stack"
        }
      }
    });
    assert.equal(saved.ok, true);
  });
});

test("project execution Env reuses an exact internally authorized session record", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sourceSessionId = "renewal-source";
    const sessionId = "renewal-successor";
    const sessionSource = sourcePath(targetRoot, sessionId);
    await mkdir(sessionSource, { recursive: true });
    const inspectedRoots = [];
    const service = projectService(targetRoot, {
      inspectEnvironment({ projectRoot }) {
        inspectedRoots.push(projectRoot);
        return {
          components: [],
          environmentDefaults: [],
          files: [],
          resources: [],
          status: "ready"
        };
      }
    });
    const runtime = await service.createRuntime({ inspectSource: false });
    await runtime.store.createSession({
      runtimeKind: "genesis",
      sessionId: sourceSessionId
    });
    await runtime.store.quiesceSessionForRenewal({
      renewalId: "renewal-env-projection",
      sourceSessionId
    });
    await runtime.store.createRenewalPendingSession({
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      confirmedAt: "2026-08-24T01:01:00.000Z",
      metadata: sourceMetadata(targetRoot, sessionId),
      renewalId: "renewal-env-projection",
      renewedFrom: sourceSessionId,
      runtimeKind: "genesis",
      sessionId,
      startedAt: "2026-08-24T01:00:00.000Z"
    });
    const session = await runtime.store.readSessionForRenewal(sessionId);

    const projected = await runVibe64RenewalAgentWriteExclusive(
      runtime,
      sessionId,
      () => service.projectExecutionEnvironment({
        session,
        sessionId
      })
    );
    assert.equal(projected.acquired, true);
    assert.deepEqual(projected.value, {});
    assert.equal(inspectedRoots.at(-1), sessionSource);
    assert.equal(inspectedRoots.filter((root) => root === sessionSource).length, 1);
    await assert.rejects(
      () => service.projectExecutionEnvironment({ sessionId }),
      { code: "vibe64_session_renewal_private" }
    );
  });
});

test("current-app inspection resolves Env without materializing session files", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const activeSessionId = "current-app-active";
    const quiescedSessionId = "current-app-quiesced";
    const activeSource = sourcePath(targetRoot, activeSessionId);
    const quiescedSource = sourcePath(targetRoot, quiescedSessionId);
    for (const sourceRoot of [activeSource, quiescedSource]) {
      await mkdir(path.join(sourceRoot, ".git", "info"), { recursive: true });
    }
    let blockNextTargetInspection = false;
    let releaseTargetInspection = null;
    let targetInspectionStarted = null;
    const targetInspectionStart = new Promise((resolve) => {
      targetInspectionStarted = resolve;
    });
    const environmentDeclaration = () => ({
      components: ["example-stack"],
      environmentDefaults: [],
      files: [{ format: "dotenv", path: ".env" }],
      resources: [],
      status: "ready"
    });
    const service = projectService(targetRoot, {
      inspectEnvironment({ projectRoot }) {
        if (blockNextTargetInspection && projectRoot === quiescedSource) {
          blockNextTargetInspection = false;
          targetInspectionStarted();
          return new Promise((resolve) => {
            releaseTargetInspection = () => resolve(environmentDeclaration());
          });
        }
        return environmentDeclaration();
      }
    });
    await service.saveEnvUserValues({
      environment: "dev",
      values: {
        CURRENT_APP_VALUE: {
          secret: false,
          value: "active-value"
        }
      }
    });
    const store = await service.createSessionStore();
    await store.createSession({
      metadata: sourceMetadata(targetRoot, activeSessionId),
      runtimeKind: "genesis",
      sessionId: activeSessionId
    });
    await store.createSession({
      metadata: sourceMetadata(targetRoot, quiescedSessionId),
      runtimeKind: "genesis",
      sessionId: quiescedSessionId
    });
    const inspected = [];
    const currentApp = createCurrentAppService({
      inspectOutputs(input) {
        assert.equal(input.environment.CURRENT_APP_VALUE, "active-value");
        inspected.push(input.projectRoot);
        return {
          components: [],
          diagnostics: [],
          resources: [],
          runtimeRequirements: [],
          stackHash: "stack-hash",
          status: "ready",
          targets: []
        };
      },
      projectService: service
    });

    const active = await currentApp.inspectCurrentApp({ sessionId: activeSessionId });
    assert.equal(active.ok, true);
    await assert.rejects(
      () => readFile(path.join(activeSource, ".env"), "utf8"),
      { code: "ENOENT" }
    );
    assert.deepEqual(inspected, [activeSource]);

    const envPath = path.join(quiescedSource, ".env");
    const excludePath = path.join(quiescedSource, ".git", "info", "exclude");
    await writeFile(envPath, "preserved-env\n", "utf8");
    await writeFile(excludePath, "preserved-exclude\n", "utf8");
    blockNextTargetInspection = true;
    const pendingInspection = currentApp.inspectCurrentApp({ sessionId: quiescedSessionId });
    await targetInspectionStart;
    await store.quiesceSessionForRenewal({
      renewalId: "renewal-current-app",
      sourceSessionId: quiescedSessionId
    });
    releaseTargetInspection();

    const completed = await pendingInspection;
    assert.equal(completed.ok, true);
    assert.equal(await readFile(envPath, "utf8"), "preserved-env\n");
    assert.equal(await readFile(excludePath, "utf8"), "preserved-exclude\n");
    assert.deepEqual(inspected, [activeSource, quiescedSource]);
  });
});

test("Env saving cannot update project state or source projection once renewal is quiesced", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "env-save-renewal";
    const sessionSource = sourcePath(targetRoot, sessionId);
    await mkdir(path.join(sessionSource, ".git", "info"), { recursive: true });
    const declaration = {
      components: ["example-stack"],
      environmentDefaults: [],
      files: [{ format: "dotenv", path: ".env" }],
      resources: [],
      status: "ready"
    };
    const service = projectService(targetRoot, {
      inspectEnvironment() {
        return declaration;
      }
    });
    const store = await service.createSessionStore();
    await store.createSession({
      metadata: sourceMetadata(targetRoot, sessionId),
      runtimeKind: "genesis",
      sessionId
    });
    const initial = await service.saveEnvUserValues({
      environment: "dev",
      sessionId,
      values: {
        SESSION_VALUE: {
          secret: false,
          value: "preserved-value"
        }
      }
    });
    assert.equal(initial.ok, true);
    const envPath = path.join(sessionSource, ".env");
    const excludePath = path.join(sessionSource, ".git", "info", "exclude");
    const userValuesPath = path.join(
      service.currentProjectRuntimeRoot(),
      "env",
      "user-values.json"
    );
    const beforeRenewal = {
      env: await readFile(envPath, "utf8"),
      excludes: await readFile(excludePath, "utf8"),
      userValues: await readFile(userValuesPath, "utf8")
    };

    await store.quiesceSessionForRenewal({
      renewalId: "renewal-env-save",
      sourceSessionId: sessionId
    });
    const pendingSave = service.saveEnvUserValues({
      environment: "dev",
      sessionId,
      values: {
        SESSION_VALUE: {
          secret: false,
          value: "must-not-be-written"
        }
      }
    });


    const blocked = await pendingSave;
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "vibe64_session_renewal_quiesced");
    assert.equal(await readFile(envPath, "utf8"), beforeRenewal.env);
    assert.equal(await readFile(excludePath, "utf8"), beforeRenewal.excludes);
    assert.equal(await readFile(userValuesPath, "utf8"), beforeRenewal.userValues);
  });
});

test("hidden renewal resource cleanup requires and reuses its exact internal session record", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sourceSessionId = "renewal-source";
    const successorSessionId = "renewal-successor";
    const successorSource = sourcePath(targetRoot, successorSessionId);
    await mkdir(successorSource, { recursive: true });
    const released = [];
    const service = projectService(targetRoot);
    service.setResourceEnvironmentProvider({
      async environmentForResources() {
        return { environment: {} };
      },
      async removeSessionResources(input) {
        released.push(input);
        return { ok: true };
      }
    });
    const store = await service.createSessionStore();
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: sourceSessionId
    });
    await store.quiesceSessionForRenewal({
      renewalId: "renewal-resource-cleanup",
      sourceSessionId
    });
    await store.createRenewalPendingSession({
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      confirmedAt: "2026-08-24T01:01:00.000Z",
      metadata: sourceMetadata(targetRoot, successorSessionId),
      renewalId: "renewal-resource-cleanup",
      renewedFrom: sourceSessionId,
      runtimeKind: "genesis",
      sessionId: successorSessionId,
      startedAt: "2026-08-24T01:00:00.000Z"
    });
    const hiddenSuccessor = await store.readSessionForRenewal(successorSessionId);

    await assert.rejects(
      () => service.releaseSessionResources({ sessionId: successorSessionId }),
      { code: "vibe64_session_renewal_private" }
    );
    assert.deepEqual(await service.releaseSessionResources({
      session: hiddenSuccessor,
      sessionId: successorSessionId
    }), { ok: true });
    assert.equal(released.length, 1);
    assert.equal(released[0].sessionId, successorSessionId);
    assert.equal(released[0].sourceRoot, successorSource);
  });
});

test("a host maps semantic database values onto exact Laravel-style Stack bindings", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "session-1";
    const sessionSource = sourcePath(targetRoot, sessionId);
    await Promise.all([
      mkdir(path.join(targetRoot, ".git", "info"), {
        recursive: true
      }),
      mkdir(path.join(sessionSource, ".git", "info"), {
        recursive: true
      })
    ]);
    const providerCalls = [];
    const service = projectService(targetRoot, {
      inspectEnvironment() {
        return {
          components: ["example-stack"],
          environmentDefaults: [{
            name: "DB_CONNECTION",
            sources: ["component:example-stack"],
            value: "mysql"
          }],
          files: [{ format: "dotenv", path: ".env" }],
          resources: [{
            component: "example-stack",
            resource: {
              environmentAlternatives: [{
                allowEmpty: ["password"],
                bindings: {
                  database: "DB_DATABASE",
                  host: "DB_HOST",
                  password: "DB_PASSWORD",
                  port: "DB_PORT",
                  username: "DB_USERNAME"
                },
                preferred: true
              }, {
                allowEmpty: [],
                bindings: {
                  url: "DATABASE_URL"
                },
                preferred: false
              }],
              id: "database",
              kind: "mysql",
              optionalBindings: {
                testDatabase: "TEST_DB_NAME"
              }
            }
          }],
          status: "missing-inputs"
        };
      }
    });
    const released = [];
    const resolvedProviderCalls = [];
    const managedEnvironment = {
      contract: "vibe64.resource-environment.v2",
      databaseToolEnvironment: {
        contract: "vibe64.database-tool-environment.v1",
        kind: "mysql",
        read: {
          database: "managed_catalogue",
          host: "127.0.0.1",
          password: "reader-secret",
          port: 23060,
          username: "managed_reader"
        },
        write: {
          database: "managed_catalogue",
          host: "127.0.0.1",
          password: "managed-secret",
          port: 23060,
          username: "managed_writer"
        }
      },
      resourceValues: [{
        declaration: {
          component: "example-stack",
          id: "database",
          kind: "mysql"
        },
        values: {
          database: "managed_catalogue",
          host: "127.0.0.1",
          password: "managed-secret",
          port: 23060,
          testDatabase: "managed_catalogue_test",
          url: "mysql://managed_writer:managed-secret@127.0.0.1:23060/managed_catalogue",
          username: "managed_writer"
        }
      }]
    };
    service.setResourceEnvironmentProvider({
      managedDevelopmentDatabase: true,
      async environmentForProvisionedResources(input) {
        resolvedProviderCalls.push(input);
        return managedEnvironment;
      },
      async environmentForResources(input) {
        providerCalls.push(input);
        return managedEnvironment;
      },
      async removeSessionResources(input) {
        released.push(input);
        return { ok: true };
      }
    });

    const read = await service.readEnv();
    const unconfigured = Object.fromEntries(read.env.records.map((record) => [record.key, record]));
    assert.deepEqual(Object.keys(unconfigured).sort(), [
      "DB_CONNECTION",
      "DB_DATABASE",
      "DB_HOST",
      "DB_PASSWORD",
      "DB_PORT",
      "DB_USERNAME"
    ]);
    assert.equal(unconfigured.DB_CONNECTION.value, "mysql");
    assert.equal(unconfigured.DB_DATABASE.owner, "user");
    assert.equal(unconfigured.DB_PASSWORD.value, "********");
    assert.equal(unconfigured.DB_PASSWORD.valuePresent, false);
    assert.equal(JSON.stringify(read).includes("managed-secret"), false);

    assert.deepEqual(await service.projectExecutionEnvironment(), {
      DB_CONNECTION: "mysql"
    });
    assert.equal(providerCalls.length, 0);

    const store = await service.createSessionStore();
    await store.createSession({
      metadata: sourceMetadata(targetRoot, sessionId),
      runtimeKind: "genesis",
      sessionId
    });

    const sessionRead = await service.readEnv({ sessionId });
    const configured = Object.fromEntries(sessionRead.env.records.map((record) => [record.key, record]));
    assert.deepEqual(Object.keys(configured).sort(), [
      "DB_CONNECTION",
      "DB_DATABASE",
      "DB_HOST",
      "DB_PASSWORD",
      "DB_PORT",
      "DB_USERNAME",
      "TEST_DB_NAME"
    ]);
    assert.equal(configured.DB_DATABASE.value, "managed_catalogue");
    assert.equal(configured.DB_DATABASE.owner, "system");
    assert.equal(configured.DB_DATABASE.source, "vibe64-host:managed-resource:mysql:database");
    assert.equal(configured.DB_PASSWORD.value, "********");
    assert.equal(configured.DB_PASSWORD.valuePresent, true);
    assert.equal(configured.TEST_DB_NAME.value, "managed_catalogue_test");
    assert.equal(JSON.stringify(sessionRead).includes("managed-secret"), false);
    assert.deepEqual(await service.revealEnvSecret({
      key: "DB_PASSWORD",
      sessionId
    }), {
      key: "DB_PASSWORD",
      ok: true,
      value: "managed-secret"
    });

    assert.deepEqual(await service.projectExecutionEnvironment({ sessionId }), {
      DB_CONNECTION: "mysql",
      DB_DATABASE: "managed_catalogue",
      DB_HOST: "127.0.0.1",
      DB_PASSWORD: "managed-secret",
      DB_PORT: "23060",
      DB_USERNAME: "managed_writer",
      TEST_DB_NAME: "managed_catalogue_test"
    });
    const materialized = await readFile(path.join(sessionSource, ".env"), "utf8");
    assert.match(materialized, /DB_CONNECTION=mysql/u);
    assert.match(materialized, /DB_USERNAME=managed_writer/u);
    assert.match(materialized, /DB_PASSWORD=managed-secret/u);
    assert.doesNotMatch(materialized, /reader-secret|managed_reader/u);
    assert.match(await readFile(path.join(sessionSource, ".git", "info", "exclude"), "utf8"), /^\/\.env$/mu);
    const tool = await service.sessionDatabaseEnvironment({ sessionId });
    assert.equal(tool.databaseToolEnvironment.read.username, "managed_reader");
    assert.equal(tool.databaseToolEnvironment.write.username, "managed_writer");
    assert.equal(providerCalls.length, 1);
    assert.equal(resolvedProviderCalls.length, 3);
    assert.equal(providerCalls.every((call) => call.sessionId === sessionId), true);
    assert.equal(resolvedProviderCalls[0].sessionId, sessionId);
    assert.equal(resolvedProviderCalls[0].developmentDatabaseScope, "session");
    assert.equal(providerCalls.every((call) => call.developmentDatabaseScope === "session"), true);
    assert.deepEqual(providerCalls[0].resources.map(({ resource }) => resource.id), ["database"]);
    assert.deepEqual(providerCalls[0].resources.map(({ resource }) => resource.kind), ["mysql"]);
    assert.equal(Object.hasOwn(providerCalls[0], "environment"), false);

    assert.deepEqual(await service.releaseSessionResources({ sessionId }), { ok: true });
    assert.equal(released.length, 1);
    assert.equal(released[0].sessionId, sessionId);
    assert.equal(released[0].developmentDatabaseScope, "session");
  });
});

test("the installed JSKIT MySQL Stack materializes its declared names without exposing the reader", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "jskit-resource-session";
    const sessionSource = sourcePath(targetRoot, sessionId);
    await mkdir(path.join(sessionSource, ".git", "info"), { recursive: true });
    await execFileAsync("git", ["init"], { cwd: sessionSource });
    await initializeGenesisProject({ projectRoot: sessionSource });
    await addGenesisStack({
      pieces: ["jskit-mysql"],
      projectRoot: sessionSource
    });

    const service = projectService(targetRoot);
    service.setResourceEnvironmentProvider({
      managedDevelopmentDatabase: true,
      async environmentForResources({ resources }) {
        const [{ component, resource }] = resources;
        return {
          contract: "vibe64.resource-environment.v2",
          databaseToolEnvironment: {
            contract: "vibe64.database-tool-environment.v1",
            kind: "mysql",
            read: {
              database: "jskit_catalogue",
              host: "127.0.0.1",
              password: "reader-private",
              port: 23060,
              username: "jskit_reader"
            },
            write: {
              database: "jskit_catalogue",
              host: "127.0.0.1",
              password: "writer-private",
              port: 23060,
              username: "jskit_writer"
            }
          },
          resourceValues: [{
            declaration: {
              component,
              id: resource.id,
              kind: resource.kind
            },
            values: {
              database: "jskit_catalogue",
              host: "127.0.0.1",
              password: "writer-private",
              port: 23060,
              testDatabase: "jskit_catalogue_test",
              url: "mysql://jskit_writer:writer-private@127.0.0.1:23060/jskit_catalogue",
              username: "jskit_writer"
            }
          }]
        };
      }
    });
    const store = await service.createSessionStore();
    await store.createSession({
      metadata: sourceMetadata(targetRoot, sessionId),
      runtimeKind: "genesis",
      sessionId
    });

    assert.deepEqual(await service.projectExecutionEnvironment({ sessionId }), {
      DB_CLIENT: "mysql2",
      DB_HOST: "127.0.0.1",
      DB_NAME: "jskit_catalogue",
      DB_PASSWORD: "writer-private",
      DB_PORT: "23060",
      DB_USER: "jskit_writer",
      TEST_DB_NAME: "jskit_catalogue_test"
    });
    const dotenv = await readFile(path.join(sessionSource, ".env"), "utf8");
    assert.doesNotMatch(dotenv, /jskit_reader|reader-private/u);
  });
});

test("the installed JSKIT PostgreSQL Stack materializes its declared names without exposing the reader", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "jskit-postgresql-resource-session";
    const sessionSource = sourcePath(targetRoot, sessionId);
    await mkdir(path.join(sessionSource, ".git", "info"), { recursive: true });
    await execFileAsync("git", ["init"], { cwd: sessionSource });
    await initializeGenesisProject({ projectRoot: sessionSource });
    await addGenesisStack({
      pieces: ["jskit-postgresql"],
      projectRoot: sessionSource
    });

    const service = projectService(targetRoot);
    service.setResourceEnvironmentProvider({
      managedDevelopmentDatabase: true,
      async environmentForResources({ resources }) {
        const [{ component, resource }] = resources;
        return {
          contract: "vibe64.resource-environment.v2",
          databaseToolEnvironment: {
            contract: "vibe64.database-tool-environment.v1",
            kind: "postgresql",
            read: {
              database: "jskit_catalogue",
              host: "127.0.0.1",
              password: "reader-private",
              port: 33060,
              username: "jskit_reader"
            },
            write: {
              database: "jskit_catalogue",
              host: "127.0.0.1",
              password: "writer-private",
              port: 33060,
              username: "jskit_writer"
            }
          },
          resourceValues: [{
            declaration: {
              component,
              id: resource.id,
              kind: resource.kind
            },
            values: {
              database: "jskit_catalogue",
              host: "127.0.0.1",
              password: "writer-private",
              port: 33060,
              url: "postgresql://jskit_writer:writer-private@127.0.0.1:33060/jskit_catalogue",
              username: "jskit_writer"
            }
          }]
        };
      }
    });
    const store = await service.createSessionStore();
    await store.createSession({
      metadata: sourceMetadata(targetRoot, sessionId),
      runtimeKind: "genesis",
      sessionId
    });

    assert.deepEqual(await service.projectExecutionEnvironment({ sessionId }), {
      DB_CLIENT: "pg",
      DB_HOST: "127.0.0.1",
      DB_NAME: "jskit_catalogue",
      DB_PASSWORD: "writer-private",
      DB_PORT: "33060",
      DB_USER: "jskit_writer"
    });
    const dotenv = await readFile(path.join(sessionSource, ".env"), "utf8");
    assert.doesNotMatch(dotenv, /jskit_reader|reader-private/u);
  });
});

test("managed app identities are stored in the repository source", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot);

    assert.deepEqual(await service.readPreviewApplicationIdentities(), {
      identities: [],
      ok: true
    });

    const saved = await service.savePreviewApplicationIdentities({
      identities: [
        {
          name: "Admin",
          type: "email",
          value: "admin@example.test"
        },
        {
          name: "user",
          type: "user-id",
          value: "42"
        }
      ]
    });

    assert.deepEqual(saved, {
      identities: [
        {
          name: "admin",
          type: "email",
          value: "admin@example.test"
        },
        {
          name: "user",
          type: "user-id",
          value: "42"
        }
      ],
      ok: true
    });
    assert.deepEqual(await service.readPreviewApplicationIdentities(), saved);

    const storedPath = path.join(
      targetRoot,
      ".vibe64",
      "preview-identities.json"
    );
    const stored = JSON.parse(await readFile(storedPath, "utf8"));
    assert.deepEqual(stored, {
      identities: saved.identities,
      version: 1
    });
    assert.equal((await stat(storedPath)).mode & 0o777, 0o660);
    await assert.rejects(() => readFile(path.join(
      service.currentProjectRuntimeRoot(),
      "preview",
      "application-identities.json"
    ), "utf8"), {
      code: "ENOENT"
    });
  });
});

test("managed app identities use the exact selected session source", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot);
    const store = await service.createSessionStore();
    const sessionSource = path.join(
      path.dirname(targetRoot),
      "managed-source",
      "sessions",
      "active",
      "identity-session",
      "source"
    );
    await mkdir(sessionSource, {
      recursive: true
    });
    await store.createSession({
      metadata: {
        source_kind: "session_clone",
        source_path: sessionSource,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      runtimeKind: "genesis",
      sessionId: "identity-session"
    });

    const saved = await service.savePreviewApplicationIdentities({
      identities: [{
        name: "admin",
        type: "email",
        value: "admin@example.test"
      }],
      sessionId: "identity-session"
    });

    assert.deepEqual(
      await service.readPreviewApplicationIdentities({
        sessionId: "identity-session"
      }),
      saved
    );
    assert.deepEqual(JSON.parse(await readFile(path.join(
      sessionSource,
      ".vibe64",
      "preview-identities.json"
    ), "utf8")), {
      identities: saved.identities,
      version: 1
    });
    assert.deepEqual(await service.readPreviewApplicationIdentities(), {
      identities: [],
      ok: true
    });
  });
});

test("managed app identity writes cannot mutate a renewal-quiesced session source", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "identity-renewal";
    const sessionSource = sourcePath(targetRoot, sessionId);
    await mkdir(sessionSource, { recursive: true });
    const service = projectService(targetRoot, {
      inspectEnvironment() {
        const declaration = {
          components: [],
          environmentDefaults: [],
          files: [],
          resources: [],
          status: "ready"
        };
        return declaration;
      }
    });
    const store = await service.createSessionStore();
    await store.createSession({
      metadata: sourceMetadata(targetRoot, sessionId),
      runtimeKind: "genesis",
      sessionId
    });
    const active = await service.savePreviewApplicationIdentities({
      identities: [{
        name: "admin",
        type: "email",
        value: "admin@example.test"
      }],
      sessionId
    });
    assert.equal(active.ok, true);
    const storedPath = path.join(sessionSource, ".vibe64", "preview-identities.json");
    const storedBeforeRenewal = await readFile(storedPath, "utf8");
    await store.quiesceSessionForRenewal({
      renewalId: "renewal-preview-identities",
      sourceSessionId: sessionId
    });
    const pendingSave = service.savePreviewApplicationIdentities({
      identities: [{
        name: "member",
        type: "email",
        value: "member@example.test"
      }],
      sessionId
    });


    const blocked = await pendingSave;

    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "vibe64_session_renewal_quiesced");
    assert.equal(await readFile(storedPath, "utf8"), storedBeforeRenewal);
  });
});

test("managed app identity validation rejects ambiguous names", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot);
    const response = await service.savePreviewApplicationIdentities({
      identities: [
        {
          name: "admin",
          type: "email",
          value: "first@example.test"
        },
        {
          name: "ADMIN",
          type: "email",
          value: "second@example.test"
        }
      ]
    });

    assert.equal(response.ok, false);
    assert.equal(response.errors[0].code, "vibe64_invalid_application_identities_config");
    assert.match(response.errors[0].message, /duplicated/u);
  });
});

test("managed app identities ignore retired machine-local state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot);
    const runtimeRoot = service.currentProjectRuntimeRoot();
    const retiredPath = path.join(
      runtimeRoot,
      "preview",
      "application-identities.json"
    );
    const identities = [
      {
        name: "admin",
        type: "email",
        value: "admin@example.test"
      },
      {
        name: "user",
        type: "login",
        value: "catalogue-user"
      }
    ];
    await mkdir(path.dirname(retiredPath), {
      recursive: true
    });
    await writeFile(retiredPath, `${JSON.stringify({
      identities,
      version: 1
    })}\n`, "utf8");

    assert.deepEqual(await service.readPreviewApplicationIdentities(), {
      identities: [],
      ok: true
    });
    assert.deepEqual(JSON.parse(await readFile(retiredPath, "utf8")), {
      identities,
      version: 1
    });
    await assert.rejects(() => readFile(path.join(
      targetRoot,
      ".vibe64",
      "preview-identities.json"
    ), "utf8"), {
      code: "ENOENT"
    });
  });
});
