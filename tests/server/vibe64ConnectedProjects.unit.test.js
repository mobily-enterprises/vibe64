import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, readFile, writeFile, symlink, mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { normalizeConnectedProjects, readConnectedProjects, saveConnectedProjects } from "../../packages/vibe64-project/src/server/connectedProjects.js";
import { vibe64ConnectedProjectsInspection } from "../../packages/vibe64-genesis/src/server/connectedProjects.js";
import { createService } from "../../packages/vibe64-project/src/server/service.js";
import { createStudioProjectContext } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";
import { initializeGenesisProject, inspectVibe64ConnectedProjects } from "../../packages/vibe64-genesis/src/server/index.js";
import { SESSION_SOURCE_PATH_AUTHORITY_MANAGED } from "@local/vibe64-core/server/sessionSourcePath";

const library = { name: "Example library", repository: "https://github.com/example/library", relationship: "dependency" };
const composition = { name: "Editor", repository: "https://github.com/example/editor", relationship: "composition" };
function service(root, options = {}) {
  return createService({ env: {}, projectContext: createStudioProjectContext({
    explicitManagedSourceRoot: path.join(path.dirname(root), "managed-source"),
    explicitSystemRoot: path.join(path.dirname(root), "system"), explicitTargetRoot: root, home: path.dirname(root)
  }), inspectCollaboration: async () => ({ choices: {}, status: "defaulted" }),
  inspectConnectedRepository: async () => ({ permissions: { push: true } }), ...options });
}

test("connection identity rejects credentials, duplicate identities and runtime state", () => {
  assert.deepEqual(normalizeConnectedProjects({ projects: [{ ...library, repository: "https://github.com/EXAMPLE/Library.git/" }, composition] }),
    { projects: [library, composition] });
  for (const repository of ["../library", "git@github.com:example/library", "https://token@github.com/example/library",
    "https://github.com/example/library?token=secret", "https://github.com/example/..", "https://github.com/example/library#main"]) {
    assert.throws(() => normalizeConnectedProjects({ projects: [{ ...library, repository }] }), { code: "vibe64_connections_invalid" });
  }
  for (const value of [
    { projects: [library, { ...library, name: "Another name", repository: "https://github.com/Example/Library.git" }] },
    { projects: [{ ...library, sourceRoot: "/private/source" }] },
    { projects: [{ ...library, relationship: "unknown" }] },
    { projects: [], runtime: {} }
  ]) assert.throws(() => normalizeConnectedProjects(value), { code: "vibe64_connections_invalid" });
});

test("Incoming integration checks fresh receiving write access and the existing publication policy", async () => {
  await withTemporaryRoot(async root => {
    const context = createStudioProjectContext({ explicitTargetRoot: root, explicitSystemRoot: path.join(root, "system"), home: root });
    const current = { slug: "receiving", path: root, repositoryMode: "github",
      repository: { mode: "github", defaultBranch: "main" }, githubRepository: { fullName: "example/library" } };
    const actor = { username: "receiver", role: "owner" };
    let permissions = { push: true };
    let archived = false;
    let checks = 0;
    const project = createService({ env: {}, publishProjectChanged: async () => {}, projectContext: { ...context,
      listProjects: async () => ({ currentProject: current, projects: [current] }) },
      inspectConnectedRepository: async (name, input) => {
        assert.equal(name, "example/library");
        assert.equal(input.vibe64User, actor);
        checks++;
        return { permissions, archived };
      } });
    assert.deepEqual((await project.incomingRepository({ vibe64User: actor })).actions, { merge: "", discard: "" });
    permissions = { push: false };
    for (const action of ["merge", "discard"]) {
      await assert.rejects(project.incomingRepository({ vibe64User: actor, action }), { code: "vibe64_incoming_integration_forbidden" });
    }
    permissions = { push: true };
    archived = true;
    await assert.rejects(project.incomingRepository({ vibe64User: actor, action: "discard" }), { code: "vibe64_incoming_integration_forbidden" });
    archived = false;
    assert.equal((await project.saveRepositoryWorkflow({ vibe64User: actor, requirePullRequest: true })).ok, true);
    await assert.rejects(project.incomingRepository({ vibe64User: actor, action: "merge" }), { code: "vibe64_incoming_integration_forbidden" });
    assert.equal((await project.incomingRepository({ vibe64User: actor, action: "discard" })).actions.discard, "");
    assert.equal(checks, 6);
  });
});

test("connection reads do not create files; writes preserve concurrent edits and malformed source", async () => {
  await withTemporaryRoot(async (root) => {
    const file = path.join(root, "vibe64.connections.json");
    assert.deepEqual(await readConnectedProjects(root), { projects: [], exists: false, revision: "" });
    await assert.rejects(readFile(file), { code: "ENOENT" });
    const saved = await saveConnectedProjects(root, { projects: [library] }, "");
    assert.equal(saved.exists, true);
    await writeFile(file, JSON.stringify({ projects: [library, composition] }));
    const edited = await readFile(file, "utf8");
    await assert.rejects(saveConnectedProjects(root, { projects: [] }, saved.revision), { code: "vibe64_connections_changed" });
    assert.equal(await readFile(file, "utf8"), edited);
    await writeFile(file, "not valid JSON\n");
    await assert.rejects(saveConnectedProjects(root, { projects: [] }, ""), { code: "vibe64_connections_invalid" });
    assert.equal(await readFile(file, "utf8"), "not valid JSON\n");
  });
});

test("connection file cannot redirect reads or writes outside the project", async () => {
  await withTemporaryRoot(async (root) => {
    const outside = path.join(path.dirname(root), "outside.json");
    await writeFile(outside, '{"projects":[]}\n');
    await symlink(outside, path.join(root, "vibe64.connections.json"));
    await assert.rejects(readConnectedProjects(root), { code: "vibe64_connections_invalid" });
    await assert.rejects(saveConnectedProjects(root, { projects: [library] }, ""), { code: "vibe64_connections_invalid" });
    assert.equal(await readFile(outside, "utf8"), '{"projects":[]}\n');
  });
});

test("Stack supplies only explicit connection declarations", () => {
  const parsed = vibe64ConnectedProjectsInspection({ status: "ready", lines: [
    "- Connect `Example library` from `https://github.com/example/library` as `dependency`.",
    "- Connect `Editor` from `https://github.com/example/editor` as `composition`."
  ] });
  assert.deepEqual(parsed.projects, [library, composition]);
  assert.equal(parsed.contract, "vibe64.connected-projects.v1");
  assert.deepEqual(vibe64ConnectedProjectsInspection({ status: "ready", lines: ["- Nothing."] }).projects, []);
  assert.equal(vibe64ConnectedProjectsInspection({ status: "blocked" }).status, "blocked");
  assert.throws(() => vibe64ConnectedProjectsInspection({ status: "ready", lines: ["- arbitrary command"] }),
    { code: "VIBE64_CONNECTED_PROJECTS_INVALID" });
});

test("explicit initialization imports once; settings own the complete list including an empty list", async () => {
  await withTemporaryRoot(async (root) => {
    let imports = 0;
    const access = [];
    const project = service(root, {
      inspectConnections: async () => { imports += 1; return { status: "ready", projects: [library] }; },
      inspectConnectedRepository: async (name) => { access.push(name); return { permissions: { push: true } }; }
    });
    const initial = await project.readSettings();
    assert.equal(initial.ok, true);
    assert.equal(initial.connectedProjects.exists, false);
    assert.equal(imports, 0);
    const initialized = await project.initializeConnectedProjects();
    assert.equal(initialized.ok, true, JSON.stringify(initialized));
    assert.deepEqual(initialized.connectedProjects.projects, [library]);
    assert.deepEqual(access, ["example/library"]);
    const added = await project.saveConnectedProjects({ projects: [library, composition], revision: initialized.connectedProjects.revision });
    assert.equal(added.ok, true, JSON.stringify(added));
    assert.deepEqual((await project.readSettings()).connectedProjects.projects, [library, composition]);
    const empty = await project.saveConnectedProjects({ projects: [], revision: added.connectedProjects.revision });
    assert.equal(empty.ok, true);
    assert.deepEqual((await project.initializeConnectedProjects()).connectedProjects.projects, []);
    assert.equal(imports, 1);
    await writeFile(path.join(root, "vibe64.connections.json"), "broken");
    assert.equal((await project.initializeConnectedProjects()).ok, false);
    assert.equal(imports, 1);
    assert.equal((await project.readSettings()).connectedProjects.available, false);
  });
});

test("connection mutations require owner and receiving repository write access", async () => {
  await withTemporaryRoot(async (root) => {
    const project = service(root, { inspectConnectedRepository: async () => ({ permissions: { push: false } }) });
    const member = await project.saveConnectedProjects({ projects: [], revision: "", vibe64User: { role: "member" } });
    assert.equal(member.ok, false);
    const denied = await project.saveConnectedProjects({ projects: [library], revision: "" });
    assert.equal(denied.ok, false);
    assert.match(JSON.stringify(denied), /Write access/);
    assert.equal((await readConnectedProjects(root)).exists, false);
  });
});

test("workspace initialization imports only declared initial connections and preserves existing source", async () => {
  await withTemporaryRoot(async (root) => {
    const source = path.join(root, "sources", "sessions", "active", "setup", "source");
    await mkdir(source, { recursive: true });
    let initial = { status: "unconfigured", declared: false, projects: [] };
    let imports = 0;
    const project = service(root, { inspectConnections: async () => { imports++; return initial; } });
    const input = { sessionId: "setup", session: { sessionId: "setup", metadata: {
      source_kind: "session_clone", source_path: source, source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    } } };
    assert.equal((await project.initializeSessionConnections(input)).ok, true);
    assert.equal((await readConnectedProjects(source)).exists, false);
    initial = { status: "ready", declared: true, projects: [library] };
    assert.equal((await project.initializeSessionConnections(input)).ok, true);
    assert.deepEqual((await readConnectedProjects(source)).projects, [library]);
    const saved = await readConnectedProjects(source);
    await saveConnectedProjects(source, { projects: [] }, saved.revision);
    await project.initializeSessionConnections(input);
    assert.equal(imports, 2);
    assert.deepEqual((await readConnectedProjects(source)).projects, []);
    assert.equal((await readConnectedProjects(root)).exists, false, "Only the exact session source is initialized.");
    await writeFile(path.join(source, "vibe64.connections.json"), "invalid");
    await assert.rejects(project.initializeSessionConnections(input), { code: "vibe64_connections_invalid" });
    assert.equal(imports, 2);
  });
});

test("the real Genesis boundary transports initial connections without writing the connection file", async () => {
  await withTemporaryRoot(async (root) => {
    await promisify(execFile)("git", ["init", "--initial-branch=main", root]);
    await initializeGenesisProject({ projectRoot: root });
    await appendFile(path.join(root, "genesis/stack.md"), "\n## Connected projects\n\n- Connect `Example library` from `https://github.com/example/library` as `dependency`.\n");
    assert.deepEqual((await inspectVibe64ConnectedProjects({ projectRoot: root })).projects, [library]);
    assert.equal((await readConnectedProjects(root)).exists, false);
    const project = service(root);
    const initialized = await project.initializeConnectedProjects();
    assert.equal(initialized.ok, true, JSON.stringify(initialized));
    assert.deepEqual(initialized.connectedProjects.projects, [library]);
  });
});

test("hosted settings change only the exact session source, preserving the other session's list", async () => {
  await withTemporaryRoot(async (root) => {
    const projectContext = createStudioProjectContext({
      explicitManagedSourceRoot: path.join(root, "sources"), explicitProjectsRoot: path.join(root, "projects"),
      explicitSystemRoot: path.join(root, "system"), home: root
    });
    const project = createService({ env: {}, projectContext,
      inspectCollaboration: async () => ({ choices: {}, status: "defaulted" }),
      inspectConnectedRepository: async () => ({ permissions: { push: true } }) });
    await project.createProject({ name: "Connections" });
    const store = await project.createSessionStore();
    for (const id of ["first", "second"]) {
      const source = path.join(root, "sources", "sessions", "active", id, "source");
      await mkdir(source, { recursive: true });
      await store.createSession({ sessionId: id, runtimeKind: "genesis", metadata: {
        source_kind: "session_clone", source_path: source, source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      } });
    }
    const first = await project.saveConnectedProjects({ sessionId: "first", projects: [library], revision: "" });
    assert.equal(first.ok, true, JSON.stringify(first));
    const second = await project.saveConnectedProjects({ sessionId: "second", projects: [composition], revision: "" });
    assert.equal(second.ok, true, JSON.stringify(second));
    const selected = (await project.readSettings({ sessionId: "second" })).connectedProjects;
    assert.equal(selected.source.sessionId, "second");
    assert.deepEqual(selected.projects, [composition]);
    assert.deepEqual((await project.readSettings({ sessionId: "first" })).connectedProjects.projects, [library]);
    await project.saveConnectedProjects({ sessionId: "first", projects: [], revision: first.connectedProjects.revision });
    assert.deepEqual((await project.readSettings({ sessionId: "second" })).connectedProjects.projects, [composition]);
  });
});
