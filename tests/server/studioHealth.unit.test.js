import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
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

// The shared tool check runs `sh -c <probe> probe <skip> <version> <commands...>`:
// a found tool prints its path, then its version output.
function probeResult(args = [], versions = {}) {
  const name = args.slice(5).find((command) => Object.hasOwn(versions, command));
  if (!name) return { ok: false, exitCode: 127, output: "" };
  const version = versions[name];
  return version === null
    ? { ok: false, exitCode: 1, output: `/usr/bin/${name}\nbroken` }
    : { ok: true, output: `/usr/bin/${name}\n${version}` };
}

function isProbe(command, args = []) {
  return command === "sh" && args[2] === "probe";
}

test("without runtime packs Health counts only what is needed; one AI tool is enough", async () => {
  const studioRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-health-own-"));
  await writeFile(path.join(studioRoot, "package.json"), JSON.stringify({ engines: { node: "26.x" } }), "utf8");
  const versions = { node: "v26.12.1", git: "git version 2.53.0", codex: "codex-cli 0.163.0" };
  const service = createService({
    connectionsService: { getStatus: async () => ({ ok: true, connections: [
      { connected: true, id: "ai", status: "connected" },
      { connected: false, required: false, id: "github", status: "signed_out" }
    ] }) },
    projectService: { listProjects: async () => ({ ok: true, projects: [] }) },
    async runCommand({ args, command }) {
      if (isProbe(command, args)) return probeResult(args, versions);
      return args.join(" ").includes("playwright_command")
        ? { ok: false, error: "Command failed with exit code 1: bash", output: "Playwright is not installed." }
        : successfulCommandResult(command, args);
    },
    studioRoot
  });

  const result = await service.inspect();
  const byId = Object.fromEntries(result.checks.map((check) => [check.id, check]));
  assert.equal(byId.toolchain, undefined);
  assert.equal(result.healthy, true, "Codex alone is enough; the rest is optional");
  assert.deepEqual(result.checks.filter((check) => check.need === "needed").map((check) => check.id),
    ["node", "git", "ai-tool", "ai-auth", "workspace", "genesis"]);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.summary.total, 6);
  assert.equal(result.summary.optionalMissing, 5, "Claude, opencode, GitHub CLI, ripgrep and one Playwright row");
  assert.equal(byId["ai-tool"].observed, "Codex 0.163.0");
  assert.equal(byId.node.observed, "Node.js 26.12.1 · /usr/bin/node");
  assert.equal(byId.claude.status, "warn");
  assert.equal(byId.claude.observed, "Claude Code isn't installed on this computer.");
  assert.equal(byId.claude.tool.install.command, "curl -fsSL https://claude.ai/install.sh | bash");
  assert.equal(byId["playwright-browser"], undefined, "no second row for the browser Playwright would install");
  assert.equal(byId.playwright.status, "warn");
  assert.match(byId.playwright.tool.install.command, /^npx playwright install/u);

  versions.node = "v24.1.0";
  delete versions.codex;
  const outdated = await service.inspect();
  const after = Object.fromEntries(outdated.checks.map((check) => [check.id, check]));
  assert.equal(outdated.healthy, false);
  assert.equal(outdated.summary.failed, 2);
  assert.equal(after.node.observed, "Node.js 24.1.0 is installed; Vibe64 needs Node.js 26.");
  assert.match(after.node.tool.install.command, /mise use -g node@26$/u);
  assert.equal(after["ai-tool"].observed, "No AI tool is installed on this computer yet.");
});

test("without runtime packs a tool that is there but fails is not counted as installed", async () => {
  const studioRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-health-plain-"));
  await writeFile(path.join(studioRoot, "package.json"), JSON.stringify({ engines: { node: "26.x" } }), "utf8");
  const service = createService({
    connectionsService: { getStatus: async () => ({ ok: true, connections: [] }) },
    projectService: { listProjects: async () => ({ ok: true, projects: [] }) },
    async runCommand({ args, command }) {
      return isProbe(command, args)
        ? probeResult(args, { node: "v26.1.0", git: null, claude: "2.1.0 (Claude Code)" })
        : successfulCommandResult(command, args);
    },
    studioRoot
  });

  const { checks } = await service.inspect();
  const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
  assert.equal(byId.git.status, "fail");
  assert.equal(byId.git.observed, "Git is at /usr/bin/git but didn't start.");
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
  const [action, tools] = createActions({ studioHealth: { inspect: async () => ({}), checkTools: async () => ({}) } });
  assert.match(tools.extensions.assistant.description, /never run the install command for them/u,
    "Colleague may check named tools, as rows do, but never installs them");
  const assistant = action.extensions.assistant;
  assert.equal(assistant.exclude, undefined);
  assert.match(assistant.description, /Health checks/u);
  const summary = assistant.transformResult({ ok: true, healthy: false, summary: { total: 1 }, updatedAt: "now",
    checks: [{ id: "playwright", label: "Playwright", group: "Tools", status: "fail", expected: "Installed.",
      observed: "x".repeat(5000), explanation: "Long detail stays on the Health page." }] });
  assert.deepEqual(Object.keys(summary.checks[0]).sort(), ["expected", "group", "id", "label", "need", "observed", "status"]);
  assert.equal(summary.checks[0].observed.length, 300);
  assert.deepEqual(assistant.transformResult({ ok: false, error: "Down" }), { ok: false, error: "Down" });
});

test("without runtime packs Health shows the name commits get and how to set your own", async () => {
  const studioRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-health-identity-"));
  await writeFile(path.join(studioRoot, "package.json"), JSON.stringify({ engines: { node: "26.x" } }), "utf8");
  const inspect = async (ident) => {
    const service = createService({
      connectionsService: { getStatus: async () => ({ ok: true, connections: [] }) },
      env: { HOME: path.join(studioRoot, "home"), PATH: path.join(studioRoot, "empty") },
      projectService: { listProjects: async () => ({ ok: true, projects: [] }) },
      async runCommand({ args, command }) {
        if (command === "git" && args.join(" ") === "var GIT_AUTHOR_IDENT") {
          return ident ? { ok: true, stdout: `${ident} 1761200000 +0800\n` } : { ok: false, error: "spawn git ENOENT" };
        }
        return successfulCommandResult(command, args);
      },
      studioRoot
    });
    return (await service.inspect()).checks.find((check) => check.id === "git-identity");
  };

  const own = await inspect("Ana Diaz <ana@example.test>");
  assert.equal(own.status, "pass");
  assert.equal(own.observed, "Ana Diaz <ana@example.test>");

  const standIn = await inspect("ana via Vibe64 <ana@local.users.vibe64.invalid>");
  assert.equal(standIn.status, "warn");
  assert.match(standIn.observed, /^Git doesn't know your name and email yet, so commits are saved as “ana via Vibe64”\.$/u);
  assert.match(standIn.command, /^git config --global user\.name "Your Name"\ngit config --global user\.email "you@example\.com"$/u);

  assert.equal(await inspect(""), undefined);
});
