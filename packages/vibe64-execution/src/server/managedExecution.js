import { constants } from "node:os";
import {
  stopCaptureExecution
} from "./engines/capture.js";
import {
  inspectDetachedExecution,
  stopDetachedExecution
} from "./engines/detached.js";
import {
  stopPtyExecution
} from "./engines/pty.js";
import {
  commandErrorResult
} from "./result.js";

let installedProvider = null;
const VIBE64_MANAGED_EXECUTION_REQUIRED_ENV = "VIBE64_MANAGED_EXECUTION_REQUIRED";

function installVibe64ManagedExecutionProvider(provider = null) {
  if (!provider || typeof provider.runCommand !== "function" || typeof provider.stopExecution !== "function") {
    throw new TypeError("A managed execution provider requires runCommand and stopExecution operations.");
  }
  if (installedProvider && installedProvider !== provider) {
    throw new Error("A managed execution provider is already installed.");
  }
  installedProvider = provider;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    if (installedProvider === provider) {
      installedProvider = null;
    }
  };
}

function vibe64ManagedExecutionProvider() {
  return installedProvider;
}

function vibe64ManagedExecutionRequired(env = process.env) {
  return ["1", "true"].includes(String(env?.[VIBE64_MANAGED_EXECUTION_REQUIRED_ENV] || "")
    .trim()
    .toLowerCase());
}

async function startVibe64Workflow(input = {}) {
  if (!installedProvider) {
    if (vibe64ManagedExecutionRequired()) throw new Error("The managed workflow provider is unavailable.");
    return { ok: true, workflow: null };
  }
  if (typeof installedProvider.startWorkflow !== "function") {
    throw new Error("The installed managed execution provider does not support workflows.");
  }
  return installedProvider.startWorkflow(input);
}

async function setVibe64WorkflowPhase(workflowId, phase) {
  if (!workflowId) return;
  if (!installedProvider?.setWorkflowPhase) throw new Error("The managed workflow provider is unavailable.");
  return installedProvider.setWorkflowPhase(workflowId, phase);
}

async function finishVibe64Workflow(workflowId, options = {}) {
  if (!workflowId) return;
  if (!installedProvider?.finishWorkflow) throw new Error("The managed workflow provider is unavailable.");
  return installedProvider.finishWorkflow(workflowId, options);
}

function vibe64CapacityRejectedResult(execution = {}, {
  code = "vibe64_capacity_rejected",
  estimatedMemoryBytes = 0,
  message = "This work cannot start while available memory is this low.",
  safelyAvailableMemoryBytes = 0
} = {}) {
  return commandErrorResult(message, code, {
    execution: {
      estimatedMemoryBytes: Math.max(0, Number(estimatedMemoryBytes) || 0),
      id: String(execution.id || "").trim(),
      kind: String(execution.kind || "").trim(),
      outcome: "capacity_rejected",
      safelyAvailableMemoryBytes: Math.max(0, Number(safelyAvailableMemoryBytes) || 0),
      state: "rejected"
    },
    retryable: false
  });
}

async function inspectVibe64Service(executionId) {
  if (!installedProvider) return inspectDetachedExecution(executionId);
  const result = await installedProvider.inspectExecution(executionId);
  // The execution gateway translates host observations; native-agent adapters
  // must not know systemd's child-status codes or mistake an absent unit for exit 0.
  const reason = String(result.execMainCode || "");
  const status = String(result.execMainStatus ?? "");
  const exited = ["1", "exited"].includes(reason);
  const killed = ["2", "3", "killed", "dumped"].includes(reason);
  const signal = result.signal || (killed ? (status.startsWith("SIG") ? status
    : Object.entries(constants.signals).find(([, number]) => String(number) === status)?.[0]) : null);
  return { ...result,
    running: exited || killed || result.scopeEmpty === true ? false : result.scopeEmpty === false ? true : null,
    exitCode: exited && /^\d+$/u.test(status) ? Number(status) : null,
    signal: signal || null
  };
}

async function stopVibe64Execution(executionId = "", options = {}) {
  const normalizedExecutionId = String(executionId || "").trim();
  if (!normalizedExecutionId) {
    return {
      code: "vibe64_execution_id_required",
      error: "An execution id is required.",
      ok: false
    };
  }
  if (installedProvider) {
    return installedProvider.stopExecution(normalizedExecutionId, options);
  }
  const captured = await stopCaptureExecution(normalizedExecutionId);
  if (captured.code !== "vibe64_execution_not_found") return captured;
  const detached = await stopDetachedExecution(normalizedExecutionId, options);
  if (detached.code !== "vibe64_execution_not_found") {
    return detached;
  }
  return stopPtyExecution(normalizedExecutionId, options);
}

async function stopVibe64OwnedExecutions(selector = {}, options = {}) {
  if (installedProvider?.stopOwnedExecutions) {
    return installedProvider.stopOwnedExecutions(selector, options);
  }
  return {
    closed: 0,
    ok: true,
    processExitProofs: [],
    scopeEmpty: true,
    supported: false
  };
}

export {
  inspectVibe64Service,
  finishVibe64Workflow,
  VIBE64_MANAGED_EXECUTION_REQUIRED_ENV,
  installVibe64ManagedExecutionProvider,
  setVibe64WorkflowPhase,
  startVibe64Workflow,
  stopVibe64Execution,
  stopVibe64OwnedExecutions,
  vibe64CapacityRejectedResult,
  vibe64ManagedExecutionProvider,
  vibe64ManagedExecutionRequired
};
