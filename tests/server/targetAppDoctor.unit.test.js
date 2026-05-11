import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import {
  createService,
  ghRepoCreateRepair,
  ghRepoCreateScript,
  gitIdentityRepair,
  gitInitRepair,
  inspectTargetApp,
  isTargetAppReady,
  repoNameFromTargetRoot,
  validateGitIdentityInputs
} from "../../packages/target-app-doctor/src/server/service.js";
import {
  terminalInputValidator
} from "../../packages/target-app-doctor/src/server/inputSchemas.js";

test("Target App Doctor readiness requires every required check to pass", () => {
  assert.equal(isTargetAppReady([
    { required: true, status: "pass" },
    { required: true, status: "pass" }
  ]), true);
  assert.equal(isTargetAppReady([
    { required: true, status: "pass" },
    { required: true, status: "fail" }
  ]), false);
});

test("Target App Doctor repair commands stay explicit", () => {
  const targetRoot = path.join("/", "tmp", "Example Target App");
  const gitRepair = gitInitRepair(targetRoot);
  const identityRepair = gitIdentityRepair();
  const ghRepair = ghRepoCreateRepair(targetRoot);

  assert.equal(gitRepair.kind, "terminal");
  assert.equal(gitRepair.label, "Initialize Git");
  assert.match(gitRepair.commandPreview, /git .*init/u);
  assert.equal(identityRepair.kind, "terminal");
  assert.equal(identityRepair.label, "Set Git identity");
  assert.deepEqual(identityRepair.fields.map((field) => field.id), ["name", "email"]);
  assert.match(identityRepair.commandPreview, /git config --global user\.name/u);
  assert.equal(ghRepair.kind, "terminal");
  assert.equal(ghRepair.label, "Create GitHub repo");
  assert.match(ghRepair.commandPreview, /gh repo create/u);
  assert.match(ghRepair.commandPreview, /--private/u);
  assert.match(ghRepair.commandPreview, /git rev-parse --verify HEAD/u);
  assert.equal(repoNameFromTargetRoot(targetRoot), "Example-Target-App");
});

test("Target App Doctor GitHub repo repair only pushes when commits exist", () => {
  const script = ghRepoCreateScript("example-target-app");

  assert.match(script, /if git rev-parse --verify HEAD/u);
  assert.match(script, /--push/u);
  assert.match(script, /linked origin without pushing/u);
  assert.match(script, /gh repo create example-target-app --source=\. --remote=origin --private\n/u);
});

test("Target App Doctor terminal input preserves enter/control characters", () => {
  const result = terminalInputValidator.schema.create({
    data: "\r"
  });

  assert.deepEqual(result.errors, {});
  assert.equal(result.validatedObject.data, "\r");
});

test("Target App Doctor validates parameterized Git identity repair inputs", () => {
  assert.deepEqual(validateGitIdentityInputs({
    email: "dev@example.com",
    name: "Dev User"
  }), {
    email: "dev@example.com",
    name: "Dev User",
    ok: true
  });
  assert.equal(validateGitIdentityInputs({
    email: "dev@example.com",
    name: ""
  }).ok, false);
  assert.equal(validateGitIdentityInputs({
    email: "not-an-email",
    name: "Dev User"
  }).ok, false);
});

test("Target App Doctor rejects Git identity terminal repair without valid inputs", () => {
  const service = createService({
    studioRoot: process.cwd(),
    targetRoot: os.tmpdir()
  });
  const response = service.startTerminal({
    actionId: "terminal-git-identity",
    inputs: {
      email: "not-an-email",
      name: ""
    }
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /user\.name/u);
});

test("Target App Doctor blocks dependent checks when target directory is unavailable", async () => {
  const targetRoot = path.join(os.tmpdir(), `jskit-studio-missing-${Date.now()}`);
  const status = await inspectTargetApp({
    studioRoot: process.cwd(),
    targetRoot
  });

  assert.equal(status.ready, false);
  assert.equal(status.checks.find((check) => check.id === "target-directory")?.status, "fail");
  assert.equal(status.checks.find((check) => check.id === "git-repository")?.observed, "Target directory is not ready.");
  assert.equal(status.checks.find((check) => check.id === "github-auth")?.observed, "Target directory is not ready.");
});
