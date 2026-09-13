import { test, expect } from "@playwright/test";
import { mockDirectChatSession } from "./support/base-shell-mocks";
import {
  DASHBOARD_PATH,
  directChatSessionId,
  viewports,
} from "./support/base-shell-data";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

for (const viewport of viewports) {
  test.describe(`integration chat request (${viewport.name})`, () => {
    let errors: string[];
    let operations: string[];
    let confirmSetup: boolean;
    let consentFlow: boolean;
    let consentPending: boolean;
    let deliveryUnavailable: boolean;
    let deliveryRequests: number;
    let providerDeliveries: number;
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport);
      errors = [];
      operations = [];
      confirmSetup = false;
      consentFlow = false;
      consentPending = false;
      deliveryUnavailable = false;
      deliveryRequests = 0;
      providerDeliveries = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      await mockDirectChatSession(page);
      let skipped = false;
      let completed = false;
      let continuationStatus = "pending";
      const decision = () => ({
        integrationId: "gmail-business", requestId: "a".repeat(64),
        outcome: completed ? "completed" : skipped ? "skipped" : "pending",
        ...(completed ? {
          configurationHash: "b".repeat(64), verifiedAt: "2026-09-11T08:00:00Z",
          continuationMessageId: "11111111-1111-4111-8111-111111111111",
          continuation: { status: continuationStatus,
            ...(continuationStatus !== "pending" ? { engineId: "codex", threadId: "fixture-thread" } : {}) }
        } : {})
      });
      await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/integration-setup/resume`, async (route) => {
        expect(route.request().method()).toBe("POST");
        expect(route.request().postDataJSON()).toEqual({ turnId: "000001", requestId: "a".repeat(64) });
        expect(completed).toBe(true);
        deliveryRequests += 1;
        if (continuationStatus === "pending") providerDeliveries += 1;
        continuationStatus = deliveryUnavailable ? "sending" : "accepted";
        await fulfillJson(route, {
          ok: !deliveryUnavailable,
          ...(deliveryUnavailable ? { code: "vibe64_integration_continuation_unconfirmed", error: "Assistant delivery could not be confirmed." } : {}),
          integrationSetup: decision()
        });
      });
      await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/integration-setup/skip`, async (route) => {
        expect(route.request().method()).toBe("POST");
        expect(route.request().postDataJSON()).toEqual({ turnId: "000001", requestId: "a".repeat(64) });
        skipped = true;
        await fulfillJson(route, { ok: true });
      });
      for (const [endpoint, payload] of [
        ["/vibe64/settings", { ok: true, promptHints: { enabled: false } }],
        [
          "/vibe64/sessions/current",
          { ok: true, sessionId: directChatSessionId },
        ],
        [`/vibe64/sessions/${directChatSessionId}/agent-session`, { ok: true }],
        [`/vibe64/sessions/${directChatSessionId}/presence`, { ok: true }],
        [
          `/vibe64/sessions/${directChatSessionId}/assistant-access`,
          { ok: true, available: true, canUse: true, ownerOnly: false },
        ],
        [
          `/vibe64/sessions/${directChatSessionId}/message-suggestions`,
          { ok: true, suggestions: [], canManage: true },
        ],
        [
          `/vibe64/sessions/${directChatSessionId}/work`,
          { ok: true, unsaved: false, operation: null, updateOperation: null },
        ],
        [
          `/vibe64/sessions/${directChatSessionId}/updates/check`,
          { ok: true, updateAvailable: false, status: "up-to-date" },
        ],
        [
          `/vibe64/sessions/${directChatSessionId}/renewal`,
          { ok: true, renewal: null, viewerScope: "integration-test-owner" },
        ],
        [
          `/vibe64/sessions/${directChatSessionId}/source-editor/stars`,
          { ok: true, files: [] },
        ],
      ] as const)
        await routeApiEndpoint(page, endpoint, (route) =>
          fulfillJson(route, payload),
        );
      await routeApiEndpoint(
        page,
        `/vibe64/sessions/${directChatSessionId}/conversation-log`,
        (route) =>
          fulfillJson(route, {
            ok: true,
            conversationLog: [
              {
                turnId: "000001",
                integrationSetup: decision(),
                user: {
                  role: "user",
                  text: "Add our business mailbox",
                  at: "2026-09-11T01:00:00Z",
                },
                assistant: {
                  role: "assistant",
                  messageId: "saved-setup-request",
                  at: "2026-09-11T01:01:00Z",
                  text: 'Configure your business mailbox.\n\n```vibe64-integration\n{"integrationId":"gmail-business"}\n```',
                },
              },
            ],
            hasMoreBefore: false,
          }),
      );
      await routeApiEndpoint(
        page,
        `/vibe64/sessions/${directChatSessionId}/integrations`,
        (route) => {
          expect(route.request().method()).toBe("GET");
          return fulfillJson(route, {
            ok: true,
            baseHash: "b".repeat(64),
            configuration: {
              schemaVersion: 1,
              registrations: {
                google: {
                  source: "own",
                  clientId: "fixture",
                  clientSecretRef: "env:GOOGLE_SECRET",
                  callbackUrlRef: "env:GOOGLE_CALLBACK",
                },
              },
              integrations: {
                "gmail-business": {
                  provider: "gmail",
                  displayName: "Business mailbox",
                  accountMode: "shared",
                  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
                  authentication: {
                    method: "oauth2",
                    registrationRef: "google",
                  },
                },
              },
            },
          });
        },
      );
      await page.route(/\/integrations\/[^/]+\/setup$/, async (route) => {
        expect(new URL(route.request().url()).pathname).toContain(
          "/integrations/gmail-business/setup",
        );
        operations.push(route.request().postDataJSON().operation);
        const request = route.request().postDataJSON();
        if (consentFlow && !confirmSetup) {
          if (request.operation === "connect") consentPending = true;
          if (request.operation === "cancel") {
            expect(request.attemptId).toBe("existing-attempt");
            consentPending = false;
          }
          await fulfillJson(route, { ok: true, status: consentPending ? "pending" : "disconnected",
            ...(consentPending ? { attemptId: "existing-attempt", authorizationUrl: "https://provider.example/consent", expiresAt: "2030-01-01T00:00:00Z" } : {}) });
          return;
        }
        if (confirmSetup && request.setupRequest) {
          expect(request.setupRequest).toEqual({ turnId: "000001", requestId: "a".repeat(64), configurationHash: "b".repeat(64) });
          completed = true;
          await fulfillJson(route, { ok: true, status: "connected", verifiedAt: "2026-09-11T08:00:00Z",
            integrationSetup: decision() });
          return;
        }
        await fulfillJson(route, {
          ok: true,
          status: "unconfigured",
          setupIssue: "Implement the application setup command.",
        });
      });
    });
    test.afterEach(() => {
      expect(operations.every((operation) => consentFlow ? ["status", "connect", "cancel"].includes(operation) : operation === "status")).toBe(
        true,
      );
      expect(errors).toEqual([]);
    });
    test("Analytics request shows configuration guidance without account actions", async ({ page }) => {
      await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/integrations`, (route) => fulfillJson(route, {
        ok: true, baseHash: "b".repeat(64), configuration: {
          schemaVersion: 1, registrations: {}, integrations: { "gmail-business": {
            provider: "google-analytics", displayName: "Website Analytics", accountMode: "shared", scopes: [],
            authentication: { method: "none" }, settings: { measurementId: "G-APP123" }
          } }
        }
      }));
      await page.goto(`${DASHBOARD_PATH}/integrations`);
      const chat = page.locator(".studio-conversation-log");
      await expect(chat.getByText(/This integration uses public settings and has no account to connect/)).toBeVisible();
      await expect(chat.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0);
      await expect(chat.getByRole("button", { name: "Configure", exact: true })).toBeVisible();
      await expect(chat.getByText("Setup completed", { exact: true })).toHaveCount(0);
      await page.reload();
      await expect(chat.getByText(/This integration uses public settings and has no account to connect/)).toBeVisible();
      expect(operations).toEqual([]);
      expect(deliveryRequests).toBe(0);
      expect(providerDeliveries).toBe(0);
    });
    test("connects inline and recovers consent after reload before cancellation and completion", async ({ page }) => {
      consentFlow = true;
      await page.goto(`${DASHBOARD_PATH}/integrations`);
      const chat = page.locator(".studio-conversation-log");
      await chat.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(chat.getByRole("link", { name: "Continue with provider" })).toHaveAttribute("href", "https://provider.example/consent");
      await page.reload();
      await expect(chat.getByRole("link", { name: "Continue with provider" })).toBeVisible();
      expect(operations.filter((operation) => operation === "connect")).toHaveLength(1);
      await page.screenshot({ path: `/tmp/integration-inline-pending-${viewport.name}.png` });
      await chat.getByRole("button", { name: "Cancel connection", exact: true }).click();
      await expect(chat.getByRole("link", { name: "Continue with provider" })).toHaveCount(0);
      expect(deliveryRequests).toBe(0);
      await chat.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(chat.getByRole("link", { name: "Continue with provider" })).toBeVisible();
      confirmSetup = true;
      await chat.getByRole("button", { name: "Check connection", exact: true }).click();
      await expect(chat.getByText("Assistant continuation accepted.", { exact: true })).toBeVisible();
      expect(providerDeliveries).toBe(1);
      expect(operations.filter((operation) => operation === "connect")).toHaveLength(2);
    });
    test("restores server-confirmed setup completion after Configure and reload", async ({ page }) => {
      confirmSetup = true;
      await page.goto(`${DASHBOARD_PATH}/integrations`);
      const chat = page.locator(".studio-conversation-log");
      await chat.getByRole("button", { name: "Configure", exact: true }).click();
      await expect(page).toHaveURL(/integrationRequest=a{64}/);
      if (viewport.name !== "expanded") await page.getByRole("button", { name: "Show chat", exact: true }).click();
      await expect(chat.getByRole("status").filter({ hasText: "Setup completed" })).toBeVisible();
      await expect(chat.getByText("Assistant continuation accepted.", { exact: true })).toBeVisible();
      expect(deliveryRequests).toBe(1);
      await expect(chat.getByRole("button", { name: "Skip", exact: true })).toHaveCount(0);
      await page.reload();
      if (viewport.name !== "expanded") {
        const showChat = page.getByRole("button", { name: "Show chat", exact: true });
        if (await showChat.isVisible()) await showChat.click();
      }
      await expect(chat.getByRole("status").filter({ hasText: "Setup completed" })).toBeVisible();
      await expect(chat.getByText("Assistant continuation accepted.", { exact: true })).toBeVisible();
      expect(deliveryRequests).toBe(1);
      expect(providerDeliveries).toBe(1);
      await page.screenshot({ path: `/tmp/integration-completed-${viewport.name}.png` });
    });
    test("checks uncertain continuation directly from chat without another app command", async ({ page }) => {
      confirmSetup = true;
      deliveryUnavailable = true;
      await page.goto(`${DASHBOARD_PATH}/integrations`);
      const chat = page.locator(".studio-conversation-log");
      await chat.getByRole("button", { name: "Configure", exact: true }).click();
      if (viewport.name !== "expanded") await page.getByRole("button", { name: "Show chat", exact: true }).click();
      await expect(chat.getByText(/Assistant delivery is not yet confirmed/)).toBeVisible();
      const setupCalls = operations.length;
      deliveryUnavailable = false;
      await chat.getByRole("button", { name: "Check continuation", exact: true }).click();
      await expect(chat.getByText("Assistant continuation accepted.", { exact: true })).toBeVisible();
      expect(operations.length).toBe(setupCalls);
      expect(deliveryRequests).toBe(2);
      expect(providerDeliveries).toBe(1);
    });
    test("saves Skip and restores it after reload", async ({ page }) => {
      await page.goto(`${DASHBOARD_PATH}/integrations`);
      const chat = page.locator(".studio-conversation-log");
      const skip = chat.getByRole("button", { name: "Skip", exact: true });
      await expect(skip).toBeVisible();
      await skip.click();
      await expect(chat.getByRole("status").filter({ hasText: "Skipped" })).toBeVisible();
      await expect(skip).toHaveCount(0);
      await page.reload();
      await expect(chat.getByRole("status").filter({ hasText: "Skipped" })).toBeVisible();
      await expect(skip).toHaveCount(0);
      await expect(chat.getByRole("button", { name: "Configure", exact: true })).toBeVisible();
      await page.screenshot({ path: `/tmp/integration-skip-${viewport.name}.png` });
    });
    test("opens its saved slot and survives reload", async ({ page }) => {
      await page.goto(`${DASHBOARD_PATH}/integrations`);
      const chat = page.locator(".studio-conversation-log");
      const configure = chat.getByRole("button", {
        name: "Configure",
        exact: true,
      });
      await expect(configure).toBeVisible();
      await configure.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/integration=gmail-business/);
      const panel = page.locator(".integrations-panel");
      await expect(
        panel.getByRole("textbox", { name: "Display name", exact: true }),
      ).toHaveValue("Business mailbox");
      await page.screenshot({
        path: `/tmp/integration-chat-${viewport.name}.png`,
      });
      await page.reload();
      if (viewport.name !== "expanded")
        await page
          .getByRole("button", { name: "Show project", exact: true })
          .click();
      await expect(
        panel.getByRole("textbox", { name: "Display name", exact: true }),
      ).toHaveValue("Business mailbox");
      if (viewport.name !== "expanded")
        await page
          .getByRole("button", { name: "Show chat", exact: true })
          .click();
      await expect(configure).toBeVisible();
      await page.screenshot({
        path: `/tmp/integration-chat-card-${viewport.name}.png`,
      });
      await page.goBack();
      await expect(configure).toBeVisible();
    });
    test("ignores a link for a different session", async ({ page }) => {
      const panel = page.locator(".integrations-panel");
      await page.goto(
        `${DASHBOARD_PATH}/integrations?integration=gmail-business&integrationSession=another-session`,
      );
      if (viewport.name !== "expanded")
        await page
          .getByRole("button", { name: "Show project", exact: true })
          .click();
      await expect(
        panel.getByRole("textbox", { name: "Display name", exact: true }),
      ).toHaveCount(0);
      await expect(panel.getByRole("heading", { name: "Add a service", exact: true })).toBeVisible();
      await expect(panel.getByText(/The requested integration/)).toHaveCount(0);
    });
    for (const id of ["removed-slot", "constructor"]) {
      test(`rejects unconfigured slot ${id}`, async ({ page }) => {
        const panel = page.locator(".integrations-panel");
        await page.goto(
          `${DASHBOARD_PATH}/integrations?integration=${id}&integrationSession=${directChatSessionId}`,
        );
        if (viewport.name !== "expanded")
          await page
            .getByRole("button", { name: "Show project", exact: true })
            .click();
        await expect(
          panel.getByText(
            `The requested integration ${id} is not configured in this session. Return to the conversation to finish its setup.`,
          ),
        ).toBeVisible();
        await expect(
          panel.getByRole("textbox", { name: "Display name", exact: true }),
        ).toHaveCount(0);
      });
    }
  });
}
