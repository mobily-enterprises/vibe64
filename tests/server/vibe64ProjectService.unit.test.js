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
  createStudioProjectContext
} from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import {
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  JSKIT_ALLOW_SELF_TARGET_CONFIG
} from "@local/vibe64-adapters/server/adapters/jskit/index";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

test("Vibe64 project service exposes project selection before project-specific state", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const service = createService({
      projectContext: createStudioProjectContext({
        explicitProjectsRoot: projectsRoot,
        env: {},
        home: root
      })
    });

    const initialProjects = await service.listProjects();
    assert.equal(initialProjects.ok, true);
    assert.equal(initialProjects.hasSelection, false);
    assert.deepEqual(initialProjects.projects, []);

    const beforeSelection = await service.readProjectType();
    assert.equal(beforeSelection.ok, true);
    assert.equal(beforeSelection.projectType.ready, false);
    assert.equal(beforeSelection.projectType.status, "no_project_selected");
    assert.equal(beforeSelection.projectType.errorCode, "vibe64_project_not_selected");
    assert.equal(beforeSelection.projectType.targetRoot, "");
    assert.deepEqual(await service.projectConfigEnvironment(), {});

    const invalid = await service.createProject({
      name: "!!!"
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.errors[0].code, "vibe64_invalid_project_slug");

    const created = await service.createProject({
      name: "Example App"
    });
    assert.equal(created.ok, true);
    assert.equal(created.hasSelection, true);
    assert.equal(created.targetRoot, path.join(projectsRoot, "example-app"));
    assert.equal(service.targetRoot, path.join(projectsRoot, "example-app"));
    assert.equal(service.currentTargetRoot(), path.join(projectsRoot, "example-app"));

    const afterSelection = await service.readProjectType();
    assert.equal(afterSelection.ok, true);
    assert.equal(afterSelection.projectType.status, "missing");
    assert.equal(afterSelection.projectType.targetRoot, path.join(projectsRoot, "example-app"));
  });
});

test("Vibe64 project service treats project request slug as the selected project", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const targetRoot = path.join(projectsRoot, "alpha_1");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createManagedProjectRecord({
      githubRepository: {
        fullName: "example/alpha_1"
      },
      slug: "alpha_1"
    });
    await projectContext.createManagedProjectRecord({
      githubRepository: {
        fullName: "example/beta"
      },
      slug: "beta"
    });
    const service = createService({
      projectContext
    });

    const listed = await runWithProjectRequestContext({
      projectsRoot,
      slug: "alpha_1",
      targetRoot
    }, () => service.listProjects());

    assert.equal(listed.ok, true);
    assert.equal(listed.hasSelection, true);
    assert.equal(listed.currentProject.slug, "alpha_1");
    assert.equal(listed.currentProject.path, targetRoot);
    assert.equal(listed.currentProject.selected, true);
    assert.equal(listed.currentProject.githubRepository.fullName, "example/alpha_1");
    assert.equal(listed.targetRoot, targetRoot);
    assert.deepEqual(listed.projects.map((project) => [
      project.slug,
      project.githubRepository.fullName,
      project.selected
    ]), [
      ["alpha_1", "example/alpha_1", true],
      ["beta", "example/beta", false]
    ]);
    assert.equal(service.targetRoot, "");
    assert.equal(service.currentTargetRoot(), "");
  });
});

test("Vibe64 project service saves project type and plain-file configuration", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      targetRoot
    });
    const stateRoot = service.currentProjectStateRoot();

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
      await readFile(path.join(stateRoot, "project_type"), "utf8"),
      "jskit\n"
    );

    const defaults = await service.readProjectConfigDefaults();
    assert.equal(defaults.ok, true);
    assert.equal(defaults.defaults.defaults.github_pr_merge_method, "merge");
    assert.equal(defaults.defaults.defaults[JSKIT_ALLOW_SELF_TARGET_CONFIG], false);
    assert.equal(defaults.defaults.defaults.jskit_database_runtime, "none");
    const mergeMethodField = defaults.defaults.fields.find((field) => field.id === "github_pr_merge_method");
    const databaseRuntimeField = defaults.defaults.fields.find((field) => field.id === "jskit_database_runtime");
    assert.equal(defaults.defaults.fields.some((field) => field.id === "deploy_production_command"), false);
    assert.equal(defaults.defaults.fields.some((field) => field.id === "deploy_staging_command"), false);
    assert.equal(mergeMethodField.sectionLabel, "Pull requests");
    assert.equal(mergeMethodField.type, "select");
    assert.deepEqual(mergeMethodField.options.map((option) => option.value), ["merge", "squash", "rebase"]);
    assert.match(databaseRuntimeField.description, /Database service Studio should prepare/u);
    assert.match(databaseRuntimeField.options.find((option) => option.value === "mysql").description, /MariaDB/u);

    const savedConfig = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "squash",
        [JSKIT_ALLOW_SELF_TARGET_CONFIG]: true,
        jskit_database_runtime: "postgres"
      }
    });
    assert.equal(savedConfig.ok, true);
    assert.equal(savedConfig.config.ready, true);
    assert.equal(savedConfig.config.values.github_pr_merge_method, "squash");
    assert.equal(savedConfig.config.values[JSKIT_ALLOW_SELF_TARGET_CONFIG], true);
    assert.equal(
      await readFile(path.join(stateRoot, "config", "github_pr_merge_method"), "utf8"),
      "squash\n"
    );
    assert.equal(
      await readFile(path.join(stateRoot, "config", "jskit_database_runtime"), "utf8"),
      "postgres\n"
    );

    const environment = await service.projectConfigEnvironment();
    assert.equal(environment.VIBE64_CONFIG_DIR, path.join(stateRoot, "config"));
    assert.equal(environment.VIBE64_CONFIG_SH, path.join(stateRoot, "runtime", "vibe64-config.sh"));

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
    const stateRoot = service.currentProjectStateRoot();

    await service.saveProjectType({
      projectType: "jskit"
    });
    await mkdir(path.join(stateRoot, "config"), {
      recursive: true
    });
    await writeFile(path.join(stateRoot, "config", "github_pr_merge_method"), "merge\n", "utf8");
    await writeFile(path.join(stateRoot, "config", JSKIT_ALLOW_SELF_TARGET_CONFIG), "false\n", "utf8");
    await writeFile(path.join(stateRoot, "config", "jskit_database_runtime"), "mysql\n", "utf8");

    const config = await service.readProjectConfig();
    assert.equal(config.ok, true);
    assert.equal(config.config.ready, true);
    assert.equal(config.config.values.jskit_database_runtime, "mysql");
    assert.deepEqual(config.config.invalid, []);
  });
});
