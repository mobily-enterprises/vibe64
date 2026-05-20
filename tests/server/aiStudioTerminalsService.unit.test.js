import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  AiStudioSessionRuntime,
  TargetAdapter,
  adapterProjectFacts
} from "../../server/lib/aiStudio/index.js";
import {
  createService
} from "../../packages/ai-studio-terminals/src/server/service.js";
import {
  codexTerminalArgs
} from "../../packages/ai-studio-terminals/src/server/codexTerminal.js";
import {
  COMMAND_RESULT_ENV
} from "../../packages/ai-studio-terminals/src/server/commandTerminalResults.js";
import {
  commandTerminalArgs,
  createCommandTerminalController
} from "../../packages/ai-studio-terminals/src/server/commandTerminal.js";
import {
  resolveShellTerminalCwd,
  shellTerminalArgs
} from "../../packages/ai-studio-terminals/src/server/shellTerminal.js";
import {
  resolveTerminalToolchainImage
} from "../../packages/ai-studio-terminals/src/server/terminalToolchainImage.js";
import {
  maskedTerminalDockerArgs,
  projectTerminalEnvironment
} from "../../packages/ai-studio-terminals/src/server/terminalEnvironment.js";
import {
  CppTargetAdapter
} from "../../server/lib/aiStudio/adapters/cpp/adapter.js";
import {
  CPP_TOOLCHAIN_IMAGE
} from "../../server/lib/aiStudio/adapters/cpp/toolchainIdentity.js";
import {
  JskitTargetAdapter
} from "../../server/lib/aiStudio/adapters/jskit/adapter.js";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "../../server/lib/aiStudio/adapters/jskit/toolchainIdentity.js";
import {
  JSKIT_MARIADB_HOST,
  JSKIT_MARIADB_ROOT_PASSWORD
} from "../../server/lib/aiStudio/adapters/jskit/setupMariaDbRuntime.js";
import {
  LaravelTargetAdapter
} from "../../server/lib/aiStudio/adapters/laravel/adapter.js";
import {
  LARAVEL_TOOLCHAIN_IMAGE
} from "../../server/lib/aiStudio/adapters/laravel/toolchainIdentity.js";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_TOOL_HOME_BIN_PATH,
  STUDIO_TOOL_HOME_NPM_PREFIX,
  STUDIO_TOOL_HOME_PATH
} from "../../server/lib/studioRuntimeIdentity.js";
import {
  STUDIO_MYSQL_CLIENT_CONFIG_DIR
} from "../../server/lib/studioToolHome.js";
import {
  runtimeNetworkName
} from "../../server/lib/aiStudio/runtimeContainers.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

class UnitCommandAdapter extends TargetAdapter {
  constructor() {
    super({
      id: "unit",
      label: "Unit adapter"
    });
  }

  async inspect() {
    return adapterProjectFacts({
      capabilities: {
        unit_command: true
      },
      commands: [
        {
          id: "unit_command",
          label: "Unit command"
        }
      ],
      summary: "Unit adapter"
    });
  }

  async listCommands({ facts = {} } = {}) {
    return facts.commands || [];
  }

  async createCommandTerminalSpec(_commandId, context = {}) {
    return {
      args: [
        "-lc",
        [
          "set -e",
          "printf 'fact:set\\t%s\\t%s\\n' dynamic_done \"$(printf '%s' from-result-file | base64 | tr -d '\\n')\" >> \"$AI_STUDIO_COMMAND_RESULT_FILE\""
        ].join("\n")
      ],
      applySuccessFacts({ facts }) {
        return {
          deleteMetadata: ["stale_value"],
          metadata: {
            dynamic_done: facts.dynamic_done
          }
        };
      },
      command: "bash",
      commandPreview: "bash command result",
      cwd: context.session?.targetRoot,
      ok: true,
      successMessage: "Unit command completed.",
      successMetadata: {
        terminal_done: "yes"
      }
    };
  }
}

function dockerEnvValue(args = [], key = "") {
  const prefix = `${key}=`;
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === "-e" && String(args[index + 1]).startsWith(prefix)) {
      return String(args[index + 1]).slice(prefix.length);
    }
  }
  return "";
}

test("AI Studio Codex terminal joins the target runtime network before the image", () => {
  const targetRoot = "/workspace/project";
  const args = codexTerminalArgs({
    codexThreadId: "",
    containerName: "ai-studio-codex-unit",
    sessionId: "unit-session",
    targetRoot,
    terminalId: "unit-terminal",
    worktree: "/workspace/project/.ai-studio/sessions/active/unit/worktree"
  });

  const networkIndex = args.indexOf("--network");
  assert.notEqual(networkIndex, -1);
  assert.deepEqual(args.slice(networkIndex, networkIndex + 2), ["--network", runtimeNetworkName(targetRoot)]);
  assert.ok(networkIndex < args.indexOf(STUDIO_BASE_TOOLCHAIN_IMAGE));

  const startupScript = args.at(-1);
  assert.ok(startupScript.includes(`export HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(startupScript.includes(`export NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));
  assert.ok(startupScript.includes(`export PATH=${STUDIO_TOOL_HOME_BIN_PATH}:$PATH`));
  assert.match(startupScript, /chown -R "\$AI_STUDIO_HOST_UID:\$AI_STUDIO_HOST_GID" "\$HOME"/u);
  assert.ok(args.includes(`NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));

  const adapterImageArgs = codexTerminalArgs({
    codexThreadId: "",
    containerName: "ai-studio-codex-adapter",
    env: {
      MYSQL_HOST: JSKIT_MARIADB_HOST,
      MYSQL_PWD: JSKIT_MARIADB_ROOT_PASSWORD
    },
    image: "adapter-toolchain:1.0.0",
    sessionId: "unit-session",
    targetRoot,
    terminalId: "adapter-terminal",
    worktree: "/workspace/project/.ai-studio/sessions/active/unit/worktree"
  });
  assert.ok(adapterImageArgs.indexOf("--network") < adapterImageArgs.indexOf("adapter-toolchain:1.0.0"));
  assert.ok(adapterImageArgs.includes(`MYSQL_PWD=${JSKIT_MARIADB_ROOT_PASSWORD}`));
  assert.ok(maskedTerminalDockerArgs(adapterImageArgs).includes("MYSQL_PWD=*****"));
  assert.ok(!maskedTerminalDockerArgs(adapterImageArgs).includes(`MYSQL_PWD=${JSKIT_MARIADB_ROOT_PASSWORD}`));
});

test("AI Studio Codex terminal mounts linked git metadata for worktree roots", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const linkedRepository = path.join(path.dirname(targetRoot), "linked-repository");
    await mkdir(path.join(linkedRepository, ".git"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".git"), `gitdir: ${path.join(linkedRepository, ".git")}\n`);

    const args = codexTerminalArgs({
      codexThreadId: "",
      containerName: "ai-studio-codex-linked-git",
      sessionId: "unit-session",
      targetRoot,
      terminalId: "unit-terminal",
      worktree: path.join(targetRoot, ".ai-studio", "sessions", "active", "unit", "worktree")
    });

    assert.ok(args.includes(`${linkedRepository}:${linkedRepository}`));
  });
});

test("AI Studio shell terminal joins the target runtime network before the image", () => {
  const targetRoot = "/workspace/project";
  const worktree = "/workspace/project/.ai-studio/sessions/active/unit/worktree";
  const args = shellTerminalArgs({
    containerName: "ai-studio-shell-unit",
    env: {
      AI_STUDIO_MYSQL_USER: "root",
      AI_STUDIO_CONFIG_DIR: "/workspace/project/.ai-studio/config",
      MYSQL_HOST: JSKIT_MARIADB_HOST,
      MYSQL_PWD: JSKIT_MARIADB_ROOT_PASSWORD,
      MYSQL_TCP_PORT: "3306"
    },
    sessionId: "unit-session",
    target: "worktree",
    targetRoot,
    terminalId: "unit-terminal",
    workdir: worktree
  });

  const networkIndex = args.indexOf("--network");
  assert.notEqual(networkIndex, -1);
  assert.deepEqual(args.slice(networkIndex, networkIndex + 2), ["--network", runtimeNetworkName(targetRoot)]);
  assert.ok(networkIndex < args.indexOf(STUDIO_BASE_TOOLCHAIN_IMAGE));
  assert.deepEqual(args.slice(args.indexOf("-w"), args.indexOf("-w") + 2), ["-w", worktree]);
  assert.deepEqual(args.slice(args.indexOf("--hostname"), args.indexOf("--hostname") + 2), [
    "--hostname",
    "ai-studio-worktree"
  ]);
  assert.ok(args.includes("AI_STUDIO_CONFIG_DIR=/workspace/project/.ai-studio/config"));
  assert.ok(args.includes(`MYSQL_HOST=${JSKIT_MARIADB_HOST}`));
  assert.ok(args.includes(`MYSQL_PWD=${JSKIT_MARIADB_ROOT_PASSWORD}`));
  assert.ok(args.includes("MYSQL_TCP_PORT=3306"));
  assert.ok(args.includes("AI_STUDIO_MYSQL_USER=root"));
  assert.ok(args.includes("TERM=xterm-256color"));
  assert.ok(args.includes("COLORTERM=truecolor"));
  assert.ok(args.includes("FORCE_COLOR=1"));
  assert.ok(args.includes("USER=studio"));
  assert.ok(args.includes("AI_STUDIO_PROJECT_ROOT=/workspace/project"));
  assert.ok(args.includes(`AI_STUDIO_SHELL_WORKDIR=${worktree}`));
  assert.ok(args.some((arg) => String(arg).startsWith("AI_STUDIO_SHELL_PROMPT=\\[\\e[38;5;39m\\]studio")));
  assert.ok(args.some((arg) => String(arg).startsWith("PS1=\\[\\e[38;5;39m\\]studio")));

  const startupScript = args.at(-1);
  assert.ok(startupScript.includes(`export HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(startupScript.includes(`export NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));
  assert.ok(startupScript.includes(`export PATH=${STUDIO_TOOL_HOME_BIN_PATH}:$PATH`));
  assert.ok(startupScript.includes(`export MYSQL_HOME=${STUDIO_MYSQL_CLIENT_CONFIG_DIR}`));
  assert.ok(startupScript.includes("printf 'user=%s\\n' \"$AI_STUDIO_MYSQL_USER\""));
  assert.ok(startupScript.includes("printf 'database=%s\\n' \"$MYSQL_DATABASE\""));
  assert.ok(startupScript.includes("PROMPT_DIRTRIM=4"));
  assert.ok(startupScript.includes("alias ls='ls --color=auto'"));
  assert.ok(startupScript.includes("PS1=\"${AI_STUDIO_SHELL_PROMPT:-\\w \\$ }\""));
  assert.match(startupScript, /chown -R "\$AI_STUDIO_HOST_UID:\$AI_STUDIO_HOST_GID" "\$HOME"/u);
  assert.match(startupScript, /setpriv .* bash --rcfile \/tmp\/ai-studio-shell\.bashrc -i/u);
});

test("AI Studio command terminal joins the target runtime network before the image", () => {
  const targetRoot = "/workspace/project";
  const worktree = "/workspace/project/.ai-studio/sessions/active/unit/worktree";
  const resultDirectory = "/tmp/ai-studio-command-unit";
  const supportDirectory = "/opt/ai-studio-support";
  const args = commandTerminalArgs({
    args: [
      "-lc",
      "npm test"
    ],
    command: "bash",
    containerName: "ai-studio-command-unit",
    env: {
      [COMMAND_RESULT_ENV]: `${resultDirectory}/result.tsv`,
      MYSQL_HOST: JSKIT_MARIADB_HOST,
      MYSQL_PWD: JSKIT_MARIADB_ROOT_PASSWORD
    },
    image: "adapter-toolchain:1.0.0",
    mounts: [
      {
        readOnly: true,
        source: supportDirectory,
        target: supportDirectory
      }
    ],
    resultFile: {
      directory: resultDirectory,
      path: `${resultDirectory}/result.tsv`
    },
    sessionId: "unit-session",
    targetRoot,
    terminalId: "unit-terminal",
    workdir: worktree
  });

  const networkIndex = args.indexOf("--network");
  assert.notEqual(networkIndex, -1);
  assert.deepEqual(args.slice(networkIndex, networkIndex + 2), ["--network", runtimeNetworkName(targetRoot)]);
  assert.ok(networkIndex < args.indexOf("adapter-toolchain:1.0.0"));
  assert.ok(args.includes(`${targetRoot}:/workspace`));
  assert.ok(args.includes(`${targetRoot}:${targetRoot}`));
  assert.ok(args.includes(`${resultDirectory}:${resultDirectory}`));
  assert.ok(args.includes(`${supportDirectory}:${supportDirectory}:ro`));
  assert.ok(args.includes(`MYSQL_HOST=${JSKIT_MARIADB_HOST}`));
  assert.ok(args.includes(`MYSQL_PWD=${JSKIT_MARIADB_ROOT_PASSWORD}`));
  assert.equal(dockerEnvValue(args, COMMAND_RESULT_ENV), `${resultDirectory}/result.tsv`);

  const startupScript = args.at(-1);
  assert.ok(startupScript.includes(`export HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(startupScript.includes(`export NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));
  assert.match(startupScript, /setpriv .* bash -lc 'npm test'/u);
});

test("AI Studio terminals use the base image when the adapter does not declare one", async () => {
  const result = await resolveTerminalToolchainImage({
    imageExists: async (image) => image === STUDIO_BASE_TOOLCHAIN_IMAGE,
    runtime: {
      adapter: new UnitCommandAdapter(),
      projectConfig: {}
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.image, STUDIO_BASE_TOOLCHAIN_IMAGE);
  assert.equal(result.label, "managed base toolchain");
});

test("AI Studio terminals use declared adapter toolchain images", async () => {
  const result = await resolveTerminalToolchainImage({
    imageExists: async (image) => image === "adapter-toolchain:1.0.0",
    runtime: {
      adapter: {
        async getTerminalToolchainSpec() {
          return {
            image: "adapter-toolchain:1.0.0",
            label: "Adapter toolchain",
            setupActionLabel: "Build adapter toolchain"
          };
        }
      },
      projectConfig: {}
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.image, "adapter-toolchain:1.0.0");
  assert.equal(result.label, "Adapter toolchain");
});

test("AI Studio terminals fail clearly when a declared adapter image is missing", async () => {
  const result = await resolveTerminalToolchainImage({
    imageExists: async () => false,
    runtime: {
      adapter: {
        async getTerminalToolchainSpec() {
          return {
            image: "missing-adapter-toolchain:1.0.0",
            label: "Missing adapter toolchain",
            setupActionLabel: "Build missing adapter toolchain"
          };
        }
      },
      projectConfig: {}
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.image, "missing-adapter-toolchain:1.0.0");
  assert.match(result.error, /Missing adapter toolchain image missing-adapter-toolchain:1\.0\.0 is missing/u);
  assert.match(result.error, /Build missing adapter toolchain/u);
});

test("adapters with managed toolchains declare their terminal toolchain image", async () => {
  assert.equal((await new JskitTargetAdapter().getTerminalToolchainSpec()).image, JSKIT_TOOLCHAIN_IMAGE);
  assert.equal((await new LaravelTargetAdapter().getTerminalToolchainSpec()).image, LARAVEL_TOOLCHAIN_IMAGE);
  assert.equal((await new CppTargetAdapter().getTerminalToolchainSpec()).image, CPP_TOOLCHAIN_IMAGE);
});

test("AI Studio terminal env includes JSKIT managed MariaDB client defaults when selected", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeFile(path.join(targetRoot, ".env"), `DB_HOST=${JSKIT_MARIADB_HOST}\n`, "utf8");
    const configDir = path.join(targetRoot, ".ai-studio", "config");
    const env = await projectTerminalEnvironment({
      projectService: {
        async projectConfigEnvironment() {
          return {
            AI_STUDIO_CONFIG_DIR: configDir
          };
        }
      },
      runtime: {
        adapter: new JskitTargetAdapter(),
        projectConfig: {}
      },
      session: {
        targetRoot
      },
      target: "shell",
      targetRoot
    });

    assert.equal(env.AI_STUDIO_CONFIG_DIR, configDir);
    assert.equal(env.MYSQL_HOST, JSKIT_MARIADB_HOST);
    assert.equal(env.MYSQL_PWD, JSKIT_MARIADB_ROOT_PASSWORD);
    assert.equal(env.MYSQL_TCP_PORT, "3306");
    assert.equal(env.AI_STUDIO_MYSQL_USER, "root");
    assert.equal(env.MYSQL_DATABASE, path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_"));
  });
});

test("AI Studio terminal env includes JSKIT managed MariaDB client defaults when config selects MySQL", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const env = await projectTerminalEnvironment({
      runtime: {
        adapter: new JskitTargetAdapter(),
        projectConfig: {
          values: {
            jskit_database_runtime: "mysql"
          }
        }
      },
      session: {
        targetRoot
      },
      target: "shell",
      targetRoot
    });

    assert.equal(env.MYSQL_HOST, JSKIT_MARIADB_HOST);
    assert.equal(env.MYSQL_PWD, JSKIT_MARIADB_ROOT_PASSWORD);
    assert.equal(env.MYSQL_TCP_PORT, "3306");
    assert.equal(env.AI_STUDIO_MYSQL_USER, "root");
    assert.equal(env.MYSQL_DATABASE, path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_"));
  });
});

test("AI Studio terminal env skips JSKIT MariaDB client defaults when unmanaged", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeFile(path.join(targetRoot, ".env"), "DB_HOST=localhost\n", "utf8");
    const env = await projectTerminalEnvironment({
      runtime: {
        adapter: new JskitTargetAdapter(),
        projectConfig: {}
      },
      session: {
        targetRoot
      },
      target: "shell",
      targetRoot
    });

    assert.equal(env.MYSQL_HOST, undefined);
    assert.equal(env.MYSQL_PWD, undefined);
  });
});

test("AI Studio command terminal records action results and metadata after success", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new UnitCommandAdapter(),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot,
      workflow: {
        id: "unit-terminal",
        steps: [
          {
            actions: [
              {
                adapterCapability: "unit_command",
                id: "unit_command",
                label: "Unit command",
                type: "command"
              }
            ],
            id: "unit_step",
            label: "Unit step"
          }
        ]
      }
    });
    await runtime.createSession({
      metadata: {
        stale_value: "delete me"
      },
      sessionId: "terminal_success"
    });

    let ensuredTargetRoot = "";
    let removedContainerName = "";
    let closePromise = Promise.resolve();
    let startedCommand = "";
    let startedDockerArgs = [];
    const command = createCommandTerminalController({
      ensureRuntimeNetwork: async (root) => {
        ensuredTargetRoot = root;
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {
            AI_STUDIO_CONFIG_DIR: path.join(targetRoot, ".ai-studio", "config")
          };
        }
      },
      removeContainer: async (containerName) => {
        removedContainerName = containerName;
      },
      resolveToolchainImage: async () => ({
        image: "unit-command-toolchain:1.0.0",
        label: "Unit command toolchain",
        ok: true
      }),
      startTerminal: (options) => {
        const id = "unit-command-terminal";
        startedCommand = options.command;
        startedDockerArgs = options.args({
          id,
          namespace: options.namespace
        });
        const resultFilePath = dockerEnvValue(startedDockerArgs, COMMAND_RESULT_ENV);
        assert.ok(resultFilePath);
        closePromise = (async () => {
          await writeFile(
            resultFilePath,
            "fact:set\tdynamic_done\tZnJvbS1yZXN1bHQtZmlsZQ==\n",
            "utf8"
          );
          await options.onClose({
            exitCode: 0,
            id
          });
        })();
        return {
          id,
          ok: true,
          status: "running"
        };
      }
    });

    const terminal = await command.startTerminal("terminal_success", {
      actionId: "unit_command",
      input: {
        dryRun: true
      }
    });
    assert.equal(terminal.ok, true);
    await closePromise;
    assert.equal(startedCommand, "docker");
    assert.equal(ensuredTargetRoot, targetRoot);
    assert.ok(startedDockerArgs.includes("--network"));
    assert.deepEqual(startedDockerArgs.slice(startedDockerArgs.indexOf("--network"), startedDockerArgs.indexOf("--network") + 2), [
      "--network",
      runtimeNetworkName(targetRoot)
    ]);
    assert.ok(startedDockerArgs.indexOf("--network") < startedDockerArgs.indexOf("unit-command-toolchain:1.0.0"));
    assert.match(removedContainerName, /^ai-studio-command-/u);

    const updatedSession = await runtime.getSession("terminal_success");
    assert.equal(updatedSession.metadata.terminal_done, "yes");
    assert.equal(updatedSession.metadata.dynamic_done, "from-result-file");
    assert.equal(updatedSession.metadata.stale_value, undefined);
    assert.deepEqual(updatedSession.actionResult, undefined);
    assert.deepEqual(updatedSession.actionResults.map((result) => ({
      actionId: result.actionId,
      input: result.input,
      message: result.message,
      metadata: result.metadata,
      status: result.status
    })), [
      {
        actionId: "unit_command",
        input: {
          dryRun: true
        },
        message: "Unit command completed.",
        metadata: {
          dynamic_done: "from-result-file",
          terminal_done: "yes"
        },
        status: "completed"
      }
    ]);
    assert.deepEqual(await runtime.store.readCommandLog("terminal_success"), [
      {
        actionId: "unit_command",
        actionLabel: "Unit command",
        actionType: "command",
        at: "2026-05-16T01:02:03.000Z",
        kind: "terminal-action",
        status: "completed",
        stepId: "unit_step"
      }
    ]);
  });
});

test("AI Studio command terminal refuses prompt actions and disabled command actions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-blocked",
        steps: [
          {
            actions: [
              {
                id: "unit_prompt",
                label: "Unit prompt",
                type: "prompt"
              },
              {
                adapterCapability: "missing_capability",
                id: "blocked_command",
                label: "Blocked command",
                type: "command"
              }
            ],
            id: "unit_step",
            label: "Unit step"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "terminal_blocked"
    });
    const service = createService({
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const prompt = await service.startCommandTerminal("terminal_blocked", {
      actionId: "unit_prompt"
    });
    assert.equal(prompt.ok, false);
    assert.match(prompt.error, /does not run in the command terminal/u);

    const disabled = await service.startCommandTerminal("terminal_blocked", {
      actionId: "blocked_command"
    });
    assert.equal(disabled.ok, false);
    assert.match(disabled.error, /does not support capability/u);
  });
});

test("AI Studio shell terminal resolves only declared session targets", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const worktreePath = path.join(targetRoot, ".ai-studio", "sessions", "active", "shell_success", "worktree");
    const session = {
      metadata: {
        worktree_path: worktreePath
      },
      targetRoot
    };
    await mkdir(worktreePath, {
      recursive: true
    });

    const worktree = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session,
      target: "worktree"
    });
    assert.equal(worktree.ok, true);
    assert.equal(worktree.cwd, worktreePath);

    const main = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session,
      target: "main"
    });
    assert.equal(main.ok, true);
    assert.equal(main.cwd, path.resolve(targetRoot));

    const outside = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session: {
        metadata: {
          worktree_path: "/tmp/outside"
        },
        targetRoot
      },
      target: "worktree"
    });
    assert.equal(outside.ok, false);
    assert.match(outside.error, /outside the target root/u);
  });
});

test("AI Studio shell terminal blocks unavailable worktree targets", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const missingWorktree = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session: {
        metadata: {},
        targetRoot
      },
      target: "worktree"
    });
    assert.equal(missingWorktree.ok, false);
    assert.match(missingWorktree.error, /Create the session worktree/u);
  });
});

test("AI Studio shell terminal service rejects invalid targets before Docker startup", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-shell-invalid",
        steps: [
          {
            id: "unit_step",
            label: "Unit step"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "shell_invalid"
    });
    const service = createService({
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const invalid = await service.startShellTerminal("shell_invalid", {
      target: "/tmp"
    });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /worktree or main/u);
  });
});
