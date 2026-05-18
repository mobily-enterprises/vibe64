import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  createService
} from "../../packages/ai-studio-project/src/server/service.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

test("AI Studio project service saves project type and plain-file configuration", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      targetRoot
    });

    const missingType = await service.readProjectType();
    assert.equal(missingType.ok, true);
    assert.equal(missingType.projectType.ready, false);
    assert.equal(missingType.projectType.status, "missing");

    const savedType = await service.saveProjectType({
      projectType: "jskit"
    });
    assert.equal(savedType.ok, true);
    assert.equal(savedType.projectType.ready, true);
    assert.equal(savedType.projectType.adapter.id, "jskit");
    assert.equal(
      await readFile(path.join(targetRoot, ".ai-studio", "project_type"), "utf8"),
      "jskit\n"
    );

    const defaults = await service.readProjectConfigDefaults();
    assert.equal(defaults.ok, true);
    assert.equal(defaults.defaults.defaults.github_pr_merge_method, "merge");
    assert.equal(defaults.defaults.defaults.jskit_database_runtime, "none");

    const savedConfig = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "rebase",
        jskit_database_runtime: "postgres",
        jskit_tenancy_mode: "workspaces"
      }
    });
    assert.equal(savedConfig.ok, true);
    assert.equal(savedConfig.config.ready, true);
    assert.equal(savedConfig.config.values.github_pr_merge_method, "rebase");
    assert.equal(
      await readFile(path.join(targetRoot, ".ai-studio", "config", "jskit_database_runtime"), "utf8"),
      "postgres\n"
    );

    const environment = await service.projectConfigEnvironment();
    assert.equal(environment.AI_STUDIO_CONFIG_DIR, path.join(targetRoot, ".ai-studio", "config"));
    assert.equal(environment.AI_STUDIO_CONFIG_SH, path.join(targetRoot, ".ai-studio", "runtime", "ai-studio-config.sh"));

    const runtime = await service.createRuntime();
    assert.equal(runtime.adapter.id, "jskit");
    assert.equal(runtime.projectConfig.values.jskit_tenancy_mode, "workspaces");
  });
});

test("AI Studio project service reports unknown and unimplemented project types as structured errors", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      targetRoot
    });

    const unknown = await service.saveProjectType({
      projectType: "unknown"
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.errors[0].code, "ai_studio_unknown_project_type");

    const unimplemented = await service.saveProjectType({
      projectType: "python"
    });
    assert.equal(unimplemented.ok, false);
    assert.equal(unimplemented.errors[0].code, "ai_studio_project_type_unimplemented");
  });
});

test("AI Studio project service loads invalid saved config as editable not ready state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      targetRoot
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await mkdir(path.join(targetRoot, ".ai-studio", "config"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".ai-studio", "config", "github_pr_merge_method"), "merge\n", "utf8");
    await writeFile(path.join(targetRoot, ".ai-studio", "config", "jskit_database_runtime"), "mysql\n", "utf8");
    await writeFile(path.join(targetRoot, ".ai-studio", "config", "jskit_tenancy_mode"), "single\n", "utf8");

    const config = await service.readProjectConfig();
    assert.equal(config.ok, true);
    assert.equal(config.config.ready, false);
    assert.match(config.config.message, /no longer valid/u);
    assert.equal(config.config.values.jskit_tenancy_mode, "none");
    assert.deepEqual(config.config.invalid.map((field) => field.fieldId), [
      "jskit_tenancy_mode"
    ]);
    assert.match(
      config.config.fieldValues.jskit_tenancy_mode.invalid.message,
      /none, personal, workspaces/u
    );
  });
});
