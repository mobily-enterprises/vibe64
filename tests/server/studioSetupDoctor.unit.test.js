import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  spawnSync
} from "node:child_process";
import test from "node:test";

import {
  createStudioHostCommandDoctorPlugin,
  createService,
  isValidPlaywrightBrowserLaunchOutput,
  isValidPlaywrightRuntimeOutput,
  isStudioSetupReady,
  playwrightBrowserLaunchCommandArgs,
  playwrightRuntimeVersionCommandArgs,
  resolveStudioRoot
} from "../../packages/studio-setup-doctor/src/server/service.js";
import {
  terminalInputValidator
} from "../../packages/studio-setup-doctor/src/server/inputSchemas.js";
import {
  registerRoutes as registerStudioSetupRoutes
} from "../../packages/studio-setup-doctor/src/server/registerRoutes.js";
import {
  runDoctorGatewayCommand
} from "../../packages/setup-doctor-core/src/server/doctorCommandRunner.js";
import {
  findRegisteredRoute,
  testReply,
  testRouteApp,
  withLocalRequestBypass
} from "./vibe64RouteTestHelpers.js";

process.env.VIBE64_RUNTIME_NAMESPACE = "unit-owner";

function writeExecutable(filePath, source) {
  writeFileSync(filePath, source);
  chmodSync(filePath, 0o755);
}

function createManagedPlaywrightFixture({
  browserProduct = "Google Chrome for Testing",
  browserVersion = "123.4.5.6",
  chromiumRevision = "9876",
  chromiumVersion = "123.4.5.6",
  headlessShellVersion = "123.4.5.6",
  playwrightCliVersion = "9.8.7",
  playwrightVersion = "9.8.7",
  root = mkdtempSync(path.join(tmpdir(), "vibe64-playwright-runtime-"))
} = {}) {
  const playwrightRuntime = path.join(root, "playwright");
  const runtimeStore = path.join(root, "runtime-store");
  const browsersStore = path.join(root, "browsers-store");
  const chromium = path.join(
    browsersStore,
    `chromium-${chromiumRevision}`,
    "chrome-linux",
    "chrome"
  );
  const headlessShell = path.join(
    browsersStore,
    `chromium_headless_shell-${chromiumRevision}`,
    "chrome-linux",
    "headless_shell"
  );
  const ffmpeg = path.join(browsersStore, "ffmpeg-1234");

  mkdirSync(path.join(playwrightRuntime), { recursive: true });
  mkdirSync(path.join(runtimeStore, "bin"), { recursive: true });
  mkdirSync(path.dirname(chromium), { recursive: true });
  mkdirSync(path.dirname(headlessShell), { recursive: true });
  mkdirSync(ffmpeg, { recursive: true });
  symlinkSync(runtimeStore, path.join(playwrightRuntime, "runtime"), "dir");
  symlinkSync("runtime/bin", path.join(playwrightRuntime, "bin"), "dir");
  symlinkSync(browsersStore, path.join(playwrightRuntime, "browsers"), "dir");

  writeExecutable(path.join(runtimeStore, "bin", "playwright"), [
    "#!/usr/bin/env bash",
    "if [ \"${1:-}\" = \"--version\" ]; then",
    `  printf 'Version ${playwrightCliVersion}\\n'`,
    "  exit 0",
    "fi",
    "printf 'Unexpected Playwright command: %s\\n' \"$*\" >&2",
    "exit 64",
    ""
  ].join("\n"));
  writeExecutable(chromium, [
    "#!/usr/bin/env bash",
    "if [ \"${1:-}\" = \"--version\" ]; then",
    `  printf '${browserProduct} ${browserVersion}\\n'`,
    "else",
    "  printf '<h1>vibe64-playwright-ok</h1>\\n'",
    "fi",
    ""
  ].join("\n"));
  writeExecutable(headlessShell, [
    "#!/usr/bin/env bash",
    `printf 'Chromium ${headlessShellVersion}\\n'`,
    ""
  ].join("\n"));
  writeFileSync(path.join(playwrightRuntime, "runtime.env"), [
    `playwright_version=${playwrightVersion}`,
    `chromium_revision=${chromiumRevision}`,
    `chromium_version=${chromiumVersion}`,
    "ffmpeg_revision=1234",
    `release_contract_sha256=${"a".repeat(64)}`,
    `runtime_store_path=${runtimeStore}`,
    `browsers_store_path=${browsersStore}`,
    ""
  ].join("\n"));

  return {
    browsersPath: path.join(playwrightRuntime, "browsers"),
    browsersStore,
    chromium,
    playwrightRuntime,
    root
  };
}

test("Studio Setup readiness requires every required check to pass", () => {
  assert.equal(isStudioSetupReady([
    { required: true, status: "pass" },
    { required: true, status: "pass" }
  ]), true);
  assert.equal(isStudioSetupReady([
    { required: true, status: "pass" },
    { required: true, status: "fail" }
  ]), false);
  assert.equal(isStudioSetupReady([
    { required: false, status: "fail" },
    { required: true, status: "pass" }
  ]), true);
});

test("Studio Setup Playwright checks follow the active managed runtime manifest", () => {
  const commandArgs = playwrightBrowserLaunchCommandArgs();
  assert.deepEqual(commandArgs.slice(0, 2), ["bash", "-c"]);
  assert.match(commandArgs[2], /PLAYWRIGHT_BROWSERS_PATH/u);
  assert.match(commandArgs[2], /PLAYWRIGHT_BROWSERS_PATH is required/u);
  assert.match(commandArgs[2], /must not resolve under \/home/u);
  assert.match(commandArgs[2], /runtime_manifest="\$playwright_runtime\/runtime\.env"/u);
  assert.match(commandArgs[2], /playwright_version/u);
  assert.match(commandArgs[2], /chromium_revision/u);
  assert.match(commandArgs[2], /chromium_version/u);
  assert.match(commandArgs[2], /ffmpeg_revision/u);
  assert.match(commandArgs[2], /release_contract_sha256/u);
  assert.match(commandArgs[2], /runtime_store_path/u);
  assert.match(commandArgs[2], /browsers_store_path/u);
  assert.doesNotMatch(commandArgs[2], /VIBE64_SHARED_CACHE_ROOT/u);
  assert.doesNotMatch(commandArgs[2], /\/var\/cache\/vibe64\/playwright/u);
  assert.doesNotMatch(commandArgs[2], /\$HOME\/\.cache\/ms-playwright/u);
  assert.doesNotMatch(commandArgs[2], /playwright install/u);
  assert.doesNotMatch(commandArgs[2], /browser:\[\[:space:\]\]\*chromium/u);
  assert.match(commandArgs[2], /expected_chromium/u);
  assert.match(commandArgs[2], /expected_chromium_version/u);
  assert.match(commandArgs[2], /find -H "\$expected_chromium"/u);
  assert.match(commandArgs[2], /chromium_headless_shell-/u);
  assert.match(commandArgs[2], /ffmpeg-/u);
  assert.match(commandArgs[2], /reported_chromium_version/u);
  assert.match(commandArgs[2], /Chromium version mismatch/u);
  assert.match(commandArgs[2], /ldd "\$browser"/u);
  assert.match(commandArgs[2], /vibe64-playwright-launch/u);
  assert.match(commandArgs[2], /--dump-dom/u);

  assert.equal(isValidPlaywrightBrowserLaunchOutput(
    "Playwright browser launched: /opt/vibe64/runtime-packs/playwright/browsers/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell"
  ), true);
  assert.equal(isValidPlaywrightBrowserLaunchOutput([
    "libnss3.so => not found",
    "Playwright browser launched: /opt/vibe64/runtime-packs/playwright/browsers/chromium-1223/chrome-linux64/chrome"
  ].join("\n")), false);

  const runtimeArgs = playwrightRuntimeVersionCommandArgs();
  assert.deepEqual(runtimeArgs.slice(0, 2), ["bash", "-c"]);
  assert.match(runtimeArgs[2], /Playwright runtime ready:/u);
  assert.match(runtimeArgs[2], /runtime\.env/u);
  assert.doesNotMatch(runtimeArgs[2], /1\.50/u);
  assert.equal(isValidPlaywrightRuntimeOutput(
    "Playwright runtime ready: Version 1.61.1; manifest /opt/vibe64/runtime-packs/playwright/runtime.env"
  ), true);
});

test("Studio Setup Playwright browser check fails missing or invalid shared runtime", () => {
  const commandArgs = playwrightBrowserLaunchCommandArgs();
  const run = (env = {}) => spawnSync(commandArgs[0], commandArgs.slice(1), {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      ...env
    }
  });

  const missing = run();
  assert.notEqual(missing.status, 0);
  assert.match(`${missing.stdout}${missing.stderr}`, /PLAYWRIGHT_BROWSERS_PATH is required/u);

  const homePath = run({
    PLAYWRIGHT_BROWSERS_PATH: "/home/unit/playwright/browsers"
  });
  assert.notEqual(homePath.status, 0);
  assert.match(`${homePath.stdout}${homePath.stderr}`, /must not resolve under \/home/u);

  const emptyRuntime = mkdtempSync(path.join(tmpdir(), "vibe64-empty-playwright-"));
  try {
    const browsersPath = path.join(emptyRuntime, "playwright", "browsers");
    mkdirSync(browsersPath, { recursive: true });
    const empty = run({
      HOME: emptyRuntime,
      PLAYWRIGHT_BROWSERS_PATH: browsersPath
    });
    assert.notEqual(empty.status, 0);
    assert.match(`${empty.stdout}${empty.stderr}`, /Managed Playwright runtime manifest is missing/u);
  } finally {
    rmSync(emptyRuntime, {
      force: true,
      recursive: true
    });
  }
});

test("Studio Setup Playwright version check uses runtime.env instead of the generic catalog", () => {
  const matching = createManagedPlaywrightFixture({
    playwrightCliVersion: "1.61.1",
    playwrightVersion: "1.61.1"
  });
  const mismatched = createManagedPlaywrightFixture({
    playwrightCliVersion: "1.60.0",
    playwrightVersion: "1.61.1"
  });
  try {
    const commandArgs = playwrightRuntimeVersionCommandArgs();
    const run = (browsersPath) => spawnSync(commandArgs[0], commandArgs.slice(1), {
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin",
        PLAYWRIGHT_BROWSERS_PATH: browsersPath
      }
    });
    const ready = run(matching.browsersPath);
    assert.equal(ready.status, 0, `${ready.stdout}${ready.stderr}`);
    assert.equal(isValidPlaywrightRuntimeOutput(ready.stdout), true);
    assert.match(ready.stdout, /Version 1\.61\.1/u);
    assert.match(ready.stdout, /playwright\/runtime\.env/u);

    const mismatch = run(mismatched.browsersPath);
    assert.notEqual(mismatch.status, 0);
    assert.match(
      `${mismatch.stdout}${mismatch.stderr}`,
      /Managed Playwright version mismatch: expected 1\.61\.1, observed 1\.60\.0/u
    );
  } finally {
    rmSync(matching.root, { force: true, recursive: true });
    rmSync(mismatched.root, { force: true, recursive: true });
  }
});

test("Studio Setup Playwright checks reject store paths that diverge from runtime.env", () => {
  const fixture = createManagedPlaywrightFixture();
  const unexpectedStore = path.join(fixture.root, "unexpected-browsers-store");
  try {
    mkdirSync(unexpectedStore);
    rmSync(fixture.browsersPath);
    symlinkSync(unexpectedStore, fixture.browsersPath, "dir");

    const commandArgs = playwrightRuntimeVersionCommandArgs();
    const result = spawnSync(commandArgs[0], commandArgs.slice(1), {
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin",
        PLAYWRIGHT_BROWSERS_PATH: fixture.browsersPath
      }
    });

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}${result.stderr}`,
      new RegExp(`Managed Playwright browser store mismatch: expected ${fixture.browsersStore}`, "u")
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test("Studio Setup Playwright browser check rejects a revision directory with the wrong binary version", () => {
  const fixture = createManagedPlaywrightFixture({
    browserVersion: "999.0.0.0"
  });
  try {
    const commandArgs = playwrightBrowserLaunchCommandArgs();
    const result = spawnSync(commandArgs[0], commandArgs.slice(1), {
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin",
        PLAYWRIGHT_BROWSERS_PATH: fixture.browsersPath
      }
    });

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}${result.stderr}`,
      /Chromium version mismatch: expected 123\.4\.5\.6, observed 999\.0\.0\.0/u
    );
  } finally {
    rmSync(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("Studio Setup Playwright browser check ignores trailing version whitespace", () => {
  const fixture = createManagedPlaywrightFixture({
    browserVersion: "123.4.5.6 ",
    headlessShellVersion: "123.4.5.6 "
  });
  try {
    const commandArgs = playwrightBrowserLaunchCommandArgs();
    const result = spawnSync(commandArgs[0], commandArgs.slice(1), {
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin",
        PLAYWRIGHT_BROWSERS_PATH: fixture.browsersPath
      }
    });

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /Playwright browser launched:/u);
  } finally {
    rmSync(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("Studio Setup doctor commands use the gateway shared Playwright runtime env", async () => {
  const result = await runDoctorGatewayCommand(process.execPath, [
    "-e",
    "console.log(process.env.PLAYWRIGHT_BROWSERS_PATH)"
  ], {
    runtimes: ["node26"]
  });

  assert.equal(result.ok, true, result.output);
  assert.equal(result.stdout.trim(), "/opt/vibe64/runtime-packs/playwright/browsers");
});

test("Studio Setup host checks shared runtime-pack tools without requiring tenant Nix access", () => {
  const checks = createStudioHostCommandDoctorPlugin().checks();
  const ids = checks.map((check) => check.id);

  assert.equal(ids.includes("nix"), false);
  assert.equal(ids.includes("nix-access"), false);
  assert.ok(ids.includes("node"));
  assert.ok(ids.includes("npm"));
  assert.ok(ids.includes("playwright"));
  assert.ok(ids.includes("playwright-browser"));
  assert.ok(ids.includes("codex"));
  assert.ok(ids.includes("opencode"));
  assert.equal(ids.includes("pnpm"), false);
  assert.equal(ids.includes("yarn"), false);
});

test("Studio Setup terminal input preserves enter/control characters", () => {
  const result = terminalInputValidator.schema.create({
    data: "\r"
  });

  assert.deepEqual(result.errors, {});
  assert.equal(result.validatedObject.data, "\r");
});

test("Studio Setup terminal actions require the Vibe64 owner", async () => {
  const service = createService();
  const memberInput = {
    actionId: "manual-host-setup",
    vibe64User: {
      email: "member@example.com",
      role: "member"
    }
  };

  const startResponse = await service.startTerminal(memberInput);
  assert.equal(startResponse.ok, false);
  assert.equal(startResponse.errors[0].code, "vibe64_owner_required");

  const readResponse = service.readTerminal("setup-terminal", memberInput);
  assert.equal(readResponse.ok, false);
  assert.equal(readResponse.errors[0].code, "vibe64_owner_required");

  const writeResponse = service.writeTerminal("setup-terminal", "\r", memberInput);
  assert.equal(writeResponse.ok, false);
  assert.equal(writeResponse.errors[0].code, "vibe64_owner_required");

  const closeResponse = service.closeTerminal("setup-terminal", memberInput);
  assert.equal(closeResponse.ok, false);
  assert.equal(closeResponse.errors[0].code, "vibe64_owner_required");
});

test("Studio Setup live status inspection requires the Vibe64 owner", async () => {
  const service = createService();
  const memberInput = {
    refresh: true,
    vibe64User: {
      email: "member@example.com",
      role: "member"
    }
  };

  const statusResponse = await service.getStatus(memberInput);
  assert.equal(statusResponse.ok, false);
  assert.equal(statusResponse.errors[0].code, "vibe64_owner_required");

  const streamResponse = await service.streamStatus(memberInput);
  assert.equal(streamResponse.ok, false);
  assert.equal(streamResponse.errors[0].code, "vibe64_owner_required");
});

test("Studio Setup status route omits absent local users instead of injecting null", async () => {
  await withLocalRequestBypass(async () => {
    let receivedInput = null;
    const app = testRouteApp();

    registerStudioSetupRoutes(app, {
      routeRelativePath: "studio/studio-setup",
      routeSurface: "app",
      projectScoped: false
    });

    const route = findRegisteredRoute(app, {
      method: "GET",
      path: "/api/studio/studio-setup"
    });
    assert.ok(route);

    const reply = testReply();
    await route.handler({
      executeAction({ input }) {
        receivedInput = input;
        return {
          ok: true,
          ready: true,
          checks: []
        };
      },
      input: {
        query: {}
      }
    }, reply);

    assert.equal(reply.statusCode, 200);
    assert.deepEqual(receivedInput, {});
    assert.equal(Object.hasOwn(receivedInput, "vibe64User"), false);
  });
});

test("Studio Setup terminal routes pass the Vibe64 user into the service", async () => {
  await withLocalRequestBypass(async () => {
    let receivedInput = null;
    const app = testRouteApp();
    const originalMake = app.make.bind(app);
    app.make = (token) => {
      if (token === "feature.studio-setup-doctor.service") {
        return {
          startTerminal(input) {
            receivedInput = input;
            return {
              id: "setup-terminal",
              ok: true
            };
          }
        };
      }
      return originalMake(token);
    };

    registerStudioSetupRoutes(app, {
      routeRelativePath: "studio/studio-setup",
      routeSurface: "app",
      projectScoped: false
    });

    const route = findRegisteredRoute(app, {
      method: "POST",
      path: "/api/studio/studio-setup/terminal"
    });
    assert.ok(route);

    const vibe64User = {
      email: "owner@example.com",
      role: "owner"
    };
    const reply = testReply();
    await route.handler({
      input: {
        body: {
          actionId: "manual-host-setup",
          vibe64User: {
            email: "spoof@example.com",
            role: "owner"
          }
        }
      },
      vibe64User
    }, reply);

    assert.equal(reply.statusCode, 200);
    assert.equal(receivedInput.actionId, "manual-host-setup");
    assert.deepEqual(receivedInput.vibe64User, vibe64User);
  });
});

test("Studio Setup resolves the Studio implementation root separately", () => {
  const previousStudioRoot = process.env.VIBE64_APP_ROOT;
  const envRoot = path.join(tmpdir(), "example-studio-root");
  const explicitRoot = path.join(tmpdir(), "explicit-studio-root");
  process.env.VIBE64_APP_ROOT = envRoot;

  try {
    assert.equal(resolveStudioRoot(), envRoot);
    assert.equal(resolveStudioRoot(explicitRoot), explicitRoot);
  } finally {
    if (previousStudioRoot == null) {
      delete process.env.VIBE64_APP_ROOT;
    } else {
      process.env.VIBE64_APP_ROOT = previousStudioRoot;
    }
  }
});

test("Studio Setup does not own app-specific setup repairs", async () => {
  const service = createService();

  const response = await service.startTerminal({
    actionId: "start-app-database",
    vibe64User: {
      email: "owner@example.com",
      role: "owner"
    }
  });

  assert.equal(response.ok, false);
  assert.equal(response.error, "Unknown terminal action.");
});
