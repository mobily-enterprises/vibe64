import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  resolveVibe64ProjectRuntimeRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";

async function withTemporaryRoot(callback) {
  const previousRuntimeNamespace = process.env[VIBE64_RUNTIME_NAMESPACE_ENV];
  const previousHome = process.env.HOME;
  if (!String(previousRuntimeNamespace || "").trim()) {
    process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";
  }
  let tempRoot = "";
  let root = "";
  try {
    tempRoot = await mkdtemp(path.join(tmpdir(), "vibe64-test-"));
    const tempId = path.basename(tempRoot).replace(/[^A-Za-z0-9_.-]+/gu, "-");
    root = path.join(tempRoot, `target-${tempId}`);
    await mkdir(root, {
      recursive: true
    });
    process.env.HOME = tempRoot;
    return await callback(root);
  } finally {
    if (tempRoot) {
      await rm(tempRoot, {
        force: true,
        maxRetries: 10,
        recursive: true,
        retryDelay: 20
      });
    }
    if (previousRuntimeNamespace == null) {
      delete process.env[VIBE64_RUNTIME_NAMESPACE_ENV];
    } else {
      process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = previousRuntimeNamespace;
    }
    if (previousHome == null) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
}

function managedSessionSourceRoot(targetRoot) {
  return path.join(path.dirname(targetRoot), "managed-source", path.basename(targetRoot));
}

function sourcePath(targetRoot, sessionId = "session") {
  return path.join(managedSessionSourceRoot(targetRoot), "sessions", "active", sessionId, "source");
}

function sourceMetadata(targetRoot, sessionId = "session") {
  return {
    source_kind: "session_clone",
    source_path: sourcePath(targetRoot, sessionId),
    source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
  };
}

function projectRuntimeRoot(targetRoot) {
  return resolveVibe64ProjectRuntimeRoot(targetRoot);
}

// Seed completed historical state without retaining an application Undo API.
async function markHistoricalConversationRewound(store, sessionId, turnIds) {
  const file = path.join(store.paths(sessionId).conversationLogRoot, "transcript.json");
  const record = JSON.parse(await readFile(file, "utf8"));
  record.rewound = [...new Set([...record.rewound, ...turnIds])];
  await writeFile(file, `${JSON.stringify(record)}\n`);
}

function renderTestGenesisPrompt({ action = {} } = {}) {
  const promptId = String(action.promptId || action.id || "test");
  return {
    context: {
      genesis: true,
      task: String(action.genesisTask || "work")
    },
    prompt: `Test Genesis prompt for ${promptId}.`,
    promptId
  };
}

export {
  markHistoricalConversationRewound,
  managedSessionSourceRoot,
  projectRuntimeRoot,
  renderTestGenesisPrompt,
  sourcePath,
  sourceMetadata,
  withTemporaryRoot
};
