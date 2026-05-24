import { expect, test, type Page, type Route } from "@playwright/test";

import { BASE_URL } from "./support/base-shell-data";
import {
  mockStudioReady
} from "./support/base-shell-mocks";

test.describe("Autopilot dumb client contract", () => {
  test("attaches to the server-owned Codex terminal preview without sending terminal input", async ({ page }) => {
    await mockCodexTerminalPreviewSocket(page);
    let codexTerminalStartRequests = 0;
    const session = sessionPayload({
      codexTerminal: {
        commandPreview: "codex",
        id: "server-codex-terminal",
        status: "running",
        transmitting: true
      },
      presentation: {
        auto: {
          canResume: false,
          canStart: false,
          nextOperation: {
            kind: "wait",
            reason: "codex"
          }
        },
        screen: {
          icon: "progress",
          kind: "codex_running",
          message: "Wait for Codex to finish the current step.",
          sections: [],
          showProgress: true,
          title: "Terminal is transmitting..."
        },
        step: {
          id: "server_step",
          label: "Server step",
          status: "awaiting_agent_result"
        },
        terminal: {
          codex: {
            label: "Terminal is transmitting...",
            readOnlyInAutopilot: true,
            renderer: "codex_terminal",
            terminalSessionId: "server-codex-terminal",
            visible: true
          }
        }
      },
      stepMachine: {
        status: "awaiting_agent_result",
        stepId: "server_step"
      }
    });
    await mockAiStudioSession(page, session, {
      onCodexTerminalStart: () => {
        codexTerminalStartRequests += 1;
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByRole("heading", { name: "Terminal is transmitting..." })).toBeVisible();
    await expect(page.locator(".studio-ai-sessions__terminals--autopilot-preview")).toBeVisible();
    await expect.poll(() => codexTerminalStartRequests).toBe(0);
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __aiStudioCodexTerminalInputs?: string[] }).__aiStudioCodexTerminalInputs || []
    ))).toEqual([]);
  });

  test("hides the active Codex terminal preview when the server renders input", async ({ page }) => {
    await mockCodexTerminalPreviewSocket(page);
    const session = sessionPayload({
      codexTerminal: {
        commandPreview: "codex",
        id: "server-codex-terminal",
        status: "running",
        transmitting: true
      },
      currentStepDefinition: {
        id: "server_step",
        label: "Server Questions"
      },
      presentation: {
        auto: {
          canResume: false,
          canStart: false,
          nextOperation: {
            kind: "wait",
            reason: "input"
          }
        },
        screen: {
          input: {
            fields: [
              {
                kind: "textarea",
                label: "Response",
                name: "response"
              }
            ],
            prompt: "What is one workflow in the dog grooming app you want to improve first?",
            submitLabel: "Send to Codex",
            title: "Talk to Codex"
          },
          kind: "input",
          message: "What is one workflow in the dog grooming app you want to improve first?",
          sections: [],
          title: "Talk to Codex"
        },
        step: {
          id: "server_step",
          label: "Server Questions",
          status: "waiting_for_input"
        },
        terminal: {
          codex: {
            label: "",
            readOnlyInAutopilot: true,
            renderer: "codex_terminal",
            terminalSessionId: "server-codex-terminal",
            visible: false
          }
        }
      },
      stepMachine: {
        status: "waiting_for_input",
        stepId: "server_step"
      }
    });
    await mockAiStudioSession(page, session);

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByRole("heading", { name: "Talk to Codex" })).toBeVisible();
    await expect(page.getByLabel("Response")).toBeVisible();
    await expect(page.locator(".studio-ai-sessions__terminals--autopilot-preview")).toBeHidden();
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __aiStudioCodexTerminalInputs?: string[] }).__aiStudioCodexTerminalInputs || []
    ))).toEqual([]);
  });

  test("renders server-provided intents and posts the chosen intent without client workflow knowledge", async ({ page }) => {
    const intentRequests: unknown[] = [];
    const session = sessionPayload({
      intents: [
        {
          enabled: true,
          id: "server_feedback",
          inputFields: [
            {
              kind: "textarea",
              label: "Feedback",
              name: "feedback"
            }
          ],
          label: "Ask server",
          style: "primary"
        }
      ],
      presentation: {
        auto: {
          canResume: false,
          canStart: false,
          nextOperation: {
            kind: "stop",
            reason: "user"
          }
        },
        screen: {
          kind: "review",
          message: "This text came from the server.",
          primaryIntentId: "server_feedback",
          sections: [],
          title: "Server Review"
        }
      }
    });
    await mockAiStudioSession(page, session, {
      onIntent: (body) => {
        intentRequests.push(body);
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByRole("heading", { name: "Server Review" })).toBeVisible();
    await expect(page.getByText("This text came from the server.")).toBeVisible();

    await page.getByLabel("Feedback").fill("Please adjust the copy.");
    await page.getByRole("button", { name: "Ask server" }).click();

    await expect.poll(() => intentRequests).toEqual([
      {
        fields: {
          feedback: "Please adjust the copy."
        },
        stepId: "server_step",
        stepStatus: "ready"
      }
    ]);
  });

  test("renders numbered questions as UI sugar and submits only the logical response field", async ({ page }) => {
    const stepInputs: unknown[] = [];
    const session = sessionPayload({
      currentStepDefinition: {
        id: "server_step",
        label: "Server Questions"
      },
      presentation: {
        auto: {
          canResume: false,
          canStart: false,
          nextOperation: {
            kind: "wait",
            reason: "input"
          }
        },
        screen: {
          input: {
            fields: [
              {
                kind: "textarea",
                label: "Response",
                name: "response"
              }
            ],
            prompt: "Answer these before continuing.\n[1] What should change?\n[2] What should stay the same?",
            submitLabel: "Submit",
            title: "Server Questions"
          },
          kind: "input",
          message: "Answer these before continuing.",
          sections: [],
          title: "Server Questions"
        },
        step: {
          id: "server_step",
          label: "Server Questions",
          status: "waiting_for_input"
        }
      }
    });
    await mockAiStudioSession(page, session, {
      onStepInput: (body) => {
        stepInputs.push(body);
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByRole("heading", { name: "Server Questions" })).toBeVisible();
    await page.getByLabel("What should change?").fill("Tighten the layout.");
    await page.getByLabel("What should stay the same?").fill("Keep the current copy.");
    await page.getByRole("button", { name: "Submit" }).click();

    await expect.poll(() => stepInputs).toEqual([
      {
        fields: {
          response: "[1] Tighten the layout.\n[2] Keep the current copy."
        },
        kind: "ready",
        source: "ui",
        stepId: "server_step",
        stepStatus: "waiting_for_input"
      }
    ]);
  });
});

async function mockAiStudioSession(
  page: Page,
  session: Record<string, unknown>,
  {
    onIntent = () => undefined,
    onStepInput = () => undefined,
    onCodexTerminalStart = () => undefined
  }: {
    onCodexTerminalStart?: () => void;
    onIntent?: (body: unknown) => void;
    onStepInput?: (body: unknown) => void;
  } = {}
) {
  await mockStudioReady(page);
  await page.route("**/api/ai-studio/sessions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "POST" && url.pathname.endsWith("/codex-terminal")) {
      onCodexTerminalStart();
      await fulfillJson(route, {
        commandPreview: "codex",
        id: "server-codex-terminal",
        ok: true,
        status: "running"
      });
      return;
    }
    if (method === "POST" && /\/intents\/[^/]+$/u.test(url.pathname)) {
      onIntent(request.postDataJSON());
      await fulfillJson(route, {
        ok: true,
        ...session
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/current-step/input")) {
      onStepInput(request.postDataJSON());
      await fulfillJson(route, {
        ok: true,
        ...session
      });
      return;
    }
    if (method === "GET" && /\/sessions\/[^/]+$/u.test(url.pathname)) {
      await fulfillJson(route, {
        ok: true,
        ...session
      });
      return;
    }
    await fulfillJson(route, {
      creation: {
        canCreate: true,
        defaultWorkflowProfile: "big_feature",
        mode: "select",
        workflowProfiles: []
      },
      limits: {
        maxOpenSessions: 5,
        openSessionCount: 1
      },
      ok: true,
      sessions: [session]
    });
  });
}

async function mockCodexTerminalPreviewSocket(page: Page) {
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    (window as unknown as {
      __aiStudioCodexTerminalInputs: string[];
    }).__aiStudioCodexTerminalInputs = [];

    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = MockWebSocket.CONNECTING;
      url = "";

      constructor(url) {
        super();
        this.url = String(url || "");
        const pathname = new URL(this.url, window.location.href).pathname;
        if (!pathname.includes("/codex-terminal/")) {
          return new OriginalWebSocket(url);
        }
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              session: {
                commandPreview: "codex",
                ok: true,
                output: "Server-owned Codex terminal output.",
                status: "running"
              },
              type: "snapshot"
            })
          }));
        }, 0);
      }

      send(rawMessage) {
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
    }

    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });
}

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: "application/json"
  });
}

function sessionPayload(overrides: Record<string, unknown> = {}) {
  const currentStepDefinition = overrides.currentStepDefinition || {
    id: "server_step",
    label: "Server step"
  };
  const intents = Array.isArray(overrides.intents) ? overrides.intents : [];
  const presentation = {
    intents,
    step: {
      id: "server_step",
      label: "Server step",
      status: "ready"
    },
    ...((overrides.presentation as Record<string, unknown>) || {})
  };
  return {
    actionResults: [],
    actions: [],
    artifactsRoot: "/workspace/example-target-app/.ai-studio/sessions/active/session-renderer/artifacts",
    completedSteps: [],
    createdAt: "2026-05-24T00:00:00.000Z",
    currentStep: "server_step",
    currentStepDefinition,
    intents,
    metadata: {},
    next: {
      disabledReason: "Server controls this step.",
      enabled: false,
      label: "Next",
      stepId: "next_step",
      visible: true
    },
    presentation,
    sessionId: "session-renderer",
    status: "active",
    stepDefinitions: [
      {
        id: "server_step",
        label: "Server step",
        status: "current"
      }
    ],
    stepMachine: {
      status: String((presentation.step as Record<string, unknown>)?.status || "ready"),
      stepId: "server_step"
    },
    targetRoot: "/workspace/example-target-app",
    title: "Renderer session",
    updatedAt: "2026-05-24T00:00:00.000Z",
    workflowId: "test-workflow",
    ...overrides
  };
}
