import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TOOLCHAIN_IMAGE,
  codexBrowserLoginCommandArgs,
  codexDeviceLoginCommandArgs,
  codexLoginRepairs,
  isStudioSetupReady,
  resolveStudioRoot
} from "../../packages/studio-setup-doctor/src/server/service.js";
import {
  terminalInputValidator
} from "../../packages/studio-setup-doctor/src/server/inputSchemas.js";

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

test("Studio Setup exposes Codex browser login with device-code fallback", () => {
  assert.deepEqual(codexBrowserLoginCommandArgs(), [
    "codex",
    "login"
  ]);
  assert.deepEqual(codexDeviceLoginCommandArgs(), [
    "codex",
    "login",
    "--device-auth"
  ]);
  const hostNetworkRepairs = codexLoginRepairs(true);
  assert.deepEqual(hostNetworkRepairs.map((repair) => repair.actionId), [
    "terminal-codex-login",
    "terminal-codex-device-login"
  ]);
  assert.match(hostNetworkRepairs[0].commandPreview, /--network host/u);
  assert.doesNotMatch(hostNetworkRepairs[0].commandPreview, /--device-auth/u);
  assert.deepEqual(codexLoginRepairs(false).map((repair) => repair.actionId), [
    "terminal-codex-device-login"
  ]);
});

test("Studio Setup resolves the Studio implementation root separately", () => {
  const previousStudioRoot = process.env.AI_STUDIO_APP_ROOT;
  const envRoot = path.join(tmpdir(), "example-studio-root");
  const explicitRoot = path.join(tmpdir(), "explicit-studio-root");
  process.env.AI_STUDIO_APP_ROOT = envRoot;

  try {
    assert.equal(resolveStudioRoot(), envRoot);
    assert.equal(resolveStudioRoot(explicitRoot), explicitRoot);
    assert.match(TOOLCHAIN_IMAGE, /^ai-studio-base-toolchain:/u);
  } finally {
    if (previousStudioRoot == null) {
      delete process.env.AI_STUDIO_APP_ROOT;
    } else {
      process.env.AI_STUDIO_APP_ROOT = previousStudioRoot;
    }
  }
});
