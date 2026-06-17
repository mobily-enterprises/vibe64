import { expect, test } from "@playwright/test";

import {
  DASHBOARD_PATH,
  DEVELOPMENT_PATH,
  SCOPED_API_PREFIX,
  targetRoot
} from "./support/base-shell-data";
import {
  fulfillJson,
  routeApiEndpoint,
  setupReadinessPayload
} from "./support/base-shell/http";
import {
  mockProtectedRouteReady
} from "./support/base-shell/setup-mocks";

test("connection events refresh inactive project capabilities without page-show fetches", async ({ page }) => {
  let codexConnected = false;
  let capabilitiesRequests = 0;
  const capabilitiesRequestPaths: string[] = [];
  const scopedCapabilitiesPath = `${SCOPED_API_PREFIX}/studio/current-app/capabilities`;

  await mockProtectedRouteReady(page);
  await routeApiEndpoint(page, "/studio/current-app/capabilities", async (route) => {
    capabilitiesRequests += 1;
    capabilitiesRequestPaths.push(new URL(route.request().url()).pathname);
    await fulfillJson(route, capabilitiesPayload(codexConnected));
  });
  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    await fulfillJson(route, emptySessionsPayload());
  });

  await page.goto(`${DEVELOPMENT_PATH}?vibe64_e2e=1`);
  const createSessionButton = page.getByRole("button", { name: "Create session" });
  await expect(createSessionButton).toBeDisabled();
  await expect(page.getByLabel("Session chat").getByText("Choose and authenticate an AI provider before starting a session.")).toBeVisible();
  await expect.poll(() => capabilitiesRequests).toBeGreaterThan(0);
  expect(capabilitiesRequestPaths.at(-1)).toBe(scopedCapabilitiesPath);
  const initialCapabilitiesRequests = capabilitiesRequests;

  await navigateInSpa(page, `${DASHBOARD_PATH}/history?vibe64_e2e=1`);
  await expect(page.getByRole("heading", { name: "Session History" })).toBeVisible();

  codexConnected = true;
  await emitConnectionChangedForCapabilities(page, {
    authSessionId: "playwright-auth-session",
    connectionId: "codex",
    connected: true,
    reason: "exit",
    status: "connected"
  });

  await expect.poll(() => capabilitiesRequests).toBe(initialCapabilitiesRequests + 1);
  expect(capabilitiesRequestPaths.at(-1)).toBe(scopedCapabilitiesPath);

  await navigateInSpa(page, DEVELOPMENT_PATH);
  await expect(page.getByRole("button", { name: "Create session" })).toBeEnabled();
  await page.waitForTimeout(250);
  expect(capabilitiesRequests).toBe(initialCapabilitiesRequests + 1);

  await navigateInSpa(page, `${DASHBOARD_PATH}/history?vibe64_e2e=1`);
  await expect(page.getByRole("heading", { name: "Session History" })).toBeVisible();

  codexConnected = false;
  await emitConnectionChangedForCapabilities(page, {
    connectionId: "codex",
    connected: false,
    reason: "",
    status: "not_connected"
  });

  await expect.poll(() => capabilitiesRequests).toBe(initialCapabilitiesRequests + 2);
  expect(capabilitiesRequestPaths.at(-1)).toBe(scopedCapabilitiesPath);

  await navigateInSpa(page, DEVELOPMENT_PATH);
  await expect(page.getByRole("button", { name: "Create session" })).toBeDisabled();
  await page.waitForTimeout(250);
  expect(capabilitiesRequests).toBe(initialCapabilitiesRequests + 2);
});

async function navigateInSpa(page, path: string) {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

async function emitConnectionChangedForCapabilities(page, payload: unknown) {
  await page.evaluate(async (eventPayload) => {
    const hook = (window as unknown as {
      __vibe64E2e?: {
        emitConnectionChangedForCapabilities?: (payload: unknown) => Promise<unknown>;
      };
    }).__vibe64E2e;
    if (typeof hook?.emitConnectionChangedForCapabilities !== "function") {
      throw new Error("Missing Vibe64 realtime Playwright hook.");
    }
    await hook.emitConnectionChangedForCapabilities(eventPayload);
  }, payload);
}

function connectionsPayload(codexConnected: boolean) {
  const codex = {
    connected: codexConnected,
    id: "codex",
    label: "Codex",
    message: codexConnected
      ? "Codex is authenticated for Studio."
      : "Codex is not authenticated for Studio.",
    status: codexConnected ? "connected" : "not_connected"
  };
  const github = {
    connected: true,
    id: "github",
    label: "GitHub",
    message: "GitHub CLI is configured for this Vibe64 user.",
    status: "connected",
    username: "mercmobily"
  };

  return {
    connections: [codex, github],
    blockedReason: codexConnected ? "" : codex.message,
    ok: true,
    ready: codexConnected
  };
}

function capabilitiesPayload(codexConnected: boolean) {
  const connections = connectionsPayload(codexConnected).connections;
  const codex = connections.find((connection) => connection.id === "codex");
  const github = connections.find((connection) => connection.id === "github");
  const setup = setupReadinessPayload({
    ready: true,
    stages: [
      { checks: [], ready: true },
      { checks: [], ready: true },
      { checks: [], ready: true }
    ]
  });
  const createSessionEnabled = codexConnected && github?.connected === true;
  const unauthenticatedReason = "Choose and authenticate an AI provider before starting a session.";
  const capability = (enabled: boolean, reason = "") => ({
    enabled,
    fix: null,
    reason: enabled ? "" : reason
  });

  return {
    capabilities: {
      chat: capability(codexConnected, "Choose and authenticate an AI provider before using chat."),
      createSession: capability(createSessionEnabled, unauthenticatedReason),
      githubWorkflow: capability(github?.connected === true, "Connect GitHub before using GitHub actions."),
      home: capability(true),
      preview: capability(true),
      runScripts: capability(true)
    },
    connections: {
      ai: {
        message: codexConnected ? "Codex is selected and authenticated." : codex?.message || "",
        providers: [
          {
            ...codex,
            ready: codexConnected,
            selected: true
          }
        ],
        ready: codexConnected,
        selectedProviderId: "codex"
      },
      github: {
        ...github,
        ready: github?.connected === true
      },
      ready: createSessionEnabled,
      rows: connections
    },
    ok: true,
    setup,
    targetRoot,
    updatedAt: "2026-06-10T00:00:00.000Z"
  };
}

function emptySessionsPayload() {
  return {
    creation: {
      canCreate: true,
      defaultWorkflowDefinition: "big_feature",
      disabledReason: "",
      mode: "select",
      requiredWorkflowDefinition: null,
      seedRequired: false,
      workflowDefinitions: [
        {
          description: "Define, plan, implement, review, validate, commit, create a PR, and optionally merge.",
          id: "big_feature",
          label: "Make improvements"
        }
      ]
    },
    limits: {
      maxOpenSessions: 3,
      openSessionCount: 0
    },
    ok: true,
    sessions: [],
    stepDefinitions: []
  };
}
