import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  runVibe64Command
} from "../../packages/vibe64-execution/src/server/runVibe64Command.js";
import {
  runPtyCommand
} from "../../packages/vibe64-execution/src/server/engines/pty.js";
import {
  closeTerminalSession,
  readTerminalSession
} from "../../packages/vibe64-execution/src/server/engines/terminalSessions.js";
import {
  assertActorHomeEnv,
  assertManagedSourceFilesystemActor,
  isManagedWorkspaceRuntime,
  realUserActorRequiresInstalledHelper
} from "../../packages/vibe64-execution/src/server/policy/permissionPolicy.js";
import {
  helperOperationForRequest,
  helperPayload,
  runHelperCommand
} from "../../packages/vibe64-execution/src/server/engines/helperClient.js";
import {
  databaseEnv
} from "../../packages/vibe64-execution/src/server/env/databaseEnv.js";
import {
  githubGitAuthScript
} from "../../packages/vibe64-execution/src/server/env/githubGitAuthShell.js";

const execFileAsync = promisify(execFile);

async function git(cwd, args, options = {}) {
  return execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    ...options
  });
}

async function existingDifferentUsername() {
  const currentUsername = os.userInfo().username;
  for (const username of ["root", "nobody", "daemon"]) {
    if (username === currentUsername) {
      continue;
    }
    try {
      await execFileAsync("getent", ["passwd", username], {
        encoding: "utf8"
      });
      return username;
    } catch {
      // Keep looking for a stable system account available in this environment.
    }
  }
  return "";
}

async function waitForFile(filePath, message = "Timed out waiting for file.") {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    try {
      return await readFile(filePath, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(message);
}

async function writeExecutable(filePath, content = "") {
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, content, "utf8");
  await chmod(filePath, 0o755);
}

async function waitForTerminalOutput(id, namespace, expectedText = "") {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const snapshot = readTerminalSession(id, {
      namespace
    });
    if (String(snapshot.output || "").includes(expectedText)) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return readTerminalSession(id, {
    namespace
  });
}

test("execution gateway reports capture timeouts as failures", async () => {
  const result = await runVibe64Command({
    args: [
      "-e",
      "setInterval(() => {}, 1000)"
    ],
    command: process.execPath,
    runtimes: [],
    timeout: 100
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.code, "vibe64_command_capture_timed_out");
  assert.match(result.output, /timed out/iu);
});

test("execution gateway injects shared tool and fallback git identity env", async () => {
  const currentUser = os.userInfo();
  const result = await runVibe64Command({
    command: process.execPath,
    args: [
      "-e",
      "console.log(JSON.stringify({ shared: process.env.VIBE64_SHARED_CACHE_ROOT, browsers: process.env.PLAYWRIGHT_BROWSERS_PATH, npmPrefix: process.env.NPM_CONFIG_PREFIX, path: process.env.PATH, author: process.env.GIT_AUTHOR_NAME, email: process.env.GIT_AUTHOR_EMAIL, committer: process.env.GIT_COMMITTER_NAME, committerEmail: process.env.GIT_COMMITTER_EMAIL }))"
    ],
    project: {
      tenant: "sas"
    },
    userKey: "merc"
  });

  assert.equal(result.ok, true, result.output);
  const env = JSON.parse(result.stdout);
  assert.equal(env.shared, "/var/cache/vibe64");
  assert.equal(env.browsers, "/opt/vibe64/runtime-packs/playwright/browsers");
  assert.equal(env.npmPrefix, path.join(currentUser.homedir, ".local"));
  const pathParts = env.path.split(":");
  assert.equal(pathParts[0], "/opt/vibe64/runtime-packs/policy-bin");
  assert.equal(pathParts[1], "/opt/vibe64/runtime-packs/managed-bin");
  assert.ok(pathParts.includes(path.join(currentUser.homedir, ".local", "bin")));
  assert.equal(env.author, "merc via Vibe64");
  assert.equal(env.email, "merc@sas.users.vibe64.invalid");
  assert.equal(env.committer, "Vibe64");
  assert.equal(env.committerEmail, "vibe64@sas.users.vibe64.invalid");
});

test("execution gateway gives Codex commands only their declared database env, fallback git identity, shared browser runtime, and actor HOME", async () => {
  const currentUser = os.userInfo();
  const result = await runVibe64Command({
    actor: "app",
    command: process.execPath,
    args: [
      "-e",
      [
        "console.log(JSON.stringify({",
        "home: process.env.HOME,",
        "dbHost: process.env.DB_HOST,",
        "dbName: process.env.DB_NAME,",
        "mysqlHost: process.env.MYSQL_HOST,",
        "mysqlDatabase: process.env.MYSQL_DATABASE,",
        "mysqlPort: process.env.MYSQL_TCP_PORT,",
        "mysqlUser: process.env.VIBE64_MYSQL_USER,",
        "browsers: process.env.PLAYWRIGHT_BROWSERS_PATH,",
        "author: process.env.GIT_AUTHOR_NAME,",
        "authorEmail: process.env.GIT_AUTHOR_EMAIL,",
        "committer: process.env.GIT_COMMITTER_NAME,",
        "committerEmail: process.env.GIT_COMMITTER_EMAIL",
        "}));"
      ].join("")
    ],
    project: {
      databaseEnv: {
        DB_CLIENT: "mysql2",
        DB_HOST: "127.0.0.1",
        DB_NAME: "sas_compas_next",
        DB_PASSWORD: "secret",
        DB_PORT: "24712",
        DB_USER: "vibe64_dev_app"
      },
      tenant: "sas"
    },
    purpose: "codex",
    userKey: "merc"
  });

  assert.equal(result.ok, true, result.output);
  assert.deepEqual(JSON.parse(result.stdout), {
    author: "merc via Vibe64",
    authorEmail: "merc@sas.users.vibe64.invalid",
    browsers: "/opt/vibe64/runtime-packs/playwright/browsers",
    committer: "Vibe64",
    committerEmail: "vibe64@sas.users.vibe64.invalid",
    dbHost: "127.0.0.1",
    dbName: "sas_compas_next",
    home: currentUser.homedir,
  });
});

test("execution gateway gives Codex PTY terminals the same declared DB, Git identity, browser runtime, and HOME env", async () => {
  const currentUser = os.userInfo();
  const namespace = `gateway-codex-env-${Date.now()}`;
  const result = await runVibe64Command({
    actor: "app",
    command: process.execPath,
    args: [
      "-e",
      [
        "console.log('VIBE64_ENV:' + JSON.stringify({",
        "home: process.env.HOME,",
        "dbHost: process.env.DB_HOST,",
        "dbName: process.env.DB_NAME,",
        "mysqlHost: process.env.MYSQL_HOST,",
        "mysqlDatabase: process.env.MYSQL_DATABASE,",
        "browsers: process.env.PLAYWRIGHT_BROWSERS_PATH,",
        "author: process.env.GIT_AUTHOR_NAME,",
        "authorEmail: process.env.GIT_AUTHOR_EMAIL",
        "}));"
      ].join("")
    ],
    mode: "pty",
    project: {
      databaseEnv: {
        DB_CLIENT: "mysql2",
        DB_HOST: "127.0.0.1",
        DB_NAME: "sas_compas_next"
      },
      tenant: "sas"
    },
    purpose: "codex",
    terminal: {
      commandPreview: "codex-env",
      namespace
    },
    userKey: "merc"
  });

  assert.equal(result.ok, true, result.error || "");
  try {
    const snapshot = await waitForTerminalOutput(result.id, namespace, "VIBE64_ENV:");
    const match = String(snapshot.output || "").match(/VIBE64_ENV:(\{[^\r\n]+\})/u);
    assert.ok(match, snapshot.output);
    assert.deepEqual(JSON.parse(match[1]), {
      author: "merc via Vibe64",
      authorEmail: "merc@sas.users.vibe64.invalid",
      browsers: "/opt/vibe64/runtime-packs/playwright/browsers",
      dbHost: "127.0.0.1",
      dbName: "sas_compas_next",
      home: currentUser.homedir,
    });
  } finally {
    await closeTerminalSession(result.id, {
      namespace
    });
  }
});

test("execution gateway gives detached Codex app-server commands the shared browser runtime and fallback identity", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "v64-detached-codex-env-"));
  try {
    const outputPath = path.join(tempDir, "env.json");
    const result = await runVibe64Command({
      actor: "app",
      allowedRoots: [tempDir],
      command: process.execPath,
      args: [
        "-e",
        [
          "require('node:fs').writeFileSync(",
          JSON.stringify(outputPath),
          ", JSON.stringify({",
          "browsers: process.env.PLAYWRIGHT_BROWSERS_PATH,",
          "author: process.env.GIT_AUTHOR_NAME,",
          "authorEmail: process.env.GIT_AUTHOR_EMAIL,",
          "committer: process.env.GIT_COMMITTER_NAME,",
          "committerEmail: process.env.GIT_COMMITTER_EMAIL",
          "}));"
        ].join("")
      ],
      cwd: tempDir,
      envPolicy: "auth",
      mode: "detached",
      project: {
        tenant: "sas"
      },
      purpose: "codex",
      runtimes: ["node26", "git", "playwright"],
      session: {
        metadata: {
          session_git_command_actor_user_key: "merc"
        },
        sessionId: "session-1",
        targetRoot: tempDir
      },
      userKey: "merc"
    });

    assert.equal(result.ok, true, result.error || result.output);
    assert.deepEqual(JSON.parse(await waitForFile(outputPath)), {
      author: "merc via Vibe64",
      authorEmail: "merc@sas.users.vibe64.invalid",
      browsers: "/opt/vibe64/runtime-packs/playwright/browsers",
      committer: "Vibe64",
      committerEmail: "vibe64@sas.users.vibe64.invalid"
    });
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("execution gateway does not let request env override shared tool cache policy", async () => {
  const result = await runVibe64Command({
    command: process.execPath,
    args: [
      "-e",
      "console.log(JSON.stringify({ shared: process.env.VIBE64_SHARED_CACHE_ROOT, browsers: process.env.PLAYWRIGHT_BROWSERS_PATH, skipDownload: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD }))"
    ],
    env: {
      PLAYWRIGHT_BROWSERS_PATH: "/tmp/wrong-playwright",
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "0",
      VIBE64_SHARED_CACHE_ROOT: "/tmp/wrong-cache"
    }
  });

  assert.equal(result.ok, true, result.output);
  assert.deepEqual(JSON.parse(result.stdout), {
    browsers: "/opt/vibe64/runtime-packs/playwright/browsers",
    shared: "/var/cache/vibe64",
    skipDownload: "1"
  });
});

test("execution gateway owner-user actor exposes matching real-user env", async () => {
  const currentUser = os.userInfo();
  const result = await runVibe64Command({
    actor: "owner-user",
    command: process.execPath,
    args: [
      "-e",
      "console.log(JSON.stringify({ home: process.env.HOME, logname: process.env.LOGNAME, user: process.env.USER }))"
    ],
    userKey: currentUser.username
  });

  assert.equal(result.ok, true, result.output);
  assert.deepEqual(JSON.parse(result.stdout), {
    home: currentUser.homedir,
    logname: currentUser.username,
    user: currentUser.username
  });
});

test("execution gateway forbids a human filesystem actor inside managed session source", async () => {
  const currentUser = os.userInfo();
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-managed-source-actor-"));
  try {
    const result = await runVibe64Command({
      actor: "owner-user",
      allowedRoots: [sourceRoot],
      command: process.execPath,
      cwd: sourceRoot,
      args: ["-e", "console.log('must-not-run')"],
      session: {
        sessionId: "session-1",
        sourceRoot
      },
      userKey: currentUser.username
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_command_managed_source_real_user_forbidden");
    assert.match(result.error, /workspace daemon filesystem identity/u);
  } finally {
    await rm(sourceRoot, {
      force: true,
      recursive: true
    });
  }
});

test("managed source actor policy permits the daemon and rejects a real user", () => {
  const sourceRoot = path.join(os.tmpdir(), "vibe64-source-policy");
  assert.doesNotThrow(() => assertManagedSourceFilesystemActor({
    requiresRealUser: false
  }, {
    session: { sourceRoot }
  }, sourceRoot));
  assert.throws(() => assertManagedSourceFilesystemActor({
    requiresRealUser: true
  }, {
    session: { sourceRoot }
  }, path.join(sourceRoot, "nested")), {
    code: "vibe64_command_managed_source_real_user_forbidden"
  });
});

test("execution gateway permits same-user direct execution only outside managed workspace runtime", () => {
  const currentUser = os.userInfo();
  const actor = {
    requiresRealUser: true,
    user: {
      gid: process.getgid(),
      home: currentUser.homedir,
      uid: process.getuid(),
      username: currentUser.username
    }
  };

  assert.equal(isManagedWorkspaceRuntime({}), false);
  assert.equal(realUserActorRequiresInstalledHelper(actor, {
    env: {}
  }), false);
  assert.equal(isManagedWorkspaceRuntime({
    VIBE64_WORKSPACE: "sas"
  }), true);
  assert.equal(realUserActorRequiresInstalledHelper(actor, {
    env: {
      VIBE64_WORKSPACE: "sas"
    }
  }), true);
  assert.equal(isManagedWorkspaceRuntime({
    VIBE64_WORKSPACE_DAEMON_USER: "v64d_sas"
  }), true);
  assert.equal(realUserActorRequiresInstalledHelper(actor, {
    env: {
      VIBE64_WORKSPACE_DAEMON_USER: "v64d_sas"
    }
  }), true);
});

test("execution gateway bars same-user detached real-user commands in managed workspace runtime", async () => {
  const currentUser = os.userInfo();
  const previousWorkspace = process.env.VIBE64_WORKSPACE;
  process.env.VIBE64_WORKSPACE = "sas";
  try {
    const result = await runVibe64Command({
      actor: "owner-user",
      command: process.execPath,
      args: [
        "-e",
        "console.log('should-not-run')"
      ],
      execution: {
        ownerId: "managed-detached-test"
      },
      mode: "detached",
      userKey: currentUser.username
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_command_detached_real_user_unsupported");
    assert.match(result.error, /helper is required/u);
  } finally {
    if (previousWorkspace === undefined) {
      delete process.env.VIBE64_WORKSPACE;
    } else {
      process.env.VIBE64_WORKSPACE = previousWorkspace;
    }
  }
});

test("execution gateway gives terminal and Codex the same shared Playwright runtime env", async () => {
  const command = process.execPath;
  const args = [
    "-e",
    "console.log(process.env.PLAYWRIGHT_BROWSERS_PATH)"
  ];
  const terminal = await runVibe64Command({
    args,
    command,
    purpose: "terminal"
  });
  const codex = await runVibe64Command({
    args,
    command,
    purpose: "codex"
  });

  assert.equal(terminal.ok, true, terminal.output);
  assert.equal(codex.ok, true, codex.output);
  assert.equal(terminal.stdout.trim(), "/opt/vibe64/runtime-packs/playwright/browsers");
  assert.equal(codex.stdout.trim(), terminal.stdout.trim());
});

test("execution gateway gives preview and terminal commands the same runtime PATH policy", async () => {
  const args = [
    "-e",
    "console.log(process.env.PATH)"
  ];
  const terminal = await runVibe64Command({
    args,
    command: process.execPath,
    purpose: "terminal",
    runtimes: ["node26", "git", "mysql", "playwright"]
  });
  const preview = await runVibe64Command({
    args,
    command: process.execPath,
    envPolicy: "preview",
    purpose: "preview",
    runtimes: ["node26", "git", "mysql", "playwright"]
  });

  assert.equal(terminal.ok, true, terminal.output);
  assert.equal(preview.ok, true, preview.output);
  assert.equal(preview.stdout.trim(), terminal.stdout.trim());
});

test("execution gateway preserves database env names without projecting aliases", async () => {
  assert.deepEqual(databaseEnv({ DB_PASSWORD: "" }), { DB_PASSWORD: "" });
  assert.deepEqual(databaseEnv({
    DB_CLIENT: "mysql2",
    DB_HOST: "127.0.0.1",
    DB_NAME: "tenant_app",
    DB_PASSWORD: "secret",
    DB_PORT: "3307",
    DB_USER: "vibe64_dev_app"
  }), {
    DB_CLIENT: "mysql2",
    DB_HOST: "127.0.0.1",
    DB_NAME: "tenant_app",
    DB_PASSWORD: "secret",
    DB_PORT: "3307",
    DB_USER: "vibe64_dev_app"
  });

  assert.deepEqual(databaseEnv({
    MYSQL_DATABASE: "legacy_app",
    MYSQL_HOST: "localhost",
    MYSQL_PWD: "legacy-secret",
    MYSQL_TCP_PORT: "3310",
    VIBE64_MYSQL_USER: "root"
  }), {
    MYSQL_DATABASE: "legacy_app",
    MYSQL_HOST: "localhost",
    MYSQL_PWD: "legacy-secret",
    MYSQL_TCP_PORT: "3310",
    VIBE64_MYSQL_USER: "root"
  });

  assert.deepEqual(databaseEnv({
    DB_CLIENT: "pg",
    DB_HOST: "127.0.0.1",
    DB_NAME: "tenant_app",
    DB_PASSWORD: "secret",
    DB_PORT: "5432",
    DB_USER: "tenant_app"
  }), {
    DB_CLIENT: "pg",
    DB_HOST: "127.0.0.1",
    DB_NAME: "tenant_app",
    DB_PASSWORD: "secret",
    DB_PORT: "5432",
    DB_USER: "tenant_app"
  });
});

test("execution gateway transports exact trusted deployment names without a database registry", async () => {
  const dbProbeArgs = [
    "-e",
    [
      "console.log(JSON.stringify({",
      "applicationDatabase: process.env.APPLICATION_DATABASE_NAME || '',",
      "db: process.env.DB_NAME,",
      "database: process.env.DB_DATABASE || '',",
      "mysql: process.env.MYSQL_DATABASE || '',",
      "password: process.env.MYSQL_PWD || '',",
      "port: process.env.MYSQL_TCP_PORT || '',",
      "username: process.env.DB_USERNAME || ''",
      "}));"
    ].join("")
  ];
  const preview = await runVibe64Command({
    args: dbProbeArgs,
    command: process.execPath,
    envPolicy: "preview",
    project: {
      runtimeConfigEnv: {
        DB_CLIENT: "mysql2",
        DB_NAME: "preview_db",
        DB_PASSWORD: "preview-secret",
        DB_PORT: "24712"
      }
    },
    purpose: "preview"
  });
  const deployment = await runVibe64Command({
    args: dbProbeArgs,
    command: process.execPath,
    envPolicy: "deployment",
    project: {
      deploymentEnv: {
        APPLICATION_DATABASE_NAME: "catalogue",
        DB_CLIENT: "mysql2",
        DB_DATABASE: "deployment_database",
        DB_NAME: "deployment_db",
        DB_PASSWORD: "deployment-secret",
        DB_PORT: "3306",
        DB_USERNAME: "deployment_writer"
      }
    },
    purpose: "deployment"
  });

  assert.equal(preview.ok, true, preview.output);
  assert.equal(deployment.ok, true, deployment.output);
  assert.deepEqual(JSON.parse(preview.stdout), {
    applicationDatabase: "",
    db: "preview_db",
    database: "",
    mysql: "",
    password: "",
    port: "",
    username: ""
  });
  assert.deepEqual(JSON.parse(deployment.stdout), {
    applicationDatabase: "catalogue",
    db: "deployment_db",
    database: "deployment_database",
    mysql: "",
    password: "",
    port: "",
    username: "deployment_writer"
  });
});

test("execution gateway env policies keep deployment commands away from session-only DB secrets", async () => {
  const result = await runVibe64Command({
    args: [
      "-e",
      [
        "console.log(JSON.stringify({",
        "db: process.env.DB_NAME || '',",
        "password: process.env.DB_PASSWORD || '',",
        "mysqlPassword: process.env.MYSQL_PWD || ''",
        "}));"
      ].join("")
    ],
    baseEnv: {
      DB_NAME: "ambient_session_db",
      DB_PASSWORD: "ambient-session-secret"
    },
    command: process.execPath,
    env: {
      DB_NAME: "caller_session_db",
      DB_PASSWORD: "caller-session-secret"
    },
    envPolicy: "deployment",
    project: {
      deploymentEnv: {
        DB_CLIENT: "mysql2",
        DB_NAME: "production_db",
        DB_PASSWORD: "production-secret"
      }
    },
    purpose: "deployment"
  });

  assert.equal(result.ok, true, result.output);
  assert.deepEqual(JSON.parse(result.stdout), {
    db: "production_db",
    mysqlPassword: "",
    password: "production-secret"
  });
});

test("execution gateway gives deployment commands production DB env, Git identity, shared cache, and GitHub transport", async () => {
  const currentUser = os.userInfo();
  const result = await runVibe64Command({
    actor: "owner-user",
    args: [
      "-e",
      [
        "const config = [];",
        "for (let index = 0; index < Number(process.env.GIT_CONFIG_COUNT || 0); index += 1) {",
        "config.push([process.env[`GIT_CONFIG_KEY_${index}`], process.env[`GIT_CONFIG_VALUE_${index}`]]);",
        "}",
        "console.log(JSON.stringify({",
        "author: process.env.GIT_AUTHOR_NAME,",
        "authorEmail: process.env.GIT_AUTHOR_EMAIL,",
        "browsers: process.env.PLAYWRIGHT_BROWSERS_PATH,",
        "db: process.env.DB_NAME,",
        "gitPrompt: process.env.GIT_TERMINAL_PROMPT,",
        "home: process.env.HOME,",
        "mysql: process.env.MYSQL_DATABASE,",
        "mysqlPassword: process.env.MYSQL_PWD,",
        "transport: config",
        "}));"
      ].join("")
    ],
    command: process.execPath,
    envPolicy: "deployment",
    gitTransport: "github-https",
    project: {
      deploymentEnv: {
        DB_CLIENT: "mysql2",
        DB_HOST: "127.0.0.1",
        DB_NAME: "prod_sas_app",
        DB_PASSWORD: "prod-secret",
        DB_PORT: "3306",
        DB_USER: "vibe64_prod_app"
      },
      tenant: "sas"
    },
    purpose: "deployment",
    runtimes: ["git", "gh", "playwright"],
    userKey: currentUser.username
  });

  assert.equal(result.ok, true, result.output);
  const env = JSON.parse(result.stdout);
  assert.equal(env.author, `${currentUser.username} via Vibe64`);
  assert.equal(env.authorEmail, `${currentUser.username}@sas.users.vibe64.invalid`);
  assert.equal(env.browsers, "/opt/vibe64/runtime-packs/playwright/browsers");
  assert.equal(env.db, "prod_sas_app");
  assert.equal(env.gitPrompt, "0");
  assert.equal(env.home, currentUser.homedir);
  assert.equal(env.mysql, undefined);
  assert.equal(env.mysqlPassword, undefined);
  assert.deepEqual(env.transport, [
    ["url.https://github.com/.insteadOf", "git@github.com:"],
    ["url.https://github.com/.insteadOf", "ssh://git@github.com/"],
    ["credential.https://github.com.helper", "!/usr/bin/env gh auth git-credential"]
  ]);
});

test("execution gateway gives deployment commands shared runtimes by default", async () => {
  const result = await runVibe64Command({
    args: [
      "-e",
      "console.log(process.env.PATH)"
    ],
    command: process.execPath,
    purpose: "deployment"
  });

  assert.equal(result.ok, true, result.output);
  const pathParts = result.stdout.split(":");
  assert.ok(pathParts.includes("/opt/vibe64/runtime-packs/node26/bin"));
  assert.ok(pathParts.includes("/opt/vibe64/runtime-packs/git/bin"));
  assert.ok(pathParts.includes("/opt/vibe64/runtime-packs/bun/bin"));
  assert.ok(pathParts.includes("/opt/vibe64/runtime-packs/playwright/bin"));
});

test("execution gateway streams capture output through onOutput", async () => {
  const chunks = [];
  const result = await runVibe64Command({
    args: [
      "-e",
      "process.stdout.write('alpha\\n'); process.stderr.write('beta\\n');"
    ],
    command: process.execPath,
    onOutput: (chunk) => {
      chunks.push(String(chunk || ""));
    },
    purpose: "deployment"
  });

  assert.equal(result.ok, true, result.output);
  assert.match(chunks.join(""), /alpha/u);
  assert.match(chunks.join(""), /beta/u);
});

test("execution gateway project env policy does not inherit session database env", async () => {
  const result = await runVibe64Command({
    args: [
      "-e",
      [
        "console.log(JSON.stringify({",
        "db: process.env.DB_NAME || '',",
        "password: process.env.DB_PASSWORD || '',",
        "mysqlPassword: process.env.MYSQL_PWD || ''",
        "}));"
      ].join("")
    ],
    baseEnv: {
      DB_NAME: "ambient_session_db",
      DB_PASSWORD: "ambient-session-secret"
    },
    command: process.execPath,
    envPolicy: "project",
    project: {
      databaseEnv: {
        DB_NAME: "project_db"
      }
    },
    session: {
      databaseEnv: {
        DB_NAME: "session_db",
        DB_PASSWORD: "session-secret"
      }
    },
    purpose: "source"
  });

  assert.equal(result.ok, true, result.output);
  assert.deepEqual(JSON.parse(result.stdout), {
    db: "project_db",
    mysqlPassword: "",
    password: ""
  });
});

test("execution gateway gives setup commands session secrets only with session env policy", async () => {
  const args = [
    "-e",
    "console.log(JSON.stringify({ db: process.env.DB_NAME || '', password: process.env.DB_PASSWORD || '' }))"
  ];
  const projectPolicy = await runVibe64Command({
    args,
    command: process.execPath,
    envPolicy: "project",
    purpose: "source",
    session: {
      databaseEnv: {
        DB_NAME: "session_only_db",
        DB_PASSWORD: "session-secret"
      }
    }
  });
  const sessionPolicy = await runVibe64Command({
    args,
    command: process.execPath,
    envPolicy: "session",
    purpose: "source",
    session: {
      databaseEnv: {
        DB_NAME: "session_only_db",
        DB_PASSWORD: "session-secret"
      }
    }
  });

  assert.equal(projectPolicy.ok, true, projectPolicy.output);
  assert.equal(sessionPolicy.ok, true, sessionPolicy.output);
  assert.deepEqual(JSON.parse(projectPolicy.stdout), {
    db: "",
    password: ""
  });
  assert.deepEqual(JSON.parse(sessionPolicy.stdout), {
    db: "session_only_db",
    password: "session-secret"
  });
});

test("execution gateway resolves project Env records without inventing database aliases", async () => {
  const result = await runVibe64Command({
    args: [
      "-e",
      [
        "console.log(JSON.stringify({",
        "publicUrl: process.env.APP_PUBLIC_URL,",
        "db: process.env.DB_NAME,",
        "mysql: process.env.MYSQL_DATABASE,",
        "mysqlHost: process.env.MYSQL_HOST,",
        "mysqlPassword: process.env.MYSQL_PWD,",
        "browsers: process.env.PLAYWRIGHT_BROWSERS_PATH",
        "}));"
      ].join("")
    ],
    command: process.execPath,
    envPolicy: "project",
    project: {
      runtimeConfigEnv: {
        APP_PUBLIC_URL: "http://localhost:3000",
        DB_CLIENT: "mysql2",
        DB_HOST: "127.0.0.1",
        DB_NAME: "sas_compas_next",
        DB_PASSWORD: "runtime-secret"
      }
    },
    purpose: "terminal"
  });

  assert.equal(result.ok, true, result.output);
  assert.deepEqual(JSON.parse(result.stdout), {
    browsers: "/opt/vibe64/runtime-packs/playwright/browsers",
    db: "sas_compas_next",
    publicUrl: "http://localhost:3000"
  });
});

test("execution gateway ignores caller-provided Git identity policy env", async () => {
  const result = await runVibe64Command({
    args: [
      "-e",
      "console.log(JSON.stringify({ name: process.env.GIT_AUTHOR_NAME, email: process.env.GIT_AUTHOR_EMAIL }))"
    ],
    command: process.execPath,
    env: {
      GIT_AUTHOR_EMAIL: "wrong@example.invalid",
      GIT_AUTHOR_NAME: "Wrong User"
    },
    project: {
      tenant: "sas"
    },
    userKey: "merc"
  });

  assert.equal(result.ok, true, result.output);
  assert.deepEqual(JSON.parse(result.stdout), {
    email: "merc@sas.users.vibe64.invalid",
    name: "merc via Vibe64"
  });
});

test("execution gateway fallback git identity allows local commits without git config", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-exec-git-"));
  await git(root, ["init", "-b", "main"]);
  await writeFile(path.join(root, "README.md"), "hello\n", "utf8");

  const add = await runVibe64Command({
    command: "git",
    args: ["add", "README.md"],
    cwd: root,
    project: {
      tenant: "localtenant"
    },
    runtimes: ["git"],
    userKey: "localuser"
  });
  assert.equal(add.ok, true, add.output);

  const commit = await runVibe64Command({
    command: "git",
    args: ["commit", "-m", "Initial local commit"],
    cwd: root,
    project: {
      tenant: "localtenant"
    },
    runtimes: ["git"],
    userKey: "localuser"
  });
  assert.equal(commit.ok, true, commit.output);

  const log = await git(root, ["log", "-1", "--format=%an <%ae>|%cn <%ce>"]);
  assert.equal(
    log.stdout.trim(),
    "localuser via Vibe64 <localuser@localtenant.users.vibe64.invalid>|Vibe64 <vibe64@localtenant.users.vibe64.invalid>"
  );
});

test("execution gateway preserves dynamic PTY database env through caller env policy", async () => {
  const namespace = `gateway-dynamic-db-${Date.now()}`;
  const result = await runVibe64Command({
    args: [
      "-e",
      [
        "console.log('VIBE64_ENV:' + JSON.stringify({",
        "db: process.env.DB_NAME,",
        "mysql: process.env.MYSQL_DATABASE,",
        "password: process.env.DB_PASSWORD",
        "}));"
      ].join("")
    ],
    command: process.execPath,
    env: () => ({
      DB_CLIENT: "mysql2",
      DB_NAME: "dynamic_db",
      DB_PASSWORD: "dynamic-secret"
    }),
    mode: "pty",
    terminal: {
      commandPreview: "dynamic-db-env",
      namespace
    }
  });

  assert.equal(result.ok, true, result.error || "");
  try {
    const snapshot = await waitForTerminalOutput(result.id, namespace, "VIBE64_ENV:");
    const match = String(snapshot.output || "").match(/VIBE64_ENV:(\{[^\r\n]+\})/u);
    assert.ok(match, snapshot.output);
    assert.deepEqual(JSON.parse(match[1]), {
      db: "dynamic_db",
      password: "dynamic-secret"
    });
  } finally {
    await closeTerminalSession(result.id, {
      namespace
    });
  }
});

test("execution gateway prefers explicitly configured nested Git identity", async () => {
  const result = await runVibe64Command({
    args: [
      "-e",
      "console.log(JSON.stringify({ name: process.env.GIT_AUTHOR_NAME, email: process.env.GIT_AUTHOR_EMAIL, committer: process.env.GIT_COMMITTER_NAME }))"
    ],
    command: process.execPath,
    project: {
      config: {
        git: {
          user: {
            email: "configured@example.invalid",
            name: "Configured User"
          }
        }
      },
      tenant: "sas"
    },
    userKey: "merc"
  });

  assert.equal(result.ok, true, result.output);
  assert.deepEqual(JSON.parse(result.stdout), {
    committer: "Configured User",
    email: "configured@example.invalid",
    name: "Configured User"
  });
});

test("execution gateway prefers GitHub identity before fallback identity", async () => {
  const result = await runVibe64Command({
    args: [
      "-e",
      "console.log(JSON.stringify({ name: process.env.GIT_AUTHOR_NAME, email: process.env.GIT_AUTHOR_EMAIL, committer: process.env.GIT_COMMITTER_NAME }))"
    ],
    command: process.execPath,
    project: {
      githubUser: {
        email: "octo@example.invalid",
        login: "octocat"
      },
      tenant: "sas"
    },
    userKey: "merc"
  });

  assert.equal(result.ok, true, result.output);
  assert.deepEqual(JSON.parse(result.stdout), {
    committer: "octocat",
    email: "octo@example.invalid",
    name: "octocat"
  });
});

test("execution gateway lets GitHub projects make local commits with fallback identity even without auth", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-exec-github-local-"));
  await git(root, ["init", "-b", "main"]);
  await writeFile(path.join(root, "README.md"), "hello\n", "utf8");

  const add = await runVibe64Command({
    command: "git",
    args: ["add", "README.md"],
    cwd: root,
    gitTransport: "github-https",
    project: {
      tenant: "sas"
    },
    purpose: "github",
    runtimes: ["git"],
    userKey: "merc"
  });
  assert.equal(add.ok, true, add.output);

  const commit = await runVibe64Command({
    command: "git",
    args: ["commit", "-m", "Local GitHub-project commit"],
    cwd: root,
    gitTransport: "github-https",
    project: {
      tenant: "sas"
    },
    purpose: "github",
    runtimes: ["git"],
    userKey: "merc"
  });
  assert.equal(commit.ok, true, commit.output);

  const log = await git(root, ["log", "-1", "--format=%an <%ae>|%cn <%ce>"]);
  assert.equal(
    log.stdout.trim(),
    "merc via Vibe64 <merc@sas.users.vibe64.invalid>|Vibe64 <vibe64@sas.users.vibe64.invalid>"
  );
});

test("execution gateway applies shim and runtime pack PATH in gateway order", async () => {
  const result = await runVibe64Command({
    command: process.execPath,
    args: [
      "-e",
      "console.log(process.env.PATH)"
    ],
    env: {
      VIBE64_RUNTIME_PACK_ROOT: "/runtime-packs"
    },
    runtimes: [
      "node26",
      "git",
      "gh",
      "mysql",
      "ripgrep",
      "bun",
      "playwright",
      "operator-clis"
    ],
    shimDirs: [
      "/tmp/vibe64-git-shim"
    ]
  });

  assert.equal(result.ok, true, result.output);
  const parts = result.stdout.split(":");
  assert.equal(parts[0], "/tmp/vibe64-git-shim");
  assert.deepEqual(parts.slice(1, 12), [
    "/runtime-packs/policy-bin",
    "/runtime-packs/node26/bin",
    "/runtime-packs/git/bin",
    "/runtime-packs/gh/bin",
    "/runtime-packs/mariadb/bin",
    "/runtime-packs/ripgrep/bin",
    "/runtime-packs/bun/bin",
    "/runtime-packs/playwright/bin",
    "/runtime-packs/managed-bin",
    "/runtime-packs/operator-clis/bin",
    "/runtime-packs/guard-bin"
  ]);
});

test("execution gateway gives interactive command purposes the shared runtime pack PATH by default", async () => {
  const result = await runVibe64Command({
    command: process.execPath,
    args: [
      "-e",
      "console.log(process.env.PATH)"
    ],
    env: {
      VIBE64_RUNTIME_PACK_ROOT: "/runtime-packs"
    },
    purpose: "terminal"
  });

  assert.equal(result.ok, true, result.output);
  const parts = result.stdout.split(":");
  assert.deepEqual(parts.slice(0, 15), [
    "/runtime-packs/policy-bin",
    "/runtime-packs/managed-bin",
    "/runtime-packs/operator-clis/bin",
    "/runtime-packs/node26/bin",
    "/runtime-packs/git/bin",
    "/runtime-packs/gh/bin",
    "/runtime-packs/mariadb/bin",
    "/runtime-packs/postgresql/bin",
    "/runtime-packs/ripgrep/bin",
    "/runtime-packs/bubblewrap/bin",
    "/runtime-packs/bun/bin",
    "/runtime-packs/php/bin",
    "/runtime-packs/composer/bin",
    "/runtime-packs/playwright/bin",
    "/runtime-packs/guard-bin"
  ]);
});

test("execution gateway lets declared runtime tools win before guard-bin", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "v64-runtime-guard-"));
  await writeExecutable(
    path.join(runtimeRoot, "node26", "bin", "npm"),
    "#!/usr/bin/env bash\nprintf '%s\\n' vibe64-node26-npm\n"
  );
  await writeExecutable(
    path.join(runtimeRoot, "guard-bin", "npm"),
    "#!/usr/bin/env bash\necho 'guard should not run' >&2\nexit 127\n"
  );

  const result = await runVibe64Command({
    command: "bash",
    args: [
      "-lc",
      "command -v npm && npm --version"
    ],
    env: {
      VIBE64_RUNTIME_PACK_ROOT: runtimeRoot
    },
    purpose: "terminal",
    runtimes: ["node26"]
  });

  assert.equal(result.ok, true, result.output);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/u), [
    path.join(runtimeRoot, "node26", "bin", "npm"),
    "vibe64-node26-npm"
  ]);
});

test("execution gateway blocks managed host tools when runtimes are explicitly empty", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "v64-runtime-guard-empty-"));
  await writeExecutable(
    path.join(runtimeRoot, "guard-bin", "npm"),
    [
      "#!/usr/bin/env bash",
      "echo 'Vibe64 runtime error: npm requires runtime node26.' >&2",
      "echo 'The command did not declare that runtime, so host npm was blocked.' >&2",
      "exit 127"
    ].join("\n")
  );

  const result = await runVibe64Command({
    command: "bash",
    args: [
      "-lc",
      "npm --version"
    ],
    env: {
      VIBE64_RUNTIME_PACK_ROOT: runtimeRoot
    },
    purpose: "terminal",
    runtimes: []
  });

  assert.equal(result.ok, false, result.output);
  assert.match(result.output, /Vibe64 runtime error: npm requires runtime node26\./u);
  assert.match(result.output, /host npm was blocked/u);
});

test("execution gateway owns GitHub transport and safe-directory env", async () => {
  const result = await runVibe64Command({
    command: process.execPath,
    args: [
      "-e",
      "console.log(JSON.stringify(process.env))"
    ],
    gitSafeDirectories: [
      "/var/lib/vibe64/sas/projects/compas-next",
      "/var/lib/vibe64/sas/projects/compas-next/sessions/active/one/source"
    ],
    gitTransport: "github-https",
    purpose: "github",
    runtimes: ["git", "gh"]
  });

  assert.equal(result.ok, true, result.output);
  const env = JSON.parse(result.stdout);
  const entries = Array.from({
    length: Number(env.GIT_CONFIG_COUNT || 0)
  }, (_, index) => ({
    key: env[`GIT_CONFIG_KEY_${index}`],
    value: env[`GIT_CONFIG_VALUE_${index}`]
  }));
  assert.equal(env.GH_PROMPT_DISABLED, "1");
  assert.equal(env.GIT_PAGER, "cat");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.ok(entries.some((entry) => entry.key === "url.https://github.com/.insteadOf" && entry.value === "git@github.com:"));
  assert.ok(entries.some((entry) => entry.key === "credential.https://github.com.helper" && entry.value === "!/usr/bin/env gh auth git-credential"));
  assert.ok(entries.some((entry) => entry.key === "safe.directory" && entry.value === "/var/lib/vibe64/sas/projects/compas-next"));
  assert.ok(entries.some((entry) => entry.key === "safe.directory" && entry.value === "/var/lib/vibe64/sas/projects/compas-next/sessions/active/one/source"));
});

test("execution gateway owns token-backed GitHub git transport without gh helper", async () => {
  const result = await runVibe64Command({
    command: process.execPath,
    args: [
      "-e",
      "console.log(JSON.stringify(process.env))"
    ],
    gitAuthToken: "github-token",
    gitSafeDirectories: [
      "/var/lib/vibe64/sas/projects/compas-next"
    ],
    gitTransport: "github-token",
    purpose: "deployment",
    runtimes: ["git"]
  });

  assert.equal(result.ok, true, result.output);
  const env = JSON.parse(result.stdout);
  const entries = Array.from({
    length: Number(env.GIT_CONFIG_COUNT || 0)
  }, (_, index) => ({
    key: env[`GIT_CONFIG_KEY_${index}`],
    value: env[`GIT_CONFIG_VALUE_${index}`]
  }));
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.VIBE64_GIT_AUTH_TOKEN, "github-token");
  assert.equal(env.VIBE64_DECLARED_RUNTIMES, "git");
  assert.ok(entries.some((entry) => entry.key === "url.https://github.com/.insteadOf" && entry.value === "git@github.com:"));
  assert.ok(entries.some((entry) => entry.key === "credential.https://github.com.helper" && entry.value.includes("VIBE64_GIT_AUTH_TOKEN")));
  assert.equal(entries.some((entry) => String(entry.value || "").includes("gh auth git-credential")), false);
  assert.ok(entries.some((entry) => entry.key === "safe.directory" && entry.value === "/var/lib/vibe64/sas/projects/compas-next"));
});

test("GitHub auth shell preserves an injected token without requiring askpass", async () => {
  const result = await runVibe64Command({
    args: [
      "-lc",
      [
        "set -euo pipefail",
        githubGitAuthScript(),
        "gh() { return 1; }",
        "vibe64_enable_github_git_auth_for_url https://github.com/vibe64/example.git",
        "test \"$VIBE64_GIT_AUTH_TOKEN\" = github-token",
        "test -z \"${GIT_ASKPASS:-}\""
      ].join("\n")
    ],
    command: "bash",
    gitAuthToken: "github-token",
    gitTransport: "github-token",
    purpose: "github",
    runtimes: ["git"]
  });

  assert.equal(result.ok, true, result.output);
});

test("execution gateway rejects token-backed GitHub git transport without a token", async () => {
  const result = await runVibe64Command({
    command: process.execPath,
    args: [
      "-e",
      "console.log('should not run')"
    ],
    gitTransport: "github-token",
    purpose: "deployment",
    runtimes: ["git"]
  });

  assert.equal(result.ok, false, result.output);
  assert.equal(result.code, "vibe64_command_git_auth_token_required");
  assert.match(result.output, /Token-backed GitHub transport requires a gitAuthToken/u);
});

test("execution gateway resolves GitHub credential HOME and transport env together", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-github-credential-home-"));
  const result = await runVibe64Command({
    actor: "app",
    command: process.execPath,
    args: [
      "-e",
      [
        "console.log(JSON.stringify({",
        "home: process.env.HOME,",
        "credentialHome: process.env.VIBE64_CREDENTIAL_HOME,",
        "xdgConfig: process.env.XDG_CONFIG_HOME,",
        "ghPrompt: process.env.GH_PROMPT_DISABLED,",
        "gitPrompt: process.env.GIT_TERMINAL_PROMPT",
        "}));"
      ].join("")
    ],
    credentialHome: {
      home: root,
      username: "github-tool"
    },
    gitTransport: "github-https",
    purpose: "github",
    runtimes: ["git", "gh"]
  });

  assert.equal(result.ok, true, result.output);
  assert.deepEqual(JSON.parse(result.stdout), {
    credentialHome: root,
    ghPrompt: "1",
    gitPrompt: "0",
    home: root,
    xdgConfig: path.join(root, ".config")
  });
});

test("execution gateway allows declared non-home credential homes for app actors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-credential-home-"));
  const result = await runVibe64Command({
    actor: "app",
    command: process.execPath,
    args: [
      "-e",
      "console.log(JSON.stringify({ home: process.env.HOME, marker: process.env.VIBE64_CREDENTIAL_HOME, xdg: process.env.XDG_CONFIG_HOME }))"
    ],
    credentialHome: {
      home: root,
      username: "tool"
    }
  });

  assert.equal(result.ok, true, result.output);
  assert.deepEqual(JSON.parse(result.stdout), {
    home: root,
    marker: root,
    xdg: path.join(root, ".config")
  });
});

test("execution gateway rejects /home credential homes without matching real-user actor", async () => {
  const result = await runVibe64Command({
    actor: "app",
    command: process.execPath,
    args: ["-e", ""],
    credentialHome: {
      home: "/home/not-the-process-user",
      username: "not-the-process-user"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_command_credential_home_real_user_required");
});

test("execution gateway allows app credential homes inside the current actor home", async () => {
  const credentialHome = path.join(os.homedir(), ".codex");
  const result = await runVibe64Command({
    actor: "app",
    command: process.execPath,
    args: [
      "-e",
      "console.log(JSON.stringify({ home: process.env.HOME, marker: process.env.VIBE64_CREDENTIAL_HOME }))"
    ],
    credentialHome: {
      home: credentialHome,
      username: os.userInfo().username
    }
  });

  assert.equal(result.ok, true, result.output);
  assert.deepEqual(JSON.parse(result.stdout), {
    home: credentialHome,
    marker: credentialHome
  });
});

test("execution gateway detached mode starts a long-running process and returns its pid", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-exec-detached-"));
  const markerPath = path.join(root, "marker.txt");
  const logPath = path.join(root, "detached.log");
  const result = await runVibe64Command({
    command: process.execPath,
    args: [
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "started\\n");`
    ],
    cwd: root,
    execution: {
      ownerId: "detached-test"
    },
    logPath,
    mode: "detached",
    purpose: "codex"
  });

  assert.equal(result.ok, true, result.output);
  assert.equal(Number.isSafeInteger(result.pid), true);
  assert.equal(await waitForFile(markerPath), "started\n");
  assert.equal(await readFile(logPath, "utf8"), "");
});

test("execution gateway rejects detached real-user commands when the process is not that user", async () => {
  const username = await existingDifferentUsername();
  if (!username) {
    return;
  }

  const result = await runVibe64Command({
    actor: "named-user",
    command: process.execPath,
    args: [
      "-e",
      "console.log('should not run')"
    ],
    execution: {
      ownerId: "real-user-detached-test"
    },
    mode: "detached",
    purpose: "codex",
    userKey: username
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_command_detached_real_user_unsupported");
});

test("execution gateway preserves captured streams and normalizes the display result", async () => {
  const result = await runVibe64Command({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write('out\\n'); process.stderr.write('err\\n'); process.exit(7);"
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout, "out\n");
  assert.equal(result.stderr, "err\n");
  assert.match(result.output, /out/u);
  assert.match(result.output, /err/u);
});

test("execution gateway applies capture maxBuffer centrally", async () => {
  const result = await runVibe64Command({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write('x'.repeat(8192));"
    ],
    maxBuffer: 1024
  });

  assert.equal(result.ok, true, result.output);
  assert.equal(result.stdout.length, 1024);
});

test("execution gateway captures binary output without text decoding", async () => {
  const expected = Buffer.from([0x00, 0xff, 0x80, 0x0a, 0x0d, 0x41]);
  const result = await runVibe64Command({
    command: process.execPath,
    args: [
      "-e",
      `process.stdout.write(Buffer.from([${[...expected].join(",")}]))`
    ],
    outputEncoding: "base64"
  });

  assert.equal(result.ok, true, result.output);
  assert.equal(result.outputEncoding, "base64");
  assert.equal(result.stdout, expected.toString("base64"));
  assert.deepEqual(Buffer.from(result.stdout, "base64"), expected);
});

test("capture preserves stdout and stderr whitespace on success and failure", async () => {
  for (const exitCode of [0, 7]) {
    for (const expected of ["", "no newline", " \t\nvalue\n\n \t", "nul\0terminated\0"]) {
      const result = await runVibe64Command({
        command: process.execPath,
        args: ["-e", `process.stdout.write(${JSON.stringify(expected)}); process.stderr.write(${JSON.stringify(expected)}); process.exitCode = ${exitCode};`]
      });
      assert.equal(result.exitCode, exitCode);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, expected);
    }
  }
});

test("execution gateway rejects an actor HOME mismatch", () => {
  assert.throws(() => assertActorHomeEnv({
    user: {
      home: "/home/v64d_sas"
    }
  }, {
    HOME: "/home/merc"
  }), {
    code: "vibe64_command_home_actor_mismatch"
  });
});

test("execution gateway owner-user actor resolves to the OS user home", async () => {
  const user = os.userInfo();
  const result = await runVibe64Command({
    actor: "owner-user",
    command: process.execPath,
    args: [
      "-e",
      "console.log(JSON.stringify({ user: process.env.USER, home: process.env.HOME }))"
    ],
    userKey: user.username
  });

  assert.equal(result.ok, true, result.output);
  assert.deepEqual(JSON.parse(result.stdout), {
    user: user.username,
    home: user.homedir
  });
});

test("execution helper operation policy distinguishes account auth from GitHub workflow commands", () => {
  assert.equal(helperOperationForRequest({
    envPolicy: "auth",
    mode: "pty",
    purpose: "account"
  }), "account-auth-terminal");
  assert.equal(helperOperationForRequest({
    envPolicy: "auth",
    mode: "pty",
    purpose: "github"
  }), "account-auth-terminal");
  assert.equal(helperOperationForRequest({
    envPolicy: "auth",
    mode: "pty",
    purpose: "assistant"
  }), "vibe64-command");
  assert.equal(helperOperationForRequest({
    envPolicy: "auth",
    mode: "pty",
    purpose: "codex"
  }), "vibe64-command");
  assert.equal(helperOperationForRequest({
    purpose: "account"
  }), "account-status");
  assert.equal(helperOperationForRequest({
    purpose: "github"
  }), "github-workflow-command");
  assert.equal(helperOperationForRequest({
    purpose: "github-api"
  }), "github-api-command");
  assert.equal(helperOperationForRequest({
    purpose: "health"
  }), "health-status");
  assert.equal(helperOperationForRequest({
    purpose: "codex"
  }), "vibe64-command");
  assert.equal(helperOperationForRequest({
    envPolicy: "auth",
    mode: "capture",
    purpose: "codex"
  }), "codex-app-server");
  assert.equal(helperOperationForRequest({
    execution: {
      kind: "assistant",
      lifecycle: "service"
    },
    mode: "detached",
    purpose: "codex"
  }), "codex-app-server");
  assert.equal(helperOperationForRequest({
    execution: {
      kind: "assistant",
      lifecycle: "service",
      operationId: "opencode-server"
    },
    mode: "detached",
    purpose: "assistant"
  }), "opencode-app-server");
  assert.equal(helperOperationForRequest({
    execution: {
      kind: "assistant",
      lifecycle: "service",
      operationId: "opencode-catalog"
    },
    mode: "detached",
    purpose: "assistant"
  }), "opencode-app-server");
  assert.equal(helperOperationForRequest({
    execution: {
      kind: "assistant",
      lifecycle: "finite",
      operationId: "opencode-catalog"
    },
    mode: "capture",
    purpose: "assistant"
  }), "opencode-app-server");
});

test("execution helper client sends normalized payloads through sudo helper", async () => {
  const payload = helperPayload({
    actor: {
      user: {
        gid: 1001,
        home: "/home/merc",
        uid: 1001,
        username: "merc"
      }
    },
    args: ["status", "--short"],
    command: "git",
    cwd: "/var/lib/vibe64/sas/projects/app",
    env: {
      GIT_AUTHOR_NAME: "merc via Vibe64"
    },
    input: "stdin text",
    operation: "github-workflow-command"
  });
  const calls = [];
  const result = await runHelperCommand(payload, {
    env: {
      VIBE64_EXEC_HELPER_PATH: "/tmp/ignored-by-explicit-helper"
    },
    helperPath: "/tmp/vibe64-exec-helper",
    outputEncoding: "base64",
    runCapture(command, args, options) {
      calls.push({
        args,
        command,
        options
      });
      return {
        ok: true
      };
    },
    timeout: 1234
  });

  assert.equal(result.ok, true);
  assert.equal(payload.inputBase64, Buffer.from("stdin text").toString("base64"));
  assert.equal(payload.schema, "vibe64.exec-helper.payload");
  assert.equal(payload.schemaVersion, 1);
  assert.deepEqual(calls, [
    {
      args: ["-n", "/tmp/vibe64-exec-helper", "execute"],
      command: "sudo",
      options: {
        env: {
          VIBE64_EXEC_HELPER_PATH: "/tmp/ignored-by-explicit-helper"
        },
        input: `${JSON.stringify(payload)}\n`,
        outputEncoding: "base64",
        timeout: 1234
      }
    }
  ]);
});

test("execution helper client preserves captured stdout and stderr", async () => {
  const payload = helperPayload({
    actor: {
      user: {
        gid: 1001,
        home: "/home/merc",
        uid: 1001,
        username: "merc"
      }
    },
    args: ["status"],
    command: "git",
    cwd: "/var/lib/vibe64/sas/projects/app",
    operation: "github-workflow-command"
  });
  const result = await runHelperCommand(payload, {
    helperPath: "/tmp/vibe64-exec-helper",
    runCapture() {
      return {
        exitCode: 9,
        ok: false,
        output: "stdout text\nstderr text",
        stderr: "stderr text",
        stdout: "stdout text"
      };
    }
  });

  assert.deepEqual(result, {
    exitCode: 9,
    ok: false,
    output: "stdout text\nstderr text",
    stderr: "stderr text",
    stdout: "stdout text"
  });
});

test("execution gateway rejects caller-owned identity and temp policy", async () => {
  for (const envName of [
    "HOME",
    "PATH",
    "TMPDIR",
    "VIBE64_EXECUTION_ID",
    "VIBE64_MANAGED_EXECUTION_REQUIRED"
  ]) {
    const result = await runVibe64Command({
      command: process.execPath,
      args: ["-e", ""],
      env: {
        [envName]: "/tmp/not-allowed"
      }
    });

    assert.equal(result.ok, false, envName);
    assert.equal(result.code, "vibe64_command_env_policy_reserved", envName);
  }
});

test("execution gateway rejects reserved policy names in trusted deployment env", async () => {
  const result = await runVibe64Command({
    args: ["-e", ""],
    command: process.execPath,
    envPolicy: "deployment",
    project: {
      deploymentEnv: {
        HOME: "/tmp/not-allowed"
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_command_env_policy_reserved");
});

test("execution gateway rejects cwd outside allowed roots", async () => {
  const result = await runVibe64Command({
    allowedRoots: [
      "/tmp/vibe64-allowed-root"
    ],
    command: process.execPath,
    args: ["-e", ""],
    cwd: "/tmp/vibe64-other-root"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_command_cwd_outside_allowed_roots");
});

test("execution gateway pty mode starts a terminal session with gateway env", async () => {
  const namespace = `v64-exec-pty-${Date.now()}`;
  const result = await runVibe64Command({
    command: process.execPath,
    args: [
      "-e",
      "console.log(process.env.PLAYWRIGHT_BROWSERS_PATH)"
    ],
    mode: "pty",
    terminal: {
      namespace
    }
  });

  assert.equal(result.ok, true, result.error);
  assert.match(result.id, /./u);
  const snapshot = await waitForTerminalOutput(result.id, namespace, "/opt/vibe64/runtime-packs/playwright/browsers");
  assert.match(snapshot.output, /\/opt\/vibe64\/runtime-packs\/playwright\/browsers/u);
  await closeTerminalSession(result.id, {
    namespace
  });
});

test("execution gateway pty mode preserves terminal argument factories", async () => {
  const namespace = `v64-exec-pty-factory-${Date.now()}`;
  const result = await runVibe64Command({
    args: ({ id }) => [
      "-lc",
      `printf 'terminal:%s playwright:%s\\n' ${JSON.stringify(id)} "$PLAYWRIGHT_BROWSERS_PATH"`
    ],
    command: "bash",
    mode: "pty",
    purpose: "terminal",
    terminal: {
      namespace
    }
  });

  try {
    assert.equal(result.ok, true, result.output);
    const snapshot = await waitForTerminalOutput(result.id, namespace, `terminal:${result.id}`);
    assert.match(snapshot.output, new RegExp(`terminal:${result.id}`, "u"));
    assert.match(snapshot.output, /playwright:\/opt\/vibe64\/runtime-packs\/playwright\/browsers/u);
  } finally {
    if (result.id) {
      await closeTerminalSession(result.id, {
        namespace
      });
    }
  }
});

test("execution gateway pty mode preserves terminal env factories under gateway policy env", async () => {
  const namespace = `v64-exec-pty-env-factory-${Date.now()}`;
  const envInputs = [];
  const result = await runVibe64Command({
    args: [
      "-e",
      "console.log(JSON.stringify({ dynamic: process.env.DYNAMIC_TERMINAL_ID, browsers: process.env.PLAYWRIGHT_BROWSERS_PATH }))"
    ],
    command: process.execPath,
    env(input = {}) {
      envInputs.push({
        id: input.id || "",
        namespace: input.namespace || ""
      });
      return {
        DYNAMIC_TERMINAL_ID: input.id || "",
        PLAYWRIGHT_BROWSERS_PATH: "/tmp/preview-tried-to-override-playwright"
      };
    },
    mode: "pty",
    purpose: "preview",
    terminal: {
      namespace
    }
  });

  try {
    assert.equal(result.ok, true, result.output);
    const snapshot = await waitForTerminalOutput(result.id, namespace, result.id);
    const line = snapshot.output
      .split(/\r?\n/u)
      .find((candidate) => candidate.includes("DYNAMIC_TERMINAL_ID") || candidate.includes("dynamic")) || "{}";
    assert.deepEqual(JSON.parse(line), {
      browsers: "/opt/vibe64/runtime-packs/playwright/browsers",
      dynamic: result.id
    });
    assert.deepEqual(envInputs, [
      {
        id: result.id,
        namespace
      }
    ]);
  } finally {
    if (result.id) {
      await closeTerminalSession(result.id, {
        namespace
      });
    }
  }
});

test("execution gateway dynamic PTY env overrides inherited non-policy env", async () => {
  const namespace = `v64-exec-pty-env-override-${Date.now()}`;
  const result = await runVibe64Command({
    args: [
      "-e",
      "console.log('DYNAMIC_OVERRIDE:' + process.env.DYNAMIC_OVERRIDE)"
    ],
    baseEnv: {
      DYNAMIC_OVERRIDE: "inherited"
    },
    command: process.execPath,
    env: () => ({
      DYNAMIC_OVERRIDE: "launch-spec"
    }),
    mode: "pty",
    purpose: "preview",
    terminal: {
      namespace
    }
  });

  try {
    assert.equal(result.ok, true, result.output);
    const snapshot = await waitForTerminalOutput(result.id, namespace, "DYNAMIC_OVERRIDE:");
    assert.match(snapshot.output, /DYNAMIC_OVERRIDE:launch-spec/u);
  } finally {
    if (result.id) {
      await closeTerminalSession(result.id, {
        namespace
      });
    }
  }
});

test("execution gateway rejects function args outside pty mode", async () => {
  const result = await runVibe64Command({
    args: () => ["-e", "console.log('nope')"],
    command: process.execPath,
    mode: "capture"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_command_args_function_requires_pty");
});

test("execution gateway rejects function env outside pty mode", async () => {
  const result = await runVibe64Command({
    command: process.execPath,
    env: () => ({
      DYNAMIC: "nope"
    }),
    mode: "capture"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_command_env_function_requires_pty");
});

test("execution gateway pty mode spools real-user helper payloads centrally", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-exec-pty-helper-"));
  const namespace = `v64-exec-pty-helper-${Date.now()}`;
  const actorUid = process.getuid() === 1001 ? 1002 : 1001;
  const actorGid = process.getgid() === 1001 ? 1002 : 1001;
  let result;
  t.after(async () => {
    try {
      if (result?.id) await closeTerminalSession(result.id, { namespace });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  await writeExecutable(path.join(root, "sudo"), `#!${process.execPath}\nprocess.stdout.write("fixture-sudo-only\\n");\n`);
  const previousPath = process.env.PATH;
  process.env.PATH = root;
  try {
    result = await runPtyCommand({
      args: ["auth", "status"],
      command: "gh",
      cwd: "/home/ada",
      envPolicy: "auth",
      mode: "pty",
      purpose: "github",
      terminal: {
        helperPayloadRoot: root,
        namespace
      }
    }, {
      actor: {
        requiresRealUser: true,
        user: {
          gid: actorGid,
          home: "/home/ada",
          uid: actorUid,
          username: "ada"
        }
      },
      cwd: "/home/ada",
      env: {
        GH_PROMPT_DISABLED: "1",
        HOME: "/home/ada",
        LOGNAME: "ada",
        USER: "ada"
      }
    });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }

  assert.equal(result.ok, true, result.error);
  const terminal = await waitForTerminalOutput(result.id, namespace, "fixture-sudo-only");
  assert.match(terminal.output, /fixture-sudo-only/u);
  const payloadRoot = path.join(root, "exec-helper-payloads");
  const payloadFiles = await readdir(payloadRoot);
  assert.equal(payloadFiles.length, 1);
  const payload = JSON.parse(await readFile(path.join(payloadRoot, payloadFiles[0]), "utf8"));
  assert.equal(payload.command, "gh");
  assert.deepEqual(payload.args, ["auth", "status"]);
  assert.equal(payload.cwd, "/home/ada");
  assert.equal(payload.env.HOME, "/home/ada");
  assert.equal(payload.gid, actorGid);
  assert.equal(payload.home, "/home/ada");
  assert.equal(payload.operation, "account-auth-terminal");
  assert.equal(payload.uid, actorUid);
  assert.equal(payload.username, "ada");
});

test("execution gateway helper-backed pty evaluates terminal args and env factories", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-exec-pty-helper-dynamic-"));
  const namespace = `v64-exec-pty-helper-dynamic-${Date.now()}`;
  const actorUid = process.getuid() === 1001 ? 1002 : 1001;
  const actorGid = process.getgid() === 1001 ? 1002 : 1001;
  let result;
  t.after(async () => {
    try {
      if (result?.id) await closeTerminalSession(result.id, { namespace });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  await writeExecutable(path.join(root, "sudo"), `#!${process.execPath}\nprocess.stdout.write("fixture-sudo-only\\n");\n`);
  const previousPath = process.env.PATH;
  process.env.PATH = root;
  try {
    result = await runPtyCommand({
      args: (input = {}) => ["auth", input.id || ""],
      command: "gh",
      cwd: "/home/ada",
      envFactory: (input = {}) => ({
        TERMINAL_ID: input.id || ""
      }),
      envPolicy: "auth",
      mode: "pty",
      purpose: "github",
      terminal: {
        helperPayloadRoot: root,
        namespace
      }
    }, {
      actor: {
        requiresRealUser: true,
        user: {
          gid: actorGid,
          home: "/home/ada",
          uid: actorUid,
          username: "ada"
        }
      },
      cwd: "/home/ada",
      env: {
        HOME: "/home/ada",
        LOGNAME: "ada",
        USER: "ada"
      }
    });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }

  assert.equal(result.ok, true, result.error);
  const terminal = await waitForTerminalOutput(result.id, namespace, "fixture-sudo-only");
  assert.match(terminal.output, /fixture-sudo-only/u);
  const payloadRoot = path.join(root, "exec-helper-payloads");
  const payloadFiles = await readdir(payloadRoot);
  assert.equal(payloadFiles.length, 1);
  const payload = JSON.parse(await readFile(path.join(payloadRoot, payloadFiles[0]), "utf8"));
  assert.deepEqual(payload.args, ["auth", result.id]);
  assert.equal(payload.env.TERMINAL_ID, result.id);
  assert.equal(payload.env.HOME, "/home/ada");
  assert.equal(payload.uid, actorUid);
  assert.equal(payload.gid, actorGid);
});
