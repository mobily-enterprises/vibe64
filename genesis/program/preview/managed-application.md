# Managed project outputs

People can run and inspect a project's web, terminal, and finite build outputs
without leaving the coding workspace.
Output status, start/open/stop, output terminal read/close and immutable-result
reads execute shared named terminal actions, with fresh project access and
actor context for HTTP and automation. Existing output services retain resource
admission, declared-target checks, launch serialization and lifecycle events.
Result download HTTP adapters preserve digest, media, filename and cache
headers, await byte delivery and close the opened handle. Project-runtime
open/close also uses named actions; terminal WebSockets remain transport adapters.

Colleague exposes output inspection, declared-target start/stop and output-terminal
read/close through those same actions. Inspection returns at most ten targets,
five recent runs and twenty result identities per run, with counts, continuation
offsets and explicit truncation. Reading an exact target returns its declared
parameter defaults and current selection. Ordinary UI reads retain full results.
The model receives bounded console output, never raw commands, source paths,
identity grants or download handles. Identity names describe available choices,
not the browser's active identity. Browser identity exchange and downloading
results still use the ordinary Preview controls.

Start can replace a running output, even without forcing restart. Colleague must
inspect current state before starting and must not repeat an uncertain start.
A start decided from a view names the run that view showed
(`replacesTerminalSessionId`, empty when it showed none); an automatic start that
names none saw none. When another run is starting or running by then, the view is
out of date: the start returns that run unchanged, as ensure does, and logs
`start_kept_running` in place of starting one. Only a start naming the running run
replaces it; agent ensure/restart and the restart after workspace setup name none
and keep their own rules. Tabs send it with every start, so a **Start preview**,
restart or automatic start pressed on an older status never ends a Preview that an
agent's ensure or another tab began meanwhile.

A restart (`restartPreview` or `forceRestart`) is satisfied by any run of what it
asks for (its target, and its parameters when it names them) that started after
it was asked for: `startTerminal` takes the request's id and time
(`requestId`, `requestedAt`) before the start waits for the launch queue, and a
start that then finds such a run returns it and logs `restart_satisfied`
(`keptRunReason` in `outputTargetLaunchRequests.js`, which also decides
`start_kept_running`). Two
restarts close together, or the restart after workspace setup and an agent's
`preview restart` asked for while it waited, give one new run; a restart asked
for after a run started still replaces it.

A restart never cuts a run's Prepare steps part way (a migration, a seed): a
target with Prepare steps prints a line once its last one succeeded
(`outputPrepareMarker`, `VIBE64_OUTPUT_PREPARE_DONE_V1`), which the run's output
watch records as `launchPrepareFinished`. A start that would replace a running
run still before that line waits for it outside the launch queue
(`waitForLaunchPrepare`, waiting for `prepare-step`), until the steps succeed or
fail, the run ends, a Stop or the session's close comes, or the wait passes
`PREPARE_WAIT_MS`. Prepare steps declare no time limit of their own, so that
bound is the five minutes a Preview start already has to become ready
(`WEB_LAUNCH_READINESS_TIMEOUT_SECONDS`), and past it the restart replaces the
run anyway: a restart always ends in a run or a clear failure, never parked. It
waits once per run, then starts again from its checks, and its run says so
(`waitedForPrepare`, and `prepareCut` when the steps were still running).
Meanwhile the outputs read says "Waiting for the database step to finish, then
Preview restarts." (`restart_waiting_for_prepare`), and so does
`vibe64-helper preview status` (`Preview note:`); `preview restart --wait` says
it waited, or that it cut the step. Stop stays immediate: Stop during the
Prepare steps marks the run `launchPrepareCut` and stops it at once, the stopped
Preview reads "Preview was stopped during its database step (Prepare), which
may be half done." (`prepare_cut`), and a restart waiting for those steps ends
`vibe64_preview_stopped`.

Each start records who asked (`requestedBy`: `http` or `assistant-tool` for the
start action, by its channel, `agent-preview-command`, `workspace-setup`,
`usage-recording` or `preview-test`) in its `launchRequest`: its id and time,
`automatic`, `forceRestart`, `restartPreview` and `replacesTerminalSessionId`,
with the runs it replaces (`replaced`: terminal, workflow, start time and
`prepareCut`). The request goes to the workflow it starts (`request`, which a
managed execution provider keeps in its workflow record) and its id to the
run's metadata (`launchRequestId`). Each run a start replaces is logged once at
warn level (`vibe64.preview.run_replaced`) and closes with the reason
`superseded:<the replacing start's id>`, which its close and stop hooks, its
workflow's finish (`reason`) and its `process_stopped` diagnostic
(`stopReason`) carry. The replacing start's workflow does not exist yet when
the run closes: a start closes the run it replaces before it is admitted, so
the admission sees that run's resources free.
An unchanged target, parameters and configured environment reuse the original
running terminal and resource workflow. The web spec supplies an allocation-free
environment fingerprint: generated loopback ports do not change that identity,
while runtime invocations retain their actual allocated URL and authentication.
Running and closing acknowledgements are not readiness or completed cleanup;
the model inspects the actual preview/terminal state. Stop retains the log;
Close waits for cleanup and removes the terminal and its log. Coding agents and
immutable download results remain separately owned.
A web target's port is its Stack's Preferred port, else the next free one above
it: the daemon checks it free and holds it until the run releases it
(`reserveAvailableWebLaunchTargetPort`, `launchTargetTerminal.js`), and the Run
command binds it later, in its own process. It is therefore never a port in the
host's ephemeral range (`/proc/sys/net/ipv4/ip_local_port_range` wherever it
exists, IANA's 49152-65535 off Linux; `ephemeralPortRange`, exported as
`@local/vibe64-terminals/server/ephemeralPortRange` for a host's own port
allocators), where an outgoing connection can take it in between and the run
then cannot listen, nor one the host profile's `claimedPorts` ranges give to the
host's own services, which their owner may bind after the check; a preferred
port inside either is passed over like a taken one. A run whose process exits with an error is
`failed`, and its message gives the exit code and the last error line its output
printed (`previewExitMessage`, `launchPreviewStatus.js`), as `The preview process
exited with code 1: listen EADDRINUSE: address already in use 127.0.0.1:4103.`

Project Close keeps shared-service admission blocked until those services drain.
If they drain but a different project cleanup controller fails, the project stays
open and restores shared-service admission so Preview is not stranded in a stale
closing state. A shared-service cleanup failure remains blocked for an explicit
Close retry because its owned executions may still be running.

The shared terminal surface lets people exit and re-enter mobile full screen
without stopping the output. This restores the underlying page navigation;
Close, Stop and collapsible task details retain their own existing behavior.

Managed test setup and suite executions declare Node, Playwright and Git so
repository fixtures use the managed Git pack. Browser workers establish the
current proxy cookie before exposing a token-free `preview.url` for navigation;
diagnostic redaction placeholders never become navigation credentials. A saved
page route cannot override the current launch's token during URL composition.
Preview Stop drains browser processes while retaining the live assistant's
command registration; session closure retires that registration. A subsequent
managed test can therefore run from the same assistant after Stop.
Ordinary managed suites enter the existing `withPreviewTarget` transaction before
startup and identity preparation. With no explicit target, that owner selects
the current or saved/default Preview using its ordinary launch plan. It restores
the prior state through the same drain, cancellation and recovery path as explicit
test targets. External URLs do not acquire this managed Preview transaction.

## Sources

- `src/lib/studioUrls.js`
- `tests/client/vibe64ProjectScope.vitest.js`
- `tests/server/vibe64TrainingVisualPlayer.browser.test.js`

- `packages/vibe64-genesis/src/server/projectServices.js`
- `packages/vibe64-terminals/src/server/projectServices.js`
- `tests/server/projectServices.unit.test.js`

- `packages/vibe64-core/src/server/launchPreviewProxyEnv.js`
- `packages/vibe64-terminals/src/server/Vibe64TerminalsFeature.js`
- `tests/server/vibe64TerminalsProvider.unit.test.js`
- `packages/current-app/src/server/currentAppActions.js`
- `packages/current-app/src/server/inputSchemas.js`
- `packages/current-app/src/server/registerRoutes.js`
- `packages/current-app/src/server/service.js`
- `packages/vibe64-terminals/src/server/terminalActions.js`
- `packages/vibe64-terminals/src/server/outputAssistantContracts.js`
- `packages/vibe64-terminals/src/server/inputSchemas.js`
- `packages/vibe64-terminals/src/server/registerRoutes.js`
- `packages/vibe64-terminals/src/server/terminalTransferRoutes.js`
- `tests/server/vibe64TerminalActionDispatch.unit.test.js`
- `tests/server/vibe64OutputActionTools.unit.test.js`
- `tests/server/vibe64OutputTools.integration.test.js`
- `packages/vibe64-genesis/src/server/outputs.js`
- `packages/vibe64-genesis/src/shared/resourceKinds.js`
- Main: `packages/vibe64-terminals/src/server/vibe64OutputTargets.js`
- `packages/vibe64-terminals/src/server/outputTargetTerminal.js`
- `packages/vibe64-terminals/src/server/outputTargetTerminalState.js`
- `packages/vibe64-terminals/src/server/outputTargetLaunchCoordination.js`
- `packages/vibe64-terminals/src/server/outputTargetLaunchStart.js`
- `packages/vibe64-terminals/src/server/outputTargetLaunchRequests.js`
- `packages/vibe64-terminals/src/server/outputTargetPreviewTests.js`
- `packages/vibe64-terminals/src/server/browserTestWorkers.js`
- `packages/vibe64-terminals/src/server/outputTargetLaunchStatus.js`
- `packages/vibe64-terminals/src/server/outputTargetTerminalSessions.js`
- `packages/vibe64-terminals/src/server/outputTargetLaunchContext.js`
- `packages/vibe64-terminals/src/server/outputTargetLaunchTerminals.js`
- `packages/vibe64-terminals/src/server/launchPreviewDiagnostics.js`
- `packages/vibe64-terminals/src/server/outputTargetMetadata.js`
- `packages/vibe64-terminals/src/server/launchPreviewStatus.js`
- `packages/vibe64-terminals/src/server/launchPreviewReadiness.js`
- `packages/vibe64-terminals/src/server/launchRestart.js`
- `packages/vibe64-terminals/src/server/previewPublicOrigin.js`
- `packages/vibe64-terminals/src/server/launchPreviewAuth.js`
- `packages/vibe64-terminals/src/server/launchTargetTerminal.js`
- `packages/vibe64-terminals/src/server/resourceWorkflow.js`
- `packages/vibe64-terminals/src/server/agentPreviewCommand.js`
- `packages/vibe64-terminals/src/server/serviceCommandServices.js`
- `packages/vibe64-terminals/src/server/agentPreviewCommandLine.js`
- `packages/vibe64-terminals/src/server/agentPreviewWorkerRegistry.js`
- `packages/vibe64-terminals/src/server/agentPreviewBrowserTests.js`
- `packages/vibe64-terminals/src/server/agentPreviewBrowserWorker.js`
- `packages/vibe64-terminals/src/server/agentPreviewBrowserProcessGroups.js`
- `packages/vibe64-terminals/src/server/agentPreviewStatusText.js`
- `packages/vibe64-terminals/src/server/browserTestCleanup.js`
- `packages/vibe64-execution/src/server/runtime/agentPlaywrightCommandSource.js`
- `packages/vibe64-execution/src/server/runtime/agentPreviewWrapperSource.js`
- `packages/vibe64-execution/src/server/runtime/agentPreviewBrowserWorkerSource.js`
- `tests/server/agentPreviewCommand.unit.test.js`
- `tests/server/agentPreviewBrowserProcessGroups.unit.test.js`
- `tests/server/agentPreviewOpenCommand.unit.test.js`
- `tests/server/previewPreparation.integration.test.js`
- `tests/server/previewRestartPrepare.integration.test.js`
- `tests/server/turnEndPreviewRestore.unit.test.js`
- `tests/server/previewTestTarget.integration.test.js`
- `tests/client/vibe64OutputControls.vitest.js`
- `tests/client/vibe64OutputControlsSurface.vitest.js`
- `tests/server/launchPreviewCrossSiteCookies.unit.test.js`
- `tests/server/launchPreviewHeldSessions.unit.test.js`
- `tests/server/previewCrossSiteFrame.browser.test.js`
- `tests/client/vibe64PreviewOpenRequest.vitest.js`
- `packages/vibe64-core/src/server/sessionUiSyncState.js`
- `packages/vibe64-genesis/src/server/promptContext.js`
- `packages/vibe64-terminals/src/server/serviceSessionTerminals.js`
- `packages/vibe64-terminals/src/server/serviceProjectRuntime.js`
- `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `packages/vibe64-terminals/src/server/workspaceSetupStart.js`
- `packages/vibe64-terminals/src/server/workspaceSetupStatus.js`
- `packages/vibe64-terminals/src/server/outputResults.js`
- `packages/vibe64-terminals/src/server/launchPreviewProxy.js`
- `packages/vibe64-terminals/src/server/launchPreviewForwarding.js`
- `packages/vibe64-terminals/src/server/launchPreviewFrameLoads.js`
- `packages/vibe64-terminals/src/server/launchPreviewHeaders.js`
- `packages/vibe64-core/src/server/cookieDomainGuard.js`
- `packages/vibe64-terminals/src/server/launchPreviewIdentity.js`
- `packages/vibe64-terminals/src/server/launchPreviewAccess.js`
- `packages/vibe64-terminals/src/server/launchPreviewHeldCookies.js`
- `packages/vibe64-terminals/src/server/launchPreviewWindow.js`
- `packages/vibe64-terminals/src/server/launchPreviewListening.js`
- `packages/vibe64-terminals/src/server/launchPreviewConnections.js`
- `packages/vibe64-terminals/src/server/launchPreviewBridge.js`
- `packages/vibe64-terminals/src/server/launchPreviewBridgeScript.txt`
- `packages/vibe64-terminals/src/server/previewLocator.js`
- `src/components/studio/Vibe64LongRunningTerminal.vue`
- `src/components/studio/Vibe64OutputControls.vue`
- `src/components/studio/Vibe64OutputToolbar.vue`
- `src/components/studio/Vibe64PreviewAddressBar.vue`
- `src/components/studio/Vibe64PreviewIdentityMenu.vue`
- `src/components/studio/Vibe64OutputResultsMenu.vue`
- `src/components/studio/Vibe64PreviewIssueMenu.vue`
- `src/components/studio/Vibe64PreviewStatus.vue`
- `src/components/studio/Vibe64OutputOptionsDialog.vue`
- `src/components/studio/Vibe64PreviewRouteDialog.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotProjectPanel.vue`
- `src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue`
- `src/composables/useVibe64AppPage.js`
- `src/composables/useVibe64OutputControls.js`
- `src/composables/useVibe64OutputStatus.js`
- `src/composables/useVibe64OutputTerminal.js`
- `src/composables/useVibe64OutputPreview.js`
- `src/composables/useVibe64OutputLaunch.js`
- `src/composables/useVibe64OutputAutoStart.js`
- `src/lib/vibe64LaunchStatus.js`
- `src/lib/vibe64LaunchAutoStart.js`
- `src/lib/vibe64LaunchPreview.js`
- `src/lib/vibe64LaunchPreviewDestination.js`
- `src/lib/vibe64LaunchBrowserWindow.js`
- `src/lib/vibe64LaunchPreviewToolbar.js`
- `src/composables/useVibe64OutputControlsSurface.js`
- `src/composables/useVibe64PreviewTargets.js`
- `src/composables/useVibe64OutputOptions.js`
- `src/composables/useVibe64PreviewRecovery.js`
- `src/composables/useVibe64PreviewToolbar.js`
- `src/composables/useVibe64PreviewFrame.js`
- `src/composables/useVibe64PreviewIdentity.js`
- `src/composables/useVibe64PreviewReload.js`
- `src/composables/useVibe64PreviewAddress.js`
- `src/composables/useVibe64PreviewPick.js`
- `src/composables/useVibe64PreviewMessages.js`
- `src/composables/useVibe64PreviewOpenRequests.js`
- `src/composables/useVibe64PreviewAttachments.js`
- `src/composables/useVibe64PreviewPresentation.js`
- `src/lib/vibe64PreviewAddress.js`
- `src/lib/vibe64PreviewFrame.js`
- `src/lib/vibe64PreviewIdentity.js`
- `src/lib/vibe64PreviewPick.js`
- `src/lib/vibe64PreviewStatusText.js`
- `src/composables/useVibe64LearningOrientation.js`

## Public contract

Embedded Preview remains interactive during edits, goals and interruptions.
The existing toolbar Stop persists a per-session stopped intent through session
metadata. The output owner serializes Stop and Start, waits for owned process,
proxy and managed browser cleanup, and refuses incidental automatic startup while
stopped. Explicit Start clears the choice after launch; a scoped browser test
temporarily runs its target and restores the saved stopped state. Stopping does
not close the coding session, agent, source or shared project services.
When a stopped session has no retained terminal, status inspection preserves its
saved target and parameters rather than treating the missing process as a crash.
A small **Work in progress** bar reports editing without hiding or replacing
the frame. A recoverable failed or stale web output queues one existing output
recovery attempt after editing/source operations settle, showing **Server will
be restarted soon** while queued or running. Successful readiness or a new
editing turn permits another attempt; failure retains ordinary diagnostics and
manual recovery rather than a retry loop. The mounted surface owns the notice
and invokes the existing admitted output commands; it adds no technology-specific
preparation, execution, resource or database owner. Resource admissions and test
approvals, as well as managed browser-test notices, exclude automatic recovery so
their original lifecycle retains control. Before recovery the same output owner
refreshes status and rechecks the current project/session, health, load errors,
editing, source operations and admission holds. A preview already started by the
person's retry is retained rather than force-restarted from stale browser state.
That recovery is an automatic start naming the run it read, so a run begun after
that read is returned rather than replaced.

Output targets may declare `Data: test` or `Data: development` in the Vibe64-owned
Outputs grammar. This optional field reaches target views unchanged. Test-data
targets show a persistent amber banner in embedded Preview; their app launchers
own database isolation. The existing serialized temporary-Preview run publishes
its state through launch status and realtime refresh. Its changes, like Preview
readiness, cleanup and Stop, name the session's project, so they reach the
session's pages even when a terminal event or cleanup runs outside any request. Startup/running,
restoration, and retained cleanup/restoration failures remain visible until the
original owner releases the run. Failures show a red recovery banner even when
the saved target is development. Status is transient and adds no persisted state.

Successful Workspace setup is reusable only when its current recipe matches and
the host still confirms the exact resources prepared. Adding resources therefore
re-enters the existing preparation workflow even when install argv are unchanged.
Failed setup retains explicit retry. Post-turn preparation waits on the existing
source-write lock while the completed agent turn drains; it does not acquire a
second lock or run underneath active source work.

`vibe64-helper playwright readiness` reuses the test wrapper's installed-package
and exact managed-runtime selection without executing tests or launching Preview.
Its result distinguishes not-configured, dependencies-not-prepared,
unsupported-runtime and ready; active suite status remains a separate operation.
Every session on a host shares that host's single current browser runtime, and
readiness reports its version as `platformVersion`. An unsupported-runtime error
identifies tests as not started and directs the agent to pin the project's
`@playwright/test` exactly to that version, rather than asking the operator for
another runtime, while retaining the interactive browser entry point.

Managed-session instructions forbid starting Playwright directly (`npx
playwright`, `playwright test`, or a package script that runs it, such as a
repository's own `test:e2e`), even when the repository's own instructions say
to: the agent runs the same suite and arguments through `vibe64-helper
playwright test` or `npm-run`, and runs the project's own Playwright only when
that command reports no managed browser runtime on the computer.
Managed-session instructions and command help require browser suites and live
Preview browser actions to run sequentially. The coding agent waits on the
original suite through cleanup, confirms no active managed run, then performs
live inspection; its `preview ensure` first restores a Preview a test target
still holds. Read-only status
and logs remain available while tests run. This guidance uses the existing test
owner and recovery guard; it adds no execution or locking mechanism.
For background commands, instructions and help prefer an existing execution
wait of about 30 seconds where supported, explicitly `yield_time_ms: 30000`
for empty command polls. Shorter waits serve interactive input or a specific
immediate check. Status and failure excerpts are read
for new output, changed state or a concrete blocker, avoiding repeated reads of
empty or unchanged logs between brief waits.

The original Studio URL classifier keeps `/api/vibe64/training` and its slash
descendants global on selected-project pages. The visual-resource route
selects the fresh authenticated learner's exact active attempt and installed pin;
project URL scoping does not apply to that actor-owned read. The original resolver
and HTTP client retain their existing project routing for session/output work.
This changes no resource envelope, player, permission or learning-state owner.

The embedded Preview frame delegates microphone and autoplay to its application
origin, alongside clipboard writing. Secure-context requirements and the browser's
microphone permission still apply. This supports ordinary audio applications
without granting devices automatically or disabling origin isolation.

The `vibe64.current-app.read` action inspects declared outputs in the currently
authorized project or selected session. It resolves fresh actor/project context
for both HTTP and direct calls; discovery never falls back to a different project.

Vibe64 lists only targets in the strict Markdown `vibe64.outputs.v1` contract
transported as an opaque Stack section by Genesis. Each target declares exact
Prepare, Build, and Run argv, a working directory and runtime requirements,
plus either an interactive presentation or finite downloadable results. Vibe64
never guesses a framework command or substitutes an unknown runtime. After
bounded output discovery proves that a project declares no target, Preview
states that there is no application output and presents no empty launch
menu. The embedded browser toolbar remains visible; URL navigation requires a
known preview destination, while Reload can recheck output status without one.
A blocked Outputs declaration with no targets reports its actionable
inspection diagnostic instead of claiming that the project has no output.
Declared targets blocked by missing resources remain visible but disabled.
Outputs run in development, so only the resources development needs block them:
`vibe64OutputsInspection` drops Genesis's `STACK_RESOURCE_MISSING` for a declared
resource that `resourceRequiredInDevelopment` says development does without (a
bucket, matched by its id among the Stack's resources, which Genesis keeps
unique), and the application then uses its own default storage. A missing
database, Redis or any other resource still disables every target, its reason
naming that resource alone, and every other environment diagnostic is kept as
before. The current-app inspection and the editor's Preview text read the same
targets, so they follow it.
Targets may declare up to sixteen named text parameters with labels, defaults,
descriptions, and required flags. Prepare, Build, and Run arguments reference
these values with `{parameter:id}`; the executable stays fixed. Vibe64 rejects
undeclared, unknown, missing required, multiline, or oversized values before
replacing a running target. Substitution happens once, then each argv value is
shell-quoted independently. Parameter values join resource configuration identity
and terminal reuse checks. Restart and temporary browser-test restoration retain
the selected values; a different target receives its own defaults.

Preview options appears only for targets that declare fields. The Run menu opens
the same form for parameterized terminal and finite targets. Editing and Cancel
do not launch anything. Explicit Run or Save and restart submits the selected
values; Use defaults restores declared defaults in the form. Required errors stay
beside their fields. Remember for this project stores values in this browser,
scoped to project and target for future sessions; existing sessions retain their
own selection. These are ordinary visible arguments, not secret storage.

Working directories resolve relative to the session source. An ordinary name
such as `..build` is valid; a path resolving outside that source is rejected.

Agents discover declared targets through `vibe64-helper preview targets --json`.
`vibe64-helper preview open <path> [--json]` moves the person's open Preview
panes to a page of the running app. Only a path inside the app is sent
(`previewAppPathError` in the shared Preview protocol: one leading `/`, no scheme,
`//`, backslash, whitespace or control character, no `/__vibe64` page and no
Preview token), and only while the Preview is ready. The command publishes a
presentation-only `preview-open-requested` session change to the session's
viewers; each embedded Preview (`useVibe64PreviewOpenRequests.js`) opens the
path through the address bar's own navigation, so token, history and frame
request match a typed address and the frame never lands on the editor's site.
It shows **The AI opened <path>** above the Preview for ten seconds and answers
through its ordinary Preview-state post with the request id. The session UI sync
state collects answers for up to four seconds, or 750 ms after the first, and the
command reports `moved: N`, or `moved: 0` with why, so the agent can give the
path instead.
`vibe64-helper playwright --help` prints usage before inspecting project packages
or managed runtimes, without starting Preview or a browser. Actual suite execution
still requires an installed project Playwright and its matching managed runtime;
help availability is not runtime readiness.

Browser-owning Node suites can declare `test:playwright:<name>` npm scripts and
use the same admitted browser execution. Preview command preparation resolves
both sockets from its supplied environment, retaining those exact paths across
the listener, browser worker and command wrappers. Fixture source paths can
therefore remain separate from the short private socket directory.
`vibe64-helper playwright --target <id> test ...` and `npm-run <script>` temporarily
select an available web target through the same output controller. Each such
target is a test server the project's Stack declares, started by the project's
own Run command with its own disposable data: the agent's instructions and
`vibe64-helper playwright --help` say so, and that `PLAYWRIGHT_BASE_URL` points
the specs at it, so an agent does not mistake it for a bypass of the project's
harness; specs create their data in fixtures, and tests that write never use the
person's development target. The server
holds the session's target selection while the existing managed runner obtains
its URL and native application identity and executes the suite. Before the
command ends it stops the test Preview when there was no running target, and
keeps the target it tested when that was the running one. A previously running
other target is not started again then: restarting the person's app after
every run, only for the agent's next run to stop it, cost each repeated run that
app's whole start. The command returns once its tests and cleanup end, and the
run waits as `restore_pending` (`outputTargetPreviewTests.js`), its test target
still serving, until the agent's turn ends (the turn publication's
`restorePreviewAfterTurn`), which starts the previous target again with its
parameters, or until a request starts, restarts, stops or closes Preview,
which puts the person's saved target back and then does what it asked. A start
or Restart that names no target starts the person's own over the still-running
test target, with its parameters, as the run's restore (`startOverTestTarget`;
a record with no process and no Stop reads as stale and is cleared, so the test
target is not stopped first). The run owns Preview, as `restoring`, until that
start ends: a refused start (capacity, say) leaves the restore waiting as
`restore_failed`, and a start that kept the test target running (a page whose
view of the run was out of date) leaves it `restore_pending`, so the test
target never runs without its run. Stop and closing the terminal take the
Preview back first (`handPreviewBack`): Stop marks Preview stopped, closes the
test target and keeps the person's target for the next Start; a Stop that meets
a start taking the Preview back ends that restore and answers at once, as it
does for any start. Closing the terminal while a restore waits drops the
person's saved target with the record, as closing any Preview does. A request
that finds nothing waiting takes no lock. A waiting restore is also written in
the session's record (`output_target_preview_restore`: the test target it waits
over and the person's saved target), so a server restart cannot leave the test
target as the person's Preview: the after-restart recovery that clears a record
with no process (`launchPreviewStatus.js`) puts the person's saved target back
instead, when the record names that test target, and the first status read or
start after the restart starts the person's target with its parameters. A run
still testing when a turn ends restores as it finishes. The next test run takes
a waiting run's restore over and starts its own target afresh
(`restartPreview`), never reusing the last run's server and data. Failures and
cancellation use the same cleanup, and a cleanup failure still keeps the
command waiting and makes it fail; a later restore that fails shows as
`restore_failed`, and the next turn's end, start or restart tries it again. One
command owns the entire suite: several tests share one startup.

A test target whose Run step takes `{workers}` (only a web target with
``- Data: `test` `` may, `outputs.js`) serves a run several app servers, one per
Playwright worker, worker *i* on `{port}`+*i* with its own copy of the test
database (`vibe64OutputTargets.js`, `launchTargetTerminal.js`). The run's count
is decided once, under the session's launch lock, from the machine's test budget
(JSKIT's `testConcurrency()`): half of it, or the run's `--workers` capped at
it, never more than 80% of the free memory fits at the target's Running high
estimate plus a Chromium per worker, at least one and at most 64
(`browserTestWorkers.js`). The free memory is the managed host's own
(`availableMemoryBytes()` of its execution provider), and a host that cannot
tell gets one; without a provider it is this process's. The launch reserves
that many consecutive ports, waits for every server's readiness, and records
them as the terminal's `testWorkers`, the one record of the count: a start
asking another count does not reuse it. Each worker signs in on its own server:
the identity grant names worker *i* (`previewAuth.js`), the Preview refuses one
it does not serve, and the identity command gets that server's URL. The
wrapper makes every worker's state at once in the run's own directory, which
the daemon makes for each run with a target and removes when it ends however
it ended, and hands the suite `PLAYWRIGHT_WORKER_TARGETS` (each worker's
`baseURL` and `storageState`), which the daemon accepts only from a run's own
suite and only with states in that directory. The suite's execution and the
target's workflow declare their `workers`, so a host admits them as that many.
A run with several servers restores the previous Preview as it ends, as a
refused or cancelled run does, instead of waiting as `restore_pending`: its
target holds a server and a database copy per worker. A run with one is
unchanged.
`vibe64-helper playwright status` reads the current run ID, target, phase, start
time and elapsed time. `cancel <run-id>` cancels only that run and waits for
cleanup. A stale ID cannot cancel a replacement run. Concurrent cancellation
requests join the same operation.
Disconnection aborts running finite commands through their execution owner.
Restoration waits for the scoped wrapper and its registered nested test commands
to finish draining. Failed drains retain their exact execution IDs and Preview
ownership; explicit cancellation retries only unproven drains. Restoration failure
also retains the run for explicit retry. Reads do not launch work, and there is
no new timer, periodic recovery, automatic test rerun or per-test target switch.
Shared agent instructions require focused batches with full stdout/stderr saved
to local artifacts. Callers report counts, timings, exit status and relevant
failure excerpts, expanding those artifacts only when needed. Startup, resource
and restoration errors remain part of the result even when test assertions pass.
The scoped runner reads the target's ready status rather than repeating startup
after the target owner has already awaited readiness. Playwright authentication
uses an isolated request context: it obtains the host's Preview cookie and runs
the declared identity exchange without rendering extra application pages or
launching another Chromium process. The test runner receives that temporary
cookie state moved to the tested address, each cookie as the tested address's
own (an HTTPS Preview's partition key does not move with it); interactive browser
identities remain separate. The state belongs to the host, and the project's Playwright config hands
it to `use.storageState` unchanged. Before preparing it, the runner refuses the
suite when a root `playwright*.config.*` file names `PLAYWRIGHT_STORAGE_STATE`
and, ignoring comments, mentions `cookies` or `origins` or passes the variable (or
one assigned from it) to a file read. Its message names the file and reason, says
the state belongs to the host, and tells the agent to report signed-out tests with
the unchanged state as a host defect instead of patching around it; the shared
agent instructions carry the same rule.
The scoped result retains structured provider refusal details even after
restoring the normal Preview, including when restoration also fails. An
explicit retry uses the original test launcher and its isolation/restoration
lifecycle, never an ordinary development start of the refused target.
The existing command stream carries the provider's admission object and the
wrapper prints it with the original error, so the assistant receives the
decision ID, memory figures and allowed actions instead of a generic readiness
failure. It does not independently calculate or override host policy.
Progress output never suppresses the final failure message: approval, startup,
execution and restoration errors remain visible on stderr after streamed output.
For a resource refusal that offers a fresh recheck, the registered command owner retains
one live request per session after successful normal-target restoration and
release of the Preview lock. The host opens a five-minute retry window in
that rejected workflow's existing record; no test reservation is held. The
Public slot stores the original command callback only in memory. Output status
projects its admission ID, waiting/resuming state and expiry through the
existing session-change stream. Chat shows Waiting for resources and the
host recovery control without covering the normal Preview.

The host's owner-only action acknowledges a handoff to `resumeTestApproval`,
not test success. The original command revalidates its registered generation,
source path and exact npm script, then reacquires scoped Preview ownership.
Host authorization wraps only the test-target start, never restoration; the
host rechecks the live assistant parent, configuration and current capacity.
Duplicate handoffs join that request. Running tests use their ordinary progress
and result stream; completion clears the slot. Cancel and expiry report tests
not run. Actual command disconnection, session close, control release or
generation replacement interrupt the original request, including during the
approval handoff. Closing a dialog, reloading or losing the dashboard WebSocket
does not cancel it. A missing live slot cannot be replayed from a stored record.

Closing the session suppresses restoration. Host-service termination cannot
execute an in-process cleanup; after a platform restart inspect Preview and
explicitly select the normal target before resuming work.

The scoped runner uses existing finite execution ownership, including the
assistant parent and descendant cancellation. Other sessions remain independent.
Target starts, restarts and individual stops are refused while the test owns
Preview; status and reads remain available. An ordinary ensure can reuse that
exact running test target but cannot restart its fixtures during the suite.
`vibe64-helper preview ensure --target <id> --wait --json` is deliberate persistent
selection and does not arrange automatic restoration.
An agent's ensure or restart announces `output-target-started` to the session's
open tabs, as a start from the editor does, so none keeps showing the state
before it. Its `--wait` (and the wait after a check's workspace preparation) waits
for the run the start returned and follows a newer run of the same target that
replaced it, to readiness; it fails at once, without waiting out its timeout, when
that run exited or went with nothing of its target in its place (Stop, another
target, no run).

Target selection does not change managed environment values or certify data
safety. Application-owned scripts must select the designated disposable data,
prepare fixtures before readiness, suppress external effects, and verify the
actual server's test identity before destructive tests. A test target's preview
identity command must select the same data. The `browser-tests` spec
(`vibe64-helper spec browser-tests`, which the provider-neutral session guidance
names before any browser suite) explains these requirements, the commands, and
the project work needed when a test target is absent. See `docs/managed-browser-tests.md` for the portable setup.
A test target serves the application's production build, never a development
server: built once per tree and reused while a digest of its sources is
unchanged, one app server per worker, so a suite tests the code Staging and
Production run; both specs say so (the outputs spec's Data rule, with JSKIT's
`jskit browser-test-server` as its example, and the browser-tests spec), and
the Outputs grammar accepts any Run step. Routine test launchers retain the
isolated schema, apply pending migrations and reset fixture data. Fresh-schema
proofs are separate from ordinary browser checks. The same spec asks agents to
batch related cases and measure slow startup before retrying. The web readiness probe allows five minutes;
the managed waiter has another thirty seconds to observe its final status and
cleanup instead of racing the probe's deadline. The probe stops when its launch
process exits, including when that process exits before the probe starts.
The launch then ends with the launch's own exit status, or the probe's when the
probe failed: the launch runs in a login shell, whose `exit` reads
`~/.bash_logout`, so the wrapper turns errexit off before each exit and a
command failing there (Ubuntu's `clear_console`, without a console) does not
replace the status (`commandWithHttpReadiness` in `launchTargetTerminal.js`,
`tests/server/outputTargetTerminal.unit.test.js`).
Host resource diagnostics also reach the browser command caller after a failed
test. Shared guidance retains task-denial evidence and its incident ID, and asks
for an operator capacity review before retrying or changing test timeouts.

While the session reports workspace setup running, browser output reads and
starts wait on that existing state rather than inspecting partially installed
dependencies. The Preview pane points to preparation progress; setup completion
refreshes outputs through the existing source-operation resume path. Setup
failures remain visible, and errors from the fresh output read are not treated
as successful preparation or hidden by package-specific exception rules.

When setup runs again under a running web Preview and succeeds, the Preview
restarts by itself through the ordinary restart, as
[workspace preparation](../execution/workspace-setup.md) describes. The restart
waits in the launch queue and applies only to a process that started before setup
finished, so a Preview that the same setup prepared is not restarted twice, and a
stopped Preview stays stopped.

Starting a target waits for the separately owned workspace-setup recipe, then
runs every step through the managed execution gateway. Web targets use the
preview resource profile, finite targets use the bounded job profile, and
interactive terminal targets use the terminal profile. Web presentation owns
port allocation, readiness and the managed proxy. Its terminal includes the
pinned Node runtime for Vibe64's readiness probes even when the application's
declared runtime is PHP or another language. A proxied web target publishes
its ingress socket as soon as readiness is confirmed, independently of client
status polling. Later status inspection verifies the bound socket identity and
republishes a missing or replaced socket. Finite runs snapshot only their
declared regular files into bounded immutable result storage and expose
downloads by generated result identity rather than a caller-supplied path.
A session keeps its newest twenty runs within 2 GB in total (the newest run is
always kept); each new snapshot removes older runs and their files.

New output runs describe one managed accounting workflow to the execution
provider; ready interactive outputs transition from startup to running.
Terminal completion reports success, failure or deliberate stop, with deferred
group finalization after execution cleanup. Already-running Preview reuse
creates no new group. Optional resource estimates come from the same Outputs
inspection; older projects without that section retain generic fallback.
Closing waits for process exit, verified process-group drain and both cleanup
hooks without a wall-clock completion deadline. Pending hooks keep the terminal
closing and retain its launch slot; concurrent Close requests join the same
operation. Stop begins process termination independently of the hooks and uses
the existing TERM/KILL escalation and scope checks. Natural process exit also
remains closing until cleanup settles. Session-change publication after launch
metadata cleanup runs independently, with publication errors logged.
Scoped test targets and the restored normal target have separate accounting
environments, without changing the application's own data configuration.

The private launch spec retains its inspected Stack identity independently of
optional estimates. A new terminal re-inspects Outputs after environment and
old-terminal cleanup, before requesting admission, and once more after admission
returns. A changed Stack fails with a direct Retry message instead of running a
stale command or attaching its estimates to a renamed target with the same label.
The ordinary failure path releases any unused workflow and port reservation.
Reusing a running Preview performs no new workflow admission or extra launch
checks. These checks add no file watcher, background polling or stored identity.

Preview startup uses its own launch queue and terminal-namespace admission. It
does not acquire assistant-write admission for an already prepared workspace.
The setup owner checks the current recipe against its successful result; the
environment owner checks existing resource readiness, generated dotenv contents,
and local Git excludes. A changed setup runs under assistant-write admission
until its command completes. Environment preparation and Git alternates repair
also recheck under that lock before writing. A rejected preparation stops launch.
Namespace admission prevents renewal from freezing a launch midway through it.
A start never holds the launch queue while a workspace preparation runs
(`readPreparedLaunchContext` answers `{ preparing }`): it waits for that
preparation outside it, so the outputs read, Open, the identity switch, Stop
and the session's close answer meanwhile. The wait keeps a count in the
namespace's admission (`beginTerminalNamespaceOperation`, taken while the
launch still holds one), so a renewal's freeze is refused as
`terminal_admission_busy` until the preparation ends. It then
takes the queue again and reruns its checks without asking for another
preparation. A Stop or the session's close while it waited
(`interruptLaunches`) ends it unstarted (`vibe64_preview_stopped`,
`vibe64_session_closing`).
A start's other steps still run inside the queue (the preparation check, which
can wait for the assistant's write, the project's services, the resource
admission and the spawn), so while a start is queued for or holds it
(`withStartLock`, `launchStartBusy`) the outputs read, Open and the identity
switch answer from what is known without the queue: the latest run, if any,
as starting ("Preparing preview."), with no readiness repair. Stop then records
the stopped choice and answers `{ ok: true, stopping: true }` at once; the
start ends unstarted at its next step (`throwIfLaunchInterrupted`, after the
preparation check, after the services and before the spawn), and Stop's
cleanup runs once the start lets the queue go.
A start the page names (`startId`, `src/lib/vibe64LaunchStart.js`) runs as
held work (`@local/vibe64-core/server/heldWork`, in `outputTargetTerminal.js`):
it answers with its run when that comes within two seconds, and otherwise
`{ ok: true, starting: true, startId, waitingFor }` (`launch-queue`,
`workspace-preparation`, `prepare-step` or `starting`). A repeat of it joins it, or reads its
outcome once it ended, and never starts it again. The outputs read reports the
session's latest five such starts as `launchStarts` (`starting` with
`waitingFor`, `started` with `terminalSessionId`, or `failed` with the refusal's
words, code and admission), each for 15 minutes after it ends, and its end
publishes `output-target-start-settled`. The page follows its start through
those reads, as it does a start whose answer was lost (status 0, or a 5xx
without a code): **Starting preview: <target>.** with what it waits for in
words, then its run or its refusal; a start the editor no longer knows reads
"Vibe64 restarted while Preview was starting. Start it again." A start without
a `startId` (the assistant's tool, the editor's own) waits for its run as
before.
A failed outputs read is shown in words (`launchStatusErrorText`), never with
a status code, an error code or a route: "Vibe64 did not answer while Preview
read its status." for status 0 or a 5xx without the server's code, the
server's own words for a refusal, and otherwise "Preview's status could not be
read."

Status inspection resolves the environment without provisioning resources or
writing project environment files. Confirmed preview readiness supersedes a
failed overlapping start request, so a running preview is not covered by an old
startup error. Late start failures from a previous project or session are ignored.
When automatic startup receives the exact agent-write or saved-practice
preparation-busy admission refusal, Preview shows the existing waiting message
and retries through its existing cooldown. Neither refusal admits a start. The
preparation lock and fresh practice authority remain unchanged; generic 409 or
startup errors do not enable automatic retry. The cooldown survives a reload. Other startup failures appear once in Preview and require an
explicit retry; startup errors are not also repeated as global toasts.

The broad Genesis opening inspection is not launch admission. Existing-project
setup diagnostics, including stale Program source citations, and inspection
request failures appear in a persistent compact warning above the preview.
Warning foreground and container colors come from the app's light/dark theme
palette. Setup actions retain readable labels when disabled during assistant work.
They do not unmount a running iframe or its toolbar. Recheck setup refreshes
only that inspection, works during assistant activity, and removes the warning
when resolved. Reload remains the separate browser/output-status action.
Choosing Preview (its tab, or Go to preview on a phone) also reads the inspection
again, so the warning shows the current setup each time: the page's
`selectProjectPane` invalidates every session's `vibe64ProjectSetupQueryKey`
read in the project. A Preview hidden under the Dashboard reads it once as it
shows; a Preview that never left, because the click replaced a Dashboard
navigation still loading its code, reads it at once. Reloading the preview
reads no setup.
Starter selection and adoption still guide new or uninitialized projects;
Vibe64's output and workspace-setup contracts continue to validate actual launches.

Status inspection never starts work. Logs, retry, stop, open, fresh restart,
result history, and authenticated downloads remain available through the
session-owned output controller and studio controls.
Preview diagnostics write only within the existing session directory. The session
lifecycle owns its creation; late diagnostic writes cannot recreate it after
removal and use the existing warning log if writing fails.
An active assistant turn delays automatic startup, not status inspection or an
explicit restart. Both restart controls send the forced-start command for
running and exited targets. Session renewal still suspends source operations;
launch preparation remains protected by the server's source-operation lock.

A long-running target does not occupy the workspace with terminal output by
default. When a run has output, its console action opens the complete terminal;
there is no one-line terminal mode. Hiding the terminal disconnects only the
view and does not stop the target. Once opened, the terminal remains open after
the process exits until the person hides it.

Project onboarding owns missing-environment guidance independently of outputs.
Output inspection still owns launch availability and its diagnostic reasons.
A project without a web target hides unavailable browser-address controls and
points to Run for terminal or downloadable outputs. No declared outputs remains
a normal idle state that does not demand a web server.

Preview rewrites Host to the loopback target. On every HTTP and WebSocket
request it drops any inbound `Forwarded` and `X-Forwarded-*` header except
`X-Forwarded-For`, and sets `X-Forwarded-Host`, `X-Forwarded-Proto` and
`X-Forwarded-Port` from its own browser-facing origin, never from client or edge
headers. On its TCP listener `X-Forwarded-For` is replaced by the proxy's own
peer address, so a client-supplied chain never reaches the application; on its
private Unix-socket listener, which only the host's ingress reaches, the
ingress's `X-Forwarded-For` is kept. That socket lives in
`VIBE64_PREVIEW_PROXY_SOCKET_DIR`, else `$XDG_RUNTIME_DIR/vibe64/apps`, else a
private per-user `/tmp/vibe64-<uid>/apps`: never under TMPDIR, which may be
longer than a socket path's 107 bytes allow. The socket's full path may itself
pass those 107 bytes: a deep socket folder and a long workspace name, which the
socket's name `v64preview-<hash>--<workspace>.sock` repeats, are enough. So on
Linux it is never listened on or connected to by that path. The listener opens
the socket's folder `O_PATH|O_NOFOLLOW|O_DIRECTORY`, binds the socket at
`/proc/self/fd/<n>/<name>`, and keeps that handle until the server has closed,
since Node unlinks the address it bound at close; closing removes the name
through the same handle. Connections go through `connectPreviewSocket`, which
the liveness check before a stale socket is replaced uses and which a host's
ingress is given to reach a Preview: it opens the folder and then the socket
`O_PATH|O_NOFOLLOW` and connects by the socket's own handle (`/proc/self/fd/<n>`). A link or file in the socket's
place is refused (`ENOTSOCK`), as is a link in its folder's place (`ENOTDIR`),
and is never followed; a link left at the socket's name is no live Preview and
is replaced by the Preview's socket. Elsewhere sockets are named by path, in the
short folders above. Applications that trust the loopback proxy
therefore build absolute URLs on the Preview address and retain Secure cookies
on HTTPS previews. A request carrying the browser's exact own Origin is
presented on the loopback target instead: Origin becomes the loopback host with
the browser-facing scheme, and the forwarded host and port are dropped, so a
framework comparing Origin with its own (possibly forwarded) host sees one
consistent origin and accepts same-origin writes. Such an application must also
accept the loopback host. In the HTML page such a request returns, absolute URLs
on the loopback target's origin (or its forwarded-scheme origin), including
JSON-escaped ones, are translated to the preview origin like redirect Locations,
so a page returned by a form post keeps its links and assets on the Preview
address.
Redirects from the target's ordinary origin or
its forwarded-scheme origin stay on the preview origin. Foreign,
opaque and absent origins are preserved so application origin checks still apply.
A host may give Previews their own domain (`VIBE64_PREVIEW_PUBLIC_DOMAIN`), apart
from its editors', so no application code shares a site with an editor; an HTTPS
Preview is then a cross-site frame of the editor that shows it. The preview
proxy's own bearer cookie on HTTPS is therefore `__Host-`, `HttpOnly`, `Secure`,
`SameSite=None` and `Partitioned`: the editor's pane sends it, browsers that
block third-party cookies still keep it (partitioned by the framing page's
site), and a foreign site that frames the Preview has a partition of its own,
with no cookie, so it gets no application page. The Preview opened in its own
tab is its own top-level site and bootstraps its own cookie from the token in
its address. An HTTP Preview runs on this computer on the editor's own loopback
name, same-site with it, so its cookie stays `SameSite=Lax` and `HttpOnly`
without `Secure`.

The browser keeps a cross-site pane's cookies apart from a window at the
Preview's own address, so a window the pane opens (a framed app's OAuth sign-in
window, which JSKIT's popup client opens on the app's origin) would have neither
the pane's gate cookie nor its app session. The Preview proxy therefore holds the
application's session itself (`launchPreviewAccess.js`,
`launchPreviewHeldCookies.js`, `launchPreviewWindow.js`). The pane coming in
with the token on an HTTPS Preview (a frame's load, `Sec-Fetch-Dest: iframe`) is
also given a held session by the bootstrap redirect: a random id in a second
cookie beside the bearer cookie, with the same attributes. For a request of a
held session the proxy keeps each `HttpOnly` cookie the application
sets (page and asset answers, WebSocket upgrade answers, the identity exchange)
instead of passing it to the browser, and sends the held cookies with that
session's requests, by path and expiry, longest path first, in place of any older
browser copy of the same name. A cookie the application ends is dropped and still
passed on, so a browser copy ends too. A request another site started gets only
held `SameSite=None` cookies unless it is a GET page load, so another site's form
post or fetch does not carry the session. Cookies the page's script reads stay
the browser's: on HTTPS their `SameSite`, `Secure` and `Partitioned` give way to
`Secure; SameSite=None; Partitioned`. Every other request (a tab of its own,
the agent's browser and test runner, a client that is no browser, an HTTP
Preview, whose windows share the pane's cookies on the editor's loopback name)
has no held session and keeps passing every cookie through, as before. The
bridge's `window.open`, in a framed HTTPS page only, opens the window blank
inside the click, asks the proxy for a ticket
(`POST /__vibe64/preview-window-ticket`: same-origin, behind the gate, from a
held session) and sends the window to `/__vibe64/preview-window?ticket=…&to=…`,
keeping `noopener`. The ticket is random, single-use and lives 30 seconds; it
carries the pane's held session. The window path, before the gate, accepts it
only for a top-level GET page load (`Sec-Fetch-Dest: document`), never in a
frame, and only for an http(s) destination. It sets the bearer cookie and the
pane's held session in the window's own cookies, in place of any the window's
browser kept, and answers 303 to the destination with
`Referrer-Policy: no-referrer`. A ticket is used up by its first use, whatever
comes of it. The pane and its window are one application session; when the
provider severs the window (COOP), a reload of the pane shows the sign-in. The
Preview in its own tab is a page of the window's site, so after a window's
sign-in it shares that session too. The redemption does not check the editor
person: the Preview's site never sees the editor's sign-in. Only the pane, which
holds that person's partitioned bearer cookie and held session, can ask for a
ticket, and the window uses it at once. Held cookies and tickets live only in
the editor process's memory, per
Preview (project, session and origin), at most 64 held sessions of 64 cookies and
16 pending tickets, the oldest giving way. They survive the proxy's replacement
on an app restart. Stop and a closed launch terminal (`stop`) drop them, and the
session's end (`retire`) drops the token too. Application sign-in state kept in
browser storage or in cookies its own script writes stays in the page that made
it. The gate and proxy debug log record a request's path, never its query, which
can carry the token or a ticket. On every Preview a
`Domain` attribute naming a domain above the Preview's host (the workspace's or
the Preview domain itself, `@local/vibe64-core/server/cookieDomainGuard`) is
removed, so a cookie never reaches another Preview or app, and the proxy logs a
warning naming the workspace and project, once per cookie and domain for each
proxy. A `Domain` naming the Preview's own host, or an unrelated domain the
browser refuses anyway, is left as it is. The Preview's own cookie is never
sent to the application.
The bearer token belongs to the session's Preview at its public origin, not to
one app run: the proxy registry keeps one token per project, session and origin,
and a proxy that replaces another, as every restart, Stop and Start or recovery
does, accepts the same token. A tab opened earlier therefore keeps its cookie,
and its live-reload WebSocket reconnects once the new run answers. The token
opens only that session's Preview: its hash binds project, session and origin,
and another session's proxy has its own token. Ending the session's terminals
(archive, renewal or project close) retires the token, and the registry keeps
tokens only in memory, so a server restart issues new ones; an older tab then
gets the 403 `Launch preview token is missing or invalid.` until Preview is
opened again from the editor. Tokens are never logged. A request or WebSocket
upgrade whose target is no address (such as `//`) is answered 400 `This address
is not one the Preview can serve.` before its token is read, so no request a
peer sends can end the editor that serves the Preview; a browser's or app's
reset of a proxied WebSocket closes its other side
(`tests/server/editorPeerResets.integration.test.js`).
The open-in-new-tab button uses the project's one named tab. An editor that is
not on loopback never opens the app's server-only loopback address: when the
action it opens has no proxied address yet, the tab shows **Starting app…** and
moves to the Preview's proxied address once output status names it. A tab the
person closes meanwhile stays closed, and switching session abandons the wait.
A loopback editor, as in the local install, opens the loopback address at once.
Each Preview proxy remembers the editor origins that were handed its address:
the `editorOrigin` the editor's browser sends with its output-status request
(its own `window.location.origin`, since routing headers such as a dev
container's rewritten Host need not match it). A caller that sends none falls
back to that request's scheme and host, with the configured public protocol
winning for a public host. The
injected bridge ignores messages from any other parent origin and addresses
every location, diagnostics, identity and app-request message to those origins,
never `*`. The editor in turn addresses its queries, diagnostics requests and
identity grants only to the origin whose bridge announced itself in the frame.
This lets a previewed editor authenticate realtime connections through the proxy.
Request bodies of every method stream to the application with the browser's own
content-length or chunked framing; the proxy does not hold uploads in memory.
HTML responses are buffered only to inject the bridge, up to 16 MB; a larger page
fails with 502 `vibe64_preview_html_too_large` rather than the starting page.
A development server that restarts itself, as Vite does after a `.env` or config
change, refuses connections for a moment and drops the requests it had not answered.
Once the application has answered through the proxy, a request the proxy can send
again unchanged, a GET or HEAD without a body, is therefore sent again every 50 ms
while the application refuses or drops it, for up to 3 seconds, so a page loading
its modules in that moment gets them from the restarted server instead of failing
on them and showing the application's own error. Vite's restart after a `.env`
change was measured at 3 to 1,352 ms. An application that has never answered is
still starting and is not waited for. A request with a body is sent once and fails
with 502, so it is never repeated. A page request that still cannot reach the
application gets that starting page, a 503.
The editor requests its frame only when Preview becomes ready, so the page checks
its own address once a second and reloads when the answer is no longer 503. It has
no automatic refresh, which would make it blink while it waits. It has no bridge,
so the default application identity waits for the page whose bridge announces
itself instead of failing there and spending its one automatic attempt.
Each terminal session's proxy adds `frame-load` records to the session's
`preview-log.jsonl`: `starting_page` when a page load got that page, and
`first_page` with its HTTP status when a real page was next served. The starting
page's own checks do not count, each terminal session keeps at most 20 records,
and a record holds only the time and status, because a path can hold a token.
These records never replace `preview-last.json`, which stays the launch's latest
record.
Each upstream HTTP request restores the configured Preview idle timeout on a
pooled socket. A pool's short free-socket timer must not terminate a later active
request; tracking and teardown listeners remain attached only once per socket.
For a local proxy, the request's loopback Host on the proxy's own port is its
browser-facing origin. Token bootstrap, application redirects and HTTP/WebSocket
Origin translation retain that hostname when the local editor uses `localhost`
instead of `127.0.0.1`. Proxied origins remain configured, and foreign hosts or
different ports cannot override the proxy origin.

When several independent editors share a public Preview domain, the host can
supply `VIBE64_PREVIEW_PUBLIC_NAMESPACE`. The existing origin hash includes that
namespace while preserving the normal workspace/domain shape. Unset preserves
existing addresses. This is routing identity, not project Env or an access grant;
the standard proxy still owns tokens and sockets.
The terminal provider forwards this value with the other live routing settings,
so the runtime environment filter cannot drop the editor identity.

The reusable managed browser belongs to the session’s registered control generation,
not to the tool command that first opened it. Subsequent commands reuse its page
and identity. Session/Preview close and control-generation replacement retain
exact-owner cleanup; the worker still exits on idle expiry or loss of control health.
The browser keeps running for 30 seconds after a browser command, so a short
wait outside the browser before the next check still sees the page's own work.
After that grace period the worker stops its recorded browser process groups
(`SIGSTOP`), so an animated or WebGL page uses no CPU until the next command,
or the worker's own close, continues them (`SIGCONT`). Both periods are exact
timers, cleared while a command runs. Chromium's page freezing cannot do this:
Playwright keeps each page focused, which keeps it visible, and Chromium does
not freeze a visible page. Status reads only the worker's own state; it neither
continues the browser nor counts as use. The idle period (five minutes) starts
when the worker starts and again when each command ends, and never expires
during a command. Group drains send `SIGCONT` after `SIGTERM`, so a stopped
browser still exits at once when its worker is gone.
A worker that cannot load Playwright writes why beside its metadata, for its own
execution, and exits; the start stops waiting at once, cleans up its execution and
returns that reason with whose fault it is: with runtime packs, Vibe64's installation
(Health's Playwright runtime row shows the same), so the agent must not install
Playwright into the project; without them, the project's or the computer's
Playwright. A worker that never reports still ends in the ten-second readiness timeout.
Finite browser-test executions retain their calling execution as parent.

## Project services

The optional `Project services` section is interpreted only by public Vibe64’s
Genesis boundary. Exact foreground commands, declared runtimes and workdirs run
through the existing execution gateway before an output starts. Per-project
serialization shares one owner across sessions; changed declarations cannot
replace a running service silently. No service starts from status inspection or
merely opening a session.

Preview Stop drains only the output. Project Close first stops session work, then
all project-owned services, and clears its open state only after successful cleanup.
Dormant close and project deletion use that same owner. Managed exact-owner stop
can clean a predecessor server’s service without its original source directory.
A `per session` declaration uses the same service owner and serialized launch path,
with session identity in its execution selector and map key. It launches from that
session's source using the session environment, reuses its live handle across
output/test target changes, and does not attach to another session's instance.
Session terminal cleanup calls the same owner's `closeSession`, selecting the
project owner plus exact session ID; project-wide services remain running. Failed
session cleanup prevents its relaunch until cleanup succeeds. Project shutdown
drains both scopes. Endpoints/readiness remain application-owned; project Env is
not a per-session value store.

Standalone services use their executor-owned process handles. Orderly editor
shutdown drains owned services. Service SIGTERM handlers own external cleanup;
commands must not detach untracked workers.

## Practice lesson Preview

A practice lesson's App runs in its practice project through the ordinary
project-scoped output, Run, Stop, terminal and preview routes, with ordinary
project admission; there is no separate Learning App adapter, output namespace or
`/api/learning/<attempt>/…` route. A lesson's
automatic check needs a receipt of the learner's own App press, recorded through
Training's browser-only `step.observe`; Run or an iframe load is never a pass.
The output surface (`useVibe64OutputControlsSurface.js`, both hosts, through
`useVibe64PreviewMessages.js` and `useVibe64PreviewFrame.js`) admits the
practice App's `orientation-available` announcement only from the exact
Preview frame and origin and closes the channel whenever it replaces or clears
that frame. Learning's orientation channel
(`src/composables/useVibe64LearningOrientation.js`) owns the protocol: one
MessageChannel bound to that frame request, session, App run and a fresh player
identity; a trusted `button`, its `request` and the displayed
`response-displayed` are correlated while the frame stays visible. It does not
know what a lesson's App requests or displays; the step's declared check
verifies the interaction against the App server. The Learning
controller's step actions (`src/lib/vibe64LearningStepActions.js`) begin a
press only for L's current step of its prepared, not-ended version 2 attempt
whose practice project is the open project, while L is not covering the app,
when that step declares an automatic response check, and then send
`step.observe` with the attempt, step, project, session and App instance,
interaction and request identities. The
server re-admits its inner session and App-run reads on the ordinary practice
project target.

Opt-in browser Preview diagnostics use the existing terminal action boundary to
record bounded failure/retry/readiness fields in the private operational logger.
Project authority is rechecked and the existing session is read without preparing
or starting it. The server removes URL credentials, queries and fragments and
limits records per daemon/minute. This is diagnostic logging, not a second
Preview lifecycle or application-state store.

Separately, the bridge reports a reduced failure of a learner-started in-app
request (`vibe64:preview-app-request`: method, `:id`-templated path, status,
failure code); it carries no body, header, query or diagnostic entry. No current
surface consumes it.

Bridge version 8 adds Pick and recorded interactions for the usage map
(`vibe64:preview-pick-start`, `-stop` and `-result`, `vibe64:preview-recording`,
`vibe64:preview-interaction`) under the same parent-origin rules. While picking,
an outline with `pointer-events: none` follows the pointer, drawn in the
editor's primary colour that Pick start may carry as `color` and `onColor`
(`#rrggbb` only; anything else, or nothing, keeps the default), and pointer, click
and context-menu events are prevented and stopped in the capture phase; at any
other time nothing is prevented. Escape, the editor's Cancel, hiding, suspending
or reloading Preview, or a lost bridge ends Pick. The result names the element's
component through the project's Preview locator, or `null`.
`readPreviewLocatorSource(session)` reads the first `Preview locator` declared
under Architecture inspection as that inspection reads it (a regular project
`.js` file of at most 64 KiB, no symlinks) and parses it without running it. The
proxy inlines it as its own classic script, which defines
`globalThis.__jskitLocateElement(element) → { file, name? } | null`; any
failure only leaves Pick without component information. The editor turns the
file into a source-relative path, finds that file's component (or page) usage
entry and emits `open-usage` for Usage › Calls there.

While the session's web recording runs, the editor tells the bridge the recording
and its next interaction number: after the highest the bridge reported and the
highest the recording held when the editor read it, so a reloaded page or a
second tab continues the numbering. When the recording refuses a number another
page already used, the editor moves the bridge on to the next free number it
names, and the refused interaction tags no further requests. Each
trusted click, form submit or Enter (outside text areas and editable text, not
while composing) starts one interaction `i_NNNN`. Same-origin fetch and
XMLHttpRequest calls started within 1 s, before the next interaction, carry
`x-vibe64-interaction`; it is never sent to another origin. The editor posts each
interaction to the recording. Labels name the element's role or tag and its
accessible name (aria-label, aria-labelledby, `<label>`, placeholder, title, or
the visible text of buttons, links and similar), clipped to 40 characters. They
never read field values, option text or editable text, and a password field is
only "password field".


Preview suspension belongs to the displayed output surface. It clears its frame
request (therefore removing the iframe), resource retry timer and pending bridge
requests, while retaining the route and established app identity. Frame admission
stays blocked until explicit Resume; Dashboard visibility and background status
updates cannot reopen it. Resume refreshes through the existing output owner and
rejects a changed project/session before admitting a new frame. Session changes
clear the local suspension choice. Backend launch, agents and other displayed
surfaces retain their own lifecycles.
