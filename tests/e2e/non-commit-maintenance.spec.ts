import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import {
  AiStudioSessionRuntime,
  FakeTargetAdapter
} from "../../server/lib/aiStudio/index.js";
import { BASE_URL } from "./support/base-shell-data";
import {
  mockProtectedRouteReady,
  mockTargetScripts
} from "./support/base-shell/setup-mocks";
import { fulfillJson } from "./support/base-shell/http";

const RESPONSE_ARTIFACT = "response.md";
const RESPONSE_TEXT = "Codex saved this maintenance answer for the user.";
const REALLY_RESPONSE_TEXT = "Really. This is the previous maintenance answer.";
const QUESTION_RESPONSE_TEXT = "Answers noted: Pescara is a strong food answer.";
const RESPONSE_MARKDOWN = `## Summary

${RESPONSE_TEXT}

- First maintenance note
- Second maintenance note
`;
const REALLY_RESPONSE_MARKDOWN = `${REALLY_RESPONSE_TEXT}\n`;
const QUESTION_RESPONSE_MARKDOWN = `## Answers noted

${QUESTION_RESPONSE_TEXT}

- Automation: not much.
- Food revisit: Pescara.
- Respected skill: guitar.
`;
const RANDOM_QUESTIONS = [
  "What is one small thing you would happily automate if it took less than a day?",
  "Which place would you revisit just for the food?",
  "What is a skill you respect but have no interest in learning yourself?"
];
const SESSION_ID = "agent-chat-session";

test.describe("non-commit maintenance agent chat", () => {
  let targetRoot = "";
  let runtime: AiStudioSessionRuntime;

  test.beforeEach(async ({ page }) => {
    targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-studio-agent-chat-"));
    runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_worktree: true,
          install_dependencies: true
        },
        id: "jskit",
        label: "JSKIT"
      }),
      clock: () => new Date("2026-05-22T01:02:03.000Z"),
      targetRoot
    });
    await mockProtectedRouteReady(page);
    await mockTargetScripts(page);
    await mockAgentChatBrowserPrimitives(page);
    await mockAgentChatRoutes(page, runtime);
  });

  test.afterEach(async () => {
    if (targetRoot) {
      await rm(targetRoot, {
        force: true,
        recursive: true
      });
    }
  });

  test("runs the agent chat profile in Autopilot and displays the saved answer artifact", async ({ page }) => {
    await page.goto(`${BASE_URL}/home`);
    await createNonCommitMaintenanceSession(page);

    await expect(page.getByRole("heading", { name: "Talk to Codex" })).toBeVisible();
    await page.getByLabel("What do you want to ask Codex?").fill("Tell me what maintenance is needed.");
    await page.getByRole("button", { name: "Ask Codex" }).click();

    await expectMarkdownResponsePreview(page);
    await expectNoBrowserCodexTerminalInput(page);
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "Congratulations!" })).toBeVisible();
  });

  test("updates the Autopilot answer after Codex clarification questions", async ({ page }) => {
    await page.goto(`${BASE_URL}/home`);
    await createNonCommitMaintenanceSession(page);

    await expect(page.getByRole("heading", { name: "Talk to Codex" })).toBeVisible();

    await page.getByLabel("What do you want to ask Codex?").fill("Really?");
    await page.getByRole("button", { name: "Ask Codex" }).click();
    await expectMarkdownResponsePreview(page, REALLY_RESPONSE_TEXT);

    await page.getByLabel("What do you want to ask Codex?").fill("Ask me three random questions.");
    await page.getByRole("button", { name: "Ask Codex" }).click();

    const autopilot = page.locator(".studio-autopilot");
    await expect(autopilot.getByText("Answer these before continuing.")).toBeVisible();
    await autopilot.getByRole("textbox", { name: "Response" }).fill([
      "Q1: not much",
      "Q2: Pescara",
      "Q3: guitar"
    ].join("\n"));
    await autopilot.getByRole("button", { name: "Send to Codex" }).click();

    const responseRegion = await expectMarkdownResponsePreview(page, QUESTION_RESPONSE_TEXT);
    await expectNoBrowserCodexTerminalInput(page);
    await expect(responseRegion).not.toContainText(REALLY_RESPONSE_TEXT);
  });

  test("runs the agent chat profile in Inspect and displays the same saved answer artifact", async ({ page }) => {
    await page.goto(`${BASE_URL}/home?mode=inspect`);
    await createNonCommitMaintenanceSession(page);

    await page.getByRole("button", { name: "Create worktree" }).click();
    await expect(page.getByText("Create worktree finished.")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByRole("button", { name: "Install checklist items" }).click();
    await expect(page.getByText("Install checklist items finished.")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByRole("button", { name: "Ask Codex" }).click();
    const inputDialog = page.getByRole("dialog").filter({
      hasText: "Ask Codex"
    });
    await expect(inputDialog).toBeVisible();
    await inputDialog.getByLabel("What do you want to ask Codex?").fill("Explain this local maintenance task.");
    await inputDialog.getByRole("button", { name: "Continue" }).click();

    await expectMarkdownResponsePreview(page);
    await expectNoBrowserCodexTerminalInput(page);
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();

    await page.getByRole("button", { name: "Quit inspect" }).click();
    await expectMarkdownResponsePreview(page);
    await expectNoBrowserCodexTerminalInput(page);
  });
});

async function expectMarkdownResponsePreview(page: Page, expectedText = RESPONSE_TEXT) {
  const responseRegion = page.getByRole("region", { name: "AI response" });
  await expect(responseRegion).toContainText(expectedText);
  if (expectedText === RESPONSE_TEXT) {
    await expect(responseRegion.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(responseRegion.getByRole("listitem").filter({ hasText: "First maintenance note" })).toBeVisible();
  }
  if (expectedText === QUESTION_RESPONSE_TEXT) {
    await expect(responseRegion.getByRole("heading", { name: "Answers noted" })).toBeVisible();
  }
  return responseRegion;
}

async function expectNoBrowserCodexTerminalInput(page: Page) {
  await expect.poll(async () => page.evaluate(() => (
    (window as unknown as { __aiStudioCodexTerminalInputs?: string[] }).__aiStudioCodexTerminalInputs || []
  ))).toEqual([]);
}

async function createNonCommitMaintenanceSession(page: Page) {
  await page.getByRole("button", { name: "New Session" }).click();
  await page.getByText("Non-commit maintenance", {
    exact: true
  }).click();
}

async function mockAgentChatRoutes(page: Page, runtime: AiStudioSessionRuntime) {
  async function pushArtifactReadiness(sessionId: string) {
    const payload = await artifactReadinessPayload(runtime, sessionId);
    await page.evaluate((payload) => {
      (window as unknown as {
        __studioPushArtifactReadiness: (payload: unknown) => void;
      }).__studioPushArtifactReadiness(payload);
    }, payload).catch(() => null);
  }

  await page.route("**/api/ai-studio/sessions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const parts = url.pathname.split("/").filter(Boolean);
    const sessionId = parts[3] || "";
    const tail = parts.slice(4);

    if (method === "GET" && url.pathname === "/api/ai-studio/sessions") {
      await fulfillJson(route, await sessionListPayload(runtime));
      return;
    }

    if (method === "GET" && sessionId && tail.length === 0) {
      await fulfillJson(route, await runtime.getSession(sessionId));
      return;
    }

    if (method === "POST" && url.pathname === "/api/ai-studio/sessions") {
      const created = await runtime.createSession({
        sessionId: SESSION_ID,
        workflowProfile: String(request.postDataJSON()?.workflowProfile || "")
      });
      await fulfillJson(route, await runtime.advance(created.sessionId));
      return;
    }

    if (method === "POST" && tail[0] === "advance") {
      await fulfillJson(route, await runtime.advance(sessionId));
      return;
    }

    if (method === "POST" && tail[0] === "actions") {
      const actionInput = request.postDataJSON() || {};
      const response = await runtime.runAction(sessionId, tail[1], actionInput);
      if (tail[1] === "agent_conversation") {
        const session = await runtime.getSession(sessionId);
        const priorResponse = String(session.stepMachine?.response || "");
        if (priorResponse.includes("Pescara")) {
          await writeAgentResponse(
            runtime,
            sessionId,
            QUESTION_RESPONSE_MARKDOWN
          );
        } else if (String(actionInput.conversationRequest || "").toLowerCase().includes("three random questions")) {
          await writeAgentQuestions(runtime, sessionId);
        } else {
          await writeAgentResponse(
            runtime,
            sessionId,
            responseMarkdownForRequest(actionInput.conversationRequest)
          );
        }
        await fulfillJson(route, {
          ...await runtime.getSession(sessionId),
          actionResult: response.actionResult
        });
        await pushArtifactReadiness(sessionId);
        return;
      }
      await fulfillJson(route, response);
      return;
    }

    if (method === "POST" && tail[0] === "intents") {
      const intentInput = request.postDataJSON() || {};
      const response = await runtime.runIntent(sessionId, tail[1], intentInput);
      if (tail[1] === "talk_to_codex") {
        const fields = intentInput.fields && typeof intentInput.fields === "object"
          ? intentInput.fields
          : {};
        if (String(fields.conversationRequest || "").includes("Pescara")) {
          await writeAgentResponse(
            runtime,
            sessionId,
            QUESTION_RESPONSE_MARKDOWN
          );
        } else if (String(fields.conversationRequest || "").toLowerCase().includes("three random questions")) {
          await writeAgentQuestions(runtime, sessionId);
        } else {
          await writeAgentResponse(
            runtime,
            sessionId,
            responseMarkdownForRequest(fields.conversationRequest)
          );
        }
        await fulfillJson(route, {
          ...await runtime.getSession(sessionId),
          actionResult: response.actionResult
        });
        await pushArtifactReadiness(sessionId);
        return;
      }
      await fulfillJson(route, response);
      return;
    }

    if (method === "POST" && tail[0] === "current-step" && tail[1] === "input") {
      const input = request.postDataJSON() || {};
      const response = await runtime.submitCurrentStepInput(sessionId, input);
      await fulfillJson(route, response);
      await pushArtifactReadiness(sessionId);
      return;
    }

    if (method === "GET" && tail[0] === "artifact-preview") {
      await fulfillJson(route, await artifactPreviewPayload(runtime, sessionId, String(url.searchParams.get("previewId") || "")));
      return;
    }

    if (method === "GET" && tail[0] === "launch-targets") {
      await fulfillJson(route, {
        launchTargets: [],
        ok: true,
        openTarget: {
          available: false,
          disabledReason: "Run a launch target first.",
          href: "",
          kind: "url",
          label: "Open browser"
        },
        sessionId
      });
      return;
    }

    if (method === "GET" && tail[0] === "artifact-readiness") {
      await fulfillJson(route, await artifactReadinessPayload(runtime, sessionId));
      return;
    }

    if (method === "GET" && tail[0] === "artifact-readiness" && tail[1] === "stream") {
      await fulfillJson(route, await artifactReadinessPayload(runtime, sessionId));
      return;
    }

    if (method === "POST" && tail[0] === "command-terminal") {
      const input = request.postDataJSON() || {};
      const actionId = String(input.actionId || "");
      await applyCommandResult(runtime, sessionId, actionId);
      if (input.advanceOnSuccess === true) {
        await advanceSessionIfReady(runtime, sessionId);
      }
      await fulfillJson(route, {
        commandPreview: actionId,
        id: `cmd-${actionId}`,
        ok: true,
        output: `${actionLabel(actionId)} started.\n`,
        status: "running"
      });
      return;
    }

    if (method === "DELETE" && tail[0] === "command-terminal") {
      await fulfillJson(route, {
        closed: true,
        ok: true
      });
      return;
    }

    if (method === "POST" && tail[0] === "codex-terminal") {
      await fulfillJson(route, {
        commandPreview: "codex",
        id: `codex-${sessionId}`,
        ok: true,
        output: "Codex ready.",
        status: "running"
      });
      return;
    }

    if (method === "DELETE" && tail[0] === "codex-terminal") {
      await fulfillJson(route, {
        closed: true,
        ok: true
      });
      return;
    }

    throw new Error(`Agent chat spec does not mock ${method} ${url.pathname}.`);
  });
}

async function sessionListPayload(runtime: AiStudioSessionRuntime) {
  const sessions = await runtime.listSessions();
  const creation = await runtime.workflowProfileCreationOptions();
  const openSessionCount = sessions.filter((session) => !["abandoned", "finished"].includes(String(session.status || ""))).length;
  return {
    creation: {
      ...creation,
      canCreate: true,
      disabledReason: ""
    },
    limits: {
      maxOpenSessions: 5,
      openSessionCount
    },
    ok: true,
    sessions
  };
}

async function applyCommandResult(runtime: AiStudioSessionRuntime, sessionId: string, actionId: string) {
  if (actionId === "create_worktree") {
    await runtime.store.writeMetadataValue(sessionId, "worktree_path", path.join(runtime.targetRoot, ".ai-studio/worktree"));
  }
  if (actionId === "install_dependencies") {
    await runtime.store.writeMetadataValue(sessionId, "dependencies_installed", "yes");
    await runtime.store.writeMetadataValue(sessionId, "dependencies_path", runtime.targetRoot);
  }
}

async function advanceSessionIfReady(runtime: AiStudioSessionRuntime, sessionId: string) {
  const session = await runtime.getSession(sessionId);
  if (session.next?.visible === true && session.next.enabled === true && session.next.stepId) {
    await runtime.advance(sessionId);
  }
}

async function writeAgentResponse(
  runtime: AiStudioSessionRuntime,
  sessionId: string,
  markdown = RESPONSE_MARKDOWN
) {
  const session = await runtime.getSession(sessionId);
  await runtime.submitCurrentStepInput(sessionId, {
    fields: {
      response: markdown
    },
    kind: "ready",
    source: "codex",
    stepId: session.currentStep,
    stepStatus: session.stepMachine?.status || ""
  });
}

async function writeAgentQuestions(runtime: AiStudioSessionRuntime, sessionId: string) {
  const session = await runtime.getSession(sessionId);
  await runtime.submitCurrentStepInput(sessionId, {
    kind: "waiting_for_input",
    message: [
      "Answer these before continuing.",
      "",
      ...RANDOM_QUESTIONS.map((question, index) => `[Q${index + 1}] ${question}`)
    ].join("\n"),
    source: "codex",
    stepId: session.currentStep,
    stepStatus: session.stepMachine?.status || ""
  });
}

function responseMarkdownForRequest(conversationRequest = "") {
  return String(conversationRequest || "").toLowerCase().includes("really")
    ? REALLY_RESPONSE_MARKDOWN
    : RESPONSE_MARKDOWN;
}

async function artifactPreviewPayload(runtime: AiStudioSessionRuntime, sessionId: string, previewId: string) {
  const session = await runtime.getSession(sessionId);
  const text = previewId === "ai_response"
    ? await runtime.store.readArtifact(sessionId, RESPONSE_ARTIFACT)
    : "";
  return {
    ...session,
    previewId,
    text: text.trim(),
    ok: true
  };
}

async function artifactReadinessPayload(runtime: AiStudioSessionRuntime, sessionId: string) {
  const session = await runtime.getSession(sessionId);
  return {
    artifactReadiness: session.artifactReadiness,
    ok: true,
    sessionId
  };
}

async function mockAgentChatBrowserPrimitives(page: Page) {
  await page.addInitScript(() => {
    const OriginalEventSource = window.EventSource;
    const OriginalWebSocket = window.WebSocket;
    const eventSourcesBySessionId: Record<string, EventTarget[]> = {};
    (window as unknown as {
      __aiStudioCodexTerminalInputs: string[];
    }).__aiStudioCodexTerminalInputs = [];

    class MockEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      readyState = MockEventSource.CONNECTING;
      sessionId = "";
      url = "";

      constructor(url) {
        super();
        this.url = String(url || "");
        const pathname = new URL(this.url, window.location.href).pathname;
        const match = /\/sessions\/([^/]+)\/artifact-readiness\/stream/u.exec(pathname);
        if (!match) {
          return new OriginalEventSource(url);
        }
        this.sessionId = decodeURIComponent(match[1]);
        eventSourcesBySessionId[this.sessionId] ||= [];
        eventSourcesBySessionId[this.sessionId].push(this);
        window.setTimeout(() => {
          this.readyState = MockEventSource.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
        eventSourcesBySessionId[this.sessionId] = (eventSourcesBySessionId[this.sessionId] || [])
          .filter((source) => source !== this);
      }
    }

    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = MockWebSocket.CONNECTING;
      actionLabel = "Command";
      sessionId = "";
      terminalKind = "";
      url = "";

      constructor(url) {
        super();
        this.url = String(url || "");
        const pathname = new URL(this.url, window.location.href).pathname;
        if (pathname.includes("/command-terminal/")) {
          this.terminalKind = "command";
          const match = /\/command-terminal\/([^/]+)\/ws/u.exec(pathname);
          const terminalId = match ? decodeURIComponent(match[1]) : "";
          if (terminalId.includes("create_worktree")) {
            this.actionLabel = "Create worktree";
          }
          if (terminalId.includes("install_dependencies")) {
            this.actionLabel = "Install checklist items";
          }
        } else if (pathname.includes("/codex-terminal/")) {
          this.terminalKind = "codex";
          const match = /\/sessions\/([^/]+)\/codex-terminal\/([^/]+)\/ws/u.exec(pathname);
          this.sessionId = match ? decodeURIComponent(match[1]) : "";
        } else {
          return new OriginalWebSocket(url);
        }
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          if (this.terminalKind === "command") {
            this.emit({
              session: {
                commandPreview: "command",
                ok: true,
                output: "",
                status: "running"
              },
              type: "snapshot"
            });
            window.setTimeout(() => {
              this.emit({
                chunk: `${this.actionLabel} finished.\n`,
                type: "output"
              });
              this.emit({
                exitCode: 0,
                status: "exited",
                type: "status"
              });
            }, 20);
            return;
          }
          this.emit({
            session: {
              commandPreview: "codex",
              ok: true,
              output: "Codex ready.",
              status: "running"
            },
            type: "snapshot"
          });
        }, 0);
      }

      send(rawMessage) {
        if (this.terminalKind !== "codex") {
          return;
        }
        const message = JSON.parse(String(rawMessage || "{}"));
        if (message.type === "input") {
          (window as unknown as {
            __aiStudioCodexTerminalInputs: string[];
          }).__aiStudioCodexTerminalInputs.push(String(message.data || ""));
        }
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }

      emit(message) {
        this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify(message)
        }));
      }
    }

    (window as unknown as {
      __studioPushArtifactReadiness: (payload: any) => void;
    }).__studioPushArtifactReadiness = (payload) => {
      const sessionId = String(payload?.sessionId || "");
      for (const source of eventSourcesBySessionId[sessionId] || []) {
        source.dispatchEvent(new MessageEvent("artifact-readiness.updated", {
          data: JSON.stringify(payload)
        }));
      }
    };

    window.EventSource = MockEventSource as unknown as typeof EventSource;
    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });
}

function actionLabel(actionId: string) {
  if (actionId === "create_worktree") {
    return "Create worktree";
  }
  if (actionId === "install_dependencies") {
    return "Install checklist items";
  }
  return actionId;
}
