import { tmpdir } from "node:os";
import path from "node:path";
import { isMissingPathError, normalizeText } from "@local/vibe64-core/server/core";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { pathMatchesPolicyPattern, sourceEditorFilePolicy, sourceEditorPathExcluded } from "./filePolicy.js";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { sessionClosingReason } from "@local/vibe64-runtime/server/sessionLifecycle";
import { createSourceEditorFileObserver } from "./sourceChangeObserver.js";
import { readStarredFiles, setStarredFile, starredFilesPath } from "./starredFiles.js";
import { createSourceEditorFileIndex } from "./fileIndex.js";
import { createSourceEditorSearchIndex, sourceEditorIndexDirectory } from "./searchIndex.js";
import { readSourceInterpretations } from "./sourceInterpretations.js";
import {
  SOURCE_EDITOR_CONFLICT_CODE,
  SOURCE_EDITOR_SEARCH_RESULT_LIMIT,
  createSourceEditorFile,
  downloadSessionFile,
  normalizeSourceEditorQuery,
  normalizeSourceEditorRelativePath,
  publicSourceEditorPolicy,
  readSourceEditorFile,
  resolveSourceEditorPath,
  runSourceEditorOperation,
  saveSourceEditorFile,
  sourceEditorDirectoryPage,
  sourceEditorError,
  sourceEditorExistingFile,
  sourceEditorFileChange,
  sourceEditorFileMatches,
  sourceEditorFilePaths,
  sourceEditorFileRevealTree,
  sourceEditorLanguageForPath,
  sourceEditorPathStats,
  sourceEditorResultLimit,
  sourceEditorResultOffset,
  sourceEditorTempRoot,
  streamSourceEditorFileChanges
} from "./sourceFiles.js";
import {
  createFileArea
} from "./fileAreas.js";
import {
  createIntegrationOperations,
  readApplicationIntegrations,
  runApplicationIntegrationSetup
} from "./integrations.js";
import {
  createExplanationOperations,
  describeSourceEditorAgentProvider,
  sourceEditorInterfacePromptVersion,
  sourceEditorVibe64UserIdentity
} from "./explanations.js";

function createService({
  integrationCommandRunner = runVibe64Command,
  integrationDiscoveryFetch = globalThis.fetch,
  explanationCacheNow = Date.now,
  logger = console,
  projectService,
  publishSessionChanged = async () => null,
  sourceFileObserver = null,
  terminalService = null,
  temporaryRoot = tmpdir()
} = {}) {
  if (!projectService || typeof projectService.createRuntime !== "function") {
    throw new TypeError("createService requires the Vibe64 Project API.");
  }
  const fileObserver = sourceFileObserver || createSourceEditorFileObserver({
    logger
  });
  const fileIndex = createSourceEditorFileIndex({
    load: sourceEditorFilePaths,
    snapshotPath: (context) => path.join(sourceEditorIndexDirectory(context), "filenames.json")
  });
  const searchIndex = createSourceEditorSearchIndex();
  let fileSaveOwner = null;

  async function sourceEditorContext(sessionId = "", {
    agentOperation = false,
    runtime: existingRuntime = null,
    vibe64User = null
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      throw sourceEditorError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    }

    const runtime = existingRuntime || await projectService.createRuntime({
      sessionId: normalizedSessionId
    });
    const session = await runtime.getSession(normalizedSessionId);
    const closingReason = sessionClosingReason(session);
    if (agentOperation && closingReason) {
      throw sourceEditorError(
        closingReason === "renewing"
          ? "Source explanations are unavailable while this session is renewing."
          : "Source explanations are unavailable while this session is closing.",
        closingReason === "renewing"
          ? "vibe64_session_renewal_quiesced"
          : "vibe64_session_closing",
        {
          reason: closingReason,
          sessionId: normalizedSessionId
        },
        409
      );
    }
    const sourceRoot = sessionSourcePath(session);
    let sourceRootStats = null;
    if (sourceRoot) {
      try {
        sourceRootStats = await sourceEditorPathStats(sourceRoot);
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }
      }
    }
    if (!sourceRootStats?.isDirectory()) {
      throw sourceEditorError(
        "Create the session source before opening the editor.",
        "vibe64_source_editor_source_unavailable",
        { sessionId: normalizedSessionId },
        409
      );
    }

    let agentAccountIdentitySignature = "";
    let agentRoutingDecision = null;
    let agentProviderId = "";
    if (agentOperation) {
      const provider = await describeSourceEditorAgentProvider(terminalService, { runtime, session, vibe64User });
      agentProviderId = normalizeText(
        provider?.providerId ||
        session?.agentSession?.providerId ||
        session?.metadata?.agent_identity_provider
      );
      agentAccountIdentitySignature = normalizeText(provider?.accountIdentitySignature);
      agentRoutingDecision = provider.decision;
    }

    return {
      agentAccountIdentity: sourceEditorVibe64UserIdentity(vibe64User),
      agentAccountIdentitySignature,
      agentRoutingDecision,
      agentProviderId,
      policy: sourceEditorFilePolicy(),
      runtime,
      session,
      sessionId: normalizedSessionId,
      sourceEditorTempRoot: sourceEditorTempRoot(temporaryRoot, normalizedSessionId),
      sourceRoot,
      vibe64User
    };
  }

  async function runSourceEditorWriteExclusive(input = {}, operation, {
    agentOperation = false
  } = {}) {
    const sessionId = normalizeText(input.sessionId);
    if (!sessionId) {
      throw sourceEditorError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    }
    const runtime = await projectService.createRuntime({ sessionId });
    const exclusive = await runVibe64AgentWriteExclusive(
      runtime,
      sessionId,
      async () => operation(await sourceEditorContext(sessionId, {
        agentOperation,
        runtime,
        vibe64User: input.vibe64User
      })),
      { operation: "source-editor-write" }
    );
    if (!exclusive.acquired) {
      throw sourceEditorError(
        normalizeText(exclusive.value?.error) || "Another source-changing operation is starting. Try again in a moment.",
        normalizeText(exclusive.value?.code) || "vibe64_source_editor_write_busy",
        {},
        409
      );
    }
    return exclusive.value;
  }

  const explanations = createExplanationOperations({
    explanationCacheNow, logger,
    projectService, sourceEditorContext, temporaryRoot, terminalService
  });

  return Object.freeze({
    fileArea: createFileArea(projectService),
    ...createIntegrationOperations({
      fileIndex, integrationCommandRunner, integrationDiscoveryFetch, projectService,
      publishSessionChanged, runSourceEditorWriteExclusive, searchIndex, sourceEditorContext
    }),
    async readTree(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        if (!normalizeSourceEditorRelativePath(input.path) && !sourceEditorResultOffset(input.offset)) {
          fileIndex.invalidate(context.sourceRoot);
          searchIndex.invalidate(context.sourceRoot);
        }
        return {
          ok: true,
          policy: publicSourceEditorPolicy(context.policy),
          root: "",
          tree: await sourceEditorDirectoryPage(context, {
            limit: input.limit,
            offset: sourceEditorResultOffset(input.offset),
            // Preserve the tree API's two-pass path normalization, including "./ src".
            path: normalizeSourceEditorRelativePath(input.path)
          })
        };
      });
    },

    async readFile(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId, { vibe64User: input.vibe64User });
        const file = await readSourceEditorFile(context, input.path);
        return {
          file,
          interpretations: await readSourceInterpretations(context, file, sourceEditorInterfacePromptVersion),
          revealTree: await sourceEditorFileRevealTree(context, file.path),
          ok: true
        };
      });
    },

    async downloadFile(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return downloadSessionFile(context, input.path);
      });
    },

    async readStarredFiles(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        const paths = await readStarredFiles(starredFilesPath(context.runtime.stateRoot, input.vibe64User));
        const files = [];
        // Only inspect explicitly bookmarked paths, never scan or watch the tree.
        for (const filePath of paths) {
          try {
            await sourceEditorExistingFile(context, filePath, { maxFileBytes: Infinity });
            files.push({ path: filePath, available: true });
          } catch (error) {
            files.push({
              path: filePath,
              available: false,
              reason: isMissingPathError(error) ? "Not found in this session" : "Unavailable in this session"
            });
          }
        }
        return { ok: true, files };
      });
    },

    async setStarredFile(input = {}) {
      return runSourceEditorOperation(async () => {
        if (typeof input.starred !== "boolean") {
          throw sourceEditorError("Choose whether to star the file.", "vibe64_invalid_starred_file");
        }
        const context = await sourceEditorContext(input.sessionId);
        const filePath = normalizeSourceEditorRelativePath(input.path);
        if (!filePath) {
          throw sourceEditorError("Choose a file to star.", "vibe64_invalid_source_editor_path");
        }
        if (input.starred) {
          await sourceEditorExistingFile(context, filePath, { maxFileBytes: Infinity });
        }
        const paths = await setStarredFile(starredFilesPath(context.runtime.stateRoot, input.vibe64User), filePath, input.starred);
        return { ok: true, paths };
      });
    },

    async streamFileChanges(input = {}, stream = {}) {
      const context = await sourceEditorContext(input.sessionId);
      const file = await sourceEditorExistingFile(context, input.path);
      return streamSourceEditorFileChanges(context, file, stream, fileObserver);
    },

    async saveFile(input = {}) {
      const save = () => runSourceEditorOperation(async () => {
        return runSourceEditorWriteExclusive(input, async (context) => {
          const file = await saveSourceEditorFile(context, input);
          searchIndex.invalidate(context.sourceRoot);
          return {
            file,
            fileChange: sourceEditorFileChange(context, input, file),
            ok: true
          };
        });
      });
      // A host save owner (Training's code-authorship ledger) may wrap this
      // exact save; it never replaces it or selects a different file.
      return fileSaveOwner ? runSourceEditorOperation(() => fileSaveOwner({ input, save })) : save();
    },

    setFileSaveOwner(owner = null) {
      if (owner !== null && typeof owner !== "function") throw new TypeError("A source file save owner must be a function.");
      fileSaveOwner = owner;
    },

    async createFile(input = {}) {
      return runSourceEditorOperation(async () => {
        return runSourceEditorWriteExclusive(input, async (context) => {
          const file = await createSourceEditorFile(context, input);
          fileIndex.invalidate(context.sourceRoot);
          searchIndex.invalidate(context.sourceRoot);
          return {
            file,
            fileChange: sourceEditorFileChange(context, input, file),
            revealTree: await sourceEditorFileRevealTree(context, file.path),
            ok: true
          };
        });
      });
    },

    async listFiles(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          ok: true,
          ...sourceEditorFileMatches(await fileIndex.read(context), input)
        };
      });
    },

    async search(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        const found = await searchIndex.search(context, {
          query: normalizeSourceEditorQuery(input.query || input.q),
          limit: sourceEditorResultLimit(input.limit, SOURCE_EDITOR_SEARCH_RESULT_LIMIT)
        });
        // The worker skips excluded paths; an index written before a policy
        // change may still hold rows until its next refresh removes them.
        return {
          ok: true,
          ...found,
          results: found.results.filter((result) => !sourceEditorPathExcluded(context.policy, result.path))
        };
      });
    },

    async resolvePath(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          ok: true,
          ...await resolveSourceEditorPath(context, input)
        };
      });
    },

    ...explanations.operations,

    async close() {
      await explanations.close();
      fileObserver.close();
      fileIndex.clear();
      return searchIndex.close();
    }
  });
}

export {
  SOURCE_EDITOR_CONFLICT_CODE,
  runApplicationIntegrationSetup,
  readApplicationIntegrations,
  createService,
  normalizeSourceEditorRelativePath,
  pathMatchesPolicyPattern,
  sourceEditorLanguageForPath
};
