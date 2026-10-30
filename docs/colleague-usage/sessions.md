# Create and switch sessions

Use **New session** (+), or **Create session** when there are no open sessions,
to open **Start an AI session**. It shows **Runs on your main AI:** and the main
AI's model. A saved setup appears straight away: the dialog does not wait for
each AI tool's model list or start any AI tool. Without a change the new session
runs on the main AI and starts with Senior.

To run only this new session on another AI, for example DeepSeek, select
**Change** beside the main AI. It opens **Custom AI**, the same choice as a
chat's **Custom** mode, and only then loads the model choices. Choose
**Orchestrator**, **Model** and **Thinking** and press **Apply**; a loading
error offers **Retry**, and **Configure more AIs** opens account setup when the
provider you want is not connected. **Cancel** there keeps the current choice. The
dialog then shows **This session runs on:** with your choice and says the
session **Starts in Custom**; the new chat runs on that AI in **Custom** mode,
and your main AI and other sessions are unchanged. **Use main AI** discards the
choice, as does closing the dialog. Choosing the main AI's own model keeps the
main AI. **Change** is offered only to the person who manages the workspace's
AI; a team member's sessions always start on the owner's main AI.

To change the main AI for every session instead, select **Change main AI for
all sessions**, which opens AI setup. Review any branch choice,
then select **Create session** (or
**Create branch & session**). While **Creating session…** is shown, the dialog
shows a progress bar and explains that it is copying the project source. It stays open: clicking outside,
pressing Escape, Close and Cancel cannot dismiss it. On success it closes and
opens the new session. If creation fails, review the error and retry or dismiss
the dialog. This works the same way on desktop and mobile.

On a phone the session's header controls (**New session** (+), a local
project's Git branch button and the session's GitHub account) sit beside the
project name while the chat pane is shown. With Preview or Dashboard shown they
make room for that pane's controls; choose **Show chat** to reach them again.
On a phone the GitHub account shows only its GitHub icon; on a computer hover
it to see which account the session's GitHub commands run as.

For a project with connected projects, the dialog closes once the session's own
source is ready. The session then shows **Preparing workspace…** while Vibe64
prepares the connected projects together, naming those still in progress (for
example **Preparing connected projects: jskit-ai, genesis (1 of 3 ready)**),
followed by the project's setup steps. The assistant can start when preparation
finishes; see [Prepare a session after updating its source](workspace-preparation.md)
for failures and retry.

Creation through an action without an explicit AI choice uses the main AI. An
explicit model choice, like **Change** in the dialog, makes the new chat Custom
and is preserved even when it is unavailable: fix its account or AI setup, or
choose another AI, before retrying. A team member's new
session still records the owner's main AI; main chat runs on the owner's AI. Colleague
can read the available choices and explain recovery; it must not claim a failed
request left no saved lesson without checking that lesson's current state.

The new session appears in the session list after its source checkout is ready.
Refreshing during creation does not report that checkout as missing. If a
**session needs attention** notice remains after creation, use **Check again**;
if the checkout is still missing, use **Copy recovery details** and ask your
administrator to restore the original work from a verified backup. Colleague
can explain the notice, but cannot restore missing source through session creation.

A session's checkout works on its own branch, `vibe64/<session id>`. A new
session keeps no local copy of the branch it was created from (such as `main`):
nothing would keep that copy current, so it would look like the latest saved
work when it is not. **Git log**, **Current changes**, **Save** and **Update**
read the project's saved work themselves. In a terminal the remote-tracking name
(such as `origin/main`) remains. The local copy is kept only when Git shows it
holds commits found nowhere else. Sessions created before this change lose
their copy once, during the Vibe64 update that brings it, under the same check;
one whose copy holds such commits, or whose checkout is not on its own branch,
keeps it.

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

A link whose session is not one of this project's open sessions (another
project's session, or one that has since been archived) loses its `session`
part once the session list loads, and the project opens its usual session
instead; no chat, Preview or other session work starts for the unknown
session. Switching projects always starts the next project from its own
sessions, never the previous project's.

The session header gives its room to session names first, then **Save**, which
never leaves the header. The other actions follow in priority order: **Temporary
AI**, **Renew session**, **Pin session**, **Pull request** and **Prepare
workspace**. When the pane is too narrow, the lowest-priority action moves into
**Session actions** (three dots) first, so Prepare workspace goes first and
Temporary AI last; widening the pane brings them back. All header actions use
small, light outline icons. Update uses a vertical line through a circle,
distinct from the branching pull-request icon. Hover or focus a control to read
its action label.

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

## Lessons and session navigation

The session tabs and chat panel list the project's ordinary sessions. The **L**
button opens the Learning environment above the page without changing the
selected session (see [Choosing lessons and courses](learning-mode-ui.md)).

A lesson's practice sessions are ordinary sessions of its practice project and
appear with its other sessions. **New session** and **Archive session** are
ordinary session operations, not ways to start or end a lesson: start, resume
and end lessons through Learning → **Courses** and Colleague. Colleague can
explain this; it cannot grant access or repair saved identities. These rules
apply on desktop and mobile.

## Keep the fresh session's link after renewal

When a completed renewal selects its confirmed fresh session, the address bar
follows that session, including when a background refresh selects it before the
renewal dialog opens it. Reloading or bookmarking the updated link opens the fresh
conversation, including after another renewal. Your chat and project-view choices
in the link stay unchanged. This works on desktop and mobile.

The renewal dialog offers the same main AI as **Start an AI session**: the
owner's Senior, or its recommendation when Senior has no saved choice. Like that
dialog, it shows a saved choice without waiting for each AI tool's model list,
and opening a session reads none either; only opening **Models** does. Keeping
that AI leaves the fresh chat on the main AI; picking a different model makes
it Custom.

If you choose another session or navigate away while the link is opening,
Vibe64 keeps your newer choice. Ordinary session-tab selection keeps its existing
behavior. Colleague can explain renewal and inspect the saved result; opening a
fresh session does not authorize further coding work.

## Archive a session

Select the session, choose **Archive session**, and confirm **Archive session**
in the dialog. This stops its assistant and terminals, preserves the session and
removes its active workspace. Desktop and mobile use the same confirmation.
Archiving does not Save. Work the project does not have yet, such as an added
starter, stays only in the session archive, and archived sessions cannot restore
source to the project. When the session has unsaved changes, the dialog says how
many and its button reads **Archive without saving**; choose **Cancel**, then
**Save**, to keep them. When Vibe64 has not yet confirmed whether the work is
saved, the dialog says so. A new session starts from the project's saved source,
so it does not contain an archived session's unsaved work.
An OpenCode session can be archived before its main chat has started; an idle
assistant with no native conversation does not need a main-turn Stop request.
Its helper conversations and terminals still go through normal cleanup.
Archiving also cancels pending Main and temporary-chat routing, waits for its
owned helpers to stop, then closes native work through the normal cleanup path.
You do not need to send the pending request or change AI accounts to close it.
If routing cleanup takes longer than 30 seconds, the session stays available
with a retryable cleanup error; choose **Archive session** again. A new request
arriving during cancellation can also require another Close attempt. Pinning,
renewal and active workspace preparation still prevent archival.
Archiving uses the session's saved assistant even after a server restart; it
does not require connecting a different assistant just to stop that session.
If a local editor ends uncleanly (a crash, a closed terminal or a forced
shutdown) while Claude is working, its Claude process ends with it, and after
the restart that chat can be read, messaged, archived and removed as usual.
A session whose workspace could not be created never started its assistant, so
archiving it skips that assistant's cleanup; it also does not hold the project
open or make project Close fail.
A session whose workspace could not be created, or whose source an earlier
archive attempt already removed, can still be archived the same way.
When Vibe64 starts, it finishes archives a restart interrupted. A session it
cannot finish is named in the server log with the reason, and the other sessions
are still finished. If the server is too busy to open an archived session, for
example under memory pressure, the error says so and you can try again later;
the archive itself is not damaged.
If history preservation fails, the operation reports the error and keeps the
workspace for retry. Resolve the reported problem, then retry **Archive session**.
When a helper such as a Database copilot, a source explanation or a naming helper
cannot be closed, archiving still stops every other part of the session first.
The error then names each part that could not stop, such as
`Database copilot: The database copilot helper could not be closed: <reason>.
Retry before asking again.`, and a source explanation or copilot that could not
close is kept so the retry closes it. Resolve the named reason, often an AI
account to reconnect, then retry **Archive session**. Archiving also closes the
session's open temporary chats in the browser; their saved history stays with
the archived session.
If the last open session cannot be archived, its chat is selected again so you
can inspect the failure and retry. If another session is already selected, that
selection stays in place and the failed session becomes available in its tab.
Colleague can explain these steps and the reported error. When you explicitly
ask it to archive a named session, it first checks that session's saved-work
status. If the session has unsaved changes, or their status is unconfirmed, it
tells you how many, offers **Save**, and archives only after you confirm
archiving without saving. It archives through the same action; the same pin,
renewal and preparation guards apply, and it reports a failed cleanup for retry.
Stopping an agent or ending Colleague is never an archive request.

## Chat availability

The chat checks which modes you can use and shows the effective assistant or an
actionable connection message. Modes that run on the owner's AI are not listed
for team members. These lightweight
checks do not start a model or download its repeated execution plan. Opening
**Chat mode** still shows the available choices; access is checked again when
work is sent. Colleague can explain an unavailable mode, but cannot grant access.
The owner's Colleague can change Main chat's mode on request; a team member's
cannot, outside their own lesson (see [Main chat approvals](main-chat-approvals.md)).

To open the coding agent's own terminal, or leave it on a phone, see [Open the coding agent's terminal](session-terminal.md).

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
While the dot pulses, that tab's green **All work is saved** tick turns grey,
because the assistant can still change files; see
[Review, Save and work with GitHub](github-work.md).

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
When the session's AI account is not connected, the chat names it as AI
Accounts does, for example **Claude isn't connected. Reconnect it in AI
Accounts or choose another model. Your draft is kept.** Other accounts read
**Codex (OpenAI)**, **DeepSeek**, **GLM · Coding Plan**, or an OpenCode
connection's own name such as **OpenAI**. When Vibe64 cannot tell which account
is missing, for example a removed OpenCode connection to a provider it does not
know by name, or an OpenCode key whose chosen model is not enabled, the chat
shows **The selected AI connection is unavailable. Your draft is kept.**
**Go to AI Accounts**
opens AI Accounts in Account settings to reconnect it; to switch instead, choose
another model in **Models**. Nothing is sent until the chat can reach a connected AI. Desktop
and phone show the same notice; Colleague can explain it, but signing in
remains your step.
If chat stays on gray loading rows while the application Preview still works,
use **Reconnect** or **Retry connection** when shown, then reload the browser tab
if it remains stuck. Report the selected session and any failed chat/access
request status when asking for help; do not share cookies or tokens. Colleague can identify the
selected session and explain recovery, but cannot read the browser console.

**Sending to assistant…** covers delivery of your message. With Claude,
**Assistant is working…** replaces it as soon as Claude starts the turn, before
its first reply arrives; the composer is not left without a status in between.
**Assistant is working…** means the turn is active. Its animated dots require
the provider to report a live reasoning phase. Tool use and waiting between
provider events can keep the turn active without animating those dots. Reasoning
summaries may arrive late in a response; absent dots alone do not prove a stall.
Reduced-motion preferences also disable the animation.

With Claude, **Reply ready · background task still running…** (Main) means
Claude has posted its answer, but a command it started in the background is
still running. The answer above is complete and readable. The turn stays active
until that command finishes or times out, and Claude may then add a short
follow-up reply after the answer; earlier replies stay visible. Temporary chat
shows the same text. Press **Stop** if you do not need the background command.

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

Start such a lesson from Learning → **Courses** (see
[Choosing lessons and courses](learning-mode-ui.md)); the ordinary
**New session** control still creates a working session with source.

## Pin a source session

Select the source session, then choose **Pin session as project source** in the
session header, or **Pin session** in **Session actions** when the header is
narrow. Its pin icon becomes filled. One session per project can be pinned.
Pinning and unpinning work while the assistant is busy or reconnecting; they do
not require an AI connection. Archive or renewal already in progress still blocks pinning.
You can still browse and work in other session tabs; the server-selected source
link stays on the pinned session. Cross-project requests addressed to the
server-selected session also keep that destination. Pinning does not Save,
push, freeze file contents, or deploy.

The pinned session cannot be archived or renewed, and the project cannot close
or be closed by idle cleanup. Closing your browser does not remove the pin.
Idle cleanup otherwise closes an open project, with its Preview, terminals and
assistant processes, 30 to 35 minutes after its last recorded activity (opening
it, session changes and assistant work). Leaving the project or closing the
browser does not close it sooner; close the project yourself to free its
memory at once, or ask Colleague to close it: it uses the same Close, which also
stops other sessions' running work, and reports a failed Close as incomplete
cleanup. A running assistant turn or active goal keeps it open. If one of the
project's sessions cannot be checked, idle cleanup leaves the project open rather
than guess, and the server log names that session; close the project yourself to
free its memory.
The pin survives server restarts. To change it, return to the pinned session and
choose **Unpin session**; tab selection then controls the source link again.
Other sessions show a disabled pin with **Unpin the project's pinned session first**.
Desktop and mobile use the same pin button beside Save. Learning sessions have
no source pin. Separate project pins do not affect each other.

Colleague can explain the pin or, on your explicit request, pin/unpin a named
session through its session action. Source cleanliness and saved-work checks
for host updates still apply to the pinned source.

## Answer clarification questions

When the agent asks numbered questions, answer each question using its own choices
or a typed response. This works the same way on desktop and phone. Choices should
appear beneath the question they answer, with one alternative per option. If an
option combines opposite answers (for example, “Yes / No”) or belongs to another
question, do not use it to communicate approval. Ask the agent to restate the
questions with separate choices. Colleague can explain the questions; your chosen
answers determine what work is authorized.
