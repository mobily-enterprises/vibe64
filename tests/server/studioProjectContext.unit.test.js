import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  PROJECT_SLUG_MAX_LENGTH,
  createStudioProjectContext,
  normalizeProjectSlug,
  projectSlugFromName,
  resolveProjectContextRoot,
} from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  projectRepositoryView
} from "../../packages/vibe64-core/src/server/projectRepository.js";
import {
  resolveProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  writeProjectRuntimeOpenState
} from "../../packages/vibe64-core/src/server/projectRuntimeOpenState.js";
import {
  resolveVibe64Roots
} from "../../packages/vibe64-core/src/server/studioRoots.js";
import {
  createService as createProjectService
} from "../../packages/vibe64-project/src/server/service.js";

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

async function fileDigest(filePath) {
  try {
    return createHash("sha256").update(await readFile(filePath)).digest("hex");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function legacyCheckoutSnapshot(projectRoot) {
  const snapshotPaths = [
    ".git/HEAD",
    ".git/MERGE_HEAD",
    ".git/config",
    ".git/index",
    ".gitmodules",
    "app.txt",
    "draft.txt",
    "sessions/active/open-session/source/session.txt",
    "sessions/blocked/blocked-session/metadata/status",
    "sessions/archived/archived-session/archive.json"
  ];
  return {
    branch: await gitOutput(projectRoot, ["branch", "--show-current"]),
    files: Object.fromEntries(await Promise.all(snapshotPaths.map(async (relativePath) => [
      relativePath,
      await fileDigest(path.join(projectRoot, relativePath))
    ]))),
    head: await gitOutput(projectRoot, ["rev-parse", "HEAD"]),
    rootEntries: (await readdir(projectRoot)).sort(),
    status: await gitOutput(projectRoot, ["status", "--porcelain=v2", "--branch", "--untracked-files=all"]),
    worktrees: await gitOutput(projectRoot, ["worktree", "list", "--porcelain"])
  };
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

test("hosted project creation rejects local-source metadata without creating state", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });

    await assert.rejects(() => context.createWorkspaceProjectRecord({
      repository: {
        mode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      },
      slug: "whs"
    }), {
      code: "vibe64_hosted_local_source_unsupported"
    });

    await assert.rejects(() => access(path.join(projectsRoot, "whs")), {
      code: "ENOENT"
    });
    await assert.rejects(() => access(context.projectRuntimeRootForSlug("whs")), {
      code: "ENOENT"
    });
  });
});

test("Studio project context refuses to adopt a pre-existing source folder", async () => {
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
    await assert.rejects(() => context.createWorkspaceProjectRecord({
      repository: {
        mode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      },
      slug: "legacy-app"
    }), {
      code: "vibe64_project_slug_exists"
    });

    assert.equal(await gitOutput(projectRoot, ["branch", "--show-current"]), "trunk");
    assert.equal(
      await gitOutput(projectRoot, ["rev-parse", "--verify", "HEAD"]),
      trunkCommit
    );
    assert.equal(await readFile(path.join(projectRoot, "README.md"), "utf8"), "Legacy project\n");
    await assert.rejects(() => access(context.projectRecordPathForSlug("legacy-app")), {
      code: "ENOENT"
    });
  });
});

test("Studio project context refuses a slug with stale runtime state", async () => {
  await withTemporaryRoot(async (root) => {
    const context = createStudioProjectContext({
      explicitProjectsRoot: path.join(root, "projects"),
      env: {},
      home: root
    });
    const runtimeRoot = context.projectRuntimeRootForSlug("stale-app");
    await writeTestFile(path.join(runtimeRoot, "sessions", "active", "old-session", "session.json"), "{}\n");

    await assert.rejects(
      () => context.createWorkspaceProjectRecord({
        slug: "stale-app"
      }),
      {
        code: "vibe64_project_slug_exists"
      }
    );
    assert.equal(
      await readFile(path.join(runtimeRoot, "sessions", "active", "old-session", "session.json"), "utf8"),
      "{}\n"
    );
    await assert.rejects(() => access(path.join(context.projectsRoot, "stale-app")), {
      code: "ENOENT"
    });
  });
});

test("Studio project context reserves a project slug atomically", async () => {
  await withTemporaryRoot(async (root) => {
    const context = createStudioProjectContext({
      explicitProjectsRoot: path.join(root, "projects"),
      env: {},
      home: root
    });

    const attempts = await Promise.allSettled([
      context.createWorkspaceProjectRecord({ slug: "one-winner" }),
      context.createWorkspaceProjectRecord({ slug: "one-winner" })
    ]);

    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = attempts.find((result) => result.status === "rejected");
    assert.equal(rejected.reason.code, "vibe64_project_slug_exists");
    await access(path.join(context.projectsRoot, "one-winner"));
    await access(context.projectRecordPathForSlug("one-winner"));
  });
});

test("hosted project updates reject local-source metadata without changing the namespace", async () => {
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

    await assert.rejects(() => context.updateWorkspaceProjectMetadata({
      repository: {
        mode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      },
      slug: "converted-app"
    }), {
      code: "vibe64_hosted_local_source_unsupported"
    });

    const projectContextRoot = path.join(projectsRoot, "converted-app");
    const unchanged = await context.readWorkspaceProject({
      slug: "converted-app"
    });
    assert.equal(unchanged.project.repositoryMode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
    await assert.rejects(() => access(path.join(projectContextRoot, ".git")), {
      code: "ENOENT"
    });
  });
});

test("hosted project readers reject stored local-source metadata without repairing it", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await context.createWorkspaceProjectRecord({
      slug: "retired-local-source"
    });
    const projectContextRoot = path.join(projectsRoot, "retired-local-source");
    const recordPath = context.projectRecordPathForSlug("retired-local-source");
    const current = JSON.parse(await readFile(recordPath, "utf8"));
    const retired = `${JSON.stringify({
      ...current,
      repository: {
        defaultBranch: "main",
        mode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      }
    }, null, 2)}\n`;
    await writeFile(recordPath, retired, "utf8");
    await mkdir(path.join(projectContextRoot, ".git"));
    await writeFile(path.join(projectContextRoot, ".git", "namespace-marker"), "do not inspect\n", "utf8");

    for (const operation of [
      () => context.readWorkspaceProject({ slug: "retired-local-source" }),
      () => context.readWorkspaceProjectState({ slug: "retired-local-source" }),
      () => context.listWorkspaceProjects(),
      () => context.beginWorkspaceProjectDeletion({ slug: "retired-local-source" })
    ]) {
      await assert.rejects(operation, {
        code: "vibe64_hosted_local_source_unsupported"
      });
    }
    assert.equal(await readFile(recordPath, "utf8"), retired);
    assert.equal(
      await readFile(path.join(projectContextRoot, ".git", "namespace-marker"), "utf8"),
      "do not inspect\n"
    );
  });
});

test("hosted project access leaves every legacy root-checkout state inert", async (t) => {
  await withTemporaryRoot(async (root) => {
    const authorityRoot = path.join(root, "authority.git");
    const seedRoot = path.join(root, "authority-seed");
    const projectsRoot = path.join(root, "projects");
    await runGit(root, ["init", "--bare", "--initial-branch=main", authorityRoot]);
    await createGitProject(seedRoot);
    await runGit(seedRoot, ["config", "user.email", "vibe64-test@example.invalid"]);
    await runGit(seedRoot, ["config", "user.name", "Vibe64 Test"]);
    await runGit(seedRoot, ["branch", "-M", "main"]);
    await writeTestFile(path.join(seedRoot, "app.txt"), "base\n");
    await runGit(seedRoot, ["add", "app.txt"]);
    await runGit(seedRoot, ["commit", "-m", "base"]);
    const baseCommit = await gitOutput(seedRoot, ["rev-parse", "HEAD"]);
    await writeTestFile(path.join(seedRoot, "app.txt"), "authority current\n");
    await runGit(seedRoot, ["add", "app.txt"]);
    await runGit(seedRoot, ["commit", "-m", "authority current"]);
    const authorityCommit = await gitOutput(seedRoot, ["rev-parse", "HEAD"]);
    await runGit(seedRoot, ["remote", "add", "origin", authorityRoot]);
    await runGit(seedRoot, ["push", "-u", "origin", "main"]);

    const scenarios = [
      {
        name: "clean and equal",
        verify(snapshot) {
          assert.match(snapshot.status, /# branch\.ab \+0 -0/u);
        }
      },
      {
        name: "clean and behind",
        async prepare(projectRoot) {
          await runGit(projectRoot, ["reset", "--hard", baseCommit]);
        },
        verify(snapshot) {
          assert.match(snapshot.status, /# branch\.ab \+0 -1/u);
        }
      },
      {
        name: "clean and ahead",
        async prepare(projectRoot) {
          await writeTestFile(path.join(projectRoot, "ahead.txt"), "local ahead\n");
          await runGit(projectRoot, ["add", "ahead.txt"]);
          await runGit(projectRoot, ["commit", "-m", "local ahead"]);
        },
        verify(snapshot) {
          assert.match(snapshot.status, /# branch\.ab \+1 -0/u);
        }
      },
      {
        name: "clean and diverged",
        async prepare(projectRoot) {
          await runGit(projectRoot, ["reset", "--hard", baseCommit]);
          await writeTestFile(path.join(projectRoot, "diverged.txt"), "local divergence\n");
          await runGit(projectRoot, ["add", "diverged.txt"]);
          await runGit(projectRoot, ["commit", "-m", "local divergence"]);
        },
        verify(snapshot) {
          assert.match(snapshot.status, /# branch\.ab \+1 -1/u);
        }
      },
      {
        name: "dirty tracked and untracked files",
        async prepare(projectRoot) {
          await writeTestFile(path.join(projectRoot, "app.txt"), "dirty tracked\n");
          await writeTestFile(path.join(projectRoot, "draft.txt"), "dirty untracked\n");
        },
        verify(snapshot) {
          assert.match(snapshot.status, /1 \.M/u);
          assert.match(snapshot.status, /\? draft\.txt/u);
        }
      },
      {
        name: "detached unfinished checkout with a submodule and linked worktree",
        async prepare(projectRoot) {
          await writeTestFile(path.join(projectRoot, ".gitmodules"), [
            "[submodule \"vendor/example\"]",
            "\tpath = vendor/example",
            `\turl = ${authorityRoot}`,
            ""
          ].join("\n"));
          await runGit(projectRoot, ["add", ".gitmodules"]);
          await runGit(projectRoot, ["update-index", "--add", "--cacheinfo", `160000,${baseCommit},vendor/example`]);
          await runGit(projectRoot, ["commit", "-m", "record submodule"]);
          await runGit(projectRoot, ["worktree", "add", "--detach", path.join(root, "linked-worktrees", "legacy"), "HEAD"]);
          await runGit(projectRoot, ["checkout", "--detach", "HEAD"]);
          await writeTestFile(path.join(projectRoot, ".git", "MERGE_HEAD"), `${baseCommit}\n`);
        },
        verify(snapshot) {
          assert.equal(snapshot.branch, "");
          assert.match(snapshot.status, /# branch\.head \(detached\)/u);
          assert.notEqual(snapshot.files[".git/MERGE_HEAD"], null);
          assert.notEqual(snapshot.files[".gitmodules"], null);
          assert.match(snapshot.worktrees, /linked-worktrees\/legacy/u);
        }
      }
    ];

    for (const [index, scenario] of scenarios.entries()) {
      await t.test(scenario.name, async () => {
        const slug = `legacy-${index + 1}`;
        const firstContext = createStudioProjectContext({
          explicitProjectsRoot: projectsRoot,
          env: {},
          home: root
        });
        await firstContext.createWorkspaceProjectRecord({
          repository: {
            defaultBranch: "main",
            mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
          },
          slug
        });
        const projectRoot = path.join(projectsRoot, slug);
        await runGit(root, ["clone", authorityRoot, projectRoot]);
        await runGit(projectRoot, ["config", "user.email", "vibe64-test@example.invalid"]);
        await runGit(projectRoot, ["config", "user.name", "Vibe64 Test"]);
        await writeTestFile(path.join(projectRoot, ".git", "info", "exclude"), "sessions/\n");
        await writeTestFile(path.join(projectRoot, "sessions", "active", "open-session", "source", "session.txt"), "active\n");
        await writeTestFile(path.join(projectRoot, "sessions", "blocked", "blocked-session", "metadata", "status"), "blocked\n");
        await writeTestFile(path.join(projectRoot, "sessions", "archived", "archived-session", "archive.json"), "{}\n");
        await scenario.prepare?.(projectRoot);

        const before = await legacyCheckoutSnapshot(projectRoot);
        scenario.verify(before);

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const context = createStudioProjectContext({
            explicitProjectsRoot: projectsRoot,
            env: {},
            home: root
          });
          const listed = await context.listWorkspaceProjects();
          const read = await context.readWorkspaceProject({ slug });
          const state = await context.readWorkspaceProjectState({ slug });
          const selected = await context.selectWorkspaceProject({ slug });
          const requestContext = await resolveProjectRequestContext({
            projectContext: context,
            request: { params: { slug } }
          });

          assert.equal(listed.projects.some((project) => project.slug === slug), true);
          assert.equal(read.project.repositoryMode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
          assert.equal(state.metadata.repository.mode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
          assert.equal(selected.currentProject.slug, slug);
          assert.equal(requestContext.targetRoot, projectRoot);
        }

        assert.deepEqual(await legacyCheckoutSnapshot(projectRoot), before);
        assert.equal(authorityCommit, await gitOutput(authorityRoot, ["rev-parse", "refs/heads/main"]));
      });
    }
  });
});

test("normal hosted access does not recreate an explicitly retired root checkout", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const firstContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await firstContext.createWorkspaceProjectRecord({ slug: "retired-checkout" });
    const projectRoot = path.join(projectsRoot, "retired-checkout");
    await writeTestFile(path.join(projectRoot, ".git", "legacy-marker"), "legacy\n");
    await writeTestFile(path.join(projectRoot, "application.txt"), "retired application\n");
    const sessionMarker = path.join(projectRoot, "sessions", "active", "kept-session", "source", "session.txt");
    await writeTestFile(sessionMarker, "preserved session\n");

    await rm(path.join(projectRoot, ".git"), { recursive: true });
    await rm(path.join(projectRoot, "application.txt"));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const context = createStudioProjectContext({
        explicitProjectsRoot: projectsRoot,
        env: {},
        home: root
      });
      await context.listWorkspaceProjects();
      await context.readWorkspaceProject({ slug: "retired-checkout" });
      await context.readWorkspaceProjectState({ slug: "retired-checkout" });
      await context.selectWorkspaceProject({ slug: "retired-checkout" });
    }

    await assert.rejects(() => access(path.join(projectRoot, ".git")), { code: "ENOENT" });
    await assert.rejects(() => access(path.join(projectRoot, "application.txt")), { code: "ENOENT" });
    assert.equal(await readFile(sessionMarker, "utf8"), "preserved session\n");
    assert.deepEqual((await readdir(projectRoot)).sort(), ["sessions"]);
  });
});

test("project slug contract resolves only canonical Vibe64 project roots", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "vibe64");

    assert.equal(normalizeProjectSlug("app_1-alpha"), "app_1-alpha");
    assert.equal(projectSlugFromName("Example App"), "example-app");
    assert.equal(projectSlugFromName("Example.App"), "example-app");
    assert.equal(resolveProjectContextRoot({
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

test("Studio project listing removes private state whose hosted namespace is gone", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await context.createWorkspaceProjectRecord({
      slug: "removed-project"
    });
    const projectRoot = path.join(projectsRoot, "removed-project");
    const runtimeRoot = context.projectRuntimeRootForSlug("removed-project");
    await writeTestFile(path.join(runtimeRoot, "sessions", "stale.txt"), "stale\n");
    await rm(projectRoot, {
      recursive: true
    });

    const listed = await context.listWorkspaceProjects();

    assert.deepEqual(listed.projects, []);
    await assert.rejects(() => access(runtimeRoot), {
      code: "ENOENT"
    });
    const recreated = await context.createWorkspaceProjectRecord({
      slug: "removed-project"
    });
    assert.equal(recreated.project.slug, "removed-project");
  });
});

for (const selectionSource of ["workspace", "explicit"]) {
  test(`Studio project listing clears a deleted hosted ${selectionSource} selection from the context and public service`, async () => {
    await withTemporaryRoot(async (root) => {
      const projectsRoot = path.join(root, "projects");
      const slug = "removed-selected-project";
      const projectRoot = path.join(projectsRoot, slug);
      const context = createStudioProjectContext({
        explicitManagedSourceRoot: path.join(root, "managed-source"),
        explicitProjectsRoot: projectsRoot,
        explicitSystemRoot: path.join(root, "system"),
        explicitTargetRoot: selectionSource === "explicit" ? projectRoot : "",
        env: {},
        home: root
      });
      const service = createProjectService({ env: {}, projectContext: context });
      await context.createWorkspaceProjectRecord({ slug });
      const selected = selectionSource === "workspace"
        ? await service.selectProject({ slug })
        : await service.listProjects();
      const runtimeRoot = context.projectRuntimeRootForSlug(slug);
      const staleSessionPath = path.join(runtimeRoot, "sessions", "stale.txt");
      assert.equal(selected.ok, true);
      assert.equal(selected.currentProject.path, projectRoot);
      assert.equal(context.targetRoot, projectRoot);
      assert.equal(context.selectionSource, selectionSource);
      await writeTestFile(staleSessionPath, "stale\n");
      await rm(projectRoot, { recursive: true });

      const publicList = await service.listProjects();
      const contextList = await context.listProjects();

      assert.equal(publicList.ok, true);
      assert.equal(publicList.hasSelection, false);
      assert.equal(publicList.currentProject, null);
      assert.equal(publicList.targetRoot, "");
      assert.deepEqual(publicList.projects, []);
      assert.equal(contextList.ok, true);
      assert.equal(contextList.hasSelection, false);
      assert.equal(contextList.currentProject, null);
      assert.equal(contextList.targetRoot, "");
      assert.deepEqual(contextList.projects, []);
      assert.equal(context.targetRoot, "");
      assert.equal(context.selectionSource, "");
      assert.equal(context.selectedProject, null);
      assert.equal(context.hasSelection(), false);
      assert.throws(() => context.requireSelectedTargetRoot(), { code: "vibe64_project_not_selected" });
      await assert.rejects(() => access(runtimeRoot), { code: "ENOENT" });

      const recreated = await service.createProject({ slug });
      assert.equal(recreated.ok, true);
      assert.equal(recreated.currentProject.slug, slug);
      assert.equal(recreated.hasSelection, true);
      assert.equal(context.targetRoot, projectRoot);
      assert.equal(context.selectionSource, "workspace");
      assert.deepEqual(recreated.projects.map((project) => project.slug), [slug]);
      await access(context.projectRecordPathForSlug(slug));
      await assert.rejects(() => access(staleSessionPath), { code: "ENOENT" });
    });
  });
}

test("an older catalog listing cannot retire a newly created and selected project", async (t) => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitManagedSourceRoot: path.join(root, "managed-source"),
      explicitProjectsRoot: projectsRoot,
      explicitSystemRoot: path.join(root, "system"),
      env: {},
      home: root
    });
    await context.createWorkspaceProject({ slug: "earlier-project" });
    await rm(path.join(projectsRoot, "earlier-project"), { recursive: true });
    const captured = Promise.withResolvers();
    const resume = Promise.withResolvers();
    const realReaddir = fs.promises.readdir;
    let holdNextCatalogRead = true;
    const readdirMock = t.mock.method(fs.promises, "readdir", async (...args) => {
      const entries = await realReaddir(...args);
      if (args[0] === projectsRoot && holdNextCatalogRead) {
        holdNextCatalogRead = false;
        captured.resolve(entries);
        await resume.promise;
      }
      return entries;
    });
    syncBuiltinESMExports();
    let earlierListing;
    try {
      earlierListing = context.listProjects();
      assert.deepEqual(await captured.promise, []);
      await context.createWorkspaceProjectRecord({ slug: "newly-selected-project" });
      const selected = await context.selectWorkspaceProject({ slug: "newly-selected-project" });
      const currentTarget = path.join(projectsRoot, "newly-selected-project");
      const currentRecordPath = context.projectRecordPathForSlug("newly-selected-project");
      assert.equal(selected.currentProject.path, currentTarget);
      const currentMetadata = await readFile(currentRecordPath, "utf8");

      resume.resolve();
      await earlierListing;

      assert.equal(context.targetRoot, currentTarget);
      assert.equal(context.selectionSource, "workspace");
      assert.equal(context.hasSelection(), true);
      assert.equal(context.selectedProject.slug, "newly-selected-project");
      assert.equal(await readFile(currentRecordPath, "utf8"), currentMetadata);
      const service = createProjectService({ env: {}, projectContext: context });
      const publicList = await service.listProjects();
      assert.equal(publicList.hasSelection, true);
      assert.equal(publicList.currentProject.path, currentTarget);
      assert.deepEqual(publicList.projects.map((project) => project.slug), ["newly-selected-project"]);
    } finally {
      readdirMock.mock.restore();
      syncBuiltinESMExports();
      resume.resolve();
      await earlierListing?.catch(() => {});
    }
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
    await context.createWorkspaceProjectRecord({ slug: "removed-other-project" });
    await rm(path.join(projectsRoot, "removed-other-project"), { recursive: true });
    const listed = await context.listProjects();
    const service = createProjectService({ env: {}, projectContext: context });
    const publicList = await service.listProjects();

    assert.equal(context.targetRoot, externalTarget);
    assert.equal(context.selectionSource, "explicit");
    assert.equal(context.hasSelection(), true);
    assert.equal(listed.hasSelection, true);
    assert.equal(listed.currentProject.path, externalTarget);
    assert.equal(listed.currentProject.external, true);
    assert.equal(listed.currentProject.slug, "external-app");
    assert.deepEqual(listed.projects, []);
    assert.equal(publicList.ok, true);
    assert.equal(publicList.hasSelection, true);
    assert.equal(publicList.currentProject.path, externalTarget);
    assert.equal(publicList.currentProject.sourceRoot, externalTarget);
    assert.deepEqual(publicList.projects.map((project) => project.path), [externalTarget]);
    await assert.rejects(() => access(context.projectRuntimeRootForSlug("removed-other-project")), { code: "ENOENT" });

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
    assert.ok(context.projectRuntimeRootForTarget(externalTarget).startsWith(path.join(context.systemRoot, "projects", "external-app-")));
    assert.ok(context.projectSessionSourceRootForTarget(externalTarget).startsWith(path.join(managedSourceRoot, "external-app-")));
    assert.equal(requestContext.projectSessionSourceRoot, context.projectSessionSourceRootForTarget(externalTarget));
    await access(requestContext.projectRuntimeRoot);
    await access(requestContext.sourceConfigRoot);

    const nestedSourceTarget = path.join(projectsRoot, "catalog-app", "sessions", "active", "session-1", "source");
    assert.equal(context.sourceConfigRootForTarget(nestedSourceTarget), nestedSourceTarget);
    assert.notEqual(context.projectRuntimeRootForTarget(nestedSourceTarget), path.join(projectsRoot, "catalog-app"));
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
    assert.equal(originListed.currentProject.githubRepository.fullName, "example/origin-target");
    assert.equal(originListed.currentProject.githubRepository.source, undefined);

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
    assert.equal(singleNonOriginListed.currentProject.githubRepository.fullName, "example/single-non-origin-target");
    assert.equal(singleNonOriginListed.currentProject.githubRepository.source, undefined);

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
    assert.equal(ambiguousListed.currentProject.githubRepository, undefined);
  });
});

test("Studio project context does not admit unregistered GitHub folders", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "existing-app");
    await createGitProject(projectRoot, {
      origin: "git@github.com:example/existing-app.git"
    });
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });

    const listed = await context.listWorkspaceProjects();

    assert.deepEqual(listed.projects, []);
    await assert.rejects(() => context.readWorkspaceProject({
      slug: "existing-app"
    }), {
      code: "vibe64_project_repository_missing"
    });
    await assert.rejects(() => access(context.projectRecordPathForSlug("existing-app")), {
      code: "ENOENT"
    });
  });
});

test("Studio project context accepts repository metadata without retired bootstrap state", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "current-app");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    const recordPath = context.projectRecordPathForSlug("current-app");
    const metadata = {
      repository: {
        defaultBranch: "main",
        github: {
          fullName: "example/current-app"
        },
        mode: PROJECT_REPOSITORY_MODE_GITHUB
      }
    };
    await Promise.all([
      mkdir(projectRoot, { recursive: true }),
      writeTestFile(recordPath, `${JSON.stringify(metadata, null, 2)}\n`)
    ]);

    const listed = await context.listWorkspaceProjects();
    const state = await context.readWorkspaceProjectState({
      slug: "current-app"
    });

    assert.deepEqual(listed.projects.map(({ slug }) => slug), ["current-app"]);
    assert.equal(listed.projects[0].githubRepository.fullName, "example/current-app");
    assert.equal(state.metadata.repository.mode, PROJECT_REPOSITORY_MODE_GITHUB);
    assert.equal(state.metadata.repository.defaultBranch, "main");
    assert.equal(state.metadata.repository.github.fullName, "example/current-app");
    assert.deepEqual(JSON.parse(await readFile(recordPath, "utf8")), metadata);
  });
});

test("Studio project context stores the development database scope without replacing repository metadata", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await context.createWorkspaceProjectRecord({
      repository: {
        defaultBranch: "main",
        mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
      },
      slug: "shared-data-app"
    });

    await context.updateWorkspaceProjectMetadata({
      developmentDatabaseScope: "project",
      slug: "shared-data-app"
    });

    const state = await context.readWorkspaceProjectState({
      slug: "shared-data-app"
    });
    const listed = await context.listWorkspaceProjects();
    assert.equal(state.metadata.developmentDatabaseScope, "project");
    assert.equal(state.metadata.repository.mode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
    assert.equal(listed.projects[0].developmentDatabaseScope, "project");
    await assert.rejects(
      () => context.updateWorkspaceProjectMetadata({
        developmentDatabaseScope: "forever",
        slug: "shared-data-app"
      }),
      { code: "vibe64_development_database_scope_invalid" }
    );
  });
});

test("Project repository view reads GitHub metadata only from repository contract", () => {
  const currentView = projectRepositoryView({
    repository: {
      defaultBranch: "main",
      github: {
        fullName: "example/current-app"
      },
      mode: PROJECT_REPOSITORY_MODE_GITHUB
    }
  });

  assert.equal(currentView.repositoryMode, PROJECT_REPOSITORY_MODE_GITHUB);
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
          defaultBranch: "main",
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
        projectRuntimeRoot: runtimeRoot,
        projectSlug: "canonical-app"
      })
    ]);

    const listed = await context.listWorkspaceProjects();

    assert.deepEqual(listed.projects.map((project) => project.slug), ["canonical-app"]);
    assert.equal(listed.projects[0].repositoryMode, PROJECT_REPOSITORY_MODE_GITHUB);
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
      repository: {
        mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT,
        defaultBranch: "main"
      },
      slug: "managed-app"
    });

    assert.equal(created.project.repositoryMode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
    assert.equal(created.project.githubRepository, undefined);

    const listed = await context.listWorkspaceProjects();

    assert.deepEqual(listed.projects.map((project) => project.slug), ["managed-app"]);
    assert.equal(listed.projects[0].repository.mode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
    assert.equal(listed.projects[0].repository.defaultBranch, "main");
    assert.equal(listed.projects[0].repositoryMode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
    assert.equal(listed.projects[0].githubRepository, undefined);

    const read = await context.readWorkspaceProject({
      slug: "managed-app"
    });

    assert.equal(read.project.repositoryMode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
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
    assert.equal(created.project.githubRepository, undefined);

    const recordText = await readFile(context.projectRecordPathForSlug("default-managed-app"), "utf8");
    const record = JSON.parse(recordText);
    assert.deepEqual(record.repository, {
      mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT,
      defaultBranch: "main"
    });
    assert.deepEqual(Object.keys(record), ["repository"]);
  });
});

test("Studio project context discards retired bootstrap metadata while reading current records", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    const projectRoot = path.join(projectsRoot, "retired-state-app");
    const recordPath = context.projectRecordPathForSlug("retired-state-app");
    await Promise.all([
      mkdir(projectRoot, { recursive: true }),
      writeTestFile(recordPath, `${JSON.stringify({
        bootstrap: {
          mode: "new",
          status: "pending"
        },
        repository: {
          defaultBranch: "main",
          mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
        }
      }, null, 2)}\n`)
    ]);

    const read = await context.readWorkspaceProject({
      slug: "retired-state-app"
    });
    const state = await context.readWorkspaceProjectState({
      slug: "retired-state-app"
    });

    assert.equal(read.project.repositoryMode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
    assert.deepEqual(state.metadata, {
      repository: {
        defaultBranch: "main",
        mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
      }
    });
  });
});

test("Studio project context requires catalog metadata in the project record", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "uncataloged-app");
    await writeTestFile(path.join(projectRoot, "unmanaged-source.txt"), "leave this file alone\n");
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

    await assert.rejects(() => resolveProjectRequestContext({
      projectContext: context,
      request: {
        params: {
          slug: "uncataloged-app"
        }
      }
    }), {
      code: "vibe64_project_repository_missing"
    });
    await assert.rejects(() => access(path.join(projectRoot, "project.json")), {
      code: "ENOENT"
    });
    await assert.rejects(() => access(context.projectRecordPathForSlug("uncataloged-app")), {
      code: "ENOENT"
    });
    assert.equal(
      await readFile(path.join(projectRoot, "unmanaged-source.txt"), "utf8"),
      "leave this file alone\n"
    );
  });
});

test("project request context uses registered catalog runtime state", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "direct-app");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      slug: "direct-app"
    });
    const vibe64User = {
      gid: 1001,
      github: {
        login: "owner"
      },
      home: path.join(root, "homes", "owner"),
      role: "owner",
      uid: 1001,
      username: "owner"
    };

    const context = await resolveProjectRequestContext({
      projectContext,
      request: {
        params: {
          slug: "direct-app"
        },
        vibe64User
      }
    });

    assert.equal(context.sourceConfigRoot, "");
    assert.equal(context.sourceRoot, "");
    assert.equal(context.projectRuntimeRoot, projectContext.projectRuntimeRootForSlug("direct-app"));
    assert.equal(context.vibe64User, vibe64User);
    await access(context.projectRuntimeRoot);
    await assert.rejects(() => access(path.join(projectRoot, "state")), {
      code: "ENOENT"
    });
    await assert.rejects(() => access(path.join(projectRoot, "local")), {
      code: "ENOENT"
    });
  });
});


test("local project authority follows the checked-out branch and reports detached HEAD explicitly", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "project");
    await mkdir(targetRoot);
    await runGit(targetRoot, ["init", "--initial-branch=trunk"]);
    await runGit(targetRoot, ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-m", "base"]);
    const context = createStudioProjectContext({ explicitTargetRoot: targetRoot, home: root,
      runtimeProfile: { local: true, mode: "local" } });
    assert.equal((await context.listProjects()).currentProject.repository.defaultBranch, "trunk");
    await runGit(targetRoot, ["checkout", "-b", "topic"]);
    assert.equal((await context.listProjects()).currentProject.repository.defaultBranch, "topic");
    await runGit(targetRoot, ["checkout", "--detach"]);
    assert.equal((await context.listProjects()).currentProject.repository.defaultBranch, "");
  });
});
