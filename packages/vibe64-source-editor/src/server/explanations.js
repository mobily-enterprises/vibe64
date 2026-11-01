import crypto from "node:crypto";
import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { GENESIS_MACHINE_CITY_PATH, validateArchitectureFacts } from "@local/vibe64-genesis/server";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import {
  downloadSessionFile,
  readSourceEditorFile,
  runSourceEditorOperation,
  sourceEditorError,
  sourceEditorTempRoot,
  streamSourceEditorOperation
} from "./sourceFiles.js";
import {
  describeSourceEditorAgentProvider,
  requiredSourceEditorExecutionProfile,
  resolveSourceEditorAgentExecutionProfile,
  sourceEditorExecutionProfileSnapshot,
  sourceEditorVibe64UserIdentity
} from "./explanationProfile.js";
import {
  normalizeSourceEditorLineRange,
  SOURCE_EDITOR_EXPLANATION_CODE_MAX_CHARS,
  SOURCE_EDITOR_EXPLANATION_MAX_LINES,
  SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION,
  sourceEditorContextWindow,
  sourceEditorExplanationDisplayPrompt,
  sourceEditorExplanationId,
  sourceEditorExplanationMessageId,
  sourceEditorExplanationPrompt,
  sourceEditorExplanationPromptCode,
  sourceEditorExplanationSummary,
  sourceEditorExplanationTitle,
  sourceEditorInterfacePromptVersion,
  sourceEditorLines,
  sourceEditorRangeWithSelectionColumns,
  sourceEditorSelectionForRange,
  sourceEditorTextHash
} from "./explanationText.js";
import {
  deleteSourceEditorExplanationAgentThread,
  readSourceEditorExplanationCleanupRecord,
  removeSourceEditorExplanationCleanupRecord,
  sourceEditorExplanationMemoryKey,
  upsertSourceEditorExplanationCleanupRecord,
  writeSourceEditorExplanation
} from "./explanationRecords.js";
import {
  createSourceEditorExplanationStreamState,
  emitSourceEditorExplanationEvent,
  runTrackedSourceEditorAgentTurn,
  sourceEditorClientExplanationId,
  sourceEditorClientMessageId,
  sourceEditorExplanationMessage,
  streamSourceEditorAgentTurn,
  withSourceEditorExplanationFreshness
} from "./explanationStream.js";
import {
  createSourceEditorExplanationCache,
  sourceEditorCompletedCacheIdentityUnchanged,
  sourceEditorExplanationCacheKey,
  sourceEditorInterpretationCacheOptions
} from "./explanationCache.js";
import { streamSourceEditorExplanationFollowup } from "./explanationFollowup.js";
import {
  cleanupSourceEditorExplanations,
  deleteSourceEditorExplanation,
  stopSourceEditorExplanation
} from "./explanationCleanup.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./explanationRecords.js").SourceEditorExplanationChats} SourceEditorExplanationChats */
/** @typedef {import("./types.js").SourceEditorExplanationStream} SourceEditorExplanationStream */

const SOURCE_EDITOR_ARCHITECTURE_MAX_BYTES = 128 * 1024 * 1024;

/**
 * Source explanations own their helper turns, conversation memory and cache.
 * @param {object} dependencies
 * @param {() => number} dependencies.explanationCacheNow
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {(sessionId: string, options?: object) => Promise<object>} dependencies.sourceEditorContext
 * @param {string} dependencies.temporaryRoot
 * @param {TerminalsService} dependencies.terminals
 */
function createExplanationOperations({
  explanationCacheNow,
  logger,
  project,
  sourceEditorContext,
  temporaryRoot,
  terminals
}) {
  /** @type {SourceEditorExplanationChats} */
  const explanationChats = new Map();
  const explanationTurns = new Map();
  const explanationCache = createSourceEditorExplanationCache({
    now: explanationCacheNow
  });

  async function runSourceEditorAgentOperation(input, operation) {
    const sessionId = toText(input.sessionId);
    if (!sessionId) {
      throw sourceEditorError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    }
    const explanationId = sourceEditorClientExplanationId(input.explanationId) || sourceEditorExplanationId();
    const key = sourceEditorExplanationMemoryKey({ sessionId }, explanationId);
    if (explanationTurns.has(key)) {
      throw sourceEditorError("This explanation is already answering a question.", "vibe64_source_explanation_busy", {}, 409);
    }
    const task = {
      sessionId,
      projectScope: currentProjectScopeKey(),
      id: explanationId,
      originId: input.originId,
      updatedAt: new Date().toISOString(),
      controller: new AbortController()
    };
    explanationTurns.set(key, task);
    let runtime;
    const run = async () => {
      const context = await sourceEditorContext(sessionId, { agentOperation: true, runtime, vibe64User: input.vibe64User });
      context.explanationId = explanationId;
      context.signal = task.controller.signal;
      context.signal.throwIfAborted();
      const retained = await readSourceEditorExplanationCleanupRecord(context, context.explanationId);
      if (retained?.helper && input.message) {
        const helper = retained.helper;
        if (helper.actorIdentity !== context.agentAccountIdentity ||
            helper.connectionIdentity !== context.agentRoutingDecision.connectionIdentity ||
            JSON.stringify(helper.selection) !== JSON.stringify(context.agentRoutingDecision.effectiveSelection)) {
          throw sourceEditorError(
            "This explanation uses a different AI or account. Start a new explanation to continue.",
            "vibe64_source_explanation_destination_changed",
            {},
            409
          );
        }
        context.assistantHelper = helper;
      } else {
        if (retained) {
          await deleteSourceEditorExplanationAgentThread(context, retained, { terminals });
          await removeSourceEditorExplanationCleanupRecord(context, context.explanationId);
        }
        const id = `source_${crypto.randomUUID()}`;
        const root = path.join(runtime.stateRoot, "assistant-helpers", id);
        context.assistantHelper = {
          scope: {
            id,
            runtimeRoot: path.join(root, "runtime"),
            workdir: path.join(root, "workdir"),
            environment: {},
            stableContext: "Explain only the supplied source and conversation. You have no tools or project access."
          },
          selection: context.agentRoutingDecision.effectiveSelection,
          connectionIdentity: context.agentRoutingDecision.connectionIdentity,
          actorIdentity: context.agentAccountIdentity,
          conversationId: "",
          runId: "",
          executionId: ""
        };
      }
      const retain = () => upsertSourceEditorExplanationCleanupRecord(context, {
        id: context.explanationId,
        sourceRange: { path: input.path || retained?.sourcePath || "" },
        ownerOriginId: input.originId || retained?.originId,
        agentThreadId: context.assistantHelper.conversationId,
        agentTurnId: context.assistantHelper.runId,
        status: "running",
        createdAt: retained?.createdAt || task.updatedAt,
        updatedAt: new Date().toISOString()
      });
      context.retainAssistantHelper = retain;
      await retain();
      try {
        await mkdir(context.assistantHelper.scope.workdir, { recursive: true, mode: 0o700 });
        await mkdir(context.assistantHelper.scope.runtimeRoot, { recursive: true, mode: 0o700 });
        context.agentExecutionProfile = await resolveSourceEditorAgentExecutionProfile(terminals, context);
        context.assistantHelper.executionProfile = sourceEditorExecutionProfileSnapshot(context.agentExecutionProfile);
        await retain();
        context.signal.throwIfAborted();
        const result = await operation(context);
        if (result?.status !== "stopped") context.signal.throwIfAborted();
        return result;
      } finally {
        if (context.assistantHelper && !context.assistantHelper.conversationId) {
          await deleteSourceEditorExplanationAgentThread(context, {
            id: context.explanationId,
            helper: context.assistantHelper
          }, { terminals });
          await removeSourceEditorExplanationCleanupRecord(context, context.explanationId);
        }
      }
    };
    task.promise = (async () => {
      runtime = await project.createRuntime({ sessionId });
      task.controller.signal.throwIfAborted();
      // Only turns in the same explanation share mutable conversation state.
      // The session store still checks renewal admission before starting work.
      const conversationKey = crypto.createHash("sha256")
        .update(toText(input.explanationId) || crypto.randomUUID())
        .digest("hex");
      const exclusive = await runtime.store.runSessionExclusive(
        sessionId,
        `source-explanation-${conversationKey}`,
        run
      );
      if (!exclusive.acquired) {
        throw sourceEditorError(
          "This explanation is already answering a question. Try again when it finishes.",
          "vibe64_source_explanation_busy",
          {},
          409
        );
      }
      return exclusive.value;
    })().finally(() => {
      if (explanationTurns.get(key) === task) explanationTurns.delete(key);
    });
    return task.promise;
  }

  async function close() {
    const tasks = [...explanationTurns.values()];
    for (const task of tasks) task.controller.abort();
    await Promise.allSettled(tasks.map((task) => task.promise));
    explanationCache.close();
  }

  /**
   * @param {object} input
   * @param {SourceEditorExplanationStream} stream
   */
  async function streamExplanation(input, stream) {
    await streamSourceEditorOperation(async () => {
      await runSourceEditorAgentOperation(input, async (context) => {
        const explanationInput = await sourceEditorExplanationInput(context, input);
        const cacheKey = sourceEditorExplanationCacheKey(context, explanationInput);
        return explanationCache.run(cacheKey, {
          completedCache: Boolean(context.agentAccountIdentitySignature),
          force: input.force === true,
          ...sourceEditorInterpretationCacheOptions(context, explanationInput, cacheKey, logger),
          generate: () => streamSourceEditorExplanation(context, input, {
            emit: stream.emit,
            explanationChats,
            explanationInput,
            isClosed: stream.isClosed,
            terminals
          }),
          reuse: (template, cacheState) => streamCachedSourceEditorExplanation(
            context,
            input,
            explanationInput,
            template,
            {
              cacheState,
              emit: stream.emit,
              explanationChats,
              isClosed: stream.isClosed
            }
          ),
          validateCompleted: (template) => sourceEditorCompletedCacheIdentityUnchanged(
            terminals,
            context,
            template
          )
        });
      });
    }, stream);
  }

  /**
   * @param {object} input
   * @param {SourceEditorExplanationStream} stream
   */
  async function streamExplanationFollowup(input, stream) {
    await streamSourceEditorOperation(async () => {
      await runSourceEditorAgentOperation(input, (context) => (
        streamSourceEditorExplanationFollowup(context, input, {
          emit: stream.emit,
          explanationChats,
          isClosed: stream.isClosed,
          terminals
        })
      ));
    }, stream);
  }

  async function stopExplanation(input) {
    return runSourceEditorOperation(async () => {
      const context = await sourceEditorContext(input.sessionId, {
        vibe64User: input.vibe64User
      });
      return {
        explanation: await stopSourceEditorExplanation(context, input.explanationId, {
          explanationChats,
          explanationTurns,
          terminals
        }),
        ok: true
      };
    });
  }

  async function deleteExplanation(input) {
    return runSourceEditorOperation(async () => {
      const context = await sourceEditorContext(input.sessionId, {
        vibe64User: input.vibe64User
      });
      return {
        ...await deleteSourceEditorExplanation(context, input.explanationId, {
          explanationChats,
          explanationTurns,
          terminals
        }),
        ok: true
      };
    });
  }

  async function cleanupExplanations(input) {
    return runSourceEditorOperation(async () => {
      const context = await sourceEditorContext(input.sessionId, {
        vibe64User: input.vibe64User
      });
      return {
        ...await cleanupSourceEditorExplanations(context, input, {
          explanationChats,
          explanationTurns,
          terminals
        }),
        ok: true
      };
    });
  }

  /**
   * Every explanation helper is closed on its own; one that cannot close
   * keeps its record for the next close, is logged and is named here.
   */
  async function closeExplanationsForSession(sessionId) {
    const runtime = await project.createRuntime({ sessionId });
    const result = await cleanupSourceEditorExplanations({
      runtime,
      sessionId,
      sourceEditorTempRoot: sourceEditorTempRoot(temporaryRoot, sessionId)
    }, {}, { all: true, explanationChats, explanationTurns, terminals });
    for (const failure of result.failures) {
      logOperationalEvent(logger, "warn", {
        component: "vibe64-source-editor",
        event: "vibe64.source_explanation.cleanup_failed",
        code: failure.code || "",
        error: failure.error,
        explanationId: failure.id,
        sessionId
      }, "A source explanation helper could not be closed; its record was kept.");
    }
    const reasons = [...new Set(result.failures.map((failure) => failure.error))];
    return {
      ...result,
      ok: result.failureCount === 0,
      ...(result.failureCount ? {
        code: "vibe64_source_explanation_cleanup_failed",
        error: result.failureCount === 1 ? reasons[0]
          : `${result.failureCount} source explanation helpers could not be closed. ${reasons.join(" ")}`
      } : {})
    };
  }

  return Object.freeze({
    streamExplanation,
    streamExplanationFollowup,
    stopExplanation,
    deleteExplanation,
    cleanupExplanations,
    closeExplanationsForSession,
    close
  });
}

async function sourceEditorExplanationInput(context, input) {
  const file = await readSourceEditorFile(context, input.path);
  if (input.expectedHash && input.expectedHash !== file.hash) {
    throw sourceEditorError(
      "The saved file changed. Reopen it before requesting an explanation.",
      "vibe64_source_explanation_source_changed",
      {},
      409
    );
  }
  const presentation = input.presentation;
  if (presentation !== undefined && !["description", "steps"].includes(presentation)) {
    throw sourceEditorError("Choose Description or Steps.", "vibe64_source_explanation_presentation_invalid");
  }
  const lines = sourceEditorLines(file.text);
  const symbolId = input.symbolId;
  let selection = input;
  if (symbolId !== undefined) {
    if (typeof symbolId !== "string" || !symbolId.trim() || symbolId.length > 4096) {
      throw sourceEditorError("Choose a valid indexed symbol.", "vibe64_source_explanation_symbol_invalid");
    }
    let architecture;
    try {
      // A download applies the path, symlink and file-identity checks. The
      // native index has its own bound, not the editable-file limit.
      const { fileHandle } = await downloadSessionFile(context, GENESIS_MACHINE_CITY_PATH);
      try {
        if ((await fileHandle.stat()).size > SOURCE_EDITOR_ARCHITECTURE_MAX_BYTES) {
          throw sourceEditorError(
            "Symbol analysis exceeds the supported size. Use Code or explain a selection.",
            "vibe64_source_explanation_index_too_large",
            {},
            413
          );
        }
        const chunks = [];
        for await (const chunk of fileHandle.createReadStream({
          start: 0,
          end: SOURCE_EDITOR_ARCHITECTURE_MAX_BYTES,
          autoClose: false
        })) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        if (buffer.length > SOURCE_EDITOR_ARCHITECTURE_MAX_BYTES) {
          throw sourceEditorError(
            "Symbol analysis exceeds the supported size. Use Code or explain a selection.",
            "vibe64_source_explanation_index_too_large",
            {},
            413
          );
        }
        architecture = validateArchitectureFacts(JSON.parse(buffer.toString("utf8")).architecture);
      } finally {
        await fileHandle.close();
      }
    } catch (error) {
      if (error.statusCode === 403 || error.statusCode === 413) throw error;
      throw sourceEditorError(
        "Symbol analysis is unavailable or invalid. Refresh analysis before describing the symbol.",
        "vibe64_source_explanation_index_unavailable",
        {},
        409
      );
    }
    const symbol = architecture.symbols.find(entry => entry.id === symbolId);
    const indexedFile = architecture.files.find(entry => entry.id === symbol?.fileId);
    if (!symbol?.rangeAvailable ||
        symbol.path !== file.path ||
        indexedFile?.path !== file.path ||
        indexedFile.hash !== `sha256:${file.hash}`) {
      throw sourceEditorError(
        "This symbol changed after analysis. Refresh analysis before describing it.",
        "vibe64_source_explanation_symbol_changed",
        {},
        409
      );
    }
    for (const point of [symbol.start, symbol.end]) {
      if (point.line > lines.length || point.column > lines[point.line - 1].length + 1) {
        throw sourceEditorError(
          "The indexed symbol range is invalid for this file. Refresh analysis.",
          "vibe64_source_explanation_symbol_changed",
          {},
          409
        );
      }
    }
    if (presentation === "steps" && !Array.isArray(symbol.parameters)) {
      throw sourceEditorError(
        "Explain function is available for callable declarations. Use Explain file or Code for other declarations.",
        "vibe64_source_explanation_not_callable"
      );
    }
    selection = { startLine: symbol.start.line, startColumn: symbol.start.column, endLine: symbol.end.line, endColumn: symbol.end.column };
  }
  const scope = symbolId !== undefined ? "selection" : toText(input.scope) === "file" ? "file" : "selection";
  if (scope === "file" && presentation === "description") {
    selection = { startLine: 1, startColumn: 1, endLine: lines.length, endColumn: lines.at(-1).length + 1 };
  }
  const range = sourceEditorRangeWithSelectionColumns(
    normalizeSourceEditorLineRange(selection, lines.length),
    selection,
    lines
  );
  const selectedText = sourceEditorSelectionForRange(file.text, range);
  if (!selectedText.trim()) {
    throw sourceEditorError("Select code before asking for an explanation.", "vibe64_source_explanation_empty_selection");
  }
  const selectedLineCount = range.endLine - range.startLine + 1;
  if (scope !== "file" && symbolId === undefined && selectedLineCount > SOURCE_EDITOR_EXPLANATION_MAX_LINES) {
    throw sourceEditorError(
      "Select a smaller code range before asking for an explanation.",
      "vibe64_source_explanation_selection_too_large",
      {
        maxLines: SOURCE_EDITOR_EXPLANATION_MAX_LINES,
        selectedLineCount
      },
      413
    );
  }
  if (scope !== "file" && selectedText.length > SOURCE_EDITOR_EXPLANATION_CODE_MAX_CHARS) {
    throw sourceEditorError(
      "Select a smaller code range before asking for an explanation.",
      "vibe64_source_explanation_selection_too_large",
      {
        maxChars: SOURCE_EDITOR_EXPLANATION_CODE_MAX_CHARS,
        selectedChars: selectedText.length
      },
      413
    );
  }
  const selectedTextHash = sourceEditorTextHash(selectedText);
  const promptVersion = presentation ? sourceEditorInterfacePromptVersion(presentation) : SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION;
  const promptCode = sourceEditorExplanationPromptCode({
    range: {
      ...range,
      scope,
      presentation
    },
    selectedText
  });
  return {
    contextWindow: scope === "file" ? "" : sourceEditorContextWindow(file.text, range),
    file,
    promptCode,
    promptVersion,
    range: {
      ...range,
      fileHash: file.hash,
      ...(presentation ? { presentation } : {}),
      ...(symbolId !== undefined ? { symbolId } : {}),
      language: file.language,
      path: file.path,
      scope,
      selectedTextHash
    },
    selectedText
  };
}

/**
 * A cached answer streams as a finished explanation of its own.
 * @param {object} context
 * @param {object} input
 * @param {object} explanationInput
 * @param {object} template
 * @param {object} options
 * @param {SourceEditorExplanationChats} options.explanationChats
 */
async function streamCachedSourceEditorExplanation(
  context,
  input,
  explanationInput,
  template,
  options
) {
  const {
    cacheState,
    emit,
    explanationChats,
    isClosed
  } = options;
  const createdAt = new Date().toISOString();
  const explanationId = sourceEditorClientExplanationId(input.explanationId) || context.explanationId || sourceEditorExplanationId();
  const userMessageId = sourceEditorClientMessageId(input.userMessageId) || sourceEditorExplanationMessageId();
  const assistantMessageId = sourceEditorClientMessageId(input.assistantMessageId) || sourceEditorExplanationMessageId();
  const executionProfile = requiredSourceEditorExecutionProfile(template.executionProfile);
  const explanation = await withSourceEditorExplanationFreshness(
    context,
    await writeSourceEditorExplanation(context, {
      agentThreadId: "",
      agentSettings: null,
      agentTurnId: "",
      body: String(template.body || ""),
      createdAt,
      engine: "agent-cache",
      error: "",
      executionProfile,
      followups: [],
      id: explanationId,
      messages: [
        sourceEditorExplanationMessage(
          "user",
          sourceEditorExplanationDisplayPrompt(explanationInput),
          createdAt,
          { id: userMessageId }
        ),
        sourceEditorExplanationMessage("assistant", String(template.body || ""), createdAt, {
          id: assistantMessageId
        })
      ],
      model: executionProfile.model,
      ownerOriginId: input.originId,
      promptVersion: explanationInput.promptVersion,
      sourceRange: explanationInput.range,
      status: "ready",
      summary: String(template.summary || sourceEditorExplanationSummary(template.body)),
      title: toText(template.title) || sourceEditorExplanationTitle(explanationInput)
    }, {
      explanationChats
    })
  );
  const eventContext = {
    cacheHit: cacheState.cacheHit === true,
    coalesced: cacheState.coalesced === true,
    explanation
  };
  emitSourceEditorExplanationEvent(emit, isClosed, "source-explanation.started", {
    ...eventContext,
    assistantMessageId,
    userMessageId
  });
  emitSourceEditorExplanationEvent(emit, isClosed, "source-explanation.execution-profile", {
    ...eventContext,
    executionProfile
  });
  emitSourceEditorExplanationEvent(emit, isClosed, "source-explanation.finished", eventContext);
  return explanation;
}

/**
 * @param {object} context
 * @param {object} input
 * @param {object} options
 * @param {SourceEditorExplanationChats} options.explanationChats
 * @param {TerminalsService} options.terminals
 */
async function streamSourceEditorExplanation(context, input, options) {
  const {
    emit,
    explanationChats,
    explanationInput: preparedInput,
    isClosed,
    terminals
  } = options;
  const createdAt = new Date().toISOString();
  const explanationId = sourceEditorClientExplanationId(input.explanationId) || context.explanationId || sourceEditorExplanationId();
  const userMessageId = sourceEditorClientMessageId(input.userMessageId) || sourceEditorExplanationMessageId();
  const assistantMessageId = sourceEditorClientMessageId(input.assistantMessageId) || sourceEditorExplanationMessageId();
  const displayPrompt = sourceEditorExplanationDisplayPrompt(preparedInput);
  const explanation = {
    agentThreadId: "",
    agentSettings: null,
    agentTurnId: "",
    body: "",
    createdAt,
    engine: "agent-chat",
    executionProfile: sourceEditorExecutionProfileSnapshot(context.agentExecutionProfile),
    followups: [],
    id: explanationId,
    messages: [
      sourceEditorExplanationMessage("user", displayPrompt, createdAt, {
        id: userMessageId
      }),
      sourceEditorExplanationMessage("assistant", "", createdAt, {
        id: assistantMessageId,
        status: "thinking"
      })
    ],
    model: context.agentExecutionProfile.model,
    ownerOriginId: input.originId,
    promptVersion: preparedInput.promptVersion,
    sourceRange: preparedInput.range,
    status: "running",
    title: sourceEditorExplanationTitle(preparedInput)
  };

  const stream = createSourceEditorExplanationStreamState(context, explanation, {
    assistantMessageId,
    emit,
    explanationChats,
    isClosed
  });

  stream.setExplanation(await writeSourceEditorExplanation(context, explanation, {
    explanationChats
  }));
  stream.emitEvent("source-explanation.started", {
    assistantMessageId,
    userMessageId
  });

  const trackedTurn = await runTrackedSourceEditorAgentTurn(context, {
    assistantMessageId,
    currentExplanation: stream.currentExplanation,
    emitEvent: stream.emitEvent,
    explanationChats,
    remember: stream.remember,
    terminals,
    run: () => streamSourceEditorAgentTurn(context, {
      prompt: sourceEditorExplanationPrompt(preparedInput),
      promptLabel: "Source code explanation",
      terminals,
      ...stream.streamHandlers
    })
  });
  if (trackedTurn.stopped) {
    return trackedTurn.explanation;
  }
  const result = trackedTurn.result;

  return await stream.finish(result.text, {
    agentThreadId: result.threadId || stream.currentExplanation().agentThreadId,
    agentTurnId: result.turnId || stream.currentExplanation().agentTurnId,
    executionProfile: result.executionProfile,
    model: result.executionProfile.model,
    summary: sourceEditorExplanationSummary(result.text)
  });
}

export {
  createExplanationOperations,
  describeSourceEditorAgentProvider,
  sourceEditorInterfacePromptVersion,
  sourceEditorVibe64UserIdentity
};
