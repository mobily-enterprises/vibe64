import {
  resolveVibe64CommandActor
} from "./actor/resolveActor.js";
import {
  resolveCommandEnv
} from "./env/resolveCommandEnv.js";
import {
  runCaptureCommand
} from "./engines/capture.js";
import {
  helperOperationForRequest,
  helperPayload,
  runHelperCommand
} from "./engines/helperClient.js";
import {
  runDetachedCommand
} from "./engines/detached.js";
import {
  runPtyCommand
} from "./engines/pty.js";
import {
  assertCwdAllowed
} from "./policy/cwdPolicy.js";
import {
  assertActorHomeEnv,
  assertManagedSourceFilesystemActor,
  processMatchesActor,
  realUserActorRequiresInstalledHelper
} from "./policy/permissionPolicy.js";
import {
  normalizeVibe64CommandRequest
} from "./request.js";
import {
  commandErrorResult
} from "./result.js";
import {
  vibe64ManagedExecutionProvider,
  vibe64ManagedExecutionRequired
} from "./managedExecution.js";

async function runLocalVibe64Command(request, {
  actor,
  baseEnv,
  cwd,
  env,
  requiresHelper
} = {}) {
  if (request.releaseEnvironmentFile) {
    return commandErrorResult("Release environment execution requires a managed host.",
      "vibe64_release_environment_unavailable", { execution: request.execution });
  }
  if (request.mode === "pty") {
    return runPtyCommand(request, {
      actor,
      baseEnv,
      cwd,
      env
    });
  }
  if (request.mode === "detached") {
    if (actor.requiresRealUser && (!processMatchesActor(actor) || requiresHelper)) {
      return commandErrorResult(
        "Detached real-user command execution is unsupported when the helper is required.",
        "vibe64_command_detached_real_user_unsupported",
        { execution: request.execution }
      );
    }
    return runDetachedCommand(request, {
      actor,
      cwd,
      env
    });
  }
  if (requiresHelper) {
    const result = await runHelperCommand(helperPayload({
      actor,
      args: request.args,
      command: request.command,
      cwd,
      env,
      input: request.input,
      operation: helperOperationForRequest(request)
    }), {
      maxBuffer: request.maxBuffer,
      outputEncoding: request.outputEncoding,
      signal: request.signal,
      timeout: request.timeout
    });
    return {
      ...result,
      execution: request.execution
    };
  }
  return runCaptureCommand(request.command, request.args, {
    cwd,
    env,
    execution: request.execution,
    input: request.input,
    maxBuffer: request.maxBuffer,
    onOutput: request.onOutput,
    outputEncoding: request.outputEncoding,
    signal: request.signal,
    timeout: request.timeout
  });
}

async function runVibe64Command(input = {}) {
  let request = null;
  try {
    request = normalizeVibe64CommandRequest(input);
    if (request.signal?.aborted) {
      return commandErrorResult("Command cancelled.", "vibe64_command_cancelled", { execution: request.execution });
    }
    const actor = await resolveVibe64CommandActor(request);
    const baseEnv = request.inheritProcessEnv
      ? {
          ...process.env,
          ...request.baseEnv
        }
      : { ...request.baseEnv };
    const executionEnv = (value = {}) => ({
      ...value,
      VIBE64_EXECUTION_ID: request.execution.id
    });
    const env = executionEnv(resolveCommandEnv({
      actor,
      baseEnv,
      request: request.releaseEnvironmentFile ? { ...request, project: {}, session: {} } : request
    }));
    assertActorHomeEnv(actor, env);
    const cwd = assertCwdAllowed(request.cwd, {
      allowedRoots: request.allowedRoots
    });
    assertManagedSourceFilesystemActor(actor, request, cwd);
    const requiresHelper = realUserActorRequiresInstalledHelper(actor);
    const resolveArgs = (input = {}) => typeof request.args === "function"
      ? request.args(input)
      : request.args;
    const resolveEnv = (input = {}) => executionEnv(request.envFactory
      ? resolveCommandEnv({
          actor,
          baseEnv,
          request: {
            ...request,
            env: request.envFactory(input),
            envFactory: null
          }
        })
      : env);

    const local = (localRequest = request, localContext = {}) => runLocalVibe64Command(
      localRequest,
      {
        actor,
        baseEnv,
        cwd,
        env,
        requiresHelper,
        ...localContext
      }
    );
    const provider = vibe64ManagedExecutionProvider();
    if (provider) {
      return await provider.runCommand(request, {
        actor,
        baseEnv,
        cwd,
        env,
        resolveArgs,
        resolveEnv,
        runLocal: local
      });
    }
    if (request.releaseEnvironmentFile) {
      return commandErrorResult("Release environment execution requires a managed host.",
        "vibe64_release_environment_unavailable", { execution: request.execution });
    }
    if (
      vibe64ManagedExecutionRequired(baseEnv) ||
      vibe64ManagedExecutionRequired(process.env)
    ) {
      return commandErrorResult(
        "Managed execution safety is unavailable. Vibe64 did not start this work.",
        "vibe64_managed_execution_provider_unavailable",
        {
          execution: request.execution,
          retryable: false
        }
      );
    }
    return local();
  } catch (error) {
    return commandErrorResult(
      error?.message || "Vibe64 command failed.",
      error?.code || "vibe64_command_failed",
      { execution: request?.execution }
    );
  }
}

export {
  runVibe64Command
};
