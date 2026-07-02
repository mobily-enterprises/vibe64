import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  FakeTargetAdapter
} from "@local/vibe64-adapters/server";
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
  let runtime: Vibe64SessionRuntime;

  test.beforeEach(async ({ page }) => {
    targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-agent-chat-"));
    runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_source: true,
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

  test("runs the agent chat definition in Autopilot and displays the saved answer artifact", async ({ page }) => {
    await page.goto(`${BASE_URL}/home`);
    await createNonCommitMaintenanceSession(page);

    await expect(page.getByRole("button", { name: /^Inspect$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Autopilot$/ })).toBeHidden();
    await expect(page.getByText("What would you like to do?"))
      .toBeVisible();
    await page.getByLabel("What would you like to do?").fill("Tell me what maintenance is needed.");
    await page.getByRole("button", { name: "Ask Codex" }).click();

    await expectMarkdownResponsePreview(page);
    await expectComposerActionsAligned(page);
    await expectNoBrowserCodexTerminalInput(page);
    await expect(page.getByRole("button", { name: "Next step" })).toBeEnabled();
    await page.getByRole("button", { name: "Next step" }).click();
    await expect(page.getByRole("heading", { name: "Congratulations!" })).toBeVisible();
  });

  test("updates the Autopilot answer after Codex clarification questions", async ({ page }) => {
    await page.goto(`${BASE_URL}/home`);
    await createNonCommitMaintenanceSession(page);

    await expect(page.getByRole("button", { name: /^Inspect$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Autopilot$/ })).toBeHidden();
    await expect(page.getByText("What would you like to do?"))
      .toBeVisible();

    await page.getByLabel("What would you like to do?").fill("Really?");
    await page.getByRole("button", { name: "Ask Codex" }).click();
    await expectMarkdownResponsePreview(page, REALLY_RESPONSE_TEXT);

    await page.getByLabel("What would you like to do?").fill("Ask me three random questions.");
    await page.getByRole("button", { name: "Ask Codex" }).click();

    const autopilot = page.locator(".studio-autopilot");
    await expect(autopilot.getByText("Answer these before continuing.", { exact: true })).toBeVisible();
    await autopilot.getByLabel(RANDOM_QUESTIONS[0]).fill("not much");
    await autopilot.getByLabel(RANDOM_QUESTIONS[1]).fill("Pescara");
    await autopilot.getByLabel(RANDOM_QUESTIONS[2]).fill("guitar");
    await autopilot.getByRole("button", { name: "Send to Codex" }).click();

    const responseRegion = await expectMarkdownResponsePreview(page, QUESTION_RESPONSE_TEXT);
    await expectNoBrowserCodexTerminalInput(page);
    await expect(responseRegion).toContainText(REALLY_RESPONSE_TEXT);
  });

  test("runs the agent chat definition in Inspect and displays the same saved answer artifact", async ({ page }) => {
    await page.goto(`${BASE_URL}/home?mode=inspect`);
    await createNonCommitMaintenanceSession(page);

    await expect(page.getByRole("button", { name: /^Autopilot$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Inspect$/ })).toBeHidden();
    await page.getByRole("button", { name: "Create session clone" }).click();
    await expect(page.getByText("Create session clone finished.")).toBeVisible();
    await page.getByRole("button", { name: "Next step" }).click();

    await page.getByRole("button", { name: "Install dependencies" }).click();
    await expect(page.getByText("Install dependencies finished.")).toBeVisible();
    await page.getByRole("button", { name: "Next step" }).click();

    const inspect = page.locator(".studio-autopilot__composer");
    await inspect.getByLabel("What would you like to do?").fill("Explain this local maintenance task.");
    await inspect.getByRole("button", { name: "Ask Codex" }).click();

    await expectMarkdownResponsePreview(page);
    await expectNoBrowserCodexTerminalInput(page);
    await expect(page.getByRole("button", { name: "Next step" })).toBeEnabled();

    await page.getByRole("button", { name: "Autopilot" }).click();
    await expectMarkdownResponsePreview(page);
    await expectNoBrowserCodexTerminalInput(page);
  });
});

async function expectMarkdownResponsePreview(page: Page, expectedText = RESPONSE_TEXT) {
  const responseRegion = page.locator('[aria-label="Conversation history"]:visible, [aria-label="Codex"]:visible')
    .filter({ hasText: expectedText })
    .first();
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
    (window as unknown as { __vibe64CodexTerminalInputs?: string[] }).__vibe64CodexTerminalInputs || []
  ))).toEqual([]);
}

async function expectComposerActionsAligned(page: Page) {
  const inputBox = await requiredBox(page.locator(".studio-autopilot-prompt-textarea"), "composer input");
  const askBox = await requiredBox(page.getByRole("button", { name: "Ask Codex" }), "Ask Codex button");
  expect(askBox.x).toBeGreaterThan(inputBox.x);
  expect(askBox.y).toBeGreaterThan(inputBox.y);
  expect(askBox.x + askBox.width).toBeLessThanOrEqual(inputBox.x + inputBox.width);
  expect(askBox.y + askBox.height).toBeLessThanOrEqual(inputBox.y + inputBox.height);
}

async function requiredBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(`${label} is not visible enough to measure.`);
  }
  return box;
}

async function createNonCommitMaintenanceSession(page: Page) {
  await page.getByRole("button", { name: "New Session" }).click();
  await page.getByText("Free-form work", {
    exact: true
  }).click();
}

async function mockAgentChatRoutes(page: Page, runtime: Vibe64SessionRuntime) {
  async function pushArtifactReadiness(sessionId: string) {
    const payload = await artifactReadinessPayload(runtime, sessionId);
    await page.evaluate((payload) => {
      (window as unknown as {
        __studioPushArtifactReadiness: (payload: unknown) => void;
      }).__studioPushArtifactReadiness(payload);
    }, payload).catch(() => null);
  }

  await page.route("**/api/vibe64/sessions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const parts = url.pathname.split("/").filter(Boolean);
    const sessionId = parts[3] || "";
    const tail = parts.slice(4);

    if (method === "GET" && url.pathname === "/api/vibe64/sessions") {
      await fulfillJson(route, await sessionListPayload(runtime));
      return;
    }

    if (method === "GET" && sessionId && tail.length === 0) {
      await fulfillJson(route, await runtime.getSession(sessionId));
      return;
    }

    if (method === "POST" && url.pathname === "/api/vibe64/sessions") {
      const created = await runtime.createSession({
        sessionId: SESSION_ID,
        workflowDefinition: String(request.postDataJSON()?.workflowDefinition || "")
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
        await recordConversationPrompt(runtime, sessionId, actionInput.conversationRequest);
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
        await recordConversationPrompt(runtime, sessionId, fields.conversationRequest);
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

    if (method === "GET" && tail[0] === "conversation-log") {
      const session = await runtime.getSession(sessionId);
      await fulfillJson(route, {
        conversationLog: await runtime.store.readConversationLog(sessionId),
        ok: true,
        revision: session.revision,
        sessionId
      });
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

async function sessionListPayload(runtime: Vibe64SessionRuntime) {
  const sessions = await runtime.listSessions();
  const creation = await runtime.workflowDefinitionCreationOptions();
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

async function applyCommandResult(runtime: Vibe64SessionRuntime, sessionId: string, actionId: string) {
  if (actionId === "create_source") {
    await runtime.store.writeMetadataValue(sessionId, "source_path", path.join(runtime.targetRoot, ".vibe64/source"));
  }
  if (actionId === "install_dependencies") {
    await runtime.store.writeMetadataValue(sessionId, "dependencies_installed", "yes");
    await runtime.store.writeMetadataValue(sessionId, "dependencies_path", runtime.targetRoot);
  }
}

async function recordConversationPrompt(
  runtime: Vibe64SessionRuntime,
  sessionId: string,
  conversationRequest: unknown
) {
  const text = String(conversationRequest || "").trim();
  if (!text) {
    return;
  }
  await runtime.store.writeConversationUserMessage(sessionId, {
    text
  });
}

async function advanceSessionIfReady(runtime: Vibe64SessionRuntime, sessionId: string) {
  const session = await runtime.getSession(sessionId);
  if (session.next?.visible === true && session.next.enabled === true && session.next.stepId) {
    await runtime.advance(sessionId);
  }
}

async function writeAgentResponse(
  runtime: Vibe64SessionRuntime,
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

async function writeAgentQuestions(runtime: Vibe64SessionRuntime, sessionId: string) {
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

async function artifactPreviewPayload(runtime: Vibe64SessionRuntime, sessionId: string, previewId: string) {
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

async function artifactReadinessPayload(runtime: Vibe64SessionRuntime, sessionId: string) {
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
    const readinessSocketsBySessionId: Record<string, Array<{ emit(message: unknown): void }>> = {};
    (window as unknown as {
      __vibe64CodexTerminalInputs: string[];
    }).__vibe64CodexTerminalInputs = [];

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
          if (terminalId.includes("create_source")) {
            this.actionLabel = "Create session clone";
          }
          if (terminalId.includes("install_dependencies")) {
            this.actionLabel = "Install dependencies";
          }
        } else if (pathname.includes("/codex-terminal/")) {
          this.terminalKind = "codex";
          const match = /\/sessions\/([^/]+)\/codex-terminal\/([^/]+)\/ws/u.exec(pathname);
          this.sessionId = match ? decodeURIComponent(match[1]) : "";
        } else if (pathname.includes("/artifact-readiness/ws")) {
          this.terminalKind = "artifact-readiness";
          const match = /\/sessions\/([^/]+)\/artifact-readiness\/ws/u.exec(pathname);
          this.sessionId = match ? decodeURIComponent(match[1]) : "";
          readinessSocketsBySessionId[this.sessionId] ||= [];
          readinessSocketsBySessionId[this.sessionId].push(this);
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
          if (this.terminalKind === "artifact-readiness") {
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
            __vibe64CodexTerminalInputs: string[];
          }).__vibe64CodexTerminalInputs.push(String(message.data || ""));
        }
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.terminalKind === "artifact-readiness") {
          readinessSocketsBySessionId[this.sessionId] = (readinessSocketsBySessionId[this.sessionId] || [])
            .filter((socket) => socket !== this);
        }
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
      for (const socket of readinessSocketsBySessionId[sessionId] || []) {
        socket.emit({
          ...payload,
          type: "artifact-readiness.updated"
        });
      }
    };

    window.EventSource = MockEventSource as unknown as typeof EventSource;
    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });
}

function actionLabel(actionId: string) {
  if (actionId === "create_source") {
    return "Create session clone";
  }
  if (actionId === "install_dependencies") {
    return "Install dependencies";
  }
  return actionId;
}
