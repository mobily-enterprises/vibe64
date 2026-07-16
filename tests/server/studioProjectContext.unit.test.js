import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  PROJECT_SLUG_MAX_LENGTH,
  createStudioProjectContext,
  normalizeProjectSlug,
  projectSlugFromName,
  resolveProjectRoot,
} from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_LOCAL_SOURCE_BRANCH,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE,
  projectRepositoryView
} from "../../packages/vibe64-core/src/server/projectRepository.js";
import {
  resolveProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  PROJECT_APPLICATION_MODE_EXISTING
} from "../../packages/vibe64-core/src/server/projectApplication.js";
import {
  writeProjectRuntimeOpenState
} from "../../packages/vibe64-core/src/server/projectRuntimeOpenState.js";
import {
  resolveVibe64Roots
} from "../../packages/vibe64-core/src/server/studioRoots.js";

const execFileAsync = promisify(execFile);

async function withTemporaryRoot(callback) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-project-context-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

async function writeTestFile(filePath, text = "") {
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

async function runGit(cwd, args = []) {
  await execFileAsync("git", args, {
    cwd
  });
}

async function gitOutput(cwd, args = []) {
  const result = await execFileAsync("git", args, {
    cwd
  });
  return String(result.stdout || "").trim();
}

async function createGitProject(projectRoot, remotes = {}) {
  await mkdir(projectRoot, {
    recursive: true
  });
  await runGit(projectRoot, ["init"]);
  for (const [name, remoteUrl] of Object.entries(remotes)) {
    await runGit(projectRoot, ["remote", "add", name, remoteUrl]);
  }
}

test("Studio project context starts without a selected project when no explicit target is provided", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });

    assert.equal(context.targetRoot, "");
    assert.equal(context.hasSelection(), false);

    const listed = await context.listProjects();
    assert.equal(listed.ok, true);
    assert.equal(listed.hasSelection, false);
    assert.equal(listed.projectsRoot, projectsRoot);
    assert.deepEqual(listed.projects, []);
  });
});

test("Studio project context uses visibly local-editor roots in local mode", async () => {
  await withTemporaryRoot(async (root) => {
    const context = createStudioProjectContext({
      env: {},
      home: root,
      runtimeProfile: {
        local: true,
        mode: "local"
      }
    });

    assert.equal(context.systemRoot, path.join(root, ".local", "state", "vibe64"));
    assert.equal(context.managedSourceRoot, path.join("/var/lib/vibe64", userInfo().username, "projects"));
    assert.equal(resolveVibe64Roots({
      env: {},
      home: root,
      runtimeProfile: {
        local: true,
        mode: "local"
      },
      targetRoot: path.join(root, "target")
    }).projectsRoot, "");
  });
});

test("Studio project context treats local mode as a single selected folder", async () => {
  await withTemporaryRoot(async (root) => {
    const legacyProjectsRoot = path.join(root, "vibe64");
    await writeTestFile(path.join(legacyProjectsRoot, "legacy-app", ".vibe64", "project.json"), `${JSON.stringify({
      githubRepository: {
        fullName: "example/legacy-app"
      }
    })}\n`);
    const targetRoot = path.join(root, "External App");
    await mkdir(targetRoot, {
      recursive: true
    });

    const context = createStudioProjectContext({
      explicitTargetRoot: targetRoot,
      env: {
        VIBE64_PROJECTS_ROOT: legacyProjectsRoot
      },
      home: root,
      runtimeProfile: {
        local: true,
        mode: "local"
      }
    });

    assert.equal(context.projectCatalogEnabled, false);
    assert.equal(context.projectsRoot, "");

    const listed = await context.listProjects();
    assert.equal(listed.ok, true);
    assert.equal(listed.hasSelection, true);
    assert.equal(listed.currentProject.path, targetRoot);
    assert.equal(listed.currentProject.slug, "external-app");
    assert.equal(listed.currentProject.external, true);
    assert.deepEqual(listed.projects.map((project) => project.path), [targetRoot]);

    const workspaceProjects = await context.listWorkspaceProjects();
    assert.equal(workspaceProjects.ok, true);
    assert.deepEqual(workspaceProjects.projects, []);

    const requestContext = await resolveProjectRequestContext({
      projectContext: context,
      request: {
        params: {
          slug: "external-app"
        }
      }
    });
    assert.equal(requestContext.targetRoot, targetRoot);

    await assert.rejects(
      () => resolveProjectRequestContext({
        projectContext: context,
        request: {
          params: {
            slug: "legacy-app"
          }
        }
      }),
      {
        code: "vibe64_project_route_unavailable"
      }
    );
    await assert.rejects(
      () => context.createWorkspaceProjectRecord({
        slug: "new-app"
      }),
      {
        code: "vibe64_project_catalog_unavailable"
      }
    );
    await assert.rejects(
      () => context.selectWorkspaceProject({
        slug: "legacy-app"
      }),
      {
        code: "vibe64_project_catalog_unavailable"
      }
    );
  });
});

test("Studio project context creates and selects workspace project folders under the projects root", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });

    const created = await context.createWorkspaceProject({
      githubRepository: {
        fullName: "example/example-app"
      },
      name: "Example App"
    });
    const expectedTargetRoot = path.join(projectsRoot, "example-app");
    const expectedRuntimeRoot = path.join(context.systemRoot, "projects", "example-app");
    const expectedRecordPath = path.join(expectedRuntimeRoot, "project.json");

    assert.equal(created.hasSelection, true);
    assert.equal(created.targetRoot, expectedTargetRoot);
    assert.equal(context.targetRoot, expectedTargetRoot);
    assert.equal(created.currentProject.slug, "example-app");
    assert.equal(created.currentProject.external, false);
    assert.equal(context.sourceConfigRootForSlug("example-app"), "");
    assert.equal(context.projectLocalRootForSlug("example-app"), expectedRuntimeRoot);
    assert.equal(context.projectRuntimeRootForSlug("example-app"), expectedRuntimeRoot);
    assert.equal(context.projectRecordPathForSlug("example-app"), expectedRecordPath);
    assert.deepEqual(created.projects.map((project) => project.slug), ["example-app"]);
    await access(expectedTargetRoot);
    await access(expectedRecordPath);
    await assert.rejects(
      () => access(path.join(expectedTargetRoot, "project.json")),
      {
        code: "ENOENT"
      }
    );
    await assert.rejects(
      () => access(path.join(expectedTargetRoot, ".gitignore")),
      {
        code: "ENOENT"
      }
    );

    const secondContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    const selected = await secondContext.selectWorkspaceProject({
      slug: "example-app"
    });

    assert.equal(selected.hasSelection, true);
    assert.equal(selected.targetRoot, expectedTargetRoot);
    assert.equal(selected.currentProject.selected, true);
  });
});

test("Studio project context creates local-source projects with a real main branch", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });

    await context.createWorkspaceProjectRecord({
      repository: {
        mode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      },
      slug: "whs"
    });

    const projectRoot = path.join(projectsRoot, "whs");
    assert.equal(await gitOutput(projectRoot, ["branch", "--show-current"]), PROJECT_REPOSITORY_LOCAL_SOURCE_BRANCH);
    assert.match(
      await gitOutput(projectRoot, ["rev-parse", "--verify", `refs/heads/${PROJECT_REPOSITORY_LOCAL_SOURCE_BRANCH}^{commit}`]),
      /^[0-9a-f]{40}$/u
    );
    assert.equal(await gitOutput(projectRoot, ["log", "-1", "--format=%s"]), "Initial commit");
    assert.equal(await gitOutput(projectRoot, ["status", "--short"]), "");
  });
});

test("Studio project context normalizes imported local-source repositories to main", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "legacy-app");
    await mkdir(projectRoot, {
      recursive: true
    });
    await runGit(projectRoot, ["init", "--initial-branch=trunk"]);
    await runGit(projectRoot, ["config", "user.email", "vibe64@example.test"]);
    await runGit(projectRoot, ["config", "user.name", "Vibe64 Test"]);
    await writeFile(path.join(projectRoot, "README.md"), "Legacy project\n", "utf8");
    await runGit(projectRoot, ["add", "-A"]);
    await runGit(projectRoot, ["commit", "-m", "Legacy commit"]);
    const trunkCommit = await gitOutput(projectRoot, ["rev-parse", "--verify", "HEAD"]);

    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await context.createWorkspaceProjectRecord({
      repository: {
        mode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      },
      slug: "legacy-app"
    });

    assert.equal(await gitOutput(projectRoot, ["branch", "--show-current"]), PROJECT_REPOSITORY_LOCAL_SOURCE_BRANCH);
    assert.equal(
      await gitOutput(projectRoot, ["rev-parse", "--verify", `refs/heads/${PROJECT_REPOSITORY_LOCAL_SOURCE_BRANCH}^{commit}`]),
      trunkCommit
    );
    assert.equal(await readFile(path.join(projectRoot, "README.md"), "utf8"), "Legacy project\n");
  });
});

test("Studio project context normalizes projects updated to local-source", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await context.createWorkspaceProjectRecord({
      slug: "converted-app"
    });

    await context.updateWorkspaceProjectMetadata({
      repository: {
        mode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      },
      slug: "converted-app"
    });

    const projectRoot = path.join(projectsRoot, "converted-app");
    assert.equal(await gitOutput(projectRoot, ["branch", "--show-current"]), PROJECT_REPOSITORY_LOCAL_SOURCE_BRANCH);
    assert.match(
      await gitOutput(projectRoot, ["rev-parse", "--verify", `refs/heads/${PROJECT_REPOSITORY_LOCAL_SOURCE_BRANCH}^{commit}`]),
      /^[0-9a-f]{40}$/u
    );
  });
});

test("project slug contract resolves only canonical Vibe64 project roots", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "vibe64");

    assert.equal(normalizeProjectSlug("app_1-alpha"), "app_1-alpha");
    assert.equal(projectSlugFromName("Example App"), "example-app");
    assert.equal(projectSlugFromName("Example.App"), "example-app");
    assert.equal(resolveProjectRoot({
      projectsRoot,
      slug: "app_1-alpha"
    }), path.join(projectsRoot, "app_1-alpha"));

    assert.equal(normalizeProjectSlug("a".repeat(PROJECT_SLUG_MAX_LENGTH)), "a".repeat(PROJECT_SLUG_MAX_LENGTH));

    for (const slug of ["", "Example", "app.dot", "../outside", "/tmp/app", "_hidden", "-dash", "app/slash", "a".repeat(PROJECT_SLUG_MAX_LENGTH + 1)]) {
      assert.throws(
        () => normalizeProjectSlug(slug),
        {
          code: "vibe64_invalid_project_slug"
        },
        `Expected invalid project slug: ${slug}`
      );
    }
  });
});

test("Studio project context lists and creates projects without selecting one", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });

    const created = await context.createWorkspaceProjectRecord({
      repository: {
        github: {
          fullName: "example/beta_2"
        },
        mode: PROJECT_REPOSITORY_MODE_GITHUB
      },
      slug: "beta_2"
    });
    assert.equal(created.ok, true);
    assert.equal(created.project.slug, "beta_2");
    assert.equal(created.project.projectRoot, path.join(projectsRoot, "beta_2"));
    assert.equal(context.targetRoot, "");
    assert.equal(context.hasSelection(), false);

    await context.createWorkspaceProjectRecord({
      repository: {
        github: {
          fullName: "example/alpha"
        },
        mode: PROJECT_REPOSITORY_MODE_GITHUB
      },
      slug: "alpha"
    });
    const listed = await context.listWorkspaceProjects();
    assert.deepEqual(listed.projects.map((project) => project.slug), ["alpha", "beta_2"]);

    const selectionList = await context.listProjects();
    assert.equal(selectionList.projects[0].githubRepository.fullName, "example/alpha");

    await assert.rejects(
      () => context.createWorkspaceProjectRecord({
        slug: "Bad.Slug"
      }),
      {
        code: "vibe64_invalid_project_slug"
      }
    );
  });
});

test("Studio project context accepts explicit targets without treating them as workspace projects", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const managedSourceRoot = path.join(root, "managed-source");
    const externalTarget = path.join(root, "external-app");
    await mkdir(externalTarget, {
      recursive: true
    });

    const context = createStudioProjectContext({
      explicitManagedSourceRoot: managedSourceRoot,
      explicitProjectsRoot: projectsRoot,
      explicitTargetRoot: externalTarget,
      env: {},
      home: root
    });
    const listed = await context.listProjects();

    assert.equal(context.targetRoot, externalTarget);
    assert.equal(listed.hasSelection, true);
    assert.equal(listed.currentProject.path, externalTarget);
    assert.equal(listed.currentProject.external, true);
    assert.equal(listed.currentProject.slug, "external-app");
    assert.deepEqual(listed.projects, []);

    const requestContext = await resolveProjectRequestContext({
      projectContext: context,
      request: {
        params: {
          slug: "external-app"
        }
      }
    });
    assert.equal(requestContext.targetRoot, externalTarget);
    assert.equal(requestContext.sourceConfigRoot, context.sourceConfigRootForTarget(externalTarget));
    assert.equal(context.sourceConfigRootForTarget(externalTarget), externalTarget);
    assert.equal(requestContext.sourceRoot, externalTarget);
    assert.equal(requestContext.sourceConfigRoot, externalTarget);
    assert.ok(context.projectLocalRootForTarget(externalTarget).startsWith(path.join(context.systemRoot, "projects", "external-app-")));
    assert.ok(context.projectSessionSourceRootForTarget(externalTarget).startsWith(path.join(managedSourceRoot, "external-app-")));
    assert.equal(requestContext.projectSessionSourceRoot, context.projectSessionSourceRootForTarget(externalTarget));
    await access(requestContext.projectRuntimeRoot);
    await access(requestContext.sourceConfigRoot);

    const nestedSourceTarget = path.join(projectsRoot, "catalog-app", "sessions", "active", "session-1", "source");
    assert.equal(context.sourceConfigRootForTarget(nestedSourceTarget), nestedSourceTarget);
    assert.notEqual(context.projectLocalRootForTarget(nestedSourceTarget), path.join(projectsRoot, "catalog-app"));
    assert.ok(context.projectSessionSourceRootForTarget(nestedSourceTarget).startsWith(path.join(managedSourceRoot, "source-")));
  });
});

test("explicit local project requests leave source gitignore untouched", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const externalTarget = path.join(root, "external-app");
    const gitignorePath = path.join(externalTarget, ".gitignore");
    await writeTestFile(gitignorePath, "node_modules/\n");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      explicitTargetRoot: externalTarget,
      env: {},
      home: root,
      runtimeProfile: {
        mode: "local-editor"
      }
    });

    await resolveProjectRequestContext({
      projectContext: context,
      request: {
        params: {
          slug: "external-app"
        }
      }
    });

    assert.equal(await readFile(gitignorePath, "utf8"), "node_modules/\n");
  });
});

test("Studio project context resolves GitHub capability from explicit target remotes without guessing", async () => {
  await withTemporaryRoot(async (root) => {
    const originTarget = path.join(root, "origin-target");
    await createGitProject(originTarget, {
      origin: "git@github.com:example/origin-target.git",
      upstream: "git@github.com:other/upstream-target.git"
    });
    const originContext = createStudioProjectContext({
      explicitTargetRoot: originTarget,
      env: {},
      home: root
    });
    const originListed = await originContext.listProjects();
    assert.equal(originListed.currentProject.repositoryMode, PROJECT_REPOSITORY_MODE_LOCAL_SOURCE);
    assert.equal(originListed.currentProject.workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE);
    assert.equal(originListed.currentProject.githubRepository.fullName, "example/origin-target");
    assert.equal(originListed.currentProject.githubRepository.source, "git-remote:origin");

    const singleNonOriginTarget = path.join(root, "single-non-origin-target");
    await createGitProject(singleNonOriginTarget, {
      origin: "ssh://git@example.com/private/repo.git",
      upstream: "https://github.com/example/single-non-origin-target.git"
    });
    const singleNonOriginContext = createStudioProjectContext({
      explicitTargetRoot: singleNonOriginTarget,
      env: {},
      home: root
    });
    const singleNonOriginListed = await singleNonOriginContext.listProjects();
    assert.equal(singleNonOriginListed.currentProject.repositoryMode, PROJECT_REPOSITORY_MODE_LOCAL_SOURCE);
    assert.equal(singleNonOriginListed.currentProject.workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE);
    assert.equal(singleNonOriginListed.currentProject.githubRepository.fullName, "example/single-non-origin-target");
    assert.equal(singleNonOriginListed.currentProject.githubRepository.source, "git-remote:upstream");

    const ambiguousTarget = path.join(root, "ambiguous-target");
    await createGitProject(ambiguousTarget, {
      origin: "ssh://git@example.com/private/repo.git",
      fork: "git@github.com:example/fork-target.git",
      upstream: "https://github.com/example/upstream-target.git"
    });
    const ambiguousContext = createStudioProjectContext({
      explicitTargetRoot: ambiguousTarget,
      env: {},
      home: root
    });
    const ambiguousListed = await ambiguousContext.listProjects();
    assert.equal(ambiguousListed.currentProject.repositoryMode, PROJECT_REPOSITORY_MODE_LOCAL_SOURCE);
    assert.equal(ambiguousListed.currentProject.workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE);
    assert.equal(ambiguousListed.currentProject.githubRepository, undefined);
  });
});

test("Project repository view reads GitHub metadata only from repository contract", () => {
  const currentView = projectRepositoryView({
    repository: {
      github: {
        defaultBranch: "main",
        fullName: "example/current-app",
        source: "project-record"
      },
      mode: PROJECT_REPOSITORY_MODE_GITHUB
    }
  });

  assert.equal(currentView.repositoryMode, PROJECT_REPOSITORY_MODE_GITHUB);
  assert.equal(currentView.workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR);
  assert.equal(currentView.repository.mode, PROJECT_REPOSITORY_MODE_GITHUB);
  assert.equal(currentView.repository.defaultBranch, "main");
  assert.equal(currentView.repository.github.fullName, "example/current-app");
  assert.equal(currentView.githubRepository.fullName, "example/current-app");

  const oldShapeView = projectRepositoryView({
    githubRepository: {
      defaultBranch: "main",
      fullName: "example/legacy-app",
      source: "project-record"
    }
  });

  assert.equal(oldShapeView.repositoryMode, undefined);
  assert.equal(oldShapeView.workflowRepositoryProfile, undefined);
  assert.equal(oldShapeView.repository, undefined);
  assert.equal(oldShapeView.githubRepository, undefined);
});

test("Studio project context rejects empty or escaping project folder names", async () => {
  await withTemporaryRoot(async (root) => {
    const context = createStudioProjectContext({
      explicitProjectsRoot: path.join(root, "projects"),
      env: {},
      home: root
    });

    assert.equal(projectSlugFromName("Example App"), "example-app");
    assert.equal(projectSlugFromName("!!!"), "");
    await assert.rejects(
      () => context.createWorkspaceProject({
        name: "!!!"
      }),
      {
        code: "vibe64_invalid_project_slug"
      }
    );
    await assert.rejects(
      () => context.selectWorkspaceProject({
        slug: "../outside"
      }),
      {
        code: "vibe64_invalid_project_slug"
      }
    );
  });
});

test("Studio project context reads project records and ignores source config as project metadata", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    const projectRoot = path.join(projectsRoot, "canonical-app");
    const recordPath = context.projectRecordPathForSlug("canonical-app");
    const runtimeRoot = context.projectRuntimeRootForSlug("canonical-app");
    await Promise.all([
      writeTestFile(recordPath, `${JSON.stringify({
        repository: {
          github: {
            fullName: "example/canonical-app"
          },
          mode: PROJECT_REPOSITORY_MODE_GITHUB
        }
      }, null, 2)}\n`),
      writeTestFile(path.join(projectRoot, ".vibe64", "project.json"), `${JSON.stringify({
        githubRepository: {
          fullName: "example/wrong-source-config"
        }
      }, null, 2)}\n`),
      writeProjectRuntimeOpenState({
        projectLocalRoot: runtimeRoot,
        projectSlug: "canonical-app",
        targetRoot: projectRoot
      })
    ]);

    const listed = await context.listWorkspaceProjects();

    assert.deepEqual(listed.projects.map((project) => project.slug), ["canonical-app"]);
    assert.equal(listed.projects[0].repositoryMode, PROJECT_REPOSITORY_MODE_GITHUB);
    assert.equal(listed.projects[0].workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR);
    assert.equal(listed.projects[0].githubRepository.fullName, "example/canonical-app");
    assert.equal(listed.projects[0].runtime.open, true);
    assert.equal(listed.projects[0].projectRecordPath, recordPath);
    assert.equal(await readFile(path.join(projectRoot, ".vibe64", "project.json"), "utf8"), `${JSON.stringify({
      githubRepository: {
        fullName: "example/wrong-source-config"
      }
    }, null, 2)}\n`);
  });
});

test("Studio project context lists and reads managed Git catalog records", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });

    const created = await context.createWorkspaceProjectRecord({
      applicationMode: PROJECT_APPLICATION_MODE_EXISTING,
      repository: {
        mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT,
        defaultBranch: "main"
      },
      slug: "managed-app"
    });

    assert.equal(created.project.repositoryMode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
    assert.equal(created.project.applicationMode, PROJECT_APPLICATION_MODE_EXISTING);
    assert.equal(created.project.workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT);
    assert.equal(created.project.githubRepository, undefined);

    const listed = await context.listWorkspaceProjects();

    assert.deepEqual(listed.projects.map((project) => project.slug), ["managed-app"]);
    assert.equal(listed.projects[0].repository.mode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
    assert.equal(listed.projects[0].applicationMode, PROJECT_APPLICATION_MODE_EXISTING);
    assert.equal(listed.projects[0].repository.defaultBranch, "main");
    assert.equal(listed.projects[0].repositoryMode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
    assert.equal(listed.projects[0].workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT);
    assert.equal(listed.projects[0].githubRepository, undefined);

    const read = await context.readWorkspaceProject({
      slug: "managed-app"
    });

    assert.equal(read.project.repositoryMode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
    assert.equal(read.project.applicationMode, PROJECT_APPLICATION_MODE_EXISTING);
    assert.equal(read.project.workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT);
    assert.equal(read.project.githubRepository, undefined);
  });
});

test("Studio project context defaults new catalog records to managed Git metadata", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });

    const created = await context.createWorkspaceProjectRecord({
      slug: "default-managed-app"
    });

    assert.equal(created.project.repositoryMode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
    assert.equal(created.project.workflowRepositoryProfile, WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT);
    assert.equal(created.project.githubRepository, undefined);

    const recordText = await readFile(context.projectRecordPathForSlug("default-managed-app"), "utf8");
    const record = JSON.parse(recordText);
    assert.deepEqual(record, {
      repository: {
        mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT,
        defaultBranch: ""
      }
    });
  });
});

test("Studio project context requires catalog metadata in the project record", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "uncataloged-app");
    await writeTestFile(path.join(projectRoot, "vibe64.project.json"), `${JSON.stringify({
      schema: "vibe64.project",
      schemaVersion: 1,
      projectType: "jskit",
      config: {}
    }, null, 2)}\n`);
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });

    const listed = await context.listWorkspaceProjects();

    assert.deepEqual(listed.projects, []);
    await assert.rejects(() => access(path.join(projectRoot, "project.json")), {
      code: "ENOENT"
    });

    const requestContext = await resolveProjectRequestContext({
      projectContext: context,
      request: {
        params: {
          slug: "uncataloged-app"
        }
      }
    });

    assert.equal(requestContext.sourceConfigRoot, "");
    assert.equal(requestContext.sourceRoot, "");
    assert.equal(requestContext.projectLocalRoot, context.projectLocalRootForSlug("uncataloged-app"));
    assert.equal(requestContext.projectRuntimeRoot, context.projectRuntimeRootForSlug("uncataloged-app"));
    assert.equal(requestContext.projectRecordPath, context.projectRecordPathForSlug("uncataloged-app"));
    await assert.rejects(() => access(path.join(projectRoot, "project.json")), {
      code: "ENOENT"
    });
    await assert.rejects(() => access(requestContext.projectRecordPath), {
      code: "ENOENT"
    });
    const manifest = JSON.parse(await readFile(path.join(projectRoot, "vibe64.project.json"), "utf8"));
    assert.equal(manifest.projectType, "jskit");
  });
});

test("project request context ensures catalog runtime root only", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "direct-app");
    await mkdir(projectRoot, {
      recursive: true
    });
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });

    const context = await resolveProjectRequestContext({
      projectContext,
      request: {
        params: {
          slug: "direct-app"
        }
      }
    });

    assert.equal(context.sourceConfigRoot, "");
    assert.equal(context.sourceRoot, "");
    assert.equal(context.projectLocalRoot, projectContext.projectLocalRootForSlug("direct-app"));
    assert.equal(context.projectRuntimeRoot, projectContext.projectRuntimeRootForSlug("direct-app"));
    await access(context.projectRuntimeRoot);
    await assert.rejects(() => access(path.join(projectRoot, "state")), {
      code: "ENOENT"
    });
    await assert.rejects(() => access(path.join(projectRoot, "local")), {
      code: "ENOENT"
    });
  });
});
