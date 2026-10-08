# Previewing a web application

While the coding agent works, **Updating app…** covers the embedded app. After
the agent stops, **App changes are hidden** remains until you select **Preview
changes**. Interrupting the agent, a failed turn, or a pause between goal turns
does not reveal changes. The button is disabled during active edits. Selecting
it refreshes Preview, restarting a stale backend through the existing output
command when required. This is a display cover, not a rollback or a saved app
version. It applies to the current workspace on desktop and mobile; reloading
the editor or switching sessions starts a new Preview view. Managed browser
checks continue independently. Colleague can explain the button; it does not
silently reveal or certify changes.

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

Preview lets the application request your microphone and play audio. Use its
microphone control and allow access when your browser asks. Permission is still
your choice; embedding an app does not grant it automatically. Use HTTPS for
remote previews or localhost on your own machine. If you denied access, change
the site's microphone permission in the browser and retry. Colleague can explain
these steps but cannot grant browser permission or record on your behalf.

**Reload preview** refreshes the embedded page. **Restart preview** starts the
application again. If startup fails, inspect the message and **Show run output**
before retrying. Hiding run output closes only the terminal view; it does not
stop the application.
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
commands or invent application-specific teardown steps.

## Browser checks from chat

Ask the coding agent in chat to test the running application in a browser and
specify the flow to check. The agent uses the session's managed browser tools;
you do not need to provide an execution ID or change application code to enable
them. Application login may still require your credentials or interaction.

The coding agent can read `vibe64-helper playwright --help` before a project has
browser tests or a matching test runtime. Help starts neither Preview nor a browser.
An actual suite still requires the project's installed Playwright version and a
matching managed runtime. A version error is a test-runtime blocker; interactive
checks can use the existing managed Preview browser. Report the exact required
version to the platform operator instead of installing a separate browser.

Before a suite, the coding agent can run `vibe64-helper playwright readiness`.
It distinguishes absent tests, uninstalled dependencies, an unsupported exact
runtime and a supported installed dependency without starting Preview or a
browser. `ready` confirms dependency/runtime availability, not passing tests or
application readiness. `status` separately reports an active test run. Colleague
can explain these outcomes and delegate investigation to the coding chat; it
does not receive shell access through this guide.

If the agent reports “Browser testing requires a live assistant execution owner,”
the browser test did not start. This is an assistant runtime problem. After the
host runtime has been fixed and restarted, send a new chat message asking the
agent to retry the check. Colleague can explain this recovery and inspect Preview
state through its existing actions; it does not receive shell or browser-test
access from this guide.

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
