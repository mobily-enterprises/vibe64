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

const RESPONSE_ARTIFACT = "human_input_response.md";
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

    await expect(page.getByRole("heading", { name: "Let's get started" })).toBeVisible();
    await page.getByRole("button", { name: "Let's start" }).click();

    await expect(page.getByRole("heading", { name: "Talk to agent" })).toBeVisible();
    await page.getByLabel("What do you want to ask Codex?").fill("Tell me what maintenance is needed.");
    await page.getByRole("button", { name: "Ask Codex" }).click();

    await expectMarkdownResponsePreview(page);
    await expect(page.getByRole("button", { name: "Finish" })).toBeVisible();
  });

  test("updates the Autopilot answer after Codex clarification questions", async ({ page }) => {
    await page.goto(`${BASE_URL}/home`);
    await createNonCommitMaintenanceSession(page);

    await page.getByRole("button", { name: "Let's start" }).click();
    await expect(page.getByRole("heading", { name: "Talk to agent" })).toBeVisible();

    await page.getByLabel("What do you want to ask Codex?").fill("Really?");
    await page.getByRole("button", { name: "Ask Codex" }).click();
    await expectMarkdownResponsePreview(page, REALLY_RESPONSE_TEXT);

    await page.getByLabel("What do you want to ask Codex?").fill("Ask me three random questions.");
    await page.getByRole("button", { name: "Ask Codex" }).click();

    await expect(page.getByText(RANDOM_QUESTIONS[0])).toBeVisible();
    const answerFields = page.getByLabel("Your answer");
    await answerFields.nth(0).fill("not much");
    await answerFields.nth(1).fill("Pescara");
    await answerFields.nth(2).fill("guitar");
    await page.getByRole("button", { name: "Continue" }).click();

    const responseRegion = await expectMarkdownResponsePreview(page, QUESTION_RESPONSE_TEXT);
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

    await page.getByRole("button", { name: "Talk to agent" }).click();
    const inputDialog = page.getByRole("dialog").filter({
      hasText: "Talk to agent"
    });
    await expect(inputDialog).toBeVisible();
    await inputDialog.getByLabel("What do you want to ask Codex?").fill("Explain this local maintenance task.");
    await inputDialog.getByRole("button", { name: "Continue" }).click();

    await expectMarkdownResponsePreview(page);
    await expect(page.getByRole("button", { name: "Edit AI response" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();

    await page.getByRole("button", { name: "Quit inspect" }).click();
    await expect(page.getByRole("heading", { name: "AI response" })).toBeVisible();
    await expectMarkdownResponsePreview(page);
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

async function createNonCommitMaintenanceSession(page: Page) {
  await page.getByRole("button", { name: "New Session" }).click();
  await page.getByText("Non-commit maintenance", {
    exact: true
  }).click();
}

async function mockAgentChatRoutes(page: Page, runtime: AiStudioSessionRuntime) {
  let autopilotPayload = emptyAutopilotPayload("");

  await page.exposeFunction("__studioHandleCodexInput", async ({ data, sessionId }: { data?: string; sessionId?: string } = {}) => {
    const normalizedSessionId = String(sessionId || "");
    if (!String(data || "").includes("AI Studio Autopilot clarification answers:")) {
      return null;
    }

    const session = await runtime.getSession(normalizedSessionId);
    if (session.promptRun?.actionId !== "talk_to_agent") {
      return null;
    }

    autopilotPayload = await writeAgentResponse(
      runtime,
      normalizedSessionId,
      session.promptRun,
      QUESTION_RESPONSE_MARKDOWN
    );
    return autopilotPayloadForSession(autopilotPayload, normalizedSessionId);
  });

  async function pushAutopilotArtifacts(sessionId: string) {
    await page.evaluate((payload) => {
      (window as unknown as {
        __studioPushAutopilotArtifacts: (payload: unknown) => void;
      }).__studioPushAutopilotArtifacts(payload);
    }, autopilotPayloadForSession(autopilotPayload, sessionId)).catch(() => null);
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
      if (tail[1] === "talk_to_agent") {
        if (String(actionInput.agentRequest || "").toLowerCase().includes("three random questions")) {
          autopilotPayload = await writeAgentQuestions(runtime, sessionId, response.actionResult?.promptRun);
        } else {
          autopilotPayload = await writeAgentResponse(
            runtime,
            sessionId,
            response.actionResult?.promptRun,
            responseMarkdownForRequest(actionInput.agentRequest)
          );
        }
        await fulfillJson(route, {
          ...await runtime.getSession(sessionId),
          actionResult: response.actionResult
        });
        await pushAutopilotArtifacts(sessionId);
        return;
      }
      await fulfillJson(route, response);
      return;
    }

    if (method === "GET" && tail[0] === "artifacts") {
      await fulfillJson(route, await artifactPayload(runtime, sessionId, String(url.searchParams.get("actionId") || "")));
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

    if (method === "GET" && tail[0] === "autopilot-artifacts") {
      await fulfillJson(route, autopilotPayloadForSession(autopilotPayload, sessionId));
      return;
    }

    if (method === "DELETE" && tail[0] === "autopilot-artifacts") {
      await runtime.store.deleteArtifacts(sessionId, [
        "issue-draft.json",
        "prompt-done.json",
        "questions.json"
      ]);
      autopilotPayload = emptyAutopilotPayload(sessionId);
      await fulfillJson(route, autopilotPayload);
      await pushAutopilotArtifacts(sessionId);
      return;
    }

    if (method === "GET" && tail[0] === "autopilot-artifacts" && tail[1] === "stream") {
      await fulfillJson(route, autopilotPayloadForSession(autopilotPayload, sessionId));
      return;
    }

    if (method === "POST" && tail[0] === "command-terminal") {
      const actionId = String(request.postDataJSON()?.actionId || "");
      await applyCommandResult(runtime, sessionId, actionId);
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
        needsThreadCapture: false,
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

    if (method === "POST" && tail[0] === "codex-prompt-handoff") {
      await fulfillJson(route, {
        codexPromptHandoffOutputStart: Number(request.postDataJSON()?.outputStart || 0),
        codexPromptHandoffSignature: "agent-chat-test",
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

async function writeAgentResponse(
  runtime: AiStudioSessionRuntime,
  sessionId: string,
  promptRun = {},
  markdown = RESPONSE_MARKDOWN
) {
  await runtime.store.writeArtifact(sessionId, RESPONSE_ARTIFACT, markdown);
  const payload = {
    artifactReadiness: {},
    issueDraft: null,
    ok: true,
    promptDone: {
      actionId: "talk_to_agent",
      completionToken: String(promptRun?.completionToken || ""),
      requestId: String(promptRun?.requestId || ""),
      stepId: "agent_response_created"
    },
    questions: null,
    sessionId
  };
  await runtime.store.writeArtifact(sessionId, "prompt-done.json", `${JSON.stringify(payload.promptDone, null, 2)}\n`);
  const updatedSession = await runtime.getSession(sessionId);
  return {
    ...payload,
    artifactReadiness: updatedSession.artifactReadiness
  };
}

async function writeAgentQuestions(runtime: AiStudioSessionRuntime, sessionId: string, promptRun = {}) {
  const questions = {
    questions: RANDOM_QUESTIONS,
    requestId: String(promptRun?.requestId || "")
  };
  await runtime.store.writeArtifact(sessionId, "questions.json", `${JSON.stringify(questions, null, 2)}\n`);
  const updatedSession = await runtime.getSession(sessionId);
  return {
    artifactReadiness: updatedSession.artifactReadiness,
    issueDraft: null,
    ok: true,
    promptDone: null,
    questions,
    sessionId
  };
}

function responseMarkdownForRequest(agentRequest = "") {
  return String(agentRequest || "").toLowerCase().includes("really")
    ? REALLY_RESPONSE_MARKDOWN
    : RESPONSE_MARKDOWN;
}

async function artifactPayload(runtime: AiStudioSessionRuntime, sessionId: string, actionId: string) {
  const session = await runtime.getSession(sessionId);
  const action = session.actions.find((candidate) => candidate.id === actionId);
  const artifacts = {
    [RESPONSE_ARTIFACT]: await runtime.store.readArtifact(sessionId, RESPONSE_ARTIFACT)
  };
  const artifactFields = action?.artifactFields || [];
  return {
    ...session,
    actionId,
    artifactFields,
    artifactPaths: {
      [RESPONSE_ARTIFACT]: path.join(session.artifactsRoot, RESPONSE_ARTIFACT)
    },
    artifactStates: {
      [RESPONSE_ARTIFACT]: {
        disabledReason: "",
        editable: true
      }
    },
    artifacts,
    editableArtifacts: artifactFields.map((field) => field.name),
    ok: true
  };
}

async function mockAgentChatBrowserPrimitives(page: Page) {
  await page.addInitScript(() => {
    const OriginalEventSource = window.EventSource;
    const OriginalWebSocket = window.WebSocket;
    const eventSourcesBySessionId: Record<string, EventTarget[]> = {};

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
        const match = /\/sessions\/([^/]+)\/autopilot-artifacts\/stream/u.exec(pathname);
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
              needsThreadCapture: false,
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
          this.emit({
            chunk: "\nCodex received the prompt.\n",
            type: "output"
          });
          const data = String(message.data || "");
          if (data.includes("AI Studio Autopilot clarification answers:")) {
            void Promise.resolve((window as unknown as {
              __studioHandleCodexInput?: (input: { data: string; sessionId: string }) => Promise<unknown>;
              __studioPushAutopilotArtifacts?: (payload: unknown) => void;
            }).__studioHandleCodexInput?.({
              data,
              sessionId: this.sessionId
            })).then((payload) => {
              if (payload) {
                (window as unknown as {
                  __studioPushAutopilotArtifacts?: (payload: unknown) => void;
                }).__studioPushAutopilotArtifacts?.(payload);
              }
            });
          }
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
      __studioPushAutopilotArtifacts: (payload: any) => void;
    }).__studioPushAutopilotArtifacts = (payload) => {
      const sessionId = String(payload?.sessionId || "");
      for (const source of eventSourcesBySessionId[sessionId] || []) {
        source.dispatchEvent(new MessageEvent("autopilot-artifacts.updated", {
          data: JSON.stringify(payload)
        }));
      }
    };

    window.EventSource = MockEventSource as unknown as typeof EventSource;
    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });
}

function autopilotPayloadForSession(payload = emptyAutopilotPayload(""), sessionId: string) {
  return {
    ...emptyAutopilotPayload(sessionId),
    ...payload,
    sessionId
  };
}

function emptyAutopilotPayload(sessionId: string) {
  return {
    artifactReadiness: {},
    issueDraft: null,
    ok: true,
    promptDone: null,
    questions: null,
    sessionId
  };
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
