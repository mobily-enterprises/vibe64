import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS } from "../../packages/vibe64-terminals/src/server/sessionRenewalHandover.js";
import { promisify } from "node:util";

import {
  createVibe64SessionStore
} from "../../packages/vibe64-runtime/src/server/sessionStore.js";

import {
  SESSION_RENEWAL_MAINTENANCE_STEP,
  SESSION_RENEWAL_STAGE,
  SESSION_RENEWAL_STATUS,
  assertSessionRenewalDraftVersion,
  assertSessionRenewalOperation,
  createSessionRenewalDraft,
  createSessionRenewalState,
  mutateSessionRenewalState,
  normalizeSessionRenewalState,
  publicSessionRenewalState,
  readSessionRenewalState,
  renewalHandoverHash,
  renewalHandoverText,
  writeSessionRenewalState
} from "../../packages/vibe64-sessions/src/server/sessionRenewalState.js";

const AT = "2026-08-24T03:00:00.000Z";
const execFileAsync = promisify(execFile);

function aclHasEntry(acl = "", entry = "") {
  return String(acl).split("\n").some((line) => (
    line === entry || line.startsWith(`${entry}\t`)
  ));
}

async function fileAcl(filePath) {
  return String((await execFileAsync("getfacl", [
    "--omit-header",
    filePath
  ])).stdout || "");
}

async function managedAclFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-renewal-acl-"));
  const primaryGroup = String((await execFileAsync("id", ["-gn"])).stdout || "").trim();
  const groups = String((await execFileAsync("id", ["-Gn"])).stdout || "")
    .trim()
    .split(/\s+/u);
  const sharedGroup = groups.includes("vibe64") ? "vibe64" : primaryGroup;
  await execFileAsync("chgrp", [sharedGroup, root]);
  await execFileAsync("chmod", ["2770", root]);
  await execFileAsync("setfacl", [
    "-m",
    `g:${sharedGroup}:rwx,m::rwx,o::---`,
    root
  ]);
  await execFileAsync("setfacl", [
    "-m",
    `d:u::rwx,d:g::rwx,d:g:${sharedGroup}:rwx,d:m::rwx,d:o::---`,
    root
  ]);
  return {
    projectContextRoot: path.join(root, "projects", "acl-proof"),
    projectRuntimeRoot: path.join(root, "state", "acl-proof"),
    root,
    sharedGroup
  };
}

function memoryRuntime() {
  let artifact = "";
  return {
    store: {
      async readSessionRenewalStateRecord() {
        return artifact;
      },
      async runSessionRenewalStateExclusive(_sessionId, operation) {
        return operation();
      },
      async writeSessionRenewalStateRecord(_sessionId, value) {
        artifact = `${JSON.stringify(value, null, 2)}\n`;
      }
    }
  };
}

test("renewal handovers count Unicode code points and normalize newlines without truncating", () => {
  const maximum = "😀".repeat(SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS);
  assert.equal(Array.from(renewalHandoverText(maximum)).length, 20_000);
  assert.equal(renewalHandoverText("one\r\ntwo\rthree"), "one\ntwo\nthree");
  assert.throws(
    () => renewalHandoverText(`${maximum}x`),
    (error) => error.code === "vibe64_session_renewal_handover_too_long" &&
      error.details.characterCount === 20_001
  );
  for (const invalid of ["before\u0000after", "before\u0008after", "before\u001fafter", "before\u007fafter"]) {
    assert.throws(
      () => renewalHandoverText(invalid),
      { code: "vibe64_session_renewal_handover_invalid" }
    );
  }
  assert.equal(renewalHandoverText("one\ttwo\nthree"), "one\ttwo\nthree");
});

test("renewal state refuses a non-atomic generic artifact writer", async () => {
  await assert.rejects(
    () => writeSessionRenewalState({
      store: {
        async writeArtifact() {}
      }
    }, "session-1", createSessionRenewalState({
      at: AT,
      operationKey: "renewal:one",
      renewalId: "renewal-1",
      sessionId: "session-1"
    })),
    { name: "TypeError" }
  );
});

test("renewal state round trips durably with exact draft integrity", async () => {
  const runtime = memoryRuntime();
  const state = {
    ...createSessionRenewalState({
      actor: { id: "user-1", name: "Jo" },
      at: AT,
      operationKey: "renewal:one",
      renewalId: "renewal-1",
      sessionId: "session-1"
    }),
    draft: createSessionRenewalDraft("# Handover\n\nContinue carefully.", {
      at: AT,
      origin: "generated"
    }),
    stage: SESSION_RENEWAL_STAGE.DRAFT_READY,
    status: SESSION_RENEWAL_STATUS.REVIEW
  };

  await writeSessionRenewalState(runtime, "session-1", state);
  const restored = await readSessionRenewalState(runtime, "session-1");

  assert.deepEqual(restored, normalizeSessionRenewalState(state, {
    expectedSessionId: "session-1"
  }));
  assert.equal(publicSessionRenewalState(restored).draft.text, "# Handover\n\nContinue carefully.");
  assert.equal(publicSessionRenewalState(restored).successor, null);
});

test("renewal draft atomic replacement retains the managed group and inherited ACL contract", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Managed ACL verification requires Linux ACL semantics.");
    return;
  }
  for (const command of ["getfacl", "setfacl"]) {
    try {
      await execFileAsync(command, ["--version"]);
    } catch {
      t.skip(`Managed ACL verification requires ${command}.`);
      return;
    }
  }

  const fixture = await managedAclFixture();
  const previousUmask = process.umask(0o022);
  let originalHandle = null;
  try {
    const store = createVibe64SessionStore({
      projectContextRoot: fixture.projectContextRoot,
      projectRuntimeRoot: fixture.projectRuntimeRoot
    });
    const runtime = { store };
    const sessionId = "managed-acl-proof";
    const unrelatedSentinel = path.join(fixture.root, "must-not-be-repaired.txt");
    await writeFile(unrelatedSentinel, "Leave this private.\n", "utf8");
    await chmod(unrelatedSentinel, 0o600);
    const initial = {
      ...createSessionRenewalState({
        actor: { id: "reviewer", name: "Reviewer" },
        at: AT,
        operationKey: "renewal:managed-acl-proof",
        renewalId: "renewal-managed-acl-proof",
        sessionId
      }),
      draft: createSessionRenewalDraft("Reviewed before atomic replacement.", {
        at: AT,
        origin: "edited"
      }),
      stage: SESSION_RENEWAL_STAGE.DRAFT_READY,
      status: SESSION_RENEWAL_STATUS.REVIEW
    };

    await writeSessionRenewalState(runtime, sessionId, initial);
    const renewalRoot = path.join(fixture.projectRuntimeRoot, "session-renewals");
    const renewalPath = path.join(renewalRoot, `${sessionId}.json`);
    const groupId = (await stat(fixture.root)).gid;

    for (const directory of [
      path.join(fixture.root, "state"),
      fixture.projectRuntimeRoot,
      renewalRoot
    ]) {
      const details = await stat(directory);
      assert.equal(details.mode & 0o7777, 0o2770, directory);
      assert.equal(details.gid, groupId, directory);
      const acl = await fileAcl(directory);
      assert.equal(aclHasEntry(acl, `group:${fixture.sharedGroup}:rwx`), true, directory);
      assert.equal(aclHasEntry(acl, `default:group:${fixture.sharedGroup}:rwx`), true, directory);
      assert.equal(aclHasEntry(acl, "other::---"), true, directory);
      assert.equal(aclHasEntry(acl, "default:other::---"), true, directory);
    }

    const firstDetails = await stat(renewalPath);
    assert.equal(firstDetails.mode & 0o777, 0o660);
    assert.equal(firstDetails.gid, groupId);
    const firstAcl = await fileAcl(renewalPath);
    assert.equal(aclHasEntry(firstAcl, `group:${fixture.sharedGroup}:rwx`), true);
    assert.equal(aclHasEntry(firstAcl, "mask::rw-"), true);
    assert.equal(aclHasEntry(firstAcl, "other::---"), true);

    originalHandle = await open(renewalPath, "r");
    process.umask(0o007);
    const updated = await mutateSessionRenewalState(runtime, sessionId, (current) => ({
      ...current,
      draft: createSessionRenewalDraft("Replaced atomically without permission repair.", {
        at: "2026-08-24T03:01:00.000Z",
        origin: "edited",
        revision: current.draft.revision + 1
      }),
      updatedAt: "2026-08-24T03:01:00.000Z"
    }));

    assert.equal(updated.revision, 2);
    const [oldDetails, replacementDetails] = await Promise.all([
      originalHandle.stat(),
      stat(renewalPath)
    ]);
    assert.notEqual(
      `${oldDetails.dev}:${oldDetails.ino}`,
      `${replacementDetails.dev}:${replacementDetails.ino}`
    );
    assert.match(
      await originalHandle.readFile({ encoding: "utf8" }),
      /Reviewed before atomic replacement\./u
    );
    assert.match(
      await readFile(renewalPath, "utf8"),
      /Replaced atomically without permission repair\./u
    );
    assert.equal(replacementDetails.mode & 0o777, 0o660);
    assert.equal(replacementDetails.gid, groupId);
    const replacementAcl = await fileAcl(renewalPath);
    assert.equal(aclHasEntry(replacementAcl, `group:${fixture.sharedGroup}:rwx`), true);
    assert.equal(aclHasEntry(replacementAcl, "mask::rw-"), true);
    assert.equal(aclHasEntry(replacementAcl, "other::---"), true);
    assert.equal((await stat(unrelatedSentinel)).mode & 0o777, 0o600);
  } finally {
    await originalHandle?.close();
    process.umask(previousUmask);
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("renewal draft version and operation checks reject stale clients", () => {
  const draft = createSessionRenewalDraft("Current handover", { at: AT });
  const state = {
    ...createSessionRenewalState({
      at: AT,
      operationKey: "renewal:one",
      renewalId: "renewal-1",
      sessionId: "session-1"
    }),
    draft,
    stage: SESSION_RENEWAL_STAGE.DRAFT_READY,
    status: SESSION_RENEWAL_STATUS.REVIEW
  };

  assert.equal(assertSessionRenewalOperation(state, "renewal:one"), state);
  assert.equal(assertSessionRenewalDraftVersion(state, {
    expectedHash: renewalHandoverHash("Current handover"),
    expectedRevision: 1
  }), draft);
  assert.throws(
    () => assertSessionRenewalOperation(state, "renewal:two"),
    { code: "vibe64_session_renewal_operation_conflict" }
  );
  assert.throws(
    () => assertSessionRenewalDraftVersion(state, {
      expectedHash: draft.hash,
      expectedRevision: 2
    }),
    { code: "vibe64_session_renewal_draft_stale" }
  );
});

test("renewal state mutations read and write beneath one store mutation", async () => {
  const runtime = memoryRuntime();
  await writeSessionRenewalState(runtime, "session-1", createSessionRenewalState({
    at: AT,
    operationKey: "renewal:one",
    renewalId: "renewal-1",
    sessionId: "session-1"
  }));

  const updated = await mutateSessionRenewalState(runtime, "session-1", (current) => ({
    ...current,
    draft: createSessionRenewalDraft("Editable", { at: AT }),
    stage: SESSION_RENEWAL_STAGE.DRAFT_READY,
    status: SESSION_RENEWAL_STATUS.REVIEW,
    updatedAt: AT
  }));

  assert.equal(updated.draft.text, "Editable");
  assert.equal(updated.revision, 2);
  assert.equal(updated.updatedAt, AT);
  const restored = await readSessionRenewalState(runtime, "session-1");
  assert.equal(restored.status, "review");
  assert.equal(restored.revision, 2);
  assert.equal(publicSessionRenewalState(restored).revision, 2);
});

test("public renewal state marks the predecessor archive only behind the durable commit boundary", () => {
  const committedAt = "2026-08-24T03:05:00.000Z";
  const uncommitted = {
    ...createSessionRenewalState({
      at: AT,
      operationKey: "renewal:archive-boundary",
      renewalId: "renewal-archive-boundary",
      sessionId: "session-1"
    }),
    approved: createSessionRenewalDraft("Approved handover", { at: AT }),
    predecessorArchivedAt: "2026-08-24T03:04:00.000Z",
    stage: SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: { sessionId: "session-2" }
  };
  assert.throws(
    () => publicSessionRenewalState(uncommitted),
    { code: "vibe64_session_renewal_state_invalid" }
  );
  const state = {
    ...uncommitted,
    commit: {
      committedAt,
      selectedBeforeArchive: "session-1",
      sourceSessionId: "session-1",
      successorSessionId: "session-2",
      successorWillBeSelected: true
    },
    maintenance: {
      attempt: 0,
      error: null,
      status: "pending",
      steps: Object.fromEntries(
        Object.values(SESSION_RENEWAL_MAINTENANCE_STEP)
          .map((name) => [name, false])
      ),
      updatedAt: committedAt
    }
  };

  assert.equal(
    publicSessionRenewalState(state).predecessorArchivedAt,
    "2026-08-24T03:04:00.000Z"
  );
  assert.throws(
    () => publicSessionRenewalState({
      ...state,
      predecessorArchivedAt: "not-a-timestamp"
    }),
    { code: "vibe64_session_renewal_state_invalid" }
  );
  for (const invalid of [
    {
      stage: SESSION_RENEWAL_STAGE.OLD_ARCHIVING,
      status: SESSION_RENEWAL_STATUS.RUNNING
    },
    {
      stage: SESSION_RENEWAL_STAGE.FAILURE_RESTORING,
      status: SESSION_RENEWAL_STATUS.RUNNING
    },
    {
      stage: SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING,
      status: SESSION_RENEWAL_STATUS.FAILED
    }
  ]) {
    assert.throws(
      () => normalizeSessionRenewalState({
        ...state,
        ...invalid
      }, { expectedSessionId: "session-1" }),
      { code: "vibe64_session_renewal_state_invalid" }
    );
  }
});

test("completed renewal state requires an exact commit marker and complete maintenance ledger", () => {
  const committedAt = "2026-08-24T03:05:00.000Z";
  const state = {
    ...createSessionRenewalState({
      at: AT,
      operationKey: "renewal:committed",
      renewalId: "renewal-committed",
      sessionId: "session-1"
    }),
    approved: createSessionRenewalDraft("Approved handover", { at: AT }),
    commit: {
      committedAt,
      selectedBeforeArchive: "session-1",
      sourceSessionId: "session-1",
      successorSessionId: "session-2",
      successorWillBeSelected: true
    },
    maintenance: {
      attempt: 1,
      error: null,
      status: "completed",
      steps: Object.fromEntries(
        Object.values(SESSION_RENEWAL_MAINTENANCE_STEP)
          .map((name) => [name, true])
      ),
      updatedAt: committedAt
    },
    stage: SESSION_RENEWAL_STAGE.COMPLETED,
    status: SESSION_RENEWAL_STATUS.COMPLETED,
    successor: {
      availableAt: committedAt,
      sessionId: "session-2"
    }
  };

  const normalized = normalizeSessionRenewalState(state, {
    expectedSessionId: "session-1"
  });
  assert.equal(normalized.commit.committedAt, committedAt);
  assert.deepEqual(publicSessionRenewalState(normalized).maintenance, {
    error: null,
    status: "completed",
    updatedAt: committedAt
  });
  assert.throws(
    () => normalizeSessionRenewalState({
      ...state,
      commit: undefined,
      maintenance: undefined
    }, { expectedSessionId: "session-1" }),
    { code: "vibe64_session_renewal_state_invalid" }
  );
  assert.throws(
    () => normalizeSessionRenewalState({
      ...state,
      commit: {
        ...state.commit,
        sourceSessionId: "another-session"
      }
    }, { expectedSessionId: "session-1" }),
    { code: "vibe64_session_renewal_state_invalid" }
  );
  assert.throws(
    () => normalizeSessionRenewalState({
      ...state,
      maintenance: {
        ...state.maintenance,
        steps: {
          ...state.maintenance.steps,
          [SESSION_RENEWAL_MAINTENANCE_STEP.SOURCE_REMOVED]: false
        }
      }
    }, { expectedSessionId: "session-1" }),
    { code: "vibe64_session_renewal_state_invalid" }
  );
});

test("renewal state rejects cross-session reads and tampered drafts", () => {
  const draft = createSessionRenewalDraft("Trusted", { at: AT });
  const state = {
    ...createSessionRenewalState({
      at: AT,
      operationKey: "renewal:one",
      renewalId: "renewal-1",
      sessionId: "session-1"
    }),
    draft: { ...draft, text: "Tampered" },
    stage: SESSION_RENEWAL_STAGE.DRAFT_READY,
    status: SESSION_RENEWAL_STATUS.REVIEW
  };

  assert.throws(
    () => normalizeSessionRenewalState(state, { expectedSessionId: "session-2" }),
    { code: "vibe64_session_renewal_state_invalid" }
  );
  assert.throws(
    () => normalizeSessionRenewalState(state, { expectedSessionId: "session-1" }),
    { code: "vibe64_session_renewal_state_invalid" }
  );
});
