import { constants as fsConstants } from "node:fs";
import {
  access,
  readFile
} from "node:fs/promises";
import path from "node:path";

import {
  createDoctorRepair,
  failDoctorCheck,
  passDoctorCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  buildDoctorHostCommandArgs
} from "./doctorHostCommand.js";
import {
  runDoctorGatewayCommand
} from "./doctorCommandRunner.js";
import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";
import {
  RUNTIME_CONFIG_TARGETS,
  normalizeRuntimeConfigPhases
} from "@local/vibe64-core/server/runtimeConfig";
import {
  runVibe64Command,
  shellQuote
} from "@local/vibe64-execution/server";

function resolveOption(option, context = {}) {
  return typeof option === "function" ? option(context) : option;
}

function isAsyncResolver(value) {
  return typeof value === "function" && value.constructor?.name === "AsyncFunction";
}

async function resolveOptionAsync(option, context = {}) {
  return typeof option === "function" ? await option(context) : option;
}

function textValue(value = "") {
  return String(value || "");
}

function textArrayValue(value = [], context = {}) {
  const resolved = resolveOption(value, context);
  return Array.isArray(resolved) ? resolved.map(textValue) : [];
}

async function textValueAsync(value = "", context = {}) {
  return textValue(await resolveOptionAsync(value, context));
}

async function textArrayValueAsync(value = [], context = {}) {
  const resolved = await resolveOptionAsync(value, context);
  return Array.isArray(resolved) ? resolved.map(textValue) : [];
}

async function objectValueAsync(value = {}, context = {}) {
  const resolved = await resolveOptionAsync(value, context);
  return resolved && typeof resolved === "object" && !Array.isArray(resolved) ? resolved : {};
}

async function runtimeConfigEnvForTerminalAction({
  context = {},
  runtimeConfigEnvironment = null,
  runtimeConfigPhases = [],
  targetRoot = ""
} = {}) {
  const phases = normalizeRuntimeConfigPhases(resolveOption(runtimeConfigPhases, context));
  if (!phases.length || typeof runtimeConfigEnvironment !== "function") {
    return {};
  }
  return objectValueAsync(runtimeConfigEnvironment({
    phases,
    target: RUNTIME_CONFIG_TARGETS.COMMAND,
    targetRoot: context.targetRoot || targetRoot
  }));
}

function isMissingPathError(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

function pathInsideRoot(root = "", relativePath = "") {
  return path.join(textValue(root), textValue(relativePath));
}

function defaultCommandPreview(command = "", args = []) {
  return [command, ...args].filter(Boolean).map(shellQuote).join(" ");
}

function validationErrorFrom(result, fallbackError = "Validation failed.") {
  if (result === null || result === undefined || result === true) {
    return null;
  }
  if (result === false) {
    return {
      error: fallbackError,
      ok: false
    };
  }
  if (typeof result === "string") {
    return {
      error: result,
      ok: false
    };
  }
  if (typeof result === "object") {
    if (result.ok === true) {
      return null;
    }
    return {
      ok: false,
      ...result
    };
  }
  return {
    error: fallbackError,
    ok: false
  };
}

function createDoctorPluginToolkit({
  runCommand: runGatewayCommandForToolkit = runDoctorGatewayCommand,
  runTerminalCommand = runVibe64Command,
  studioRoot = "",
  targetRoot = "",
  terminalEnv = {},
  terminalNamespace = ""
} = {}) {
  // Root helpers: adapters can work with the Studio checkout and the target project without rebuilding paths.
  function targetRootFor(context = {}) {
    return textValue(context.targetRoot || targetRoot);
  }

  function studioRootFor(context = {}) {
    return textValue(context.studioRoot || studioRoot);
  }

  function targetPath(relativePath = "", context = {}) {
    return pathInsideRoot(targetRootFor(context), relativePath);
  }

  function studioPath(relativePath = "", context = {}) {
    return pathInsideRoot(studioRootFor(context), relativePath);
  }

  function targetConfigPath(relativePath = "", context = {}) {
    return targetPath(path.join("config", textValue(relativePath)), context);
  }

  function studioConfigPath(relativePath = "", context = {}) {
    return studioPath(path.join("config", textValue(relativePath)), context);
  }

  // File helpers: adapters get consistent missing-file and JSON-parse results.
  async function fileExists(filePath = "") {
    try {
      await access(filePath, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async function readTextFile(filePath = "") {
    try {
      return {
        error: "",
        missing: false,
        ok: true,
        path: filePath,
        value: await readFile(filePath, "utf8")
      };
    } catch (error) {
      return {
        error: textValue(error?.message || error),
        missing: isMissingPathError(error),
        ok: false,
        path: filePath,
        value: ""
      };
    }
  }

  async function readJsonFile(filePath = "") {
    const text = await readTextFile(filePath);
    if (!text.ok) {
      return {
        ...text,
        value: null
      };
    }
    try {
      return {
        error: "",
        missing: false,
        ok: true,
        path: filePath,
        value: JSON.parse(text.value)
      };
    } catch (error) {
      return {
        error: textValue(error?.message || error),
        missing: false,
        ok: false,
        path: filePath,
        value: null
      };
    }
  }

  function targetFileExists(relativePath = "", context = {}) {
    return fileExists(targetPath(relativePath, context));
  }

  function targetConfigFileExists(relativePath = "", context = {}) {
    return fileExists(targetConfigPath(relativePath, context));
  }

  function studioFileExists(relativePath = "", context = {}) {
    return fileExists(studioPath(relativePath, context));
  }

  function studioConfigFileExists(relativePath = "", context = {}) {
    return fileExists(studioConfigPath(relativePath, context));
  }

  function readTargetFile(relativePath = "", context = {}) {
    return readTextFile(targetPath(relativePath, context));
  }

  function readTargetConfigFile(relativePath = "", context = {}) {
    return readTextFile(targetConfigPath(relativePath, context));
  }

  function readStudioFile(relativePath = "", context = {}) {
    return readTextFile(studioPath(relativePath, context));
  }

  function readStudioConfigFile(relativePath = "", context = {}) {
    return readTextFile(studioConfigPath(relativePath, context));
  }

  function readTargetJson(relativePath = "", context = {}) {
    return readJsonFile(targetPath(relativePath, context));
  }

  function readTargetConfigJson(relativePath = "", context = {}) {
    return readJsonFile(targetConfigPath(relativePath, context));
  }

  function readStudioJson(relativePath = "", context = {}) {
    return readJsonFile(studioPath(relativePath, context));
  }

  function readStudioConfigJson(relativePath = "", context = {}) {
    return readJsonFile(studioConfigPath(relativePath, context));
  }

  // Command helpers: adapters describe commands; Studio owns execution and result formatting.
  async function runCommand({
    args = [],
    command = "",
    cwd = "",
    input,
    timeout = 15_000
  } = {}, context = {}) {
    return runGatewayCommandForToolkit(
      textValue(resolveOption(command, context)),
      textArrayValue(args, context),
      {
        cwd: textValue(resolveOption(cwd, context)),
        input: resolveOption(input, context),
        timeout
      }
    );
  }

  function commandCheck({
    args = [],
    command = "",
    cwd = "",
    expected = "",
    explanation = "",
    id = "",
    input,
    label = "",
    repair = null,
    timeout = 15_000,
    validate = (output) => String(output || "").trim().length > 0
  } = {}) {
    return {
      expected,
      id,
      label,
      async run(context = {}) {
        const result = await runCommand({
          args,
          command,
          cwd,
          input,
          timeout
        }, context);
        const validationError = result.ok
          ? validationErrorFrom(validate(result.output, result), "Command check validation failed.")
          : null;

        if (!result.ok || validationError) {
          return failDoctorCheck({
            id,
            label,
            expected,
            observed: validationError?.error || result.output,
            explanation,
            repair: resolveOption(repair, context)
          });
        }

        return passDoctorCheck({
          id,
          label,
          expected,
          observed: result.output,
          explanation
        });
      }
    };
  }

  async function runHostToolCommand(commandArgs = [], options = {}, context = {}) {
    const {
      env = {},
      gitTransport = "none",
      runtimeConfigEnvironment = null,
      runtimeConfigPhases = [],
      runtimes = [],
      targetRoot: optionTargetRoot = "",
      timeout
    } = options;
    const hostCommandTargetRoot = textValue(optionTargetRoot || targetRoot);
    const argv = buildDoctorHostCommandArgs(commandArgs);
    const [command, ...args] = argv;
    if (!command) {
      return {
        error: "Doctor tool command is empty.",
        exitCode: 1,
        ok: false,
        output: "Doctor tool command is empty.",
        stderr: "Doctor tool command is empty.",
        stdout: ""
      };
    }
    const commandContext = {
      ...context,
      targetRoot: hostCommandTargetRoot
    };
    const runtimeConfigEnv = await runtimeConfigEnvForTerminalAction({
      context: commandContext,
      runtimeConfigEnvironment,
      runtimeConfigPhases,
      targetRoot: hostCommandTargetRoot
    });
    return runGatewayCommandForToolkit(command, args, {
      cwd: hostCommandTargetRoot || undefined,
      env: await objectValueAsync(env, commandContext),
      gitTransport: textValue(resolveOption(gitTransport, commandContext)) || "none",
      project: {
        runtimeConfigEnv
      },
      runtimes: textArrayValue(runtimes, commandContext),
      timeout
    });
  }

  // Terminal helpers: adapters describe terminal actions once and reuse them for repairs/start dispatch.
  function terminalAction({
    actionId = "",
    args = [],
    autoRun = false,
    command = "bash",
    commandPreview = "",
    cwd = "",
    env = {},
    fields = [],
    gitTransport = "none",
    input,
    label = "",
    prepare = null,
    runtimeConfigEnvironment = null,
    runtimeConfigPhases = [],
    runtimes = [],
    validate = null
  } = {}) {
    function preview(context = {}) {
      const resolvedCommand = textValue(resolveOption(command, context));
      const resolvedArgs = textArrayValue(args, context);
      return textValue(resolveOption(commandPreview, context)) ||
        defaultCommandPreview(resolvedCommand, resolvedArgs);
    }

    return deepFreeze({
      actionId,
      label,
      repair(context = {}) {
        return createDoctorRepair({
          actionId,
          autoRun,
          command: preview(context),
          fields: resolveOption(fields, context) || [],
          input: resolveOption(input, context),
          kind: "terminal",
          label
        });
      },
      async start(context = {}) {
        const validationError = typeof validate === "function"
          ? validationErrorFrom(validate(context), "Terminal action input is invalid.")
          : null;
        if (validationError) {
          return validationError;
        }
        if (typeof runTerminalCommand !== "function") {
          return null;
        }
        if (typeof prepare === "function") {
          await prepare(context);
        }
        const resolvedTerminalEnv = await objectValueAsync(terminalEnv, context);
        const resolvedEnv = await objectValueAsync(env, context);
        const resolvedCwd = await resolveOptionAsync(cwd, context);
        const targetRoot = targetRootFor(context);
        const runtimeConfigEnv = await runtimeConfigEnvForTerminalAction({
          context,
          runtimeConfigEnvironment,
          runtimeConfigPhases,
          targetRoot
        });
        return runTerminalCommand({
          args: await textArrayValueAsync(args, context),
          command: await textValueAsync(command, context),
          cwd: textValue(resolvedCwd || targetRoot),
          env: {
            ...resolvedTerminalEnv,
            ...resolvedEnv
          },
          envPolicy: "project",
          gitTransport: textValue(resolveOption(gitTransport, context)) || "none",
          mode: "pty",
          project: {
            runtimeConfigEnv,
            targetRoot
          },
          purpose: "setup",
          runtimes: textArrayValue(runtimes, context),
          terminal: {
            commandPreview: preview(context),
            namespace: terminalNamespace
          }
        });
      }
    });
  }

  function commandTerminalAction({
    script,
    ...options
  } = {}) {
    return terminalAction({
      ...options,
      args: (context) => ["-lc", textValue(resolveOption(script, context))],
      command: "bash"
    });
  }

  function hostCommandTerminalAction({
    commandArgs = [],
    ...options
  } = {}) {
    const asyncArgs = isAsyncResolver(commandArgs);
    const syncCommandArgs = (context = {}) => buildDoctorHostCommandArgs(textArrayValue(commandArgs, context));
    const asyncCommandArgs = async (context = {}) => buildDoctorHostCommandArgs(await textArrayValueAsync(commandArgs, context));
    const commandFrom = (argv = []) => textValue(argv[0]);
    const argsFrom = (argv = []) => argv.slice(1);
    return terminalAction({
      ...options,
      args: asyncArgs
        ? async (context) => argsFrom(await asyncCommandArgs(context))
        : (context) => argsFrom(syncCommandArgs(context)),
      command: asyncArgs
        ? async (context) => commandFrom(await asyncCommandArgs(context))
        : (context) => commandFrom(syncCommandArgs(context))
    });
  }

  function startTerminalAction(actions = [], context = {}) {
    const actionId = textValue(context.actionId);
    const action = actions.find((candidate) => candidate?.actionId === actionId);
    return action ? action.start(context) : null;
  }

  // Plugin helper: adapters return a small object with checks plus optional terminal actions.
  function plugin({
    checks = [],
    id = "",
    label = "",
    terminalActions = []
  } = {}) {
    return deepFreeze({
      id,
      label,
      checks(context = {}) {
        return resolveOption(checks, context) || [];
      },
      startTerminal(context = {}) {
        const actions = resolveOption(terminalActions, context) || [];
        return startTerminalAction(Array.isArray(actions) ? actions : [], context);
      }
    });
  }

  async function hostCommandResult({
    commandArgs = [],
    env = {},
    gitTransport = "none",
    runtimeConfigEnvironment = null,
    runtimeConfigPhases = [],
    runtimes = [],
    targetRoot = "",
    timeout = 20_000
  } = {}, context = {}) {
    return runHostToolCommand(commandArgs, {
      env,
      gitTransport,
      runtimeConfigEnvironment,
      runtimeConfigPhases,
      runtimes,
      targetRoot,
      timeout
    }, context);
  }

  function hostCommandCheck({
    commandArgs = [],
    env = {},
    expected = "",
    explanation = "",
    gitTransport = "none",
    id = "",
    label = "",
    repair = null,
    runtimeConfigEnvironment = null,
    runtimeConfigPhases = [],
    runtimes = [],
    targetRoot = "",
    timeout = 20_000,
    validate = (output) => String(output || "").trim().length > 0
  } = {}) {
    return {
      expected,
      id,
      label,
      async run(context = {}) {
        const result = await hostCommandResult({
          commandArgs: textArrayValue(commandArgs, context),
          env,
          gitTransport,
          runtimeConfigEnvironment,
          runtimeConfigPhases,
          runtimes,
          targetRoot: textValue(resolveOption(targetRoot, context) || targetRootFor(context)),
          timeout
        }, context);
        const validationError = result.ok
          ? validationErrorFrom(validate(result.output, result), "Command check validation failed.")
          : null;

        if (!result.ok || validationError) {
          return failDoctorCheck({
            id,
            label,
            expected,
            observed: validationError?.error || result.output,
            explanation,
            repair: resolveOption(repair, context)
          });
        }

        return passDoctorCheck({
          id,
          label,
          expected,
          observed: result.output,
          explanation
        });
      }
    };
  }

  return deepFreeze({
    commandCheck,
    fileExists,
    plugin,
    readJsonFile,
    readStudioConfigFile,
    readStudioConfigJson,
    readStudioFile,
    readStudioJson,
    readTargetConfigFile,
    readTargetConfigJson,
    readTargetFile,
    readTargetJson,
    readTextFile,
    runCommand,
    runHostToolCommand,
    commandTerminalAction,
    startTerminalAction,
    studioConfigFileExists,
    studioConfigPath,
    studioFileExists,
    studioPath,
    targetConfigFileExists,
    targetConfigPath,
    targetFileExists,
    targetPath,
    terminalAction,
    hostCommandCheck,
    hostCommandResult,
    hostCommandTerminalAction
  });
}

export {
  createDoctorPluginToolkit
};
