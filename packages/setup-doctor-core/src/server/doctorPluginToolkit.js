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
  buildDoctorToolchainArgs
} from "./doctorToolchain.js";
import {
  ensureTargetRuntimeNetwork
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";
import {
  dockerCommand,
  runHostCommand,
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";

function resolveOption(option, context = {}) {
  return typeof option === "function" ? option(context) : option;
}

function textValue(value = "") {
  return String(value || "");
}

function textArrayValue(value = [], context = {}) {
  const resolved = resolveOption(value, context);
  return Array.isArray(resolved) ? resolved.map(textValue) : [];
}

function isMissingPathError(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

function pathInsideRoot(root = "", relativePath = "") {
  return path.join(textValue(root), textValue(relativePath));
}

function defaultCommandPreview(command = "", args = []) {
  if (command === "docker") {
    return dockerCommand(args);
  }
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
  runCommand: runHostCommandForToolkit = runHostCommand,
  startTerminalSession = null,
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
    return runHostCommandForToolkit(
      textValue(resolveOption(command, context)),
      textArrayValue(args, context),
      {
        cwd: textValue(resolveOption(cwd, context)),
        input: resolveOption(input, context),
        timeout
      }
    );
  }

  async function runDocker(args = [], options = {}) {
    return runHostCommandForToolkit("docker", args, {
      ...options,
      timeout: options.timeout || 30_000
    });
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

  async function runToolchain(commandArgs = [], options = {}) {
    const {
      image = "",
      targetRoot: optionTargetRoot = "",
      timeout,
      ...toolchainOptions
    } = options;
    const toolchainTargetRoot = textValue(optionTargetRoot || targetRoot);
    if (toolchainTargetRoot) {
      await ensureTargetRuntimeNetwork(toolchainTargetRoot);
    }
    return runDocker(buildDoctorToolchainArgs(commandArgs, {
      ...toolchainOptions,
      ...(image ? { image } : {}),
      targetRoot: toolchainTargetRoot
    }), {
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
    input,
    label = "",
    prepare = null,
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
        if (typeof startTerminalSession !== "function") {
          return null;
        }
        if (typeof prepare === "function") {
          await prepare(context);
        }
        return startTerminalSession({
          args: textArrayValue(args, context),
          command: textValue(resolveOption(command, context)),
          commandPreview: preview(context),
          cwd: textValue(resolveOption(cwd, context) || targetRootFor(context)),
          env: {
            ...(resolveOption(terminalEnv, context) || {}),
            ...(resolveOption(env, context) || {})
          },
          namespace: terminalNamespace
        });
      }
    });
  }

  function shellTerminalAction({
    script,
    ...options
  } = {}) {
    return terminalAction({
      ...options,
      args: (context) => ["-lc", textValue(resolveOption(script, context))],
      command: "bash"
    });
  }

  function dockerTerminalAction(options = {}) {
    return terminalAction({
      ...options,
      command: "docker"
    });
  }

  function toolchainTerminalAction({
    commandArgs = [],
    extraArgs = [],
    image = "",
    targetRoot: actionTargetRoot = "",
    ...options
  } = {}) {
    function toolchainTargetRootForContext(context = {}) {
      return textValue(resolveOption(actionTargetRoot, context) || targetRootFor(context));
    }

    return dockerTerminalAction({
      ...options,
      args: (context) => {
        const toolchainTargetRoot = toolchainTargetRootForContext(context);
        const resolvedImage = textValue(resolveOption(image, context));
        return buildDoctorToolchainArgs(textArrayValue(commandArgs, context), {
          extraArgs: textArrayValue(extraArgs, context),
          ...(resolvedImage ? { image: resolvedImage } : {}),
          targetRoot: toolchainTargetRoot
        });
      },
      prepare: async (context) => {
        const toolchainTargetRoot = toolchainTargetRootForContext(context);
        if (toolchainTargetRoot) {
          await ensureTargetRuntimeNetwork(toolchainTargetRoot);
        }
      }
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

  async function toolchainCommandResult({
    commandArgs = [],
    extraArgs = [],
    image = "",
    targetRoot = "",
    timeout = 20_000
  } = {}) {
    return runToolchain(commandArgs, {
      extraArgs,
      image,
      targetRoot,
      timeout
    });
  }

  function toolchainCommandCheck({
    commandArgs = [],
    expected = "",
    explanation = "",
    extraArgs = [],
    id = "",
    image = "",
    label = "",
    repair = null,
    targetRoot = "",
    timeout = 20_000,
    validate = (output) => String(output || "").trim().length > 0
  } = {}) {
    return {
      expected,
      id,
      label,
      async run(context = {}) {
        const result = await toolchainCommandResult({
          commandArgs: textArrayValue(commandArgs, context),
          extraArgs: textArrayValue(extraArgs, context),
          image: textValue(resolveOption(image, context)),
          targetRoot: textValue(resolveOption(targetRoot, context) || targetRootFor(context)),
          timeout
        });
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
    dockerTerminalAction,
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
    runDocker,
    runToolchain,
    shellTerminalAction,
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
    toolchainCommandCheck,
    toolchainCommandResult,
    toolchainTerminalAction
  });
}

export {
  createDoctorPluginToolkit
};
