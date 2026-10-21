import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  commandCheck,
  createService
} from "../../packages/studio-health/src/server/service.js";
import { configureVibe64Host } from "@local/vibe64-execution/server";
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
      output: "Playwright runtime ready: Version 1.61.1; manifest /srv/host-tools/playwright/runtime.env"
    };
  }
  if (script.includes("Playwright browser launched:")) {
    return {
      ok: true,
      output: "Playwright browser launched: /srv/host-tools/playwright/browsers/chromium-123/chrome"
    };
  }
  const outputByCommand = {
    claude: "2.1.0 (Claude Code)",
    codex: "codex-cli 0.1.0",
    opencode: "1.18.31",
    gh: "gh version 2.96.0",
    git: "git version 2.54.0",
    node: "v26.5.0",
    rg: "ripgrep 15.1.0"
  };
  return {
    ok: true,
    output: outputByCommand[path.basename(commandText)] || "available"
  };
}

// Health on a host with runtime packs checks the pinned tools.
function withRuntimePacks(t, root) {
  configureVibe64Host({ runtimePackRoot: path.join(root, "runtime-packs") });
  t.after(() => configureVibe64Host(null));
  return path.join(root, "runtime-packs");
}

test("Studio Health reports explicit platform checks without repairs", async (t) => {
  const studioRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-health-"));
  await writeFile(path.join(studioRoot, "package.json"), "{}\n", "utf8");
  withRuntimePacks(t, studioRoot);
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
  // The host's Codex check is the original one: same command, label and wording.
  const codex = result.checks.find((check) => check.id === "codex");
  assert.equal(codex.label, "Codex CLI");
  assert.equal(codex.expected, "The managed operator CLI pack exposes Codex.");
  assert.ok(commandCalls.some((call) => call.command === "codex" && call.args[0] === "--version"));
  assert.equal(commandCalls.every((call) => call.mode === "capture"), true);
  assert.equal(commandCalls.every((call) => call.purpose === "health"), true);
});

test("Studio Health reports unavailable checks without inventing readiness", async (t) => {
  const studioRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-health-fail-"));
  await writeFile(path.join(studioRoot, "package.json"), "{}\n", "utf8");
  withRuntimePacks(t, studioRoot);
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

test("without runtime packs Health checks the person's own tools and names missing AI tools", async () => {
  const studioRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-health-own-"));
  await writeFile(path.join(studioRoot, "package.json"), JSON.stringify({ engines: { node: "26.x" } }), "utf8");
  const claude = path.join(studioRoot, "home", ".local", "bin", "claude");
  await mkdir(path.dirname(claude), { recursive: true });
  await writeFile(claude, "#!/bin/sh\n", "utf8");
  await chmod(claude, 0o755);
  const commands = [];
  const service = createService({
    connectionsService: { getStatus: async () => ({ ok: true, connections: [{ connected: true, id: "ai", status: "connected" }] }) },
    env: { HOME: path.join(studioRoot, "home"), PATH: path.join(studioRoot, "empty") },
    projectService: { listProjects: async () => ({ ok: true, projects: [] }) },
    async runCommand({ args, command }) {
      commands.push(command);
      return command === "node" ? { ok: true, output: "v24.1.0" } : successfulCommandResult(command, args);
    },
    studioRoot
  });

  const { checks } = await service.inspect();
  const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
  assert.equal(byId.toolchain.observed, "Using your installed tools.");
  assert.equal(byId.node.status, "fail");
  assert.equal(byId.node.expected, "Node.js 26 is installed.");
  assert.equal(byId.claude.status, "pass");
  assert.ok(commands.includes(claude));
  // Machine-wide folders are searched too, so only assert the shape of a missing tool.
  for (const tool of ["codex", "opencode"].filter((id) => byId[id].status === "warn")) {
    assert.match(byId[tool].observed, /isn't installed on this computer\.$/u);
    assert.match(byId[tool].explanation, /^To use it, install it with: curl -fsSL https:\/\//u);
  }
});

test("without runtime packs a failed tool check shows the tool's words, not its command line", async () => {
  const studioRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-health-plain-"));
  await writeFile(path.join(studioRoot, "package.json"), JSON.stringify({ engines: { node: "26.x" } }), "utf8");
  const missing = "Playwright is not installed on this computer. See https://playwright.dev/docs/intro to install it.";
  const service = createService({
    connectionsService: { getStatus: async () => ({ ok: true, connections: [] }) },
    env: { HOME: path.join(studioRoot, "home"), PATH: path.join(studioRoot, "empty") },
    projectService: { listProjects: async () => ({ ok: true, projects: [] }) },
    async runCommand({ args, command }) {
      return args.join(" ").includes("playwright_command")
        ? { ok: false, error: `Command failed with exit code 1: bash -c 'set -euo pipefail ...'`, output: missing }
        : successfulCommandResult(command, args);
    },
    studioRoot
  });

  const { checks } = await service.inspect();
  const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
  for (const id of ["playwright", "playwright-browser"]) {
    assert.equal(byId[id].status, "fail");
    assert.equal(byId[id].observed, missing);
  }
  assert.equal(byId["playwright-browser"].label, "Playwright browser");
  assert.doesNotMatch(byId["github-cli"].explanation, /pinned/u);
});

test("the browser health probe launches pinned headless Chromium within the health deadline", (t) => {
  withRuntimePacks(t, os.tmpdir());
  const script = playwrightBrowserLaunchCheckScript();
  assert.match(script, /browser="\$headless_shell"/u);
  assert.match(script, /timeout 15s/u);
  assert.ok(script.indexOf('headless_shell_version=') < script.indexOf('browser="$headless_shell"'));
  assert.ok(script.indexOf('could not launch (exit') < script.indexOf('tail -n 3'));
  assert.equal(isValidPlaywrightBrowserLaunchOutput(
    "Playwright browser launched: /srv/host-tools/playwright/browsers/chromium_headless_shell-1228/chrome-linux/headless_shell"
  ), true);
  assert.equal(isValidPlaywrightBrowserLaunchOutput(
    "Playwright browser launched: /srv/host-tools/playwright/browsers/chromium_headless_shell-1228/chrome-linux/chrome-headless-shell"
  ), true);
  assert.equal(isValidPlaywrightBrowserLaunchOutput(
    "Playwright browser launched: /srv/host-tools/playwright/browsers/chrome-linux/unrelated"
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

test("assistants read a bounded Health summary through the same action", async () => {
  const { createActions } = await import("../../packages/studio-health/src/server/actions.js");
  const [action] = createActions({ studioHealth: { inspect: async () => ({}) } });
  const assistant = action.extensions.assistant;
  assert.equal(assistant.exclude, undefined);
  assert.match(assistant.description, /Health checks/u);
  const summary = assistant.transformResult({ ok: true, healthy: false, summary: { total: 1 }, updatedAt: "now",
    checks: [{ id: "playwright", label: "Playwright", group: "Tools", status: "fail", expected: "Installed.",
      observed: "x".repeat(5000), explanation: "Long detail stays on the Health page." }] });
  assert.deepEqual(Object.keys(summary.checks[0]).sort(), ["expected", "group", "id", "label", "observed", "status"]);
  assert.equal(summary.checks[0].observed.length, 300);
  assert.deepEqual(assistant.transformResult({ ok: false, error: "Down" }), { ok: false, error: "Down" });
});
