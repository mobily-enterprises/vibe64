import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { inspectConnectedDevelopmentInputs, inspectConnectedWorkspaceSetup, materializeConnectedDevelopmentInputs } from "../../packages/vibe64-project/src/server/connectedDevelopment.js";
import { materializeProjectEnvironmentFiles, projectEnvironmentFilesAreCurrent } from "../../packages/vibe64-project/src/server/projectEnvironmentFiles.js";
import { CONNECTED_PACKAGE_TYPE_VALUES } from "../../packages/vibe64-genesis/src/shared/connectedPackageTypes.js";
import { sourceMetadata, sourcePath, withTemporaryRoot } from "./vibe64TestHelpers.js";

const exec = promisify(execFile);

async function fixture(target, name = "task") {
  const root = sourcePath(target, name);
  const id = randomUUID();
  const receiverRoot = sourcePath(path.join(target, "library"), id);
  await mkdir(root, { recursive: true });
  await mkdir(receiverRoot, { recursive: true });
  await exec("git", ["init", "--initial-branch=main", root]);
  const connection = { name: "Library", repository: "https://github.com/example/library", relationship: "dependency" };
  await writeFile(path.join(root, "vibe64.connections.json"), JSON.stringify({ projects: [connection] }));
  const contribution = { schemaVersion: 1, id, repository: "example/library", integrationBranch: "main", baseCommit: "a".repeat(40) };
  const session = { sessionId: name, metadata: { ...sourceMetadata(target, name), connected_sources: JSON.stringify({
    schemaVersion: 1, sources: [{ projectSlug: "library", contribution }]
  }) } };
  const receiving = { sessionId: id, sourceReady: true, metadata: {
    ...sourceMetadata(path.join(target, "library"), id), connected_contribution: JSON.stringify(contribution)
  } };
  return { root, receiverRoot, session,
    input: { session, projects: [{ ...connection, projectSlug: "library", session: receiving }],
      inspection: { status: "ready", defaultPackageType: "npm", recipeHash: "test-recipe", sourcesFile: ".development/connected.json" } }
  };
}

test("connected source inputs are task-specific, ignored, repeatable and usable without changing release files", async (t) => {
  const previousUmask = process.umask(0o007);
  t.after(() => process.umask(previousUmask));
  await withTemporaryRoot(async target => {
    const first = await fixture(target, "task-a");
    const second = await fixture(target, "task-b");
    const environmentInput = { sourceRoot: first.root, files: [{ format: "dotenv", path: ".env" }], environment: { TEST: "value" } };
    await materializeProjectEnvironmentFiles(environmentInput);
    await materializeConnectedDevelopmentInputs(first.input);
    await materializeConnectedDevelopmentInputs(second.input);
    const mapPath = path.join(first.root, first.input.inspection.sourcesFile);
    const before = await lstat(mapPath, { bigint: true });
    const mapped = JSON.parse(await readFile(mapPath, "utf8"));
    assert.equal(mapped.contract, "vibe64.connected-sources.v1");
    assert.equal(mapped.projects[0].sourceRoot, first.receiverRoot);
    assert.equal(mapped.projects[0].contributionId, first.input.projects[0].session.sessionId);
    assert.equal(mapped.projects[0].relationship, "dependency");
    assert.equal(mapped.projects[0].type, "npm");
    assert.deepEqual(await materializeConnectedDevelopmentInputs(first.input), {
      sourcesFile: ".development/connected.json", recipeHash: "test-recipe", status: "inputs-prepared"
    });
    assert.equal((await lstat(mapPath, { bigint: true })).ctimeNs, before.ctimeNs);
    assert.equal(Number(before.mode) & 0o777, 0o660);
    await materializeProjectEnvironmentFiles(environmentInput);
    assert.equal(await projectEnvironmentFilesAreCurrent(environmentInput), true);
    const ignored = [".env", ".development/connected.json", ".development/.connected.json.123.test.tmp"];
    const checked = await exec("git", ["check-ignore", "--", ...ignored], { cwd: first.root });
    assert.deepEqual(checked.stdout.trim().split("\n"), ignored);
    const visible = await exec("git", ["ls-files", "--others", "--exclude-standard"], { cwd: first.root });
    assert.equal(visible.stdout.trim(), "vibe64.connections.json");
    assert.deepEqual(JSON.parse(await readFile(path.join(first.root, "vibe64.connections.json"), "utf8")), {
      projects: [{ name: "Library", repository: "https://github.com/example/library", relationship: "dependency" }]
    });

    // A project-owned consumer can use the selected source directly. This is an
    // input-file proof, not yet production Stack-runner integration.
    await writeFile(path.join(first.receiverRoot, "value.txt"), "first revision");
    await writeFile(path.join(second.receiverRoot, "value.txt"), "other task");
    const consumer = "const fs=require('fs'),p=require('path');const m=JSON.parse(fs.readFileSync(process.argv[1]));process.stdout.write(fs.readFileSync(p.join(m.projects[0].sourceRoot,'value.txt')));";
    const consume = source => exec(process.execPath, ["-e", consumer, path.join(source.root, source.input.inspection.sourcesFile)]);
    assert.equal((await consume(first)).stdout, "first revision");
    await writeFile(path.join(first.receiverRoot, "value.txt"), "changed source");
    assert.equal((await consume(first)).stdout, "changed source");
    assert.equal((await consume(second)).stdout, "other task");
  });
});

test("connected source projection refuses tracked, authored, linked and foreign-session destinations", async () => {
  await withTemporaryRoot(async target => {
    for (const kind of ["tracked", "authored", "file-link", "parent-link", "foreign-session"]) {
      const fixtureData = await fixture(target, kind);
      const { root, input } = fixtureData;
      const destination = path.join(root, input.inspection.sourcesFile);
      const external = path.join(target, `outside-${kind}`);
      await mkdir(external);
      await writeFile(path.join(external, "connected.json"), "untouched outside");
      if (kind === "parent-link") {
        await symlink(external, path.dirname(destination));
      } else {
        await mkdir(path.dirname(destination));
        if (kind === "file-link") await symlink(path.join(external, "connected.json"), destination);
        else await writeFile(destination, kind === "foreign-session"
          ? JSON.stringify({ contract: "vibe64.connected-sources.v1", sessionId: "someone-else" }) : "authored file");
      }
      if (kind === "tracked") await exec("git", ["add", "--", input.inspection.sourcesFile], { cwd: root });
      const before = await readFile(destination, "utf8");
      await assert.rejects(materializeConnectedDevelopmentInputs(input), error =>
        ["vibe64_connected_source_file_tracked", "vibe64_connected_source_file_symlink", "vibe64_connected_source_file_owned"].includes(error.code));
      assert.equal(await readFile(destination, "utf8"), before);
      assert.equal(await readFile(path.join(external, "connected.json"), "utf8"), "untouched outside");
    }
  });
});

test("source map resolves the Stack package default and preserves per-repository overrides", async () => {
  await withTemporaryRoot(async target => {
    const { root, input } = await fixture(target);
    const connectionFile = path.join(root, "vibe64.connections.json");
    const configuration = JSON.parse(await readFile(connectionFile, "utf8"));
    const noDefault = { ...input, inspection: { ...input.inspection, defaultPackageType: "" } };
    await assert.rejects(materializeConnectedDevelopmentInputs(noDefault),
      { code: "vibe64_connected_package_type_required" });
    await materializeConnectedDevelopmentInputs(input);
    const mapFile = path.join(root, input.inspection.sourcesFile);
    assert.equal(JSON.parse(await readFile(mapFile, "utf8")).projects[0].type, "npm");
    configuration.projects[0].type = "custom";
    configuration.projects[0].script = "tooling/custom.mjs";
    await mkdir(path.join(root, "tooling"));
    await writeFile(path.join(root, "tooling/custom.mjs"), "// Custom connection fixture.\n");
    await writeFile(connectionFile, JSON.stringify(configuration));
    await assert.rejects(inspectConnectedDevelopmentInputs(input),
      { code: "vibe64_connected_inputs_required" });
    await materializeConnectedDevelopmentInputs(noDefault);
    assert.equal(JSON.parse(await readFile(mapFile, "utf8")).projects[0].type, "custom");
    assert.deepEqual(JSON.parse(await readFile(connectionFile, "utf8")), configuration);
    const inspect = customRunner => inspectConnectedWorkspaceSetup({ session: input.session,
      setup: { status: "ready", recipeHash: "ordinary", diagnostics: [], steps: [] },
      inspection: { ...noDefault.inspection, steps: [], customRunner } });
    const missingRunner = await inspect(null);
    assert.equal(missingRunner.status, "blocked");
    assert.equal(missingRunner.diagnostics.at(-1).code, "vibe64_connected_custom_runner_required");
    const runner = { label: "Custom source", argv: ["node"], runtimeRequirements: ["nodejs"], workdir: "." };
    const ready = await inspect(runner);
    assert.equal(ready.status, "ready");
    assert.deepEqual(ready.steps.map(step => step.phase), ["prepare", "verify"]);
    assert.deepEqual(ready.steps[0].argv, ["node", path.join(root, "tooling/custom.mjs"),
      "--phase", "prepare", "--source-root", input.projects[0].session.metadata.source_path,
      "--project-root", root, "--sources-file", mapFile, "--repository", configuration.projects[0].repository]);
    const external = path.join(target, "external-handler.mjs");
    await writeFile(external, "throw new Error('must not execute');\n");
    await symlink(external, path.join(root, "tooling/linked.mjs"));
    configuration.projects[0].script = "tooling/linked.mjs";
    await writeFile(connectionFile, JSON.stringify(configuration));
    await materializeConnectedDevelopmentInputs(noDefault);
    assert.equal((await inspect(runner)).status, "blocked", "a script cannot escape the consuming project through a link");
  });
});

test("connected input inspection never creates or repairs a missing or changed source map", async () => {
  await withTemporaryRoot(async target => {
    const { root, input } = await fixture(target);
    const destination = path.join(root, input.inspection.sourcesFile);
    const excludes = path.join(root, ".git/info/exclude");
    const originalExcludes = await readFile(excludes, "utf8");
    await assert.rejects(inspectConnectedDevelopmentInputs(input), { code: "vibe64_connected_inputs_required" });
    await assert.rejects(lstat(destination), { code: "ENOENT" });
    assert.equal(await readFile(excludes, "utf8"), originalExcludes);

    await materializeConnectedDevelopmentInputs(input);
    const before = await lstat(destination, { bigint: true });
    assert.equal((await inspectConnectedDevelopmentInputs(input)).status, "inputs-prepared");
    assert.equal((await lstat(destination, { bigint: true })).ctimeNs, before.ctimeNs);
    const mapped = JSON.parse(await readFile(destination, "utf8"));
    mapped.projects[0].sourceRoot = root;
    const changed = JSON.stringify(mapped);
    await writeFile(destination, changed);
    await assert.rejects(inspectConnectedDevelopmentInputs(input), { code: "vibe64_connected_inputs_required" });
    assert.equal(await readFile(destination, "utf8"), changed, "inspection never accepts or silently repairs a changed path");
  });
});

test("connected inputs require matching bindings and a declared recipe; removal preserves receiving work", async () => {
  await withTemporaryRoot(async target => {
    const { root, receiverRoot, input } = await fixture(target);
    await assert.rejects(materializeConnectedDevelopmentInputs({ ...input, inspection: { status: "unconfigured" } }),
      { code: "vibe64_connected_development_required" });
    const original = input.projects[0].session.metadata.connected_contribution;
    input.projects[0].session.metadata.connected_contribution = JSON.stringify({ ...JSON.parse(original), baseCommit: "b".repeat(40) });
    await assert.rejects(materializeConnectedDevelopmentInputs(input), { code: "vibe64_connected_sources_changed" });
    input.projects[0].session.metadata.connected_contribution = original;
    await materializeConnectedDevelopmentInputs(input);
    const destination = path.join(root, input.inspection.sourcesFile);
    const before = await readFile(destination, "utf8");
    await assert.rejects(materializeConnectedDevelopmentInputs({ ...input, runCommand: async () => ({ ok: false }) }),
      { code: "vibe64_connected_source_file_git_unavailable" });
    assert.equal(await readFile(destination, "utf8"), before);
    await writeFile(path.join(receiverRoot, "unfinished.txt"), "keep my work");
    await writeFile(path.join(root, "vibe64.connections.json"), JSON.stringify({ projects: [] }));
    await materializeConnectedDevelopmentInputs({ ...input, projects: [] });
    assert.deepEqual(JSON.parse(await readFile(destination, "utf8")).projects, []);
    assert.equal(await readFile(path.join(receiverRoot, "unfinished.txt"), "utf8"), "keep my work");
    assert.equal(JSON.parse(input.session.metadata.connected_sources).sources.length, 1);
  });
});

test("workspace readiness includes both recipes and the exact task source selection", async () => {
  await withTemporaryRoot(async target => {
    const first = await fixture(target, "ready-a");
    const second = await fixture(target, "ready-b");
    const setup = { status: "ready", recipeHash: "ordinary-setup", diagnostics: [],
      steps: [{ label: "Ordinary setup", argv: ["npm", "ci"], runtimeRequirements: ["nodejs"], workdir: "." }] };
    const inspect = (task, changes = {}) => inspectConnectedWorkspaceSetup({ session: task.session, setup,
      inspection: { ...task.input.inspection, steps: [
        { label: "Verify connected source", phase: "verify", argv: ["node", "verify.mjs"], runtimeRequirements: ["nodejs"], workdir: "." }
      ], ...changes } });
    assert.equal((await inspect(first)).status, "blocked", "an unprepared map cannot reuse ordinary setup readiness");
    await materializeConnectedDevelopmentInputs(first.input);
    await materializeConnectedDevelopmentInputs(second.input);
    const ready = await inspect(first);
    assert.equal(ready.status, "ready");
    assert.deepEqual(ready.steps.map(step => step.label), ["Ordinary setup", "Verify connected source"]);
    assert.deepEqual(ready.runtimeRequirements, ["nodejs"]);
    assert.notEqual(ready.recipeHash, setup.recipeHash);
    assert.notEqual(ready.recipeHash, (await inspect(second)).recipeHash, "another task's successful preparation is not interchangeable");
    assert.notEqual(ready.recipeHash, (await inspect(first, { recipeHash: "changed-treatment" })).recipeHash);
    const inputs = await inspectConnectedDevelopmentInputs(first.input);
    assert.equal(inputs.inputsHash, ready.connectedDevelopment.inputsHash);
    assert.deepEqual(inputs.sourceRoots, [first.receiverRoot]);

    const changed = { ...first.input.projects[0], name: "Renamed library" };
    await writeFile(path.join(first.root, "vibe64.connections.json"), JSON.stringify({ projects: [
      { name: changed.name, repository: changed.repository, relationship: changed.relationship }
    ] }));
    assert.equal((await inspect(first)).status, "blocked", "Settings changes invalidate the old projection");
    await materializeConnectedDevelopmentInputs({ ...first.input, projects: [changed] });
    assert.notEqual((await inspect(first)).recipeHash, ready.recipeHash);
  });
});

test("every non-custom package type is recorded in the map and requires the project's own Verify command", async () => {
  await withTemporaryRoot(async target => {
    const { root, input } = await fixture(target);
    const mapFile = path.join(root, input.inspection.sourcesFile);
    const setup = { status: "ready", recipeHash: "ordinary", diagnostics: [], steps: [] };
    const verify = { label: "Verify connected source", phase: "verify", argv: ["sh", "verify.sh"],
      runtimeRequirements: ["shell"], workdir: "." };
    for (const type of CONNECTED_PACKAGE_TYPE_VALUES.filter(value => value !== "custom")) {
      const typed = { ...input, inspection: { ...input.inspection, defaultPackageType: type } };
      await materializeConnectedDevelopmentInputs(typed);
      assert.equal(JSON.parse(await readFile(mapFile, "utf8")).projects[0].type, type);
      const unverified = await inspectConnectedWorkspaceSetup({ session: input.session, setup,
        inspection: { ...typed.inspection, steps: [], customRunner: null } });
      assert.equal(unverified.status, "blocked");
      assert.deepEqual(unverified.diagnostics.at(-1), { code: "vibe64_connected_verification_required",
        message: `Declare a Verify command for the connected ${type} packages.` });
      const verified = await inspectConnectedWorkspaceSetup({ session: input.session, setup,
        inspection: { ...typed.inspection, steps: [verify], customRunner: null } });
      assert.equal(verified.status, "ready", `${type} relies only on the declared Verify step`);
      assert.deepEqual(verified.steps, [verify], `Vibe64 adds no ${type} package-manager command`);
    }
    const connectionFile = path.join(root, "vibe64.connections.json");
    const configuration = JSON.parse(await readFile(connectionFile, "utf8"));
    configuration.projects[0].type = "pip";
    configuration.projects[0].script = "tooling/prepare.py";
    await writeFile(connectionFile, JSON.stringify(configuration));
    await assert.rejects(materializeConnectedDevelopmentInputs(input), { code: "vibe64_connections_invalid" });
  });
});
