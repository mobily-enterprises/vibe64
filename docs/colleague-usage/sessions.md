# Create and switch sessions

Use **New session** (+), or **Create session** when there are no open sessions,
to open **Start an AI session**. Choose an available orchestrator, review any
branch choice, then select **Create session** (or **Create branch & session**).
While **Creating session…** is shown, the dialog stays open: clicking outside,
pressing Escape, Close and Cancel cannot dismiss it. On success it closes and
opens the new session. If creation fails, review the error and retry or dismiss
the dialog. This works the same way on desktop and mobile.

The new session appears in the session list after its source checkout is ready.
Refreshing during creation does not report that checkout as missing. If a
**session needs attention** notice remains after creation, use **Check again**;
if the checkout is still missing, use **Copy recovery details** and ask your
administrator to restore the original work from a verified backup. Colleague
can explain the notice, but cannot restore missing source through session creation.

If creation reports **This session source already exists**, existing commits,
staged changes and files have been preserved. Reopen that session if it is listed;
otherwise keep the source and ask your administrator to inspect the recovery
details. Repeating creation does not reset or replace the checkout.

Colleague can explain the choices or create a session through its session
creation action when you explicitly ask it to do so.

An approved preparation operation may reserve a session and its exact saved
source before creation. If creation reports retained session state or unavailable
creation checks, keep that reservation and ask the owner to inspect it; retry must
not overwrite it or choose another session. The operation retains its verified
source rather than silently starting from newer project changes. These checks add
no desktop/mobile control or arbitrary source selection to Colleague.

## Switch between open sessions

Select a session tab above the chat to open that session's conversation and work.
The selected tab includes the Archive session control. Hover or keyboard focus
alone does not select a session.

A project link can initially select the session named in its URL. You can then
select another tab; session-list refreshes preserve that choice. Following a
different session link selects its named session. A session being archived is
temporarily unavailable for selection.

The right-side session actions tighten their spacing and icon size in narrower
chat panes to leave more room for labels. Wider panes retain their usual spacing;
the smallest panes keep secondary actions in **Session actions**. Update uses a
vertical line through a circle, distinct from the branching pull-request icon.
Hover or focus a control to read its action label.

During a session **Save** or **Update**, you can still open existing temporary
chats, read their saved history and keep a plain text draft. The draft's save
state appears in that chat. Sending or changing assistant work waits for the
repository operation to finish. If an Update response is lost, use the saved
Update status and recovery controls before requesting another Update; a reload
does not establish that the first one failed.

Colleague can explain the tabs and open an accessible session through its
navigation action when you explicitly ask it to do so.

## Reconnect a chat

If the conversation shows **Conversation subscription failed.**, choose
**Reload chat** to reconnect to the same session. This reads its saved history
and restores updates without sending your draft or repeating an earlier request.
Standalone Vibe64 supports this through the local editor for its selected project;
it does not require a hosted workspace login. Keep using the editor's localhost
address. If the error persists, report the project, session and exact error.
On phones, open the chat pane to find the same control. Colleague can explain
recovery and open the session; the person selects **Reload chat**.

## Working and Learning session navigation: integration prerequisite

The prepared mode filter uses the same session tabs and chat panel for Working
and Learning sessions. Older sessions without a purpose remain Working. Hiding
a session from navigation preserves its running work, mounted conversation and
draft; it does not stop or archive anything. A selected session of the other
purpose is hidden without opening a different session automatically. The host
must attach the actual mode control and remembered selection before this is a
complete visible feature. The filter does not create a lesson, authorize an
attempt or turn an ordinary session into a teacher. Desktop and mobile use the
same navigation contract. Colleague can explain the mode; changing it does not
authorize starting or ending a lesson.

When the host connects Working and Learning to these tabs, each mode remembers
its own selected conversation. A Working conversation that finishes opening
while you view Learning stays with its original project and does not replace the
lesson you are viewing. Switching modes preserves hidden conversations and
unsent drafts; it does not stop their work.

If Learning updates fail temporarily, the last confirmed lesson conversations
remain visible. Wait for a successful refresh before selecting another lesson.
If access is denied or your account changes, another learner's conversations
must not remain available. If a conflicting-conversation error appears, retain
your work and ask the owner to inspect it. Colleague can explain these states;
it cannot grant access or repair saved identities. Ordinary **New session** and
**Archive session** are Working operations, not ways to start or end a lesson.
These rules apply on desktop and mobile; this prerequisite alone does not add
the visible mode control or complete lesson delivery.

## Keep the fresh session's link after renewal

When a completed renewal selects its confirmed fresh session, the address bar
follows that session, including when a background refresh selects it before the
renewal dialog opens it. Reloading or bookmarking the updated link opens the fresh
conversation, including after another renewal. Your chat and project-view choices
in the link stay unchanged. This works on desktop and mobile.

If you choose another session or navigate away while the link is opening,
Vibe64 keeps your newer choice. Ordinary session-tab selection keeps its existing
behavior. Colleague can explain renewal and inspect the saved result; opening a
fresh session does not authorize further coding work.

## Archive a session

Select the session, choose **Archive session**, and confirm **Archive session**
in the dialog. This stops its assistant and terminals, preserves the session and
removes its active workspace. Desktop and mobile use the same confirmation.
An OpenCode session can be archived before its main chat has started; an idle
assistant with no native conversation does not need a main-turn Stop request.
Its helper conversations and terminals still go through normal cleanup.
Archiving uses the session's saved assistant even after a server restart; it
does not require connecting a different assistant just to stop that session.
If history preservation fails, the operation reports the error and keeps the
workspace for retry. Resolve the reported problem, then retry **Archive session**.
Colleague can explain these steps and the reported error; the existing session
permissions and confirmation still apply.

## Chat availability

The chat checks which modes you can use and shows the effective assistant,
shared-backup label or an actionable connection message. These lightweight
checks do not start a model or download its repeated execution plan. Opening
**Chat mode** still shows the available choices; access is checked again when
work is sent. Colleague can explain an unavailable mode, but cannot grant access.

## Open the coding agent's terminal

Open **Dashboard → AI Terminal**, then select **Start Codex**, **Start Claude
Code** or **Start OpenCode**, depending on the session's agent. The terminal
continues that session's native conversation. **Close terminal** stops its
interactive terminal; starting it again resumes the saved conversation.

Claude opens a new interactive process for the current saved conversation. Finish
or stop an active chat turn before selecting **Start Claude Code**. The idle chat
process stops first, and chat is unavailable while the terminal is open. Use
**Close terminal** to return to chat. Even with a saved Claude connection, its
interactive terminal may request first-use setup or sign-in. Complete the native
steps yourself; Colleague can explain them but cannot sign in for you.

Click inside the terminal before typing or pasting. Text and Enter are delivered
in the order you entered them, even while the server checks terminal access.
If an input error appears, inspect the terminal before entering the command again;
the error does not mean that earlier input was discarded or rolled back.
Colleague can explain the error, but terminal commands remain your interaction.

A resumed Codex terminal keeps the shared server's saved permissions. Codex may
still show its own OpenAI sign-in screen when Main chat uses an external model:
its terminal checks the shared server's account before opening the conversation.
An external model connection alone does not satisfy that native sign-in. Complete
the offered account sign-in yourself, or close the terminal and continue in Main
chat. Colleague can explain the steps, but cannot complete your sign-in.

## Leave a terminal on mobile

AI Terminal fills small screens. Use **Exit full screen** in its header to
restore the page and its **Dashboard section** selector. This keeps the terminal
running. Use **Full screen** to enlarge it again. **Close terminal** stops that
terminal; it is a separate control.

The same full-screen controls appear on other non-collapsible terminal views.
Task output with a **Collapse** control keeps that existing way back. Colleague
can explain these controls or open another view through its navigation action;
leaving a view does not authorize stopping its work.

## Leave a dashboard tool

On mobile, use **Back to dashboard** from Database, Files, Changes or System,
then use **Dashboard section** to select another page. The back control works
even when you opened the tool from a direct link or its data is still loading.
Database opens Overview when the link does not specify a view; selecting ERD
or Data updates that view in the URL.

Colleague can explain these controls or navigate to another dashboard section
through its existing navigation action when you ask it to.

## Understand assistant activity

The dot beside a session tab pulses while that session reports active assistant
work, including when you are viewing another session. It stops when that work
finishes; you do not need to select the session to see the change. This also
works immediately after opening the project, before you have visited that
session. If its activity cannot be read, the dot does not claim it is working.

**Loading assistant…** means the initial assistant connection is being prepared,
including after you select a different assistant. Checking an already healthy
connection keeps its current activity visible. A failed check or disconnected
browser shows recovery information and, when available, **Retry**.
Switching back to a loaded session reveals its existing chat without reloading
history or checking the assistant again. Hidden chats continue receiving live
updates, including changes to AI access and configuration. An empty set of tabs
does not prove that background work stopped. Colleague should inspect the exact
session before reporting its state. Returning after a real
connection loss can still require recovery. Known repository state is also reused;
explicit Refresh and checks for changes made outside Vibe64 remain available.
Opening a session also checks your AI access. Sending waits for that result;
the pending check does not itself mean the connection is unavailable. A confirmed
unavailable connection or access error is shown after the check returns.
If chat stays on gray loading rows while the application Preview still works,
use **Reconnect** or **Retry connection** when shown, then reload the browser tab
if it remains stuck. Report the selected session and any failed chat/access
request status when asking for help; do not share cookies or tokens. Colleague can identify the
selected session and explain recovery, but cannot read the browser console.

**Assistant is working…** means the turn is active. Its animated dots require
the provider to report a live reasoning phase. Tool use and waiting between
provider events can keep the turn active without animating those dots. Reasoning
summaries may arrive late in a response; absent dots alone do not prove a stall.
Reduced-motion preferences also disable the animation.

Colleague can explain these states. It should verify current session activity
through its available read operations before claiming that work has stopped.


## Lessons that do not need a practice workspace

A lesson without practical workspace steps can retain its own conversation and
saved lesson identity without creating a project, Git checkout or Preview app.
It does not use a coding session's source as a substitute. Your existing working
sessions and saved lessons remain separate.

If the lesson reports that its execution directory is missing, keep the session
and ask the administrator to inspect or restore it. Reloading does not rebuild
that directory or repeat your request. Archived lesson history remains readable,
but cannot continue running as the archived conversation. Colleague can explain
the reported error; it cannot grant another learner's access or silently replace
the saved lesson with newer content.

This session foundation adds no lesson-launch control. Lesson selection and
Main teaching must be connected through the existing learning flow before this
can be used from the interface; the ordinary **New session** control still creates
a working session with source.

## Pin a source session

Select the source session, then choose **Pin session as project source** beside
Save. Its pin icon becomes filled. One session per project can be pinned.
Pinning and unpinning work while the assistant is busy or reconnecting; they do
not require an AI connection. Archive or renewal already in progress still blocks pinning.
You can still browse and work in other session tabs; the server-selected source
link stays on the pinned session. Cross-project requests addressed to the
server-selected session also keep that destination. Pinning does not Save,
publish, freeze file contents, or deploy.

The pinned session cannot be archived or renewed, and the project cannot close
or be closed by idle cleanup. Closing your browser does not remove the pin.
The pin survives server restarts. To change it, return to the pinned session and
choose **Unpin session**; tab selection then controls the source link again.
Other sessions show a disabled pin with **Unpin the project's pinned session first**.
Desktop and mobile use the same pin button beside Save. Learning sessions have
no source pin. Separate project pins do not affect each other.

Colleague can explain the pin or, on your explicit request, pin/unpin a named
session through its session action. Source cleanliness and publication checks
for host updates still apply to the pinned source.
