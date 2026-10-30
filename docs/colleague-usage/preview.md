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

The Preview address bar has two groups. The page group, styled as the address
field, holds **Go back in preview**, the **Preview URL**, **Reload preview**,
**Suspend preview**, **Copy preview URL** and the open-in-new-tab button; these
act on the page shown in this browser. The separate outlined server group holds
the server status dot, **Show run output**, **Stop preview** and **Restart**;
these act on the app server behind every Preview page. On mobile the server
group sits on its own row under the address.

Use **Suspend preview**, beside **Reload preview**, to unload
only this displayed page and reduce browser CPU use. Unsaved changes inside the
page may be lost. The app server, coding agents and goals continue running;
other Preview windows are unaffected. **Resume preview** reopens the saved route
with the existing app identity. The suspended page also shows a Resume button.
Switching to **Dashboard** and back keeps it suspended. This choice belongs to
this Preview instance; it does not suspend a different session. Suspending an outer Preview also unloads any
nested pages inside it. Colleague can explain the control; the person operates
it in their browser.

Open the project's **Preview** tab. On mobile, use **Show project** from chat,
then **Show preview controls** to expand the toolbar. If the selected output needs settings,
choose **Preview options**, fill the required fields and choose **Run**.
**Remember for this project** saves those ordinary settings in this browser for
future sessions. **Cancel** leaves the current run alone.

Preview checks the current output, workspace setup and resource declarations
together. Later checks reread changes to those declarations. Invalid resource
estimates retain their diagnostic and generic fallback; they do not by themselves
make an otherwise valid output unavailable.

If the previewed application shows its own login screen, enter that application's
credentials. Its login and realtime connection run through the Preview address.
HTTPS previews retain the HTTPS scheme for applications that use it to set
secure login cookies and redirects.
Preview tells the application its browser-facing address through the standard
forwarded headers. An application configured to trust its local proxy then
builds absolute links, asset URLs and callbacks on the Preview address. If pages
load without styles or links point to `127.0.0.1`, the application does not
trust the proxy yet; ask the agent to configure trusted proxies for its
framework. A page returned by a form post also keeps its links on the Preview
address. Preview tells the application the visitor's address in
`X-Forwarded-For`; a value the browser sends itself is not passed on. Form posts
and realtime connections from the Preview page reach the application on its
local address, so its allowed hosts must include that local address as well as
the Preview address.
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

A Preview also stops when the platform restarts, for example during an update.
The pane then removes the old page instead of leaving it looking alive. It shows
**Preview state was lost after a server restart** with **Restart preview**, or,
once that has been seen, **Preview is not running** with a **Start preview**
button in the middle of the pane. Starting it runs the session's current code.
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
An HTTPS Preview can also appear inside a previewed editor's iframe. Its first
navigation saves a secure Preview cookie, then removes the token from the address;
the nested app should load without a token error. If the browser blocks that
cookie, open the Preview in its own tab and ask the coding agent to check the
browser's cookie policy and the current Preview address. Colleague can explain
those steps but cannot change the browser's cookie settings.
A single app page larger than 16 MB cannot be shown in Preview: it shows
**Preview page is too large to inject the bridge.** Ask the coding agent to make
that page smaller, for example by loading its data separately. Uploads of any
size pass through to the app unchanged.
Only the editor that showed you the Preview can use it. Another website that
puts the Preview address in its own frame gets no app page, because the Preview
cookie reaches only same-site frames, and none of the app's captured console or
network details.
If two temporary editors show the same address, their host routing configuration
needs correction. Restart the affected Previews after the host update; changing
an application's listening port is not required.

Some projects declare shared development services. Starting an output starts them
once for the project; subsequent sessions share them. Stopping an individual
Preview leaves these services available. Where your host provides project **Close**,
use it to stop all project work, including shared services. In a local directory
editor, shut down the editor normally. However the local editor ends, including a
crash or a closed terminal, its shared services stop within a few seconds and do
not keep running into its next start. Previews end with it too, unless their
program keeps running after its terminal hangs up. Hiding Preview, navigating
away or closing a browser tab does not perform project Close. Ordinary inactivity shutdown also
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

## Show what an element uses

**Pick element**, beside **Reload preview**, finds the component behind part of
the page. On mobile it is in the expanded toolbar (**Show preview controls**).
Choose it, then click an element in Preview. While you pick, an outline follows
the pointer and names the component, and the click selects the element instead
of using it. Architecture then opens **Usage** › **Calls** at that component, to
show its exact and probable calls, with its name in the entry list's search; see
[See what one entry point uses](usage-map.md). To
stop picking, press Escape or choose **Cancel** on **Select an element in Preview
to see what it uses.** Hiding, suspending or reloading Preview also stops it.

Pick needs the project's technology to say which component drew an element.
When it cannot, Vibe64 says **No component information on this page. Record
while clicking to see its requests.** When the component has no usage entry
yet, it says that the file **has no usage entry yet. Refresh the architecture
scan, then pick again.**

Starting a Preview recording (see [Record what runs](usage-recording.md))
restarts Preview with the recorder, so unsaved page state is lost; stopping it
does not restart Preview. While it runs, each click, form submit or Enter in
Preview becomes an interaction. Requests the
page starts on its own address within one second of it are listed under it in
Usage › Recording, such as **Click: button "Add" (SessionList.vue)** or **Enter: textbox "Title"**; requests to
other sites are never marked. Labels name the element's role and visible label,
never what was typed, and a password field is only called "password field". The
page itself works as usual while it is recorded.

Colleague can explain Pick and recorded interactions; the person picks and
clicks in their own browser.

## Browser checks from chat

For managed browser checks, test ownership and recovery, read
[Browser checks from chat](preview-browser-checks.md).

Lesson diagrams play in the Learning environment, not over Preview; see [The Learning environment (L)](learning-environment.md).

To choose which application Preview starts, see [Choose a starting application](preview-starting-application.md).
