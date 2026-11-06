import assert from "node:assert/strict";
import { readFile, writeFile, symlink, mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { normalizeConnectedProjects, readConnectedProjects, saveConnectedProjects } from "../../packages/vibe64-project/src/server/connectedProjects.js";
import { CONNECTED_PACKAGE_TYPE_VALUES } from "../../packages/vibe64-genesis/src/shared/connectedPackageTypes.js";
import { createService } from "../../packages/vibe64-project/src/server/service.js";
import { createStudioProjectContext } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { withTemporaryRoot, projectServiceCollaborators } from "./vibe64TestHelpers.js";
import { SESSION_SOURCE_PATH_AUTHORITY_MANAGED } from "@local/vibe64-core/server/sessionSourcePath";

const library = { name: "Example library", repository: "https://github.com/example/library", relationship: "dependency" };
const composition = { name: "Editor", repository: "https://github.com/example/editor", relationship: "composition" };
const customLibrary = { ...library, type: "custom", script: "tooling/prepare-native-worker.mjs" };
function service(root, options = {}) {
  return createService({ ...projectServiceCollaborators(), logger: console, env: {}, projectContext: createStudioProjectContext({
    env: process.env,
    explicitManagedSourceRoot: path.join(path.dirname(root), "managed-source"),
    explicitSystemRoot: path.join(path.dirname(root), "system"), explicitTargetRoot: root, home: path.dirname(root)
  }), inspectCollaboration: async () => ({ choices: {}, status: "defaulted" }),
  inspectConnectedRepository: async () => ({ permissions: { push: true } }), ...options });
}

test("connection identity rejects credentials, duplicate identities and runtime state", () => {
  assert.deepEqual(normalizeConnectedProjects({ repositories: [{ ...library, repository: "https://github.com/EXAMPLE/Library.git/" }, composition] }),
    { repositories: [library, composition] });
  assert.deepEqual(normalizeConnectedProjects({ repositories: [customLibrary, { ...composition, type: "npm" }] }),
    { repositories: [customLibrary, { ...composition, type: "npm" }] },
    "package type is independent of dependency/composition relationship");
  const inheritedCustom = { ...library, script: customLibrary.script };
  assert.deepEqual(normalizeConnectedProjects({ repositories: [inheritedCustom] }), { repositories: [inheritedCustom] },
    "an omitted type can retain a script for a future consuming Stack custom default");
  for (const script of ["", " ", null, 42, "/tmp/prepare.sh", "C:/prepare.cmd", "C:prepare.cmd", "tooling\\prepare.cmd",
    "../prepare.sh", "tooling/../prepare.sh", "./prepare.sh", ".git/hooks/prepare", "tooling/.GIT/prepare",
    "tooling//prepare", "tooling/prepare/", "prepare\n.sh"]) {
    assert.throws(() => normalizeConnectedProjects({ repositories: [{ ...customLibrary, script }] }), { code: "vibe64_connections_invalid" });
  }
  for (const type of ["", null, "gem", "script", "NPM", "Composer", "yarn", "python", 42]) {
    assert.throws(() => normalizeConnectedProjects({ repositories: [{ ...library, type }] }), { code: "vibe64_connections_invalid" });
  }
  for (const type of CONNECTED_PACKAGE_TYPE_VALUES.filter(value => value !== "custom")) {
    assert.deepEqual(normalizeConnectedProjects({ repositories: [{ ...library, type }] }), { repositories: [{ ...library, type }] },
      `${type} is a declared ecosystem type`);
    assert.throws(() => normalizeConnectedProjects({ repositories: [{ ...customLibrary, type }] }),
      { code: "vibe64_connections_invalid", message: new RegExp(`The ${type} connection cannot have a custom script`, "u") });
  }
  for (const repository of ["../library", "git@github.com:example/library", "https://token@github.com/example/library",
    "https://github.com/example/library?token=secret", "https://github.com/example/..", "https://github.com/example/library#main"]) {
    assert.throws(() => normalizeConnectedProjects({ repositories: [{ ...library, repository }] }), { code: "vibe64_connections_invalid" });
  }
  for (const value of [
    { repositories: [library, { ...library, name: "Another name", repository: "https://github.com/Example/Library.git" }] },
    { repositories: [{ ...library, sourceRoot: "/private/source" }] },
    { repositories: [{ ...library, type: "custom" }] },
    { repositories: [{ ...customLibrary, type: "npm" }] },
    { repositories: [{ ...library, relationship: "unknown" }] },
    { repositories: [], runtime: {} }
  ]) assert.throws(() => normalizeConnectedProjects(value), { code: "vibe64_connections_invalid" });
});

test("connection reads do not create files; writes preserve concurrent edits and malformed source", async () => {
  await withTemporaryRoot(async (root) => {
    const file = path.join(root, "vibe64.connections.json");
    assert.deepEqual(await readConnectedProjects(root), { repositories: [], exists: false, revision: "" });
    await assert.rejects(readFile(file), { code: "ENOENT" });
    const saved = await saveConnectedProjects(root, { repositories: [library] }, "");
    assert.equal(saved.exists, true);
    await writeFile(file, JSON.stringify({ repositories: [library, composition] }));
    const edited = await readFile(file, "utf8");
    await assert.rejects(saveConnectedProjects(root, { repositories: [] }, saved.revision), { code: "vibe64_connections_changed" });
    assert.equal(await readFile(file, "utf8"), edited);
    await writeFile(file, "not valid JSON\n");
    await assert.rejects(saveConnectedProjects(root, { repositories: [] }, ""), { code: "vibe64_connections_invalid" });
    assert.equal(await readFile(file, "utf8"), "not valid JSON\n");
  });
});

test("oversized connection writes preserve the original readable source file", async () => {
  await withTemporaryRoot(async root => {
    const file = path.join(root, "vibe64.connections.json");
    const original = await saveConnectedProjects(root, { repositories: [library] }, "");
    const bytes = await readFile(file);
    const projects = Array.from({ length: 64 }, (_, index) => ({
      ...customLibrary, name: `Library ${index}`, repository: `https://github.com/example/library-${index}`,
      script: `tooling/${"s".repeat(1000)}`
    }));
    assert.equal(normalizeConnectedProjects({ repositories: projects }).repositories.length, 64, "each entry satisfies the field bounds");
    await assert.rejects(saveConnectedProjects(root, { repositories: projects }, original.revision), {
      code: "vibe64_connections_invalid", message: /exceeds 64 KiB/u
    });
    assert.deepEqual(await readFile(file), bytes);
    assert.deepEqual(await readConnectedProjects(root), original);
  });
});

test("connection file cannot redirect reads or writes outside the project", async () => {
  await withTemporaryRoot(async (root) => {
    const outside = path.join(path.dirname(root), "outside.json");
    await writeFile(outside, '{"repositories":[]}\n');
    await symlink(outside, path.join(root, "vibe64.connections.json"));
    await assert.rejects(readConnectedProjects(root), { code: "vibe64_connections_invalid" });
    await assert.rejects(saveConnectedProjects(root, { repositories: [library] }, ""), { code: "vibe64_connections_invalid" });
    assert.equal(await readFile(outside, "utf8"), '{"repositories":[]}\n');
  });
});


test("settings create and maintain the complete repository list, including an empty list", async () => {
  await withTemporaryRoot(async (root) => {
    const access = [];
    const project = service(root, {
      inspectConnectedRepository: async (name) => { access.push(name); return { permissions: { push: true } }; }
    });
    const initial = await project.readSettings({});
    assert.equal(initial.ok, true);
    assert.equal(initial.connectedProjects.exists, false);
    assert.equal((await readConnectedProjects(root)).exists, false, "reading Settings never creates the connection file");
    const created = await project.saveConnectedProjects({ repositories: [library], revision: "" });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.deepEqual(created.connectedProjects.repositories, [library]);
    assert.equal(Object.hasOwn(JSON.parse(await readFile(path.join(root, "vibe64.connections.json"), "utf8")).repositories[0], "type"),
      false, "inheriting the Stack default must not persist an npm default");
    assert.deepEqual(access, ["example/library"]);
    const typed = [customLibrary, { ...composition, type: "npm" }];
    const added = await project.saveConnectedProjects({ repositories: typed, revision: created.connectedProjects.revision });
    assert.equal(added.ok, true, JSON.stringify(added));
    assert.deepEqual((await project.readSettings({})).connectedProjects.repositories, typed);
    const inherited = await project.saveConnectedProjects({ repositories: [{ ...library, script: customLibrary.script }], revision: added.connectedProjects.revision });
    assert.equal(inherited.ok, true);
    assert.deepEqual((await readConnectedProjects(root)).repositories, [{ ...library, script: customLibrary.script }]);
    const defaults = await project.saveConnectedProjects({ repositories: [library, composition], revision: inherited.connectedProjects.revision });
    assert.equal(defaults.ok, true);
    assert.deepEqual((await readConnectedProjects(root)).repositories, [library, composition], "omitting type removes an explicit override");
    const empty = await project.saveConnectedProjects({ repositories: [], revision: defaults.connectedProjects.revision });
    assert.equal(empty.ok, true);
    assert.deepEqual((await project.readSettings({})).connectedProjects.repositories, []);
    await writeFile(path.join(root, "vibe64.connections.json"), "broken");
    assert.equal((await project.saveConnectedProjects({ repositories: [], revision: empty.connectedProjects.revision })).ok, false);
    assert.equal((await project.readSettings({})).connectedProjects.available, false);
    assert.equal(await readFile(path.join(root, "vibe64.connections.json"), "utf8"), "broken");
  });
});

test("connection mutations require owner and receiving repository write access", async () => {
  await withTemporaryRoot(async (root) => {
    const project = service(root, { inspectConnectedRepository: async () => ({ permissions: { push: false } }) });
    const member = await project.saveConnectedProjects({ repositories: [], revision: "", vibe64User: { role: "member" } });
    assert.equal(member.ok, false);
    const denied = await project.saveConnectedProjects({ repositories: [library], revision: "" });
    assert.equal(denied.ok, false);
    assert.match(JSON.stringify(denied), /Write access/);
    assert.equal((await readConnectedProjects(root)).exists, false);
  });
});



test("catalogue settings change only the exact session source, preserving the other session's list", async () => {
  await withTemporaryRoot(async (root) => {
    const projectContext = createStudioProjectContext({
      env: process.env,
      explicitManagedSourceRoot: path.join(root, "sources"), explicitProjectsRoot: path.join(root, "repositories"),
      explicitSystemRoot: path.join(root, "system"), home: root
    });
    const project = createService({ ...projectServiceCollaborators(), logger: console, env: {}, projectContext,
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
    const first = await project.saveConnectedProjects({ sessionId: "first", repositories: [library], revision: "" });
    assert.equal(first.ok, true, JSON.stringify(first));
    const second = await project.saveConnectedProjects({ sessionId: "second", repositories: [composition], revision: "" });
    assert.equal(second.ok, true, JSON.stringify(second));
    const selected = (await project.readSettings({ sessionId: "second" })).connectedProjects;
    assert.equal(selected.source.sessionId, "second");
    assert.deepEqual(selected.repositories, [composition]);
    assert.deepEqual((await project.readSettings({ sessionId: "first" })).connectedProjects.repositories, [library]);
    await project.saveConnectedProjects({ sessionId: "first", repositories: [], revision: first.connectedProjects.revision });
    assert.deepEqual((await project.readSettings({ sessionId: "second" })).connectedProjects.repositories, [composition]);
  });
});
