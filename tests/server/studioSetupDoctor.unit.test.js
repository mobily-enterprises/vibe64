import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TOOLCHAIN_IMAGE,
  createService,
  isStudioSetupReady,
  resolveStudioRoot
} from "../../packages/studio-setup-doctor/src/server/service.js";
import {
  terminalInputValidator
} from "../../packages/studio-setup-doctor/src/server/inputSchemas.js";
import {
  registerRoutes as registerStudioSetupRoutes
} from "../../packages/studio-setup-doctor/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  testReply,
  testRouteApp,
  withLocalRequestBypass
} from "./vibe64RouteTestHelpers.js";

process.env.VIBE64_RUNTIME_NAMESPACE = "unit-tenant";

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
    actionId: "manual-docker",
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
          actionId: "manual-docker",
          vibe64User: {
            email: "spoof@example.com",
            role: "owner"
          }
        }
      },
      vibe64User
    }, reply);

    assert.equal(reply.statusCode, 200);
    assert.equal(receivedInput.actionId, "manual-docker");
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
    assert.equal(TOOLCHAIN_IMAGE, "ghcr.io/mobily-enterprises/vibe64-base-toolchain:0.1.1");
  } finally {
    if (previousStudioRoot == null) {
      delete process.env.VIBE64_APP_ROOT;
    } else {
      process.env.VIBE64_APP_ROOT = previousStudioRoot;
    }
  }
});

test("Studio Setup does not own tenant runtime container repairs", async () => {
  const service = createService();

  const response = await service.startTerminal({
    actionId: "start-runtime-container-mariadb",
    vibe64User: {
      email: "owner@example.com",
      role: "owner"
    }
  });

  assert.equal(response.ok, false);
  assert.equal(response.error, "Unknown terminal action.");
});
