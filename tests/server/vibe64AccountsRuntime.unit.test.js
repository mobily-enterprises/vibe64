import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  CODEX_RECONNECT_REQUIRED_CODE,
  codexAuthMarkerPath,
  markCodexReconnectRequired,
  readCodexAuthStatus
} from "@local/vibe64-core/server/codexAuthState";
import {
  closeTerminalSessionsForNamespacePrefix,
  startTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT
} from "@local/vibe64-core/server/projectRepository";
import {
  Vibe64AccountsProvider
} from "../../packages/vibe64-accounts/src/server/Vibe64AccountsProvider.js";
import {
  VIBE64_CONNECTION_PURPOSE_SESSION,
  VIBE64_CONNECTIONS_SERVICE
} from "../../packages/vibe64-runtime/src/server/connectionReadiness.js";
import {
  VIBE64_MANAGED_APP_AUTH_SERVICE
} from "../../packages/vibe64-accounts/src/server/managedAppAuthService.js";
import {
  GITHUB_RECONNECT_REQUIRED_CODE,
  githubCliFailureDetails
} from "../../packages/setup-doctor-core/src/server/githubCliAuth.js";
import {
  createAccountsRuntime,
  createService,
  GITHUB_ACCOUNT_MODE_USER,
  VIBE64_ACCOUNTS_SERVICE
} from "../../packages/vibe64-accounts/src/server/service.js";
import {
  createVibe64AccountAuthSessionChangedPublisher,
  VIBE64_ACCOUNT_AUTH_SESSION_CHANGED_EVENT
} from "../../packages/vibe64-accounts/src/server/accountRealtimeEvents.js";
import {
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

async function writeReadyCodexMarker(systemRoot) {
  const markerPath = codexAuthMarkerPath(systemRoot);
  await mkdir(path.dirname(markerPath), {
    recursive: true
  });
  await writeFile(
    markerPath,
    `${JSON.stringify({
      connected: true,
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

function createProviderApp({
  env = null
} = {}) {
  const services = new Map();
  const serviceRegistrations = new Map();
  return {
    actions() {},
    has(token) {
      return token === "jskit.env" && env !== null;
    },
    make(token) {
      if (token === "jskit.env" && env !== null) {
        return env;
      }
      throw new Error(`Unexpected app lookup: ${token}`);
    },
    service(id, factory, options = {}) {
      services.set(id, factory);
      serviceRegistrations.set(id, {
        factory,
        options
      });
    },
    serviceRegistrations,
    services
  };
}

function accountServiceScope() {
  return {
    has() {
      return false;
    },
    make(id) {
      if (id === "feature.vibe64-project.service") {
        return {
          currentTargetRoot() {
            return "";
          }
        };
      }
      throw new Error(`Unexpected service lookup: ${id}`);
    }
  };
}

test("accounts provider captures system and target roots before lazy service creation", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const targetRoot = path.join(root, "target");
    await mkdir(targetRoot, {
      recursive: true
    });
    await writeReadyCodexMarker(systemRoot);

    const app = createProviderApp();

    await withEnv({
      [VIBE64_SYSTEM_ROOT_ENV]: systemRoot,
      [VIBE64_TARGET_ROOT_ENV]: targetRoot
    }, () => {
      new Vibe64AccountsProvider().register(app);
    });

    const serviceFactory = app.services.get(VIBE64_ACCOUNTS_SERVICE);
    assert.equal(typeof serviceFactory, "function");

    const service = await withEnv({
      [VIBE64_SYSTEM_ROOT_ENV]: path.join(root, "wrong-system"),
      [VIBE64_TARGET_ROOT_ENV]: path.join(root, "wrong-target")
    }, () => serviceFactory(accountServiceScope()));

    const status = await service.getStatus({
      accountIds: ["codex"]
    });
    assert.equal(status.ok, true);
    assert.equal(status.ready, true);
    assert.equal(status.accounts.find((account) => account.id === "codex")?.connected, true);
    assert.equal(status.targetRoot, targetRoot);
  });
});

test("accounts provider reads system and target roots from JSKIT runtime env", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const targetRoot = path.join(root, "target");
    await mkdir(targetRoot, {
      recursive: true
    });
    await writeReadyCodexMarker(systemRoot);

    const app = createProviderApp({
      env: {
        [VIBE64_SYSTEM_ROOT_ENV]: systemRoot,
        [VIBE64_TARGET_ROOT_ENV]: targetRoot
      }
    });

    await withEnv({
      [VIBE64_SYSTEM_ROOT_ENV]: null,
      [VIBE64_TARGET_ROOT_ENV]: null
    }, () => {
      new Vibe64AccountsProvider().register(app);
    });

    const serviceFactory = app.services.get(VIBE64_ACCOUNTS_SERVICE);
    assert.equal(typeof serviceFactory, "function");

    const service = await withEnv({
      [VIBE64_SYSTEM_ROOT_ENV]: null,
      [VIBE64_TARGET_ROOT_ENV]: null
    }, () => serviceFactory(accountServiceScope()));

    const status = await service.getStatus({
      accountIds: ["codex"]
    });
    assert.equal(status.ok, true);
    assert.equal(status.ready, true);
    assert.equal(status.accounts.find((account) => account.id === "codex")?.connected, true);
    assert.equal(status.targetRoot, targetRoot);
  });
});

test("accounts provider does not publish realtime events for auth-session reads", () => {
  const app = createProviderApp();

  new Vibe64AccountsProvider().register(app);

  const registration = app.serviceRegistrations.get(VIBE64_ACCOUNTS_SERVICE);
  assert.equal(typeof registration?.factory, "function");
  assert.deepEqual(Object.keys(registration.options.events).sort(), [
    "logout",
    "saveGitIdentity",
    "startAuth"
  ]);
  assert.equal(Object.hasOwn(registration.options.events, "readAuthSession"), false);
});

test("connections service omits managed app auth for session readiness", async () => {
  const app = createProviderApp();
  new Vibe64AccountsProvider().register(app);

  const serviceFactory = app.services.get(VIBE64_CONNECTIONS_SERVICE);
  assert.equal(typeof serviceFactory, "function");

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
  const appAuthConnection = {
    connected: false,
    id: "app_auth",
    message: "Configure app auth.",
    ok: true,
    required: true
  };
  const appAuthInputs = [];
  const service = serviceFactory({
    has(id) {
      return id === VIBE64_MANAGED_APP_AUTH_SERVICE;
    },
    make(id) {
      if (id === VIBE64_ACCOUNTS_SERVICE) {
        return {
          async getStatus() {
            return accountStatus;
          }
        };
      }
      if (id === VIBE64_MANAGED_APP_AUTH_SERVICE) {
        return {
          async getConnectionStatus(input = {}) {
            appAuthInputs.push(input);
            return appAuthConnection;
          }
        };
      }
      throw new Error(`Unexpected service lookup: ${id}`);
    }
  });

  const projectStatus = await service.getStatus({});
  assert.equal(projectStatus.ready, false);
  assert.equal(projectStatus.blockedReason, "Configure app auth.");
  assert.deepEqual(projectStatus.connections.map((connection) => connection.id), [
    "codex",
    "github",
    "app_auth"
  ]);

  const sessionStatus = await service.getStatus({
    connectionPurpose: VIBE64_CONNECTION_PURPOSE_SESSION
  });
  assert.equal(sessionStatus.ready, true);
  assert.equal(sessionStatus.blockedReason, "");
  assert.deepEqual(sessionStatus.connections.map((connection) => connection.id), [
    "codex",
    "github"
  ]);
  assert.deepEqual(appAuthInputs, [{}]);
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
  const app = createProviderApp();
  new Vibe64AccountsProvider().register(app);

  const serviceFactory = app.services.get(VIBE64_CONNECTIONS_SERVICE);
  assert.equal(typeof serviceFactory, "function");

  const accountInputs = [];
  let currentProject = {
    repository: {
      mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
    }
  };
  const service = serviceFactory({
    has(id) {
      return id === "feature.vibe64-project.service";
    },
    make(id) {
      if (id === VIBE64_ACCOUNTS_SERVICE) {
        return {
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
        };
      }
      if (id === "feature.vibe64-project.service") {
        return {
          async listProjects() {
            return {
              currentProject,
              ok: true,
              projects: [currentProject]
            };
          }
        };
      }
      throw new Error(`Unexpected service lookup: ${id}`);
    }
  });

  const managedStatus = await service.getStatus({});
  currentProject = {
    repository: {
      mode: PROJECT_REPOSITORY_MODE_GITHUB
    }
  };
  const githubStatus = await service.getStatus({});

  assert.deepEqual(accountInputs.map((input) => input.providerIds), [
    ["codex"],
    ["codex", "github"]
  ]);
  assert.deepEqual(managedStatus.connections.map((connection) => connection.id), ["codex"]);
  assert.deepEqual(githubStatus.connections.map((connection) => connection.id), ["codex", "github"]);
});

test("connections service treats local-source projects with GitHub metadata as non-GitHub", async () => {
  const app = createProviderApp();
  new Vibe64AccountsProvider().register(app);

  const serviceFactory = app.services.get(VIBE64_CONNECTIONS_SERVICE);
  assert.equal(typeof serviceFactory, "function");

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
  const service = serviceFactory({
    has(id) {
      return id === "feature.vibe64-project.service";
    },
    make(id) {
      if (id === VIBE64_ACCOUNTS_SERVICE) {
        return {
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
        };
      }
      if (id === "feature.vibe64-project.service") {
        return {
          async listProjects() {
            return {
              currentProject,
              ok: true,
              projects: [currentProject]
            };
          }
        };
      }
      throw new Error(`Unexpected service lookup: ${id}`);
    }
  });

  const status = await service.getStatus({});

  assert.deepEqual(accountInputs.map((input) => input.providerIds), [
    ["codex"]
  ]);
  assert.deepEqual(status.connections.map((connection) => connection.id), ["codex"]);
});

test("auth-session publisher emits a scoped session event", async () => {
  const events = [];
  const publishAuthSessionChanged = createVibe64AccountAuthSessionChangedPublisher({
    domainEvents: {
      async publish(event) {
        events.push(event);
        return event;
      }
    },
    methodName: "startAuth",
    serviceToken: VIBE64_ACCOUNTS_SERVICE
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
    reason: "terminal-output"
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].entity, "account-auth-session");
  assert.equal(events[0].entityId, "auth-session-1");
  assert.equal(events[0].meta.service.method, "startAuth");
  assert.equal(events[0].meta.realtime.event, VIBE64_ACCOUNT_AUTH_SESSION_CHANGED_EVENT);
  assert.deepEqual(events[0].meta.realtime.payload, {
    accountId: "codex",
    outputVersion: 2,
    reason: "terminal-output",
    session: {
      account: {
        id: "codex"
      },
      id: "auth-session-1",
      outputVersion: 2,
      status: "authenticating",
      terminalStatus: "running"
    },
    sessionId: "auth-session-1",
    status: "authenticating",
    terminalStatus: "running"
  });
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
      runToolchain: async (args = []) => {
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
        throw new Error(`Unexpected toolchain command: ${args.join(" ")}`);
      },
      startTerminalSessionFn: (input) => {
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
      startTerminalSessionFn: (input = {}) => {
        terminalStarts.push(input);
        return startTerminalSession({
          ...input,
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
      assert.equal(terminalStarts.length, 3);
      assert.equal(typeof terminalStarts[0].runningLimitFilter, "function");
    } finally {
      await closeTerminalSessionsForNamespacePrefix("vibe64-accounts");
    }
  });
});

test("accounts service delegates account toolchain commands to runtime override", async () => {
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
    const service = createService({
      accountRuntime: {
        ...baseRuntime,
        runToolchain: async (args = [], options = {}, { fallback = null } = {}) => {
          assert.equal(typeof fallback, "function");
          commands.push({
            args,
            options
          });
          assert.equal(options.toolHomeSource, githubHome);
          assert.equal(options.username, "ada");
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
          throw new Error(`Unexpected toolchain command: ${args.join(" ")}`);
        }
      },
      runToolchain: async () => {
        throw new Error("default account toolchain should not be used when runtime overrides it");
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
      runToolchain: async (args = []) => {
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
        throw new Error(`Unexpected toolchain command: ${args.join(" ")}`);
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
      runToolchain: async (args = []) => {
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
        throw new Error(`Unexpected toolchain command: ${args.join(" ")}`);
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

test("proven invalid GitHub auth keeps local status reconnect-required until live auth succeeds", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const githubHome = path.join(root, "homes", "local-user");
    const vibe64User = {
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
          requireExplicitRoots: true,
          systemRoot
        }),
        projectService: {
          currentTargetRoot() {
            return "";
          }
        },
        publishAccountChanged: async () => null,
        runToolchain: async (args = []) => {
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
          throw new Error(`Unexpected toolchain command: ${args.join(" ")}`);
        }
      });

      const initialStatus = await service.getStatus({
        providerIds: ["github"],
        vibe64User
      });
      assert.equal(initialStatus.accounts.find((account) => account.id === "github")?.connected, true);
      assert.equal(commands.length, 5);

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
      assert.equal(commands.length, 5);

      const liveStatus = await service.getStatus({
        providerIds: ["github"],
        refresh: true,
        vibe64User
      });
      const liveGithub = liveStatus.accounts.find((account) => account.id === "github");
      assert.equal(liveGithub.connected, true);
      assert.equal(liveGithub.username, "local-user");
      assert.equal(commands.length, 10);

      const clearedStatus = await service.getStatus({
        providerIds: ["github"],
        vibe64User
      });
      assert.equal(clearedStatus.accounts.find((account) => account.id === "github")?.connected, true);
      assert.equal(commands.length, 15);
    } finally {
      await chmod(githubHome, 0o700);
    }
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
      runToolchain: async (args = []) => {
        commands.push(args);
        throw new Error(`Unexpected toolchain command: ${args.join(" ")}`);
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

    assert.deepEqual(runtime.codexContext(), {
      gid: 2002,
      home: daemonHome,
      ok: true,
      scope: "app",
      toolHomeSource: daemonHome,
      uid: 2001,
      username: "v64d_workspace",
      userKey: "v64d_workspace"
    });
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
      runToolchain: async (args = []) => {
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
        throw new Error(`Unexpected toolchain command: ${args.join(" ")}`);
      },
      startTerminalSessionFn: (input = {}) => startTerminalSession({
        ...input,
        args: ["-e", "setTimeout(() => {}, 60_000);"],
        command: process.execPath,
        commandPreview: "node -e setTimeout",
        env: {}
      })
    });

    const session = await service.startAuth({
      accountId: "codex",
      mode: "device"
    });
    assert.equal(session.ok, true);
    assert.equal(session.status, "authenticating");

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
      runToolchain: async (args = []) => {
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
        throw new Error(`Unexpected toolchain command: ${args.join(" ")}`);
      }
    });

    const firstStatus = await service.getCodexStatus();
    const firstMarkerText = await readFile(markerPath, "utf8");

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
    await assert.rejects(
      () => readFile(markerPath, "utf8"),
      /ENOENT/u
    );
  });
});
