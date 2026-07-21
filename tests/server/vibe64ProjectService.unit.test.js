import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createService
} from "../../packages/vibe64-project/src/server/service.js";
import {
  projectEnvMaterializeInputValidator,
  projectEnvUserValuesInputValidator
} from "../../packages/vibe64-project/src/server/inputSchemas.js";
import {
  VIBE64_INITIALIZATION_WORKFLOW_DEFINITION_IDS,
  VIBE64_WORKFLOW_DEFINITION_IDS,
  createCoreWorkflowRegistry
} from "@local/vibe64-runtime/server";
import {
  createStudioProjectContext
} from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
} from "../../packages/vibe64-core/src/server/projectRepository.js";
import {
  PROJECT_APPLICATION_MODE_EXISTING,
  PROJECT_APPLICATION_MODE_NEW,
  PROJECT_APPLICATION_MODE_ONE_OFF_FLAG
} from "../../packages/vibe64-core/src/server/projectApplication.js";
import {
  writeProjectOneOffFlag
} from "../../packages/vibe64-core/src/server/projectOneOffFlags.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  writeProjectRuntimeOpenState
} from "../../packages/vibe64-core/src/server/projectRuntimeOpenState.js";
import {
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_TARGETS
} from "@local/vibe64-core/server/runtimeConfig";
import {
  readEnvUserValues
} from "@local/vibe64-core/server/envUserValues";
import {
  JSKIT_AUTH_PROVIDER_SUPABASE,
  JSKIT_AUTH_PROVIDER_SUPABASE_PACKAGE,
  JSKIT_USER_MODE_CONFIG,
  JSKIT_USER_MODE_NONE,
  JSKIT_USER_MODE_USERS,
  jskitAppAuthEnvironment
} from "@local/vibe64-adapters/server/adapters/jskit/appAuthConfig";
import {
  GENERIC_NODE_WEB_CLIENT_LIBRARY_CONFIG
} from "@local/vibe64-adapters/server/adapters/node-web/index";
import {
  JSKIT_MARIADB_APP_USER,
  jskitMariaDbAppPassword
} from "@local/vibe64-adapters/server/adapters/jskit/setupMariaDbRuntime";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);
const VIBE64_PUBLIC_SOURCE_ROOT_ENV = "VIBE64_PUBLIC_SOURCE_ROOT";

function githubProjectRepositoryInput(github = {}) {
  const {
    defaultBranch = "main",
    ...githubMetadata
  } = github;
  return {
    repository: {
      defaultBranch,
      github: githubMetadata,
      mode: PROJECT_REPOSITORY_MODE_GITHUB
    }
  };
}

async function writeProjectApplicationMode(projectContext, slug, value) {
  await projectContext.writeWorkspaceProjectOneOffFlag({
    flag: PROJECT_APPLICATION_MODE_ONE_OFF_FLAG,
    slug,
    value
  });
}

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

function createServiceForTemporaryTarget(targetRoot, options = {}) {
  return createService({
    ...options,
    projectContext: createStudioProjectContext({
      explicitManagedSourceRoot: path.join(path.dirname(targetRoot), "managed-source"),
      explicitTargetRoot: targetRoot,
      env: {},
      home: path.dirname(targetRoot)
    })
  });
}

async function createSessionSourceFixture({
  projectLocalRoot = "",
  projectSessionSourceRoot = "",
  sessionId = "",
  workTitle = ""
} = {}) {
  const sourcePath = path.join(projectSessionSourceRoot, "sessions", "active", sessionId, "source");
  const metadataRoot = path.join(projectLocalRoot, "sessions", "active", sessionId, "metadata");
  await mkdir(sourcePath, {
    recursive: true
  });
  await mkdir(metadataRoot, {
    recursive: true
  });
  await writeFile(path.join(metadataRoot, "source_path"), `${sourcePath}\n`, "utf8");
  await writeFile(path.join(metadataRoot, "source_kind"), "session_clone\n", "utf8");
  await writeFile(path.join(metadataRoot, "source_path_authority"), `${SESSION_SOURCE_PATH_AUTHORITY_MANAGED}\n`, "utf8");
  if (workTitle) {
    await writeFile(path.join(metadataRoot, "work_title"), `${workTitle}\n`, "utf8");
  }
  return sourcePath;
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
  databaseRuntime = "mariadb",
  mergeMethod = "merge",
  projectType = "jskit",
  userMode = JSKIT_USER_MODE_USERS
} = {}) {
  await mkdir(root, {
    recursive: true
  });
  await writeFile(path.join(root, "vibe64.project.json"), `${JSON.stringify({
    schema: "vibe64.project",
    schemaVersion: 1,
    projectType,
    config: {
      github_pr_merge_method: mergeMethod,
      jskit_database_runtime: databaseRuntime,
      [JSKIT_USER_MODE_CONFIG]: userMode
    }
  }, null, 2)}\n`, "utf8");
}

async function writeSeededJskitMarkers(root, {
  installedPackages = {}
} = {}) {
  const files = {
    ".jskit/lock.json": `${JSON.stringify({
      lockVersion: 1,
      installedPackages
    }, null, 2)}\n`,
    "config/public.js": "export default {};\n",
    "packages/main/package.descriptor.mjs": "export default {};\n",
    "src/main.js": "export {};\n"
  };
  await writePackageJson(root, {
    name: "seeded-jskit-app"
  });
  await Promise.all(Object.entries(files).map(async ([relativePath, contents]) => {
    const filePath = path.join(root, relativePath);
    await mkdir(path.dirname(filePath), {
      recursive: true
    });
    await writeFile(filePath, contents, "utf8");
  }));
}

test("Vibe64 project service exposes project selection before project-specific state", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    const service = createService({
      projectContext
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
    const expectedProjectRoot = path.join(projectsRoot, "example-app");
    const expectedRuntimeRoot = projectContext.projectRuntimeRootForSlug("example-app");
    const expectedRecordPath = projectContext.projectRecordPathForSlug("example-app");
    assert.equal(created.ok, true);
    assert.equal(created.hasSelection, true);
    assert.equal(created.targetRoot, expectedProjectRoot);
    assert.equal(service.targetRoot, expectedProjectRoot);
    assert.equal(service.currentTargetRoot(), expectedProjectRoot);
    assert.equal(created.currentProject.slug, "example-app");
    assert.equal(created.currentProject.projectRoot, expectedProjectRoot);
    assert.equal(created.currentProject.projectRuntimeRoot, expectedRuntimeRoot);
    assert.equal(created.currentProject.projectLocalRoot, expectedRuntimeRoot);
    assert.equal(created.currentProject.projectRecordPath, expectedRecordPath);
    assert.equal(created.currentProject.gitCacheRoot, path.join(expectedProjectRoot, "git-cache"));

    const routedCurrentProject = await service.runInProjectContext(
      "example-app",
      () => service.readCurrentProject()
    );
    assert.equal(routedCurrentProject.slug, "example-app");
    assert.equal(routedCurrentProject.projectRoot, expectedProjectRoot);
    assert.equal(routedCurrentProject.projectRuntimeRoot, expectedRuntimeRoot);
    assert.equal(routedCurrentProject.selected, true);

    const afterSelection = await service.readProjectType();
    assert.equal(afterSelection.ok, true);
    assert.equal(afterSelection.projectType.ready, false);
    assert.equal(afterSelection.projectType.status, "missing");
    assert.equal(afterSelection.projectType.bootstrap, false);
    assert.equal(afterSelection.projectType.path, expectedRecordPath);

    const templates = await service.readProjectTemplates();
    assert.equal(templates.ok, true);
    assert.equal(templates.eligibility.eligible, true);
    assert.deepEqual(templates.templates.map((template) => template.id), [
      "jskit-public",
      "jskit-accounts",
      "jskit-database",
      "jskit-workspaces"
    ]);
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
        ...githubProjectRepositoryInput({
          fullName: "example/beepollen"
        }),
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
    assert.equal(listed.setup.studioSetupEnabled, true);
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

test("Vibe64 project service reports composed runtimes as externally managed Studio Setup", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root,
      runtimeProfile: {
        local: false,
        mode: "composed",
        projectCatalogEnabled: true
      }
    });
    await projectContext.createWorkspaceProjectRecord({
      ...githubProjectRepositoryInput({
        fullName: "example/alpha"
      }),
      slug: "alpha"
    });
    const targetRoot = path.join(projectsRoot, "alpha");
    const service = createService({
      projectContext
    });

    const listed = await runWithProjectRequestContext({
      projectsRoot,
      slug: "alpha",
      targetRoot
    }, () => service.listProjects());

    assert.equal(listed.ok, true);
    assert.equal(listed.setup.studioSetupEnabled, false);
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
      ...githubProjectRepositoryInput({
        fullName: "example/alpha_1"
      }),
      slug: "alpha_1"
    });
    await projectContext.createWorkspaceProjectRecord({
      ...githubProjectRepositoryInput({
        fullName: "example/beta"
      }),
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
      ...githubProjectRepositoryInput({
        fullName: "example/catalog-app"
      }),
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
    let sessionManifest = JSON.parse(await readFile(path.join(sessionSourceRoot, "vibe64.project.json"), "utf8"));
    assert.equal(sessionManifest.projectType, "jskit");
    await assert.rejects(
      () => readFile(path.join(projectRoot, "vibe64.project.json"), "utf8"),
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
        jskit_database_runtime: "mariadb"
      }
    }));

    assert.equal(savedConfig.ok, true);
    sessionManifest = JSON.parse(await readFile(path.join(sessionSourceRoot, "vibe64.project.json"), "utf8"));
    assert.equal(sessionManifest.config.jskit_database_runtime, "mariadb");
    await assert.rejects(
      () => readFile(path.join(projectRoot, "vibe64.project.json"), "utf8"),
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
	        jskit_database_runtime: "mariadb"
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
	        jskit_database_runtime: "mariadb"
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
      ...githubProjectRepositoryInput({
        fullName: "example/catalog-app"
      }),
      slug: "catalog-app"
    });
    const runtimeRoot = projectContext.projectRuntimeRootForSlug("catalog-app");
    await mkdir(sessionSourceRoot, {
      recursive: true
    });
    await mkdir(otherSessionSourceRoot, {
      recursive: true
    });
    await mkdir(path.join(runtimeRoot, "sessions", "active", "setup-session", "metadata"), {
      recursive: true
    });
    await mkdir(path.join(runtimeRoot, "sessions", "active", "other-session", "metadata"), {
      recursive: true
    });
    await writeFile(path.join(runtimeRoot, "sessions", "active", "setup-session", "metadata", "source_path"), `${sessionSourceRoot}\n`, "utf8");
    await writeFile(path.join(runtimeRoot, "sessions", "active", "other-session", "metadata", "source_path"), `${otherSessionSourceRoot}\n`, "utf8");
    const service = createService({
      projectContext
    });
    const requestContext = {
      projectRecordPath: projectContext.projectRecordPathForSlug("catalog-app"),
      projectLocalRoot: runtimeRoot,
      projectRuntimeRoot: runtimeRoot,
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
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mariadb"
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
    assert.equal(projectConfigEnv.VIBE64_PROJECT_MANIFEST, path.join(sessionSourceRoot, "vibe64.project.json"));
    assert.equal(projectConfigEnv.VIBE64_CONFIG_LOCAL_DIR, path.join(runtimeRoot, "runtime-config"));

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

test("Vibe64 project dashboard Env reads committed git-cache and ignores active session config", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const sourceRepo = path.join(root, "source-repo");
    await createGitProject(sourceRepo);
    await writeVibe64SourceConfig(sourceRepo, {
      databaseRuntime: "mariadb"
    });
    await commitAll(sourceRepo, "Commit source-owned Vibe64 config");
    const defaultBranch = await gitCurrentBranch(sourceRepo);

    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      ...githubProjectRepositoryInput({
        defaultBranch,
        fullName: "example/catalog-app"
      }),
      slug: "catalog-app"
    });
    const projectRoot = path.join(projectsRoot, "catalog-app");
    const runtimeRoot = projectContext.projectRuntimeRootForSlug("catalog-app");
    const recordPath = projectContext.projectRecordPathForSlug("catalog-app");
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
    await mkdir(path.join(runtimeRoot, "sessions", "active", "session-a", "metadata"), {
      recursive: true
    });
    await mkdir(path.join(runtimeRoot, "sessions", "active", "session-b", "metadata"), {
      recursive: true
    });
    await writeFile(path.join(runtimeRoot, "sessions", "active", "session-a", "metadata", "source_path"), `${sessionSourceA}\n`, "utf8");
    await writeFile(path.join(runtimeRoot, "sessions", "active", "session-b", "metadata", "source_path"), `${sessionSourceB}\n`, "utf8");

    const service = createService({
      projectContext
    });
    const requestContext = {
      projectRecordPath: recordPath,
      projectLocalRoot: runtimeRoot,
      projectRuntimeRoot: runtimeRoot,
      projectsRoot,
      slug: "catalog-app",
      targetRoot: projectRoot
    };

    const dashboardEnv = await runWithProjectRequestContext(
      requestContext,
      () => service.readEnv({
        environment: "dev"
      })
    );
    assert.equal(dashboardEnv.ok, true);
    assert.equal(dashboardEnv.env.unavailable, null);
    assert.equal(dashboardEnv.env.records.find((record) => record.key === "DB_CLIENT")?.value, "mysql2");

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

test("Vibe64 project dashboard Env reads local-source project baseline without git-cache", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      repository: {
        mode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      },
      slug: "whs"
    });
    const projectRoot = path.join(projectsRoot, "whs");
    const runtimeRoot = projectContext.projectRuntimeRootForSlug("whs");
    const recordPath = projectContext.projectRecordPathForSlug("whs");
    await writeVibe64SourceConfig(projectRoot, {
      databaseRuntime: "mariadb"
    });
    const service = createService({
      projectContext
    });
    const requestContext = {
      projectRecordPath: recordPath,
      projectLocalRoot: runtimeRoot,
      projectRuntimeRoot: runtimeRoot,
      projectsRoot,
      slug: "whs",
      targetRoot: projectRoot
    };

    const projectConfig = await runWithProjectRequestContext(
      requestContext,
      () => service.readProjectConfig()
    );

    assert.equal(projectConfig.ok, true);
    assert.equal(projectConfig.config.ready, true);
    assert.equal(projectConfig.config.sourceType, "source-tree");
    assert.equal(projectConfig.config.values.jskit_database_runtime, "mariadb");

    const dashboardEnv = await runWithProjectRequestContext(
      requestContext,
      () => service.readEnv({
        environment: "dev"
      })
    );

    assert.equal(dashboardEnv.ok, true);
    assert.equal(dashboardEnv.env.unavailable, null);
    assert.equal(dashboardEnv.env.configSource.label, "Project baseline");
    assert.equal(dashboardEnv.env.configSource.rootKind, "project-root");
    assert.equal(dashboardEnv.env.configSource.sourceRoot, projectRoot);
    assert.equal(dashboardEnv.env.records.find((record) => record.key === "DB_CLIENT")?.value, "mysql2");
    assert.deepEqual(dashboardEnv.env.generatedFiles.roots.map((root) => root.path), [
      projectRoot
    ]);
  });
});

test("Vibe64 project dashboard Env reports missing committed config without choosing a session", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "catalog-app");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      ...githubProjectRepositoryInput({
        defaultBranch: "main",
        fullName: "example/catalog-app"
      }),
      slug: "catalog-app"
    });
    await writeVibe64SourceConfig(path.join(projectRoot, "sessions", "active", "session-a", "source"), {
      databaseRuntime: "mariadb"
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

    const dashboardEnv = await runWithProjectRequestContext(
      requestContext,
      () => service.readEnv({
        environment: "dev"
      })
    );

    assert.equal(dashboardEnv.ok, true);
    assert.equal(dashboardEnv.env.ok, false);
    assert.equal(
      dashboardEnv.env.unavailable.code,
      "vibe64_committed_project_git_cache_missing"
    );
    assert.doesNotMatch(
      dashboardEnv.env.unavailable.code,
      /session_required/u
    );
  });
});

test("Vibe64 project dashboard Env saves runtime-local user values when baseline config is unavailable", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "catalog-app");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      ...githubProjectRepositoryInput({
        defaultBranch: "main",
        fullName: "example/catalog-app"
      }),
      slug: "catalog-app"
    });
    const runtimeRoot = projectContext.projectRuntimeRootForSlug("catalog-app");
    const service = createService({
      projectContext
    });
    const requestContext = {
      projectLocalRoot: runtimeRoot,
      projectRuntimeRoot: runtimeRoot,
      projectsRoot,
      slug: "catalog-app",
      targetRoot: projectRoot
    };

    const saved = await runWithProjectRequestContext(
      requestContext,
      () => service.saveEnvUserValues({
        environment: "dev",
        values: {
          OPENAI_API_KEY: {
            secret: true,
            value: "sk-unavailable"
          }
        }
      })
    );
    const userValues = await readEnvUserValues({
      projectLocalRoot: runtimeRoot
    });
    const savedRecord = saved.env.records.find((record) => record.key === "OPENAI_API_KEY");

    assert.equal(saved.ok, true);
    assert.equal(saved.env.ok, false);
    assert.equal(saved.env.unavailable.code, "vibe64_committed_project_git_cache_missing");
    assert.equal(savedRecord.value, "********");
    assert.equal(userValues.records.find((record) => record.key === "OPENAI_API_KEY")?.value, "sk-unavailable");
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
      ...githubProjectRepositoryInput({
        fullName: "example/catalog-app"
      }),
      slug: "catalog-app"
    });
    await writeProjectApplicationMode(projectContext, "catalog-app", PROJECT_APPLICATION_MODE_NEW);
    const runtimeRoot = projectContext.projectRuntimeRootForSlug("catalog-app");
    await mkdir(path.join(runtimeRoot, "sessions", "active", "session-a", "source"), {
      recursive: true
    });
    await mkdir(path.join(runtimeRoot, "sessions", "active", "session-b", "source"), {
      recursive: true
    });
    const service = createService({
      projectContext
    });
    const requestContext = {
      projectRecordPath: projectContext.projectRecordPathForSlug("catalog-app"),
      projectLocalRoot: runtimeRoot,
      projectRuntimeRoot: runtimeRoot,
      projectsRoot,
      slug: "catalog-app",
      targetRoot: projectRoot
    };

    await assert.rejects(
      () => runWithProjectRequestContext(requestContext, () => service.createRuntime()),
      {
        code: "vibe64_project_type_missing"
      }
    );

    const runtime = await runWithProjectRequestContext(
      requestContext,
      () => service.createRuntime({
        sourceSetupRequired: false
      })
    );

    assert.equal(runtime.stateRoot, projectContext.projectRuntimeRootForSlug("catalog-app"));
    assert.equal(runtime.targetRoot, projectRoot);
    assert.equal(runtime.sourceContractRoot, "");
    assert.equal(runtime.projectRecordPath, projectContext.projectRecordPathForSlug("catalog-app"));
  });
});

test("Vibe64 project service keeps session controls available with malformed source metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeSeededJskitMarkers(targetRoot);
    await writeVibe64SourceConfig(targetRoot);
    const service = createServiceForTemporaryTarget(targetRoot);
    const runtime = await service.createRuntime();
    const created = await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: {
        source_path: targetRoot
      },
      sessionId: "malformed-source-metadata"
    });
    await runtime.promptContextSnapshotForSession(created);
    const packageJsonPath = path.join(targetRoot, "package.json");
    const projectManifestPath = path.join(targetRoot, "vibe64.project.json");
    const validPackageJson = await readFile(packageJsonPath, "utf8");
    await writeFile(packageJsonPath, "{\n", "utf8");

    const packageFailureRuntime = await service.createRuntime({
      sessionId: "malformed-source-metadata"
    });
    const packageFailureSession = await packageFailureRuntime.getSession("malformed-source-metadata");
    assert.equal(packageFailureSession.sourceInspection.kind, "source_error");
    assert.equal(packageFailureSession.sourceInspection.error.code, "vibe64_invalid_jskit_json");
    assert.equal(packageFailureSession.sourceInspection.error.message, "Application source metadata is invalid and must be repaired.");
    assert.equal(JSON.stringify(packageFailureSession.sourceInspection).includes(targetRoot), false);

    const controlRuntime = await service.createRuntime({
      inspectSource: false,
      sessionId: "malformed-source-metadata"
    });
    const controlSession = await controlRuntime.getSession("malformed-source-metadata");
    assert.equal(controlSession.sourceInspection, undefined);
    assert.equal(controlSession.adapter.id, "jskit");
    await assert.rejects(
      controlRuntime.assertSourceHealthy(controlSession),
      (error) => error?.code === "vibe64_source_inspection_unavailable"
    );

    await writeFile(packageJsonPath, validPackageJson, "utf8");
    await writeFile(projectManifestPath, "{\n", "utf8");
    const inspectedRuntime = await service.createRuntime({
      sessionId: "malformed-source-metadata"
    });
    const inspectedSession = await inspectedRuntime.getSession("malformed-source-metadata");
    assert.equal(inspectedSession.status, "active");
    assert.equal(inspectedSession.sourceInspection.status, "error");
    assert.equal(inspectedSession.sourceInspection.kind, "source_error");
    assert.equal(inspectedSession.sourceInspection.error.message, "Application source metadata is invalid and must be repaired.");
    assert.equal(inspectedSession.sourceInspection.lastKnownGood.adapterId, "jskit");

    await rm(projectManifestPath);
    await mkdir(projectManifestPath);
    const sourceIndependentRuntime = await service.createRuntime({
      inspectSource: false,
      sessionId: "malformed-source-metadata"
    });
    assert.equal(
      (await sourceIndependentRuntime.getSession("malformed-source-metadata")).adapter.id,
      "jskit"
    );
    const unavailableInspectionRuntime = await service.createRuntime({
      sessionId: "malformed-source-metadata"
    });
    const unavailableInspectionSession = await unavailableInspectionRuntime.getSession("malformed-source-metadata");
    assert.equal(unavailableInspectionSession.sourceInspection.kind, "platform_error");
    assert.deepEqual(unavailableInspectionSession.sourceInspection.error, {
      code: "vibe64_source_inspection_unavailable",
      message: "Vibe64 could not inspect this application right now."
    });
  });
});

test("Vibe64 project service reads bootstrap config when active session sources are ambiguous", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "catalog-app");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      ...githubProjectRepositoryInput({
        fullName: "example/catalog-app"
      }),
      slug: "catalog-app"
    });
    await writeProjectApplicationMode(projectContext, "catalog-app", PROJECT_APPLICATION_MODE_NEW);
    const service = createService({
      projectContext
    });
    const runtimeRoot = projectContext.projectRuntimeRootForSlug("catalog-app");
    const requestContext = {
      projectRecordPath: projectContext.projectRecordPathForSlug("catalog-app"),
      projectLocalRoot: runtimeRoot,
      projectRuntimeRoot: runtimeRoot,
      projectsRoot,
      slug: "catalog-app",
      targetRoot: projectRoot
    };

    await runWithProjectRequestContext(requestContext, () => service.saveProjectType({
      projectType: "jskit",
      sessionId: "pre-source-session"
    }));
    await runWithProjectRequestContext(requestContext, () => service.saveProjectConfig({
      sessionId: "pre-source-session",
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "postgres"
      }
    }));
    await mkdir(path.join(runtimeRoot, "sessions", "active", "session-a", "source"), {
      recursive: true
    });
    await mkdir(path.join(runtimeRoot, "sessions", "active", "session-b", "source"), {
      recursive: true
    });

    const runtime = await runWithProjectRequestContext(
      requestContext,
      () => service.createRuntime()
    );
    const creationOptions = await runtime.workflowDefinitionCreationOptions();

    assert.equal(runtime.adapter.id, "jskit");
    assert.equal(runtime.projectConfig.bootstrap, true);
    assert.equal(runtime.projectConfig.values.jskit_database_runtime, "postgres");
    assert.equal(creationOptions.seedRequired, true);
    assert.equal(creationOptions.mode, "seed_required");
    assert.equal(creationOptions.workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR);
    assert.equal(creationOptions.defaultWorkflowDefinition, VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION);
  });
});

test("Vibe64 project service requires initialization for an explicitly existing application", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "existing-app");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      ...githubProjectRepositoryInput({
        fullName: "example/existing-app"
      }),
      slug: "existing-app"
    });
    await writeProjectApplicationMode(projectContext, "existing-app", PROJECT_APPLICATION_MODE_EXISTING);
    const runtimeRoot = projectContext.projectRuntimeRootForSlug("existing-app");
    const requestContext = {
      projectRecordPath: projectContext.projectRecordPathForSlug("existing-app"),
      projectLocalRoot: runtimeRoot,
      projectRuntimeRoot: runtimeRoot,
      projectsRoot,
      slug: "existing-app",
      targetRoot: projectRoot
    };
    const service = createService({
      projectContext
    });

    await runWithProjectRequestContext(requestContext, () => service.saveProjectType({
      projectType: "jskit",
      sessionId: "before-initialization"
    }));
    await runWithProjectRequestContext(requestContext, () => service.saveProjectConfig({
      sessionId: "before-initialization",
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mariadb"
      }
    }));

    const runtime = await runWithProjectRequestContext(requestContext, () => service.createRuntime());
    const creationOptions = await runtime.workflowDefinitionCreationOptions();

    assert.equal(creationOptions.initializationRequired, true);
    assert.equal(creationOptions.seedRequired, false);
    assert.equal(creationOptions.mode, "initialization_required");
    assert.equal(
      creationOptions.defaultWorkflowDefinition,
      VIBE64_INITIALIZATION_WORKFLOW_DEFINITION_IDS.GITHUB_PR
    );
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
      ...githubProjectRepositoryInput({
        fullName: "example/catalog-app"
      }),
      slug: "catalog-app"
    });
    await writeProjectApplicationMode(projectContext, "catalog-app", PROJECT_APPLICATION_MODE_NEW);
    const service = createService({
      projectContext
    });
    const runtimeRoot = projectContext.projectRuntimeRootForSlug("catalog-app");
    const recordPath = projectContext.projectRecordPathForSlug("catalog-app");
    const requestContext = {
      projectRecordPath: recordPath,
      projectLocalRoot: runtimeRoot,
      projectRuntimeRoot: runtimeRoot,
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
      sessionId: "seed-session",
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
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
      () => readFile(path.join(projectRoot, "vibe64.project.json"), "utf8"),
      {
        code: "ENOENT"
      }
    );
    await assert.rejects(
      () => readFile(path.join(projectRoot, "project.json"), "utf8"),
      {
        code: "ENOENT"
      }
    );
    const projectRecord = JSON.parse(await readFile(recordPath, "utf8"));
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
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "rebase",
        jskit_database_runtime: "mariadb"
      }
    }));
    assert.equal(updatedSeedSessionConfig.ok, true);
    assert.equal(updatedSeedSessionConfig.config.bootstrap, true);
    assert.equal(updatedSeedSessionConfig.config.values.github_pr_merge_method, "rebase");
    assert.equal(updatedSeedSessionConfig.config.values.jskit_database_runtime, "mariadb");
    const updatedProjectRecord = JSON.parse(await readFile(recordPath, "utf8"));
    assert.equal(updatedProjectRecord.bootstrapConfig.status, "pending");
    assert.equal(updatedProjectRecord.bootstrapConfig.values.github_pr_merge_method, "rebase");
    assert.equal(updatedProjectRecord.bootstrapConfig.values.jskit_database_runtime, "mariadb");

    const bootstrapConfigEnv = await runWithProjectRequestContext(
      requestContext,
      () => service.projectConfigEnvironment({
        sessionId: "seed-session"
      })
    );
    assert.equal(
      bootstrapConfigEnv.VIBE64_PROJECT_MANIFEST,
      path.join(projectRoot, "sessions", "active", "seed-session", "source", "vibe64.project.json")
    );
    assert.equal(bootstrapConfigEnv.VIBE64_CONFIG_LOCAL_DIR, path.join(runtimeRoot, "runtime-config"));
    await assert.rejects(
      () => readFile(path.join(projectRoot, "sessions", "active", "seed-session", "source", "vibe64.project.json"), "utf8"),
      {
        code: "ENOENT"
      }
    );

    const bootstrapRuntimeEnv = await runWithProjectRequestContext(
      requestContext,
      () => service.projectRuntimeConfigEnvironment({
        materialize: false,
        phases: [RUNTIME_CONFIG_PHASES.GENERATE],
        sessionId: "seed-session",
        target: "command",
        targetRoot: projectRoot
      })
    );
    assert.equal(bootstrapRuntimeEnv.DB_CLIENT, "mysql2");

    const runtime = await runWithProjectRequestContext(requestContext, () => service.createRuntime());
    assert.equal(runtime.adapter.id, "jskit");
    assert.equal(runtime.projectConfig.bootstrap, true);
    assert.equal(runtime.projectConfig.values.jskit_database_runtime, "mariadb");
  });
});

test("source-backed setup retires a stale bootstrap adapter selection", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      ...githubProjectRepositoryInput({
        fullName: "example/vibe64-online"
      }),
      slug: "vibe64-online"
    });
    const targetRoot = path.join(projectsRoot, "vibe64-online");
    const projectLocalRoot = projectContext.projectLocalRootForTarget(targetRoot);
    const projectRecordPath = projectContext.projectRecordPathForTarget(targetRoot);
    const projectSessionSourceRoot = projectContext.projectSessionSourceRootForTarget(targetRoot);
    const requestContext = {
      projectLocalRoot,
      projectRecordPath,
      projectSessionSourceRoot,
      projectsRoot,
      slug: "vibe64-online",
      targetRoot
    };
    const service = createService({
      projectContext
    });

    const bootstrap = await runWithProjectRequestContext(requestContext, () => service.saveProjectConfig({
      projectType: "jskit",
      sessionId: "adapter-transition",
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mariadb"
      }
    }));
    assert.equal(bootstrap.ok, true);
    assert.equal(bootstrap.config.bootstrap, true);

    const sourceRoot = await createSessionSourceFixture({
      projectLocalRoot,
      projectSessionSourceRoot,
      sessionId: "adapter-transition"
    });
    await writePackageJson(sourceRoot, {
      name: "vibe64-online",
      scripts: {
        dev: "node ./bin/vibe64-online.js dev"
      }
    });

    const saved = await runWithProjectRequestContext(requestContext, () => service.saveProjectConfig({
      projectType: "node-web",
      sessionId: "adapter-transition",
      values: {
        [GENERIC_NODE_WEB_CLIENT_LIBRARY_CONFIG]: "auto",
        github_pr_merge_method: "squash"
      }
    }));
    assert.equal(saved.ok, true);
    assert.equal(saved.config.bootstrap, undefined);
    assert.equal(saved.config.projectType, "node-web");

    const manifest = JSON.parse(await readFile(path.join(sourceRoot, "vibe64.project.json"), "utf8"));
    assert.equal(manifest.projectType, "node-web");
    assert.deepEqual(manifest.config, {
      github_pr_merge_method: "squash",
      [GENERIC_NODE_WEB_CLIENT_LIBRARY_CONFIG]: "auto"
    });
    const runtimeLock = JSON.parse(await readFile(path.join(sourceRoot, "vibe64.runtime-lock.json"), "utf8"));
    assert.equal(runtimeLock.adapter.id, "node-web");
    assert.equal(runtimeLock.project.projectType, "node-web");
    const projectRecord = JSON.parse(await readFile(projectRecordPath, "utf8"));
    assert.equal(projectRecord.bootstrapConfig, undefined);

    const runtime = await runWithProjectRequestContext(requestContext, () => service.createRuntime({
      sessionId: "adapter-transition"
    }));
    assert.equal(runtime.adapter.id, "node-web");
    assert.equal(runtime.projectConfig.projectType, "node-web");
  });
});

test("Vibe64 project service keeps a config-only JSKIT Git cache in the seed workflow", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const sourceRoot = path.join(root, "source");
    await createGitProject(sourceRoot);
    await writeVibe64SourceConfig(sourceRoot, {
      databaseRuntime: "mariadb",
      mergeMethod: "merge",
      projectType: "jskit"
    });
    await commitAll(sourceRoot, "Commit Vibe64 config");

    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      ...githubProjectRepositoryInput({
        fullName: "example/catalog-app"
      }),
      slug: "catalog-app"
    });
    await writeProjectApplicationMode(projectContext, "catalog-app", PROJECT_APPLICATION_MODE_NEW);
    const projectRoot = path.join(projectsRoot, "catalog-app");
    const runtimeRoot = projectContext.projectRuntimeRootForSlug("catalog-app");
    const recordPath = projectContext.projectRecordPathForSlug("catalog-app");
    const gitCacheRepository = path.join(projectRoot, "git-cache", "repository.git");
    await mkdir(path.dirname(gitCacheRepository), {
      recursive: true
    });
    await execFileAsync("git", ["clone", "--bare", sourceRoot, gitCacheRepository]);
    const service = createService({
      projectContext
    });
    const requestContext = {
      projectRecordPath: recordPath,
      projectLocalRoot: runtimeRoot,
      projectRuntimeRoot: runtimeRoot,
      projectsRoot,
      slug: "catalog-app",
      targetRoot: projectRoot
    };

    const projectType = await runWithProjectRequestContext(requestContext, () => service.readProjectType());
    assert.equal(projectType.ok, true);
    assert.equal(projectType.projectType.ready, true);
    assert.equal(projectType.projectType.projectType, "jskit");
    assert.equal(projectType.projectType.sourceType, "git-cache");

    const projectConfig = await runWithProjectRequestContext(requestContext, () => service.readProjectConfig());
    assert.equal(projectConfig.ok, true);
    assert.equal(projectConfig.config.ready, true);
    assert.equal(projectConfig.config.sourceType, "git-cache");
    assert.equal(projectConfig.config.values.github_pr_merge_method, "merge");
    assert.equal(projectConfig.config.values.jskit_database_runtime, "mariadb");

    const sessionScopedProjectType = await runWithProjectRequestContext(requestContext, () => service.readProjectType({
      sessionId: "archived-session"
    }));
    assert.equal(sessionScopedProjectType.ok, true);
    assert.equal(sessionScopedProjectType.projectType.ready, false);
    assert.equal(sessionScopedProjectType.projectType.status, "missing");

    await mkdir(path.join(runtimeRoot, "sessions", "active", "pre-source-session"), {
      recursive: true
    });
    const preSourceSessionProjectType = await runWithProjectRequestContext(requestContext, () => service.readProjectType({
      sessionId: "pre-source-session"
    }));
    assert.equal(preSourceSessionProjectType.ok, true);
    assert.equal(preSourceSessionProjectType.projectType.ready, true);
    assert.equal(preSourceSessionProjectType.projectType.sourceType, "git-cache");

    const preSourceSessionProjectConfig = await runWithProjectRequestContext(requestContext, () => service.readProjectConfig({
      sessionId: "pre-source-session"
    }));
    assert.equal(preSourceSessionProjectConfig.ok, true);
    assert.equal(preSourceSessionProjectConfig.config.ready, true);
    assert.equal(preSourceSessionProjectConfig.config.sourceType, "git-cache");

    const preSourceSessionConfigEnvironment = await runWithProjectRequestContext(requestContext, () => service.projectConfigEnvironment({
      sessionId: "pre-source-session"
    }));
    assert.equal(typeof preSourceSessionConfigEnvironment, "object");
    assert.equal(preSourceSessionConfigEnvironment.VIBE64_PROJECT_MANIFEST, undefined);
    assert.equal(preSourceSessionConfigEnvironment.JSKIT_DATABASE_RUNTIME, undefined);

    const runtime = await runWithProjectRequestContext(requestContext, () => service.createRuntime());
    const creationOptions = await runtime.workflowDefinitionCreationOptions();
    assert.equal(runtime.targetRoot, projectRoot);
    assert.equal(runtime.sourceContractRoot, "");
    assert.equal(creationOptions.seedRequired, true);
    assert.equal(creationOptions.mode, "seed_required");
    assert.equal(creationOptions.workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR);
    assert.equal(creationOptions.defaultWorkflowDefinition, VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION);

    const savedBootstrapConfig = await runWithProjectRequestContext(requestContext, () => service.saveProjectConfig({
      projectType: "jskit",
      sessionId: "pre-source-session",
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "squash",
        jskit_database_runtime: "postgres"
      }
    }));
    assert.equal(savedBootstrapConfig.ok, true);
    assert.equal(savedBootstrapConfig.config.bootstrap, true);
    assert.equal(savedBootstrapConfig.config.values.github_pr_merge_method, "squash");
    assert.equal(savedBootstrapConfig.config.values.jskit_database_runtime, "postgres");

    const bootstrapProjectType = await runWithProjectRequestContext(requestContext, () => service.readProjectType({
      sessionId: "pre-source-session"
    }));
    assert.equal(bootstrapProjectType.ok, true);
    assert.equal(bootstrapProjectType.projectType.ready, true);
    assert.equal(bootstrapProjectType.projectType.bootstrap, true);
    assert.equal(bootstrapProjectType.projectType.sourceType, undefined);

    const bootstrapProjectConfig = await runWithProjectRequestContext(requestContext, () => service.readProjectConfig({
      sessionId: "pre-source-session"
    }));
    assert.equal(bootstrapProjectConfig.ok, true);
    assert.equal(bootstrapProjectConfig.config.ready, true);
    assert.equal(bootstrapProjectConfig.config.bootstrap, true);
    assert.equal(bootstrapProjectConfig.config.sourceType, undefined);
    assert.equal(bootstrapProjectConfig.config.values.github_pr_merge_method, "squash");
    assert.equal(bootstrapProjectConfig.config.values.jskit_database_runtime, "postgres");

    const bootstrapEnvironment = await runWithProjectRequestContext(requestContext, () => service.projectConfigEnvironment({
      sessionId: "pre-source-session"
    }));
    assert.equal(
      bootstrapEnvironment.VIBE64_PROJECT_MANIFEST,
      path.join(projectRoot, "sessions", "active", "pre-source-session", "source", "vibe64.project.json")
    );

    const preSourceSessionRuntime = await runWithProjectRequestContext(
      requestContext,
      () => service.createRuntime({
        sessionId: "pre-source-session"
      })
    );
    assert.equal(preSourceSessionRuntime.adapter.id, "jskit");
    assert.equal(preSourceSessionRuntime.projectConfig.bootstrap, true);
    assert.equal(preSourceSessionRuntime.projectConfig.values.jskit_database_runtime, "postgres");
  });
});

test("Vibe64 project service reads existing GitHub project config without requiring a Git cache", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      ...githubProjectRepositoryInput({
        defaultBranch: "main",
        fullName: "example/existing-app"
      }),
      slug: "existing-app"
    });
    await writeProjectApplicationMode(projectContext, "existing-app", PROJECT_APPLICATION_MODE_EXISTING);
    const projectRoot = path.join(projectsRoot, "existing-app");
    const runtimeRoot = projectContext.projectRuntimeRootForSlug("existing-app");
    const recordPath = projectContext.projectRecordPathForSlug("existing-app");
    const vibe64User = {
      gid: 1000,
      home: path.join(root, "users", "owner"),
      uid: 1000,
      username: "owner"
    };
    const calls = [];
    let readerResult = {
      commit: "0123456789abcdef0123456789abcdef01234567",
      found: true,
      handled: true,
      manifestText: `${JSON.stringify({
        config: {
          github_pr_merge_method: "merge",
          jskit_database_runtime: "mariadb"
        },
        projectType: "jskit",
        schema: "vibe64.project",
        schemaVersion: 1
      })}\n`,
      ref: "refs/heads/main",
      sourceType: "github"
    };
    let readerError = null;
    const service = createService({
      committedProjectConfigReader: {
        async readCommittedProjectConfig(input = {}) {
          calls.push(input);
          if (readerError) {
            throw readerError;
          }
          return readerResult;
        }
      },
      projectContext
    });
    const requestContext = {
      projectRecordPath: recordPath,
      projectLocalRoot: runtimeRoot,
      projectRuntimeRoot: runtimeRoot,
      projectsRoot,
      slug: "existing-app",
      targetRoot: projectRoot,
      vibe64User
    };

    const missingReader = await runWithProjectRequestContext(
      requestContext,
      () => createService({ projectContext }).readProjectType()
    );
    assert.equal(missingReader.ok, true);
    assert.equal(missingReader.projectType.ready, false);
    assert.equal(missingReader.projectType.status, "unavailable");
    assert.equal(missingReader.projectType.errorCode, "vibe64_committed_project_git_cache_missing");

    const valid = await runWithProjectRequestContext(requestContext, () => service.readProjectType());
    assert.equal(valid.ok, true);
    assert.equal(valid.projectType.ready, true);
    assert.equal(valid.projectType.projectType, "jskit");
    assert.equal(valid.projectType.sourceType, "github");
    assert.equal(valid.projectType.commit, readerResult.commit);
    assert.equal(calls[0].metadata.repository.mode, PROJECT_REPOSITORY_MODE_GITHUB);
    assert.equal(calls[0].ref, "refs/heads/main");
    assert.deepEqual(calls[0].vibe64User, vibe64User);
    await assert.rejects(() => access(path.join(projectRoot, "git-cache", "repository.git")), {
      code: "ENOENT"
    });

    readerResult = {
      commit: valid.projectType.commit,
      found: false,
      handled: true,
      ref: "refs/heads/main",
      sourceType: "github"
    };
    const missing = await runWithProjectRequestContext(requestContext, () => service.readProjectType());
    assert.equal(missing.ok, true);
    assert.equal(missing.projectType.ready, false);
    assert.equal(missing.projectType.status, "missing");
    assert.equal(missing.projectType.errorCode, "vibe64_project_type_missing");

    readerResult = {
      commit: valid.projectType.commit,
      found: true,
      handled: true,
      manifestText: "{broken json\n",
      ref: "refs/heads/main",
      sourceType: "github"
    };
    const malformed = await runWithProjectRequestContext(requestContext, () => service.readProjectType());
    assert.equal(malformed.ok, true);
    assert.equal(malformed.projectType.ready, false);
    assert.equal(malformed.projectType.status, "unavailable");
    assert.equal(malformed.projectType.errorCode, "vibe64_committed_project_manifest_invalid");
    assert.match(malformed.projectType.message, /invalid JSON/u);

    readerResult = {
      commit: valid.projectType.commit,
      found: true,
      handled: true,
      manifestText: `${JSON.stringify({
        config: {},
        schema: "vibe64.project",
        schemaVersion: 1
      })}\n`,
      ref: "refs/heads/main",
      sourceType: "github"
    };
    const missingProjectType = await runWithProjectRequestContext(requestContext, () => service.readProjectType());
    assert.equal(missingProjectType.ok, true);
    assert.equal(missingProjectType.projectType.ready, false);
    assert.equal(missingProjectType.projectType.status, "unavailable");
    assert.equal(missingProjectType.projectType.errorCode, "vibe64_committed_project_manifest_invalid");
    assert.match(missingProjectType.projectType.message, /missing projectType/u);

    readerError = Object.assign(new Error("GitHub is unavailable."), {
      code: "github_unavailable"
    });
    const unreadable = await runWithProjectRequestContext(requestContext, () => service.readProjectType());
    assert.equal(unreadable.ok, true);
    assert.equal(unreadable.projectType.ready, false);
    assert.equal(unreadable.projectType.status, "unavailable");
    assert.equal(unreadable.projectType.errorCode, "vibe64_committed_project_repository_unreadable");
    assert.match(unreadable.projectType.message, /GitHub is unavailable/u);
  });
});

test("Vibe64 project service ignores stale bootstrap config when committed git-cache config exists", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const sourceRoot = path.join(root, "source");
    await createGitProject(sourceRoot);
    await writeVibe64SourceConfig(sourceRoot, {
      databaseRuntime: "mariadb",
      mergeMethod: "merge",
      projectType: "jskit"
    });
    await writeSeededJskitMarkers(sourceRoot);
    await commitAll(sourceRoot, "Commit Vibe64 config");

    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      ...githubProjectRepositoryInput({
        fullName: "example/dogandgroom"
      }),
      slug: "dogandgroom"
    });
    const projectRoot = path.join(projectsRoot, "dogandgroom");
    const runtimeRoot = projectContext.projectRuntimeRootForSlug("dogandgroom");
    const recordPath = projectContext.projectRecordPathForSlug("dogandgroom");
    const gitCacheRepository = path.join(projectRoot, "git-cache", "repository.git");
    await mkdir(path.dirname(gitCacheRepository), {
      recursive: true
    });
    await execFileAsync("git", ["clone", "--bare", sourceRoot, gitCacheRepository]);

    const projectRecord = JSON.parse(await readFile(recordPath, "utf8"));
    projectRecord.bootstrapConfig = {
      schemaVersion: 1,
      status: "pending",
      projectType: "jskit",
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "squash",
        jskit_database_runtime: "postgres"
      },
      savedAt: "2026-07-07T17:46:42.940Z"
    };
    await writeFile(recordPath, `${JSON.stringify(projectRecord, null, 2)}\n`, "utf8");

    const service = createService({
      projectContext
    });
    const requestContext = {
      projectRecordPath: recordPath,
      projectLocalRoot: runtimeRoot,
      projectRuntimeRoot: runtimeRoot,
      projectsRoot,
      slug: "dogandgroom",
      targetRoot: projectRoot
    };

    const projectType = await runWithProjectRequestContext(requestContext, () => service.readProjectType());
    assert.equal(projectType.ok, true);
    assert.equal(projectType.projectType.ready, true);
    assert.equal(projectType.projectType.projectType, "jskit");
    assert.equal(projectType.projectType.sourceType, "git-cache");
    assert.notEqual(projectType.projectType.bootstrap, true);

    const projectConfig = await runWithProjectRequestContext(requestContext, () => service.readProjectConfig());
    assert.equal(projectConfig.ok, true);
    assert.equal(projectConfig.config.ready, true);
    assert.equal(projectConfig.config.sourceType, "git-cache");
    assert.notEqual(projectConfig.config.bootstrap, true);
    assert.equal(projectConfig.config.values.github_pr_merge_method, "merge");
    assert.equal(projectConfig.config.values.jskit_database_runtime, "mariadb");

    const runtime = await runWithProjectRequestContext(requestContext, () => service.createRuntime());
    const creationOptions = await runtime.workflowDefinitionCreationOptions();
    assert.equal(runtime.projectConfig.sourceType, "git-cache");
    assert.equal(runtime.projectConfig.values.jskit_database_runtime, "mariadb");
    assert.equal(creationOptions.seedRequired, false);
    assert.equal(creationOptions.mode, "select");

    const projectLevelSave = await runWithProjectRequestContext(requestContext, () => service.saveProjectConfig({
      projectType: "jskit",
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "rebase",
        jskit_database_runtime: "none"
      }
    }));
    assert.equal(projectLevelSave.ok, false);
    assert.equal(projectLevelSave.errors[0].code, "vibe64_project_config_committed_read_only");

    const updatedProjectRecord = JSON.parse(await readFile(recordPath, "utf8"));
    assert.equal(updatedProjectRecord.bootstrapConfig.values.github_pr_merge_method, "squash");
    assert.equal(updatedProjectRecord.bootstrapConfig.values.jskit_database_runtime, "postgres");
  });
});

test("Vibe64 project service reads committed config when active session sources are ambiguous", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const sourceRoot = path.join(root, "source");
    await createGitProject(sourceRoot);
    await writeVibe64SourceConfig(sourceRoot, {
      databaseRuntime: "mariadb",
      mergeMethod: "merge",
      projectType: "jskit"
    });
    await writeSeededJskitMarkers(sourceRoot);
    await commitAll(sourceRoot, "Commit Vibe64 config");

    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      ...githubProjectRepositoryInput({
        fullName: "example/catalog-app"
      }),
      slug: "catalog-app"
    });
    const projectRoot = path.join(projectsRoot, "catalog-app");
    const runtimeRoot = projectContext.projectRuntimeRootForSlug("catalog-app");
    const recordPath = projectContext.projectRecordPathForSlug("catalog-app");
    const gitCacheRepository = path.join(projectRoot, "git-cache", "repository.git");
    await mkdir(path.dirname(gitCacheRepository), {
      recursive: true
    });
    await execFileAsync("git", ["clone", "--bare", sourceRoot, gitCacheRepository]);
    await writeVibe64SourceConfig(path.join(projectRoot, "sessions", "active", "session-a", "source"), {
      databaseRuntime: "postgres"
    });
    await writeVibe64SourceConfig(path.join(projectRoot, "sessions", "active", "session-b", "source"), {
      databaseRuntime: "none"
    });
    await mkdir(path.join(runtimeRoot, "sessions", "active", "session-a", "metadata"), {
      recursive: true
    });
    await mkdir(path.join(runtimeRoot, "sessions", "active", "session-b", "metadata"), {
      recursive: true
    });
    await writeFile(
      path.join(runtimeRoot, "sessions", "active", "session-a", "metadata", "source_path"),
      `${path.join(projectRoot, "sessions", "active", "session-a", "source")}\n`,
      "utf8"
    );
    await writeFile(
      path.join(runtimeRoot, "sessions", "active", "session-b", "metadata", "source_path"),
      `${path.join(projectRoot, "sessions", "active", "session-b", "source")}\n`,
      "utf8"
    );
    const service = createService({
      projectContext
    });
    const requestContext = {
      projectRecordPath: recordPath,
      projectLocalRoot: runtimeRoot,
      projectRuntimeRoot: runtimeRoot,
      projectsRoot,
      slug: "catalog-app",
      targetRoot: projectRoot
    };

    const runtime = await runWithProjectRequestContext(
      requestContext,
      () => service.createRuntime()
    );
    const creationOptions = await runtime.workflowDefinitionCreationOptions();

    assert.equal(runtime.adapter.id, "jskit");
    assert.equal(runtime.projectConfig.sourceType, "git-cache");
    assert.equal(runtime.projectConfig.values.jskit_database_runtime, "mariadb");
    assert.equal(creationOptions.seedRequired, false);
    assert.equal(creationOptions.mode, "select");
    assert.equal(creationOptions.workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR);
    assert.equal(creationOptions.defaultWorkflowDefinition, VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE);
  });
});

test("Vibe64 project service passes managed and local repository profiles into runtime creation", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const managedProjectRoot = path.join(projectsRoot, "managed-app");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      repository: {
        mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
      },
      slug: "managed-app"
    });
    const managedService = createService({
      projectContext
    });
    const managedRuntime = await runWithProjectRequestContext({
      projectLocalRoot: managedProjectRoot,
      projectRuntimeRoot: managedProjectRoot,
      projectsRoot,
      slug: "managed-app",
      targetRoot: managedProjectRoot
    }, () => managedService.createRuntime({
      skipProjectConfig: true
    }));
    const managedOptions = await managedRuntime.workflowDefinitionCreationOptions();

    assert.equal(managedOptions.workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT);
    assert.equal(managedOptions.defaultWorkflowDefinition, VIBE64_WORKFLOW_DEFINITION_IDS.CANONICAL_GIT_FEATURE);
    assert.equal(
      managedOptions.workflowDefinitions.some((definition) => definition.id === VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE),
      false
    );
    assert.equal(
      managedOptions.workflowDefinitions.some((definition) => definition.id === VIBE64_WORKFLOW_DEFINITION_IDS.CANONICAL_GIT_FEATURE),
      true
    );

    const localRoot = path.join(root, "opened-local-repo");
    await mkdir(localRoot, {
      recursive: true
    });
    const localRuntime = await createService({
      targetRoot: localRoot
    }).createRuntime({
      skipProjectConfig: true
    });
    const localOptions = await localRuntime.workflowDefinitionCreationOptions();

    assert.equal(localOptions.workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE);
    assert.equal(localOptions.defaultWorkflowDefinition, VIBE64_WORKFLOW_DEFINITION_IDS.LOCAL_SOURCE_FEATURE);
    assert.equal(
      localOptions.workflowDefinitions.some((definition) => definition.id === VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE),
      false
    );
    assert.equal(
      localOptions.workflowDefinitions.some((definition) => definition.id === VIBE64_WORKFLOW_DEFINITION_IDS.LOCAL_SOURCE_FEATURE),
      true
    );

    const requestKnownRuntime = await createService({
      targetRoot: localRoot
    }).createRuntime({
      currentProject: {
        applicationMode: PROJECT_APPLICATION_MODE_EXISTING,
        repositoryMode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
      },
      skipProjectConfig: true
    });
    const requestKnownOptions = await requestKnownRuntime.workflowDefinitionCreationOptions();

    assert.equal(requestKnownOptions.initializationRequired, true);
    assert.equal(requestKnownOptions.seedRequired, false);
    assert.equal(requestKnownOptions.workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT);

    const flagBackedService = createService({
      targetRoot: localRoot
    });
    await writeProjectOneOffFlag({
      name: PROJECT_APPLICATION_MODE_ONE_OFF_FLAG,
      projectRuntimeRoot: flagBackedService.currentProjectLocalRoot(),
      value: PROJECT_APPLICATION_MODE_NEW
    });
    const flagBackedRuntime = await flagBackedService.createRuntime({
      currentProject: {
        repositoryMode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      },
      skipProjectConfig: true
    });
    const flagBackedOptions = await flagBackedRuntime.workflowDefinitionCreationOptions();

    assert.equal(flagBackedOptions.initializationRequired, false);
    assert.equal(flagBackedOptions.seedRequired, true);
    assert.equal(flagBackedOptions.workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE);
  });
});

test("Vibe64 project service saves project type and plain-file configuration", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createServiceForTemporaryTarget(targetRoot);
    const stateRoot = service.currentProjectSourceConfigRoot();
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
    let manifest = JSON.parse(await readFile(path.join(stateRoot, "vibe64.project.json"), "utf8"));
    assert.equal(manifest.projectType, "jskit");

    const defaults = await service.readProjectConfigDefaults();
    assert.equal(defaults.ok, true);
    assert.equal(defaults.defaults.defaults.github_pr_merge_method, "merge");
    assert.equal(defaults.defaults.defaults[JSKIT_USER_MODE_CONFIG], JSKIT_USER_MODE_USERS);
    assert.equal(defaults.defaults.defaults.jskit_database_runtime, "mariadb");
    assert.deepEqual(defaults.defaults.runtimeLock.selected.tools.map((entry) => entry.id), ["nodejs-26"]);
    assert.deepEqual(defaults.defaults.runtimeLock.selected.services.map((entry) => entry.id), ["mariadb"]);
    const mergeMethodField = defaults.defaults.fields.find((field) => field.id === "github_pr_merge_method");
    const userModeField = defaults.defaults.fields.find((field) => field.id === JSKIT_USER_MODE_CONFIG);
    const databaseRuntimeField = defaults.defaults.fields.find((field) => field.id === "jskit_database_runtime");
    const databaseRuntimeChoice = defaults.defaults.runtimeChoices.find((choice) => choice.configFieldId === "jskit_database_runtime");
    assert.equal(defaults.defaults.fields.some((field) => field.id === "deploy_production_command"), false);
    assert.equal(defaults.defaults.fields.some((field) => field.id === "deploy_staging_command"), false);
    assert.equal(defaults.defaults.fields.some((field) => field.id === "vibe64_app_auth_environment"), false);
    assert.equal(defaults.defaults.fields.some((field) => field.id.startsWith("vibe64_email_")), false);
    assert.equal(mergeMethodField.sectionLabel, "Pull requests");
    assert.equal(mergeMethodField.type, "select");
    assert.deepEqual(mergeMethodField.options.map((option) => option.value), ["merge", "squash", "rebase"]);
    assert.equal(userModeField.label, "User accounts");
    assert.equal(userModeField.sectionLabel, "JSKIT authentication");
    assert.equal(userModeField.required, true);
    assert.deepEqual(userModeField.options.map((option) => option.value), [
      JSKIT_USER_MODE_USERS,
      JSKIT_USER_MODE_NONE
    ]);
    assert.deepEqual(defaults.defaults.fields.map((field) => field.id), [
      "github_pr_merge_method",
      JSKIT_USER_MODE_CONFIG,
      "jskit_database_runtime"
    ]);
    assert.match(databaseRuntimeField.description, /Database service Studio should prepare/u);
    assert.match(databaseRuntimeField.options.find((option) => option.value === "mariadb").description, /MariaDB/u);
    assert.equal(databaseRuntimeChoice.selectedValue, "mariadb");
    assert.equal(databaseRuntimeChoice.selectedPackageId, "mariadb");
    assert.equal(
      databaseRuntimeChoice.options.find((option) => option.value === "mariadb").packageId,
      "mariadb"
    );
    assert.equal(
      databaseRuntimeChoice.options.find((option) => option.value === "postgres").runtimeUnavailable,
      true
    );
    const savedConfig = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "squash",
        jskit_database_runtime: "mariadb"
      }
    });
    assert.equal(savedConfig.ok, true);
    assert.equal(savedConfig.config.ready, true);
    assert.equal(savedConfig.config.values[JSKIT_USER_MODE_CONFIG], JSKIT_USER_MODE_USERS);
    assert.equal(savedConfig.config.values.github_pr_merge_method, "squash");
    manifest = JSON.parse(await readFile(path.join(stateRoot, "vibe64.project.json"), "utf8"));
    assert.equal(manifest.config.github_pr_merge_method, "squash");
    assert.equal(manifest.config.jskit_database_runtime, "mariadb");
    assert.deepEqual(savedConfig.config.runtimeLock.selected.services.map((entry) => entry.id), ["mariadb"]);
    assert.equal(
      savedConfig.config.runtimeChoices.find((choice) => choice.configFieldId === "jskit_database_runtime").selectedPackageId,
      "mariadb"
    );
    const savedManifest = JSON.parse(await readFile(path.join(stateRoot, "vibe64.project.json"), "utf8"));
    assert.equal(savedManifest.config[JSKIT_USER_MODE_CONFIG], JSKIT_USER_MODE_USERS);
    assert.deepEqual(Object.keys(savedManifest.config).sort(), [
      "github_pr_merge_method",
      "jskit_database_runtime",
      JSKIT_USER_MODE_CONFIG
    ]);

    const environment = await service.projectConfigEnvironment();
    assert.equal(environment.VIBE64_PROJECT_MANIFEST, path.join(stateRoot, "vibe64.project.json"));
    assert.equal(environment.VIBE64_CONFIG_LOCAL_DIR, path.join(localRoot, "runtime-config"));
    assert.equal(environment.VIBE64_CONFIG_SH, path.join(localRoot, "runtime", "vibe64-config.sh"));

    const pendingSessionType = await service.readProjectType({
      sessionId: "pending-session-source"
    });
    assert.equal(pendingSessionType.ok, true);
    assert.equal(pendingSessionType.projectType.ready, true);
    assert.equal(pendingSessionType.projectType.projectType, "jskit");
    assert.equal(pendingSessionType.projectType.sourceRoot, targetRoot);

    const pendingSessionRequestType = await runWithProjectRequestContext({
      sourceRoot: path.join(path.dirname(targetRoot), "missing-session-source"),
      targetRoot
    }, () => service.readProjectType({
      sessionId: "pending-session-source"
    }));
    assert.equal(pendingSessionRequestType.ok, true);
    assert.equal(pendingSessionRequestType.projectType.ready, true);
    assert.equal(pendingSessionRequestType.projectType.sourceRoot, targetRoot);

    const pendingSessionConfig = await service.readProjectConfig({
      sessionId: "pending-session-source"
    });
    assert.equal(pendingSessionConfig.ok, true);
    assert.equal(pendingSessionConfig.config.ready, true);
    assert.equal(pendingSessionConfig.config.values.jskit_database_runtime, "mariadb");

    const runtime = await service.createRuntime();
    assert.equal(runtime.adapter.id, "jskit");
    assert.equal(runtime.projectConfig.values.jskit_database_runtime, "mariadb");
  });
});

test("Vibe64 project config exposes only the user-account decision", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      targetRoot
    });
    await service.saveProjectType({
      projectType: "jskit"
    });

    const usersConfig = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mariadb",
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS
      }
    });
    assert.equal(usersConfig.ok, true);
    assert.equal(usersConfig.config.ready, true);
    assert.equal(usersConfig.config.values[JSKIT_USER_MODE_CONFIG], JSKIT_USER_MODE_USERS);

    const publicConfig = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none",
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_NONE
      }
    });
    assert.equal(publicConfig.ok, true);
    assert.equal(publicConfig.config.ready, true);
    assert.equal(publicConfig.config.values[JSKIT_USER_MODE_CONFIG], JSKIT_USER_MODE_NONE);

    const removedProviderConfig = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mariadb",
        jskit_auth_provider: "supabase"
      }
    });
    assert.equal(removedProviderConfig.ok, false);
    assert.equal(removedProviderConfig.errors[0].code, "vibe64_unknown_config_field");
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
    assert.equal(defaults.defaults.defaults.jskit_database_runtime, "mariadb");

    const savedConfig = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mariadb"
      }
    });
    assert.equal(savedConfig.ok, true);
    assert.equal(savedConfig.config.values.github_pr_merge_method, "merge");
    assert.equal(savedConfig.config.values.jskit_database_runtime, "mariadb");
  });
});

test("Vibe64 project service can preview and save config with a draft project type", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      targetRoot
    });
    const stateRoot = service.currentProjectSourceConfigRoot();

    const draftConfig = await service.readProjectConfig({
      projectType: "jskit"
    });
    assert.equal(draftConfig.ok, true);
    assert.equal(draftConfig.config.projectType, "jskit");
    assert.equal(draftConfig.config.adapter.id, "jskit");
    await assert.rejects(
      () => readFile(path.join(stateRoot, "vibe64.project.json"), "utf8"),
      {
        code: "ENOENT"
      }
    );

    const savedConfig = await service.saveProjectConfig({
      projectType: "jskit",
      values: {
        github_pr_merge_method: "rebase",
        jskit_database_runtime: "mariadb"
      }
    });
    assert.equal(savedConfig.ok, true);
    assert.equal(savedConfig.config.ready, true);
    assert.equal(savedConfig.config.projectType, "jskit");
    const draftSavedManifest = JSON.parse(await readFile(path.join(stateRoot, "vibe64.project.json"), "utf8"));
    assert.equal(draftSavedManifest.projectType, "jskit");
    assert.equal(draftSavedManifest.config.github_pr_merge_method, "rebase");
  });
});

test("Vibe64 project Env route inputs keep session source selection", () => {
  const saveResult = projectEnvUserValuesInputValidator.schema.patch({
    environment: "dev",
    sessionId: "session-draft",
    sourcePath: "/workspace/session/source",
    values: {
      OPENAI_API_KEY: {
        secret: true,
        value: "sk-test"
      }
    }
  });
  const materializeResult = projectEnvMaterializeInputValidator.schema.patch({
    environment: "dev",
    sessionId: "session-draft",
    sourcePath: "/workspace/session/source"
  });

  assert.deepEqual(saveResult.errors, {});
  assert.equal(saveResult.validatedObject.sessionId, "session-draft");
  assert.equal(saveResult.validatedObject.sourcePath, "/workspace/session/source");
  assert.deepEqual(materializeResult.errors, {});
  assert.equal(materializeResult.validatedObject.sessionId, "session-draft");
  assert.equal(materializeResult.validatedObject.sourcePath, "/workspace/session/source");
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

test("Vibe64 project service keeps runtime config environment out of raw process env", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      projectRuntimeConfigEnvironmentResolvers: [
        async () => jskitAppAuthEnvironment({
          provider: JSKIT_AUTH_PROVIDER_SUPABASE
        })
      ],
      targetRoot
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await service.saveProjectConfig({
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none"
      }
    });

    const environment = await service.projectConfigEnvironment();
    assert.equal(environment.jskitAppAuth, undefined);

    const runtimeConfig = await service.projectRuntimeConfig();
    assert.equal(runtimeConfig.systemEnvironment.jskitAppAuth.provider, JSKIT_AUTH_PROVIDER_SUPABASE);
  });
});

test("Vibe64 project service resolves and materializes JSKIT dev runtime config", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitProject(targetRoot);
    await writeFile(path.join(targetRoot, ".env"), "STALE=from-user\n", "utf8");
    const service = createServiceForTemporaryTarget(targetRoot, {
      projectRuntimeConfigEnvironmentResolvers: [
        async () => jskitAppAuthEnvironment({
          provider: JSKIT_AUTH_PROVIDER_SUPABASE,
          supabase: {
            publishableKey: "pk_dev",
            url: "https://devref.supabase.co"
          }
        })
      ],
    });
    const worktreePath = await createSessionSourceFixture({
      projectLocalRoot: service.currentProjectLocalRoot(),
      projectSessionSourceRoot: service.currentProjectSessionSourceRoot(),
      sessionId: "runtime-config",
      workTitle: "Runtime config test session"
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await service.saveProjectConfig({
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mariadb"
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
    assert.equal(env.AUTH_DEV_BYPASS_ENABLED, undefined);
    assert.equal(env.AUTH_DEV_BYPASS_SECRET, undefined);
    assert.equal(env.AUTH_DEV_ACCESS_TTL_SECONDS, undefined);
    assert.equal(env.AUTH_DEV_REFRESH_TTL_SECONDS, undefined);
    assert.equal(env.DB_CLIENT, "mysql2");
    assert.equal(env.DB_HOST, "127.0.0.1");
    assert.equal(env.DB_USER, JSKIT_MARIADB_APP_USER);
    assert.equal(env.DB_PASSWORD, runtimeConfig.values.DB_PASSWORD);
    assert.equal(env.AUTH_PROFILE_MODE, undefined);
    assert.equal(env.APP_SHOULD_NOT_IMPORT_ENV, undefined);
    assert.equal(dbPasswordRecord.owner, "vibe64");
    assert.equal(dbPasswordRecord.editable, false);
    assert.equal(dbPasswordRecord.value, "********");
    assert.equal(publishableKeyRecord.owner, "user");
    assert.equal(publishableKeyRecord.editable, true);
    assert.equal(publishableKeyRecord.value, "********");

    const launchEnv = await service.projectRuntimeConfigEnvironment({
      materialize: false,
      sourcePath: worktreePath,
      target: RUNTIME_CONFIG_TARGETS.LAUNCH_TARGET
    });
    assert.equal(launchEnv.AUTH_DEV_BYPASS_ENABLED, undefined);
    assert.equal(launchEnv.AUTH_DEV_BYPASS_SECRET, undefined);
    assert.equal(launchEnv.AUTH_DEV_ACCESS_TTL_SECONDS, undefined);
    assert.equal(launchEnv.AUTH_DEV_REFRESH_TTL_SECONDS, undefined);
    assert.equal(launchEnv.APP_PUBLIC_URL, "http://localhost:3000");
    assert.equal(launchEnv.DB_CLIENT, "mysql2");

    const rootEnv = await readFile(path.join(targetRoot, ".env"), "utf8");
    const worktreeEnv = await readFile(path.join(worktreePath, ".env"), "utf8");
    assert.equal(rootEnv, worktreeEnv);
    assert.match(rootEnv, /# Generated by Vibe64\./u);
    assert.match(rootEnv, /APP_PUBLIC_URL=http:\/\/localhost:3000/u);
    assert.match(rootEnv, /AUTH_PROVIDER=supabase/u);
    assert.match(rootEnv, /AUTH_SUPABASE_URL=https:\/\/devref\.supabase\.co/u);
    assert.match(rootEnv, /AUTH_SUPABASE_PUBLISHABLE_KEY=pk_dev/u);
    assert.doesNotMatch(rootEnv, /AUTH_DEV_BYPASS_/u);
    assert.match(rootEnv, /DB_NAME=target_/u);
    assert.doesNotMatch(rootEnv, /AUTH_PROFILE_MODE/u);

    const prodRuntimeConfig = await service.projectRuntimeConfig({
      scope: "prod"
    });
    assert.equal(prodRuntimeConfig.values.AUTH_DEV_BYPASS_ENABLED, undefined);
    assert.equal(prodRuntimeConfig.values.AUTH_DEV_BYPASS_SECRET, undefined);

    const apiResponse = await service.readEnv({
      environment: "dev"
    });
    assert.equal(Object.hasOwn(apiResponse.env, "systemRecords"), false);
    assert.equal(apiResponse.env.generatedFiles.synced, true);
    assert.match(apiResponse.env.generatedFiles.lastGeneratedAt, /^20/u);
    assert.deepEqual(apiResponse.env.generatedFiles.roots.map((root) => root.rootKind), [
      "project-root"
    ]);
    assert.deepEqual(apiResponse.env.generatedFiles.roots.map((root) => root.label), [
      "Project baseline"
    ]);
    assert.deepEqual(apiResponse.env.generatedFiles.roots.flatMap((root) => root.targets.map((target) => target.status)), [
      "synced"
    ]);
  });
});

test("Vibe64 project service imports unknown generated dotenv values into dev user Env", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitProject(targetRoot);
    const service = createServiceForTemporaryTarget(targetRoot);
    const worktreePath = await createSessionSourceFixture({
      projectLocalRoot: service.currentProjectLocalRoot(),
      projectSessionSourceRoot: service.currentProjectSessionSourceRoot(),
      sessionId: "runtime-config-import"
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await service.saveProjectConfig({
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mariadb"
      }
    });
    await commitAll(targetRoot, "Commit Vibe64 config");
    await writeVibe64SourceConfig(worktreePath, {
      databaseRuntime: "mariadb"
    });

    await service.projectRuntimeConfigEnvironment({
      sourcePath: worktreePath
    });
    await writeFile(path.join(worktreePath, ".env"), [
      await readFile(path.join(worktreePath, ".env"), "utf8"),
      "AUTH_PROFILE_MODE=users",
      "DB_HOST=evil.example",
      "HOME_ASSISTANT_AI_API_KEY=secret-from-package",
      "PACKAGE_DEFINED_URL=https://package.example",
      "VITE_PUBLIC_FLAG=enabled",
      ""
    ].join("\n"), "utf8");

    const env = await service.projectRuntimeConfigEnvironment({
      sourcePath: worktreePath
    });

    assert.equal(env.AUTH_PROVIDER, "local");
    assert.equal(env.AUTH_LOCAL_BACKEND, "db");
    assert.equal(env.AUTH_LOCAL_STORE_DIR, undefined);
    assert.equal(env.AUTH_LOCAL_RECOVERY_DEV_OUTPUT, "log");
    assert.equal(env.DB_HOST, "127.0.0.1");
    assert.equal(env.AUTH_PROFILE_MODE, undefined);
    assert.equal(env.HOME_ASSISTANT_AI_API_KEY, "secret-from-package");
    assert.equal(env.PACKAGE_DEFINED_URL, "https://package.example");
    assert.equal(env.VITE_PUBLIC_FLAG, "enabled");

    const userValues = await readEnvUserValues({
      projectLocalRoot: service.currentProjectLocalRoot()
    });
    const apiKeyRecord = userValues.records.find((record) => record.key === "HOME_ASSISTANT_AI_API_KEY");
    const publicRecord = userValues.records.find((record) => record.key === "VITE_PUBLIC_FLAG");
    assert.equal(apiKeyRecord.value, "secret-from-package");
    assert.equal(apiKeyRecord.secret, true);
    assert.equal(publicRecord.value, "enabled");
    assert.equal(publicRecord.secret, false);
    assert.equal(userValues.records.some((record) => record.key === "AUTH_PROFILE_MODE"), false);
    assert.equal(userValues.records.some((record) => record.key === "DB_HOST" && record.owner === "user"), false);
    const packageUrlRecord = userValues.records.find((record) => record.key === "PACKAGE_DEFINED_URL");
    assert.equal(packageUrlRecord.value, "https://package.example");
    assert.equal(packageUrlRecord.secret, false);

    const rewrittenEnv = await readFile(path.join(worktreePath, ".env"), "utf8");
    assert.match(rewrittenEnv, /AUTH_PROVIDER=local/u);
    assert.match(rewrittenEnv, /AUTH_LOCAL_BACKEND=db/u);
    assert.doesNotMatch(rewrittenEnv, /AUTH_LOCAL_STORE_DIR/u);
    assert.match(rewrittenEnv, /AUTH_LOCAL_RECOVERY_DEV_OUTPUT=log/u);
    assert.match(rewrittenEnv, /DB_HOST=127\.0\.0\.1/u);
    assert.doesNotMatch(rewrittenEnv, /AUTH_PROFILE_MODE/u);
    assert.doesNotMatch(rewrittenEnv, /DB_HOST=evil\.example/u);
    assert.match(rewrittenEnv, /HOME_ASSISTANT_AI_API_KEY=secret-from-package/u);
    assert.match(rewrittenEnv, /PACKAGE_DEFINED_URL=https:\/\/package\.example/u);
    assert.match(rewrittenEnv, /VITE_PUBLIC_FLAG=enabled/u);
  });
});

test("Vibe64 project service derives file auth without secretly enabling a database", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitProject(targetRoot);
    const service = createServiceForTemporaryTarget(targetRoot);
    const worktreePath = await createSessionSourceFixture({
      projectLocalRoot: service.currentProjectLocalRoot(),
      projectSessionSourceRoot: service.currentProjectSessionSourceRoot(),
      sessionId: "runtime-config-local-auth-db"
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await service.saveProjectConfig({
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none"
      }
    });
    await commitAll(targetRoot, "Commit Vibe64 config");
    await writeVibe64SourceConfig(worktreePath, {
      databaseRuntime: "none"
    });

    const env = await service.projectRuntimeConfigEnvironment({
      sourcePath: worktreePath
    });

    assert.equal(env.AUTH_PROVIDER, "local");
    assert.equal(env.AUTH_LOCAL_BACKEND, "file");
    assert.equal(env.AUTH_LOCAL_STORE_DIR, ".jskit/auth");
    assert.equal(env.AUTH_LOCAL_RECOVERY_DEV_OUTPUT, "log");
    assert.equal(env.DB_CLIENT, undefined);
    assert.equal(env.DB_HOST, undefined);
    assert.equal(env.DB_USER, undefined);

    const rewrittenEnv = await readFile(path.join(worktreePath, ".env"), "utf8");
    assert.match(rewrittenEnv, /AUTH_PROVIDER=local/u);
    assert.match(rewrittenEnv, /AUTH_LOCAL_BACKEND=file/u);
    assert.match(rewrittenEnv, /AUTH_LOCAL_STORE_DIR=\.jskit\/auth/u);
    assert.doesNotMatch(rewrittenEnv, /DB_CLIENT/u);
    assert.doesNotMatch(rewrittenEnv, /DB_HOST/u);
  });
});

test("Vibe64 project service Env read does not import unknown active session dotenv values", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitProject(targetRoot);
    const service = createServiceForTemporaryTarget(targetRoot);
    const worktreePath = await createSessionSourceFixture({
      projectLocalRoot: service.currentProjectLocalRoot(),
      projectSessionSourceRoot: service.currentProjectSessionSourceRoot(),
      sessionId: "runtime-config-read"
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await service.saveProjectConfig({
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mariadb"
      }
    });
    await commitAll(targetRoot, "Commit Vibe64 config");
    await writeVibe64SourceConfig(worktreePath, {
      databaseRuntime: "mariadb"
    });

    await service.projectRuntimeConfigEnvironment({
      sourcePath: worktreePath
    });
    await writeFile(path.join(worktreePath, ".env"), [
      await readFile(path.join(worktreePath, ".env"), "utf8"),
      "HOME_ASSISTANT_AI_API_KEY=stale-active-session-value",
      ""
    ].join("\n"), "utf8");

    const apiResponse = await service.readEnv({
      environment: "dev"
    });
    const userValues = await readEnvUserValues({
      projectLocalRoot: service.currentProjectLocalRoot()
    });

    assert.equal(apiResponse.ok, true);
    assert.equal(userValues.records.some((record) => record.key === "HOME_ASSISTANT_AI_API_KEY"), false);
  });
});

test("Vibe64 project service Env save imports unknown generated dotenv values before rewriting", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitProject(targetRoot);
    const service = createServiceForTemporaryTarget(targetRoot);
    const worktreePath = await createSessionSourceFixture({
      projectLocalRoot: service.currentProjectLocalRoot(),
      projectSessionSourceRoot: service.currentProjectSessionSourceRoot(),
      sessionId: "runtime-config-save"
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await service.saveProjectConfig({
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mariadb"
      }
    });
    await commitAll(targetRoot, "Commit Vibe64 config");
    await writeVibe64SourceConfig(worktreePath, {
      databaseRuntime: "mariadb"
    });

    await service.projectRuntimeConfigEnvironment({
      sourcePath: worktreePath
    });
    await writeFile(path.join(worktreePath, ".env"), [
      await readFile(path.join(worktreePath, ".env"), "utf8"),
      "HOME_ASSISTANT_AI_API_KEY=package-written-secret",
      ""
    ].join("\n"), "utf8");

    const saved = await service.saveEnvUserValues({
      environment: "dev",
      sessionId: "runtime-config-save",
      values: {
        VITE_VISIBLE_FLAG: "yes"
      }
    });
    const userValues = await readEnvUserValues({
      projectLocalRoot: service.currentProjectLocalRoot()
    });
    const rewrittenEnv = await readFile(path.join(worktreePath, ".env"), "utf8");

    assert.equal(saved.ok, true);
    assert.equal(userValues.records.find((record) => record.key === "HOME_ASSISTANT_AI_API_KEY")?.value, "package-written-secret");
    assert.equal(userValues.records.find((record) => record.key === "VITE_VISIBLE_FLAG")?.value, "yes");
    assert.match(rewrittenEnv, /HOME_ASSISTANT_AI_API_KEY=package-written-secret/u);
    assert.match(rewrittenEnv, /VITE_VISIBLE_FLAG=yes/u);
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
      ...githubProjectRepositoryInput({
        fullName: "example/catalog-app"
      }),
      slug: "catalog-app"
    });
    const targetRoot = path.join(projectsRoot, "catalog-app");
    const projectLocalRoot = projectContext.projectLocalRootForTarget(targetRoot);
    const sourceConfigRoot = projectContext.sourceConfigRootForTarget(targetRoot);
    const projectSessionSourceRoot = projectContext.projectSessionSourceRootForTarget(targetRoot);
    const sessionSourcePath = await createSessionSourceFixture({
      projectLocalRoot,
      projectSessionSourceRoot,
      sessionId: "runtime-config"
    });
    await writeFile(path.join(targetRoot, ".env"), "STALE=from-project-home\n", "utf8");
    const service = createService({
      projectRuntimeConfigEnvironmentResolvers: [
        async () => jskitAppAuthEnvironment({
          provider: JSKIT_AUTH_PROVIDER_SUPABASE,
          supabase: {
            publishableKey: "pk_dev",
            url: "https://devref.supabase.co"
          }
        })
      ],
      projectContext
    });
    const requestContext = {
      projectLocalRoot,
      sourceConfigRoot,
      projectSessionSourceRoot,
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
          [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
          github_pr_merge_method: "merge",
          jskit_database_runtime: "mariadb"
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

      const apiResponse = await service.readEnv({
        environment: "dev",
        sessionId: "runtime-config"
      });
      assert.equal(apiResponse.env.generatedFiles.synced, true);
      assert.equal(apiResponse.env.configSource.label, "Session draft");
      assert.deepEqual(apiResponse.env.generatedFiles.roots.map((syncRoot) => syncRoot.rootKind), [
        "session-source"
      ]);
      assert.deepEqual(apiResponse.env.generatedFiles.roots.map((syncRoot) => syncRoot.path), [
        sessionSourcePath
      ]);
    });
  });
});

test("Vibe64 project service saves user-owned Env values and redacts API responses", async () => {
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
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none"
      }
    });
    await commitAll(targetRoot, "Commit Vibe64 config");

    const saved = await service.saveEnvUserValues({
      environment: "dev",
      values: {
        OPENAI_API_KEY: {
          secret: true,
          value: "sk-test"
        }
      }
    });
    const savedRecord = saved.env.records.find((record) => record.key === "OPENAI_API_KEY");
    assert.equal(saved.ok, true);
    assert.equal(savedRecord.source, "user");
    assert.equal(savedRecord.value, "********");
    assert.equal(savedRecord.secret, true);
    assert.equal(savedRecord.valuePresent, true);

    const apiResponse = await service.readEnv({
      environment: "dev"
    });
    const apiRecord = apiResponse.env.records.find((record) => record.key === "OPENAI_API_KEY");
    assert.equal(apiResponse.ok, true);
    assert.equal(apiRecord.value, "********");
    assert.deepEqual(apiRecord.requiredFor, []);

    const env = await service.projectRuntimeConfigEnvironment({
      materialize: false,
      phase: RUNTIME_CONFIG_PHASES.PREVIEW
    });
    assert.equal(env.OPENAI_API_KEY, "sk-test");
  });
});

test("Vibe64 project service rejects user edits for Vibe64-owned Env values", async () => {
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
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mariadb"
      }
    });
    await commitAll(targetRoot, "Commit Vibe64 config");

    const blocked = await service.saveEnvUserValues({
      environment: "dev",
      values: {
        DB_PASSWORD: {
          secret: true,
          value: "user-password"
        }
      }
    });

    const runtimeConfig = await service.projectRuntimeConfig();
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errors[0].code, "vibe64_env_value_not_editable");
    assert.equal(runtimeConfig.values.DB_PASSWORD, jskitMariaDbAppPassword(targetRoot, {
      serviceDataRoot: service.currentServiceDataRoot()
    }));
  });
});

test("Vibe64 project service rejects Vibe64-reserved user Env keys", async () => {
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
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none"
      }
    });
    await commitAll(targetRoot, "Commit Vibe64 config");

    const blocked = await service.saveEnvUserValues({
      environment: "dev",
      values: {
        VIBE64_DEPLOYMENT_PUBLIC_URL: {
          secret: false,
          value: "https://example.invalid"
        }
      }
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.errors[0].code, "vibe64_env_reserved_key");
    const userValues = await readEnvUserValues({
      projectLocalRoot: targetRoot
    });
    assert.equal(userValues.records.some((record) => record.key === "VIBE64_DEPLOYMENT_PUBLIC_URL"), false);
  });
});

test("Vibe64 project service accepts the declared Vibe64 Online development Env", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      ...githubProjectRepositoryInput({
        fullName: "example/vibe64-online"
      }),
      slug: "vibe64-online"
    });
    const targetRoot = path.join(projectsRoot, "vibe64-online");
    const projectLocalRoot = projectContext.projectLocalRootForTarget(targetRoot);
    const projectSessionSourceRoot = projectContext.projectSessionSourceRootForTarget(targetRoot);
    const sourceRoot = await createSessionSourceFixture({
      projectLocalRoot,
      projectSessionSourceRoot,
      sessionId: "online-env"
    });
    await writePackageJson(sourceRoot, {
      name: "vibe64-online",
      scripts: {
        dev: "node ./bin/vibe64-online.js dev"
      }
    });
    const requestContext = {
      projectLocalRoot,
      projectRecordPath: projectContext.projectRecordPathForTarget(targetRoot),
      projectSessionSourceRoot,
      projectsRoot,
      slug: "vibe64-online",
      targetRoot
    };
    const service = createService({
      projectContext
    });

    await runWithProjectRequestContext(requestContext, () => service.saveProjectConfig({
      projectType: "node-web",
      sessionId: "online-env",
      values: {
        github_pr_merge_method: "merge",
        [GENERIC_NODE_WEB_CLIENT_LIBRARY_CONFIG]: "auto"
      }
    }));

    await assert.rejects(
      () => runWithProjectRequestContext(requestContext, () => service.projectRuntimeConfigEnvironment({
        materialize: false,
        phase: RUNTIME_CONFIG_PHASES.DEPLOY,
        sessionId: "online-env",
        sourcePath: sourceRoot,
        target: RUNTIME_CONFIG_TARGETS.COMMAND
      })),
      (error) => {
        assert.equal(error.code, "vibe64_runtime_config_missing");
        assert.match(error.message, /VIBE64_PUBLIC_SOURCE_ROOT/u);
        return true;
      }
    );

    const publicSourceRoot = "/var/lib/vibe64/merc/projects/vibe64/sessions/selected/source";
    const saved = await runWithProjectRequestContext(requestContext, () => service.saveEnvUserValues({
      environment: "dev",
      sessionId: "online-env",
      sourcePath: sourceRoot,
      values: {
        [VIBE64_PUBLIC_SOURCE_ROOT_ENV]: publicSourceRoot
      }
    }));
    const previewEnv = await runWithProjectRequestContext(requestContext, () => service.projectRuntimeConfigEnvironment({
      materialize: false,
      phase: RUNTIME_CONFIG_PHASES.PREVIEW,
      sessionId: "online-env",
      sourcePath: sourceRoot,
      target: RUNTIME_CONFIG_TARGETS.LAUNCH_TARGET
    }));
    const productionSave = await runWithProjectRequestContext(requestContext, () => service.saveEnvUserValues({
      environment: "prod",
      sessionId: "online-env",
      sourcePath: sourceRoot,
      values: {
        [VIBE64_PUBLIC_SOURCE_ROOT_ENV]: publicSourceRoot
      }
    }));

    assert.equal(saved.ok, true);
    assert.equal(previewEnv[VIBE64_PUBLIC_SOURCE_ROOT_ENV], publicSourceRoot);
    assert.equal(productionSave.ok, false);
    assert.equal(productionSave.errors[0].code, "vibe64_env_reserved_key");
  });
});

test("Vibe64 project service rejects adapter-reserved user Env keys", async () => {
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
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none"
      }
    });
    await commitAll(targetRoot, "Commit Vibe64 config");

    const blocked = await service.saveEnvUserValues({
      environment: "dev",
      values: {
        AUTH_PROFILE_MODE: {
          secret: false,
          value: "users"
        }
      }
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.errors[0].code, "vibe64_env_reserved_key");
    const userValues = await readEnvUserValues({
      projectLocalRoot: service.currentProjectLocalRoot()
    });
    assert.equal(userValues.records.some((record) => record.key === "AUTH_PROFILE_MODE"), false);
  });
});

test("Vibe64 project service lets installed providers own editable Runtime Config values", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitProject(targetRoot);
    await writeSeededJskitMarkers(targetRoot, {
      installedPackages: {
        [JSKIT_AUTH_PROVIDER_SUPABASE_PACKAGE]: {
          options: {}
        }
      }
    });
    const service = createService({
      targetRoot
    });

    await service.saveProjectType({
      projectType: "jskit"
    });
    await service.saveProjectConfig({
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none"
      }
    });
    await commitAll(targetRoot, "Commit Vibe64 config");

    const saved = await service.saveEnvUserValues({
      environment: "dev",
      values: {
        AUTH_SUPABASE_URL: {
          secret: false,
          value: "https://override.supabase.co"
        }
      }
    });

    assert.equal(saved.ok, true);
    const userValues = await readEnvUserValues({
      projectLocalRoot: service.currentProjectLocalRoot()
    });
    assert.equal(
      userValues.records.find((record) => record.key === "AUTH_SUPABASE_URL")?.value,
      "https://override.supabase.co"
    );
    const env = await service.projectRuntimeConfigEnvironment({
      materialize: false
    });
    assert.equal(env.AUTH_PROVIDER, JSKIT_AUTH_PROVIDER_SUPABASE);
    assert.equal(env.AUTH_SUPABASE_URL, "https://override.supabase.co");
  });
});

test("Vibe64 project service rejects secret Env values with adapter-public prefixes", async () => {
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
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none"
      }
    });
    await commitAll(targetRoot, "Commit Vibe64 config");

    const blocked = await service.saveEnvUserValues({
      environment: "dev",
      values: {
        VITE_PUBLIC_API_KEY: {
          secret: true,
          value: "visible"
        }
      }
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.errors[0].code, "vibe64_env_public_secret_not_allowed");
  });
});

test("Vibe64 project service runs best-effort hooks after project config saves", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const hookCalls = [];
    const service = createService({
      projectConfigSavedHooks: [
        async ({ projectConfig, targetRoot: hookTargetRoot }) => {
          hookCalls.push({
            userMode: projectConfig.values[JSKIT_USER_MODE_CONFIG],
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
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none"
      }
    });

    assert.equal(saved.ok, true);
    assert.deepEqual(hookCalls, [
      {
        userMode: JSKIT_USER_MODE_USERS,
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
    const stateRoot = service.currentProjectSourceConfigRoot();

    await service.saveProjectType({
      projectType: "jskit"
    });
    await writeFile(path.join(stateRoot, "vibe64.project.json"), `${JSON.stringify({
      schema: "vibe64.project",
      schemaVersion: 1,
      projectType: "jskit",
      config: {
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mariadb",
        [JSKIT_USER_MODE_CONFIG]: "sometimes"
      }
    }, null, 2)}\n`, "utf8");

    const config = await service.readProjectConfig();
    assert.equal(config.ok, true);
    assert.equal(config.config.ready, false);
    assert.equal(config.config.values[JSKIT_USER_MODE_CONFIG], JSKIT_USER_MODE_USERS);
    assert.deepEqual(config.config.invalid, [
      {
        code: "vibe64_invalid_select_config",
        fieldId: JSKIT_USER_MODE_CONFIG,
        filePath: path.join(stateRoot, "vibe64.project.json"),
        message: "Config jskit_users must be one of: users, none.",
        rawValue: "sometimes"
      }
    ]);
  });
});
