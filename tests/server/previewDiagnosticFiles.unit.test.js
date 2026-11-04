import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { previewLastPath, previewLogPath } from "@local/vibe64-terminals/server/previewDiagnosticFiles";
import { writePreviewDiagnostic } from "../../packages/vibe64-terminals/src/server/launchPreviewDiagnostics.js";
import { createLaunchPreviewProxyRegistry } from "../../packages/vibe64-terminals/src/server/launchPreviewProxy.js";
import { ensureLaunchPreviewProxy } from "../../packages/vibe64-terminals/src/server/launchPreviewReadiness.js";

// A host's storage report names these files through their owner rather than
// repeating the file names the Preview launcher writes.
test("the Preview's diagnostic files are named by their owner's package export", () => {
  assert.equal(previewLogPath({ sessionRoot: "/state/sessions/active/s1" }), "/state/sessions/active/s1/preview-log.jsonl");
  assert.equal(previewLastPath({ sessionRoot: "/state/sessions/active/s1" }), "/state/sessions/active/s1/preview-last.json");
  assert.equal(previewLogPath({}), "", "an archived session has no Preview log of its own");
});

test("a frame load joins the session's Preview log and leaves the launch's latest record alone", async () => {
  const sessionRoot = await mkdtemp(path.join(os.tmpdir(), "v64-preview-frame-load-"));
  const session = { sessionId: "session-frame-load", sessionRoot };
  const registry = createLaunchPreviewProxyRegistry({ env: process.env });
  try {
    await writePreviewDiagnostic(session, { reason: "terminal_start_failed", status: "failed" });
    const latest = await readFile(previewLastPath(session), "utf8");
    const preview = await ensureLaunchPreviewProxy({
      context: { session },
      launchPreviewProxies: registry,
      options: { env: process.env },
      sessionId: session.sessionId,
      targetHref: "http://127.0.0.1:9/home",
      terminal: { id: "terminal-1", metadata: { outputTargetId: "app" } }
    });
    const cleanUrl = new URL(preview.href);
    cleanUrl.search = "";
    const bootstrap = await fetch(preview.href, { headers: { Accept: "text/html" }, redirect: "manual" });
    const response = await fetch(cleanUrl, {
      headers: {
        Accept: "text/html",
        Cookie: bootstrap.headers.get("set-cookie").split(";")[0],
        "Sec-Fetch-Dest": "iframe"
      }
    });
    await response.text();
    assert.equal(response.status, 503);

    const readLog = async () => (await readFile(previewLogPath(session), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    let log = await readLog();
    for (let attempt = 0; attempt < 100 && log.length < 2; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
      log = await readLog();
    }
    assert.equal(log.length, 2);
    assert.equal(log[1].status, "frame-load");
    assert.equal(log[1].reason, "starting_page");
    assert.equal(log[1].terminalSessionId, "terminal-1");
    assert.equal(log[1].outputTargetId, "app");
    assert.equal(await readFile(previewLastPath(session), "utf8"), latest);
  } finally {
    await registry.closeAll();
    await rm(sessionRoot, { force: true, recursive: true });
  }
});
