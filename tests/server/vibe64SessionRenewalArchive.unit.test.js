import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  pathExists
} from "@local/vibe64-core/server/core";
import {
  VIBE64_SESSION_STATUS,
  createVibe64SessionStore
} from "@local/vibe64-runtime/server/sessionStore";
import { Vibe64SessionRuntime } from "@local/vibe64-runtime/server/runtime";
import { renewalSourceStagePath } from "@local/vibe64-runtime/server/sessionWorktreeGit";
import {
  projectRuntimeRoot,
  sourceMetadata,
  sourcePath as sessionSourcePath,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

async function git(cwd, args = []) {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024,
    timeout: 30_000
  });
  return String(result.stdout || "").trim();
}

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

async function createGitProject(root, {
  withSubmodule = false
} = {}) {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "vibe64@example.test"]);
  await git(root, ["config", "user.name", "Vibe64 Test"]);
  await Promise.all([
    writeProjectFile(root, ".gitignore", "node_modules/\ndist/\n"),
    writeProjectFile(root, "app.txt", "initial\n")
  ]);
  await git(root, ["add", ".gitignore", "app.txt"]);
  if (withSubmodule) {
    const submoduleRemote = path.join(path.dirname(root), "renewal-submodule.git");
    const submoduleSeed = path.join(path.dirname(root), "renewal-submodule-seed");
    await git(path.dirname(root), [
      "init",
      "--bare",
      "--initial-branch=main",
      submoduleRemote
    ]);
    await git(path.dirname(root), ["clone", submoduleRemote, submoduleSeed]);
    await git(submoduleSeed, ["config", "user.email", "vibe64@example.test"]);
    await git(submoduleSeed, ["config", "user.name", "Vibe64 Test"]);
    await writeProjectFile(submoduleSeed, "module.txt", "module initial\n");
    await git(submoduleSeed, ["add", "module.txt"]);
    await git(submoduleSeed, ["commit", "-m", "initial submodule"]);
    await git(submoduleSeed, ["push", "origin", "main"]);
    await git(root, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      submoduleRemote,
      "vendor/dependency"
    ]);
    await git(root, ["add", ".gitmodules", "vendor/dependency"]);
  }
  await git(root, ["commit", "-m", "initial"]);
  await git(root, ["branch", "-M", "main"]);
  return git(root, ["rev-parse", "--verify", "HEAD"]);
}

async function createRenewalFixture(targetRoot, {
  onRenewalArchiveCommitStep,
  renewalId = "renewal-archive-1",
  sourceSessionId = "renewal-source",
  successorSessionId = "renewal-successor",
  withSubmodule = false
} = {}) {
  const baseCommit = await createGitProject(targetRoot, { withSubmodule });
  const runtimeRoot = projectRuntimeRoot(targetRoot);
  const store = createVibe64SessionStore({
    onRenewalArchiveCommitStep,
    projectContextRoot: targetRoot,
    projectRuntimeRoot: runtimeRoot,
    projectSessionSourceRoot: targetRoot
  });
  const runtime = new Vibe64SessionRuntime({
    projectContextRoot: targetRoot,
    projectRuntimeRoot: runtimeRoot,
    projectSessionSourceRoot: targetRoot,
    store
  });
  const sourcePath = sessionSourcePath(targetRoot, sourceSessionId);
  await runtime.createSession({
    metadata: {
      base_branch: "main",
      base_commit: baseCommit,
      branch: `vibe64/${sourceSessionId}`,
      source_default_branch: "main",
      source_remote_url: targetRoot,
      ...sourceMetadata(targetRoot, sourceSessionId)
    },
    sessionId: sourceSessionId
  });
  await mkdir(path.dirname(sourcePath), {
    recursive: true
  });
  await git(path.dirname(sourcePath), ["clone", targetRoot, sourcePath]);
  await git(sourcePath, ["config", "user.email", "vibe64@example.test"]);
  await git(sourcePath, ["config", "user.name", "Vibe64 Test"]);
  await git(sourcePath, ["checkout", "-B", `vibe64/${sourceSessionId}`, baseCommit]);
  if (withSubmodule) {
    await git(sourcePath, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "update",
      "--init",
      "--recursive"
    ]);
  }
  await runtime.quiesceSessionForRenewal({
    quiescedAt: "2026-08-24T01:00:30.000Z",
    renewalId,
    sourceSessionId
  });
  await runtime.store.createRenewalPendingSession({
    actorDisplayName: "Ada",
    actorId: "ada-owner",
    confirmedAt: "2026-08-24T01:01:00.000Z",
    renewalId,
    renewedFrom: sourceSessionId,
    runtimeKind: "genesis",
    sessionId: successorSessionId,
    startedAt: "2026-08-24T01:00:00.000Z"
  });
  return {
    renewalId,
    runtime,
    sourcePath,
    sourceSessionId,
    successorSessionId
  };
}

async function handoffAndFinalize(fixture) {
  await fixture.runtime.store.transitionRenewalSuccessor({
    acknowledgedAt: "2026-08-24T01:03:00.000Z",
    renewedAt: "2026-08-24T01:04:00.000Z",
    renewalId: fixture.renewalId,
    sourceSessionId: fixture.sourceSessionId,
    successorSessionId: fixture.successorSessionId
  });
}

async function activateSuccessor(fixture) {
  return fixture.runtime.store.activateRenewalSuccessor({
    renewalId: fixture.renewalId,
    sourceSessionId: fixture.sourceSessionId,
    successorSessionId: fixture.successorSessionId
  });
}

async function commitPreparedRenewal(fixture, {
  committedAt = "2026-08-24T01:06:00.000Z",
  finalizeArchive = true
} = {}) {
  const selectionPlan = await fixture.runtime.finalizeRenewalCurrentSession(fixture);
  await fixture.runtime.store.commitRenewalArchive(fixture);
  await fixture.runtime.store.commitRenewalSuccessor({
    committedAt,
    renewalId: fixture.renewalId,
    sourceSessionId: fixture.sourceSessionId,
    successorSessionId: fixture.successorSessionId
  });
  const selection = await fixture.runtime.store.commitRenewalCurrentSession(fixture);
  if (finalizeArchive) {
    await fixture.runtime.store.finalizeRenewalArchiveCommit(fixture);
  }
  return {
    selection,
    selectionPlan
  };
}

test("renewal stages a clean source reversibly before committing removal", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const fixture = await createRenewalFixture(targetRoot);
    await writeProjectFile(fixture.sourcePath, "saved.txt", "saved work\n");
    await git(fixture.sourcePath, ["add", "saved.txt"]);
    await git(fixture.sourcePath, ["commit", "-m", "saved work"]);
    await writeProjectFile(
      fixture.sourcePath,
      "node_modules/ignored-package/index.js",
      "ignored dependency\n"
    );

    const firstPreparation = await fixture.runtime.prepareSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    assert.equal(firstPreparation.changed, true);
    assert.equal(firstPreparation.prepared, true);
    assert.equal(firstPreparation.staged, false);
    assert.equal(await pathExists(fixture.sourcePath), true);
    assert.equal(await pathExists(firstPreparation.stagePath), false);
    assert.equal(
      (await fixture.runtime.listSessions()).some((session) => (
        session.sessionId === fixture.sourceSessionId
      )),
      true
    );
    const metadata = await fixture.runtime.store.readMetadata(fixture.sourceSessionId);
    assert.equal(metadata.source_recovery_saved, "yes");
    assert.equal(metadata.source_recovery_dirty, "no");
    assert.equal(metadata.source_recovery_bundle_artifact, "recovery/branch.bundle");

    const repeatedPreparation = await fixture.runtime.prepareSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    assert.equal(repeatedPreparation.changed, false);
    assert.equal(await pathExists(fixture.sourcePath), true);

    const firstStage = await fixture.runtime.stagePreparedSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    assert.equal(firstStage.changed, true);
    assert.equal(await pathExists(fixture.sourcePath), false);
    assert.equal(await pathExists(firstStage.stagePath), true);

    const restored = await fixture.runtime.restoreSessionSourceAfterRenewalFailure(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    assert.equal(restored.changed, true);
    assert.equal(await pathExists(fixture.sourcePath), true);
    assert.equal(await pathExists(firstStage.stagePath), false);

    await fixture.runtime.prepareSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await fixture.runtime.stagePreparedSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await assert.rejects(
      () => fixture.runtime.commitRenewalSessionSourceRemoval(
        fixture.sourceSessionId,
        { renewalId: fixture.renewalId }
      ),
      { code: "vibe64_session_renewal_archive_required" }
    );
    assert.equal(await pathExists(firstStage.stagePath), true);
    await handoffAndFinalize(fixture);
    await fixture.runtime.store.prepareRenewalSessionArchive(fixture);
    await activateSuccessor(fixture);
    assert.equal(
      (await fixture.runtime.store.listSessions())
        .some((session) => session.sessionId === fixture.successorSessionId),
      false
    );
    await assert.rejects(
      () => fixture.runtime.store.readSession(fixture.successorSessionId),
      { code: "vibe64_session_renewal_private" }
    );
    await commitPreparedRenewal(fixture);
    const committed = await fixture.runtime.commitRenewalSessionSourceRemoval(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    assert.equal(committed.changed, true);
    assert.equal(await pathExists(committed.stagePath), false);
    assert.equal((await fixture.runtime.store.readSession(fixture.sourceSessionId)).archived, true);
    assert.equal((await fixture.runtime.store.readSession(fixture.successorSessionId)).status, VIBE64_SESSION_STATUS.ACTIVE);
    assert.equal((await fixture.runtime.commitRenewalSessionSourceRemoval(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    )).changed, false);
  });
});

test("renewal source staging rejects dirty work and corrupt recovery evidence", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const dirtyProjectRoot = path.join(targetRoot, "dirty-project");
    const cleanProjectRoot = path.join(targetRoot, "clean-project");
    await Promise.all([
      mkdir(dirtyProjectRoot, { recursive: true }),
      mkdir(cleanProjectRoot, { recursive: true })
    ]);
    const dirtyFixture = await createRenewalFixture(dirtyProjectRoot, {
      renewalId: "renewal-dirty",
      sourceSessionId: "dirty-source",
      successorSessionId: "dirty-successor"
    });
    await writeProjectFile(dirtyFixture.sourcePath, "unsaved.txt", "not saved\n");
    await assert.rejects(
      () => dirtyFixture.runtime.prepareSessionSourceForRenewal(
        dirtyFixture.sourceSessionId,
        { renewalId: dirtyFixture.renewalId }
      ),
      { code: "vibe64_session_renewal_source_dirty" }
    );
    assert.equal(await pathExists(dirtyFixture.sourcePath), true);
    assert.equal(await pathExists(renewalSourceStagePath(
      await dirtyFixture.runtime.store.readSession(dirtyFixture.sourceSessionId),
      dirtyFixture.renewalId
    )), false);

    const cleanFixture = await createRenewalFixture(cleanProjectRoot, {
      renewalId: "renewal-corrupt",
      sourceSessionId: "corrupt-source",
      successorSessionId: "corrupt-successor"
    });
    await writeProjectFile(cleanFixture.sourcePath, "saved.txt", "saved\n");
    await git(cleanFixture.sourcePath, ["add", "saved.txt"]);
    await git(cleanFixture.sourcePath, ["commit", "-m", "saved"]);
    const stage = await cleanFixture.runtime.prepareSessionSourceForRenewal(
      cleanFixture.sourceSessionId,
      { renewalId: cleanFixture.renewalId }
    );
    const session = await cleanFixture.runtime.store.readSession(cleanFixture.sourceSessionId);
    await writeFile(
      path.join(session.artifactsRoot, "recovery/branch.bundle"),
      "not a git bundle",
      "utf8"
    );
    await assert.rejects(
      () => cleanFixture.runtime.prepareSessionSourceForRenewal(
        cleanFixture.sourceSessionId,
        { renewalId: cleanFixture.renewalId }
      ),
      { code: "vibe64_session_renewal_recovery_invalid" }
    );
    assert.equal(await pathExists(stage.stagePath), false);
    assert.equal(await pathExists(cleanFixture.sourcePath), true);
    await assert.rejects(
      () => cleanFixture.runtime.stagePreparedSessionSourceForRenewal(
        cleanFixture.sourceSessionId,
        { renewalId: cleanFixture.renewalId }
      ),
      { code: "vibe64_session_renewal_recovery_invalid" }
    );
    assert.equal(await pathExists(stage.stagePath), false);
    assert.equal(await pathExists(cleanFixture.sourcePath), true);
  });
});

test("renewal source proof rejects dirty submodules even when repository config hides them", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const fixture = await createRenewalFixture(targetRoot, {
      renewalId: "renewal-dirty-submodule",
      sourceSessionId: "submodule-source",
      successorSessionId: "submodule-successor",
      withSubmodule: true
    });
    await git(fixture.sourcePath, ["config", "status.ignoreSubmodules", "all"]);
    await writeProjectFile(
      fixture.sourcePath,
      "node_modules/ignored-package/index.js",
      "ignored dependency\n"
    );
    await writeProjectFile(
      fixture.sourcePath,
      "vendor/dependency/module.txt",
      "dirty tracked submodule\n"
    );

    await assert.rejects(
      () => fixture.runtime.prepareSessionSourceForRenewal(
        fixture.sourceSessionId,
        { renewalId: fixture.renewalId }
      ),
      { code: "vibe64_session_renewal_source_dirty" }
    );
    assert.equal(await pathExists(fixture.sourcePath), true);
    assert.equal(await pathExists(renewalSourceStagePath(
      await fixture.runtime.store.readSession(fixture.sourceSessionId),
      fixture.renewalId
    )), false);
  });
});

test("renewal source proof rejects tracked changes hidden by assume-unchanged", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const fixture = await createRenewalFixture(targetRoot, {
      renewalId: "renewal-assume-unchanged",
      sourceSessionId: "assume-unchanged-source",
      successorSessionId: "assume-unchanged-successor"
    });
    await git(fixture.sourcePath, [
      "update-index",
      "--assume-unchanged",
      "app.txt"
    ]);
    await writeProjectFile(
      fixture.sourcePath,
      "app.txt",
      "tracked work hidden from ordinary status\n"
    );
    assert.equal(await git(fixture.sourcePath, ["status", "--porcelain=v1"]), "");

    await assert.rejects(
      () => fixture.runtime.prepareSessionSourceForRenewal(
        fixture.sourceSessionId,
        { renewalId: fixture.renewalId }
      ),
      { code: "vibe64_session_renewal_source_dirty" }
    );
    assert.equal(await pathExists(fixture.sourcePath), true);
    assert.equal(await pathExists(renewalSourceStagePath(
      await fixture.runtime.store.readSession(fixture.sourceSessionId),
      fixture.renewalId
    )), false);
  });
});

test("renewal source proof rejects tracked changes hidden by skip-worktree", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const fixture = await createRenewalFixture(targetRoot, {
      renewalId: "renewal-skip-worktree",
      sourceSessionId: "skip-worktree-source",
      successorSessionId: "skip-worktree-successor"
    });
    await git(fixture.sourcePath, [
      "update-index",
      "--skip-worktree",
      "app.txt"
    ]);
    await writeProjectFile(
      fixture.sourcePath,
      "app.txt",
      "tracked work hidden from ordinary status\n"
    );
    assert.equal(await git(fixture.sourcePath, ["status", "--porcelain=v1"]), "");

    await assert.rejects(
      () => fixture.runtime.prepareSessionSourceForRenewal(
        fixture.sourceSessionId,
        { renewalId: fixture.renewalId }
      ),
      { code: "vibe64_session_renewal_source_dirty" }
    );
    assert.equal(await pathExists(fixture.sourcePath), true);
    assert.equal(await pathExists(renewalSourceStagePath(
      await fixture.runtime.store.readSession(fixture.sourceSessionId),
      fixture.renewalId
    )), false);
  });
});

test("renewal source cleanup resumes an exact partially deleted tombstone", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const fixture = await createRenewalFixture(targetRoot);
    const prepared = await fixture.runtime.prepareSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await fixture.runtime.stagePreparedSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await handoffAndFinalize(fixture);
    await fixture.runtime.store.prepareRenewalSessionArchive(fixture);
    await activateSuccessor(fixture);
    await commitPreparedRenewal(fixture);

    const deletionPath = `${prepared.stagePath}.deleting`;
    const unrelatedPath = `${prepared.stagePath}.unrelated`;
    await rename(prepared.stagePath, deletionPath);
    await Promise.all([
      rm(path.join(deletionPath, ".git"), { force: true, recursive: true }),
      writeProjectFile(unrelatedPath, "keep.txt", "keep\n")
    ]);

    const resumed = await fixture.runtime.commitRenewalSessionSourceRemoval(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    assert.equal(resumed.changed, true);
    assert.equal(resumed.deletionPath, deletionPath);
    assert.equal(await pathExists(deletionPath), false);
    assert.equal(await pathExists(unrelatedPath), true);
    assert.equal((await fixture.runtime.commitRenewalSessionSourceRemoval(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    )).changed, false);
  });
});

test("renewal completion selects the successor only when the archived predecessor was selected", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const fixture = await createRenewalFixture(targetRoot);
    await fixture.runtime.store.updateCurrentSession(fixture.sourceSessionId);
    await fixture.runtime.prepareSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await handoffAndFinalize(fixture);
    await fixture.runtime.store.prepareRenewalSessionArchive(fixture);
    assert.equal(
      (await fixture.runtime.store.readCurrentSession()).sessionId,
      fixture.sourceSessionId
    );
    assert.deepEqual(
      await fixture.runtime.store.listSessionSummaries({ statusGroup: "archived" }),
      []
    );
    await activateSuccessor(fixture);

    const prepared = await fixture.runtime.finalizeRenewalCurrentSession(fixture);
    assert.equal(prepared.changed, false);
    assert.equal(prepared.selectedBeforeArchive, fixture.sourceSessionId);
    assert.equal(prepared.sessionId, fixture.sourceSessionId);
    assert.equal(prepared.successorWillBeSelected, true);
    assert.equal(
      (await fixture.runtime.store.readCurrentSession()).sessionId,
      fixture.sourceSessionId
    );

    const { selection: completed } = await commitPreparedRenewal(fixture);
    assert.equal(completed.changed, true);
    assert.equal(completed.selectedBeforeArchive, fixture.sourceSessionId);
    assert.equal(completed.sessionId, fixture.successorSessionId);
    assert.equal(
      (await fixture.runtime.store.readCurrentSession()).sessionId,
      fixture.successorSessionId
    );

    const repeated = await fixture.runtime.store.commitRenewalCurrentSession(fixture);
    assert.equal(repeated.changed, false);
    assert.equal(repeated.sessionId, fixture.successorSessionId);
  });
});

test("renewal completion never overwrites a selection made outside its exact archive transaction", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const fixture = await createRenewalFixture(targetRoot);
    await fixture.runtime.store.createSession({
      runtimeKind: "genesis",
      sessionId: "other-session"
    });
    await fixture.runtime.store.updateCurrentSession(fixture.sourceSessionId);
    await fixture.runtime.prepareSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await handoffAndFinalize(fixture);
    await fixture.runtime.store.prepareRenewalSessionArchive(fixture);
    await activateSuccessor(fixture);
    await fixture.runtime.store.updateCurrentSession("other-session");

    const prepared = await fixture.runtime.finalizeRenewalCurrentSession(fixture);
    assert.equal(prepared.changed, false);
    assert.equal(prepared.selectedBeforeArchive, fixture.sourceSessionId);
    assert.equal(prepared.sessionId, "other-session");
    assert.equal(prepared.successorWillBeSelected, false);

    const { selection: completed } = await commitPreparedRenewal(fixture);
    assert.equal(completed.changed, false);
    assert.equal(completed.sessionId, "other-session");
    assert.equal(
      (await fixture.runtime.store.readCurrentSession()).sessionId,
      "other-session"
    );
  });
});

test("renewal completion preserves no-selection intent captured by the archive", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const fixture = await createRenewalFixture(targetRoot);
    await fixture.runtime.prepareSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await handoffAndFinalize(fixture);
    await fixture.runtime.store.prepareRenewalSessionArchive(fixture);
    await activateSuccessor(fixture);

    const prepared = await fixture.runtime.finalizeRenewalCurrentSession(fixture);
    assert.equal(prepared.changed, false);
    assert.equal(prepared.selectedBeforeArchive, "none");
    assert.equal(prepared.sessionId, "");
    assert.equal(prepared.successorWillBeSelected, false);

    const { selection: completed } = await commitPreparedRenewal(fixture);
    assert.equal(completed.changed, false);
    assert.equal(completed.sessionId, "");
    assert.equal(await fixture.runtime.store.readCurrentSession(), null);
  });
});

test("failed pre-commit renewal preparation stays private and restores without changing selection", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const fixture = await createRenewalFixture(targetRoot);
    await fixture.runtime.store.updateCurrentSession(fixture.sourceSessionId);
    const stage = await fixture.runtime.prepareSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await handoffAndFinalize(fixture);
    const detached = await fixture.runtime.store.detachRenewedSessionForArchive(fixture);
    assert.equal(detached.detached, false);
    assert.equal(detached.prepared, true);
    assert.equal(await pathExists(fixture.runtime.store.paths(fixture.sourceSessionId).manifestPath), true);
    assert.equal(
      (await fixture.runtime.store.readCurrentSession()).sessionId,
      fixture.sourceSessionId
    );
    assert.deepEqual(
      await fixture.runtime.store.listSessionSummaries({ statusGroup: "archived" }),
      []
    );

    await assert.rejects(
      () => fixture.runtime.store.restoreRenewalClosingSession({
        ...fixture,
        renewalId: "another-renewal"
      }),
      { code: "vibe64_session_renewal_archive_status_invalid" }
    );
    const restored = await fixture.runtime.store.restoreRenewalClosingSession(fixture);
    assert.equal(restored.restored, true);
    assert.equal(restored.status, VIBE64_SESSION_STATUS.RENEWAL_QUIESCED);
    assert.equal(
      (await fixture.runtime.store.readSessionForRenewal(fixture.sourceSessionId)).status,
      VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
    );
    assert.equal((await fixture.runtime.store.readCurrentSession()).sessionId, fixture.sourceSessionId);
    await fixture.runtime.restoreSessionSourceAfterRenewalFailure(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await fixture.runtime.restoreSessionAfterRenewalCancellation(fixture);
    assert.equal(await pathExists(fixture.sourcePath), true);
    assert.equal(await pathExists(stage.stagePath), false);
  });
});

test("renewal rollback accepts a failure before archive detachment records its selection marker", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const fixture = await createRenewalFixture(targetRoot);
    await fixture.runtime.store.updateCurrentSession(fixture.sourceSessionId);
    await fixture.runtime.prepareSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await handoffAndFinalize(fixture);
    assert.equal(
      (await fixture.runtime.store.readSessionForRenewal(fixture.sourceSessionId))
        .metadata.renewal_selected_before_archive,
      undefined
    );

    const restored = await fixture.runtime.store.restoreRenewalClosingSession(fixture);
    assert.equal(restored.restored, false);
    assert.equal(restored.selectedBeforeArchive, "none");
    assert.equal(restored.status, VIBE64_SESSION_STATUS.RENEWAL_QUIESCED);
    assert.equal((await fixture.runtime.store.readCurrentSession()).sessionId, fixture.sourceSessionId);
    await fixture.runtime.restoreSessionSourceAfterRenewalFailure(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await fixture.runtime.restoreSessionAfterRenewalCancellation(fixture);
    assert.equal(await pathExists(fixture.sourcePath), true);
  });
});

test("renewal restoration never overwrites another selection or a published archive", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const fixture = await createRenewalFixture(targetRoot);
    await fixture.runtime.store.createSession({
      runtimeKind: "genesis",
      sessionId: "other-session"
    });
    await fixture.runtime.store.updateCurrentSession("other-session");
    await fixture.runtime.prepareSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await handoffAndFinalize(fixture);
    await fixture.runtime.store.detachRenewedSessionForArchive(fixture);
    await fixture.runtime.store.restoreRenewalClosingSession(fixture);
    assert.equal((await fixture.runtime.store.readCurrentSession()).sessionId, "other-session");

    await fixture.runtime.restoreSessionSourceAfterRenewalFailure(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await fixture.runtime.restoreSessionAfterRenewalCancellation(fixture);
    await fixture.runtime.quiesceSessionForRenewal(fixture);
    await fixture.runtime.prepareSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await fixture.runtime.store.transitionRenewalSuccessor({
      acknowledgedAt: "2026-08-24T01:03:00.000Z",
      renewalId: fixture.renewalId,
      sourceSessionId: fixture.sourceSessionId,
      successorSessionId: fixture.successorSessionId
    });
    await fixture.runtime.store.prepareRenewalSessionArchive(fixture);
    await fixture.runtime.store.activateRenewalSuccessor(fixture);
    await fixture.runtime.finalizeRenewalCurrentSession(fixture);
    await fixture.runtime.store.commitRenewalArchive(fixture);
    assert.equal((await fixture.runtime.store.readCurrentSession()).sessionId, "other-session");
    await assert.rejects(
      () => fixture.runtime.store.restoreRenewalClosingSession(fixture),
      { code: "vibe64_session_renewal_archive_published" }
    );
    await fixture.runtime.store.finalizeRenewalArchiveCommit(fixture);
  });
});

test("ordinary archiving refuses to bypass the renewal archive transaction", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const fixture = await createRenewalFixture(targetRoot);
    await fixture.runtime.prepareSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await handoffAndFinalize(fixture);
    assert.deepEqual(
      await fixture.runtime.store.listSessionSummaries({ statusGroup: "archived" }),
      []
    );
    await assert.rejects(
      () => fixture.runtime.store.publishSessionArchive(fixture.sourceSessionId),
      { code: "vibe64_session_renewal_quiesced" }
    );
    assert.equal(await pathExists(fixture.runtime.store.paths(fixture.sourceSessionId).manifestPath), true);
  });
});

test("renewal archive retries clean only exact crash-owned staging paths", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const fixture = await createRenewalFixture(targetRoot);
    const archiveRoot = fixture.runtime.store.paths().archivedSessionsRoot;
    const buildRoot = path.join(
      archiveRoot,
      ".renewals",
      ".building",
      fixture.sourceSessionId
    );
    const unrelatedBuildRoot = path.join(
      archiveRoot,
      ".renewals",
      ".building",
      "another-session"
    );
    await Promise.all([
      writeProjectFile(buildRoot, "interrupted.tmp", "stale"),
      writeProjectFile(unrelatedBuildRoot, "keep.tmp", "keep")
    ]);
    await fixture.runtime.prepareSessionSourceForRenewal(
      fixture.sourceSessionId,
      { renewalId: fixture.renewalId }
    );
    await handoffAndFinalize(fixture);
    const prepared = await fixture.runtime.store.prepareRenewalSessionArchive(fixture);
    assert.equal(await pathExists(buildRoot), false);
    assert.equal(await pathExists(path.join(unrelatedBuildRoot, "keep.tmp")), true);

    const publishingRoot = path.join(
      archiveRoot,
      ".renewals",
      ".publishing",
      fixture.sourceSessionId
    );
    const unrelatedPublishingRoot = path.join(
      archiveRoot,
      ".renewals",
      ".publishing",
      "another-session"
    );
    await Promise.all([
      writeProjectFile(publishingRoot, "interrupted.tmp", "stale"),
      writeProjectFile(unrelatedPublishingRoot, "keep.tmp", "keep")
    ]);
    const finalArchivePath = path.join(
      archiveRoot,
      `${fixture.sourceSessionId}.tar.gz`
    );
    await mkdir(path.dirname(finalArchivePath), { recursive: true });
    await copyFile(prepared.archivePath, finalArchivePath);
    await activateSuccessor(fixture);

    const committed = await fixture.runtime.store.commitRenewalArchive(fixture);

    assert.equal(committed.sessionId, fixture.sourceSessionId);
    assert.equal(await pathExists(publishingRoot), false);
    assert.equal(
      await pathExists(path.join(unrelatedPublishingRoot, "keep.tmp")),
      true
    );
    assert.equal(await pathExists(finalArchivePath), true);
    assert.equal(
      await pathExists(path.join(
        archiveRoot,
        `${fixture.sourceSessionId}.json`
      )),
      true
    );
  });
});

test("renewal archive publication resumes after every closing-tree write boundary", async (t) => {
  const metadataNames = [
    "renewal_acknowledged_at",
    "renewal_actor_display_name",
    "renewal_actor_id",
    "renewal_archived_at",
    "renewal_confirmed_at",
    "renewal_handover_delivered_at",
    "renewal_id",
    "renewal_started_at",
    "renewal_successor_created_at",
    "renewed_at",
    "renewed_to",
    "renewal_selected_before_archive"
  ];
  const scenarios = [
    { name: "closing rename", step: "closing-renamed" },
    ...metadataNames.map((metadataName) => ({
      metadataName,
      name: `${metadataName} write`,
      step: "closing-metadata-written"
    })),
    { name: "archived status write", step: "closing-status-written" }
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      await withTemporaryRoot(async (targetRoot) => {
        let interrupted = false;
        const fixture = await createRenewalFixture(targetRoot, {
          onRenewalArchiveCommitStep(input = {}) {
            if (
              !interrupted &&
              input.step === scenario.step &&
              (!scenario.metadataName || input.metadataName === scenario.metadataName)
            ) {
              interrupted = true;
              const error = new Error(`Interrupted after ${scenario.name}`);
              error.code = "simulated_renewal_archive_commit_interruption";
              throw error;
            }
          }
        });
        await fixture.runtime.store.updateCurrentSession(fixture.sourceSessionId);
        await fixture.runtime.prepareSessionSourceForRenewal(
          fixture.sourceSessionId,
          { renewalId: fixture.renewalId }
        );
        await handoffAndFinalize(fixture);
        await fixture.runtime.store.prepareRenewalSessionArchive(fixture);
        await activateSuccessor(fixture);
        await fixture.runtime.finalizeRenewalCurrentSession(fixture);

        await assert.rejects(
          () => fixture.runtime.store.commitRenewalArchive(fixture),
          { code: "simulated_renewal_archive_commit_interruption" }
        );
        assert.equal(interrupted, true);
        const interruptedPredecessor = await fixture.runtime.store.readSessionForRenewal(
          fixture.sourceSessionId
        );
        assert.equal(
          interruptedPredecessor.status,
          scenario.step === "closing-status-written"
            ? VIBE64_SESSION_STATUS.ARCHIVED
            : VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
        );
        const sourcePaths = fixture.runtime.store.paths(fixture.sourceSessionId);
        const closingRoot = path.join(
          sourcePaths.closingSessionsRoot,
          fixture.sourceSessionId
        );
        assert.equal(await pathExists(sourcePaths.manifestPath), false);
        assert.equal(await pathExists(path.join(closingRoot, "session.json")), true);

        const committed = await commitPreparedRenewal(fixture);
        assert.equal(committed.selection.sessionId, fixture.successorSessionId);
        assert.equal(
          (await fixture.runtime.store.readSessionForRenewal(
            fixture.sourceSessionId
          )).archived,
          true
        );
        assert.equal(
          (await fixture.runtime.store.readCurrentSession()).sessionId,
          fixture.successorSessionId
        );
        assert.equal(await pathExists(closingRoot), false);
        assert.equal(await pathExists(path.join(
          sourcePaths.archivedSessionsRoot,
          ".renewals",
          fixture.sourceSessionId
        )), false);
        assert.equal(await pathExists(path.join(
          sourcePaths.archivedSessionsRoot,
          ".renewals",
          ".publishing",
          fixture.sourceSessionId
        )), false);
      });
    });
  }
});
