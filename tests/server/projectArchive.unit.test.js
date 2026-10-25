import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createProjectArchiveService } from "../../packages/vibe64-project/src/server/projectArchive.js";
import { createStudioProjectContext } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { runVibe64Command } from "../../packages/vibe64-execution/src/server/index.js";

// The project lifecycle (see genesis/program/projects/project-archives.md).
// A host that adds managed databases or resource profiles tests them itself.

const execFileAsync = promisify(execFile);

async function withArchiveTest(callback) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-project-delete-"));
  try {
    const projectContext = createStudioProjectContext({
      env: {},
      explicitProjectsRoot: path.join(tempRoot, "projects"),
      explicitSystemRoot: path.join(tempRoot, "state"),
      home: tempRoot
    });
    await callback({ projectContext, tempRoot });
  } finally {
    await rm(tempRoot, {
      force: true,
      recursive: true
    });
  }
}

function practiceTraining(learnerUid = 42) {
  return {
    schemaVersion: 2,
    learnerKey: Buffer.from(String(learnerUid)).toString("base64url"),
    practiceId: "12345678-1234-4234-8234-123456789abc",
    pin: {
      course: { courseId: "intro-course", release: "0.1.0" },
      topic: { schemaVersion: 1, topicId: "intro-topic", release: "0.1.0", repository: "example/learn-intro",
        commit: "b".repeat(40), topicHash: "a".repeat(64) },
      lesson: { code: "LESSON-01", hash: "c".repeat(64) }
    },
    exercise: { kind: "bundled", sourcePath: "." }
  };
}

const PRACTICE_SLUG = "training-12345678123442348234123456789abc";

// A practice project in the learner's learning space, through the real local
// project context (standalone space under the managed source root). inScope
// runs an operation inside its practice scope, as the Learning owner does.
async function withPracticeTest(callback) {
  await withArchiveTest(async ({ tempRoot }) => {
    const projectContext = createStudioProjectContext({ env: {}, explicitSystemRoot: path.join(tempRoot, "state"),
      explicitManagedSourceRoot: path.join(tempRoot, "managed-source"), home: tempRoot,
      runtimeProfile: { local: true, mode: "local" } });
    const { learningSpaceRoot } = projectContext;
    assert.equal(learningSpaceRoot, path.join(tempRoot, "managed-source", ".learning"));
    const actor = { uid: 42, username: "learner" };
    const training = practiceTraining();
    const slug = PRACTICE_SLUG;
    const inScope = (operation, access = "write") => projectContext.runWithPracticeProjectScope(
      { actor, training, access, ...(access === "write" ? { allowDeleting: true } : {}) }, operation);
    await inScope(() => projectContext.createWorkspaceProjectRecord({ slug, training }), "create");
    const { projectContextRoot, projectRuntimeRoot } = await inScope(() => projectContext.readWorkspaceProjectState({ slug }));
    assert.equal(projectContextRoot, path.join(learningSpaceRoot, training.learnerKey, training.practiceId, slug));
    await callback({ actor, inScope, learningSpaceRoot, projectContext, projectContextRoot, projectRuntimeRoot, slug,
      tempRoot, training });
  });
}

// An ordinary catalogue project named like a practice project: created before
// the name was reserved (moved into place, since creation now refuses it).
async function createLegacyPracticeNamedProject(projectContext) {
  await projectContext.createWorkspaceProjectRecord({ slug: "legacy" });
  await rename(path.join(projectContext.projectsRoot, "legacy"), path.join(projectContext.projectsRoot, PRACTICE_SLUG));
  await rename(projectContext.projectRuntimeRootForSlug("legacy"), projectContext.projectRuntimeRootForSlug(PRACTICE_SLUG));
  return path.join(projectContext.projectsRoot, PRACTICE_SLUG);
}

test("project deletion resumes after namespace removal failure without repeating completed steps", async () => {
  await withArchiveTest(async ({ projectContext }) => {
    await projectContext.createWorkspaceProjectRecord({
      slug: "retry-project"
    });
    const projectContextRoot = path.join(projectContext.projectsRoot, "retry-project");
    const projectRuntimeRoot = projectContext.projectRuntimeRootForSlug("retry-project");
    await writeFile(path.join(projectContextRoot, "namespace-marker.json"), "{}\n", "utf8");
    let archiveInspections = 0;
    let closeAttempts = 0;
    let resourceRemovalAttempts = 0;
    let namespaceRemovalAttempts = 0;
    const service = createProjectArchiveService({
      clock: () => new Date("2026-06-19T09:00:00.000Z"),
      closeProjectRuntime: async () => {
        closeAttempts += 1;
        return {
          ok: true
        };
      },
      projectContext,
      hostResources: {
        remove: async () => {
          resourceRemovalAttempts += 1;
        }
      },
      // The namespace archive is created once: count its tar runs.
      runCommand: async (input) => {
        if (input.args.some((entry) => String(entry).endsWith(`${path.sep}source.tgz.partial`))) {
          archiveInspections += 1;
        }
        return runVibe64Command(input);
      },
      removePath: async (targetPath, options) => {
        if (path.resolve(targetPath) === path.resolve(projectContextRoot)) {
          namespaceRemovalAttempts += 1;
          if (namespaceRemovalAttempts === 1) {
            throw Object.assign(new Error("namespace busy"), {
              code: "namespace_busy"
            });
          }
        }
        return rm(targetPath, options);
      }
    });

    await assert.rejects(
      () => service.archiveProject({
        slug: "retry-project"
      }),
      {
        code: "namespace_busy"
      }
    );
    assert.equal(closeAttempts, 1);
    assert.equal(namespaceRemovalAttempts, 1);
    assert.equal(resourceRemovalAttempts, 1);
    assert.equal(archiveInspections, 1);
    await access(projectContextRoot);
    await access(projectRuntimeRoot);
    const interrupted = await projectContext.readWorkspaceProjectState({
      slug: "retry-project"
    });
    assert.ok(interrupted.metadata.deletion.steps["runtime-closed"]);
    assert.ok(interrupted.metadata.deletion.steps["source-archived"]);
    assert.ok(interrupted.metadata.deletion.steps["state-archived"]);
    assert.ok(interrupted.metadata.deletion.steps["resources-archived"]);
    assert.ok(interrupted.metadata.deletion.steps["bundle-validated"]);
    assert.ok(interrupted.metadata.deletion.steps["resources-removed"]);
    assert.equal(interrupted.metadata.deletion.steps["source-removed"], undefined);
    await assert.rejects(
      () => projectContext.readWorkspaceProject({
        slug: "retry-project"
      }),
      {
        code: "vibe64_project_deleting"
      }
    );

    const completed = await service.archiveProject({
      slug: "retry-project"
    });

    assert.equal(completed.ok, true);
    // Bundle records are written atomically and privately, leaving no temporary file.
    const bundleEntries = await readdir(completed.bundlePath);
    assert.deepEqual(bundleEntries.filter((name) => /\.(?:partial|tmp)$/u.test(name)), []);
    for (const name of bundleEntries.filter((entry) => entry.endsWith(".json"))) {
      assert.equal((await stat(path.join(completed.bundlePath, name))).mode & 0o777, 0o600, name);
    }
    assert.equal(closeAttempts, 1);
    assert.equal(namespaceRemovalAttempts, 2);
    assert.equal(resourceRemovalAttempts, 1);
    assert.equal(archiveInspections, 1);
    await assert.rejects(() => access(projectContextRoot), {
      code: "ENOENT"
    });
    await assert.rejects(() => access(projectRuntimeRoot), {
      code: "ENOENT"
    });

    const replayed = await service.archiveProject({
      slug: "retry-project"
    });
    assert.equal(replayed.bundlePath, completed.bundlePath);
    assert.equal(closeAttempts, 1);
    assert.equal(namespaceRemovalAttempts, 2);
    assert.equal(resourceRemovalAttempts, 1);
  });
});

test("one uninterrupted deletion lists each archive once when created and once when validated", async () => {
  await withArchiveTest(async ({ projectContext }) => {
    await projectContext.createWorkspaceProjectRecord({ slug: "single-run" });
    const listings = new Map();
    const service = createProjectArchiveService({
      closeProjectRuntime: async () => ({ ok: true }),
      projectContext,
      runCommand: async (input) => {
        if (input.args[0] === "-tzf") {
          const name = path.basename(input.args[1]);
          listings.set(name, (listings.get(name) || 0) + 1);
        }
        return runVibe64Command(input);
      }
    });
    const completed = await service.archiveProject({ slug: "single-run" });
    assert.equal(completed.ok, true);
    assert.deepEqual(Object.fromEntries(listings), { "source.tgz": 2, "runtime-state.tgz": 2 });
  });
});

test("the namespace archive leaves out rebuildable output at each session source root, exactly once", async () => {
  await withArchiveTest(async ({ projectContext }) => {
    await projectContext.createWorkspaceProjectRecord({ slug: "lean" });
    const root = path.join(projectContext.projectsRoot, "lean");
    const source = path.join(root, "sessions", "active", "s1", "source");
    for (const dir of ["node_modules/pkg", "src/build", "dist"]) await mkdir(path.join(source, dir), { recursive: true });
    for (const file of ["node_modules/pkg/index.js", "src/build/keep.js", "dist/app.js"]) await writeFile(path.join(source, file), "x\n");
    let createArgs = [];
    const service = createProjectArchiveService({
      closeProjectRuntime: async () => ({ ok: true }),
      projectContext,
      runCommand: async (input) => {
        if (input.args.some((entry) => String(entry).endsWith(`${path.sep}source.tgz.partial`))) createArgs = input.args;
        return runVibe64Command(input);
      }
    });
    const completed = await service.archiveProject({ slug: "lean" });
    const excludes = createArgs.flatMap((entry, index) => (createArgs[index - 1] === "--exclude" ? [entry] : []));
    assert.equal(excludes.length, 20);
    assert.deepEqual(excludes.slice(0, 2), ["lean/sessions/*/*/source/.jskit/cache", "lean/sessions/*/*/source/.jskit/cache/*"]);
    assert.ok(excludes.includes("lean/sessions/*/*/source/node_modules"));
    assert.ok(excludes.every((pattern) => pattern.startsWith("lean/sessions/*/*/source/") &&
      !pattern.slice("lean/".length).includes("sessions/*/*/source/sessions")), "the session prefix appears once");
    const { stdout } = await execFileAsync("tar", ["-tzf", path.join(completed.bundlePath, "source.tgz")]);
    assert.ok(stdout.includes("lean/sessions/active/s1/source/src/build/keep.js"), "nested source directories are kept");
    assert.ok(!stdout.includes("node_modules"));
    assert.ok(!stdout.includes("source/dist"));
  });
});

test("archive recovery rehearsal restores session source and conversation ACLs and detects corruption", async () => {
  await withArchiveTest(async ({ projectContext, tempRoot }) => {
    const slug = "restore-rehearsal";
    await projectContext.createWorkspaceProjectRecord({
      slug
    });
    const projectContextRoot = path.join(projectContext.projectsRoot, slug);
    const projectRuntimeRoot = projectContext.projectRuntimeRootForSlug(slug);
    const sessionSourceFile = path.join(
      projectContextRoot,
      "sessions",
      "active",
      "session-one",
      "source",
      "src",
      "city.js"
    );
    const conversationFile = path.join(
      projectRuntimeRoot,
      "sessions",
      "active",
      "session-one",
      "conversations",
      "conversation-one",
      "messages.jsonl"
    );
    await Promise.all([
      mkdir(path.dirname(sessionSourceFile), {
        recursive: true
      }),
      mkdir(path.dirname(conversationFile), {
        recursive: true
      })
    ]);
    await Promise.all([
      writeFile(sessionSourceFile, "export const city = 'recoverable';\n", "utf8"),
      writeFile(conversationFile, "{\"role\":\"user\",\"content\":\"recover me\"}\n", "utf8")
    ]);
    const currentGroup = String((await execFileAsync("id", ["-gn"])).stdout || "").trim();
    await Promise.all([
      execFileAsync("setfacl", ["-m", `g:${currentGroup}:rw`, sessionSourceFile]),
      execFileAsync("setfacl", ["-m", `g:${currentGroup}:rw`, conversationFile])
    ]);
    const service = createProjectArchiveService({
      clock: () => new Date("2026-08-16T12:34:56.789Z"),
      closeProjectRuntime: async () => ({
        ok: true
      }),
      projectContext
    });

    const archived = await service.archiveProject({
      slug
    });
    const restoredSourceParent = path.join(tempRoot, "restored-source");
    const restoredStateParent = path.join(tempRoot, "restored-state");
    await Promise.all([
      mkdir(restoredSourceParent),
      mkdir(restoredStateParent)
    ]);
    await Promise.all([
      execFileAsync("tar", [
        "--acls",
        "--xattrs",
        "-xzf",
        path.join(archived.bundlePath, "source.tgz"),
        "-C",
        restoredSourceParent
      ]),
      execFileAsync("tar", [
        "--acls",
        "--xattrs",
        "-xzf",
        path.join(archived.bundlePath, "runtime-state.tgz"),
        "-C",
        restoredStateParent
      ])
    ]);
    const restoredSessionSourceFile = path.join(
      restoredSourceParent,
      slug,
      "sessions",
      "active",
      "session-one",
      "source",
      "src",
      "city.js"
    );
    const restoredConversationFile = path.join(
      restoredStateParent,
      slug,
      "sessions",
      "active",
      "session-one",
      "conversations",
      "conversation-one",
      "messages.jsonl"
    );
    assert.equal(
      await readFile(restoredSessionSourceFile, "utf8"),
      "export const city = 'recoverable';\n"
    );
    assert.equal(
      await readFile(restoredConversationFile, "utf8"),
      "{\"role\":\"user\",\"content\":\"recover me\"}\n"
    );
    for (const restoredFile of [restoredSessionSourceFile, restoredConversationFile]) {
      const acl = String((await execFileAsync("getfacl", [
        "--omit-header",
        restoredFile
      ])).stdout || "");
      assert.match(acl, new RegExp(`^group:${currentGroup}:rw-`, "mu"));
    }

    await appendFile(path.join(archived.bundlePath, "runtime-state.tgz"), "corrupt", "utf8");
    await assert.rejects(
      () => service.archiveProject({
        slug
      }),
      {
        code: "vibe64_project_archive_artifact_changed"
      }
    );
  });
});

test("project deletion refuses a state path that is not the slug's exact runtime root", async () => {
  await withArchiveTest(async ({ projectContext }) => {
    await projectContext.createWorkspaceProjectRecord({
      slug: "safe-project"
    });
    const actualState = await projectContext.readWorkspaceProjectState({
      slug: "safe-project"
    });
    const unsafeContext = {
      ...projectContext,
      async readWorkspaceProjectState() {
        return {
          ...actualState,
          projectRuntimeRoot: path.join(projectContext.systemRoot, "projects", "another-project")
        };
      }
    };
    const service = createProjectArchiveService({
      closeProjectRuntime: async () => ({
        ok: true
      }),
      projectContext: unsafeContext
    });

    await assert.rejects(
      () => service.archiveProject({
        slug: "safe-project"
      }),
      {
        code: "vibe64_project_state_outside_system_root"
      }
    );
    await access(path.join(projectContext.projectsRoot, "safe-project"));
    await access(projectContext.projectRuntimeRootForSlug("safe-project"));
  });
});

test("a pinned source blocks deletion before deletion state or resources change", async () => {
  await withArchiveTest(async ({ projectContext }) => {
    await projectContext.createWorkspaceProjectRecord({ slug: "pinned-project" });
    const sessions = path.join(projectContext.projectSessionSourceRootForSlug("pinned-project"), "sessions");
    await mkdir(sessions, { recursive: true });
    await symlink("active/main-session", path.join(sessions, "pinned"));
    const before = await projectContext.readWorkspaceProjectState({ slug: "pinned-project" });
    const service = createProjectArchiveService({ projectContext,
      closeProjectRuntime: async () => { throw new Error("must not close"); },
      hostResources: {
        archive: async () => { throw new Error("must not archive"); },
        remove: async () => { throw new Error("must not remove"); }
      }
    });
    await assert.rejects(service.archiveProject({ slug: "pinned-project",
      beforeRemove: async () => { throw new Error("the owner's step must not run after a refusal"); } }), { code: "vibe64_project_pinned" });
    assert.deepEqual((await projectContext.readWorkspaceProjectState({ slug: "pinned-project" })).metadata, before.metadata);
  });
});

test("light practice deletion resumes after namespace removal failure", async () => {
  await withPracticeTest(async ({ actor, inScope, projectContext, projectContextRoot, slug, training }) => {
    let closeAttempts = 0;
    let resourceRemovalAttempts = 0;
    let namespaceRemovalAttempts = 0;
    const service = createProjectArchiveService({ projectContext,
      closeProjectRuntime: async () => { closeAttempts += 1; return { ok: true }; },
      hostResources: {
        archive: async () => { throw new Error("must not archive"); },
        remove: async () => { resourceRemovalAttempts += 1; }
      },
      removePath: async (targetPath, options) => {
        if (path.resolve(targetPath) === path.resolve(projectContextRoot) && ++namespaceRemovalAttempts === 1) {
          throw Object.assign(new Error("namespace busy"), { code: "namespace_busy" });
        }
        return rm(targetPath, options);
      } });
    // The owner's step runs under the lock before the deletion marker, and again on a resume.
    const steps = [];
    const beforeRemove = async () => { steps.push(Boolean((await projectContext.readWorkspaceProjectState({ slug })).metadata.deletion)); };
    await assert.rejects(inScope(() => service.removeProject({ slug, beforeRemove })), { code: "namespace_busy" });
    const interrupted = await inScope(() => projectContext.readWorkspaceProjectState({ slug }));
    assert.ok(interrupted.metadata.deletion.steps["runtime-closed"]);
    assert.ok(interrupted.metadata.deletion.steps["resources-removed"]);
    assert.equal(interrupted.metadata.deletion.steps["source-archived"], undefined);
    assert.equal(interrupted.metadata.deletion.steps["source-removed"], undefined);
    // An open page on a practice project being deleted gets core's clean not-found.
    await assert.rejects(() => projectContext.runWithPracticeProjectScope({ actor, training, requireProject: true }, () => assert.fail()),
      { code: "vibe64_practice_project_deleted", statusCode: 404 });
    assert.equal(await inScope(() => service.projectExists({ slug })), true, "an interrupted removal stays listed for the retry");
    assert.equal((await inScope(() => service.removeProject({ slug, beforeRemove }))).removed, true);
    assert.deepEqual(steps, [false, true]);
    assert.equal(closeAttempts, 1);
    assert.equal(resourceRemovalAttempts, 1);
    assert.equal(namespaceRemovalAttempts, 2);
    await assert.rejects(() => access(projectContext.projectRuntimeRootForSlug(slug)), { code: "ENOENT" });
    await assert.rejects(() => access(path.dirname(projectContextRoot)), { code: "ENOENT" },
      "the empty practice directory goes with its namespace");
    assert.equal(await inScope(() => service.projectExists({ slug })), false);
    assert.deepEqual(await inScope(() => service.removeProject({ slug, beforeRemove })), { ok: true, slug, removed: false },
      "a completed removal replays without effects");
    assert.deepEqual(steps, [false, true]);
  });
});

test("a pinned session blocks light practice deletion before deletion state changes", async () => {
  await withPracticeTest(async ({ inScope, projectContext, slug }) => {
    const sessions = path.join(await inScope(() => projectContext.projectSessionSourceRootForSlug(slug)), "sessions");
    await mkdir(sessions, { recursive: true });
    await symlink("active/main-session", path.join(sessions, "pinned"));
    const before = await inScope(() => projectContext.readWorkspaceProjectState({ slug }));
    const service = createProjectArchiveService({ projectContext,
      closeProjectRuntime: async () => { throw new Error("must not close"); },
      hostResources: {
        archive: async () => { throw new Error("must not archive"); },
        remove: async () => { throw new Error("must not remove"); }
      } });
    await assert.rejects(inScope(() => service.removeProject({ slug,
      beforeRemove: async () => { throw new Error("the owner's step must not run after a refusal"); } })),
      { code: "vibe64_project_pinned", statusCode: 409, message: "Unpin session main-session before deleting this practice project." });
    assert.deepEqual((await inScope(() => projectContext.readWorkspaceProjectState({ slug }))).metadata, before.metadata);
    assert.deepEqual(await inScope(() => service.canRemoveProject({ slug })),
      { ok: false, reason: "Unpin session main-session before deleting this practice project." });
    assert.deepEqual((await inScope(() => projectContext.readWorkspaceProjectState({ slug }))).metadata, before.metadata,
      "the preflight writes nothing");
  });
});

test("light deletion refuses a catalogue project, which keeps archive-only deletion", async () => {
  await withArchiveTest(async ({ projectContext }) => {
    await projectContext.createWorkspaceProjectRecord({ slug: "ordinary" });
    const before = await projectContext.readWorkspaceProjectState({ slug: "ordinary" });
    const service = createProjectArchiveService({ projectContext,
      closeProjectRuntime: async () => { throw new Error("must not close"); } });
    await assert.rejects(service.removeProject({ slug: "ordinary" }), { code: "vibe64_project_not_practice", statusCode: 409 });
    assert.equal((await service.canRemoveProject({ slug: "ordinary" })).ok, false);
    assert.deepEqual((await projectContext.readWorkspaceProjectState({ slug: "ordinary" })).metadata, before.metadata);
    await access(path.join(projectContext.projectsRoot, "ordinary"));
  });
});

test("a practice slug is archived or removed only inside its practice scope, refused before any deletion marker", async () => {
  await withPracticeTest(async ({ inScope, projectContext, projectContextRoot, slug }) => {
    const before = await inScope(() => projectContext.readWorkspaceProjectState({ slug }));
    const service = createProjectArchiveService({ projectContext,
      closeProjectRuntime: async () => { throw new Error("must not close"); } });
    await assert.rejects(service.archiveProject({ slug }), { code: "vibe64_practice_scope_required", statusCode: 409 });
    await assert.rejects(service.removeProject({ slug }), { code: "vibe64_practice_scope_required", statusCode: 409 });
    assert.deepEqual((await inScope(() => projectContext.readWorkspaceProjectState({ slug }))).metadata, before.metadata);
    await access(projectContextRoot);
  });
});

test("a catalogue project named like a practice project, without a practice marker, is still archived", async () => {
  await withArchiveTest(async ({ projectContext }) => {
    const namespace = await createLegacyPracticeNamedProject(projectContext);
    const service = createProjectArchiveService({ projectContext, closeProjectRuntime: async () => ({ ok: true }) });
    const archived = await service.archiveProject({ slug: PRACTICE_SLUG });
    assert.equal(archived.ok, true);
    assert.equal(path.dirname(path.dirname(archived.bundlePath)), path.join(projectContext.systemRoot, "project-archives"));
    await assert.rejects(() => access(namespace), { code: "ENOENT" });
  });
});

test("a catalogue project named like a practice project resumes after its namespace is gone and replays its archive", async () => {
  await withArchiveTest(async ({ projectContext }) => {
    const namespace = await createLegacyPracticeNamedProject(projectContext);
    const projectRuntimeRoot = projectContext.projectRuntimeRootForSlug(PRACTICE_SLUG);
    let stateRemovalAttempts = 0;
    const service = createProjectArchiveService({ projectContext, closeProjectRuntime: async () => ({ ok: true }),
      removePath: async (targetPath, options) => {
        if (path.resolve(targetPath) === path.resolve(projectRuntimeRoot) && ++stateRemovalAttempts === 1) {
          throw Object.assign(new Error("state busy"), { code: "state_busy" });
        }
        return rm(targetPath, options);
      } });
    await assert.rejects(service.archiveProject({ slug: PRACTICE_SLUG }), { code: "state_busy" });
    await assert.rejects(() => access(namespace), { code: "ENOENT" }, "the namespace was removed before the interruption");
    const interrupted = await projectContext.readWorkspaceProjectState({ slug: PRACTICE_SLUG });
    assert.ok(interrupted.metadata.deletion.steps["source-removed"]);
    const completed = await service.archiveProject({ slug: PRACTICE_SLUG });
    assert.equal(completed.ok, true);
    assert.equal(stateRemovalAttempts, 2);
    await assert.rejects(() => access(projectRuntimeRoot), { code: "ENOENT" });
    const replayed = await service.archiveProject({ slug: PRACTICE_SLUG });
    assert.equal(replayed.bundlePath, completed.bundlePath);
    assert.deepEqual(replayed.artifacts, completed.artifacts);
  });
});

test("a practice archive uses the learning-space namespace and replays through the unchanged bundle scan", async () => {
  await withPracticeTest(async ({ inScope, projectContext, projectContextRoot, projectRuntimeRoot, slug, training }) => {
    // The learner's code lives in the practice session source root, which the
    // learning space keeps inside the namespace on both hosts.
    const sessionSource = path.join(await inScope(() => projectContext.projectSessionSourceRootForSlug(slug)),
      "sessions", "active", "s1", "source");
    assert.ok(sessionSource.startsWith(`${projectContextRoot}${path.sep}`));
    await mkdir(path.join(sessionSource, "node_modules", "left-pad"), { recursive: true });
    await writeFile(path.join(sessionSource, "app.js"), "practice\n");
    const archiveRoot = path.join(projectContext.systemRoot, "training", "practice-archives", training.learnerKey);
    const service = createProjectArchiveService({ projectContext, clock: () => new Date("2026-10-20T10:00:00.000Z"),
      closeProjectRuntime: async () => ({ ok: true }) });
    const archived = await inScope(() => service.archiveProject({ slug, archiveRoot }));
    assert.equal(archived.bundlePath, path.join(archiveRoot, slug, `20261020T100000000Z-${slug}`));
    const listing = String((await execFileAsync("tar", ["-tzf", path.join(archived.bundlePath, "source.tgz")])).stdout)
      .split("\n").filter(Boolean);
    assert.ok(listing.includes(`${slug}/sessions/active/s1/source/app.js`));
    assert.equal(listing.some((entry) => entry.includes("node_modules")), false);
    await assert.rejects(() => access(projectContextRoot), { code: "ENOENT" });
    await assert.rejects(() => access(path.dirname(projectContextRoot)), { code: "ENOENT" });
    await assert.rejects(() => access(projectRuntimeRoot), { code: "ENOENT" });
    const replayed = await inScope(() => service.archiveProject({ slug, archiveRoot }));
    assert.equal(replayed.bundlePath, archived.bundlePath);
    assert.deepEqual(replayed.artifacts, archived.artifacts);
  });
});

test("checkHeadroom asks the host before a fresh archive and the normal archive does not", async () => {
  await withArchiveTest(async ({ projectContext }) => {
    await projectContext.createWorkspaceProjectRecord({ slug: "tight" });
    await projectContext.createWorkspaceProjectRecord({ slug: "normal" });
    const checks = [];
    const service = createProjectArchiveService({ projectContext, closeProjectRuntime: async () => ({ ok: true }),
      assertArchiveHeadroom: async (input) => {
        checks.push(input);
        throw Object.assign(new Error("Free workspace storage first."), { code: "archive_headroom_low" });
      } });
    const before = await projectContext.readWorkspaceProjectState({ slug: "tight" });
    await assert.rejects(service.archiveProject({ slug: "tight", checkHeadroom: true }), { code: "archive_headroom_low" });
    assert.deepEqual(checks.map(({ slug, projectContextRoot }) => [slug, projectContextRoot]),
      [["tight", path.join(projectContext.projectsRoot, "tight")]]);
    assert.deepEqual((await projectContext.readWorkspaceProjectState({ slug: "tight" })).metadata, before.metadata,
      "a refusal writes no deletion marker");
    assert.equal((await service.archiveProject({ slug: "normal" })).ok, true);
    assert.equal(checks.length, 1);
  });
});
