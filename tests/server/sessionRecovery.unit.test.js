import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FakeTargetAdapter
} from "@local/vibe64-adapters/server";
import {
  readProjectRecordMetadata
} from "@local/vibe64-core/server/projectBootstrapConfig";
import {
  RECOVERY_OPTION_KEEP,
  RECOVERY_OPTION_SWITCH,
  VIBE64_INITIALIZATION_WORKFLOW_DEFINITION_IDS,
  VIBE64_WORKFLOW_DEFINITION_IDS,
  Vibe64SessionRuntime,
  WORKFLOW_SETUP_RECOVERY_ID
} from "@local/vibe64-runtime/server";

function runGit(cwd, args = []) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function committedWorkflowAdapter() {
  const adapter = new FakeTargetAdapter({
    facts: {
      workflow: {
        seedRequired: false
      }
    }
  });
  adapter.inspectCommittedWorkflow = async ({ source } = {}) => ({
    seedRequired: !source.exists("complete.marker")
  });
  return adapter;
}

async function withRecoveryRuntime(callback, {
  completeAtBase = true
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-recovery-"));
  const sourceRoot = path.join(root, "source");
  const stateRoot = path.join(root, "state");
  const projectRecordPath = path.join(root, "project.json");
  try {
    await mkdir(sourceRoot, { recursive: true });
    runGit(sourceRoot, ["init", "--initial-branch=main"]);
    runGit(sourceRoot, ["config", "user.email", "vibe64@example.test"]);
    runGit(sourceRoot, ["config", "user.name", "Vibe64 Test"]);
    await writeFile(path.join(sourceRoot, "README.md"), "# Test application\n", "utf8");
    if (completeAtBase) {
      await writeFile(path.join(sourceRoot, "complete.marker"), "ready\n", "utf8");
    }
    runGit(sourceRoot, ["add", "."]);
    runGit(sourceRoot, ["commit", "-m", "Initial application"]);
    const baseCommit = runGit(sourceRoot, ["rev-parse", "HEAD"]);
    await writeFile(projectRecordPath, `${JSON.stringify({
      repository: {
        defaultBranch: "main",
        mode: "github"
      },
      unrelatedProjectMetadata: "preserve"
    }, null, 2)}\n`, "utf8");
    const runtime = new Vibe64SessionRuntime({
      adapter: committedWorkflowAdapter(),
      projectLocalRoot: stateRoot,
      projectRecordPath,
      targetRoot: sourceRoot,
      workflowCreationBaseline: {
        seedRequired: true,
        workflowRepositoryProfile: "github_pr"
      }
    });
    const created = await runtime.createSession({
      metadata: {
        base_commit: baseCommit,
        source_path: sourceRoot,
        workflow_repository_profile: "github_pr"
      }
    });
    await runtime.store.writeCompletedStep(created.sessionId, "session_created");
    await runtime.store.writeCompletedStep(created.sessionId, "source_created");
    await runtime.store.writeCurrentStep(created.sessionId, "seed_application_defined");
    return await callback({
      baseCommit,
      projectRecordPath,
      runtime,
      sessionId: created.sessionId,
      sourceRoot
    });
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

test("setup recovery compares the saved workflow with the starting commit", async () => {
  await withRecoveryRuntime(async ({ runtime, sessionId }) => {
    const session = await runtime.getSession(sessionId);
    const issue = session.recovery?.issues?.[0];

    assert.equal(session.workflowId, VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION);
    assert.equal(issue?.id, WORKFLOW_SETUP_RECOVERY_ID);
    assert.equal(issue?.code, "vibe64_session_setup_classification_mismatch");
    assert.deepEqual(issue?.blockedCapabilities, ["workflow_progress"]);
    assert.equal(session.presentation.auto.nextOperation, null);
    assert.equal(session.next.enabled, false);
    assert.ok(issue.options.some((option) => option.id === RECOVERY_OPTION_SWITCH));
  });
});

test("setup recovery ignores application files added after the starting commit", async () => {
  await withRecoveryRuntime(async ({ runtime, sessionId, sourceRoot }) => {
    await writeFile(path.join(sourceRoot, "complete.marker"), "built later\n", "utf8");
    const session = await runtime.getSession(sessionId);

    assert.equal(session.recovery, undefined);
    assert.notEqual(session.presentation.auto.nextOperation, null);
  }, {
    completeAtBase: false
  });
});

test("confirmed setup recovery switches workflow without replacing working files", async () => {
  await withRecoveryRuntime(async ({ projectRecordPath, runtime, sessionId, sourceRoot }) => {
    await writeFile(path.join(sourceRoot, "local-work.txt"), "preserve me\n", "utf8");
    const before = await runtime.getSession(sessionId);
    const issue = before.recovery.issues[0];

    const recovered = await runtime.resolveSessionRecovery(sessionId, {
      issueId: issue.id,
      optionId: RECOVERY_OPTION_SWITCH,
      signature: issue.signature
    });

    assert.equal(
      recovered.workflowId,
      VIBE64_INITIALIZATION_WORKFLOW_DEFINITION_IDS.GITHUB_PR
    );
    assert.equal(recovered.currentStep, "dependencies_installed");
    assert.deepEqual(recovered.completedSteps, ["session_created", "source_created"]);
    assert.equal(recovered.recovery, undefined);
    assert.equal(await readFile(path.join(sourceRoot, "local-work.txt"), "utf8"), "preserve me\n");
    const projectMetadata = await readProjectRecordMetadata(projectRecordPath);
    assert.equal(projectMetadata.applicationMode, undefined);
    assert.equal(projectMetadata.unrelatedProjectMetadata, "preserve");
  });
});

test("recovery rejects a decision made against stale diagnostic evidence", async () => {
  await withRecoveryRuntime(async ({ runtime, sessionId }) => {
    const issue = (await runtime.getSession(sessionId)).recovery.issues[0];

    await assert.rejects(
      runtime.resolveSessionRecovery(sessionId, {
        issueId: issue.id,
        optionId: RECOVERY_OPTION_SWITCH,
        signature: "stale-signature"
      }),
      (error) => error?.code === "vibe64_session_recovery_stale"
    );
  });
});

test("keeping the current setup acknowledges only the current mismatch", async () => {
  await withRecoveryRuntime(async ({ runtime, sessionId }) => {
    const issue = (await runtime.getSession(sessionId)).recovery.issues[0];
    const recovered = await runtime.resolveSessionRecovery(sessionId, {
      issueId: issue.id,
      optionId: RECOVERY_OPTION_KEEP,
      signature: issue.signature
    });

    assert.equal(recovered.workflowId, VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION);
    assert.equal(recovered.currentStep, "seed_application_defined");
    assert.equal(recovered.recovery, undefined);
  });
});

test("failed recovery acknowledgment rolls back only recovery-owned state", async () => {
  await withRecoveryRuntime(async ({ projectRecordPath, runtime, sessionId }) => {
    const issue = (await runtime.getSession(sessionId)).recovery.issues[0];
    const writeMetadataValue = runtime.store.writeMetadataValue;
    let acknowledgmentFailed = false;
    runtime.store.writeMetadataValue = async (...args) => {
      if (!acknowledgmentFailed && String(args[1] || "").startsWith("recovery.resolved.")) {
        acknowledgmentFailed = true;
        throw new Error("Forced recovery acknowledgment failure.");
      }
      return writeMetadataValue(...args);
    };
    try {
      await assert.rejects(
        runtime.resolveSessionRecovery(sessionId, {
          issueId: issue.id,
          optionId: RECOVERY_OPTION_SWITCH,
          signature: issue.signature
        }),
        /Forced recovery acknowledgment failure/u
      );
    } finally {
      runtime.store.writeMetadataValue = writeMetadataValue;
    }

    const restored = await runtime.getSession(sessionId);
    const projectMetadata = await readProjectRecordMetadata(projectRecordPath);
    assert.equal(restored.workflowId, VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION);
    assert.equal(restored.currentStep, "seed_application_defined");
    assert.equal(restored.recovery?.issues?.[0]?.id, WORKFLOW_SETUP_RECOVERY_ID);
    assert.equal(projectMetadata.applicationMode, undefined);
    assert.equal(projectMetadata.unrelatedProjectMetadata, "preserve");
  });
});

test("a selected composer template uses its own prompt instead of the current workflow prompt", async () => {
  await withRecoveryRuntime(async ({ runtime, sessionId }) => {
    const before = await runtime.getSession(sessionId);
    assert.equal(before.recovery, undefined);
    assert.equal(before.actions.find((action) => action.id === "define_seed_application")?.enabled, true);

    const result = await runtime.runAction(
      sessionId,
      "define_seed_application",
      {
        conversationRequest: "Sync the current code."
      },
      {
        promptTemplateId: "core.sync_with_remote"
      }
    );

    assert.equal(result.actionResult.promptId, "fallback");
    assert.equal(result.actionResult.agentPromptHandoff.promptId, "fallback");
  }, {
    completeAtBase: false
  });
});
