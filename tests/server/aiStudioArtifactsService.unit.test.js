import assert from "node:assert/strict";
import test from "node:test";

import {
  AiStudioSessionRuntime,
  FakeTargetAdapter
} from "../../server/lib/aiStudio/index.js";
import {
  AUTOPILOT_ISSUE_DRAFT_ARTIFACT,
  AUTOPILOT_PROMPT_DONE_ARTIFACT,
  AUTOPILOT_QUESTIONS_ARTIFACT
} from "../../server/lib/aiStudio/autopilotFiles.js";
import {
  createService
} from "../../packages/ai-studio-artifacts/src/server/service.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

function projectServiceForRuntime(runtime) {
  return {
    async createRuntime() {
      return runtime;
    }
  };
}

test("AI Studio artifacts service reads and saves editable issue artifacts", async () => {
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
      sessionId: "artifact_issue"
    });
    await runtime.store.writeArtifact("artifact_issue", "issue_title", "Original title\n");
    await runtime.store.writeArtifact("artifact_issue", "issue.md", "Original body\n");

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const initial = await service.readArtifacts("artifact_issue", {
      actionId: "edit_issue"
    });
    assert.equal(initial.ok, true);
    assert.deepEqual(initial.artifactFields.map((field) => field.name), [
      "issue_title",
      "issue.md"
    ]);
    assert.equal(initial.artifactStates["issue.md"].editable, true);
    assert.equal(initial.artifactStates.issue_title.editable, true);
    assert.equal(initial.artifacts.issue_title, "Original title\n");

    const saved = await service.saveArtifacts("artifact_issue", {
      actionId: "edit_issue",
      artifacts: {
        "issue.md": "Updated body",
        issue_title: "Updated title"
      }
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.artifacts["issue.md"], "Updated body\n");
    assert.equal(saved.artifacts.issue_title, "Updated title\n");
    assert.equal(await runtime.store.readMetadataValue("artifact_issue", "issue_title"), "Updated title");

    await runtime.store.writeMetadataValue("artifact_issue", "issue_url", "https://github.com/example/repo/issues/1");
    const blocked = await service.saveArtifacts("artifact_issue", {
      actionId: "edit_issue",
      artifacts: {
        "issue.md": "Changed after submit"
      }
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errors[0].code, "ai_studio_artifact_edit_not_available");
    assert.match(blocked.errors[0].message, /already exists/u);
  });
});

test("AI Studio artifacts service saves autopilot issue artifacts before issue submission", async () => {
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
      sessionId: "artifact_autopilot_issue"
    });

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const saved = await service.saveIssueArtifacts("artifact_autopilot_issue", {
      body: "Create a booking dashboard.",
      title: "Add booking dashboard"
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.artifacts.issue_title, "Add booking dashboard\n");
    assert.equal(saved.artifacts["issue.md"], "Create a booking dashboard.\n");
    assert.equal(await runtime.store.readArtifact("artifact_autopilot_issue", "issue_title"), "Add booking dashboard\n");
    assert.equal(await runtime.store.readArtifact("artifact_autopilot_issue", "issue.md"), "Create a booking dashboard.\n");
    assert.equal(await runtime.store.readMetadataValue("artifact_autopilot_issue", "issue_title"), "Add booking dashboard");

    const updatedSession = await runtime.getSession("artifact_autopilot_issue");
    assert.equal(updatedSession.next.enabled, true);
    assert.equal(updatedSession.next.stepId, "issue_submitted");
  });
});

test("AI Studio artifacts service clears autopilot issue artifacts before issue submission", async () => {
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
      sessionId: "artifact_autopilot_issue_clear"
    });
    await runtime.store.writeArtifact("artifact_autopilot_issue_clear", "issue_title", "Draft title\n");
    await runtime.store.writeArtifact("artifact_autopilot_issue_clear", "issue.md", "Draft body\n");
    await runtime.store.writeMetadataValue("artifact_autopilot_issue_clear", "issue_title", "Draft title");

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const cleared = await service.clearIssueArtifacts("artifact_autopilot_issue_clear");

    assert.equal(cleared.ok, true);
    assert.equal(await runtime.store.readArtifact("artifact_autopilot_issue_clear", "issue_title"), "");
    assert.equal(await runtime.store.readArtifact("artifact_autopilot_issue_clear", "issue.md"), "");
    assert.equal(await runtime.store.readMetadataValue("artifact_autopilot_issue_clear", "issue_title"), "");
  });
});

test("AI Studio artifacts service only saves autopilot issue artifacts at the issue definition step", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_submitted",
      sessionId: "artifact_autopilot_wrong_step"
    });
    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const saved = await service.saveIssueArtifacts("artifact_autopilot_wrong_step", {
      body: "Body",
      title: "Title"
    });

    assert.equal(saved.ok, false);
    assert.equal(saved.errors[0].code, "ai_studio_issue_artifacts_step_required");
  });
});

test("AI Studio artifacts service reads and clears Autopilot control files", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_executed",
      sessionId: "artifact_autopilot_files"
    });
    await Promise.all([
      runtime.store.writeArtifact("artifact_autopilot_files", AUTOPILOT_QUESTIONS_ARTIFACT, JSON.stringify({
        requestId: "request-123",
        questions: [
          "Which table should this use?",
          {
            id: "auth",
            text: "Should this require authentication?"
          }
        ]
      })),
      runtime.store.writeArtifact("artifact_autopilot_files", AUTOPILOT_ISSUE_DRAFT_ARTIFACT, JSON.stringify({
        body: "Issue body",
        requestId: "request-123",
        title: "Issue title"
      })),
      runtime.store.writeArtifact("artifact_autopilot_files", AUTOPILOT_PROMPT_DONE_ARTIFACT, JSON.stringify({
        actionId: "execute_plan",
        completionToken: "AI_STUDIO_AUTOPILOT_DONE_1234567890abcdef1234567890abcdef",
        requestId: "request-123",
        stepId: "plan_executed"
      }))
    ]);

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const files = await service.readAutopilotArtifacts("artifact_autopilot_files");
    assert.equal(files.ok, true);
    assert.deepEqual(files.questions, {
      requestId: "request-123",
      questions: [
        {
          answer: "",
          id: "q1",
          text: "Which table should this use?"
        },
        {
          answer: "",
          id: "auth",
          text: "Should this require authentication?"
        }
      ]
    });
    assert.deepEqual(files.issueDraft, {
      body: "Issue body",
      requestId: "request-123",
      title: "Issue title"
    });
    assert.deepEqual(files.promptDone, {
      actionId: "execute_plan",
      completionToken: "AI_STUDIO_AUTOPILOT_DONE_1234567890abcdef1234567890abcdef",
      requestId: "request-123",
      stepId: "plan_executed"
    });

    const cleared = await service.clearAutopilotArtifacts("artifact_autopilot_files");
    assert.equal(cleared.ok, true);
    assert.equal(cleared.questions, null);
    assert.equal(cleared.issueDraft, null);
    assert.equal(cleared.promptDone, null);
    assert.equal(await runtime.store.readArtifact("artifact_autopilot_files", AUTOPILOT_QUESTIONS_ARTIFACT), "");
    assert.equal(await runtime.store.readArtifact("artifact_autopilot_files", AUTOPILOT_ISSUE_DRAFT_ARTIFACT), "");
    assert.equal(await runtime.store.readArtifact("artifact_autopilot_files", AUTOPILOT_PROMPT_DONE_ARTIFACT), "");
  });
});

test("AI Studio artifacts service rejects unknown or empty artifact saves", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_submitted",
      sessionId: "artifact_invalid"
    });
    await runtime.store.writeArtifact("artifact_invalid", "issue_title", "Title\n");
    await runtime.store.writeArtifact("artifact_invalid", "issue.md", "Body\n");
    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const empty = await service.saveArtifacts("artifact_invalid", {
      actionId: "edit_issue",
      artifacts: {}
    });
    assert.equal(empty.ok, false);
    assert.equal(empty.errors[0].code, "ai_studio_artifacts_required");

    const unknown = await service.saveArtifacts("artifact_invalid", {
      actionId: "edit_issue",
      artifacts: {
        "notes.txt": "No"
      }
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.errors[0].code, "ai_studio_artifact_not_editable");
  });
});

test("AI Studio artifacts service uses pull-request editor descriptors", async () => {
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
      initialStep: "pr_created",
      sessionId: "artifact_pr"
    });
    await runtime.store.writeArtifact("artifact_pr", "pull_request.md", "Original PR body\n");

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const initial = await service.readArtifacts("artifact_pr", {
      actionId: "edit_pr"
    });
    assert.equal(initial.ok, true);
    assert.deepEqual(initial.artifactFields.map((field) => field.name), [
      "pull_request.md"
    ]);
    assert.equal(initial.artifacts["pull_request.md"], "Original PR body\n");

    const saved = await service.saveArtifacts("artifact_pr", {
      actionId: "edit_pr",
      artifacts: {
        "pull_request.md": "Updated PR body"
      }
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.artifacts["pull_request.md"], "Updated PR body\n");
  });
});
