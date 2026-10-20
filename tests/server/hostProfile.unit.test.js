import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test, { after } from "node:test";

import {
  configureVibe64Host,
  vibe64Host,
  vibe64ProcessUmask,
  vibe64SharedModes
} from "../../packages/vibe64-execution/src/server/hostProfile.js";
import { runVibe64Command } from "../../packages/vibe64-execution/src/server/runVibe64Command.js";
import { resolveRuntimePath } from "../../packages/vibe64-execution/src/server/runtime/resolveRuntimePath.js";
import { sharedToolEnv } from "../../packages/vibe64-execution/src/server/env/sharedToolEnv.js";
import { runHelperCommand } from "../../packages/vibe64-execution/src/server/engines/helperClient.js";
import {
  isValidPlaywrightRuntimeOutput,
  playwrightRuntimeVersionCheckScript
} from "../../packages/vibe64-execution/src/server/runtime/browserRuntime.js";
import {
  resolveDefaultLocalEditorSystemRoot,
  resolveVibe64Roots
} from "../../packages/vibe64-core/src/server/studioRoots.js";
import { shellQuote } from "../../packages/vibe64-execution/src/server/shellText.js";
import { macosDataMoveMessage } from "../../bin/server.js";

after(() => configureVibe64Host(null));

function withPlatform(t, platform) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...original, value: platform });
  t.after(() => Object.defineProperty(process, "platform", original));
}

test("a person's own computer needs no host configuration", () => {
  configureVibe64Host(null);
  assert.deepEqual({ ...vibe64Host() }, {
    runtimePackRoot: "",
    sharedCacheRoot: "",
    execHelperPath: "",
    sharedGroupAccess: false
  });
  assert.deepEqual(vibe64SharedModes(), { inheritingDirectory: 0o700, directory: 0o700, file: 0o600 });
  assert.equal(vibe64ProcessUmask(), "");
});

test("a host profile is validated, frozen and replaces the local defaults", (t) => {
  t.after(() => configureVibe64Host(null));
  assert.throws(() => configureVibe64Host({ runtimePackRoot: "relative/packs" }), /absolute path or empty/u);
  assert.throws(() => configureVibe64Host({ sharedGroupAccess: "yes" }), /true or false/u);
  assert.throws(() => configureVibe64Host({ packRoot: "/srv/packs" }), /Unknown host profile setting: packRoot/u);

  const previousUmask = process.umask();
  t.after(() => process.umask(previousUmask));
  const profile = configureVibe64Host({
    runtimePackRoot: "/srv/packs",
    sharedCacheRoot: "/srv/cache",
    execHelperPath: "/srv/helper",
    sharedGroupAccess: true
  });
  assert.equal(vibe64Host(), profile);
  assert.ok(Object.isFrozen(profile));
  assert.equal(process.umask(), 0o007);
  assert.deepEqual(vibe64SharedModes(), { inheritingDirectory: 0o2770, directory: 0o770, file: 0o660 });
  assert.equal(vibe64ProcessUmask(), "0007");
});

test("commands use the person's own tools without pinned-pack settings", async () => {
  configureVibe64Host(null);
  const result = await runVibe64Command({
    command: process.execPath,
    args: ["-e", "console.log(JSON.stringify(process.env))"],
    purpose: "terminal"
  });
  assert.equal(result.ok, true, result.output);
  const env = JSON.parse(result.stdout);
  for (const name of ["PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", "VIBE64_PLAYWRIGHT_VERSION", "VIBE64_SHARED_CACHE_ROOT"]) {
    assert.equal(env[name], undefined, name);
  }
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, process.env.PLAYWRIGHT_BROWSERS_PATH);
  assert.equal(env.NPM_CONFIG_PREFIX, process.env.NPM_CONFIG_PREFIX);
  const parts = env.PATH.split(":");
  assert.ok(!parts.some((part) => /policy-bin|guard-bin|managed-bin/u.test(part)), env.PATH);
  for (const part of String(process.env.PATH || "").split(":").filter(Boolean)) {
    assert.ok(parts.includes(part), `${part} stays reachable`);
  }
});

test("without packs the runtime path keeps the server's PATH and Homebrew on macOS", (t) => {
  configureVibe64Host(null);
  withPlatform(t, "darwin");
  const parts = resolveRuntimePath({ existingPath: "/caller/bin", runtimes: ["node26", "git"] }).split(":");
  assert.equal(parts[0], "/caller/bin");
  assert.ok(parts.includes("/opt/homebrew/bin"));
  assert.ok(!parts.some((part) => part.includes("node26")));
});

test("pinned packs and an explicit option take precedence over the person's tools", (t) => {
  configureVibe64Host({ runtimePackRoot: "/srv/packs", sharedCacheRoot: "/srv/cache" });
  t.after(() => configureVibe64Host(null));
  const parts = resolveRuntimePath({ existingPath: "/caller/bin", runtimes: ["node26"] }).split(":");
  assert.deepEqual(parts.slice(0, 4), ["/srv/packs/policy-bin", "/srv/packs/node26/bin", "/srv/packs/guard-bin", "/caller/bin"]);
  assert.ok(!parts.includes("/opt/homebrew/bin"));
  assert.deepEqual(sharedToolEnv(), {
    VIBE64_SHARED_CACHE_ROOT: "/srv/cache",
    PLAYWRIGHT_BROWSERS_PATH: "/srv/packs/playwright/browsers",
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"
  });
  assert.equal(sharedToolEnv({ runtimePackRoot: "/srv/other", sharedCacheRoot: "/srv/other-cache" })
    .PLAYWRIGHT_BROWSERS_PATH, "/srv/other/playwright/browsers");
});

test("running a command as another user needs the host's helper", async () => {
  configureVibe64Host(null);
  await assert.rejects(runHelperCommand({}, { runCapture: () => ({ ok: true }) }), {
    code: "vibe64_exec_helper_unavailable"
  });
});

test("the Playwright check names the installed command without packs", () => {
  configureVibe64Host(null);
  const script = playwrightRuntimeVersionCheckScript();
  assert.match(script, /command -v playwright/u);
  assert.doesNotMatch(script, /runtime\.env|PLAYWRIGHT_BROWSERS_PATH:\?/u);
  assert.equal(isValidPlaywrightRuntimeOutput("Playwright runtime ready: Version 1.50.1; command /usr/local/bin/playwright"), true);
});

test("local data and project sources live in the person's own folders", () => {
  const home = "/Users/ada";
  assert.equal(resolveDefaultLocalEditorSystemRoot(home, "darwin"), "/Users/ada/Library/Application Support/Vibe64");
  assert.equal(resolveVibe64Roots({ env: {}, home, runtimeProfile: { local: true } }).managedSourceRoot, "/Users/ada/Vibe64");
});

test("macOS startup explains how to move data from the earlier folder and changes nothing", () => {
  const home = "/Users/ada";
  const previous = resolveDefaultLocalEditorSystemRoot(home, "linux");
  const current = path.join(home, "Library", "Application Support", "Vibe64");
  const existing = new Set([previous]);
  const message = macosDataMoveMessage({ env: {}, exists: (file) => existing.has(file), home, platform: "darwin" });
  assert.ok(message.endsWith(`\n  mv ${shellQuote(previous)} ${shellQuote(current)}`), message);
  existing.add(current);
  assert.equal(macosDataMoveMessage({ env: {}, exists: (file) => existing.has(file), home, platform: "darwin" }), "");
  assert.equal(macosDataMoveMessage({ env: {}, exists: () => true, home, platform: "linux" }), "");
  assert.equal(macosDataMoveMessage({ env: { VIBE64_SYSTEM_ROOT: "/srv/state" }, exists: (file) => file === previous, home, platform: "darwin" }), "");
});
