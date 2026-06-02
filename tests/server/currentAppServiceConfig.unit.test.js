import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createService,
  resolveCurrentAppRoot
} from "../../packages/current-app/src/server/service.js";
import {
  createService as createProjectService
} from "../../packages/vibe64-project/src/server/service.js";
import {
  createStudioProjectContext
} from "../../packages/vibe64-core/src/server/studioProjectContext.js";

async function withTemporaryRoot(callback) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-current-app-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

function readySetupServices() {
  return {
    adapterSetupService: {
      async getStatus() {
        return {
          ready: true
        };
      }
    },
    accountSetupService: {
      async getStatus() {
        return {
          ready: true
        };
      }
    },
    projectSetupService: {
      async getStatus() {
        return {
          ready: true
        };
      }
    },
    studioSetupService: {
      async getStatus() {
        return {
          ready: true
        };
      }
    }
  };
}

function fakeProjectService({
  adapter = {},
  configReady = true,
  projectTypeReady = true,
  targetRoot
} = {}) {
  return {
    targetRoot,
    currentTargetRoot() {
      return targetRoot;
    },
    async createRuntime() {
      return {
        adapter,
        projectConfig: {
          ready: configReady,
          values: {
            example_config: "yes"
          }
        }
      };
    },
    async projectConfigEnvironment() {
      return {
        VIBE64_CONFIG_DIR: path.join(targetRoot, ".vibe64", "config")
      };
    },
    async readProjectConfig() {
      return {
        config: {
          ready: configReady,
          values: {
            example_config: "yes"
          }
        }
      };
    },
    async readProjectType() {
      return {
        projectType: {
          adapter: projectTypeReady
            ? {
                id: "fake",
                label: "Fake"
              }
            : null,
          projectType: projectTypeReady ? "fake" : "",
          ready: projectTypeReady
        }
      };
    }
  };
}

function fakeAdapter() {
  return {
    async createCurrentAppTargetScriptTerminalSpec() {
      return {
        args: ["-lc", "printf adapter"],
        command: "bash",
        commandPreview: "adapter script",
        ok: true
      };
    },
    async inspectCurrentApp({ targetRoot = "" } = {}) {
      return {
        adapter: "fake",
        appPath: "/",
        config: {},
        directories: [],
        git: {
          enabled: false
        },
        localPackages: {
          appPackageName: "",
          packages: []
        },
        markers: [],
        ok: true,
        ready: true,
        root: targetRoot
      };
    },
    async listCurrentAppTargetScripts() {
      return {
        ok: true,
        scripts: [
          {
            command: "npm run build",
            label: "Build",
            name: "build",
            starredByDefault: true
          },
          {
            command: "npm run verify",
            label: "Verify",
            name: "verify"
          }
        ]
      };
    }
  };
}

test("current-app resolves the launch target root from Vibe64 environment", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const previousTargetRoot = process.env.VIBE64_TARGET_ROOT;
    process.env.VIBE64_TARGET_ROOT = targetRoot;

    try {
      assert.equal(resolveCurrentAppRoot(), targetRoot);
      assert.equal(resolveCurrentAppRoot(path.join(targetRoot, "explicit")), path.join(targetRoot, "explicit"));
    } finally {
      if (previousTargetRoot == null) {
        delete process.env.VIBE64_TARGET_ROOT;
      } else {
        process.env.VIBE64_TARGET_ROOT = previousTargetRoot;
      }
    }
  });
});

test("current-app reports project selection before setup readiness when no project is selected", async () => {
  await withTemporaryRoot(async (root) => {
    const projectService = createProjectService({
      projectContext: createStudioProjectContext({
        explicitProjectsRoot: path.join(root, "projects"),
        env: {},
        home: root
      })
    });
    const service = createService({
      projectService,
      setupServices: readySetupServices()
    });

    const setup = await service.inspectSetupReadiness();
    assert.equal(setup.ready, false);
    assert.equal(setup.currentStage.id, "project-selection");
    assert.deepEqual(setup.stages, []);

    const currentApp = await service.inspectCurrentApp();
    assert.equal(currentApp.ok, true);
    assert.equal(currentApp.ready, false);
    assert.equal(currentApp.root, "");
    assert.equal(currentApp.projectType.status, "no_project_selected");
  });
});

test("current-app reads selected project root from the project service method", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      projectService: {
        currentTargetRoot() {
          return targetRoot;
        },
        async createRuntime() {
          throw new Error("Runtime should not load for setup readiness.");
        }
      },
      setupServices: readySetupServices()
    });

    const setup = await service.inspectSetupReadiness();
    assert.equal(setup.ready, true);
  });
});

test("current-app reports project type, config, and setup gates before adapter inspection", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const beforeProjectType = await createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        projectTypeReady: false,
        targetRoot
      }),
      setupServices: readySetupServices()
    }).inspectCurrentApp();
    assert.equal(beforeProjectType.ready, false);
    assert.equal(beforeProjectType.adapterReady, false);
    assert.equal(beforeProjectType.root, targetRoot);
    assert.equal(beforeProjectType.projectType.ready, false);

    const beforeConfig = await createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        configReady: false,
        targetRoot
      }),
      setupServices: readySetupServices()
    }).inspectCurrentApp();
    assert.equal(beforeConfig.ready, false);
    assert.equal(beforeConfig.projectConfig.ready, false);

    const beforeSetup = await createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        targetRoot
      }),
      setupServices: {
        ...readySetupServices(),
        projectSetupService: {
          async getStatus() {
            return {
              blockedReason: "Project setup is blocked.",
              ready: false
            };
          }
        }
      }
    }).inspectCurrentApp();
    assert.equal(beforeSetup.ready, false);
    assert.equal(beforeSetup.setup.ready, false);
    assert.equal(beforeSetup.setup.message, "Project setup is blocked.");
  });
});

test("current-app reports connections separately from automatic setup capabilities", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        targetRoot
      }),
      setupServices: {
        ...readySetupServices(),
        accountSetupService: {
          async getStatus() {
            return {
              accounts: [
                {
                  connected: false,
                  id: "codex",
                  label: "Codex",
                  message: "Codex is not authenticated for Studio.",
                  status: "not_connected"
                },
                {
                  connected: true,
                  id: "github",
                  label: "GitHub",
                  status: "connected"
                }
              ],
              blockedReason: "Choose and authenticate an AI provider.",
              ok: true,
              ready: false
            };
          }
        }
      }
    });

    const state = await service.inspectCapabilities();
    assert.equal(state.ok, true);
    assert.equal(state.setup.ready, true);
    assert.equal(state.connections.ready, false);
    assert.equal(state.connections.ai.ready, false);
    assert.equal(state.connections.github.ready, true);
    assert.equal(state.capabilities.home.enabled, true);
    assert.equal(state.capabilities.chat.enabled, false);
    assert.equal(state.capabilities.chat.fix.route, "/home/dashboard/connections");
    assert.match(state.capabilities.createSession.reason, /AI provider/u);
  });
});

test("current-app merges adapter scripts with project scripts and stores starred target script ids", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await mkdir(path.join(targetRoot, ".vibe64", "scripts"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".vibe64", "scripts", "local-check"), "echo ok\n", "utf8");
    const service = createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        adapter: fakeAdapter(),
        targetRoot
      }),
      setupServices: readySetupServices()
    });

    const listed = await service.listTargetScripts();
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.scripts.map((script) => script.id), [
      "adapter:build",
      "adapter:verify",
      "project:local-check"
    ]);
    assert.deepEqual(listed.starredScriptIds, ["adapter:build"]);

    const saved = await service.saveStarredTargetScripts({
      scriptIds: ["project:local-check", "adapter:verify"]
    });
    assert.equal(saved.ok, true);
    assert.deepEqual(saved.starredScriptIds, ["adapter:verify", "project:local-check"]);
    assert.equal(
      await readFile(path.join(targetRoot, ".vibe64", "config", "starred_scripts"), "utf8"),
      "adapter:verify,project:local-check\n"
    );

    const invalid = await service.saveStarredTargetScripts({
      scriptIds: ["missing"]
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.errors[0].code, "invalid_target_script");

    const reset = await service.resetStarredTargetScripts();
    assert.equal(reset.ok, true);
    assert.deepEqual(reset.starredScriptIds, ["adapter:build"]);
    await assert.rejects(access(path.join(targetRoot, ".vibe64", "config", "starred_scripts")), {
      code: "ENOENT"
    });
  });
});

test("current-app rejects target script terminal starts before spawning unknown commands", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        adapter: fakeAdapter(),
        targetRoot
      }),
      setupServices: readySetupServices()
    });

    const missingInput = await service.startTargetScriptTerminal({});
    assert.equal(missingInput.ok, false);
    assert.equal(missingInput.errors[0].code, "missing_target_script");

    const unknown = await service.startTargetScriptTerminal({
      scriptId: "adapter:missing"
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.errors[0].code, "invalid_target_script");
  });
});
