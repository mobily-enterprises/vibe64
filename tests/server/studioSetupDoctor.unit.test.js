import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync
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
  isStudioSetupReady,
  isValidPlaywrightOutput,
  playwrightBrowserLaunchCommandArgs,
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

test("Studio Setup Playwright check accepts the shared browser cache path", () => {
  assert.equal(isValidPlaywrightOutput([
    "Version 1.60.0",
    "/var/cache/vibe64/playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell"
  ].join("\n")), true);

  assert.equal(isValidPlaywrightOutput([
    "Version 1.60.0",
    "/var/cache/vibe64/playwright/chromium-1223/chrome-linux64/chrome"
  ].join("\n")), true);

  assert.equal(isValidPlaywrightOutput([
    "Version 1.60.0",
    "/var/cache/vibe64/playwright/chromium-1223/chrome-linux64/README"
  ].join("\n")), false);
});

test("Studio Setup Playwright browser check launches a discovered browser", () => {
  const commandArgs = playwrightBrowserLaunchCommandArgs();
  assert.deepEqual(commandArgs.slice(0, 2), ["bash", "-lc"]);
  assert.match(commandArgs[2], /PLAYWRIGHT_BROWSERS_PATH/u);
  assert.match(commandArgs[2], /PLAYWRIGHT_BROWSERS_PATH is required/u);
  assert.match(commandArgs[2], /must not resolve under \/home/u);
  assert.doesNotMatch(commandArgs[2], /VIBE64_SHARED_CACHE_ROOT/u);
  assert.doesNotMatch(commandArgs[2], /\/var\/cache\/vibe64\/playwright/u);
  assert.doesNotMatch(commandArgs[2], /\$HOME\/\.cache\/ms-playwright/u);
  assert.match(commandArgs[2], /ldd "\$browser"/u);
  assert.match(commandArgs[2], /--dump-dom/u);

  assert.equal(isValidPlaywrightBrowserLaunchOutput(
    "Playwright browser launched: /var/cache/vibe64/playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell"
  ), true);
  assert.equal(isValidPlaywrightBrowserLaunchOutput([
    "libnss3.so => not found",
    "Playwright browser launched: /var/cache/vibe64/playwright/chromium-1223/chrome-linux64/chrome"
  ].join("\n")), false);
});

test("Studio Setup Playwright browser check fails missing or invalid shared cache", () => {
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
    PLAYWRIGHT_BROWSERS_PATH: "/home/unit/.cache/ms-playwright"
  });
  assert.notEqual(homePath.status, 0);
  assert.match(`${homePath.stdout}${homePath.stderr}`, /must not resolve under \/home/u);

  const emptyCache = mkdtempSync(path.join(tmpdir(), "vibe64-empty-playwright-"));
  try {
    const empty = run({
      PLAYWRIGHT_BROWSERS_PATH: emptyCache
    });
    assert.notEqual(empty.status, 0);
    assert.match(`${empty.stdout}${empty.stderr}`, /No Playwright Chromium browser was found below/u);
  } finally {
    rmSync(emptyCache, {
      force: true,
      recursive: true
    });
  }
});

test("Studio Setup doctor commands use the gateway shared Playwright cache env", async () => {
  const result = await runDoctorGatewayCommand(process.execPath, [
    "-e",
    "console.log(process.env.PLAYWRIGHT_BROWSERS_PATH)"
  ], {
    runtimes: ["node22"]
  });

  assert.equal(result.ok, true, result.output);
  assert.equal(result.stdout.trim(), "/var/cache/vibe64/playwright");
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
