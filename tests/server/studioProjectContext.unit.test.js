import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  resolveProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  resolveVibe64ProviderHomesRoot,
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

    const localBaseRoot = path.join(root, ".local", "share", "vibe64-local-editor");
    assert.equal(context.systemRoot, path.join(localBaseRoot, "state"));
    assert.equal(resolveVibe64Roots({
      env: {},
      home: root,
      runtimeProfile: {
        local: true,
        mode: "local"
      },
      targetRoot: path.join(root, "target")
    }).projectsRoot, "");
    assert.equal(resolveVibe64ProviderHomesRoot({
      env: {},
      home: root,
      runtimeProfile: {
        local: true,
        mode: "local"
      }
    }), path.join(localBaseRoot, "provider-homes"));
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

    assert.equal(created.hasSelection, true);
    assert.equal(created.targetRoot, expectedTargetRoot);
    assert.equal(context.targetRoot, expectedTargetRoot);
    assert.equal(created.currentProject.slug, "example-app");
    assert.equal(created.currentProject.external, false);
    assert.deepEqual(created.projects.map((project) => project.slug), ["example-app"]);
    await access(expectedTargetRoot);

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
      githubRepository: {
        fullName: "example/beta_2"
      },
      slug: "beta_2"
    });
    assert.equal(created.ok, true);
    assert.equal(created.project.slug, "beta_2");
    assert.equal(created.project.projectRoot, path.join(projectsRoot, "beta_2"));
    assert.equal(context.targetRoot, "");
    assert.equal(context.hasSelection(), false);

    await context.createWorkspaceProjectRecord({
      githubRepository: {
        fullName: "example/alpha"
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
    const externalTarget = path.join(root, "external-app");
    await mkdir(externalTarget, {
      recursive: true
    });

    const context = createStudioProjectContext({
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
    assert.equal(requestContext.projectStateRoot, context.projectStateRootForTarget(externalTarget));
    await access(requestContext.projectStateRoot);
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
    assert.equal(ambiguousListed.currentProject.githubRepository, undefined);
  });
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

test("Studio project context reads shared project state and ignores private local state", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    const stateRoot = context.projectStateRootForSlug("canonical-app");
    const localRoot = context.projectLocalRootForSlug("canonical-app");
    await Promise.all([
      writeTestFile(path.join(stateRoot, "project.json"), `${JSON.stringify({
        githubRepository: {
          fullName: "example/canonical-app"
        }
      }, null, 2)}\n`),
      writeTestFile(path.join(stateRoot, "project_type"), "node-web\n"),
      writeTestFile(path.join(localRoot, "project_type"), "jskit\n")
    ]);

    const listed = await context.listWorkspaceProjects();

    assert.deepEqual(listed.projects.map((project) => project.slug), ["canonical-app"]);
    assert.equal(listed.projects[0].githubRepository.fullName, "example/canonical-app");
    assert.equal(await readFile(path.join(stateRoot, "project_type"), "utf8"), "node-web\n");
    assert.equal(await readFile(path.join(localRoot, "project_type"), "utf8"), "jskit\n");
  });
});

test("project request context ensures shared and local roots without migrating private state", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "direct-app");
    await writeTestFile(path.join(projectRoot, ".vibe64-local", "project_type"), "jskit\n");
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

    assert.equal(context.projectStateRoot, projectContext.projectStateRootForSlug("direct-app"));
    assert.equal(context.projectLocalRoot, projectContext.projectLocalRootForSlug("direct-app"));
    await access(context.projectStateRoot);
    await access(context.projectLocalRoot);
    await assert.rejects(() => access(path.join(context.projectStateRoot, "project_type")), {
      code: "ENOENT"
    });
    assert.equal(await readFile(path.join(projectRoot, ".vibe64-local", "project_type"), "utf8"), "jskit\n");
  });
});
