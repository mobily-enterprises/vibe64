# Vibe64 Execution Gateway Rundown

This is a practical orientation for engineers who have not seen this codebase.
The main idea is simple: Vibe64 code should describe command intent through one
gateway, and the gateway owns process identity, environment policy, runtime
tooling, credential homes, Git behavior, database aliases, and process launch
mode.

## Where The Code Lives

The public Vibe64 repo owns the execution gateway:

- `packages/vibe64-execution/src/server/runVibe64Command.js`
  - Main entry point.
- `packages/vibe64-execution/src/server/request.js`
  - Request shape, enum validation, defaults.
- `packages/vibe64-execution/src/server/actor/resolveActor.js`
  - Resolves `daemon`, `app`, `owner-user`, and `named-user`.
- `packages/vibe64-execution/src/server/actor/userIdentity.js`
  - Normalizes OS-user facts and constructs actor HOME/XDG env.
- `packages/vibe64-execution/src/server/env/resolveCommandEnv.js`
  - Builds the final command environment.
- `packages/vibe64-execution/src/server/engines/`
  - Process engines: capture, PTY, detached, helper.
- `packages/vibe64-execution/src/server/policy/`
  - CWD and ownership checks.
- `packages/vibe64-execution/src/server/index.js`
  - Public server API exports.

Vibe64 Online consumes the public package from the composed app:

- `packages/private-online-core/src/server/githubToolchain.js`
- `packages/private-online-core/src/server/projectRepositoryService.js`
- `packages/private-online-deployments/src/server/deploymentRunner.js`
- `packages/private-online-deployments/src/server/service.js`

## Core Flow

All command execution should go through:

```js
runVibe64Command(input)
```

Internally, `runVibe64Command()` does this:

1. Normalize the request.
2. Resolve the actor.
3. Resolve the environment.
4. Check ownership and allowed roots.
5. Dispatch to a process engine.

In code terms:

```js
const request = normalizeVibe64CommandRequest(input);
const actor = await resolveVibe64CommandActor(request);
const env = resolveCommandEnv({ actor, baseEnv, request });
assertActorHomeEnv(actor, env);
const cwd = assertCwdAllowed(request.cwd, { allowedRoots: request.allowedRoots });
```

Then it chooses:

- `mode: "capture"`: run and collect output.
- `mode: "pty"`: start a tracked terminal session.
- `mode: "detached"`: spawn a background process.
- real-user mismatch: run through `/usr/lib/vibe64/vibe64-exec-helper` via sudo.

## Main Request Shape

Typical request:

```js
await runVibe64Command({
  actor: "named-user",
  userKey: "merc",
  purpose: "github",
  mode: "capture",
  command: "git",
  args: ["ls-remote", "origin", "refs/heads/main"],
  cwd: "/var/lib/vibe64/sas/projects/compas-next",
  allowedRoots: ["/var/lib/vibe64/sas/projects/compas-next"],
  gitSafeDirectories: ["/var/lib/vibe64/sas/projects/compas-next"],
  gitTransport: "github-https",
  runtimes: ["git", "gh"],
  envPolicy: "auth",
  credentialHome: {
    home: "/home/merc",
    username: "merc",
    uid: 1000,
    gid: 1000
  },
  timeout: 20000
});
```

That means:

- Run `git ls-remote origin refs/heads/main`.
- Run it for the real OS user `merc`.
- Use GitHub HTTPS credential behavior.
- Refuse interactive Git prompts.
- Put `git` and `gh` runtime packs on `PATH`.
- Allow the command only inside the project root.
- Use `/home/merc` as the credential home.

## Key Parameters

### `actor`

`actor` decides whose identity the command should use.

```js
"daemon"     // current Vibe64 daemon process, such as v64d_sas
"app"        // app process actor; no real-user switch
"owner-user" // project/session owner user
"named-user" // explicit user from userKey
```

Examples:

```js
{
  actor: "daemon",
  purpose: "setup"
}
```

```js
{
  actor: "named-user",
  userKey: "merc",
  purpose: "github"
}
```

`owner-user` and `named-user` require a real OS user. If the Node process is not
already running as that user, the gateway routes through the host exec helper.

### `purpose`

`purpose` describes why the command is running. It drives defaults and policy.

```js
"account"
"terminal"
"codex"
"github"
"source-editor"
"preview"
"adapter"
"deployment"
"setup"
```

Interactive purposes default to the broad runtime pack set:

```js
[
  "operator-clis",
  "node26",
  "git",
  "gh",
  "mysql",
  "mariadb",
  "ripgrep",
  "bubblewrap",
  "php",
  "composer",
  "playwright"
]
```

### `mode`

```js
"capture"  // command returns stdout/stderr/output
"pty"      // command becomes an interactive terminal session
"detached" // command starts and returns a pid/result
```

Capture example:

```js
await runVibe64Command({
  actor: "daemon",
  command: "git",
  args: ["status", "--short"],
  cwd: "/var/lib/vibe64/sas/projects/app",
  mode: "capture",
  purpose: "setup",
  runtimes: ["git"]
});
```

PTY example:

```js
await runVibe64Command({
  actor: "app",
  command: "bash",
  args: () => ["-lc", "npm install"],
  cwd: "/var/lib/vibe64/sas/projects/app/sessions/active/session/source",
  mode: "pty",
  purpose: "terminal",
  envPolicy: "project",
  terminal: {
    commandPreview: "npm install",
    namespace: "session:2026-07-08_01-48-17",
    maxRunning: 1
  }
});
```

### `envPolicy`

`envPolicy` determines which environment records are admitted and how they are
interpreted.

```js
"session"    // normal session/runtime command env
"project"    // project config/runtime config/database env
"preview"    // preview launch context
"auth"       // GitHub/Codex/account credential commands
"deployment" // publish/deployment env
```

For example, project commands receive project config and database env:

```js
{
  envPolicy: "project",
  project: {
    configEnv: {
      AUTH_PROVIDER: "local"
    },
    runtimeConfigEnv: {
      DB_HOST: "127.0.0.1",
      DB_PORT: "24712",
      DB_NAME: "sas_compas_next"
    }
  }
}
```

Deployment commands use deployment-specific env:

```js
{
  envPolicy: "deployment",
  project: {
    deploymentEnv: {
      NODE_ENV: "production"
    },
    deploymentDatabaseEnv: {
      DATABASE_URL: "mysql://..."
    }
  }
}
```

### `runtimes`

`runtimes` controls shared runtime-pack PATH entries.

```js
{
  runtimes: ["node26", "git", "mysql", "playwright"]
}
```

Those resolve under:

```txt
/opt/vibe64/runtime-packs/node26/bin
/opt/vibe64/runtime-packs/git/bin
/opt/vibe64/runtime-packs/mariadb/bin
/opt/vibe64/runtime-packs/playwright/bin
```

The gateway appends system PATH fallback entries too:

```txt
/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
```

### `credentialHome`

`credentialHome` describes where tool credentials live. It is intentionally
separate from `actor`, because some app-level operations need a tool home even
when the command is launched by the app process.

```js
{
  credentialHome: {
    home: "/home/merc",
    username: "merc",
    uid: 1000,
    gid: 1000
  }
}
```

Rules:

- For real-user actors, credential home must match the actor home.
- For app/daemon actors, `/home/...` credential homes are restricted.
- Credential home sets `VIBE64_CREDENTIAL_HOME`.
- Credential home also becomes `HOME`, `USER`, `LOGNAME`, and XDG home env when allowed.

## Environment Ownership

Callers may pass extra env:

```js
{
  env: {
    FOO: "bar"
  }
}
```

Callers may not pass policy-owned env:

```js
{
  env: {
    HOME: "/tmp/fake",
    PATH: "/tmp/bin",
    XDG_CONFIG_HOME: "/tmp/config"
  }
}
```

That is rejected. These are gateway-owned because otherwise command behavior
becomes impossible to reason about.

Gateway-owned process identity env looks like:

```js
{
  HOME: "/home/v64d_sas",
  USER: "v64d_sas",
  LOGNAME: "v64d_sas",
  XDG_CACHE_HOME: "/home/v64d_sas/.cache",
  XDG_CONFIG_HOME: "/home/v64d_sas/.config",
  XDG_DATA_HOME: "/home/v64d_sas/.local/share"
}
```

Shared tool env is always present:

```js
{
  VIBE64_SHARED_CACHE_ROOT: "/var/cache/vibe64",
  PLAYWRIGHT_BROWSERS_PATH: "/opt/vibe64/runtime-packs/playwright/browsers"
}
```

NPM prefix is derived from HOME:

```js
{
  NPM_CONFIG_PREFIX: "/home/v64d_sas/.local"
}
```

## Database Env

The gateway normalizes database aliases both ways.

Input:

```js
{
  DB_HOST: "127.0.0.1",
  DB_PORT: "24712",
  DB_NAME: "sas_compas_next",
  DB_USER: "vibe64_dev_app",
  DB_PASSWORD: "secret"
}
```

Output also includes:

```js
{
  MYSQL_HOST: "127.0.0.1",
  MYSQL_TCP_PORT: "24712",
  MYSQL_DATABASE: "sas_compas_next",
  VIBE64_MYSQL_USER: "vibe64_dev_app",
  MYSQL_PWD: "secret"
}
```

That is why agents and terminals should be able to use either JS-style `DB_*`
or MySQL CLI-friendly `MYSQL_*` variables.

## Git Env

All gateway Git commands get:

```js
{
  GIT_TERMINAL_PROMPT: "0"
}
```

When `gitTransport: "github-https"` or `purpose: "github"` is set, the gateway
adds GitHub HTTPS helper behavior from `gitConfigEnv.js`.

Git safe directories are passed explicitly:

```js
{
  gitSafeDirectories: [
    "/var/lib/vibe64/sas/projects/compas-next",
    "/var/lib/vibe64/sas/projects/compas-next/sessions/active/..."
  ]
}
```

## Git Identity

The gateway guarantees Git author/committer identity.

Preferred explicit identity:

```js
{
  project: {
    gitIdentity: {
      name: "Merc Mobily",
      email: "merc@example.com"
    }
  }
}
```

GitHub identity:

```js
{
  session: {
    githubUser: {
      login: "mercmobily",
      email: "merc@example.com"
    }
  }
}
```

Fallback identity:

```js
{
  GIT_AUTHOR_NAME: "merc via Vibe64",
  GIT_AUTHOR_EMAIL: "merc@sas.users.vibe64.invalid",
  GIT_COMMITTER_NAME: "Vibe64",
  GIT_COMMITTER_EMAIL: "vibe64@sas.users.vibe64.invalid"
}
```

The fallback matters for non-GitHub projects. A commit should not fail simply
because the user has not connected GitHub.

## Result Shape

All engines return the same result structure.

Success:

```js
{
  ok: true,
  exitCode: 0,
  stdout: "main abc123\n",
  stderr: "",
  output: "main abc123",
  signal: "",
  code: "",
  error: "",
  pid: null,
  timedOut: false
}
```

Failure:

```js
{
  ok: false,
  exitCode: 1,
  code: "vibe64_command_cwd_outside_allowed_roots",
  error: "Vibe64 command cwd is outside the allowed roots.",
  output: "Vibe64 command cwd is outside the allowed roots.",
  stdout: "",
  stderr: "Vibe64 command cwd is outside the allowed roots.",
  pid: null,
  signal: "",
  timedOut: false
}
```

## Important Usage Sites

### Command Terminals

`packages/vibe64-terminals/src/server/commandTerminal.js`

The command terminal starts PTYs through the gateway:

```js
await runVibe64Command({
  actor: actor.actor,
  userKey: actor.userKey,
  mode: "pty",
  purpose,
  command: "bash",
  args: () => commandTerminalHostArgs({
    command: spec.command,
    args: spec.args || []
  }),
  cwd: workdir,
  allowedRoots: [
    targetRoot,
    workdir,
    terminalWorktreePath(session),
    resultFile.directory
  ],
  envPolicy: "project",
  project: {
    config: runtime.projectConfig || {},
    configEnv: terminalEnvRecords.projectConfigEnv,
    runtimeConfigEnv: terminalEnvRecords.runtimeConfigEnv,
    targetRoot
  },
  session,
  terminal: {
    commandPreview: spec.commandPreview,
    helperPayloadRoot: resultFile.directory,
    namespace,
    maxRunning
  }
});
```

This is the path that should make `node`, `npm`, `mysql`, `gh`, Playwright, and
project env available in user-facing terminals.

### Codex Git/GitHub Wrapper

`packages/vibe64-terminals/src/server/codexGitCommand.js`

Codex is only allowed to reach Git/GitHub through a narrow command path:

```js
await runVibe64Command({
  actor: actor.githubRequired === false ? "app" : "owner-user",
  userKey: gatewayUserKey,
  purpose: actor.githubRequired === false ? "codex" : "github",
  command,
  args,
  cwd: cwd.cwd,
  allowedRoots: [actor.targetRoot],
  envPolicy: "auth",
  gitSafeDirectories: [
    actor.targetRoot,
    cwd.cwd
  ],
  gitTransport: actor.githubRequired === false ? "none" : "github-https",
  runtimes: ["git", "gh"],
  session: {
    metadata: session.metadata || {},
    sessionId,
    targetRoot: actor.targetRoot
  }
});
```

This is the path that should prevent Codex from losing GitHub credentials or
using the wrong HOME.

### GitHub Toolchain In Online

`packages/private-online-core/src/server/githubToolchain.js`

Online runs GitHub commands as the real user:

```js
await runVibe64Command({
  actor: "named-user",
  userKey: "merc",
  purpose: "github",
  command: "gh",
  args: ["auth", "status", "--hostname", "github.com"],
  cwd: "/var/lib/vibe64/sas/projects/compas-next",
  credentialHome: {
    home: "/home/merc",
    username: "merc",
    uid: 1000,
    gid: 1000
  },
  gitTransport: "github-https",
  runtimes: ["gh", "git"],
  timeout: 20000
});
```

### Managed Git Repository Setup

`packages/private-online-core/src/server/projectRepositoryService.js`

Managed Vibe64 Git repos are initialized by the daemon:

```js
await runVibe64Command({
  actor: "daemon",
  purpose: "setup",
  mode: "capture",
  command: "git",
  args: ["init", "--bare", repositoryPath],
  cwd: gitCacheRoot,
  allowedRoots: [gitCacheRoot],
  gitSafeDirectories: [gitCacheRoot],
  envPolicy: "project",
  runtimes: ["git"],
  timeout: 30000
});
```

### Deployment Publish

`packages/private-online-deployments/src/server/service.js`

Publish terminals are gateway PTYs:

```js
await runVibe64Command({
  actor: "app",
  purpose: "deployment",
  mode: "pty",
  command: process.execPath,
  args: [DEPLOYMENT_PUBLISH_TERMINAL_RUNNER, terminalInputPath],
  cwd: context.sourceRoot || context.targetRoot || process.cwd(),
  envPolicy: "deployment",
  credentialHome: {
    home: publishToolHome.runtimeToolHomeSource || publishToolHome.toolHomeSource,
    username: publishToolHome.owner?.ownerUserKey || "deployment-publish"
  },
  env: ({ id }) => ({
    [DEPLOYMENT_PUBLISH_ID_ENV]: String(id || "").trim()
  }),
  terminal: {
    commandPreview: "vibe64 publish",
    maxRunning: 1,
    namespace: deploymentPublishTerminalNamespace(context),
    namespaceLimitPrefix: deploymentPublishTerminalNamespace(context)
  }
});
```

## What New Code Should Do

If new code needs to run any of these:

- `git`
- `gh`
- `npm`
- `node`
- `mysql`
- `mariadb`
- `codex`
- `opencode`
- Playwright
- preview commands
- adapter commands
- setup/doctor commands
- deployment commands

then it should almost certainly call `runVibe64Command()`.

Do not manually assemble these in feature code:

- `HOME`
- `USER`
- `LOGNAME`
- `XDG_*`
- `PATH`
- `MYSQL_*`
- `DB_*` aliases
- Git author/committer identity
- GitHub credential helpers
- version-matched Playwright browser runtime path

Those are gateway concerns.

## Good Default Patterns

For project command terminals:

```js
{
  actor: "app",
  purpose: "terminal",
  mode: "pty",
  envPolicy: "project",
  runtimes: ["node26", "git", "mysql", "playwright"]
}
```

For GitHub operations:

```js
{
  actor: "named-user",
  userKey: "merc",
  purpose: "github",
  envPolicy: "auth",
  gitTransport: "github-https",
  runtimes: ["git", "gh"],
  credentialHome: {
    home: "/home/merc",
    username: "merc"
  }
}
```

For internal setup:

```js
{
  actor: "daemon",
  purpose: "setup",
  envPolicy: "project",
  mode: "capture",
  runtimes: ["git"]
}
```

For deployment:

```js
{
  actor: "app",
  purpose: "deployment",
  envPolicy: "deployment",
  gitTransport: "github-https",
  runtimes: ["node26", "git"]
}
```

## Design Invariant

Feature code should not decide how tools are launched. Feature code should say:

> "Run this command, for this actor, in this project/session/deployment context,
> with these runtimes and this policy."

The execution gateway decides:

- what `HOME` is,
- what `PATH` is,
- which credential home is valid,
- which Git identity is valid,
- which database aliases exist,
- where Playwright browsers live,
- whether sudo helper execution is required,
- whether cwd is allowed,
- whether the result is capture, PTY, or detached.

That is the boundary that keeps command execution understandable.
