import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  commandErrorResult
} from "../result.js";
import {
  envRecord
} from "../normalize.js";
import {
  resolveCommandEnv
} from "../env/resolveCommandEnv.js";
import {
  closeTerminalSession,
  startTerminalSession
} from "./terminalSessions.js";
import {
  DEFAULT_EXEC_HELPER_PATH,
  VIBE64_EXEC_HELPER_PATH_ENV,
  helperOperationForRequest,
  helperPayload
} from "./helperClient.js";
import {
  realUserActorRequiresInstalledHelper
} from "../policy/permissionPolicy.js";

const ptyExecutions = new Map();

function ptyHelperPayloadPath(root = "") {
  const resolvedRoot = String(root || "").trim();
  if (!resolvedRoot) {
    const error = new Error("A helper payload root is required for real-user PTY execution.");
    error.code = "vibe64_command_pty_helper_payload_root_required";
    throw error;
  }
  const payloadRoot = path.join(path.resolve(resolvedRoot), "exec-helper-payloads");
  mkdirSync(payloadRoot, {
    mode: 0o700,
    recursive: true
  });
  return path.join(payloadRoot, `${process.pid}-${Date.now()}-${randomUUID()}.json`);
}

function terminalSessionInputForRequest(request = {}, {
  actor,
  baseEnv,
  localPath,
  cwd,
  env
} = {}) {
  const terminal = request.terminal || {};
  if (!realUserActorRequiresInstalledHelper(actor)) {
    return {
      args: request.args,
      command: request.command,
      cwd,
      env: terminalEnvForRequest(request, {
        actor,
        baseEnv,
        localPath,
        policyEnv: env
      })
    };
  }
  return {
    args: (input = {}) => {
      const payloadPath = ptyHelperPayloadPath(terminal.helperPayloadRoot);
      const payloadEnv = terminalEnvForRequest(request, {
        actor,
        baseEnv,
        policyEnv: env
      });
      const payloadArgs = typeof request.args === "function"
        ? request.args(input)
        : request.args;
      const payload = helperPayload({
        actor,
        args: payloadArgs,
        command: request.command,
        cwd,
        env: typeof payloadEnv === "function" ? payloadEnv(input) : payloadEnv,
        input: request.input,
        operation: helperOperationForRequest(request)
      });
      writeFileSync(payloadPath, `${JSON.stringify(payload)}\n`, {
        mode: 0o600
      });
      return [
        "-n",
        process.env[VIBE64_EXEC_HELPER_PATH_ENV] || DEFAULT_EXEC_HELPER_PATH,
        "execute",
        payloadPath
      ];
    },
    command: "sudo",
    cwd: terminal.helperPayloadRoot,
    env: {}
  };
}

function terminalEnvForRequest(request = {}, {
  actor = {},
  baseEnv = {},
  localPath = "",
  policyEnv = {}
} = {}) {
  if (typeof request.envFactory !== "function") {
    return policyEnv;
  }
  return (input = {}) => {
    return resolveCommandEnv({
      actor,
      baseEnv,
      localPath,
      request: {
        ...request,
        env: envRecord(request.envFactory(input)),
        envFactory: null
      }
    });
  };
}

async function runPtyCommand(request = {}, {
  actor,
  baseEnv,
  localPath,
  cwd,
  env
} = {}) {
  try {
    const terminal = request.terminal || {};
    const executionId = request.execution?.id || "";
    const sessionInput = terminalSessionInputForRequest(request, {
      actor,
      baseEnv: baseEnv || env,
      localPath,
      cwd,
      env
    });
    const result = startTerminalSession({
      args: sessionInput.args,
      command: sessionInput.command,
      commandPreview: terminal.commandPreview,
      cwd: sessionInput.cwd,
      detachedIdleTimeoutMs: terminal.detachedIdleTimeoutMs,
      env: sessionInput.env,
      maxRunning: terminal.maxRunning,
      metadata: terminal.metadata,
      namespace: terminal.namespace,
      namespaceLimitPrefix: terminal.namespaceLimitPrefix,
      onClose: async (input) => {
        try {
          if (typeof terminal.onClose === "function") {
            await terminal.onClose(input);
          }
        } finally {
          if (executionId) {
            ptyExecutions.set(executionId, {
              id: input.id,
              namespace: terminal.namespace,
              scopeEmpty: true
            });
          }
        }
      },
      onOutput: terminal.onOutput,
      onStop: terminal.onStop,
      reuseRunning: terminal.reuseRunning,
      runningLimitFilter: terminal.runningLimitFilter
    });
    if (result?.ok === true && executionId) {
      ptyExecutions.set(executionId, {
        id: result.id,
        namespace: terminal.namespace
      });
    }
    return result?.ok === true
      ? {
          ...result,
          execution: request.execution
        }
      : result;
  } catch (error) {
    return commandErrorResult(
      error?.message || "Vibe64 PTY command failed.",
      error?.code || "vibe64_command_pty_failed",
      { execution: request.execution }
    );
  }
}

async function stopPtyExecution(executionId = "") {
  const normalizedExecutionId = String(executionId || "").trim();
  const execution = ptyExecutions.get(normalizedExecutionId);
  if (!execution) {
    return {
      code: "vibe64_execution_not_found",
      error: "The execution is not owned by this process.",
      executionId: normalizedExecutionId,
      ok: false,
      scopeEmpty: false,
      stopped: false
    };
  }
  if (execution.scopeEmpty === true) {
    ptyExecutions.delete(normalizedExecutionId);
    return {
      executionId: normalizedExecutionId,
      ok: true,
      scopeEmpty: true,
      stopped: false
    };
  }
  try {
    const result = await closeTerminalSession(execution.id, {
      namespace: execution.namespace
    });
    ptyExecutions.delete(normalizedExecutionId);
    return {
      executionId: normalizedExecutionId,
      ok: true,
      scopeEmpty: true,
      stopped: result.closed === true
    };
  } catch (error) {
    return {
      code: error?.code || "vibe64_execution_drain_failed",
      error: error?.message || "The terminal execution did not become empty.",
      executionId: normalizedExecutionId,
      ok: false,
      scopeEmpty: false,
      stopped: false
    };
  }
}

export {
  runPtyCommand,
  stopPtyExecution
};
