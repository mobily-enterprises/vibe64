# Account for a managed workflow

Related managed commands can share one accounting parent so the execution host
can measure their simultaneous memory use and retain a trustworthy final peak.

## Sources

- `packages/vibe64-execution/src/server/index.js`
- `packages/vibe64-execution/src/server/managedExecution.js`
- `packages/vibe64-execution/src/server/request.js`
- `packages/vibe64-execution/src/host/execHelper.js`
- `packages/vibe64-execution/src/server/runtime/runtimePacks.js`
- `packages/vibe64-terminals/src/server/resourceWorkflow.js`
- `packages/vibe64-terminals/src/server/projectExecutionEnv.js`
- `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `packages/vibe64-terminals/src/server/vibe64OutputTargets.js`
- `packages/vibe64-terminals/src/server/outputTargetTerminal.js`
- `src/lib/vibe64ResourceRecovery.js`
- `src/composables/useVibe64OutputControls.js`
- `src/composables/useVibe64OutputControlsSurface.js`
- `src/components/studio/Vibe64OutputControls.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`

## Public contract

`startVibe64Workflow()`, `setVibe64WorkflowPhase()` and
`finishVibe64Workflow()` delegate trusted server lifecycle requests to the same
installed managed-execution provider as commands. Standalone operation may
return no workflow; a required hosted provider or installed provider without
workflow support fails explicitly rather than bypassing accounting.

Execution metadata carries only a validated workflow UUID. It cannot select a
systemd unit, host path or resource policy. The execution provider verifies
project/session ownership and supplies the privileged helper with the UUID and
bounded project/session keys. The helper derives the workspace from the
authenticated daemon identity and creates nested project/session/workflow
accounting slices beneath that workspace's existing work slice. Child execution
limits and all ancestor limits still apply. No shared database or provider
service moves into these groups automatically.

The helper creates transient systemd slices with bounded memory/tasks and
readback verification. Creating the same active identity is idempotent only
when the requested limits match. It cannot exceed the actual workspace work
ceiling or reconfigure an existing workflow through the create operation.
Attaching a managed execution requires an active owned workflow and child limits
no larger than that parent. Ordinary commands without workflow identity retain
their existing execution path.

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
`/run/vibe64-workflows/<workspace>/<uuid>.json`, beneath `0700` directories,
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
`<sessionRoot>/preview-last.json` and `preview-log.jsonl`. Failed workspace setup
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
