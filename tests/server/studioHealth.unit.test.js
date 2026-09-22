import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  commandCheck,
  createService
} from "../../packages/studio-health/src/server/service.js";
import {
  isValidPlaywrightBrowserLaunchOutput,
  playwrightBrowserLaunchCheckScript
} from "../../packages/vibe64-execution/src/server/runtime/browserRuntime.js";

function successfulCommandResult(command = "", args = []) {
  const commandText = String(command);
  const script = args.join(" ");
  if (commandText.endsWith("/genesis")) {
    return { ok: true, output: "Usage:\n  genesis init" };
  }
  if (script.includes("Playwright runtime ready:")) {
    return {
      ok: true,
      output: "Playwright runtime ready: Version 1.61.1; manifest /opt/vibe64/playwright/runtime.env"
    };
  }
  if (script.includes("Playwright browser launched:")) {
    return {
      ok: true,
      output: "Playwright browser launched: /opt/vibe64/playwright/browsers/chromium-123/chrome"
    };
  }
  const outputByCommand = {
    codex: "codex-cli 0.1.0",
    gh: "gh version 2.96.0",
    git: "git version 2.54.0",
    node: "v26.5.0",
    rg: "ripgrep 15.1.0"
  };
  return {
    ok: true,
    output: outputByCommand[commandText] || "available"
  };
}

test("Studio Health reports explicit platform checks without repairs", async () => {
  const studioRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-health-"));
  await writeFile(path.join(studioRoot, "package.json"), "{}\n", "utf8");
  const commandCalls = [];
  const service = createService({
    connectionsService: {
      async getStatus(input) {
        assert.equal(input.providerIds, undefined);
        return {
          ok: true,
          connections: [
            { connected: true, id: "ai", label: "AI connection", status: "connected" },
            { connected: true, id: "github", status: "connected" }
          ]
        };
      }
    },
    projectService: {
      async listProjects() {
        return {
          ok: true,
          projects: [{ slug: "example" }]
        };
      }
    },
    async runCommand({ args, command, mode, purpose }) {
      commandCalls.push({ args, command, mode, purpose });
      return successfulCommandResult(command, args);
    },
    studioRoot
  });

  const result = await service.inspect({
    vibe64User: { role: "owner" }
  });

  assert.equal(result.ok, true);
  assert.equal(result.healthy, true);
  assert.equal(result.summary.failed, 0);
  assert.deepEqual(result.checks.map((check) => check.id), [
    "workspace",
    "ai-auth",
    "github-auth",
    "node",
    "git",
    "github-cli",
    "ripgrep",
    "codex",
    "genesis",
    "playwright",
    "playwright-browser"
  ]);
  assert.equal(commandCalls.length, 8);
  assert.equal(commandCalls.every((call) => call.mode === "capture"), true);
  assert.equal(commandCalls.every((call) => call.purpose === "health"), true);
});

test("Studio Health reports unavailable checks without inventing readiness", async () => {
  const studioRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-health-fail-"));
  await writeFile(path.join(studioRoot, "package.json"), "{}\n", "utf8");
  const service = createService({
    connectionsService: {
      async getStatus() {
        throw new Error("Account service unavailable.");
      }
    },
    projectService: {
      async listProjects() {
        return { ok: false, error: "Catalog unavailable." };
      }
    },
    async runCommand() {
      return { ok: false, output: "Runtime pack unavailable." };
    },
    studioRoot
  });

  const result = await service.inspect();

  assert.equal(result.ok, true);
  assert.equal(result.healthy, false);
  assert.equal(result.summary.failed, result.summary.total);
  assert.match(result.checks.find((check) => check.id === "workspace").observed, /Catalog unavailable/u);
  assert.match(result.checks.find((check) => check.id === "accounts-auth").observed, /Account service unavailable/u);
  assert.match(result.checks.find((check) => check.id === "genesis").observed, /Runtime pack unavailable/u);
});

test("the browser health probe launches pinned headless Chromium within the health deadline", () => {
  const script = playwrightBrowserLaunchCheckScript();
  assert.match(script, /browser="\$headless_shell"/u);
  assert.match(script, /timeout 15s/u);
  assert.ok(script.indexOf('headless_shell_version=') < script.indexOf('browser="$headless_shell"'));
  assert.ok(script.indexOf('could not launch (exit') < script.indexOf('tail -n 3'));
  assert.equal(isValidPlaywrightBrowserLaunchOutput(
    "Playwright browser launched: /opt/vibe64/playwright/browsers/chromium_headless_shell-1228/chrome-linux/headless_shell"
  ), true);
  assert.equal(isValidPlaywrightBrowserLaunchOutput(
    "Playwright browser launched: /opt/vibe64/playwright/browsers/chromium_headless_shell-1228/chrome-linux/chrome-headless-shell"
  ), true);
  assert.equal(isValidPlaywrightBrowserLaunchOutput(
    "Playwright browser launched: /opt/vibe64/playwright/browsers/chrome-linux/unrelated"
  ), false);
});

test("Health prioritizes a failed execution's reason ahead of incidental browser stderr", async () => {
  const check = await commandCheck({
    command: "bash",
    id: "playwright-browser",
    label: "Pinned browser",
    runCommand: async () => ({
      ok: false,
      error: "The browser check timed out.",
      output: Array(5).fill("[chromium] DBus unavailable").join("\n")
    }),
    studioRoot: "/tmp"
  });
  assert.equal(check.status, "fail");
  assert.match(check.observed, /^The browser check timed out\./u);
});
