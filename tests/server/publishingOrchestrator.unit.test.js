// The local release flow with real project state (targets, history,
// confirmations) and stand-ins for Git, builds and destinations: one confirmed
// plan builds each package once and fans out to every target, a failing target
// leaves the release partial, confirming the same plan again finishes only what
// is left, and history records everything the person confirmed.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { vibe64PackagingInspection } from "../../packages/vibe64-genesis/src/server/packaging.js";
import { createConfirmationService } from "../../packages/vibe64-publishing/src/server/confirmationService.js";
import { changelogSection, createReleaseOrchestrator } from "../../packages/vibe64-publishing/src/server/releaseOrchestrator.js";
import { createBuilderMap } from "../../packages/vibe64-publishing/src/server/state/builderMap.js";
import { createReleaseHistoryStore } from "../../packages/vibe64-publishing/src/server/state/releaseHistoryStore.js";
import { createTargetsStore } from "../../packages/vibe64-publishing/src/server/state/targetsStore.js";

const COMMIT = "c".repeat(40);
const PERSON = { kind: "person", id: "ada" };
const PACKAGING = vibe64PackagingInspection({
  environment: { stackHash: "sha256:s", environmentDefaults: [] },
  section: { status: "ready", stackHash: "sha256:s", lines: [
    "### Package `sdk`: Notes SDK",
    "- Packer: `npm`",
    "- Version from: `package.json`",
    "### Package `py`: Notes for Python",
    "- Packer: `python-dist`",
    "- Build `Build`: `python` `-m` `build`",
    "- Output: `dist`",
    "- Version from: `pyproject.toml`"
  ] }
});

async function fixture(t, { failing = new Set(), verification = "passed" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-publishing-orchestrator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtimeRoot = path.join(root, "publishing");
  const calls = { builds: [], publishes: [], tags: [], pushes: [], dryRuns: [] };
  const baseline = {
    supported: true, mode: "local_source", repositoryRoot: path.join(root, "project"), branch: "main",
    baselineRef: "refs/heads/main", upstreamRef: "refs/remotes/origin/main", commit: COMMIT, saved: true, pushed: true,
    remote: { name: "origin", url: "https://github.com/ada/notes.git", githubRepository: "ada/notes" }, message: ""
  };
  const repository = {
    baseline: async () => baseline,
    readRelease: async () => ({ packaging: PACKAGING, versions: { sdk: "1.2.0", py: "1.2.0" } }),
    existingTags: async () => [],
    subjectsSince: async () => ["Add offline drafts", "Release 1.1.0"],
    withCheckout: async (_root, _commit, operation) => operation(root),
    fileAtCommit: async () => "# Changelog\n\n## 1.2.0 - 2026-10-23\n\n- Offline drafts.\n\n## 1.1.0 - 2026-10-01\n\n- First.\n",
    createTags: async (_facts, { tags }) => { calls.tags.push(...tags); return { created: tags, existing: [] }; },
    pushTags: async (_facts, tags) => { calls.pushes.push(...tags); return { pushed: tags }; }
  };
  const credentials = {
    facts: async ({ targets }) => Object.fromEntries(targets.map((target) => [target.id, { ok: true, verified: true }])),
    dryRun: async ({ target }) => { calls.dryRuns.push(target.id); return { alreadyPublished: false, files: [{ path: "index.js", size: 10 }], destination: target.destination }; },
    publish: async ({ target, version, artifacts, previous }) => {
      calls.publishes.push({ id: target.id, version, digest: artifacts.digest, previous: previous?.status || null, tag: target.tag, notes: target.notes });
      if (failing.has(target.id)) throw Object.assign(new Error(`${target.id} registry said no`), { code: "VIBE64_PUBLISH_UPLOAD_FAILED" });
      return { target: target.id, version, checksum: `sha256:${target.id}`, status: "proven", alreadyPublished: false, proof: { integrity: `sha512-${target.id}`, token: "never-shown" } };
    },
    safeReport: (report) => ({ alreadyPublished: report.alreadyPublished, files: report.files }),
    safeOutcome: ({ status, version, checksum, alreadyPublished, proof }) => ({ status, version, checksum, alreadyPublished, proof: { integrity: proof.integrity } })
  };
  const packaging = {
    androidTemplate: { id: "vibe64.capacitor-android.v1", capacitor: "8.5.3", buildTools: "35.0.0" },
    gatherAndroidFacts: async () => null,
    buildPackage: async ({ packageId, version, planHash }) => {
      calls.builds.push(packageId);
      return { artifacts: { digest: `sha256:${packageId}-${version}`, manifest: { planHash, files: [{ path: `${packageId}-${version}.tgz`, size: 100, sha256: `sha256:${packageId}` }] }, reused: false } };
    }
  };
  const targets = createTargetsStore({ runtimeRoot });
  const history = createReleaseHistoryStore({ runtimeRoot });
  const confirmations = createConfirmationService({ runtimeRoot });
  const orchestrator = createReleaseOrchestrator({
    projectRuntimeRoot: root,
    resultStore: path.join(runtimeRoot, "results"),
    targets,
    history,
    builders: createBuilderMap({ runtimeRoot }),
    confirmations,
    keys: { status: async () => ({ exists: true, unlocked: true, entries: [], recoveryKit: null }) },
    toolchains: { status: async () => ({ java: { ready: false } }), androidToolchains: async () => null, registryTools: async () => ({}) },
    repository,
    verification: { status: async (commit) => ({ commit, status: verification }) },
    credentials,
    sourceWriter: { prepareAndWrite: async ({ entry, version }) => ({ package: entry.id, previousVersion: "1.1.0", version, files: [{ path: "package.json" }, { path: "CHANGELOG.md" }] }) },
    packaging
  });
  await targets.add({ destination: "npm", package: "sdk", channel: "latest", account: "npm-main", settings: { registry: "http://127.0.0.1:4873/" } });
  await targets.add({ destination: "github-releases", package: "sdk", channel: "latest", account: "github-main", settings: { repository: "ada/notes" } });
  await targets.add({ destination: "pypi", package: "py", account: "pypi-main", settings: { repository: "http://127.0.0.1:8080/", index: "http://127.0.0.1:8080/simple/" } });
  return { orchestrator, history, targets, confirmations, calls, runtimeRoot };
}

async function confirm(orchestrator, plan, actor = PERSON) {
  const { token } = await orchestrator.openConfirmation({ planHash: plan.planHash, actor });
  const started = await orchestrator.confirmRelease({ planHash: plan.planHash, token, actor });
  await orchestrator.settle(started.releaseId);
  return started;
}

test("one confirmed plan builds each package once, fans out to every target and records the release", async (t) => {
  const { orchestrator, calls, history, runtimeRoot } = await fixture(t);
  const suggestion = await orchestrator.suggestRelease();
  assert.deepEqual(suggestion.packages.find(({ id }) => id === "sdk").suggestions.map(({ version }) => version), ["1.2.1", "1.3.0", "2.0.0"]);
  assert.equal(suggestion.notes, "- Add offline drafts");

  const plan = await orchestrator.plan();
  assert.equal(plan.preflight.ready, true, JSON.stringify(plan.preflight.checks.filter(({ ok }) => !ok)));
  assert.deepEqual(plan.tags, ["py@1.2.0", "sdk@1.2.0"]);
  assert.match(plan.planId, /^[0-9a-f]{4}$/u);

  const started = await confirm(orchestrator, plan);
  assert.equal(started.resumed, false);
  assert.deepEqual(calls.builds.sort(), ["py", "sdk"], "each package builds once even with two targets");
  assert.deepEqual(calls.tags.sort(), ["py@1.2.0", "sdk@1.2.0"]);
  assert.deepEqual(calls.pushes.sort(), ["py@1.2.0", "sdk@1.2.0"]);
  assert.deepEqual(calls.publishes.map(({ id }) => id).sort(), ["py-pypi", "sdk-github-releases", "sdk-npm"]);
  const github = calls.publishes.find(({ id }) => id === "sdk-github-releases");
  assert.equal(github.tag, "sdk@1.2.0");
  assert.equal(github.notes, "- Offline drafts.", "release notes come from the saved CHANGELOG entry");

  const record = await orchestrator.readRelease(started.releaseId);
  assert.equal(record.status, "succeeded");
  assert.equal(record.planHash, plan.planHash);
  assert.equal(record.confirmedBy, "ada");
  assert.deepEqual(record.versions, { py: "1.2.0", sdk: "1.2.0" });
  assert.equal(record.targets["sdk-npm"].proof.integrity, "sha512-sdk-npm");
  assert.ok(record.steps.every(({ status }) => status === "done"), JSON.stringify(record.steps));
  const stored = JSON.parse(await readFile(path.join(history.directory, `${started.releaseId}.json`), "utf8"));
  assert.equal(stored.toolchain.node, process.versions.node);
  assert.deepEqual(Object.keys(stored.packages).sort(), ["py", "sdk"]);
  assert.doesNotMatch(JSON.stringify(stored), /never-shown/u, "history keeps only the safe proof");

  const state = await orchestrator.readState();
  assert.equal(state.targets.find(({ id }) => id === "sdk-npm").latest.version, "1.2.0");
  assert.equal(state.releases[0].id, started.releaseId);
  assert.ok(runtimeRoot);
});

test("a failing target leaves the release partial and the same confirmed plan resumes only what is left", async (t) => {
  const failing = new Set(["py-pypi"]);
  const { orchestrator, calls } = await fixture(t, { failing });
  const plan = await orchestrator.plan();
  const first = await confirm(orchestrator, plan);
  const partial = await orchestrator.readRelease(first.releaseId);
  assert.equal(partial.status, "partial");
  assert.equal(partial.targets["py-pypi"].status, "failed");
  assert.match(partial.targets["py-pypi"].error.message, /registry said no/u);
  assert.equal(partial.targets["sdk-npm"].status, "proven");
  assert.equal((await orchestrator.readLogs(first.releaseId)).log.some(({ level, message }) => level === "error" && /py-pypi/u.test(message)), true);

  failing.clear();
  calls.publishes.length = 0;
  const again = await confirm(orchestrator, plan);
  assert.equal(again.resumed, true);
  assert.equal(again.releaseId, first.releaseId, "the same release record is finished");
  const resumed = await orchestrator.readRelease(first.releaseId);
  assert.equal(resumed.status, "succeeded");
  assert.deepEqual(
    calls.publishes.map(({ id, previous }) => [id, previous]).sort(),
    [["py-pypi", "failed"], ["sdk-github-releases", "proven"], ["sdk-npm", "proven"]],
    "proven targets are handed their proof so they finish at once"
  );
  assert.equal((await orchestrator.listHistory()).length, 1);
});

test("an assistant can only ask; the person confirms the exact current plan", async (t) => {
  const { orchestrator, calls, targets, confirmations } = await fixture(t);
  const plan = await orchestrator.plan();
  const asked = await orchestrator.requestPublish({ planHash: plan.planHash });
  assert.equal(asked.pendingConfirmation.planHash, plan.planHash);
  assert.equal((await orchestrator.readState()).pendingConfirmation.requestedBy, "assistant");
  assert.equal(calls.publishes.length, 0, "asking publishes nothing");
  await assert.rejects(orchestrator.openConfirmation({ planHash: plan.planHash, actor: { kind: "assistant", id: "assistant" } }), { code: "VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON" });

  const { token } = await orchestrator.openConfirmation({ planHash: plan.planHash, actor: PERSON });
  await assert.rejects(orchestrator.confirmRelease({ planHash: plan.planHash, token, actor: { kind: "assistant", id: "assistant" } }), { code: "VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON" });
  await targets.remove("py-pypi");
  await assert.rejects(orchestrator.confirmRelease({ planHash: plan.planHash, token, actor: PERSON }), { code: "VIBE64_PUBLISH_CONFIRMATION_PLAN_CHANGED" });
  assert.equal(calls.publishes.length, 0);
  assert.equal((await confirmations.pendingRequest()).planHash, plan.planHash, "the request waits until the person acts");
});

test("preflight blocks a release whose checks did not pass, and a dry run publishes nothing", async (t) => {
  const blocked = await fixture(t, { verification: "failed" });
  const plan = await blocked.orchestrator.plan();
  assert.equal(plan.preflight.blocked, true);
  assert.equal(plan.preflight.checks.find(({ id }) => id === "verification-passed").ok, false);
  await assert.rejects(blocked.orchestrator.openConfirmation({ planHash: plan.planHash, actor: PERSON }), { code: "VIBE64_PUBLISH_PREFLIGHT_BLOCKED" });

  const { orchestrator, calls } = await fixture(t);
  const ready = await orchestrator.plan({ targetIds: ["sdk-npm"] });
  assert.deepEqual(ready.targets.map(({ id }) => id), ["sdk-npm"]);
  const dry = await orchestrator.dryRun({ planHash: ready.planHash, targetIds: ["sdk-npm"] });
  await orchestrator.settle(dry.releaseId);
  const record = await orchestrator.readRelease(dry.releaseId);
  assert.equal(record.kind, "dry-run");
  assert.equal(record.status, "succeeded");
  assert.deepEqual(calls.dryRuns, ["sdk-npm"]);
  assert.deepEqual(calls.tags, [], "a dry run never tags");
  assert.deepEqual(calls.publishes, [], "a dry run never publishes");
});

test("prepare writes the version change into the session; release notes come from the changelog", async (t) => {
  const { orchestrator } = await fixture(t);
  const prepared = await orchestrator.prepareRelease({ sessionId: "s1", versions: { sdk: "1.3.0" }, notes: "- Faster sync." });
  assert.deepEqual(prepared.packages, [{ id: "sdk", previousVersion: "1.1.0", version: "1.3.0", files: ["package.json", "CHANGELOG.md"] }]);
  await assert.rejects(orchestrator.prepareRelease({ sessionId: "s1", versions: { sdk: "next" }, notes: "x" }), { code: "vibe64_publishing_prepare_invalid" });
  assert.equal(changelogSection("## 2.0.0 - d\n\n- B\n\n## 1.0.0 - d\n\n- A\n", "1.0.0"), "- A");
  assert.equal(changelogSection("# Changelog\n", "1.0.0"), null);
});
