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
  processMatchesActor,
  realUserActorRequiresInstalledHelper
} from "./policy/permissionPolicy.js";
import {
  normalizeVibe64CommandRequest
} from "./request.js";
import {
  commandErrorResult
} from "./result.js";

async function runVibe64Command(input = {}) {
  try {
    const request = normalizeVibe64CommandRequest(input);
    const actor = await resolveVibe64CommandActor(request);
    const baseEnv = {
      ...process.env,
      ...request.baseEnv
    };
    const env = resolveCommandEnv({
      actor,
      baseEnv,
      request
    });
    assertActorHomeEnv(actor, env);
    const cwd = assertCwdAllowed(request.cwd, {
      allowedRoots: request.allowedRoots
    });
    const requiresHelper = realUserActorRequiresInstalledHelper(actor);

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
          "vibe64_command_detached_real_user_unsupported"
        );
      }
      return runDetachedCommand(request, {
        actor,
        cwd,
        env
      });
    }
    if (requiresHelper) {
      return runHelperCommand(helperPayload({
        actor,
        args: request.args,
        command: request.command,
        cwd,
        env,
        input: request.input,
        operation: helperOperationForRequest(request)
      }), {
        maxBuffer: request.maxBuffer,
        timeout: request.timeout
      });
    }
    return runCaptureCommand(request.command, request.args, {
      cwd,
      env,
      input: request.input,
      maxBuffer: request.maxBuffer,
      onOutput: request.onOutput,
      timeout: request.timeout
    });
  } catch (error) {
    return commandErrorResult(
      error?.message || "Vibe64 command failed.",
      error?.code || "vibe64_command_failed"
    );
  }
}

export {
  runVibe64Command
};
