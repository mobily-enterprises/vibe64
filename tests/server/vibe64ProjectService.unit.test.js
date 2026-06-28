import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

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
  writeProjectRuntimeOpenState
} from "../../packages/vibe64-core/src/server/projectRuntimeOpenState.js";
import {
  RUNTIME_CONFIG_PHASES
} from "@local/vibe64-core/server/runtimeConfig";
import {
  VIBE64_APP_AUTH_MODE_CONFIG,
  VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
  VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE,
  VIBE64_APP_AUTH_MODE_NONE,
  VIBE64_MANUAL_SUPABASE_PUBLISHABLE_KEY_CONFIG,
  VIBE64_MANUAL_SUPABASE_PROJECT_URL_CONFIG
} from "@local/vibe64-core/shared";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

async function writePackageJson(root, packageJson = {}) {
  await writeFile(path.join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

async function createGitProject(root, remotes = {}) {
  await mkdir(root, {
    recursive: true
  });
  await execFileAsync("git", ["init"], {
    cwd: root
  });
  for (const [name, remoteUrl] of Object.entries(remotes)) {
    await execFileAsync("git", ["remote", "add", name, remoteUrl], {
      cwd: root
    });
  }
}

async function commitAll(root, message = "Commit test project state") {
  await execFileAsync("git", ["add", "-A"], {
    cwd: root
  });
  await execFileAsync("git", [
    "-c",
    "user.name=Vibe64 Test",
    "-c",
    "user.email=vibe64@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    message
  ], {
    cwd: root
  });
}

async function gitCurrentBranch(root) {
  const result = await execFileAsync("git", ["branch", "--show-current"], {
    cwd: root
  });
  return String(result.stdout || "").trim() || "master";
}

async function writeVibe64SourceConfig(root, {
  appAuthMode = VIBE64_APP_AUTH_MODE_NONE,
  databaseRuntime = "mysql",
  mergeMethod = "merge",
  projectType = "jskit"
} = {}) {
  const configRoot = path.join(root, ".vibe64", "config");
  await mkdir(configRoot, {
    recursive: true
  });
  await writeFile(path.join(root, ".vibe64", "project_type"), `${projectType}\n`, "utf8");
  await writeFile(path.join(configRoot, VIBE64_APP_AUTH_MODE_CONFIG), `${appAuthMode}\n`, "utf8");
  await writeFile(path.join(configRoot, "github_pr_merge_method"), `${mergeMethod}\n`, "utf8");
  await writeFile(path.join(configRoot, "jskit_database_runtime"), `${databaseRuntime}\n`, "utf8");
}

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
	    assert.equal(created.currentProject.projectRuntimeRoot, path.join(projectsRoot, "example-app"));
	    assert.equal(created.currentProject.projectLocalRoot, path.join(projectsRoot, "example-app"));
	    assert.equal(created.currentProject.onlineProjectRecordPath, path.join(projectsRoot, "example-app", "project.json"));

    const afterSelection = await service.readProjectType();
    assert.equal(afterSelection.ok, true);
    assert.equal(afterSelection.projectType.ready, false);
    assert.equal(afterSelection.projectType.status, "missing");
    assert.equal(afterSelection.projectType.bootstrap, false);
    assert.equal(afterSelection.projectType.path, path.join(projectsRoot, "example-app", "project.json"));
  });
});

test("Vibe64 project service exposes self-target project auto-select repro metadata only when opted in", async () => {
  const previousSelfTarget = process.env.VIBE64_SELF_TARGET_SYSTEM_ROOT;
  const previousAutoSelect = process.env.VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT;
  try {
    process.env.VIBE64_SELF_TARGET_SYSTEM_ROOT = "1";
    process.env.VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT = "beepollen";

    await withTemporaryRoot(async (root) => {
      const projectsRoot = path.join(root, "projects");
      const projectContext = createStudioProjectContext({
        explicitProjectsRoot: projectsRoot,
        env: {},
        home: root
      });
      await projectContext.createWorkspaceProjectRecord({
        githubRepository: {
          fullName: "example/beepollen"
        },
        slug: "beepollen"
      });
      const service = createService({
        projectContext
      });

      const listed = await service.listProjects();

      assert.equal(listed.ok, true);
      assert.equal(listed.hasSelection, false);
      assert.equal(listed.repro.selfTargetAutoSelectProject.selfTarget, true);
      assert.equal(listed.repro.selfTargetAutoSelectProject.enabled, true);
      assert.equal(listed.repro.selfTargetAutoSelectProject.projectSlug, "beepollen");
    });

    process.env.VIBE64_SELF_TARGET_SYSTEM_ROOT = "";
    await withTemporaryRoot(async (root) => {
      const service = createService({
        projectContext: createStudioProjectContext({
          explicitProjectsRoot: path.join(root, "projects"),
          env: {},
          home: root
        })
      });

      const listed = await service.listProjects();

      assert.equal(listed.ok, true);
      assert.equal(listed.repro.selfTargetAutoSelectProject.selfTarget, false);
      assert.equal(listed.repro.selfTargetAutoSelectProject.enabled, false);
      assert.equal(listed.repro.selfTargetAutoSelectProject.projectSlug, "");
    });
  } finally {
    if (previousSelfTarget === undefined) {
      delete process.env.VIBE64_SELF_TARGET_SYSTEM_ROOT;
    } else {
      process.env.VIBE64_SELF_TARGET_SYSTEM_ROOT = previousSelfTarget;
    }
    if (previousAutoSelect === undefined) {
      delete process.env.VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT;
    } else {
      process.env.VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT = previousAutoSelect;
    }
  }
});

test("Vibe64 project service treats local editor target as the selected project", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "External App");
    await createGitProject(targetRoot, {
      origin: "https://github.com/example/external-app.git"
    });
    const service = createService({
      projectContext: createStudioProjectContext({
        explicitTargetRoot: targetRoot,
        env: {},
        home: root,
        runtimeProfile: {
          projectCatalogEnabled: false,
          mode: "local",
          singleTargetRoot: targetRoot
        }
      })
    });

    const listed = await service.listProjects();
    assert.equal(listed.ok, true);
    assert.equal(listed.hasSelection, true);
    assert.equal(listed.currentProject.external, true);
    assert.equal(listed.currentProject.name, "External App");
    assert.equal(listed.currentProject.slug, "external-app");
    assert.equal(listed.currentProject.githubRepository.fullName, "example/external-app");
    assert.equal(listed.targetRoot, targetRoot);

    const routedListed = await runWithProjectRequestContext({
      slug: "external-app",
      targetRoot
    }, () => service.listProjects());

    assert.equal(routedListed.ok, true);
    assert.equal(routedListed.hasSelection, true);
    assert.equal(routedListed.currentProject.external, true);
    assert.equal(routedListed.currentProject.githubRepository.fullName, "example/external-app");
    assert.deepEqual(routedListed.projects.map((project) => [
      project.slug,
      project.githubRepository.fullName,
      project.selected
    ]), [
      ["external-app", "example/external-app", true]
    ]);

    const created = await service.createProject({
      name: "another"
    });
    assert.equal(created.ok, false);
    assert.equal(created.errors[0].code, "vibe64_project_catalog_unavailable");

    const selected = await service.selectProject({
      slug: "another"
    });
    assert.equal(selected.ok, false);
    assert.equal(selected.errors[0].code, "vibe64_project_catalog_unavailable");
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
    await projectContext.createWorkspaceProjectRecord({
      githubRepository: {
        fullName: "example/alpha_1"
      },
      slug: "alpha_1"
    });
    await projectContext.createWorkspaceProjectRecord({
      githubRepository: {
        fullName: "example/beta"
      },
      slug: "beta"
    });
    await writeProjectRuntimeOpenState({
      projectLocalRoot: projectContext.projectLocalRootForTarget(targetRoot),
      projectSlug: "alpha_1",
      reason: "unit-open",
      targetRoot
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
    assert.equal(listed.currentProject.runtime.open, true);
    assert.equal(listed.targetRoot, targetRoot);
    assert.deepEqual(listed.projects.map((project) => [
      project.slug,
      project.githubRepository.fullName,
      project.runtime.open,
      project.selected
    ]), [
      ["alpha_1", "example/alpha_1", true, true],
      ["beta", "example/beta", false, false]
    ]);
    assert.equal(service.targetRoot, "");
    assert.equal(service.currentTargetRoot(), "");
  });
});

test("Vibe64 project service writes catalog config to the active session source", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "catalog-app");
    const sessionSourceRoot = path.join(projectRoot, "sessions", "active", "setup-session", "source");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      githubRepository: {
        fullName: "example/catalog-app"
      },
      slug: "catalog-app"
    });
    await mkdir(sessionSourceRoot, {
      recursive: true
    });
    const service = createService({
      projectContext
    });

    const savedType = await runWithProjectRequestContext({
      projectLocalRoot: projectRoot,
      projectRuntimeRoot: projectRoot,
      projectsRoot,
      slug: "catalog-app",
      targetRoot: projectRoot
    }, () => service.saveProjectType({
      projectType: "jskit",
      sessionId: "setup-session"
    }));

    assert.equal(savedType.ok, true);
    assert.equal(savedType.projectType.sourceRoot, sessionSourceRoot);
    assert.equal(
      await readFile(path.join(sessionSourceRoot, ".vibe64", "project_type"), "utf8"),
      "jskit\n"
    );
    await assert.rejects(
      () => readFile(path.join(projectRoot, ".vibe64", "project_type"), "utf8"),
      {
        code: "ENOENT"
      }
    );

    const savedConfig = await runWithProjectRequestContext({
      projectLocalRoot: projectRoot,
      projectRuntimeRoot: projectRoot,
      projectsRoot,
      slug: "catalog-app",
      targetRoot: projectRoot
    }, () => service.saveProjectConfig({
      sessionId: "setup-session",
      values: {
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mysql"
      }
    }));

    assert.equal(savedConfig.ok, true);
    assert.equal(
      await readFile(path.join(sessionSourceRoot, ".vibe64", "config", "jskit_database_runtime"), "utf8"),
      "mysql\n"
    );
	    await assert.rejects(
	      () => readFile(path.join(projectRoot, ".vibe64", "config", "jskit_database_runtime"), "utf8"),
	      {
	        code: "ENOENT"
	      }
	    );

	    const outsideSession = await runWithProjectRequestContext({
	      projectLocalRoot: projectRoot,
	      projectRuntimeRoot: projectRoot,
	      projectsRoot,
	      slug: "catalog-app",
	      targetRoot: projectRoot
	    }, () => service.saveProjectConfig({
	      sourcePath: path.join(projectRoot, "outside-source"),
	      values: {
	        github_pr_merge_method: "merge",
	        jskit_database_runtime: "mysql"
	      }
	    }));
	    assert.equal(outsideSession.ok, false);
	    assert.equal(outsideSession.errors[0].code, "vibe64_project_config_source_outside_session");

	    const missingSource = await runWithProjectRequestContext({
	      projectLocalRoot: projectRoot,
	      projectRuntimeRoot: projectRoot,
	      projectsRoot,
	      slug: "catalog-app",
	      targetRoot: projectRoot
	    }, () => service.saveProjectConfig({
	      sourcePath: path.join(projectRoot, "sessions", "active", "missing-session", "source"),
	      values: {
	        github_pr_merge_method: "merge",
	        jskit_database_runtime: "mysql"
	      }
	    }));
	    assert.equal(missingSource.ok, false);
	    assert.equal(missingSource.errors[0].code, "vibe64_project_config_source_missing");
  });
});

test("Vibe64 project service resolves config environments for a selected catalog session source", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "catalog-app");
    const sessionSourceRoot = path.join(projectRoot, "sessions", "active", "setup-session", "source");
    const otherSessionSourceRoot = path.join(projectRoot, "sessions", "active", "other-session", "source");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      githubRepository: {
        fullName: "example/catalog-app"
      },
      slug: "catalog-app"
    });
    await mkdir(sessionSourceRoot, {
      recursive: true
    });
    await mkdir(otherSessionSourceRoot, {
      recursive: true
    });
    const service = createService({
      projectContext
    });
    const requestContext = {
      projectLocalRoot: projectRoot,
      projectRuntimeRoot: projectRoot,
      projectsRoot,
      slug: "catalog-app",
      targetRoot: projectRoot
    };

    await runWithProjectRequestContext(requestContext, () => service.saveProjectType({
      projectType: "jskit",
      sessionId: "setup-session"
    }));
    await runWithProjectRequestContext(requestContext, () => service.saveProjectConfig({
      sessionId: "setup-session",
      values: {
        [VIBE64_APP_AUTH_MODE_CONFIG]: VIBE64_APP_AUTH_MODE_NONE,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mysql"
      }
    }));

    await assert.rejects(
      () => runWithProjectRequestContext(requestContext, () => service.projectConfigEnvironment()),
      {
        code: "vibe64_project_config_session_required"
      }
    );

    const projectConfigEnv = await runWithProjectRequestContext(
      requestContext,
      () => service.projectConfigEnvironment({
        sessionId: "setup-session"
      })
    );
    assert.equal(projectConfigEnv.VIBE64_CONFIG_DIR, path.join(sessionSourceRoot, ".vibe64", "config"));
    assert.equal(projectConfigEnv.VIBE64_CONFIG_LOCAL_DIR, path.join(projectRoot, "runtime-config"));

    const runtimeConfigEnv = await runWithProjectRequestContext(
      requestContext,
      () => service.projectRuntimeConfigEnvironment({
        materialize: false,
        phase: RUNTIME_CONFIG_PHASES.SERVER,
        sourcePath: sessionSourceRoot
      })
    );
    assert.equal(runtimeConfigEnv.APP_PUBLIC_URL, "http://localhost:3000");
    assert.equal(runtimeConfigEnv.DB_CLIENT, "mysql2");
  });
});

test("Vibe64 project dashboard runtime config reads committed git-cache and ignores active session config", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const sourceRepo = path.join(root, "source-repo");
    await createGitProject(sourceRepo);
    await writeVibe64SourceConfig(sourceRepo, {
      databaseRuntime: "mysql"
    });
    await commitAll(sourceRepo, "Commit source-owned Vibe64 config");
    const defaultBranch = await gitCurrentBranch(sourceRepo);

    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      githubRepository: {
        defaultBranch,
        fullName: "example/catalog-app"
      },
      slug: "catalog-app"
    });
    const projectRoot = path.join(projectsRoot, "catalog-app");
    const gitCacheRepository = path.join(projectRoot, "git-cache", "repository.git");
    await mkdir(path.dirname(gitCacheRepository), {
      recursive: true
    });
    await execFileAsync("git", ["clone", "--bare", sourceRepo, gitCacheRepository]);

    const sessionSourceA = path.join(projectRoot, "sessions", "active", "session-a", "source");
    const sessionSourceB = path.join(projectRoot, "sessions", "active", "session-b", "source");
    await writeVibe64SourceConfig(sessionSourceA, {
      databaseRuntime: "postgres"
    });
    await writeVibe64SourceConfig(sessionSourceB, {
      databaseRuntime: "none"
    });

    const service = createService({
      projectContext
    });
    const requestContext = {
      projectLocalRoot: projectRoot,
      projectRuntimeRoot: projectRoot,
      projectsRoot,
      slug: "catalog-app",
      targetRoot: projectRoot
    };

    const dashboardRuntimeConfig = await runWithProjectRequestContext(
      requestContext,
      () => service.readRuntimeConfig({
        scope: "dev"
      })
    );
    assert.equal(dashboardRuntimeConfig.ok, true);
    assert.equal(dashboardRuntimeConfig.runtimeConfig.unavailable, null);
    assert.equal(dashboardRuntimeConfig.runtimeConfig.view.records.find((record) => record.key === "DB_CLIENT")?.value, "mysql2");

    const sessionConfig = await runWithProjectRequestContext(
      requestContext,
      () => service.readProjectConfig({
        sessionId: "session-a"
      })
    );
    assert.equal(sessionConfig.ok, true);
    assert.equal(sessionConfig.config.values.jskit_database_runtime, "postgres");
  });
});

test("Vibe64 project dashboard runtime config reports missing committed config without choosing a session", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "catalog-app");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      githubRepository: {
        defaultBranch: "main",
        fullName: "example/catalog-app"
      },
      slug: "catalog-app"
    });
    await writeVibe64SourceConfig(path.join(projectRoot, "sessions", "active", "session-a", "source"), {
      databaseRuntime: "mysql"
    });
    await writeVibe64SourceConfig(path.join(projectRoot, "sessions", "active", "session-b", "source"), {
      databaseRuntime: "postgres"
    });
    const service = createService({
      projectContext
    });
    const requestContext = {
      projectLocalRoot: projectRoot,
      projectRuntimeRoot: projectRoot,
      projectsRoot,
      slug: "catalog-app",
      targetRoot: projectRoot
    };

    const dashboardRuntimeConfig = await runWithProjectRequestContext(
      requestContext,
      () => service.readRuntimeConfig({
        scope: "dev"
      })
    );

    assert.equal(dashboardRuntimeConfig.ok, true);
    assert.equal(dashboardRuntimeConfig.runtimeConfig.ok, false);
    assert.equal(
      dashboardRuntimeConfig.runtimeConfig.unavailable.code,
      "vibe64_committed_project_git_cache_missing"
    );
    assert.doesNotMatch(
      dashboardRuntimeConfig.runtimeConfig.unavailable.code,
      /session_required/u
    );
  });
});

test("Vibe64 project service can create a source-optional runtime before selecting an active source", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "catalog-app");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      githubRepository: {
        fullName: "example/catalog-app"
      },
      slug: "catalog-app"
    });
    await mkdir(path.join(projectRoot, "sessions", "active", "session-a", "source"), {
      recursive: true
    });
    await mkdir(path.join(projectRoot, "sessions", "active", "session-b", "source"), {
      recursive: true
    });
    const service = createService({
      projectContext
    });
    const requestContext = {
      projectLocalRoot: projectRoot,
      projectRuntimeRoot: projectRoot,
      projectsRoot,
      slug: "catalog-app",
      targetRoot: projectRoot
    };

    await assert.rejects(
      () => runWithProjectRequestContext(requestContext, () => service.createRuntime()),
      {
        code: "vibe64_project_config_session_required"
      }
    );

    const runtime = await runWithProjectRequestContext(
      requestContext,
      () => service.createRuntime({
        sourceSetupRequired: false
      })
    );

    assert.equal(runtime.stateRoot, projectRoot);
    assert.equal(runtime.targetRoot, projectRoot);
    assert.equal(runtime.projectSharedRoot, "");
    assert.equal(runtime.onlineProjectRecordPath, path.join(projectRoot, "project.json"));
  });
});

test("Vibe64 project service stores zero-source online setup as temporary bootstrap metadata", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "catalog-app");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      githubRepository: {
        fullName: "example/catalog-app"
      },
      slug: "catalog-app"
    });
    const service = createService({
      projectContext
    });
    const requestContext = {
      projectLocalRoot: projectRoot,
      projectRuntimeRoot: projectRoot,
      projectsRoot,
      slug: "catalog-app",
      targetRoot: projectRoot
    };

    const missingType = await runWithProjectRequestContext(requestContext, () => service.readProjectType());
    assert.equal(missingType.ok, true);
    assert.equal(missingType.projectType.ready, false);
    assert.equal(missingType.projectType.status, "missing");

    const draftConfig = await runWithProjectRequestContext(requestContext, () => service.readProjectConfig({
      projectType: "jskit"
    }));
    assert.equal(draftConfig.ok, true);
    assert.equal(draftConfig.config.ready, false);
    assert.equal(draftConfig.config.bootstrap, false);

    const saved = await runWithProjectRequestContext(requestContext, () => service.saveProjectConfig({
      projectType: "jskit",
      values: {
        github_pr_merge_method: "squash",
        jskit_database_runtime: "postgres"
      }
    }));

    assert.equal(saved.ok, true);
    assert.equal(saved.config.bootstrap, true);
    assert.equal(saved.config.ready, true);
    assert.equal(saved.config.values.github_pr_merge_method, "squash");
    assert.equal(saved.config.values.jskit_database_runtime, "postgres");
    await assert.rejects(
      () => readFile(path.join(projectRoot, ".vibe64", "project_type"), "utf8"),
      {
        code: "ENOENT"
      }
    );
    const projectRecord = JSON.parse(await readFile(path.join(projectRoot, "project.json"), "utf8"));
    assert.equal(projectRecord.bootstrapConfig.status, "pending");
    assert.equal(projectRecord.bootstrapConfig.projectType, "jskit");
    assert.equal(projectRecord.bootstrapConfig.values.github_pr_merge_method, "squash");
    assert.equal(projectRecord.bootstrapConfig.values.jskit_database_runtime, "postgres");

    const savedType = await runWithProjectRequestContext(requestContext, () => service.readProjectType());
    assert.equal(savedType.projectType.ready, true);
    assert.equal(savedType.projectType.bootstrap, true);

    const seedSessionType = await runWithProjectRequestContext(requestContext, () => service.readProjectType({
      sessionId: "seed-session"
    }));
    assert.equal(seedSessionType.ok, true);
    assert.equal(seedSessionType.projectType.ready, true);
    assert.equal(seedSessionType.projectType.bootstrap, true);

    const seedSessionConfig = await runWithProjectRequestContext(requestContext, () => service.readProjectConfig({
      sessionId: "seed-session"
    }));
    assert.equal(seedSessionConfig.ok, true);
    assert.equal(seedSessionConfig.config.bootstrap, true);
    assert.equal(seedSessionConfig.config.values.jskit_database_runtime, "postgres");

    const updatedSeedSessionConfig = await runWithProjectRequestContext(requestContext, () => service.saveProjectConfig({
      sessionId: "seed-session",
      values: {
        github_pr_merge_method: "rebase",
        jskit_database_runtime: "mysql"
      }
    }));
    assert.equal(updatedSeedSessionConfig.ok, true);
    assert.equal(updatedSeedSessionConfig.config.bootstrap, true);
    assert.equal(updatedSeedSessionConfig.config.values.github_pr_merge_method, "rebase");
    assert.equal(updatedSeedSessionConfig.config.values.jskit_database_runtime, "mysql");
    const updatedProjectRecord = JSON.parse(await readFile(path.join(projectRoot, "project.json"), "utf8"));
    assert.equal(updatedProjectRecord.bootstrapConfig.status, "pending");
    assert.equal(updatedProjectRecord.bootstrapConfig.values.github_pr_merge_method, "rebase");
    assert.equal(updatedProjectRecord.bootstrapConfig.values.jskit_database_runtime, "mysql");

    const runtime = await runWithProjectRequestContext(requestContext, () => service.createRuntime());
    assert.equal(runtime.adapter.id, "jskit");
    assert.equal(runtime.projectConfig.bootstrap, true);
    assert.equal(runtime.projectConfig.values.jskit_database_runtime, "mysql");
  });
});

test("Vibe64 project service saves project type and plain-file configuration", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      targetRoot
    });
    const stateRoot = service.currentProjectStateRoot();
    const localRoot = service.currentProjectLocalRoot();

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
    assert.equal(defaults.defaults.defaults[VIBE64_APP_AUTH_MODE_CONFIG], VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE);
    assert.equal(defaults.defaults.defaults.jskit_database_runtime, "mysql");
    const mergeMethodField = defaults.defaults.fields.find((field) => field.id === "github_pr_merge_method");
    const appAuthModeField = defaults.defaults.fields.find((field) => field.id === VIBE64_APP_AUTH_MODE_CONFIG);
    const databaseRuntimeField = defaults.defaults.fields.find((field) => field.id === "jskit_database_runtime");
    const manualSupabaseUrlField = defaults.defaults.fields.find((field) => field.id === VIBE64_MANUAL_SUPABASE_PROJECT_URL_CONFIG);
    assert.equal(defaults.defaults.fields.some((field) => field.id === "deploy_production_command"), false);
    assert.equal(defaults.defaults.fields.some((field) => field.id === "deploy_staging_command"), false);
    assert.equal(defaults.defaults.fields.some((field) => field.id === "vibe64_app_auth_environment"), false);
    assert.equal(defaults.defaults.fields.some((field) => field.id.startsWith("vibe64_email_")), false);
    assert.equal(mergeMethodField.sectionLabel, "Pull requests");
    assert.equal(mergeMethodField.type, "select");
    assert.deepEqual(mergeMethodField.options.map((option) => option.value), ["merge", "squash", "rebase"]);
    assert.deepEqual(appAuthModeField.options.map((option) => option.value), [
      VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
      VIBE64_APP_AUTH_MODE_NONE,
      VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE
    ]);
    assert.match(databaseRuntimeField.description, /Database service Studio should prepare/u);
    assert.match(databaseRuntimeField.options.find((option) => option.value === "mysql").description, /MariaDB/u);
    assert.deepEqual(manualSupabaseUrlField.visibleWhen, {
      equals: "manual_supabase",
      field: VIBE64_APP_AUTH_MODE_CONFIG
    });

    const savedConfig = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "squash",
        jskit_database_runtime: "postgres"
      }
    });
    assert.equal(savedConfig.ok, true);
    assert.equal(savedConfig.config.ready, true);
    assert.equal(savedConfig.config.values[VIBE64_APP_AUTH_MODE_CONFIG], VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE);
    assert.equal(savedConfig.config.values.github_pr_merge_method, "squash");
    assert.equal(
      await readFile(path.join(stateRoot, "config", "github_pr_merge_method"), "utf8"),
      "squash\n"
    );
    assert.equal(
      await readFile(path.join(stateRoot, "config", "jskit_database_runtime"), "utf8"),
      "postgres\n"
    );
    assert.equal(
      await readFile(path.join(stateRoot, "config", VIBE64_APP_AUTH_MODE_CONFIG), "utf8"),
      "managed_supabase\n"
    );

    const environment = await service.projectConfigEnvironment();
    assert.equal(environment.VIBE64_CONFIG_DIR, path.join(stateRoot, "config"));
    assert.equal(environment.VIBE64_CONFIG_LOCAL_DIR, path.join(localRoot, "runtime-config"));
    assert.equal(environment.VIBE64_CONFIG_SH, path.join(localRoot, "runtime", "vibe64-config.sh"));

    const runtime = await service.createRuntime();
    assert.equal(runtime.adapter.id, "jskit");
    assert.equal(runtime.projectConfig.values.jskit_database_runtime, "postgres");
  });
});

test("Vibe64 project config requires conditional login fields only when visible", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      targetRoot
    });
    const localRoot = service.currentProjectLocalRoot();
    await service.saveProjectType({
      projectType: "jskit"
    });

    const noLoginConfig = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mysql",
        [VIBE64_APP_AUTH_MODE_CONFIG]: VIBE64_APP_AUTH_MODE_NONE
      }
    });
    assert.equal(noLoginConfig.ok, true);
    assert.equal(noLoginConfig.config.ready, true);

    const managedLoginConfig = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mysql",
        [VIBE64_APP_AUTH_MODE_CONFIG]: VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE
      }
    });
    assert.equal(managedLoginConfig.ok, true);
    assert.equal(managedLoginConfig.config.ready, true);

    const manualLoginConfig = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mysql",
        [VIBE64_APP_AUTH_MODE_CONFIG]: VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE,
        [VIBE64_MANUAL_SUPABASE_PROJECT_URL_CONFIG]: "https://manual.example.supabase.co",
        [VIBE64_MANUAL_SUPABASE_PUBLISHABLE_KEY_CONFIG]: "manual-publishable-key"
      }
    });
    assert.equal(manualLoginConfig.ok, true);
    assert.equal(manualLoginConfig.config.ready, true);
    assert.equal(
      await readFile(path.join(localRoot, "runtime-config", VIBE64_MANUAL_SUPABASE_PUBLISHABLE_KEY_CONFIG), "utf8"),
      "manual-publishable-key\n"
    );

    const clearedManualLoginConfig = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mysql",
        [VIBE64_APP_AUTH_MODE_CONFIG]: VIBE64_APP_AUTH_MODE_NONE,
        [VIBE64_MANUAL_SUPABASE_PROJECT_URL_CONFIG]: "https://manual.example.supabase.co",
        [VIBE64_MANUAL_SUPABASE_PUBLISHABLE_KEY_CONFIG]: "manual-publishable-key"
      }
    });
    assert.equal(clearedManualLoginConfig.ok, true);
    assert.equal(clearedManualLoginConfig.config.ready, true);
    await assert.rejects(
      () => readFile(path.join(localRoot, "runtime-config", VIBE64_MANUAL_SUPABASE_PROJECT_URL_CONFIG), "utf8"),
      {
        code: "ENOENT"
      }
    );
    await assert.rejects(
      () => readFile(path.join(localRoot, "runtime-config", VIBE64_MANUAL_SUPABASE_PUBLISHABLE_KEY_CONFIG), "utf8"),
      {
        code: "ENOENT"
      }
    );
  });
});

test("Vibe64 project service uses normal JSKIT config fields for Vibe64 itself", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writePackageJson(targetRoot, {
      name: "vibe64"
    });
    const service = createService({
      targetRoot
    });

    await service.saveProjectType({
      projectType: "jskit"
    });

    const defaults = await service.readProjectConfigDefaults();
    assert.equal(defaults.ok, true);
    assert.equal(defaults.defaults.defaults.jskit_database_runtime, "mysql");

    const savedConfig = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mysql"
      }
    });
    assert.equal(savedConfig.ok, true);
    assert.equal(savedConfig.config.values.github_pr_merge_method, "merge");
    assert.equal(savedConfig.config.values.jskit_database_runtime, "mysql");
  });
});

test("Vibe64 project service can preview and save config with a draft project type", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      targetRoot
    });
    const stateRoot = service.currentProjectStateRoot();

    const draftConfig = await service.readProjectConfig({
      projectType: "jskit"
    });
    assert.equal(draftConfig.ok, true);
    assert.equal(draftConfig.config.projectType, "jskit");
    assert.equal(draftConfig.config.adapter.id, "jskit");
    await assert.rejects(
      () => readFile(path.join(stateRoot, "project_type"), "utf8"),
      {
        code: "ENOENT"
      }
    );

    const savedConfig = await service.saveProjectConfig({
      projectType: "jskit",
      values: {
        github_pr_merge_method: "rebase",
        jskit_database_runtime: "mysql"
      }
    });
    assert.equal(savedConfig.ok, true);
    assert.equal(savedConfig.config.ready, true);
    assert.equal(savedConfig.config.projectType, "jskit");
    assert.equal(
      await readFile(path.join(stateRoot, "project_type"), "utf8"),
      "jskit\n"
    );
    assert.equal(
      await readFile(path.join(stateRoot, "config", "github_pr_merge_method"), "utf8"),
      "rebase\n"
    );
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
        jskit_database_runtime: "none"
      }
    });

    const runtime = await service.createRuntime();
    assert.equal(runtime.workflowRegistry, workflowRegistry);
  });
});

test("Vibe64 project service composes project config environment resolvers", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      projectConfigEnvironmentResolvers: [
        async ({ projectConfig }) => ({
          JSKIT_AUTH_MODE: projectConfig?.values?.[VIBE64_APP_AUTH_MODE_CONFIG] || ""
        })
      ],
      targetRoot
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await service.saveProjectConfig({
      values: {
        [VIBE64_APP_AUTH_MODE_CONFIG]: "managed_supabase",
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none"
      }
    });

    const environment = await service.projectConfigEnvironment();
    assert.equal(environment.JSKIT_AUTH_MODE, "managed_supabase");
  });
});

test("Vibe64 project service resolves and materializes JSKIT dev runtime config", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitProject(targetRoot);
    await writeFile(path.join(targetRoot, ".env"), "STALE=from-user\n", "utf8");
    const service = createService({
      projectConfigEnvironmentResolvers: [
        async () => ({
          APP_SHOULD_NOT_IMPORT_ENV: "ignored",
          JSKIT_AUTH_ENVIRONMENT: "dev",
          JSKIT_AUTH_MODE: "managed_supabase",
          JSKIT_AUTH_PROVIDER: "supabase",
          JSKIT_AUTH_SOURCE: "vibe64-managed",
          JSKIT_AUTH_SUPABASE_PROJECT_REF: "devref",
          JSKIT_AUTH_SUPABASE_PUBLISHABLE_KEY: "pk_dev",
          JSKIT_AUTH_SUPABASE_URL: "https://devref.supabase.co"
        })
      ],
      targetRoot
    });
    const worktreePath = path.join(service.currentProjectLocalRoot(), "sessions", "active", "runtime-config", "source");
    await mkdir(worktreePath, {
      recursive: true
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await service.saveProjectConfig({
      values: {
        [VIBE64_APP_AUTH_MODE_CONFIG]: VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mysql"
      }
    });
    await commitAll(targetRoot, "Commit Vibe64 config");

    const env = await service.projectRuntimeConfigEnvironment({
      sourcePath: worktreePath
    });
    const runtimeConfig = await service.projectRuntimeConfig();
    const dbPasswordRecord = runtimeConfig.view.records.find((record) => record.key === "DB_PASSWORD");
    const publishableKeyRecord = runtimeConfig.view.records.find((record) => record.key === "AUTH_SUPABASE_PUBLISHABLE_KEY");

    assert.equal(env.APP_PUBLIC_URL, "http://localhost:3000");
    assert.equal(env.AUTH_PROVIDER, "supabase");
    assert.equal(env.AUTH_SUPABASE_URL, "https://devref.supabase.co");
    assert.equal(env.AUTH_SUPABASE_PUBLISHABLE_KEY, "pk_dev");
    assert.equal(env.DB_CLIENT, "mysql2");
    assert.equal(env.DB_HOST, "vibe64-mariadb");
    assert.equal(env.DB_PASSWORD, "vibe64_jskit_root");
    assert.equal(env.JSKIT_AUTH_SUPABASE_URL, undefined);
    assert.equal(env.JSKIT_AUTH_SUPABASE_PUBLISHABLE_KEY, undefined);
    assert.equal(env.APP_SHOULD_NOT_IMPORT_ENV, undefined);
    assert.equal(dbPasswordRecord.owner, "vibe64");
    assert.equal(dbPasswordRecord.editable, false);
    assert.equal(dbPasswordRecord.value, "********");
    assert.equal(publishableKeyRecord.owner, "vibe64");
    assert.equal(publishableKeyRecord.editable, false);
    assert.equal(publishableKeyRecord.value, "********");

    const rootEnv = await readFile(path.join(targetRoot, ".env"), "utf8");
    const worktreeEnv = await readFile(path.join(worktreePath, ".env"), "utf8");
    assert.equal(rootEnv, worktreeEnv);
    assert.match(rootEnv, /# Generated by Vibe64\./u);
    assert.match(rootEnv, /APP_PUBLIC_URL=http:\/\/localhost:3000/u);
    assert.match(rootEnv, /AUTH_PROVIDER=supabase/u);
    assert.match(rootEnv, /AUTH_SUPABASE_URL=https:\/\/devref\.supabase\.co/u);
    assert.match(rootEnv, /AUTH_SUPABASE_PUBLISHABLE_KEY=pk_dev/u);
    assert.match(rootEnv, /DB_NAME=target_/u);
    assert.doesNotMatch(rootEnv, /JSKIT_AUTH_SUPABASE_/u);

    const apiResponse = await service.readRuntimeConfig({
      scope: "dev"
    });
    assert.equal(apiResponse.runtimeConfig.sync.synced, true);
    assert.match(apiResponse.runtimeConfig.lastGeneratedAt, /^20/u);
    assert.deepEqual(apiResponse.runtimeConfig.sync.roots.map((root) => root.rootKind), [
      "project-root",
      "session-source"
    ]);
    assert.deepEqual(apiResponse.runtimeConfig.sync.roots.flatMap((root) => root.targets.map((target) => target.status)), [
      "synced",
      "synced"
    ]);
  });
});

test("Vibe64 project service materializes runtime config into catalog session sources only", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      githubRepository: {
        fullName: "example/catalog-app"
      },
      slug: "catalog-app"
    });
    const targetRoot = path.join(projectsRoot, "catalog-app");
    const projectLocalRoot = projectContext.projectLocalRootForTarget(targetRoot);
    const projectStateRoot = projectContext.projectStateRootForTarget(targetRoot);
    const sessionSourcePath = path.join(projectLocalRoot, "sessions", "active", "runtime-config", "source");
    await mkdir(sessionSourcePath, {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".env"), "STALE=from-project-home\n", "utf8");
    const service = createService({
      projectConfigEnvironmentResolvers: [
        async () => ({
          JSKIT_AUTH_ENVIRONMENT: "dev",
          JSKIT_AUTH_MODE: "managed_supabase",
          JSKIT_AUTH_PROVIDER: "supabase",
          JSKIT_AUTH_SOURCE: "vibe64-managed",
          JSKIT_AUTH_SUPABASE_PROJECT_REF: "devref",
          JSKIT_AUTH_SUPABASE_PUBLISHABLE_KEY: "pk_dev",
          JSKIT_AUTH_SUPABASE_URL: "https://devref.supabase.co"
        })
      ],
      projectContext
    });
    const requestContext = {
      projectLocalRoot,
      projectStateRoot,
      projectsRoot,
      slug: "catalog-app",
      targetRoot
    };

    await runWithProjectRequestContext(requestContext, async () => {
      await service.saveProjectType({
        projectType: "jskit"
      });
      await service.saveProjectConfig({
        values: {
          [VIBE64_APP_AUTH_MODE_CONFIG]: VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
          github_pr_merge_method: "merge",
          jskit_database_runtime: "mysql"
        }
      });

      await service.projectRuntimeConfigEnvironment({
        sourcePath: sessionSourcePath
      });

      assert.equal(await readFile(path.join(targetRoot, ".env"), "utf8"), "STALE=from-project-home\n");
      const sessionEnv = await readFile(path.join(sessionSourcePath, ".env"), "utf8");
      assert.match(sessionEnv, /# Generated by Vibe64\./u);
      assert.match(sessionEnv, /AUTH_SUPABASE_URL=https:\/\/devref\.supabase\.co/u);
      assert.match(sessionEnv, /DB_NAME=catalog_app/u);

      const apiResponse = await service.readRuntimeConfig({
        scope: "dev"
      });
      assert.equal(apiResponse.runtimeConfig.sync.synced, true);
      assert.deepEqual(apiResponse.runtimeConfig.sync.roots.map((syncRoot) => syncRoot.rootKind), [
        "session-source"
      ]);
      assert.deepEqual(apiResponse.runtimeConfig.sync.roots.map((syncRoot) => syncRoot.path), [
        sessionSourcePath
      ]);
    });
  });
});

test("Vibe64 project service saves user-owned runtime values and redacts API responses", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitProject(targetRoot);
    const service = createService({
      targetRoot
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await service.saveProjectConfig({
      values: {
        [VIBE64_APP_AUTH_MODE_CONFIG]: VIBE64_APP_AUTH_MODE_NONE,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none"
      }
    });
    await commitAll(targetRoot, "Commit Vibe64 config");

    const saved = await service.saveRuntimeConfigUserValues({
      scope: "dev",
      values: {
        OPENAI_API_KEY: {
          requiredFor: [RUNTIME_CONFIG_PHASES.PREVIEW],
          secret: true,
          value: "sk-test"
        }
      }
    });
    const savedRecord = saved.runtimeConfig.view.records.find((record) => record.key === "OPENAI_API_KEY");
    assert.equal(saved.ok, true);
    assert.equal(savedRecord.owner, "user");
    assert.equal(savedRecord.editable, true);
    assert.equal(savedRecord.value, "********");

    const apiResponse = await service.readRuntimeConfig({
      scope: "dev"
    });
    const apiRecord = apiResponse.runtimeConfig.view.records.find((record) => record.key === "OPENAI_API_KEY");
    assert.equal(apiResponse.ok, true);
    assert.equal(apiRecord.value, "********");
    assert.deepEqual(apiResponse.runtimeConfig.missing, []);

    const env = await service.projectRuntimeConfigEnvironment({
      materialize: false,
      phase: RUNTIME_CONFIG_PHASES.PREVIEW
    });
    assert.equal(env.OPENAI_API_KEY, "sk-test");
  });
});

test("Vibe64 project service rejects user edits for Vibe64-owned runtime values", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitProject(targetRoot);
    const service = createService({
      targetRoot
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await service.saveProjectConfig({
      values: {
        [VIBE64_APP_AUTH_MODE_CONFIG]: VIBE64_APP_AUTH_MODE_NONE,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mysql"
      }
    });
    await commitAll(targetRoot, "Commit Vibe64 config");

    const blocked = await service.saveRuntimeConfigUserValues({
      scope: "dev",
      values: {
        DB_PASSWORD: {
          secret: true,
          value: "user-password"
        }
      }
    });

    const runtimeConfig = await service.projectRuntimeConfig();
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errors[0].code, "vibe64_runtime_config_value_not_editable");
    assert.equal(runtimeConfig.values.DB_PASSWORD, "vibe64_jskit_root");
  });
});

test("Vibe64 project service blocks missing required runtime config for the requested phase", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitProject(targetRoot);
    const service = createService({
      targetRoot
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await service.saveProjectConfig({
      values: {
        [VIBE64_APP_AUTH_MODE_CONFIG]: VIBE64_APP_AUTH_MODE_NONE,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none"
      }
    });
    await commitAll(targetRoot, "Commit Vibe64 config");

    await service.saveRuntimeConfigUserValues({
      scope: "dev",
      values: {
        OPENAI_API_KEY: {
          requiredFor: [RUNTIME_CONFIG_PHASES.PREVIEW],
          secret: true,
          value: ""
        }
      }
    });

    const config = await service.readRuntimeConfig({
      phase: RUNTIME_CONFIG_PHASES.PREVIEW,
      scope: "dev"
    });
    assert.deepEqual(config.runtimeConfig.missing.map((record) => record.key), ["OPENAI_API_KEY"]);
    await assert.rejects(
      () => service.projectRuntimeConfigEnvironment({
        materialize: false,
        phase: RUNTIME_CONFIG_PHASES.PREVIEW
      }),
      {
        code: "vibe64_runtime_config_missing"
      }
    );

    const env = await service.projectRuntimeConfigEnvironment({
      materialize: false,
      phase: RUNTIME_CONFIG_PHASES.SERVER
    });
    assert.equal(env.OPENAI_API_KEY, "");
  });
});

test("Vibe64 project service runs best-effort hooks after project config saves", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const hookCalls = [];
    const service = createService({
      projectConfigSavedHooks: [
        async ({ projectConfig, targetRoot: hookTargetRoot }) => {
          hookCalls.push({
            mode: projectConfig.values[VIBE64_APP_AUTH_MODE_CONFIG],
            targetRoot: hookTargetRoot
          });
          return {
            ok: true,
            synced: true
          };
        }
      ],
      targetRoot
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    const saved = await service.saveProjectConfig({
      values: {
        [VIBE64_APP_AUTH_MODE_CONFIG]: VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none"
      }
    });

    assert.equal(saved.ok, true);
    assert.deepEqual(hookCalls, [
      {
        mode: VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
        targetRoot
      }
    ]);
    assert.deepEqual(saved.config.sync, [
      {
        ok: true,
        synced: true
      }
    ]);
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
    await writeFile(path.join(stateRoot, "config", "jskit_database_runtime"), "mysql\n", "utf8");
    await writeFile(path.join(stateRoot, "config", VIBE64_APP_AUTH_MODE_CONFIG), "none\n", "utf8");

    const config = await service.readProjectConfig();
    assert.equal(config.ok, true);
    assert.equal(config.config.ready, true);
    assert.equal(config.config.values.jskit_database_runtime, "mysql");
    assert.deepEqual(config.config.invalid, []);
  });
});
