import { expect, test, type Page, type Route } from "@playwright/test";

import { BASE_URL } from "./support/base-shell-data";
import {
  mockStudioReady
} from "./support/base-shell-mocks";

test.describe("Autopilot dumb client contract", () => {
  test("auto-dispatches the server operation without rendering a manual start override", async ({ page }) => {
    await recordForbiddenText(page, "Let's start");
    const actionRequests: unknown[] = [];
    const session = sessionPayload({
      presentation: {
        auto: {
          nextOperation: {
            actionId: "opaque_server_action",
            executable: true,
            id: "session-action:opaque_server_action",
            kind: "action",
            label: "Opaque server operation",
            route: "session-action"
          }
        },
        screen: {
          kind: "ready",
          sections: [],
          title: "Server Ready"
        }
      }
    });
    await mockVibe64Session(page, session, {
      onAction: (actionId, body) => {
        actionRequests.push({
          actionId,
          body
        });
        const presentation = session.presentation as Record<string, unknown>;
        presentation.auto = {
          nextOperation: {
            executable: false,
            kind: "wait",
            reason: "codex"
          }
        };
        presentation.screen = {
          icon: "progress",
          kind: "codex_running",
          sections: [],
          showProgress: true,
          title: "Terminal is transmitting..."
        };
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect.poll(() => actionRequests).toEqual([
      {
        actionId: "opaque_server_action",
        body: {}
      }
    ]);
    await expect(page.getByRole("heading", { name: "Terminal is transmitting..." })).toBeVisible();
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __vibe64ForbiddenTextSeen?: boolean }).__vibe64ForbiddenTextSeen === true
    ))).toBe(false);
  });

  test("does not start command machinery from action metadata when nextOperation waits", async ({ page }) => {
    let commandTerminalStarts = 0;
    const session = sessionPayload({
      actions: [
        {
          dispatchRoute: "command-terminal",
          enabled: true,
          id: "metadata_only_command",
          label: "Metadata-only command",
          type: "command"
        }
      ],
      presentation: {
        auto: {
          nextOperation: {
            executable: false,
            kind: "wait",
            reason: "server"
          }
        },
        screen: {
          kind: "blocked",
          message: "The server did not authorize an operation.",
          sections: [],
          title: "Server Blocked"
        }
      }
    });
    await mockVibe64Session(page, session, {
      onCommandTerminalStart: () => {
        commandTerminalStarts += 1;
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByRole("heading", { name: "Server Blocked" })).toBeVisible();
    await expect.poll(() => commandTerminalStarts).toBe(0);
  });

  test("shows blocked intent action results as errors and keeps issue input retryable", async ({ page }) => {
    const intentRequests: unknown[] = [];
    const session = issueSourceSession();
    await mockVibe64Session(page, session, {
      onIntent: (body) => {
        intentRequests.push(body);
        session.actionResult = {
          actionLabel: "Use existing issue",
          actionType: "adapter",
          message: "Could not resolve GitHub issue: issue not found",
          status: "blocked",
          stepId: "issue_file_created"
        };
        session.stepMachine = {
          status: "failed",
          stepId: "issue_file_created"
        };
      }
    });

    await page.goto(`${BASE_URL}/home`);
    await page.getByLabel("Issue URL or number").fill("404404");
    await page.getByRole("button", { exact: true, name: "Use existing issue" }).click();

    await expect.poll(() => intentRequests).toEqual([
      {
        fields: {
          issueRef: "404404"
        },
        stepId: "issue_file_created",
        stepStatus: "ready"
      }
    ]);
    await expect(page.getByText("Could not resolve GitHub issue: issue not found").first()).toBeVisible();
    await expect(page.getByText("Vibe64 intent completed.")).toHaveCount(0);
    await expect(page.getByText("Vibe64 intent could not run.")).toHaveCount(0);
    await expect(page.getByLabel("Issue URL or number")).toBeVisible();
  });

  test("progresses after a successful existing-issue intent result", async ({ page }) => {
    const session = issueSourceSession();
    await mockVibe64Session(page, session, {
      onIntent: () => {
        Object.assign(session, sessionPayload({
          actionResult: {
            actionLabel: "Use existing issue",
            actionType: "adapter",
            message: "Selected GitHub issue #123: Existing feature",
            metadata: {
              issue_number: "123",
              issue_source: "existing",
              issue_title: "Existing feature",
              issue_url: "https://github.com/example/project/issues/123",
              issue_word: "Existing"
            },
            status: "completed",
            stepId: "issue_file_created"
          },
          currentStep: "issue_submitted",
          currentStepDefinition: {
            id: "issue_submitted",
            label: "Edit and submit issue"
          },
          intents: [],
          metadata: {
            issue_number: "123",
            issue_source: "existing",
            issue_title: "Existing feature",
            issue_url: "https://github.com/example/project/issues/123",
            issue_word: "Existing"
          },
          presentation: {
            auto: {
              nextOperation: {
                executable: false,
                kind: "stop",
                reason: "Issue selected"
              }
            },
            screen: {
              kind: "ready",
              sections: [],
              title: "Edit and submit issue"
            },
            step: {
              id: "issue_submitted",
              label: "Edit and submit issue",
              status: "ready"
            }
          },
          stepMachine: {
            status: "ready",
            stepId: "issue_submitted"
          }
        }));
      }
    });

    await page.goto(`${BASE_URL}/home`);
    await page.getByLabel("Issue URL or number").fill("123");
    await page.getByRole("button", { exact: true, name: "Use existing issue" }).click();

    await expect(page.getByRole("heading", { name: "Edit and submit issue" })).toBeVisible();
    await expect(page.getByText("Could not resolve GitHub issue")).toHaveCount(0);
  });

  test("continues from server state when a command stream closes after server completion", async ({ page }) => {
    await mockCommandTerminalSocketThatCloses(page);
    const advances: unknown[] = [];
    const session = sessionPayload({
      actions: [
        {
          dispatchRoute: "command-terminal",
          enabled: true,
          id: "server_command",
          label: "Server command",
          type: "command"
        }
      ],
      presentation: {
        auto: {
          nextOperation: {
            actionId: "server_command",
            executable: true,
            id: "command-terminal:server_command",
            kind: "command",
            label: "Server command",
            route: "command-terminal"
          }
        },
        screen: {
          kind: "ready",
          sections: [],
          title: "Server command"
        }
      }
    });
    await mockVibe64Session(page, session, {
      onAdvance: () => {
        advances.push({});
        Object.assign(session, sessionPayload({
          currentStep: "next_server_step",
          currentStepDefinition: {
            id: "next_server_step",
            label: "Next server step"
          },
          presentation: {
            auto: {
              nextOperation: {
                executable: false,
                kind: "stop",
                reason: "complete"
              }
            },
            screen: {
              kind: "ready",
              sections: [],
              title: "Next server step"
            },
            step: {
              id: "next_server_step",
              label: "Next server step",
              status: "ready"
            }
          },
          stepMachine: {
            status: "ready",
            stepId: "next_server_step"
          }
        }));
      },
      onCommandTerminalClose: () => {
        session.next = {
          disabledReason: "",
          enabled: true,
          label: "Next step",
          stepId: "next_server_step",
          visible: true
        };
        session.presentation = {
          ...(session.presentation as Record<string, unknown>),
          auto: {
            nextOperation: {
              executable: true,
              id: "session-advance:next_server_step",
              kind: "advance",
              label: "Next step",
              route: "session-advance"
            }
          },
          screen: {
            kind: "ready",
            sections: [],
            title: "Server command complete"
          },
          step: {
            id: "server_step",
            label: "Server step",
            status: "done"
          }
        };
        session.stepMachine = {
          status: "done",
          stepId: "server_step"
        };
      },
      onCommandTerminalStart: () => {
        // The server owns command completion; the socket below intentionally
        // closes before sending an exited status.
        return {
          commandPreview: "echo test",
          id: "server-command-terminal",
          ok: true,
          status: "running"
        };
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect.poll(() => advances.length).toBe(1);
    await expect(page.getByRole("heading", { name: "Next server step" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  });

  test("continues from server state after a command exits successfully", async ({ page }) => {
    const advances: unknown[] = [];
    const session = sessionPayload({
      actions: [
        {
          dispatchRoute: "command-terminal",
          enabled: true,
          id: "server_command",
          label: "Server command",
          type: "command"
        }
      ],
      presentation: {
        auto: {
          nextOperation: {
            actionId: "server_command",
            executable: true,
            id: "command-terminal:server_command",
            kind: "command",
            label: "Server command",
            route: "command-terminal"
          }
        },
        screen: {
          kind: "ready",
          sections: [],
          title: "Server command"
        }
      }
    });
    await mockVibe64Session(page, session, {
      onAdvance: () => {
        advances.push({});
        Object.assign(session, sessionPayload({
          currentStep: "next_server_step",
          currentStepDefinition: {
            id: "next_server_step",
            label: "Next server step"
          },
          presentation: {
            auto: {
              nextOperation: {
                executable: false,
                kind: "stop",
                reason: "complete"
              }
            },
            screen: {
              kind: "ready",
              sections: [],
              title: "Next server step"
            },
            step: {
              id: "next_server_step",
              label: "Next server step",
              status: "ready"
            }
          },
          stepMachine: {
            status: "ready",
            stepId: "next_server_step"
          }
        }));
      },
      onCommandTerminalClose: () => {
        session.next = {
          disabledReason: "",
          enabled: true,
          label: "Next step",
          stepId: "next_server_step",
          visible: true
        };
        session.presentation = {
          ...(session.presentation as Record<string, unknown>),
          auto: {
            nextOperation: {
              executable: true,
              id: "session-advance:next_server_step",
              kind: "advance",
              label: "Next step",
              route: "session-advance"
            }
          },
          screen: {
            kind: "ready",
            sections: [],
            title: "Server command complete"
          },
          step: {
            id: "server_step",
            label: "Server step",
            status: "done"
          }
        };
        session.stepMachine = {
          status: "done",
          stepId: "server_step"
        };
      },
      onCommandTerminalStart: () => {
        return {
          commandPreview: "echo test",
          exitCode: 0,
          id: "server-command-terminal",
          ok: true,
          output: "Server command output.",
          status: "exited"
        };
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect.poll(() => advances.length).toBe(1);
    await expect(page.getByRole("heading", { name: "Next server step" })).toBeVisible();
  });

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
          nextOperation: {
            executable: false,
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
            visible: true,
            visibleUntil: new Date(Date.now() + 10_000).toISOString()
          }
        }
      },
      stepMachine: {
        status: "awaiting_agent_result",
        stepId: "server_step"
      }
    });
    await mockVibe64Session(page, session, {
      onCodexTerminalStart: () => {
        codexTerminalStartRequests += 1;
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByRole("heading", { name: "Terminal is transmitting..." })).toBeVisible();
    await expect(page.locator(".studio-ai-sessions__terminals--autopilot-preview")).toBeVisible();
    await expect.poll(() => codexTerminalStartRequests).toBe(0);
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __vibe64CodexTerminalInputs?: string[] }).__vibe64CodexTerminalInputs || []
    ))).toEqual([]);
  });

  test("opens a global Codex terminal from Autopilot when no sessions exist", async ({ page }) => {
    await mockCodexTerminalPreviewSocket(page);
    await page.addInitScript(() => {
      window.localStorage.removeItem("vibe64:selected-session-id");
    });
    let globalCodexStarts = 0;
    let sessionCodexStarts = 0;

    await mockStudioReady(page);
    await page.route("**/api/vibe64/codex-terminal", async (route) => {
      if (route.request().method() === "POST") {
        globalCodexStarts += 1;
        await fulfillJson(route, {
          commandPreview: "codex",
          globalCodexTerminal: {
            commandPreview: "codex",
            id: "global-codex-terminal",
            status: "running"
          },
          id: "global-codex-terminal",
          ok: true,
          status: "running"
        });
        return;
      }
      await fulfillJson(route, {
        codexTerminal: null,
        globalCodexTerminal: null,
        ok: true
      });
    });
    await page.route("**/api/vibe64/sessions**", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "POST" && url.pathname.endsWith("/codex-terminal")) {
        sessionCodexStarts += 1;
      }
      await fulfillJson(route, {
        creation: {
          canCreate: true,
          defaultWorkflowDefinition: "big_feature",
          mode: "select",
          workflowDefinitions: []
        },
        limits: {
          maxOpenSessions: 5,
          openSessionCount: 0
        },
        ok: true,
        sessions: []
      });
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByText("No sessions yet.")).toBeVisible();
    await page.getByRole("button", { name: "Codex terminal" }).click();

    await expect(page.locator(".studio-ai-sessions__global-codex-terminal .codex-terminal__host")).toBeVisible();
    await expect.poll(() => globalCodexStarts).toBe(1);
    await expect.poll(() => sessionCodexStarts).toBe(0);
  });

  test("runs the server-presented Codex continuation control from Autopilot", async ({ page }) => {
    let continuationRequests = 0;
    const continuationIntent = {
      actionId: "",
      control: {
        action: "continue_codex_turn",
        disabledWhen: [],
        icon: "",
        loadingWhen: []
      },
      disabledReason: "",
      enabled: true,
      id: "continue_codex_turn",
      inputFields: [],
      label: "Ask Codex to continue",
      style: "primary"
    };
    const session = sessionPayload({
      intents: [continuationIntent],
      presentation: {
        auto: {
          nextOperation: {
            executable: false,
            kind: "wait",
            reason: "codex"
          }
        },
        intents: [continuationIntent],
        screen: {
          icon: "warning",
          kind: "codex_attention",
          message: "Codex has not reported progress for the current step.",
          sections: [],
          showProgress: false,
          title: "Codex needs attention"
        },
        step: {
          id: "server_step",
          label: "Server step",
          status: "awaiting_agent_result"
        }
      },
      stepMachine: {
        status: "awaiting_agent_result",
        stepId: "server_step"
      }
    });
    await mockVibe64Session(page, session, {
      onCodexTurnContinue: () => {
        continuationRequests += 1;
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByRole("heading", { name: "Codex needs attention" })).toBeVisible();
    await page.getByRole("button", { name: "Ask Codex to continue" }).click();

    await expect.poll(() => continuationRequests).toBe(1);
  });

  test("does not refresh-loop when a headless Codex terminal consumes server state", async ({ page }) => {
    await mockCodexTerminalPreviewSocket(page);
    let sessionReads = 0;
    const continuationIntent = {
      actionId: "",
      control: {
        action: "continue_codex_turn",
        disabledWhen: [],
        icon: "",
        loadingWhen: []
      },
      disabledReason: "",
      enabled: true,
      id: "continue_codex_turn",
      inputFields: [],
      label: "Ask Codex to continue",
      style: "primary"
    };
    const session = sessionPayload({
      codexTerminal: {
        commandPreview: "codex",
        id: "server-codex-terminal",
        status: "running",
        transmitting: false
      },
      intents: [continuationIntent],
      presentation: {
        auto: {
          nextOperation: {
            executable: false,
            kind: "wait",
            reason: "codex"
          }
        },
        intents: [continuationIntent],
        screen: {
          icon: "warning",
          kind: "codex_attention",
          message: "Codex has not reported progress for the current step.",
          sections: [],
          showProgress: false,
          title: "Codex needs attention"
        },
        step: {
          id: "server_step",
          label: "Server step",
          status: "awaiting_agent_result"
        }
      },
      stepMachine: {
        status: "awaiting_agent_result",
        stepId: "server_step"
      }
    });
    await mockVibe64Session(page, session, {
      onSessionRead: () => {
        sessionReads += 1;
      }
    });

    await page.goto(`${BASE_URL}/home`);
    await expect(page.getByRole("heading", { name: "Codex needs attention" })).toBeVisible();
    await page.waitForTimeout(1000);

    expect(sessionReads).toBeLessThanOrEqual(2);
  });

  test("refreshes an expired Codex wait presentation after Inspect and returns with a continuation control", async ({ page }) => {
    await mockInspectTerminalSockets(page);
    let refreshAtMs = 0;
    const continuationIntent = {
      actionId: "",
      control: {
        action: "continue_codex_turn",
        disabledWhen: [],
        icon: "",
        loadingWhen: []
      },
      disabledReason: "",
      enabled: true,
      id: "continue_codex_turn",
      inputFields: [],
      label: "Ask Codex to continue",
      style: "primary"
    };
    const session = sessionPayload({
      codexTerminal: {
        commandPreview: "codex",
        id: "server-codex-terminal",
        status: "running",
        transmitting: false
      },
      intents: [],
      presentation: {
        auto: {
          nextOperation: {
            executable: false,
            kind: "wait",
            reason: "codex"
          }
        },
        intents: [],
        refreshAt: new Date(Date.now() + 5000).toISOString(),
        refreshReason: "codex_wait",
        screen: {
          icon: "progress",
          kind: "codex_running",
          message: "Wait for Codex to finish the current step.",
          sections: [],
          showProgress: true,
          title: "Waiting for Codex..."
        },
        step: {
          id: "server_step",
          label: "Server step",
          status: "awaiting_agent_result"
        }
      },
      stepMachine: {
        status: "awaiting_agent_result",
        stepId: "server_step"
      }
    });
    await mockVibe64Session(page, session, {
      onSessionRead: () => {
        if (!refreshAtMs) {
          refreshAtMs = Date.now() + 1200;
          session.presentation = {
            ...session.presentation,
            refreshAt: new Date(refreshAtMs).toISOString()
          };
        }
        if (Date.now() < refreshAtMs) {
          return;
        }
        session.intents = [continuationIntent];
        session.presentation = {
          ...session.presentation,
          intents: [continuationIntent],
          refreshAt: "",
          refreshReason: "",
          screen: {
            icon: "warning",
            kind: "codex_attention",
            message: "Codex has not reported progress for the current step.",
            sections: [],
            showProgress: false,
            title: "Codex needs attention"
          }
        };
      }
    });

    await page.goto(`${BASE_URL}/home`);
    await expect(page.getByRole("heading", { name: "Waiting for Codex..." })).toBeVisible();

    await page.getByRole("button", { name: "Inspect" }).click();
    await expect(page.locator(".codex-terminal__host")).toBeVisible();
    await page.getByRole("button", { name: "Autopilot" }).click();
    await expect(page.getByRole("heading", { name: "Waiting for Codex..." })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Codex needs attention" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask Codex to continue" })).toBeVisible();
  });

  test("keeps the server-owned Codex terminal preview behind input while transmitting", async ({ page }) => {
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
          nextOperation: {
            executable: false,
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
            submitTarget: "current-step-input",
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
            label: "Terminal is transmitting...",
            readOnlyInAutopilot: true,
            renderer: "codex_terminal",
            terminalSessionId: "server-codex-terminal",
            visible: true,
            visibleUntil: new Date(Date.now() + 10_000).toISOString()
          }
        }
      },
      stepMachine: {
        status: "waiting_for_input",
        stepId: "server_step"
      }
    });
    await mockVibe64Session(page, session);

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByLabel("Response")).toBeVisible();
    await expect(page.locator(".studio-ai-sessions__terminals--autopilot-preview")).toBeVisible();
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __vibe64CodexTerminalInputs?: string[] }).__vibe64CodexTerminalInputs || []
    ))).toEqual([]);
  });

  test("hides the server-owned Codex terminal preview after the byte activity window expires", async ({ page }) => {
    await mockCodexTerminalPreviewSocket(page);
    const session = sessionPayload({
      codexTerminal: {
        commandPreview: "codex",
        id: "server-codex-terminal",
        lastInputAt: new Date(Date.now() - 10_000).toISOString(),
        lastInputBytes: 2048,
        status: "running",
        transmitting: true
      },
      presentation: {
        auto: {
          nextOperation: {
            executable: false,
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
            prompt: "What should Codex do next?",
            submitTarget: "current-step-input",
            submitLabel: "Send to Codex",
            title: "Talk to Codex"
          },
          kind: "input",
          message: "What should Codex do next?",
          sections: [],
          title: "Talk to Codex"
        },
        terminal: {
          codex: {
            label: "Terminal is transmitting...",
            readOnlyInAutopilot: true,
            renderer: "codex_terminal",
            terminalSessionId: "server-codex-terminal",
            visible: true,
            visibleUntil: new Date(Date.now() - 5000).toISOString()
          }
        }
      },
      stepMachine: {
        status: "waiting_for_input",
        stepId: "server_step"
      }
    });
    await mockVibe64Session(page, session);

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByLabel("Response")).toBeVisible();
    await expect(page.locator(".studio-ai-sessions__terminals--autopilot-preview")).toHaveCount(0);
  });

  test("ignores stale Codex terminal preview presentation without a byte activity expiry", async ({ page }) => {
    await mockCodexTerminalPreviewSocket(page);
    const session = sessionPayload({
      codexTerminal: {
        commandPreview: "codex",
        id: "server-codex-terminal",
        status: "running",
        transmitting: true
      },
      presentation: {
        auto: {
          nextOperation: {
            executable: false,
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
            prompt: "What should Codex do next?",
            submitTarget: "current-step-input",
            submitLabel: "Send to Codex",
            title: "Talk to Codex"
          },
          kind: "input",
          message: "What should Codex do next?",
          sections: [],
          title: "Talk to Codex"
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
        status: "waiting_for_input",
        stepId: "server_step"
      }
    });
    await mockVibe64Session(page, session);

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByLabel("Response")).toBeVisible();
    await expect(page.locator(".studio-ai-sessions__terminals--autopilot-preview")).toHaveCount(0);
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
          nextOperation: {
            executable: false,
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
    await mockVibe64Session(page, session, {
      onIntent: (body) => {
        intentRequests.push(body);
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByRole("heading", { name: "Server Review" })).toBeVisible();
    await expect(page.getByText("This text came from the server.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Attach file" })).toHaveCount(0);

    const feedbackInput = page.getByLabel("Feedback");
    await feedbackInput.fill("Please adjust the copy.");
    await feedbackInput.press("Tab");
    await expect(page.getByRole("button", { name: "Ask server" })).toBeFocused();
    await page.keyboard.press("Enter");

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

  test("tabs from the Codex composer to send before workflow controls", async ({ page }) => {
    const intentRequests: unknown[] = [];
    let advances = 0;
    const session = sessionPayload({
      intents: [
        {
          enabled: true,
          id: "talk_to_codex",
          inputFields: [
            {
              kind: "textarea",
              label: "What do you want to ask Codex?",
              name: "conversationRequest"
            }
          ],
          label: "Ask Codex",
          style: "primary"
        },
        {
          enabled: true,
          id: "continue_workflow",
          label: "Next step",
          style: "primary"
        }
      ],
      presentation: {
        auto: {
          nextOperation: {
            executable: false,
            kind: "stop",
            reason: "user"
          }
        },
        screen: {
          kind: "conversation",
          message: "Ask Codex for changes.",
          primaryIntentId: "talk_to_codex",
          sections: [
            {
              kind: "response_preview"
            }
          ],
          title: "Talk to Codex"
        },
        step: {
          id: "server_step",
          label: "Talk to Codex",
          status: "waiting_for_input"
        }
      },
      stepMachine: {
        status: "waiting_for_input",
        stepId: "server_step"
      }
    });
    await mockVibe64Session(page, session, {
      conversationLog: [
        {
          assistant: {
            at: "2026-05-25T01:03:00.000Z",
            role: "assistant",
            text: Array.from({ length: 36 }, (_value, index) => `Codex line ${index + 1}.`).join("\n")
          },
          turnId: "turn-1",
          user: {
            at: "2026-05-25T01:02:00.000Z",
            role: "user",
            text: "Please inspect the current state."
          }
        }
      ],
      onAdvance: () => {
        advances += 1;
      },
      onIntent: (body) => {
        intentRequests.push(body);
      }
    });

    await page.goto(`${BASE_URL}/home`);

    const composerInput = page.getByLabel("What do you want to ask Codex?");
    await expect(composerInput).toBeVisible();
    await expect(page.getByRole("button", { name: "Next step" })).toBeVisible();
    await expect.poll(async () => page.locator(".studio-conversation-log__body").evaluate((element) => (
      element.scrollTop + element.clientHeight >= element.scrollHeight - 2
    ))).toBe(true);

    await composerInput.fill("Please tighten this up.");
    await composerInput.press("Tab");
    await expect(page.getByRole("button", { name: "Ask Codex" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect.poll(() => intentRequests).toEqual([
      {
        fields: {
          conversationRequest: "Please tighten this up."
        },
        stepId: "server_step",
        stepStatus: "waiting_for_input"
      }
    ]);
    expect(advances).toBe(0);
  });

  test("aligns the Inspect shell terminal bottom with the Codex terminal", async ({ page }) => {
    await page.setViewportSize({
      height: 948,
      width: 2048
    });
    await mockInspectTerminalSockets(page);
    const session = sessionPayload({
      completedSteps: ["worktree_created"],
      metadata: {
        worktree_path: "/workspace/example-target-app/.vibe64/sessions/active/session-renderer/worktree"
      },
      sessionRoot: "/workspace/example-target-app/.vibe64/sessions/active/session-renderer",
      worktreeReady: true
    });
    await mockVibe64Session(page, session);

    await page.goto(`${BASE_URL}/home?mode=inspect`);
    await expect(page.locator(".codex-terminal__host")).toBeVisible();
    await page.getByLabel("Open shell").click();
    await page.getByText("Worktree shell").click();
    await expect(page.locator(".vibe64-shell-controls__terminal--active .ai-command-terminal__host"))
      .toBeVisible();

    const terminalBounds = await page.evaluate(() => {
      function rectFor(selector: string) {
        const element = document.querySelector(selector);
        if (!element) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          height: rect.height,
          top: rect.top
        };
      }
      const shell = rectFor(".vibe64-shell-controls__terminal--active .ai-command-terminal__host");
      const codex = rectFor(".codex-terminal__host");
      return {
        codex,
        delta: shell && codex ? shell.bottom - codex.bottom : null,
        shell
      };
    });

    expect(terminalBounds.shell).toBeTruthy();
    expect(terminalBounds.codex).toBeTruthy();
    expect(Math.abs(terminalBounds.delta ?? Number.POSITIVE_INFINITY), JSON.stringify(terminalBounds, null, 2))
      .toBeLessThanOrEqual(0.25);
  });

  test("keeps Inspect shell terminals alive when switching to Autopilot", async ({ page }) => {
    let shellTerminalCloses = 0;
    await mockInspectTerminalSockets(page);
    const session = sessionPayload({
      completedSteps: ["worktree_created"],
      metadata: {
        worktree_path: "/workspace/example-target-app/.vibe64/sessions/active/session-renderer/worktree"
      },
      sessionRoot: "/workspace/example-target-app/.vibe64/sessions/active/session-renderer",
      worktreeReady: true
    });
    await mockVibe64Session(page, session, {
      onShellTerminalClose: () => {
        shellTerminalCloses += 1;
      }
    });

    await page.goto(`${BASE_URL}/home?mode=inspect`);
    await page.getByLabel("Open shell").click();
    await page.getByText("Worktree shell").click();
    await expect(page.locator(".vibe64-shell-controls__terminal--active .ai-command-terminal__host"))
      .toBeVisible();

    await page.getByRole("button", { name: "Autopilot" }).click();
    await expect(page).toHaveURL(/\/home(?:\?|$)/u);
    await page.waitForTimeout(100);
    expect(shellTerminalCloses).toBe(0);

    await page.getByRole("button", { name: "Inspect" }).click();
    await expect(page.locator(".vibe64-shell-controls__terminal--active .ai-command-terminal__host"))
      .toBeVisible();
  });

  test("keeps each session shell terminal alive when switching selected sessions", async ({ page }) => {
    let shellTerminalCloses = 0;
    await mockInspectTerminalSockets(page);
    const firstSession = sessionPayload({
      sessionId: "session-alpha",
      sessionName: "Alpha",
      metadata: {
        worktree_path: "/workspace/example-target-app/.vibe64/sessions/active/session-alpha/worktree"
      },
      sessionRoot: "/workspace/example-target-app/.vibe64/sessions/active/session-alpha",
      worktreeReady: true
    });
    const secondSession = sessionPayload({
      sessionId: "session-beta",
      sessionName: "Beta",
      metadata: {
        worktree_path: "/workspace/example-target-app/.vibe64/sessions/active/session-beta/worktree"
      },
      sessionRoot: "/workspace/example-target-app/.vibe64/sessions/active/session-beta",
      worktreeReady: true
    });
    await mockVibe64Session(page, secondSession, {
      onShellTerminalClose: () => {
        shellTerminalCloses += 1;
      },
      sessionList: [firstSession, secondSession]
    });

    await page.goto(`${BASE_URL}/home?mode=inspect`);
    await expect(page.locator(".studio-ai-sessions__tab", { hasText: "Beta" })).toBeVisible();
    await page.getByLabel("Open shell").click();
    await page.getByText("Worktree shell").click();
    await expect(page.locator(".vibe64-shell-controls__terminal--active .ai-command-terminal__host"))
      .toBeVisible();

    await page.locator(".studio-ai-sessions__tab", { hasText: "Alpha" }).click();
    await page.waitForTimeout(100);
    expect(shellTerminalCloses).toBe(0);

    await page.locator(".studio-ai-sessions__tab", { hasText: "Beta" }).click();
    await expect(page.locator(".vibe64-shell-controls__terminal--active .ai-command-terminal__host"))
      .toBeVisible();
    expect(shellTerminalCloses).toBe(0);
  });

  test("focuses the selected shell terminal when switching shell tabs", async ({ page }) => {
    await mockInspectTerminalSockets(page);
    const session = sessionPayload({
      completedSteps: ["worktree_created"],
      metadata: {
        worktree_path: "/workspace/example-target-app/.vibe64/sessions/active/session-renderer/worktree"
      },
      sessionRoot: "/workspace/example-target-app/.vibe64/sessions/active/session-renderer",
      worktreeReady: true
    });
    await mockVibe64Session(page, session);

    await page.goto(`${BASE_URL}/home?mode=inspect`);
    await page.getByLabel("Open shell").click();
    await page.getByText("Worktree shell").click();
    await expect(page.locator(".vibe64-shell-controls__terminal--active .ai-command-terminal__host"))
      .toBeVisible();
    await expectActiveShellTerminalFocused(page);

    await page.getByTitle("New shell tab (Alt-N)").click();
    await expect(page.locator(".vibe64-shell-controls__tab--active", { hasText: "terminal 2" }))
      .toBeVisible();
    await expectActiveShellTerminalFocused(page);

    await page.getByTitle("Alt-1: terminal 1").click();
    await expect(page.locator(".vibe64-shell-controls__tab--active", { hasText: "terminal 1" }))
      .toBeVisible();
    await expectActiveShellTerminalFocused(page);
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
          nextOperation: {
            executable: false,
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
            submitTarget: "current-step-input",
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
    await mockVibe64Session(page, session, {
      onStepInput: (body) => {
        stepInputs.push(body);
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByRole("heading", { name: "Server Questions" })).toBeVisible();
    await expect(page.locator("textarea")).toHaveCount(0);
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

async function mockVibe64Session(
  page: Page,
  session: Record<string, unknown>,
  {
    onAction = () => undefined,
    onAdvance = () => undefined,
    onCommandTerminalClose = () => undefined,
    onCommandTerminalStart = () => undefined,
    onCodexTurnContinue = () => undefined,
    onIntent = () => undefined,
    onSessionRead = () => undefined,
    onStepInput = () => undefined,
    onCodexTerminalStart = () => undefined,
    onShellTerminalClose = () => undefined,
    sessionList = null,
    conversationLog = []
  }: {
    conversationLog?: unknown[];
    onAction?: (actionId: string, body: unknown) => void;
    onAdvance?: () => void;
    onCommandTerminalClose?: () => void;
    onCommandTerminalStart?: () => Record<string, unknown> | void;
    onCodexTerminalStart?: () => void;
    onCodexTurnContinue?: () => void;
    onIntent?: (body: unknown) => void;
    onSessionRead?: (session: Record<string, unknown>) => void;
    onShellTerminalClose?: () => void;
    onStepInput?: (body: unknown) => void;
    sessionList?: Record<string, unknown>[] | null;
  } = {}
) {
  const listedSessions = Array.isArray(sessionList) ? sessionList : [session];
  function sessionForRequest(pathname: string) {
    const requestedSessionId = decodeURIComponent(pathname.split("/").at(-1) || "");
    return listedSessions.find((item) => item.sessionId === requestedSessionId) || session;
  }

  await mockStudioReady(page);
  await page.route("**/api/vibe64/sessions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "POST" && /\/codex-terminal\/continue\/?$/u.test(url.pathname)) {
      onCodexTurnContinue();
      await fulfillJson(route, {
        codexContinueInjected: true,
        commandPreview: "codex",
        id: "server-codex-terminal",
        ok: true,
        status: "running",
        terminalSessionId: "server-codex-terminal"
      });
      return;
    }
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
    if (method === "POST" && url.pathname.endsWith("/shell-terminal")) {
      await fulfillJson(route, {
        commandPreview: "bash",
        id: "server-shell-terminal",
        ok: true,
        status: "running"
      });
      return;
    }
    if (method === "POST" && /\/actions\/[^/]+$/u.test(url.pathname)) {
      onAction(url.pathname.split("/").at(-1) || "", request.postDataJSON() || {});
      await fulfillJson(route, {
        ok: true,
        ...session
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/advance")) {
      onAdvance();
      await fulfillJson(route, {
        ok: true,
        ...session
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/command-terminal")) {
      const commandTerminal = onCommandTerminalStart();
      await fulfillJson(route, {
        commandPreview: "echo test",
        id: "server-command-terminal",
        ok: true,
        status: "exited",
        ...(commandTerminal && typeof commandTerminal === "object" ? commandTerminal : {})
      });
      return;
    }
    if (method === "DELETE" && /\/command-terminal\/[^/]+$/u.test(url.pathname)) {
      onCommandTerminalClose();
      await fulfillJson(route, {
        closed: true,
        ok: true
      });
      return;
    }
    if (method === "DELETE" && /\/shell-terminal\/[^/]+$/u.test(url.pathname)) {
      onShellTerminalClose();
      await fulfillJson(route, {
        closed: true,
        ok: true
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
    if (method === "GET" && url.pathname.endsWith("/conversation-log")) {
      await fulfillJson(route, {
        conversationLog,
        ok: true,
        sessionId: session.sessionId
      });
      return;
    }
    if (method === "GET" && /\/sessions\/[^/]+$/u.test(url.pathname)) {
      onSessionRead(sessionForRequest(url.pathname));
      await fulfillJson(route, {
        ok: true,
        ...sessionForRequest(url.pathname)
      });
      return;
    }
    await fulfillJson(route, {
      creation: {
        canCreate: true,
        defaultWorkflowDefinition: "big_feature",
        mode: "select",
        workflowDefinitions: []
      },
      limits: {
        maxOpenSessions: 5,
        openSessionCount: 1
      },
      ok: true,
      sessions: listedSessions
    });
  });
}

async function recordForbiddenText(page: Page, text: string) {
  await page.addInitScript((forbiddenText) => {
    const state = window as unknown as { __vibe64ForbiddenTextSeen?: boolean };
    state.__vibe64ForbiddenTextSeen = false;
    function check() {
      if (document.body?.innerText.includes(String(forbiddenText || ""))) {
        state.__vibe64ForbiddenTextSeen = true;
      }
    }
    document.addEventListener("DOMContentLoaded", () => {
      check();
      new MutationObserver(check).observe(document.body, {
        characterData: true,
        childList: true,
        subtree: true
      });
    });
  }, text);
}

async function expectActiveShellTerminalFocused(page: Page) {
  await expect.poll(async () => page.evaluate(() => {
    const activeTerminal = document.querySelector(".vibe64-shell-controls__terminal--active");
    const activeElement = document.activeElement;
    return Boolean(activeTerminal && activeElement && activeTerminal.contains(activeElement));
  }), {
    timeout: 500
  }).toBe(true);
}

async function mockInspectTerminalSockets(page: Page) {
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;

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
        if (!pathname.includes("/codex-terminal/") && !pathname.includes("/shell-terminal/")) {
          return new OriginalWebSocket(url);
        }
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              session: {
                commandPreview: pathname.includes("/shell-terminal/") ? "bash" : "codex",
                ok: true,
                output: pathname.includes("/shell-terminal/")
                  ? "studio worktree .../session-renderer/worktree $ "
                  : "OpenAI Codex\n\nTip: Type / to open the command popup.",
                status: "running"
              },
              type: "snapshot"
            })
          }));
        }, 0);
      }

      send() {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }

    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });
}

async function mockCommandTerminalSocketThatCloses(page: Page) {
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;

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
        if (!pathname.includes("/command-terminal/")) {
          return new OriginalWebSocket(url);
        }
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              session: {
                commandPreview: "echo test",
                ok: true,
                output: "Server command output.",
                status: "running"
              },
              type: "snapshot"
            })
          }));
          this.readyState = MockWebSocket.CLOSED;
          this.dispatchEvent(new CloseEvent("close"));
        }, 0);
      }

      send() {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }

    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });
}

async function mockCodexTerminalPreviewSocket(page: Page) {
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    (window as unknown as {
      __vibe64CodexTerminalInputs: string[];
    }).__vibe64CodexTerminalInputs = [];

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
            __vibe64CodexTerminalInputs: string[];
          }).__vibe64CodexTerminalInputs.push(String(message.data || ""));
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
    artifactsRoot: "/workspace/example-target-app/.vibe64/sessions/active/session-renderer/artifacts",
    completedSteps: [],
    createdAt: "2026-05-24T00:00:00.000Z",
    currentStep: "server_step",
    currentStepDefinition,
    intents,
    metadata: {},
    next: {
      disabledReason: "Server controls this step.",
      enabled: false,
      label: "Next step",
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

function issueSourceSession(overrides: Record<string, unknown> = {}) {
  const intents = [
    {
      actionId: "use_existing_issue",
      enabled: true,
      id: "use_existing_issue",
      inputFields: [
        {
          label: "Issue URL or number",
          name: "issueRef",
          placeholder: "123, #123, or https://github.com/org/repo/issues/123",
          requiredMessage: "Issue URL or number is required."
        }
      ],
      label: "Use existing issue",
      style: "primary"
    },
    {
      actionId: "draft_issue",
      enabled: true,
      id: "draft_issue",
      inputFields: [
        {
          kind: "textarea",
          label: "What do you want Vibe64 to work on?",
          name: "conversationRequest",
          placeholder: "Describe the feature, bug, or change you want.",
          requiredMessage: "Describe what you want Vibe64 to work on."
        }
      ],
      label: "Make my own issue",
      style: "secondary"
    }
  ];
  return sessionPayload({
    currentStep: "issue_file_created",
    currentStepDefinition: {
      id: "issue_file_created",
      label: "Define or select issue"
    },
    intents,
    presentation: {
      auto: {
        nextOperation: {
          executable: false,
          kind: "stop",
          reason: "Select an existing issue or draft a new one."
        }
      },
      intents,
      screen: {
        kind: "issue_source",
        message: "Enter a GitHub issue number, or draft a new issue from a description.",
        primaryIntentId: "use_existing_issue",
        sections: [],
        title: "Define or select issue"
      },
      step: {
        id: "issue_file_created",
        label: "Define or select issue",
        status: "ready"
      }
    },
    stepDefinitions: [
      {
        id: "issue_file_created",
        label: "Define or select issue",
        status: "current"
      },
      {
        id: "issue_submitted",
        label: "Edit and submit issue",
        status: "pending"
      }
    ],
    stepMachine: {
      status: "ready",
      stepId: "issue_file_created"
    },
    ...overrides
  });
}
