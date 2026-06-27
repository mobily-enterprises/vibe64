import assert from "node:assert/strict";
import test from "node:test";

import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  FakeTargetAdapter
} from "@local/vibe64-adapters/server";
import {
  createService
} from "../../packages/vibe64-artifacts/src/server/service.js";
import {
  registerRoutes
} from "../../packages/vibe64-artifacts/src/server/registerRoutes.js";
import {
  _testing as coreMaintenanceTesting
} from "@local/vibe64-runtime/server/workflowModules/coreMaintenance";
import { withTemporaryRoot, worktreeMetadata } from "./vibe64TestHelpers.js";
import {
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

const maintenanceWorkflowDefinitionIds = coreMaintenanceTesting.workflowDefinitionIds;

function projectServiceForRuntime(runtime) {
  return {
    async createRuntime() {
      return runtime;
    }
  };
}

function artifactsRouteApp(service) {
  const registeredRoutes = [];
  const websocketRoutes = [];
  return {
    registeredRoutes,
    websocketRoutes,
    make(token) {
      if (token === "jskit.http.router") {
        return {
          register(method, path, options, handler) {
            registeredRoutes.push({
              handler,
              method,
              options,
              path
            });
          }
        };
      }
      if (token === "jskit.fastify") {
        return {
          get(path, options, handler) {
            websocketRoutes.push({
              handler,
              options,
              path
            });
          }
        };
      }
      if (token === "feature.vibe64-artifacts.service") {
        return service;
      }
      throw new Error(`Unexpected app token: ${token}`);
    }
  };
}

function testSocket() {
  const handlers = {};
  const sent = [];
  return {
    closed: null,
    handlers,
    readyState: 1,
    sent,
    close(code, reason) {
      this.closed = {
        code,
        reason
      };
    },
    on(event, handler) {
      handlers[event] = handler;
    },
    send(payload) {
      sent.push(JSON.parse(payload));
    }
  };
}

async function waitForSocketMessages(socket, count) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (socket.sent.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("Vibe64 artifacts route streams readiness over WebSocket", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
      let streamClosed;
      const streamClosedPromise = new Promise((resolve) => {
        streamClosed = resolve;
      });
      const service = {
        streamArtifactReadiness(sessionId, { emit, isClosed, onClose }) {
          assert.equal(sessionId, "session-1");
          assert.equal(isClosed(), false);
          emit("artifact-readiness.updated", {
            artifactReadiness: {
              report: true
            },
            ok: true,
            sessionId
          });
          return new Promise((resolve) => {
            onClose(() => {
              streamClosed();
              resolve({
                ok: true
              });
            });
          });
        }
      };
      const app = artifactsRouteApp(service);
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });
      const route = app.websocketRoutes.find((registeredRoute) => {
        return registeredRoute.path === `${apiRouteBase}/vibe64/sessions/:sessionId/artifact-readiness/ws`;
      });
      assert.ok(route, "Expected artifact readiness WebSocket route.");
      assert.deepEqual(route.options, {
        websocket: true
      });

      const socket = testSocket();
      route.handler(socket, {
        headers: {},
        ip: "10.0.0.8",
        params: {
          sessionId: "session-1",
          slug
        }
      });
      await waitForSocketMessages(socket, 1);
      assert.deepEqual(socket.sent, [
        {
          artifactReadiness: {
            report: true
          },
          ok: true,
          sessionId: "session-1",
          type: "artifact-readiness.updated"
        }
      ]);

      socket.handlers.close();
      await streamClosedPromise;
    });
  });
});

test("Vibe64 artifacts service saves semantic issue step input", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_issue_on_gh: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        github_issue_mode: "create"
      },
      sessionId: "step_input_issue"
    });

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const saved = await service.submitCurrentStepInput("step_input_issue", {
      kind: "ready",
      source: "ui",
      stepId: "issue_file_created",
      stepStatus: "ready",
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
    assert.equal(await runtime.store.readArtifact("step_input_issue", "work_title"), "Add booking dashboard\n");
    assert.equal(await runtime.store.readArtifact("step_input_issue", "work_word"), "Booking\n");
    assert.equal(await runtime.store.readArtifact("step_input_issue", "work.md"), "Create a booking dashboard.\n");
    assert.equal(await runtime.store.readMetadataValue("step_input_issue", "issue_title"), "Add booking dashboard");
    assert.equal(await runtime.store.readMetadataValue("step_input_issue", "issue_word"), "Booking");
    assert.equal(await runtime.store.readMetadataValue("step_input_issue", "work_title"), "Add booking dashboard");
    assert.equal(await runtime.store.readMetadataValue("step_input_issue", "work_word"), "Booking");

    const updatedSession = await runtime.getSession("step_input_issue");
    assert.equal(updatedSession.sessionName, "Booking");
    assert.equal(updatedSession.stepMachine.status, "confirm_files");
    assert.equal(updatedSession.next.enabled, false);
    assert.equal(updatedSession.next.stepId, "plan_and_execute");
    const conversationLog = await runtime.store.readConversationLog("step_input_issue");
    assert.deepEqual(conversationLog.map((turn) => [
      turn.user?.text || "",
      turn.assistant?.text || ""
    ]), [
      [
        [
          "Saved issue draft.",
          "",
          "Issue title:",
          "Add booking dashboard",
          "",
          "Session label:",
          "Booking",
          "",
          "Issue body:",
          "Create a booking dashboard."
        ].join("\n"),
        ""
      ]
    ]);
  });
});

test("Vibe64 artifacts service saves semantic pull request step input", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_pr_on_gh: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: worktreeMetadata(targetRoot, "step_input_pr"),
      sessionId: "step_input_pr"
    });
    await runtime.runAction("step_input_pr", "resolve_pull_request", {});
    await runtime.store.writeConversationUserMessage("step_input_pr", {
      text: "Draft the pull request."
    });

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const saved = await service.submitCurrentStepInput("step_input_pr", {
      kind: "ready",
      source: "codex",
      stepId: "create_and_merge_pull_request",
      stepStatus: "awaiting_agent_result",
      fields: {
        title: "Add booking dashboard",
        body: "## Summary\nCreate the booking dashboard.\n"
      }
    });

    assert.equal(saved.ok, true);
    assert.equal(
      await runtime.store.readArtifact("step_input_pr", "tmp/create_and_merge_pull_request.title.txt"),
      "Add booking dashboard\n"
    );
    assert.equal(
      await runtime.store.readArtifact("step_input_pr", "tmp/create_and_merge_pull_request.body.md"),
      "## Summary\nCreate the booking dashboard.\n"
    );
    const updatedSession = await runtime.getSession("step_input_pr");
    assert.equal(updatedSession.stepMachine.status, "confirm_files");
    const conversationLog = await runtime.store.readConversationLog("step_input_pr");
    assert.deepEqual(conversationLog.map((turn) => [
      turn.user?.text || "",
      turn.assistant?.text || ""
    ]), [
      [
        "Draft the pull request.",
        [
          "Proposed pull request draft.",
          "",
          "Title:",
          "Add booking dashboard",
          "",
          "Body:",
          "## Summary",
          "Create the booking dashboard."
        ].join("\n")
      ]
    ]);
  });
});

test("Vibe64 artifacts service appends agent responses to the conversation log", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      sessionId: "agent_conversation_log",
      workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
    });
    await runtime.store.writeConversationUserMessage("agent_conversation_log", {
      text: "What should we improve?"
    });

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const saved = await service.submitCurrentStepInput("agent_conversation_log", {
      fields: {
        response: "Tighten the Autopilot conversation panel."
      },
      kind: "ready",
      source: "codex",
      stepId: "maintenance_conversation",
      stepStatus: "ready"
    });

    const conversationLog = await runtime.store.readConversationLog("agent_conversation_log");
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

test("Vibe64 artifacts service closes structured Codex agent turns in the conversation log", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: worktreeMetadata(targetRoot, "structured_agent_conversation_log"),
      sessionId: "structured_agent_conversation_log"
    });
    await runtime.runAction("structured_agent_conversation_log", "draft_issue", {
      conversationRequest: "Create a file called P.txt in the project root."
    });
    await runtime.store.writeConversationUserMessage("structured_agent_conversation_log", {
      text: "Create a file called P.txt in the project root."
    });

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const saved = await service.submitCurrentStepInput("structured_agent_conversation_log", {
      fields: {
        body: "Create an empty file named p.txt in the project root.",
        title: "Create lowercase p.txt",
        word: "p"
      },
      kind: "ready",
      source: "codex",
      stepId: "issue_file_created",
      stepStatus: "awaiting_agent_result"
    });

    const conversationLog = await runtime.store.readConversationLog("structured_agent_conversation_log");
    assert.equal(saved.ok, true);
    assert.deepEqual(conversationLog.map((turn) => [
      turn.user?.text || "",
      turn.assistant?.text || ""
    ]), [
      [
        "Create a file called P.txt in the project root.",
        [
          "Proposed work description.",
          "",
          "Work title:",
          "Create lowercase p.txt",
          "",
          "Session label:",
          "p",
          "",
          "Work description:",
          "Create an empty file named p.txt in the project root."
        ].join("\n")
      ]
    ]);
  });
});

test("Vibe64 artifacts service records step-owned completion messages for prompt-only steps", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: worktreeMetadata(targetRoot, "plan_completion_conversation_log"),
      sessionId: "plan_completion_conversation_log"
    });
    await runtime.runAction("plan_completion_conversation_log", "make_plan");
    await runtime.store.writeConversationUserMessage("plan_completion_conversation_log", {
      text: "Make the plan."
    });

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const saved = await service.submitCurrentStepInput("plan_completion_conversation_log", {
      kind: "ready",
      source: "codex",
      stepId: "plan_and_execute",
      stepStatus: "awaiting_agent_result"
    });

    const conversationLog = await runtime.store.readConversationLog("plan_completion_conversation_log");
    assert.equal(saved.ok, true);
    assert.deepEqual(conversationLog.map((turn) => [
      turn.user?.text || "",
      turn.assistant?.text || ""
    ]), [
      [
        "Make the plan.",
        "Plan submitted for review."
      ]
    ]);
  });
});

test("Vibe64 artifacts service rejects UI input while a step waits for Codex", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_pr_on_gh: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: worktreeMetadata(targetRoot, "step_input_pr_ui_waiting"),
      sessionId: "step_input_pr_ui_waiting"
    });
    await runtime.runAction("step_input_pr_ui_waiting", "resolve_pull_request", {});

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
      stepId: "create_and_merge_pull_request",
      stepStatus: "awaiting_agent_result"
    });

    assert.equal(saved.ok, false);
    assert.equal(saved.errors[0].code, "vibe64_step_input_state_changed");
    assert.match(saved.errors[0].message, /waiting for the agent/u);
    assert.equal(saved.operationOutcome, "stale_operation");
    assert.equal(saved.refreshRecommended, true);
    assert.equal(saved.details.operationOutcome, "stale_operation");
    assert.equal(saved.details.refreshRecommended, true);
  });
});

test("Vibe64 artifacts service rejects semantic step input on steps without an input contract", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
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
    assert.equal(saved.errors[0].code, "vibe64_step_input_not_available");
  });
});

test("Vibe64 artifacts service rejects stale current-step input", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
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
    assert.equal(saved.errors[0].code, "vibe64_step_input_state_changed");
    assert.match(saved.errors[0].message, /Reload state/u);
    assert.equal(saved.operationOutcome, "stale_operation");
    assert.equal(saved.refreshRecommended, true);
    assert.equal(saved.currentStep, "issue_file_created");
    assert.equal(saved.stepStatus, "ready");
    assert.equal(saved.expectedInput, null);
    assert.equal(saved.details.currentStep, "issue_file_created");
    assert.equal(saved.details.stepStatus, "ready");
  });
});

test("Vibe64 artifacts service lets issue command failures return to retry state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_issue_on_gh: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        github_issue_mode: "create",
        work_source: "new_issue"
      },
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
      stepId: "issue_file_created",
      stepStatus: "waiting_for_input",
      text: "The GitHub CLI is authenticated now."
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.stepMachine.status, "confirm_files");
    assert.equal(saved.actions.find((action) => action.id === "create_issue_on_gh").enabled, true);
  });
});

test("Vibe64 artifacts service lets setup command failures return to retry state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
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

test("Vibe64 artifacts service keeps pull request command failures inside the pull request machine", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_pr_on_gh: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        ...worktreeMetadata(targetRoot, "step_input_pr_failure"),
        branch_pushed: "vibe64/test-pr"
      },
      sessionId: "step_input_pr_failure"
    });
    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });
    await runtime.runAction("step_input_pr_failure", "resolve_pull_request", {});
    await service.submitCurrentStepInput("step_input_pr_failure", {
      fields: {
        body: "## Summary\nBody.\n",
        title: "Add feature"
      },
      kind: "ready",
      source: "codex",
      stepId: "create_and_merge_pull_request",
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
      stepId: "create_and_merge_pull_request",
      stepStatus: "waiting_for_input",
      text: "The branch has been pushed."
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.stepMachine.status, "confirm_files");
    assert.equal(saved.actions.find((action) => action.id === "create_pr_on_gh").enabled, true);
  });
});

test("Vibe64 artifacts service reads live artifact readiness", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
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

test("Vibe64 artifacts service reads server-owned artifact previews by semantic id", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "report_and_update_knowledge",
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
    assert.equal(unknown.errors[0].code, "vibe64_artifact_preview_not_available");
  });
});
