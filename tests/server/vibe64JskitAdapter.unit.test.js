import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_SESSION_STATUS,
  VIBE64_WORKFLOW_DEFINITION_IDS,
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  JSKIT_PREVIEW_AUTH_KIND
} from "@local/vibe64-core/server/previewAuth";
import {
  PREVIEW_PROXY_HOST_ENV,
  PREVIEW_PROXY_PORT_END_ENV,
  PREVIEW_PROXY_PORT_START_ENV,
  PREVIEW_PROXY_PUBLIC_HOST_ENV
} from "@local/vibe64-core/server/launchPreviewProxyEnv";
import {
  VIBE64_PROJECTS_ROOT_ENV,
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV,
  VIBE64_SYSTEM_DIR,
  VIBE64_SYSTEM_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  JSKIT_VIBE64_COMMANDS,
  createJskitLaunchTargetTerminalSpec,
  createJskitTargetAdapter,
  listJskitLaunchTargets
} from "@local/vibe64-adapters/server/adapters/jskit/index";
import {
  jskitAutomatedChecksHook,
  jskitCodeIndexHook
} from "@local/vibe64-adapters/server/adapters/jskit/adapter";
import {
  createJskitSetupDoctorPlugin
} from "@local/vibe64-adapters/server/adapters/jskit/setupDoctorPlugin";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  startupArgsPreviewOption
} from "@local/vibe64-adapters/server/launchPreviewOptions";
import { withTemporaryRoot, worktreeMetadata } from "./vibe64TestHelpers.js";
import {
  assertDockerEnv,
  assertDockerVolumeMount,
  dockerEnvValue
} from "./dockerArgsTestHelpers.js";

async function withRuntimeNamespace(namespace, fn) {
  const previous = process.env[VIBE64_RUNTIME_NAMESPACE_ENV];
  if (namespace) {
    process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = namespace;
  } else {
    delete process.env[VIBE64_RUNTIME_NAMESPACE_ENV];
  }
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[VIBE64_RUNTIME_NAMESPACE_ENV];
    } else {
      process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = previous;
    }
  }
}

async function withProviderHomesRoot(root, fn) {
  const previous = process.env[VIBE64_PROVIDER_HOMES_ROOT_ENV];
  if (root) {
    process.env[VIBE64_PROVIDER_HOMES_ROOT_ENV] = root;
  } else {
    delete process.env[VIBE64_PROVIDER_HOMES_ROOT_ENV];
  }
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[VIBE64_PROVIDER_HOMES_ROOT_ENV];
    } else {
      process.env[VIBE64_PROVIDER_HOMES_ROOT_ENV] = previous;
    }
  }
}

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

async function createJskitProject(root) {
  await Promise.all([
    writeProjectFile(root, "package.json", JSON.stringify({
      name: "example-jskit-app",
      scripts: {
        build: "vite build",
        test: "node --test"
      }
    }, null, 2)),
    writeProjectFile(root, "config/public.js", "export default {};\n"),
    writeProjectFile(root, "src/main.js", "console.log('app');\n"),
    writeProjectFile(root, "packages/main/package.descriptor.mjs", "export default {};\n"),
    writeProjectFile(root, ".jskit/lock.json", "{}\n"),
    writeProjectFile(root, ".jskit/APP_BLUEPRINT.md", "# App blueprint\n")
  ]);
}

function commandIds() {
  return JSKIT_VIBE64_COMMANDS
    .map((command) => command.id)
    .sort((left, right) => left.localeCompare(right));
}

function capabilityIds() {
  return [
    ...commandIds(),
    "use_existing_issue",
    "use_existing_pr"
  ].sort((left, right) => left.localeCompare(right));
}

function enabledByActionId(actions = []) {
  return Object.fromEntries(actions.map((action) => [action.id, action.enabled]));
}

function assertJskitHelperGuardBeforeContract(prompt = "") {
  const helperGuardIndex = prompt.indexOf("generic helpers for JSON:API documents");
  const guideContractIndex = prompt.indexOf("JSKIT guide-first contract");
  assert.notEqual(helperGuardIndex, -1);
  assert.notEqual(guideContractIndex, -1);
  assert.ok(helperGuardIndex < guideContractIndex);
}

test("jskit adapter exposes selected-project facts, commands, and prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const adapter = createJskitTargetAdapter();

    const detection = await adapter.detect({
      targetRoot
    });
    const facts = await adapter.inspect({
      targetRoot
    });
    const promptContext = await adapter.getPromptContext({
      targetRoot
    });

    assert.deepEqual(detection, {
      detected: true,
      reason: ""
    });
    assert.equal(facts.summary, "JSKIT project type selected.");
    assert.equal(Object.hasOwn(facts, "promptContext"), false);
    assert.equal(promptContext.package_name, "example-jskit-app");
    assert.equal(promptContext.scripts, "build, test");
    assert.equal(promptContext.blueprint_exists, "true");
    assert.equal(promptContext.blueprint_relative_path, ".jskit/APP_BLUEPRINT.md");
    assert.equal(promptContext.blueprint_path, path.join(targetRoot, ".jskit/APP_BLUEPRINT.md"));
    assert.match(promptContext.agent_guide_contract, /guide\/agent\/index\.md/u);
    assert.match(promptContext.agent_guide_contract, /app-setup\/database-layer\.md/u);
    assert.match(promptContext.agent_guide_contract, /Use individual `npx jskit generate \.\.\. help` commands only/u);
    assert.doesNotMatch(promptContext.tooling_contract, /helper-map update/u);
    assert.doesNotMatch(promptContext.tooling_contract, /generated code index/u);
    assert.doesNotMatch(promptContext.tooling_contract, /helper map/u);
    assert.match(promptContext.tooling_contract, /New JSKIT-owned files must be created/u);
    assert.match(promptContext.tooling_contract, /Before writing generic helpers for JSON:API documents/u);
    assert.match(promptContext.tooling_contract, /search JSKIT package exports and agent-doc references first/u);
    assert.match(promptContext.generator_discovery_commands, /npx jskit list-placements --json/u);
    assert.doesNotMatch(promptContext.generator_discovery_commands, /helper-map update/u);
    assert.doesNotMatch(promptContext.generator_discovery_commands, /helper-map --json/u);
    assert.doesNotMatch(promptContext.generator_discovery_commands, /generate .* help/u);
    assert.match(promptContext.placement_contract, /agent-friendly placement docs/u);
    assert.match(promptContext.placement_contract, /node_modules\/@jskit-ai\/agent-docs\/patterns\/placements\.md/u);
    assert.match(promptContext.database_contract, /Configured database runtime: mysql/u);
    assert.equal(Object.hasOwn(promptContext, "environment_blueprint"), false);
    assert.equal(Object.hasOwn(promptContext, "seed_issue_guidance"), false);
    assert.equal(promptContext.valid_jskit_markers, "true");
    assert.deepEqual(Object.keys(facts.capabilities).sort(), capabilityIds());
    assert.equal(facts.capabilities.update_code_index, true);
    assert.deepEqual(facts.commands.map((command) => command.id), commandIds());
  });
});

test("jskit adapter reflects configured database runtime in prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const adapter = createJskitTargetAdapter();

    const mysqlConfig = {
      values: {
        jskit_database_runtime: "mysql"
      }
    };
    const promptContext = await adapter.getPromptContext({
      config: mysqlConfig,
      targetRoot
    });

    assert.equal(promptContext.database_runtime, "mysql");
    assert.match(promptContext.database_contract, /Configured database runtime: mysql/u);
    assert.match(promptContext.database_contract, /Never create migration files directly/u);
    assert.match(promptContext.database_contract, /Every table added for application data must have `npx jskit generate crud-server-generator scaffold \.\.\.` run for it/u);
    assert.match(promptContext.database_contract, /json-rest-api/u);
    assert.match(promptContext.database_contract, /not direct Knex queries/u);
    assert.match(promptContext.database_contract, /Do not store durable application data in JSON files/u);

    const invalidPromptContext = await adapter.getPromptContext({
      config: {
        values: {
          jskit_database_runtime: "sqlite"
        }
      },
      targetRoot
    });

    assert.equal(invalidPromptContext.database_runtime, "mysql");
    assert.equal(Object.hasOwn(invalidPromptContext, "seed_issue_guidance"), false);

    await withTemporaryRoot(async (unseededRoot) => {
      const seedPromptContext = await adapter.getPromptContext({
        targetRoot: unseededRoot
      });

      assert.equal(seedPromptContext.valid_jskit_markers, "false");
      assert.match(seedPromptContext.seed_issue_guidance, /tenancy\/workspaces/u);
    });
  });
});

test("jskit adapter uses stable config fields regardless of target package identity", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const adapter = createJskitTargetAdapter();

    const missingPackageFields = await adapter.getConfigFields({
      targetRoot
    });
    const missingPackageDefaults = await adapter.getDefaultConfig({
      targetRoot
    });
    assert.equal(missingPackageDefaults.jskit_database_runtime, "mysql");

    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      name: "vibe64"
    }, null, 2));

    const vibe64Fields = await adapter.getConfigFields({
      targetRoot
    });
    const vibe64Defaults = await adapter.getDefaultConfig({
      targetRoot
    });
    assert.deepEqual(
      vibe64Fields.map((field) => field.id),
      missingPackageFields.map((field) => field.id)
    );
    assert.equal(vibe64Defaults.jskit_database_runtime, "mysql");
  });
});

test("jskit adapter allows Studio self-targeting only for the Vibe64 package", async () => {
  const adapter = createJskitTargetAdapter();

  await withTemporaryRoot(async (targetRoot) => {
    assert.equal(await adapter.allowsStudioSelfTarget({
      targetRoot
    }), false);
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      name: "vibe64"
    }, null, 2));
    assert.equal(await adapter.allowsStudioSelfTarget({
      targetRoot
    }), true);
  });
});

test("jskit project setup checks project database readiness but not tenant container ownership", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const plugin = createJskitSetupDoctorPlugin({
      targetRoot
    });
    const checks = await plugin.checks({
      targetRoot
    });
    const checkIds = checks.map((check) => check.id);

    assert.ok(checkIds.includes("runtime-services"));
    assert.equal(checkIds.includes("jskit-mariadb"), false);
  });
});

test("jskit Vibe64 self-target enables host Docker with shared project runtime data", async () => {
  await withRuntimeNamespace("", async () => withProviderHomesRoot("", async () => withTemporaryRoot(async (targetRoot) => {
    const projectsRoot = path.dirname(targetRoot);
    const providerHomesRoot = path.join(projectsRoot, VIBE64_SYSTEM_DIR, "provider-homes");
    const parentSystemRoot = path.join(projectsRoot, VIBE64_SYSTEM_DIR);
    const sessionId = "self_target_studio_launch";
    const sessionRoot = path.join(targetRoot, ".vibe64-local", "sessions", "active", sessionId);
    const selfTargetSystemRoot = path.join(sessionRoot, "runtime", "self-target-system-root");
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      name: "vibe64",
      scripts: {
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const spec = await createJskitLaunchTargetTerminalSpec({
      context: {
        projectsRoot
      },
      launchTargetId: "dev",
      session: {
        metadata: {
          dependencies_installed: "yes",
          worktree_path: targetRoot
        },
        sessionId,
        sessionRoot,
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.metadata.hostDocker, true);
    assert.equal(spec.metadata.hostDockerSource, "target_package:vibe64");
    assert.equal(spec.metadata.urlPath, "/app/vibe64");
    assert.match(spec.metadata.targetUrl, /\/app\/vibe64$/u);
    assert.equal(spec.metadata.runtimeNamespace, "");
    const args = spec.args({
      id: "unit-terminal"
    });
    assert.ok(args.includes("DOCKER_HOST=unix:///var/run/docker.sock"));
    assertDockerEnv(args, VIBE64_RUNTIME_NAMESPACE_ENV, "");
    assertDockerEnv(args, VIBE64_PROJECTS_ROOT_ENV, projectsRoot);
    assertDockerEnv(args, VIBE64_PROVIDER_HOMES_ROOT_ENV, providerHomesRoot);
    assertDockerEnv(args, VIBE64_SYSTEM_ROOT_ENV, selfTargetSystemRoot);
    assertDockerEnv(args, VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV, "1");
    assertDockerEnv(args, PREVIEW_PROXY_HOST_ENV, "0.0.0.0");
    assertDockerEnv(args, PREVIEW_PROXY_PUBLIC_HOST_ENV, "127.0.0.1");
    const previewProxyPortStart = dockerEnvValue(args, PREVIEW_PROXY_PORT_START_ENV);
    const previewProxyPortEnd = dockerEnvValue(args, PREVIEW_PROXY_PORT_END_ENV);
    assert.match(previewProxyPortStart, /^\d+$/u);
    assert.match(previewProxyPortEnd, /^\d+$/u);
    assert.equal(Number(previewProxyPortEnd), Number(previewProxyPortStart) + 99);
    assert.ok(args.includes(
      `127.0.0.1:${previewProxyPortStart}-${previewProxyPortEnd}:${previewProxyPortStart}-${previewProxyPortEnd}`
    ));
    assert.ok(args.includes("/var/run/docker.sock:/var/run/docker.sock"));
    assertDockerVolumeMount(args, projectsRoot, projectsRoot);
    assertDockerVolumeMount(args, providerHomesRoot, providerHomesRoot);
    assertDockerVolumeMount(args, selfTargetSystemRoot, selfTargetSystemRoot);
    assert.notEqual(selfTargetSystemRoot, parentSystemRoot);
    assert.equal(
      spec.metadata.vibe64SelfTarget,
      "Vibe64 self-target: shared projects and provider homes with isolated Studio state"
    );
    assert.equal(spec.metadata.vibe64SelfTargetProjectsRoot, projectsRoot);
    assert.equal(spec.metadata.vibe64SelfTargetProviderHomesRoot, providerHomesRoot);
    assert.equal(spec.metadata.vibe64SelfTargetSystemRoot, selfTargetSystemRoot);
    assert.equal(
      spec.metadata.vibe64SelfTargetPreviewProxyPortRange,
      `${previewProxyPortStart}-${previewProxyPortEnd}`
    );
    const launchHome = path.join(sessionRoot, "runtime", "launch-home", "unit-terminal");
    assertDockerVolumeMount(args, launchHome, launchHome);
    assert.ok(args.at(-1).includes(`HOME=${launchHome}`));
    assert.doesNotMatch(args.at(-1), /HOME=\/tmp\/studio-home/u);
  })));
});

test("jskit self-target preserves the current runtime namespace", async () => {
  await withRuntimeNamespace("tonymobily", async () => withProviderHomesRoot("", async () => withTemporaryRoot(async (targetRoot) => {
    const projectsRoot = path.dirname(targetRoot);
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      name: "vibe64",
      scripts: {
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const spec = await createJskitLaunchTargetTerminalSpec({
      context: {
        projectsRoot
      },
      launchTargetId: "dev",
      session: {
        metadata: {
          dependencies_installed: "yes",
          worktree_path: targetRoot
        },
        sessionId: "self_target_studio_launch_namespaced",
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.metadata.runtimeNamespace, "tonymobily");
    const args = spec.args({
      id: "unit-terminal"
    });
    assertDockerEnv(args, VIBE64_RUNTIME_NAMESPACE_ENV, "tonymobily");
  })));
});

test("jskit launch targets expose app and built app actions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        build: "vite build",
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const launchTargets = await listJskitLaunchTargets({
      session: {
        metadata: {
          dependencies_installed: "yes",
          worktree_path: targetRoot
        }
      }
    });

    assert.deepEqual(launchTargets, [
      {
        defaultDisplay: "minimized",
        id: "built",
        label: "Run built app",
        previewOptions: [
          startupArgsPreviewOption()
        ]
      },
      {
        defaultDisplay: "minimized",
        id: "dev",
        label: "Run app",
        previewOptions: [
          startupArgsPreviewOption()
        ]
      }
    ]);
  });
});

test("jskit launch targets expose startup argument preview options", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        build: "vite build",
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const launchTargets = await listJskitLaunchTargets({
      session: {
        metadata: {
          dependencies_installed: "yes",
          worktree_path: targetRoot
        }
      }
    });

    assert.deepEqual(launchTargets.find((target) => target.id === "dev").previewOptions, [
      startupArgsPreviewOption()
    ]);
  });
});

test("jskit launch targets wait for dependency installation", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const session = {
      metadata: {
        worktree_path: targetRoot
      },
      sessionId: "jskit_launch_before_dependencies",
      targetRoot
    };
    const launchTargets = await listJskitLaunchTargets({
      session
    });

    assert.deepEqual(launchTargets, [
      {
        available: false,
        defaultDisplay: "minimized",
        disabledReason: "Install dependencies before running the app.",
        id: "dev",
        label: "Run app",
        previewOptions: [
          startupArgsPreviewOption()
        ]
      }
    ]);

    const spec = await createJskitLaunchTargetTerminalSpec({
      launchTargetId: "dev",
      session,
      targetRoot
    });

    assert.equal(spec.ok, false);
    assert.equal(spec.message, "Install dependencies before running the app.");
  });
});

test("jskit launch targets use canonical session worktree when metadata path is stale", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "session-with-stale-path";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktreePath = path.join(sessionRoot, "worktree");
    await writeProjectFile(worktreePath, "package.json", JSON.stringify({
      scripts: {
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const session = {
      completedSteps: ["session_created", "worktree_created"],
      metadata: {
        dependencies_installed: "yes",
        worktree_path: path.join(path.dirname(targetRoot), "old-workspace", ".vibe64", "sessions", "active", sessionId, "worktree")
      },
      sessionId,
      sessionRoot,
      targetRoot
    };
    const launchTargets = await listJskitLaunchTargets({
      session
    });

    assert.deepEqual(launchTargets, [
      {
        defaultDisplay: "minimized",
        id: "dev",
        label: "Run app",
        previewOptions: [
          startupArgsPreviewOption()
        ]
      }
    ]);

    const spec = await createJskitLaunchTargetTerminalSpec({
      launchTargetId: "dev",
      session,
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.metadata.runRoot, worktreePath);
  });
});

test("jskit Vibe64 self-target launch uses the selected checkout instead of a stale session worktree", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "self-target-stale-worktree";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktreePath = path.join(sessionRoot, "worktree");
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      name: "vibe64",
      scripts: {
        dev: "vite",
        server: "node current-server.js"
      }
    }, null, 2));
    await writeProjectFile(worktreePath, "package.json", JSON.stringify({
      name: "vibe64",
      scripts: {
        dev: "vite",
        server: "node stale-server.js"
      }
    }, null, 2));
    await writeProjectFile(targetRoot, "config/server_command", "node current-server.js\n");
    await writeProjectFile(worktreePath, "config/server_command", "node stale-server.js\n");

    const spec = await createJskitLaunchTargetTerminalSpec({
      context: {
        projectsRoot: path.dirname(targetRoot)
      },
      launchTargetId: "dev",
      session: {
        completedSteps: ["session_created", "worktree_created"],
        metadata: {
          dependencies_installed: "yes",
          worktree_path: worktreePath
        },
        sessionId,
        sessionRoot,
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.metadata.backendCommand, "node current-server.js");
    assert.equal(spec.metadata.runRoot, targetRoot);
    assert.equal(spec.metadata.vibe64SelfTargetProjectsRoot, path.dirname(targetRoot));
    const args = spec.args({
      id: "unit-terminal"
    });
    assert.equal(args[args.indexOf("-w") + 1], targetRoot);
    const startupScript = args.at(-1);
    assert.match(startupScript, /node current-server\.js/u);
    assert.doesNotMatch(startupScript, /stale-server/u);
  });
});

test("jskit built launch waits for the server readiness marker before opening", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        build: "vite build",
        "db:migrate": "knex migrate:latest",
        server: "node server.js"
      }
    }, null, 2));

    const spec = await createJskitLaunchTargetTerminalSpec({
      launchTargetId: "built",
      session: {
        metadata: {
          dependencies_installed: "yes",
          worktree_path: targetRoot
        },
        sessionId: "jskit_built_launch",
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.match(spec.metadata.readinessMarker, /^\[\[VIBE64_LAUNCH_READY_V1:/u);
    assert.equal(spec.metadata.launchReady, false);
    assert.equal(spec.metadata.defaultDisplay, "minimized");
    assert.equal(spec.metadata.buildCommand, "npm run build");
    assert.equal(spec.metadata.migrationCommand, "npm run db:migrate");
    assert.equal(spec.metadata.serverCommand, "npm run server");
    assert.equal(spec.metadata.previewAuth, JSKIT_PREVIEW_AUTH_KIND);

    const args = spec.args({
      id: "unit-terminal"
    });
    assert.ok(args.includes("AUTH_DEV_BYPASS_ENABLED=true"));
    assert.ok(args.some((arg) => /^AUTH_DEV_BYPASS_SECRET=[a-f0-9]{64}$/u.test(arg)));
    const profileEnvArg = args.find((arg) => /^VIBE64_PREVIEW_AUTH_PROFILE_FILE=.+\/profile\.json$/u.test(arg));
    assert.ok(profileEnvArg);
    const profilePath = profileEnvArg.replace(/^VIBE64_PREVIEW_AUTH_PROFILE_FILE=/u, "");
    assert.ok(args.includes(`${path.dirname(profilePath)}:${path.dirname(profilePath)}`));
    assert.ok(args.includes("AUTH_DEV_ACCESS_TTL_SECONDS=3600"));
    assert.ok(args.includes("AUTH_DEV_REFRESH_TTL_SECONDS=43200"));
    assert.doesNotMatch(spec.commandPreview({ args }), /AUTH_DEV_BYPASS_SECRET=[a-f0-9]{64}/u);
    assert.match(spec.commandPreview({ args }), /'AUTH_DEV_BYPASS_SECRET=\(redacted\)'/u);
    const startupScript = args.at(-1);
    const buildIndex = startupScript.indexOf("npm run build");
    const migrateIndex = startupScript.indexOf("npm run db:migrate");
    const previewAuthIndex = startupScript.indexOf("Preparing preview auth user");
    const serverIndex = startupScript.indexOf("npm run server");
    assert.notEqual(buildIndex, -1);
    assert.notEqual(migrateIndex, -1);
    assert.notEqual(previewAuthIndex, -1);
    assert.notEqual(serverIndex, -1);
    assert.ok(buildIndex < migrateIndex);
    assert.ok(migrateIndex < previewAuthIndex);
    assert.ok(previewAuthIndex < serverIndex);
    assert.match(startupScript, /action:%s/u);
    assert.match(startupScript, /VIBE64_LAUNCH_READY_V1/u);
    assert.match(startupScript, /fetch\(href/u);
    assert.match(startupScript, /Launch target did not become ready at/u);
  });
});

test("jskit dev launch starts backend and Vite together", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        "db:migrate": "knex migrate:latest",
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const spec = await createJskitLaunchTargetTerminalSpec({
      context: {
        vibe64User: {
          email: "Owner@Example.COM",
          github: {
            login: "repo-owner"
          }
        }
      },
      launchTargetId: "dev",
      session: {
        metadata: {
          dependencies_installed: "yes",
          worktree_path: targetRoot
        },
        sessionId: "jskit_dev_launch",
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.metadata.backendCommand, "npm run server");
    assert.equal(spec.metadata.backendPort, 3000);
    assert.equal(spec.metadata.defaultDisplay, "minimized");
    assert.equal(spec.metadata.frontendCommand, "npm run dev -- --host 0.0.0.0 --port \"$PORT\"");
    assert.equal(spec.metadata.migrationCommand, "npm run db:migrate");
    assert.equal(spec.metadata.previewAuth, JSKIT_PREVIEW_AUTH_KIND);
    assert.match(spec.metadata.readinessMarker, /^\[\[VIBE64_LAUNCH_READY_V1:/u);

    const args = spec.args({
      id: "unit-terminal"
    });
    assert.ok(args.includes("AUTH_DEV_BYPASS_ENABLED=true"));
    assert.ok(args.some((arg) => /^AUTH_DEV_BYPASS_SECRET=[a-f0-9]{64}$/u.test(arg)));
    const profileEnvArg = args.find((arg) => /^VIBE64_PREVIEW_AUTH_PROFILE_FILE=.+\/profile\.json$/u.test(arg));
    assert.ok(profileEnvArg);
    const profilePath = profileEnvArg.replace(/^VIBE64_PREVIEW_AUTH_PROFILE_FILE=/u, "");
    assert.ok(args.includes(`${path.dirname(profilePath)}:${path.dirname(profilePath)}`));
    assert.ok(args.includes("AUTH_DEV_ACCESS_TTL_SECONDS=3600"));
    assert.ok(args.includes("AUTH_DEV_REFRESH_TTL_SECONDS=43200"));
    assert.doesNotMatch(spec.commandPreview({ args }), /AUTH_DEV_BYPASS_SECRET=[a-f0-9]{64}/u);
    assert.match(spec.commandPreview({ args }), /'AUTH_DEV_BYPASS_SECRET=\(redacted\)'/u);
    const startupScript = args.at(-1);
    assert.match(startupScript, /VIBE64_JSKIT_BACKEND_PORT=\\?"?3000/u);
    const migrateIndex = startupScript.indexOf("npm run db:migrate");
    const previewAuthIndex = startupScript.indexOf("Preparing preview auth user");
    const serverIndex = startupScript.indexOf("npm run server");
    assert.notEqual(migrateIndex, -1);
    assert.notEqual(previewAuthIndex, -1);
    assert.notEqual(serverIndex, -1);
    assert.ok(migrateIndex < previewAuthIndex);
    assert.ok(previewAuthIndex < serverIndex);
    assert.match(startupScript, /VITE_API_PROXY_TARGET="http:\/\/127\.0\.0\.1:\$VIBE64_JSKIT_BACKEND_PORT"/u);
    assert.match(startupScript, /npm run dev -- --host 0\.0\.0\.0 --port "\$PORT"/u);
    assert.match(startupScript, /VIBE64_LAUNCH_READY_V1/u);
    assert.match(startupScript, /fetch\(href/u);
    assert.match(startupScript, /Launch target did not become ready at/u);
    assert.match(startupScript, /"email":"owner@example\.com"/u);
    assert.match(startupScript, /"username":"repo-owner"/u);
    assert.match(startupScript, /const findByEmail/u);
    assert.match(startupScript, /let user = await findByEmail\(\)/u);
    assert.match(startupScript, /profileFromUser\(user, profile\)/u);
  });
});

test("jskit dev launch applies preview startup arguments to the backend command", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const spec = await createJskitLaunchTargetTerminalSpec({
      context: {},
      launchInput: {
        values: {
          startupArgs: [
            ".",
            "--profile local editor"
          ]
        }
      },
      launchTargetId: "dev",
      session: {
        metadata: {
          dependencies_installed: "yes",
          worktree_path: targetRoot
        },
        sessionId: "jskit_dev_launch_with_startup_args",
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    const startupScript = spec.args({
      id: "unit-terminal"
    }).at(-1);
    assert.match(startupScript, /\(export PORT="\$VIBE64_JSKIT_BACKEND_PORT"; npm run server -- \. .*--profile local editor/u);
    assert.match(
      startupScript,
      /\(export VITE_API_PROXY_TARGET="http:\/\/127\.0\.0\.1:\$VIBE64_JSKIT_BACKEND_PORT"; npm run dev -- --host 0\.0\.0\.0 --port "\$PORT"\) &/u
    );
  });
});

test("jskit adapter reports missing markers without pretending project type selection failed", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", "{}\n");
    const adapter = createJskitTargetAdapter();

    const detection = await adapter.detect({
      targetRoot
    });
    const facts = await adapter.inspect({
      targetRoot
    });
    const promptContext = await adapter.getPromptContext({
      targetRoot
    });

    assert.equal(detection.detected, true);
    assert.match(facts.summary, /Missing markers/u);
    assert.equal(promptContext.valid_jskit_markers, "false");
    assert.deepEqual(Object.keys(facts.capabilities).sort(), capabilityIds());
  });
});

test("jskit adapter reports malformed package.json instead of hiding it", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    await writeProjectFile(targetRoot, "package.json", "{ not json\n");
    const adapter = createJskitTargetAdapter();

    await assert.rejects(
      () => adapter.inspect({
        targetRoot
      }),
      {
        code: "vibe64_invalid_jskit_json"
      }
    );
  });
});

test("jskit prompt actions include JSKIT prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: worktreeMetadata(targetRoot, "jskit_prompt"),
      sessionId: "jskit_prompt"
    });

    const afterPrompt = await runtime.runAction("jskit_prompt", "make_plan");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.id, "jskit");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.promptContext.package_name, "example-jskit-app");
    assert.match(afterPrompt.actionResult.prompt, /example-jskit-app/u);
    assert.match(afterPrompt.actionResult.prompt, /Managed services/u);
    assert.match(afterPrompt.actionResult.prompt, /Use the Managed services section as the only source/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /Managed runtime containers/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT generated-file contract/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT guide-first contract/u);
    assert.match(afterPrompt.actionResult.prompt, /guide\/agent\/generators\/crud-generators\.md/u);
    assert.match(afterPrompt.actionResult.prompt, /Use individual `npx jskit generate \.\.\. help` commands only/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /npx jskit generate crud-server-generator scaffold help/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not plan hand-created packages/u);
    assert.match(afterPrompt.actionResult.prompt, /Work anchor source of truth:/u);
    assert.match(afterPrompt.actionResult.prompt, /work_title/u);
    assert.match(afterPrompt.actionResult.prompt, /work\.md/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not call GitHub to rediscover the issue content/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT placement contract/u);
    assert.match(afterPrompt.actionResult.prompt, /npx jskit list-placements --json/u);
  });
});

test("jskit seed issue definition uses the current-step input contract before issue creation", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "seed_application_defined",
      metadata: worktreeMetadata(targetRoot, "jskit_seed_prompt"),
      sessionId: "jskit_seed_prompt",
      workflowDefinition: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION
    });

    const initialSession = await runtime.getSession("jskit_seed_prompt");

    assert.equal(initialSession.currentStep, "seed_application_defined");
    assert.equal(initialSession.stepMachine.status, "waiting_for_input");
    assert.equal(initialSession.currentStepDefinition.interaction.kind, "conversation");
    assert.equal(initialSession.currentStepDefinition.interaction.actionId, "define_seed_application");

    const afterPrompt = await runtime.runAction("jskit_seed_prompt", "define_seed_application", {
      conversationRequest: "Ask me the JSKIT setup choices you need."
    });

    assert.equal(afterPrompt.stepMachine.status, "awaiting_agent_result");
    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptId, "define_seed_application");
    assert.match(afterPrompt.actionResult.prompt, /defining the initial seed work/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT seed guidance/u);
    assert.match(afterPrompt.actionResult.prompt, /app name\/title/u);
    assert.match(afterPrompt.actionResult.prompt, /Ask one simple question at a time/u);
    assert.match(afterPrompt.actionResult.prompt, /normal app owner/u);
    assert.match(afterPrompt.actionResult.prompt, /what the answer changes in the app/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not make the user choose from framework module names/u);
    assert.match(afterPrompt.actionResult.prompt, /Vibe64 agent result contract/u);

    const afterInput = await runtime.submitCurrentStepInput("jskit_seed_prompt", {
      fields: {
        body: "Seed the JSKIT app foundation.",
        title: "Seed JSKIT application foundation",
        word: "seed"
      },
      kind: "ready",
      source: "codex",
      stepId: "seed_application_defined",
      stepStatus: "awaiting_agent_result"
    });

    assert.equal(afterInput.stepMachine.status, "confirm_files");
    assert.equal(afterInput.next.enabled, true);
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "issue_title"), "Seed JSKIT application foundation\n");
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "issue_word"), "seed\n");
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "issue.md"), "Seed the JSKIT app foundation.\n");
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "work_title"), "Seed JSKIT application foundation\n");
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "work_word"), "seed\n");
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "work.md"), "Seed the JSKIT app foundation.\n");
  });
});

test("jskit execute-plan prompt requires generators, placements, and database modules before hand-built files", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createJskitTargetAdapter(),
      projectConfig: {
        values: {
          jskit_database_runtime: "mysql"
        }
      },
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: {
        ...worktreeMetadata(targetRoot, "jskit_execute_prompt"),
        plan_ready: "yes"
      },
      sessionId: "jskit_execute_prompt"
    });

    const afterPrompt = await runtime.runAction("jskit_execute_prompt", "execute_plan");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].label, "JSKIT MariaDB");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].client, "mysql");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].alternateClient, "mariadb");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].generatorTokenHints.host, "$MYSQL_HOST");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].generatorTokenHints.password, "$MYSQL_PWD");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].generatorTokenHints.database, "$MYSQL_DATABASE");
    assert.match(afterPrompt.actionResult.prompt, /Read the JSKIT agent guide and run the baseline discovery commands before adding new app files/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not hand-create packages, package descriptors, provider entrypoints/u);
    assert.match(afterPrompt.actionResult.prompt, /Before writing generic helpers for JSON:API documents/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not implement framework-shaped helpers locally/u);
    assert.match(afterPrompt.actionResult.prompt, /In the final response, for every hand-written helper/u);
    assert.match(afterPrompt.actionResult.prompt, /why it belongs locally instead of in an existing shared\/global JSKIT location/u);
    assertJskitHelperGuardBeforeContract(afterPrompt.actionResult.prompt);
    assert.match(afterPrompt.actionResult.prompt, /Managed services/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT MariaDB/u);
    assert.match(afterPrompt.actionResult.prompt, /mysql --host/u);
    assert.match(afterPrompt.actionResult.prompt, /--execute/u);
    assert.match(afterPrompt.actionResult.prompt, /<SQL>/u);
    assert.match(afterPrompt.actionResult.prompt, /VIBE64_MYSQL_USER/u);
    assert.match(afterPrompt.actionResult.prompt, /MYSQL_DATABASE/u);
    assert.match(afterPrompt.actionResult.prompt, /env vars: MYSQL_DATABASE, MYSQL_HOST, MYSQL_PWD, MYSQL_TCP_PORT, VIBE64_MYSQL_USER/u);
    assert.match(afterPrompt.actionResult.prompt, /generator tokens: database=\$MYSQL_DATABASE/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not inspect Docker/u);
    assert.match(afterPrompt.actionResult.prompt, /read the agent-friendly placement docs before implementation/u);
    assert.match(afterPrompt.actionResult.prompt, /node_modules\/@jskit-ai\/agent-docs\/patterns\/placements\.md/u);
    assert.match(afterPrompt.actionResult.prompt, /Configured database runtime: mysql/u);
    assert.match(afterPrompt.actionResult.prompt, /Never create migration files directly/u);
    assert.match(afterPrompt.actionResult.prompt, /run the server-side CRUD generator for every added table/u);
    assert.match(afterPrompt.actionResult.prompt, /do not use direct Knex access from feature code/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not store durable application data in JSON files/u);
    assert.match(afterPrompt.actionResult.prompt, /crud-ui-generator crud/u);
  });
});

test("jskit deslop prompt checks framework-shaped helpers before accepting them", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "review_and_validate",
      metadata: worktreeMetadata(targetRoot, "jskit_deslop_prompt"),
      sessionId: "jskit_deslop_prompt"
    });

    const afterPrompt = await runtime.runAction("jskit_deslop_prompt", "run_deslop");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.match(afterPrompt.actionResult.prompt, /Before accepting, preserving, or writing generic helpers for JSON:API documents/u);
    assert.match(afterPrompt.actionResult.prompt, /Treat local framework-shaped helpers as findings/u);
    assert.match(afterPrompt.actionResult.prompt, /Treat any new hand-written helper, shared utility, composable/u);
    assert.match(afterPrompt.actionResult.prompt, /local-vs-shared placement as a deslop finding/u);
    assertJskitHelperGuardBeforeContract(afterPrompt.actionResult.prompt);
  });
});

test("jskit issue and pull-request steps are gated by artifacts and metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });

    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        github_issue_mode: "create",
        work_source: "new_issue"
      },
      sessionId: "jskit_issue"
    });
    const issueBeforeFiles = await runtime.getSession("jskit_issue");
    assert.equal(issueBeforeFiles.next.enabled, false);
    assert.equal(issueBeforeFiles.actions.find((action) => action.id === "create_issue_on_gh")?.enabled, false);

    await runtime.store.writeArtifact("jskit_issue", "issue_title", "Add reports\n");
    await runtime.store.writeArtifact("jskit_issue", "issue_word", "Reports\n");
    await runtime.store.writeArtifact("jskit_issue", "issue.md", "Body\n");
    const issueReady = await runtime.getSession("jskit_issue");
    assert.equal(issueReady.actions.find((action) => action.id === "create_issue_on_gh")?.enabled, true);
    assert.equal(issueReady.next.enabled, false);

    await runtime.store.writeMetadataValue("jskit_issue", "issue_url", "https://github.com/example/repo/issues/42");
    const issueSubmitted = await runtime.getSession("jskit_issue");
    assert.equal(issueSubmitted.next.enabled, true);
    assert.equal(issueSubmitted.actions.find((action) => action.id === "create_issue_on_gh")?.enabled, false);

    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        ...worktreeMetadata(targetRoot, "jskit_pr"),
        branch_pushed: "vibe64/jskit_pr"
      },
      sessionId: "jskit_pr"
    });
    const prBeforeFile = await runtime.getSession("jskit_pr");
    const prBeforeFileActions = enabledByActionId(prBeforeFile.actions);
    assert.equal(prBeforeFile.next.enabled, false);
    assert.equal(prBeforeFileActions.open_pr, false);
    assert.equal(prBeforeFileActions.create_pr_on_gh, false);

    await runtime.store.writeArtifact("jskit_pr", "tmp/create_and_merge_pull_request.title.txt", "PR title\n");
    await runtime.store.writeArtifact("jskit_pr", "tmp/create_and_merge_pull_request.body.md", "PR body\n");
    const prReady = await runtime.getSession("jskit_pr");
    const prReadyActions = enabledByActionId(prReady.actions);
    assert.equal(prReadyActions.open_pr, false);
    assert.equal(prReadyActions.create_pr_on_gh, true);

    await runtime.store.writeMetadataValue("jskit_pr", "pr_url", "https://github.com/example/repo/pull/24");
    const prSubmitted = await runtime.getSession("jskit_pr");
    const prSubmittedActions = enabledByActionId(prSubmitted.actions);
    assert.equal(prSubmitted.next.enabled, false);
    assert.equal(prSubmittedActions.open_pr, true);
    assert.equal(prSubmittedActions.resolve_pull_request, false);
    assert.equal(prSubmittedActions.create_pr_on_gh, false);
    assert.equal(prSubmittedActions.prepare_for_merge, true);
    assert.equal(prSubmittedActions.merge_pr, true);
    assert.equal(prSubmittedActions.sync_main_checkout, false);
    assert.equal(prSubmittedActions.skip_merge, true);
  });
});

test("jskit merge, sync, and finish steps follow current metadata gates", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });

    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: worktreeMetadata(targetRoot, "jskit_merge"),
      sessionId: "jskit_merge"
    });
    const mergeWithoutPr = await runtime.getSession("jskit_merge");
    assert.deepEqual(enabledByActionId(mergeWithoutPr.actions), {
      create_pr_on_gh: false,
      merge_pr: false,
      open_pr: false,
      prepare_for_merge: false,
      resolve_pull_request: true,
      sync_main_checkout: false,
      skip_merge: false
    });

    await runtime.store.writeArtifact("jskit_merge", "report.md", "# Report\n");
    await runtime.store.writeMetadataValue("jskit_merge", "pr_url", "https://github.com/example/repo/pull/24");
    const mergeReady = await runtime.getSession("jskit_merge");
    assert.deepEqual(enabledByActionId(mergeReady.actions), {
      create_pr_on_gh: false,
      merge_pr: true,
      open_pr: true,
      prepare_for_merge: true,
      resolve_pull_request: false,
      sync_main_checkout: false,
      skip_merge: true
    });

    const afterPrepare = await runtime.runAction("jskit_merge", "prepare_for_merge");
    assert.equal(afterPrepare.actionResult.promptId, "prepare_for_merge");
    assert.match(afterPrepare.actionResult.prompt, /Prepare the JSKIT pull request for merge/u);
    assert.match(afterPrepare.actionResult.prompt, /main checkout is ready to sync/u);
    await assert.rejects(
      () => runtime.runAction("jskit_merge", "merge_pr"),
      {
        code: "vibe64_action_disabled",
        message: "Wait for Codex to finish this step."
      }
    );

    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        pr_url: "https://github.com/example/repo/pull/24"
      },
      sessionId: "jskit_sync_blocked"
    });
    const syncBlocked = await runtime.getSession("jskit_sync_blocked");
    const syncBlockedAction = syncBlocked.actions.find((action) => action.id === "sync_main_checkout");
    assert.equal(syncBlockedAction.enabled, false);
    assert.equal(syncBlockedAction.disabledReason, "Merge the pull request before syncing the main checkout.");
    assert.equal(syncBlocked.next.enabled, false);

    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        pr_merged: "yes",
        pr_url: "https://github.com/example/repo/pull/24"
      },
      sessionId: "jskit_sync"
    });
    const syncReady = await runtime.getSession("jskit_sync");
    assert.equal(syncReady.actions.find((action) => action.id === "sync_main_checkout").enabled, true);
    assert.equal(syncReady.next.enabled, false);

    await runtime.createSession({
      initialStep: "session_finished",
      metadata: {
        pr_url: "https://github.com/example/repo/pull/24"
      },
      sessionId: "jskit_finish_blocked"
    });
    const finishBlocked = await runtime.getSession("jskit_finish_blocked");
    assert.equal(finishBlocked.actions.find((action) => action.id === "finish_session").enabled, false);

    await runtime.createSession({
      initialStep: "session_finished",
      metadata: {
        main_checkout_synced: "yes",
        pr_url: "https://github.com/example/repo/pull/24"
      },
      sessionId: "jskit_finish"
    });
    const afterFinish = await runtime.runAction("jskit_finish", "finish_session");
    assert.equal(afterFinish.status, VIBE64_SESSION_STATUS.FINISHED);
    assert.equal(afterFinish.metadata.session_finished, "yes");
    assert.equal(afterFinish.actionResult.sessionStatus, VIBE64_SESSION_STATUS.FINISHED);
  });
});

test("jskit command actions expose terminal specs instead of direct runners", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const calls = [];
    const adapter = createJskitTargetAdapter({
      commandTerminalSpecFactory: async ({ commandId, context, targetRoot: commandTargetRoot }) => {
        calls.push({
          commandId,
          input: context.input,
          targetRoot: commandTargetRoot
        });
        return {
          args: ["-lc", "printf ok"],
          command: "bash",
          commandPreview: "printf ok",
          cwd: commandTargetRoot,
          ok: true,
          successMetadata: {
            example_done: "yes"
          },
          successMessage: "Example command completed."
        };
      }
    });

    const spec = await adapter.createCommandTerminalSpec("create_worktree", {
      input: {
        dryRun: true
      },
      session: {
        targetRoot
      }
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.command, "bash");
    assert.deepEqual(spec.successMetadata, {
      example_done: "yes"
    });
    assert.deepEqual(calls, [
      {
        commandId: "create_worktree",
        input: {
          dryRun: true
        },
        targetRoot
      }
    ]);
  });
});

test("jskit validation hooks expose code index and verification commands", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);

    const codeIndex = await jskitCodeIndexHook({
      worktreePath: targetRoot
    });
    const checks = await jskitAutomatedChecksHook({
      worktreePath: targetRoot
    });

    assert.equal(codeIndex.commandPreview, "npx --no-install jskit helper-map update");
    assert.equal(codeIndex.metadata.code_index_path, ".jskit/helper-map.md");
    assert.equal(checks.commandPreview, "npx --no-install jskit app verify");
  });
});
