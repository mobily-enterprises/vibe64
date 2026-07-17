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
  startTerminalSession
} from "./terminalSessions.js";
import {
  helperOperationForRequest,
  helperPayload
} from "./helperClient.js";
import {
  hostUserExecHelperPath
} from "../hostUserExecution.js";
import {
  realUserActorRequiresInstalledHelper
} from "../policy/permissionPolicy.js";

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
        hostUserExecHelperPath(),
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
  policyEnv = {}
} = {}) {
  if (typeof request.envFactory !== "function") {
    return policyEnv;
  }
  return (input = {}) => {
    return resolveCommandEnv({
      actor,
      baseEnv,
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
  cwd,
  env
} = {}) {
  try {
    const terminal = request.terminal || {};
    const sessionInput = terminalSessionInputForRequest(request, {
      actor,
      baseEnv: baseEnv || env,
      cwd,
      env
    });
    return startTerminalSession({
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
      onClose: terminal.onClose,
      onOutput: terminal.onOutput,
      onStop: terminal.onStop,
      reuseRunning: terminal.reuseRunning,
      runningLimitFilter: terminal.runningLimitFilter
    });
  } catch (error) {
    return commandErrorResult(
      error?.message || "Vibe64 PTY command failed.",
      error?.code || "vibe64_command_pty_failed"
    );
  }
}

export {
  runPtyCommand
};
