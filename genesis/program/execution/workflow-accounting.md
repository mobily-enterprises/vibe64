# Account for a managed workflow

Related managed commands can share one accounting parent so the execution host
can measure their simultaneous memory use and retain a trustworthy final peak.

## Sources

- `packages/vibe64-execution/src/server/index.js`
- Main: `packages/vibe64-execution/src/server/managedExecution.js`
- `packages/vibe64-execution/src/server/conversationExecution.js`
- `packages/vibe64-execution/src/server/engines/stdioBridge.js`
- `packages/vibe64-execution/src/server/request.js`
- `packages/vibe64-execution/src/server/engines/capture.js`
- `packages/vibe64-execution/src/server/engines/captureProcess.js`
- `packages/vibe64-execution/src/server/engines/commandSpawner.js`
- `packages/vibe64-execution/src/server/engines/commandExecutor.js`
- `packages/vibe64-execution/src/server/engines/commandSpawnerProcess.js`
- `packages/vibe64-execution/src/server/engines/detached.js`
- `packages/vibe64-execution/src/server/engines/detachedReaper.js`
- `packages/vibe64-execution/src/server/engines/terminalSessions.js`
- `packages/vibe64-execution/src/server/engines/terminalSessionClosing.js`
- `packages/vibe64-execution/src/server/engines/terminalSessionRegistry.js`
- `packages/vibe64-execution/src/host/managedWorkflows.js`
- `tooling/proof/systemd-workflow/run.sh`
- `packages/vibe64-execution/src/host/stagingAccess.js`
- `packages/vibe64-execution/src/host/hostFiles.js`
- `packages/vibe64-execution/src/host/personRegistry.js`
- `packages/vibe64-execution/src/host/serviceOperations.js`
- `packages/vibe64-execution/src/host/stagingLogin.js`
- `packages/vibe64-execution/src/host/hostSettings.js`
- `packages/vibe64-execution/src/host/editorPrivateState.js`
- `packages/vibe64-execution/src/host/executionReceipts.js`
- `packages/vibe64-execution/src/host/executionState.js`
- `packages/vibe64-execution/src/server/policy/cwdPolicy.js`
- `packages/vibe64-execution/src/server/runtime/runtimePacks.js`
- `packages/vibe64-terminals/src/server/resourceWorkflow.js`
- `packages/vibe64-terminals/src/server/projectExecutionEnv.js`
- `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `packages/vibe64-terminals/src/server/workspaceSetupExecution.js`
- `packages/vibe64-terminals/src/server/vibe64OutputTargets.js`
- `packages/vibe64-terminals/src/server/outputTargetTerminal.js`
- `packages/vibe64-terminals/src/server/outputTargetLaunchStart.js`
- `packages/vibe64-terminals/src/server/outputTargetLaunchCoordination.js`
- `packages/vibe64-terminals/src/server/outputTargetMetadata.js`
- `packages/vibe64-terminals/src/server/launchPreviewStatus.js`
- `packages/vibe64-terminals/src/server/previewDiagnosticFiles.js`
- `src/lib/vibe64ResourceRecovery.js`
- `src/composables/useVibe64OutputControls.js`
- `src/composables/useVibe64OutputLaunch.js`
- `src/composables/useVibe64OutputControlsSurface.js`
- `src/composables/useVibe64PreviewRecovery.js`
- `src/components/studio/Vibe64OutputControls.vue`
- `src/components/studio/Vibe64PreviewStatus.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotActivity.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotProjectPanel.vue`

## Public contract

Every finite command, the ones Vibe64 waits for, starts in one executor, which
runs Node's spawn with exactly the options it is given. The editor server sends
every finite command to its spawner, started at boot; small short-lived
processes (the session work child, CLIs, tests) run the same executor in
themselves, because a spawner there costs more than their own fork. So the
editor never forks its own heap for a command, which held its main thread for
10 ms at 158 MB and 33 ms at 1.5 GB per start. Neither decides anything: for a
gateway command, the gateway, cwd and permission policy and managed execution
approve it before it gets there, and the few direct callers of the starters
(Vibe64's own fixed tools) are listed in a test with their reasons. A call it
cannot carry out throws to its caller alone. The spawner talks only through its
private IPC channel and a pipe of start records only the editor reads, runs as
the editor with only the editor's `NODE_OPTIONS` in its environment, and ends
with the editor. Every command leads its own process group. Every started
command's pid is in that pipe before the spawner does anything else, so when
it dies, stops answering or sends what the editor does not know, every command
it started fails naming it and has its process group ended, and the next
command starts a new spawner; nothing falls back to a direct start. The one
exception is an outside kill of the spawner in the microseconds between a
start and its record. The files that start processes themselves are listed
once, with their counts and reasons, in
`tests/server/commandSpawnerOwnership.unit.test.js`: long-lived starters, once
per owner, one finite exception (the synchronous Git identity read a
terminal's environment needs), and programs that are not the editor. The
execution gateway rundown (`docs/execution-gateway-rundown.md`) covers the
security model and failures.

The existing runtime catalogue also maps Python, Ruby, Go, Java, Kotlin, C# and
Rust to explicit host packs. Kotlin receives Java tools, and Rust receives the
native linker toolchain. Interactive coding and terminals use these same pack
paths; declared operations prepend only their requested runtimes. On managed
hosts the installed runtime guards block undeclared tool names before mutable
host PATH entries. Standalone execution retains the developer's ordinary PATH
and installed tools without requiring a managed runtime installation. The host
owns installation, while the project owns build commands and dependency/source
resolution. Frameworks reuse those toolchains; database CLI selection does not
change resource lifecycle or apply migrations.

The runtime catalogue recognizes `awsebcli` and its `eb` command for declared
operations and interactive coding/terminal execution. Hosts own the actual CLI
installation and credential policy. Public execution supplies its normal project
environment and runtime paths; it neither stores separate EB credentials nor
installs the tool for standalone users.

A managed execution's unit runs while any of its processes does
(`ExitType=cgroup`), except a detached job, an agent's session command, whose
unit ends when its runner ends (`ExitType=main`, `managedExecutionExitType`):
systemd then stops whatever the command left running (`&`, `nohup`, `setsid`,
`disown`, a double fork, `screen -dm`), so nothing a command starts outlives
it. Work the agent's own tool keeps in its background mode is still that
command running. A service's first process may leave the rest of it running,
and a finite capture's or terminal's caller waits for its descendants.

Managed execution Stop asks systemd to stop the exact unit before attempting
forced cgroup cleanup. This lets host-owned ExecStop hooks drain delegated
resources before their processes receive termination signals. The stop job is
queued, and processes still present after the caller's termination grace period
(`termTimeoutMs`, at most 15 s, and 15 s when none is given) are force-killed, so
a 3 s conversation stop is not held to the unit's 10 s `TimeoutStopSec`.
Completion still requires the entire execution scope to be empty. A Stop of an
execution whose scope is already empty signals nothing: it only removes the
runtime receipt directory and resets systemd's failed-unit record, which also
releases work that ended on its own.

The helper's `release-ended` action acknowledges, in one call, the receipts of
every finished execution its caller no longer owns. The caller names the
executions it still owns (at most 4,096); the helper lists the workspace's
execution units once and removes every other receipt directory of that
workspace whose unit is gone, inactive or failed, then resets those failed
units. A loaded unfinished unit keeps its receipt, and a failed unit listing
removes nothing. The receipt is a runtime handoff that
must outlive its unit until the caller has read it, so the helper never removes
it when the unit ends.

The workspace's receipts directory belongs to root, mode `0750` with the shared
Vibe64 group, so only the helper adds, renames or removes receipts in it; an
execution's target user only passes through it to its own receipt. It sits in
the daemon's own runtime directory, which root makes or keeps the daemon's
(shared group, mode `2750`) through a directory it opened without following a
link, with the group id the start already read and no process. The daemon can
rearrange that runtime directory's contents, so the
helper opens it without following a link and then works only through that open
directory. It creates a receipt only where nothing exists yet, and writes the
runner's command and hands it and the receipt to the target user through
descriptors it opened itself. A link planted in place of that directory or of
a receipt fails the start instead of being followed, and Stop and
`release-ended` remove receipts through the same open directory. Older helpers
left the directory to the daemon; the next start takes it back. The helper
reads the runner's result the same way, only as the target user's regular
`result.json` in that receipt within a size limit; a link, FIFO or anything
else there counts as no result.

A detached execution's receipt also holds its private directory, created for
its target user with mode `0700` and named to the unit as
`VIBE64_EXECUTION_PRIVATE_DIR`. A service keeps state there that must end with
it, such as OpenCode's home and XDG configuration, data and state. Whatever
removes the receipt (Stop, `release-ended`, a failed start) removes that state
too, so a server that restarted without the service's handle leaves none of it
behind. Finite and interactive executions get no private directory.

Each managed command names itself through its execution descriptor's `label`
and `operationId` and carries the project and session it serves, so a host
listing running work need not fall back to a generic name. An AI run also
names its purpose in `aiPurpose` (`@local/vibe64-execution/shared/aiPurpose`):
`agent-turn` for a process running chats' agent turns (a Claude turn or
terminal, the main Codex app-server, the OpenCode server), `helper:<workload>`
for a helper's one-off turn (`helper:prompt_hint`, `helper:account` for
Claude's account reads), and `helper:shared` for the Codex helper app-server
that serves every helper. The descriptor refuses any other value
(`vibe64_execution_ai_purpose_invalid`), the label ends with it ("Claude Code
assistant (helper:prompt_hint)"), and the exec helper's unit description names
it from the payload's `aiPurpose` ("Vibe64 assistant execution (agent-turn)").
A helper turn is never a planned restart's crucial operation and never steered;
the restart simply ends it. Account checks name
themselves (`claude auth status` is "Checking the Claude sign-in"), as do a
session's GitHub token and Git identity reads. The AI's own `git` and `gh`
commands through the managed Git gateway are "Running Git for the AI" and
"Running GitHub CLI for the AI", under their session and the project whose
session store served the command; that slug is read without listing projects,
because the gateway is a hot path. A Claude assistant process carries its
session's project. Shared Codex app-server and OpenCode server processes serve
many sessions and carry no single project or session.

A finite capture's unit sets `LogLevelMax=notice`. Its output already returns
to the caller, so the journal keeps only systemd's notices, warnings and errors
about it (a failed or killed command, its exit status and result) and none of
the routine Starting, Started and Deactivated lines that each frequent short
command would otherwise add. The same limit applies to anything the command's
own processes log to the journal, such as syslog messages. Terminal (pty) and
detached executions keep systemd's normal unit messages.

`createVibe64ConversationExecution()` adapts native conversation execution to the
existing command policy gateway. It exposes process start, running/exit
observations and owned stop, with optional duplex bytes carried by a private
socket inside the managed scope. Input EOF does not discard the remaining reply.
JSKIT owns the engine command and protocol; this host retains actor, environment,
runtime paths, resource accounting and verified scope cleanup. Socket files are
removed only after the execution owner confirms that the scope is empty.
Recovery delegates the saved execution ID to that same owner rather than
requiring an entry in the restarted adapter's memory. An absent process is not
evidence of a successful exit; missing exit status stays unknown. Observation
failure rejects the exit wait and does not acknowledge scope cleanup.
Each host inspection starts the privileged helper, so while the gateway's
reported process ID still exists the adapter checks it locally each second and
inspects through the host only every 30 seconds. A vanished process ID only
prompts the next host inspection, which still supplies the exit evidence.
Without a process ID it inspects through the host each second.
Startup rejects missing execution identities and retains the gateway's failure
receipt and retryability. Native owners may supply their existing stop reason
and termination grace period; the gateway still proves scope cleanup.

Without an installed execution provider, the running server owns its detached
commands (shared services, assistants, agent session commands and the agent
Preview browser) and records them only in memory. While any run it keeps one
reaper process holding their process groups over a pipe from the server. When
the server ends in any way, including a crash or a closed terminal, the pipe
closes and the reaper stops those groups (SIGTERM, then SIGKILL after three
seconds); it also exits once the last detached command ends. Commands remain
their own process-group leaders. A stop drains a command's group the same way
and counts a member that has exited as ended, though its parent, or init for an
orphan, has yet to reap it (`waitForProcessGroupEmpty` in `engines/detached.js`
reads a group still there 100 ms on, then 200, 400, 800 ms after each read: its
leader's /proc entry while the leader runs, and once it has exited every
member's with `processGroupHasLiveMember`, without the thread pool, whose
per-file round trips a loaded host stretched to 1.45 s for one read). Whether
a process has ended is one rule, `processEnded` in `runtime/processEnded.js`, that
every check of a process or group uses: a zombie (Z) on its last thread has
ended, but a zombie leader whose process still runs other threads (its main
thread called `pthread_exit`) has not, as /proc's thread count shows. A streamed
command's stdio bridge, its group's leader, ends its child's input at SIGTERM
and ends only after reaping that child, so the child is never left for init to
reap, and a SIGTERM that reached the bridge alone still ends a child that reads
its input to the end. Terminal commands, including Preview launches,
end with the kernel's hangup of their terminal instead; a program that ignores
SIGHUP outlives the server. Captured commands are not held. A saved service
execution ID this server does not hold therefore belongs to an earlier server
whose groups were already stopped. `stopVibe64RestoredService`, the default stop
of the Claude host and of the conversation execution facility, whose owners keep
only that ID, reports such a restored stop as an empty scope without claiming
to have stopped anything.
`stopVibe64Execution` still reports an unknown ID as not found, so an owner that
also keeps the process's own identity, such as the Codex app-server, runs its
identity proof, which also finds command groups that left the service's group.
Windows keeps its previous behaviour.

The terminal-session registry keeps a namespace only while it holds a session.
Listing, reading, subscribing to, stopping or closing a namespace records nothing.
The command environment resolver (`packages/vibe64-execution/src/server/env/resolveCommandEnv.js`)
retains a trusted absolute host `XDG_RUNTIME_DIR` only when the resolved child
UID/GID matches the current process. Runtime sockets therefore retain their host
location across same-identity execution, independently of private credential HOME.
Cross-identity execution does not receive that directory; request and project
configuration still cannot override this policy-owned setting.
The resolver never takes `NODE_ENV` from the editor's environment or a caller's
base env: a command's framework mode comes only from the project's Env, the
launch's or caller's own env, its Staging Env or its own command line, so a
host may serve the editor itself in production mode. Nor does it take the
editor's `APP_ENV`: every command but a staging command or a staging
account's gets `APP_ENV=development` over the project's Env and its own env,
and a Preview command also starts with `NODE_ENV=development`, which the
project's Env or launch may change. Nor does it take the editor's own sign-in
settings, any name beginning `AUTH_`: the editor is itself a JSKIT application
whose `AUTH_*` would turn on or redirect a project's own JSKIT sign-in, so a
command's `AUTH_*` come only from the project's Env, the launch's or caller's
own env or its Staging Env. A Claude Code process, started from the editor's
env, gets its project's Env as the project's for the same reason. Nor does it
take the editor's own address, `HOST` and `PORT`, nor the proxies it believes
(`TRUSTED_PROXIES`) and the surfaces it serves (`SERVER_SURFACE`,
`JSKIT_SERVER_SURFACE`), which a project's server reads under the same names:
its dev server would try the editor's own port. On a managed host (one whose
helper runs people's commands) the editor is the host's service, so its
environment is the service's, not a person's: the host's variables for the app,
the editor's settings, public addresses, database and keys. There the resolver
drops from the base env every entry the editor's own process has with the same
value, whoever passed it on, so an agent's command does not bring back what its
agent was started with, and keeps only what any program there needs: language,
time and terminal (`LANG`, `LANGUAGE`, `LC_*`, `TZ`, `TERM`, `COLORTERM`), the
host's proxies and certificates, `TMPDIR`, the Genesis parsers
(`GENESIS_PARSER_*`), `PHP_INI_SCAN_DIR` and the workspace's name
(`VIBE64_WORKSPACE`), which a Git identity of last resort names. A Preview also
keeps the editor's public addresses (`VIBE64_PUBLIC_*`, `VIBE64_PREVIEW_*`) and
its speech service (`VIBE64_VOICE_*`), since it may be an editor itself served
behind this one (public Vibe64's `dev:example`). A value a caller set itself,
and the command's own env, always stay. A standalone editor's environment is its
person's own shell and is kept, but for the names above that are the editor's
own.
A usage recording's Preview or Output launch may also name
`usageRecordingEnvironment`, a function of the environment the gateway resolved
for it: `runVibe64Command` adds what it returns to that environment and to each
PTY terminal's re-resolved one, so the recorder's variables follow from the PATH
the target runs with. What it returns may name only what a caller's env may.
A command whose folder is in a tree holding the gradle adapter's init script, in
`.development/gradle-home/init.d`, gets that session's own Gradle user home as
`GRADLE_USER_HOME` and the shared read-only dependency cache as
`GRADLE_RO_DEP_CACHE` when one is published
(`packages/vibe64-execution/src/server/env/connectedGradleEnv.js`), over the
login's tool homes and the project's Env, unless the command's own environment
names them, so every Gradle command of a session with a gradle connection takes
it with no flag. A session home whose connection is gone is dropped from whatever
environment still names it, such as an agent's started while it was connected.
On a host whose homes cannot start programs, the host profile's
`loginEnvironment` names the tool homes the host gives each login, `%u` standing
for the login (`packages/vibe64-execution/src/server/env/loginToolEnv.js`): a
person's or the daemon's command gets its variables (npm's prefix and cache,
Cargo's, Go's, Python's user base, Corepack's, gems', a cache folder) over the
ones the editor's own environment carries, unless the command's own environment
names them, its folders on PATH, and no login's `~/.local/bin`, not
even one the editor's own PATH inherited; a staging account keeps its home's. Its
variables win over the home's own folders (`~/.cache`, `~/.config`,
`~/.local/share`), which are only the fallback where nothing names one: a credential
home that is the login's own names no folders of its own over them, only its
explicit roots, while a credential home of its own keeps its own folders, and the
exec helper keeps the absolute XDG folders a person's or the daemon's command names
(`packages/vibe64-execution/src/host/commandEnvironment.js`), filling in only the
ones it names none of or names relative; a staging account's stay in its area. A
login environment cannot name `HOME`, `LOGNAME`, `PATH`, `TMPDIR`, `USER` or
`XDG_RUNTIME_DIR`, which the resolver and the helper already own, and a host
profile that does is refused.
The exec helper gives every command but a staging account's the workspace's
temporary folder as `TMPDIR`, and a staging account's its own temporary
folder, `app/tmp` in its area beside its home
(`packages/vibe64-execution/src/host/commandEnvironment.js`), and, because a
JVM ignores `TMPDIR`, every command `JAVA_TOOL_OPTIONS` starting with
`-Djava.io.tmpdir` and `-Djna.tmpdir` set to it (`javaTemporaryOptions`): the
native libraries SQLite's JDBC driver, Netty, Jansi and JNA unpack would
otherwise go to `/tmp` and `~/.cache`, which cannot start programs on a host
whose `/tmp` and homes are `noexec`. The caller's own `JAVA_TOOL_OPTIONS`
follow, so a `-D` it names wins; for a staging account's command run with its
release's Env file, the Env file's own follow, once.
Driver-supplied private home and XDG directories pass through the gateway's
credential-home validation; they are not overwritten with the application's
account home. Relative directories are rejected before starting a process.
When no project, session or supplied identity names the commit author, the
gateway asks git itself for `user.name`/`user.email` with the command's own env
(`packages/vibe64-execution/src/server/env/gitIdentityEnv.js`), so includes,
XDG and repository config and `GIT_CONFIG_*` overrides apply. The gateway awaits
that read without holding the server's thread, and one read answers every
command with the same directory and full env for 30 seconds. A change to a file
`git config --global` writes ends that at once; a read that never finished is
not kept. The synchronous Codex runtime-context builder, rebuilt for each Codex
runtime it describes, shares that memo: it answers from a finished read and
holds its caller only to read when none is current.

The privileged command helper requires exact numeric target UID/GID values and
uses a fixed executable path and trusted environment search path while dropping
privilege. Root's own steps run with the system folders as PATH. The requested
command PATH takes effect only for the target user; a command whose caller names
none, and every release and managed service unit, starts with the PATH the
host's helper settings name (`PATH` in `exec-helper.env`, an EnvironmentFile in
the helper's root-only settings folder), else the system folders, and, when
those settings name the runtime packs that PATH's tools come from
(`VIBE64_RUNTIME_PACK_ROOT`, below), with their folder beside it;
provider credentials and the private OpenCode home remain in their existing
environment. Loader and shell startup injection variables are excluded.
Allowed working directories and host service paths are checked after resolving
symlinks. A link inside an allowed directory cannot grant access outside that root.

The helper's settings folder holds `exec-helper.env`, its people's sudo
commands (`person-sudo-commands`), the people and applications it registered
and the staging keys; every one of those paths derives from it, and the
staging sandbox hides it. It is the system's own Vibe64 settings folder
unless `VIBE64_HOST_SETTINGS_ROOT`, read once as the helper loads
(`hostSettingsRoot` in `hostAccounts.js`), names another, which must be an
absolute, normalized path other than `/`; anything else stops the helper
before it acts. An environment variable is safe here because the helper acts
as root only through sudo, whose `env_reset` drops its caller's variables: a
host that keeps the folder elsewhere makes its sudo target a root-owned
launcher, in a folder only root can change, that sets the variable itself, and
names that launcher in its settings (`VIBE64_EXEC_HELPER_COMMAND`, below), so
the helper's later runs read the same folder.

The same settings say where the helper keeps what it makes outside its own
folders and how its accounts are numbered (`hostSettings.js`); a host that
names none keeps the system's own account files, ranges and folders, as before:

- `VIBE64_ACCOUNT_DATABASE`, `files` (the default) or `extrausers`: the account
  database staging accounts and group memberships are added to. With
  `extrausers` (libnss-extrausers), for a host whose system's own account files
  cannot be written, `useradd`, `userdel` and, for group membership, `gpasswd`
  get `--extrausers`, since `usermod -a -G` leaves such a group unchanged. A
  login shell (staging access) changes through `usermod --prefix`, with a
  root-only folder in `/run` whose `etc` is the database (`changeLoginShell` in
  `hostAccounts.js`): plain `usermod` changes such an account too, but opens the
  system's own account files for writing, which fails there. A person the
  helper makes (`add-person`, below) goes to the same database, without a
  password there as anywhere.
- `VIBE64_PERSON_SHELL`: the login shell of a person the helper makes,
  `/bin/bash` unless the host names its own (an absolute, normalized path of
  letters, digits and `. _ + -`), for a host whose people sign in through a
  shell of its own, so a person made while it runs has the shell the host gives
  its people.
- `VIBE64_SYSTEM_ID_BAND` and `VIBE64_PERSON_ID_BAND`, each `FIRST-LAST`: the
  numbers the helper gives new staging accounts and their groups, and new
  people and theirs, as `useradd -K` keys. A host names them when its system's
  own accounts can change without seeing the helper's (an image-based system
  updated by replacing its image), so the two never share a number; a host that
  names neither numbers by the system's own ranges.
- `VIBE64_SYSTEMD_UNIT_ROOT`: an absolute folder for release and managed
  service units in place of systemd's own, which must be a folder only root can
  change. Like systemd's own folder and the settings file, every account may
  read it and each unit in it: a staging login finds its staging unit as its
  staging account, and the editor reads the installed units' ports. The helper
  writes every unit `0644` whatever umask sudo gave it (`UNIT_MODE` in
  `serviceOperations.js`). systemd does not read it, so the helper links each unit it installs
  into systemd's runtime folder, a staging unit with its boot target
  (`systemctl enable --runtime`), a managed one without (`systemctl link
  --runtime`), and removing a staging unit takes both away (`systemctl disable
  --runtime`). Those links last until the host restarts: at every start, before
  its services, the host runs the root-only `vibe64-exec-helper relink-units`,
  which links every release and managed service unit root wrote there again as
  it was installed and starts the staging units, as a boot starts them from
  systemd's own folder, and gives each `0644` again (one a helper before this
  wrote under a stricter umask, which the editor could not read). A unit root
  did not write, or one others may change, it leaves unlinked and reports. Every reader of the installed units (a release's
  port claim, retiring an application, a staging login) reads the same folder.
- `VIBE64_SUDOERS_ROOT`: an absolute folder for the staging sudo rules in
  place of sudo's own, which the host's sudo configuration includes.
- `VIBE64_STAGING_KEYS_ROOT`: an absolute folder for the application
  accounts' staging key files in place of `staging-ssh` in the helper's
  settings folder, which host setup's SSH policy names; the host's sshd reads
  each account's keys there by its name (`helperStagingKeysRoot`).
- `VIBE64_RUNTIME_PACK_ROOT`: the folder of the runtime packs whose folders
  the helper settings' `PATH` names, when it is not the folder their tool
  wrappers default to (`helperRuntimePackRoot` in `hostSettings.js`). The
  wrappers that come first on that PATH (`policy-bin`'s `npm`, `npx` and
  the rest) run the pack's own program below that folder, and a release or
  managed service has no editor environment to take it from: every release and
  managed service unit names it beside its PATH
  (`Environment=VIBE64_RUNTIME_PACK_ROOT=`), and a staging login and
  `staging-enter` carry it from the unit as they carry its PATH. Without it
  units name none and the wrappers keep their own default. It is written into
  a unit as it is, so it must be an absolute, normalized path of letters,
  digits and `. _ + -` alone. A unit takes it when the helper writes the unit
  (a publish, a Restart, a managed service's install); a unit written before
  keeps what it had until then.
- `VIBE64_EXEC_HELPER_COMMAND`: the command that starts the helper, when the
  host starts it through a launcher rather than by the file it runs from
  (`helperCommand` in `hostSettings.js`). The helper's later runs start it
  so: the staging sudo rule and the staging shell's commands, `staging-enter`,
  a staging unit's `ExecStart`, a managed run, and the command the refusal of
  an unregistered person tells an administrator to run. Without it they name
  the file the helper runs from, as before. It is written into a sudo rule, a
  unit and a shell function as it is, so it must be an absolute, normalized
  path of letters, digits and `. _ + -` alone.

An unknown database, a band that is not `FIRST-LAST` (first no greater than
last, both below 65534), a folder that is not an absolute path other than `/`
or a helper command that is not such a path refuses the operation that needs
it. A host's own server reads the configured
unit folder through `@local/vibe64-execution/server/hostSettings`
(`helperSystemdUnitRoot`).

The helper writes what it keeps across restarts durably: a unit file, a
person's or application's registration and a staging key or sudo rule have
their data synced to disk before they are renamed into place, and their folder
after (`hostFiles.js`'s `fsyncDirectory`), so a power cut leaves the old file or
the new one, never an empty one.

The helper's `managed-service` operation serves the daemon's own long-running
services below the workspace service root. `install-start` writes the unit and
starts it without a boot target, so it runs only while used: its owner starts it
again through the same action, and a staging service whose unit `Requires=` it
starts it at boot. `stop` stops and disables it and leaves its data in place.
It refuses, reporting `required` and the units, while a running, starting or
unreadable unit still requires the service, because systemd would stop that
unit with it. `restart` serves the owner of a service that hangs: systemd
stops it, killing it when it outlasts its stop time limit, and starts it again,
stopping and starting with it each running unit that `Requires=` it, and
reports those units; a unit never installed is `absent` and nothing runs.
Staging services keep their boot target.
`tests/server/vibe64ExecutionHelperSource.unit.test.js` covers the three actions.

Where the daemon or a target user can rearrange a directory, the helper reads a
file there only through that directory opened without following links, and
only as that owner's regular file within a size limit. It never waits on a
FIFO and never repeats what it read in an error. This covers a user's Vibe64
membership in the daemon's state directory and a forking managed service's
PID file, which it also removes only through that directory and only while the
file still names the process it found stopped. A payload arrives on standard
input, except that a managed execution whose terminal holds standard input
passes it as the daemon's own file directly in the workspace's payload
directory; the helper accepts no other file, and removes that one once read.

The helper acts as another account only for a person of the calling daemon's
workspace. Root keeps that workspace's people in its own registry, one
root-owned file per person in a root-only folder for the workspace, which no
daemon can write. Host setup registers an existing account with the root-only
`register-person <workspace> <username>`. The root-only
`add-person <workspace> <username>` (`addPerson` in `personRegistry.js`) is for
a login the workspace's member list names: an existing account is registered as
`register-person` registers one, and a login without an account is first made
without a password (`createPerson` in `hostAccounts.js`): in the host's account
database, numbered in its people's band, in a group of its own, with the host's
person shell and an empty home of its own, `/home/<login>` at 0750, whatever the
umask. That home is always one it makes: when anything is already at
`/home/<login>` (a folder an account removed outside Vibe64 left, whatever uid
owns it, a link or a file), no account is made and the step fails (exit 2) with
one line naming it, its kind and uid, and how an administrator moves it away;
the folder stays exactly as it is, since whose files they are is not Vibe64's to
judge, and the next member list makes the person once it is gone. One that
appears while the account is made takes the new account away again. Either way the person joins the
shared group and `nix-users`, the group the units of a person's commands name,
and running it again changes nothing. A name Vibe64 keeps for its own accounts
(a workspace daemon's or a staging account's, `root`, or not a managed
username) and an existing system or administrator account are refused with exit 3 before anything changes. The
daemon has no operation that makes, registers or re-enables a person (the
helper refuses `create-system-user` and `enable-system-user` as unknown
operations): it can never make an account, nor make an existing one a person
or add it to the shared group, merely by naming it. Every
command as a person, captured or managed, needs that registration with the
account's current uid, a login uid from `login.defs` rather than a system
account, no administrator power, the shared group, and an active membership in
the daemon's state. An administrator is an account in one of the groups that
administer the host or reach root without sudo (`adm`, `admin`, `disk`,
`docker`, `incus`, `incus-admin`, `kmem`, `libvirt`, `lxd`, `root`, `shadow`,
`staff`, `sudo`, `wheel`), or one for which root's `sudo -n -l -U` lists a
rule other than the host's own narrow commands for its people. The host lists
those exact commands, one per line as sudo prints them, in a root-only file;
each allowed rule runs one of them as root without a password, and any other
rule, or an answer sudo never gives, refuses. A staging account (`v64s_`)
is never a person. The root-only `check-person <username>` exits 0 for an
account the helper may act as and 3 with the reason otherwise, so host setup can
hand an owner's administration to a separate account first and SSH access can
refuse an administrator. The check repeats
before every command, so a person who later becomes an administrator is
refused from then on. The person's command then runs with no new privileges,
so sudo, su and other setuid programs cannot raise it. That alone would not
protect an administrator: the command could still change the account's own
files, such as its SSH keys, shell start-up files or user services, which run
with all of its rights at its next sign-in. A managed execution's runner gets
no new privileges from `setpriv --no-new-privs`, because a container's systemd
drop-in can switch a unit's `NoNewPrivileges=` off. Every execution's runner
starts so (`NO_NEW_PRIVILEGES_COMMAND` in `systemdUnits.js`), the daemon's own
included. The daemon's sudo rule names this helper, and the helper takes the
daemon's word for every request, so an agent's command, its assistant, a
Preview, a browser or a capture running as the daemon once could reach the
helper through `sudo -n` and start work outside its own unit (an execution no
Stop or command end reached, a managed service), act as another person or
change Staging. Only the daemon's processes outside every execution, the
editor's own service above all, still reach the helper. A managed service's
start script, in the workspace's own folders, starts under the same prefix:
the daemon's executions may change that script and end its process into a
restart. A managed service unit installed before takes it when the editor next
installs it. The daemon's private state
(`editor-private` below its state root, `editorPrivateState.js`: Production's
Env and the key that seals it, which the editor's own service alone reads) is
hidden from every execution and managed service the helper starts for the
daemon or a person (`InaccessiblePaths=`), so an agent, a terminal or a Preview
running as the daemon's own user is refused by the filesystem; the leading `-`
lets a unit start before the editor first makes the folder, which it does when
it starts. Host setup runs the root-only
`upgrade-person-registry <workspace>` once per workspace: it registers each
membership whose account is already in the shared group, except system and
administrator accounts, which it reports; a workspace that has a registry keeps
it.
`tests/server/vibe64ExecutionPersonRegistry.unit.test.js` covers the registry,
`add-person` and their refusals; `tests/server/vibe64ExecutionHostSettings.unit.test.js`
covers how a person is made, and `tests/server/vibe64ExecutionHelperSource.unit.test.js`
that the daemon's `create-system-user` and `enable-system-user` are refused.

Each project published to staging runs as its own staging account, which the
helper's `staging-account` operation makes and retires; the daemon names only the
project, by its folder below the workspace's `projects`: a catalogue project's
own folder, or a learner's practice project's,
`.learning/<learner>/<practice>/training-<practice>`, the shape
`learningSpace.js` gives it. The helper derives the account, `v64s_` and twelve
hex digits of a hash of the workspace and the project's slug, and its area, a
folder per workspace and slug below the staging area the host's helper
settings name (`VIBE64_STAGING_AREA_ROOT`), from the calling daemon; a host
that names none refuses every staging account. Catalogue projects may not take a practice slug, so every
slug, and with it every account, area and staging unit name, belongs to one
project of its workspace. The account
is a system account with only its own group: no login, no home outside its
area, never in `vibe64` or `nix-users`. Root registers it in its own registry,
one root-owned file per account in a root-only folder for the workspace, apart
from the people's. A person
operation refuses any `v64s_` name, and an application is acted as only through
that registry, so neither ever stands in for the other. `ensure` makes the
account on first use and adopts an account an interrupted `ensure` left
unregistered only when it is exactly the account the helper makes. A new
registration needs a project of the workspace (its folder below `projects`,
reached through real folders without following links) and room under the workspace's
limit of 100 registrations, because each holds a system uid for as long as it
lasts and the host's system uid range is small. Through
directories it opened itself, never following a link, it makes the area: root's
directories down to the project's (`0711`), the daemon's `handover/` the
application's group may read (`2750`), and the application's own `app/` with
its `home/`, its temporary folder `tmp/`, and `database/` (`0700`), which the
daemon may search for a database by name but never list. An existing directory
must still have the owner it was given, except `home/` and `tmp/`, which the
application may make whatever it likes and root never opens again; nothing is
repaired. `retire` refuses while a staging unit of the
account is still installed (it could start it again), while its `database/`
still holds anything (root never removes a database), or while anything runs
as it.
It unregisters the account before it looks for its processes, so no new
execution can start as it meanwhile, and registers it again when it refuses.
It then removes the whole area, the account and its registration, so the
account's uid and its place under the limit are free again. A staging
database outlives its project, as other staging databases do: the editor
gives it back into its own staging database directory before it retires the
application, which leaves `database/` empty; a database still there (one the
editor did not know of, or made under an earlier path) stops the retire and is
kept.

While a host lets a project's AI sessions use its staging, the helper's
`staging-access` operation (`stagingLogin.js`, `stagingAccess.js`)
gives the project's staging account a way in for them: `grant` writes the
project's one `ssh-ed25519` public key as a root-owned key file for the
account in the key folder its settings name (loopback only, no forwarding, and
the login's forced command, `staging-shell`, named in the key itself, so sshd
confines the account on a host without host setup's SSH policy; where that
policy names the same command, sshd runs the policy's), `0644` whatever the
helper's umask, in folders it makes `0755`, as sshd reads the key as the
account, which neither owns it nor is in its group (the managed umask `0007`
once left it `0640`, and every staging login was refused), a
`visudo`-checked sudoers rule of its own, `0440` whatever the umask (`stagingSudoersPath`, in the sudo rule folder its settings name) that lets
the account run exactly `vibe64-exec-helper staging-service *` (by the command
its settings name), and the
login shell `/bin/sh`, which the account check accepts only while that key
file exists. sshd starts even the forced command through that shell, and
`/bin/sh -c` reads no file of the account's, where bash started by sshd would
read the `~/.bashrc` the application can write. `revoke` removes all three,
the key file and rule only where it finds them: it looks before it removes, so
taking back access an account never had writes nothing into either folder, and
a read-only sudo rule folder (where unlink fails before it looks a name up)
holding no rule is no error, while a rule such a folder still holds fails the
revoke. It turns off lingering, ends the account's open logins (`loginctl
terminate-user`) and removes the account's crontab and at jobs, which a login
could leave to run later; `retire` refuses while anything of the account still
runs (a staging login included) and only then revokes. The host's SSH
policy, not the helper, admits staging accounts from loopback alone, with
that key file and `vibe64-exec-helper staging-shell` as their forced
command. That command runs as the account, finds the staging unit root
installed for it (the running one), and starts the client's command, bash
(`--noprofile --norc`, and no `BASH_ENV` or `ENV` from the login's
environment) or an SFTP server in that release's folder with its Env file, the
unit's PATH, runtime pack folder and temporary folder (with a JVM's options naming it, the Env file's own
after them) and, for a release whose start script runs the command it is
given, that script's runtimes and Serve defaults; it adds `staging-logs`,
`staging-status`, `staging-restart` and `staging-enter`. `activity`
reads two records for the account, each its newest 500 entries, and says when
older ones are left out: the host's own, root's logind entries for each of the
account's login sessions (its start, and its end however it ended: logout, a
dropped connection or revoke's `terminate-user`), which the account cannot
write; and what each login reported itself, which the forced command logs as
the account to the journal under `vibe64-staging` (its command word for
word, the session id the client sent, its logind session, exit status and
duration). The account could write those lines too, and sshd's PAM stack may
set a login's environment from a file of the account's (Ubuntu's reads
`~/.pam_environment`, which could name a library every program of the login
loads), so they are only what the login says. Such a login runs outside the staging service's sandbox, as a
person's own login would, so mounts the service makes in namespaces of its own
(its private `/tmp`, a FUSE volume) are not there.
`staging-service`, through sudo, accepts only a staging account with
its key installed, and reads, restarts or enters only that account's own
staging unit. `enter` refuses a unit with no running main process, or one
whose main process is not in the unit's own cgroup when root reads its
namespaces or after (a main process that ended leaves its number to any
process); otherwise root runs `nsenter`, which enters that process's mount
namespace and becomes the account (its own group only) before anything in that
namespace runs, since an application with the FUSE or gVisor allowance may have
made that namespace itself. A main process in a user namespace of the
application's own is joined there too, as the ids the account has in it,
because a FUSE volume mounted there admits only that namespace's processes.
There the helper's `staging-enter`, as the account, refuses unless it is in
the mount namespace root read, then reads the release's Env file and starts the
command, or the shell, in the release's folder through its start script, as
the login does.

The helper answers to no other name: any other command or operation is refused
as unknown, and `activity` reads only the journal tag `vibe64-staging`.

A managed execution runs as an application only when the daemon asks for its
registered account by name (`stagingAccount`), and only as a finite capture.
Any command may run there, from the application's own area (`app/` or
`database/`, its home by default), with a link it planted resolved before the
check. The editor cannot enter that area, so it checks such a directory against
the request's allowed roots without resolving links, and the helper resolves it
as root. It runs as the account and its own group alone, with umask `0077`, the
runner under `setpriv --no-new-privs`, and a sandbox: no new privileges, its
own `app/tmp` as its `TMPDIR` (with a private `/tmp` beside it, which may be
`noexec`), the whole file system read-only except its area
and its receipt, no access to homes or to the host's settings folder (with
its people and applications), no other users' processes, no devices beyond
the standard ones, no System V IPC or `/dev/shm` shared with others, no kernel settings,
namespaces or capabilities; only internet, local and netlink
sockets (Node's `os.networkInterfaces()` needs netlink); and only an ordinary
service's system calls (`@system-service`), any other failing with `EPERM`.
A set-user-ID or set-group-ID file it makes does nothing: the host mounts the
staging area `nosuid,nodev`, so the kernel ignores those bits there for
every process on the host, sandboxed or not, and the helper requires it. Before
it runs an application's command or installs its staging service, the mount
covering the area (the last listed with the longest mount point holding it in
`/proc/self/mountinfo`) must be `nosuid`, and so must the one covering a staging
service's working directory before its start script runs, at every start, boot
included. Otherwise the helper refuses with a message naming the area, and no
application code runs. Everything else an application may write, its private
`/tmp` and `/var/tmp`, its `/dev/shm` and its receipt in `/run`, is `nosuid`
too. The sandbox has
no `RestrictSUIDSGID=`: under it systemd refuses `openat2()` with `ENOSYS`,
since it cannot see the mode inside `struct open_how`, and GNU tar creates
every file and folder it unpacks with `openat2()`, so tar and dpkg-deb could
unpack nothing. A person's own computer has no staging accounts, so it
needs no such mount.
Builds with Node, npm, esbuild, Python, tar, dpkg-deb and SQLite run unchanged in it.
A release whose Deployment section says `- Sandbox allows:` asks for more, and
the daemon passes what its release record holds (`sandboxAllowances`) with
each of the application's executions and its staging unit. The helper accepts
it only for an application's own execution or staging unit, and only for
allowances the host's owner lists in its root-owned helper settings
(`VIBE64_STAGING_SANDBOX_ALLOWANCES`, for example `gvisor fuse`); anything
else, or a setting naming an allowance the helper does not know, refuses the
command rather than run it with less. `gvisor` (gVisor's rootless `runsc`)
turns `RestrictNamespaces=yes` into `user mnt pid ipc uts net` and adds
`@mount` and `ptrace` to the system calls; `fuse` turns it into `user mnt`,
adds `@mount`, and exposes the host's `/dev/fuse` (`DeviceAllow=/dev/fuse rw`
and `BindPaths=/dev/fuse`, the only device beyond the standard ones). Nothing
else changes: inside a user namespace its processes hold capabilities only over
what that namespace owns, the mounts it inherits stay locked, so the read-only
file system, the inaccessible paths and the writable area hold, its files keep
their real owner outside, and it may trace only its own processes. An opt-in
real-host test (`tests/server/vibe64StagingSandboxAllowances.integration.test.js`,
`VIBE64_TEST_STAGING_SANDBOX=1` with `VIBE64_TEST_RUNSC`) runs these exact
lines as systemd units through sudo: without an allowance no namespace,
`/dev/fuse` or gVisor; with `fuse` a FUSE mount the host and the rest of the
unit never see; with `gvisor` a rootless `runsc` sandbox; and without any one
namespace, system call group or device an allowance adds, what it allows fails
again. Only the
daemon reaches the helper (its sudo rule names the daemon alone, and an
application's sandbox gives no new privileges), and the release and service
records live in the daemon's staging state, outside every application's
writable area.
Its receipt sits in
root's own runtime directory for the workspace's applications (`0711`), which
the account can traverse but not list, because it is in no group that reaches
the daemon's runtime directory. Inspect, stop and release-ended find receipts
in both. A staging environment is accepted only for an application's command:
the daemon's file `handover/<release>/environment`, readable by the
application's group alone, for a command in that release's build or workspace.
`tests/server/vibe64ExecutionStagingAccounts.unit.test.js` covers the
accounts, their area, their executions and their refusals.

Root never reads a release's environment file, and no unit makes systemd read
one on root's behalf. A staging service's unit runs the helper as the service's
own user, which loads the file at every start, restarts included, and then
becomes the service's start script, so no extra process stays running. A
finite execution given a staging environment has its runner load the file as
the application. The file keeps systemd's `EnvironmentFile=` syntax.

A managed service's runner stays connected to the controller that admitted it
and stops the service when that connection ends. The controller's lease is
the socket `resource-controller.sock` in the daemon's runtime directory, where
only the daemon adds entries and which no application can reach; the helper
starts a service only with exactly that daemon's socket
(`managedExecutionControllerLeaseName()`), so no other local account can take
the lease first, as it could an abstract socket name.

`staging-unit install-start` installs a staging service only for an
staging account root registered for the calling daemon's workspace. Its
working directory must be `app/releases/<release>/workspace` in that
application's area, or a folder inside it (the release's Workdir) that root
reaches through real directories, never a link the application planted; and
its environment file and start script the daemon's own
`handover/<release>/` files for that same release, which the application's
group may read (and run) but not change. The unit runs as the account and its
own group with umask `0077`, the helper under `setpriv --no-new-privs`, in the
same sandbox as the application's executions with its area as the only
writable place, its `app/tmp` there as its `TMPDIR` (`Environment=TMPDIR=`,
with a private `/tmp` beside it), and one listening port: `SocketBindAllow=`
names its loopback port (1024–65535) and `SocketBindDeny=any` refuses every
other TCP port, port 0 included, so it can never take over another service's
port while that service is down. UDP binds stay allowed: a UDP client (Node's
`dgram`, for StatsD or syslog) binds before it sends, usually to port 0, which
no port rule can name, and no host service listens on an unprivileged UDP
port. The staging service still starts at boot and requires its managed
databases.

`/tmp`, a private one included, may be `noexec` (mobilynet mounts it so), so a
tool that unpacks a program into `TMPDIR` and runs it would fail there; the
staging area lets programs start, and is the application's own, so its
temporary folder there opens nothing to anyone else. At every start the
helper's `run-staging-unit`, as the account, makes that folder afresh, as a
private `/tmp` is: it removes `app/tmp` (a link the application planted there
removed, never followed), makes it again (`0700`), and gives a JVM options
naming it before the Env file's own. It does so only where the unit's `TMPDIR`
is exactly `tmp` beside the account's home in its `app/` folder, never a folder
an Env file names. What it cannot remove (a folder the application made
read-only) stays, said in the service's log, and the start goes on. A unit
written before keeps `TMPDIR=/tmp` and starts as it did until the helper
writes it again (its next publish).

Known, accepted limit: a finite execution as an application (Prepare, Build,
Migrate, release file work) has no bind limits, so it may listen on any TCP
port that is free, including a stopped staging service's. Builds and tests
legitimately listen: a headless browser's debugging port (Puppeteer's default
`--remote-debugging-port=0`) and test servers on port 0, which no
`SocketBindAllow=` rule can name alone. Such a listener lasts only as long as
its finite execution.

Every `staging-unit` action (install-start, remove, inspect) names a
unit of the calling daemon's own workspace, `vibe64-staging-<workspace>-…`, so
no daemon replaces, stops or reads another workspace's staging service.
install-start also requires the name of the application's own project
(`vibe64-staging-<workspace>-<project>-<hash>.service`), refuses a unit file
already installed for another account, and refuses a port that another staging
unit's `SocketBindAllow=` claims; root reads only unit files it wrote. A unit of
the calling workspace that is not one (a link or mask, another owner's, one
others may change, or an oversized one) is refused by name; another
workspace's claims nothing and never stops this one. `assertStagingUnitClaim()`
holds these checks.

`startVibe64Workflow()`, `setVibe64WorkflowPhase()` and
`finishVibe64Workflow()` delegate trusted server lifecycle requests to the same
installed managed-execution provider as commands. Standalone operation may
return no workflow; a required managed provider or installed provider without
workflow support fails explicitly rather than bypassing accounting.

Finite capture requests accept an `AbortSignal`. The installed execution provider
owns managed cancellation and descendant drain. Standalone capture uses its
existing process-group cleanup; unsuccessful drains retain an execution stop
handle for explicit retry through `stopVibe64Execution()`. Concurrent stops share
the same drain, and a successful drain is not repeated. Cancellation reports
completion only after cleanup; a failed drain remains an explicit failure.
After that original standalone scope-empty proof, capture projects its existing
execution descriptor with `state: "finished"`, including cancellation after
drain. Early cancellation and failed drains retain their prior results. This
terminal projection lets the internal declared-check owner remove temporary
assets only after confirmed completion; finite lifecycle alone is not proof.
A failed drain returns `vibe64_execution_drain_failed` without replacing the
command's own outcome: the error says whether the command timed out, was
cancelled or finished, `timedOut` and the signal are kept, and on Linux up to ten
remaining processes are named in the error and in `remainingProcesses`. A member
the server may not signal, such as a sudo helper's root-owned child, is one such
remainder.

Execution metadata carries only a validated workflow UUID. It cannot select a
systemd unit, host path or resource policy. The execution provider verifies
project/session ownership and supplies the privileged helper with the UUID and
bounded project/session keys. The helper derives the workspace from the
authenticated daemon identity and creates nested project/session/workflow
accounting slices beneath that workspace's existing work slice. Child execution
limits and all ancestor limits still apply. No shared database or provider
service moves into these groups automatically.
Execution inspection and stop use the same hierarchical `cgroup.events`
population evidence as workflow accounting. An empty parent `cgroup.procs`
cannot declare a delegated service complete while its child groups still run;
unavailable population evidence remains unknown and cannot acknowledge cleanup.

The helper creates transient systemd slices with bounded memory/tasks and
readback verification. Creating the same active identity is idempotent only
when the requested limits match. It cannot exceed the actual workspace work
ceiling or reconfigure an existing workflow through the create operation.
Attaching a managed execution requires an active owned workflow and child limits
no larger than that parent. Ordinary commands without workflow identity retain
their existing execution path.

An ordinary command runs in its workspace's work slice, whose limits the helper
sets with `systemctl set-property --runtime`, so they last until reboot. The
helper first reads the slice's own cgroup: when it exists with the memory, I/O
and task controllers on, `pids.max` at the requested task limit and
`memory.max` at the requested memory limit rounded down to a page, the command
starts with no `systemctl` call and systemd rewrites none of the slice's
drop-ins. A missing, stopped or differently limited slice, or a file the helper
cannot read, takes the full path: start the slice if inactive, then set its
limits. A command run as the workspace daemon reuses the daemon identity the
helper resolved for its caller instead of looking it up again.
`tests/server/vibe64ExecutionWorkSlice.unit.test.js` covers both paths.

Repeatable caller-owned activities may also carry `resourceProfile` with a task
key, environment and opaque compatibility digest. This is identity metadata,
not an allocation request: it cannot contain commands, credentials, paths or
memory policy. Codex and OpenCode service callers identify their installed
runtime/configuration; an unresolved Codex executable omits the digest. Arbitrary
shell commands do not acquire a guessed identity from their command text. The
installed execution provider owns any historical measurement and start decision;
workflow children must not train an independent copy of their parent's demand.
Final execution receipts retain nullable kernel resource counters so an owning
provider can distinguish missing quality evidence from genuine zero counters.

The privileged `workflow-grow` action accepts the workflow identity, its expected
current maximum and a requested byte budget, plus at most 128 distinct execution
identities with their expected/requested maxima. The provider must reserve the
additional capacity before invoking it. Every execution must be an active direct
child of that exact workflow. All targets are validated before any write; stale
expected limits, reductions, unknown groups and target/ancestor memory throttles
or hard limits reject the request. The action changes neither ancestors nor
unlisted executions, task limits, processes or application state.

Growth applies the parent first, then the requested children, and checks both
systemd and kernel readback. Requested budgets are rounded down to whole kernel
pages, never above the provider's budget. The response includes page size, before
and after configured/effective limits, and limiting-ancestor readings. Missing
or inconsistent readings are not treated as successful changes. A refusal at a
target or ancestor names that group, the limiting field, its observed maximum
and the requested allowance so the provider can explain the actual constraint.

These workflow actions are proved on a real systemd only by the real-host case
of `tests/server/vibe64ManagedWorkflow.unit.test.js`, which every ordinary run
skips (it needs root's systemd, `sudo -n` and a workspace account).
`tooling/proof/systemd-workflow/run.sh` runs it in a disposable Incus VM it
deletes by exact name on every exit: a sudo-capable operator drives the helper
for a hand-made workspace account, which stands in for the one a managed host's
account step makes (mobilynet's accounts work-area, proved by mobilynet's own
tests), under a hand-made work slice with a 2 GiB MemoryMax, which stands in
for host setup's. It proves the helper's workflow groups, their limits, the
`sudo -n` units, growth and its refusals, not how a host makes either.

A failure reports `unchanged`, `partial` or `unknown` for this invocation. A
failed write is not proof of no effect; only complete readback equal to the
original limits proves unchanged after an attempted write. Partial changes are
never undone by shrinking a running limit. The provider must retain its larger
reservation until it reconciles unknown/partial results. `unchanged` on a later
retry does not undo an earlier attempt: its before/after limits must also match
the provider's recorded reservation intent before capacity can be released.
Successful responses distinguish an actual change from an exact no-op. This
mechanism provides no automatic-growth policy, scheduler or application restart.

`workflow-limits` accepts the same bounded owned target identities but only
reads their current configured/effective maxima, `memory.high`, page size and
ancestor limits. It performs no writes and does not require the old expected
maximum to match: its purpose is to reconcile an interrupted change without
issuing it again. An existing lower throttle is reported rather than changed.
Every requested target must still be active and belong to the exact workflow;
the provider separately accounts for executions already verified complete.
These are current readings, not recovered evidence of pre-change limits.

Inspection reads whole-group current memory, lifetime peak, memory breakdown,
swap bytes/activity, memory-limit events, memory stall time and descendant
emptiness. Missing counters are nullable. An empty parent process list alone
does not prove its descendant groups empty, and child maxima are never added
to invent a simultaneous peak.

Individual execution inspection also returns `exitObservedAt` and
`exitTimeSource` when available. The existing command runner records its child
exit event in `result.json`; retained receipts take precedence over the later
wrapper-exit observation. Otherwise, the same systemd inspection reads
`ExecMainExitTimestamp` with UTC subsecond formatting. These are host/runner
observations, not invented exact kernel death times. No new helper action or
poller is added. The normal finite launcher removes its receipt before later
inspection; that path relies on remaining systemd evidence. Absent evidence
stays unknown. The consumer owns durable incident storage and presentation.

An inspect response may also include `oomBoundary` after systemd or a retained
runner counter establishes OOM. The existing helper queries only current-boot
kernel OOM records matching the exact execution unit and start/exit window,
with a two-second/128-KiB/64-event bound. The kernel's `oom_memcg` identifies the
exceeded memory group, separately from the victim's `task_memcg`. Evidence names
the scope, exact cgroup and recorded time; it does not infer a numeric limit.
Long kernel paths may split the report at `task_memcg=`. Only the immediately
adjacent, same-boot/same-journal-sequence complete victim suffix with close kernel
time is joined; incomplete/interleaved records stay unknown. Only the owned unit
beneath its authenticated workspace is accepted. Conflicting
boundaries, unsupported placement constraints and unavailable/truncated journals
return null. Normal running inspection and cleanup polling perform no journal
lookup. Consumers own private retention and must not expose raw host paths or
kernel text through public incident views.

Execution inspection can also return `taskLimit`. The runner retains a positive
`pids.events.local`/`pids.events` counter in its existing result receipt; the
inspector reads the same counters when the group still exists. Only local
enforcement under normal cgroup-v2 mount semantics proves the execution boundary.
`pids_localevents`, aggregate-only counters or unknown mount semantics cannot
identify that boundary. Counters cover the group's lifetime, not an exact
denial time. Missing counters are not fabricated zeroes.
Runner receipts also retain their start time. When systemd has collected the
transient unit, its default `success`, exit status and task maximum do not replace
the saved runner measurements. Start and observed exit times still bound a
failure-only journal lookup after collection.
After saving its receipt the runner exits with the command's exit status. When a
service's command ends by a signal, the runner re-raises that signal, so systemd
judges the unit as it would the command: a service stopped with SIGTERM is a
clean stop rather than a failed unit. A finite or interactive command ended by a
signal exits with 128 plus the signal's number instead, because
`systemd-run --wait` would report a clean signal stop of its unit as success.
For an unsuccessful execution without counter evidence, inspection checks a
current-boot, exact-owned-unit, start/exit-bounded kernel journal query with the
same two-second/128-KiB/64-record limits. A complete fork-denial record proves
task creation was refused in this activity, but names the originating group,
not the limiting ancestor. It therefore leaves the boundary and denial count
unknown. Unavailable, truncated, foreign or out-of-window evidence stays null.
No task limit is changed, no additional sampler/store is introduced, and cleanup
polling does not query the journal. The provider retains original exits and owns
any user-facing explanation; a task denial is not memory-exhaustion evidence.

Finish refuses a populated or unknown group. It atomically retains final
counters before stopping the exact accounting unit and verifies inactivity.
The root-owned `0600` receipt at
`<helper run directory>/<workspace>/<uuid>.json`, beneath `0700` directories,
survives a lost helper response or controller restart in the same boot.
Only after recording durable history does the provider acknowledge that receipt;
acknowledgement requires the unit to be empty and inactive. Repeated finish and
acknowledgement are safe. If systemd already collected the empty transient unit,
a repeated stop-command failure does not override verified inactive/absent state
and the retained empty-group receipt. An active or unproven group still fails.
Receipts are boot-local evidence, not durable profiles
or a reservation ledger.

Workspace preparation starts one workflow for its declared command sequence.
Each new output terminal starts its own workflow, advancing an interactive
output to running after readiness and reporting its outcome when it closes.
Reusing a running preview does not create a second workflow. Finite output and
workspace-setup runs stay in the execution phase. A scoped browser-test target
uses the test accounting environment; restoring the normal target uses
development. This metadata does not change application database selection.

The caller supplies exact project/session ownership and a compatibility digest
of the operation, normalized command/workdir, runtime installations, dependency
files, platform and architecture. Commands come from the inspected contract,
before generated ports and readiness tokens are substituted. Dependency paths
belong to the existing runtime-pack registry. Only those paths in the source
root and declared workdirs are read, with a 64-file / 16 MiB aggregate bound,
8 MiB per file and a 256-entry in-process digest cache. Ordinary source edits
and a different session source path do not discard compatible observations.
No command text, source path, environment value or file contents cross into
profile identity metadata. Runtime fingerprints include resolved pack bin
directories and every registered command's filesystem identity, not only the
first executable. This distinguishes aggregate-pack upgrades that retain a
shared tool and secondary-command changes behind stable wrappers. Registered
commands absent from a pack are represented as absent; a pack with no available
registered command is unlearnable. No directory scan or version process runs.

The existing runtime registry also names required installed identity paths for
wrapper-backed packs: operator CLI package manifests and Playwright's runtime
manifest/browser-store directory. Only their real paths and filesystem stamps
enter the digest; the fingerprint does not execute or parse those manifests.
The runtime installer remains responsible for installing/validating the pack.
Missing required identity paths make learning unavailable, not a new startup
failure. No file or persistent identity registry is created. The descriptor and
workflow protocol remain v1; changed fingerprints select a different measurement
generation under the provider's existing policy.

Setup and output callers attach the configuration fingerprint returned by the
same project-environment resolution used for execution. The project environment
owner excludes secrets and managed session resource values while retaining
effective application settings and logical binding declarations. The workflow
fingerprint combines that digest with the inspected operation; it never receives
raw configuration values. A failed configuration inspection makes the workflow
unlearnable with `configuration_identity_unavailable`, while ordinary accounting
and safe fallback remain available. No separate environment lookup is performed.

Setup and output owners re-inspect their source contracts after environment
preparation and after workflow admission returns, before executing commands.
Stale declarations use the ordinary retry/finalization paths rather than a new
queue, lock or stored snapshot. The provider still owns admission; it does not
read or interpret Genesis sections. See workspace preparation and managed
project outputs for their exact checks.

Missing optional estimates, dependency files or historical profiles do not
require an application migration. Unreadable, oversized or escaping dependency
identity and unavailable runtime identity make the run explicitly unlearnable;
the provider still receives the accounting request with generic fallback
available. Dependency reads are nonblocking and reject non-regular files, so a
named-pipe lockfile cannot stall admission while waiting for a writer. It stays
untouched, does not reuse an older cached fingerprint, and normal learning can
resume after the source is corrected. This does not bypass an actual
launch/runtime or ownership failure.

An output admission refusal preserves the provider's structured decision in
the ordinary error response. Preview diagnostics retain its correlation ID in
`<sessionRoot>/preview-last.json` and `preview-log.jsonl`; the package export
`@local/vibe64-terminals/server/previewDiagnosticFiles` names both files, so a
host that reports their size does not repeat the names. Failed workspace setup
stores only the optional UUID `resourceAdmissionId` in its existing
`<sessionRoot>/metadata/workspace_setup` record, so a reload can still identify
the decision. Successful preparation and non-failed states clear that ID;
malformed IDs are discarded. Older metadata needs no migration. The provider
remains responsible for explaining the decision and authorizing any retry;
Public does not interpret an override or weaken the normal launch lifecycle.

Output status can recover the ID from the last failed preview diagnostic when
it belongs to the same session and a still-declared target. A ready/starting or
running preview supersedes that historical refusal; malformed, foreign or
removed-target evidence is ignored. A known refusal suppresses automatic starts
until an explicit recovery action, including after a page reload. The optional
`VIBE64_RESOURCE_RECOVERY_KEY` injection supplies the host's decision control in
preview/preparation failure actions. Without it the ordinary standalone controls
remain available. An accepted host retry attaches its returned terminal or
refreshes current status on replay; it does not call Run a second time.
An original browser test can instead retain a bounded approval wait after
normal Preview restoration. The registered test-command owner, not this generic
recovery control, retains and resumes its live callback. Output status carries
that wait separately from the historical preview refusal so a ready normal app
does not hide the chat's approval controls. The host stores decision state in
the existing workflow record and authorizes only that request's next test start;
see the managed-project-outputs contract for cancellation and restoration.
The host's Recheck action carries a target ID and whether a stopped target may
be started. The preview surface reads current status first; running/starting
work is reused. A changed session/project or a failed status read cannot start
anything. If a fresh start is appropriate, it uses ordinary non-forced Run for
that still-declared target, never the toolbar's explicit forced-restart action.

Close callbacks precede execution finalization. A deferred finish records the
requested outcome and lets the provider finish the workflow after its last
execution has been archived and its group proven empty. This preserves final
peaks without declaring a still-running group complete. Resource estimates,
learned profiles, admission policy and user-visible recovery belong to the
provider, not these generic execution operations.
Terminal closure awaits these callbacks without an elapsed-time failure, so
provider queue contention keeps cleanup pending rather than falsely failed.


Workspace package-cache maintenance is an explicit finite command purpose. Its
host operation only admits an exact scratch child under the owning daemon's
private `cache-maintenance` directory, with no project source or arbitrary home
path substitution. It reuses ordinary runtime declarations, job accounting,
timeouts and process cleanup. The host schedules cache work and the package
manager retains its format and garbage-collection rules.
