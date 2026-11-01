import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { vibe64AgentExecutionProfileAuditSnapshot } from "@local/vibe64-runtime/shared";
import {
  databaseAssistantAvailability,
  DATABASE_ASSISTANT_EXECUTION_PROFILE,
  runDatabaseAssistant
} from "./assistant.js";
import { databaseError } from "./databaseError.js";
import { databaseResult } from "./databaseResult.js";
import { actorKey } from "./sessionState.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("./types.js").SessionDatabase} SessionDatabase */
/** @typedef {import("./types.js").SessionQueries} SessionQueries */

/**
 * The database copilot's questions: one at a time per person and session, each
 * on its own ephemeral helper whose saved receipt is closed when the question
 * ends or, failing that, when the session closes.
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {SessionDatabase} dependencies.sessionDatabase
 * @param {SessionQueries} dependencies.sessionQueries
 * @param {TerminalsService} dependencies.terminals
 */
function createDatabaseAssistantTasks({
  logger,
  project,
  sessionDatabase,
  sessionQueries,
  terminals
}) {
  const activeAssistants = new Set();

  /**
   * The session store reads and writes an ordinary close uses.
   * @param {Vibe64SessionRuntime} runtime
   */
  function sessionStorage(runtime) {
    return Object.freeze({
      readArtifact: (sessionId, artifact) => runtime.store.readArtifact(sessionId, artifact),
      mutateSession: (sessionId, mutation) => runtime.store.mutateSession(sessionId, mutation),
      withReadableSessionPaths: (sessionId, read) => runtime.store.withReadableSessionPaths(sessionId, read)
    });
  }

  /**
   * The renewal-private reads and writes a renewal's helper cleanup uses.
   * @param {Vibe64SessionRuntime} runtime
   */
  function renewalStorage(runtime) {
    return Object.freeze({
      readArtifact: (sessionId, artifact) => runtime.store.readArtifactForRenewal(sessionId, artifact),
      mutateSession: (sessionId, mutation) => runtime.store.mutateSessionForRenewal(sessionId, mutation),
      withReadableSessionPaths: (sessionId, read) => runtime.store.withReadableSessionPathsForRenewal(sessionId, read)
    });
  }

  async function assistantDecision(context) {
    return terminals.resolveAssistantPurpose({ purpose: "database_assistant" }, {
      session: context.session,
      vibe64User: context.vibe64User
    });
  }

  /**
   * A receipt whose helper close is unconfirmed is kept and retried; its error
   * names the copilot helper and keeps the native owner's reason and code.
   * @param {Vibe64SessionRuntime} runtime
   * @param {string} sessionId
   * @param {string} artifact
   * @param {object | null} vibe64User
   * @param {ReturnType<typeof sessionStorage>} storage
   */
  async function cleanupAssistant(runtime, sessionId, artifact, vibe64User, storage) {
    const saved = await storage.readArtifact(sessionId, artifact);
    let helper = null;
    try {
      helper = saved ? JSON.parse(saved) : null;
    } catch {
      throw databaseError(
        `The saved database copilot receipt ${artifact} is unreadable; it was left unchanged.`,
        "vibe64_database_assistant_receipt_invalid"
      );
    }
    if (!helper) return;
    const root = path.join(runtime.stateRoot, "assistant-helpers", helper.scope?.id || "");
    if (!/^database_[a-f0-9-]+$/u.test(helper.scope?.id || "") || helper.scope.workdir !== path.join(root, "workdir") ||
        helper.scope.runtimeRoot !== path.join(root, "runtime")) {
      throw databaseError(
        `The saved database copilot receipt ${artifact} has invalid cleanup paths; it was left unchanged.`,
        "vibe64_database_assistant_receipt_invalid"
      );
    }
    const result = await terminals.deleteEphemeralAgentConversation(helper.scope, {
      conversationId: helper.conversationId,
      cleanupExecutionId: helper.executionId,
      ...(helper.executionProfile ? { executionProfile: helper.executionProfile } : {})
    }, { assistantSelection: helper.selection, vibe64User });
    if (result?.ok !== true) {
      const reason = String(result?.error || "").trim().slice(0, 512).replace(/[.\s]+$/u, "");
      throw databaseError(
        `The database copilot helper could not be closed${reason ? `: ${reason}` : ""}. Retry before asking again.`,
        result?.code || "vibe64_database_assistant_cleanup_failed"
      );
    }
    const retire = (paths) => rm(path.join(paths.artifactsRoot, artifact), { force: true });
    await storage.mutateSession(sessionId, retire);
    await rm(root, { recursive: true, force: true });
  }

  /**
   * Each person's receipt is closed on its own: one that cannot close is kept
   * for the next close and named, and never stops the others.
   * @param {string} sessionId
   * @param {{ runtime?: Vibe64SessionRuntime }} [options]
   */
  async function closeAssistantsForSession(sessionId, options = {}) {
    const runtime = await closingRuntime(sessionId, options);
    return closeSessionAssistants(sessionId, runtime, sessionStorage(runtime));
  }

  /**
   * A renewal's helper cleanup closes the receipts through the renewal-private
   * store, which refuses an ordinary close.
   * @param {string} sessionId
   * @param {{ runtime?: Vibe64SessionRuntime }} options
   */
  async function closeRenewalAssistantsForSession(sessionId, options) {
    const runtime = await closingRuntime(sessionId, options);
    return closeSessionAssistants(sessionId, runtime, renewalStorage(runtime));
  }

  /**
   * Stops the session's running questions, then names the runtime that closes
   * their receipts.
   * @param {string} sessionId
   * @param {{ runtime?: Vibe64SessionRuntime }} options
   */
  async function closingRuntime(sessionId, options) {
    const scope = currentProjectScopeKey();
    const tasks = [...activeAssistants].filter((task) => task.sessionId === sessionId && task.projectScope === scope);
    for (const task of tasks) task.controller.abort();
    await sessionQueries.cancelSession(sessionId);
    await Promise.allSettled(tasks.map((task) => task.promise));
    return options.runtime || project.createRuntimeWithoutSource();
  }

  /**
   * @param {string} sessionId
   * @param {Vibe64SessionRuntime} runtime
   * @param {ReturnType<typeof sessionStorage>} storage
   */
  async function closeSessionAssistants(sessionId, runtime, storage) {
    const files = await storage.withReadableSessionPaths(sessionId, async (paths) => {
      try {
        return await readdir(path.join(paths.artifactsRoot, "database/assistant-tasks"));
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    });
    const failures = [];
    for (const file of files) {
      if (/^[a-f0-9]{20}\.json$/u.test(file)) {
        const artifact = `database/assistant-tasks/${file}`;
        try {
          await cleanupAssistant(runtime, sessionId, artifact, null, storage);
        } catch (error) {
          failures.push(error);
          logOperationalEvent(logger, "warn", {
            component: "vibe64-database-tools",
            event: "vibe64.database.assistant_cleanup_failed",
            sessionId,
            artifact,
            code: error.code || "",
            error: error.message
          }, "A database copilot helper could not be closed; its receipt was kept.");
        }
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) {
      throw Object.assign(new AggregateError(failures, failures.map((error) => error.message).join(" ")), {
        code: "vibe64_database_assistant_cleanup_failed"
      });
    }
    return { ok: true };
  }

  function askAssistant(input) {
    const task = {
      sessionId: toText(input.sessionId),
      projectScope: currentProjectScopeKey(),
      actor: actorKey(input.vibe64User),
      controller: new AbortController()
    };
    task.promise = databaseResult(async () => {
      if ([...activeAssistants].some((other) => other !== task && other.sessionId === task.sessionId &&
          other.projectScope === task.projectScope && other.actor === task.actor)) {
        throw databaseError("Wait for your current database question to finish.", "vibe64_database_assistant_busy");
      }
      const context = await sessionDatabase.sessionContext(input);
      task.controller.signal.throwIfAborted();
      const decision = await assistantDecision(context);
      if (!decision.available) throw databaseError(decision.message, decision.reasonCode);
      const runtime = await project.createRuntimeWithoutSource();
      const admitted = await runtime.store.runSessionExclusive(context.sessionId, `database-assistant-${task.actor}`, async () => {
        const schema = await sessionDatabase.currentSchema(context);
        const artifact = `database/assistant-tasks/${task.actor}.json`;
        await cleanupAssistant(runtime, context.sessionId, artifact, context.vibe64User, sessionStorage(runtime));
        task.controller.signal.throwIfAborted();
        const id = `database_${randomUUID()}`;
        const root = path.join(runtime.stateRoot, "assistant-helpers", id);
        const helper = {
          scope: {
            id,
            environment: {},
            runtimeRoot: path.join(root, "runtime"),
            workdir: path.join(root, "workdir"),
            stableContext: "Answer only from the supplied database information. You have no tools or project access."
          },
          selection: decision.effectiveSelection,
          connectionIdentity: decision.connectionIdentity,
          conversationId: "",
          runId: "",
          executionId: ""
        };
        const retain = () => runtime.store.writeJsonArtifact(context.sessionId, artifact, helper);
        await retain();
        const options = {
          assistantSelection: helper.selection,
          vibe64User: context.vibe64User,
          expectedConnectionIdentity: helper.connectionIdentity,
          signal: task.controller.signal,
          async onEvent(event) {
            if (event.type === "thread") helper.conversationId = event.threadId;
            else if (event.type === "turn") helper.runId = event.turnId;
            else if (event.type === "helper-execution") helper.executionId = event.executionId;
            else return;
            await retain();
          }
        };
        const startedAt = Date.now();
        let result = null;
        let failure = null;
        try {
          await mkdir(helper.scope.workdir, { recursive: true, mode: 0o700 });
          await mkdir(helper.scope.runtimeRoot, { recursive: true, mode: 0o700 });
          const profile = await terminals.resolveEphemeralAgentExecutionProfile(
            helper.scope,
            { ...DATABASE_ASSISTANT_EXECUTION_PROFILE },
            options
          );
          helper.executionProfile = vibe64AgentExecutionProfileAuditSnapshot(profile);
          await retain();
          task.controller.signal.throwIfAborted();
          result = await runDatabaseAssistant({
            agentContext: options,
            assistant: databaseAssistantAvailability(decision),
            executeReadQuery: (sql) => {
              task.controller.signal.throwIfAborted();
              return sessionQueries.execute(context, { schema, sql, signal: task.controller.signal });
            },
            messages: input.messages,
            runAgentTurn: (turnInput, turnOptions) => terminals.runEphemeralAgentChatTurn(
              helper.scope,
              { ...turnInput, executionProfile: profile },
              turnOptions
            ),
            schema
          });
        } catch (error) {
          failure = error;
        }
        // This service is the helper's only cleanup owner. A cleanup failure
        // fails an otherwise successful question; after a failed question it
        // is attached as the cause, so the original reason stays visible.
        // Either way the retained artifact blocks the next question and is
        // retried on session close.
        try {
          await cleanupAssistant(runtime, context.sessionId, artifact, context.vibe64User, sessionStorage(runtime));
        } catch (cleanupError) {
          if (failure) failure.cause ??= cleanupError;
          else failure = cleanupError;
        }
        sessionDatabase.logOperation(context, failure ? {
          code: failure.code,
          durationMs: Date.now() - startedAt,
          operation: "assistant.ask",
          status: "failed"
        } : {
          durationMs: Date.now() - startedAt,
          model: result.model,
          operation: "assistant.ask",
          queryCount: result.queries.length,
          schemaLookupCount: result.schemaLookups.length,
          status: "succeeded"
        }, failure ? "warn" : "info");
        if (failure) throw failure;
        return result;
      });
      if (!admitted.acquired) {
        throw databaseError(
          admitted.value?.error || "The session is unavailable for a database question.",
          admitted.value?.code || "vibe64_database_assistant_busy"
        );
      }
      return admitted.value;
    }).finally(() => activeAssistants.delete(task));
    activeAssistants.add(task);
    return task.promise;
  }

  /**
   * Aborts every running question; the result settles once they all have.
   */
  function abortAll() {
    const tasks = [...activeAssistants];
    for (const task of tasks) task.controller.abort();
    return Promise.allSettled(tasks.map((task) => task.promise));
  }

  return Object.freeze({
    assistantDecision,
    closeAssistantsForSession,
    closeRenewalAssistantsForSession,
    askAssistant,
    abortAll
  });
}

export {
  createDatabaseAssistantTasks
};
