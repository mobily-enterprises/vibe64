import { expect, test, type Locator, type Page, type Request, type Route } from "@playwright/test";

import {
  BASE_URL,
  DASHBOARD_PATH,
  DEVELOPMENT_PATH,
  sessionRuntimeRoot
} from "./support/base-shell-data";
import {
  mockProjectGateReady
} from "./support/base-shell-mocks";
import {
  routeApiEndpoint
} from "./support/base-shell/http";

const SESSION_ID = "direct-chat-session";
const SCROLL_TEST_COPY = "A deliberately detailed update keeps the conversation tall enough to exercise the real overflow container.";
const REPOSITORY_RECOVERY_GIT_BOUNDARY = [
  "Vibe64—not Temporary AI—owns every repository operation. The failed operation has already been rolled back.",
  "You may inspect Git read-only and edit ordinary working-tree files in this session. Do not change HEAD, branches, refs, the index, stashes, remotes, commits, checkpoints, or repository configuration.",
  "Do not run git add, commit, checkout, switch, restore, reset, clean, stash, merge, rebase, cherry-pick, revert, pull, push, fetch, or update-ref. Do not create a recovery ref or stash; Vibe64 already owns durable recovery.",
  "Record the initial HEAD and index with read-only commands, leave both byte-for-byte unchanged, and do not publish. Resolve only by editing the conflicting working-tree files so the user can retry the Vibe64 operation.",
  "For an overlapping edit, keep the latest saved version's overlapping lines byte-for-byte and preserve this session's additional intent in adjacent non-overlapping content. Do not report success while Git has unmerged index entries or while HEAD/index differ from their initial values."
].join("\n");

async function openTemporaryAiWorkspace(page: Page) {
  await expect(page.getByRole("region", { name: "Session chat" })).toBeVisible();
  const expandedAction = page.getByRole("button", {
    name: "Open temporary AI",
    exact: true
  });
  if (await expandedAction.isVisible()) {
    await expandedAction.click();
    return;
  }
  await page.getByRole("button", { name: "Session actions", exact: true }).click();
  await page.locator("[data-vibe64-temporary-ai-action]").click();
}

test.describe("direct chat", () => {
  test("sends an ordinary chat message without orchestration metadata or a prompts section", async ({ page }) => {
    const messages: Record<string, unknown>[] = [];
    await mockDirectChat(page, {
      onMessage(body) {
        messages.push(body);
      }
    });

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

    await expect(page.getByText("Prompts", { exact: true })).toHaveCount(0);

    const composer = page.getByLabel("Message AI assistant");
    await composer.fill("Make the smallest safe change.");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect.poll(() => messages).toHaveLength(1);
    expect(messages[0]).toEqual(expect.objectContaining({
      displayMessage: "Make the smallest safe change.",
      message: "Make the smallest safe change."
    }));
    expect(messages[0].messageId).toMatch(/^message_tab_/u);
    expect(messages[0]).not.toHaveProperty("actionId");
    expect(messages[0]).not.toHaveProperty("intentId");
    await expect(page.getByText("Make the smallest safe change.", { exact: true })).toBeVisible();
    await expect(composer).toHaveValue("");
  });

  test("suggestions preserve composer height while authored input still grows it", async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    const longPrompt = "Show me the simplest useful first version";
    await mockDirectChat(page, { includeWorktreePaths: true });
    await routeApiEndpoint(page, "/vibe64/settings", async (route) => {
      await fulfillJson(route, {
        ok: true,
        promptHints: {
          canEdit: true,
          enabled: true
        }
      });
    });
    await routeApiEndpoint(
      page,
      `/vibe64/sessions/${SESSION_ID}/assistant-access`,
      async (route) => {
        await fulfillJson(route, {
          accessLabel: "Workspace use",
          available: true,
          canRequestMessage: false,
          canUse: true,
          ok: true,
          ownerOnly: false
        });
      }
    );
    await routeApiEndpoint(
      page,
      `/vibe64/sessions/${SESSION_ID}/prompt-hints`,
      async (route) => {
        await fulfillJson(route, {
          ok: true,
          status: "ready",
          suggestions: [
            { label: "Plan first version", prompt: longPrompt },
            { label: "Shape app idea", prompt: "Help me shape my app idea" },
            { label: "Decide first steps", prompt: "What should we decide first?" }
          ]
        });
      }
    );

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
    await page.addStyleTag({
      content: ".studio-autopilot-prompt-textarea__input { width: 10rem !important; }"
    });

    const composer = page.getByLabel("Message AI assistant");
    const suggestion = page.getByRole("button", {
      name: `Use suggestion: ${longPrompt}`
    });
    await expect(suggestion).toBeVisible({ timeout: 15_000 });
    const composerHeight = () => composer.evaluate((element) => (
      element.getBoundingClientRect().height
    ));
    const initialHeight = await composerHeight();

    await suggestion.hover();
    await expect(composer).toHaveAttribute("placeholder", longPrompt);
    await expect.poll(composerHeight).toBe(initialHeight);

    await composer.hover();
    await expect(composer).not.toHaveAttribute("placeholder", longPrompt);
    await expect.poll(composerHeight).toBe(initialHeight);

    await suggestion.click();

    await expect(composer).toHaveValue(longPrompt);
    await expect.poll(composerHeight).toBe(initialHeight);
    const constrainedComposer = await composer.evaluate((element) => ({
      clientHeight: element.clientHeight,
      overflowY: window.getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight
    }));
    expect(constrainedComposer.scrollHeight).toBeGreaterThan(constrainedComposer.clientHeight);
    expect(constrainedComposer.overflowY).toBe("auto");

    await composer.press("End");
    await composer.type(" Add the focused interaction test too.");

    await expect.poll(composerHeight).toBeGreaterThan(initialHeight);
  });

  test.describe("composer delivery on a phone", () => {
    test.use({
      hasTouch: true,
      viewport: { height: 844, width: 390 }
    });

    test("keeps typing available until one explicit text-only Steer is accepted", async ({ page }) => {
      const messages: Record<string, unknown>[] = [];
      const agentTurn: Record<string, unknown> = {
        active: false,
        id: "",
        state: "idle"
      };
      let acceptInitialDelivery!: () => void;
      const initialDelivery = new Promise<void>((resolve) => {
        acceptInitialDelivery = resolve;
      });
      await mockDirectChat(page, {
        agentTurn,
        async onMessage(body) {
          messages.push(body);
          if (messages.length === 1) {
            Object.assign(agentTurn, {
              active: true,
              id: "",
              state: "starting"
            });
            await initialDelivery;
          }
        }
      });

      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

      const composer = page.getByLabel("Message AI assistant");
      await composer.fill("Start the careful implementation.");
      await page.getByRole("button", { name: "Send message" }).click();
      await expect.poll(() => messages).toHaveLength(1);

      await expect(composer).toBeEnabled();
      await expect(page.getByRole("button", { name: "Sending message" })).toBeDisabled();
      await composer.fill("Keep the completion-race test focused.");

      await page.getByRole("button", { name: "Reload chat" }).click();
      acceptInitialDelivery();
      await expect(page.getByRole("button", {
        name: "Waiting for the assistant to accept guidance"
      })).toBeDisabled();
      await expect(composer).toHaveValue("Keep the completion-race test focused.");

      Object.assign(agentTurn, {
        active: true,
        id: "turn-direct-chat-active",
        state: "active"
      });
      await page.getByRole("button", { name: "Reload chat" }).click();
      const steer = page.getByRole("button", { name: "Steer assistant" });
      await expect(steer).toBeEnabled();
      const steerBounds = await steer.boundingBox();
      expect(steerBounds?.height).toBeGreaterThanOrEqual(48);
      expect(steerBounds?.width).toBeGreaterThanOrEqual(48);
      expect(await page.evaluate(() => (
        document.documentElement.scrollWidth <= window.innerWidth
      ))).toBe(true);
      await steer.click();

      await expect.poll(() => messages).toHaveLength(2);
      expect(messages[1]).toEqual(expect.objectContaining({
        displayMessage: "Keep the completion-race test focused.",
        message: "Keep the completion-race test focused."
      }));
      expect(messages[1]).not.toHaveProperty("attachmentIds");
      await expect(composer).toHaveValue("");
    });
  });

  test("saves through the native project operation without sending a chat message", async ({ page }) => {
    const messages: Record<string, unknown>[] = [];
    const saves: Record<string, unknown>[] = [];
    await mockDirectChat(page, {
      onMessage(body) {
        messages.push(body);
      },
      onSave(body) {
        saves.push(body);
      }
    });

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

    const sessionChat = page.getByRole("region", { name: "Session chat" });
    const saveButton = sessionChat.getByRole("button", { name: "Save selected session work", exact: true });
    await expect(saveButton).toBeVisible();
    await expect(page.locator(".studio-home-shell-save-work-host")).toHaveCount(0);
    await saveButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Save current work?", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/canonical repository/iu)).toBeVisible();
    await expect(dialog.getByText(/concurrent canonical changes/iu)).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(messages).toHaveLength(0);

    await saveButton.click();
    const confirmButton = dialog.getByRole("button", { name: "Save", exact: true });
    await confirmButton.click();

    await expect.poll(() => saves).toHaveLength(1);
    expect(saves[0]).toEqual({});
    expect(messages).toHaveLength(0);
    await expect(dialog).not.toBeVisible();
  });

  test("keeps Save unavailable until assistant preparation completes", async ({ page }) => {
    await mockDirectChat(page);
    let releasePreparation = () => {};
    const preparing = new Promise<void>((resolve) => { releasePreparation = resolve; });
    await routeApiEndpoint(page, `/vibe64/sessions/${SESSION_ID}/agent-session`, async (route) => {
      await preparing;
      await fulfillJson(route, { ok: true });
    });
    try {
      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
      const save = page.getByRole("button", { name: "Save selected session work", exact: true });
      await expect(save).toBeVisible();
      await expect(save).toBeDisabled();
      await expect(page.locator(".vibe64-prompt-hints__assistant-status")).toHaveText("Checking assistant status...");
      releasePreparation();
      await expect(save).toBeEnabled();
      await save.click();
      await expect(page.getByRole("dialog")).toBeVisible();
    } finally {
      releasePreparation();
    }
  });

  for (const width of [390, 821, 1280]) {
    for (const update of [false, true]) {
      test(`recovers an early ${update ? "Update" : "Save"} rejection at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await mockDirectChat(page, { workState: { unsaved: true, updateAvailable: update } });
        const error = "The assistant is still reconnecting. Wait until it is ready, then try again.";
        let attempts = 0;
        await routeApiEndpoint(page, `/vibe64/sessions/${SESSION_ID}/${update ? "updates/apply" : "save"}`, async (route) => {
          attempts += 1;
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ ok: false, code: "vibe64_agent_write_mode_busy", error, retryable: true })
          });
        });
        await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
        const header = page.getByRole("button", {
          name: update ? "Update selected session (rebase)" : "Save selected session work", exact: true
        });
        const confirm = async () => {
          if (!update) await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
        };
        await header.click();
        await confirm();
        const summary = page.locator(".vibe64-temporary-action-terminal__summary").filter({ hasText: error });
        await expect(summary).toBeVisible();
        await expect(summary.locator(".vibe64-temporary-action-terminal__status")).toHaveCount(0);
        for (const paneWidth of [240, 360, 600]) {
          await summary.evaluate((element, size) => { element.parentElement!.style.width = `${size}px`; }, paneWidth);
          const bounds = await summary.boundingBox();
          const buttons = await summary.getByRole("button").all();
          expect(buttons).toHaveLength(3);
          let previousRight = 0;
          for (const button of buttons) {
            const box = (await button.boundingBox())!;
            expect(box.width).toBeGreaterThanOrEqual(40);
            expect(box.x).toBeGreaterThanOrEqual(previousRight);
            expect(box.x + box.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
            previousRight = box.x + box.width;
          }
          expect(await summary.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
        await summary.evaluate((element) => { element.parentElement!.style.width = ""; });
        const title = update ? "Update this session (rebase)" : "Save work";
        await summary.getByRole("button", { name: `Show ${title} details`, exact: true }).click();
        await page.getByRole("button", { name: "Collapse", exact: true }).click();
        await summary.getByRole("button", { name: `Retry ${title}`, exact: true }).click();
        await confirm();
        await expect.poll(() => attempts).toBe(2);
        await expect(summary).toBeVisible();
        await summary.getByRole("button", { name: `Dismiss ${title}`, exact: true }).press("Enter");
        await expect(summary).not.toBeVisible();
        await header.click();
        await confirm();
        await expect.poll(() => attempts).toBe(3);
        await expect(summary).toBeVisible();
      });
    }
  }

  test("disables Save work while the agent is active", async ({ page }) => {
    await mockDirectChat(page, {
      agentActive: true
    });

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

    await expect(page.getByRole("button", { name: "Save selected session work", exact: true })).toBeDisabled();
  });

  test.describe("session-chat Save on a phone", () => {
    test.use({
      hasTouch: true,
      viewport: { height: 844, width: 390 }
    });

    test("keeps one icon-only selected-session action in the chat header", async ({ page }) => {
      await mockDirectChat(page);
      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

      const sessionHeader = page.getByRole("region", { name: "Session chat" }).locator(".studio-autopilot__session-header");
      const saveButton = sessionHeader.getByRole("button", { name: "Save selected session work", exact: true });
      await expect(saveButton).toBeVisible();
      await expect(saveButton).toHaveText("");
      const bounds = await saveButton.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(48);
      expect(bounds?.width).toBeGreaterThanOrEqual(48);
      expect(await page.evaluate(() => (
        document.documentElement.scrollWidth <= window.innerWidth
      ))).toBe(true);
      await expect(page.locator(".studio-home-shell-save-work-host")).toHaveCount(0);
    });
  });

  for (const width of [960, 1600]) {
    test(`keeps icon-only Save inside the session strip at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ height: 900, width });
      await mockDirectChat(page);
      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

      const saveButton = page.getByRole("region", { name: "Session chat" }).getByRole("button", {
        name: "Save selected session work",
        exact: true
      });
      await expect(saveButton).toBeVisible();
      await expect(saveButton).toHaveText("");
      expect(await page.evaluate(() => (
        document.documentElement.scrollWidth <= window.innerWidth
      ))).toBe(true);
    });
  }

  test("keeps exactly one selected-session Save through switching and warm navigation", async ({ page }) => {
    const saves: string[] = [];
    await mockDirectChat(page, {
      additionalSessionIds: ["direct-chat-session-b"],
      onSave(_body, sessionId) {
        saves.push(sessionId);
      }
    });
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

    const visibleChat = page.locator(".studio-autopilot__chat-panel:visible");
    const saveButton = visibleChat.getByRole("button", { name: "Save selected session work" });
    await expect(saveButton).toHaveCount(1);
    await visibleChat.locator('[aria-label^="Direct chat."]').click();
    await expect(saveButton).toHaveCount(1);
    await visibleChat.locator('[aria-label^="Second session."]').click();
    await expect(saveButton).toHaveCount(1);

    await saveButton.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => saves).toEqual(["direct-chat-session-b"]);

    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
    await expect(saveButton).toHaveCount(1);
    await page.goBack();
    await expect(page).toHaveURL(`${BASE_URL}${DASHBOARD_PATH}/env`);
    await expect(saveButton).toHaveCount(1);
    await page.goForward();
    await expect(page).toHaveURL(`${BASE_URL}${DEVELOPMENT_PATH}`);
    await expect(saveButton).toHaveCount(1);
  });

  test.describe("temporary AI mobile navigation", () => {
    test.use({
      hasTouch: true,
      viewport: { height: 844, width: 390 }
    });

    test("switches between Main chat and temporary AI without stopping hidden work", async ({ page }) => {
      const messages: Record<string, unknown>[] = [];
      const temporaryDeletes: string[] = [];
      const temporaryStarts: Record<string, unknown>[] = [];
      const temporaryTurns: Record<string, unknown>[] = [];
      let mainChatVisible = false;
      let pollsWhileMainChatVisible = 0;
      await mockDirectChat(page, {
        onMessage(body) {
          messages.push(body);
        },
        onTemporaryConversation(body) {
          temporaryStarts.push(body);
        },
        onTemporaryDelete(conversationId) {
          temporaryDeletes.push(conversationId);
        },
        onTemporaryPoll() {
          if (mainChatVisible) {
            pollsWhileMainChatVisible += 1;
            return {
              message: "Finished while Main chat was visible.",
              ok: true,
              progressUpdates: [{
                id: "progress:hidden",
                text: "Continued while Main chat was visible."
              }],
              runId: "temporary-run-1",
              status: "completed"
            };
          }
          return {
            message: "",
            ok: true,
            progressUpdates: [{ id: "progress:initial", text: "Inspecting the project." }],
            runId: "temporary-run-1",
            status: "inProgress"
          };
        },
        onTemporaryTurn(body) {
          temporaryTurns.push(body);
        }
      });

      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
      await openTemporaryAiWorkspace(page);

      const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
      const navigation = workspace.getByRole("navigation", {
        name: "Main and temporary conversations"
      });
      await expect(workspace).toBeVisible();
      await expect(navigation.getByRole("button", { name: "Main chat", exact: true })).toBeVisible();
      await workspace.getByLabel("Message temporary AI").fill("Inspect this without changing it.");
      await workspace.getByRole("button", { name: "Send to temporary AI" }).click();
      await workspace.getByRole("button", { name: "Show all 1 progress update", exact: true }).click();
      await expect(workspace.getByText(
        "Inspecting the project.",
        { exact: true }
      )).toBeVisible();

      await navigation.getByRole("button", { name: "New temporary AI task", exact: true }).click();
      await expect(navigation.getByRole("button", { name: "Temporary 2", exact: true })).toHaveAttribute(
        "aria-current",
        "page"
      );

      const coarseControls = [
        navigation.getByRole("button", { name: "Main chat", exact: true }),
        navigation.locator('[data-temporary-ai-task-id]').filter({ hasText: "Temporary 1" }),
        navigation.locator('[data-temporary-ai-task-id]').filter({ hasText: "Temporary 2" }),
        navigation.getByRole("button", { name: "Close Temporary 1", exact: true }),
        navigation.getByRole("button", { name: "Close Temporary 2", exact: true }),
        navigation.getByRole("button", { name: "New temporary AI task", exact: true }),
        navigation.getByRole("button", { name: /Read-only: temporary AI cannot edit/iu })
      ];
      for (const control of coarseControls) {
        const bounds = await control.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(48);
        expect(bounds?.width).toBeGreaterThanOrEqual(48);
      }

      await navigation.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      const navigationBounds = await navigation.boundingBox();
      const mainChatBounds = await navigation.getByRole("button", {
        name: "Main chat",
        exact: true
      }).boundingBox();
      expect(mainChatBounds?.x).toBeGreaterThanOrEqual(navigationBounds?.x || 0);
      expect((mainChatBounds?.x || 0) - (navigationBounds?.x || 0)).toBeLessThan(12);

      await navigation.getByRole("button", { name: "Main chat", exact: true }).click();
      mainChatVisible = true;
      await expect(workspace).not.toBeVisible();
      await expect(page.getByRole("region", { name: "Session chat" })).toBeFocused();
      await page.getByLabel("Message AI assistant").fill("Continue in the main conversation.");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect.poll(() => messages).toHaveLength(1);
      await expect.poll(() => pollsWhileMainChatVisible).toBeGreaterThan(0);

      await openTemporaryAiWorkspace(page);
      await expect(workspace).toBeVisible();
      await expect(navigation.getByRole("button", { name: "Temporary 1", exact: true })).toBeVisible();
      await expect(navigation.getByRole("button", { name: "Temporary 2", exact: true })).toHaveAttribute(
        "aria-current",
        "page"
      );
      await navigation.getByRole("button", { name: "Temporary 1", exact: true }).click();
      await workspace.getByRole("button", { name: "Show all 1 progress update", exact: true }).click();
      await expect(workspace.getByText("Continued while Main chat was visible.", { exact: true })).toBeVisible();
      await expect(workspace.getByText("Finished while Main chat was visible.", { exact: true })).toBeVisible();
      await expect(navigation.getByRole("button", { name: "Temporary 1", exact: true })).toHaveAttribute(
        "aria-current",
        "page"
      );

      await navigation.getByRole("button", { name: "Close Temporary 1", exact: true }).click();
      await expect.poll(() => temporaryDeletes).toEqual(["temporary-conversation-1"]);
      await expect(workspace).toBeVisible();
      await expect(navigation.getByRole("button", { name: "Temporary 1", exact: true })).toHaveCount(0);
      await expect(navigation.getByRole("button", { name: "Temporary 2", exact: true })).toBeVisible();
      expect(temporaryStarts).toHaveLength(1);
      expect(temporaryTurns).toHaveLength(1);
      expect(temporaryTurns[0]).toEqual(expect.objectContaining({
        message: "Inspect this without changing it.",
        policy: "read",
        promptLabel: "Temporary 1"
      }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });

  for (const width of [960, 1600]) {
    test(`keeps Main chat navigation stable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ height: 900, width });
      await mockDirectChat(page);
      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
      await openTemporaryAiWorkspace(page);

      const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
      const navigation = workspace.getByRole("navigation", {
        name: "Main and temporary conversations"
      });
      await navigation.getByRole("button", { name: "New temporary AI task", exact: true }).click();
      await expect(navigation.getByRole("button", { name: "Temporary 2", exact: true })).toHaveAttribute(
        "aria-current",
        "page"
      );
      await navigation.getByRole("button", { name: "Main chat", exact: true }).click();
      await expect(workspace).not.toBeVisible();
      await expect(page.getByRole("region", { name: "Session chat" })).toBeFocused();

      await openTemporaryAiWorkspace(page);
      await expect(navigation.getByRole("button", { name: "Temporary 1", exact: true })).toBeVisible();
      await expect(navigation.getByRole("button", { name: "Temporary 2", exact: true })).toHaveAttribute(
        "aria-current",
        "page"
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  for (const recovery of [
    {
      diagnostic: "Dependency installation exited with code 1.",
      expectedPrompt: [
        "Workspace preparation needs attention.",
        "Diagnostic:\nDependency installation exited with code 1.",
        "Diagnose and repair the current workspace while preserving its existing work.",
        "When your turn finishes, Vibe64 will automatically rerun its deterministic workspace preparation. Do not merely tell the user to retry.",
        "If the repair needs information only the user can provide, ask for it in this temporary conversation."
      ].join("\n\n"),
      status: "failed"
    },
    {
      diagnostic: "Two Stack components declare different setup recipes.",
      expectedPrompt: [
        "Workspace preparation needs attention.",
        "Diagnostic:\nTwo Stack components declare different setup recipes.",
        "Diagnose and repair the current workspace while preserving its existing work.",
        "When your turn finishes, Vibe64 will automatically rerun its deterministic workspace preparation. Do not merely tell the user to retry.",
        "If the repair needs information only the user can provide, ask for it in this temporary conversation."
      ].join("\n\n"),
      status: "ambiguous"
    }
  ]) {
    test(`routes ${recovery.status} workspace preparation through Temporary AI`, async ({ page }) => {
      const captured = await mockTemporaryRecovery(page, {
        workspaceSetup: {
          diagnostic: recovery.diagnostic,
          status: recovery.status,
          updatedAt: "2026-08-23T12:00:00.000Z"
        }
      });

      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
      await page.getByRole("button", { name: "Fix it with AI", exact: true }).click();

      await expectTemporaryRecovery(page, captured, {
        expectedPrompt: recovery.expectedPrompt,
        promptLabel: "Fix workspace preparation"
      });
    });
  }

  for (const recovery of [
    {
      action: "Save",
      code: "vibe64_session_save_history_diverged",
      operationKey: "operation",
      promptLead: "Help resolve this Vibe64 Save problem. Inspect the current session and canonical repository state, preserve all work, and do not publish until the conflict is understood:"
    },
    {
      action: "Update",
      code: "vibe64_session_update_conflict",
      operationKey: "updateOperation",
      promptLead: "Help resolve this Vibe64 Update problem. Inspect the current session and canonical repository state, preserve all work, and do not publish until the conflict is understood:"
    },
    {
      action: "Update",
      code: "vibe64_session_update_history_diverged",
      operationKey: "updateOperation",
      promptLead: "Help resolve this Vibe64 Update problem. Inspect the current session and canonical repository state, preserve all work, and do not publish until the conflict is understood:"
    }
  ]) {
    test(`routes chat ${recovery.code} recovery through Temporary AI`, async ({ page }) => {
      const diagnostic = `${recovery.action} could not preserve the changed history.`;
      const captured = await mockTemporaryRecovery(page, {
        workState: {
          operation: null,
          updateOperation: null,
          unsaved: true,
          [recovery.operationKey]: {
            code: recovery.code,
            error: diagnostic,
            operationId: `operation-${recovery.code}`,
            status: "failed"
          }
        }
      });

      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
      await page.getByRole("button", { name: "Fix it with AI", exact: true }).click();

      await expectTemporaryRecovery(page, captured, {
        expectedPrompt: [
          recovery.promptLead,
          REPOSITORY_RECOVERY_GIT_BOUNDARY,
          ...(recovery.action === "Update" ? [
            "When your repair is complete, Vibe64 will run Update to verify it and show the result here. If you need a decision, return a continue result instead."
          ] : []),
          diagnostic
        ].join("\n\n"),
        promptLabel: `Resolve ${recovery.action}`
      });
    });
  }

  for (const width of [390, 1600]) {
    test(`renders numbered question Markdown at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ height: 900, width });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const assistantPrompt = [
        "Recorded all three, including **no admin approval for roster conflicts**.",
        "[1] After an online booking is confirmed, should it **remain yellow** to show that it originated online?",
        "Possible answers:",
        "- **Yes**, keep `yellow` (Recommended)",
        "- No, use the [billing guide](docs/billing.md)",
        "[2] Does the owner's **“Invoiced” switch** mean the existing monthly-billing preference?",
        "[3] Should the **10% VIP discount** use `vip_discount`, keeping <b>literal HTML</b> and [unsafe](javascript:alert) as text?"
      ].join("\n");
      await mockDirectChat(page, {
        includeWorktreePaths: true,
        conversationLog: [{
          assistant: { at: "2026-08-14T01:03:00.000Z", role: "assistant", text: assistantPrompt },
          turnId: "turn-markdown-questions"
        }, {
          user: { at: "2026-08-14T01:04:00.000Z", role: "user", text: "[1] Yes\n[2] Please clarify\n[3] Yes" },
          turnId: "turn-markdown-answers"
        }]
      });
      const openedPaths: string[] = [];
      await routeApiEndpoint(page, `/vibe64/sessions/${SESSION_ID}/source-editor/file`, async (route) => {
        const path = new URL(route.request().url()).searchParams.get("path") || "";
        openedPaths.push(path);
        await fulfillJson(route, { ok: true, file: { path, text: "# Billing guide", hash: "billing-guide" } });
      });

      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
      const questions = page.locator(".studio-conversation-log__questions");
      await expect(questions).toBeVisible();
      await expect(questions.locator(".studio-conversation-log__question-number")).toHaveText(["1", "2", "3"]);
      await expect(questions.locator(".studio-conversation-log__question-text strong")).toHaveText([
        "remain yellow", "“Invoiced” switch", "10% VIP discount"
      ]);
      await expect(questions.locator("code")).toHaveText(["yellow", "vip_discount"]);
      await expect(questions.locator(".studio-conversation-log__question-choices strong")).toHaveText("Yes");
      await expect(questions).toContainText("Recommended");
      await expect(questions).not.toContainText("**");
      await expect(questions).toContainText("<b>literal HTML</b>");
      await expect(questions.locator("b, a[href^='javascript:']")).toHaveCount(0);
      expect(await questions.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath("numbered-questions.png") });

      await questions.getByRole("link", { name: "billing guide" }).click();
      await expect.poll(() => openedPaths).toContain("docs/billing.md");
      await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/files`));
      expect(errors).toEqual([]);
    });
  }

  test("submits assistant numbered questions through the same chat endpoint", async ({ page }) => {
    const messages: Record<string, unknown>[] = [];
    const assistantPrompt = [
      "Please answer these before I continue.",
      "[1] What should change?",
      "[2] What should stay the same?"
    ].join("\n");
    await mockDirectChat(page, {
      conversationLog: [{
        assistant: {
          at: "2026-08-14T01:03:00.000Z",
          role: "assistant",
          text: assistantPrompt
        },
        turnId: "turn-numbered-questions"
      }],
      onMessage(body) {
        messages.push(body);
      }
    });

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

    await page.getByLabel("[1] What should change?").fill("Tighten the layout.");
    await page.getByLabel("[2] What should stay the same?").fill("Keep the current copy.");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect.poll(() => messages).toHaveLength(1);
    expect(messages[0]).toEqual(expect.objectContaining({
      displayMessage: "[1] Tighten the layout.\n[2] Keep the current copy.",
      message: "[1] Tighten the layout.\n[2] Keep the current copy."
    }));
  });

  for (const width of [390, 960, 1600]) {
    test(`preserves manual conversation reading and resumes follow deliberately at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ height: 844, width });
      const conversationLog = Array.from({ length: 24 }, (_value, index) => scrollTestTurn(index + 1));
      await mockDirectChat(page, { conversationLog });
      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

      const body = page.locator(".studio-conversation-log__body");
      const reload = page.getByRole("button", { name: "Reload chat" });
      await expect(body).toBeVisible();
      await expect(body).toHaveAttribute("tabindex", "0");
      await expect(body).toHaveAttribute("aria-label", "Conversation messages");
      await expect.poll(() => conversationDistanceFromBottom(body)).toBeLessThanOrEqual(48);

      await detachConversation(body, 480, width === 390 ? "touch" : "wheel");
      conversationLog.push(scrollTestTurn(25, {
        role: "user",
        text: "A collaborator added a remote message while this reader was reviewing history."
      }));
      await reload.click();
      await expect(page.getByText(/collaborator added a remote message/iu)).toBeVisible();
      await page.waitForTimeout(180);
      await expect.poll(() => conversationDistanceFromBottom(body)).toBeGreaterThan(200);

      await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      conversationLog.push({
        system: {
          at: "2026-08-24T10:30:00.000Z",
          messageId: "system-follow",
          role: "system",
          text: "The session is ready for its next instruction."
        },
        turnId: "turn-system-follow"
      });
      await reload.click();
      await expect(page.getByText("The session is ready for its next instruction.", { exact: true })).toBeVisible();
      await expect.poll(() => conversationDistanceFromBottom(body)).toBeLessThanOrEqual(48);

      const streamingTurn = scrollTestTurn(26, {
        role: "assistant",
        text: "The first streamed commentary update is visible."
      });
      delete streamingTurn.assistant;
      streamingTurn.commentary = [{
        at: "2026-08-24T10:31:00.000Z",
        messageId: "stream-commentary-1",
        role: "commentary",
        text: "The first streamed commentary update is visible."
      }];
      conversationLog.push(streamingTurn);
      await reload.click();
      await expect(page.getByText("The first streamed commentary update is visible.", { exact: true })).toBeVisible();
      await expect.poll(() => conversationDistanceFromBottom(body)).toBeLessThanOrEqual(48);

      await body.focus();
      const keyboardStart = await body.evaluate((element) => element.scrollTop);
      await page.keyboard.press("PageUp");
      await page.keyboard.press("PageUp");
      await expect.poll(() => body.evaluate((element) => element.scrollTop))
        .toBeLessThan(keyboardStart - 20);
      await expect.poll(() => conversationDistanceFromBottom(body)).toBeGreaterThan(100);
      await body.evaluate((element) => {
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      streamingTurn.commentary.push({
        at: "2026-08-24T10:31:10.000Z",
        messageId: "stream-commentary-2",
        role: "commentary",
        text: "A second progress update arrived after keyboard navigation."
      });
      streamingTurn.assistant = {
        at: "2026-08-24T10:31:20.000Z",
        messageId: "stream-final",
        role: "assistant",
        text: "This final assistant update arrived after keyboard navigation."
      };
      await reload.click();
      await expect(page.getByText("This final assistant update arrived after keyboard navigation.", { exact: true })).toBeVisible();
      await page.waitForTimeout(180);
      await expect.poll(() => conversationDistanceFromBottom(body)).toBeGreaterThan(100);

      await page.getByLabel("Message AI assistant").fill("Resume following after my accepted message.");
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByText("Resume following after my accepted message.", { exact: true })).toBeVisible();
      await expect.poll(() => conversationDistanceFromBottom(body)).toBeLessThanOrEqual(48);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  test("keeps the visible history anchor through a slow older-page response", async ({ page }) => {
    const latestTurns = Array.from({ length: 20 }, (_value, index) => scrollTestTurn(index + 21));
    const olderTurns = Array.from({ length: 20 }, (_value, index) => scrollTestTurn(index + 1));
    await mockDirectChat(page, {
      async conversationPage({ beforeTurnId }) {
        if (beforeTurnId) {
          await new Promise((resolve) => setTimeout(resolve, 700));
          return {
            conversationLog: olderTurns,
            pagination: {
              count: olderTurns.length,
              hasMoreBefore: false,
              limit: 20,
              newestTurnId: "turn-20",
              oldestTurnId: "turn-1",
              totalTurnCount: 40
            }
          };
        }
        return {
          conversationLog: latestTurns,
          pagination: {
            count: latestTurns.length,
            hasMoreBefore: true,
            limit: 20,
            newestTurnId: "turn-40",
            nextBeforeTurnId: "turn-21",
            oldestTurnId: "turn-21",
            totalTurnCount: 40
          }
        };
      }
    });
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

    const body = page.locator(".studio-conversation-log__body");
    await body.evaluate((element) => {
      element.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        deltaY: -1_000
      }));
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const visibleAnchor = page.getByText("User message 21. A deliberately detailed update", {
      exact: false
    });
    await expect(visibleAnchor).toBeVisible();
    const anchorBefore = await visibleAnchor.boundingBox();
    await page.getByRole("button", { name: "Load older messages" }).click();
    await expect(page.getByText("User message 1. A deliberately detailed update", {
      exact: false
    })).toBeVisible();
    const anchorAfter = await visibleAnchor.boundingBox();
    expect(Math.abs((anchorAfter?.y || 0) - (anchorBefore?.y || 0))).toBeLessThanOrEqual(2);
  });
});

async function mockDirectChat(page: Page, {
  additionalSessionIds = [],
  agentActive = false,
  agentTurn = null,
  conversationPage = null,
  conversationLog = [],
  includeWorktreePaths = false,
  onMessage = () => undefined,
  onSave = () => undefined,
  onTemporaryConversation = () => undefined,
  onTemporaryDelete = () => undefined,
  onTemporaryPoll = () => null,
  onTemporaryTurn = () => undefined,
  workspaceSetup = null,
  workState = {
    operation: null,
    unsaved: true,
    updateOperation: null
  }
}: {
  additionalSessionIds?: string[];
  agentActive?: boolean;
  agentTurn?: Record<string, unknown> | null;
  conversationPage?: ((context: {
    beforeTurnId: string;
    limit: number;
  }) => Record<string, unknown> | Promise<Record<string, unknown>>) | null;
  conversationLog?: Record<string, unknown>[];
  includeWorktreePaths?: boolean;
  onMessage?: (body: Record<string, unknown>) => unknown | Promise<unknown>;
  onSave?: (body: Record<string, unknown>, sessionId: string) => unknown | Promise<unknown>;
  onTemporaryConversation?: (body: Record<string, unknown>) => unknown | Promise<unknown>;
  onTemporaryDelete?: (conversationId: string) => unknown | Promise<unknown>;
  onTemporaryPoll?: () => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
  onTemporaryTurn?: (body: Record<string, unknown>) => unknown | Promise<unknown>;
  workspaceSetup?: Record<string, unknown> | null;
  workState?: Record<string, unknown>;
} = {}) {
  await mockProjectGateReady(page);
  const session = directSession({
    agentActive,
    agentTurn,
    includeWorktreePaths,
    workspaceSetup
  });
  const sessions = [
    session,
    ...additionalSessionIds.map((sessionId, index) => directSession({
      agentActive: false,
      includeWorktreePaths,
      sessionId,
      sessionName: index === 0 ? "Second session" : `Session ${index + 2}`,
      workspaceSetup
    }))
  ];
  let selectedSessionId = SESSION_ID;

  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === "GET" && url.pathname.endsWith("/assistant-access")) {
      await fulfillJson(route, {
        accessLabel: "Workspace use",
        available: true,
        canRequestMessage: false,
        canUse: true,
        ok: true,
        ownerOnly: false
      });
      return;
    }
    if (method === "PUT" && url.pathname.endsWith("/current")) {
      const body = requestBodyWithoutOrigin(request);
      selectedSessionId = String(body.sessionId || SESSION_ID);
      await fulfillJson(route, {
        ok: true,
        sessionId: selectedSessionId
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/agent-message")) {
      const body = requestBodyWithoutOrigin(request);
      await onMessage(body);
      await fulfillJson(route, {
        delivered: true,
        messageId: String(body.messageId || ""),
        ok: true,
        sessionId: SESSION_ID
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/save")) {
      const body = requestBodyWithoutOrigin(request);
      const requestSessionId = sessionIdFromApiPath(url.pathname) || selectedSessionId;
      await onSave(body, requestSessionId);
      await fulfillJson(route, {
        ok: true,
        operation: {
          events: [{ message: "Saved to the canonical project repository." }],
          status: "succeeded"
        },
        sessionId: requestSessionId,
        status: "saved"
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/temporary-conversations")) {
      const body = requestBodyWithoutOrigin(request);
      await onTemporaryConversation(body);
      await fulfillJson(route, {
        conversationId: "temporary-conversation-1",
        ok: true
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/temporary-conversations/temporary-conversation-1/turns")) {
      const body = requestBodyWithoutOrigin(request);
      await onTemporaryTurn(body);
      await fulfillJson(route, {
        ok: true,
        runId: "temporary-run-1",
        status: "inProgress"
      });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/temporary-conversations/temporary-conversation-1")) {
      const temporaryPoll = await onTemporaryPoll();
      await fulfillJson(route, temporaryPoll || {
        message: "Temporary answer",
        ok: true,
        runId: "temporary-run-1",
        status: "completed"
      });
      return;
    }
    if (method === "DELETE" && url.pathname.endsWith("/temporary-conversations/temporary-conversation-1")) {
      await onTemporaryDelete("temporary-conversation-1");
      await fulfillJson(route, { ok: true });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/work")) {
      await fulfillJson(route, {
        ...workState,
        ok: true
      });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/conversation-log")) {
      const beforeTurnId = String(url.searchParams.get("beforeTurnId") || "");
      const requestedLimit = Number.parseInt(String(url.searchParams.get("limit") || "20"), 10);
      const customPage = conversationPage
        ? await conversationPage({
            beforeTurnId,
            limit: Number.isFinite(requestedLimit) ? requestedLimit : 20
          })
        : null;
      if (customPage) {
        await fulfillJson(route, {
          ...customPage,
          ok: true,
          sessionId: SESSION_ID
        });
        return;
      }
      await fulfillJson(route, {
        conversationLog,
        ok: true,
        pagination: {
          count: conversationLog.length,
          hasMoreBefore: false,
          limit: 20,
          totalTurnCount: conversationLog.length
        },
        sessionId: SESSION_ID
      });
      return;
    }
    if (method === "GET" && /\/sessions\/[^/]+$/u.test(url.pathname)) {
      const requestSessionId = sessionIdFromApiPath(url.pathname) || selectedSessionId;
      const requestedSession = sessions.find(({ sessionId }) => sessionId === requestSessionId) || session;
      await fulfillJson(route, {
        ...requestedSession,
        ok: true
      });
      return;
    }
    await fulfillJson(route, {
      creation: {
        canCreate: true,
        mode: "direct"
      },
      limits: {
        openSessionCount: 1
      },
      ok: true,
      sessions
    });
  }, { prefix: true });
}

function scrollTestTurn(index: number, {
  role = "assistant",
  text = ""
}: {
  role?: "assistant" | "user";
  text?: string;
} = {}) {
  const id = `turn-${index}`;
  const user = {
    at: `2026-08-24T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
    messageId: `${id}-user`,
    role: "user",
    text: role === "user" && text
      ? text
      : `User message ${index}. ${SCROLL_TEST_COPY}`
  };
  return {
    ...(role === "assistant"
      ? {
          assistant: {
            at: `2026-08-24T10:${String(index % 60).padStart(2, "0")}:30.000Z`,
            messageId: `${id}-assistant`,
            role: "assistant",
            text: text || `Assistant message ${index}. ${SCROLL_TEST_COPY}`
          }
        }
      : {}),
    turnId: id,
    user
  };
}

async function conversationDistanceFromBottom(locator: Locator) {
  return locator.evaluate((element) => Math.max(
    0,
    element.scrollHeight - element.scrollTop - element.clientHeight
  ));
}

async function detachConversation(
  locator: Locator,
  distanceFromBottom: number,
  method: "touch" | "wheel" = "wheel"
) {
  await locator.evaluate((element, { distance, method: inputMethod }) => {
    element.dispatchEvent(inputMethod === "touch"
      ? new Event("touchmove", { bubbles: true })
      : new WheelEvent("wheel", {
          bubbles: true,
          deltaY: -distance
        }));
    element.scrollTop = Math.max(
      0,
      element.scrollHeight - element.clientHeight - distance
    );
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, {
    distance: distanceFromBottom,
    method
  });
}

function directSession({
  agentActive = false,
  agentTurn = null,
  includeWorktreePaths = false,
  sessionId = SESSION_ID,
  sessionName = "Direct chat",
  workspaceSetup = null
}: {
  agentActive?: boolean;
  agentTurn?: Record<string, unknown> | null;
  includeWorktreePaths?: boolean;
  sessionId?: string;
  sessionName?: string;
  workspaceSetup?: Record<string, unknown> | null;
} = {}) {
  const createdAt = "2026-08-14T00:00:00.000Z";
  const sessionRoot = sessionRuntimeRoot(sessionId);
  const sourcePath = includeWorktreePaths
    ? `/workspace/vibe64-sources/sessions/active/${sessionId}/source`
    : `${sessionRoot}/source`;
  return {
    agentRuns: [],
    agentSession: {
      identity: null,
      providerId: "codex",
      terminal: null,
      thread: {
        id: "thread-direct-chat"
      },
      transportId: "codex_app_server",
      turn: agentTurn || { active: agentActive },
      workdir: sourcePath
    },
    backgroundTasks: [],
    companion: {
      id: "genesis",
      label: "Genesis"
    },
    conversationLogRoot: `${sessionRoot}/conversation-log`,
    manifest: {
      createdAt,
      product: "vibe64",
      revision: 1,
      schemaVersion: 1,
      sessionId: SESSION_ID,
      updatedAt: createdAt
    },
    metadata: includeWorktreePaths
      ? {
          source_kind: "session_clone",
          source_path: sourcePath,
          source_path_authority: "managed_session_source"
        }
      : {},
    revision: 1,
    sessionId,
    sessionName,
    sessionRoot,
    sourcePath,
    sourceReady: true,
    stateRoot: `${sessionRoot}/state`,
    status: "active",
    targetRoot: "/workspace/example-target-app",
    updatedAt: createdAt,
    ...(workspaceSetup ? { workspaceSetup } : {})
  };
}

function sessionIdFromApiPath(pathname: string) {
  return decodeURIComponent(pathname.match(/\/sessions\/([^/]+)/u)?.[1] || "");
}

async function mockTemporaryRecovery(page: Page, options: {
  workspaceSetup?: Record<string, unknown> | null;
  workState?: Record<string, unknown>;
}) {
  const messages: Record<string, unknown>[] = [];
  const temporaryStarts: Record<string, unknown>[] = [];
  const temporaryTurns: Record<string, unknown>[] = [];
  await mockDirectChat(page, {
    ...options,
    onMessage(body) {
      messages.push(body);
    },
    onTemporaryConversation(body) {
      temporaryStarts.push(body);
    },
    onTemporaryTurn(body) {
      temporaryTurns.push(body);
    }
  });
  return {
    messages,
    temporaryStarts,
    temporaryTurns
  };
}

async function expectTemporaryRecovery(page: Page, captured: {
  messages: Record<string, unknown>[];
  temporaryStarts: Record<string, unknown>[];
  temporaryTurns: Record<string, unknown>[];
}, {
  expectedPrompt,
  promptLabel
}: {
  expectedPrompt: string;
  promptLabel: string;
}) {
  const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
  await expect(workspace).toBeVisible();
  await expect.poll(() => captured.temporaryStarts).toHaveLength(1);
  expect(captured.temporaryStarts[0]).toEqual(expect.objectContaining({
    policy: "workspace_write"
  }));
  await expect.poll(() => captured.temporaryTurns).toHaveLength(1);
  expect(captured.temporaryTurns[0]).toEqual(expect.objectContaining({
    message: expectedPrompt,
    policy: "workspace_write",
    promptLabel
  }));
  await expect(workspace.getByText("Temporary answer", { exact: true })).toBeVisible();
  await expect(workspace.getByRole("button", {
    name: promptLabel,
    exact: true
  })).toBeVisible();
  await expect(workspace.getByRole("button", {
    name: "Read/write: temporary AI may edit this session",
    exact: true
  })).toBeVisible();
  expect(captured.temporaryStarts).toHaveLength(1);
  expect(captured.temporaryTurns).toHaveLength(1);
  expect(captured.messages).toHaveLength(0);
}

function requestBodyWithoutOrigin(request: Request) {
  const {
    originId: _originId,
    ...body
  } = (request.postDataJSON() || {}) as Record<string, unknown>;
  return body;
}

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: "application/json"
  });
}
