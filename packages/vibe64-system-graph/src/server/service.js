import crypto from "node:crypto";

import {
  normalizeText,
  pathExists,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";

import {
  defaultSystemAdapterRegistry
} from "./adapters/registry.js";
import {
  evidenceFingerprint,
  applySystemFindings
} from "./findings.js";
import {
  readGitSnapshot
} from "./gitSnapshot.js";
import {
  entityDetails,
  entityEvidence,
  fileConstellation,
  systemOverview
} from "./modelProjections.js";
import {
  readSystemDocument,
  systemDeclarationsDigest,
  writeSystemDocument
} from "./systemDocument.js";
import {
  decodeSystemKey
} from "./systemKeys.js";
import {
  buildUpdatedSystemModel
} from "./updateSystem.js";

const SYSTEM_UPDATE_EVENT_LIMIT = 500;
const SYSTEM_UPDATE_TASK_LIMIT = 100;

function systemResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_system_graph_failed",
    fallbackMessage: "Vibe64 System operation failed."
  });
}

function systemError(message, code, statusCode = 400, details = {}) {
  const error = vibe64Error(message, code);
  error.details = details;
  error.statusCode = statusCode;
  return error;
}

function adapterIdForContext(runtime, session = {}) {
  return normalizeText(
    runtime.adapter?.id ||
    session.metadata?.adapter_id ||
    session.metadata?.project_type
  );
}

function updateContextKey(context) {
  return `${context.sessionId}\u0000${context.sourceRoot}`;
}

function publicUpdateTask(task = {}, { reused = false } = {}) {
  return {
    adapterId: task.adapterId,
    error: task.error || null,
    eventCount: task.events?.length || 0,
    reused,
    sessionId: task.sessionId,
    status: task.status,
    updateId: task.updateId
  };
}

function updateEvent(task, type, payload = {}) {
  const event = {
    at: new Date().toISOString(),
    sequence: task.events.length + 1,
    type,
    ...payload
  };
  task.events.push(event);
  if (task.events.length > SYSTEM_UPDATE_EVENT_LIMIT) {
    task.events.splice(0, task.events.length - SYSTEM_UPDATE_EVENT_LIMIT);
  }
  for (const listener of task.listeners) {
    listener();
  }
  task.listeners.clear();
  return event;
}

function updateTaskDone(task = {}) {
  return task.status === "completed" || task.status === "failed";
}

function stableDeclarations(declarations = []) {
  return [...declarations].sort((left, right) => (
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  ));
}

function createService({
  adapterRegistry = defaultSystemAdapterRegistry,
  documentReader = readSystemDocument,
  documentWriter = writeSystemDocument,
  modelBuilder = buildUpdatedSystemModel,
  projectService,
  snapshotReader = readGitSnapshot
} = {}) {
  if (!projectService || typeof projectService.createRuntime !== "function") {
    throw new TypeError("createService requires feature.vibe64-project.service.");
  }
  const updateTasks = new Map();
  const activeUpdates = new Map();

  async function systemContext(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      throw systemError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    }
    const runtime = await projectService.createRuntime({
      sessionId: normalizedSessionId
    });
    const session = await runtime.getSession(normalizedSessionId);
    const sourceRoot = sessionSourcePath(session);
    if (!sourceRoot || !await pathExists(sourceRoot)) {
      throw systemError(
        "Create the active session source before opening System.",
        "vibe64_system_source_unavailable",
        409,
        { sessionId: normalizedSessionId }
      );
    }
    const adapterId = adapterIdForContext(runtime, session);
    return {
      adapter: adapterRegistry.adapterFor(adapterId),
      adapterId,
      runtime,
      session,
      sessionId: normalizedSessionId,
      sourceRoot
    };
  }

  function requireSupportedContext(context) {
    if (!context.adapter) {
      throw systemError(
        `System browsing is not supported for the ${context.adapterId || "selected"} project adapter yet.`,
        "vibe64_system_adapter_unsupported",
        409,
        { adapterId: context.adapterId }
      );
    }
    return context;
  }

  async function requiredDocument(context) {
    const record = await documentReader(context.sourceRoot);
    if (!record.exists || !record.model) {
      throw systemError(
        "Run Update System to create vibe64.system.json for this session.",
        "vibe64_system_document_missing",
        409,
        { sessionId: context.sessionId }
      );
    }
    return record;
  }

  function currentTask(context) {
    const updateId = activeUpdates.get(updateContextKey(context));
    return updateId ? updateTasks.get(updateId) || null : null;
  }

  async function modelStatus(context, documentRecord = null) {
    const task = currentTask(context);
    if (task && !updateTaskDone(task)) {
      const activeDocument = documentRecord || await documentReader(context.sourceRoot);
      return {
        adapterId: context.adapterId,
        current: false,
        documentExists: activeDocument.exists === true,
        status: "updating",
        update: publicUpdateTask(task)
      };
    }
    if (!context.adapter) {
      return {
        adapterId: context.adapterId,
        current: false,
        documentExists: false,
        status: "unsupported",
        update: null
      };
    }
    const record = documentRecord || await documentReader(context.sourceRoot);
    if (!record.exists || !record.model) {
      return {
        adapterId: context.adapterId,
        current: false,
        documentExists: false,
        status: "missing",
        update: task ? publicUpdateTask(task) : null
      };
    }
    const snapshot = await snapshotReader(context.sourceRoot);
    const declarationsDigest = systemDeclarationsDigest(record.model.declarations);
    const adapterCurrent = record.model.adapter?.id === context.adapter.id &&
      record.model.adapter?.version === context.adapter.version;
    const sourceCurrent = record.model.input?.sourceDigest === snapshot.digest;
    const declarationsCurrent = record.model.input?.declarationsDigest === declarationsDigest;
    return {
      adapterId: context.adapterId,
      bytes: record.bytes,
      coverage: record.model.coverage,
      current: adapterCurrent && sourceCurrent && declarationsCurrent,
      documentExists: true,
      status: adapterCurrent && sourceCurrent && declarationsCurrent ? "current" : "stale",
      update: task ? publicUpdateTask(task) : null
    };
  }

  function trimUpdateTasks() {
    if (updateTasks.size <= SYSTEM_UPDATE_TASK_LIMIT) {
      return;
    }
    for (const [updateId, task] of updateTasks) {
      if (updateTaskDone(task) && updateTasks.size > SYSTEM_UPDATE_TASK_LIMIT) {
        updateTasks.delete(updateId);
      }
    }
  }

  async function runUpdateAttempt(task, context, initialDocument) {
    const declarations = initialDocument.model?.declarations || [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const before = await snapshotReader(context.sourceRoot);
      updateEvent(task, "system-update.analysis-started", {
        attempt,
        changedPaths: before.changedPaths.length
      });
      const result = await modelBuilder({
        adapterId: context.adapterId,
        adapterRegistry,
        declarations,
        previousModel: initialDocument.model,
        snapshot: before,
        sourceRoot: context.sourceRoot
      });
      const after = await snapshotReader(context.sourceRoot);
      if (before.digest !== after.digest) {
        if (attempt < 2) {
          updateEvent(task, "system-update.source-raced", {
            attempt,
            retrying: true
          });
          continue;
        }
        throw systemError(
          "The session source changed while System was analyzing it. Retry the update.",
          "vibe64_system_source_raced",
          409
        );
      }
      const latestDocument = await documentReader(context.sourceRoot);
      if (latestDocument.contentHash !== initialDocument.contentHash) {
        throw systemError(
          "vibe64.system.json changed while System was updating. Review it and retry.",
          "vibe64_system_document_changed",
          409
        );
      }
      updateEvent(task, "system-update.writing", {
        scopes: result.scopes,
        updateMode: result.updateMode
      });
      const written = await documentWriter(context.sourceRoot, result.model);
      return {
        bytes: written.bytes,
        delta: result.delta,
        fallbackReason: result.fallbackReason,
        updateMode: result.updateMode,
        updateReason: result.updateReason
      };
    }
    throw new Error("System update retry loop ended unexpectedly.");
  }

  async function executeUpdate(task, context) {
    try {
      task.status = "running";
      updateEvent(task, "system-update.started", {
        adapterId: context.adapterId
      });
      const initialDocument = await documentReader(context.sourceRoot);
      const result = await runUpdateAttempt(task, context, initialDocument);
      task.result = result;
      task.status = "completed";
      updateEvent(task, "system-update.completed", result);
    } catch (error) {
      task.error = {
        code: String(error?.code || "vibe64_system_update_failed"),
        message: String(error?.message || error || "System update failed.")
      };
      task.status = "failed";
      updateEvent(task, "system-update.failed", {
        error: task.error
      });
    } finally {
      activeUpdates.delete(updateContextKey(context));
      trimUpdateTasks();
    }
  }

  async function waitForTaskEvent(task, timeoutMs = 1000) {
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        task.listeners.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      task.listeners.add(finish);
    });
  }

  return Object.freeze({
    async readStatus(input = {}) {
      return systemResult(async () => {
        const context = await systemContext(input.sessionId);
        try {
          return {
            ok: true,
            ...await modelStatus(context)
          };
        } catch (error) {
          return {
            adapterId: context.adapterId,
            current: false,
            documentExists: true,
            error: {
              code: String(error?.code || "vibe64_system_document_invalid"),
              message: String(error?.message || error)
            },
            ok: true,
            status: "failed",
            update: null
          };
        }
      });
    },

    async readOverview(input = {}) {
      return systemResult(async () => {
        const context = requireSupportedContext(await systemContext(input.sessionId));
        const document = await requiredDocument(context);
        return {
          ok: true,
          overview: systemOverview(document.model),
          systemStatus: await modelStatus(context, document)
        };
      });
    },

    async readEntity(input = {}) {
      return systemResult(async () => {
        const context = requireSupportedContext(await systemContext(input.sessionId));
        const document = await requiredDocument(context);
        const entityId = decodeSystemKey(input.entityKey);
        const details = entityDetails(document.model, entityId);
        if (!details) {
          throw systemError("System entity was not found.", "vibe64_system_entity_not_found", 404);
        }
        return {
          details,
          ok: true
        };
      });
    },

    async readEntityEvidence(input = {}) {
      return systemResult(async () => {
        const context = requireSupportedContext(await systemContext(input.sessionId));
        const document = await requiredDocument(context);
        const entityId = decodeSystemKey(input.entityKey);
        const evidence = entityEvidence(document.model, entityId);
        if (!evidence) {
          throw systemError("System entity was not found.", "vibe64_system_entity_not_found", 404);
        }
        return {
          evidence,
          ok: true
        };
      });
    },

    async readFileConstellation(input = {}) {
      return systemResult(async () => {
        const context = requireSupportedContext(await systemContext(input.sessionId));
        const document = await requiredDocument(context);
        const fileId = decodeSystemKey(input.fileKey);
        const constellation = fileConstellation(document.model, fileId);
        if (!constellation) {
          throw systemError("System file was not found.", "vibe64_system_file_not_found", 404);
        }
        return {
          constellation,
          ok: true
        };
      });
    },

    async readFindings(input = {}) {
      return systemResult(async () => {
        const context = requireSupportedContext(await systemContext(input.sessionId));
        const document = await requiredDocument(context);
        return {
          findings: document.model.findings,
          ok: true,
          systemStatus: await modelStatus(context, document)
        };
      });
    },

    async startUpdate(input = {}) {
      return systemResult(async () => {
        const context = requireSupportedContext(await systemContext(input.sessionId));
        const activeTask = currentTask(context);
        if (activeTask && !updateTaskDone(activeTask)) {
          return {
            ok: true,
            update: publicUpdateTask(activeTask, { reused: true })
          };
        }
        const updateId = crypto.randomUUID();
        const task = {
          adapterId: context.adapterId,
          error: null,
          events: [],
          listeners: new Set(),
          result: null,
          sessionId: context.sessionId,
          sourceRoot: context.sourceRoot,
          status: "queued",
          updateId
        };
        updateTasks.set(updateId, task);
        activeUpdates.set(updateContextKey(context), updateId);
        void executeUpdate(task, context);
        return {
          ok: true,
          update: publicUpdateTask(task)
        };
      });
    },

    async streamUpdate(input = {}, { emit, isClosed = () => false } = {}) {
      const context = requireSupportedContext(await systemContext(input.sessionId));
      const task = updateTasks.get(normalizeText(input.updateId));
      if (!task || task.sessionId !== context.sessionId || task.sourceRoot !== context.sourceRoot) {
        throw systemError("System update was not found.", "vibe64_system_update_not_found", 404);
      }
      let cursor = 0;
      while (!isClosed()) {
        while (cursor < task.events.length) {
          emit(task.events[cursor]);
          cursor += 1;
        }
        if (updateTaskDone(task)) {
          return;
        }
        await waitForTaskEvent(task);
      }
    },

    async acceptFinding(input = {}) {
      return systemResult(async () => {
        const context = requireSupportedContext(await systemContext(input.sessionId));
        const document = await requiredDocument(context);
        const findingId = normalizeText(input.findingId);
        const finding = document.model.findings.find((candidate) => candidate.id === findingId);
        if (!finding) {
          throw systemError("System finding was not found.", "vibe64_system_finding_not_found", 404);
        }
        const declaration = {
          kind: "finding-acceptance",
          rule: finding.rule,
          entityIds: [...finding.entityIds].sort(),
          evidenceFingerprint: evidenceFingerprint(finding.evidenceIds),
          ...(normalizeText(input.reason) ? { reason: normalizeText(input.reason).slice(0, 1000) } : {})
        };
        const declarations = document.model.declarations || [];
        const duplicate = declarations.some((candidate) => (
          candidate.kind === declaration.kind &&
          candidate.rule === declaration.rule &&
          candidate.evidenceFingerprint === declaration.evidenceFingerprint &&
          JSON.stringify(candidate.entityIds || []) === JSON.stringify(declaration.entityIds)
        ));
        if (!duplicate) {
          document.model.declarations = stableDeclarations([...declarations, declaration]);
          document.model.input.declarationsDigest = systemDeclarationsDigest(document.model.declarations);
          applySystemFindings(document.model);
          await documentWriter(context.sourceRoot, document.model);
        }
        return {
          finding: document.model.findings.find((candidate) => candidate.id === findingId),
          ok: true
        };
      });
    }
  });
}

export {
  createService
};
