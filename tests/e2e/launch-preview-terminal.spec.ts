import { expect, test, type Page, type Request as PlaywrightRequest, type Route } from "@playwright/test";
import { createServer as createHttpServer, request as requestHttp, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, rm, writeFile } from "node:fs/promises";
import { controllerHarness } from "../fixtures/opencodeController.js";
import { createPreviewPreparationFixture } from "../fixtures/previewPreparation.js";

import {
  injectLaunchPreviewBridge
} from "../../packages/vibe64-terminals/src/server/launchPreviewBridge.js";
import {
  PREVIEW_IDENTITY_CONTROL_PATH
} from "../../packages/vibe64-core/src/server/previewAuth.js";
import {
  sourceEditorFilePolicy,
  sourceEditorSourceContractPathExcluded
} from "../../packages/vibe64-source-editor/src/server/filePolicy.js";
import {
  pathMatchesPolicyPattern
} from "../../packages/vibe64-source-editor/src/server/service.js";

import {
  BASE_URL,
  DASHBOARD_PATH,
  DEVELOPMENT_PATH,
  SCOPED_API_PREFIX,
  sessionRuntimeRoot
} from "./support/base-shell-data";
import {
  mockProjectGateReady
} from "./support/base-shell-mocks";

const SESSION_ID = "session-renderer";
const TARGET_APP_URL = "http://127.0.0.1:4103/home";
const PROXY_APP_URL = "http://127.0.0.1:49000/home";
const TEST_ASSISTANT_CATALOG_REVISION = `sha256:${"a".repeat(64)}`;

for (const width of [390, 1440]) {
  test(`@update-icon failed Update retains Rebase until success at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockLaunchTerminalSocket(page);
    await mockLaunchSession(page, { assistantAccess: PERSONAL_ASSISTANT_ACCESS });
    let behind = true;
    let attempts = 0;
    await page.route("**/sessions/*/work", (route) => fulfillJson(route, {
      checkedAt: new Date().toISOString(),
      ok: true,
      unsaved: true,
      updateAvailable: behind,
      updateOperation: behind ? {
        code: "vibe64_session_update_conflict",
        error: "The document conflicts with the latest saved version.",
        operationId: "failed-update",
        status: "failed"
      } : null
    }));
    await page.route("**/sessions/*/updates/apply", async (route) => {
      attempts += 1;
      behind = attempts < 2;
      await fulfillJson(route, behind
        ? { ok: false, code: "vibe64_session_update_conflict", error: "The document still conflicts." }
        : { ok: true, status: "updated" });
    });
    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
    const rebase = page.getByRole("button", { name: "Update selected session (rebase)", exact: true });
    const save = page.getByRole("button", { name: "Save selected session work", exact: true });
    await expect(rebase).toBeEnabled();
    await expect(save).toHaveCount(0);
    await page.reload();
    await expect(rebase).toBeEnabled();
    await rebase.click();
    await expect.poll(() => attempts).toBe(1);
    await expect(rebase).toBeEnabled();
    await rebase.click();
    await expect.poll(() => attempts).toBe(2);
    await expect(save).toBeEnabled();
    await expect(rebase).toHaveCount(0);
  });
}

for (const width of [390, 1440]) {
  for (const first of ["HTTP", "realtime"]) {
    test(`@rebase-discovery ${first} shows Rebase before work inspection at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await mockLaunchTerminalSocket(page);
      const sessions = ["Alpha", "Beta", "Gamma"].map((sessionName, index) => sessionPayload({
        sessionId: index ? `session-${sessionName}` : SESSION_ID, sessionName
      }));
      const targetId = sessions[1].sessionId;
      await mockLaunchSession(page, {
        assistantAccess: PERSONAL_ASSISTANT_ACCESS, session: sessions[0], sessionList: sessions
      });
      const checkGate = Promise.withResolvers<void>();
      const workGate = Promise.withResolvers<void>();
      const confirmed = {
        ok: true, canonicalCommit: "new-version", checkedAt: "2026-09-08T10:00:00.000Z", updateAvailable: true
      };
      let targetChecks = 0;
      let targetWorkReads = 0;
      let workFinished = false;
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/sessions/*/work", async (route) => {
        const target = route.request().url().includes(`/${targetId}/`);
        if (target) { targetWorkReads += 1; await workGate.promise; workFinished = true; }
        await fulfillJson(route, {
          ok: true, canonicalCommit: target ? "new-version" : "old-version",
          unsaved: true, changedPaths: ["app.js"], updateAvailable: target
        });
      });
      await page.route("**/sessions/*/updates/check", async (route) => {
        if (route.request().url().includes(`/${targetId}/`)) {
          targetChecks += 1;
          await checkGate.promise;
          await fulfillJson(route, confirmed);
        } else {
          await fulfillJson(route, { ok: true, canonicalCommit: "old-version", updateAvailable: false });
        }
      });
      try {
        await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
        await page.locator(`[data-vibe64-session-id='${targetId}']:visible`).click();
        await expect.poll(() => targetChecks).toBe(1);
        const chat = page.locator(".studio-autopilot:visible");
        const composer = chat.locator("textarea").last();
        await composer.fill("Keep this draft while checking for updates.");
        await composer.focus();
        const notify = () => publishChatSessionChange(page, {
          reason: "session-repository-checked", sessionId: targetId, repositoryUpdateCheck: confirmed
        });
        if (first === "realtime") await notify();
        else checkGate.resolve();
        const update = chat.getByRole("button", { name: "Update selected session (rebase)", exact: true });
        await expect(update).toBeEnabled({ timeout: 1500 });
        expect(workFinished).toBe(false);
        await expect(composer).toHaveValue("Keep this draft while checking for updates.");
        await expect(composer).toBeFocused();
        const reads = targetWorkReads;
        if (first === "realtime") checkGate.resolve();
        else await notify();
        await expect(update).toBeEnabled();
        await page.screenshot({ path: testInfo.outputPath("rebase-before-work.png"), animations: "disabled" });
        expect(targetWorkReads).toBe(reads);
        workGate.resolve();
        await expect.poll(() => workFinished).toBe(true);
        await expect(update).toBeEnabled();
        await expect(page.getByText("Attention required", { exact: true })).toHaveCount(0);
        expect(errors).toEqual([]);
      } finally {
        checkGate.resolve();
        workGate.resolve();
      }
    });
  }
}

for (const width of [390, 1440]) {
  test(`@save-realtime sibling tabs and header show Update before rechecking finishes at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mockLaunchTerminalSocket(page);
    const sessions = ["Alpha", "Beta", "Gamma"].map((sessionName, index) => sessionPayload({
      sessionId: index ? `session-${sessionName}` : SESSION_ID,
      sessionName
    }));
    await mockLaunchSession(page, {
      assistantAccess: PERSONAL_ASSISTANT_ACCESS,
      session: sessions[0],
      sessionList: sessions
    });
    let notified = false;
    let checked = false;
    let releaseCheck: () => void = () => {};
    const checkGate = new Promise<void>((resolve) => { releaseCheck = resolve; });
    await page.route("**/sessions/*/work", (route) => fulfillJson(route, {
      canonicalCommit: checked ? "new-version" : "old-version",
      checkedAt: new Date().toISOString(),
      changedPaths: ["app.js"],
      ok: true,
      unsaved: true,
      updateAvailable: checked
    }));
    await page.route("**/sessions/*/updates/check", async (route) => {
      if (notified) await checkGate;
      await fulfillJson(route, {
        canonicalCommit: checked ? "new-version" : "old-version",
        ok: true,
        updateAvailable: checked
      });
    });
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      const chat = page.locator(".studio-autopilot:visible");
      const save = chat.getByRole("button", { name: "Save selected session work", exact: true });
      const update = chat.getByRole("button", { name: "Update selected session (rebase)", exact: true });
      for (const session of sessions.slice(1)) {
        await page.locator(`[data-vibe64-session-id='${session.sessionId}']:visible`).click();
        await expect(save).toBeEnabled();
      }
      notified = true;
      for (const session of sessions.slice(1)) {
        await publishChatSessionChange(page, {
          canonicalCommit: "new-version",
          reason: "repository-canonical-changed",
          sessionId: session.sessionId,
          sourceSessionId: SESSION_ID
        });
      }
      for (const session of sessions.slice(1)) {
        await page.locator(`[data-vibe64-session-id='${session.sessionId}']:visible`).click();
        await expect(update).toBeVisible({ timeout: 1000 });
        await expect(save).toHaveCount(0);
      }
      await page.screenshot({ path: testInfo.outputPath("update-before-check.png"), animations: "disabled" });
      checked = true;
      releaseCheck();
      await expect(update).toBeEnabled();
      await expect(save).toHaveCount(0);
    } finally {
      releaseCheck();
    }
  });
}

test.describe("temporary workspace lifetime", () => {
  for (const pending of ["creation", "poll", "stop"]) {
    test(`@temporary-unmount archiving a session retires pending ${pending}`, async ({ page }, testInfo) => {
      await mockLaunchTerminalSocket(page);
      const requests: TemporaryAiRecoveryRequests = { mainMessages: [], temporaryStarts: [], temporaryTurns: [] };
      await mockLaunchSession(page, {
        assistantAccess: PERSONAL_ASSISTANT_ACCESS,
        temporaryAiRecoveryRequests: requests
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let held = false;
      let reads = 0;
      let deletes = 0;
      let updates = 0;
      const gate = Promise.withResolvers<void>();
      await page.route("**/sessions/*/work", (route) => fulfillJson(route, {
        ok: true, unsaved: true, updateAvailable: true,
        updateOperation: {
          operationId: "failed-update", status: "failed", code: "vibe64_session_update_conflict",
          error: "Document conflicts with the saved version."
        }
      }));
      await page.route("**/temporary-conversations", async (route) => {
        if (pending !== "creation") { await route.fallback(); return; }
        held = true;
        await gate.promise;
        await route.fallback();
      });
      await page.route("**/temporary-conversations/temporary-preview-identity", async (route) => {
        if (route.request().method() === "DELETE") {
          deletes += 1;
          await fulfillJson(route, { ok: true });
          return;
        }
        reads += 1;
        if (pending === "poll" && reads === 1) {
          held = true;
          await gate.promise;
        }
        await fulfillJson(route, { ok: true, status: "inProgress" });
      });
      await page.route("**/sessions/*/updates/apply", (route) => {
        updates += 1;
        return fulfillJson(route, { ok: true });
      });
      await page.route("**/temporary-conversations/*/stop", async (route) => {
        if (pending !== "stop") { await route.fallback(); return; }
        held = true;
        await gate.promise;
        await fulfillJson(route, { ok: false, error: "This Stop reply arrived after the session was archived." });
      });
      try {
        await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
        await page.getByRole("button", { name: "Fix it with AI", exact: true }).click();
        if (pending === "stop") {
          await page.getByRole("region", { name: "Temporary AI workspace" })
            .getByRole("button", { name: "Stop", exact: true }).click();
        }
        await expect.poll(() => held).toBe(true);
        await expect(page.getByRole("region", { name: "Temporary AI workspace" })).toBeVisible();
        const readsBeforeArchive = reads;
        await page.screenshot({ path: testInfo.outputPath("repair-before-leaving.png") });
        await page.getByRole("button", { name: "Archive session", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Archive session", exact: true }).click();
        await expect(page.getByRole("region", { name: "Temporary AI workspace" })).toHaveCount(0);
        if (pending === "stop") {
          // Finish the archive feedback before releasing the obsolete Stop reply.
          await expect(page.getByText("Vibe64 session archived.", { exact: true })).toBeVisible();
          await page.getByRole("button", { name: "Dismiss", exact: true }).click();
        }
        gate.resolve();
        await expect.poll(() => deletes).toBe(1);
        // Observe more than two 650ms poll intervals after the held reply settles.
        await page.waitForTimeout(1600);
        expect(reads).toBe(readsBeforeArchive);
        expect(requests.temporaryTurns).toHaveLength(pending === "creation" ? 0 : 1);
        expect(updates).toBe(0);
        expect(errors).toEqual([]);
        expect(await page.getByText("This Stop reply arrived after the session was archived.").count()).toBe(0);
        await page.screenshot({ path: testInfo.outputPath("session-archived-no-task-work.png") });
      } finally {
        gate.resolve();
      }
    });
  }
});

for (const width of [390, 1440]) {
  test(`@temporary-repair progress stays in the transcript and Update verifies the repair at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mockLaunchTerminalSocket(page);
    const requests: TemporaryAiRecoveryRequests = { mainMessages: [], temporaryStarts: [], temporaryTurns: [] };
    await mockLaunchSession(page, {
      assistantAccess: PERSONAL_ASSISTANT_ACCESS,
      sessionList: [sessionPayload(), sessionPayload({ sessionId: "session-other", sessionName: "Other" })],
      temporaryAiRecoveryRequests: requests
    });
    let updateCount = 0;
    let releaseUpdate: (() => void) | undefined;
    let resultKind = "";
    let run = 0;
    let progressReads = 0;
    const progressUpdates = [
      { id: "first", text: "Inspecting the conflicting document. ".repeat(60) },
      { id: "second", text: "Comparing the current and saved versions. ".repeat(60) }
    ];
    await page.route("**/sessions/*/work", (route) => fulfillJson(route, {
      ok: true, unsaved: true, updateAvailable: updateCount !== 2,
      updateOperation: updateCount === 2 ? null : {
        operationId: "failed-update", status: "failed", code: "vibe64_session_update_conflict",
        error: "Document conflicts with the saved version."
      }
    }));
    await page.route("**/temporary-conversations/*/turns", async (route) => {
      run += 1;
      resultKind = "";
      requests.temporaryTurns.push(route.request().postDataJSON());
      await fulfillJson(route, { ok: true, status: "inProgress", runId: `repair-${run}` });
    });
    await page.route("**/temporary-conversations/temporary-preview-identity", async (route) => {
      if (route.request().method() !== "GET") { await route.fallback(); return; }
      progressReads += 1;
      await fulfillJson(route, {
        ok: true, runId: `repair-${run}`, status: resultKind ? "completed" : "inProgress",
        progressUpdates,
        message: resultKind === "continue" ? "Which version should I keep?" : resultKind ? "I repaired the document." : "",
        outcome: resultKind ? { kind: resultKind, message: "Repair result.", report: "Document repaired." } : null
      });
    });
    await page.route("**/sessions/*/updates/apply", async (route) => {
      updateCount += 1;
      await new Promise<void>((resolve) => { releaseUpdate = resolve; });
      await fulfillJson(route, updateCount === 1
        ? { ok: false, code: "vibe64_session_update_conflict", error: "The document still conflicts." }
        : { ok: true, status: "updated" });
    });
    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
    await page.locator(`[data-vibe64-session-id='${SESSION_ID}']:visible`).click();
    await page.getByRole("button", { name: "Fix it with AI", exact: true }).click();
    const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
    const activity = workspace.locator(".vibe64-prompt-hints__assistant-status");
    const transcript = workspace.locator(".vibe64-temporary-ai__messages");
    const composer = workspace.getByRole("textbox", { name: "Message temporary AI", exact: true });
    await expect(activity).toHaveText("AI is working…");
    await page.locator('[data-vibe64-session-id="session-other"]:visible').click();
    await expect(workspace).not.toBeVisible();
    const readsWhileHidden = progressReads;
    await expect.poll(() => progressReads).toBeGreaterThan(readsWhileHidden);
    await page.locator(`[data-vibe64-session-id='${SESSION_ID}']:visible`).click();
    await expect(workspace).toBeVisible();
    await expect(activity).toHaveText("AI is working…");
    expect(requests.temporaryTurns).toHaveLength(1);
    await expect(transcript.getByText("Working…", { exact: true })).toHaveCount(0);
    await expect(activity).toHaveCount(1);
    const statusStyle = await activity.evaluate((element) => {
      const style = getComputedStyle(element);
      return { weight: style.fontWeight, background: style.backgroundColor };
    });
    expect(statusStyle).toEqual({ weight: "400", background: "rgba(0, 0, 0, 0)" });
    await expect(workspace.getByText("This is a separate temporary chat", { exact: false })).toHaveCount(0);
    const progress = workspace.getByLabel("Temporary AI progress", { exact: true }).last();
    const toggle = progress.getByRole("button");
    await expect(toggle).toHaveText("Show all 2 progress updates");
    await expect(progress.locator(".vibe64-conversation-progress__message")).toHaveCount(0);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(progress.locator(".vibe64-conversation-progress__message")).toHaveCount(2);
    progressUpdates.push({ id: "third", text: "Checking whether the repair can be applied. ".repeat(60) });
    await expect(progress.locator(".vibe64-conversation-progress__message")).toHaveCount(3);
    expect(await transcript.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    expect((await activity.boundingBox())!.height).toBeLessThan(55);
    expect((await composer.boundingBox())!.y).toBeLessThan(844);
    await expect(workspace.getByRole("button", { name: "Stop", exact: true })).toBeInViewport();
    await toggle.click();
    await expect(toggle).toHaveText("Show all 3 progress updates");
    await page.screenshot({ path: testInfo.outputPath(`repair-working-${width}.png`) });

    resultKind = "continue";
    await expect(workspace.getByText("Waiting for your reply", { exact: true })).toBeVisible();
    expect(updateCount).toBe(0);
    await composer.fill("Keep both changes.");
    await page.locator('[data-vibe64-session-id="session-other"]:visible').click();
    await expect(workspace).not.toBeVisible();
    await page.locator(`[data-vibe64-session-id='${SESSION_ID}']:visible`).click();
    await expect(composer).toHaveValue("Keep both changes.");
    await expect(workspace.getByText("Waiting for your reply", { exact: true })).toBeVisible();
    await workspace.getByRole("button", { name: "Send to temporary AI", exact: true }).click();
    await expect(activity).toHaveText("AI is working…");
    resultKind = "complete";
    await expect(activity).toHaveText("Checking Update…");
    await expect(composer).toBeDisabled();
    await expect(workspace.getByRole("button", { name: "Close Resolve Update", exact: true })).toBeDisabled();
    expect(updateCount).toBe(1);
    releaseUpdate?.();
    await expect(workspace.getByText("Update needs attention", { exact: true })).toBeVisible();
    await expect(workspace.getByText("Update still needs attention: The document still conflicts.", { exact: true })).toBeVisible();
    await composer.fill("Try again.");
    await workspace.getByRole("button", { name: "Send to temporary AI", exact: true }).click();
    await expect(activity).toHaveText("AI is working…");
    resultKind = "complete";
    await expect(activity).toHaveText("Checking Update…");
    expect(updateCount).toBe(2);
    releaseUpdate?.();
    await expect(workspace.getByText("Repair verified", { exact: true })).toBeVisible();
    await expect(workspace.getByText("Update succeeded. Your session includes the latest saved work and keeps your local edits.", { exact: true })).toBeVisible();
    await expect(composer).toBeEnabled();
    await expect(activity).toHaveCount(0);
    expect(requests.mainMessages).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath(`repair-verified-${width}.png`) });
    await page.locator('[data-vibe64-session-id="session-other"]:visible').click();
    await page.locator(`[data-vibe64-session-id='${SESSION_ID}']:visible`).click();
    await expect(workspace.getByText("Repair verified", { exact: true })).toBeVisible();
    await workspace.getByRole("button", { name: "Main chat", exact: true }).click();
    await expect(workspace).not.toBeVisible();
    await page.locator('[data-vibe64-session-id="session-other"]:visible').click();
    await page.locator(`[data-vibe64-session-id='${SESSION_ID}']:visible`).click();
    await expect(workspace).not.toBeVisible();
  });
}

for (const width of [390, 1440]) {
  test(`@temporary-cancel closing a repair warns, waits for Stop, and keeps failed cleanup retryable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mockLaunchTerminalSocket(page);
    await mockLaunchSession(page, {
      assistantAccess: PERSONAL_ASSISTANT_ACCESS,
      temporaryAiRecoveryRequests: { mainMessages: [], temporaryStarts: [], temporaryTurns: [] }
    });
    let stopCount = 0;
    let deleteCount = 0;
    let updateCount = 0;
    let stopped = false;
    let releaseStop: () => void;
    const stopGate = new Promise<void>((resolve) => { releaseStop = resolve; });
    await page.route("**/sessions/*/work", (route) => fulfillJson(route, {
      ok: true, unsaved: true, updateAvailable: true,
      updateOperation: { operationId: "failed-update", status: "failed", code: "vibe64_session_update_conflict", error: "Document conflicts with the saved version." }
    }));
    await page.route("**/temporary-conversations/*/turns", (route) => fulfillJson(route, {
      ok: true, status: "inProgress", runId: "repair-1"
    }));
    await page.route("**/temporary-conversations/temporary-preview-identity", async (route) => {
      if (route.request().method() === "DELETE") {
        deleteCount += 1;
        await fulfillJson(route, deleteCount === 1
          ? { ok: false, error: "Conversation deletion failed." }
          : { ok: true });
        return;
      }
      await fulfillJson(route, {
        ok: true, runId: "repair-1", status: stopped ? "interrupted" : "inProgress",
        progressUpdates: [{ id: "first", text: "Inspecting the conflicting document." }]
      });
    });
    await page.route("**/temporary-conversations/*/stop", async (route) => {
      stopCount += 1;
      if (stopCount === 1) {
        await fulfillJson(route, { ok: false, error: "Stopping the AI failed." });
        return;
      }
      await stopGate;
      stopped = true;
      await fulfillJson(route, { ok: true });
    });
    await page.route("**/sessions/*/updates/apply", (route) => {
      updateCount += 1;
      return fulfillJson(route, { ok: true });
    });
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      await page.getByRole("button", { name: "Fix it with AI", exact: true }).click();
      const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
      const activity = workspace.locator(".vibe64-prompt-hints__assistant-status");
      const close = workspace.getByRole("button", { name: "Close Resolve Update", exact: true });
      await expect(activity).toHaveText("AI is working…");
      await close.click();
      const dialog = page.getByRole("dialog", { name: "Stop and close repair?", exact: true });
      await expect(dialog).toBeInViewport();
      await expect(dialog.getByText("Partial edits will stay in this session", { exact: false })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("repair-close-warning.png"), animations: "disabled" });
      await dialog.getByRole("button", { name: "Keep chat open", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      expect(stopCount).toBe(0);
      expect(deleteCount).toBe(0);
      await expect(activity).toHaveText("AI is working…");
      await close.click();
      await dialog.getByRole("button", { name: "Stop and close", exact: true }).click();
      await expect(page.getByText("Stopping the AI failed.", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Stop and close", exact: true })).toBeEnabled();
      expect(deleteCount).toBe(0);
      await dialog.getByRole("button", { name: "Keep chat open", exact: true }).click();
      await expect(activity).toHaveText("AI is working…");
      await close.click();
      await dialog.getByRole("button", { name: "Stop and close", exact: true }).click();
      await expect.poll(() => stopCount).toBe(2);
      expect(deleteCount).toBe(0);
      await expect(dialog.getByRole("button", { name: "Keep chat open", exact: true })).toBeDisabled();
      releaseStop!();
      const incompleteDialog = page.getByRole("dialog", { name: "Close incomplete repair?", exact: true });
      await expect(page.getByText("Conversation deletion failed.", { exact: true })).toBeVisible();
      await incompleteDialog.getByRole("button", { name: "Keep chat open", exact: true }).click();
      await expect(workspace.getByText("AI repair stopped", { exact: true })).toBeVisible();
      await expect(workspace.getByText("Partial edits remain and Update still needs to succeed.", { exact: false })).toBeVisible();
      await expect(activity).toHaveCount(0);
      await expect(workspace.getByRole("textbox", { name: "Message temporary AI", exact: true })).toBeEnabled();
      expect(updateCount).toBe(0);
      await close.click();
      await incompleteDialog.getByRole("button", { name: "Close repair", exact: true }).click();
      await expect(workspace).not.toBeVisible();
      expect(stopCount).toBe(2);
      expect(deleteCount).toBe(2);
      expect(updateCount).toBe(0);
      await expect(page.getByRole("button", { name: "Update selected session (rebase)", exact: true })).toBeVisible();
    } finally {
      releaseStop!();
    }
  });
}

for (const width of [1440, 390]) {
  for (const changeEnvironment of [false, true]) {
    test(`@preview-preparation real preview ${changeEnvironment ? "waits for changed environment" : "starts while assistant admission is occupied"} at ${width}px`, async ({ page }, testInfo) => {
      const previousNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
      process.env.VIBE64_RUNTIME_NAMESPACE = "preview-preparation-browser";
      let publishReady = async () => {};
      const fixture = await createPreviewPreparationFixture({
        publishSessionChanged: {
          async outputTarget(_sessionId, event) {
            if (event.reason === "output-target-ready") await publishReady();
          }
        }
      });
      let release = async () => {};
      try {
        await fixture.prepare();
        if (changeEnvironment) {
          await writeFile(fixture.stackPath, (await readFile(fixture.stackPath, "utf8")).replace("`initial`", "`updated`"));
        }
        release = await fixture.holdAssistantLock();
        await page.setViewportSize({ width, height: 1000 });
        await mockLaunchTerminalSocket(page, { terminalSocketNeverSettles: true });
        const launch = await mockLaunchSession(page);
        publishReady = launch.publishLaunchReady;
        let starts = 0;
        await page.route("**/outputs", async (route) => {
          await fulfillJson(route, await fixture.terminals.outputTargetStatus(fixture.sessionId));
        });
        await page.route("**/output-runs", async (route) => {
          starts += 1;
          const result = await fixture.terminals.startOutputTargetTerminal(fixture.sessionId, route.request().postDataJSON());
          await fulfillJson(route, result, { status: result.ok === false ? 409 : 200 });
        });
        await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
        if (width < 600) await page.getByRole("button", { name: "Show project" }).click();
        if (changeEnvironment) {
          await expect(page.getByText("Waiting for the assistant operation to finish. Preview will retry automatically.")).toBeVisible();
          expect(starts).toBe(1);
          await page.screenshot({ path: testInfo.outputPath("real-preparation-waiting.png") });
          await release();
        }
        const preview = page.frameLocator(".vibe64-launch-controls__preview-frame");
        await expect(preview.getByRole("heading", { name: `Preview works: ${changeEnvironment ? "updated" : "initial"}` })).toBeVisible({ timeout: 15_000 });
        expect(starts).toBe(changeEnvironment ? 2 : 1);
        await expect(page.getByText("Another assistant operation is starting. Try again in a moment.", { exact: true })).toHaveCount(0);
        if (!changeEnvironment) {
          expect((await fixture.runtime.store.runSessionExclusive(fixture.sessionId, "agent-write-mode", () => null)).acquired).toBe(false);
        }
        await page.screenshot({ path: testInfo.outputPath("real-preview-running.png") });
      } finally {
        await page.unrouteAll({ behavior: "wait" });
        await release();
        await fixture.close();
        if (previousNamespace === undefined) delete process.env.VIBE64_RUNTIME_NAMESPACE;
        else process.env.VIBE64_RUNTIME_NAMESPACE = previousNamespace;
      }
    });
  }
}
const PERSONAL_ASSISTANT_ACCESS = Object.freeze({
  accessLabel: "Personal use",
  available: true,
  canUse: true,
  ok: true,
  ownerOnly: true
});
type SourceExplanationPayload = Record<string, unknown>;
type SourceExplanationResponse = unknown[] | ((payload: SourceExplanationPayload) => unknown[]);
type PreviewIdentitySelector = {
  type: "email" | "login" | "user-id";
  value: string;
};
type PreviewIdentitySelection = {
  displayName?: string;
  mode: string;
  name?: string;
  selector?: PreviewIdentitySelector;
};
type PreviewIdentityExchangeResult = {
  code?: string;
  error?: string;
  identity?: Record<string, unknown> | null;
  ok?: boolean;
  signedOut?: boolean;
  status?: number;
};
type TemporaryAiRecoveryRequests = {
  mainMessages: Record<string, unknown>[];
  temporaryStarts: Record<string, unknown>[];
  temporaryTurns: Record<string, unknown>[];
};
type AttachmentUpload = {
  bytes: Buffer;
  contentType: string;
  fileName: string;
};

function assistantCatalogPayload({ includeOpenCode = false }: {
  includeOpenCode?: boolean;
} = {}) {
  const codex = {
    agents: [{
      id: "codex",
      label: "Codex",
      mode: "primary"
    }],
    authentication: {
      management: "account-owner",
      modes: ["oauth", "api-key"]
    },
    defaults: {
      agentId: "codex",
      modelId: "gpt-5.6-sol",
      modelProviderId: "openai",
      variantId: "xhigh"
    },
    engineId: "codex",
    health: {
      status: "ready"
    },
    label: "Codex",
    modelProviders: [{
      connected: true,
      connectionStatus: "connected",
      id: "openai",
      label: "OpenAI",
      models: [{
        id: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        status: "available",
        variants: [{
          id: "xhigh",
          label: "Extra high"
        }]
      }]
    }],
    revision: TEST_ASSISTANT_CATALOG_REVISION,
    schema: "vibe64.assistant-capabilities.v1",
    transportId: "codex_app_server"
  };
  return {
    engines: includeOpenCode
      ? [codex, {
          agents: [{ id: "build", label: "Build", mode: "primary" }],
          authentication: { management: "account-owner", modes: ["api-key"] },
          defaults: {
            agentId: "build",
            modelId: "glm-5.3",
            modelProviderId: "zai-coding-plan",
            variantId: "high"
          },
          engineId: "opencode",
          health: { status: "ready" },
          label: "OpenCode",
          modelProviders: [{
            connected: true,
            connectionStatus: "connected",
            id: "zai-coding-plan",
            label: "Z.AI Coding Plan",
            models: [{
              id: "glm-5.3",
              label: "GLM-5.3",
              status: "available",
              variants: [{ id: "high", label: "High" }]
            }]
          }],
          revision: TEST_ASSISTANT_CATALOG_REVISION,
          schema: "vibe64.assistant-capabilities.v1",
          transportId: "opencode_server"
        }]
      : [codex],
    ok: true
  };
}

async function submitAssistantSessionDialog(page: Page, {
  doubleSubmit = false
}: {
  doubleSubmit?: boolean;
} = {}) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const submitButton = dialog.locator(".vibe64-assistant-dialog__actions button").last();
  await expect(submitButton).toHaveText("Create session");
  await expect(submitButton).toBeEnabled();
  if (doubleSubmit) {
    await submitButton.evaluate((element) => {
      const button = element as HTMLButtonElement;
      button.focus();
      button.click();
      button.click();
    });
  } else {
    await submitButton.click();
  }
  return submitButton;
}

async function readMultipartAttachment(request: PlaywrightRequest): Promise<AttachmentUpload> {
  const contentType = String(request.headers()["content-type"] || "");
  const body = request.postDataBuffer();
  if (!/^multipart\/form-data;\s*boundary=/iu.test(contentType) || !body) {
    throw new Error("Expected one multipart attachment upload.");
  }
  const multipartRequest = new globalThis.Request("http://vibe64.test/attachment", {
    body,
    headers: {
      "content-type": contentType
    },
    method: "POST"
  });
  const formData = await multipartRequest.formData();
  const fieldNames = [...formData.keys()];
  const file = formData.get("file");
  if (
    fieldNames.length !== 1 ||
    fieldNames[0] !== "file" ||
    !file ||
    typeof file === "string"
  ) {
    throw new Error("Expected multipart upload field named file.");
  }
  return {
    bytes: Buffer.from(await file.arrayBuffer()),
    contentType: String(file.type || "application/octet-stream"),
    fileName: String(file.name || "attachment")
  };
}

async function observeBrowserUploadProgress(page: Page) {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      __vibe64AttachmentProgressSamples?: number[];
    };
    state.__vibe64AttachmentProgressSamples = [];
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function sendWithObservedProgress(body) {
      this.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable || event.total <= 0) {
          return;
        }
        const percent = Math.round((event.loaded / event.total) * 100);
        const samples = state.__vibe64AttachmentProgressSamples || [];
        if (samples.at(-1) !== percent) {
          samples.push(percent);
        }
        state.__vibe64AttachmentProgressSamples = samples;
      });
      return originalSend.call(this, body);
    };
  });
}

async function browserUploadProgressSamples(page: Page) {
  return await page.evaluate(() => {
    const state = window as typeof window & {
      __vibe64AttachmentProgressSamples?: number[];
    };
    return [...(state.__vibe64AttachmentProgressSamples || [])];
  });
}

function expectMonotonicNonzeroProgress(samples: number[]) {
  expect(samples.some((value) => value > 0)).toBe(true);
  expect(samples.every((value, index) => index === 0 || value >= samples[index - 1])).toBe(true);
}

async function openSessionDashboardTool(page: Page, label: string) {
  await page.getByRole("tab", {
    name: "Dashboard"
  }).click();
  const dashboardNav = page.locator(".section-container-shell__nav");
  await expect(dashboardNav.getByLabel("Active session navigation")).toBeVisible();
  await dashboardNav.locator(".vibe64-active-session-nav-item.v-list-item", {
    hasText: label
  }).click();
}

test("@preview-lifecycle renders through the proxy and displays the target URL", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  await expect(previewFrame).toBeVisible();
  await expect(previewFrame).toHaveAttribute("src", /http:\/\/127\.0\.0\.1:49000\/home/u);
  await expect(
    page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")
  ).toBeVisible();
  await expect(page.getByLabel("Preview URL")).toHaveValue("/home");
  await expect(
    page.locator(".studio-home-shell-preview-toolbar-host .vibe64-launch-controls__toolbar")
  ).toBeVisible();
});

test("@render-recovery keeps GitHub sessions and preview alive through navigation and resize", async ({ page }) => {
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.text().includes("JSKIT_ERROR_CAUSE")) {
      errors.push(message.text());
    }
    if (message.type() === "warning" && message.text().includes("Teleport")) {
      errors.push(message.text());
    }
  });
  await mockLaunchTerminalSocket(page);
  const sessions = ["Alpha", "Beta", "Gamma"].map((name, index) => {
    const session = sessionPayload({ sessionId: index ? `session-${name}` : SESSION_ID, sessionName: name });
    Object.assign(session.metadata, {
      github_repository: "example/project",
      session_git_command_actor_scope: "user",
      session_git_command_actor_user_key: "test-user"
    });
    return session;
  });
  await mockLaunchSession(page, { assistantAccess: PERSONAL_ASSISTANT_ACCESS, session: sessions[0], sessionList: sessions });
  await page.goto(`${BASE_URL}${DASHBOARD_PATH}/session`);
  await expect(page.getByLabel("Message AI assistant")).toBeVisible();
  for (let round = 0; round < 4; round += 1) {
    await page.setViewportSize({ width: round % 2 ? 1100 : 1440, height: 900 });
    await page.getByRole("tab", { name: "Preview", exact: true }).click();
    await expect(page.locator(".vibe64-launch-controls__preview-frame:visible")).toBeVisible();
    for (const session of sessions) {
      await page.locator(`.studio-autopilot:visible [data-vibe64-session-id='${session.sessionId}']`).click();
      await expect(page.locator(".studio-autopilot:visible").getByLabel("Message AI assistant")).toBeVisible();
      await page.locator(".studio-autopilot:visible").getByRole("button", { name: "Reload chat", exact: true }).click();
      expect(errors).toEqual([]);
    }
    await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
    await page.goBack();
    await page.goForward();
    expect(errors).toEqual([]);
  }
  await page.evaluate(async () => {
    const root = document.querySelector("#app") as Element & { __vue_app__: { config: { globalProperties: { $router: { push: (path: string) => Promise<void> } } } } };
    await root.__vue_app__.config.globalProperties.$router.push("/app");
  });
  await page.goBack();
  await expect(page.locator(".studio-autopilot:visible").getByLabel("Message AI assistant")).toBeVisible();
  await page.setViewportSize({ width: 1200, height: 900 });
  expect(errors).toEqual([]);
});

test("@render-recovery creates three sessions while previews finish in the background", async ({ page }) => {
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.text().includes("JSKIT_ERROR_CAUSE")) {
      errors.push(message.text());
    }
  });
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    assistantAccess: PERSONAL_ASSISTANT_ACCESS,
    previewResponseDelayMs: 1000,
    sessionList: []
  });
  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  for (let index = 1; index <= 3; index += 1) {
    await page.locator("button.studio-ai-sessions__create-button:visible").click();
    await submitAssistantSessionDialog(page);
    await expect(page.locator(".studio-ai-sessions__tab:visible")).toHaveCount(index);
  }
  for (let round = 0; round < 3; round += 1) {
    for (let index = 1; index <= 3; index += 1) {
      await page.locator(`.studio-autopilot:visible [data-vibe64-session-id='session-created-${index}']`).click();
      await page.setViewportSize({ width: index % 2 ? 1440 : 1100, height: 900 });
      await page.locator(".studio-autopilot:visible").getByRole("button", { name: "Reload chat", exact: true }).click();
      expect(errors).toEqual([]);
    }
  }
  await expect(page.locator(".vibe64-launch-controls__preview-frame:visible")).toBeVisible();
  await page.locator('.studio-home-shell-preview-toolbar-host button[title="Reload preview"]').click();
  await expect(page.frameLocator(".vibe64-launch-controls__preview-frame:visible").getByText("Preview app")).toBeVisible();
  expect(errors).toEqual([]);
});

test("@render-recovery completes hidden preview loads across toolbar moves", async ({ page }) => {
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.text().includes("JSKIT_ERROR_CAUSE")) {
      errors.push(message.text());
    }
  });
  await mockLaunchTerminalSocket(page);
  const sessions = ["Alpha", "Beta", "Gamma"].map((sessionName, index) => sessionPayload({
    sessionId: index ? `session-${sessionName}` : SESSION_ID,
    sessionName
  }));
  await mockLaunchSession(page, {
    assistantAccess: PERSONAL_ASSISTANT_ACCESS,
    previewResponseDelayMs: 2000,
    previewIdentity: previewIdentityCapability(),
    previewIdentityExchange: () => ({ ok: true, identity: { email: "admin@example.com" } }),
    session: sessions[0], sessionList: sessions
  });
  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  for (const session of sessions) {
    await page.locator(`.studio-autopilot:visible [data-vibe64-session-id='${session.sessionId}']`).click();
    await expect(page.locator(`.studio-ai-session-runtime[data-vibe64-session-runtime-id='${session.sessionId}'] iframe`)).toBeAttached();
  }
  for (let round = 0; round < 3; round += 1) {
    await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Show project", exact: true }).click();
    await page.getByRole("button", { name: "Go to preview", exact: true }).click();
    if (round === 0) await page.getByRole("button", { name: "Show preview controls", exact: true }).click();
    await page.locator('.studio-home-shell-preview-toolbar-host button[title="Reload preview"]').click();
    await page.getByRole("button", { name: "Show chat", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(".studio-autopilot:visible").getByRole("button", { name: "Reload chat", exact: true }).click();
    await expect(page.frameLocator(".vibe64-launch-controls__preview-frame:visible").getByText("Preview app")).toBeVisible();
    expect(errors).toEqual([]);
  }
});

for (const width of [1280, 390]) {
  test(`@preview-setup-warning keeps the app and browser usable through Genesis warnings at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mockLaunchTerminalSocket(page, { terminalSocketNeverSettles: true });
    const session = sessionPayload();
    session.agentSession.turn.active = true;
    const launch = await mockLaunchSession(page, { session });
    let state = "attention";
    let failInspection = false;
    let reads = 0;
    await page.route("**/vibe64/onboarding?*", async (route) => {
      reads += 1;
      await fulfillJson(route, failInspection ? { ok: false, error: "Setup inspection unavailable." } : {
        ok: true,
        available: true,
        inspection: {
          state,
          nextAction: state === "ready" ? "work" : "repair",
          diagnostics: state === "ready" ? [] : [{
            code: "PROGRAM_SOURCE_MISSING",
            message: "Program module cites a missing or ineligible source file: src/components/contacts/ContactUpcomingBookings.vue."
          }]
        },
        templates: []
      });
    });
    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
    if (width === 390) await page.getByRole("button", { name: "Show project", exact: true }).click();
    const frame = page.locator(".vibe64-launch-controls__preview-frame");
    const warning = page.locator(".project-preview__warning");
    await expect(frame).toBeVisible();
    await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")).toBeVisible();
    await expect(warning).toContainText("ContactUpcomingBookings.vue");
    await expect(warning.getByRole("button", { name: "Ask AI to update setup" })).toBeDisabled();
    await expect(warning.getByRole("button", { name: "Recheck setup" })).toBeEnabled();
    const frameElement = await frame.elementHandle();
    const initialLoads = launch.getPreviewLoadCount();

    failInspection = true;
    await warning.getByRole("button", { name: "Recheck setup" }).click();
    await expect(warning).toContainText("Setup inspection unavailable.");
    await expect(frame).toBeVisible();
    expect(await frameElement?.evaluate((element) => element === document.querySelector(".vibe64-launch-controls__preview-frame"))).toBe(true);
    expect(launch.getPreviewLoadCount()).toBe(initialLoads);

    failInspection = false;
    state = "ready";
    await warning.getByRole("button", { name: "Recheck setup" }).click();
    await expect(warning).toHaveCount(0);
    expect(await frameElement?.evaluate((element) => element === document.querySelector(".vibe64-launch-controls__preview-frame"))).toBe(true);
    expect(launch.getPreviewLoadCount()).toBe(initialLoads);

    // Returning with a warm cache must show a new warning without replacing the iframe.
    state = "attention";
    if (width === 390) {
      await page.getByRole("button", { name: "Go to dashboard", exact: true }).click();
      await page.getByRole("button", { name: "Go to preview", exact: true }).click();
    } else {
      await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
      await page.getByRole("tab", { name: "Preview", exact: true }).click();
    }
    await expect(warning).toBeVisible();
    expect(await frameElement?.evaluate((element) => element === document.querySelector(".vibe64-launch-controls__preview-frame"))).toBe(true);
    expect(launch.getPreviewLoadCount()).toBe(initialLoads);

    if (width === 390) await page.getByRole("button", { name: "Show preview controls", exact: true }).click();
    await expect(page.getByLabel("Preview URL", { exact: true })).toHaveValue("/home");
    const readsBeforeReload = reads;
    await page.locator('button[title="Reload preview"]').click();
    await expect.poll(() => launch.getPreviewLoadCount()).toBe(initialLoads + 1);
    expect(reads).toBe(readsBeforeReload);
    expect(launch.getLaunchStartPayloads()).toHaveLength(0);
    await expect(page.locator('.vibe64-launch-controls__dock button[title="Open browser"]')).toBeEnabled();
    if (width === 390) await page.getByRole("button", { name: "Collapse preview controls", exact: true }).click();
    await expect(frame).toBeVisible();
    const warningBox = await warning.boundingBox();
    const frameBox = await frame.boundingBox();
    expect((warningBox?.y || 0) + (warningBox?.height || 0)).toBeLessThanOrEqual(frameBox?.y || 0);
    expect(frameBox?.height).toBeGreaterThan(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`setup-warning-${width}.png`) });
  });
}

test("@preview-setup-warning retains reload when launch settings have no usable target", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launch = await mockLaunchSession(page, {
    initialLaunchStatus: idleLaunchStatusPayload([])
  });
  await page.route("**/vibe64/onboarding?*", async (route) => {
    await fulfillJson(route, { ok: false, error: "Genesis setup could not be read." });
  });
  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await expect(page.locator(".project-preview__warning")).toBeVisible();
  await expect(page.getByLabel("Preview URL", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Preview URL", { exact: true })).toBeDisabled();
  const reads = launch.getLaunchStatusRequestCount();
  await page.locator('button[title="Reload preview"]').click();
  await expect.poll(() => launch.getLaunchStatusRequestCount()).toBeGreaterThan(reads);
  expect(launch.getLaunchStartPayloads()).toHaveLength(0);
  await expect(page.locator(".vibe64-launch-controls__preview-frame")).toHaveCount(0);
});

test("@preview-identity switches between real app identities and Guest without restarting", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    previewIdentity: previewIdentityCapability(),
    previewIdentityExchange: (selection) => ({
      identity: selection.mode === "guest"
        ? null
        : {
            email: selection.selector?.type === "email" ? selection.selector.value : "",
            login: selection.selector?.type === "login" ? selection.selector.value : "",
            selector: selection.selector,
            userId: selection.name === "admin" ? "app-user-admin" : "app-user-custom",
            username: selection.name === "admin" ? "Ada App" : "Merc App"
          },
      ok: true
    }),
    previewIdentityExchangeDelayMs: 500
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const identityButton = page.getByRole("button", {
    name: /Previewing as|Switching preview identity/u
  });
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toContainText(
    "Opening preview as"
  );
  await expect(identityButton).toHaveAttribute(
    "aria-label",
    "Previewing as admin — ada@example.com"
  );
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toHaveCount(0);

  await identityButton.click();
  await page.locator(".vibe64-launch-controls__identity-menu")
    .getByText("Guest", { exact: true })
    .click();
  await expect(identityButton).toHaveAttribute("aria-label", "Previewing as Guest");

  await identityButton.click();
  await page.locator(".vibe64-launch-controls__identity-menu")
    .getByText("worker", { exact: true })
    .click();
  await expect(identityButton).toHaveAttribute(
    "aria-label",
    "Previewing as worker — merc"
  );

  await page.reload();
  await expect(identityButton).toHaveAttribute(
    "aria-label",
    "Previewing as admin — ada@example.com"
  );
  await identityButton.click();
  const identityMenu = page.locator(".vibe64-launch-controls__identity-menu");
  await expect(identityMenu.getByText("Login name: merc", { exact: true })).toBeVisible();
  await identityMenu.getByText("worker", { exact: true }).click();
  await expect(identityButton).toHaveAttribute(
    "aria-label",
    "Previewing as worker — merc"
  );

  expect(launchSession.getPreviewIdentitySelections()).toEqual([
    {
      displayName: "admin",
      mode: "identity",
      name: "admin",
      selector: {
        type: "email",
        value: "ada@example.com"
      }
    },
    {
      mode: "guest"
    },
    {
      displayName: "worker",
      mode: "identity",
      name: "worker",
      selector: {
        type: "login",
        value: "merc"
      }
    },
    {
      displayName: "admin",
      mode: "identity",
      name: "admin",
      selector: {
        type: "email",
        value: "ada@example.com"
      }
    },
    {
      displayName: "worker",
      mode: "identity",
      name: "worker",
      selector: {
        type: "login",
        value: "merc"
      }
    }
  ]);
  expect(launchSession.getLaunchStartPayloads()).toHaveLength(0);
});

for (const width of [390, 1440]) {
  test(`@preview-identity exposes exact app errors and remains recoverable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({
      height: 844,
      width
    });
    await mockLaunchTerminalSocket(page);
    const recoveryRequests: TemporaryAiRecoveryRequests = {
      mainMessages: [],
      temporaryStarts: [],
      temporaryTurns: []
    };
    const launchSession = await mockLaunchSession(page, {
      assistantAccess: PERSONAL_ASSISTANT_ACCESS,
      previewIdentity: previewIdentityCapability(),
      previewIdentityExchange: (selection) => {
        if (selection.selector?.value === "missing@example.com") {
          return {
            code: "auth_user_not_found",
            error: "User not found.",
            ok: false,
            signedOut: true,
            status: 404
          };
        }
        return {
          identity: {
            email: selection.selector?.type === "email" ? selection.selector.value : "",
            selector: selection.selector,
            userId: "app-user-admin",
            username: "Ada App"
          },
          ok: true
        };
      },
      temporaryAiRecoveryRequests: recoveryRequests
    });

    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
    const chatToggle = width === 390 ? "Show project" : "Collapse chat";
    await page.getByRole("button", { name: chatToggle, exact: true }).click();
    const chat = page.getByRole("region", { name: "Session chat", exact: true });
    const project = page.getByRole("region", { name: "Project", exact: true });
    await expect(chat).toBeHidden();
    await expect(project).toBeVisible();
    if (width === 390) {
      await page.getByRole("button", { name: "Show preview controls" }).click();
    }

    const identityButton = page.getByRole("button", {
      name: "Previewing as admin — ada@example.com"
    });
    await expect(identityButton).toBeVisible();
    await identityButton.click();
    await page.locator(".vibe64-launch-controls__identity-menu")
      .getByText("missing", { exact: true })
      .click();

    await expect(page.getByText("User not found.", { exact: true })).toBeVisible();
    const failedIdentityButton = page.getByRole("button", {
      name: "Preview identity failed: User not found."
    });
    await expect(failedIdentityButton).toBeVisible();
    await failedIdentityButton.click();

    await page.locator(".vibe64-launch-controls__identity-menu")
      .getByRole("button", {
        name: "Fix it with AI",
        exact: true
      })
      .click();

    const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
    await expect(chat).toBeVisible();
    if (width === 390) {
      await expect(project).toBeHidden();
      await expect.poll(async () => Math.round((await chat.boundingBox())?.width || 0)).toBe(width);
    } else {
      await expect(project).toBeVisible();
    }
    await expect(workspace).toBeVisible();
    await expect(workspace.getByRole("button", {
      name: "Fix preview identity",
      exact: true
    })).toBeVisible();
    await expect(workspace.getByRole("button", {
      name: "Read/write: temporary AI may edit this session",
      exact: true
    })).toBeVisible();

    const expectedRecoveryPrompt = [
      "The managed preview could not sign in as `missing` (email: `missing@example.com`):",
      "User not found.",
      "Please diagnose and fix this in the current application. Ensure its app-owned, idempotent development seed creates this user profile and any workspace membership the app requires in every fresh database, then run the normal database preparation command and verify the identity exchange. Keep preview authentication material host-managed; do not add, reveal, or hardcode Vibe64 secrets."
    ].join("\n\n");
    await expect.poll(() => recoveryRequests.temporaryStarts).toHaveLength(1);
    expect(recoveryRequests.temporaryStarts[0]).toEqual(expect.objectContaining({
      policy: "workspace_write"
    }));
    await expect.poll(() => recoveryRequests.temporaryTurns).toHaveLength(1);
    expect(recoveryRequests.temporaryTurns[0]).toEqual(expect.objectContaining({
      message: expectedRecoveryPrompt,
      policy: "workspace_write",
      promptLabel: "Fix preview identity"
    }));
    await expect(workspace.getByText("Temporary identity recovery complete.", {
      exact: true
    })).toBeVisible();
    expect(recoveryRequests.temporaryStarts).toHaveLength(1);
    expect(recoveryRequests.temporaryTurns).toHaveLength(1);
    expect(recoveryRequests.mainMessages).toHaveLength(0);
    await expect(page).toHaveURL(`${BASE_URL}${DEVELOPMENT_PATH}`);
    await page.screenshot({
      path: testInfo.outputPath(`preview-identity-recovery-${width}.png`),
      animations: "disabled"
    });

    await page.getByRole("button", { name: chatToggle, exact: true }).click();
    await page.getByRole("button", {
      name: "Preview identity failed: User not found."
    }).click();
    await page.locator(".vibe64-launch-controls__identity-menu")
      .getByText("admin", { exact: true })
      .click();
    await expect(page.getByRole("button", {
      name: "Previewing as admin — ada@example.com"
    })).toBeVisible();

    expect(launchSession.getLaunchStartPayloads()).toHaveLength(0);
  });
}

test("@preview-lifecycle attaches multiple visible preview frames and stops each shared tab stream", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __vibe64PreviewCaptureCalls?: number }).__vibe64PreviewCaptureCalls = 0;
    (window as typeof window & { __vibe64PreviewCaptureTracks?: MediaStreamTrack[] }).__vibe64PreviewCaptureTracks = [];
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        (window as typeof window & { __vibe64PreviewCaptureCalls?: number }).__vibe64PreviewCaptureCalls =
          Number((window as typeof window & { __vibe64PreviewCaptureCalls?: number }).__vibe64PreviewCaptureCalls || 0) + 1;
        const canvas = document.createElement("canvas");
        canvas.height = window.innerHeight;
        canvas.width = window.innerWidth;
        const context = canvas.getContext("2d");
        const captureStream = canvas.captureStream(30);
        const track = captureStream.getVideoTracks()[0];
        (window as typeof window & { __vibe64PreviewCaptureTracks?: MediaStreamTrack[] })
          .__vibe64PreviewCaptureTracks?.push(track);
        let frame = 0;
        const paintFrame = () => {
          if (track.readyState === "ended") {
            return;
          }
          if (context) {
            context.fillStyle = frame % 2 === 0 ? "#102030" : "#102031";
            context.fillRect(0, 0, canvas.width, canvas.height);
          }
          frame += 1;
          window.requestAnimationFrame(paintFrame);
        };
        paintFrame();
        return captureStream;
      }
    });
  });
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    attachmentUploadResponseDelayMs: 800,
    previewResponseDelayMs: 800
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`, {
    waitUntil: "domcontentloaded"
  });

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  const composerActions = page.locator(".studio-autopilot__composer-actions");
  const captureButton = composerActions.getByRole("button", {
    name: "Attach visible preview"
  });
  await expect(
    page.locator(".vibe64-launch-controls__toolbar").getByRole("button", {
      name: "Attach visible preview"
    })
  ).toHaveCount(0);
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toBeVisible();
  await expect(captureButton).toHaveCount(0);
  await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app"))
    .toBeVisible();
  await expect(captureButton).toBeVisible();

  await captureButton.click();
  await expect(page.locator(".vibe64-attachment-queue__item")).toHaveCount(1);
  await expect(page.getByRole("progressbar", {
    name: /Upload progress for vibe64-preview-/u
  })).toHaveCount(1);
  await captureButton.click();
  await expect(page.locator(".vibe64-attachment-queue__item")).toHaveCount(2);
  await expect(page.locator(".vibe64-attachment-queue__item--ready")).toHaveCount(2);
  expect(launchSession.getAttachmentUploads()).toHaveLength(2);
  expect(launchSession.getAttachmentUploads().every((upload) => (
    upload.contentType === "image/png" &&
    /^vibe64-preview-.*\.png$/u.test(upload.fileName) &&
    upload.bytes.length > 0
  ))).toBe(true);
  expect(await page.evaluate(() => ({
    calls: Number((window as typeof window & { __vibe64PreviewCaptureCalls?: number }).__vibe64PreviewCaptureCalls || 0),
    trackStates: ((window as typeof window & { __vibe64PreviewCaptureTracks?: MediaStreamTrack[] })
      .__vibe64PreviewCaptureTracks || []).map((track) => track.readyState)
  }))).toEqual({
    calls: 2,
    trackStates: ["ended", "ended"]
  });

  await previewFrame.evaluate((frame) => {
    frame.style.transform = "translateX(-200vw)";
  });
  await expect(captureButton).toHaveCount(0);
  await previewFrame.evaluate((frame) => {
    frame.style.transform = "";
  });
  await expect(captureButton).toBeVisible();

  await page.getByRole("tab", {
    name: "Dashboard"
  }).click();
  await expect(captureButton).toHaveCount(0);
  await page.getByRole("tab", {
    name: "Preview"
  }).click();
  await expect(captureButton).toBeVisible();
});

test("@preview-lifecycle attaches isolated proxied-app console and network diagnostics", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    attachmentUploadResponseDelayMs: 800
  });
  await page.route("http://127.0.0.1:49000/api/diagnostics", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        message: "validation failed"
      }),
      contentType: "application/json",
      headers: {
        "x-preview-diagnostic": "captured"
      },
      status: 422
    });
  });
  await page.route("http://127.0.0.1:49000/assets/routine-resource.svg*", async (route) => {
    await route.fulfill({
      body: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"/>",
      contentType: "image/svg+xml",
      status: 200
    });
  });
  await page.route("http://127.0.0.1:49000/assets/missing-resource.svg", async (route) => {
    await route.fulfill({
      body: "not found",
      contentType: "text/plain",
      status: 404
    });
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app"))
    .toBeVisible();
  await page.evaluate(() => {
    console.error("studio-console-must-not-be-attached");
  });
  await page.frameLocator(".vibe64-launch-controls__preview-frame").locator("body").evaluate(async () => {
    console.log("proxied-console-log", {
      answer: 42
    });
    console.error("proxied-console-error");
    const response = await fetch("/api/diagnostics", {
      body: JSON.stringify({
        accountId: 7
      }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });
    await response.text();
    const loadImage = (src: string) => new Promise<void>((resolve) => {
      const image = document.createElement("img");
      image.addEventListener("error", () => {
        image.remove();
        resolve();
      }, { once: true });
      image.addEventListener("load", () => {
        image.remove();
        resolve();
      }, { once: true });
      image.src = src;
      document.body.append(image);
    });
    await Promise.all(Array.from({ length: 275 }, (_, index) => (
      loadImage(`/assets/routine-resource.svg?index=${index}`)
    )));
    await loadImage("/assets/missing-resource.svg");
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  });

  const attachDiagnostics = page.locator(".studio-autopilot__composer-actions")
    .getByRole("button", {
      name: "Attach console & network"
    });
  await expect(attachDiagnostics).toBeVisible();
  await attachDiagnostics.click();
  await expect(page.locator(".vibe64-attachment-queue__item")).toHaveCount(1);
  const diagnosticsRow = page.locator(".vibe64-attachment-queue__item", {
    hasText: "vibe64-preview-diagnostics-"
  });
  await expect(diagnosticsRow).toContainText("Uploading");
  await expect(diagnosticsRow.getByRole("progressbar", {
    name: /Upload progress for vibe64-preview-diagnostics-/u
  })).toBeVisible();
  await expect(page.locator(".vibe64-attachment-queue__item--ready")).toHaveCount(1);
  await expect.poll(() => launchSession.getAttachmentUploads().length).toBe(1);

  const [upload] = launchSession.getAttachmentUploads();
  const diagnostics = upload.bytes.toString("utf8");
  expect(upload.contentType).toBe("text/plain");
  expect(upload.fileName).toMatch(/^vibe64-preview-diagnostics-.*\.log$/u);
  expect(diagnostics).toContain("## Console");
  expect(diagnostics).toContain("proxied-console-log {\"answer\":42}");
  expect(diagnostics).toContain("proxied-console-error");
  expect(diagnostics).toContain("## Network");
  expect(diagnostics).toContain("POST http://127.0.0.1:4103/api/diagnostics");
  expect(diagnostics).toContain("422");
  expect(diagnostics).toContain("{\"accountId\":7}");
  expect(diagnostics).toContain("{\"message\":\"validation failed\"}");
  expect(diagnostics).toContain("GET http://127.0.0.1:4103/assets/missing-resource.svg");
  expect(diagnostics).toContain("Resource failed to load");
  expect(diagnostics).not.toContain("routine-resource.svg");
  const suppressedResourceCount = diagnostics.match(/Routine passive resource entries omitted: (\d+)/u);
  expect(Number(suppressedResourceCount?.[1] || 0)).toBeGreaterThanOrEqual(275);
  expect(diagnostics).not.toContain("studio-console-must-not-be-attached");
  expect(diagnostics).not.toContain("VIBE64_SESSION_DEBUG");
  expect(diagnostics).not.toContain("vibe64_preview_token");
});

for (const viewportWidth of [390, 960, 1600]) {
  test(`@preview-lifecycle attachment queue exposes progress and retries one failed multipart upload at ${viewportWidth}px`, async ({ page }) => {
    await page.setViewportSize({
      height: viewportWidth === 390 ? 844 : 900,
      width: viewportWidth
    });
    await mockLaunchTerminalSocket(page);
    const launchSession = await mockLaunchSession(page, {
      attachmentUploadOutcomes: ["failure", "success"],
      attachmentUploadResponseDelayMs: 800
    });

    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

    const fileName = `retry-note-${viewportWidth}.txt`;
    const fileContents = `retry this multipart upload at ${viewportWidth}px`;
    await page.getByLabel("Message AI assistant").fill("Use the attached note.");
    const sendMessage = page.getByRole("button", {
      name: "Send message"
    });
    const attachFiles = page.getByRole("button", {
      name: "Attach files"
    });
    await expect(attachFiles).toBeEnabled();
    const fileChooserPromise = page.waitForEvent("filechooser");
    await attachFiles.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      buffer: Buffer.from(fileContents, "utf8"),
      mimeType: "text/plain",
      name: fileName
    });

    const queue = page.getByRole("region", {
      name: "Message attachments"
    });
    const row = queue.locator(".vibe64-attachment-queue__item", {
      hasText: fileName
    });
    await expect(row).toContainText("Uploading");
    await expect(row.getByRole("progressbar", {
      name: `Upload progress for ${fileName}`
    })).toBeVisible();
    await expect(row.getByRole("button", {
      name: `Cancel ${fileName}`
    })).toBeVisible();
    await expect(sendMessage).toBeDisabled();

    await expect(row).toContainText("Upload failed");
    await expect(queue).not.toHaveAttribute("aria-busy", "true");
    await expect(sendMessage).toBeDisabled();
    await row.getByRole("button", {
      name: `Retry ${fileName}`
    }).click();

    await expect(row).toContainText("Uploading");
    await expect(row).toContainText("Ready");
    await expect(sendMessage).toBeEnabled();
    await expect.poll(() => launchSession.getAttachmentUploads().length).toBe(2);
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth
    ))).toBe(true);
    const rowBounds = await row.boundingBox();
    expect(rowBounds).not.toBeNull();
    expect(Number(rowBounds?.x || 0)).toBeGreaterThanOrEqual(0);
    expect(Number(rowBounds?.x || 0) + Number(rowBounds?.width || 0)).toBeLessThanOrEqual(viewportWidth + 1);
    expect(launchSession.getAttachmentUploads().map((upload) => ({
      content: upload.bytes.toString("utf8"),
      contentType: upload.contentType,
      fileName: upload.fileName
    }))).toEqual([
      {
        content: fileContents,
        contentType: "text/plain",
        fileName
      },
      {
        content: fileContents,
        contentType: "text/plain",
        fileName
      }
    ]);
  });
}

test("@preview-lifecycle multipart upload exposes genuine nonzero monotonic browser progress", async ({ page }) => {
  await observeBrowserUploadProgress(page);
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    attachmentUploadResponseDelayMs: 1000
  });
  const fileName = "observed-browser-progress.bin";
  const fileContents = Buffer.alloc(512 * 1024, 0x61);
  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    buffer: fileContents,
    mimeType: "application/octet-stream",
    name: fileName
  });

  const row = page.locator(".vibe64-attachment-queue__item", {
    hasText: fileName
  });
  await expect(row).toContainText("Uploading");
  await expect(row.getByRole("progressbar", {
    name: `Upload progress for ${fileName}`
  })).toBeVisible();
  await expect(row).toContainText("Ready", { timeout: 15_000 });
  expectMonotonicNonzeroProgress(await browserUploadProgressSamples(page));
  expect(launchSession.getAttachmentUploads()).toHaveLength(1);
  expect(launchSession.getAttachmentUploads()[0].bytes.equals(fileContents)).toBe(true);
});

test("@preview-lifecycle reduced motion keeps unknown upload progress stationary", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const originalAddEventListener = XMLHttpRequestUpload.prototype.addEventListener;
    XMLHttpRequestUpload.prototype.addEventListener = function addEventListenerWithoutUploadProgress(
      type,
      listener,
      options
    ) {
      if (type === "progress") {
        return;
      }
      return originalAddEventListener.call(this, type, listener, options);
    };
  });
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    attachmentUploadResponseDelayMs: 1000
  });
  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const fileName = "reduced-motion-upload.bin";
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    buffer: Buffer.alloc(128 * 1024, 0x63),
    mimeType: "application/octet-stream",
    name: fileName
  });

  const row = page.locator(".vibe64-attachment-queue__item", {
    hasText: fileName
  });
  const progress = row.getByRole("progressbar", {
    name: `Upload progress for ${fileName}`
  });
  await expect(row).toContainText("Uploading");
  await expect(row).toContainText("0 B / 128.0 KB");
  await expect(progress).toHaveCount(0);
  await expect(row.locator(".vibe64-attachment-queue__progress--stationary")).toBeVisible();
  const activeHeight = Number((await row.boundingBox())?.height || 0);

  await expect(row).toContainText("Ready", { timeout: 12_000 });
  const readyHeight = Number((await row.boundingBox())?.height || 0);
  expect(Math.abs(activeHeight - readyHeight)).toBeLessThanOrEqual(6);
});

test("@preview-lifecycle Temporary AI keeps its shared upload queue across task switches on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    assistantAccess: PERSONAL_ASSISTANT_ACCESS,
    attachmentUploadResponseDelayMs: 1000
  });
  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await page.getByRole("button", { name: /^Session actions/u }).click();
  await page.locator("[data-vibe64-temporary-ai-action]:visible").click();

  const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
  const navigation = workspace.getByRole("navigation", {
    name: "Main and temporary conversations"
  });
  await workspace.getByLabel("Message temporary AI").fill("Inspect the attached file.");
  const send = workspace.getByRole("button", {
    name: "Send to temporary AI"
  });
  const fileName = "temporary-ai-progress.bin";
  const fileContents = Buffer.alloc(256 * 1024, 0x62);
  const chooserPromise = page.waitForEvent("filechooser");
  await workspace.getByRole("button", { name: "Attach files" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    buffer: fileContents,
    mimeType: "application/octet-stream",
    name: fileName
  });

  const queue = workspace.getByRole("region", { name: "Message attachments" });
  const row = queue.locator(".vibe64-attachment-queue__item", { hasText: fileName });
  await expect(row).toContainText("Uploading");
  await expect(send).toBeDisabled();

  await navigation.getByRole("button", {
    name: "New temporary AI task",
    exact: true
  }).click();
  await navigation.getByRole("button", { name: "Temporary 1", exact: true }).click();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Ready", { timeout: 12_000 });
  await expect(send).toBeEnabled();

  const rowBounds = await row.boundingBox();
  expect(rowBounds).not.toBeNull();
  expect(Number(rowBounds?.x || 0) + Number(rowBounds?.width || 0)).toBeLessThanOrEqual(391);
  await navigation.getByRole("button", { name: "Close Temporary 1", exact: true }).click();
  await expect.poll(() => launchSession.getAttachmentDeletes()).toEqual(["attachment-1"]);
});

test("@preview-lifecycle Codex interactive terminal keeps one attachment queue and retries handoff", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 960 });
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    agentTerminalControlOutcomes: ["failure", "success"],
    assistantAccess: PERSONAL_ASSISTANT_ACCESS,
    attachmentUploadOutcomes: ["success", "failure"],
    attachmentUploadResponseDelayMs: 800,
    session: sessionPayload({
      agentTerminal: {
        commandPreview: "codex",
        id: "server-agent-terminal",
        status: "running"
      }
    })
  });
  await page.goto(`${BASE_URL}${DASHBOARD_PATH}/ai-terminal`);

  const terminalRoot = page.locator(".vibe64-codex-session");
  const terminal = page.getByRole("region", { name: "Codex terminal" });
  const terminalHost = terminal.locator(".vibe64-terminal-surface__host");
  await expect(terminal).toBeVisible();
  await expect(terminalHost).toBeVisible();
  await expect(terminal.getByRole("button", { name: "Expand" })).toHaveCount(0);
  await expect(terminal.getByRole("button", { name: "Collapse" })).toHaveCount(0);

  const firstFileName = "terminal-handoff.bin";
  const firstFileContents = "terminal attachment handoff";
  const attachFiles = terminal.getByRole("button", {
    name: "Attach files to Codex terminal"
  });
  await attachFiles.focus();
  await expect(attachFiles).toBeFocused();
  const chooserPromise = page.waitForEvent("filechooser");
  await attachFiles.press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles({
    buffer: Buffer.from(firstFileContents, "utf8"),
    mimeType: "application/octet-stream",
    name: firstFileName
  });

  const queue = terminal.getByRole("region", { name: "Message attachments" });
  const row = queue.locator(".vibe64-attachment-queue__item", {
    hasText: firstFileName
  });
  await expect(row).toBeVisible();
  await expect(row.getByRole("progressbar", {
    name: `Upload progress for ${firstFileName}`
  })).toBeVisible();
  await expect(terminalHost).toBeVisible();
  await expect(attachFiles).toBeVisible();
  await expect(row).toBeVisible();

  await expect(row).toContainText("Sending failed");
  await expect(row).toContainText("The test terminal rejected the attachment path.");
  await row.getByRole("button", { name: `Retry ${firstFileName}` }).click();
  await expect(queue).toHaveCount(0);
  expect(launchSession.getAttachmentUploads()).toHaveLength(1);
  expect(launchSession.getAgentTerminalControlPayloads()).toEqual([
    {
      attachmentIds: ["attachment-1"],
      text: `[/tmp/vibe64-attachments/${firstFileName}] `
    },
    {
      attachmentIds: ["attachment-1"],
      text: `[/tmp/vibe64-attachments/${firstFileName}] `
    }
  ]);

  const secondFileName = "terminal-upload-failure.txt";
  await terminalRoot.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["pending drop"], "pending-drop.txt", {
      type: "text/plain"
    }));
    element.dispatchEvent(new DragEvent("dragenter", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
  });
  const dropOverlay = terminal.locator(".vibe64-codex-session__drop-overlay");
  await expect(dropOverlay).toBeVisible();
  await expect(dropOverlay).toContainText("Drop temporary files for Codex");
  await expect(dropOverlay.locator(".vibe64-codex-session__drop-card"))
    .toHaveClass(/elevation-4/u);
  await terminalRoot.evaluate((element, fileName) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["fail this upload"], fileName, {
      type: "text/plain"
    }));
    element.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
  }, secondFileName);
  const failedRow = terminal.getByRole("region", { name: "Message attachments" })
    .locator(".vibe64-attachment-queue__item", { hasText: secondFileName });
  await expect(terminalHost).toBeVisible();
  await expect(failedRow).toContainText("Upload failed");
  await failedRow.getByRole("button", { name: `Remove ${secondFileName}` }).click();
  await expect(terminal.getByRole("region", { name: "Message attachments" })).toHaveCount(0);
  await expect(attachFiles).toBeVisible();
});

for (const viewportWidth of [390, 1600]) {
  test(`@preview-lifecycle Codex terminal picker stays accessible at ${viewportWidth}px`, async ({ page }) => {
    await page.setViewportSize({
      height: viewportWidth === 390 ? 844 : 900,
      width: viewportWidth
    });
    await mockLaunchTerminalSocket(page);
    const launchSession = await mockLaunchSession(page, {
      assistantAccess: PERSONAL_ASSISTANT_ACCESS,
      attachmentUploadResponseDelayMs: 800,
      session: sessionPayload({
        agentTerminal: {
          commandPreview: "codex",
          id: "server-agent-terminal",
          status: "running"
        }
      })
    });
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/ai-terminal`);

    const terminal = page.getByRole(viewportWidth === 390 ? "dialog" : "region", {
      name: "Codex terminal"
    });
    const attachFiles = terminal.getByRole("button", {
      name: "Attach files to Codex terminal"
    });
    const fileName = `terminal-picker-${viewportWidth}.txt`;
    await expect(attachFiles).toBeVisible();
    await attachFiles.focus();
    await expect(attachFiles).toBeFocused();
    const chooserPromise = page.waitForEvent("filechooser");
    await attachFiles.press("Enter");
    const chooser = await chooserPromise;
    await chooser.setFiles({
      buffer: Buffer.from(`terminal picker ${viewportWidth}`, "utf8"),
      mimeType: "text/plain",
      name: fileName
    });

    const row = terminal.locator(".vibe64-attachment-queue__item", {
      hasText: fileName
    });
    await expect(row).toBeVisible();
    const attachBounds = await attachFiles.boundingBox();
    expect(attachBounds).not.toBeNull();
    expect(Number(attachBounds?.height || 0)).toBeGreaterThanOrEqual(40);
    await expect(terminal.locator(".vibe64-terminal-surface__host")).toBeVisible();
    await expect(terminal.getByRole("button", { name: "Expand" })).toHaveCount(0);
    await expect(terminal.getByRole("button", { name: "Collapse" })).toHaveCount(0);
    await expect(attachFiles).toBeVisible();
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth
    ))).toBe(true);
    await expect.poll(() => launchSession.getAttachmentUploads().length).toBe(1);
    await expect(terminal.getByRole("region", { name: "Message attachments" })).toHaveCount(0);
  });
}

test("@preview-lifecycle Codex terminal picker keeps a 48px coarse touch target", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { height: 844, width: 390 }
  });
  const page = await context.newPage();
  try {
    await mockLaunchTerminalSocket(page);
    await mockLaunchSession(page, {
      assistantAccess: PERSONAL_ASSISTANT_ACCESS,
      session: sessionPayload({
        agentTerminal: {
          commandPreview: "codex",
          id: "server-agent-terminal",
          status: "running"
        }
      })
    });
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/ai-terminal`);

    expect(await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(true);
    const attachFiles = page.getByRole("dialog", { name: "Codex terminal" })
      .getByRole("button", { name: "Attach files to Codex terminal" });
    await expect(attachFiles).toBeVisible();
    const bounds = await attachFiles.boundingBox();
    expect(Number(bounds?.height || 0)).toBeGreaterThanOrEqual(48);
    expect(Number(bounds?.width || 0)).toBeGreaterThanOrEqual(48);
  } finally {
    await context.close();
  }
});

test("@preview-lifecycle interactive terminal is selected only by the session's immutable AI", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1600 });
  await mockLaunchTerminalSocket(page);
  const baseSession = sessionPayload({
    agentTerminal: {
      commandPreview: "opencode attach",
      id: "server-agent-terminal",
      status: "running"
    }
  });
  await mockLaunchSession(page, {
    assistantAccess: PERSONAL_ASSISTANT_ACCESS,
    assistantCatalog: assistantCatalogPayload({ includeOpenCode: true }),
    session: {
      ...baseSession,
      agentSession: {
        ...baseSession.agentSession,
        providerId: "opencode",
        transportId: "opencode_server"
      },
      assistantSelection: {
        agentId: "build",
        catalogRevision: TEST_ASSISTANT_CATALOG_REVISION,
        engineId: "opencode",
        modelId: "glm-5.3",
        modelProviderId: "zai-coding-plan",
        variantId: "high"
      }
    }
  });

  await page.goto(`${BASE_URL}${DASHBOARD_PATH}/ai-terminal`);

  const openCodeTerminal = page.getByRole("region", { name: "OpenCode terminal" });
  await expect(openCodeTerminal).toBeVisible();
  await expect(openCodeTerminal.locator(".vibe64-terminal-surface__host")).toBeVisible();
  await expect(page.getByRole("region", { name: "Codex terminal" })).toHaveCount(0);
});

test("@preview-lifecycle temporary action output disappears only when completed while collapsed", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1600 });
  await mockLaunchTerminalSocket(page);
  const session = sessionPayload();
  session.workspaceSetup = {
    currentLabel: "Installing dependencies",
    status: "running",
    transcript: "Preparing packages\nInstalling dependencies"
  };
  await mockLaunchSession(page, { session });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const activity = page.locator(".studio-autopilot__activity");
  const summary = activity.locator(".vibe64-temporary-action-terminal__summary");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("Installing dependencies");
  expect(Number((await summary.boundingBox())?.height || 0)).toBeLessThan(64);
  await expect(activity.locator(".vibe64-terminal-surface")).toHaveCount(0);

  await activity.getByRole("button", { name: /Show Preparing workspace/u }).click();
  const details = activity.locator(".vibe64-terminal-surface");
  await expect(details).toBeVisible();
  await expect(details).toContainText("Installing dependencies");

  session.workspaceSetup = {
    status: "succeeded",
    transcript: "Workspace preparation complete"
  };
  session.revision += 1;
  await page.getByRole("button", { name: "Reload chat" }).click();
  await expect(details).toBeVisible();
  await expect(details).toContainText("Workspace preparation complete");

  await details.getByRole("button", { name: "Hide" }).click();
  await expect(details).toHaveCount(0);
  await expect(summary).toHaveCount(0);

  session.workspaceSetup = {
    currentLabel: "Checking packages",
    status: "running",
    transcript: "Checking packages"
  };
  session.revision += 1;
  await page.getByRole("button", { name: "Reload chat" }).click();
  await expect(summary).toBeVisible();

  session.workspaceSetup = {
    status: "succeeded",
    transcript: "Workspace prepared"
  };
  session.revision += 1;
  await page.getByRole("button", { name: "Reload chat" }).click();
  await expect(summary).toHaveCount(0);
  await expect(details).toHaveCount(0);
});

test("@preview-lifecycle address bar navigates within the preview and goes back", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  const address = page.getByLabel("Preview URL");
  await expect(previewFrame).toBeVisible();
  await expect(address).toHaveValue("/home");

  await address.fill("/jobs/42?tab=docs#files");
  await address.press("Enter");

  await expect(previewFrame).toHaveAttribute("src", /http:\/\/127\.0\.0\.1:49000\/jobs\/42\?tab=docs#files/u);
  await expect(address).toHaveValue("/jobs/42?tab=docs#files");

  await page.getByRole("button", {
    name: "Go back in preview"
  }).click();

  await expect(address).toHaveValue("/home");
});

test("@preview-lifecycle back button follows locations reported by the iframe", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  const address = page.getByLabel("Preview URL");
  await expect(previewFrame).toBeVisible();
  await expect(address).toHaveValue("/home");

  const frameHandle = await previewFrame.elementHandle();
  const frame = await frameHandle?.contentFrame();
  expect(frame).not.toBeNull();

  await frame?.evaluate(() => {
    window.history.pushState({}, "", "/jobs/42?tab=docs#files");
  });
  await expect(address).toHaveValue("/jobs/42?tab=docs#files");

  await page.getByRole("button", {
    name: "Go back in preview"
  }).click();

  await expect(address).toHaveValue("/home");
});

test("embedded preview toolbar follows mobile project-pane visibility", async ({ page }) => {
  await page.setViewportSize({
    height: 800,
    width: 390
  });
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await expect(page.locator(".studio-home-shell-heading")).toBeVisible();

  await expect(page.locator(".studio-home-shell-preview-toolbar-host")).toHaveCount(0);

  await page.locator(".studio-home-shell-chat-toggle").click();

  const toolbar = page.locator(".studio-home-shell-preview-toolbar-host .vibe64-launch-controls__toolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveClass(/vibe64-launch-controls__toolbar--mobile-collapsed/u);

  await toolbar.locator(".vibe64-launch-controls__mobile-expand").click();

  await expect(toolbar).toHaveClass(/vibe64-launch-controls__toolbar--mobile-expanded/u);
  await expect(page.getByLabel("Preview URL")).toBeVisible();

  const appBarBox = await page.getByTestId("jskit-shell-app-bar").boundingBox();
  const toolbarBox = await toolbar.boundingBox();
  const collapseBox = await toolbar.locator(".vibe64-launch-controls__mobile-collapse-button").boundingBox();
  const addressBox = await page.getByLabel("Preview URL").boundingBox();
  const actionsBox = await toolbar.locator(".vibe64-launch-controls__secondary-actions").boundingBox();
  expect(appBarBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  expect(collapseBox).not.toBeNull();
  expect(addressBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(toolbarBox?.y).toBeGreaterThanOrEqual((appBarBox?.y || 0) + (appBarBox?.height || 0) - 1);
  expect(collapseBox?.x).toBeLessThan(addressBox?.x || 0);
  expect(Math.abs(
    ((collapseBox?.y || 0) + (collapseBox?.height || 0) / 2) -
    ((addressBox?.y || 0) + (addressBox?.height || 0) / 2)
  )).toBeLessThan(3);
  expect(actionsBox?.y).toBeGreaterThan((addressBox?.y || 0) + (addressBox?.height || 0) - 2);
});

test("@preview-lifecycle loads launch targets from pathless session summaries", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    session: sessionPayload(),
    sessionList: [sessionPayload({
      includeWorktreePaths: false
    })]
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  await expect(previewFrame).toBeVisible();
  await expect(previewFrame).toHaveAttribute("src", /http:\/\/127\.0\.0\.1:49000\/home/u);
  await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")).toBeVisible();
});

for (const width of [1440, 390]) {
  for (const readinessFirst of [false, true]) {
    test(`@preview-race readiness ${readinessFirst ? "before" : "after"} a rejected start at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await mockLaunchTerminalSocket(page);
      const session = { ...sessionPayload(), revision: 1 };
      const launch = await mockLaunchSession(page, {
        initialLaunchStatus: idleLaunchStatusPayload(launchStatusPayload().outputTargets),
        session
      });
      let releaseStart = () => {};
      const heldStart = new Promise<void>((resolve) => { releaseStart = resolve; });
      let startRequested = false;
      await page.route("**/output-runs", async (route) => {
        startRequested = true;
        await heldStart;
        await fulfillJson(route, {
          code: "vibe64_agent_write_mode_busy",
          error: "Another assistant operation is starting. Try again in a moment.",
          ok: false,
          retryable: true
        }, { status: 409 });
      });
      const rejectedStart = page.waitForResponse((response) => response.url().endsWith("/output-runs") && response.status() === 409);
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      if (width < 600) {
        await page.getByRole("button", { name: "Show project" }).click();
      }
      await expect.poll(() => startRequested).toBe(true);
      const failure = page.locator("strong").filter({ hasText: "Preview could not be started" });
      if (!readinessFirst) {
        releaseStart();
        await expect(page.getByText("Waiting for the assistant operation to finish. Preview will retry automatically.")).toBeVisible();
        await expect(failure).toHaveCount(0);
        await expect(page.getByText("Another assistant operation is starting. Try again in a moment.", { exact: true })).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath("start-rejected.png") });
      }
      await launch.publishLaunchReady();
      await expect(page.locator(".vibe64-launch-controls__preview-frame")).toBeVisible();
      releaseStart();
      await rejectedStart;
      await expect(failure).toHaveCount(0);
      await expect(page.getByText("Another assistant operation is starting. Try again in a moment.", { exact: true })).toHaveCount(0);
      await expect(page.locator(".vibe64-launch-controls__status-dot--running:visible")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("preview-recovered.png") });
    });
  }
}

for (const width of [1440, 390]) {
  test(`@preview-contention repeated busy starts recover automatically at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => {
      (window as typeof window & { busyErrorShown?: boolean }).busyErrorShown = false;
      new MutationObserver(() => {
        if (document.body?.textContent?.includes("Another assistant operation is starting. Try again in a moment.")) {
          (window as typeof window & { busyErrorShown?: boolean }).busyErrorShown = true;
        }
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    await mockLaunchTerminalSocket(page);
    await mockLaunchSession(page, {
      initialLaunchStatus: idleLaunchStatusPayload(launchStatusPayload().outputTargets)
    });
    let starts = 0;
    const startTimes: number[] = [];
    await page.route("**/output-runs", async (route) => {
      startTimes.push(Date.now());
      if (++starts > 3) {
        await route.fallback();
        return;
      }
      await fulfillJson(route, {
        code: "vibe64_agent_write_mode_busy",
        error: "Another assistant operation is starting. Try again in a moment.",
        ok: false,
        retryable: true
      }, { status: 409 });
    });
    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
    if (width < 600) {
      await page.getByRole("button", { name: "Show project" }).click();
    }
    await expect(page.getByText("Waiting for the assistant operation to finish. Preview will retry automatically.")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("waiting.png") });
    await expect(page.locator(".vibe64-launch-controls__preview-frame")).toBeVisible({ timeout: 35_000 });
    await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")).toBeVisible();
    await expect(page.locator("strong").filter({ hasText: "Preview could not be started" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as typeof window & { busyErrorShown?: boolean }).busyErrorShown)).toBe(false);
    await expect(page.getByText("Waiting for the assistant operation to finish. Preview will retry automatically.")).toHaveCount(0);
    expect(starts).toBe(4);
    for (let index = 1; index < startTimes.length; index += 1) {
      expect(startTimes[index] - startTimes[index - 1]).toBeGreaterThanOrEqual(6500);
    }
    await page.screenshot({ path: testInfo.outputPath("repeated-retry-recovered.png") });
  });
}

test("@preview-contention a genuine startup failure appears once and waits for an explicit retry", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    initialLaunchStatus: idleLaunchStatusPayload(launchStatusPayload().outputTargets)
  });
  let starts = 0;
  const message = "The configured preview command could not be started.";
  await page.route("**/output-runs", async (route) => {
    if (++starts > 1) return route.fallback();
    await fulfillJson(route, { code: "vibe64_output_start_failed", error: message, ok: false }, { status: 500 });
  });
  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await page.waitForTimeout(8500);
  expect(starts).toBe(1);
  await page.getByRole("button", { name: "Restart preview", exact: true }).click();
  await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")).toBeVisible();
  await expect(page.getByText(message, { exact: true })).toHaveCount(0);
  expect(starts).toBe(2);
});

test("@preview-contention reload preserves the retry cooldown and recovers", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    initialLaunchStatus: idleLaunchStatusPayload(launchStatusPayload().outputTargets)
  });
  const startTimes: number[] = [];
  await page.route("**/output-runs", async (route) => {
    startTimes.push(Date.now());
    if (startTimes.length > 1) return route.fallback();
    await fulfillJson(route, {
      code: "vibe64_agent_write_mode_busy", error: "Another assistant operation is starting. Try again in a moment.",
      ok: false, retryable: true
    }, { status: 409 });
  });
  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await expect(page.getByText("Waiting for the assistant operation to finish. Preview will retry automatically.")).toBeVisible();
  await page.reload();
  await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")).toBeVisible({ timeout: 15_000 });
  expect(startTimes).toHaveLength(2);
  expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(6500);
});

for (const cancelHint of [false, true]) {
  test(`@preview-race preview stays usable while hints ${cancelHint ? "are cancelled by sending" : "finish"}`, async ({ page }, testInfo) => {
    await mockLaunchTerminalSocket(page);
    const requests: TemporaryAiRecoveryRequests = { mainMessages: [], temporaryStarts: [], temporaryTurns: [] };
    await mockLaunchSession(page, {
      assistantAccess: PERSONAL_ASSISTANT_ACCESS,
      conversationLog: [{
        assistant: { at: "2026-09-07T00:00:00Z", role: "assistant", text: "The application is ready to preview." },
        turnId: "completed-preview-work"
      }],
      initialLaunchStatus: idleLaunchStatusPayload(launchStatusPayload().outputTargets),
      launchTerminalDelayMs: 1500,
      temporaryAiRecoveryRequests: requests
    });
    await page.route("**/vibe64/settings", (route) => fulfillJson(route, {
      ok: true,
      promptHints: { canEdit: true, enabled: true }
    }));
    const hintGate = Promise.withResolvers<void>();
    let hintStarted = false;
    let hintCancelled = false;
    await page.route("**/prompt-hints", async (route) => {
      hintStarted = true;
      await hintGate.promise;
      await fulfillJson(route, {
        ok: true,
        status: "ready",
        suggestions: ["Review the booking flow", "Check the appointment screen", "Improve the grooming form"]
          .map((prompt, index) => ({
            label: ["Review bookings", "Check appointments", "Improve grooming"][index],
            prompt
          }))
      });
    });
    await page.route("**/prompt-hints/cancel", (route) => {
      hintCancelled = true;
      return fulfillJson(route, { ok: true });
    });
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      await expect.poll(() => hintStarted).toBe(true);
      await expect(page.getByText("Thinking of a few ideas", { exact: true })).toBeVisible();
      const preview = page.locator(".vibe64-launch-controls__preview-frame");
      await expect(preview).toBeVisible();
      const previewSrc = await preview.getAttribute("src");
      await expect(page.locator(".vibe64-launch-controls__status-dot--running:visible")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("preview-with-pending-hints.png") });
      if (cancelHint) {
        await page.getByLabel("Message AI assistant").fill("Check the booking form");
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await expect.poll(() => requests.mainMessages.length).toBe(1);
        await expect.poll(() => hintCancelled).toBe(true);
      }
      hintGate.resolve();
      await expect(page.getByText("Thinking of a few ideas", { exact: true })).toHaveCount(0);
      if (!cancelHint) {
        await expect(page.getByRole("button", { name: "Use suggestion: Review the booking flow" })).toBeVisible();
      }
      await expect(preview).toBeVisible();
      await expect(preview).toHaveAttribute("src", previewSrc!);
      await expect(page.locator(".vibe64-launch-controls__preview-diagnostic")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("preview-after-hints.png") });
    } finally {
      hintGate.resolve();
    }
  });
}

for (const stopped of [false, true]) {
  test(`@preview-active-restart keeps both restart controls usable with an active AI and ${stopped ? "stopped" : "running"} preview`, async ({ page }, testInfo) => {
    await mockLaunchTerminalSocket(page, { terminalSocketNeverSettles: true });
    const session = sessionPayload();
    session.agentSession.turn.active = true;
    const runningStatus = launchStatusPayload();
    const launchSession = await mockLaunchSession(page, {
      session,
      initialLaunchStatus: stopped ? {
        ...idleLaunchStatusPayload(runningStatus.outputTargets),
        activeTerminal: {
          ...runningStatus.activeTerminal as Record<string, unknown>,
          exitCode: 0,
          running: false,
          status: "exited"
        }
      } : runningStatus
    });
    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
    await expect.poll(() => launchSession.getLaunchStatusRequestCount()).toBeGreaterThan(0);
    expect(launchSession.getLaunchStartPayloads()).toHaveLength(0);

    if (stopped) {
      await page.getByRole("button", { name: "Restart preview", exact: true }).click();
      await expect.poll(() => launchSession.getLaunchStartPayloads()).toHaveLength(1);
    }
    await expect(page.locator(".vibe64-launch-controls__preview-frame")).toBeVisible();

    const startsBeforeToolbar = launchSession.getLaunchStartPayloads().length;
    await page.locator('button[title="Restart preview"]:visible').click();
    await expect.poll(() => launchSession.getLaunchStartPayloads()).toHaveLength(startsBeforeToolbar + 1);
    await page.getByRole("button", { name: "Show run output", exact: true }).click();
    await page.locator(".vibe64-launch-controls__terminal--embedded")
      .getByRole("button", { name: "Restart preview", exact: true }).click();
    await expect.poll(() => launchSession.getLaunchStartPayloads()).toHaveLength(startsBeforeToolbar + 2);
    for (const payload of launchSession.getLaunchStartPayloads()) {
      expect(payload).toMatchObject({ forceRestart: true, outputTargetId: "dev" });
    }

    await page.locator(".vibe64-launch-controls__terminal--embedded")
      .getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
    await page.getByRole("tab", { name: "Preview", exact: true }).click();
    await expect(page.locator(".vibe64-launch-controls__preview-frame")).toBeVisible();
    await page.reload();
    await expect(page.locator(".vibe64-launch-controls__preview-frame")).toBeVisible();
    expect(launchSession.getLaunchStartPayloads()).toHaveLength(startsBeforeToolbar + 2);
    for (const width of [390, 900, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 390) {
        await page.getByRole("button", { name: "Show project", exact: true }).click();
      }
      await expect(page.locator(".vibe64-launch-controls__preview-frame")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`active-ai-preview-reloaded-${width}.png`) });
    }
  });
}

test("@preview-lifecycle auto-starts without exposing passive actions", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    initialLaunchStatus: idleLaunchStatusPayload([
      {
        available: true,
        default: false,
        downloads: [],
        id: "built",
        label: "Run built app",
        mode: "interactive",
        presentation: { kind: "web" }
      },
      {
        available: true,
        default: true,
        downloads: [],
        id: "dev",
        label: "Run app",
        mode: "interactive",
        presentation: { kind: "web" }
      }
    ]),
    launchTerminalDelayMs: 1000
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const waitingState = page.locator(".vibe64-launch-controls__preview-empty");
  await expect(waitingState).toBeVisible();
  await expect(waitingState.getByRole("button")).toHaveCount(0);
  await expect.poll(() => launchSession.getLaunchStartPayloads()).toEqual([
    {
      outputTargetId: "dev",
      originId: expect.stringMatching(/^tab:/u)
    }
  ]);
  await expect(page.locator(".vibe64-launch-controls__run-button")).toHaveCount(0);
  await expect(page.getByText("Run built app")).toHaveCount(0);
});

test("@preview-lifecycle automatically recovers when the first status has no targets", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    launchStatusSequence: [
      idleLaunchStatusPayload(),
      idleLaunchStatusPayload([
        {
          available: true,
          default: true,
          downloads: [],
          id: "dev",
          label: "Run app",
          mode: "interactive",
          presentation: { kind: "web" }
        }
      ])
    ]
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(page.getByText("Preview will appear here when it is ready.")).toBeVisible();
  await expect(page.locator(".vibe64-launch-controls__preview-empty").getByRole("button")).toHaveCount(0);

  await expect.poll(() => launchSession.getLaunchStartPayloads()).toEqual([
    {
      outputTargetId: "dev",
      originId: expect.stringMatching(/^tab:/u)
    }
  ]);
});

test("@preview-lifecycle refreshes disabled targets after the selected session advances", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const session = {
    ...sessionPayload(),
    revision: 1
  };
  const launchSession = await mockLaunchSession(page, {
    launchStatusSequence: previewAvailabilitySequence(),
    session
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(page.getByText("Install dependencies before running the app.")).toBeVisible();
  expect(launchSession.getLaunchStatusRequestCount()).toBe(1);

  session.workspaceSetup = {
    status: "succeeded"
  };
  session.revision = 2;
  await page.getByRole("button", {
    name: "Reload chat"
  }).click();

  await expect.poll(() => launchSession.getLaunchStatusRequestCount()).toBe(2);
  await expect.poll(() => launchSession.getLaunchStartPayloads()).toEqual([
    {
      outputTargetId: "dev",
      originId: expect.stringMatching(/^tab:/u)
    }
  ]);
});

test("@preview-lifecycle lets the user recheck a disabled target without a session signal", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    launchStatusSequence: previewAvailabilitySequence()
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(page.getByText("Install dependencies before running the app.")).toBeVisible();
  expect(launchSession.getLaunchStatusRequestCount()).toBe(1);

  await page.getByRole("button", {
    name: "Check again"
  }).click();

  await expect.poll(() => launchSession.getLaunchStatusRequestCount()).toBe(2);
  await expect.poll(() => launchSession.getLaunchStartPayloads()).toEqual([
    {
      outputTargetId: "dev",
      originId: expect.stringMatching(/^tab:/u)
    }
  ]);
});

test("@preview-lifecycle keeps the loading explanation visible until the iframe loads", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    previewResponseDelayMs: 1000
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const loadingOverlay = page.locator(".vibe64-launch-controls__preview-overlay");
  await expect(loadingOverlay).toContainText("Loading preview page");
  await expect(loadingOverlay).toContainText("The server is ready; the browser is still loading the app.");
  await expect(loadingOverlay.locator(".vibe64-launch-controls__preview-pulse")).toBeVisible();
  await expect(loadingOverlay.getByRole("button")).toHaveCount(0);
  await expect(
    page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")
  ).toBeVisible();
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toHaveCount(0);
});

test("@preview-lifecycle becomes usable from the bridge handshake while an app module is pending", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    previewModuleDelayMs: 5000
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(
    page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")
  ).toBeVisible();
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toHaveCount(0);
  expect(launchSession.getPreviewModuleCompleted()).toBe(false);
});

test("@preview-lifecycle reports a failed app module and retries the iframe once", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    previewModuleFailureCount: 1
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(page.locator(".v-snackbar", {
    hasText: "Preview could not load an application resource. Retrying automatically…"
  })).toBeVisible();
  await expect.poll(() => launchSession.getPreviewModuleRequestCount()).toBe(2);
  await expect.poll(() => launchSession.getPreviewModuleCompleted()).toBe(true);
  await expect.poll(() => launchSession.getPreviewLoadCount()).toBe(2);
  expect(consoleErrors.some((message) => (
    message.includes("[Vibe64 preview]") &&
    message.includes("Application resource failed to load")
  ))).toBe(true);
});

test("@preview-lifecycle bounds automatic retries when an app module keeps failing", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    previewModuleFailureCount: 10
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(page.locator(".v-snackbar", {
    hasText: "Preview could not load an application resource after retrying. Use Reload preview to try again."
  })).toBeVisible();
  await expect.poll(() => launchSession.getPreviewModuleRequestCount()).toBe(2);
  await page.waitForTimeout(750);
  expect(launchSession.getPreviewLoadCount()).toBe(2);
  expect(launchSession.getPreviewModuleRequestCount()).toBe(2);
  expect(launchSession.getPreviewModuleCompleted()).toBe(false);
});

test("@preview-lifecycle lets a slow first iframe load finish without restarting it", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    previewResponseDelayMs: 6500
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(
    page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")
  ).toBeVisible({
    timeout: 10000
  });
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toHaveCount(0);
  expect(launchSession.getPreviewLoadCount()).toBe(1);
});

test("@preview-lifecycle token bootstrap redirects once without reloading the clean document", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    previewBootstrapToken: "preview-bootstrap-token"
  });
  try {
    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

    await expect(
      page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")
    ).toBeVisible();
    await expect.poll(() => launchSession.getPreviewLoadCount()).toBe(2);
    await page.waitForTimeout(500);
    expect(launchSession.getPreviewLoadCount()).toBe(2);
  } finally {
    await launchSession.close();
  }
});

test("@preview-lifecycle stays mounted without reloading while covered by dashboard", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page);
  let onboardingReads = 0;
  await page.route(`${BASE_URL}${SCOPED_API_PREFIX}/vibe64/onboarding?sessionId=${SESSION_ID}`, async (route) => {
    onboardingReads += 1;
    await fulfillJson(route, {
      available: true,
      inspection: { diagnostics: [], state: "ready", templateEligible: false },
      ok: true,
      source: { rootKind: "session-source", sessionId: SESSION_ID },
      templates: []
    });
  });

  await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
  await expect(page.getByRole("navigation", { name: "Dashboard sections" })).toBeVisible();
  await expect(page.locator(`[data-vibe64-session-runtime-id='${SESSION_ID}']`)).toBeVisible();
  expect(onboardingReads).toBe(0);
  await page.getByRole("tab", { name: "Preview" }).click();

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  await expect(previewFrame).toHaveCount(1);
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toHaveCount(0);
  expect(onboardingReads).toBe(1);

  const initialSrc = await previewFrame.getAttribute("src");
  const initialPreviewLoadCount = launchSession.getPreviewLoadCount();
  await page.evaluate(() => {
    const frame = document.querySelector(".vibe64-launch-controls__preview-frame");
    const shellPane = document.querySelector(".shell-route-transition__pane");
    (window as unknown as { __vibe64ShellPane?: Element | null }).__vibe64ShellPane = shellPane;
    (window as unknown as { __vibe64PreviewFrame?: Element | null }).__vibe64PreviewFrame = frame;
  });

  await page.getByRole("tab", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(DASHBOARD_PATH)}/env/?$`, "u"));
  await page.waitForTimeout(5500);

  await expect(previewFrame).toHaveCount(1);
  expect(onboardingReads).toBe(1);
  expect(await previewFrame.getAttribute("src")).toBe(initialSrc);
  expect(launchSession.getPreviewLoadCount()).toBe(initialPreviewLoadCount);

  await page.getByRole("tab", { name: "Preview" }).click();
  await expect.poll(() => onboardingReads).toBe(2);
  await expect(previewFrame).toHaveCount(1);
  expect(await previewFrame.getAttribute("src")).toBe(initialSrc);
  expect(launchSession.getPreviewLoadCount()).toBe(initialPreviewLoadCount);
  expect(await previewFrame.evaluate((frame) => (
    frame === (window as unknown as { __vibe64PreviewFrame?: Element }).__vibe64PreviewFrame
  ))).toBe(true);
});

for (const viewport of [{ width: 1280, height: 577 }, { width: 960, height: 700 }, { width: 390, height: 844 }]) {
  test(`starter failures stay in action feedback and hidden completion waits for Preview at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockLaunchTerminalSocket(page);
    const launchSession = await mockLaunchSession(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let state = "new";
    let onboardingReads = 0;
    const writes: unknown[] = [];
    const releaseStarter = Promise.withResolvers<void>();
    await page.route(`${BASE_URL}${SCOPED_API_PREFIX}/vibe64/onboarding?sessionId=${SESSION_ID}`, async (route) => {
      onboardingReads += 1;
      await fulfillJson(route, {
        available: true,
        inspection: { diagnostics: [], state, templateEligible: state === "new" },
        ok: true,
        source: { rootKind: "session-source", sessionId: SESSION_ID },
        templates: state === "new" ? [{
          id: "test:jskit/public", technology: "jskit", name: "Local test starter",
          description: "A disposable starting application.", namespace: "test"
        }] : []
      });
    });
    await page.route(`${BASE_URL}${SCOPED_API_PREFIX}/vibe64/templates/apply`, async (route) => {
      writes.push(route.request().postDataJSON());
      if (writes.length === 1) {
        await fulfillJson(route, { ok: false, code: "starter_unavailable", error: "The starter could not be downloaded." }, { status: 400 });
        return;
      }
      await releaseStarter.promise;
      state = "ready";
      await fulfillJson(route, { ok: true });
    });
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      if (viewport.width <= 960) await page.getByRole("button", { name: "Show project", exact: true }).click();
      const starter = page.getByRole("button", { name: /Local test starter/u });
      await expect(starter).toBeEnabled();
      expect(onboardingReads).toBe(1);
      await starter.focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => writes.length).toBe(1);
      const failureFeedback = page.locator(".v-snackbar__wrapper", { hasText: "The starter could not be downloaded." });
      await expect(failureFeedback).toBeVisible();
      await expect(failureFeedback).toHaveCSS("opacity", "1");
      await expect(failureFeedback).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath("onboarding-starter-failure.png") });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(starter).toBeEnabled();
      expect(onboardingReads).toBe(1);

      await starter.focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => writes.length).toBe(2);
      await expect(starter).toBeDisabled();
      await expect(starter).toContainText("Preparing your starter");
      await (viewport.width <= 960
        ? page.getByRole("button", { name: "Go to dashboard", exact: true })
        : page.getByRole("tab", { name: "Dashboard", exact: true })).click();
      await expect(page).toHaveURL(new RegExp(`${escapeRegExp(DASHBOARD_PATH)}/env/?$`, "u"));
      await expect(starter).not.toBeVisible();
      releaseStarter.resolve();
      await expect(page.locator(".project-onboarding__choice")).toContainText("Use this starter");
      expect(onboardingReads).toBe(1);
      await (viewport.width <= 960
        ? page.getByRole("button", { name: "Go to preview", exact: true })
        : page.getByRole("tab", { name: "Preview", exact: true })).click();
      await expect(page.locator(".vibe64-launch-controls__preview-frame")).toBeVisible();
      expect(onboardingReads).toBe(2);
      expect(writes).toEqual([
        { sessionId: SESSION_ID, templateId: "test:jskit/public" },
        { sessionId: SESSION_ID, templateId: "test:jskit/public" }
      ]);
      expect(launchSession.getLaunchStartPayloads()).toHaveLength(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("onboarding-starter-ready.png") });
    } finally {
      releaseStarter.resolve();
      await launchSession.close();
    }
  });
}

test("embedded preview stays mounted when switching selected sessions", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const alphaSession = sessionPayload({
    sessionId: "session-alpha",
    sessionName: "Alpha"
  });
  const betaSession = sessionPayload({
    sessionId: "session-beta",
    sessionName: "Beta"
  });
  await mockLaunchSession(page, {
    session: alphaSession,
    sessionList: [alphaSession, betaSession]
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  const visibleSessionTab = (name: string) => page.locator(
    ".studio-ai-session-runtime:not([style*='display: none']) .studio-ai-sessions__tab",
    { hasText: name }
  );
  await visibleSessionTab("Alpha").click();

  const alphaRuntime = page.locator("[data-vibe64-session-runtime-id='session-alpha']");
  const alphaPreviewFrame = alphaRuntime.locator(".vibe64-launch-controls__preview-frame");
  await expect(alphaPreviewFrame).toHaveCount(1);
  const initialSrc = await alphaPreviewFrame.getAttribute("src");
  await page.evaluate(() => {
    const frame = document.querySelector("[data-vibe64-session-runtime-id='session-alpha'] .vibe64-launch-controls__preview-frame");
    (window as unknown as { __vibe64AlphaPreviewFrame?: Element | null }).__vibe64AlphaPreviewFrame = frame;
  });

  await visibleSessionTab("Beta").click();
  await expect(page.locator("[data-vibe64-session-runtime-id='session-beta']")).toBeVisible();

  await visibleSessionTab("Alpha").click();
  await expect(alphaRuntime).toBeVisible();
  await expect(alphaPreviewFrame).toHaveCount(1);
  expect(await alphaPreviewFrame.getAttribute("src")).toBe(initialSrc);
  await expect.poll(async () => page.evaluate(() => {
    const frame = document.querySelector("[data-vibe64-session-runtime-id='session-alpha'] .vibe64-launch-controls__preview-frame");
    const refs = window as unknown as { __vibe64AlphaPreviewFrame?: Element | null };
    return frame === refs.__vibe64AlphaPreviewFrame;
  })).toBe(true);
});

test("mobile project navigation uses action labels after showing the project pane", async ({ page }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  });
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(page.getByRole("button", {
    name: "Show project"
  })).toBeVisible();
  await expect(page.getByRole("tab", {
    exact: true,
    name: "Preview"
  })).toHaveCount(0);
  await expect(page.getByRole("tab", {
    exact: true,
    name: "Dashboard"
  })).toHaveCount(0);

  await page.getByRole("button", {
    name: "Show project"
  }).click();

  await expect(page.getByRole("tab", {
    exact: true,
    name: "Go to preview"
  })).toHaveCount(0);
  await expect(page.getByRole("tab", {
    exact: true,
    name: "Go to dashboard"
  })).toHaveCount(0);
  await expect(page.getByRole("button", {
    exact: true,
    name: "Go to dashboard"
  })).toBeVisible();
});

test("mobile shows either the chat or project pane at full width", async ({ page }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  });
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const shell = page.locator(".studio-autopilot");
  const chat = page.getByRole("region", { name: "Session chat", exact: true });
  const project = page.getByRole("region", { name: "Project", exact: true });

  await expect(chat).toBeVisible();
  await expect(project).toBeHidden();
  await expect.poll(async () => ({
    chat: Math.round((await chat.boundingBox())?.width || 0),
    shell: Math.round((await shell.boundingBox())?.width || 0)
  })).toEqual({
    chat: 390,
    shell: 390
  });

  await page.getByRole("button", {
    name: "Show project"
  }).click();

  await expect(chat).toBeHidden();
  await expect(project).toBeVisible();
  await expect.poll(async () => ({
    project: Math.round((await project.boundingBox())?.width || 0),
    shell: Math.round((await shell.boundingBox())?.width || 0)
  })).toEqual({
    project: 390,
    shell: 390
  });
});

test("mobile dashboard section links keep the active project slug", async ({ page }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  });
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
  await page.getByRole("button", {
    name: "Show project"
  }).click();
  await page.locator(".section-container-shell__mobile-section-title", {
    hasText: "Env"
  }).click();

  await expect(page).toHaveURL(`${BASE_URL}${DASHBOARD_PATH}/env`);
  expect(page.url()).not.toContain("[slug]");
});

for (const viewportWidth of [390, 960, 1600]) {
  test(`@preview-lifecycle session creation is single-flight and visibly pending at ${viewportWidth}px`, async ({ page }) => {
    await page.setViewportSize({
      height: viewportWidth === 390 ? 844 : 900,
      width: viewportWidth
    });
    await mockLaunchTerminalSocket(page);
    const creation = await mockLaunchSession(page, {
      sessionCreationDeferred: true,
      sessionCreationOutcomes: ["failure", "success", "success"],
      sessionList: []
    });

    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

    const toolbarCreate = page.locator("button.studio-ai-sessions__create-button:visible");
    const previewCreate = page.locator("button.studio-ai-sessions__preview-create-button");
    await expect(toolbarCreate).toBeVisible();
    if (viewportWidth >= 1600) {
      await expect(previewCreate).toBeVisible();
    } else {
      await expect(previewCreate).toBeHidden();
    }
    const firstTrigger = viewportWidth >= 1600 ? previewCreate : toolbarCreate;
    const idleBox = await firstTrigger.boundingBox();

    await firstTrigger.click();
    const dialogCreate = await submitAssistantSessionDialog(page, {
      doubleSubmit: true
    });

    await expect.poll(() => creation.getSessionCreationRequestCount()).toBe(1);
    await expect(dialogCreate).toBeDisabled();
    await expect(dialogCreate).toHaveAttribute("aria-busy", "true");
    await expect(dialogCreate).toHaveText("Creating session…");
    await expect(toolbarCreate).toBeDisabled();
    await expect(toolbarCreate).toHaveAttribute("aria-busy", "true");
    await expect(toolbarCreate).toHaveAttribute("aria-label", "Creating session…");
    await expect(toolbarCreate).toHaveAttribute("title", "Creating session…");
    if (viewportWidth >= 1600) {
      await expect(previewCreate).toBeDisabled();
      await expect(previewCreate).toHaveText("Creating session…");
      await expect(previewCreate).toHaveAttribute("aria-busy", "true");
    }
    const pendingBox = await firstTrigger.boundingBox();
    expect(Math.abs((pendingBox?.width || 0) - (idleBox?.width || 0))).toBeLessThan(1);
    expect(pendingBox?.height || 0).toBeGreaterThanOrEqual(47);
    await expect(page.locator(".v-progress-circular")).toHaveCount(0);

    creation.releaseNextSessionCreation();
    await expect(toolbarCreate).toBeEnabled();
    await expect(toolbarCreate).not.toHaveAttribute("aria-busy", "true");
    await expect(toolbarCreate).toHaveAttribute("aria-label", "New session");
    await expect(page.getByText("Session creation failed for this test.", {
      exact: true
    })).toBeVisible();
    await expect(dialogCreate).toBeEnabled();
    await expect(dialogCreate).toHaveText("Create session");
    await expect(dialogCreate).toBeFocused();
    expect(creation.getSessionCreationRequestCount()).toBe(1);

    await dialogCreate.press("Enter");
    await expect.poll(() => creation.getSessionCreationRequestCount()).toBe(2);
    await expect(toolbarCreate).toBeDisabled();
    creation.releaseNextSessionCreation();

    await expect(page.locator(".studio-ai-sessions__tab:visible")).toHaveCount(1);
    await expect(page.locator(".studio-ai-sessions__tab-label:visible")).toHaveText("Created 2");
    expect(creation.getSessionCreationRequestCount()).toBe(2);

    const activeToolbarCreate = page.locator("button.studio-ai-sessions__create-button");
    await activeToolbarCreate.click();
    await submitAssistantSessionDialog(page);
    await expect.poll(() => creation.getSessionCreationRequestCount()).toBe(3);
    await expect(activeToolbarCreate).toBeDisabled();
    await expect(activeToolbarCreate).toHaveAttribute("aria-busy", "true");
    creation.releaseNextSessionCreation();
    await expect(page.locator(".studio-ai-sessions__tab:visible")).toHaveCount(2);
    await expect(page.locator(".studio-ai-sessions__tab-label:visible")).toHaveText([
      "Created 2",
      "Created 3"
    ]);
    expect(creation.getSessionCreationRequestCount()).toBe(3);
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth
    ))).toBe(true);
  });
}

for (const viewportWidth of [390, 960, 1600]) {
  test(`@preview-lifecycle an occupied shared database exposes no session creation action at ${viewportWidth}px`, async ({ page }) => {
    await page.setViewportSize({
      height: viewportWidth === 390 ? 844 : 900,
      width: viewportWidth
    });
    await mockLaunchTerminalSocket(page);
    const creation = await mockLaunchSession(page, {
      sessionList: [],
      sharedDevelopmentDatabase: true
    });

    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

    const toolbarCreate = page.locator("button.studio-ai-sessions__create-button");
    const previewCreate = page.locator("button.studio-ai-sessions__preview-create-button");
    await expect(toolbarCreate).toBeVisible();
    if (viewportWidth >= 1600) {
      await expect(previewCreate).toBeVisible();
    } else {
      await expect(previewCreate).toBeHidden();
    }

    await toolbarCreate.click();
    await submitAssistantSessionDialog(page);
    await expect.poll(() => creation.getSessionCreationRequestCount()).toBe(1);
    await expect(page.locator(".studio-ai-sessions__tab:visible")).toHaveCount(1);
    await expect(page.locator(
      ".studio-ai-sessions__tab:visible[data-vibe64-session-id='session-created-1']"
    )).toBeFocused();
    await expect(toolbarCreate).toHaveCount(0);
    await expect(previewCreate).toHaveCount(0);

    const rejected = await page.evaluate(async ({ apiPrefix }) => {
      const response = await fetch(`${apiPrefix}/vibe64/sessions`, {
        body: "{}",
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      return {
        body: await response.json(),
        status: response.status
      };
    }, {
      apiPrefix: SCOPED_API_PREFIX
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({
      code: "vibe64_session_creation_limit",
      ok: false
    });

    await page.evaluate(async ({ apiPrefix }) => {
      await fetch(`${apiPrefix}/vibe64/sessions/session-created-1/archive`, {
        body: "{}",
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
    }, {
      apiPrefix: SCOPED_API_PREFIX
    });
    await page.reload();
    await expect(toolbarCreate).toBeVisible();
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth
    ))).toBe(true);
  });
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 960, height: 900 }, { width: 390, height: 844 }]) {
  test(`source-owned Collaboration and Engineering settings recover and stay isolated at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockLaunchTerminalSocket(page);
    const sessionA = sessionPayload({ sessionId: "settings-a", sessionName: "Settings A" });
    const sessionB = sessionPayload({ sessionId: "settings-b", sessionName: "Settings B" });
    await mockLaunchSession(page, { session: sessionA, sessionList: [sessionA, sessionB] });
    const choices = {
      tone: [
        { id: "encouraging", name: "Encouraging" },
        { id: "playful", name: "Playful and cheeky" },
        { id: "direct", name: "Direct" },
        { id: "military", name: "Crisp and military" }
      ],
      responseLength: [
        { id: "very_short", name: "Very short" },
        { id: "concise", name: "Concise" },
        { id: "balanced", name: "Balanced" },
        { id: "detailed", name: "Detailed" }
      ],
      experience: [
        { id: "beginner", name: "Beginner" },
        { id: "comfortable", name: "Comfortable" },
        { id: "expert", name: "Expert" }
      ],
      explanationStyle: [
        { id: "conclusions", name: "Conclusions only" },
        { id: "concise", name: "Concise rationale" },
        { id: "teaching", name: "Teaching detail" }
      ]
    };
    const profiles = [
      { id: "focused.v1", name: "Focused", description: "Small, direct changes for ordinary product work." },
      { id: "durable.v1", name: "Durable product", description: "Long-lived product work with explicit compatibility and operational care." },
      { id: "high-assurance.v1", name: "High assurance", description: "Security- or reliability-critical work backed by explicit risks and evidence." }
    ];
    const settings: Record<string, { collaboration: Record<string, string>; profile: string }> = {
      "settings-a": {
        collaboration: {
          tone: "encouraging", responseLength: "concise", experience: "comfortable",
          explanationStyle: "concise", requirements: "Source A requirements."
        },
        profile: "focused.v1"
      },
      "settings-b": {
        collaboration: {
          tone: "direct", responseLength: "balanced", experience: "beginner",
          explanationStyle: "conclusions", requirements: "Source B requirements."
        },
        profile: "durable.v1"
      }
    };
    const originalA = structuredClone(settings[sessionA.sessionId]);
    const writes: Record<string, Record<string, string>[]> = { collaboration: [], engineering: [] };
    const heldReads: string[] = [];
    const canonicalReads = {
      collaboration: Promise.withResolvers<void>(),
      engineering: Promise.withResolvers<void>()
    };
    let failWrite = "";
    let failRead = "";
    let holdRead = "";
    const settingsRoute = new RegExp(
      `^${escapeRegExp(`${BASE_URL}${SCOPED_API_PREFIX}/vibe64/settings`)}(?:/(?:collaboration|engineering))?(?:\\?.*)?$`,
      "u"
    );
    await page.route(settingsRoute, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const kind = url.pathname.endsWith("/engineering") ? "engineering" : "collaboration";
      const payload = request.method() === "PUT" ? request.postDataJSON() as Record<string, string> : null;
      // The persistent session panel also reads the selected-source policy without a query.
      const sessionId = payload ? payload.sessionId : url.searchParams.get("sessionId") || sessionA.sessionId;
      expect([sessionA.sessionId, sessionB.sessionId]).toContain(sessionId);
      const selected = settings[sessionId];
      if (payload) {
        writes[kind].push(payload);
        if (failWrite === kind) {
          await fulfillJson(route, {
            errors: [{ code: "validation_failed", message: `${kind} save failed for this test.` }],
            ok: false
          }, { status: 400 });
          return;
        }
        if (kind === "engineering") {
          selected.profile = payload.profile;
        } else {
          const { sessionId: targetSessionId, ...collaboration } = payload;
          expect(targetSessionId).toBe(sessionB.sessionId);
          selected.collaboration = collaboration;
        }
      } else {
        expect(request.method()).toBe("GET");
        if (holdRead === kind && sessionId === sessionB.sessionId) {
          heldReads.push(kind);
          await canonicalReads[kind].promise;
        }
        if (failRead === kind && sessionId === sessionB.sessionId) {
          await fulfillJson(route, {
            errors: [{ code: "settings_unavailable", message: `${kind} read failed for this test.` }],
            ok: false
          }, { status: 400 });
          return;
        }
      }
      const source = { projectSlug: "example-target-app", rootKind: "session-source", sessionId };
      const collaboration = {
        ...selected.collaboration, available: true, canEdit: true, choices,
        source, status: "configured", unavailableReason: ""
      };
      await fulfillJson(route, kind === "engineering"
        ? {
            engineering: {
              available: true, profile: profiles.find((profile) => profile.id === selected.profile),
              profiles, source, status: "configured", unavailableReason: ""
            },
            ok: true,
            projectSlug: "example-target-app"
          }
        : {
            collaboration,
            developmentDatabase: { managed: false },
            ok: true,
            projectSlug: "example-target-app",
            promptHints: { canEdit: true, enabled: true }
          });
    });

    const approaches = [
      {
        kind: "collaboration", region: "AI behaviour", save: "Save collaboration",
        fields: [
          { label: "Tone", dirtyA: "Playful and cheeky", storedB: "Direct", dirtyB: "Crisp and military" },
          { label: "Response length", dirtyA: "Detailed", storedB: "Balanced", dirtyB: "Very short" },
          { label: "Experience level", dirtyA: "Expert", storedB: "Beginner", dirtyB: "Comfortable" },
          { label: "Explanation style", dirtyA: "Teaching detail", storedB: "Conclusions only", dirtyB: "Concise rationale" }
        ],
        payload: {
          tone: "military", responseLength: "very_short", experience: "comfortable",
          explanationStyle: "concise", requirements: "Source B only.\nUse Australian English.",
          sessionId: sessionB.sessionId
        }
      },
      {
        kind: "engineering", region: "Engineering approach", save: "Save engineering approach",
        fields: [{ label: "Engineering profile", dirtyA: "High assurance", storedB: "Durable product", dirtyB: "Focused" }],
        payload: { profile: "focused.v1", sessionId: sessionB.sessionId }
      }
    ] as const;
    try {
      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/settings?sessionId=${sessionA.sessionId}`);
      if (viewport.width <= 960) {
        await page.getByRole("button", { name: "Show project", exact: true }).click();
      }
      const panel = page.locator(".project-settings:visible");
      await expect(panel.getByRole("heading", { name: "Project settings", exact: true })).toBeVisible();
      const originalPanel = await panel.elementHandle();
      expect(originalPanel).not.toBeNull();
      for (const approach of approaches) {
        const section = panel.getByRole("region", { name: approach.region, exact: true });
        for (const field of approach.fields) {
          const control = section.getByRole("combobox", { name: field.label, exact: true });
          await control.focus();
          await control.press("Enter");
          const option = page.getByRole("option", { name: field.dirtyA, exact: true });
          await option.focus();
          await option.press("Enter");
          await expect(control).toHaveValue(field.dirtyA);
        }
        await expect(section.getByRole("button", { name: approach.save, exact: true })).toBeEnabled();
      }
      await panel.getByRole("textbox", { name: "Project requirements (optional)", exact: true }).fill("Unsaved source A only.");

      // Controlled URL navigation exercises Vue Router without remounting Settings.
      // There is no ordinary Settings link that chooses an explicit source session.
      await page.evaluate((href) => {
        window.history.pushState({ ...window.history.state }, "", href);
        window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      }, `${DASHBOARD_PATH}/settings?sessionId=${sessionB.sessionId}`);
      await expect(page).toHaveURL(`${BASE_URL}${DASHBOARD_PATH}/settings?sessionId=${sessionB.sessionId}`);
      await expect(panel.getByRole("textbox", { name: "Project requirements (optional)", exact: true })).toHaveValue("Source B requirements.");
      expect(await originalPanel!.evaluate((node) => node.isConnected && node === document.querySelector(".project-settings"))).toBe(true);
      for (const approach of approaches) {
        const section = panel.getByRole("region", { name: approach.region, exact: true });
        for (const field of approach.fields) {
          await expect(section.getByRole("combobox", { name: field.label, exact: true })).toHaveValue(field.storedB);
        }
        await expect(section.getByRole("button", { name: approach.save, exact: true })).toBeDisabled();
      }

      for (const approach of approaches) {
        const section = panel.getByRole("region", { name: approach.region, exact: true });
        for (const field of approach.fields) {
          const control = section.getByRole("combobox", { name: field.label, exact: true });
          await control.scrollIntoViewIfNeeded();
          await expect(control).toBeVisible();
          const bounds = await control.boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
          await control.focus();
          await control.press("Enter");
          const option = page.getByRole("option", { name: field.dirtyB, exact: true });
          await option.focus();
          await option.press("Enter");
          await expect(control).toHaveValue(field.dirtyB);
        }
        const requirements = panel.getByRole("textbox", { name: "Project requirements (optional)", exact: true });
        if (approach.kind === "collaboration") {
          await requirements.fill(approach.payload.requirements);
        }
        const save = section.getByRole("button", { name: approach.save, exact: true });
        failWrite = approach.kind;
        await save.focus();
        await save.press("Enter");
        await expect(page.locator(".v-snackbar", { hasText: `${approach.kind} save failed for this test.` })).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.locator(".v-overlay__scrim:visible")).toHaveCount(0);
        await expect(save).toBeEnabled();
        expect(writes[approach.kind]).toEqual([approach.payload]);
        for (const field of approach.fields) {
          const control = section.getByRole("combobox", { name: field.label, exact: true });
          await expect(control).toBeEnabled();
          await expect(control).toHaveValue(field.dirtyB);
        }
        if (approach.kind === "collaboration") {
          await expect(requirements).toHaveValue(approach.payload.requirements);
        }

        failWrite = "";
        holdRead = approach.kind;
        await save.focus();
        await save.press("Enter");
        await expect.poll(() => heldReads.includes(approach.kind)).toBe(true);
        // The PUT is fulfilled; only its follow-up canonical GET remains pending.
        const pendingSave = section.getByRole("button", { name: "Saving…", exact: true });
        await expect(pendingSave).toBeDisabled();
        for (const field of approach.fields) {
          await expect(section.getByRole("combobox", { name: field.label, exact: true })).toBeDisabled();
        }
        if (approach.kind === "collaboration") {
          await expect(requirements).toBeDisabled();
        }
        await pendingSave.evaluate((button) => (button as HTMLButtonElement).click());
        expect(writes[approach.kind]).toEqual([approach.payload, approach.payload]);
        await pendingSave.scrollIntoViewIfNeeded();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`${approach.kind}-canonical-read-pending.png`) });

        failRead = approach.kind;
        holdRead = "";
        canonicalReads[approach.kind].resolve();
        await expect(panel.getByRole("heading", { name: "Project settings could not load", exact: true })).toBeVisible();
        await expect(panel).toContainText(`${approach.kind} read failed for this test.`);
        failRead = "";
        const retry = panel.getByRole("button", { name: "Retry", exact: true });
        await retry.focus();
        await retry.press("Enter");
        for (const field of approach.fields) {
          const control = section.getByRole("combobox", { name: field.label, exact: true });
          await expect(control).toBeEnabled();
          await expect(control).toHaveValue(field.dirtyB);
        }
        if (approach.kind === "collaboration") {
          await expect(requirements).toHaveValue(approach.payload.requirements);
        }
        await expect(save).toBeDisabled();
        expect(writes[approach.kind]).toEqual([approach.payload, approach.payload]);
        await save.scrollIntoViewIfNeeded();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`${approach.kind}-read-retry-ready.png`) });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      expect(settings[sessionA.sessionId]).toEqual(originalA);
    } finally {
      canonicalReads.collaboration.resolve();
      canonicalReads.engineering.resolve();
      await page.unroute(settingsRoute);
    }
  });
}

for (const source of [
  { endpoint: "settings", sessionId: "" },
  { endpoint: "settings", sessionId: "settings-a" },
  { endpoint: "settings/engineering", sessionId: "settings-a" }
]) {
  test(`delayed settings retries stay project-bound: ${source.endpoint}, ${source.sessionId || "selected source"}`, async ({ page }) => {
    page.setDefaultTimeout(10_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.clock.install();
    await mockLaunchTerminalSocket(page);
    const session = sessionPayload({ sessionId: "settings-a", sessionName: "Settings A" });
    await mockLaunchSession(page, { session, sessionList: [session] });
    const projects = ["example-target-app", "other-target-app"].map((slug) => ({
      external: false, name: slug, path: `/workspace/${slug}`, selected: true,
      slug, source: "workspace", runtime: { open: true }
    }));
    await page.route(/\/api(?:\/app\/[^/]+)?\/vibe64\/projects(?:\?.*)?$/u, async (route) => {
      const slug = /\/app\/project\/([^/]+)/u.exec(page.url())?.[1];
      const currentProject = projects.find((project) => project.slug === slug);
      await fulfillJson(route, {
        ok: true, hasSelection: true, currentProject, projects,
        projectsRoot: "/workspace", targetRoot: currentProject!.path
      });
    });
    const response = {
      ok: true, promptHints: { enabled: true, canEdit: true },
      collaboration: { available: false, canEdit: false },
      engineering: { available: false }
    };
    const reads: Array<{ slug: string; route: Route }> = [];
    let otherProjectRead = false;
    await page.route(/\/api(?:\/app\/[^/]+)?\/vibe64\/settings(?:\/engineering)?(?:\?.*)?$/u, async (route) => {
      const url = new URL(route.request().url());
      const slug = /\/api\/app\/([^/]+)/u.exec(url.pathname)?.[1] || "unscoped";
      if (slug === "other-target-app" && url.pathname.endsWith("/vibe64/settings")) otherProjectRead = true;
      if (url.pathname.endsWith(`/vibe64/${source.endpoint}`) && (url.searchParams.get("sessionId") || "") === source.sessionId) {
        reads.push({ slug, route });
        if (slug === "example-target-app") return;
      }
      await fulfillJson(route, response);
    });

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/settings${source.sessionId ? `?sessionId=${source.sessionId}` : ""}`);
    await expect.poll(() => reads.length).toBe(1);
    expect(reads[0].slug).toBe("example-target-app");
    await page.getByRole("button", { name: "example-target-app", exact: true }).click();
    await page.getByRole("list").getByText("other-target-app", { exact: true }).click();
    await expect(page).toHaveURL(`${BASE_URL}/app/project/other-target-app`);
    // Wait for the new project's persistent settings reader before releasing A.
    await expect.poll(() => otherProjectRead).toBe(true);
    const beforeRetry = reads.length;
    await fulfillJson(reads[0].route, { ok: false, error: "Transient source A read failure." }, { status: 503 });
    await page.clock.runFor(3_000);
    await expect.poll(() => reads.length).toBe(beforeRetry + 1);
    expect(reads.at(-1)!.slug, "the physical retry must keep its original project").toBe("example-target-app");
    await fulfillJson(reads.at(-1)!.route, response);
  });
}

for (const viewportWidth of [390, 960, 1600]) {
  test(`@preview-lifecycle shared database choice is unavailable with multiple sessions at ${viewportWidth}px`, async ({ page }) => {
    await page.setViewportSize({
      height: viewportWidth === 390 ? 844 : 900,
      width: viewportWidth
    });
    await mockLaunchTerminalSocket(page);
    await mockProjectGateReady(page);
    await page.route(/\/api(?:\/app\/[^/]+)?\/vibe64\/settings(?:\?.*)?$/u, async (route) => {
      await fulfillJson(route, {
        collaboration: {
          available: true,
          canEdit: true,
          choices: {},
          experience: "comfortable",
          explanationStyle: "concise",
          requirements: "",
          responseLength: "concise",
          source: { rootKind: "session-source", sessionId: "session-a" },
          status: "configured",
          tone: "encouraging",
          unavailableReason: ""
        },
        developmentDatabase: {
          canChange: false,
          disabledReason: "Close all 2 open sessions (First task, Second task) before changing the development database.",
          managed: true,
          openSessionCount: 2,
          options: {
            project: {
              available: false,
              disabledReason: "A shared database allows one open session, but this project has 2. Close all 2 open sessions (First task, Second task) before choosing it."
            },
            session: {
              available: true
            }
          },
          scope: "session"
        },
        ok: true,
        promptHints: { canEdit: true, enabled: true }
      });
    });

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/settings`);
    const showProject = page.getByRole("button", {
      name: "Show project"
    });
    if (viewportWidth <= 980) {
      await expect(showProject).toBeVisible();
      await showProject.click();
    }

    await expect(page.getByRole("heading", {
      name: "Project settings"
    })).toBeVisible();
    const sessionDatabase = page.getByRole("radio", {
      name: "A separate database for each session"
    });
    const sharedDatabase = page.getByRole("radio", {
      name: "One database shared by this project"
    });
    await expect(sessionDatabase).toBeEnabled();
    await expect(sessionDatabase).toBeChecked();
    await expect(sharedDatabase).toBeDisabled();
    await expect(sharedDatabase).toHaveAttribute(
      "aria-describedby",
      "development-database-project-reason"
    );
    await expect(page.locator("#development-database-project-reason")).toContainText(
      "this project has 2"
    );
    await expect(page.getByRole("button", {
      name: "Save database choice"
    })).toBeDisabled();
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth
    ))).toBe(true);
  });
}

for (const viewportWidth of [390, 960, 1600]) {
  test(`@preview-lifecycle switching to per-session databases restores the ordinary session limit at ${viewportWidth}px`, async ({ page }) => {
    await page.setViewportSize({
      height: viewportWidth === 390 ? 844 : 900,
      width: viewportWidth
    });
    await mockLaunchTerminalSocket(page);
    const creation = await mockLaunchSession(page, {
      sessionList: [],
      sharedDevelopmentDatabase: true
    });
    let databaseScope = "project";
    const developmentDatabase = () => ({
      canChange: true,
      managed: true,
      openSessionCount: 0,
      options: {
        project: {
          available: true
        },
        session: {
          available: true
        }
      },
      scope: databaseScope
    });
    await page.route(/\/api(?:\/app\/[^/]+)?\/vibe64\/settings(?:\/development-database)?(?:\?.*)?$/u, async (route) => {
      const request = route.request();
      if (new URL(request.url()).pathname.endsWith("/development-database")) {
        expect(request.method()).toBe("PUT");
        expect(request.postDataJSON()).toEqual({
          scope: "session"
        });
        databaseScope = "session";
        creation.setSharedDevelopmentDatabase(false);
        await fulfillJson(route, {
          ...developmentDatabase(),
          ok: true
        });
        return;
      }
      await fulfillJson(route, {
        collaboration: {
          available: true,
          canEdit: true,
          choices: {},
          experience: "comfortable",
          explanationStyle: "concise",
          requirements: "",
          responseLength: "concise",
          source: { rootKind: "session-source", sessionId: "session-a" },
          status: "configured",
          tone: "encouraging",
          unavailableReason: ""
        },
        developmentDatabase: developmentDatabase(),
        ok: true,
        promptHints: { canEdit: true, enabled: true }
      });
    });

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/settings`);
    if (viewportWidth <= 980) {
      const showProject = page.getByRole("button", {
        name: "Show project"
      });
      await expect(showProject).toBeVisible();
      await showProject.click();
    }

    const perSessionDatabase = page.getByRole("radio", {
      name: "A separate database for each session"
    });
    await expect(perSessionDatabase).toBeEnabled();
    await perSessionDatabase.focus();
    await perSessionDatabase.press("Space");
    await expect(perSessionDatabase).toBeChecked();
    const saveDatabase = page.getByRole("button", {
      name: "Save database choice"
    });
    await expect(saveDatabase).toBeEnabled();
    await saveDatabase.focus();
    await saveDatabase.press("Enter");
    await expect.poll(() => databaseScope).toBe("session");

    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
    const toolbarCreate = page.locator("button.studio-ai-sessions__create-button:visible");
    for (let expectedCount = 1; expectedCount <= 3; expectedCount += 1) {
      await expect(toolbarCreate).toBeEnabled();
      await toolbarCreate.click();
      await submitAssistantSessionDialog(page);
      await expect.poll(() => creation.getSessionCreationRequestCount()).toBe(expectedCount);
      await expect(page.locator(".studio-ai-sessions__tab:visible")).toHaveCount(expectedCount);
    }
    await expect(toolbarCreate).toBeVisible();
    await expect(toolbarCreate).toBeDisabled();
    await toolbarCreate.focus();
    await expect(toolbarCreate).toBeFocused();
    await expect(toolbarCreate).toHaveAttribute("aria-disabled", "true");
    await expect(toolbarCreate).toHaveAttribute(
      "aria-label",
      "New session. Studio allows up to 3 open sessions. Archive one before creating another."
    );
    await expect(toolbarCreate).toHaveAttribute(
      "title",
      "Studio allows up to 3 open sessions. Archive one before creating another."
    );
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth
    ))).toBe(true);
  });
}

test("session panel shows loading feedback instead of empty create state while sessions load", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    sessionListDelayMs: 3000
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(page.getByText("Loading sessions.").first()).toBeVisible();
  await expect(page.getByText("Create a session to start preview.")).toHaveCount(0);
  await expect(page.getByRole("button", {
    name: "Create session"
  })).toHaveCount(0);
  await expect(page.getByRole("button", {
    name: "New session"
  })).toHaveCount(0);

  await expect(page.locator(".vibe64-launch-controls__preview-frame")).toBeVisible();
  await expect(page.getByText("Create a session to start preview.")).toHaveCount(0);
});

test("the chat cog stays available and delivery actions stay aligned during an active turn", async ({ page }) => {
  await page.setViewportSize({ height: 600, width: 900 });
  await mockLaunchTerminalSocket(page);
  const baseSession = sessionPayload();
  const selectedSession = {
    ...baseSession,
    agentSession: {
      ...baseSession.agentSession,
      turn: {
        active: true,
        id: "turn-active-chat-controls",
        state: "active"
      }
    },
    assistantSelection: {
      agentId: "codex",
      catalogRevision: TEST_ASSISTANT_CATALOG_REVISION,
      engineId: "codex",
      modelId: "gpt-5.6-sol",
      modelProviderId: "openai",
      variantId: "xhigh"
    }
  };
  await mockLaunchSession(page, {
    assistantAccess: PERSONAL_ASSISTANT_ACCESS,
    assistantCatalog: assistantCatalogPayload({ includeOpenCode: true }),
    session: selectedSession
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  const assistantMenuButton = page.locator("button[aria-label='Choose AI']:visible");
  await expect(assistantMenuButton).toBeEnabled();
  await assistantMenuButton.click();

  const selector = page.getByLabel("AI session selector");
  await expect(selector).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(selector.getByRole("button", { name: "GPT-5.6 Sol" })).toBeDisabled();
  await expect(selector.getByRole("button", { name: "Extra high" })).toBeDisabled();
  await expect(selector.getByText(
    "AI choices are view-only while the assistant is working.",
    { exact: true }
  )).toBeVisible();
  await expect(selector.getByText("OpenCode", { exact: true })).toHaveCount(0);
  await expect(selector.getByRole("button", { name: "Apply" })).toBeDisabled();

  await page.keyboard.press("Escape");
  await expect(selector).not.toBeVisible();
  await page.setViewportSize({ height: 700, width: 390 });
  const steerButton = page.getByRole("button", { name: "Steer assistant" });
  await expect(steerButton).toBeVisible();
  const [assistantMenuBox, steerBox] = await Promise.all([
    assistantMenuButton.boundingBox(),
    steerButton.boundingBox()
  ]);
  expect(Math.abs(
    (assistantMenuBox?.y || 0) + (assistantMenuBox?.height || 0) / 2 -
    ((steerBox?.y || 0) + (steerBox?.height || 0) / 2)
  )).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth
  ))).toBe(true);
});

for (const viewport of [{ width: 1280, height: 577 }, { width: 390, height: 844 }]) {
  test(`cold Files waits for remembered-session detail at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockLaunchTerminalSocket(page);
    await mockLaunchSession(page, {
      sourceEditorFiles: { "src/App.js": "export const ready = true;\n" }
    });
    await page.route(`${BASE_URL}${SCOPED_API_PREFIX}/vibe64/onboarding?sessionId=${SESSION_ID}`, async (route) => {
      await fulfillJson(route, {
        available: true,
        inspection: { diagnostics: [], state: "ready", templateEligible: false },
        ok: true,
        source: { rootKind: "session-source", sessionId: SESSION_ID },
        templates: []
      });
    });
    const filesUrl = `${BASE_URL}${DASHBOARD_PATH}/files`;
    await page.goto(filesUrl);
    await expect(page.getByLabel("Session source editor")).toBeVisible();

    // Normal selection above remembers the session; reload must not wait for its list entry.
    const sessionsUrl = `${BASE_URL}${SCOPED_API_PREFIX}/vibe64/sessions`;
    const sessionReads = new RegExp(`^${escapeRegExp(sessionsUrl)}(?:/${SESSION_ID})?(?:\\?.*)?$`, "u");
    const releaseReads = Promise.withResolvers<void>();
    const heldReads: string[] = [];
    await page.route(sessionReads, async (route) => {
      heldReads.push(route.request().url());
      await releaseReads.promise;
      await route.fallback();
    });
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect.poll(() => heldReads.includes(`${sessionsUrl}/${SESSION_ID}`)).toBe(true);
      await expect(page).toHaveURL(filesUrl);
      const loading = page.locator(".studio-autopilot__project-panel > .vibe64-async-module-state");
      await expect(loading).toBeVisible();
      await expect(loading).toHaveAttribute("aria-busy", "true");
      await expect(loading.locator(".v-skeleton-loader")).toHaveAttribute("aria-label", "Loading session source...");
      await expect(page.getByLabel("Session source editor")).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Dashboard sections" })).toBeHidden();
      const project = page.getByRole("region", { name: "Project", exact: true });
      const pendingBounds = await project.boundingBox();
      expect(pendingBounds).not.toBeNull();
      expect(await loading.boundingBox()).toEqual(pendingBounds);
      await page.screenshot({ path: testInfo.outputPath("source-tool-pending.png") });

      releaseReads.resolve();
      await expect(page.getByLabel("Session source editor")).toBeVisible();
      await expect(loading).toHaveCount(0);
      await expect(page).toHaveURL(filesUrl);
      expect(await project.boundingBox()).toEqual(pendingBounds);
      await page.screenshot({ path: testInfo.outputPath("source-tool-ready.png") });
    } finally {
      releaseReads.resolve();
      await page.unroute(sessionReads);
    }
  });
}

test("chat source links open the editor and editor autosaves file changes", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const sourceEditor = await mockLaunchSession(page, {
    conversationLog: [
      {
        assistant: {
          at: "2026-05-24T00:00:00.000Z",
          role: "assistant",
          text: "Open [src/App.js:2](src/App.js:2) and make the change."
        },
        turnId: "turn-source-link"
      }
    ],
    sourceEditorFiles: {
      ".git/hidden.js": "export const hidden = 'visible needle';\n",
      "dist/bundle.js": "visible needle\n",
      "node_modules/pkg/hidden.js": "export const hidden = 'visible needle';\n",
      "src/App.js": "import { helper } from './utils/really-long-helper-file-name-that-needs-hover';\nconst value = 1;\nconst status = 'ready';\n",
      "src/utils/really-long-helper-file-name-that-needs-hover.js": "export const helper = 'visible needle';\n"
    }
  });
  await page.route(`${BASE_URL}${SCOPED_API_PREFIX}/vibe64/onboarding?sessionId=${SESSION_ID}`, async (route) => {
    await fulfillJson(route, {
      available: true,
      inspection: { diagnostics: [], state: "ready", templateEligible: false },
      ok: true,
      source: { rootKind: "session-source", sessionId: SESSION_ID },
      templates: []
    });
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await page.getByRole("link", {
    name: "src/App.js:2"
  }).click();

  await expect(page).toHaveURL(`${BASE_URL}${DASHBOARD_PATH}/files`);
  await expect(page.getByLabel("Session source editor")).toBeVisible();
  await expect(page.locator(".vibe64-source-editor__title")).toContainText("App.js");
  await expect(page.locator(".vibe64-source-tree__button--active", {
    hasText: "App.js"
  })).toBeVisible();
  expect(sourceEditor.getTreeRequests()).toEqual([
    {
      limit: 20,
      offset: 0,
      path: ""
    }
  ]);
  await expect(page.locator(".vibe64-source-tree__button", {
    hasText: "really-long-helper-file-name-that-needs-hover.js"
  })).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("const status = 'ready';");

  await page.getByText("./utils/really-long-helper-file-name-that-needs-hover").click({
    modifiers: ["Control"]
  });
  await expect(page.locator(".vibe64-source-editor__title")).toContainText("really-long-helper-file-name");
  await expect(page.locator(".cm-content")).toContainText("visible needle");

  await page.getByRole("link", {
    name: "src/App.js:2"
  }).click();
  await expect(page.locator(".vibe64-source-editor__title")).toContainText("App.js");

  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("const value = 2;\n");

  await expect.poll(() => sourceEditor.getSavedText("src/App.js")).toBe("const value = 2;\n");

  await page.getByRole("textbox", {
    name: "Open file"
  }).fill("helper");
  const fastOpenMatch = page.locator(".vibe64-source-editor__matches")
    .getByTitle("src/utils/really-long-helper-file-name-that-needs-hover.js");
  await expect(fastOpenMatch).toBeVisible();
  await fastOpenMatch.click();
  await expect(page.locator(".vibe64-source-editor__title")).toContainText("really-long-helper-file-name");
  await expect(page.locator(".cm-content")).toContainText("visible needle");

  await page.getByRole("tab", {
    name: "Preview"
  }).click();
  await expect(page).toHaveURL(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await expect(page.getByLabel("Session source editor")).toBeHidden();
  await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app"))
    .toBeVisible();
  await page.getByRole("tab", {
    name: "Dashboard"
  }).click();
  await expect(page).toHaveURL(`${BASE_URL}${DASHBOARD_PATH}/files`);
  await expect(page.getByLabel("Session source editor")).toBeVisible();
  await expect(page.locator(".vibe64-source-editor__title")).toContainText("really-long-helper-file-name");
  const composerGeometry = await page.locator(".studio-autopilot__chat-panel .studio-autopilot__composer .studio-autopilot-prompt-textarea__field").evaluate((element) => {
    const composer = element.closest(".studio-autopilot__composer").getBoundingClientRect();
    return {
      fieldBottomGap: composer.bottom - element.getBoundingClientRect().bottom,
      viewportBottomGap: window.innerHeight - composer.bottom
    };
  });
  expect(composerGeometry.viewportBottomGap).toBeGreaterThanOrEqual(0);
  expect(composerGeometry.viewportBottomGap).toBeLessThanOrEqual(1);
  expect(composerGeometry.fieldBottomGap).toBeCloseTo(4, 0);
  await page.getByTitle("Collapse file list").click();
  await expect(page.getByTitle("Show files")).toBeVisible();
  await page.getByTitle("Show files").click();
  await expect(page.locator(".vibe64-source-tree__button--active", {
    hasText: "really-long-helper-file-name"
  })).toBeVisible();

  await page.getByRole("textbox", {
    name: "Find in files"
  }).fill("visible needle");
  await expect(page.getByTitle("src/utils/really-long-helper-file-name-that-needs-hover.js:1:24")).toBeVisible();
  await expect(page.getByText("node_modules/pkg/hidden.js", { exact: true })).toBeVisible();
  await expect(page.getByText("dist/bundle.js", { exact: true })).toBeVisible();
  await expect(page.getByText(".git/hidden.js", { exact: true })).toHaveCount(0);
});

test("source editor refresh reloads the open file and preserves its viewport", async ({ page }) => {
  const originalText = Array.from({ length: 240 }, (_, index) => (
    `const sourceLine${String(index + 1).padStart(3, "0")} = ${index + 1};`
  )).join("\n") + "\n";
  await mockLaunchTerminalSocket(page);
  const sourceEditor = await mockLaunchSession(page, {
    conversationLog: [
      {
        assistant: {
          at: "2026-05-24T00:00:00.000Z",
          role: "assistant",
          text: "Open [src/App.js](src/App.js)."
        },
        turnId: "turn-source-refresh"
      }
    ],
    sourceEditorFiles: {
      "src/App.js": originalText
    }
  });
  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await page.getByRole("link", {
    name: "src/App.js"
  }).click();
  const scroller = page.locator(".cm-scroller");
  await scroller.evaluate((element) => {
    element.scrollTop = 1800;
  });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(1_000);
  const viewport = await scroller.evaluate((element) => {
    const scrollerBounds = element.getBoundingClientRect();
    const visibleLines = [...element.querySelectorAll(".cm-line")].filter((line) => {
      const lineBounds = line.getBoundingClientRect();
      return lineBounds.bottom > scrollerBounds.top && lineBounds.top < scrollerBounds.bottom;
    });
    return {
      line: visibleLines[Math.floor(visibleLines.length / 2)]?.textContent || "",
      scrollTop: element.scrollTop
    };
  });
  expect(viewport.line).toMatch(/^const sourceLine\d{3} = \d+;$/u);

  const changedLine = viewport.line.replace(";", " + 1;");
  sourceEditor.setText(
    "src/App.js",
    `const insertedAboveViewport = true;\n${originalText.replace(viewport.line, changedLine)}`
  );
  await page.getByTitle("Refresh files").click();

  await expect(page.locator(".cm-content")).toContainText(changedLine);
  await expect.poll(async () => (
    await scroller.evaluate((element) => element.scrollTop) - viewport.scrollTop
  )).toBeGreaterThan(5);
  expect(await scroller.evaluate((element) => element.scrollTop) - viewport.scrollTop).toBeLessThan(50);
  expect(sourceEditor.getTreeRequests().length).toBeGreaterThan(1);
});

test("source explanations keep live progress compact and answers above the follow-up composer", async ({ page }) => {
  const sourcePath = "src/pages/home/receivals/[recordId]/edit.vue";
  const sourceRoot = `${sessionRuntimeRoot(SESSION_ID)}/source`;
  const finalText = [
    "## Brief Summary",
    `[${sourcePath}](<${sourceRoot}/${sourcePath}:1>) is the edit screen wiring for an existing receival.`,
    "",
    "It configures the shared CRUD runtime and passes lookup helpers into the receival form.",
    "",
    "Readable closing line above the follow-up composer."
  ].join("\n");
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    assistantAccess: PERSONAL_ASSISTANT_ACCESS,
    conversationLog: [
      {
        assistant: {
          at: "2026-05-24T00:00:00.000Z",
          role: "assistant",
          text: `Open [${sourcePath}:1](${sourcePath}:1) and explain it.`
        },
        turnId: "turn-source-explanation-link"
      }
    ],
    sourceEditorFiles: {
      [sourcePath]: "<template><ReceivalForm /></template>\n<script setup>\nconst recordId = '42';\n</script>\n"
    },
    sourceExplanationResponses: [
      (payload) => [
        {
          assistantMessageId: payload.assistantMessageId,
          type: "source-explanation.started",
          userMessageId: payload.userMessageId
        },
        {
          messageId: payload.assistantMessageId,
          role: "assistant",
          status: "thinking",
          text: "I'll read the project guidance and adjacent generated CRUD files first.",
          type: "source-explanation.message"
        }
      ],
      (payload) => [
        {
          assistantMessageId: payload.assistantMessageId,
          type: "source-explanation.started",
          userMessageId: payload.userMessageId
        },
        {
          explanation: sourceEditorExplanationPayload(payload, finalText),
          type: "source-explanation.finished"
        }
      ]
    ]
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await openSessionDashboardTool(page, "Files");
  await page.getByRole("textbox", {
    name: "Open file"
  }).fill("edit.vue");
  await page.locator(".vibe64-source-editor__matches").getByTitle(sourcePath).click();
  await expect(page.locator(".vibe64-source-editor__title")).toContainText("edit.vue");

  await page.getByRole("button", {
    name: "Explain"
  }).click();

  const panel = page.getByLabel("Source explanation");
  const thinkingDetail = panel.locator(".vibe64-source-explanation__thinking-detail", {
    hasText: "I'll read the project guidance"
  });
  await expect(thinkingDetail).toBeVisible();
  const status = panel.locator(".vibe64-source-explanation__status", {
    hasText: "Thinking…"
  });
  await expect(status).toBeVisible();
  await expect(status.locator(".vibe64-source-explanation__status-mark")).toBeVisible();
  await page.getByTitle("Collapse explanation").click();
  await expect(page.getByTitle("Show explanation")).toBeVisible();
  await page.getByTitle("Show explanation").click();
  await expect(panel).toBeVisible();
  const statusFontSize = await thinkingDetail.locator(".studio-long-text-review__paragraph").evaluate((element) => (
    Number.parseFloat(getComputedStyle(element).fontSize)
  ));
  expect(statusFontSize).toBeLessThanOrEqual(13);

  await page.getByRole("button", {
    name: "Explain"
  }).click();

  const sourceLink = panel.getByRole("link", {
    name: sourcePath
  });
  await expect(sourceLink).toBeVisible();
  await expect(panel.getByText("Readable closing line above the follow-up composer.")).toBeVisible();

  const geometry = await panel.evaluate((element) => {
    const answer = element.querySelector(".vibe64-source-explanation__thread");
    const followup = element.querySelector(".vibe64-source-explanation__followup");
    const closingLine = Array.from(element.querySelectorAll(".studio-long-text-review__paragraph"))
      .find((node) => node.textContent?.includes("Readable closing line above the follow-up composer."));
    if (!answer || !followup || !closingLine) {
      throw new Error("Missing explanation layout element.");
    }
    return {
      closingBottom: closingLine.getBoundingClientRect().bottom,
      followupTop: followup.getBoundingClientRect().top,
      threadBottom: answer.getBoundingClientRect().bottom
    };
  });
  expect(geometry.closingBottom).toBeLessThanOrEqual(geometry.followupTop - 1);
  expect(geometry.threadBottom).toBeLessThanOrEqual(geometry.followupTop - 1);

  const followupBox = panel.getByRole("textbox", {
    name: "Ask about this explanation"
  });
  const explanationComposerBottomGap = await panel.locator(".vibe64-source-explanation__followup .studio-autopilot-prompt-textarea__field").evaluate((element) => (
    window.innerHeight - element.getBoundingClientRect().bottom
  ));
  expect(explanationComposerBottomGap).toBeLessThanOrEqual(3);
  await followupBox.fill("first line");
  await followupBox.press("Enter");
  await followupBox.pressSequentially("second line");
  await expect(followupBox).toHaveValue("first line\nsecond line");

  await sourceLink.click();
  await expect(page.locator(".vibe64-source-editor__title")).toContainText("edit.vue");
});

test("conversation messages render pipe tables", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    conversationLog: [
      {
        assistant: {
          at: "2026-05-24T00:00:00.000Z",
          role: "assistant",
          text: "| Table | Rows | Role | | --- | ---: | --- | | users | 3 | JSKIT user mirror for Supabase identities. | | assistant_config | 0 | Per-surface assistant config. |"
        },
        turnId: "turn-table"
      }
    ]
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const table = page.locator(".studio-long-text-review__table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", {
    name: "Table"
  })).toBeVisible();
  await expect(table.getByRole("columnheader", {
    name: "Rows"
  })).toBeVisible();
  await expect(table.getByRole("cell", {
    name: "JSKIT user mirror for Supabase identities."
  })).toBeVisible();
  await expect(table.getByRole("cell", {
    name: "Per-surface assistant config."
  })).toBeVisible();

  const numericCellAlign = await table.getByRole("cell", {
    name: "3"
  }).evaluate((element) => getComputedStyle(element).textAlign);
  expect(numericCellAlign).toBe("right");
});

test("@preview-lifecycle long-running output stays hidden until opened and takes over mobile", async ({ page }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  });
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await page.getByRole("button", { name: "Show project" }).click();

  const terminal = page.locator(".vibe64-launch-controls__terminal--embedded");
  const terminalHost = terminal.locator(".vibe64-terminal-surface__host");
  await expect(terminal).toHaveCount(0);
  await page.getByRole("button", { name: "Show preview controls" }).click();
  const showOutput = page.getByRole("button", { name: "Show run output" });
  await expect(showOutput).toBeVisible();

  const bodyOverflowBefore = await page.locator("body").evaluate((element) => element.style.overflow);
  await expect.poll(() => page.locator("#app").evaluate((element) => element.inert)).toBe(false);

  await showOutput.click();

  const takeover = page.getByRole("dialog");
  await expect(takeover).toBeVisible();
  await expect(takeover).toHaveAttribute("aria-modal", "true");
  await expect(terminalHost).toBeVisible();
  await expect(terminal).toContainText("ready");
  await expect(terminal.getByRole("button", { name: "Copy" })).toBeVisible();
  await expect.poll(() => page.locator("body").evaluate((element) => element.style.overflow)).toBe("hidden");
  await expect.poll(() => page.locator("#app").evaluate((element) => element.inert)).toBe(true);
  await expect.poll(() => takeover.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  const takeoverFocusable = takeover.locator(
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
  );
  await takeoverFocusable.last().focus();
  await page.keyboard.press("Tab");
  await expect.poll(() => takeover.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await takeoverFocusable.first().focus();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => takeover.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  const terminalInput = terminal.locator(".xterm-helper-textarea");
  await terminalInput.focus();
  await terminalInput.pressSequentially("status");
  await terminalInput.press("Enter");
  await expect.poll(() => page.evaluate(() => {
    const payloads = (window as typeof window & { __vibe64LaunchTerminalMessages?: string[] })
      .__vibe64LaunchTerminalMessages || [];
    return payloads.flatMap((payload) => {
      try {
        const parsed = JSON.parse(payload) as { data?: string; type?: string };
        return parsed.type === "input" ? [String(parsed.data || "")] : [];
      } catch {
        return [];
      }
    }).join("");
  })).toContain("status\r");
  const expandedBox = await terminal.boundingBox();
  expect(expandedBox?.x).toBe(0);
  expect(expandedBox?.y).toBe(0);
  expect(expandedBox?.width).toBe(390);
  expect(expandedBox?.height).toBe(844);

  await terminal.getByRole("button", { name: "Close" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(terminal).toHaveCount(0);
  await page.getByRole("button", { name: "Show preview controls" }).click();
  await expect(showOutput).toBeVisible();
  await expect.poll(() => page.locator("#app").evaluate((element) => element.inert)).toBe(false);
  await expect.poll(() => page.locator("body").evaluate((element) => element.style.overflow)).toBe(bodyOverflowBefore);
});

for (const desktopWidth of [960, 1600]) {
  test(`@preview-lifecycle long-running output is an on-demand desktop dock at ${desktopWidth}px`, async ({ page }) => {
    await page.setViewportSize({
      height: 900,
      width: desktopWidth
    });
    await mockLaunchTerminalSocket(page);
    await mockLaunchSession(page);

    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
    if (desktopWidth === 960) {
      const showProject = page.getByRole("button", { name: "Show project" });
      await expect(showProject).toBeVisible();
      await showProject.click();
    }

    const preview = page.locator(".vibe64-launch-controls__preview");
    const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
    const terminal = page.locator(".vibe64-launch-controls__terminal--embedded");
    const terminalHost = terminal.locator(".vibe64-terminal-surface__host");
    const showPreviewControls = page.getByRole("button", { name: "Show preview controls" });
    if (await showPreviewControls.isVisible()) {
      await showPreviewControls.click();
    }
    const showOutput = page.getByRole("button", { name: "Show run output" });
    const readPreviewGeometry = () => preview.evaluate((element) => {
      const frame = element.querySelector(".vibe64-launch-controls__preview-frame");
      const previewBox = element.getBoundingClientRect();
      const frameBox = frame?.getBoundingClientRect();
      return {
        frame: frameBox ? {
          height: frameBox.height,
          width: frameBox.width,
          x: frameBox.x,
          y: frameBox.y
        } : null,
        preview: {
          height: previewBox.height,
          width: previewBox.width,
          x: previewBox.x,
          y: previewBox.y
        }
      };
    });
    const previewReceivesPointerAtCenter = () => previewFrame.evaluate((frame) => {
      const box = frame.getBoundingClientRect();
      return document.elementFromPoint(
        box.left + (box.width / 2),
        box.top + (box.height / 2)
      ) === frame;
    });

    await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app"))
      .toBeVisible();
    await expect(terminal).toHaveCount(0);
    await expect(showOutput).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const previewGeometry = await readPreviewGeometry();
    expect(await previewReceivesPointerAtCenter()).toBe(true);

    await showOutput.click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(terminalHost).toBeVisible();
    await expect(terminal.locator(".xterm")).toHaveCount(1);
    await expect(terminal).toHaveCount(1);
    await expect(terminal).toContainText("ready");
    const expandedBox = await terminal.boundingBox();
    const terminalHeaderBox = await terminal.locator(".vibe64-terminal-surface__header").boundingBox();
    const appBarBox = await page.getByTestId("jskit-shell-app-bar").boundingBox();
    expect(expandedBox).not.toBeNull();
    expect(terminalHeaderBox).not.toBeNull();
    expect(appBarBox).not.toBeNull();
    expect(terminalHeaderBox!.y).toBeGreaterThanOrEqual(appBarBox!.y + appBarBox!.height);
    expect(expandedBox!.height).toBeGreaterThan(320);
    expect(expandedBox!.height).toBeLessThanOrEqual(previewGeometry.preview.height);
    expect(expandedBox!.x).toBeGreaterThan(previewGeometry.preview.x);
    expect(await readPreviewGeometry()).toEqual(previewGeometry);

    await terminal.getByRole("button", { name: "Close" }).click();

    await expect(terminal).toHaveCount(0);
    if (await showPreviewControls.isVisible()) {
      await showPreviewControls.click();
    }
    await expect(showOutput).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await readPreviewGeometry()).toEqual(previewGeometry);
    expect(await previewReceivesPointerAtCenter()).toBe(true);

    await showOutput.click();
    await expect(terminal).toContainText("ready");
  });
}

test("@preview-lifecycle long-running output errors do not push the terminal host down", async ({ page }) => {
  await mockLaunchTerminalSocket(page, {
    terminalErrorDelayMs: 120
  });
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  const terminal = page.locator(".vibe64-launch-controls__terminal--embedded");
  await page.getByRole("button", { name: "Show run output" }).click();

  const terminalHost = terminal.locator(".vibe64-terminal-surface__host");
  await expect(terminalHost).toBeVisible();
  const hostTopBefore = await terminalHost.evaluate((element) => element.getBoundingClientRect().top);

  await expect(page.getByText("No command running.")).toBeVisible();
  const hostTopAfter = await terminalHost.evaluate((element) => element.getBoundingClientRect().top);

  expect(Math.abs(hostTopAfter - hostTopBefore)).toBeLessThan(1);
});

test("@preview-lifecycle an opened long-running output stays open after the launch exits", async ({ page }) => {
  await mockLaunchTerminalSocket(page, {
    terminalExitCode: 1,
    terminalExitDelayMs: 120
  });
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const terminal = page.locator(".vibe64-launch-controls__terminal--embedded");
  await expect(terminal).toHaveCount(0);
  await page.getByRole("button", { name: "Show run output" }).click();
  const terminalHost = terminal.locator(".vibe64-terminal-surface__host");
  await expect(terminalHost).toBeVisible();
  const hostHeightBefore = await terminalHost.evaluate((element) => element.getBoundingClientRect().height);

  await expect(page.getByText("Exited with code 1", { exact: true })).toBeVisible();
  await expect(terminal).toBeVisible();
  const hostHeightAfter = await terminalHost.evaluate((element) => element.getBoundingClientRect().height);

  expect(hostHeightBefore).toBeGreaterThan(320);
  expect(hostHeightAfter).toBeGreaterThan(320);
  expect(Math.abs(hostHeightAfter - hostHeightBefore)).toBeLessThan(1);
});

for (const width of [1440, 390]) {
  test(`@chat-responsive confirmed Send permits steering before HTTP finishes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockLaunchTerminalSocket(page);
    const session = sessionPayload();
    const conversationLog: unknown[] = [];
    await mockLaunchSession(page, { assistantAccess: PERSONAL_ASSISTANT_ACCESS, conversationLog, session });
    const requests: Record<string, unknown>[] = [];
    let releaseFirst!: () => void;
    const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve; });
    await page.route(`${BASE_URL}${SCOPED_API_PREFIX}/vibe64/sessions/${SESSION_ID}/agent-message`, async (route) => {
      const payload = route.request().postDataJSON();
      requests.push(payload);
      if (requests.length === 1) {
        await firstResponse;
        await fulfillJson(route, { ok: false, error: "Late transport failure" }, { status: 500 });
      } else {
        await fulfillJson(route, { ok: true, delivered: true, messageId: payload.messageId });
      }
    });
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      const composer = page.getByLabel("Message AI assistant");
      await composer.fill("Inspect the booking form");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect.poll(() => requests.length).toBe(1);
      await expect(page.getByRole("button", { name: "Sending message" })).toBeVisible();
      const turn = {
        turnId: "000001",
        user: {
          at: new Date().toISOString(),
          messageId: requests[0].messageId,
          role: "user",
          text: "Inspect the booking form"
        }
      };
      conversationLog.push(turn);
      session.revision = 2;
      Object.assign(session.agentSession.turn, { active: true, id: "turn-responsive", state: "active" });
      await publishChatSessionChange(page, {
        agentSession: session.agentSession,
        conversationLogPatch: { type: "upsert-turn", turn },
        reason: "codex-app-server-message-delivered",
        revision: 2,
        sessionId: SESSION_ID
      });
      await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
      await composer.fill("Check the mobile form too");
      await page.getByRole("button", { name: "Steer assistant", exact: true }).click();
      await expect.poll(() => requests.length).toBe(2);
      expect(requests[1].message).toBe("Check the mobile form too");
      await expect(composer).toHaveValue("");
      await composer.fill("Preserve this next draft");
      releaseFirst();
      await expect(composer).toHaveValue("Preserve this next draft");
      await expect(page.getByRole("button", { name: "Steer assistant", exact: true })).toBeEnabled();
      await expect(page.getByText("Late transport failure", { exact: true })).toHaveCount(0);
    } finally {
      releaseFirst();
    }
  });

  test(`@chat-responsive confirmed Stop permits a new Send before HTTP finishes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockLaunchTerminalSocket(page);
    const session = sessionPayload();
    Object.assign(session.agentSession.turn, { active: true, id: "turn-stopping", state: "active" });
    const requests: TemporaryAiRecoveryRequests = { mainMessages: [], temporaryStarts: [], temporaryTurns: [] };
    await mockLaunchSession(page, {
      assistantAccess: PERSONAL_ASSISTANT_ACCESS,
      session,
      temporaryAiRecoveryRequests: requests
    });
    let stopRequests = 0;
    let releaseStop!: () => void;
    const stopResponse = new Promise<void>((resolve) => { releaseStop = resolve; });
    await page.route(`${BASE_URL}${SCOPED_API_PREFIX}/vibe64/sessions/${SESSION_ID}/agent-turn/interrupt`, async (route) => {
      stopRequests += 1;
      await stopResponse;
      await fulfillJson(route, { ok: true });
    });
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await expect.poll(() => stopRequests).toBe(1);
      await expect(page.getByRole("button", { name: "Stopping…", exact: true })).toBeDisabled();
      session.revision = 2;
      Object.assign(session.agentSession.turn, { active: false, state: "idle" });
      await publishChatSessionChange(page, {
        agentSession: session.agentSession,
        reason: "codex-app-server-turn-idle",
        revision: 2,
        sessionId: SESSION_ID
      });
      const composer = page.getByLabel("Message AI assistant");
      await composer.fill("fdd");
      await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect.poll(() => requests.mainMessages.length).toBe(1);
      expect(requests.mainMessages[0].message).toBe("fdd");
      await composer.fill("Next draft survives Stop completion");
      releaseStop();
      await expect(composer).toHaveValue("Next draft survives Stop completion");
      await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
    } finally {
      releaseStop();
    }
  });
}

for (const width of [1440, 390]) {
  test(`@chat-stress only the exact receipt acknowledges Send at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const chat = await responsiveChatHarness(page);
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      await chat.composer.fill("Check the booking flow");
      await chat.send.click();
      await expect.poll(() => chat.messages.length).toBe(1);
      await chat.receipt(0, { messageId: "unrelated-message" });
      await chat.publish({
        reason: "codex-app-server-commentary",
        conversationLogPatch: { type: "upsert-turn", turn: {
          turnId: "000003",
          commentary: [{ role: "assistant", at: new Date().toISOString(), text: "An unrelated update arrived." }]
        } }
      });
      await expect(page.getByRole("button", { name: "Sending message" })).toBeDisabled();
      await chat.composer.fill("Keep typing while delivery is pending");
      await chat.composer.press("Enter");
      await chat.composer.press("Enter");
      expect(chat.messages.length).toBe(1);
      await chat.receipt(0);
      await chat.receipt(0);
      await expect(chat.steer).toBeEnabled();
      await chat.steer.click();
      await expect.poll(() => chat.messages.length).toBe(2);
      expect(chat.messages[1].body.message).toBe("Keep typing while delivery is pending");
      expect(chat.messages[0].settled).toBe(false);
      await chat.messages[1].finish();
      expect(chat.errors).toEqual([]);
    } finally { await chat.close(); }
  });

  test(`@chat-stress HTTP acceptance works without a realtime receipt at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const chat = await responsiveChatHarness(page);
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      await chat.composer.fill("First message");
      await chat.send.click();
      await expect.poll(() => chat.messages.length).toBe(1);
      await chat.composer.fill("Second draft");
      await chat.messages[0].finish();
      await expect(chat.send).toBeEnabled();
      await expect(chat.composer).toHaveValue("Second draft");
      await chat.send.click();
      await expect.poll(() => chat.messages.length).toBe(2);
      expect(chat.messages[1].body.messageId).not.toBe(chat.messages[0].body.messageId);
      await chat.messages[1].finish();
      expect(chat.errors).toEqual([]);
    } finally { await chat.close(); }
  });

  test(`@chat-stress failed Send resends the same message and keeps a newer draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const chat = await responsiveChatHarness(page);
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      await chat.composer.fill("The original message");
      await chat.send.click();
      await expect.poll(() => chat.messages.length).toBe(1);
      await chat.composer.fill("My next draft stays here");
      await chat.messages[0].finish({ ok: false, error: "Deliberate delivery failure" }, 503);
      await expect(page.getByText("Deliberate delivery failure", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: /Resend/u }).click();
      await expect.poll(() => chat.messages.length).toBe(2);
      expect(chat.messages[1].body.messageId).toBe(chat.messages[0].body.messageId);
      expect(chat.messages[1].body.message).toBe("The original message");
      await chat.receipt(1);
      await expect(chat.steer).toBeEnabled();
      await expect(chat.composer).toHaveValue("My next draft stays here");
      expect(chat.errors).toEqual([]);
    } finally { await chat.close(); }
  });

  test(`@chat-stress Stop ignores another turn and late failure cannot disturb a new Stop at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const chat = await responsiveChatHarness(page, { active: true });
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      await chat.stop.click();
      await expect.poll(() => chat.interrupts.length).toBe(1);
      await chat.turn(false, "unrelated-turn");
      await chat.composer.fill("A draft after Stop");
      await expect(chat.send).toBeDisabled();
      await chat.turn(false, "turn-stress");
      await expect(chat.send).toBeEnabled();
      await chat.send.click();
      await expect.poll(() => chat.messages.length).toBe(1);
      await chat.receipt(0, { turnId: "turn-new" });
      await chat.stop.click();
      await expect.poll(() => chat.interrupts.length).toBe(2);
      await chat.interrupts[0].finish({ ok: false, error: "Old Stop response failed" }, 503);
      await expect(page.getByRole("button", { name: "Stopping…", exact: true })).toBeDisabled();
      await chat.turn(false, "turn-new");
      await chat.composer.fill("Still usable");
      await expect(chat.send).toBeEnabled();
      expect(chat.errors).toEqual([]);
    } finally { await chat.close(); }
  });

  test(`@chat-stress a rejected Stop can be retried without losing the draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const chat = await responsiveChatHarness(page, { active: true });
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      await chat.composer.fill("Keep this guidance");
      await chat.stop.click();
      await expect.poll(() => chat.interrupts.length).toBe(1);
      await chat.interrupts[0].finish({ ok: false, error: "Deliberate interrupt failure" }, 503);
      const failure = page.getByRole("alert").filter({ hasText: "Deliberate interrupt failure" });
      await expect(failure).toBeVisible();
      await expect(chat.stop).toBeEnabled();
      await expect(chat.steer).toBeEnabled();
      await expect(chat.composer).toHaveValue("Keep this guidance");
      await chat.stop.click();
      await expect.poll(() => chat.interrupts.length).toBe(2);
      await expect(failure).toBeHidden();
      await chat.interrupts[1].finish({ ok: false, error: "Deliberate interrupt failure" }, 503);
      await expect(failure).toBeVisible();
      await chat.stop.click();
      await expect.poll(() => chat.interrupts.length).toBe(3);
      await expect(failure).toBeHidden();
      await chat.turn(false, "turn-stress");
      await expect(chat.send).toBeEnabled();
      expect(chat.errors).toEqual([]);
    } finally { await chat.close(); }
  });

  test(`@chat-stress Stop acknowledgement does not wait for a held session refresh at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const chat = await responsiveChatHarness(page, { active: true });
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    let refreshes = 0;
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      await expect(chat.stop).toBeEnabled();
      await page.route(`${BASE_URL}${SCOPED_API_PREFIX}/vibe64/sessions/${SESSION_ID}`, async (route) => {
        refreshes += 1;
        await refreshGate;
        await fulfillJson(route, { ok: true, ...chat.sessions[0] });
      });
      await chat.composer.fill("Input remains available");
      await chat.stop.click();
      await expect.poll(() => chat.interrupts.length).toBe(1);
      await chat.interrupts[0].finish();
      await expect.poll(() => refreshes).toBeGreaterThan(0);
      await expect(chat.stop).toBeEnabled();
      await expect(chat.steer).toBeEnabled();
      await chat.turn(false, "turn-stress");
      await expect(chat.send).toBeEnabled();
      await chat.send.click();
      await expect.poll(() => chat.messages.length).toBe(1);
      expect(chat.messages[0].body.message).toBe("Input remains available");
      expect(chat.errors).toEqual([]);
    } finally { releaseRefresh(); await chat.close(); }
  });

  for (const operation of ["Send", "Stop"]) {
    test(`@chat-stress switching sessions during ${operation} preserves independent drafts at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const chat = await responsiveChatHarness(page, { active: operation === "Stop", twoSessions: true });
      try {
        await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
        await chat.visible.locator(".studio-ai-sessions__tab", { hasText: "Alpha" }).click();
        if (operation === "Stop") {
          await chat.stop.click();
          await expect.poll(() => chat.interrupts.length).toBe(1);
        } else {
          await chat.composer.fill("Alpha's pending message");
          await chat.send.click();
          await expect.poll(() => chat.messages.length).toBe(1);
        }
        await chat.composer.fill("Alpha's next draft");
        await chat.visible.locator(".studio-ai-sessions__tab", { hasText: "Beta" }).click();
        await chat.composer.fill("Beta's message");
        await chat.send.click();
        const index = operation === "Stop" ? 0 : 1;
        await expect.poll(() => chat.messages.length).toBe(index + 1);
        expect(chat.messages[index].sessionId).toBe(`${SESSION_ID}-beta`);
        await chat.messages[index].finish();
        await chat.composer.fill("Beta's next draft");
        await (operation === "Stop" ? chat.interrupts[0] : chat.messages[0])
          .finish({ ok: false, error: "Alpha's late failure" }, 503);
        await expect(chat.composer).toHaveValue("Beta's next draft");
        await expect(chat.send).toBeEnabled();
        if (operation === "Stop") {
          await expect(page.getByRole("button", { name: "Stopping…", exact: true, includeHidden: true })).toHaveCount(0);
          await expect(page.getByRole("alert").filter({ hasText: "Alpha's late failure" })).toBeHidden();
        }
        await chat.visible.locator(".studio-ai-sessions__tab", { hasText: "Alpha" }).click();
        await expect(chat.composer).toHaveValue("Alpha's next draft");
        expect(chat.errors).toEqual([]);
      } finally { await chat.close(); }
    });
  }

  test(`@chat-stress saved-commit Deslop settles its actual banner before HTTP at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const chat = await responsiveChatHarness(page);
    await page.route(`${BASE_URL}${SCOPED_API_PREFIX}/vibe64/sessions/${SESSION_ID}/work`, async (route) => {
      await fulfillJson(route, { ok: true, unsaved: true, operation: null, updateOperation: null });
    });
    await page.route(`${BASE_URL}${SCOPED_API_PREFIX}/vibe64/sessions/${SESSION_ID}/save`, async (route) => {
      await fulfillJson(route, { ok: true, status: "saved", reconciled: true, saveCommit: "a".repeat(40) });
    });
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      await page.getByRole("button", { name: "Save selected session work", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Work saved", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: /Deslop|Clean up/iu }).click();
      await expect.poll(() => chat.messages.length).toBe(1);
      expect(chat.messages[0].body.genesisTask).toBe("deslop");
      expect(chat.messages[0].body.message).toBe(`Deslop commit ${"a".repeat(40)}.`);
      await expect(page.getByRole("button", { name: "Starting…", exact: true })).toBeDisabled();
      await chat.receipt(0);
      await expect(page.getByText("Work saved", { exact: true })).toHaveCount(0);
      await expect(chat.stop).toBeEnabled();
      expect(chat.messages[0].settled).toBe(false);
      await chat.stop.click();
      await expect.poll(() => chat.interrupts.length).toBe(1);
      await chat.turn(false, "turn-stress");
      await chat.composer.fill("Continue after stopping Deslop");
      await expect(chat.send).toBeEnabled();
      expect(chat.errors).toEqual([]);
    } finally { await chat.close(); }
  });

  test(`@chat-stress reconnect recovers a missed receipt without waiting for Send HTTP at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const chat = await responsiveChatHarness(page);
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      await chat.composer.fill("Accepted while connection was lost");
      await chat.send.click();
      await expect.poll(() => chat.messages.length).toBe(1);
      await page.context().setOffline(true);
      await chat.receipt(0, { publishReceipt: false });
      await chat.composer.fill("Draft survives reconnect");
      await page.context().setOffline(false);
      await expect(chat.steer).toBeEnabled({ timeout: 20_000 });
      await expect(chat.composer).toHaveValue("Draft survives reconnect");
      expect(chat.messages[0].settled).toBe(false);
      await chat.steer.click();
      await expect.poll(() => chat.messages.length).toBe(2);
      expect(chat.errors).toEqual([]);
    } finally { await page.context().setOffline(false); await chat.close(); }
  });

  test(`@chat-stress repeated Send and Stop preserve typing through a long history at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const history = Array.from({ length: 150 }, (_, index) => ({
      turnId: String(index + 1).padStart(6, "0"),
      user: { role: "user", at: new Date().toISOString(), messageId: `history-${index}`, text: `Historical request ${index}.` },
      assistant: { role: "assistant", at: new Date().toISOString(), text: `Historical answer ${index}.\n\n${"Detailed implementation evidence. ".repeat(15)}` }
    }));
    const chat = await responsiveChatHarness(page, { history });
    try {
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      await expect(chat.composer).toBeVisible();
      await page.evaluate(() => {
        const samples: number[] = [];
        const slowInputs: { duration: number; insertedLength: number; valueLength: number }[] = [];
        (window as any).__chatInputPaintSamples = samples;
        (window as any).__chatSlowInputs = slowInputs;
        document.addEventListener("input", (event) => {
          if ((event.target as Element)?.getAttribute("aria-label") === "Message AI assistant") {
            const started = performance.now();
            const insertedLength = (event as InputEvent).data?.length || 0;
            const valueLength = (event.target as HTMLTextAreaElement).value.length;
            requestAnimationFrame(() => {
              const duration = performance.now() - started;
              samples.push(duration);
              if (duration > 100) slowInputs.push({ duration, insertedLength, valueLength });
            });
          }
        }, true);
      });
      for (let cycle = 0; cycle < 5; cycle += 1) {
        await chat.composer.fill(`Cycle ${cycle}: inspect the booking flow`);
        await chat.send.click();
        await expect.poll(() => chat.messages.length).toBe(cycle + 1);
        await chat.composer.pressSequentially("Keep the typed draft.", { delay: 5 });
        await chat.receipt(cycle, { turnId: `cycle-${cycle}` });
        await expect(chat.steer).toBeEnabled();
        await expect(chat.composer).toHaveValue("Keep the typed draft.");
        await chat.stop.click();
        await expect.poll(() => chat.interrupts.length).toBe(cycle + 1);
        await chat.turn(false, `cycle-${cycle}`);
        await expect(chat.send).toBeEnabled();
        await expect(chat.composer).toHaveValue("Keep the typed draft.");
      }
      for (const request of [...chat.messages, ...chat.interrupts].reverse()) {
        await request.finish();
      }
      await expect(chat.send).toBeEnabled();
      await expect(chat.composer).toHaveValue("Keep the typed draft.");
      const samples = await page.evaluate(() => (window as any).__chatInputPaintSamples as number[]);
      samples.sort((left, right) => left - right);
      const p95 = samples[Math.floor(samples.length * 0.95)];
      const slowInputs = await page.evaluate(() => (window as any).__chatSlowInputs);
      await testInfo.attach("input-to-next-frame.json", { body: JSON.stringify({ width, samples: samples.length, p95, max: samples.at(-1), slowInputs }), contentType: "application/json" });
      expect(samples.length).toBeGreaterThan(50);
      // Run with --trace=off for timing; trace snapshots can block frames in this large fixture.
      if (testInfo.project.use.trace === "off") expect(p95).toBeLessThan(300);
      expect(chat.errors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("chat-after-repeated-cycles.png") });
    } finally { await chat.close(); }
  });
}

for (const width of [390, 820, 1440]) {
  for (const engineId of ["codex", "opencode"]) {
    for (const outcome of ["accepted", "receipt", "rejected"]) {
      test(`@steer-clear ${engineId} clears immediately and preserves the next draft after ${outcome} at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        const chat = await responsiveChatHarness(page, { active: true, engineId });
        const original = "Do not make the cards configurable yet.";
        const nextDraft = `${original} This is a separate follow-up.`;
        try {
          await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
          await chat.composer.fill(original);
          const started = Date.now();
          await chat.steer.click();
          await expect(chat.composer).toHaveValue("", { timeout: 500 });
          expect(Date.now() - started).toBeLessThan(1_000);
          await expect.poll(() => chat.messages.length).toBe(1);
          await expect(chat.visible.getByRole("button", { name: "Sending guidance to assistant", exact: true })).toBeDisabled();
          await chat.composer.pressSequentially(nextDraft, { delay: 5 });
          await expect(chat.composer).toHaveValue(nextDraft);
          expect(chat.messages[0].settled).toBe(false);
          await page.screenshot({ path: testInfo.outputPath("draft-while-steering-pending.png"), animations: "disabled" });

          if (outcome === "receipt") {
            await chat.receipt(0);
            await expect(chat.steer).toBeEnabled();
            expect(chat.messages[0].settled).toBe(false);
            await chat.messages[0].finish({ ok: false, error: "Late delivery error" }, 500);
            await expect(page.getByText("Late delivery error", { exact: true })).toHaveCount(0);
          } else if (outcome === "rejected") {
            await chat.messages[0].finish({ ok: false, error: "Guidance was not delivered." }, 409);
            await expect(chat.visible.getByText("Guidance was not delivered.", { exact: true })).toBeVisible();
            await expect(chat.steer).toBeEnabled();
            await expect(chat.composer).toHaveValue(nextDraft);
            await chat.visible.getByRole("button", { name: "Resend", exact: true }).click();
            await expect.poll(() => chat.messages.length).toBe(2);
            expect(chat.messages[1].body.messageId).toBe(chat.messages[0].body.messageId);
            expect(chat.messages[1].body.message).toBe(original);
            await chat.receipt(1);
            await chat.messages[1].finish();
          } else {
            await chat.messages[0].finish();
            await expect(chat.steer).toBeEnabled();
            await chat.receipt(0);
          }
          await expect(chat.composer).toHaveValue(nextDraft);
          await expect(chat.steer).toBeEnabled();
          await expect(chat.visible.getByText(original, { exact: true })).toHaveCount(1);
          await expect(chat.stop).toBeEnabled();
          expect(chat.errors).toEqual([]);
        } finally { await chat.close(); }
      });
    }
  }
}

type HeldChatRequest = {
  body: Record<string, unknown>;
  sessionId: string;
  settled: boolean;
  finish(body?: Record<string, unknown>, status?: number): Promise<void>;
};

async function responsiveChatHarness(page: Page, {
  active = false,
  engineId = "",
  twoSessions = false,
  history = []
}: { active?: boolean; engineId?: string; twoSessions?: boolean; history?: unknown[] } = {}) {
  page.setDefaultTimeout(10_000);
  await mockLaunchTerminalSocket(page);
  const sessions = [sessionPayload({ sessionName: twoSessions ? "Alpha" : "Renderer session" })];
  if (twoSessions) sessions.push(sessionPayload({ sessionId: `${SESSION_ID}-beta`, sessionName: "Beta" }));
  const assistantCatalog = engineId ? assistantCatalogPayload({ includeOpenCode: true }) : undefined;
  if (assistantCatalog) {
    const engine = assistantCatalog.engines.find((item) => item.engineId === engineId)!;
    Object.assign(sessions[0].assistantSelection, { ...engine.defaults, engineId });
    Object.assign(sessions[0].agentSession, { providerId: engineId, transportId: engine.transportId });
  }
  Object.assign(sessions[0].agentSession.turn, { active, id: "turn-stress", state: active ? "active" : "idle" });
  const conversationLog = [...history];
  await mockLaunchSession(page, { assistantAccess: PERSONAL_ASSISTANT_ACCESS, assistantCatalog, conversationLog, session: sessions[0], sessionList: sessions });
  const messages: HeldChatRequest[] = [];
  const interrupts: HeldChatRequest[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/\/vibe64\/sessions\/[^/]+\/(?:agent-message|agent-turn\/interrupt)$/u, async (route) => {
    const request = route.request();
    const response = Promise.withResolvers<{ body: Record<string, unknown>; status: number }>();
    const finished = Promise.withResolvers<void>();
    const record: HeldChatRequest = {
      body: request.postDataJSON(),
      sessionId: new URL(request.url()).pathname.split("/sessions/")[1].split("/")[0],
      settled: false,
      async finish(body = { ok: true, delivered: true }, status = 200) {
        if (!record.settled) {
          record.settled = true;
          response.resolve({ body, status });
        }
        await finished.promise;
      }
    };
    (request.url().endsWith("/agent-message") ? messages : interrupts).push(record);
    const result = await response.promise;
    try { await fulfillJson(route, result.body, { status: result.status }); }
    finally { finished.resolve(); }
  });
  const visible = page.locator(".studio-autopilot__chat-panel:visible");
  async function publish(change: Record<string, unknown>, sessionId = SESSION_ID) {
    const session = sessions.find((item) => item.sessionId === sessionId)!;
    session.revision += 1;
    await publishChatSessionChange(page, { agentSession: session.agentSession, sessionId, revision: session.revision, ...change });
  }
  return {
    composer: visible.getByLabel("Message AI assistant"),
    errors, interrupts, messages, publish, sessions, visible,
    send: visible.getByRole("button", { name: "Send message", exact: true }),
    steer: visible.getByRole("button", { name: "Steer assistant", exact: true }),
    stop: visible.getByRole("button", { name: "Stop", exact: true }),
    async close() { await Promise.all([...messages, ...interrupts].map((request) => request.finish())); },
    async turn(active: boolean, id: string) {
      Object.assign(sessions[0].agentSession.turn, { active, id, state: active ? "active" : "idle" });
      await publish({ reason: active ? "codex-app-server-turn-active" : "codex-app-server-turn-idle" });
    },
    async receipt(index: number, { messageId = "", turnId = "turn-stress", publishReceipt = true } = {}) {
      const request = messages[index];
      const session = sessions.find((item) => item.sessionId === request.sessionId)!;
      Object.assign(session.agentSession.turn, { active: true, id: turnId, state: "active" });
      const id = messageId || request.body.messageId;
      const previous = conversationLog.find((item: any) => item.user?.messageId === id) as { turnId: string } | undefined;
      const turn = {
        turnId: previous?.turnId || String(conversationLog.length + 1).padStart(6, "0"),
        user: { role: "user", at: new Date().toISOString(), messageId: id, text: request.body.displayMessage || request.body.message }
      };
      if (!conversationLog.some((item: any) => item.user?.messageId === id)) conversationLog.push(turn);
      if (publishReceipt) {
        await publish({ reason: "codex-app-server-message-delivered", conversationLogPatch: { type: "upsert-turn", turn } }, request.sessionId);
      } else {
        session.revision += 1;
      }
    }
  };
}

async function publishChatSessionChange(page: Page, payload: Record<string, unknown>) {
  await page.evaluate((change) => {
    const app = (document.querySelector("#app") as unknown as {
      __vue_app__: { _context: { provides: Record<string, {
        onevent(packet: { data: unknown[] }): void;
      }> } };
    }).__vue_app__;
    app._context.provides["jskit.realtime.runtime.client.socket"].onevent({
      data: ["vibe64.session.changed", change]
    });
  }, payload);
}

async function mockLaunchSession(page: Page, {
  agentTerminalControlOutcomes = [],
  assistantAccess = null,
  assistantCatalog = assistantCatalogPayload(),
  attachmentUploadOutcomes = [],
  attachmentUploadResponseDelayMs = 0,
  conversationLog = [],
  initialLaunchStatus = null,
  launchStatusSequence = null,
  launchTerminalDelayMs = 0,
  previewBootstrapToken = "",
  previewIdentity = null,
  previewIdentityExchange = null,
  previewIdentityExchangeDelayMs = 0,
  previewModuleFailureCount = 0,
  previewResponseDelayMs = 0,
  previewModuleDelayMs = 0,
  session = sessionPayload(),
  sessionList = null,
  sourceEditorFiles = null,
  sourceExplanationResponses = [],
  sessionCreationDeferred = false,
  sessionCreationOutcomes = [],
  sessionListDelayMs = 0,
  sharedDevelopmentDatabase = false,
  temporaryAiRecoveryRequests = null
}: {
  agentTerminalControlOutcomes?: Array<"failure" | "success">;
  assistantAccess?: Record<string, unknown> | null;
  assistantCatalog?: ReturnType<typeof assistantCatalogPayload>;
  attachmentUploadOutcomes?: Array<"failure" | "success">;
  attachmentUploadResponseDelayMs?: number;
  conversationLog?: unknown[];
  initialLaunchStatus?: ReturnType<typeof launchStatusPayload> | null;
  launchStatusSequence?: unknown[] | null;
  launchTerminalDelayMs?: number;
  previewBootstrapToken?: string;
  previewIdentity?: Record<string, unknown> | null;
  previewIdentityExchange?: ((selection: PreviewIdentitySelection) => PreviewIdentityExchangeResult) | null;
  previewIdentityExchangeDelayMs?: number;
  previewModuleFailureCount?: number;
  previewResponseDelayMs?: number;
  previewModuleDelayMs?: number;
  session?: ReturnType<typeof sessionPayload>;
  sessionList?: ReturnType<typeof sessionPayload>[] | null;
  sourceEditorFiles?: Record<string, string> | null;
  sourceExplanationResponses?: SourceExplanationResponse[];
  sessionCreationDeferred?: boolean;
  sessionCreationOutcomes?: Array<"failure" | "success">;
  sessionListDelayMs?: number;
  sharedDevelopmentDatabase?: boolean;
  temporaryAiRecoveryRequests?: TemporaryAiRecoveryRequests | null;
} = {}) {
  let listedSessions = Array.isArray(sessionList) ? [...sessionList] : [session];
  const sourceEditor = sourceEditorFiles ? createSourceEditorMock(sourceEditorFiles) : null;
  const queuedSourceExplanationResponses = [...sourceExplanationResponses];
  const launchStartPayloads: unknown[] = [];
  const previewIdentityGrants = new Map<string, PreviewIdentitySelection>();
  const previewIdentitySelections: PreviewIdentitySelection[] = [];
  const agentTerminalControlPayloads: Record<string, unknown>[] = [];
  const attachmentDeletes: string[] = [];
  const attachmentUploads: AttachmentUpload[] = [];
  const queuedAgentTerminalControlOutcomes = [...agentTerminalControlOutcomes];
  const queuedAttachmentUploadOutcomes = [...attachmentUploadOutcomes];
  const sequencedLaunchStatuses = Array.isArray(launchStatusSequence) ? launchStatusSequence : [];
  const queuedSessionCreationOutcomes = [...sessionCreationOutcomes];
  const sessionCreationReleases: Array<() => void> = [];
  let launchStarted = sequencedLaunchStatuses.length > 0
    ? Boolean((sequencedLaunchStatuses[0] as { activeTerminal?: unknown })?.activeTerminal)
    : !initialLaunchStatus || Boolean(initialLaunchStatus.activeTerminal);
  let initialLaunchStatusActive = true;
  let launchStatusReadCount = 0;
  let launchStatusSequenceIndex = 0;
  let previewLoadCount = 0;
  let previewModuleCompleted = false;
  let previewModuleRequestCount = 0;
  let previewIdentityGrantSequence = 0;
  let sessionCreationRequestCount = 0;
  const previewServer = previewBootstrapToken
    ? await startPreviewAppServer({
        bootstrapToken: previewBootstrapToken,
        responseDelayMs: previewResponseDelayMs,
        targetOrigin: new URL(TARGET_APP_URL).origin
      })
    : null;
  const proxyAppUrl = previewServer?.href || PROXY_APP_URL;
  const previewHref = previewBootstrapToken
    ? `${proxyAppUrl}?vibe64_preview_token=${encodeURIComponent(previewBootstrapToken)}`
    : proxyAppUrl;
  function currentLaunchStatus() {
    if (sequencedLaunchStatuses.length > 0 && !launchStarted) {
      const index = Math.min(launchStatusSequenceIndex, sequencedLaunchStatuses.length - 1);
      launchStatusSequenceIndex += 1;
      return sequencedLaunchStatuses[index];
    }
    if (initialLaunchStatusActive && initialLaunchStatus) {
      return initialLaunchStatus;
    }
    return launchStatusPayload(launchStarted
      ? { previewHref, previewIdentity }
      : {
          activeTerminal: null,
          previewHref,
          previewIdentity
        });
  }
  function sessionForRequest(pathname: string) {
    const requestedSessionId = decodeURIComponent(pathname.split("/").at(-1) || "");
    if (session.sessionId === requestedSessionId) {
      return session;
    }
    return listedSessions.find((item) => item.sessionId === requestedSessionId) || session;
  }
  async function waitForSessionCreationRelease() {
    if (!sessionCreationDeferred) {
      return;
    }
    await new Promise<void>((resolve) => {
      sessionCreationReleases.push(resolve);
    });
  }
  let sharedDevelopmentDatabaseActive = sharedDevelopmentDatabase;
  function currentSessionCreationPolicy() {
    const openSessionCount = listedSessions.filter((item) => item.status !== "archived").length;
    const maxOpenSessions = sharedDevelopmentDatabaseActive ? 1 : 3;
    const canCreate = openSessionCount < maxOpenSessions;
    return {
      creation: {
        canCreate,
        mode: "direct",
        showCreateAction: sharedDevelopmentDatabaseActive ? canCreate : true,
        ...(!canCreate
          ? {
              disabledReason: sharedDevelopmentDatabaseActive
                ? "This project shares one development database. Archive its open session before creating another."
                : "Studio allows up to 3 open sessions. Archive one before creating another."
            }
          : {})
      },
      limits: {
        maxOpenSessions,
        openSessionCount
      }
    };
  }
  await mockProjectGateReady(page);
  await page.route("**/vibe64/onboarding?*", async (route) => {
    await fulfillJson(route, {
      ok: true,
      inspection: { state: "ready" },
      templates: []
    });
  });
  await page.route(
    /\/api(?:\/app\/[^/]+)?\/vibe64\/assistants\/capabilities(?:\?.*)?$/u,
    async (route) => {
      await fulfillJson(route, assistantCatalog);
    }
  );
  await page.route(/\/api(?:\/app\/[^/]+)?\/vibe64\/sessions(?:\/.*)?(?:\?.*)?$/u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "POST" && url.pathname.endsWith("/vibe64/sessions")) {
      sessionCreationRequestCount += 1;
      const policy = currentSessionCreationPolicy();
      if (policy.creation.canCreate !== true) {
        await fulfillJson(route, {
          code: "vibe64_session_creation_limit",
          error: policy.creation.disabledReason,
          ok: false
        }, {
          status: 409
        });
        return;
      }
      await waitForSessionCreationRelease();
      const outcome = queuedSessionCreationOutcomes.shift() || "success";
      if (outcome === "failure") {
        await fulfillJson(route, {
          code: "vibe64_session_create_test_failure",
          error: "Session creation failed for this test.",
          ok: false
        }, {
          status: 500
        });
        return;
      }
      const createdSession = sessionPayload({
        sessionId: `session-created-${sessionCreationRequestCount}`,
        sessionName: `Created ${sessionCreationRequestCount}`
      });
      listedSessions = [...listedSessions, createdSession];
      await fulfillJson(route, {
        ...currentSessionCreationPolicy(),
        ok: true,
        ...createdSession
      });
      return;
    }
    if (method === "POST" && /\/sessions\/[^/]+\/archive$/u.test(url.pathname)) {
      const archivedSessionId = decodeURIComponent(url.pathname.split("/").at(-2) || "");
      listedSessions = listedSessions.map((item) => (
        item.sessionId === archivedSessionId
          ? {
              ...item,
              status: "archived"
            }
          : item
      ));
      await fulfillJson(route, {
        ok: true,
        sessionId: archivedSessionId,
        status: "archived"
      });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/outputs")) {
      launchStatusReadCount += 1;
      await fulfillJson(route, currentLaunchStatus());
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/output-runs")) {
      launchStartPayloads.push(request.postDataJSON());
      if (launchTerminalDelayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, launchTerminalDelayMs);
        });
      }
      initialLaunchStatusActive = false;
      launchStarted = true;
      await fulfillJson(route, {
        ok: true,
        ...launchStatusPayload({ previewHref, previewIdentity }).activeTerminal
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/preview-identity")) {
      const requestedIdentity = normalizePreviewIdentitySelection(
        request.postDataJSON(),
        previewIdentity
      );
      const grant = `preview-identity-grant-${++previewIdentityGrantSequence}`;
      previewIdentityGrants.set(grant, requestedIdentity);
      previewIdentitySelections.push(requestedIdentity);
      await fulfillJson(route, {
        grant,
        ok: true,
        requestedIdentity
      });
      return;
    }
    if (method === "POST" && /\/output-runs\/[^/]+\/stop$/u.test(url.pathname)) {
      initialLaunchStatusActive = false;
      launchStarted = false;
      await fulfillJson(route, {
        id: "server-launch-terminal",
        ok: true,
        running: false,
        status: "exited"
      });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/conversation-log")) {
      await fulfillJson(route, {
        conversationLog,
        ok: true,
        sessionId: decodeURIComponent(url.pathname.split("/").at(-2) || "")
      });
      return;
    }
    if (assistantAccess && method === "GET" && url.pathname.endsWith("/assistant-access")) {
      await fulfillJson(route, assistantAccess);
      return;
    }
    if (temporaryAiRecoveryRequests && method === "POST" && url.pathname.endsWith("/agent-message")) {
      const payload = request.postDataJSON() as Record<string, unknown>;
      temporaryAiRecoveryRequests.mainMessages.push(payload);
      await fulfillJson(route, {
        delivered: true,
        messageId: String(payload.messageId || ""),
        ok: true,
        sessionId: SESSION_ID
      });
      return;
    }
    if (
      temporaryAiRecoveryRequests &&
      method === "POST" &&
      url.pathname.endsWith("/temporary-conversations")
    ) {
      temporaryAiRecoveryRequests.temporaryStarts.push(
        request.postDataJSON() as Record<string, unknown>
      );
      await fulfillJson(route, {
        conversationId: "temporary-preview-identity",
        ok: true
      });
      return;
    }
    if (
      temporaryAiRecoveryRequests &&
      method === "POST" &&
      url.pathname.endsWith("/temporary-conversations/temporary-preview-identity/turns")
    ) {
      temporaryAiRecoveryRequests.temporaryTurns.push(
        request.postDataJSON() as Record<string, unknown>
      );
      await fulfillJson(route, {
        ok: true,
        runId: "temporary-preview-identity-run",
        status: "inProgress"
      });
      return;
    }
    if (
      temporaryAiRecoveryRequests &&
      method === "GET" &&
      url.pathname.endsWith("/temporary-conversations/temporary-preview-identity")
    ) {
      await fulfillJson(route, {
        message: "Temporary identity recovery complete.",
        ok: true,
        runId: "temporary-preview-identity-run",
        status: "completed"
      });
      return;
    }
    if (
      method === "POST" &&
      /\/agent-terminal\/[^/]+\/control\/text$/u.test(url.pathname)
    ) {
      const payload = request.postDataJSON() as Record<string, unknown>;
      agentTerminalControlPayloads.push(payload);
      if (queuedAgentTerminalControlOutcomes.shift() === "failure") {
        await fulfillJson(route, {
          error: "The test terminal rejected the attachment path.",
          ok: false
        }, {
          status: 503
        });
        return;
      }
      await fulfillJson(route, {
        ok: true
      });
      return;
    }
    if (method === "DELETE" && /\/agent-attachments\/[^/]+$/u.test(url.pathname)) {
      attachmentDeletes.push(decodeURIComponent(url.pathname.split("/").at(-1) || ""));
      await fulfillJson(route, {
        ok: true
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/agent-attachments")) {
      const attachment = await readMultipartAttachment(request);
      attachmentUploads.push(attachment);
      if (attachmentUploadResponseDelayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, attachmentUploadResponseDelayMs);
        });
      }
      if (queuedAttachmentUploadOutcomes.shift() === "failure") {
        await fulfillJson(route, {
          errors: [{
            code: "vibe64_agent_attachment_upload_failed",
            message: "The test upload failed before retry."
          }],
          ok: false
        }, {
          status: 503
        });
        return;
      }
      await fulfillJson(route, {
        attachmentId: `attachment-${attachmentUploads.length}`,
        contentType: attachment.contentType,
        expiresInMs: 300_000,
        fileName: attachment.fileName,
        ok: true,
        path: `/tmp/vibe64-attachments/${attachment.fileName}`,
        size: attachment.bytes.length
      });
      return;
    }
    if (sourceEditor && method === "GET" && url.pathname.endsWith("/source-editor/tree")) {
      await fulfillJson(route, sourceEditor.readTree({
        limit: Number(url.searchParams.get("limit") || 20),
        offset: Number(url.searchParams.get("offset") || 0),
        path: url.searchParams.get("path") || ""
      }));
      return;
    }
    if (sourceEditor && method === "GET" && url.pathname.endsWith("/source-editor/changes/stream")) {
      await route.fulfill({
        body: [
          "retry: 60000",
          "event: vibe64.source-editor.sync.ready",
          `data: ${JSON.stringify({
            path: url.searchParams.get("path") || "",
            sessionId: SESSION_ID
          })}`,
          ""
        ].join("\n"),
        contentType: "text/event-stream; charset=utf-8",
        status: 200
      });
      return;
    }
    if (sourceEditor && method === "GET" && url.pathname.endsWith("/source-editor/files")) {
      await fulfillJson(route, sourceEditor.listFiles(url.searchParams.get("q") || ""));
      return;
    }
    if (sourceEditor && method === "GET" && url.pathname.endsWith("/source-editor/search")) {
      await fulfillJson(route, sourceEditor.search(url.searchParams.get("q") || ""));
      return;
    }
    if (sourceEditor && method === "POST" && url.pathname.endsWith("/source-editor/resolve-path")) {
      await fulfillJson(route, sourceEditor.resolvePath(request.postDataJSON()));
      return;
    }
    if (sourceEditor && method === "GET" && url.pathname.endsWith("/source-editor/file")) {
      await fulfillJson(route, sourceEditor.readFile(url.searchParams.get("path") || ""));
      return;
    }
    if (sourceEditor && method === "PUT" && url.pathname.endsWith("/source-editor/file")) {
      await fulfillJson(route, sourceEditor.saveFile(request.postDataJSON()));
      return;
    }
    if (sourceEditor && method === "POST" && url.pathname.endsWith("/source-editor/explanations/stream")) {
      const payload = request.postDataJSON() as SourceExplanationPayload;
      const response = queuedSourceExplanationResponses.shift();
      const events = typeof response === "function" ? response(payload) : response;
      await fulfillNdjson(route, Array.isArray(events) ? events : [
        {
          explanation: sourceEditorExplanationPayload(payload, "Source explanation complete."),
          type: "source-explanation.finished"
        }
      ]);
      return;
    }
    if (method === "GET" && /\/sessions\/[^/]+$/u.test(url.pathname)) {
      await fulfillJson(route, {
        ok: true,
        ...sessionForRequest(url.pathname)
      });
      return;
    }
    if (sessionListDelayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, sessionListDelayMs);
      });
    }
    await fulfillJson(route, {
      ...currentSessionCreationPolicy(),
      ok: true,
      sessions: listedSessions.filter((item) => item.status !== "archived")
    });
  });
  if (!previewServer) {
    await page.route("http://127.0.0.1:49000/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/vibe64-test-late-module.js") {
        previewModuleRequestCount += 1;
        if (previewModuleRequestCount <= previewModuleFailureCount) {
          await route.fulfill({
            body: "Application module failed to load.",
            contentType: "text/plain",
            status: 502
          });
          return;
        }
        await new Promise((resolve) => {
          setTimeout(resolve, previewModuleDelayMs);
        });
        previewModuleCompleted = true;
        await route.fulfill({
          body: "window.__vibe64TestModuleLoaded = true;",
          contentType: "application/javascript"
        });
        return;
      }
      if (request.method() === "POST" && url.pathname === PREVIEW_IDENTITY_CONTROL_PATH) {
        const grant = String((request.postDataJSON() as { grant?: string })?.grant || "");
        const selection = previewIdentityGrants.get(grant);
        if (!selection) {
          await fulfillJson(route, {
            code: "vibe64_preview_identity_grant_invalid",
            error: "Preview identity grant is missing or invalid.",
            ok: false
          }, {
            status: 403
          });
          return;
        }
        previewIdentityGrants.delete(grant);
        if (previewIdentityExchangeDelayMs > 0) {
          await new Promise((resolve) => {
            setTimeout(resolve, previewIdentityExchangeDelayMs);
          });
        }
        const result = previewIdentityExchange?.(selection) || {
          identity: selection.mode === "guest" ? null : {
            email: selection.selector?.type === "email" ? selection.selector.value : "",
            login: selection.selector?.type === "login" ? selection.selector.value : "",
            selector: selection.selector,
            userId: "app-user",
            username: selection.displayName || selection.selector?.value
          },
          ok: true
        };
        await fulfillJson(route, result, {
          status: result.status || (result.ok === false ? 400 : 200)
        });
        return;
      }
      previewLoadCount += 1;
      if (previewResponseDelayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, previewResponseDelayMs);
        });
      }
      await route.fulfill({
        body: previewAppHtml({
          lateModule: previewModuleDelayMs > 0 || previewModuleFailureCount > 0,
          targetOrigin: new URL(TARGET_APP_URL).origin
        }),
        contentType: "text/html"
      });
    });
  }
  return {
    async close() {
      await previewServer?.close();
    },
    getLaunchStartPayloads() {
      return launchStartPayloads;
    },
    async publishLaunchReady() {
      initialLaunchStatusActive = false;
      launchStarted = true;
      // Deliver to the real listeners; onevent would buffer indefinitely because
      // this HTTP fixture does not establish a live Socket.IO connection.
      await page.evaluate((sessionId) => {
        const app = (document.querySelector("#app") as unknown as {
          __vue_app__: { _context: { provides: Record<string, {
            emitEvent(args: unknown[]): void;
          }> } };
        }).__vue_app__;
        app._context.provides["jskit.realtime.runtime.client.socket"].emitEvent(
          ["vibe64.session.changed", {
            sessionId,
            reason: "output-target-ready",
            clientRefresh: { includeOutputs: true }
          }]
        );
      }, session.sessionId);
    },
    getSessionCreationRequestCount() {
      return sessionCreationRequestCount;
    },
    setSharedDevelopmentDatabase(value: boolean) {
      sharedDevelopmentDatabaseActive = value;
    },
    releaseNextSessionCreation() {
      sessionCreationReleases.shift()?.();
    },
    getAttachmentUploads() {
      return [...attachmentUploads];
    },
    getAttachmentDeletes() {
      return [...attachmentDeletes];
    },
    getAgentTerminalControlPayloads() {
      return [...agentTerminalControlPayloads];
    },
    getLaunchStatusRequestCount() {
      return launchStatusReadCount;
    },
    getSavedText(path: string) {
      return sourceEditor?.getText(path) || "";
    },
    setText(path: string, text: string) {
      sourceEditor?.setText(path, text);
    },
    getTreeRequests() {
      return sourceEditor?.getTreeRequests() || [];
    },
    getPreviewLoadCount() {
      return previewServer?.getLoadCount() || previewLoadCount;
    },
    getPreviewModuleCompleted() {
      return previewModuleCompleted;
    },
    getPreviewModuleRequestCount() {
      return previewModuleRequestCount;
    },
    getPreviewIdentitySelections() {
      return [...previewIdentitySelections];
    }
  };
}

function previewIdentityCapability() {
  return {
    available: true,
    defaultIdentityName: "admin",
    defaultMode: "identity",
    disabledReason: "",
    identities: [
      {
        name: "admin",
        type: "email",
        value: "ada@example.com"
      },
      {
        name: "worker",
        type: "login",
        value: "merc"
      },
      {
        name: "missing",
        type: "email",
        value: "missing@example.com"
      }
    ],
    identityTypes: ["email", "login", "user-id"],
    rejectedIdentities: []
  };
}

function normalizePreviewIdentitySelection(
  value: unknown,
  capability: Record<string, unknown> | null
): PreviewIdentitySelection {
  const selection = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const mode = String(selection.mode || "identity");
  if (mode === "identity") {
    const identities = Array.isArray(capability?.identities)
      ? capability.identities as Record<string, unknown>[]
      : [];
    const requestedName = String(selection.identityName || "").trim().toLowerCase();
    const identity = requestedName && requestedName !== "default"
      ? identities.find((entry) => String(entry.name || "") === requestedName)
      : identities[0];
    const selector = normalizePreviewIdentitySelector(identity);
    return identity && selector
      ? {
          displayName: String(identity.name || ""),
          mode,
          name: String(identity.name || ""),
          selector
        }
      : { mode };
  }
  return { mode: "guest" };
}

function normalizePreviewIdentitySelector(value: unknown): PreviewIdentitySelector | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const type = String(source.type || "") as PreviewIdentitySelector["type"];
  const rawValue = String(source.value || "").trim();
  if (!["email", "login", "user-id"].includes(type) || !rawValue) {
    return null;
  }
  return {
    type,
    value: type === "email" ? rawValue.toLowerCase() : rawValue
  };
}

function escapeRegExp(value: string) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function createSourceEditorMock(initialFiles: Record<string, string>) {
  const files = new Map(Object.entries(initialFiles));
  const policy = sourceEditorFilePolicy();
  const treeRequests: Array<{
    limit: number;
    offset: number;
    path: string;
  }> = [];
  let version = 1;

  function fileHash(path: string) {
    return `${path}:${version}`;
  }

  function sourceEditorPathExcluded(filePath: string) {
    return sourceEditorSourceContractPathExcluded(filePath) ||
      policy.exclude.some((pattern) => pathMatchesPolicyPattern(filePath, pattern));
  }

  function sortedFilePaths() {
    return Array.from(files.keys())
      .filter((filePath) => !sourceEditorPathExcluded(filePath))
      .sort((left, right) => left.localeCompare(right));
  }

  function readTree(input: {
    limit?: number;
    offset?: number;
    path?: string;
  } = {}) {
    const request = {
      limit: Number(input.limit || 20),
      offset: Number(input.offset || 0),
      path: String(input.path || "")
    };
    treeRequests.push(request);
    const root = sourceEditorTreeFromPaths(sortedFilePaths());
    const directory = findSourceEditorTreeDirectory(root, request.path);
    return {
      ok: true,
      policy,
      root: "",
      tree: sourceEditorDirectoryPage(directory || {
        children: [],
        name: request.path.split("/").filter(Boolean).at(-1) || "",
        path: request.path,
        type: "directory"
      }, request)
    };
  }

  function listFiles(query: string) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    return {
      files: sortedFilePaths()
        .filter((filePath) => !normalizedQuery || filePath.toLowerCase().includes(normalizedQuery))
        .map((filePath) => ({
          language: filePath.endsWith(".js") ? "javascript" : "text",
          name: filePath.split("/").at(-1) || filePath,
          path: filePath
        })),
      ok: true,
      query,
      truncated: false
    };
  }

  function search(query: string) {
    const needle = String(query || "");
    const results: Array<Record<string, unknown>> = [];
    if (needle) {
      for (const filePath of sortedFilePaths()) {
        const lines = String(files.get(filePath) || "").split(/\r?\n/u);
        lines.forEach((line, index) => {
          const column = line.indexOf(needle);
          if (column >= 0) {
            results.push({
              column: column + 1,
              line: index + 1,
              path: filePath,
              preview: line
            });
          }
        });
      }
    }
    return {
      ok: true,
      query,
      results,
      truncated: false
    };
  }

  function readFile(filePath: string) {
    const path = String(filePath || "");
    return {
      file: {
        hash: fileHash(path),
        language: "javascript",
        path,
        text: files.get(path) || ""
      },
      ok: true,
      revealTree: sourceEditorTreeFromPaths([path])
    };
  }

  function saveFile(payload: unknown) {
    const record = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as { path?: string; text?: string }
      : {};
    const path = String(record.path || "");
    files.set(path, String(record.text ?? ""));
    version += 1;
    return readFile(path);
  }

  function resolvePath(payload: unknown) {
    const record = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as { fromPath?: string; target?: string }
      : {};
    const fromPath = String(record.fromPath || "").replaceAll("\\", "/");
    const target = String(record.target || "").replaceAll("\\", "/").split(/[?#]/u)[0];
    const fromDirectory = fromPath.split("/").slice(0, -1).join("/");
    const basePath = target.startsWith("/")
      ? target.slice(1)
      : normalizeSourceEditorMockPath(`${fromDirectory}/${target}`);
    for (const candidatePath of sourceEditorResolveMockCandidates(basePath)) {
      if (files.has(candidatePath) && !sourceEditorPathExcluded(candidatePath)) {
        return {
          file: {
            language: candidatePath.endsWith(".js") ? "javascript" : "text",
            path: candidatePath
          },
          ok: true,
          path: candidatePath,
          resolved: true,
          target
        };
      }
    }
    return {
      ok: true,
      resolved: false,
      target
    };
  }

  return {
    getText(path: string) {
      return files.get(path) || "";
    },
    getTreeRequests() {
      return [...treeRequests];
    },
    listFiles,
    readFile,
    readTree,
    resolvePath,
    saveFile,
    search,
    setText(path: string, text: string) {
      files.set(path, text);
      version += 1;
    }
  };
}

function normalizeSourceEditorMockPath(value: string) {
  const parts: string[] = [];
  for (const part of String(value || "").split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function sourceEditorResolveMockCandidates(pathValue: string) {
  const normalizedPath = normalizeSourceEditorMockPath(pathValue);
  const hasExtension = /\.[^/.]+$/u.test(normalizedPath);
  const extensions = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".json", ".css"];
  return [
    normalizedPath,
    ...(hasExtension ? [] : extensions.map((suffix) => `${normalizedPath}${suffix}`)),
    ...extensions.map((suffix) => `${normalizedPath}/index${suffix}`)
  ];
}

function sourceEditorTreeFromPaths(paths: string[]) {
  const root = {
    children: [] as Array<Record<string, unknown>>,
    loaded: false,
    name: "",
    path: "",
    type: "directory"
  };

  for (const filePath of paths) {
    let directory = root;
    const parts = filePath.split("/").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      const childPath = parts.slice(0, index + 1).join("/");
      if (index === parts.length - 1) {
        directory.children.push({
          language: name.endsWith(".js") ? "javascript" : "text",
          name,
          path: childPath,
          size: 0,
          type: "file"
        });
        continue;
      }
      let child = directory.children.find((candidate) => (
        candidate.type === "directory" && candidate.path === childPath
      )) as typeof root | undefined;
      if (!child) {
        child = {
          children: [],
          loaded: false,
          name,
          path: childPath,
          type: "directory"
        };
        directory.children.push(child);
      }
      directory = child;
    }
  }

  sortSourceEditorTree(root);
  return root;
}

function sortSourceEditorTree(node: Record<string, unknown>) {
  const children = Array.isArray(node.children)
    ? node.children as Array<Record<string, unknown>>
    : [];
  children.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "directory" ? -1 : 1;
    }
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
  for (const child of children) {
    if (child.type === "directory") {
      sortSourceEditorTree(child);
    }
  }
}

function findSourceEditorTreeDirectory(node: Record<string, unknown>, directoryPath = ""): Record<string, unknown> | null {
  if (node.type !== "directory") {
    return null;
  }
  if (String(node.path || "") === String(directoryPath || "")) {
    return node;
  }
  for (const child of Array.isArray(node.children) ? node.children as Array<Record<string, unknown>> : []) {
    const found = findSourceEditorTreeDirectory(child, directoryPath);
    if (found) {
      return found;
    }
  }
  return null;
}

function sourceEditorDirectoryPage(node: Record<string, unknown>, {
  limit = 20,
  offset = 0
}: {
  limit?: number;
  offset?: number;
} = {}) {
  const children = Array.isArray(node.children)
    ? node.children as Array<Record<string, unknown>>
    : [];
  const normalizedLimit = Math.max(1, Number(limit || 20));
  const normalizedOffset = Math.max(0, Number(offset || 0));
  const pageChildren = children
    .slice(normalizedOffset, normalizedOffset + normalizedLimit)
    .map((child) => child.type === "directory"
      ? {
          children: [],
          hasMore: false,
          limit: normalizedLimit,
          loaded: false,
          name: child.name,
          nextOffset: 0,
          offset: 0,
          path: child.path,
          total: 0,
          truncated: false,
          type: "directory"
        }
      : child);
  const nextOffset = Math.min(children.length, normalizedOffset + pageChildren.length);
  return {
    children: pageChildren,
    hasMore: nextOffset < children.length,
    limit: normalizedLimit,
    loaded: true,
    name: node.name,
    nextOffset,
    offset: normalizedOffset,
    path: node.path,
    total: children.length,
    truncated: false,
    type: "directory"
  };
}

function previewAppHtml({
  lateModule = false,
  targetOrigin = new URL(TARGET_APP_URL).origin
}: {
  lateModule?: boolean;
  targetOrigin?: string;
} = {}) {
  const moduleScript = lateModule
    ? "<script type=\"module\" src=\"/vibe64-test-late-module.js\"></script>"
    : "";
  return injectLaunchPreviewBridge(
    `<!doctype html><html><head><title>Preview</title>${moduleScript}</head><body><div id="app">Preview app</div></body></html>`,
    {
      targetOrigin
    }
  );
}

async function startPreviewAppServer({
  bootstrapToken = "",
  responseDelayMs = 0,
  targetOrigin = new URL(TARGET_APP_URL).origin
}: {
  bootstrapToken?: string;
  responseDelayMs?: number;
  targetOrigin?: string;
} = {}) {
  let loadCount = 0;
  const server = createHttpServer(async (request, response) => {
    loadCount += 1;
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    const url = new URL(String(request.url || "/"), origin);
    if (bootstrapToken && url.searchParams.get("vibe64_preview_token") === bootstrapToken) {
      url.searchParams.delete("vibe64_preview_token");
      response.writeHead(302, {
        Location: url.toString(),
        "Set-Cookie": `vibe64_preview_token_${address.port}=${bootstrapToken}; Path=/; HttpOnly`
      });
      response.end();
      return;
    }
    if (responseDelayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, responseDelayMs);
      });
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });
    response.end(previewAppHtml({
      targetOrigin
    }));
  });
  await listenOnLoopback(server);
  const address = server.address() as AddressInfo;
  return {
    async close() {
      await closeHttpServer(server);
    },
    href: `http://127.0.0.1:${address.port}/home`,
    getLoadCount() {
      return loadCount;
    }
  };
}

function listenOnLoopback(server: HttpServer) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeHttpServer(server: HttpServer) {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function mockLaunchTerminalSocket(page: Page, {
  terminalErrorDelayMs = 0,
  terminalExitCode = 0,
  terminalExitDelayMs = 0,
  terminalSocketNeverSettles = false
}: {
  terminalErrorDelayMs?: number;
  terminalExitCode?: number;
  terminalExitDelayMs?: number;
  terminalSocketNeverSettles?: boolean;
} = {}) {
  await page.addInitScript(({
    targetAppUrl,
    terminalErrorDelayMs: errorDelayMs,
    terminalExitCode: exitCode,
    terminalExitDelayMs: exitDelayMs,
    terminalSocketNeverSettles: neverSettles
  }) => {
    const OriginalWebSocket = window.WebSocket;
    (window as typeof window & { __vibe64LaunchTerminalMessages?: string[] })
      .__vibe64LaunchTerminalMessages = [];
    (window as typeof window & { __vibe64AgentTerminalMessages?: string[] })
      .__vibe64AgentTerminalMessages = [];

    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = MockWebSocket.CONNECTING;
      url = "";

      constructor(url: string | URL) {
        super();
        this.url = String(url || "");
        const pathname = new URL(this.url, window.location.href).pathname;
        const agentTerminal = pathname.includes("/agent-terminal/");
        const launchTerminal = pathname.includes("/output-runs/");
        if (!agentTerminal && !launchTerminal) {
          return new OriginalWebSocket(url);
        }
        if (neverSettles) {
          return;
        }
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              session: {
                commandPreview: agentTerminal ? "codex" : "npm run dev",
                id: agentTerminal ? "server-agent-terminal" : "server-launch-terminal",
                metadata: agentTerminal ? {} : {
                  actions: [
                    {
                      href: targetAppUrl,
                      id: "url-dev",
                      kind: "url",
                      label: "Open browser"
                    }
                  ],
                  launchReady: true,
                  outputTargetId: "dev",
                  outputTargetLabel: "Run app"
                },
                ok: true,
                output: agentTerminal ? "Codex ready" : `action:url:${targetAppUrl}\nready`,
                status: "running"
              },
              type: "snapshot"
            })
          }));
          if (errorDelayMs > 0) {
            window.setTimeout(() => {
              this.dispatchEvent(new MessageEvent("message", {
                data: JSON.stringify({
                  error: "Terminal session not found.",
                  type: "error"
                })
              }));
            }, errorDelayMs);
          }
          if (exitDelayMs > 0) {
            window.setTimeout(() => {
              this.dispatchEvent(new MessageEvent("message", {
                data: JSON.stringify({
                  exitCode,
                  status: "exited",
                  type: "status"
                })
              }));
            }, exitDelayMs);
          }
        }, 0);
      }

      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        const pathname = new URL(this.url, window.location.href).pathname;
        if (pathname.includes("/agent-terminal/")) {
          (window as typeof window & { __vibe64AgentTerminalMessages?: string[] })
            .__vibe64AgentTerminalMessages?.push(String(data));
          return;
        }
        (window as typeof window & { __vibe64LaunchTerminalMessages?: string[] })
          .__vibe64LaunchTerminalMessages?.push(String(data));
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }

    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  }, {
    targetAppUrl: TARGET_APP_URL,
    terminalErrorDelayMs,
    terminalExitCode,
    terminalExitDelayMs,
    terminalSocketNeverSettles
  });
}

function launchStatusPayload(options: {
  activeTerminal?: unknown;
  previewHref?: string;
  previewIdentity?: Record<string, unknown> | null;
} = {}) {
  const previewHref = options.previewHref || PROXY_APP_URL;
  const terminal = Object.hasOwn(options, "activeTerminal")
    ? options.activeTerminal
    : {
        commandPreview: "npm run dev",
        id: "server-launch-terminal",
        metadata: {
          actions: [
            {
              href: TARGET_APP_URL,
              id: "url-dev",
              kind: "url",
              label: "Open browser"
            }
          ],
          launchReady: true,
          outputTargetId: "dev",
          outputTargetLabel: "Run app"
        },
        output: `action:url:${TARGET_APP_URL}\nready`,
        running: true,
        status: "running"
      };
  const devOutputTarget = {
    available: true,
    default: true,
    downloads: [],
    id: "dev",
    label: "Run app",
    mode: "interactive",
    presentation: {
      kind: "web"
    }
  };
  return {
    activeTerminal: terminal,
    outputRuns: [],
    outputTargets: [
      devOutputTarget
    ],
    ok: true,
    ...(options.previewIdentity ? { previewIdentity: options.previewIdentity } : {}),
    openTarget: {
      available: true,
      href: TARGET_APP_URL,
      kind: "url",
      label: "Open browser",
      previewHref
    },
    previewTarget: {
      available: true,
      disabledReason: "",
      href: previewHref,
      kind: "url",
      label: "Preview",
      targetHref: TARGET_APP_URL
    }
  };
}

function idleLaunchStatusPayload(outputTargets: unknown[] = []) {
  return {
    activeTerminal: null,
    outputRuns: [],
    outputTargets,
    ok: true,
    preview: {
      state: "idle",
      canStart: outputTargets.some((target) => (target as { available?: boolean }).available !== false),
      canRestart: false,
      canShowLog: false
    },
    openTarget: {
      available: false,
      disabledReason: "Run an output target first.",
      href: "",
      kind: "url",
      label: "Open browser",
      previewHref: ""
    },
    previewTarget: {
      available: false,
      disabledReason: "Run an output target first.",
      href: "",
      kind: "url",
      label: "Preview",
      targetHref: ""
    }
  };
}

function previewAvailabilitySequence() {
  const previewTarget = {
    default: true,
    downloads: [],
    id: "dev",
    label: "Run app",
    mode: "interactive",
    presentation: { kind: "web" }
  };
  return [
    idleLaunchStatusPayload([
      {
        ...previewTarget,
        available: false,
        disabledReason: "Install dependencies before running the app."
      }
    ]),
    idleLaunchStatusPayload([
      {
        ...previewTarget,
        available: true
      }
    ])
  ];
}

function sessionPayload({
  agentTerminal = null,
  includeWorktreePaths = true,
  sessionId = SESSION_ID,
  sessionName = "Renderer session"
}: {
  agentTerminal?: Record<string, unknown> | null;
  includeWorktreePaths?: boolean;
  sessionId?: string;
  sessionName?: string;
} = {}) {
  const sourcePath = `/var/lib/vibe64/test/projects/example/sessions/active/${sessionId}/source`;
  const createdAt = "2026-05-24T00:00:00.000Z";
  const sessionRoot = sessionRuntimeRoot(sessionId);
  const session = {
    agentRuns: [],
    agentSession: {
      identity: null,
      providerId: "codex",
      terminal: agentTerminal,
      thread: {
        id: `thread-${sessionId}`
      },
      transportId: "codex_app_server",
      turn: {
        active: false
      },
      workdir: sourcePath
    },
    assistantSelection: {
      agentId: "codex",
      catalogRevision: TEST_ASSISTANT_CATALOG_REVISION,
      engineId: "codex",
      modelId: "gpt-5.6-sol",
      modelProviderId: "openai",
      variantId: "xhigh"
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
      sessionId,
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
    stateRoot: `${sessionRoot}/state`,
    status: "active",
    targetRoot: "/workspace/example-target-app",
    updatedAt: createdAt
  };
  if (!includeWorktreePaths) {
    return session;
  }
  return {
    ...session,
    sourcePath,
    sourceReady: true
  };
}

function sourceEditorExplanationPayload(payload: SourceExplanationPayload = {}, text = "") {
  const path = String(payload.path || "src/App.js");
  const startLine = Math.max(1, Number(payload.startLine || 1));
  const endLine = Math.max(startLine, Number(payload.endLine || startLine));
  return {
    agentThreadId: "agent-thread-source-explanation",
    agentTurnId: "agent-turn-source-explanation",
    body: text,
    createdAt: "2026-05-24T00:00:00.000Z",
    engine: "agent-chat",
    followups: [],
    id: String(payload.explanationId || "exp_source_explanation"),
    messages: [
      {
        createdAt: "2026-05-24T00:00:00.000Z",
        id: String(payload.userMessageId || "msg_user"),
        role: "user",
        status: "complete",
        text: `Explain the whole file ${path}.`
      },
      {
        createdAt: "2026-05-24T00:00:01.000Z",
        id: String(payload.assistantMessageId || "msg_assistant"),
        role: "assistant",
        status: "complete",
        text
      }
    ],
    model: "agent-chat",
    sourceRange: {
      endColumn: Math.max(1, Number(payload.endColumn || 1)),
      endLine,
      language: "vue",
      path,
      scope: String(payload.scope || "file"),
      startColumn: Math.max(1, Number(payload.startColumn || 1)),
      startLine
    },
    status: "ready",
    summary: text.split(/\n\n/u)[0] || text,
    title: `${path.split("/").at(-1) || "Code"} full file`
  };
}

async function fulfillJson(route: Route, payload: unknown, {
  status = 200
}: {
  status?: number;
} = {}) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: "application/json",
    status
  });
}

async function fulfillNdjson(route: Route, events: unknown[]) {
  await route.fulfill({
    body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    contentType: "application/x-ndjson"
  });
}

for (const engine of ["codex", "opencode"]) {
  for (const width of [390, 1440]) {
    test(`@shared-attachments ${engine} references, removal, sent previews and downloads at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 950 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await mockLaunchTerminalSocket(page);
      const base = sessionPayload();
      const session = engine === "codex" ? base : {
        ...base,
        agentSession: { ...base.agentSession, providerId: "opencode", transportId: "opencode_server" },
        assistantSelection: { agentId: "build", catalogRevision: TEST_ASSISTANT_CATALOG_REVISION, engineId: "opencode", modelId: "glm-5.3", modelProviderId: "zai-coding-plan", variantId: "high" }
      };
      const conversationLog: unknown[] = [];
      await mockLaunchSession(page, { session, conversationLog, assistantAccess: PERSONAL_ASSISTANT_ACCESS, assistantCatalog: assistantCatalogPayload({ includeOpenCode: true }) });
      const uploads = new Map<string, AttachmentUpload>();
      const deleted: string[] = [];
      const messages: Record<string, unknown>[] = [];
      let imageUnavailable = false;
      // Chromium's same-origin `download` requests bypass page routing. Serve
      // actual file responses so this verifies saved bytes as well as the UI.
      const downloadServer = createHttpServer((request, response) => {
        const url = new URL(request.url || "/", BASE_URL);
        if (url.pathname.startsWith(`${SCOPED_API_PREFIX}/vibe64/sessions/${SESSION_ID}/agent-attachments/`)) {
          const uploaded = uploads.get(url.pathname.split("/").at(-1) || "");
          if (!uploaded || (imageUnavailable && url.searchParams.has("inline"))) { response.writeHead(404).end(); return; }
          response.writeHead(200, {
            "content-type": uploaded.contentType,
            "content-disposition": url.searchParams.has("inline") ? "inline" : `attachment; filename="${uploaded.fileName}"`,
            "cache-control": "no-store"
          }).end(uploaded.bytes);
          return;
        }
        const upstream = requestHttp(url, { method: request.method, headers: { ...request.headers, host: new URL(BASE_URL).host } }, (incoming) => {
          response.writeHead(incoming.statusCode || 502, incoming.headers);
          incoming.pipe(response);
        });
        upstream.on("error", () => response.writeHead(502).end());
        request.pipe(upstream);
      });
      await listenOnLoopback(downloadServer);
      try {
      await page.route(/\/agent-attachments(?:\/[^/?]+)?(?:\?.*)?$/u, async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        expect(url.pathname.startsWith(`${SCOPED_API_PREFIX}/vibe64/sessions/${SESSION_ID}/agent-attachments`)).toBe(true);
        if (request.method() === "POST") {
          const uploaded = await readMultipartAttachment(request);
          const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(uploads.size + 1).padStart(12, "0")}`;
          uploads.set(id, uploaded);
          await new Promise((resolve) => setTimeout(resolve, uploaded.fileName === "one.png" ? 700 : 150));
          await fulfillJson(route, { ok: true, attachmentId: id, fileName: uploaded.fileName, size: uploaded.bytes.length, path: `/private/upload/${id}`, contentType: uploaded.contentType });
        } else if (request.method() === "DELETE") {
          deleted.push(url.pathname.split("/").at(-1) || "");
          await fulfillJson(route, { ok: true });
        } else {
          await route.continue();
        }
      });
      await page.route("**/agent-message", async (route) => {
        const payload = route.request().postDataJSON();
        messages.push(payload);
        if (messages.length === 1) {
          await fulfillJson(route, { ok: false, error: "Test delivery interrupted. Retry this message." }, { status: 503 });
          return;
        }
        conversationLog.push({
          turnId: "attachment-turn",
          user: { role: "user", at: new Date().toISOString(), messageId: payload.messageId, text: payload.displayMessage || payload.message, attachments: payload.displayAttachments }
        });
        await fulfillJson(route, { ok: true, delivered: true });
      });
      await page.goto(`http://127.0.0.1:${(downloadServer.address() as AddressInfo).port}${DEVELOPMENT_PATH}`);
      const composer = page.getByLabel("Message AI assistant");
      await composer.fill("Inspect these");
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFe0AAAAASUVORK5CYII=", "base64");
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Attach files", exact: true }).click();
      await (await chooser).setFiles([
        { name: "one.png", mimeType: "image/png", buffer: png },
        { name: "two.png", mimeType: "image/png", buffer: png },
        { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Saved attachment") }
      ]);
      await expect(page.locator(".vibe64-attachment-queue__item--ready")).toHaveCount(3);
      for (const reference of ["[Image #1]", "[Image #2]", "[File #1]"]) {
        expect(await composer.inputValue()).toContain(reference);
      }
      await expect(composer).not.toHaveValue(/\/private\/upload/u);
      await page.screenshot({ path: testInfo.outputPath("attachment-composer.png"), animations: "disabled" });
      await page.getByRole("button", { name: /\[Image #[12]\] one.png/u }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect.poll(() => dialog.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Remove one.png", exact: true }).click();
      await expect(composer).toHaveValue(/^Inspect these\s+\[Image #1\]\s+\[File #1\]\s*$/u);
      await expect.poll(() => deleted.length).toBe(1);
      await composer.fill("I removed the tokens myself.");
      await expect(page.locator(".vibe64-attachment-queue__item--ready")).toHaveCount(2);
      expect(deleted).toHaveLength(1);
      await composer.fill("Review [Image #1] and [File #1]. I edited this.");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect.poll(() => messages.length).toBe(1);
      expect(messages[0].message).toBe("Review [Image #1] and [File #1]. I edited this.");
      expect(messages[0].attachmentIds).toHaveLength(2);
      expect(JSON.stringify(messages[0])).not.toContain("/private/upload");
      await expect(page.getByText("Test delivery interrupted. Retry this message.", { exact: false })).toBeVisible();
      await composer.fill("Keep this next draft");
      const nextChooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Attach files", exact: true }).click();
      await (await nextChooser).setFiles({ name: "later.txt", mimeType: "text/plain", buffer: Buffer.from("Next message attachment") });
      await expect(composer).toHaveValue(/Keep this next draft\s+\[File #2\]/u);
      await page.getByRole("button", { name: "Resend", exact: true }).click();
      await expect.poll(() => messages.length).toBe(2);
      expect(messages[1].attachmentIds).toEqual(messages[0].attachmentIds);
      expect(messages[1].messageId).toBe(messages[0].messageId);
      expect(uploads.size).toBe(4);
      await expect(page.locator(".vibe64-attachment-queue__item--ready")).toHaveCount(1);
      await expect(composer).toHaveValue(/Keep this next draft\s+\[File #1\]/u);
      await expect(page.getByRole("button", { name: /\[File #1\] later.txt/u })).toBeVisible();
      expect(deleted).toHaveLength(1);
      await page.getByRole("button", { name: "Remove later.txt", exact: true }).click();
      await composer.fill("");
      await expect(page.locator(".vibe64-attachment-queue__item--ready")).toHaveCount(0);
      const sent = page.locator(".vibe64-conversation-attachments");
      await sent.getByRole("button", { name: /two.png/u }).click();
      await expect.poll(() => dialog.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      imageUnavailable = true;
      await sent.getByRole("button", { name: /two.png/u }).click();
      await expect(dialog.getByText("Preview is unavailable for this file.", { exact: false })).toBeVisible();
      await expect(dialog.getByRole("link", { name: "Download", exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      imageUnavailable = false;
      await sent.getByRole("button", { name: /notes.txt/u }).click();
      await expect(dialog.getByText("Preview is unavailable for this file.", { exact: false })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("attachment-dialog.png"), animations: "disabled" });
      const download = page.waitForEvent("download");
      await dialog.getByRole("link", { name: "Download", exact: true }).click();
      const downloaded = await download;
      expect(downloaded.suggestedFilename()).toBe("notes.txt");
      expect(await readFile((await downloaded.path())!, "utf8")).toBe("Saved attachment");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.reload();
      await expect(sent.getByRole("button", { name: /\[Image #1\] two.png/u })).toBeVisible();
      await sent.getByRole("button", { name: /two.png/u }).click();
      await expect.poll(() => dialog.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await composer.fill("Pasted screenshot");
      await composer.evaluate((textarea, bytes) => {
        const clipboardData = new DataTransfer();
        clipboardData.items.add(new File([new Uint8Array(bytes)], "pasted.png", { type: "image/png" }));
        textarea.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
      }, [...png]);
      await expect(composer).toHaveValue(/Pasted screenshot\s+\[Image #1\]/u);
      await expect(page.getByRole("button", { name: /\[Image #1\] pasted.png/u })).toBeVisible();
      await page.getByRole("button", { name: "Remove pasted.png", exact: true }).click();
      await expect(composer).toHaveValue(/^Pasted screenshot\s*$/u);
      expect(errors).toEqual([]);
      } finally {
        downloadServer.closeAllConnections();
        await closeHttpServer(downloadServer);
      }
    });
  }
}

for (const width of [390, 820, 1440]) {
  for (const outcome of ["stop", "provider-error", "abort-timeout"]) {
    test(`@opencode-recovery real controller releases chat after ${outcome} at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await mockLaunchTerminalSocket(page);
      const session = sessionPayload();
      const conversationLog: any[] = [];
      const errors: string[] = [];
      let stoppingAttempts = 0;
      let mounted = false;
      page.on("pageerror", (error) => errors.push(error.message));
      const harness = await controllerHarness({
        assistantResponses: [{ pending: true, text: "" }],
        providerEvents: outcome === "provider-error" ? [{ data: {
          type: "session.error",
          properties: { error: { name: "APIError", data: { message: "The provider rejected this image input." } } }
        } }] : [],
        interrupt: async (_id: string, { signal }: { signal: AbortSignal }) => {
          if (++stoppingAttempts === 1 && outcome === "abort-timeout") {
            await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
          }
          return true;
        },
        onSessionChanged: async (_id: string, event: any) => {
          const payload = { ...event.payload };
          if (payload.agentSession) Object.assign(session.agentSession, payload.agentSession);
          if (payload.conversationLogPatch) {
            const item = payload.conversationLogPatch.turn;
            let turn;
            if (item.type === "user") {
              turn = { turnId: String(conversationLog.length + 1).padStart(6, "0"), user: { role: "user", at: new Date().toISOString(), messageId: item.id, text: item.text } };
            } else if (item.system) {
              turn = { ...item, system: { ...item.system, role: "system", at: new Date().toISOString(), messageId: item.turnId } };
            }
            if (turn) {
              conversationLog.push(turn);
              payload.conversationLogPatch = { type: "upsert-turn", turn };
            } else delete payload.conversationLogPatch;
          }
          if (mounted) await publishChatSessionChange(page, { ...payload, reason: event.reason, sessionId: SESSION_ID, revision: ++session.revision });
        }
      });
      Object.assign(session.assistantSelection, harness.selection);
      Object.assign(session.agentSession, { providerId: "opencode", transportId: "opencode_server" });
      const engine = await harness.controller.capabilities({ engineId: "opencode", modelProviderId: "deepseek" });
      await mockLaunchSession(page, { session, conversationLog, assistantAccess: PERSONAL_ASSISTANT_ACCESS, assistantCatalog: { ok: true, engines: [engine] } as any });
      await page.route(/\/sessions\/[^/]+\/(?:agent-message|agent-turn\/interrupt)$/u, async (route) => {
        try {
          const result = route.request().url().endsWith("/agent-message")
            ? await harness.controller.sendMessage("session-1", route.request().postDataJSON())
            : await harness.controller.interruptTurn("session-1");
          await fulfillJson(route, result);
        } catch (error: any) {
          await fulfillJson(route, { ok: false, error: error.message, code: error.code }, { status: error.statusCode || 500 });
        }
      });
      try {
        await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
        const visible = page.locator(".studio-autopilot__chat-panel:visible");
        const composer = visible.getByLabel("Message AI assistant");
        const send = visible.getByRole("button", { name: "Send message", exact: true });
        await expect(composer).toBeVisible();
        mounted = true;
        await composer.fill("Read the attached image.");
        await send.click();
        await expect(composer).toHaveValue("");
        await composer.fill("Keep this new draft.");
        const start = Date.now();
        if (outcome === "provider-error") {
          await expect(visible.getByText(/The provider rejected this image input\./u).first()).toBeVisible();
        } else {
          const stop = visible.getByRole("button", { name: "Stop", exact: true });
          await expect(stop).toBeEnabled();
          await stop.click();
          if (outcome === "abort-timeout") {
            await expect(page.getByText(/OpenCode did not confirm Stop within 5 seconds/u).first()).toBeVisible();
            const close = page.getByRole("button", { name: "Close", exact: true });
            if (await close.isVisible()) await close.click();
            await expect(stop).toBeEnabled();
            await stop.click();
          }
        }
        await expect(send).toBeEnabled();
        expect(Date.now() - start).toBeLessThan(outcome === "abort-timeout" ? 8_000 : 2_500);
        await expect(composer).toHaveValue("Keep this new draft.");
        await visible.getByRole("button", { name: "Choose AI", exact: true }).click();
        await expect(page.getByRole("button", { name: /DeepSeek Chat/u, exact: false })).toBeEnabled();
        await expect(page.getByText("AI choices are view-only while the assistant is working.")).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath("recovered-chat-and-model-controls.png"), animations: "disabled" });
        expect(errors).toEqual([]);
        expect(harness.switchedModels).toEqual([]);
      } finally {
        mounted = false;
        await harness.controller.closeAllForProject();
        await rm(harness.root, { force: true, recursive: true });
      }
    });
  }
}

for (const width of [390, 820, 1440]) {
  for (const engineId of ["codex", "opencode"]) {
    test(`@assistant-menu-speed ${engineId} warms choices without blocking typing and keeps them during refresh at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockLaunchTerminalSocket(page);
      const session = sessionPayload();
      const catalog = assistantCatalogPayload({ includeOpenCode: true });
      const engine = catalog.engines.find((item) => item.engineId === engineId)!;
      Object.assign(session.assistantSelection, { ...engine.defaults, engineId });
      Object.assign(session.agentSession, { providerId: engineId, transportId: engine.transportId });
      await mockLaunchSession(page, { session, assistantAccess: PERSONAL_ASSISTANT_ACCESS, assistantCatalog: catalog });
      let hold = false;
      let releaseRefresh: (() => void) | undefined;
      let loaded = 0;
      const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
      const requests: string[] = [];
      await page.route(/\/assistants\/capabilities(?:\?.*)?$/u, async (route) => {
        const query = new URL(route.request().url()).searchParams;
        if (query.has("configuredOnly")) { await fulfillJson(route, catalog); return; }
        requests.push(query.toString());
        if (hold) await refreshGate;
        else await new Promise((resolve) => setTimeout(resolve, 1_500));
        await fulfillJson(route, { ok: true, engines: [engine] });
        loaded += 1;
      });
      try {
        await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
        const visible = page.locator(".studio-autopilot__chat-panel:visible");
        const composer = visible.getByLabel("Message AI assistant");
        await composer.fill("Keep typing while AI choices load.");
        await expect(composer).toHaveValue("Keep typing while AI choices load.");
        await expect.poll(() => loaded).toBe(2);
        expect(requests).toHaveLength(2);
        hold = true;
        const start = Date.now();
        await visible.getByRole("button", { name: "Choose AI", exact: true }).click();
        const model = page.getByRole("button", { name: engineId === "codex" ? /GPT-5.6 Sol/u : /GLM-5.3/u });
        await expect(model).toBeVisible({ timeout: 1_000 });
        await expect(model).toBeEnabled();
        expect(Date.now() - start).toBeLessThan(1_000);
        await expect(page.getByLabel("Loading available AIs")).toHaveCount(0);
        await expect.poll(() => requests.length).toBeGreaterThan(2);
        await expect(model).toBeEnabled();
        await page.keyboard.press("Escape");
        await expect(composer).toHaveValue("Keep typing while AI choices load.");
        await expect(visible.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
      } finally { releaseRefresh?.(); }
    });
  }
}
