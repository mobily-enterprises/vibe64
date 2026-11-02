import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  targetRuntimeIdentity
} from "../../packages/vibe64-core/src/server/projectRuntimeIdentity.js";
import {
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  configureStudioProjectContext,
  localProjectKeyFromTargetRoot
} from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import {
  cleanupCodexAttachments,
  renewCodexAttachments,
  storeCodexAttachment
} from "../../packages/vibe64-terminals/src/server/codexAttachments.js";
import {
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV
} from "../../packages/vibe64-runtime/src/server/codexAttachmentPaths.js";

const SESSION_ID = "2026-08-24_12-34-56";
const HASH_PATTERN = /^[a-f0-9]{12}$/u;

async function withTemporaryRoot(operation) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-identity-"));
  try {
    configureStudioProjectContext({ env: {}, explicitProjectsRoot: path.join(root, "projects"),
      explicitSystemRoot: path.join(root, "system"), home: root });
    return await operation(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function standaloneContext(projectRoot, runtimeRoot) {
  return {
    projectRuntimeRoot: runtimeRoot,
    projectSessionSourceRoot: path.join(
      runtimeRoot,
      "managed-source",
      localProjectKeyFromTargetRoot(projectRoot)
    ),
    slug: "shared",
    sourceRoot: projectRoot,
    targetRoot: projectRoot
  };
}

async function storeAttachment({
  attachmentRoot,
  context,
  contents,
  executionRoot
}) {
  return runWithProjectRequestContext(context, () => storeCodexAttachment({
    env: {
      [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: attachmentRoot
    },
    executionRoot,
    input: {
      fileName: "proof.txt",
      stream: Readable.from([Buffer.from(contents)])
    },
    sessionId: SESSION_ID
  }));
}

test("standalone runtime identities isolate equal basenames without exposing source paths", async () => {
  await withTemporaryRoot(async (root) => {
    const firstProjectRoot = path.join(root, "owner-a", "shared");
    const secondProjectRoot = path.join(root, "owner-b", "shared");
    const firstContext = standaloneContext(firstProjectRoot, path.join(root, "state-a"));
    const secondContext = standaloneContext(secondProjectRoot, path.join(root, "state-b"));
    const firstExecutionRoot = path.join(
      firstContext.projectSessionSourceRoot,
      "sessions",
      "active",
      SESSION_ID,
      "source"
    );
    const secondExecutionRoot = path.join(
      secondContext.projectSessionSourceRoot,
      "sessions",
      "active",
      SESSION_ID,
      "source"
    );
    await Promise.all([
      mkdir(firstExecutionRoot, { recursive: true }),
      mkdir(secondExecutionRoot, { recursive: true })
    ]);

    const firstIdentity = await runWithProjectRequestContext(
      firstContext,
      () => targetRuntimeIdentity(firstExecutionRoot)
    );
    const secondIdentity = await runWithProjectRequestContext(
      secondContext,
      () => targetRuntimeIdentity(secondExecutionRoot)
    );

    assert.match(firstIdentity, /^local-project:shared-[a-f0-9]{12}$/u);
    assert.match(secondIdentity, /^local-project:shared-[a-f0-9]{12}$/u);
    assert.notEqual(firstIdentity, secondIdentity);
    assert.equal(targetRuntimeIdentity(firstProjectRoot), firstIdentity);
    assert.equal(targetRuntimeIdentity(secondProjectRoot), secondIdentity);
    assert.equal(firstIdentity.includes(firstProjectRoot), false);
    assert.equal(secondIdentity.includes(secondProjectRoot), false);
  });
});

test("catalogue runtime identity remains stable across isolated session checkouts", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const slug = "hosted-abcdef123456";
    const sessionSourceRoot = path.join(projectsRoot, slug);
    const context = {
      projectRuntimeRoot: path.join(root, "runtime", slug),
      projectSessionSourceRoot: sessionSourceRoot,
      slug,
      sourceRoot: "",
      targetRoot: sessionSourceRoot
    };
    const firstExecutionRoot = path.join(sessionSourceRoot, "sessions", "active", "session-a", "source");
    const secondExecutionRoot = path.join(sessionSourceRoot, "sessions", "active", "session-b", "source");
    const identities = await runWithProjectRequestContext(context, () => [
      targetRuntimeIdentity(firstExecutionRoot),
      targetRuntimeIdentity(secondExecutionRoot)
    ]);

    assert.deepEqual(identities, [`project:${slug}`, `project:${slug}`]);
    assert.equal(targetRuntimeIdentity(firstExecutionRoot), `project:${slug}`);
    assert.equal(targetRuntimeIdentity(secondExecutionRoot), `project:${slug}`);
  });
});

test("same-second standalone sessions survive context-free renew and close without crossing projects", async () => {
  await withTemporaryRoot(async (root) => {
    const attachmentRoot = path.join(root, "attachments");
    const firstProjectRoot = path.join(root, "owner-a", "shared");
    const secondProjectRoot = path.join(root, "owner-b", "shared");
    const firstContext = standaloneContext(firstProjectRoot, path.join(root, "state-a"));
    const secondContext = standaloneContext(secondProjectRoot, path.join(root, "state-b"));
    const firstExecutionRoot = path.join(firstContext.projectSessionSourceRoot, "sessions", "active", SESSION_ID, "source");
    const secondExecutionRoot = path.join(secondContext.projectSessionSourceRoot, "sessions", "active", SESSION_ID, "source");
    await Promise.all([
      mkdir(firstExecutionRoot, { recursive: true }),
      mkdir(secondExecutionRoot, { recursive: true })
    ]);

    const contextBoundIdentities = await Promise.all([
      runWithProjectRequestContext(firstContext, () => targetRuntimeIdentity(firstExecutionRoot)),
      runWithProjectRequestContext(secondContext, () => targetRuntimeIdentity(secondExecutionRoot))
    ]);
    assert.equal(targetRuntimeIdentity(firstExecutionRoot), contextBoundIdentities[0]);
    assert.equal(targetRuntimeIdentity(secondExecutionRoot), contextBoundIdentities[1]);
    assert.notEqual(contextBoundIdentities[0], contextBoundIdentities[1]);

    const first = await storeAttachment({
      attachmentRoot,
      contents: "first project",
      context: firstContext,
      executionRoot: firstExecutionRoot
    });
    const second = await storeAttachment({
      attachmentRoot,
      contents: "second project",
      context: secondContext,
      executionRoot: secondExecutionRoot
    });
    const firstRelativeParts = path.relative(path.join(attachmentRoot, "files"), first.path).split(path.sep);
    const secondRelativeParts = path.relative(path.join(attachmentRoot, "files"), second.path).split(path.sep);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.match(firstRelativeParts[0], HASH_PATTERN);
    assert.match(secondRelativeParts[0], HASH_PATTERN);
    assert.notEqual(firstRelativeParts[0], secondRelativeParts[0]);
    assert.equal(firstRelativeParts[1], secondRelativeParts[1]);
    assert.equal(first.path.includes(firstProjectRoot), false);
    assert.equal(second.path.includes(secondProjectRoot), false);
    assert.equal(await readFile(first.path, "utf8"), "first project");
    assert.equal(await readFile(second.path, "utf8"), "second project");
    await Promise.all([
      access(path.join(attachmentRoot, "locks", firstRelativeParts[0], `${firstRelativeParts[1]}.lock`)),
      access(path.join(attachmentRoot, "locks", secondRelativeParts[0], `${secondRelativeParts[1]}.lock`))
    ]);

    assert.deepEqual(await renewCodexAttachments(
      firstExecutionRoot,
      SESSION_ID,
      [first.attachmentId],
      { env: { [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: attachmentRoot } }
    ), {
      missing: [],
      retained: [first.attachmentId]
    });
    assert.equal(await cleanupCodexAttachments(
      firstExecutionRoot,
      SESSION_ID,
      "",
      { env: { [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: attachmentRoot } }
    ), true);

    await assert.rejects(() => access(first.path), { code: "ENOENT" });
    assert.equal(await readFile(second.path, "utf8"), "second project");
    assert.deepEqual(await renewCodexAttachments(
      secondExecutionRoot,
      SESSION_ID,
      [second.attachmentId],
      { env: { [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: attachmentRoot } }
    ), {
      missing: [],
      retained: [second.attachmentId]
    });

    assert.equal(await cleanupCodexAttachments(
      secondExecutionRoot,
      SESSION_ID,
      "",
      { env: { [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: attachmentRoot } }
    ), true);
  });
});
