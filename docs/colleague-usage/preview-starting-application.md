# Choose a starting application

This continues [Previewing a web application](preview.md).

In an empty project's **Preview**, choose **Use this starter** on the desired
starter, such as Basic app, App with no users, but a database, or App with users. On mobile, open **Show project** first. Import
adds source to this session; review it and use **Save** to keep it in the project.
Setup and running the app are separate operations.

A missing Stack contract reported during import can belong to the downloaded
starter even when your project's Stack is empty. Validation rejects that starter
before copying it. Migrating the empty destination does not fix the starter.
After the starter or importer is repaired, retry **Use this starter**. If the
result is uncertain, recheck the project before retrying; existing application
source must not be overwritten.

Colleague can inspect onboarding, explain the available choices and offer to
apply one. After you choose a starter and accept its offer or directly request
it, Colleague can use the existing onboarding action and recheck the result.
A successful import does not mean dependencies are prepared or Preview is running.

For recurring **Preview could not load an application resource** errors, enable
Preview diagnostics in the affected Studio browser before reproducing: add
`vibe64_preview_debug=1` to the page URL, or set
`localStorage.setItem("vibe64:preview-debug", "1")` in that browser's developer
console. The option applies to that browser, on desktop or mobile; Colleague can
explain it but cannot change browser developer settings for the person.

While enabled, failed script/style/module URLs, frame readiness and automatic
retry events are sent through the session's authenticated Preview action to the
workspace's private operational log (`vibe64.preview.browser_diagnostic`). An
operator can inspect that log after the page reloads or the person leaves. Each
record identifies the project, session, frame attempt, retry count and browser
observation time. The authenticated route selects the project and session; the
browser sends only diagnostic fields in the request body. URLs keep only origin/path: credentials, query values and
fragments are removed. Console text, request/response bodies and headers are not
uploaded. Each iframe reports at most 50 failed resources; the daemon accepts
at most 120 records per minute. Excess diagnostics
are omitted without changing Preview. These records can identify a failing
module, but browser resource errors do not themselves provide its HTTP status.
A log outage does not trigger another Preview retry.

Remove the URL option and run
`localStorage.removeItem("vibe64:preview-debug")` to stop recording. Existing
private log retention remains the operator's responsibility. The ordinary
Preview diagnostics attachment remains a separate, explicitly requested snapshot
of the current iframe's console/network history.

For a **Chat updates could not reconnect** investigation, the operator can enable
existing `JSKIT_REALTIME_DEBUG=1` on the workspace daemon (or `realtime.debug` in
its runtime configuration), then restart the daemon at a safe maintenance boundary
to apply it. Vibe64 passes this flag to the shared chat runtime; setting it in a
project's Preview environment does not enable chat diagnostics. Subscription
diagnostics then record the pending
server stage at the 10-second acknowledgement budget and the stage/reason when
that observer is released. With this option enabled, each preceding stage and
its elapsed time are also retained in warning-level logs, so an operator can
distinguish slow admission from slow snapshot reading. With the environment flag
enabled, `vibe64.conversation.browser_timing` also separates Main's session loading,
native conversation opening and fresh authorization, including failed boundaries.
Repeated subscription authorization is recorded only when denied or taking at
least 100 milliseconds, to avoid a diagnostic log entry for every healthy token.
The same diagnostic record family separates slow conversation access checks into
fresh user lookup, saved learning-attempt validation, practice scope, project
access and project-context resolution. It records the elapsed phases even when
access fails; repeated checks keep their existing authorization behavior.
Concurrent Learning readers share verification of the same pinned course files
while that verification is running. Completed results are not cached: later
reads still reject missing or changed installed files, with the same reinstall
guidance. Each reader retains its own result and fresh access checks.
These records identify the session and operation, without chat text, request
details, account credentials or error contents. This does
not change the deadline, start a model, resend a message or retry a subscription;
use **Reload chat** after correcting the cause.

Leaving a chat or releasing its failed connection stops further subscription
setup once the current step finishes. A released connection does not start a
new history read; an existing read may finish without updating the replacement
view. This only releases browser observation: agent work continues. **Reload
chat** still checks current access before restoring history and live updates.

With the same option, saved learning-attempt timings separately report normal or
preview scope selection, saved exercise validation and practice-context capture.
These are nested durations within saved-attempt time; do not add them to that
parent duration. Failed stages retain their timing without exposing their error
contents, and no completed authorization result is cached.

Opening a saved Learning practice conversation still checks its pinned teaching
content on each admission. That check does not load a second exercise-file payload
for workspace preparation. Missing or changed teaching content still requires the
owner to restore the exact verified snapshot; reloading chat does not bypass it.
