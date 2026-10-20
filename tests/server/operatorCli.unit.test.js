import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  configureVibe64Host,
  operatorCliProblem,
  resolveOperatorCli
} from "@local/vibe64-execution/server";

async function withHome(callback) {
  const home = await mkdtemp(path.join(os.tmpdir(), "vibe64-operator-cli-"));
  try {
    return await callback(home);
  } finally {
    configureVibe64Host(null);
    await rm(home, { force: true, recursive: true });
  }
}

async function installFake(dir, tool) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, tool);
  await writeFile(file, "#!/bin/sh\n", "utf8");
  await chmod(file, 0o755);
  return file;
}

test("a host with runtime packs runs its pinned CLI launchers", async () => {
  await withHome(async (packRoot) => {
    configureVibe64Host({ runtimePackRoot: packRoot });
    assert.deepEqual(resolveOperatorCli("claude", { env: {} }),
      { command: path.join(packRoot, "managed-bin", "claude"), installed: true, searched: [] });
    assert.equal(resolveOperatorCli("claude", { env: { VIBE64_CLAUDE_COMMAND: "/fixture/claude" } }).command, "/fixture/claude");
    assert.equal(resolveOperatorCli("codex", { env: {} }).command, path.join(packRoot, "managed-bin", "codex"));
    assert.equal(resolveOperatorCli("opencode", { env: {} }).command, "opencode");
    assert.equal(operatorCliProblem("codex").install, undefined, "a host with packs never shows an install command");
  });
});

test("without packs each CLI is the person's own, found again on every call", async () => {
  await withHome(async (home) => {
    const env = { HOME: home, PATH: path.join(home, "on-path") };
    await mkdir(path.join(home, ".nvm", "versions", "node", "v26.1.0", "bin"), { recursive: true });
    const before = resolveOperatorCli("claude", { env });
    assert.deepEqual(before.searched, [...new Set([
      path.join(home, "on-path"),
      ...[".local/bin", ".claude/local", ".opencode/bin", ".npm-global/bin", ".bun/bin", ".volta/bin"]
        .map((dir) => path.join(home, dir)),
      path.join(home, ".nvm", "versions", "node", "v26.1.0", "bin"),
      path.dirname(process.execPath),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin"
    ])]);

    const installed = await installFake(path.join(home, ".local", "bin"), "claude");
    assert.notEqual(before.command, installed);
    assert.deepEqual(resolveOperatorCli("claude", { env }), { command: installed, installed: true, searched: before.searched });

    const first = await installFake(path.join(home, "on-path"), "codex");
    await installFake(path.join(home, ".npm-global", "bin"), "codex");
    assert.equal(resolveOperatorCli("codex", { env }).command, first, "PATH comes before the usual install folders");

    const nvm = await installFake(path.join(home, ".nvm", "versions", "node", "v26.1.0", "bin"), "opencode");
    assert.equal(resolveOperatorCli("opencode", { env }).command, nvm);
  });
});

test("a CLI found nowhere is reported as not installed", async () => {
  await withHome(async (home) => {
    const result = resolveOperatorCli("claude", { env: { HOME: home, VIBE64_CLAUDE_COMMAND: path.join(home, "absent") } });
    assert.deepEqual(result, { command: path.join(home, "absent"), installed: false, searched: [path.join(home, "absent")] });
  });
});

test("an explicit Claude command is used as given", async () => {
  await withHome(async (home) => {
    const command = await installFake(home, "fixture-claude");
    assert.deepEqual(resolveOperatorCli("claude", { env: { HOME: home, VIBE64_CLAUDE_COMMAND: command } }),
      { command, installed: true, searched: [command] });
  });
});

test("a missing or failing CLI is described plainly, with its official installer", () => {
  assert.deepEqual(operatorCliProblem("claude"), {
    code: "vibe64_cli_not_installed",
    status: "not_installed",
    message: "Claude Code isn't installed on this computer. Vibe64 uses it to work with Claude. Install it, then choose Check again.",
    install: { command: "curl -fsSL https://claude.ai/install.sh | bash", guideUrl: "https://code.claude.com/docs/en/setup" }
  });
  assert.equal(operatorCliProblem("codex").install.command, "curl -fsSL https://chatgpt.com/codex/install.sh | sh");
  assert.equal(operatorCliProblem("opencode").install.command, "curl -fsSL https://opencode.ai/install | bash");
  const failed = operatorCliProblem("codex", { installed: true });
  assert.equal(failed.code, "vibe64_cli_unavailable");
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.message, "Codex is installed but didn't start. Choose Check again; if it keeps failing, reinstall it.");
  assert.throws(() => resolveOperatorCli("gemini"), TypeError);
});
