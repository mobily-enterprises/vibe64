import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  codexBrowserLoginCommandArgs,
  codexDeviceLoginCommandArgs,
  codexLoginRepairs,
  isBootstrapReady,
  mysqlCapabilitySql,
  mysqlRepair,
  resolveStudioRoot
} from "../../packages/bootstrap-doctor/src/server/service.js";
import {
  terminalInputValidator
} from "../../packages/bootstrap-doctor/src/server/inputSchemas.js";

test("Bootstrap Doctor probes MySQL without asking for an app database name", () => {
  const repair = mysqlRepair();

  assert.equal(repair.input, undefined);
  assert.equal(repair.label, "Start MySQL and verify DDL");
  assert.match(repair.commandPreview, /CREATE DATABASE IF NOT EXISTS `jskit_ai_studio_bootstrap_probe`/u);
  assert.match(mysqlCapabilitySql(), /CREATE TABLE IF NOT EXISTS `jskit_ai_studio_bootstrap_probe`\.`capability_probe`/u);
  assert.match(mysqlCapabilitySql(), /DROP DATABASE `jskit_ai_studio_bootstrap_probe`/u);
  assert.doesNotMatch(repair.commandPreview, /<database_name>|Database name/u);
});

test("Bootstrap Doctor readiness requires every required check to pass", () => {
  assert.equal(isBootstrapReady([
    { required: true, status: "pass" },
    { required: true, status: "pass" }
  ]), true);
  assert.equal(isBootstrapReady([
    { required: true, status: "pass" },
    { required: true, status: "fail" }
  ]), false);
});

test("Bootstrap Doctor terminal input preserves enter/control characters", () => {
  const result = terminalInputValidator.schema.create({
    data: "\r"
  });

  assert.deepEqual(result.errors, {});
  assert.equal(result.validatedObject.data, "\r");
});

test("Bootstrap Doctor exposes Codex browser login with device-code fallback", () => {
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

test("Bootstrap Doctor resolves the Studio implementation root separately", () => {
  const previousStudioRoot = process.env.JSKIT_STUDIO_APP_ROOT;
  const envRoot = path.join(tmpdir(), "example-studio-root");
  const explicitRoot = path.join(tmpdir(), "explicit-studio-root");
  process.env.JSKIT_STUDIO_APP_ROOT = envRoot;

  try {
    assert.equal(resolveStudioRoot(), envRoot);
    assert.equal(resolveStudioRoot(explicitRoot), explicitRoot);
  } finally {
    if (previousStudioRoot == null) {
      delete process.env.JSKIT_STUDIO_APP_ROOT;
    } else {
      process.env.JSKIT_STUDIO_APP_ROOT = previousStudioRoot;
    }
  }
});
