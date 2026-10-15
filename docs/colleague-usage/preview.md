# Previewing a web application

While the coding agent works, a small **Work in progress** bar appears above the
app. Preview stays visible and interactive on desktop and mobile, including
during goals and after interruptions. The bar disappears when editing stops.

When Vibe64's output status detects a failed or stale web server and recovery is
available, **Server will be restarted soon** appears above the app. Recovery uses
the app's declared output command and waits for editing and other source operations
to stop; interrupting a turn does not cancel that queued recovery. It makes one
automatic attempt. If that fails, the existing error and recovery controls remain
available; use **Restart preview** or ask the coding agent to repair the failure.
Application page errors that do not change the output's health remain visible in
the app itself. Resource holds and managed browser tests retain their own recovery
controls. After a hold is retried, Vibe64 checks current output status before
automatic recovery; a Preview that has already started stays running.
Colleague can explain these controls and offer supported recovery assistance.

An amber **Test Preview** bar means the selected app target declares isolated
test data. It remains visible above the app on desktop and mobile, even with
the Preview toolbar collapsed. Changes in that target use its test data rather
than the ordinary app database. The project launcher must enforce this separation.
A generic **Browser tests in progress** bar means automated checks control
Preview; it does not claim a separate database. **Restoring your app** remains
visible while Vibe64 restores the previous target. The bar disappears when
restoration succeeds. A red **Preview recovery required** bar means cleanup or
restoration failed: ask the coding agent to recover the managed browser run
before using Preview. Colleague can inspect output status and explain recovery;
it must not claim the normal app is restored from a test exit code alone.

Open the project's **Preview** tab. On mobile, use **Show project** from chat,
then **Show preview controls** to expand the toolbar. If the selected output needs settings,
choose **Preview options**, fill the required fields and choose **Run**.
**Remember for this project** saves those ordinary settings in this browser for
future sessions. **Cancel** leaves the current run alone.

If the previewed application shows its own login screen, enter that application's
credentials. Its login and realtime connection run through the Preview address.
HTTPS previews retain the HTTPS scheme for applications that use it to set
secure login cookies and redirects.
In the local editor, Preview keeps the editor's loopback hostname through login
and page navigation, so opening the editor on `localhost` also works. If a tab
shows an expired Preview access error after a restart, use **Reload preview**
to obtain its current address.

Longer application requests keep the same Preview idle allowance when an HTTP
connection is reused. If a save or archive still reports a connection error,
check its resulting state before retrying: losing the reply does not prove the
operation failed. Colleague can help inspect the state through its supported
actions; it must not repeat an uncertain write automatically.

Preview lets the application request your microphone and play audio. Use its
microphone control and allow access when your browser asks. Permission is still
your choice; embedding an app does not grant it automatically. Use HTTPS for
remote previews or localhost on your own machine. If you denied access, change
the site's microphone permission in the browser and retry. Colleague can explain
these steps but cannot grant browser permission or record on your behalf.

While **Preparing workspace** is running, Preview waits before reading or starting
the app. Use **Expand** on the preparation card to inspect progress and logs.
Preview checks the app automatically when setup finishes. If setup fails, its
failure stays visible; fix the cause and use the preparation card's **Retry**.
Errors that remain after setup finishes are still reported as Preview errors.

If automatic Preview opening meets a busy exercise preparation or assistant write
operation, it waits and retries the same Preview through the existing cooldown.
The message says **Waiting for the current workspace operation to finish. Preview
will retry automatically.** This refusal happens before the app starts; it does
not create another lesson attempt. Other startup errors still require an explicit
retry after you inspect the failure.

**Reload preview** refreshes the embedded page. **Restart preview** starts the
application again. If startup fails, inspect the message and **Show run output**
before retrying. Hiding run output closes only the terminal view; it does not
stop the application.
The top Preview toolbar shows **Stop preview** while the application is running.
Stop waits for the application's owned work and managed browser to close; it
does not close the coding session, chat, source checkout or shared services.
On managed hosts, service cleanup runs before remaining processes are terminated.
Wait for Stop to finish; a cleanup failure is not a successful stop.
Stopping Preview closes its browser process but keeps the coding assistant's
managed-browser registration. The same assistant can run another managed browser
check or test suite afterward without reopening its conversation.
It stays stopped after navigation, reload or reopening the session. Use the
toolbar's **Start preview** or **Restart preview** deliberately to run it again.
If Stop reports incomplete cleanup, retry Stop before starting. Browser tests
may temporarily run an isolated target, then restore the prior stopped choice.
Managed suites without `--target` also restore the previous running or stopped
Preview state, including after an assertion failure or cancellation. An explicitly
supplied external `PLAYWRIGHT_BASE_URL` does not start or stop managed Preview.
The selected target and its parameter values remain saved while stopped, including
after browser tests or an editor restart, for the next explicit Start.
If Preview reports an invalid saved stop state, use the explicit Stop action
before retrying Start; automatic recovery does not overwrite that state.
Colleague can offer the existing authorized stop/start actions, but a how-to
question alone does not authorize either action.
Retrying the same output reuses its running application when its settings and
environment still match. It does not start another process merely because a
new Preview address could be allocated. Use **Restart preview** when you intend
to replace that run.
Stopping or restarting a hosted Preview includes processes in its child groups,
that are owned by that output. Wait for cleanup to finish before starting
another run. If cleanup fails, open **Resources** for the reported operation
and retry only after its running work has been stopped.

Colleague can inspect the selected output and its logs, explain required fields,
and start or stop it through existing authorized actions. It must inspect current
state before starting and verify readiness afterward. An application's login
screen still requires the person's interaction or an explicitly authorized coding
agent; Colleague does not receive passwords from usage knowledge.

Independent temporary editors may contain the same example project/session yet
have separate Preview addresses. Use the current editor’s **Preview** controls;
an address from a discarded environment is no longer valid. No namespace or port
field is required. Colleague uses the current Preview result rather than
constructing an address.
An HTTPS Preview can also appear inside another editor's iframe. Its first
navigation saves a secure Preview cookie, then removes the token from the address;
the nested app should load without a token error. If the browser blocks that
cookie, open the Preview in its own tab and ask the coding agent to check the
browser's cookie policy and the current Preview address. Colleague can explain
those steps but cannot change the browser's cookie settings.
If two temporary editors show the same address, their host routing configuration
needs correction. Restart the affected Previews after the host update; changing
an application's listening port is not required.

Some projects declare shared development services. Starting an output starts them
once for the project; subsequent sessions share them. Stopping an individual
Preview leaves these services available. Where your host provides project **Close**,
use it to stop all project work, including shared services. In a local directory
editor, shut down the editor normally. Hiding Preview, navigating away or closing a
browser tab does not perform project Close. Ordinary inactivity shutdown also
stops them. Shared services remain subject to hosted resource limits while idle.

If another branch changes a running service declaration, startup asks you to Close
and reopen the project. Save work as needed before doing so; this stops the other
sessions’ running tools too. A failed Close reports cleanup failure. Do not claim
resources were released until Close succeeds. Colleague can explain the result
and use the existing authorized project-close action; it does not execute shell
commands or invent application-specific teardown steps. If shared services were
cleaned up but another close controller failed, the project remains open and
Preview can start those services again; retry Close after addressing the reported
controller.

## Browser checks from chat

For managed browser checks, test ownership and recovery, read
[Browser checks from chat](preview-browser-checks.md).

## Lesson presentation in Preview

When a host opens a declared lesson diagram, Preview offers **App preview** and
**Colleague presentation**. App preview returns to the running application;
Colleague presentation shows the same retained diagram. Switching changes neither
the application process nor its frame. **Minimise presentation** returns to the
application while retaining the diagram; **Restore presentation** brings it back.
On phones, return to the workspace from Colleague to use these same Preview choices.

The host reads your pinned diagram for your signed-in lesson attempt even while
its exercise project is selected. You need not leave the project to load it. If
loading fails, use **Reload presentation** for the same attempt; do not start a
new lesson or treat the failure as an assessment result.

Hiding a diagram pauses its motion when its declared controller supports pause.
Showing it does not replay a transition automatically. A diagram failure offers
**Reload diagram**; a failed resource read offers **Reload presentation**, which
reads the same attempt and declared visual again. Neither recovery grades an
assessment or changes the lesson version. Missing or changed pinned content needs
the owner's normal recovery. Colleague's visual commands become available only
when the host supplies authenticated resource delivery and browser acknowledgement;
this Preview composition alone does not activate those tools or synchronise speech.

With the authenticated host connected, you can ask Colleague to show a declared
lesson visual or demonstrate its next step. It uses your saved prepared exercise
and waits for the diagram to be ready or the transition to finish. Ask it to read
the displayed diagram state if you are unsure. If the browser disconnects or the
exercise view changes, reopen the same lesson and retry deliberately; a missing
acknowledgement is not proof the transition failed, so keep the original command
identity on a retry. These commands do not mark learner work correct or prove
spoken narration finished.

### Diagram explanations and sound

A host-enabled teaching cue first shows the declared diagram, then uses one final
Colleague explanation. Its motion starts when that explanation actually becomes
audible. Tool progress is not narration. With spoken replies off, read the final
explanation and press **Continue** to watch. If sound has not started, **Play diagram
without sound** is an explicit alternative; sound failure also offers Continue.
Neither option pretends that audio played.

Hiding Preview, changing the exercise, reloading its diagram or stopping the
explanation retires the current cue. Supported motion pauses and its semantic
state remains readable; showing Preview alone does not replay it. Deliberately
hiding the diagram interrupts sound only while this cue's exact explanation is
still audible. The normal voice stop also clears queued speech for that same
voice binding; it does not pause audio for later resumption. Minimising Colleague
alone keeps voice playing, and a newer answer or another conversation is never
stopped by this diagram control. Ask Colleague to repeat the explanation explicitly
when needed. Colleague waits for the actual
diagram and required audio completion receipt before another teaching cue or
question. An unconfirmed receipt needs its current status checked, not an inferred
pass or automatic replay. On phones, opening a teaching presentation minimises
Colleague's frame while retaining the conversation, microphone and typed draft.

## Choose a starting application

In an empty project's **Preview**, choose **Use this starter** on the desired
Basic, Database, or Accounts app. On mobile, open **Show project** first. Import
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
