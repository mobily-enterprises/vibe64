import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createVibe64ActionPolicy } from "@local/vibe64-core/server/actionContext";
import { resolveDefaultLocalEditorSystemRoot } from "@local/vibe64-core/server/studioRoots";
import { localProjectKeyFromTargetRoot } from "@local/vibe64-core/server/studioProjectContext";
import { EXTERNAL_PROJECT_LOCAL_ROOTS_DIR } from "@local/vibe64-core/server/projectState";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import { LOCAL_PROJECT_RESOURCES } from "@local/vibe64-project/server/resourceEnvironment";
import { NO_SAVED_ENV_VALUES } from "@local/vibe64-project/server/savedEnvValues";
import { upgradeChatTranscriptLogs } from "@local/vibe64-runtime/server/chatTranscriptLogUpgrade";
import { parseTranscriptLog, transcriptLogContents } from "@local/vibe64-runtime/server/sessionTranscriptLog";

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
  return path.join(resolveDefaultLocalEditorSystemRoot({ env: process.env }), EXTERNAL_PROJECT_LOCAL_ROOTS_DIR, localProjectKeyFromTargetRoot(targetRoot));
}

// Seed completed historical state without retaining an application Undo API.
async function markHistoricalConversationRewound(store, sessionId, turnIds) {
  const file = path.join(store.paths(sessionId).conversationLogRoot, "transcript.jsonl");
  const { record } = parseTranscriptLog(await readFile(file));
  record.rewound = [...new Set([...record.rewound, ...turnIds])];
  await writeFile(file, transcriptLogContents(record));
}

/**
 * Converts the previous release's transcript.json chats as deployment's ordered
 * upgrades do after 20261002-session-conversations: 20261124-chat-transcript-log.
 * @param {string} systemRoot
 */
async function upgradeChatTranscripts(systemRoot) {
  await upgradeChatTranscriptLogs({ systemRoot, apply: true, report: () => {},
    backupRoot: path.join(systemRoot, "upgrades/backups/20261124-chat-transcript-log") });
}

/**
 * A declared action as the action catalogue runs it under the Vibe64 action
 * policy: with its registered input, and an execute that applies the policy
 * to already validated input. Tests that call one action directly use it.
 * @param {object} definition
 */
function underActionPolicy(definition) {
  const policy = createVibe64ActionPolicy({ localhostCheckBypassed: false });
  return {
    ...definition,
    input: policy.input(definition),
    execute: (input, context = {}) => policy.execute({
      definition, input, context, run: (policyInput, policyContext) => definition.execute(policyInput, policyContext)
    })
  };
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

/**
 * The project service's collaborators as a standalone server's project feature supplies them: this process's env,
 * no project-change announcements, local resources and no saved values. Tests spread it first and override what
 * they exercise.
 */
function projectServiceCollaborators() {
  return {
    env: process.env,
    publishProjectChanged: async () => null,
    resourceEnvironmentProvider: LOCAL_PROJECT_RESOURCES,
    savedEnvValues: NO_SAVED_ENV_VALUES
  };
}

export {
  markHistoricalConversationRewound,
  upgradeChatTranscripts,
  managedSessionSourceRoot,
  projectRuntimeRoot,
  projectServiceCollaborators,
  renderTestGenesisPrompt,
  sourcePath,
  sourceMetadata,
  underActionPolicy,
  withTemporaryRoot
};
