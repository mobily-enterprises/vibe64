import { expect, test, type Page, type Route } from "@playwright/test";

const targetRoot = "/workspace/example-target-app";
const savedProjectConfigValues = {
  github_pr_merge_method: "merge",
  jskit_database_runtime: "none"
};

test("home loads through a self-contained mocked Studio shell", async ({ page }) => {
  await mockReadyStudioShell(page);

  await page.goto("/home");

  await expect(page).toHaveURL(/\/home$/u);
  await expect(page.getByRole("link", { name: "Setup", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Target Scripts", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Session" })).toBeVisible();
  await page.getByRole("button", { name: "New Session" }).click();
  await expect(page.getByText("Session type")).toBeVisible();
  await expect(page.getByText("Big feature", { exact: true })).toBeVisible();
  await expect(page.getByText("General coding", { exact: true })).toBeVisible();
  await expect(page.getByText("Documentation/non code maintenance", { exact: true })).toBeVisible();
  await expect(page.getByText("Non-commit maintenance", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/home$/u);
});

async function mockReadyStudioShell(page: Page) {
  let projectConfigResolved = false;
  let markProjectConfigResolved = () => undefined;
  const projectConfigReady = new Promise<void>((resolve) => {
    markProjectConfigResolved = () => {
      if (projectConfigResolved) {
        return;
      }
      projectConfigResolved = true;
      resolve();
    };
  });
  const setupReadinessReadyPayload = {
    currentStage: null,
    message: "",
    ready: true,
    stages: [
      {
        checks: [],
        ok: true,
        ready: true
      },
      {
        accounts: [
          {
            connected: true,
            id: "codex",
            label: "Codex",
            status: "connected"
          },
          {
            connected: true,
            id: "github",
            label: "GitHub",
            status: "connected"
          }
        ],
        ok: true,
        ready: true
      },
      {
        checks: [],
        ok: true,
        ready: true
      },
      {
        ok: true,
        ready: true,
        stages: []
      }
    ]
  };
  const apiPayloads = new Map<string, unknown>([
    [
      "/api/bootstrap",
      {
        app: {
          features: {
            assistantEnabled: false,
            assistantRequiredPermission: "",
            socialEnabled: false,
            socialFederationEnabled: false
          }
        },
        definition: null,
        requestMeta: {
          hasRequest: false
        },
        session: {
          authenticated: false,
          oauthDefaultProvider: null,
          oauthProviders: []
        },
        surfaceAccess: {},
        userSettings: null
      }
    ],
    [
      "/api/ai-studio/project-type",
      {
        ok: true,
        projectType: {
          adapter: {
            id: "jskit",
            label: "JSKIT target adapter"
          },
          availableProjectTypes: [
            {
              enabled: true,
              id: "jskit",
              label: "JSKIT AI"
            }
          ],
          errorCode: "",
          message: "",
          path: `${targetRoot}/.ai-studio/project_type`,
          projectType: "jskit",
          ready: true,
          status: "ready",
          targetRoot
        }
      }
    ],
    [
      "/api/ai-studio/project-config",
      {
        config: {
          adapter: {
            id: "jskit",
            label: "JSKIT target adapter"
          },
          configRoot: `${targetRoot}/.ai-studio/config`,
          defaults: savedProjectConfigValues,
          fields: [],
          fieldValues: Object.fromEntries(
            Object.entries(savedProjectConfigValues).map(([fieldId, value]) => [
              fieldId,
              {
                defaultValue: value,
                filePath: `${targetRoot}/.ai-studio/config/${fieldId}`,
                invalid: null,
                saved: true,
                value
              }
            ])
          ),
          helperPath: `${targetRoot}/.ai-studio/runtime/ai-studio-config.sh`,
          invalid: [],
          message: "",
          missing: [],
          projectType: "jskit",
          ready: true,
          runtimeRoot: `${targetRoot}/.ai-studio/runtime`,
          sections: [],
          values: savedProjectConfigValues
        },
        ok: true
      }
    ],
    [
      "/api/ai-studio/accounts",
      {
        accounts: [
          {
            connected: true,
            id: "codex",
            label: "Codex",
            status: "connected"
          },
          {
            connected: true,
            id: "github",
            label: "GitHub",
            status: "connected"
          }
        ],
        ok: true,
        ready: true
      }
    ],
    [
      "/api/studio/studio-setup",
      {
        checks: [],
        ok: true,
        ready: true
      }
    ],
    [
      "/api/studio/adapter-setup",
      {
        checks: [],
        ok: true,
        ready: true
      }
    ],
    [
      "/api/studio/project-setup",
      {
        ok: true,
        ready: true,
        stages: []
      }
    ],
    [
      "/api/studio/current-app/setup-readiness",
      setupReadinessReadyPayload
    ],
    [
      "/api/studio/current-app/setup-readiness/stream",
      setupReadinessReadyPayload
    ],
    [
      "/api/studio/current-app",
      {
        adapter: {
          id: "jskit",
          label: "JSKIT"
        },
        git: {
          branch: "main",
          checked: true,
          dirty: false,
          isRepo: true
        },
        ok: true,
        ready: true,
        rootPath: targetRoot
      }
    ],
    [
      "/api/ai-studio/sessions",
      {
        creation: {
          canCreate: true,
          defaultWorkflowDefinition: "big_feature",
          disabledReason: "",
          mode: "select",
          requiredWorkflowDefinition: null,
          seedRequired: false,
          workflowDefinitions: [
            {
              description: "Plan, implement, review, validate, commit, create a PR, and optionally merge.",
              id: "big_feature",
              label: "Big feature"
            },
            {
              description: "Make focused code changes with Codex, review, validate, commit, create a PR, and optionally merge.",
              id: "general_coding",
              label: "General coding"
            },
            {
              description: "Update documentation or other non-code project files, validate, commit, create a PR, and optionally merge.",
              id: "non_code_maintenance",
              label: "Documentation/non code maintenance"
            },
            {
              description: "Run a local maintenance task without commit, pull request, or merge steps.",
              id: "non_commit_maintenance",
              label: "Non-commit maintenance"
            }
          ]
        },
        limits: {
          maxOpenSessions: 5,
          openSessionCount: 0
        },
        ok: true,
        sessions: [],
        stepDefinitions: []
      }
    ]
  ]);

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();

    if (method !== "GET" || !apiPayloads.has(url.pathname)) {
      throw new Error(`Self-contained smoke spec does not mock ${method} ${url.pathname}.`);
    }

    if (url.pathname === "/api/studio/current-app") {
      await projectConfigReady;
    }

    if (url.pathname.endsWith("/stream")) {
      await fulfillSse(route, apiPayloads.get(url.pathname));
    } else {
      await fulfillJson(route, apiPayloads.get(url.pathname));
    }

    if (url.pathname === "/api/ai-studio/project-config") {
      markProjectConfigResolved();
    }
  });
}

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: "application/json"
  });
}

async function fulfillSse(route: Route, payload: unknown) {
  await route.fulfill({
    body: `event: run.finished\ndata: ${JSON.stringify({
      status: payload
    })}\n\n`,
    contentType: "text/event-stream"
  });
}
