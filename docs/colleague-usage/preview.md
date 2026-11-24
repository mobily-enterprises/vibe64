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

The open-in-new-tab button (titled **Preview**, or with the output's own name)
opens the app in an ordinary browser tab, not a popup window, so you can edit
its address. Choosing it again reuses that same tab for the project.
The button appears once Preview is ready, or earlier if the app prints its own
address while starting.

When the editor itself is open on `localhost` or `127.0.0.1`, as in the local
editor, the button opens the app's local address at once. Any other editor
address, for example on a managed host, opens the session's Preview address
instead and never the app's server-only `127.0.0.1` address. If you choose the
button there before Preview is ready, the tab shows **Starting app…** and moves
to the Preview address by itself once Preview is ready. If you close that tab
first, it stays closed; choose the button again once Preview is ready.

A tab on the session's Preview address keeps working when the app restarts in
the same session, whether through **Restart preview**, **Stop preview** and
**Start preview**, automatic recovery or an Env change. The address stays the
same, and the page's live reload reconnects by itself once the app answers
again. The tab's access ends with the session: when it is archived or renewed,
when the project closes, or when Vibe64 itself restarts. An older tab then shows
**Launch preview token is missing or invalid.**; open Preview again from the
editor with the open-in-new-tab button. That access opens only this session's
Preview.

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

A resource the app needs and doesn't have yet, such as its database or Redis,
keeps Preview from starting: Preview names the values to set in **Dash → Env**
under **Development**, or says Vibe64 is still setting the resource up, then you
press **Check again** (see [Choose a starting application](preview-starting-application.md)).
A files bucket is never one of them: without its settings the app uses its own
default storage, and Preview starts.

If the previewed application shows its own login screen, enter that application's
credentials. Its login and realtime connection run through the Preview address.
HTTPS previews retain the HTTPS scheme for applications that use it to set
secure login cookies and redirects.

A host may give Previews a domain of their own, apart from the editor's, so the
application's code never shares the editor's site. On such a host the Preview
pane shows another site's page, and the browser keeps the pane's cookies apart
from every other page's. Preview therefore keeps the application's sign-in for
the pane itself: the cookies the application marks `HttpOnly` (its session,
usually) stay in Preview, which sends them with the pane's requests, and the
cookies the application's own scripts read are marked so the browser keeps them
for the pane (`SameSite=None`, `Secure`, `Partitioned`). Signing in inside the
pane works as usual and survives a reload.

A sign-in that opens a window of its own (an accounts hub, Google and other
providers, which refuse to be framed) works from the pane too: Preview lets the
window in as the pane, with a one-time pass the pane asks for as it opens the
window, so the window and the pane share one sign-in. An application that waits
for its window, as JSKIT applications do, reloads the pane signed in when the
window finishes. Some providers cut the window off from the page that opened it:
the window then stays open, signed in, and the pane is not told. Close the
window and select **Reload preview** (or reload the page inside the pane) to see
the pane signed in. The Preview opened in its own tab keeps a sign-in of its own
until a window from the pane signs in, which signs the tab in too (both are pages
of the Preview's own site); otherwise sign in there separately if you need to. An
application that keeps its sign-in in the browser's own storage (local storage,
or a cookie its scripts write) keeps it only in the window that signed in: ask
the coding agent to keep the session in an `HttpOnly` cookie, or sign in in the
Preview's own tab. **Stop** signs the application out in the pane and its
windows; a restart keeps the sign-in.

The browser must support partitioned
cookies (current Chrome, Edge, Firefox and Safari 26.2 or later do); in an older
Safari, or with a browser setting that blocks every cookie in frames, the pane
shows **Launch preview token is missing or invalid.** Open the Preview in its own
tab instead, or update the browser.
An application cookie is never shared beyond the Preview's own address: if the
application names a wider domain for one (a `Domain` that would also reach other
Previews or apps), Preview removes that domain, keeps the cookie on the Preview's
address alone and records a warning in Vibe64's log naming the workspace and the
project. The application keeps working; ask the coding agent to stop setting that
domain in development.
Preview only ever shows the application. If the browser ever puts Vibe64's own
page inside the Preview frame, the editor records where the frame came from in
Vibe64's log, loads the application again and says so above the Preview for a
minute; if that repeats within a minute, the frame stays empty, with a note
saying so, until **Reload preview** or the Preview restarts. Tell the project's
owner when you see either note: the log entry explains what happened.
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
and page navigation, so opening the editor on `localhost` also works.

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
When preparation runs again while the app is already running, for example after
**Update**, **Prepare workspace**, **Retry** or **Fix it with AI**, Vibe64
restarts the Preview by itself once preparation succeeds, so the app runs on what
preparation installed; you do not need **Restart preview**. As with **Restart
preview**, unsaved page state is lost. A stopped Preview stays stopped, and a
failed preparation leaves the running app as it is, with the failure shown.
Errors that remain after setup finishes are still reported as Preview errors.

If automatic Preview opening meets a busy exercise preparation or assistant write
operation, it waits and retries the same Preview through the existing cooldown.
The message says **Waiting for the current workspace operation to finish. Preview
will retry automatically.** This refusal happens before the app starts; it does
not create another lesson attempt. Other startup errors still require an explicit
retry after you inspect the failure.

When the application's development server restarts itself after it has already
answered, for example a moment after an Env change or a change to its own
configuration, Preview holds the page's requests until the server answers again,
for up to about 3 seconds. A page that was opening or still loading its modules
at that moment then finishes loading as usual, instead of flashing the
application's own error, such as "The application could not open". Form posts and
other requests that carry data are never sent twice: one sent during the restart
still fails, and the application reports it as usual.

**Start preview** answers at once. While the start waits, for the workspace
preparation (after a restart it can take minutes) or for another Preview change,
Preview says what it waits for, for example **Starting preview: App. Waiting for
the workspace preparation to finish.**, and opens the app once it runs, so you
do not need to press it again. If Vibe64 restarts meanwhile, Preview says
**Vibe64 restarted while Preview was starting. Start it again.** A refused start
shows its reason, as before.

If the page opens while the application has not answered yet, or stays
unreachable for longer than that, Preview shows **Starting preview.** and waits.
It checks about once a second and opens the page by itself, in its default
identity, as soon as the application answers, so you do not need to reload.
If a managed app identity is invalid, Preview still starts with the valid ones
and a notice above the page names each skipped identity and its reason, with
**Open App access** to fix it (see [Managed app access](managed-app-access.md)).
If it keeps waiting, the application is not answering: use **Show run output** to
see why.

**Reload preview** refreshes the embedded page. **Restart preview** starts the
application again. If startup fails, inspect the message and **Show run output**
before retrying. Hiding run output closes only the terminal view; it does not
stop the application.
To stop Preview, and for what Preview shows after a stop or a platform restart
and what a start does while another run is starting or running, read
[Stopping and restarting Preview](preview-stop-and-restart.md).

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
puts the Preview address in its own frame gets no app page, because the browser
keeps the Preview's cookie only for the site that showed it (the editor's, or the
Preview's own in its own tab), and none of the app's captured console or network
details. A window's one-time pass is no use to it either: only the pane can ask
for one, and the pass works once, within 30 seconds, only as a window's own page,
never inside another site's frame; a refused pass shows **This Preview window's
ticket is missing, used, expired or not this page's.** Open the window again
from the Preview.
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
stops them.

If another branch changes a running service declaration, startup asks you to Close
and reopen the project. Save work as needed before doing so; this stops the other
sessions’ running tools too. A failed Close reports cleanup failure. Do not claim
resources were released until Close succeeds. Colleague can explain the result
and use the existing authorized project-close action; it does not execute shell
commands or invent application-specific teardown steps. If shared services were
cleaned up but another close controller failed, the project remains open and
Preview can start those services again; retry Close after addressing the reported
controller.

## Ask the AI to show you a page

Ask the coding agent in chat to show you a page of the app, for example "show
me order 42 in my Preview". It moves the Preview you have open in this session
to that page, exactly as if you had typed the page's path into the **Preview
URL** box: the same Preview access, signed-in identity and **Go back in
preview** history. A note above the app says **The AI opened** and the path,
for example **The AI opened /orders/42**, for ten seconds. Every browser tab
showing this session's Preview moves, including one where **Dashboard** is in
front; choose **Preview** to see it. On mobile, use **Show project** from chat.

The agent opens only pages of the running app, by a path that starts with a
single `/`, such as `/orders/42?tab=notes`. It cannot send your Preview to
another site, to Vibe64's own pages or to an address carrying a Preview token.
It is told whether your Preview moved. When nobody has this session's Preview
open, or it is suspended or still starting, nothing moves and the agent gives
you the path instead: type it into the **Preview URL** box, or choose **Resume
preview** first. A stopped Preview stays stopped; the agent starts it only when
you want it running. The agent's own managed browser for checks is a separate
copy; its pages never appear in your Preview unless it opens them this way.
Colleague can explain this; the coding agent in the session's chat opens the
page, through `vibe64-helper preview open`.

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
scan, then pick again.** Before the project's first scan it says **This project
has not been scanned yet. Refresh the architecture scan in Usage, then pick
again.** Both offer **Open Usage**, where **Refresh** runs the scan.

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
