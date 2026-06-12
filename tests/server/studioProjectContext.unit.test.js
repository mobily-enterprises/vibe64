import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

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

test("Studio project context uses a visibly local-editor system root in local mode", async () => {
  await withTemporaryRoot(async (root) => {
    const context = createStudioProjectContext({
      env: {},
      home: root,
      runtimeProfile: {
        local: true,
        mode: "local"
      }
    });

    assert.equal(context.systemRoot, path.join(root, ".local", "share", "vibe64-local-editor"));
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

    const created = await context.createManagedProjectRecord({
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

    await context.createManagedProjectRecord({
      githubRepository: {
        fullName: "example/alpha"
      },
      slug: "alpha"
    });
    const listed = await context.listManagedProjects();
    assert.deepEqual(listed.projects.map((project) => project.slug), ["alpha", "beta_2"]);

    const selectionList = await context.listProjects();
    assert.equal(selectionList.projects[0].githubRepository.fullName, "example/alpha");

    await assert.rejects(
      () => context.createManagedProjectRecord({
        slug: "Bad.Slug"
      }),
      {
        code: "vibe64_invalid_project_slug"
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

test("Studio project context reads shared project state and ignores private local state", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectRoot = path.join(projectsRoot, "canonical-app");
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

    const listed = await context.listManagedProjects();

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
