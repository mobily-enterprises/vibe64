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
- `packages/vibe64-execution/src/server/engines/detached.js`
- `packages/vibe64-execution/src/server/engines/detachedReaper.js`
- `packages/vibe64-execution/src/server/engines/terminalSessions.js`
- `packages/vibe64-execution/src/host/execHelper.js`
- `packages/vibe64-execution/src/server/policy/cwdPolicy.js`
- `packages/vibe64-execution/src/server/runtime/runtimePacks.js`
- `packages/vibe64-terminals/src/server/resourceWorkflow.js`
- `packages/vibe64-terminals/src/server/projectExecutionEnv.js`
- `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `packages/vibe64-terminals/src/server/vibe64OutputTargets.js`
- `packages/vibe64-terminals/src/server/outputTargetTerminal.js`
- `packages/vibe64-terminals/src/server/previewDiagnosticFiles.js`
- `src/lib/vibe64ResourceRecovery.js`
- `src/composables/useVibe64OutputControls.js`
- `src/composables/useVibe64OutputControlsSurface.js`
- `src/components/studio/Vibe64OutputControls.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`

## Public contract

The existing runtime catalogue also maps Python, Ruby, Go, Java, Kotlin, C# and
Rust to explicit host packs. Kotlin receives Java tools, and Rust receives the
native linker toolchain. Interactive coding and terminals use these same pack
paths; declared operations prepend only their requested runtimes. On managed
hosts the installed runtime guards block undeclared tool names before mutable
host PATH entries. Standalone execution retains the developer's ordinary PATH
and installed tools without requiring hosted runtime installation. The host
owns installation, while the project owns build commands and dependency/source
resolution. Frameworks reuse those toolchains; database CLI selection does not
change resource lifecycle or apply migrations.

The runtime catalogue recognizes `awsebcli` and its `eb` command for declared
operations and interactive coding/terminal execution. Hosts own the actual CLI
installation and credential policy. Public execution supplies its normal project
environment and runtime paths; it neither stores separate EB credentials nor
installs the tool for standalone users.

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
listing running work need not fall back to a generic name. Account checks name
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
their own process-group leaders. Terminal commands, including Preview launches,
end with the kernel's hangup of their terminal instead; a program that ignores
SIGHUP outlives the server. Captured commands are not held. A saved service
execution ID this server does not hold therefore belongs to an earlier server
whose groups were already stopped. `stopVibe64RestoredService`, the default stop
of the Claude host and of the conversation execution facility, whose owners keep
only that ID, reports such a restored stop (`allowMissingRecordScopeRecovery`)
as an empty scope without claiming to have stopped anything.
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
not kept. Only the synchronous Codex runtime-context builder still reads while
its caller waits, through the same parser and with no memo.

The privileged command helper requires exact numeric target UID/GID values and
uses a fixed executable path and trusted environment search path while dropping
privilege. The requested command PATH takes effect only for the target user;
provider credentials and the private OpenCode home remain in their existing
environment. Loader and shell startup injection variables are excluded.
Allowed working directories and host service paths are checked after resolving
symlinks. A link inside an allowed directory cannot grant access outside that root.

The helper's `managed-service` operation serves the daemon's own long-running
services below the workspace service root. `install-start` writes the unit and
starts it without a boot target, so it runs only while used: its owner starts it
again through the same action, and a release service whose unit `Requires=` it
starts it at boot. `stop` stops and disables it and leaves its data in place.
It refuses, reporting `required` and the units, while a running, starting or
unreadable unit still requires the service, because systemd would stop that
unit with it. Release services keep their boot target.
`tests/server/vibe64ExecutionHelperSource.unit.test.js` covers both actions.

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
`register-person <workspace> <username>`, and the helper's own
`create-system-user` registers the account it creates. `enable-system-user` only
re-enables a registered person: the daemon can no longer make an existing
account a person, or add it to the shared group, merely by naming it. Every
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
rule, or an answer sudo never gives, refuses. An application account (`v64a_`)
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
drop-in can switch a unit's `NoNewPrivileges=` off. Host setup runs the root-only
`upgrade-person-registry <workspace>` once per workspace: it registers each
membership whose account is already in the shared group, except system and
administrator accounts, which it reports; a workspace that has a registry keeps
it.
`tests/server/vibe64ExecutionPersonRegistry.unit.test.js` covers the registry
and its refusals.

Each published project runs as its own application account, which the helper's
`application-account` operation makes and retires; the daemon names only the
project. The helper derives the account, `v64a_` and twelve hex digits of a hash
of the workspace and project, and its area, a folder per workspace and project
in root's system folder for applications, from the calling daemon. The account
is a system account with only its own group: no login, no home outside its
area, never in `vibe64` or `nix-users`. Root registers it in its own registry,
one root-owned file per account in a root-only folder for the workspace, apart
from the people's. A person
operation refuses any `v64a_` name, and an application is acted as only through
that registry, so neither ever stands in for the other. `ensure` makes the
account on first use and adopts an account an interrupted `ensure` left
unregistered only when it is exactly the account the helper makes. Through
directories it opened itself, never following a link, it makes the area: root's
directories down to the project's (`0711`), the daemon's `handover/` the
application's group may read (`2750`), and the application's own `app/` with
its `home/` and `database/` (`0700`), which the daemon may search for a database
by name but never list. An existing directory must still have the owner it was
given; nothing is repaired. `retire` refuses while anything runs as the
account, and removes the handover and application files. A production database
outlives its project, as other production databases do, so while `database/`
holds one the account, its registration and that directory stay; otherwise they
go too.

A managed execution runs as an application only when the daemon asks for its
registered account by name (`applicationAccount`), and only as a finite capture.
Any command may run there, from the application's own area (`app/` or
`database/`, its home by default), with a link it planted resolved before the
check. It runs as the account and its own group alone, with umask `0077`, the
runner under `setpriv --no-new-privs`, and a sandbox: no new privileges, a
private `/tmp` as its `TMPDIR`, the whole file system read-only except its area
and its receipt, no access to homes or to the host's settings folder (with
its people and applications), no other users' processes, no kernel
settings, set-user-ID files, namespaces or capabilities. Its receipt sits in
root's own runtime directory for the workspace's applications (`0711`), which
the account can traverse but not list, because it is in no group that reaches
the daemon's runtime directory. Inspect, stop and release-ended find receipts
in both. A release environment is accepted only for an application's command:
the daemon's file `handover/<release>/environment`, readable by the
application's group alone, for a command in that release's build or workspace.
`tests/server/vibe64ExecutionApplicationAccounts.unit.test.js` covers the
accounts, their area, their executions and their refusals.

Root never reads a release's environment file, and no unit makes systemd read
one on root's behalf. A release service's unit runs the helper as the service's
own user, which loads the file at every start, restarts included, and then
becomes the service's start script, so no extra process stays running. A
finite execution given a release environment has its runner load the file as
the application. The file keeps systemd's `EnvironmentFile=` syntax.

`deployment-service install-start` installs a release service only for an
application account root registered for the calling daemon's workspace. Its
workspace must be `app/releases/<release>/workspace` in that application's
area, and its environment file and start script the daemon's own
`handover/<release>/` files for that same release, which the application's
group may read (and run) but not change. The unit runs as the account and its
own group with umask `0077`, the helper under `setpriv --no-new-privs`, in the
same sandbox as the application's executions with its area as the only
writable place, a private `/tmp`, and one listening port: `SocketBindAllow=`
names its loopback port (1024–65535) and `SocketBindDeny=any` refuses every
other, so it can never take over another service's port while that service is
down. It still starts at boot and requires its managed databases.

`startVibe64Workflow()`, `setVibe64WorkflowPhase()` and
`finishVibe64Workflow()` delegate trusted server lifecycle requests to the same
installed managed-execution provider as commands. Standalone operation may
return no workflow; a required hosted provider or installed provider without
workflow support fails explicitly rather than bypassing accounting.

Finite capture requests accept an `AbortSignal`. The installed execution provider
owns hosted cancellation and descendant drain. Standalone capture uses its
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
