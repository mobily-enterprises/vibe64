import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TARGET_SCRIPT_TERMINAL_NAMESPACE,
  createService,
  resolveCurrentAppRoot
} from "../../packages/current-app/src/server/service.js";
import {
  createService as createProjectService
} from "../../packages/vibe64-project/src/server/service.js";
import {
  createStudioProjectContext
} from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import {
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  closeTerminalSession,
  readTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
} from "@local/vibe64-core/server/projectRepository";

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
    connectionSetupService: {
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
  createRuntime: createRuntimeOverride = null,
  projectTypeReady = true,
  projectConfigEnvironment: projectConfigEnvironmentOverride = null,
  selectedProject = {
    workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
  },
  runtime = {},
  targetRoot,
  runtimeRoot = path.join(path.dirname(targetRoot), ".vibe64-runtime", "projects", "current-app-test"),
  stateRoot = path.join(path.dirname(targetRoot), ".vibe64", "projects", "current-app-test")
} = {}) {
  return {
    targetRoot,
    selectedProject,
    async listProjects() {
      return {
        currentProject: selectedProject,
        hasSelection: Boolean(selectedProject),
        ok: true,
        projects: selectedProject ? [selectedProject] : []
      };
    },
    currentTargetRoot() {
      return targetRoot;
    },
    currentProjectRuntimeRoot() {
      return runtimeRoot;
    },
    currentProjectSourceRoot() {
      return targetRoot;
    },
    currentProjectSourceConfigRoot() {
      return stateRoot;
    },
    currentProjectStateRoot() {
      return stateRoot;
    },
    async createRuntime(input = {}) {
      if (typeof createRuntimeOverride === "function") {
        return createRuntimeOverride(input);
      }
      return {
        adapter,
        projectConfig: {
          ready: configReady,
          values: {
            example_config: "yes"
          }
        },
        ...runtime
      };
    },
    async projectConfigEnvironment(input = {}) {
      if (typeof projectConfigEnvironmentOverride === "function") {
        return projectConfigEnvironmentOverride(input);
      }
      return {
        VIBE64_CONFIG_DIR: path.join(stateRoot, "config")
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

test("current-app setup readiness omits Studio Setup when runtime manages it outside setup", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let studioSetupCalls = 0;
    const service = createService({
      projectService: fakeProjectService({
        targetRoot
      }),
      setupOptions: {
        includeStudioSetup: false
      },
      setupServices: {
        ...readySetupServices(),
        studioSetupService: {
          async getStatus() {
            studioSetupCalls += 1;
            throw new Error("Studio Setup should not run.");
          }
        }
      }
    });

    const setup = await service.inspectSetupReadiness();

    assert.equal(setup.ready, true);
    assert.equal(studioSetupCalls, 0);
    assert.deepEqual(setup.stages.map((stage) => stage.id), ["project-setup"]);
  });
});

test("current-app capabilities route automatic setup fixes to Project Setup when Studio Setup is omitted", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      projectService: fakeProjectService({
        targetRoot
      }),
      setupOptions: {
        includeStudioSetup: false
      },
      setupServices: {
        ...readySetupServices(),
        projectSetupService: {
          async getStatus() {
            throw new Error("Project Setup diagnostics should not run for capabilities.");
          },
          async getCachedStatus() {
            return {
              blockedReason: "Project setup is blocked.",
              ready: false
            };
          }
        },
        studioSetupService: {
          async getStatus() {
            throw new Error("Studio Setup should not run.");
          }
        }
      }
    });

    const state = await service.inspectCapabilities();

    assert.equal(state.ok, true);
    assert.equal(state.setup.currentStage.id, "project-setup");
    assert.equal(state.capabilities.preview.enabled, false);
    assert.equal(state.capabilities.preview.fix.route, "?tab=project-setup");
  });
});

test("current-app reports project type and config gates before adapter inspection", async () => {
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

    let fullProjectSetupCalls = 0;
    const withoutCachedSetup = await createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        adapter: fakeAdapter(),
        targetRoot
      }),
      setupServices: {
        ...readySetupServices(),
        projectSetupService: {
          async getStatus() {
            fullProjectSetupCalls += 1;
            throw new Error("Project Setup diagnostics should not run for current-app inspection.");
          }
        }
      }
    }).inspectCurrentApp();
    assert.equal(fullProjectSetupCalls, 0);
    assert.equal(withoutCachedSetup.ready, true);
    assert.equal(withoutCachedSetup.adapter, "fake");
  });
});

test("current-app honors cached setup blockers before adapter inspection", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const beforeSetup = await createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        adapter: {
          async inspectCurrentApp() {
            throw new Error("Adapter inspection should not run while cached setup is blocked.");
          }
        },
        targetRoot
      }),
      setupServices: {
        ...readySetupServices(),
        projectSetupService: {
          async getStatus() {
            throw new Error("Project Setup diagnostics should not run for current-app inspection.");
          },
          async getCachedStatus() {
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
        connectionSetupService: {
          async getStatus() {
            return {
              connections: [
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
    assert.equal(state.capabilities.app.enabled, true);
    assert.equal(state.capabilities.chat.enabled, false);
    assert.equal(state.capabilities.chat.fix.route, "?tab=studio-setup");
    assert.match(state.capabilities.createSession.reason, /connection setup/u);
  });
});

test("current-app capabilities do not run uncached project setup diagnostics", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let fullProjectSetupCalls = 0;
    const service = createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        targetRoot
      }),
      setupServices: {
        connectionSetupService: {
          async getStatus() {
            return {
              connections: [
                {
                  connected: true,
                  id: "codex",
                  label: "Codex",
                  ready: true,
                  status: "connected"
                },
                {
                  connected: true,
                  id: "github",
                  label: "GitHub",
                  ready: true,
                  status: "connected"
                }
              ],
              ok: true,
              ready: true
            };
          }
        },
        projectSetupService: {
          async getStatus() {
            fullProjectSetupCalls += 1;
            throw new Error("Project setup diagnostics should not run for capabilities.");
          }
        },
        studioSetupService: {
          async getStatus() {
            return {
              ready: true
            };
          }
        }
      }
    });

    const state = await service.inspectCapabilities();

    assert.equal(state.ok, true);
    assert.equal(fullProjectSetupCalls, 0);
    assert.equal(state.setup.ready, true);
    assert.equal(state.setup.stages.find((stage) => stage.id === "project-setup")?.skipped, true);
    assert.equal(state.capabilities.chat.enabled, true);
    assert.equal(state.capabilities.createSession.enabled, true);
    assert.equal(state.capabilities.preview.enabled, true);
  });
});

test("current-app local-source capabilities do not require GitHub connection for session creation", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        selectedProject: {
          workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
        },
        targetRoot
      }),
      setupServices: {
        connectionSetupService: {
          async getStatus() {
            return {
              connections: [
                {
                  connected: true,
                  id: "codex",
                  label: "Codex",
                  ready: true,
                  status: "connected"
                },
                {
                  connected: false,
                  id: "github",
                  label: "GitHub",
                  ready: false,
                  status: "not_connected"
                }
              ],
              ok: true,
              ready: false
            };
          }
        },
        projectSetupService: {
          async getStatus() {
            throw new Error("Project setup diagnostics should not run for capabilities.");
          }
        },
        studioSetupService: {
          async getStatus() {
            return {
              ready: true
            };
          }
        }
      }
    });

    const state = await service.inspectCapabilities();

    assert.equal(state.ok, true);
    assert.equal(state.connections.github.ready, false);
    assert.equal(state.connections.ready, true);
    assert.equal(state.capabilities.createSession.enabled, true);
    assert.equal(state.capabilities.githubWorkflow.enabled, false);
  });
});

test("current-app local-source capabilities ignore legacy GitHub metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        selectedProject: {
          githubRepository: {
            fullName: "example/local-origin"
          },
          repository: {
            mode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
          },
          repositoryMode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
        },
        targetRoot
      }),
      setupServices: {
        connectionSetupService: {
          async getStatus() {
            return {
              connections: [
                {
                  connected: true,
                  id: "codex",
                  label: "Codex",
                  ready: true,
                  status: "connected"
                },
                {
                  connected: false,
                  id: "github",
                  label: "GitHub",
                  ready: false,
                  status: "not_connected"
                }
              ],
              ok: true,
              ready: false
            };
          }
        },
        projectSetupService: {
          async getStatus() {
            throw new Error("Project setup diagnostics should not run for capabilities.");
          }
        },
        studioSetupService: {
          async getStatus() {
            return {
              ready: true
            };
          }
        }
      }
    });

    const state = await service.inspectCapabilities();

    assert.equal(state.ok, true);
    assert.equal(state.connections.github.ready, false);
    assert.equal(state.connections.ready, true);
    assert.equal(state.capabilities.createSession.enabled, true);
    assert.equal(state.capabilities.githubWorkflow.enabled, false);
  });
});

test("current-app GitHub-profile capabilities still require GitHub connection for session creation", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        selectedProject: {
          workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
        },
        targetRoot
      }),
      setupServices: {
        connectionSetupService: {
          async getStatus() {
            return {
              connections: [
                {
                  connected: true,
                  id: "codex",
                  label: "Codex",
                  ready: true,
                  status: "connected"
                },
                {
                  connected: false,
                  id: "github",
                  label: "GitHub",
                  ready: false,
                  status: "not_connected"
                }
              ],
              ok: true,
              ready: false
            };
          }
        },
        projectSetupService: {
          async getStatus() {
            throw new Error("Project setup diagnostics should not run for capabilities.");
          }
        },
        studioSetupService: {
          async getStatus() {
            return {
              ready: true
            };
          }
        }
      }
    });

    const state = await service.inspectCapabilities();

    assert.equal(state.ok, true);
    assert.equal(state.connections.github.ready, false);
    assert.equal(state.connections.ready, false);
    assert.equal(state.capabilities.createSession.enabled, false);
    assert.match(state.capabilities.createSession.reason, /git connection setup/u);
    assert.equal(state.capabilities.githubWorkflow.enabled, false);
  });
});

test("current-app capabilities reuse cached project setup blockers without running diagnostics", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        targetRoot
      }),
      setupServices: {
        connectionSetupService: {
          async getStatus() {
            return {
              connections: [
                {
                  connected: true,
                  id: "codex",
                  label: "Codex",
                  ready: true,
                  status: "connected"
                },
                {
                  connected: true,
                  id: "github",
                  label: "GitHub",
                  ready: true,
                  status: "connected"
                }
              ],
              ok: true,
              ready: true
            };
          }
        },
        projectSetupService: {
          async getStatus() {
            throw new Error("Project setup diagnostics should not run for capabilities.");
          },
          async getCachedStatus() {
            return {
              ready: false,
              stages: [
                {
                  id: "dependencies",
                  label: "Dependencies runnable",
                  observed: "Missing node_modules packages.",
                  status: "blocked"
                }
              ]
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
      }
    });

    const state = await service.inspectCapabilities();

    assert.equal(state.ok, true);
    assert.equal(state.setup.ready, false);
    assert.match(state.setup.message, /Missing node_modules/u);
    assert.equal(state.capabilities.chat.enabled, true);
    assert.equal(state.capabilities.createSession.enabled, true);
    assert.equal(state.capabilities.preview.enabled, false);
  });
});

test("current-app merges adapter scripts with project scripts and stores starred target script ids", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtimeRoot = path.join(path.dirname(targetRoot), ".vibe64-runtime", "projects", "current-app-test");
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
      await readFile(path.join(runtimeRoot, "runtime-config", "current-app", "starred_scripts"), "utf8"),
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
    await assert.rejects(access(path.join(runtimeRoot, "runtime-config", "current-app", "starred_scripts")), {
      code: "ENOENT"
    });
  });
});

test("current-app lists target scripts while setup diagnostics are blocked", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        adapter: fakeAdapter(),
        targetRoot
      }),
      setupServices: {
        ...readySetupServices(),
        projectSetupService: {
          async getStatus() {
            return {
              blockedReason: "Remote ready: error: No such remote 'origin'.",
              ready: false
            };
          }
        }
      }
    });

    const listed = await service.listTargetScripts();

    assert.equal(listed.ok, true);
    assert.deepEqual(listed.scripts.map((script) => script.id), [
      "adapter:build",
      "adapter:verify"
    ]);
    assert.deepEqual(listed.starredScriptIds, ["adapter:build"]);
  });
});

test("current-app lists target scripts from the selected session worktree", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionRoot = path.join(path.dirname(targetRoot), "runtime", "sessions", "active", "session-1");
    const worktreeRoot = path.join(sessionRoot, "source");
    await mkdir(path.join(worktreeRoot, ".vibe64", "scripts"), {
      recursive: true
    });
    await writeFile(path.join(worktreeRoot, ".vibe64", "scripts", "worktree-check"), "echo ok\n", "utf8");
    const inspectedRoots = [];
    const inspectedConfigScopes = [];
    const createRuntimeInputs = [];
    const adapter = {
      ...fakeAdapter(),
      async listCurrentAppTargetScripts({
        config = {},
        targetRoot: inspectedRoot = ""
      } = {}) {
        inspectedRoots.push(inspectedRoot);
        inspectedConfigScopes.push(config?.values?.scope || "");
        return {
          ok: true,
          scripts: [{
            command: "npm run verify",
            label: "Verify",
            name: "verify",
            starredByDefault: true
          }]
        };
      }
    };
    const service = createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        adapter,
        createRuntime(input = {}) {
          createRuntimeInputs.push(input);
          return {
            adapter,
            projectConfig: {
              ready: true,
              values: {
                scope: input?.sessionId === "session-1" ? "selected-session" : "unscoped"
              }
            },
            async getSession(sessionId) {
              assert.equal(sessionId, "session-1");
              return {
                completedSteps: ["session_created", "source_created"],
                sessionRoot
              };
            }
          };
        },
        targetRoot
      }),
      setupServices: readySetupServices()
    });

    const listed = await service.listTargetScripts({
      sessionId: "session-1"
    });

    assert.equal(listed.ok, true);
    assert.deepEqual(inspectedRoots, [worktreeRoot]);
    assert.deepEqual(inspectedConfigScopes, ["selected-session"]);
    assert.equal(createRuntimeInputs.some((input) => input?.sessionId === "session-1"), true);
    assert.deepEqual(listed.scripts.map((script) => script.id), [
      "adapter:verify",
      "project:worktree-check"
    ]);
  });
});

test("current-app refuses session-scoped target scripts before session source exists", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let adapterInspections = 0;
    const service = createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        adapter: {
          ...fakeAdapter(),
          async listCurrentAppTargetScripts() {
            adapterInspections += 1;
            return {
              ok: true,
              scripts: []
            };
          }
        },
        runtime: {
          async getSession(sessionId) {
            assert.equal(sessionId, "seeding-session");
            return {
              completedSteps: ["session_created"],
              sessionId,
              sessionRoot: path.join(path.dirname(targetRoot), "runtime", "sessions", "active", sessionId)
            };
          }
        },
        targetRoot
      }),
      setupServices: readySetupServices()
    });

    const listed = await service.listTargetScripts({
      sessionId: "seeding-session"
    });

    assert.equal(listed.ok, false);
    assert.equal(listed.code, "vibe64_session_source_required");
    assert.match(listed.error, /Create the session source/u);
    assert.equal(listed.sessionId, "seeding-session");
    assert.equal(adapterInspections, 0);
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

test("current-app target script terminal namespace includes the active project scope", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        adapter: fakeAdapter(),
        targetRoot
      }),
      setupServices: readySetupServices()
    });
    const namespace = `${TARGET_SCRIPT_TERMINAL_NAMESPACE}:project:alpha_1:target`;
    const terminal = await runWithProjectRequestContext({
      slug: "alpha_1",
      targetRoot
    }, () => service.startTargetScriptTerminal({
      scriptId: "adapter:build"
    }));

    try {
      assert.equal(terminal.ok, true);
      assert.equal(readTerminalSession(terminal.id, {
        namespace
      }).ok, true);
      assert.equal(readTerminalSession(terminal.id, {
        namespace: `${TARGET_SCRIPT_TERMINAL_NAMESPACE}:global:target`
      }).ok, false);
    } finally {
      await closeTerminalSession(terminal.id, {
        namespace
      });
    }
  });
});
