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
- `packages/vibe64-execution/src/server/engines/commandSpawner.js`
  - Starts every finite command, through the command spawner in the editor
    server (below).
- `packages/vibe64-execution/src/server/policy/`
  - CWD and ownership checks.
- `packages/vibe64-execution/src/server/index.js`
  - Public server API exports.

A host that composes this application uses the same execution package. Its
callers remain responsible for describing their actor and command intent; they
do not replace the gateway's environment or credential policy.

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
- `mode: "pty"`: start a tracked terminal session. Like every engine, the
  terminal gets exactly the resolved environment, never the server process's
  own variables, and a function `env` is resolved per terminal id with the
  same `VIBE64_EXECUTION_ID` stamp. A provider's `runLocal` context `env` is
  exactly the env its PTY starts with.
- `mode: "detached"`: spawn a background process.
- real-user mismatch: run through the host's privileged helper via sudo. The
  helper acts only as a person root registered for the calling daemon's
  workspace, never as an administrator or system account, and runs that
  person's command with no new privileges, as it runs every managed execution,
  the daemon's own included. A
  person's own computer has no helper and never builds such an actor.

## How a Finite Command Starts: the Command Spawner

A finite command is one Vibe64 waits for: a capture command (Git, the host
helper through sudo, a tool's `--version`), an OS account lookup, the Git
identity read, a packaging tool. `spawnCommand()` and `execFileCommand()` in
`packages/vibe64-execution/src/server/engines/commandSpawner.js` are Node's
`spawn()` and `execFile()` for these commands, reached through the package's
`@local/vibe64-execution/server/commandSpawner` subpath (the package root
exports neither). Behind them, `commandExecutor.js` holds the one `spawn()`
call that starts every one of them, with exactly the options it is given.

**The rule: the editor server sends every finite command to its spawner,
started at boot; small short-lived processes (the session work child, CLIs,
tests) run the same executor in themselves, because a spawner there costs more
than their own fork.** The spawner is a small, long-lived process
(`commandSpawnerProcess.js`) that only connects the executor to its IPC
channel and its pipe of start records.

The mode is set once per process. A process runs its commands in itself until
it calls `startCommandSpawner()`, which the editor server does at boot, before
it accepts requests (`server.js`;
`tests/server/editorServerCommandSpawner.unit.test.js` proves it). From then on
every command of that process goes to a spawner. A spawner that dies is
replaced by a new one for the next command, never by the executor in the
editor.

### Why it exists

On Linux, Node starts a command by forking the process that asks. libuv clones
it without `CLONE_VM` or `CLONE_VFORK` and waits until the child has exec'd, so
the asking process's main thread stops while the kernel copies the page tables
of its whole heap. Measured on a test host (Node 26.5, libuv 1.52.1, `git
--version`):

| Editor RSS | Direct start, main-thread block (median) | 12 at once | Through the spawner |
|---|---|---|---|
| 158 MB | 10.1 ms | 97 ms | 0.14 ms |
| 1.5 GB | 33.2 ms | 422 ms | 0.17 ms |

A large project's editor under normal page polling spent 9.8 s of 72 s of
its main-thread time starting commands. The command also finishes sooner
through the spawner: 13 ms instead of 17 ms (158 MB) and 37.5 ms (1.5 GB).
`tests/server/commandSpawnerHeapCost.integration.test.js` keeps the start flat
across heap sizes on every run: a capture started at 1.5 GB of RSS holds the
main thread under 5 ms (median), and no more than 3 ms longer than at 156 MB.
Its own figures vary with the host and the run, so it checks those limits and
reports its figures; the table above is the one measurement this rundown
quotes.

A small process is the opposite case. A spawner costs it a Node startup, about
85 ms: in a fresh process, 13 Git commands took 72.5 ms with the executor in
the process itself and 196 ms with a spawner of its own.

### One way to start a command

`commandSpawner` starts every finite command. The files that start processes
themselves are listed once, each with its number of uses of `child_process`,
node-pty, execa or open and why, in
`tests/server/commandSpawnerOwnership.unit.test.js`. That test reads every
JavaScript file of `server.js`, `bin/`, `server/` and `packages/` and fails on
any other use, a new one in a listed file included, and on a listed file that
no longer has its uses. It skips `templates/` folders: their files are copied
into a person's project and never run as the editor. What the list holds:

- `commandExecutor.js`, where finite commands start, and `commandSpawner.js`,
  which starts the spawner;
- the editor's long-lived processes, each once per owner and needing a
  terminal, a file descriptor or a channel of its own: runtime terminals,
  detached services and their reaper, SQLite workers;
- one finite exception: the synchronous Git identity read (`spawnSync`) a
  terminal's environment needs, which cannot wait for the spawner's reply (its
  asynchronous read goes through the spawner);
- the person's browser, opened once after the server starts (`bin/server.js`,
  through the open package);
- programs that are not the editor: the execution helper (`src/host/`), the
  stdio bridge an AI engine's conversation runs in, OpenCode's plugin, the
  publishing command line, the `vibe64` and development launchers in `bin/` and
  the PHP recorder's build script.

### What it decides: nothing

Policy stays where it was. For a gateway command, `runVibe64Command` resolves
the actor and the environment, `cwdPolicy` and the permission policy check the
working directory and identity, a host's managed execution admits the work,
and the server's stop refuses new work, all before the command reaches
`spawnCommand`. The few files that call `spawnCommand`, `execFileCommand` or
`runCaptureCommand` directly, for Vibe64's own fixed tools, skip those checks;
`tests/server/executionGatewayBypass.unit.test.js` lists them with their
reasons. The executor checks only that a message has the shape it knows. The
spawner refuses anything else by exiting, which fails the commands it was
running rather than guessing.

The editor refuses, before anything is sent, a call it cannot carry out: a
command or an argument that is not a string, input that is neither text nor
bytes, a relative working directory, an option or a stdio it does not take, a
signal that is not one. Each throws a `TypeError` to that caller alone
(`execFileCommand` rejects with it); the spawner and every other command carry
on.

A command's working directory and environment are the ones its caller gives.
The working directory is absolute: the editor's own when none is given (a
capture resolves a relative one against the editor's). The environment is
required (`spawnCommand` throws without one) and passes as Node's `spawn`
passes it: each value as text, a name whose value is `undefined` left out. The
spawner's own working directory (`/`) and environment never reach a command.

Every command starts as a session leader (`setsid`, outside Windows), not only
as the leader of its own process group. That is intentional, and it is one
difference from Node's `spawn` in the editor: the command has no controlling
terminal. A terminal's Ctrl-C never reaches it, and nothing it runs can prompt
on `/dev/tty`, so a command that would ask there (Git or SSH wanting a
password) fails instead of waiting for an answer no one can give. The stop and the spawner end each command by its process group.

### Security model

- **Only the editor can talk to it.** The channel is the IPC socketpair Node
  creates when the editor starts the spawner; its start records go over a
  second socketpair, which only the editor reads. No path names either, and
  Linux refuses to reopen a socket through `/proc/<pid>/fd` (`ENXIO`). No
  command inherits them: Node opens both close-on-exec, and every command gets
  its own stdin, stdout and stderr. A command's environment, credentials
  included, crosses only the private channel, never argv or a file.
- **No new reach, no new privileges.** The spawner runs as the editor, with the
  same user, groups, cgroup, umask, resource limits and no-new-privileges flag,
  all inherited. It sets and raises nothing: no setuid, no uid or gid of its
  own. Identity changes still happen only in the host's helper through sudo.
  Its own environment holds only the editor's `NODE_OPTIONS`, as any Node
  process the editor starts would read it (the test hosts' path guard reaches
  it that way). A command gets only the environment it was given.
- **Honestly, what that protects.** The spawner gives nothing beyond what a
  process of the same user already has against the editor itself. A same-uid
  process that could take the channel (with `pidfd_getfd` or ptrace) could
  equally act on the editor directly. Many commands run as that same user, so
  the protection is the private channel and the spawner being a dumb executor
  that runs only what the editor's checks approved. Yama's ptrace scope, where
  a host enables it, is a bonus, not the guarantee.

### Failure behaviour

Nothing ever falls back to starting a command in the editor.

- **It dies** (a crash, an out-of-memory kill, a signal), **sends a message
  the editor does not know** (one with an unknown type or no id), or **stops
  answering**: the editor kills it and sends it nothing more; the next command
  starts a new spawner, even one asked for between its exit and its channel's
  close. Once its channel and its pipe of start records have both closed,
  every command it was running fails with `vibe64_command_spawner_failed`,
  and the error names the spawner and how it stopped. Each of those commands
  that started has its process group ended as a stop ends one (`SIGTERM`, then
  `SIGKILL` after 3 s, each sent only while the group has members) before it
  closes: a capture, a plain `spawnCommand` and `execFileCommand` alike.
- **Stuck** means a spawn or kill left unanswered for 5 s (`STUCK_AFTER_MS`),
  counted from the request that found nothing outstanding or from the last
  answer. The spawner answers each one as soon as it reads it, with well under
  a millisecond of its own work, and what it starts never delays the answer.
  Only the machine can (a starved CPU, swapping). So a spawner silent for 5 s,
  the grace a timed-out capture already gets between SIGTERM and SIGKILL, has
  stopped. The decision waits one turn of the editor's event loop, so an editor
  that was busy itself counts the answers that were already waiting
  (`commandSpawner.unit.test.js` holds the loop past the limit and keeps the
  spawner). A stuck verdict costs every command that spawner was running: each
  fails with `vibe64_command_spawner_failed` and is ended, and the next command
  starts a new spawner. A right verdict saves every caller from waiting for an
  answer that never comes.
- **It cannot start**: the command fails with the same code, naming the error.
- **A command that cannot start** (a missing program, or arguments `spawn()`
  refuses: an environment value over Linux's 128 KiB, a NUL byte) has one
  `error` and then `close`, as a `ChildProcess` does, and its `spawned`
  resolves with no pid. It never rejects, so a caller listening for `close`
  alone, or for `error`, always hears the end.
- **Every started command's pid is in a pipe the editor owns before the
  spawner does anything else, so a spawner's death never leaves a command the
  editor cannot end.** The spawner writes each start's id and pid there in the
  same synchronous step as the `spawn()` that started it. The pipe keeps what
  was written after the spawner dies, and the editor reads it to its end,
  whatever output was still waiting on the channel: past about 128 KB of
  unread output, a pid's answer on the channel waits in the spawner's memory,
  but its record does not. At most 64 records (`START_RECORD_CAP`) wait
  unread; at the cap the spawner starts nothing more until the editor has read
  them, so a record's write never waits (on a test host at Linux's default
  socket buffer, 180 records fit before a write would). The one exception is an
  outside SIGKILL or out-of-memory kill of the spawner between `spawn()`
  returning and that write, a few microseconds with nothing between them. A
  command started then is unknown to the editor: on a managed host, a command
  run through the host's managed execution is stopped with its unit, by
  execution id, when the command fails; elsewhere it runs until it exits, or
  until it next writes output, which SIGPIPE then ends.
  `commandSpawner.unit.test.js` kills a spawner behind no unread output, just
  past 128 KB of it and 8 MB of it, and finds every command it started known
  to the editor and ended.

### Lifecycle

- **Start:** the server starts it at boot (`startCommandSpawner()` in
  `server.js`), while the editor is small.
- **Held and idle:** it is held (ref'd) only while commands run, as a running
  command is held, so it never keeps a process alive by itself.
- **The editor's stop needs nothing from it.** The stop ends each command's
  process group itself with `kill(2)` (`endCommands`: captures, plain
  `spawnCommand` children and `execFileCommand` alike). Once requests in flight
  have had their 350 ms (`STOP_DRAIN_MS` in `server/lib/stopGate.js`), it sends
  SIGTERM to every command asked for before the stop began, then SIGKILL to a
  group still there 75 ms later (`STOP_COMMAND_GRACE_MS`). A command the
  spawner has not yet answered for is ended once its pid arrives. The spawner
  ignores SIGHUP, SIGINT and SIGTERM, so a terminal's Ctrl-C or a service
  manager's stop signal to the whole cgroup does not end it early, and it
  reports the commands still running until the editor exits.
- **End:** its channel closes when the editor exits for any reason: a stop, a
  crash, Ctrl-C, SIGKILL. The spawner then ends every command still running,
  as the detached reaper ends a group (SIGTERM to its process group, then
  SIGKILL to a group still there after 3 s), and exits. No command outlives
  the editor (`commandSpawner.unit.test.js` ends an editor with Ctrl-C and with
  kill -9 and finds its commands gone).

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
  cwd: "/home/merc/projects/shop",
  allowedRoots: ["/home/merc/projects/shop"],
  gitSafeDirectories: ["/home/merc/projects/shop"],
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
- Put the `git` and `gh` runtimes on `PATH`.
- Allow the command only inside the project root.
- Use `/home/merc` as the credential home.

## Key Parameters

### `actor`

`actor` decides whose identity the command should use.

```js
"daemon"     // current Vibe64 daemon process
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
A host whose profile declares a helper is a managed host: it routes every
real-user command through the helper, even one for the process's own user, and
never adds the launching shell's `PATH`.

On a managed host, an `app` capture may also name `stagingAccount`: a staging
account, the OS account of a project's staging app, which the host helper made
and registered for the daemon's workspace. The command then runs as that
account, in its own area and sandbox, never as a person;
`stagingEnvironmentFile` is accepted only for such a command, and so is
`sandboxAllowances`, the allowances its staging release's Deployment section
declares, which the helper grants only where the host's owner permits them. A
person's own computer has no staging accounts and refuses the fields.

### `purpose`

`purpose` describes why the command is running. It drives defaults and policy.

```js
"account"
"terminal"
"codex"
"github"
"source-editor"
"preview"
"staging"
"health"
"source"
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
  cwd: "/home/merc/projects/app",
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
  cwd: "/home/merc/projects/app/sessions/active/session/source",
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
"staging"    // Staging publish env
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
      DB_NAME: "alice_shop"
    }
  }
}
```

Staging commands use their Staging Env values exactly. The gateway adds no
framework mode such as `NODE_ENV` and never passes on the editor's own (see
Environment Ownership); a host may give the Serve step alone its runtime's
conventional production setting, and a project that needs a specific mode
declares it on its Deployment Serve step, which wins.

```js
{
  envPolicy: "staging",
  project: {
    stagingEnv: {
      APP_PUBLIC_URL: "https://example.com",
      DATABASE_URL: "mysql://..."
    }
  }
}
```

### `runtimes`

`runtimes` names the tools a command needs on `PATH`.

```js
{
  runtimes: ["node26", "git", "mysql", "playwright"]
}
```

On a person's own computer these are the tools already on their `PATH`. A host
that provides pinned runtime packs passes their root at startup, and each id
then resolves under it:

```txt
<runtime pack root>/node26/bin
<runtime pack root>/git/bin
<runtime pack root>/mariadb/bin
<runtime pack root>/playwright/bin
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
- Credential home also becomes `HOME`, `USER`, `LOGNAME`, and XDG home env when allowed. A credential home that is
  the actor's own home names no XDG folders of its own: the command keeps the folders its login already has (the
  host's tool homes where they name one, else the home's), and only the credential home's explicit roots
  (`cacheRoot`, `configRoot`, `dataRoot`, `stateRoot`) replace them.

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

A command starts from the editor's environment (`inheritProcessEnv`) or the
caller's `baseEnv`, but never takes `NODE_ENV` from it: a framework mode
belongs to the project. A command's `NODE_ENV` comes only from the project's
Env (Stack defaults and Development Env), a launch's or terminal's own env,
its Staging Env for staging commands, or its own command line
(`env NODE_ENV=test npm test`). An editor a host serves with
`NODE_ENV=production` therefore still installs devDependencies in Workspace
setup, and its Previews, terminals, tests and agents run as the project
configures them. `resolveCommandEnv` drops it, so the Codex app-server and its
threads, which are built with it, follow the same rule.

`APP_ENV` says where the application runs, and the gateway owns it. It never
takes the editor's own either, since the editor is itself a production
application, and gives every command that is not a staging command (no
`envPolicy: "staging"`, `purpose: "staging"` or staging account)
`APP_ENV=development`, last, over the project's Env and the caller's own env:
everything a session runs is Development. A staging command gets only what its
Staging Env says. A Preview command (`purpose: "preview"`) also
starts with `NODE_ENV=development`, which the project's Env or launch may still
change. Development Env refuses to save `APP_ENV`.

Nor does a command take the editor's own sign-in settings: every name beginning
`AUTH_` in the editor's environment or the caller's `baseEnv`. The editor is
itself a JSKIT application, and a project's JSKIT application reads the same
names for its own sign-in, so an editor that signs people in with a one-time
pass (`AUTH_PASS_PUBLIC_KEY` and its audience and resource) would otherwise turn
pass sign-in on in every Preview. A command's `AUTH_*` come only from the
project's Env (`project.runtimeConfigEnv`), a launch's or terminal's own env,
or its Staging Env. A caller that starts a process from the editor's env, as a
Claude Code conversation does, hands its project's Env as the project's
(`project.runtimeConfigEnv`, or `projectEnv` for the conversation execution),
not inside `baseEnv`.

Nor does a command take the editor's own address, `HOST` and `PORT`, or its
`TRUSTED_PROXIES`, `SERVER_SURFACE` and `JSKIT_SERVER_SURFACE`: a project's
server reads the same names, and its dev server would try the editor's own port.
A Preview gives the application its own address.

On a managed host (`execHelperPath` configured) the editor is the host's service,
and its environment is the service's: the host's variables for the app, the
editor's settings and public addresses, its database and keys. There
`resolveCommandEnv` first drops every `baseEnv` entry the editor's own
`process.env` has with the same value (`withoutManagedEditorEnv`), whichever
caller handed it on: the gateway's own inheritance, a caller that spread the
editor's env (the Codex runtime context), or an agent's command, whose base env
is the agent's own. It keeps only `MANAGED_EDITOR_ENV_KEPT` (language, time and
terminal, proxies and certificates, `TMPDIR`, `GENESIS_PARSER_*`,
`PHP_INI_SCAN_DIR`, `VIBE64_WORKSPACE`) and every `LC_*`, and, for a Preview
(`purpose: "preview"`), `MANAGED_EDITOR_PREVIEW_ENV_KEPT`, the addresses and
speech service an editor running as that Preview serves itself by. A value a
caller set itself and the command's own `env` stay, and the database names are
filtered the same way before `databaseEnv` reads the base env. A standalone
editor's environment is its person's shell and stays as it was.

Gateway-owned process identity env looks like:

```js
{
  HOME: "/home/merc",
  USER: "merc",
  LOGNAME: "merc",
  XDG_CACHE_HOME: "/home/merc/.cache",
  XDG_CONFIG_HOME: "/home/merc/.config",
  XDG_DATA_HOME: "/home/merc/.local/share"
}
```

Shared tool env is present only when the host provides a shared cache and
runtime packs; on a person's own computer the tools use their own defaults.
With packs every command is told their folder, which the `policy-bin`
wrappers first on its PATH (`npm`, `npx` and the rest) find their tools by;
a command run with a Staging Env file starts from none of the editor's own
environment, so it has the folder only from here:

```js
{
  VIBE64_SHARED_CACHE_ROOT: "<shared cache root>",
  VIBE64_RUNTIME_PACK_ROOT: "<runtime pack root>",
  PLAYWRIGHT_BROWSERS_PATH: "<runtime pack root>/playwright/browsers"
}
```

NPM prefix is derived from HOME, and its `bin` joins PATH:

```js
{
  NPM_CONFIG_PREFIX: "/home/merc/.local"
}
```

A host whose homes cannot start programs (homes mounted `noexec`) names
`loginEnvironment` in its host profile: the tool homes it gives each login, in a
folder where programs start, `%u` standing for the login. Each person's and the
daemon's command gets its variables, over the ones the server's own environment
carries (its own login's, say), unless the command's own environment names
them, so a CLI installed with `npm -g`, `go install`, `cargo install`,
`python3 -m pip install --user` or `gem install` starts, and `npx` and Corepack
run what they download:

```js
{
  NPM_CONFIG_PREFIX: "<work>/<login>/.tools/npm",
  NPM_CONFIG_CACHE: "<work>/<login>/.tools/npm-cache",
  GOPATH: "<work>/<login>/.tools/go",
  XDG_CACHE_HOME: "<work>/<login>/.cache"
}
```

Its variables win over the home's own folders (`~/.cache`, `~/.config`,
`~/.local/share`), which are only the fallback: a login environment naming
`XDG_CACHE_HOME` gives `uvx` and Corepack a cache folder they can start programs
from, and the exec helper keeps the folders the command names when it runs it as
the person. It cannot name `HOME`, `LOGNAME`, `PATH`, `TMPDIR`, `USER` or
`XDG_RUNTIME_DIR`, which the resolver and the helper own.

A session's AI command names its session's temporary folder as `tempDirectory`
(`v64s-<12 hex>` in the editor's own `TMPDIR`, short so sockets fit below it);
the resolver makes it the command's `TMPDIR`, and the exec helper keeps it only
for the workspace's own commands and only when it is a real `v64s-<12 hex>`
folder directly in that workspace's temporary folder (`sessionTempDirectory`),
otherwise the workspace's temporary folder. The helper also lets the
workspace's own commands start in such a folder (`sessionTempFolderCwd`).

The host's program folders take `~/.local/bin`'s place on PATH: no login's `~/.local/bin`
is on the command's PATH, not even one the server's own PATH inherited from a
login shell's profile, since a program found there would refuse to start.

A staging account keeps `~/.local`: its home is in its own area, where
programs start.

## Database Env

The gateway normalizes database aliases both ways.

Input:

```js
{
  DB_HOST: "127.0.0.1",
  DB_PORT: "24712",
  DB_NAME: "alice_shop",
  DB_USER: "vibe64_dev_app",
  DB_PASSWORD: "secret"
}
```

Output also includes:

```js
{
  MYSQL_HOST: "127.0.0.1",
  MYSQL_TCP_PORT: "24712",
  MYSQL_DATABASE: "alice_shop",
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
    "/home/merc/projects/shop",
    "/home/merc/projects/shop/sessions/active/..."
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
      name: "Octo Cat",
      email: "octo@example.test"
    }
  }
}
```

A supplied identity (`personGitIdentity`) is the person's Git name and email
read as that person by a caller whose command runs under another Unix identity:
session-work writes that record commits supply it, with `userKey` naming the
person, where each person has their own OS account (see
`genesis/program/source/save-work.md`).

Without an explicit or supplied identity, the person's own Git config comes
next: git itself runs `git config --get-regexp '^user\.(name|email)$'` with the
command's env (git found on the server's PATH), in the command's repository and
else in its HOME. The gateway awaits this read without blocking the server, and
one read answers every command with the same directory and env for 30 seconds;
a change to a file `git config --global` writes is seen by the next command.

GitHub identity:

```js
{
  session: {
    githubUser: {
      login: "octocat",
      email: "octo@example.test"
    }
  }
}
```

Fallback identity:

```js
{
  GIT_AUTHOR_NAME: "octo via Vibe64",
  GIT_AUTHOR_EMAIL: "octo@local.users.vibe64.invalid",
  GIT_COMMITTER_NAME: "Vibe64",
  GIT_COMMITTER_EMAIL: "vibe64@local.users.vibe64.invalid"
}
```

The fallback is named after the request's `userKey`, else the command's OS
user. It matters for non-GitHub projects. A commit should not fail simply
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

### Managed agent and application processes

`packages/vibe64-terminals/src/server/codexTerminal.js` and
`packages/vibe64-terminals/src/server/outputTargetTerminal.js`

Vibe64 owns the execution environment for direct agent turns and declared
Vibe64 Outputs targets. Outputs declarations provide literal commands and
abstract runtime requirements; Vibe64 resolves those requirements to managed
runtime packs, supplies project Env, snapshots declared finite results,
allocates ports for web presentations, and supervises the process. Project code
does not assemble host `PATH`, browser paths, or account homes.

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

The service decides by the repository a command acts on, not its working
directory alone (`codexGitCommandPlaces.js`): `-C`, `--git-dir`, `--work-tree`,
the `GIT_DIR` and `GIT_WORK_TREE` the wrapper forwards, and what `init` and
`clone` make. The source and each connected copy keep the request above; a
repository in the session's temporary folder runs as plain local Git, and a
command whose shell sets a variable that points Git at a program or config
(`GIT_CONFIG_COUNT` with its `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>`,
`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_GLOBAL`, `GIT_SSH_COMMAND` and the rest of
`CODEX_GIT_COMMAND_PROGRAM_ENV_NAMES`), none of which reaches it, is refused,
naming them, as one carrying the token is, rather than run without them (in
the source and a connected copy, a local command runs without them and ends
its output with one line naming them, and that its config goes on its command
line as `git -c <key>=<value>`):

```js
await runVibe64Command({
  actor: "app",
  command: "git",
  allowedRoots: [tempRoot, cwdRoot],
  env: { GIT_CEILING_DIRECTORIES: sessionFolder, /* the command's GIT_DIR, GIT_WORK_TREE, GIT_AUTHOR_*, GIT_COMMITTER_* */ },
  gitIdentity: "none",     // no person's Git identity
  gitTransport: "anonymous", // no credential, Git's credential helpers cleared
  purpose: "codex",
  session: { sessionId }   // no metadata, user key or token
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
- Vibe64 workspace-preparation and launch commands
- source inspection and archive commands

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

For a managed project process:

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

For managed source operations:

```js
{
  actor: "daemon",
  purpose: "source",
  envPolicy: "project",
  mode: "capture",
  runtimes: ["git"]
}
```

For a staging command:

```js
{
  actor: "app",
  purpose: "staging",
  envPolicy: "staging",
  gitTransport: "github-https",
  runtimes: ["node26", "git"]
}
```

## Design Invariant

Feature code should not decide how tools are launched. Feature code should say:

> "Run this command, for this actor, in this project/session/staging context,
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
