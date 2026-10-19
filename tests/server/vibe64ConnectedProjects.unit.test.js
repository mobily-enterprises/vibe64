import assert from "node:assert/strict";
import { readFile, writeFile, symlink, mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { normalizeConnectedProjects, readConnectedProjects, saveConnectedProjects } from "../../packages/vibe64-project/src/server/connectedProjects.js";
import { CONNECTED_PACKAGE_TYPE_VALUES } from "../../packages/vibe64-genesis/src/shared/connectedPackageTypes.js";
import { createService } from "../../packages/vibe64-project/src/server/service.js";
import { createStudioProjectContext } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";
import { SESSION_SOURCE_PATH_AUTHORITY_MANAGED } from "@local/vibe64-core/server/sessionSourcePath";

const library = { name: "Example library", repository: "https://github.com/example/library", relationship: "dependency" };
const composition = { name: "Editor", repository: "https://github.com/example/editor", relationship: "composition" };
const customLibrary = { ...library, type: "custom", script: "tooling/prepare-native-worker.mjs" };
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
  assert.deepEqual(normalizeConnectedProjects({ projects: [customLibrary, { ...composition, type: "npm" }] }),
    { projects: [customLibrary, { ...composition, type: "npm" }] },
    "package type is independent of dependency/composition relationship");
  const inheritedCustom = { ...library, script: customLibrary.script };
  assert.deepEqual(normalizeConnectedProjects({ projects: [inheritedCustom] }), { projects: [inheritedCustom] },
    "an omitted type can retain a script for a future consuming Stack custom default");
  for (const script of ["", " ", null, 42, "/tmp/prepare.sh", "C:/prepare.cmd", "C:prepare.cmd", "tooling\\prepare.cmd",
    "../prepare.sh", "tooling/../prepare.sh", "./prepare.sh", ".git/hooks/prepare", "tooling/.GIT/prepare",
    "tooling//prepare", "tooling/prepare/", "prepare\n.sh"]) {
    assert.throws(() => normalizeConnectedProjects({ projects: [{ ...customLibrary, script }] }), { code: "vibe64_connections_invalid" });
  }
  for (const type of ["", null, "gem", "script", "NPM", "Composer", "yarn", "python", 42]) {
    assert.throws(() => normalizeConnectedProjects({ projects: [{ ...library, type }] }), { code: "vibe64_connections_invalid" });
  }
  for (const type of CONNECTED_PACKAGE_TYPE_VALUES.filter(value => value !== "custom")) {
    assert.deepEqual(normalizeConnectedProjects({ projects: [{ ...library, type }] }), { projects: [{ ...library, type }] },
      `${type} is a declared ecosystem type`);
    assert.throws(() => normalizeConnectedProjects({ projects: [{ ...customLibrary, type }] }),
      { code: "vibe64_connections_invalid", message: new RegExp(`The ${type} connection cannot have a custom script`, "u") });
  }
  for (const repository of ["../library", "git@github.com:example/library", "https://token@github.com/example/library",
    "https://github.com/example/library?token=secret", "https://github.com/example/..", "https://github.com/example/library#main"]) {
    assert.throws(() => normalizeConnectedProjects({ projects: [{ ...library, repository }] }), { code: "vibe64_connections_invalid" });
  }
  for (const value of [
    { projects: [library, { ...library, name: "Another name", repository: "https://github.com/Example/Library.git" }] },
    { projects: [{ ...library, sourceRoot: "/private/source" }] },
    { projects: [{ ...library, type: "custom" }] },
    { projects: [{ ...customLibrary, type: "npm" }] },
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

test("a contribution source reads only the receiving integration branch", async () => {
  await withTemporaryRoot(async root => {
    const context = createStudioProjectContext({ explicitTargetRoot: root, explicitSystemRoot: path.join(root, "system"), home: root });
    const current = { slug: "receiving", path: root, repositoryMode: "github",
      repository: { mode: "github", defaultBranch: "release/main" }, githubRepository: { fullName: "Example/Library" } };
    const reads = [];
    let branch = { name: "release/main", commit: { sha: "a".repeat(40) } };
    const project = createService({ env: {}, projectContext: { ...context,
      listProjects: async () => ({ currentProject: current, projects: [current] }) },
      inspectConnectedRepository: async () => ({ permissions: { push: true } }),
      inspectConnectedBranch: async (name, branchName) => { reads.push([name, branchName]); return branch; } });
    assert.deepEqual(await project.connectedContributionSource({}),
      { repository: "example/library", integrationBranch: "release/main", baseCommit: "a".repeat(40) });
    assert.deepEqual(reads, [["Example/Library", "release/main"]]);
    branch = null;
    await assert.rejects(project.connectedContributionSource({}), { code: "vibe64_incoming_target_missing" });
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

test("oversized connection writes preserve the original readable source file", async () => {
  await withTemporaryRoot(async root => {
    const file = path.join(root, "vibe64.connections.json");
    const original = await saveConnectedProjects(root, { projects: [library] }, "");
    const bytes = await readFile(file);
    const projects = Array.from({ length: 64 }, (_, index) => ({
      ...customLibrary, name: `Library ${index}`, repository: `https://github.com/example/library-${index}`,
      script: `tooling/${"s".repeat(1000)}`
    }));
    assert.equal(normalizeConnectedProjects({ projects }).projects.length, 64, "each entry satisfies the field bounds");
    await assert.rejects(saveConnectedProjects(root, { projects }, original.revision), {
      code: "vibe64_connections_invalid", message: /exceeds 64 KiB/u
    });
    assert.deepEqual(await readFile(file), bytes);
    assert.deepEqual(await readConnectedProjects(root), original);
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


test("settings create and maintain the complete repository list, including an empty list", async () => {
  await withTemporaryRoot(async (root) => {
    const access = [];
    const project = service(root, {
      inspectConnectedRepository: async (name) => { access.push(name); return { permissions: { push: true } }; }
    });
    const initial = await project.readSettings();
    assert.equal(initial.ok, true);
    assert.equal(initial.connectedProjects.exists, false);
    assert.equal((await readConnectedProjects(root)).exists, false, "reading Settings never creates the connection file");
    const created = await project.saveConnectedProjects({ projects: [library], revision: "" });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.deepEqual(created.connectedProjects.projects, [library]);
    assert.equal(Object.hasOwn(JSON.parse(await readFile(path.join(root, "vibe64.connections.json"), "utf8")).projects[0], "type"),
      false, "inheriting the Stack default must not persist an npm default");
    assert.deepEqual(access, ["example/library"]);
    const typed = [customLibrary, { ...composition, type: "npm" }];
    const added = await project.saveConnectedProjects({ projects: typed, revision: created.connectedProjects.revision });
    assert.equal(added.ok, true, JSON.stringify(added));
    assert.deepEqual((await project.readSettings()).connectedProjects.projects, typed);
    const inherited = await project.saveConnectedProjects({ projects: [{ ...library, script: customLibrary.script }], revision: added.connectedProjects.revision });
    assert.equal(inherited.ok, true);
    assert.deepEqual((await readConnectedProjects(root)).projects, [{ ...library, script: customLibrary.script }]);
    const defaults = await project.saveConnectedProjects({ projects: [library, composition], revision: inherited.connectedProjects.revision });
    assert.equal(defaults.ok, true);
    assert.deepEqual((await readConnectedProjects(root)).projects, [library, composition], "omitting type removes an explicit override");
    const empty = await project.saveConnectedProjects({ projects: [], revision: defaults.connectedProjects.revision });
    assert.equal(empty.ok, true);
    assert.deepEqual((await project.readSettings()).connectedProjects.projects, []);
    await writeFile(path.join(root, "vibe64.connections.json"), "broken");
    assert.equal((await project.saveConnectedProjects({ projects: [], revision: empty.connectedProjects.revision })).ok, false);
    assert.equal((await project.readSettings()).connectedProjects.available, false);
    assert.equal(await readFile(path.join(root, "vibe64.connections.json"), "utf8"), "broken");
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
