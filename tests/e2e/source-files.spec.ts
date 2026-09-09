import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BASE_URL, DASHBOARD_PATH, directChatSessionId, directChatSessionPayload } from "./support/base-shell-data";
import { mockDirectChatSession } from "./support/base-shell-mocks";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

async function mockFiles(page, { initialStars = ["src/app.js", "deleted.md"], additionalFiles = {} } = {}) {
  const messages: object[] = [];
  await mockDirectChatSession(page);
  const session = {
    ...directChatSessionPayload,
    sourcePath: `/managed-source/sessions/active/${directChatSessionId}/source`,
    metadata: {
      source_path: `/managed-source/sessions/active/${directChatSessionId}/source`,
      source_kind: "session_clone",
      source_path_authority: "managed_session_source"
    }
  };
  await routeApiEndpoint(page, "/vibe64/sessions", (route) => fulfillJson(route, { ok: true, sessions: [session] }));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}`, (route) => fulfillJson(route, session));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/agent-session`, (route) => fulfillJson(route, { ok: true, agentSession: session.agentSession }));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/assistant-access`, (route) => fulfillJson(route, { ok: true, available: true, canUse: true }));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/message-suggestions`, (route) => fulfillJson(route, { ok: true, suggestions: [] }));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/update-check`, (route) => fulfillJson(route, { ok: true, status: "up-to-date" }));
  await routeApiEndpoint(page, "/vibe64/sessions/current", (route) => fulfillJson(route, { ok: true, sessionId: directChatSessionId }));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/agent-message`, async (route) => {
    const body = route.request().postDataJSON();
    messages.push(body);
    return fulfillJson(route, { ok: true, delivered: true, messageId: body.messageId, sessionId: directChatSessionId });
  });
  const base = `/vibe64/sessions/${directChatSessionId}/source-editor`;
  const files = { "README.md": "# Hello\n", "notes.bin": Buffer.from([0, 255, 3]), "src/app.js": "export const ready = true;\n", ...additionalFiles };
  let stars = [...initialStars];
  await routeApiEndpoint(page, base, async (route) => {
    const url = new URL(route.request().url());
    const operation = url.pathname.split("/").at(-1);
    if (operation === "stars") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        stars = body.starred ? [...new Set([...stars, body.path])] : stars.filter((file) => file !== body.path);
        return fulfillJson(route, { ok: true, paths: stars });
      }
      return fulfillJson(route, { ok: true, files: stars.map((path) => ({ path, available: path in files, reason: "Not found in this session" })) });
    }
    if (operation === "tree") {
      const directory = url.searchParams.get("path") || "";
      const prefix = directory ? `${directory}/` : "";
      const children = new Map();
      for (const file of Object.keys(files)) {
        if (!file.startsWith(prefix)) continue;
        const [name, ...descendants] = file.slice(prefix.length).split("/");
        const path = `${prefix}${name}`;
        children.set(path, descendants.length
          ? { type: "directory", name, path, loaded: false, children: [] }
          : { type: "file", name, path });
      }
      return fulfillJson(route, { ok: true, policy: {}, tree: { type: "directory", name: directory, path: directory, loaded: true, children: [...children.values()] } });
    }
    if (operation === "file") {
      const path = url.searchParams.get("path") || "";
      if (route.request().method() !== "GET") {
        const body = route.request().postDataJSON();
        files[body.path] = body.text;
        return fulfillJson(route, { ok: true, file: { path: body.path, text: body.text, hash: `hash:${body.text}` } });
      }
      if (Buffer.isBuffer(files[path])) {
        return route.fulfill({ status: 415, json: { ok: false, code: "vibe64_source_editor_binary_file", error: "The selected file appears to be binary." } });
      }
      return fulfillJson(route, { ok: true, file: { path, text: String(files[path] || ""), hash: `hash:${files[path]}`, language: "javascript" } });
    }
    if (operation === "download") {
      const path = url.searchParams.get("path") || "";
      return route.fulfill({ body: Buffer.from(files[path]), contentType: "application/octet-stream", headers: { "content-disposition": "attachment; filename=notes.bin" } });
    }
    if (url.pathname.endsWith("changes/stream")) return route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
    return fulfillJson(route, { ok: true, files: [], results: [] });
  }, { children: true });
  return { messages };
}

for (const width of [390, 900, 1600]) {
  test(`binary chat links and file selections offer usable downloads at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const path = "docs/staff guide.docx";
    const bytes = Buffer.from([80, 75, 3, 4, 0, 255, 13, 10]);
    await mockFiles(page, { additionalFiles: { [path]: bytes } });
    await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/conversation-log`, (route) => fulfillJson(route, {
      ok: true,
      sessionId: directChatSessionId,
      conversationLog: [{ turnId: "word-guide", assistant: {
        at: "2026-08-14T01:03:00.000Z", role: "assistant",
        text: `[Download the Word staff guide](/managed-source/sessions/active/${directChatSessionId}/source/docs/staff%20guide.docx)`
      } }],
      pagination: { count: 1, hasMoreBefore: false, limit: 20, totalTurnCount: 1 }
    }));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().includes("/source-editor/file")) writes.push(request.postData() || "");
    });
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}`);
    await expect(page.getByLabel("Message AI assistant")).toBeAttached();
    const showChat = page.getByRole("button", { name: "Show chat", exact: true });
    if (await showChat.isVisible()) await showChat.click();
    await page.getByRole("link", { name: "Download the Word staff guide", exact: true }).click();
    const editor = page.getByLabel("Session source editor");
    await expect(editor.getByRole("heading", { name: "staff guide.docx", exact: true })).toBeVisible();
    await expect(editor.getByText("This file cannot be edited as text. Download it to open it in another application.")).toBeVisible();
    await expect(editor.getByText("Select a file to edit.", { exact: true })).toHaveCount(0);
    await expect(editor.locator(".cm-content")).not.toBeVisible();
    for (const name of ["Undo", "Redo", "Save now"]) await expect(editor.getByTitle(name, { exact: true })).toBeDisabled();
    await expect(editor.getByRole("button", { name: "Explain", exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath(`binary-download-${width}.png`), animations: "disabled" });

    for (const button of [editor.locator("main").getByRole("button", { name: "Download file", exact: true }), editor.locator("header").getByRole("button", { name: "Download file", exact: true })]) {
      const downloading = page.waitForEvent("download");
      await button.click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe("staff guide.docx");
      expect(await readFile((await download.path())!)).toEqual(bytes);
    }
    await editor.getByRole("button", { name: "Star file", exact: true }).click();
    await expect(editor.getByRole("button", { name: "Unstar file", exact: true })).toBeVisible();
    await editor.getByTitle("Refresh files", { exact: true }).click();
    await expect(editor.getByRole("heading", { name: "staff guide.docx", exact: true })).toBeVisible();
    await expect(editor.locator("main").getByRole("button", { name: "Download file", exact: true })).toBeEnabled();

    await page.getByRole("button", { name: "Back to dashboard", exact: true }).click();
    if (await showChat.isVisible()) await showChat.click();
    await page.getByRole("link", { name: "Download the Word staff guide", exact: true }).click();
    await expect(editor.locator("main").getByRole("button", { name: "Download file", exact: true })).toBeEnabled();

    // Reopen text, then choose a binary file directly from the tree.
    await editor.locator(".vibe64-source-tree__button").filter({ hasText: "README.md" }).click();
    await expect(editor.locator(".cm-content")).toContainText("# Hello");
    await editor.locator(".vibe64-source-tree__button").filter({ hasText: "notes.bin" }).click();
    await expect(editor.getByRole("heading", { name: "notes.bin", exact: true })).toBeVisible();
    await expect(editor.locator(".cm-content")).not.toBeVisible();
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("oversized files remain downloadable after a delayed read and a failed download", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await mockFiles(page, { additionalFiles: { "large.txt": "The complete saved file." } });
  const reading = Promise.withResolvers<void>();
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/source-editor/file`, async (route) => {
    if (new URL(route.request().url()).searchParams.get("path") !== "large.txt") return route.fallback();
    await reading.promise;
    return route.fulfill({ status: 413, json: { ok: false, code: "vibe64_source_editor_file_too_large", error: "Too large for the editor." } });
  });
  let failDownload = true;
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/source-editor/download`, async (route) => {
    if (!failDownload) return route.fallback();
    failDownload = false;
    return route.fulfill({ status: 403, json: { ok: false, error: "Download access denied." } });
  });
  try {
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/files`);
    const editor = page.getByLabel("Session source editor");
    await editor.locator(".vibe64-source-tree__button").filter({ hasText: "large.txt" }).click();
    await expect(editor.getByRole("status", { name: "Opening large.txt" })).toBeVisible();
    await expect(editor.getByRole("button", { name: "Download file", exact: true })).toBeDisabled();
    reading.resolve();
    await expect(editor.getByText("This file is too large to edit here. You can download the complete file.")).toBeVisible();
    const downloadButton = editor.locator("main").getByRole("button", { name: "Download file", exact: true });
    await downloadButton.click();
    await expect(page.getByText("Download access denied.", { exact: true })).toBeVisible();
    await expect(downloadButton).toBeEnabled();
    const downloading = page.waitForEvent("download");
    await downloadButton.click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("large.txt");
    expect(await readFile((await download.path())!, "utf8")).toBe("The complete saved file.");
    await editor.locator(".vibe64-source-tree__button").filter({ hasText: "README.md" }).click();
    await expect(editor.locator(".cm-content")).toContainText("# Hello");
    await expect(downloadButton).toHaveCount(0);
  } finally { reading.resolve(); }
});

test("download offers an explicit save choice and waits for that save", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await mockFiles(page);
  const saved = Promise.withResolvers<void>();
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/source-editor/file`, async (route) => {
    if (route.request().method() !== "GET") await saved.promise;
    return route.fallback();
  });
  try {
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/files`);
    const editor = page.getByLabel("Session source editor");
    await editor.locator(".vibe64-source-tree__button").filter({ hasText: "README.md" }).click();
    await expect(editor.locator(".cm-content")).toContainText("# Hello");
    await editor.locator(".cm-content").fill("# My draft\n");
    await editor.getByRole("button", { name: "Download file", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Download this file?", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Download saved file", exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Save & download", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    saved.resolve();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("README.md");
    expect(await readFile((await download.path())!, "utf8")).toBe("# My draft\n");
  } finally { saved.resolve(); }
});

for (const width of [390, 900, 1600]) {
  test(`@compact-stars long and duplicate filenames remain usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const longPath = `src/${"long-filename-".repeat(12)}.js`;
    await mockFiles(page, {
      initialStars: ["src/app.js", "lib/app.js", longPath, "deleted.md", "README.md", "notes.bin"],
      additionalFiles: { "lib/app.js": "export const library = true;\n", [longPath]: "export const long = true;\n" }
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let starReads = 0;
    page.on("request", (request) => {
      if (request.method() === "GET" && new URL(request.url()).pathname.endsWith("/source-editor/stars")) starReads += 1;
    });
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/files`);
    const editor = page.getByLabel("Session source editor");
    const starred = editor.locator(".vibe64-source-editor__starred");
    await expect(starred.locator("summary")).toHaveText("Starred 6");
    await expect(starred).toHaveJSProperty("open", false);
    await starred.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(starred).toHaveJSProperty("open", true);
    await expect(starred.getByRole("listitem")).toHaveCount(6);
    await expect(starred.locator(".starred-files-list__open").filter({ hasText: /^app\.js$/ })).toHaveCount(2);
    const first = starred.locator('.starred-files-list__open[title="src/app.js"]');
    const second = starred.locator('.starred-files-list__open[title="lib/app.js"]');
    await expect(first).toHaveAccessibleName("src/app.js");
    await expect(second).toHaveAccessibleName("lib/app.js");
    const missing = starred.locator('.starred-files-list__open[title^="deleted.md:"]');
    await expect(missing).toBeDisabled();
    await expect(missing).toHaveAccessibleDescription("deleted.md: Not found in this session");
    const long = starred.getByTitle(longPath, { exact: true }).locator("strong");
    await expect(long).toHaveCSS("white-space", "nowrap");
    await expect(long).toHaveCSS("text-overflow", "ellipsis");
    expect(await long.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`compact-stars-${width}.png`), animations: "disabled" });
    await second.click();
    await expect(editor.locator(".cm-content")).toContainText("export const library = true;");
    await first.click();
    await expect(editor.locator(".cm-content")).toContainText("export const ready = true;");
    await expect(starred).toHaveJSProperty("open", true);
    const beforeTyping = starReads;
    await editor.locator(".cm-content").fill("export const ready = false;\n");
    await expect(starred).toHaveJSProperty("open", true);
    expect(starReads).toBe(beforeTyping);

    const showChat = page.getByRole("button", { name: "Show chat", exact: true });
    if (await showChat.isVisible()) await showChat.click();
    const beforePicker = starReads;
    await page.getByRole("button", { name: "Starred files (6)", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Find a starred file", exact: true })).toBeFocused();
    await expect.poll(() => starReads).toBe(beforePicker + 1);
    await page.getByRole("textbox", { name: "Find a starred file", exact: true }).fill("src/app.js");
    await page.keyboard.press("Enter");
    await expect(editor).toBeVisible();
    await expect(editor.locator(".cm-content")).toContainText("export const ready = false;");
    await expect(starred).toHaveJSProperty("open", true);
    await starred.locator("summary").click();
    await expect(starred).toHaveJSProperty("open", false);
    await page.reload();
    await expect(starred.locator("summary")).toHaveText("Starred 6");
    await expect(starred).toHaveJSProperty("open", false);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`starred files open from chat and downloads preserve bytes at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { messages } = await mockFiles(page);
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/files`);
    const editor = page.getByLabel("Session source editor");
    await expect(editor).toBeVisible();
    await editor.locator(".vibe64-source-tree__button").filter({ hasText: "README.md" }).click();
    await expect(editor.locator(".cm-content")).toContainText("# Hello");
    await editor.getByRole("button", { name: "Star file", exact: true }).click();
    await expect(editor.getByRole("button", { name: "Unstar file", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(editor.getByRole("list", { name: "Starred files" }).getByText("README.md", { exact: true })).toHaveCount(1);

    await editor.getByRole("button", { name: "Actions for notes.bin", exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByText("Download file", { exact: true }).last().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("notes.bin");
    expect(await readFile((await download.path())!)).toEqual(Buffer.from([0, 255, 3]));

    // Compact screens retain chat behind the project pane; use the shell's back control.
    const showChat = page.getByRole("button", { name: "Show chat", exact: true });
    if (await showChat.isVisible()) await showChat.click();
    const picker = page.getByRole("button", { name: "Starred files (3)", exact: true });
    const composer = page.getByLabel("Message AI assistant");
    await composer.fill("Keep this draft while browsing files.");
    await picker.click();
    await expect(page.getByRole("textbox", { name: "Find a starred file", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Find a starred file", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(picker).toBeFocused();
    await picker.click();
    await expect(page.locator(".starred-files-menu").getByText("Not found in this session")).toBeVisible();
    await page.getByRole("textbox", { name: "Find a starred file", exact: true }).fill("app.js");
    await page.screenshot({ path: testInfo.outputPath(`starred-files-${width}.png`), animations: "disabled" });
    await page.getByRole("textbox", { name: "Find a starred file", exact: true }).press("Enter");
    await expect(editor).toBeVisible();
    await expect(editor.locator(".cm-content")).toContainText("export const ready = true;");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (await showChat.isVisible()) await showChat.click();
    await expect(composer).toHaveValue("Keep this draft while browsing files.");
    await composer.focus();
    await composer.press("Tab");
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => messages.length).toBe(1);
    await expect(composer).toHaveValue("");
    await page.reload();
    await expect(editor).toBeVisible();
    await expect(editor.locator(".vibe64-source-editor__starred").getByRole("button", { name: "Unstar README.md", exact: true })).toBeVisible();
  });
}

for (const width of [390, 1600]) {
  test(`@star-failure overlapping failed removals preserve order without an inline error at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockFiles(page, { initialStars: ["src/app.js", "README.md", "deleted.md"] });
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    let writes = 0;
    let reads = 0;
    await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/source-editor/stars`, async (route) => {
      if (route.request().method() === "GET") {
        reads += 1;
        return route.fallback();
      }
      const { path } = route.request().postDataJSON();
      writes += 1;
      await (path === "src/app.js" ? first.promise : second.promise);
      return fulfillJson(route, { ok: false, error: `Could not remove ${path}` });
    });
    try {
      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/files`);
      const starred = page.getByLabel("Session source editor").locator(".vibe64-source-editor__starred");
      await expect(starred.locator("summary")).toHaveText("Starred 3");
      const list = starred.getByRole("list", { name: "Starred files", exact: true });
      const listTop = (await list.boundingBox())!.y;
      const beforeWrites = reads;
      await starred.getByRole("button", { name: "Unstar src/app.js", exact: true }).click();
      await starred.getByRole("button", { name: "Unstar README.md", exact: true }).click();
      await expect.poll(() => writes).toBe(2);
      first.resolve();
      await expect(starred.getByRole("button", { name: "Unstar src/app.js", exact: true })).toBeVisible();
      await expect(starred.locator(".v-alert")).toHaveCount(0);
      expect((await list.boundingBox())!.y).toBe(listTop);
      await expect(page.getByText("Could not remove src/app.js", { exact: true })).toBeVisible();
      expect(reads).toBe(beforeWrites);
      second.resolve();
      await expect(starred.locator(".starred-files-list__open strong")).toHaveText(["app.js", "README.md", "deleted.md"]);
      await expect.poll(() => reads).toBe(beforeWrites + 1);
      await expect(page.getByText("Could not remove README.md", { exact: true })).toBeVisible();
      await expect(starred.locator(".v-alert")).toHaveCount(0);
    } finally {
      first.resolve();
      second.resolve();
    }
  });
}
