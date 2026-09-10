# Managed project outputs

People can run and inspect a project's web, terminal, and finite build outputs
without leaving the coding workspace.

## Sources

- `packages/vibe64-genesis/src/server/outputs.js`
- `packages/vibe64-terminals/src/server/vibe64OutputTargets.js`
- `packages/vibe64-terminals/src/server/outputTargetTerminal.js`
- `packages/vibe64-terminals/src/server/resourceWorkflow.js`
- `packages/vibe64-terminals/src/server/agentPreviewCommand.js`
- `packages/vibe64-execution/src/server/runtime/agentPlaywrightCommandSource.js`
- `packages/vibe64-execution/src/server/runtime/agentPreviewWrapperSource.js`
- `packages/vibe64-genesis/src/server/promptContext.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `packages/vibe64-terminals/src/server/outputResults.js`
- `packages/vibe64-terminals/src/server/launchPreviewProxy.js`
- `src/components/studio/Vibe64LongRunningTerminal.vue`
- `src/components/studio/Vibe64OutputControls.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue`
- `src/composables/useVibe64OutputControls.js`
- `src/composables/useVibe64OutputControlsSurface.js`

## Public contract

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
Working directories resolve relative to the session source. An ordinary name
such as `..build` is valid; a path resolving outside that source is rejected.

Agents discover declared targets through `vibe64-preview targets --json`.
`vibe64-playwright --target <id> test ...` and `npm-run <script>` temporarily
select an available web target through the same output controller. The server
holds the session's target selection while the existing managed runner obtains
its URL and native application identity and executes the suite. It restores a
previously running target and waits for readiness, or stops the test Preview
when there was no running target. Failures and cancellation use the same cleanup;
restoration failures preserve the test failure and make the command fail.
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
For an overridable tight-memory refusal, the registered command owner retains
one live request per session after successful normal-target restoration and
release of the Preview lock. The host opens a five-minute approval window in
that rejected workflow's existing record; no test reservation is held. The
Public slot stores the original command callback only in memory. Output status
projects its admission ID, waiting/resuming state and expiry through the
existing session-change stream. Chat shows Waiting for memory approval and the
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
`vibe64-preview ensure --target <id> --wait --json` is deliberate persistent
selection and does not arrange automatic restoration.

Target selection does not change managed environment values or certify data
safety. Application-owned scripts must select the designated disposable data,
prepare fixtures before readiness, suppress external effects, and verify the
actual server's test identity before destructive tests. A test target's preview
identity command must select the same data. Provider-neutral session guidance
explains these requirements, the commands, and the project work needed when a
test target is absent. See `docs/managed-browser-tests.md` for the portable setup.

Starting a target waits for the separately owned workspace-setup recipe, then
runs every step through the managed execution gateway. Web targets use the
preview resource profile, finite targets use the bounded job profile, and
interactive terminal targets use the terminal profile. Web presentation owns
port allocation, readiness and the managed proxy. A hosted web target publishes
its ingress socket as soon as readiness is confirmed, independently of client
status polling. Later status inspection verifies the bound socket identity and
republishes a missing or replaced socket. Finite runs snapshot only their
declared regular files into bounded immutable result storage and expose
downloads by generated result identity rather than a caller-supplied path.

New output runs describe one managed accounting workflow to the execution
provider; ready interactive outputs transition from startup to running.
Terminal completion reports success, failure or deliberate stop, with deferred
group finalization after execution cleanup. Already-running Preview reuse
creates no new group. Optional resource estimates come from the same Outputs
inspection; older projects without that section retain generic fallback.
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

Status inspection resolves the environment without provisioning resources or
writing project environment files. Confirmed preview readiness supersedes a
failed overlapping start request, so a running preview is not covered by an old
startup error. Late start failures from a previous project or session are ignored.
When automatic startup meets a temporary assistant-operation conflict, Preview
shows a waiting message and retries through its existing cooldown. The cooldown
survives a reload. Other startup failures appear once in Preview and require an
explicit retry; startup errors are not also repeated as global toasts.

The broad Genesis opening inspection is not launch admission. Existing-project
setup diagnostics, including stale Program source citations, and inspection
request failures appear in a persistent compact warning above the preview.
They do not unmount a running iframe or its toolbar. Recheck setup refreshes
only that inspection, works during assistant activity, and removes the warning
when resolved. Reload remains the separate browser/output-status action.
Starter selection and adoption still guide new or uninitialized projects;
Vibe64's output and workspace-setup contracts continue to validate actual launches.

Status inspection never starts work. Logs, retry, stop, open, fresh restart,
result history, and authenticated downloads remain available through the
session-owned output controller and studio controls.
An active assistant turn delays automatic startup, not status inspection or an
explicit restart. Both restart controls send the forced-start command for
running and exited targets. Session renewal still suspends source operations;
launch preparation remains protected by the server's source-operation lock.

A long-running target does not occupy the workspace with terminal output by
default. When a run has output, its console action opens the complete terminal;
there is no one-line terminal mode. Hiding the terminal disconnects only the
view and does not stop the target. Once opened, the terminal remains open after
the process exits until the person hides it.
