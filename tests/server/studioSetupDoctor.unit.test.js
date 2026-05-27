import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REINSTALL_CODEX_CLI_TERMINAL_PREVIEW,
  TOOLCHAIN_IMAGE,
  isStudioSetupReady,
  reinstallCodexCliRepair,
  reinstallCodexCliScript,
  reinstallCodexCliTerminalScript,
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

test("Studio Setup resolves the Studio implementation root separately", () => {
  const previousStudioRoot = process.env.VIBE64_APP_ROOT;
  const envRoot = path.join(tmpdir(), "example-studio-root");
  const explicitRoot = path.join(tmpdir(), "explicit-studio-root");
  process.env.VIBE64_APP_ROOT = envRoot;

  try {
    assert.equal(resolveStudioRoot(), envRoot);
    assert.equal(resolveStudioRoot(explicitRoot), explicitRoot);
    assert.match(TOOLCHAIN_IMAGE, /^vibe64-base-toolchain:/u);
  } finally {
    if (previousStudioRoot == null) {
      delete process.env.VIBE64_APP_ROOT;
    } else {
      process.env.VIBE64_APP_ROOT = previousStudioRoot;
    }
  }
});

test("Studio Setup Codex repair reinstalls Codex in the managed tool home", () => {
  const repair = reinstallCodexCliRepair();
  const script = reinstallCodexCliScript();

  assert.equal(repair.actionId, "reinstall-codex-cli");
  assert.equal(repair.autoRun, false);
  assert.equal(repair.label, "Reinstall Codex CLI");
  assert.match(repair.commandPreview, /docker run/u);
  assert.match(repair.commandPreview, /HOME=\/home\/studio/u);
  assert.match(repair.commandPreview, /NPM_CONFIG_PREFIX=\/home\/studio\/\.local/u);
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
