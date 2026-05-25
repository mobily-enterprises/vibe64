import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  AiStudioSessionRuntime,
  AI_STUDIO_WORKFLOW_PROFILE_IDS,
  FakeTargetAdapter
} from "../../server/lib/aiStudio/index.js";
import {
  createService
} from "../../packages/ai-studio-artifacts/src/server/service.js";
import {
  helperSocketHostPath,
  prepareCurrentStepInputHelper
} from "../../server/lib/aiStudio/currentStepInputHelperServer.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

function projectServiceForRuntime(runtime) {
  return {
    async createRuntime() {
      return runtime;
    }
  };
}

function runNodeScript(scriptPath = "", args = [], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      scriptPath,
      ...args
    ], {
      env: {
        ...process.env,
        ...env
      },
      stdio: [
        "ignore",
        "pipe",
        "pipe"
      ]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve({
        code,
        stderr,
        stdout
      });
    });
  });
}

test("AI Studio artifacts service saves semantic issue step input", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_issue_on_gh: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      sessionId: "step_input_issue"
    });

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const saved = await service.submitCurrentStepInput("step_input_issue", {
      kind: "ready",
      stepId: "issue_file_created",
      stepStatus: "waiting_for_input",
      fields: {
        body: "Create a booking dashboard.",
        title: "Add booking dashboard",
        word: "Booking"
      }
    });

    assert.equal(saved.ok, true);
    assert.equal(await runtime.store.readArtifact("step_input_issue", "issue_title"), "Add booking dashboard\n");
    assert.equal(await runtime.store.readArtifact("step_input_issue", "issue_word"), "Booking\n");
    assert.equal(await runtime.store.readArtifact("step_input_issue", "issue.md"), "Create a booking dashboard.\n");
    assert.equal(await runtime.store.readMetadataValue("step_input_issue", "issue_title"), "Add booking dashboard");
    assert.equal(await runtime.store.readMetadataValue("step_input_issue", "issue_word"), "Booking");

    const updatedSession = await runtime.getSession("step_input_issue");
    assert.equal(updatedSession.sessionName, "Booking");
    assert.equal(updatedSession.stepMachine.status, "confirm_files");
    assert.equal(updatedSession.next.enabled, true);
    assert.equal(updatedSession.next.stepId, "issue_submitted");
  });
});

test("AI Studio artifacts service saves semantic pull request step input", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_pr_on_gh: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "create_pull_request",
      sessionId: "step_input_pr"
    });

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const saved = await service.submitCurrentStepInput("step_input_pr", {
      kind: "ready",
      source: "codex",
      stepId: "create_pull_request",
      stepStatus: "awaiting_agent_result",
      fields: {
        title: "Add booking dashboard",
        body: "## Summary\nCreate the booking dashboard.\n"
      }
    });

    assert.equal(saved.ok, true);
    assert.equal(
      await runtime.store.readArtifact("step_input_pr", "tmp/create_pull_request.title.txt"),
      "Add booking dashboard\n"
    );
    assert.equal(
      await runtime.store.readArtifact("step_input_pr", "tmp/create_pull_request.body.md"),
      "## Summary\nCreate the booking dashboard.\n"
    );
    const updatedSession = await runtime.getSession("step_input_pr");
    assert.equal(updatedSession.stepMachine.status, "confirm_files");
  });
});

test("AI Studio artifacts service appends helper responses to the conversation log", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      sessionId: "helper_conversation_log",
      workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
    });
    await runtime.store.writeConversationUserMessage("helper_conversation_log", {
      text: "What should we improve?"
    });

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const saved = await service.submitCurrentStepInput("helper_conversation_log", {
      fields: {
        response: "Tighten the Autopilot conversation panel."
      },
      kind: "ready",
      source: "codex",
      stepId: "maintenance_conversation",
      stepStatus: "ready"
    });

    const conversationLog = await runtime.store.readConversationLog("helper_conversation_log");
    assert.equal(saved.ok, true);
    assert.deepEqual(conversationLog.map((turn) => [
      turn.user?.text || "",
      turn.assistant?.text || ""
    ]), [
      [
        "What should we improve?",
        "Tighten the Autopilot conversation panel."
      ]
    ]);
  });
});

test("AI Studio artifacts service rejects UI input while a step waits for Codex", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_pr_on_gh: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "create_pull_request",
      sessionId: "step_input_pr_ui_waiting"
    });

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const saved = await service.submitCurrentStepInput("step_input_pr_ui_waiting", {
      fields: {
        body: "## Summary\nCreate the booking dashboard.\n",
        title: "Add booking dashboard"
      },
      kind: "ready",
      source: "ui",
      stepId: "create_pull_request",
      stepStatus: "awaiting_agent_result"
    });

    assert.equal(saved.ok, false);
    assert.equal(saved.errors[0].code, "ai_studio_step_input_state_changed");
    assert.match(saved.errors[0].message, /waiting for Codex/u);
  });
});

test("AI Studio artifacts service rejects semantic step input on steps without an input contract", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "session_created",
      sessionId: "step_input_wrong_step"
    });
    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const saved = await service.submitCurrentStepInput("step_input_wrong_step", {
      kind: "ready",
      stepId: "session_created",
      stepStatus: "",
      fields: {
        body: "Body",
        title: "Title"
      }
    });

    assert.equal(saved.ok, false);
    assert.equal(saved.errors[0].code, "ai_studio_step_input_not_available");
  });
});

test("AI Studio artifacts service rejects stale current-step input", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      sessionId: "step_input_stale"
    });
    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const saved = await service.submitCurrentStepInput("step_input_stale", {
      kind: "ready",
      stepId: "issue_file_created",
      stepStatus: "confirm_files",
      fields: {
        body: "Body",
        title: "Title",
        word: "Title"
      }
    });

    assert.equal(saved.ok, false);
    assert.equal(saved.errors[0].code, "ai_studio_step_input_state_changed");
    assert.match(saved.errors[0].message, /Reload state/u);
    assert.equal(saved.currentStep, "issue_file_created");
    assert.equal(saved.stepStatus, "waiting_for_input");
    assert.equal(saved.expectedInput.title, "Define issue");
    assert.equal(saved.expectedInput.fields[0].name, "title");
  });
});

test("AI Studio current-step helper submits through the same server path", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      sessionId: "step_input_helper"
    });
    const projectService = projectServiceForRuntime(runtime);
    const session = await runtime.getSession("step_input_helper");
    const changedSessionIds = [];
    const helper = await prepareCurrentStepInputHelper({
      onSessionChanged: async (sessionId) => {
        changedSessionIds.push(sessionId);
      },
      projectService,
      session,
      targetRoot
    });

    const result = await runNodeScript(helper.env.AI_STUDIO_CURRENT_STEP_INPUT_HELPER, [
      "--json",
      JSON.stringify({
        fields: {
          body: "Create a booking dashboard.",
          title: "Add booking dashboard",
          word: "Booking"
        },
        kind: "ready",
        stepId: "issue_file_created",
        stepStatus: "waiting_for_input"
      })
    ], {
      ...helper.env,
      AI_STUDIO_CURRENT_STEP_INPUT_SOCKET: helperSocketHostPath(targetRoot)
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    const response = JSON.parse(result.stdout);
    assert.equal(response.ok, true);
    assert.equal(response.stepMachine.status, "confirm_files");
    assert.equal(await runtime.store.readArtifact("step_input_helper", "issue_title"), "Add booking dashboard\n");
    assert.deepEqual(changedSessionIds, ["step_input_helper"]);
  });
});

test("AI Studio current-step helper rejects stale state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      sessionId: "step_input_helper_stale"
    });
    const projectService = projectServiceForRuntime(runtime);
    const session = await runtime.getSession("step_input_helper_stale");
    const helper = await prepareCurrentStepInputHelper({
      projectService,
      session,
      targetRoot
    });

    const result = await runNodeScript(helper.env.AI_STUDIO_CURRENT_STEP_INPUT_HELPER, [
      "--json",
      JSON.stringify({
        fields: {
          body: "Body",
          title: "Title",
          word: "Title"
        },
        kind: "ready",
        stepId: "issue_file_created",
        stepStatus: "confirm_files"
      })
    ], {
      ...helper.env,
      AI_STUDIO_CURRENT_STEP_INPUT_SOCKET: helperSocketHostPath(targetRoot)
    });

    assert.equal(result.code, 1);
    const response = JSON.parse(result.stdout);
    assert.equal(response.ok, false);
    assert.equal(response.errors[0].code, "ai_studio_step_input_state_changed");
    assert.match(response.errors[0].message, /Reload state/u);
  });
});

test("AI Studio artifacts service lets issue command failures return to retry state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_issue_on_gh: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_submitted",
      sessionId: "step_input_issue_failure"
    });
    await Promise.all([
      runtime.store.writeArtifact("step_input_issue_failure", "issue_title", "Title\n"),
      runtime.store.writeArtifact("step_input_issue_failure", "issue_word", "Title\n"),
      runtime.store.writeArtifact("step_input_issue_failure", "issue.md", "Body\n")
    ]);
    await runtime.getSession("step_input_issue_failure");
    await runtime.recordCommandActionStarted("step_input_issue_failure", "create_issue_on_gh");
    await runtime.recordCommandActionFinished(
      await runtime.getSession("step_input_issue_failure"),
      "create_issue_on_gh",
      {
        message: "GitHub refused the issue.",
        status: "failed"
      }
    );
    const failedSession = await runtime.getSession("step_input_issue_failure");
    assert.equal(failedSession.stepMachine.status, "waiting_for_input");
    assert.equal(failedSession.actions.find((action) => action.id === "create_issue_on_gh").enabled, false);

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });
    const saved = await service.submitCurrentStepInput("step_input_issue_failure", {
      kind: "user_response",
      source: "ui",
      stepId: "issue_submitted",
      stepStatus: "waiting_for_input",
      text: "The GitHub CLI is authenticated now."
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.stepMachine.status, "ready");
    assert.equal(saved.actions.find((action) => action.id === "create_issue_on_gh").enabled, true);
  });
});

test("AI Studio artifacts service lets setup command failures return to retry state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "dependencies_installed",
      sessionId: "step_input_setup_failure"
    });
    await runtime.recordCommandActionStarted("step_input_setup_failure", "install_dependencies");
    await runtime.recordCommandActionFinished(
      await runtime.getSession("step_input_setup_failure"),
      "install_dependencies",
      {
        message: "npm install failed.",
        output: "EACCES",
        status: "failed"
      }
    );
    const failedSession = await runtime.getSession("step_input_setup_failure");
    assert.equal(failedSession.stepMachine.status, "waiting_for_input");
    assert.equal(failedSession.stepMachine.output, "EACCES");

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });
    const saved = await service.submitCurrentStepInput("step_input_setup_failure", {
      kind: "user_response",
      source: "ui",
      stepId: "dependencies_installed",
      stepStatus: "waiting_for_input",
      text: "Permissions are fixed."
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.stepMachine.status, "ready");
  });
});

test("AI Studio artifacts service keeps pull request command failures inside the pull request machine", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_pr_on_gh: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "create_pull_request",
      metadata: {
        branch_pushed: "ai-studio/test-pr"
      },
      sessionId: "step_input_pr_failure"
    });
    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });
    await service.submitCurrentStepInput("step_input_pr_failure", {
      fields: {
        body: "## Summary\nBody.\n",
        title: "Add feature"
      },
      kind: "ready",
      source: "codex",
      stepId: "create_pull_request",
      stepStatus: "awaiting_agent_result"
    });
    await runtime.recordCommandActionStarted("step_input_pr_failure", "create_pr_on_gh");
    await runtime.recordCommandActionFinished(
      await runtime.getSession("step_input_pr_failure"),
      "create_pr_on_gh",
      {
        message: "Branch was not pushed.",
        status: "failed"
      }
    );
    const failedSession = await runtime.getSession("step_input_pr_failure");
    assert.equal(failedSession.stepMachine.status, "waiting_for_input");
    assert.equal(failedSession.actions.find((action) => action.id === "create_pr_on_gh").enabled, false);

    const saved = await service.submitCurrentStepInput("step_input_pr_failure", {
      kind: "user_response",
      source: "ui",
      stepId: "create_pull_request",
      stepStatus: "waiting_for_input",
      text: "The branch has been pushed."
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.stepMachine.status, "confirm_files");
    assert.equal(saved.actions.find((action) => action.id === "create_pr_on_gh").enabled, true);
  });
});

test("AI Studio artifacts service reads live artifact readiness", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_executed",
      sessionId: "artifact_readiness"
    });
    await runtime.store.writeArtifact("artifact_readiness", "response.md", "Saved response.\n");

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const response = await service.readArtifactReadiness("artifact_readiness");
    assert.equal(response.ok, true);
    assert.equal(response.artifactReadiness["response.md"].nonEmpty, true);
  });
});

test("AI Studio artifacts service reads server-owned artifact previews by semantic id", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "report_created",
      sessionId: "artifact_invalid"
    });
    await runtime.store.writeArtifact("artifact_invalid", "report.md", "Report\n");
    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const report = await service.readArtifactPreview("artifact_invalid", {
      previewId: "report"
    });
    assert.equal(report.ok, true);
    assert.equal(report.text, "Report");
    assert.equal(report.previewId, "report");

    const unknown = await service.readArtifactPreview("artifact_invalid", {
      previewId: "unknown"
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.errors[0].code, "ai_studio_artifact_preview_not_available");
  });
});
