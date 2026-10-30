import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveVibe64CommandActor
} from "./actor/resolveActor.js";
import {
  resolveCommandEnv,
  resolveCommandEnvAsync
} from "./env/resolveCommandEnv.js";
import {
  GIT_AUTHOR_EMAIL_ENV,
  GIT_AUTHOR_NAME_ENV,
  GIT_COMMITTER_EMAIL_ENV,
  GIT_COMMITTER_NAME_ENV
} from "./env/gitIdentityEnv.js";
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
  hostIsManaged,
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

// This installation's recorder runtime: the usage recording package installed
// beside this one, or in a node_modules folder above this file.
function usageRecordingRuntimeRoots(fromFile) {
  const candidates = [path.resolve(path.dirname(fromFile), "../../../vibe64-usage-recording/runtime/node")];
  for (let directory = path.dirname(fromFile); ; directory = path.dirname(directory)) {
    candidates.push(path.join(directory, "node_modules/@local/vibe64-usage-recording/runtime/node"));
    if (path.dirname(directory) === directory) break;
  }
  return candidates.flatMap((candidate) => {
    try {
      return [realpathSync(candidate)];
    } catch {
      return [];
    }
  });
}

// The only NODE_OPTIONS a launch receives from Vibe64: the usage recorder's
// preload, accepted as a regular file reached through no symbolic link inside
// this installation's recorder runtime. The host helper keeps its own copy.
function usageRecordingNodeOptions(preload = "", fromFile = fileURLToPath(import.meta.url)) {
  try {
    if (path.resolve(preload) === preload && realpathSync(preload) === preload && statSync(preload).isFile() &&
        usageRecordingRuntimeRoots(fromFile).some((root) => preload.startsWith(`${root}${path.sep}`))) {
      return `--import=${preload}`;
    }
  } catch {
    // Reported below like any other refused path.
  }
  throw Object.assign(new Error("The usage recorder is not part of this Vibe64 installation."), {
    code: "vibe64_usage_recording_preload_invalid"
  });
}

// Release environments and application accounts exist only on a managed host,
// whose helper loads the file and switches to the account.
function managedOnlyRequestError(request) {
  if (request.releaseEnvironmentFile) {
    return commandErrorResult("Release environment execution requires a managed host.",
      "vibe64_release_environment_unavailable", { execution: request.execution });
  }
  if (request.applicationAccount) {
    return commandErrorResult("Application account execution requires a managed host.",
      "vibe64_application_account_unavailable", { execution: request.execution });
  }
  return null;
}

async function runLocalVibe64Command(request, {
  actor,
  cwd,
  env,
  requiresHelper,
  resolveEnv
} = {}) {
  const managedOnly = managedOnlyRequestError(request);
  if (managedOnly) {
    return managedOnly;
  }
  if (request.usageRecordingPreload) {
    const NODE_OPTIONS = usageRecordingNodeOptions(request.usageRecordingPreload);
    const resolveWithoutPreload = resolveEnv;
    env = { ...env, NODE_OPTIONS };
    resolveEnv = (input) => ({ ...resolveWithoutPreload(input), NODE_OPTIONS });
  }
  if (request.mode === "pty") {
    return runPtyCommand(request, {
      actor,
      cwd,
      env,
      resolveEnv
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
    const provider = vibe64ManagedExecutionProvider();
    const managedRequired = vibe64ManagedExecutionRequired(baseEnv) ||
      vibe64ManagedExecutionRequired(process.env);
    const requiresHelper = realUserActorRequiresInstalledHelper(actor);
    // A standalone editor uses the tools on its owner's shell PATH. A managed
    // host and commands crossing Unix identities keep the host policy.
    const managedHost = Boolean(provider) || managedRequired || hostIsManaged();
    const localPath = !managedHost && processMatchesActor(actor)
      ? [baseEnv.PATH, process.env.PATH].filter(Boolean).join(":")
      : "";
    const env = executionEnv(await resolveCommandEnvAsync({
      actor,
      baseEnv,
      localPath,
      request: request.releaseEnvironmentFile ? { ...request, project: {}, session: {} } : request
    }));
    // A PTY env factory is called synchronously per terminal; it carries the
    // Git identity this command already resolved.
    const resolvedGitIdentityEnv = Object.fromEntries([
      GIT_AUTHOR_EMAIL_ENV,
      GIT_AUTHOR_NAME_ENV,
      GIT_COMMITTER_EMAIL_ENV,
      GIT_COMMITTER_NAME_ENV
    ].map((name) => [name, env[name]]));
    assertActorHomeEnv(actor, env);
    // The editor cannot enter an application's area: the host helper resolves
    // an application command's working directory there and confines it.
    const cwd = assertCwdAllowed(request.cwd, {
      allowedRoots: request.allowedRoots,
      resolveLinks: !request.applicationAccount
    });
    assertManagedSourceFilesystemActor(actor, request, cwd);
    const resolveArgs = (input = {}) => typeof request.args === "function"
      ? request.args(input)
      : request.args;
    const resolveEnv = (input = {}) => executionEnv(request.envFactory
      ? resolveCommandEnv({
          actor,
          baseEnv,
          localPath,
          resolvedGitIdentityEnv,
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
        cwd,
        env,
        requiresHelper,
        resolveEnv,
        ...localContext
      }
    );
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
    const managedOnly = managedOnlyRequestError(request);
    if (managedOnly) {
      return managedOnly;
    }
    if (managedRequired) {
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
  runVibe64Command,
  usageRecordingNodeOptions
};
