import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import {
  createCapabilityRuntime,
  defineProvider
} from "@jskit-ai/kernel/shared/capabilities";

import {
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  createPersonalAiProfileStore
} from "@local/vibe64-core/server/personalAiProfile";
import {
  CODEX_RECONNECT_REQUIRED_CODE,
  codexAuthMarkerPath,
  markCodexAuthReconnecting,
  markCodexReconnectRequired,
  readCodexAuthStatus,
  readCodexLoginId
} from "@local/vibe64-core/server/codexAuthState";
import {
  closeTerminalSessionsForNamespacePrefix,
  startTerminalSession
} from "@local/vibe64-execution/server/terminalSessions";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT
} from "@local/vibe64-core/server/projectRepository";
import {
  Vibe64AccountsFeature,
  createConnections
} from "../../packages/vibe64-accounts/src/server/Vibe64AccountsFeature.js";
import {
  ACTION_LOGOUT_ACCOUNT,
  ACTION_READ_ACCOUNTS,
  ACTION_START_ACCOUNT_AUTH,
  createActions
} from "../../packages/vibe64-accounts/src/server/actions.js";
import {
  GITHUB_RECONNECT_REQUIRED_CODE,
  githubCliFailureDetails
} from "../../packages/vibe64-accounts/src/server/githubCliAuth.js";
import {
  createAccountsRuntime,
  createService,
  GITHUB_ACCOUNT_MODE_USER
} from "../../packages/vibe64-accounts/src/server/service.js";
import {
  createVibe64AccountAuthSessionChangedPublisher,
  createVibe64ConnectionsChangedPublisher,
  VIBE64_CONNECTIONS_CHANGED_EVENT,
  VIBE64_ACCOUNT_AUTH_SESSION_CHANGED_EVENT
} from "../../packages/vibe64-accounts/src/server/accountRealtimeEvents.js";
import {
  STUDIO_MANAGED_CLAUDE_COMMAND,
  STUDIO_MANAGED_CODEX_COMMAND,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";

async function withTempDir(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-accounts-runtime-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

function startGatewayAuthTestTerminal(input = {}, overrides = {}) {
  const terminal = input.terminal || {};
  return startTerminalSession({
    args: input.args,
    command: input.command,
    commandPreview: terminal.commandPreview,
    cwd: input.cwd,
    env: input.env,
    maxRunning: terminal.maxRunning,
    metadata: terminal.metadata,
    namespace: terminal.namespace,
    onClose: terminal.onClose,
    onOutput: terminal.onOutput,
    reuseRunning: terminal.reuseRunning,
    runningLimitFilter: terminal.runningLimitFilter,
    ...overrides
  });
}

test("standalone accounts service saves and exposes the installation personal profile", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const personalProfileStore = createPersonalAiProfileStore({ systemRoot });
    const service = createService({
      accountRuntime: createAccountsRuntime({
        requireExplicitRoots: true,
        systemRoot
      }),
      personalProfileStore
    });

    const saved = await service.savePersonalAiProfile({
      preferredName: "  Ada   Lovelace "
    });
    assert.equal(saved.ok, true);
    assert.deepEqual(saved.personalProfile, {
      available: true,
      preferredName: "Ada Lovelace",
      scope: "installation",
      version: 1
    });

    const status = await service.getStatus({
      providerIds: ["codex"]
    });
    assert.equal(status.ok, true);
    assert.deepEqual(status.personalProfile, saved.personalProfile);
  });
});

async function writeReadyCodexMarker(systemRoot) {
  const markerPath = codexAuthMarkerPath(systemRoot);
  await mkdir(path.dirname(markerPath), {
    recursive: true
  });
  await writeFile(
    markerPath,
    `${JSON.stringify({
      connected: true,
      loginId: "12345678-1234-4123-8123-123456789abc",
      updatedAt: "2026-06-17T00:00:00.000Z",
      version: 1
    }, null, 2)}\n`,
    "utf8"
  );
}

async function writeReadyGithubHome(githubHome, {
  email = "local@example.test",
  name = "Local User",
  username = "local-user"
} = {}) {
  await mkdir(path.join(githubHome, ".config", "gh"), {
    recursive: true
  });
  await writeFile(
    path.join(githubHome, ".config", "gh", "hosts.yml"),
    [
      "github.com:",
      "    users:",
      `        ${username}:`,
      "            oauth_token: test-token",
      "    git_protocol: https",
      "    oauth_token: test-token",
      `    user: ${username}`,
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(githubHome, ".gitconfig"),
    [
      "[credential \"https://github.com\"]",
      "\thelper = ",
      "\thelper = !/usr/bin/gh auth git-credential",
      "[user]",
      `\tname = ${name}`,
      `\temail = ${email}`,
      ""
    ].join("\n"),
    "utf8"
  );
}

async function writeReadyAccounts({
  githubHome = "",
  systemRoot,
  ...github
} = {}) {
  await writeReadyCodexMarker(systemRoot);
  if (githubHome) {
    await writeReadyGithubHome(githubHome, github);
  }
}

async function waitForAccountRuntimeCondition(predicate, message = "Timed out waiting for account runtime condition.") {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await delay(20);
  }
  assert.fail(message);
}

function withEnv(values, callback) {
  const previous = new Map();
  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
    if (values[key] == null) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function startAccountsFeature({
  accountRuntime = null,
  env = {},
  project = null,
  terminals = null
} = {}) {
  const registeredRoutes = [];
  const publishedEvents = [];
  let observed = null;
  const projectApi = project || {
    currentTargetRoot() {
      return "";
    },
    async readCurrentProject() {
      return {};
    }
  };
  const observer = defineProvider({
    id: "test.vibe64-accounts-observer",
    requires: {
      accounts: "vibe64.accounts",
      actions: "runtime.actions",
      connections: "vibe64.connections"
    },
    setup(dependencies) {
      observed = dependencies;
    }
  });
  const runtime = createCapabilityRuntime({
    providers: [
      createActionProvider(),
      Vibe64AccountsFeature,
      observer
    ],
    inputs: {
      "vibe64.project": projectApi,
      "runtime.env": env,
      "runtime.events": {
        async publish(event) {
          publishedEvents.push(event);
          return event;
        }
      },
      "runtime.fastify": {
        get(pathname, options, handler) {
          registeredRoutes.push({ handler, method: "GET", options, path: pathname });
        }
      },
      "runtime.http": {
        router: {
          register(method, pathname, options, handler) {
            registeredRoutes.push({ handler, method, options, path: pathname });
          }
        }
      },
      ...(accountRuntime ? { "vibe64.accounts.runtime": accountRuntime } : {}),
      ...(terminals ? { "vibe64.terminals": terminals } : {})
    }
  });
  await runtime.start();
  return {
    ...observed,
    project: projectApi,
    publishedEvents,
    registeredRoutes,
    runtime
  };
}

test("accounts feature reads roots only from its named runtime env capability", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const targetRoot = path.join(root, "target");
    await mkdir(targetRoot, {
      recursive: true
    });
    await writeReadyCodexMarker(systemRoot);

    const feature = await withEnv({
      [VIBE64_SYSTEM_ROOT_ENV]: path.join(root, "wrong-system"),
      [VIBE64_TARGET_ROOT_ENV]: path.join(root, "wrong-target")
    }, () => startAccountsFeature({
      env: {
        [VIBE64_SYSTEM_ROOT_ENV]: systemRoot,
        [VIBE64_TARGET_ROOT_ENV]: targetRoot
      }
    }));

    const status = await feature.accounts.getStatus({
      accountIds: ["codex"]
    });
    assert.equal(status.ok, true);
    assert.equal(status.ready, true);
    assert.equal(status.accounts.find((account) => account.id === "codex")?.connected, true);
    assert.equal(status.targetRoot, targetRoot);
    assert.equal(feature.registeredRoutes.some((route) => route.path.endsWith("/vibe64/accounts")), true);
    await feature.runtime.shutdown();
  });
});

test("accounts feature keeps assistant readiness aligned with Codex sign-in state", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    let assistantRuntime;
    const feature = await startAccountsFeature({
      env: { [VIBE64_SYSTEM_ROOT_ENV]: systemRoot },
      terminals: {
        configureAssistantRuntime(input) {
          assistantRuntime = input;
        }
      }
    });
    try {
      assert.equal(await assistantRuntime.codexConnectionStatus(), false);
      await writeReadyCodexMarker(systemRoot);
      assert.equal(await assistantRuntime.codexConnectionStatus(), true);
      await rm(codexAuthMarkerPath(systemRoot));
      assert.equal(await assistantRuntime.codexConnectionStatus(), false);
      await writeReadyCodexMarker(systemRoot);
      await markCodexReconnectRequired(systemRoot);
      assert.equal(await assistantRuntime.codexConnectionStatus(), false);
    } finally {
      await feature.runtime.shutdown();
    }
  });
});

test("accounts actions capture the feature API and keep auth-session reads event-free", async () => {
  const calls = [];
  const actions = createActions({
    accounts: {
      async getStatus(input) {
        calls.push(input);
        return { ok: true };
      }
    }
  });
  const readAction = actions.find((action) => action.id === ACTION_READ_ACCOUNTS);
  const logoutAction = actions.find((action) => action.id === ACTION_LOGOUT_ACCOUNT);
  const startAction = actions.find((action) => action.id === ACTION_START_ACCOUNT_AUTH);

  assert.equal(Object.hasOwn(readAction, "events"), false);
  assert.equal(logoutAction.events.length, 2);
  assert.deepEqual(await readAction.execute({ refresh: true }), { ok: true });
  assert.deepEqual(calls, [{ refresh: true }]);

  const authSessionEvent = startAction.events
    .map((buildEvent) => buildEvent({
      context: {
        actor: { id: "1001" }
      },
      result: {
        account: { id: "codex" },
        id: "auth-session-1",
        outputVersion: 1,
        status: "authenticating"
      }
    }))
    .find((event) => event?.realtime?.event === VIBE64_ACCOUNT_AUTH_SESSION_CHANGED_EVENT);
  assert.equal(authSessionEvent.actorId, "1001");
  assert.equal(authSessionEvent.realtime.audience, "actor_user");
  assert.equal(Object.hasOwn(authSessionEvent.realtime.payload, "session"), false);
});

test("accounts feature reports connection readiness without the optional terminal service", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    await writeReadyCodexMarker(systemRoot);
    const feature = await startAccountsFeature({
      env: { [VIBE64_SYSTEM_ROOT_ENV]: systemRoot },
      project: {
        async readCurrentProject() {
          return { repository: { mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT } };
        }
      }
    });
    try {
      const status = await feature.connections.getStatus();
      assert.equal(status.ok, true);
      assert.equal(status.ready, true);
      assert.deepEqual(status.connections.map((connection) => connection.id), ["codex"]);
    } finally {
      await feature.runtime.shutdown();
    }
  });
});

test("connection readiness contains only the accounts required by the current project", async () => {
  const accountStatus = {
    accounts: [
      {
        connected: true,
        id: "codex",
        required: true
      },
      {
        connected: true,
        id: "github",
        required: true
      }
    ],
    ok: true,
    ready: true
  };
  const connections = createConnections({
    accounts: {
      async getStatus() {
        return accountStatus;
      }
    },
    project: {
      async readCurrentProject() {
        return {
          repository: {
            mode: PROJECT_REPOSITORY_MODE_GITHUB
          }
        };
      }
    }
  });

  const projectStatus = await connections.getStatus({});
  assert.equal(projectStatus.ready, true);
  assert.equal(projectStatus.blockedReason, "");
  assert.deepEqual(projectStatus.connections.map((connection) => connection.id), [
    "codex",
    "github"
  ]);
});

test("accounts status can read Codex-only readiness without a GitHub user", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    await writeReadyCodexMarker(systemRoot);
    const service = createService({
      accountRuntime: createAccountsRuntime({
        githubAccountMode: GITHUB_ACCOUNT_MODE_USER,
        requireExplicitRoots: true,
        systemRoot
      }),
      projectService: {
        currentTargetRoot() {
          return "";
        }
      }
    });

    const status = await service.getStatus({
      providerIds: ["codex"]
    });

    assert.equal(status.ok, true);
    assert.equal(status.ready, true);
    assert.deepEqual(status.accounts.map((account) => account.id), ["codex"]);
  });
});

test("connections service requests GitHub only for GitHub repository projects", async () => {
  const accountInputs = [];
  let currentProject = {
    repository: {
      mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
    }
  };
  const connections = createConnections({
    accounts: {
      async getStatus(input = {}) {
        accountInputs.push(input);
        const accountIds = Array.isArray(input.providerIds) ? input.providerIds : [];
        return {
          accounts: accountIds.map((accountId) => ({
            connected: true,
            id: accountId,
            required: true
          })),
          ok: true,
          ready: true
        };
      }
    },
    project: {
      async readCurrentProject() {
        return currentProject;
      },
      async listProjects() {
        throw new Error("Connection readiness should not list every project.");
      }
    }
  });

  const managedStatus = await connections.getStatus({});
  currentProject = {
    repository: {
      mode: PROJECT_REPOSITORY_MODE_GITHUB
    }
  };
  const githubStatus = await connections.getStatus({});

  assert.deepEqual(accountInputs.map((input) => input.providerIds), [
    ["codex"],
    ["codex", "github"]
  ]);
  assert.deepEqual(managedStatus.connections.map((connection) => connection.id), ["codex"]);
  assert.deepEqual(githubStatus.connections.map((connection) => connection.id), ["codex", "github"]);
});

test("connections service treats local-source projects with GitHub metadata as non-GitHub", async () => {
  const accountInputs = [];
  const currentProject = {
    githubRepository: {
      fullName: "example/local-origin"
    },
    repository: {
      mode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
    },
    repositoryMode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
  };
  const connections = createConnections({
    accounts: {
      async getStatus(input = {}) {
        accountInputs.push(input);
        const accountIds = Array.isArray(input.providerIds) ? input.providerIds : [];
        return {
          accounts: accountIds.map((accountId) => ({
            connected: true,
            id: accountId,
            required: true
          })),
          ok: true,
          ready: true
        };
      }
    },
    project: {
      async readCurrentProject() {
        return currentProject;
      }
    }
  });

  const status = await connections.getStatus({});

  assert.deepEqual(accountInputs.map((input) => input.providerIds), [
    ["codex"]
  ]);
  assert.deepEqual(status.connections.map((connection) => connection.id), ["codex"]);
});

test("auth-session publisher emits a scoped session event", async () => {
  const events = [];
  const publishAuthSessionChanged = createVibe64AccountAuthSessionChangedPublisher({
    events: {
      async publish(event) {
        events.push(event);
        return event;
      }
    }
  });

  await publishAuthSessionChanged({
    account: {
      id: "codex"
    },
    id: "auth-session-1",
    outputVersion: 2,
    status: "authenticating",
    terminalStatus: "running"
  }, {
    actorId: "1001",
    reason: "terminal-output"
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].entity, "account-auth-session");
  assert.equal(events[0].entityId, "auth-session-1");
  assert.equal(Object.hasOwn(events[0], "meta"), false);
  assert.equal(events[0].actorId, "1001");
  assert.equal(events[0].realtime.event, VIBE64_ACCOUNT_AUTH_SESSION_CHANGED_EVENT);
  assert.equal(events[0].realtime.audience, "actor_user");
  assert.deepEqual(events[0].realtime.payload, {
    accountId: "codex",
    outputVersion: 2,
    reason: "terminal-output",
    sessionId: "auth-session-1",
    status: "authenticating",
    terminalStatus: "running"
  });
});

test("connection publisher invalidates every client without exposing connection material", async () => {
  const events = [];
  const publishConnectionChanged = createVibe64ConnectionsChangedPublisher({
    events: {
      async publish(event) {
        events.push(event);
        return event;
      }
    }
  });

  await publishConnectionChanged("zai-coding-plan", {
    connected: true,
    operation: "updated",
    reason: "replaced",
    status: "connected"
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].entityId, "zai-coding-plan");
  assert.equal(events[0].realtime.event, VIBE64_CONNECTIONS_CHANGED_EVENT);
  assert.deepEqual(events[0].realtime.payload, {
    connected: true,
    connectionId: "zai-coding-plan",
    reason: "replaced",
    status: "connected"
  });
  assert.equal(JSON.stringify(events[0]).includes("apiKey"), false);
});

test("GitHub identity save updates Git config without starting an auth terminal", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const githubHome = path.join(root, "homes", "tony");
    const vibe64User = {
      home: githubHome,
      gid: 1001,
      uid: 1001,
      username: "tony"
    };
    const commands = [];
    const terminalStarts = [];
    const service = createService({
      accountRuntime: createAccountsRuntime({
        githubAccountMode: GITHUB_ACCOUNT_MODE_USER,
        requireExplicitRoots: true,
        systemRoot
      }),
      projectService: {
        currentTargetRoot() {
          return "";
        }
      },
      runHostToolCommand: async (args = []) => {
        commands.push(args);
        if (args[0] === "bash" && args[1] === "-lc") {
          return {
            ok: true,
            output: ""
          };
        }
        if (args[0] === "gh" && args[1] === "auth" && args[2] === "status") {
          return {
            ok: true,
            output: "Logged in to github.com. Token scopes: repo, read:org, gist, workflow."
          };
        }
        if (args[0] === "gh" && args[1] === "api") {
          return {
            ok: true,
            stdout: "mercmobily"
          };
        }
        if (args[0] === "git" && args.includes("credential.helper")) {
          return {
            ok: true,
            output: "!/usr/bin/gh auth git-credential",
            stdout: "!/usr/bin/gh auth git-credential"
          };
        }
        if (args[0] === "git" && args.at(-1) === "user.name") {
          return {
            ok: true,
            stdout: "Tony"
          };
        }
        if (args[0] === "git" && args.at(-1) === "user.email") {
          return {
            ok: true,
            stdout: "tony@example.test"
          };
        }
        throw new Error(`Unexpected host command: ${args.join(" ")}`);
      },
      runAuthTerminalCommand: (input) => {
        terminalStarts.push(input);
        throw new Error("saveGitIdentity must not start an auth terminal");
      }
    });

    const result = await service.saveGitIdentity({
      gitUserEmail: "tony@example.test",
      gitUserName: "Tony",
      vibe64User
    });

    assert.equal(result.ok, true);
    assert.equal(result.account.connected, true);
    assert.equal(result.account.username, "mercmobily");
    assert.equal(terminalStarts.length, 0);
    assert.equal(commands[0][0], "bash");
    assert.match(commands[0][2], /git config --global user\.name Tony/u);
    assert.match(commands[0][2], /git config --global user\.email tony@example\.test/u);
  });
});

test("GitHub auth terminal running limit is scoped to the OS user", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const adaHome = path.join(root, "homes", "ada");
    const graceHome = path.join(root, "homes", "grace");
    await Promise.all([
      mkdir(adaHome, {
        recursive: true
      }),
      mkdir(graceHome, {
        recursive: true
      })
    ]);
    const terminalStarts = [];
    const service = createService({
      accountRuntime: createAccountsRuntime({
        githubAccountMode: GITHUB_ACCOUNT_MODE_USER,
        requireExplicitRoots: true,
        systemRoot
      }),
      projectService: {
        currentTargetRoot() {
          return root;
        }
      },
      runAuthTerminalCommand: (input = {}) => {
        terminalStarts.push(input);
        return startGatewayAuthTestTerminal(input, {
          args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000);"],
          command: process.execPath,
          commandPreview: "node auth terminal",
          env: {}
        });
      }
    });

    try {
      const ada = await service.startAuth({
        accountId: "github",
        gitUserEmail: "ada@example.test",
        gitUserName: "Ada",
        mode: "browser",
        vibe64User: {
          home: adaHome,
          gid: 1001,
          uid: 1001,
          username: "ada"
        }
      });
      const grace = await service.startAuth({
        accountId: "github",
        gitUserEmail: "grace@example.test",
        gitUserName: "Grace",
        mode: "browser",
        vibe64User: {
          home: graceHome,
          gid: 1002,
          uid: 1002,
          username: "grace"
        }
      });
      const reusedAda = await service.startAuth({
        accountId: "github",
        gitUserEmail: "ada@example.test",
        gitUserName: "Ada",
        mode: "browser",
        vibe64User: {
          home: adaHome,
          gid: 1001,
          uid: 1001,
          username: "ada"
        }
      });

      assert.equal(ada.ok, true);
      assert.equal(grace.ok, true);
      assert.equal(reusedAda.ok, true);
      assert.equal(reusedAda.id, ada.id);
      assert.equal(terminalStarts.length, 2, "reusing Ada's login must not launch another managed execution");
      assert.equal(typeof terminalStarts[0].terminal.runningLimitFilter, "function");
    } finally {
      await closeTerminalSessionsForNamespacePrefix("vibe64-accounts");
    }
  });
});

test("GitHub auth terminal uses a gateway real-user PTY request", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const githubHome = path.join(root, "homes", "ada");
    const actorUid = process.getuid() === 1001 ? 1002 : 1001;
    const actorGid = process.getgid() === 1001 ? 1002 : 1001;
    await Promise.all([
      mkdir(systemRoot, {
        recursive: true
      }),
      mkdir(githubHome, {
        recursive: true
      })
    ]);

    const terminalRequests = [];
    const service = createService({
      accountRuntime: createAccountsRuntime({
        githubAccountMode: GITHUB_ACCOUNT_MODE_USER,
        requireExplicitRoots: true,
        systemRoot
      }),
      projectService: {
        currentTargetRoot() {
          return root;
        }
      },
      runAuthTerminalCommand: async (input) => {
        terminalRequests.push(input);
        return startGatewayAuthTestTerminal(input, {
          args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000);"],
          command: process.execPath,
          commandPreview: "node auth terminal",
          env: {}
        });
      },
      runHostToolCommand: async () => ({ ok: false, output: "Fixture GitHub account is not connected.", stdout: "" })
    });

    try {
      const result = await service.startAuth({
        accountId: "github",
        gitUserEmail: "ada@example.test",
        gitUserName: "Ada",
        mode: "browser",
        vibe64User: {
          home: githubHome,
          gid: actorGid,
          uid: actorUid,
          username: "ada"
        }
      });

      assert.equal(result.ok, true);
      assert.equal(terminalRequests.length, 1);
      assert.equal(terminalRequests[0].actor, "owner-user");
      assert.equal(terminalRequests[0].command, "bash");
      assert.equal(terminalRequests[0].credentialHome.home, githubHome);
      assert.equal(terminalRequests[0].credentialHome.uid, actorUid);
      assert.equal(terminalRequests[0].credentialHome.gid, actorGid);
      assert.equal(terminalRequests[0].credentialHome.username, "ada");
      assert.equal(terminalRequests[0].cwd, githubHome);
      assert.equal(terminalRequests[0].envPolicy, "auth");
      assert.equal(terminalRequests[0].mode, "pty");
      assert.equal(terminalRequests[0].purpose, "github");
      assert.equal(terminalRequests[0].terminal.helperPayloadRoot, systemRoot);
      assert.equal(terminalRequests[0].terminal.metadata.userKey, "ada");
      assert.equal(terminalRequests[0].terminal.namespace, "vibe64-accounts");
    } finally {
      await closeTerminalSessionsForNamespacePrefix("vibe64-accounts");
    }
  });
});

test("GitHub auth terminal finalization checks and publishes the same OS user context", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const githubHome = path.join(root, "homes", "ada");
    const vibe64User = {
      home: githubHome,
      gid: 1001,
      uid: 1001,
      username: "ada"
    };
    await Promise.all([
      mkdir(systemRoot, {
        recursive: true
      }),
      mkdir(githubHome, {
        recursive: true
      })
    ]);

    const hostCommands = [];
    const publishedAccounts = [];
    const publishedSessions = [];
    const service = createService({
      accountRuntime: createAccountsRuntime({
        githubAccountMode: GITHUB_ACCOUNT_MODE_USER,
        requireExplicitRoots: true,
        systemRoot
      }),
      projectService: {
        currentTargetRoot() {
          return root;
        }
      },
      publishAccountChanged: async (accountId, event = {}) => {
        publishedAccounts.push({
          accountId,
          event
        });
      },
      publishAuthSessionChanged: async (session = {}, event = {}) => {
        publishedSessions.push({
          event,
          session
        });
      },
      runAuthTerminalCommand: (input = {}) => startGatewayAuthTestTerminal(input, {
        args: ["-e", ""],
        command: process.execPath,
        commandPreview: "node auth terminal",
        env: {}
      }),
      runHostToolCommand: async (args = [], options = {}) => {
        hostCommands.push({
          args,
          options
        });
        assert.equal(options.toolHomeSource, githubHome);
        assert.equal(options.username, "ada");
        assert.equal(options.hostUid, 1001);
        assert.equal(options.hostGid, 1001);
        if (args[0] === "gh" && args[1] === "auth" && args[2] === "status") {
          return {
            ok: true,
            output: "Logged in to github.com. Token scopes: repo, read:org, gist, workflow."
          };
        }
        if (args[0] === "gh" && args[1] === "api") {
          return {
            ok: true,
            stdout: "ada-github"
          };
        }
        if (args[0] === "git" && args.includes("credential.helper")) {
          return {
            ok: true,
            output: "!/usr/bin/gh auth git-credential",
            stdout: "!/usr/bin/gh auth git-credential"
          };
        }
        if (args[0] === "git" && args.at(-1) === "user.name") {
          return {
            ok: true,
            stdout: "Ada"
          };
        }
        if (args[0] === "git" && args.at(-1) === "user.email") {
          return {
            ok: true,
            stdout: "ada@example.test"
          };
        }
        throw new Error(`Unexpected host command: ${args.join(" ")}`);
      }
    });

    const session = await service.startAuth({
      accountId: "github",
      gitUserEmail: "ada@example.test",
      gitUserName: "Ada",
      mode: "browser",
      vibe64User
    });
    assert.equal(session.ok, true);

    await waitForAccountRuntimeCondition(
      () => publishedAccounts.some((entry) => entry.accountId === "github" && entry.event.account?.connected === true),
      "GitHub auth terminal close did not publish connected account status."
    );

    const connected = publishedAccounts.find((entry) => entry.accountId === "github" && entry.event.account?.connected === true);
    assert.equal(connected.event.account.username, "ada-github");
    assert.equal(connected.event.status, "connected");
    assert.equal(connected.event.authSessionId, session.id);
    assert.equal(hostCommands.length, 5);
    assert.ok(publishedSessions.some((entry) => entry.session.id === session.id && entry.session.account?.connected === true));
    assert.equal(publishedSessions.every((entry) => entry.event.actorId === "1001"), true);
  });
});

test("GitHub auth terminal failure publishes useful terminal output", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const githubHome = path.join(root, "homes", "ada");
    const vibe64User = {
      home: githubHome,
      gid: 1001,
      uid: 1001,
      username: "ada"
    };
    await Promise.all([
      mkdir(systemRoot, {
        recursive: true
      }),
      mkdir(githubHome, {
        recursive: true
      })
    ]);

    const publishedSessions = [];
    const service = createService({
      accountRuntime: createAccountsRuntime({
        githubAccountMode: GITHUB_ACCOUNT_MODE_USER,
        requireExplicitRoots: true,
        systemRoot
      }),
      projectService: {
        currentTargetRoot() {
          return root;
        }
      },
      publishAuthSessionChanged: async (session = {}, event = {}) => {
        publishedSessions.push({
          event,
          session
        });
      },
      runAuthTerminalCommand: (input = {}) => startGatewayAuthTestTerminal(input, {
        args: [
          "-e",
          "process.stdout.write('First copy your one-time code: 2024-22017\\n'); process.stderr.write('auth failed for unit test\\n'); process.exit(1);"
        ],
        command: process.execPath,
        commandPreview: "node auth terminal",
        env: {}
      }),
      runHostToolCommand: async (args = [], options = {}) => {
        assert.equal(options.toolHomeSource, githubHome);
        assert.equal(options.username, "ada");
        if (args[0] === "gh" && args[1] === "auth" && args[2] === "status") {
          return {
            ok: false,
            output: "gh: Bad credentials (HTTP 401)",
            stderr: "gh: Bad credentials (HTTP 401)"
          };
        }
        return {
          ok: false,
          output: "",
          stderr: ""
        };
      }
    });

    const session = await service.startAuth({
      accountId: "github",
      gitUserEmail: "ada@example.test",
      gitUserName: "Ada",
      mode: "browser",
      vibe64User
    });
    assert.equal(session.ok, true);

    await waitForAccountRuntimeCondition(
      () => publishedSessions.some((entry) => entry.session.id === session.id && entry.session.status === "failed"),
      "GitHub auth terminal failure did not publish failed auth session output."
    );

    const failed = publishedSessions.find((entry) => entry.session.id === session.id && entry.session.status === "failed");
    assert.match(failed.session.output, /First copy your one-time code: 2024-22017/u);
    assert.match(failed.session.output, /auth failed for unit test/u);
    assert.equal(failed.session.account.connected, false);
  });
});

test("accounts service delegates account host commands to runtime override", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const githubHome = path.join(root, "homes", "ada");
    const vibe64User = {
      home: githubHome,
      gid: 1001,
      uid: 1001,
      username: "ada"
    };
    const baseRuntime = createAccountsRuntime({
      githubAccountMode: GITHUB_ACCOUNT_MODE_USER,
      requireExplicitRoots: true,
      systemRoot
    });
    const commands = [];
    let activeCommands = 0;
    let maximumActiveCommands = 0;
    const service = createService({
      accountRuntime: {
        ...baseRuntime,
        runHostToolCommand: async (args = [], options = {}, { fallback = null } = {}) => {
          assert.equal(typeof fallback, "function");
          commands.push({
            args,
            options
          });
          assert.equal(options.toolHomeSource, githubHome);
          assert.equal(options.username, "ada");
          activeCommands += 1;
          maximumActiveCommands = Math.max(maximumActiveCommands, activeCommands);
          await new Promise((resolve) => setImmediate(resolve));
          activeCommands -= 1;
          if (args[0] === "gh" && args[1] === "auth" && args[2] === "status") {
            return {
              ok: true,
              output: "Logged in to github.com. Token scopes: repo, read:org, gist, workflow."
            };
          }
          if (args[0] === "gh" && args[1] === "api") {
            return {
              ok: true,
              stdout: "ada-github"
            };
          }
          if (args[0] === "git" && args.includes("credential.helper")) {
            return {
              ok: true,
              output: "store",
              stdout: "store"
            };
          }
          if (args[0] === "git" && args.at(-1) === "user.name") {
            return {
              ok: true,
              stdout: "Ada"
            };
          }
          if (args[0] === "git" && args.at(-1) === "user.email") {
            return {
              ok: true,
              stdout: "ada@example.test"
            };
          }
          throw new Error(`Unexpected host command: ${args.join(" ")}`);
        }
      },
      runHostToolCommand: async () => {
        throw new Error("default account host command should not be used when runtime overrides it");
      }
    });

    const status = await service.getStatus({
      providerIds: ["github"],
      refresh: true,
      vibe64User
    });
    const github = status.accounts.find((account) => account.id === "github");

    assert.equal(github.connected, true);
    assert.equal(github.username, "ada-github");
    assert.equal(commands.length, 5);
    assert.equal(maximumActiveCommands, 5);
  });
});

test("GitHub status retries transient host read failures before requiring reconnect", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const githubHome = path.join(root, "homes", "mercmobily");
    const vibe64User = {
      github: {
        connectedAt: "2026-07-05T16:11:03.389Z",
        id: 2128734,
        login: "mercmobily"
      },
      home: githubHome,
      gid: 1001,
      uid: 1001,
      username: "mercmobily"
    };
    let statusAttempts = 0;
    const service = createService({
      accountRuntime: createAccountsRuntime({
        githubAccountMode: GITHUB_ACCOUNT_MODE_USER,
        previousGithub: (input = {}) => input.vibe64User?.github || null,
        requireExplicitRoots: true,
        systemRoot
      }),
      runHostToolCommand: async (args = []) => {
        if (args[0] === "gh" && args[1] === "auth" && args[2] === "status") {
          statusAttempts += 1;
          if (statusAttempts === 1) {
            return {
              ok: false,
              output: "EAGAIN: resource temporarily unavailable, read",
              stderr: "EAGAIN: resource temporarily unavailable, read"
            };
          }
          return {
            ok: true,
            output: "Logged in to github.com. Token scopes: repo, read:org, gist, workflow."
          };
        }
        if (args[0] === "gh" && args[1] === "api") {
          return {
            ok: true,
            output: "mercmobily",
            stdout: "mercmobily"
          };
        }
        if (args[0] === "git" && args.includes("credential.helper")) {
          return {
            ok: true,
            output: "!/usr/bin/gh auth git-credential",
            stdout: "!/usr/bin/gh auth git-credential"
          };
        }
        if (args[0] === "git" && args.at(-1) === "user.name") {
          return {
            ok: true,
            output: "mercmobily",
            stdout: "mercmobily"
          };
        }
        if (args[0] === "git" && args.at(-1) === "user.email") {
          return {
            ok: true,
            output: "tonymobily@gmail.com",
            stdout: "tonymobily@gmail.com"
          };
        }
        throw new Error(`Unexpected host command: ${args.join(" ")}`);
      }
    });

    const status = await service.getStatus({
      providerIds: ["github"],
      refresh: true,
      vibe64User
    });
    const github = status.accounts.find((account) => account.id === "github");

    assert.equal(statusAttempts, 2);
    assert.equal(github.connected, true);
    assert.equal(github.status, "connected");
    assert.equal(github.username, "mercmobily");
  });
});

test("GitHub transient host read failures are not classified as reconnect-required", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const githubHome = path.join(root, "homes", "mercmobily");
    const vibe64User = {
      github: {
        connectedAt: "2026-07-05T16:11:03.389Z",
        id: 2128734,
        login: "mercmobily"
      },
      home: githubHome,
      gid: 1001,
      uid: 1001,
      username: "mercmobily"
    };
    let statusAttempts = 0;
    const service = createService({
      accountRuntime: createAccountsRuntime({
        githubAccountMode: GITHUB_ACCOUNT_MODE_USER,
        previousGithub: (input = {}) => input.vibe64User?.github || null,
        requireExplicitRoots: true,
        systemRoot
      }),
      runHostToolCommand: async (args = []) => {
        if (args[0] === "gh" && args[1] === "auth" && args[2] === "status") {
          statusAttempts += 1;
          return {
            ok: false,
            output: "EAGAIN: resource temporarily unavailable, read",
            stderr: "EAGAIN: resource temporarily unavailable, read"
          };
        }
        if (args[0] === "gh" && args[1] === "api") {
          return {
            ok: true,
            output: "mercmobily",
            stdout: "mercmobily"
          };
        }
        if (args[0] === "git" && args.includes("credential.helper")) {
          return {
            ok: true,
            output: "!/usr/bin/gh auth git-credential",
            stdout: "!/usr/bin/gh auth git-credential"
          };
        }
        if (args[0] === "git" && args.at(-1) === "user.name") {
          return {
            ok: true,
            output: "mercmobily",
            stdout: "mercmobily"
          };
        }
        if (args[0] === "git" && args.at(-1) === "user.email") {
          return {
            ok: true,
            output: "tonymobily@gmail.com",
            stdout: "tonymobily@gmail.com"
          };
        }
        throw new Error(`Unexpected host command: ${args.join(" ")}`);
      }
    });

    const status = await service.getStatus({
      providerIds: ["github"],
      refresh: true,
      vibe64User
    });
    const github = status.accounts.find((account) => account.id === "github");

    assert.equal(statusAttempts, 3);
    assert.equal(github.connected, false);
    assert.equal(github.code, "vibe64_github_status_temporarily_unavailable");
    assert.equal(github.status, "not_connected");
    assert.equal(github.previousUsername, "mercmobily");
    assert.doesNotMatch(github.message, /Reconnect GitHub/u);
  });
});

test("GitHub CLI auth failures are classified as reconnect-required", () => {
  const failure = githubCliFailureDetails({
    output: "gh: Bad credentials (HTTP 401)"
  });

  assert.equal(failure.code, GITHUB_RECONNECT_REQUIRED_CODE);
  assert.equal(failure.reconnectRequired, true);
  assert.equal(failure.statusCode, 409);
  assert.match(failure.message, /Reconnect GitHub/u);
});

test("cached GitHub status preserves proven invalid and logout states until live auth succeeds", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const githubHome = path.join(root, "homes", "local-user");
    const vibe64User = {
      github: {
        connectedAt: "2026-07-05T16:11:03.389Z",
        id: 2128734,
        login: "local-user"
      },
      home: githubHome,
      gid: 1002,
      uid: 1002,
      username: "local-user"
    };
    await writeReadyAccounts({
      githubHome,
      systemRoot
    });
    await chmod(githubHome, 0o000);

    const commands = [];
    try {
      const service = createService({
        accountRuntime: createAccountsRuntime({
          githubAccountMode: GITHUB_ACCOUNT_MODE_USER,
          previousGithub: (input = {}) => input.vibe64User?.github || null,
          requireExplicitRoots: true,
          systemRoot
        }),
        projectService: {
          currentTargetRoot() {
            return "";
          }
        },
        publishAccountChanged: async () => null,
        runHostToolCommand: async (args = []) => {
          commands.push(args);
          if (
            args[0] === STUDIO_MANAGED_CODEX_COMMAND &&
            args[1] === "-c" &&
            args[2] === STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG &&
            args.includes("login") &&
            args.includes("status")
          ) {
            return {
              ok: true,
              output: "Logged in"
            };
          }
          if (args[0] === "gh" && args[1] === "auth" && args[2] === "logout") {
            return {
              ok: true,
              output: "Logged out"
            };
          }
          if (args[0] === "gh" && args[1] === "auth" && args[2] === "status") {
            return {
              ok: true,
              output: "Logged in to github.com. Token scopes: repo, read:org, gist, workflow."
            };
          }
          if (args[0] === "gh" && args[1] === "api") {
            return {
              ok: true,
              stdout: "local-user"
            };
          }
          if (args[0] === "git" && args.includes("credential.helper")) {
            return {
              ok: true,
              output: "!/usr/bin/gh auth git-credential",
              stdout: "!/usr/bin/gh auth git-credential"
            };
          }
          if (args[0] === "git" && args.at(-1) === "user.name") {
            return {
              ok: true,
              stdout: "Local User"
            };
          }
          if (args[0] === "git" && args.at(-1) === "user.email") {
            return {
              ok: true,
              stdout: "local@example.test"
            };
          }
          throw new Error(`Unexpected host command: ${args.join(" ")}`);
        }
      });

      const initialStatus = await service.getStatus({
        providerIds: ["github"],
        vibe64User
      });
      assert.equal(initialStatus.accounts.find((account) => account.id === "github")?.connected, true);
      assert.equal(commands.length, 0);

      const invalid = await service.recordGithubAuthInvalid({
        reason: "repository-owners",
        vibe64User
      });
      assert.equal(invalid.ok, true);
      assert.equal(invalid.account.code, GITHUB_RECONNECT_REQUIRED_CODE);
      assert.equal(invalid.account.status, "reconnect_required");

      const localStatus = await service.getStatus({
        providerIds: ["github"],
        vibe64User
      });
      const localGithub = localStatus.accounts.find((account) => account.id === "github");
      assert.equal(localGithub.connected, false);
      assert.equal(localGithub.code, GITHUB_RECONNECT_REQUIRED_CODE);
      assert.equal(localGithub.status, "reconnect_required");
      assert.equal(commands.length, 0);

      const liveStatus = await service.getStatus({
        providerIds: ["github"],
        refresh: true,
        vibe64User
      });
      const liveGithub = liveStatus.accounts.find((account) => account.id === "github");
      assert.equal(liveGithub.connected, true);
      assert.equal(liveGithub.username, "local-user");
      assert.equal(commands.length, 5);

      const clearedStatus = await service.getStatus({
        providerIds: ["github"],
        vibe64User
      });
      assert.equal(clearedStatus.accounts.find((account) => account.id === "github")?.connected, true);
      assert.equal(commands.length, 5);

      const logout = await service.logout({
        accountId: "github",
        vibe64User
      });
      assert.equal(logout.ok, true);
      assert.equal(logout.account.connected, false);
      assert.equal(commands.length, 6);

      const loggedOutStatus = await service.getStatus({
        providerIds: ["github"],
        vibe64User
      });
      assert.equal(loggedOutStatus.accounts.find((account) => account.id === "github")?.connected, false);
      assert.equal(commands.length, 6);
    } finally {
      await chmod(githubHome, 0o700);
    }
  });
});

test("Codex status exposes only the current account email without rotating auth or starting a runtime", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const daemonHome = path.join(root, "daemon");
    const authPath = path.join(daemonHome, ".codex", "auth.json");
    await mkdir(path.dirname(authPath), { recursive: true });
    await writeReadyCodexMarker(systemRoot);
    const markerBefore = await readFile(codexAuthMarkerPath(systemRoot), "utf8");
    const commands = [];
    const invalidations = [];
    const service = createService({
      accountRuntime: createAccountsRuntime({ daemonHome, requireExplicitRoots: true, systemRoot }),
      projectService: { currentTargetRoot: () => "" },
      invalidateAgentRuntimes: async (input) => { invalidations.push(input); return { ok: true }; },
      runHostToolCommand: async (args) => {
        commands.push(args);
        return { ok: true, output: "Logged in using ChatGPT" };
      }
    });
    for (const [claims, expected] of [
      [{ email: "tony@example.com" }, "tony@example.com"],
      [{ "https://api.openai.com/profile": { email: "changed@example.com" } }, "changed@example.com"],
      [{ email: { unexpected: true } }, ""]
    ]) {
      const token = `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
      await writeFile(authPath, JSON.stringify({
        auth_mode: "chatgpt",
        tokens: { id_token: token, access_token: "private-access-token", refresh_token: "private-refresh-token" }
      }));
      const local = await service.getStatus({ accountIds: ["codex"] });
      assert.equal(local.accounts[0].username, expected);
      assert.equal(local.accounts[0].connected, true);
      assert.equal(commands.length, 0);
      assert.doesNotMatch(JSON.stringify(local), /private-access-token|private-refresh-token|header\./u);
    }
    await writeFile(authPath, JSON.stringify({
      tokens: { id_token: `header.${Buffer.from(JSON.stringify({ email: "live@example.com" })).toString("base64url")}.signature` }
    }));
    assert.equal((await service.getCodexStatus()).account.username, "live@example.com");
    assert.equal(commands.length, 1);
    for (const contents of [
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "private-api-key" }),
      JSON.stringify({ auth_mode: "chatgpt", tokens: { id_token: "invalid" } }),
      "{invalid json"
    ]) {
      await writeFile(authPath, contents);
      const status = await service.getStatus({ accountIds: ["codex"] });
      assert.equal(status.accounts[0].username, "");
      assert.equal(status.accounts[0].connected, true);
      assert.doesNotMatch(JSON.stringify(status), /private-api-key/u);
    }
    await rm(authPath);
    assert.equal((await service.getStatus({ accountIds: ["codex"] })).accounts[0].username, "");
    assert.deepEqual(invalidations, []);
    assert.equal(await readFile(codexAuthMarkerPath(systemRoot), "utf8"), markerBefore);
    await rm(codexAuthMarkerPath(systemRoot));
    assert.equal((await service.getStatus({ accountIds: ["codex"] })).accounts[0].connected, false);
  });
});

test("proven invalid Codex auth stays reconnect-required until a login session finalizes", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const daemonHome = path.join(root, "homes", "daemon");
    await writeReadyCodexMarker(systemRoot);
    await markCodexReconnectRequired(systemRoot, {
      reason: "codex-app-server-ensure-available"
    });

    const commands = [];
    const service = createService({
      accountRuntime: createAccountsRuntime({
        daemonHome,
        requireExplicitRoots: true,
        systemRoot
      }),
      projectService: {
        currentTargetRoot() {
          return "";
        }
      },
      runHostToolCommand: async (args = []) => {
        commands.push(args);
        throw new Error(`Unexpected host command: ${args.join(" ")}`);
      }
    });

    const localStatus = await service.getStatus({
      accountIds: ["codex"]
    });
    const localCodex = localStatus.accounts.find((account) => account.id === "codex");
    assert.equal(localCodex.connected, false);
    assert.equal(localCodex.code, CODEX_RECONNECT_REQUIRED_CODE);
    assert.equal(localCodex.status, "reconnect_required");

    const refreshedCodex = await service.getCodexStatus();
    assert.equal(refreshedCodex.account.connected, false);
    assert.equal(refreshedCodex.account.code, CODEX_RECONNECT_REQUIRED_CODE);
    assert.equal(refreshedCodex.account.status, "reconnect_required");
    assert.deepEqual(commands, []);
  });
});

test("accounts runtime resolves Codex credentials from explicit daemon OS identity", async () => {
  await withTempDir(async (root) => {
    const daemonHome = path.join(root, "homes", "v64d_workspace");
    const runtime = createAccountsRuntime({
      daemonGid: 2002,
      daemonHome,
      daemonUid: 2001,
      daemonUsername: "v64d_workspace",
      requireExplicitRoots: true,
      systemRoot: path.join(root, "system")
    });
    const context = runtime.codexContext();

    assert.equal(context.gid, 2002);
    assert.equal(context.home, daemonHome);
    assert.equal(context.ok, true);
    assert.equal(context.scope, "app");
    assert.equal(context.toolHomeSource, daemonHome);
    assert.equal(context.uid, 2001);
    assert.equal(context.username, "v64d_workspace");
    assert.equal(context.userKey, "v64d_workspace");
    assert.equal(context.systemRoot, path.join(root, "system"));
    assert.equal(context.env.HOME, daemonHome);
    assert.equal(context.providerOptions.systemRoot, path.join(root, "system"));
    assert.equal(context.providerOptions.toolHomeSource, daemonHome);
  });
});

test("cancelled Codex auth sessions do not clear reconnect-required state", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const daemonHome = path.join(root, "homes", "daemon");
    await writeReadyCodexMarker(systemRoot);
    await markCodexReconnectRequired(systemRoot, {
      reason: "codex-app-server-ensure-available"
    });

    const terminalRequests = [];
    const service = createService({
      accountRuntime: createAccountsRuntime({
        daemonHome,
        requireExplicitRoots: true,
        systemRoot
      }),
      projectService: {
        currentTargetRoot() {
          return root;
        }
      },
      runHostToolCommand: async (args = []) => {
        if (
          args[0] === STUDIO_MANAGED_CODEX_COMMAND &&
          args[1] === "-c" &&
          args[2] === STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG &&
          args.includes("status")
        ) {
          return {
            ok: true,
            output: "Logged in using ChatGPT"
          };
        }
        throw new Error(`Unexpected host command: ${args.join(" ")}`);
      },
      runAuthTerminalCommand: (input = {}) => {
        terminalRequests.push(input);
        return startGatewayAuthTestTerminal(input, {
          args: ["-e", "setTimeout(() => {}, 60_000);"],
          command: process.execPath,
          commandPreview: "node -e setTimeout",
          env: {}
        });
      }
    });

    const session = await service.startAuth({
      accountId: "codex",
      mode: "device"
    });
    assert.equal(session.ok, true);
    assert.equal(session.status, "authenticating");
    assert.equal(terminalRequests[0].purpose, "account");

    const cancel = await service.cancelAuthSession({
      sessionId: session.id
    });
    assert.equal(cancel.ok, true);
    await delay(50);

    const authStatus = await readCodexAuthStatus(systemRoot);
    assert.equal(authStatus.status, "reconnect_required");

    const refreshedCodex = await service.getCodexStatus();
    assert.equal(refreshedCodex.account.connected, false);
    assert.equal(refreshedCodex.account.code, CODEX_RECONNECT_REQUIRED_CODE);
    assert.equal(refreshedCodex.account.status, "reconnect_required");
  });
});

test("Codex auth marker generation invalidates app-server runtimes without rotating on status refresh", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const daemonHome = path.join(root, "homes", "daemon");
    const markerPath = codexAuthMarkerPath(systemRoot);
    const invalidations = [];
    let codexConnected = true;
    const service = createService({
      accountRuntime: createAccountsRuntime({
        daemonHome,
        requireExplicitRoots: true,
        systemRoot
      }),
      invalidateAgentRuntimes: async (input = {}) => {
        invalidations.push(input);
        return {
          ok: true,
          providerCount: 1,
          stopped: 1
        };
      },
      projectService: {
        currentTargetRoot() {
          return "";
        }
      },
      runHostToolCommand: async (args = []) => {
        if (
          args[0] === STUDIO_MANAGED_CODEX_COMMAND &&
          args[1] === "-c" &&
          args[2] === STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG &&
          args.includes("logout")
        ) {
          codexConnected = false;
          return {
            ok: true,
            output: "Logged out"
          };
        }
        if (
          args[0] === STUDIO_MANAGED_CODEX_COMMAND &&
          args[1] === "-c" &&
          args[2] === STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG &&
          args.includes("status")
        ) {
          return codexConnected
            ? {
                ok: true,
                output: "Logged in using ChatGPT"
              }
            : {
                ok: false,
                output: "Not logged in"
              };
        }
        throw new Error(`Unexpected host command: ${args.join(" ")}`);
      }
    });

    const firstStatus = await service.getCodexStatus();
    const firstMarkerText = await readFile(markerPath, "utf8");
    const firstLoginId = await readCodexLoginId(systemRoot);
    assert.match(firstLoginId, /^[a-f0-9-]{36}$/u);

    assert.equal(firstStatus.ok, true);
    assert.equal(firstStatus.account.connected, true);
    assert.equal(invalidations.length, 1);
    assert.equal(invalidations[0].provider, "codex");
    assert.equal(invalidations[0].reason, "codex-status-refresh");
    assert.equal(invalidations[0].toolHomeSource, daemonHome);

    const secondStatus = await service.getCodexStatus();
    const secondMarkerText = await readFile(markerPath, "utf8");

    assert.equal(secondStatus.ok, true);
    assert.equal(secondStatus.account.connected, true);
    assert.equal(secondMarkerText, firstMarkerText);
    assert.equal(invalidations.length, 1);

    const logout = await service.logout({
      accountId: "codex"
    });

    assert.equal(logout.ok, true);
    assert.equal(logout.account.connected, false);
    assert.equal(invalidations.length, 2);
    assert.equal(invalidations[1].reason, "logout");
    assert.equal(await readCodexLoginId(systemRoot), "");
    await assert.rejects(
      () => readFile(markerPath, "utf8"),
      /ENOENT/u
    );
    codexConnected = true;
    await service.getCodexStatus();
    assert.notEqual(await readCodexLoginId(systemRoot), firstLoginId);
  });
});


test("Codex status retries unfinished auth turnover without another login", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    let invalidations = 0;
    const service = createService({
      accountRuntime: createAccountsRuntime({
        daemonHome: path.join(root, "daemon"),
        requireExplicitRoots: true,
        systemRoot
      }),
      invalidateAgentRuntimes: async () => ({
        ok: ++invalidations > 1,
        providerCount: 1,
        stopped: invalidations > 1 ? 1 : 0
      }),
      runHostToolCommand: async () => ({ ok: true, output: "Logged in using ChatGPT" })
    });
    const pending = await service.getCodexStatus();
    assert.equal(pending.ok, false);
    assert.equal(pending.code, "vibe64_codex_auth_runtime_invalidation_failed");
    assert.equal((await readCodexAuthStatus(systemRoot)).status, "reconnecting");
    const pendingLoginId = await readCodexLoginId(systemRoot);
    const recovered = await service.getCodexStatus();
    assert.equal(recovered.account.connected, true);
    assert.equal(await readCodexAuthStatus(systemRoot), null);
    assert.equal(invalidations, 2);
    assert.equal(await readCodexLoginId(systemRoot), pendingLoginId);
    await service.getCodexStatus();
    assert.equal(invalidations, 2);
  });
});

test("ordinary Codex status reads never upgrade legacy login metadata", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const daemonHome = path.join(root, "daemon");
    await writeReadyCodexMarker(systemRoot);
    const markerPath = codexAuthMarkerPath(systemRoot);
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    delete marker.loginId;
    await writeFile(markerPath, JSON.stringify(marker));
    const authPath = path.join(daemonHome, ".codex", "auth.json");
    await mkdir(path.dirname(authPath), { recursive: true });
    const auth = JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: null, access_token: "native-token" } });
    await writeFile(authPath, auth);
    let probes = 0;
    let invalidations = 0;
    const options = {
      accountRuntime: createAccountsRuntime({ daemonHome, systemRoot }),
      invalidateAgentRuntimes: async () => { invalidations += 1; return { ok: true }; },
      runHostToolCommand: async () => {
        probes += 1;
        assert.equal(await readCodexLoginId(systemRoot), "");
        return { ok: true, output: "Logged in using ChatGPT" };
      }
    };
    const service = createService(options);
    const results = await Promise.all([
      service.getStatus({ accountIds: ["codex"] }),
      service.getStatus({ accountIds: ["codex"] })
    ]);
    assert.equal(results.every((result) => result.accounts[0].connected), true);
    assert.equal(await readCodexLoginId(systemRoot), "");
    assert.equal(probes, 0);
    assert.equal(invalidations, 0);
    const restarted = createService({ ...options, runHostToolCommand: async () => ({ ok: true }) });
    assert.equal((await restarted.getCodexStatus()).account.connected, true);
    assert.equal(await readCodexLoginId(systemRoot), "");
    assert.equal(await readFile(markerPath, "utf8"), JSON.stringify(marker));
    assert.equal(invalidations, 0);
    assert.equal(await readFile(authPath, "utf8"), auth, "Vibe64 never rewrites native credentials");
  });
});

test("Codex creates a new local identity once per successful sign-in and preserves it on failure", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    await writeReadyCodexMarker(systemRoot);
    const initialId = await readCodexLoginId(systemRoot);
    const published = [];
    let exitCode = 0;
    let invalidations = 0;
    const service = createService({
      accountRuntime: createAccountsRuntime({ daemonHome: path.join(root, "daemon"), systemRoot }),
      projectService: { currentTargetRoot: () => root },
      invalidateAgentRuntimes: async () => { invalidations += 1; return { ok: true }; },
      inspectRoutingConfiguration: async () => { throw new Error("Routing catalogue is temporarily unavailable."); },
      runHostToolCommand: async () => ({ ok: true, output: "Logged in using ChatGPT" }),
      publishAuthSessionChanged: async (session) => { published.push(session); },
      runAuthTerminalCommand: (input) => startGatewayAuthTestTerminal(input, {
        args: ["-e", `process.exit(${exitCode});`],
        command: process.execPath,
        commandPreview: "fixture Codex login",
        env: {}
      })
    });
    const successful = await service.startAuth({ accountId: "codex", mode: "device" });
    assert.equal(successful.ok, true);
    await waitForAccountRuntimeCondition(
      () => published.some((session) => session.id === successful.id && session.terminalStatus === "exited"),
      "Successful Codex sign-in did not finalize."
    );
    const loginId = await readCodexLoginId(systemRoot);
    assert.notEqual(loginId, initialId);
    assert.equal(invalidations, 1);
    const completed = await service.readAuthSession({ sessionId: successful.id });
    assert.equal(completed.status, "connected", "Routing setup failure does not undo successful authentication");
    assert.equal(completed.account.routing.ok, false);
    assert.equal(completed.account.routing.error, "Routing catalogue is temporarily unavailable.");
    assert.deepEqual(completed.account.routing, published.findLast((session) => session.id === successful.id).account.routing);
    await service.getCodexStatus();
    assert.equal(await readCodexLoginId(systemRoot), loginId);
    assert.equal(invalidations, 1, "Polling a completed sign-in must not rotate its ID again");

    exitCode = 1;
    const failed = await service.startAuth({ accountId: "codex", mode: "device" });
    await waitForAccountRuntimeCondition(
      () => published.some((session) => session.id === failed.id && session.terminalStatus === "exited"),
      "Failed Codex sign-in did not finalize."
    );
    const failedSession = await service.readAuthSession({ sessionId: failed.id });
    assert.equal(failedSession.account.routing, undefined, "A failed attempt does not reuse an earlier setup result");
    assert.equal(await readCodexLoginId(systemRoot), loginId);
    assert.equal(invalidations, 1);
  });
});

for (const connected of [true, false]) {
  test(`ordinary account reads recover pending Codex ${connected ? "login" : "logout"} after a restart`, async () => {
    await withTempDir(async (root) => {
      const systemRoot = path.join(root, "system");
      await markCodexAuthReconnecting(systemRoot, { reason: connected ? "auth-session-status" : "logout" });
      let probes = 0;
      let invalidations = 0;
      const service = createService({
        accountRuntime: createAccountsRuntime({ daemonHome: path.join(root, "daemon"), systemRoot }),
        invalidateAgentRuntimes: async () => {
          invalidations += 1;
          return { ok: true, providerCount: 0, stopped: 0 };
        },
        runHostToolCommand: async () => {
          probes += 1;
          await delay(20);
          return { ok: connected, output: connected ? "Logged in using ChatGPT" : "Not logged in" };
        }
      });
      const results = await Promise.all([
        service.getStatus({ accountIds: ["codex"] }),
        service.getStatus({ accountIds: ["codex"] })
      ]);
      for (const result of results) {
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(result.accounts[0].connected, connected);
        assert.notEqual(result.accounts[0].status, "reconnecting");
      }
      assert.equal(probes, 1, "Concurrent status readers share one recovery probe");
      assert.equal(invalidations, 1);
      assert.equal(await readCodexAuthStatus(systemRoot), null);
      await service.getStatus({ accountIds: ["codex"] });
      assert.equal(probes, 1, "Settled account reads remain local");
    });
  });
}

test("automatic Codex account recovery preserves an unverified transition and retries later", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    await markCodexAuthReconnecting(systemRoot, { reason: "auth-session-status" });
    let invalidations = 0;
    const service = createService({
      accountRuntime: createAccountsRuntime({ daemonHome: path.join(root, "daemon"), systemRoot }),
      invalidateAgentRuntimes: async () => ({ ok: ++invalidations > 1 }),
      runHostToolCommand: async () => ({ ok: true, output: "Logged in using ChatGPT" })
    });
    const refused = await service.getStatus({ accountIds: ["codex"] });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "vibe64_codex_auth_runtime_invalidation_failed");
    assert.equal((await readCodexAuthStatus(systemRoot)).status, "reconnecting");
    const recovered = await service.getStatus({ accountIds: ["codex"] });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.accounts[0].connected, true);
    assert.equal(await readCodexAuthStatus(systemRoot), null);
    assert.equal(invalidations, 2);
  });
});


test("Claude authentication is owner-only and launches native login after runtime cleanup", async () => {
  await withTempDir(async (root) => {
    const requests = [];
    const invalidations = [];
    let cleanupAllowed = true;
    const service = createService({
      daemonHome: path.join(root, "home"), systemRoot: path.join(root, "system"),
      invalidateAgentRuntimes: async (input) => {
        invalidations.push(input);
        return { ok: cleanupAllowed, code: cleanupAllowed ? "" : "cleanup_unconfirmed" };
      },
      runAuthTerminalCommand: async (input) => {
        requests.push(input);
        return { ok: false, code: "fixture_terminal", error: "Captured native login request." };
      }
    });
    const member = { role: "user", username: "member" };
    assert.equal((await service.startAuth({ accountId: "claude", vibe64User: member })).code, "vibe64_owner_required");
    assert.equal((await service.logout({ accountId: "claude", vibe64User: member })).code, "vibe64_owner_required");
    assert.equal(requests.length, 0);
    assert.equal(invalidations.length, 0);
    const owner = { role: "owner", username: "owner" };
    const result = await service.startAuth({ accountId: "claude", mode: "browser", vibe64User: owner });
    assert.equal(result.code, "fixture_terminal");
    assert.deepEqual(invalidations, [{ provider: "claude", reason: "claude-auth-change" }]);
    assert.equal(requests[0].command, STUDIO_MANAGED_CLAUDE_COMMAND);
    assert.deepEqual(requests[0].args, ["auth", "login", "--claudeai"]);
    assert.equal(requests[0].mode, "pty");
    assert.equal(requests[0].credentialHome.home, path.join(root, "home"));
    assert.equal(requests[0].terminal.metadata.accountId, "claude");
    cleanupAllowed = false;
    assert.equal((await service.startAuth({ accountId: "claude", vibe64User: owner })).code, "cleanup_unconfirmed");
    assert.equal(requests.length, 1);
  });
});


test("Claude login receives its browser link as JSON and accepts code input only from the owner", async () => {
  await withTempDir(async (root) => {
    let request;
    let launches = 0;
    const authUrl = "https://claude.com/cai/oauth/authorize?code=true&redirect_uri=http%3A%2F%2Flocalhost%3A46237%2Fcallback&state=fixture&code_challenge=fixture-challenge&code_challenge_method=S256";
    const manualUrl = new URL(authUrl);
    manualUrl.searchParams.set("redirect_uri", "https://platform.claude.com/oauth/code/callback");
    const service = createService({
      daemonHome: path.join(root, "home"), systemRoot: path.join(root, "system"),
      runAuthTerminalCommand: async (input) => {
        launches += 1;
        request = input;
        return startGatewayAuthTestTerminal(input, {
          command: process.execPath,
          args: ["--input-type=module", "-e", `
            import { execFileSync } from 'node:child_process';
            execFileSync(process.env.BROWSER, [${JSON.stringify(authUrl)}], { env: process.env });
            process.stdout.write('Ready to sign in.');
            process.stdin.resume();
          `]
        });
      }
    });
    const owner = { role: "owner", username: "owner" };
    const member = { role: "user", username: "member" };
    const started = await service.startAuth({ accountId: "claude", vibe64User: owner });
    assert.equal(started.ok, true);
    try {
      let session;
      for (let attempt = 0; attempt < 100; attempt++) {
        session = await service.readAuthSession({ sessionId: started.id, vibe64User: owner });
        if (session.authUrl) break;
        await delay(10);
      }
      assert.equal(session.authUrl, manualUrl.href);
      assert.equal(session.output.includes(authUrl), false);
      assert.equal(session.status, "authenticating");
      assert.equal((await service.readAuthSession({ sessionId: started.id, vibe64User: member })).ok, false);
      assert.equal(service.writeAuthTerminal({ sessionId: started.id, vibe64User: member }, "secret-code\r").ok, false);
      assert.equal(service.writeAuthTerminal({ sessionId: started.id, vibe64User: owner }, "secret-code\r").ok, true);
      const resumed = await service.startAuth({ accountId: "claude", vibe64User: owner });
      assert.equal(resumed.id, started.id);
      assert.equal(resumed.authUrl, manualUrl.href);
      assert.equal(launches, 1, "reusing login must not reserve another managed execution");
    } finally {
      await service.cancelAuthSession({ sessionId: started.id, vibe64User: owner });
    }
    await assert.rejects(readFile(request.env.VIBE64_CLAUDE_AUTH_HANDOFF), { code: "ENOENT" });
    const restarted = await service.startAuth({ accountId: "claude", vibe64User: owner });
    try {
      assert.equal(restarted.ok, true);
      assert.notEqual(restarted.id, started.id);
      assert.equal(launches, 2);
    } finally {
      await service.cancelAuthSession({ sessionId: restarted.id, vibe64User: owner });
    }
  });
});

test("curated Codex connection management uses the existing workspace owner authorization", async () => {
  await withTempDir(async (root) => {
    const denied = { ok: false, code: "owner_only", error: "Only the owner can manage Codex." };
    const checked = [];
    const service = createService({
      accountRuntime: createAccountsRuntime({ systemRoot: path.join(root, "system"),
        canManageCodex(input) {
          checked.push(input.vibe64User?.role);
          return input.vibe64User?.role === "owner" ? null : denied;
        }
      })
    });
    for (const method of ["readCodexProviders", "saveCodexProvider", "removeCodexProvider"]) {
      assert.deepEqual(await service[method]({ modelProviderId: "deepseek", apiKey: "never-sent", vibe64User: { role: "member" } }), denied);
      assert.deepEqual(await service[method]({ modelProviderId: "deepseek", apiKey: "never-sent" }), denied);
    }
    const visible = await service.readCodexProviders({ vibe64User: { role: "owner" } });
    assert.equal(visible.ok, true);
    assert.deepEqual(visible.providers.map(({ id, connected }) => ({ id, connected })), [
      { id: "deepseek", connected: false }, { id: "zai-coding-plan", connected: false }
    ]);
    assert.equal(checked.length, 7);
  });
});

async function routingAccountsFixture(root) {
  const selection = (engineId, modelProviderId, modelId) => ({ schema: "vibe64.assistant-selection.v1",
    engineId, modelProviderId, modelId, agentId: engineId, variantId: "", catalogRevision: `sha256:${"a".repeat(64)}`, selectionSource: "recommended" });
  const senior = selection("codex", "openai", "gpt-6-astra");
  const junior = selection("codex", "deepseek", "deepseek-flash");
  const pickle = selection("opencode", "opencode", "big-pickle");
  const routes = [senior, junior, pickle];
  const unavailable = new Set();
  const store = createAssistantRoutingStore({ systemRoot: root });
  const manager = createSessionAgentManager({ readRoutingConfiguration: () => store.read(),
    readAssistantAccess: async ({ assistantSelection: value }) => ({ available: !unavailable.has(value.modelId),
      ownerOnly: value.modelProviderId === "openai", connectionIdentity: `private-identity:${value.modelId}` }),
    providers: ["codex", "opencode"].map((engineId) => ({ id: engineId, transportId: `${engineId}_server`,
      async capabilities(_context, input) {
        const selected = routes.filter((row) => row.engineId === engineId && (!input.modelProviderId || row.modelProviderId === input.modelProviderId));
        return { engineId, label: engineId, transportId: `${engineId}_server`, revision: senior.catalogRevision,
          agents: [{ id: engineId, mode: "primary" }], modelProviders: [...new Set(selected.map(({ modelProviderId }) => modelProviderId))].map((id) => ({
            id, label: id, connected: true, models: selected.filter(({ modelProviderId }) => modelProviderId === id)
              .map(({ modelId }) => ({ id: modelId, label: modelId, status: unavailable.has(modelId) ? "unavailable" : "available", variants: [], capabilities: { toolcall: true } }))
          })) };
      }
    })) });
  const events = [];
  const denied = { ok: false, code: "owner_only", error: "Only the owner can configure routing." };
  const service = createService({ accountRuntime: createAccountsRuntime({ systemRoot: root,
    canManageCodex: ({ vibe64User }) => vibe64User?.role === "owner" ? null : denied }),
    inspectRoutingConfiguration: (configuration, options) => manager.inspectRoutingConfiguration(configuration, options),
    publishAccountChanged: async (...args) => { events.push(args); } });
  const owner = { role: "owner", username: "owner" };
  const member = { role: "member", username: "member" };
  const assignments = { senior, junior, router: junior, intern: junior, sharedBackup: pickle };
  return { service, store, manager, owner, member, denied, events, assignments, senior, junior, pickle, unavailable };
}

test("model routing setup initializes compatible missing roles once and preserves deliberate choices", async () => {
  await withTempDir(async (root) => {
    const f = await routingAccountsFixture(root);
    const preview = await f.service.readModelRouting({ vibe64User: f.member });
    const setup = preview.engines.find(({ engineId }) => engineId === "codex");
    assert.equal(setup.preview.viewer.senior.available, false, "reading does not initialize missing defaults");
    assert.equal(setup.setupPreview.senior.effectiveSelection.modelId, "deepseek-flash");
    assert.equal(setup.setupPreview.senior.backupUsed, true);
    assert.equal((await f.store.read()).revision, 0);
    // Internal session setup can be triggered by the first collaborator; it
    // accepts only workflow IDs and cannot replace the owner's assignments.
    const first = await f.service.initializeModelRouting({ engineIds: ["codex"], vibe64User: f.member });
    assert.equal(first.ok, true, first.error);
    assert.equal(first.initialized.length, 5);
    const saved = await f.store.read();
    assert.equal(saved.orchestrators.codex.senior.modelId, "gpt-6-astra");
    assert.equal(saved.orchestrators.codex.junior.modelId, "deepseek-flash");
    assert.equal(saved.orchestrators.codex.intern.modelId, "deepseek-flash");
    assert.equal(saved.orchestrators.codex.router.modelId, "deepseek-flash");
    assert.equal(saved.orchestrators.codex.sharedBackup.modelId, "deepseek-flash");
    assert.equal(saved.orchestrators.opencode, undefined, "only the newly usable orchestrator is initialized");
    assert.deepEqual(await f.service.initializeModelRouting({ engineIds: ["codex"], vibe64User: f.owner }), { ok: true, initialized: [] });
    assert.deepEqual(await f.store.read(), saved);
    const chosen = { ...saved.orchestrators.codex, junior: { ...f.senior, selectionSource: "explicit" }, intern: null };
    delete chosen.router;
    await f.store.write({ codex: chosen }, saved.revision);
    const result = await f.service.initializeModelRouting({ engineIds: ["codex", "claude"], vibe64User: f.owner });
    assert.deepEqual(result.initialized, [{ engineId: "codex", role: "router" }]);
    const current = await f.store.read();
    assert.equal(current.orchestrators.codex.intern, null, "explicitly unset is not a missing assignment");
    const nextPreview = await f.service.readModelRouting({ vibe64User: f.owner });
    assert.equal(nextPreview.engines.find(({ engineId }) => engineId === "codex").setupPreview.intern.available, false);
    assert.deepEqual(current.orchestrators.codex.junior, chosen.junior);
    assert.equal(current.orchestrators.claude, undefined, "an unavailable orchestrator gets no helper-only profile");
    assert.equal(f.events.length, 2);
  });
});

test("workflow reads use saved routing and scoped access without discovering model catalogues", async () => {
  await withTempDir(async (root) => {
    const f = await routingAccountsFixture(root);
    await f.store.write({ codex: f.assignments, opencode: { senior: f.pickle, junior: f.pickle } }, 0);
    const revision = (await f.store.read()).revision;
    const member = await f.service.readModelRoutingWorkflows({ vibe64User: f.member });
    assert.equal(member.ok, true, member.error);
    assert.equal(member.canConfigure, false);
    assert.equal(member.workflows[0].seniorLabel, "OpenCode · big-pickle");
    assert.equal(member.workflows[0].juniorLabel, "OpenCode · big-pickle");
    assert.equal(member.workflows[0].backupUsed, true);
    const owner = await f.service.readModelRoutingWorkflows({ vibe64User: f.owner });
    assert.equal(owner.canConfigure, true);
    assert.equal(owner.workflows[0].seniorLabel, "Codex · gpt-6-astra");
    assert.equal((await f.store.read()).revision, revision);
    assert.deepEqual(f.events, []);
    assert.doesNotMatch(JSON.stringify(member), /private-identity|connectionIdentity/);
  });
});

test("initializing a complete saved workflow does not wait for live catalogues", async () => {
  await withTempDir(async (root) => {
    const f = await routingAccountsFixture(root);
    await f.store.write({ codex: { ...f.assignments, sharedBackup: null } }, 0);
    const service = createService({ accountRuntime: createAccountsRuntime({ systemRoot: root }),
      inspectRoutingConfiguration: async () => { throw new Error("Model discovery must not run."); } });
    assert.deepEqual(await service.initializeModelRouting({ engineIds: ["codex"], vibe64User: f.owner }), { ok: true, initialized: [] });
    assert.equal((await f.store.read()).orchestrators.codex.sharedBackup, null);
  });
});

test("model routing setup leaves an unusable workflow and incomplete catalogue untouched", async () => {
  await withTempDir(async (root) => {
    const f = await routingAccountsFixture(root);
    f.unavailable.add("gpt-6-astra");
    f.unavailable.add("deepseek-flash");
    const result = await f.service.initializeModelRouting({ engineIds: ["codex"], vibe64User: f.owner });
    assert.deepEqual(result, { ok: true, initialized: [] });
    assert.equal((await f.store.read()).revision, 0);
    assert.equal(f.events.length, 0);
  });
});

test("model routing read and draft preview resolve the whole collaborator pair without writing", async () => {
  await withTempDir(async (root) => {
    const f = await routingAccountsFixture(root);
    const initial = await f.service.readModelRouting({ vibe64User: f.owner });
    assert.equal(initial.ok, true, initial.error);
    assert.equal(initial.revision, 0);
    await assert.rejects(readFile(path.join(root, "ai-connections/routing.json")), { code: "ENOENT" });
    const draft = { revision: 0, orchestrators: { codex: f.assignments }, vibe64User: f.owner };
    const preview = await f.service.previewModelRouting(draft);
    assert.equal(preview.ok, true, preview.error);
    const codex = preview.engines.find(({ engineId }) => engineId === "codex");
    assert.equal(codex.preview.owner.senior.effectiveSelection.modelId, "gpt-6-astra");
    assert.equal(codex.preview.collaborator.senior.effectiveSelection.engineId, "opencode");
    assert.equal(codex.preview.collaborator.junior.backupReason, "keep_workflow_together");
    assert.equal(codex.preview.collaborator.review.effectiveSelection.modelId, "big-pickle");
    assert.equal(codex.preview.collaborator.auto.available, true);
    assert.equal((await f.store.read()).revision, 0);
    assert.deepEqual(f.events, []);
    assert.doesNotMatch(JSON.stringify(preview), /private-identity|connectionIdentity/);
    assert.deepEqual(await f.service.previewModelRouting({ ...draft, vibe64User: f.member }), f.denied);
    assert.deepEqual(await f.service.saveModelRouting({ ...draft, vibe64User: f.member }), f.denied);
    const saved = await f.service.saveModelRouting(draft);
    assert.equal(saved.ok, true, saved.error);
    const member = await f.service.readModelRouting({ vibe64User: f.member });
    const viewer = member.engines.find(({ engineId }) => engineId === "codex").preview;
    assert.equal(member.canConfigure, false);
    assert.equal(viewer.owner, undefined);
    assert.equal(viewer.collaborator, undefined);
    assert.equal(viewer.viewer.junior.effectiveSelection.engineId, "opencode");
  });
});

test("model routing preserves unavailable assignments and their provenance while repairing another role", async () => {
  await withTempDir(async (root) => {
    const f = await routingAccountsFixture(root);
    await f.store.write({ codex: f.assignments, opencode: { ...Object.fromEntries(Object.keys(f.assignments).map((role) => [role, f.pickle])) } }, 0);
    f.unavailable.add(f.senior.modelId);
    const result = await f.service.saveModelRouting({ vibe64User: f.owner, revision: 1, orchestrators: { codex: {
      ...f.assignments, senior: { ...f.senior, selectionSource: "explicit" }, intern: { ...f.pickle, selectionSource: "explicit" }
    } } });
    assert.equal(result.ok, true, result.error);
    const saved = await f.store.read();
    assert.deepEqual(saved.orchestrators.codex.senior, f.senior);
    assert.equal(saved.orchestrators.codex.intern.engineId, "opencode");
    assert.equal(saved.orchestrators.codex.intern.selectionSource, "explicit");
    assert.equal(saved.orchestrators.opencode.junior.modelId, "big-pickle");
    assert.match(result.engines.find(({ engineId }) => engineId === "codex").roles.senior.error, /unavailable/);
    const stale = await f.service.previewModelRouting({ vibe64User: f.owner, revision: 1, orchestrators: {} });
    assert.equal(stale.code, "vibe64_assistant_routing_stale");
    const invalid = await f.service.saveModelRouting({ vibe64User: f.owner, revision: 2, orchestrators: { codex: { sharedBackup: f.senior } } });
    assert.equal(invalid.ok, false);
    assert.ok(invalid.fieldErrors["codex.sharedBackup"]);
    assert.equal((await f.store.read()).revision, 2);
  });
});

test("model routing only clears migrated helper evidence after explicit review of a valid Intern choice", async () => {
  await withTempDir(async (root) => {
    const f = await routingAccountsFixture(root);
    const helperRoutingReview = { reason: "helper_choices_differ", previous: [{ engineId: "codex", modelProviderId: "openai",
      modelId: "gpt-6-luna", selectionSource: "explicit" }], proposed: f.junior };
    await f.store.write({ codex: { ...f.assignments, helperRoutingReview } }, 0);
    const unrelated = await f.service.saveModelRouting({ vibe64User: f.owner, revision: 1, orchestrators: { codex: { router: f.senior } } });
    assert.equal(unrelated.ok, true, unrelated.error);
    assert.deepEqual((await f.store.read()).orchestrators.codex.helperRoutingReview, helperRoutingReview);
    const preview = unrelated.engines.find(({ engineId }) => engineId === "codex").preview.owner;
    assert.equal(preview.intern.available, true);
    assert.equal(preview.prompt_hint.reasonCode, "vibe64_assistant_helper_review_required");
    const resolved = await f.service.saveModelRouting({ vibe64User: f.owner, revision: 2,
      orchestrators: {}, reviewedHelperWorkflows: ["codex"] });
    assert.equal(resolved.ok, true, resolved.error);
    assert.equal((await f.store.read()).orchestrators.codex.helperRoutingReview, undefined);
    assert.equal(resolved.engines.find(({ engineId }) => engineId === "codex").preview.owner.prompt_hint.available, true);
  });
});

test("first-session setup offers included OpenCode chat without promising restricted helpers", async () => {
  await withTempDir(async (root) => {
    const f = await routingAccountsFixture(root);
    f.unavailable.add("gpt-6-astra");
    f.unavailable.add("deepseek-flash");
    const before = await f.service.readModelRouting({ vibe64User: f.member });
    const preview = before.engines.find(({ engineId }) => engineId === "opencode");
    assert.equal(preview.setupPreview.auto.available, false);
    assert.equal(preview.setupPreview.senior.available, true);
    assert.equal((await f.store.read()).revision, 0);
    const initialized = await f.service.initializeModelRouting({ engineIds: ["opencode"], vibe64User: f.member });
    assert.equal(initialized.ok, true, initialized.error);
    const saved = await f.store.read();
    assert.deepEqual(Object.keys(saved.orchestrators), ["opencode"]);
    for (const role of ["senior", "junior", "sharedBackup"]) {
      assert.equal(saved.orchestrators.opencode[role].modelId, "big-pickle");
    }
    const after = await f.service.readModelRouting({ vibe64User: f.member });
    assert.equal(saved.orchestrators.opencode.router, undefined);
    assert.equal(saved.orchestrators.opencode.intern, undefined);
    assert.equal(after.engines.find(({ engineId }) => engineId === "opencode").preview.viewer.auto.available, false);
  });
});

test("routing reads leave the retired temporary default inert and new saves omit it", async () => {
  await withTempDir(async (root) => {
    const f = await routingAccountsFixture(root);
    const draft = { revision: 0, orchestrators: {}, vibe64User: f.owner };
    assert.equal((await f.service.previewModelRouting(draft)).temporaryChatRole, undefined);
    assert.deepEqual(await f.service.saveModelRouting({ ...draft, vibe64User: f.member }), f.denied);
    const saved = await f.service.saveModelRouting(draft);
    assert.equal(saved.ok, true, saved.error);
    const routingPath = path.join(root, "ai-connections", "routing.json");
    const original = JSON.stringify({ ...await f.store.read(), temporaryChatRole: "intern" });
    await writeFile(routingPath, original);
    assert.equal((await f.service.readModelRouting({ vibe64User: f.member })).temporaryChatRole, undefined);
    assert.equal(await readFile(routingPath, "utf8"), original);
    const updated = await f.service.saveModelRouting({ ...draft, revision: saved.revision });
    assert.equal(updated.ok, true, updated.error);
    assert.equal((await f.store.read()).temporaryChatRole, undefined);
    assert.equal((await f.service.saveModelRouting(draft)).code, "vibe64_assistant_routing_stale");
  });
});
