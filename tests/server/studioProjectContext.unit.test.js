import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createStudioProjectContext,
  normalizeWorkspaceSlug,
  projectSlugFromName,
  resolveWorkspaceRoot,
  workspaceSlugFromName
} from "../../packages/vibe64-core/src/server/studioProjectContext.js";

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

test("Studio project context creates and selects managed project folders under the projects root", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });

    const created = await context.createManagedProject({
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
    const selected = await secondContext.selectManagedProject({
      slug: "example-app"
    });

    assert.equal(selected.hasSelection, true);
    assert.equal(selected.targetRoot, expectedTargetRoot);
    assert.equal(selected.currentProject.selected, true);
  });
});

test("workspace slug contract resolves only canonical Vibe64 workspace roots", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "vibe64");

    assert.equal(normalizeWorkspaceSlug("app_1-alpha"), "app_1-alpha");
    assert.equal(workspaceSlugFromName("Example App"), "example-app");
    assert.equal(workspaceSlugFromName("Example.App"), "example-app");
    assert.equal(resolveWorkspaceRoot({
      projectsRoot,
      slug: "app_1-alpha"
    }), path.join(projectsRoot, "app_1-alpha"));

    for (const slug of ["", "Example", "app.dot", "../outside", "/tmp/app", "_hidden", "-dash", "app/slash"]) {
      assert.throws(
        () => normalizeWorkspaceSlug(slug),
        {
          code: "vibe64_invalid_workspace_slug"
        },
        `Expected invalid workspace slug: ${slug}`
      );
    }
  });
});

test("Studio project context lists and creates workspaces without selecting one", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const context = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });

    const created = await context.createManagedWorkspace({
      githubRepository: {
        fullName: "example/beta_2"
      },
      slug: "beta_2"
    });
    assert.equal(created.ok, true);
    assert.equal(created.workspace.slug, "beta_2");
    assert.equal(created.workspace.workspaceRoot, path.join(projectsRoot, "beta_2"));
    assert.equal(context.targetRoot, "");
    assert.equal(context.hasSelection(), false);

    await context.createManagedWorkspace({
      githubRepository: {
        fullName: "example/alpha"
      },
      slug: "alpha"
    });
    const listed = await context.listManagedWorkspaces();
    assert.deepEqual(listed.workspaces.map((workspace) => workspace.slug), ["alpha", "beta_2"]);

    await assert.rejects(
      () => context.createManagedWorkspace({
        slug: "Bad.Slug"
      }),
      {
        code: "vibe64_invalid_workspace_slug"
      }
    );
  });
});

test("Studio project context accepts explicit targets without treating them as managed projects", async () => {
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
    assert.deepEqual(listed.projects, []);
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
      () => context.createManagedProject({
        name: "!!!"
      }),
      {
        code: "vibe64_invalid_project_slug"
      }
    );
    await assert.rejects(
      () => context.selectManagedProject({
        slug: "../outside"
      }),
      {
        code: "vibe64_invalid_project_slug"
      }
    );
  });
});
