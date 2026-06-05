import { expect, test, type Page, type Route } from "@playwright/test";

import { BASE_URL } from "./support/base-shell-data";
import {
  mockStudioReady
} from "./support/base-shell-mocks";

async function expectNoAttentionRequired(page: Page) {
  await expect(page.getByText("Attention required", { exact: true })).toHaveCount(0);
}

test.describe("Autopilot dumb client contract", () => {
  test("routes workspace menu shortcuts and JSKIT dashboard subpages", async ({ page }) => {
    await mockVibe64Session(page, sessionPayload());

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Tools" })).toHaveCount(0);

    await page.getByRole("tab", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/home\/dashboard\/accounts\/?$/u);
    await expectNoAttentionRequired(page);
    await expect(page.getByRole("tab", { name: "Dashboard" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
    await expect.poll(async () => page.locator(
      ".section-container-shell__nav .v-list-item-title"
    ).evaluateAll((nodes) => nodes.map((node) => String(node.textContent || "").trim()).filter(Boolean)))
      .toEqual([
        "Accounts",
        "Configure",
        "Remote",
        "Run",
        "Session History",
        "Setup"
      ]);

    for (const { label, routePath, selector, text } of [
      { label: "Accounts", routePath: "accounts", selector: ".accounts-setup", text: "Accounts" },
      { label: "Remote", routePath: "remote", selector: ".vibe64-project-tools--panel", text: "Project tools" },
      { label: "Run", routePath: "run", selector: ".target-scripts-panel", text: "" },
      { label: "Session History", routePath: "history", selector: ".vibe64-session-history-panel", text: "" },
      { label: "Setup", routePath: "setup", selector: ".vibe64-setup-panel", text: "" },
      { label: "Configure", routePath: "configure", selector: ".project-config-setup", text: "" }
    ]) {
      await page.locator(".section-container-shell__nav").getByText(label, { exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/home/dashboard/${routePath}/?(?:\\?.*)?$`, "u"));
      await expectNoAttentionRequired(page);
      await expect(page.getByRole("tab", { name: "Dashboard" })).toHaveAttribute("aria-selected", "true");
      const content = page.locator(selector);
      await expect(text ? content.filter({ hasText: text }) : content).toBeVisible();
    }
  });

  test("keeps home content visible while dashboard routes avoid setup readiness checks", async ({ page }) => {
    const setupReadinessRequests: string[] = [];
    await mockVibe64Session(page, sessionPayload());
    await page.unroute("**/api/studio/current-app/setup-readiness");
    await page.route("**/api/studio/current-app/setup-readiness", async (route) => {
      setupReadinessRequests.push(route.request().url());
      await fulfillJson(route, {
        currentStage: null,
        message: "",
        ready: true,
        stages: []
      });
    });

    await page.goto(`${BASE_URL}/home`);
    await expect(page.getByRole("tab", { name: "Preview" })).toBeVisible();

    await page.getByRole("tab", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/home\/dashboard\/accounts\/?$/u);
    await expect(page.getByText("Checking setup", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
    expect(setupReadinessRequests).toHaveLength(0);
  });

  test("keeps the chat resource mounted while switching dashboard sections", async ({ page }) => {
    const conversationLogReadPaths: string[] = [];
    const sessionReadPaths: string[] = [];
    await mockVibe64Session(page, sessionPayload(), {
      conversationLog: [
        {
          assistant: {
            at: "2026-06-02T01:03:00.000Z",
            role: "assistant",
            text: "Dashboard navigation should not reload this chat."
          },
          turnId: "turn-dashboard-reload",
          user: {
            at: "2026-06-02T01:02:00.000Z",
            role: "user",
            text: "Open the dashboard."
          }
        }
      ],
      onConversationLogRead: (pathname) => {
        conversationLogReadPaths.push(pathname);
      },
      onSessionRead: (_session, pathname) => {
        sessionReadPaths.push(pathname);
      }
    });

    await page.goto(`${BASE_URL}/home`);
    await expect(page.getByText("Dashboard navigation should not reload this chat.")).toBeVisible();
    await page.getByRole("tab", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/home\/dashboard\/accounts\/?$/u);
    await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();

    const sessionReadsAfterDashboardOpen = sessionReadPaths.length;
    const conversationReadsAfterDashboardOpen = conversationLogReadPaths.length;

    for (const { label, routePath } of [
      { label: "Configure", routePath: "configure" },
      { label: "Remote", routePath: "remote" },
      { label: "Run", routePath: "run" },
      { label: "Session History", routePath: "history" },
      { label: "Setup", routePath: "setup" },
      { label: "Accounts", routePath: "accounts" }
    ]) {
      await page.locator(".section-container-shell__nav").getByText(label, { exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/home/dashboard/${routePath}/?$`, "u"));
      await expect(page.getByText("Dashboard navigation should not reload this chat.")).toBeVisible();
      expect(sessionReadPaths, `unexpected session reads after ${label}`).toHaveLength(sessionReadsAfterDashboardOpen);
      expect(conversationLogReadPaths, `unexpected conversation reads after ${label}`).toHaveLength(conversationReadsAfterDashboardOpen);
    }
  });

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
          title: "Codex is thinking..."
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
    await expect(page.getByText("Codex is thinking...")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Codex is thinking..." })).toHaveCount(0);
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
    const session = workSourceSession();
    await mockVibe64Session(page, session, {
      onIntent: (body) => {
        intentRequests.push(body);
        session.actionResult = {
          actionLabel: "Solve existing issue",
          actionType: "adapter",
          message: "Could not resolve GitHub issue: issue not found",
          status: "blocked",
          stepId: "work_source_selected"
        };
        session.stepMachine = {
          status: "failed",
          stepId: "work_source_selected"
        };
      }
    });

    await page.goto(`${BASE_URL}/home`);
    await page.getByRole("button", { exact: true, name: "Existing issue" }).click();
    await page.getByLabel("Issue URL or number").fill("404404");
    await page.getByRole("button", { exact: true, name: "Existing issue" }).click();

    await expect.poll(() => intentRequests).toEqual([
      {
        fields: {
          issueRef: "404404"
        },
        stepId: "work_source_selected",
        stepStatus: "ready"
      }
    ]);
    await expect(page.getByText("Could not resolve GitHub issue: issue not found").first()).toBeVisible();
    await expect(page.getByText("Vibe64 intent completed.")).toHaveCount(0);
    await expect(page.getByText("Vibe64 intent could not run.")).toHaveCount(0);
    await expect(page.getByLabel("Issue URL or number")).toBeVisible();
  });

  test("progresses after a successful existing-issue intent result", async ({ page }) => {
    const session = workSourceSession();
    await mockVibe64Session(page, session, {
      onIntent: () => {
        Object.assign(session, sessionPayload({
          actionResult: {
            actionLabel: "Solve existing issue",
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
            stepId: "work_source_selected"
          },
          currentStep: "worktree_created",
          currentStepDefinition: {
            id: "worktree_created",
            label: "Create worktree"
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
              title: "Create worktree"
            },
            step: {
              id: "worktree_created",
              label: "Create worktree",
              status: "ready"
            }
          },
          stepMachine: {
            status: "ready",
            stepId: "worktree_created"
          }
        }));
      }
    });

    await page.goto(`${BASE_URL}/home`);
    await page.getByRole("button", { exact: true, name: "Existing issue" }).click();
    await page.getByLabel("Issue URL or number").fill("123");
    await page.getByRole("button", { exact: true, name: "Existing issue" }).click();

    await expect(page.getByRole("heading", { name: "Create worktree" })).toBeVisible();
    await expect(page.getByText("Could not resolve GitHub issue")).toHaveCount(0);
  });

  test("renders the starting-point choices and submits existing issue and PR refs through server intents", async ({ page }) => {
    const intentRequests: unknown[] = [];
    const session = workSourceSession();
    await mockVibe64Session(page, session, {
      onIntent: (body) => {
        intentRequests.push(body);
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByText("What would you like this session to do? Choose New issue to start fresh and let Vibe64 create a GitHub issue for the work. Choose Existing issue if you already have an issue number or URL. Choose Existing PR to continue from a pull request that already exists. Choose No issue when you only want to describe the work in chat and do not need a GitHub issue."))
      .toBeVisible();
    await expect(page.getByRole("button", { name: "New issue" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Existing issue" })).toBeVisible();
    await expect(page.getByRole("button", { name: "No issue" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Existing PR" })).toBeVisible();

    await page.getByRole("button", { name: "Existing issue" }).click();
    await expect(page.getByLabel("Issue URL or number")).toBeVisible();
    await page.getByLabel("Issue URL or number").fill("#123");
    await page.getByRole("button", { name: "Existing issue" }).click();

    await page.getByRole("button", { name: "Existing PR" }).click();
    await expect(page.getByLabel("PR URL or number")).toBeVisible();
    await page.getByLabel("PR URL or number").fill("https://github.com/example/project/pull/77");
    await page.getByRole("button", { name: "Existing PR" }).click();

    await expect.poll(() => intentRequests).toEqual([
      {
        fields: {
          issueRef: "#123"
        },
        stepId: "work_source_selected",
        stepStatus: "ready"
      },
      {
        fields: {
          prRef: "https://github.com/example/project/pull/77"
        },
        stepId: "work_source_selected",
        stepStatus: "ready"
      }
    ]);
  });

  test("advances immediately after selecting a starting point", async ({ page }) => {
    const intentRequests: unknown[] = [];
    const session = workSourceSession();
    await mockVibe64Session(page, session, {
      onIntent: (body) => {
        intentRequests.push(body);
        Object.assign(session, worktreeSession());
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await page.getByRole("button", { name: "New issue" }).click();

    await expect.poll(() => intentRequests).toEqual([
      {
        fields: {},
        stepId: "work_source_selected",
        stepStatus: "ready"
      }
    ]);
    await expect(page.getByRole("heading", { name: "Create worktree" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose starting point" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next step" })).toHaveCount(0);
  });

  test("keeps existing PR sessions on the work definition step until details are saved", async ({ page }) => {
    const advances: string[] = [];
    const session = existingPrIssueSkipSession();
    await mockVibe64Session(page, session, {
      onAdvance: () => {
        advances.push(String(session.currentStep || ""));
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByRole("heading", { name: "Define work" })).toBeVisible();
    await expect.poll(() => advances).toEqual([]);
    await expect(page.getByRole("button", { name: "Solve existing issue" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Describe work" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create issue on GH" })).toHaveCount(0);
  });

  test("advances through completed existing issue work definitions", async ({ page }) => {
    const advances: string[] = [];
    const session = existingIssueDoneSession();
    await mockVibe64Session(page, session, {
      onAdvance: () => {
        advances.push(String(session.currentStep || ""));
        Object.assign(session, sessionPayload({
          currentStep: "plan_and_execute",
          currentStepDefinition: {
            id: "plan_and_execute",
            label: "Plan and execute"
          },
          presentation: {
            auto: {
              nextOperation: {
                executable: false,
                kind: "stop",
                reason: "Codex is thinking."
              }
            },
            screen: {
              kind: "ready",
              sections: [],
              title: "Plan and execute"
            },
            step: {
              id: "plan_and_execute",
              label: "Plan and execute",
              status: "ready"
            }
          },
          stepMachine: {
            status: "ready",
            stepId: "plan_and_execute"
          }
        }));
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect.poll(() => advances).toEqual(["issue_file_created"]);
    await expect(page.getByRole("heading", { name: "Plan and execute" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Define work" })).toHaveCount(0);
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

  test("keeps a running Autopilot command alive when switching sessions", async ({ page }) => {
    await mockCommandTerminalSocketThatExits(page, {
      delayMs: 2000,
      exitCode: 1,
      output: "install failed\n"
    });
    let commandTerminalCloses = 0;
    let commandTerminalStarts = 0;
    const stepInputs: unknown[] = [];
    const commandSession = sessionPayload({
      actions: [
        {
          dispatchRoute: "command-terminal",
          enabled: true,
          id: "install_dependencies",
          label: "Install dependencies",
          type: "command"
        }
      ],
      currentStep: "dependencies_installed",
      currentStepDefinition: {
        id: "dependencies_installed",
        label: "Install dependencies"
      },
      presentation: {
        auto: {
          nextOperation: {
            actionId: "install_dependencies",
            executable: true,
            id: "command-terminal:install_dependencies",
            kind: "command",
            label: "Install dependencies",
            route: "command-terminal"
          }
        },
        screen: {
          kind: "action",
          sections: [],
          title: "Install dependencies"
        },
        step: {
          id: "dependencies_installed",
          label: "Install dependencies",
          status: "ready"
        }
      },
      sessionId: "session-alpha",
      sessionName: "Alpha",
      stepDefinitions: [
        {
          id: "dependencies_installed",
          label: "Install dependencies",
          status: "current"
        }
      ],
      stepMachine: {
        status: "ready",
        stepId: "dependencies_installed"
      }
    });
    const otherSession = sessionPayload({
      presentation: {
        auto: {
          nextOperation: {
            executable: false,
            kind: "stop",
            reason: "Other session is waiting."
          }
        },
        screen: {
          kind: "ready",
          sections: [],
          title: "Other session"
        },
        step: {
          id: "other_step",
          label: "Other step",
          status: "ready"
        }
      },
      sessionId: "session-beta",
      sessionName: "Beta"
    });
    await mockVibe64Session(page, commandSession, {
      onCommandTerminalClose: () => {
        commandTerminalCloses += 1;
        Object.assign(commandSession, {
          presentation: {
            ...(commandSession.presentation as Record<string, unknown>),
            auto: {
              nextOperation: {
                executable: false,
                kind: "wait",
                reason: "Resolve the install command failure before continuing."
              }
            },
            screen: {
              input: {
                fields: [
                  {
                    kind: "textarea",
                    label: "Retry note",
                    name: "response",
                    required: false
                  }
                ],
                kind: "command_failure_response",
                prompt: "Install dependencies failed with exit code 1.",
                submitKind: "user_response",
                submitLabel: "Retry command",
                submitTarget: "current-step-input",
                title: "Install command needs attention"
              },
              kind: "input",
              message: "Install dependencies failed with exit code 1.",
              sections: [],
              title: "Install command needs attention"
            },
            step: {
              id: "dependencies_installed",
              label: "Install dependencies",
              status: "waiting_for_input"
            }
          },
          stepMachine: {
            from: "attempting_execution",
            message: "Install dependencies failed with exit code 1.",
            status: "waiting_for_input",
            stepId: "dependencies_installed"
          }
        });
      },
      onCommandTerminalStart: () => {
        commandTerminalStarts += 1;
        return {
          commandPreview: "npm install",
          id: "server-command-terminal",
          ok: true,
          status: "running"
        };
      },
      onStepInput: (body) => {
        stepInputs.push(body);
        Object.assign(commandSession, {
          presentation: {
            ...(commandSession.presentation as Record<string, unknown>),
            auto: {
              nextOperation: {
                actionId: "install_dependencies",
                executable: true,
                id: "command-terminal:install_dependencies",
                kind: "command",
                label: "Install dependencies",
                route: "command-terminal"
              }
            },
            screen: {
              kind: "action",
              sections: [],
              title: "Install dependencies"
            },
            step: {
              id: "dependencies_installed",
              label: "Install dependencies",
              status: "ready"
            }
          },
          stepMachine: {
            status: "ready",
            stepId: "dependencies_installed"
          }
        });
      },
      sessionList: [otherSession, commandSession]
    });

    await page.goto(`${BASE_URL}/home`);
    await expect(page.locator(".studio-autopilot__command-terminal-overlay strong", {
      hasText: "Command running."
    })).toBeVisible();

    await page.locator(".studio-ai-sessions__tab", { hasText: "Beta" }).click();
    await page.waitForTimeout(30);
    expect(commandTerminalCloses).toBe(0);
    await expect(page.getByRole("heading", { name: "Other session" })).toBeVisible();
    await expect.poll(() => commandTerminalCloses).toBe(1);

    await page.locator(".studio-ai-sessions__tab", { hasText: "Alpha" }).click();
    await expect(page.locator(".studio-autopilot__command-terminal-overlay strong", {
      hasText: "Command needs attention."
    })).toBeVisible();
    await expect(page.getByRole("button", { name: "Get AI to fix it" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry command" })).toBeVisible();
    await expect(page.getByLabel("Retry note")).toBeHidden();

    await page.getByRole("button", { name: "Retry command" }).click();

    await expect.poll(() => stepInputs.length).toBe(1);
    expect(stepInputs[0]).toMatchObject({
      fields: {
        response: ""
      },
      kind: "user_response",
      source: "ui",
      stepId: "dependencies_installed",
      stepStatus: "waiting_for_input"
    });
    await expect.poll(() => commandTerminalStarts).toBe(2);
  });

  test("uses app-server turn state for Codex thinking without opening the terminal", async ({ page }) => {
    await mockCodexTerminalPreviewSocket(page);
    let codexTerminalStartRequests = 0;
    const session = sessionPayload({
      codexAgentTurn: {
        active: true,
        state: "active",
        status: "inProgress",
        turnId: "codex-app-server-turn"
      },
      codexAgentTurnActive: true,
      codexTerminal: {
        commandPreview: "codex",
        id: "server-codex-terminal",
        status: "running"
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
          title: "Codex is thinking..."
        },
        step: {
          id: "server_step",
          label: "Server step",
          status: "awaiting_agent_result"
        },
        terminal: {
          codex: {
            label: "",
            readOnlyInAutopilot: true,
            renderer: "codex_terminal",
            terminalSessionId: "server-codex-terminal",
            visible: false,
            visibleUntil: ""
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

    await expect(page.locator(".studio-ai-sessions__terminals--autopilot-preview")).toHaveCount(0);
    await expect(page.locator(".studio-ai-sessions__terminals--compact")).toHaveCount(0);
    await expect(page.locator(".studio-ai-sessions__codex-thinking-overlay")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Codex is thinking..." })).toHaveCount(0);
    await expect.poll(() => codexTerminalStartRequests).toBe(0);
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __vibe64CodexTerminalInputs?: string[] }).__vibe64CodexTerminalInputs || []
    ))).toEqual([]);
    await page.waitForTimeout(700);
    await expect.poll(() => codexTerminalStartRequests).toBe(0);
    await expect(page.locator(".studio-ai-sessions__terminals--compact .codex-terminal__host")).toHaveCount(0);
    await expect(page.getByText("Your agent needs attention")).toHaveCount(0);
    await expect(page.locator(".studio-ai-sessions__codex-thinking-overlay")).toBeVisible();
  });

  test("does not surface Codex app-server preparation failure as terminal control", async ({ page }) => {
    await mockCodexTerminalPreviewSocket(page);
    const session = sessionPayload({
      codexTerminal: {
        commandPreview: "codex",
        id: "server-codex-terminal",
        status: "running"
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
        backgroundTasks: [
          {
            error: "Codex app-server preparation failed.",
            id: "codex_app_server",
            kind: "codex_app_server",
            label: "Codex app-server",
            message: "Codex app-server preparation failed.",
            retry: {
              control: {
                action: "start_codex_terminal"
              },
              label: "Retry Codex"
            },
            status: "failed",
            terminalSessionId: "server-codex-terminal",
            updatedAt: new Date().toISOString()
          }
        ],
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
            visible: false,
            visibleUntil: ""
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

    await expect(page.getByText("Your agent needs attention")).toHaveCount(0);
    await expect(page.locator(".studio-ai-sessions__terminals--compact .codex-terminal__host")).toHaveCount(0);
    await expect(page.locator(".studio-autopilot")).not.toHaveAttribute("inert", "");
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __vibe64CodexTerminalSocketCount?: () => number }).__vibe64CodexTerminalSocketCount?.() || 0
    ))).toBe(0);
    await expect.poll(async () => page.evaluate(() => (
      ((window as unknown as { __vibe64CodexTerminalInputs?: string[] }).__vibe64CodexTerminalInputs || []).join("")
    ))).toBe("");
  });

  test("does not expose the selected session Codex terminal from Autopilot", async ({ page }) => {
    await mockCodexTerminalPreviewSocket(page);
    let globalCodexStarts = 0;
    let sessionCodexStarts = 0;
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
    const session = sessionPayload({
      metadata: {
        worktree_path: "/workspace/example-target-app/.vibe64/sessions/active/session-renderer/worktree"
      },
      worktree: "/workspace/example-target-app/.vibe64/sessions/active/session-renderer/worktree",
      worktreeReady: true
    });
    await mockVibe64Session(page, session, {
      onCodexTerminalStart: () => {
        sessionCodexStarts += 1;
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByRole("button", { name: "Codex terminal" })).toHaveCount(0);
    await expect(page.locator(".studio-ai-sessions__terminals--autopilot-foreground .codex-terminal__host")).toHaveCount(0);
    await expect.poll(() => sessionCodexStarts).toBe(0);
    await expect.poll(() => globalCodexStarts).toBe(0);
  });

  test("hides the Autopilot Codex terminal button when no session is selected", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem("vibe64:selected-session-id");
    });

    await mockStudioReady(page);
    await page.route("**/api/vibe64/sessions**", async (route) => {
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
    await expect(page.getByRole("button", { name: "Codex terminal" })).toHaveCount(0);
  });

  test("does not attach or lock a hidden Codex terminal during ordinary user input", async ({ page }) => {
    await mockCodexTerminalPreviewSocket(page);
    const session = sessionPayload({
      codexTerminal: {
        commandPreview: "codex",
        id: "server-codex-terminal",
        status: "running"
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
            label: "",
            readOnlyInAutopilot: true,
            renderer: "codex_terminal",
            terminalSessionId: "server-codex-terminal",
            visible: false,
            visibleUntil: ""
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
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __vibe64CodexTerminalSocketCount?: () => number }).__vibe64CodexTerminalSocketCount?.() || 0
    ))).toBe(0);

    await expect(page.locator(".studio-ai-sessions__terminals--autopilot-preview")).toHaveCount(0);
    await expect(page.locator(".studio-ai-sessions__codex-thinking-overlay")).toHaveCount(0);
    await expect(page.locator(".studio-autopilot")).not.toHaveAttribute("inert", "");
    await page.waitForTimeout(700);
    await expect(page.locator(".studio-ai-sessions__terminals--autopilot-preview")).toHaveCount(0);
    await expect(page.locator(".studio-ai-sessions__codex-thinking-overlay")).toHaveCount(0);
    await expect(page.locator(".studio-autopilot")).not.toHaveAttribute("inert", "");
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __vibe64CodexTerminalInputs?: string[] }).__vibe64CodexTerminalInputs || []
    ))).toEqual([]);
  });

  test("hides the server-owned Codex terminal preview when the Codex turn is idle", async ({ page }) => {
    await mockCodexTerminalPreviewSocket(page);
    const session = sessionPayload({
      codexTerminal: {
        commandPreview: "codex",
        id: "server-codex-terminal",
        lastInputAt: new Date().toISOString(),
        lastInputBytes: 2048,
        status: "running"
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
            label: "Codex is thinking...",
            readOnlyInAutopilot: true,
            renderer: "codex_terminal",
            terminalSessionId: "server-codex-terminal",
            visible: false,
            visibleUntil: ""
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

  test("keeps user input available when stale hidden Codex output is not attached", async ({ page }) => {
    await mockCodexTerminalPreviewSocket(page);
    const session = sessionPayload({
      codexTerminal: {
        commandPreview: "codex",
        id: "server-codex-terminal",
        status: "running"
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
            label: "",
            readOnlyInAutopilot: true,
            renderer: "codex_terminal",
            terminalSessionId: "server-codex-terminal",
            visible: false,
            visibleUntil: ""
          }
        }
      },
      stepMachine: {
        status: "waiting_for_input",
        stepId: "server_step"
      },
      worktree: "/workspace/example-target-app/.vibe64/sessions/active/session-renderer/worktree"
    });
    await mockVibe64Session(page, session);

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByLabel("Response")).toBeVisible();
    await expect(page.locator(".studio-ai-sessions__terminals--autopilot-preview")).toHaveCount(0);
    await expect(page.locator(".studio-autopilot")).not.toHaveAttribute("inert", "");
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __vibe64CodexTerminalSocketCount?: () => number }).__vibe64CodexTerminalSocketCount?.() || 0
    ))).toBe(0);

    await expect(page.locator(".studio-ai-sessions__terminals--autopilot-preview")).toHaveCount(0);
    await expect(page.locator(".studio-autopilot")).not.toHaveAttribute("inert", "");
    await expect(page.locator(".studio-ai-sessions__codex-thinking-overlay")).toHaveCount(0);

    await page.waitForTimeout(700);
    await expect(page.locator(".studio-ai-sessions__terminals--autopilot-preview")).toHaveCount(0);
    await expect(page.locator(".studio-autopilot")).not.toHaveAttribute("inert", "");
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __vibe64CodexTerminalInputs?: string[] }).__vibe64CodexTerminalInputs || []
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

  test("keeps a disabled composer visible when the session is temporarily not accepting input", async ({ page }) => {
    const session = sessionPayload({
      intents: [],
      presentation: {
        auto: {
          nextOperation: {
            executable: false,
            kind: "wait",
            reason: "agent"
          }
        },
        screen: {
          kind: "conversation",
          message: "Waiting for Codex.",
          primaryIntentId: "",
          sections: [
            {
              kind: "response_preview"
            }
          ],
          title: "Waiting for Codex"
        },
        step: {
          id: "server_step",
          label: "Talk to Codex",
          status: "awaiting_agent_result"
        }
      },
      stepMachine: {
        status: "awaiting_agent_result",
        stepId: "server_step"
      }
    });
    await mockVibe64Session(page, session, {
      conversationLog: [
        {
          turnId: "turn-1",
          user: {
            at: "2026-05-25T01:02:00.000Z",
            role: "user",
            text: "Please inspect the current state."
          }
        }
      ]
    });

    await page.goto(`${BASE_URL}/home`);

    const composerInput = page.getByLabel("What would you like to do?");
    await expect(composerInput).toBeVisible();
    await expect(composerInput).toBeDisabled();
  });

  test("keeps the Codex composer stable and interrupts the active turn from the inline button", async ({ page }) => {
    await mockCodexTerminalPreviewSocket(page);
    const intentRequests: unknown[] = [];
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
          id: "continue_step",
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
            text: "Previous Codex answer."
          },
          turnId: "turn-1",
          user: {
            at: "2026-05-25T01:02:00.000Z",
            role: "user",
            text: "Please inspect the current state."
          }
        }
      ],
      onIntent: (body) => {
        intentRequests.push(body);
        Object.assign(session, {
          codexTerminal: {
            commandPreview: "codex",
            id: "server-codex-terminal",
            status: "running"
          },
          presentation: {
            ...session.presentation as Record<string, unknown>,
            auto: {
              nextOperation: {
                executable: false,
                kind: "wait",
                reason: "agent"
              }
            },
            prompt: {
              state: "waiting_for_agent",
              statusText: "Codex is thinking."
            },
            screen: {
              ...((session.presentation as Record<string, unknown>).screen as Record<string, unknown>),
              showProgress: true
            },
            step: {
              id: "server_step",
              label: "Talk to Codex",
              status: "awaiting_agent_result"
            },
            terminal: {
              codex: {
                terminalSessionId: "server-codex-terminal"
              }
            }
          },
          stepMachine: {
            status: "awaiting_agent_result",
            stepId: "server_step"
          }
        });
      }
    });

    await page.goto(`${BASE_URL}/home`);

    const composerInput = page.getByLabel("What do you want to ask Codex?");
    await composerInput.fill("Please tighten this up.");
    await page.getByRole("button", { name: "Ask Codex" }).click();

    await expect.poll(() => intentRequests).toHaveLength(1);
    await expect(composerInput).toBeVisible();
    await expect(composerInput).toBeDisabled();
    await expect(page.getByRole("button", { name: "Ask Codex" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next step" })).toHaveCount(0);
    const stopButton = page.getByRole("button", { name: "Stop Codex" });
    await expect(stopButton).toBeVisible();
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __vibe64CodexTerminalSocketCount?: () => number }).__vibe64CodexTerminalSocketCount?.() || 0
    ))).toBeGreaterThan(0);

    await stopButton.click();

    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __vibe64CodexTerminalInputs?: string[] }).__vibe64CodexTerminalInputs || []
    ))).toContain("\u001b");
  });

  test("does not repeat the conversation starter after real chat history exists", async ({ page }) => {
    const session = sessionPayload({
      intents: [
        {
          enabled: true,
          id: "talk_to_codex",
          inputFields: [
            {
              kind: "textarea",
              label: "What would you like to do?",
              name: "conversationRequest"
            }
          ],
          label: "Ask Codex",
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
          message: "What would you like to do?",
          primaryIntentId: "talk_to_codex",
          sections: [
            {
              kind: "response_preview"
            }
          ],
          title: "Talk to Codex",
          variant: "guide"
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
            text: "Hello."
          },
          turnId: "turn-1",
          user: {
            at: "2026-05-25T01:02:00.000Z",
            role: "user",
            text: "Say hello."
          }
        }
      ]
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByLabel("What would you like to do?")).toBeVisible();
    await expect(page.locator(".studio-conversation-log__message-row--assistant", {
      hasText: "What would you like to do?"
    })).toHaveCount(0);
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
    let shellTerminalStarts = 0;
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
      onShellTerminalStart: () => {
        shellTerminalStarts += 1;
      },
      sessionList: [firstSession, secondSession]
    });

    await page.goto(`${BASE_URL}/home`);
    const visibleSessionTab = (name: string) => page.locator(
      ".studio-ai-session-runtime:not([style*='display: none']) .studio-ai-sessions__tab",
      { hasText: name }
    );
    await expect(visibleSessionTab("Beta")).toBeVisible();
    await visibleSessionTab("Beta").click();
    await page.getByLabel("Session tools").click();
    await page.getByRole("button", { name: "Shell" }).click();
    await expect(page.locator(".vibe64-shell-controls__terminal--active .ai-command-terminal__host"))
      .toBeVisible();
    await expect.poll(() => shellTerminalStarts).toBe(1);

    await visibleSessionTab("Alpha").click();
    await page.waitForTimeout(100);
    expect(shellTerminalCloses).toBe(0);

    await visibleSessionTab("Beta").click();
    await expect(page.locator(".vibe64-shell-controls__terminal--active .ai-command-terminal__host"))
      .toBeVisible();
    expect(shellTerminalCloses).toBe(0);
    expect(shellTerminalStarts).toBe(1);
  });

  test("focuses the selected shell terminal when switching shell tabs", async ({ page }) => {
    await mockInspectTerminalSockets(page);
    const shellTerminalStarts: unknown[] = [];
    const session = sessionPayload({
      completedSteps: ["worktree_created"],
      metadata: {
        worktree_path: "/workspace/example-target-app/.vibe64/sessions/active/session-renderer/worktree"
      },
      sessionRoot: "/workspace/example-target-app/.vibe64/sessions/active/session-renderer",
      worktreeReady: true
    });
    await mockVibe64Session(page, session, {
      onShellTerminalStart: (body) => {
        shellTerminalStarts.push(body);
        return {
          id: `server-shell-terminal-${shellTerminalStarts.length}`
        };
      }
    });

    await page.goto(`${BASE_URL}/home`);
    await page.getByLabel("Session tools").click();
    await page.getByRole("button", { name: "Shell" }).click();
    await expect(page.locator(".vibe64-shell-controls__terminal--active .ai-command-terminal__host"))
      .toBeVisible();
    await expect(page.getByTitle("Minimize terminal")).toHaveCount(0);
    await expect(page.locator(".vibe64-shell-controls__tab--active", { hasText: "worktree" }))
      .toBeVisible();
    await expectActiveShellTabsTouchTerminal(page);
    await expectActiveShellTerminalFocused(page);

    await page.getByTitle("New shell tab (Alt-N opens the last shell type)").click();
    await page.getByText("Main repo shell").click();
    await expect(page.locator(".vibe64-shell-controls__tab--active", { hasText: "repo" }))
      .toBeVisible();
    await expectActiveShellTabsTouchTerminal(page);
    await expectActiveShellTerminalFocused(page);
    await expect.poll(() => shellTerminalStarts.map((item) => String((item as { target?: string })?.target || "")))
      .toEqual(["worktree", "main"]);

    await page.keyboard.press("Alt+N");
    await expect(page.locator(".vibe64-shell-controls__tab--active", { hasText: "repo" }))
      .toBeVisible();
    await expect.poll(() => shellTerminalStarts.map((item) => String((item as { target?: string })?.target || "")))
      .toEqual(["worktree", "main", "main"]);

    await page.getByTitle("Alt-1: worktree").click();
    await expect(page.locator(".vibe64-shell-controls__tab--active", { hasText: "worktree" }))
      .toBeVisible();
    await expectActiveShellTerminalFocused(page);
  });

  test("opens a main repo shell by default when the session has no worktree", async ({ page }) => {
    await mockInspectTerminalSockets(page);
    const shellTerminalStarts: unknown[] = [];
    const session = sessionPayload({
      completedSteps: [],
      metadata: {},
      sessionRoot: "/workspace/example-target-app/.vibe64/sessions/active/session-renderer",
      worktreeReady: false
    });
    await mockVibe64Session(page, session, {
      onShellTerminalStart: (body) => {
        shellTerminalStarts.push(body);
      }
    });

    await page.goto(`${BASE_URL}/home`);
    await page.getByLabel("Session tools").click();
    await page.getByRole("button", { name: "Shell" }).click();
    await expect(page.locator(".vibe64-shell-controls__terminal--active .ai-command-terminal__host"))
      .toBeVisible();
    await expect(page.locator(".vibe64-shell-controls__tab--active", { hasText: "repo" }))
      .toBeVisible();
    await expect.poll(() => shellTerminalStarts.map((item) => String((item as { target?: string })?.target || "")))
      .toEqual(["main"]);
  });

  test("restores and clears the active session tool per session", async ({ page }) => {
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

    await page.goto(`${BASE_URL}/home`);
    const sessionToolsButton = page.getByRole("button", { name: "Session tools" });
    await sessionToolsButton.click();
    await page.getByRole("button", { name: "Shell" }).click();
    await expect(page.locator(".vibe64-shell-controls__terminal--active .ai-command-terminal__host"))
      .toBeVisible();
    await expect(page.getByText("Open a shell for this session.")).toBeHidden();

    await page.reload();
    await expect(page.locator(".vibe64-shell-controls__terminal--active .ai-command-terminal__host"))
      .toBeVisible();
    await expect(page.getByText("Open a shell for this session.")).toBeHidden();

    const sessionToolsMenu = page.locator(".studio-autopilot__session-tools-menu");
    await sessionToolsButton.click();
    await sessionToolsMenu.getByRole("button", { exact: true, name: "Session" }).click();
    await expect(page.getByRole("heading", { name: "Session Details" }).first()).toBeVisible();
    await expect(page.getByText("Open a shell for this session.")).toBeHidden();

    await sessionToolsButton.click();
    await sessionToolsMenu.getByRole("button", { name: "Shell" }).click();
    await expect(page.locator(".vibe64-shell-controls__terminal--active .ai-command-terminal__host"))
      .toBeVisible();
    await expect(page.getByText("Open a shell for this session.")).toBeHidden();

    await sessionToolsButton.click();
    await expect(sessionToolsMenu.getByRole("button", { name: "Close session tool" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Close session tool" }).click();
    await expect(page.getByText("Open a shell for this session.")).toBeHidden();

    await page.reload();
    await expect(page.getByText("Open a shell for this session.")).toBeHidden();
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

  test("renders workflow controls alongside current-step input forms", async ({ page }) => {
    const intentRequests: unknown[] = [];
    const stepInputs: unknown[] = [];
    const intents = [
      {
        enabled: true,
        id: "continue_step",
        inputFields: [],
        label: "Create GitHub issue",
        saveCurrentStepInputBeforeRun: true,
        style: "primary"
      },
      {
        actionId: "reject_issue_draft",
        enabled: true,
        id: "reject_issue_draft",
        inputFields: [
          {
            kind: "textarea",
            label: "What should change?",
            name: "feedback",
            placeholder: "Tell Codex how to improve the saved issue draft.",
            requiredMessage: "Explain what should change before sending the improvement request."
          }
        ],
        label: "Send improvement request",
        style: "secondary"
      }
    ];
    const session = sessionPayload({
      currentStep: "issue_file_created",
      currentStepDefinition: {
        id: "issue_file_created",
        label: "Define work"
      },
      intents,
      presentation: {
        auto: {
          nextOperation: {
            executable: false,
            kind: "wait",
            reason: "user"
          }
        },
        intents,
        screen: {
          input: {
            fields: [
              {
                kind: "text",
                label: "Issue title",
                name: "title",
                value: "Create root a.txt file"
              },
              {
                kind: "text",
                label: "Session label",
                name: "word",
                value: "a-txt"
              },
              {
                kind: "textarea",
                label: "Issue body",
                name: "body",
                value: Array.from({ length: 18 }, (_value, index) => (
                  `Line ${index + 1}: create a file named \`a.txt\` in the project root.`
                )).join("\n")
              }
            ],
            intents,
            prompt: "Review the issue details, then create the GitHub issue.",
            submitKind: "confirm_files",
            submitTarget: "current-step-input",
            submitLabel: "Save changes",
            title: "Define issue"
          },
          kind: "confirm_files",
          message: "Review the issue details, then create the GitHub issue.",
          sections: [],
          title: "Define issue"
        },
        step: {
          id: "issue_file_created",
          label: "Define work",
          status: "confirm_files"
        }
      },
      stepMachine: {
        status: "confirm_files",
        stepId: "issue_file_created"
      }
    });
    await mockVibe64Session(page, session, {
      onIntent: (body) => {
        intentRequests.push(body);
      },
      onStepInput: (body) => {
        stepInputs.push(body);
      }
    });

    await page.goto(`${BASE_URL}/home`);

    const autopilot = page.locator(".studio-autopilot");
    await expect(autopilot.getByRole("heading", { name: "Define issue" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(autopilot.getByRole("button", { name: "Create GitHub issue" })).toBeVisible();
    const createIssueBox = await autopilot.getByRole("button", { name: "Create GitHub issue" }).boundingBox();
    const viewport = page.viewportSize();
    expect(createIssueBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect((createIssueBox?.y || 0) + (createIssueBox?.height || 0)).toBeLessThanOrEqual(viewport?.height || 0);
    await expect(autopilot.getByLabel("Issue title")).toBeVisible();
    await expect(autopilot.getByLabel("What should change?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(autopilot.getByRole("button", { name: "Create GitHub issue" })).toBeVisible();
    await expect.poll(() => stepInputs).toEqual([]);
    await autopilot.getByLabel("What should change?").fill("Use a clearer title.");
    await autopilot.getByRole("button", { name: "Send improvement request" }).click();

    await expect.poll(() => intentRequests).toEqual([
      {
        fields: {
          feedback: "Use a clearer title."
        },
        stepId: "issue_file_created",
        stepStatus: "confirm_files"
      }
    ]);
    await expect.poll(() => stepInputs).toEqual([]);
  });

  test("saves current-step fields before running a save-backed workflow control", async ({ page }) => {
    const commandRequests: unknown[] = [];
    const intentRequests: unknown[] = [];
    const stepInputs: unknown[] = [];
    const intents = [
      {
        actionId: "create_issue_on_gh",
        enabled: true,
        id: "continue_step",
        inputFields: [],
        label: "Create GitHub issue",
        saveCurrentStepInputBeforeRun: true,
        style: "primary"
      }
    ];
    const session = sessionPayload({
      actions: [
        {
          dispatchRoute: "command-terminal",
          enabled: true,
          id: "create_issue_on_gh",
          label: "Create issue on GH",
          saveCurrentStepInputBeforeRun: true,
          type: "command",
          visible: true
        }
      ],
      currentStep: "issue_file_created",
      currentStepDefinition: {
        id: "issue_file_created",
        label: "Define work"
      },
      intents,
      presentation: {
        auto: {
          nextOperation: {
            executable: false,
            kind: "wait",
            reason: "user"
          }
        },
        intents,
        screen: {
          input: {
            fields: [
              {
                kind: "text",
                label: "Issue title",
                name: "title",
                value: "Create root a.txt file"
              },
              {
                kind: "text",
                label: "Session label",
                name: "word",
                value: "a-txt"
              },
              {
                kind: "textarea",
                label: "Issue body",
                name: "body",
                value: "Create a file named `a.txt` in the project root."
              }
            ],
            intents,
            prompt: "Review the issue details, then create the GitHub issue.",
            submitKind: "confirm_files",
            submitTarget: "current-step-input",
            submitLabel: "Save changes",
            title: "Define issue"
          },
          kind: "confirm_files",
          message: "Review the issue details, then create the GitHub issue.",
          sections: [],
          title: "Define issue"
        },
        step: {
          id: "issue_file_created",
          label: "Define work",
          status: "confirm_files"
        }
      },
      stepMachine: {
        status: "confirm_files",
        stepId: "issue_file_created"
      }
    });
    await mockVibe64Session(page, session, {
      onIntent: (body) => {
        intentRequests.push(body);
      },
      onCommandTerminalStart: (body) => {
        commandRequests.push(body);
      },
      onStepInput: (body) => {
        stepInputs.push(body);
      }
    });

    await page.goto(`${BASE_URL}/home`);

    const autopilot = page.locator(".studio-autopilot");
    await autopilot.getByLabel("Issue title").fill("Updated issue title");
    await autopilot.getByRole("button", { name: "Create GitHub issue" }).click();

    await expect.poll(() => stepInputs).toEqual([
      {
        fields: {
          body: "Create a file named `a.txt` in the project root.",
          title: "Updated issue title",
          word: "a-txt"
        },
        kind: "confirm_files",
        source: "ui",
        stepId: "issue_file_created",
        stepStatus: "confirm_files"
      }
    ]);
    await expect.poll(() => commandRequests).toEqual([
      {
        actionId: "create_issue_on_gh",
        advanceOnSuccess: false,
        input: {}
      }
    ]);
    await expect.poll(() => intentRequests).toEqual([]);
  });

  test("renders current-step actions alongside save-only input forms in Autopilot", async ({ page }) => {
    const commandRequests: unknown[] = [];
    const stepInputs: unknown[] = [];
    const session = sessionPayload({
      actions: [
        {
          dispatchRoute: "command-terminal",
          enabled: true,
          id: "create_pr_on_gh",
          label: "Create PR on GH",
          saveCurrentStepInputBeforeRun: true,
          type: "command",
          visible: true
        }
      ],
      currentStep: "create_and_merge_pull_request",
      currentStepDefinition: {
        id: "create_and_merge_pull_request",
        label: "Create pull request, possibly merge"
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
                kind: "text",
                label: "Pull request title",
                name: "title",
                value: "Draft title"
              },
              {
                kind: "textarea",
                label: "Pull request body",
                name: "body",
                value: "Draft body"
              }
            ],
            kind: "collect_input_run_command",
            prompt: "Review the pull request details.",
            submitKind: "confirm_files",
            submitTarget: "current-step-input",
            submitLabel: "Save draft",
            title: "Create pull request, possibly merge"
          },
          kind: "confirm_files",
          message: "Review the pull request details.",
          sections: [],
          title: "Create pull request, possibly merge"
        },
        step: {
          id: "create_and_merge_pull_request",
          label: "Create pull request, possibly merge",
          status: "confirm_files"
        }
      },
      stepMachine: {
        status: "confirm_files",
        stepId: "create_and_merge_pull_request"
      }
    });
    await mockVibe64Session(page, session, {
      onCommandTerminalStart: (body) => {
        commandRequests.push(body);
      },
      onStepInput: (body) => {
        stepInputs.push(body);
      }
    });

    await page.goto(`${BASE_URL}/home`);

    const autopilot = page.locator(".studio-autopilot");
    await expect(autopilot.getByRole("button", { name: "Save draft" })).toBeVisible();
    await expect(autopilot.getByRole("button", { name: "Create PR on GH" })).toBeVisible();
    await autopilot.getByLabel("Pull request title").fill("Edited PR title");
    await autopilot.getByRole("button", { name: "Create PR on GH" }).click();

    await expect.poll(() => stepInputs).toEqual([
      {
        fields: {
          body: "Draft body",
          title: "Edited PR title"
        },
        kind: "confirm_files",
        source: "ui",
        stepId: "create_and_merge_pull_request",
        stepStatus: "confirm_files"
      }
    ]);
    await expect.poll(() => commandRequests).toEqual([
      {
        actionId: "create_pr_on_gh",
        advanceOnSuccess: false,
        input: {}
      }
    ]);
  });

  test("renders workflow controls with current-step input fields in Inspect", async ({ page }) => {
    const intentRequests: unknown[] = [];
    const stepInputs: unknown[] = [];
    const intents = [
      {
        enabled: true,
        id: "continue_step",
        inputFields: [],
        label: "Use this description",
        saveCurrentStepInputBeforeRun: true,
        style: "primary"
      },
      {
        actionId: "reject_issue_draft",
        enabled: true,
        id: "reject_issue_draft",
        inputFields: [
          {
            kind: "textarea",
            label: "What should change?",
            name: "feedback",
            placeholder: "Tell Codex how to improve the saved issue draft.",
            requiredMessage: "Explain what should change before sending the improvement request."
          }
        ],
        label: "Send improvement request",
        style: "secondary"
      }
    ];
    const session = sessionPayload({
      actions: [
        {
          enabled: false,
          id: "draft_issue",
          label: "Describe work",
          visible: true
        },
        {
          enabled: false,
          id: "create_issue_on_gh",
          label: "Create issue on GH",
          visible: true
        }
      ],
      currentStep: "issue_file_created",
      currentStepDefinition: {
        id: "issue_file_created",
        label: "Define work"
      },
      intents,
      presentation: {
        intents,
        screen: {
          input: {
            fields: [
              {
                kind: "text",
                label: "Work title",
                name: "title",
                value: "Add empty a.txt to worktree root"
              },
              {
                kind: "text",
                label: "Session label",
                name: "word",
                value: "a-txt"
              },
              {
                kind: "textarea",
                label: "Work description",
                name: "body",
                value: "Create an empty file named `a.txt` in the active Vibe64 worktree root."
              }
            ],
            intents,
            prompt: "Review the work details, then continue without creating a GitHub issue.",
            submitKind: "confirm_files",
            submitTarget: "current-step-input",
            submitLabel: "Save changes",
            title: "Define work"
          },
          kind: "confirm_files",
          message: "Review the work details, then continue without creating a GitHub issue.",
          primaryIntentId: "",
          sections: [],
          title: "Define work"
        },
        step: {
          id: "issue_file_created",
          label: "Define work",
          status: "confirm_files"
        }
      },
      stepDefinitions: [
        {
          id: "issue_file_created",
          index: 0,
          label: "Define work",
          status: "current"
        }
      ],
      stepMachine: {
        status: "confirm_files",
        stepId: "issue_file_created"
      }
    });
    await mockVibe64Session(page, session, {
      onIntent: (body) => {
        intentRequests.push(body);
      },
      onStepInput: (body) => {
        stepInputs.push(body);
      }
    });

    await page.goto(`${BASE_URL}/home?mode=inspect`);

    const inspect = page.locator(".studio-ai-sessions__inspect-slot");
    await expect(inspect.getByLabel("Work title")).toHaveValue("Add empty a.txt to worktree root");
    await expect(inspect.getByLabel("Session label")).toHaveValue("a-txt");
    await expect(inspect.getByLabel("Work description")).toHaveValue("Create an empty file named `a.txt` in the active Vibe64 worktree root.");
    await expect(inspect.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(inspect.getByRole("button", { name: "Next step" })).toHaveCount(0);
    await expect(inspect.getByRole("button", { name: "Describe work" })).toHaveCount(0);
    await expect(inspect.getByRole("button", { name: "Create issue on GH" })).toHaveCount(0);
    await expect(inspect.getByRole("button", { name: "Use this description" })).toBeVisible();
    await expect(inspect.getByRole("button", { name: "Send improvement request" })).toBeVisible();
    await expect(inspect.getByLabel("What should change?")).toBeVisible();
    await inspect.getByLabel("What should change?").fill("Make the acceptance criteria stricter.");
    await inspect.getByRole("button", { name: "Send improvement request" }).click();
    await expect.poll(() => intentRequests).toEqual([
      {
        fields: {
          feedback: "Make the acceptance criteria stricter."
        },
        stepId: "issue_file_created",
        stepStatus: "confirm_files"
      }
    ]);
    await expect.poll(() => stepInputs).toEqual([]);

    intentRequests.length = 0;
    await inspect.getByRole("button", { name: "Use this description" }).click();
    await expect.poll(() => stepInputs).toEqual([
      {
        fields: {
          body: "Create an empty file named `a.txt` in the active Vibe64 worktree root.",
          title: "Add empty a.txt to worktree root",
          word: "a-txt"
        },
        kind: "confirm_files",
        source: "ui",
        stepId: "issue_file_created",
        stepStatus: "confirm_files"
      }
    ]);
    await expect.poll(() => intentRequests).toEqual([
      {
        fields: {},
        stepId: "issue_file_created",
        stepStatus: "confirm_files"
      }
    ]);
  });

  test("saves current-step fields before running an action-backed workflow control in Inspect", async ({ page }) => {
    const commandRequests: unknown[] = [];
    const intentRequests: unknown[] = [];
    const stepInputs: unknown[] = [];
    const intents = [
      {
        actionId: "create_issue_on_gh",
        enabled: true,
        id: "continue_step",
        inputFields: [],
        label: "Create GitHub issue",
        saveCurrentStepInputBeforeRun: true,
        style: "primary"
      }
    ];
    const session = sessionPayload({
      actions: [
        {
          dispatchRoute: "command-terminal",
          enabled: true,
          id: "create_issue_on_gh",
          label: "Create issue on GH",
          saveCurrentStepInputBeforeRun: true,
          type: "command",
          visible: true
        }
      ],
      currentStep: "issue_file_created",
      currentStepDefinition: {
        id: "issue_file_created",
        label: "Define work"
      },
      intents,
      presentation: {
        intents,
        screen: {
          input: {
            fields: [
              {
                kind: "text",
                label: "Issue title",
                name: "title",
                value: "Separate Drying and Cleaning workflows"
              },
              {
                kind: "text",
                label: "Session label",
                name: "word",
                value: "drying-cleaning"
              },
              {
                kind: "textarea",
                label: "Issue body",
                name: "body",
                value: "Correct the pollen workflow so received pollen goes through drying first."
              }
            ],
            intents,
            prompt: "Review the issue details, then create the GitHub issue.",
            submitKind: "confirm_files",
            submitTarget: "current-step-input",
            submitLabel: "Save changes",
            title: "Define issue"
          },
          kind: "confirm_files",
          message: "Review the issue details, then create the GitHub issue.",
          sections: [],
          title: "Define issue"
        },
        step: {
          id: "issue_file_created",
          label: "Define work",
          status: "confirm_files"
        }
      },
      stepMachine: {
        status: "confirm_files",
        stepId: "issue_file_created"
      }
    });
    await mockVibe64Session(page, session, {
      onCommandTerminalStart: (body) => {
        commandRequests.push(body);
      },
      onIntent: (body) => {
        intentRequests.push(body);
      },
      onStepInput: (body) => {
        stepInputs.push(body);
      }
    });

    await page.goto(`${BASE_URL}/home?mode=inspect`);

    const inspect = page.locator(".studio-ai-sessions__inspect-slot");
    await inspect.getByLabel("Issue title").fill("Updated issue title");
    await inspect.getByRole("button", { name: "Create GitHub issue" }).click();

    await expect.poll(() => stepInputs).toEqual([
      {
        fields: {
          body: "Correct the pollen workflow so received pollen goes through drying first.",
          title: "Updated issue title",
          word: "drying-cleaning"
        },
        kind: "confirm_files",
        source: "ui",
        stepId: "issue_file_created",
        stepStatus: "confirm_files"
      }
    ]);
    await expect.poll(() => commandRequests).toEqual([
      {
        actionId: "create_issue_on_gh",
        advanceOnSuccess: false,
        input: {}
      }
    ]);
    await expect.poll(() => intentRequests).toEqual([]);
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
    onConversationLogRead = () => undefined,
    onIntent = () => undefined,
    onSessionRead = () => undefined,
    onStepInput = () => undefined,
    onCodexTerminalStart = () => undefined,
    onShellTerminalClose = () => undefined,
    onShellTerminalStart = () => undefined,
    sessionList = null,
    conversationLog = []
  }: {
    conversationLog?: unknown[];
    onAction?: (actionId: string, body: unknown) => void;
    onAdvance?: () => void;
    onCommandTerminalClose?: () => void;
    onCommandTerminalStart?: (body?: Record<string, unknown>) => Record<string, unknown> | void;
    onCodexTerminalStart?: () => Record<string, unknown> | void;
    onConversationLogRead?: (pathname: string) => void;
    onIntent?: (body: unknown) => void;
    onSessionRead?: (session: Record<string, unknown>, pathname: string) => void;
    onShellTerminalClose?: () => void;
    onShellTerminalStart?: (body?: Record<string, unknown>) => Record<string, unknown> | void;
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
    if (method === "POST" && url.pathname.endsWith("/codex-terminal")) {
      const codexTerminal = onCodexTerminalStart();
      await fulfillJson(route, {
        commandPreview: "codex",
        id: "server-codex-terminal",
        ok: true,
        status: "running",
        ...(codexTerminal && typeof codexTerminal === "object" ? codexTerminal : {})
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/shell-terminal")) {
      const shellTerminal = onShellTerminalStart(request.postDataJSON() || {});
      await fulfillJson(route, {
        commandPreview: "bash",
        id: "server-shell-terminal",
        ok: true,
        status: "running",
        ...(shellTerminal && typeof shellTerminal === "object" ? shellTerminal : {})
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
      const commandTerminal = onCommandTerminalStart(request.postDataJSON() || {});
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
      onConversationLogRead(url.pathname);
      await fulfillJson(route, {
        conversationLog,
        ok: true,
        sessionId: session.sessionId
      });
      return;
    }
    if (method === "GET" && /\/sessions\/[^/]+$/u.test(url.pathname)) {
      onSessionRead(sessionForRequest(url.pathname), url.pathname);
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

async function expectActiveShellTabsTouchTerminal(page: Page) {
  await expect.poll(async () => page.evaluate(() => {
    const tab = document.querySelector(".vibe64-shell-controls__terminal--active .vibe64-shell-controls__tab--active");
    const host = document.querySelector(".vibe64-shell-controls__terminal--active .ai-command-terminal__host");
    const tabRect = tab?.getBoundingClientRect?.();
    const hostRect = host?.getBoundingClientRect?.();
    if (!tabRect || !hostRect) {
      return Number.POSITIVE_INFINITY;
    }
    return hostRect.top - tabRect.bottom;
  }), {
    timeout: 500
  }).toBeLessThanOrEqual(1);
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

async function mockCommandTerminalSocketThatExits(page: Page, {
  delayMs = 0,
  exitCode = 0,
  output = "Server command output."
} = {}) {
  await page.addInitScript(({ delayMs: exitDelayMs, exitCode: commandExitCode, output: commandOutput }) => {
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
                commandPreview: "npm install",
                ok: true,
                output: commandOutput,
                status: "running"
              },
              type: "snapshot"
            })
          }));
          window.setTimeout(() => {
            this.dispatchEvent(new MessageEvent("message", {
              data: JSON.stringify({
                exitCode: commandExitCode,
                status: "exited",
                type: "status"
              })
            }));
          }, exitDelayMs);
        }, 0);
      }

      send() {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }

    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  }, {
    delayMs,
    exitCode,
    output
  });
}

async function mockCodexTerminalPreviewSocket(page: Page) {
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    const codexSockets: MockWebSocket[] = [];
    (window as unknown as {
      __vibe64CodexTerminalInputs: string[];
      __vibe64PushCodexTerminalOutput: (output: string) => void;
    }).__vibe64CodexTerminalInputs = [];
    (window as unknown as {
      __vibe64PushCodexTerminalOutput: (output: string) => void;
    }).__vibe64PushCodexTerminalOutput = (output: string) => {
      for (const socket of codexSockets) {
        if (socket.readyState === MockWebSocket.OPEN) {
          socket.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              chunk: String(output || ""),
              type: "output"
            })
          }));
        }
      }
    };

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
        codexSockets.push(this);
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
        const index = codexSockets.indexOf(this);
        if (index >= 0) {
          codexSockets.splice(index, 1);
        }
        this.dispatchEvent(new CloseEvent("close"));
      }
    }

    (window as unknown as {
      __vibe64CodexTerminalSocketCount: () => number;
    }).__vibe64CodexTerminalSocketCount = () => codexSockets
      .filter((socket) => socket.readyState === MockWebSocket.OPEN)
      .length;

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
      label: "Describe work",
      style: "primary"
    },
    {
      actionId: "create_issue_on_gh",
      enabled: false,
      id: "create_issue_on_gh",
      inputFields: [],
      label: "Create issue on GH",
      style: "secondary"
    }
  ];
  return sessionPayload({
    currentStep: "issue_file_created",
    currentStepDefinition: {
      id: "issue_file_created",
      label: "Define work"
    },
    intents,
    presentation: {
      auto: {
        nextOperation: {
          executable: false,
          kind: "stop",
          reason: "Describe the work before continuing."
        }
      },
      intents,
      screen: {
        kind: "issue_source",
        message: "Tell me what you want built or fixed. Vibe64 can turn it into a GitHub issue if this session needs one.",
        primaryIntentId: "draft_issue",
        sections: [],
        title: "Define work",
        variant: "guide"
      },
      step: {
        id: "issue_file_created",
        label: "Define work",
        status: "ready"
      }
    },
    stepDefinitions: [
      {
        id: "issue_file_created",
        label: "Define work",
        status: "current"
      },
      {
        id: "plan_and_execute",
        label: "Plan and execute",
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

function workSourceSession(overrides: Record<string, unknown> = {}) {
  const intents = [
    {
      actionId: "use_new_issue",
      enabled: true,
      id: "use_new_issue",
      inputFields: [],
      label: "New issue",
      style: "primary"
    },
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
      label: "Existing issue",
      style: "secondary"
    },
    {
      actionId: "use_existing_pr",
      enabled: true,
      id: "use_existing_pr",
      inputFields: [
        {
          label: "PR URL or number",
          name: "prRef",
          placeholder: "123, #123, or https://github.com/org/repo/pull/123",
          requiredMessage: "PR URL or number is required."
        }
      ],
      label: "Existing PR",
      style: "secondary"
    },
    {
      actionId: "use_description",
      enabled: true,
      id: "use_description",
      inputFields: [],
      label: "No issue",
      style: "secondary"
    }
  ];
  return sessionPayload({
    currentStep: "work_source_selected",
    currentStepDefinition: {
      id: "work_source_selected",
      label: "Choose starting point"
    },
    intents,
    presentation: {
      auto: {
        nextOperation: {
          executable: false,
          kind: "wait",
          reason: "user"
        }
      },
      intents,
      screen: {
        kind: "work_source",
        message: "What would you like this session to do? Choose New issue to start fresh and let Vibe64 create a GitHub issue for the work. Choose Existing issue if you already have an issue number or URL. Choose Existing PR to continue from a pull request that already exists. Choose No issue when you only want to describe the work in chat and do not need a GitHub issue.",
        sections: [],
        title: "Choose starting point",
        variant: "guide"
      },
      step: {
        id: "work_source_selected",
        label: "Choose starting point",
        status: "ready"
      }
    },
    stepDefinitions: [
      {
        id: "work_source_selected",
        label: "Choose starting point",
        status: "current"
      },
      {
        id: "worktree_created",
        label: "Create worktree",
        status: "pending"
      }
    ],
    stepMachine: {
      status: "ready",
      stepId: "work_source_selected"
    },
    ...overrides
  });
}

function worktreeSession(overrides: Record<string, unknown> = {}) {
  return sessionPayload({
    actions: [
      {
        dispatchRoute: "command-terminal",
        enabled: true,
        id: "create_worktree",
        label: "Create worktree",
        type: "command"
      }
    ],
    currentStep: "worktree_created",
    currentStepDefinition: {
      id: "worktree_created",
      label: "Create worktree"
    },
    next: {
      enabled: false,
      stepId: "dependencies_installed",
      visible: true
    },
    presentation: {
      auto: {
        nextOperation: {
          actionId: "create_worktree",
          executable: true,
          id: "command-terminal:create_worktree",
          kind: "command",
          label: "Create worktree",
          route: "command-terminal"
        }
      },
      intents: [],
      screen: {
        kind: "action",
        message: "Create the session worktree.",
        sections: [],
        title: "Create worktree"
      },
      step: {
        id: "worktree_created",
        label: "Create worktree",
        status: "ready"
      }
    },
    stepDefinitions: [
      {
        id: "work_source_selected",
        label: "Choose starting point",
        status: "done"
      },
      {
        id: "worktree_created",
        label: "Create worktree",
        status: "current"
      }
    ],
    stepMachine: {
      status: "ready",
      stepId: "worktree_created"
    },
    ...overrides
  });
}

function existingPrIssueSkipSession(overrides: Record<string, unknown> = {}) {
  const intents = [
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
      label: "Describe work",
      style: "primary"
    }
  ];
  return sessionPayload({
    actions: [
      {
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
        label: "Describe work"
      },
      {
        enabled: false,
        id: "create_issue_on_gh",
        label: "Create issue on GH"
      }
    ],
    currentStep: "issue_file_created",
    currentStepDefinition: {
      id: "issue_file_created",
      label: "Define work"
    },
    intents,
    metadata: {
      github_issue_mode: "skip",
      issue_source: "none",
      source_pr_title: "Upstream feature",
      source_pr_update_mode: "stacked",
      source_pr_url: "https://github.com/example/project/pull/77",
      work_anchor_type: "pull_request",
      work_source: "existing_pr"
    },
    next: {
      disabledReason: "Describe the work before continuing.",
      enabled: false,
      label: "Next step",
      stepId: "plan_and_execute",
      visible: true
    },
    presentation: {
      auto: {
        nextOperation: {
          executable: false,
          kind: "stop",
          reason: "Describe the work before continuing."
        }
      },
      intents,
      screen: {
        kind: "issue_source",
        message: "Tell me what you want built or fixed. Vibe64 can turn it into a GitHub issue if this session needs one.",
        primaryIntentId: "draft_issue",
        sections: [],
        title: "Define work",
        variant: "guide"
      },
      step: {
        id: "issue_file_created",
        label: "Define work",
        status: "ready"
      }
    },
    stepMachine: {
      message: "Describe the work before continuing.",
      phase: "choose_source",
      status: "ready",
      stepId: "issue_file_created"
    },
    ...overrides
  });
}

function existingIssueDoneSession(overrides: Record<string, unknown> = {}) {
  const intents = [
    {
      enabled: true,
      id: "continue_step",
      label: "Next step",
      operation: "continue",
      style: "primary"
    }
  ];
  return sessionPayload({
    actions: [
      {
        disabledReason: "The GitHub issue state is already resolved.",
        enabled: false,
        id: "create_issue_on_gh",
        label: "Create issue on GH"
      },
      {
        disabledReason: "Work details are already saved.",
        enabled: false,
        id: "draft_issue",
        label: "Describe work"
      }
    ],
    currentStep: "issue_file_created",
    currentStepDefinition: {
      id: "issue_file_created",
      label: "Define work"
    },
    intents,
    metadata: {
      github_issue_mode: "reuse",
      issue_url: "https://github.com/example/project/issues/12",
      work_source: "existing_issue"
    },
    next: {
      disabledReason: "",
      enabled: true,
      label: "Next step",
      stepId: "plan_and_execute",
      visible: true
    },
    presentation: {
      auto: {
        nextOperation: {
          executable: true,
          id: "session-advance:plan_and_execute",
          kind: "advance",
          label: "Next step",
          route: "session-advance"
        }
      },
      intents,
      screen: {
        kind: "ready",
        sections: [],
        title: "Define work"
      },
      step: {
        id: "issue_file_created",
        label: "Define work",
        status: "done"
      }
    },
    stepDefinitions: [
      {
        id: "issue_file_created",
        label: "Define work",
        status: "current"
      },
      {
        id: "plan_and_execute",
        label: "Plan and execute",
        status: "pending"
      }
    ],
    stepMachine: {
      phase: "existing_selected",
      status: "done",
      stepId: "issue_file_created"
    },
    ...overrides
  });
}
