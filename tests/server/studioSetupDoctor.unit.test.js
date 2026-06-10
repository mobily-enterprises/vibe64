import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REINSTALL_CODEX_CLI_TERMINAL_PREVIEW,
  TOOLCHAIN_IMAGE,
  createService,
  createStudioTenantRuntimeDoctorPlugin,
  isStudioSetupReady,
  reinstallCodexCliRepair,
  reinstallCodexCliScript,
  reinstallCodexCliTerminalScript,
  resolveStudioRoot
} from "../../packages/studio-setup-doctor/src/server/service.js";
import {
  terminalInputValidator
} from "../../packages/studio-setup-doctor/src/server/inputSchemas.js";
import {
  registerRoutes as registerStudioSetupRoutes
} from "../../packages/studio-setup-doctor/src/server/registerRoutes.js";
import {
  STUDIO_TOOL_HOME_NPM_PREFIX,
  STUDIO_TOOL_HOME_PATH
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  findRegisteredRoute,
  testReply,
  testRouteApp,
  withLocalRequestBypass
} from "./vibe64RouteTestHelpers.js";
import {
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

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
    actionId: "reinstall-codex-cli",
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
          actionId: "reinstall-codex-cli"
        }
      },
      vibe64User
    }, reply);

    assert.equal(reply.statusCode, 200);
    assert.equal(receivedInput.actionId, "reinstall-codex-cli");
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
    assert.equal(TOOLCHAIN_IMAGE, "ghcr.io/mobily-enterprises/vibe64-base-toolchain:0.1.0");
  } finally {
    if (previousStudioRoot == null) {
      delete process.env.VIBE64_APP_ROOT;
    } else {
      process.env.VIBE64_APP_ROOT = previousStudioRoot;
    }
  }
});

test("Studio Setup owns the shared tenant JSKIT MariaDB runtime", async () => {
  await withTemporaryRoot(async (studioRoot) => {
    const plugin = createStudioTenantRuntimeDoctorPlugin({
      runCommand: async () => ({
        ok: false,
        output: "No such container",
        stdout: ""
      }),
      studioRoot,
      tenantId: "tonymobily"
    });
    const checks = await plugin.checks({
      studioRoot
    });
    const mariaDbCheck = checks.find((check) => check.id === "jskit-mariadb");

    assert.ok(mariaDbCheck);
    assert.equal(mariaDbCheck.label, "JSKIT MariaDB");

    const result = await mariaDbCheck.run({
      studioRoot
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.repair.actionId, "start-runtime-container-jskit-mariadb");
    assert.match(result.repair.commandPreview, /--name vibe64-jskit-mariadb-tonymobily/u);
    assert.match(result.repair.commandPreview, /-v vibe64_jskit_mariadb_data_tonymobily:\/var\/lib\/mysql/u);
    assert.doesNotMatch(result.repair.commandPreview, /MARIADB_DATABASE=/u);
  });
});

test("Studio Setup Codex repair reinstalls Codex in the managed tool home", () => {
  const repair = reinstallCodexCliRepair();
  const script = reinstallCodexCliScript();

  assert.equal(repair.actionId, "reinstall-codex-cli");
  assert.equal(repair.autoRun, false);
  assert.equal(repair.label, "Reinstall Codex CLI");
  assert.match(repair.commandPreview, /docker run/u);
  assert.ok(repair.commandPreview.includes(`HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(repair.commandPreview.includes(`NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));
  assert.match(repair.commandPreview, /CODEX_GLOBAL_PACKAGE_DIR=/u);
  assert.match(repair.commandPreview, /rm -rf "\$CODEX_GLOBAL_PACKAGE_DIR\/codex"/u);
  assert.match(repair.commandPreview, /rm -rf "\$CODEX_GLOBAL_PACKAGE_DIR\/\.codex-"\*/u);
  assert.match(repair.commandPreview, /npm install -g @openai\/codex@latest/u);
  assert.doesNotMatch(repair.commandPreview, /docker build -t vibe64-base-toolchain/u);
  assert.doesNotMatch(script, /npm uninstall -g @openai\/codex/u);
  assert.match(script, /rm -rf "\$CODEX_GLOBAL_PACKAGE_DIR\/codex"/u);
  assert.match(script, /codex --version/u);
});

test("Studio Setup Codex repair terminal shows clear lifecycle text", () => {
  const script = reinstallCodexCliTerminalScript();

  assert.equal(REINSTALL_CODEX_CLI_TERMINAL_PREVIEW, "Reinstall Codex CLI inside the managed Studio toolchain");
  assert.match(script, /Vibe64 setup: reinstalling Codex CLI/u);
  assert.match(script, /Status: running\. Keep this terminal open\./u);
  assert.match(script, /Status: done\. Codex CLI was reinstalled and verified\./u);
  assert.match(script, /It is safe to close this terminal\./u);
  assert.doesNotMatch(script, /echo '\$ docker run/u);
  assert.doesNotMatch(script, /printf '%s\\n' '\$ docker run/u);
  assert.match(script, /npm install -g @openai\/codex@latest/u);
});
