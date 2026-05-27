import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  createService
} from "../../packages/vibe64-project/src/server/service.js";
import {
  createCoreWorkflowRegistry
} from "@local/vibe64-runtime/server";
import {
  JSKIT_ALLOW_SELF_TARGET_CONFIG
} from "@local/vibe64-adapters/server/adapters/jskit/index";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

test("Vibe64 project service saves project type and plain-file configuration", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      targetRoot
    });

    const missingType = await service.readProjectType();
    assert.equal(missingType.ok, true);
    assert.equal(missingType.projectType.ready, false);
    assert.equal(missingType.projectType.status, "missing");
    assert.equal(missingType.projectType.targetRoot, targetRoot);
    const projectTypes = missingType.projectType.availableProjectTypes;
    const jskitProjectType = projectTypes.find((type) => type.id === "jskit");
    const nextjsProjectType = projectTypes.find((type) => type.id === "nextjs");
    const vinextProjectType = projectTypes.find((type) => type.id === "vinext");
    assert.equal(jskitProjectType.label, "JSKIT AI");
    assert.match(jskitProjectType.description, /full-stack application framework/u);
    assert.equal(jskitProjectType.projectUrl, "https://www.npmjs.com/package/@jskit-ai/jskit-cli");
    assert.equal(nextjsProjectType.projectUrl, "https://nextjs.org");
    assert.equal(vinextProjectType.projectUrl, "https://github.com/cloudflare/vinext");
    assert.deepEqual(jskitProjectType.applicationTypes.map((applicationType) => applicationType.id), [
      "web_application",
      "phone_app"
    ]);

    const applicationTypes = missingType.projectType.availableApplicationTypes;
    const webApplicationType = applicationTypes.find((applicationType) => applicationType.id === "web_application");
    const phoneApplicationType = applicationTypes.find((applicationType) => applicationType.id === "phone_app");
    const systemProgramType = applicationTypes.find((applicationType) => applicationType.id === "system_program");
    assert.equal(webApplicationType.label, "Web application");
    assert.deepEqual(webApplicationType.adapters.slice(0, 3).map((adapter) => adapter.id), [
      "jskit",
      "nextjs",
      "laravel"
    ]);
    assert.match(webApplicationType.adapters[0].explanation, /Vue and Node\.js/u);
    assert.deepEqual(phoneApplicationType.adapters.map((adapter) => adapter.id), [
      "jskit",
      "nextjs"
    ]);
    assert.deepEqual(systemProgramType.adapters.map((adapter) => adapter.id), [
      "cpp"
    ]);

    const savedType = await service.saveProjectType({
      projectType: "jskit"
    });
    assert.equal(savedType.ok, true);
    assert.equal(savedType.projectType.ready, true);
    assert.equal(savedType.projectType.adapter.id, "jskit");
    assert.equal(savedType.projectType.targetRoot, targetRoot);
    assert.equal(
      await readFile(path.join(targetRoot, ".vibe64", "project_type"), "utf8"),
      "jskit\n"
    );

    const defaults = await service.readProjectConfigDefaults();
    assert.equal(defaults.ok, true);
    assert.equal(defaults.defaults.defaults.github_pr_merge_method, "merge");
    assert.equal(defaults.defaults.defaults[JSKIT_ALLOW_SELF_TARGET_CONFIG], false);
    assert.equal(defaults.defaults.defaults.jskit_database_runtime, "none");
    const mergeMethodField = defaults.defaults.fields.find((field) => field.id === "github_pr_merge_method");
    const databaseRuntimeField = defaults.defaults.fields.find((field) => field.id === "jskit_database_runtime");
    assert.match(mergeMethodField.description, /merge completed pull requests/u);
    assert.match(mergeMethodField.options.find((option) => option.value === "squash").description, /one clean commit/u);
    assert.match(databaseRuntimeField.description, /Database service Studio should prepare/u);
    assert.match(databaseRuntimeField.options.find((option) => option.value === "mysql").description, /MariaDB/u);

    const savedConfig = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "rebase",
        [JSKIT_ALLOW_SELF_TARGET_CONFIG]: true,
        jskit_database_runtime: "postgres"
      }
    });
    assert.equal(savedConfig.ok, true);
    assert.equal(savedConfig.config.ready, true);
    assert.equal(savedConfig.config.values.github_pr_merge_method, "rebase");
    assert.equal(savedConfig.config.values[JSKIT_ALLOW_SELF_TARGET_CONFIG], true);
    assert.equal(
      await readFile(path.join(targetRoot, ".vibe64", "config", "jskit_database_runtime"), "utf8"),
      "postgres\n"
    );

    const environment = await service.projectConfigEnvironment();
    assert.equal(environment.VIBE64_CONFIG_DIR, path.join(targetRoot, ".vibe64", "config"));
    assert.equal(environment.VIBE64_CONFIG_SH, path.join(targetRoot, ".vibe64", "runtime", "vibe64-config.sh"));

    const runtime = await service.createRuntime();
    assert.equal(runtime.adapter.id, "jskit");
    assert.equal(runtime.projectConfig.values[JSKIT_ALLOW_SELF_TARGET_CONFIG], true);
    assert.equal(runtime.projectConfig.values.jskit_database_runtime, "postgres");
  });
});

test("Vibe64 project service injects the app workflow registry into runtimes", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const workflowRegistry = createCoreWorkflowRegistry();
    const service = createService({
      targetRoot,
      workflowRegistry
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "merge",
        [JSKIT_ALLOW_SELF_TARGET_CONFIG]: false,
        jskit_database_runtime: "none"
      }
    });

    const runtime = await service.createRuntime();
    assert.equal(runtime.workflowRegistry, workflowRegistry);
  });
});

test("Vibe64 project service reports unknown and unimplemented project types as structured errors", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      targetRoot
    });

    const unknown = await service.saveProjectType({
      projectType: "unknown"
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.errors[0].code, "vibe64_unknown_project_type");

    const unimplemented = await service.saveProjectType({
      projectType: "python"
    });
    assert.equal(unimplemented.ok, false);
    assert.equal(unimplemented.errors[0].code, "vibe64_project_type_unimplemented");
  });
});

test("Vibe64 project service loads invalid saved config as editable not ready state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      targetRoot
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await mkdir(path.join(targetRoot, ".vibe64", "config"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".vibe64", "config", "github_pr_merge_method"), "merge\n", "utf8");
    await writeFile(path.join(targetRoot, ".vibe64", "config", JSKIT_ALLOW_SELF_TARGET_CONFIG), "false\n", "utf8");
    await writeFile(path.join(targetRoot, ".vibe64", "config", "jskit_database_runtime"), "mysql\n", "utf8");

    const config = await service.readProjectConfig();
    assert.equal(config.ok, true);
    assert.equal(config.config.ready, true);
    assert.equal(config.config.values.jskit_database_runtime, "mysql");
    assert.deepEqual(config.config.invalid, []);
  });
});
