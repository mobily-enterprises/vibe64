import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  OPERATOR_CLIS,
  SUDO_NOTE,
  checkLocalTools,
  configureVibe64Host,
  localToolFamily,
  localToolIds,
  localToolInstall,
  operatorCliInstall
} from "@local/vibe64-execution/server";
import { resolveRuntimePath } from "../../packages/vibe64-execution/src/server/runtime/resolveRuntimePath.js";

async function withHome(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "vibe64-local-tools-"));
  const previous = { HOME: process.env.HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME, MISE_DATA_DIR: process.env.MISE_DATA_DIR };
  process.env.HOME = home;
  delete process.env.XDG_DATA_HOME;
  delete process.env.MISE_DATA_DIR;
  t.after(async () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    configureVibe64Host(null);
    await rm(home, { force: true, recursive: true });
  });
  return home;
}

async function tool(dir, name, body) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await writeFile(file, `#!/bin/sh\n${body}\n`, "utf8");
  await chmod(file, 0o755);
  return file;
}

test("Stack runtime ids map to rows only for tools the person supplies", () => {
  assert.deepEqual(localToolIds(["node26", "ruby", "cpp", "composer", "php", "nodejs", "unknown"]), ["ruby", "cpp", "php"]);
  assert.deepEqual(localToolIds([]), []);
  assert.equal(localToolFamily({ platform: "darwin" }), "brew");
  assert.equal(localToolFamily({ platform: "linux", aptGet: true }), "apt");
  assert.equal(localToolFamily({ platform: "linux", aptGet: false }), "");
});

test("each computer gets one command: apt, Homebrew or mise, sudo lines say so", () => {
  assert.deepEqual(localToolInstall("cpp", { family: "apt" }), {
    command: "sudo apt install build-essential pkg-config libyaml-dev libssl-dev zlib1g-dev libpq-dev default-libmysqlclient-dev",
    sudo: true, note: SUDO_NOTE
  });
  assert.equal(localToolInstall("cpp", { family: "brew" }).command, "brew install pkg-config libyaml openssl@3");
  assert.equal(localToolInstall("cpp", { family: "" }), null, "other systems use Other ways");
  // Without Apple's command line tools, compilers and Git come from them first.
  assert.equal(localToolInstall("git", { family: "brew", xcode: false }).command, "xcode-select --install");
  // Language runtimes use mise, with -g so nothing is written into the project.
  assert.equal(localToolInstall("python", { family: "apt", mise: true }).command, "mise use -g python@3.13");
  assert.equal(localToolInstall("ruby", { family: "brew", mise: false }).command,
    "curl https://mise.run | sh && ~/.local/bin/mise use -g ruby@3.4");
  assert.equal(localToolInstall("composer", { family: "apt" }).command, localToolInstall("php", { family: "apt" }).command);
  assert.equal(localToolInstall("playwright", { family: "apt" }).sudo, true, "--with-deps asks for the password");
  assert.equal(localToolInstall("missing-tool"), null);
});

test("AI tools keep one shell line and no Windows lines", () => {
  assert.deepEqual(Object.keys(OPERATOR_CLIS), ["claude", "codex", "opencode"]);
  for (const id of Object.keys(OPERATOR_CLIS)) {
    assert.equal(typeof OPERATOR_CLIS[id].install, "string");
    assert.doesNotMatch(operatorCliInstall(id), /irm|powershell|npm install -g/u);
    assert.equal(localToolInstall(id, { family: "apt" }).command, operatorCliInstall(id));
  }
});

test("a tool counts as ready only when it runs; the person's own installs come first", async (t) => {
  const home = await withHome(t);
  const shims = path.join(home, ".local/share/mise/shims");
  await tool(shims, "python3", "echo 'Python 3.13.1'");
  await tool(shims, "ruby", "echo 'ruby: broken interpreter' >&2; exit 1");
  await tool(path.join(home, ".local/bin"), "rustc", "echo 'rustc 1.90.0 (abc 2026-01-01)'");
  await tool(path.join(home, ".local/bin"), "cargo", "echo 'cargo 1.90.0'");

  const result = await checkLocalTools(["python", "ruby", "rust", "kotlin", "node26"], { cwd: home });
  assert.equal(result.managed, false);
  const byId = Object.fromEntries(result.tools.map((entry) => [entry.id, entry]));
  assert.deepEqual(Object.keys(byId), ["python", "ruby", "rust", "kotlin"]);
  assert.equal(byId.python.status, "ready");
  assert.equal(byId.python.path, "~/.local/share/mise/shims/python3", "mise shims win over /usr/bin");
  assert.equal(byId.python.version, "3.13.1");
  assert.equal(byId.python.install, null);
  assert.equal(byId.ruby.status, "broken", "a file that exists but fails is not a working Ruby");
  assert.equal(byId.ruby.path, "~/.local/share/mise/shims/ruby");
  assert.match(byId.ruby.install.command, /mise use -g ruby@3\.4$/u);
  assert.equal(byId.rust.status, "ready");
  assert.equal(byId.rust.version, "1.90.0");
  if (byId.kotlin.status !== "ready") {
    assert.equal(byId.kotlin.status, "missing");
    assert.equal(byId.kotlin.path, "");
  }
});

test("the tool PATH puts ~/.local/bin and mise shims before the inherited PATH", async (t) => {
  const home = await withHome(t);
  assert.doesNotMatch(resolveRuntimePath({ inheritedPath: "/usr/bin" }), new RegExp(home, "u"), "absent folders are left out");
  await mkdir(path.join(home, ".local/bin"), { recursive: true });
  await mkdir(path.join(home, ".local/share/mise/shims"), { recursive: true });
  const parts = resolveRuntimePath({ existingPath: "/caller/bin", inheritedPath: "/usr/bin:/bin" }).split(":");
  assert.deepEqual(parts.slice(0, 4),
    ["/caller/bin", path.join(home, ".local/bin"), path.join(home, ".local/share/mise/shims"), "/usr/bin"],
    "a caller's own entries stay first; the person's installs beat the inherited PATH");
  await mkdir(path.join(home, ".opencode/bin"), { recursive: true });
  assert.ok(resolveRuntimePath({ inheritedPath: "/usr/bin" }).split(":").includes(path.join(home, ".opencode/bin")),
    "a fresh opencode install is found without a new shell");

  configureVibe64Host({ runtimePackRoot: path.join(home, "packs") });
  assert.doesNotMatch(resolveRuntimePath({ inheritedPath: "/usr/bin" }), /\.local/u, "packs keep their own PATH");
  assert.deepEqual(await checkLocalTools(["python"], { cwd: home }), { ok: true, managed: true, tools: [] });
});

test("the terminal stays quiet when an AI tool is there; one plain message when none is", async (t) => {
  const home = await withHome(t);
  const { warnMissingOperatorClis } = await import("../../packages/vibe64-accounts/src/server/Vibe64AccountsFeature.js");
  const lines = [];
  configureVibe64Host({ runtimePackRoot: path.join(home, "packs") });
  warnMissingOperatorClis((text) => lines.push(text));
  assert.deepEqual(lines, [], "a host with packs always has its tools");
  configureVibe64Host(null);
  await tool(path.join(home, ".local/bin"), "claude", "echo 2.1.0");
  warnMissingOperatorClis((text) => lines.push(text));
  assert.deepEqual(lines, [], "Claude alone is enough: no nagging about Codex or opencode");
});
