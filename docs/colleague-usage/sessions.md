# Create and switch sessions

Use **New session** (+), or **Create session** when there are no open sessions,
to open **Start an AI session**. It shows **Runs on your main AI:** and the main
AI's model. A saved setup appears straight away: the dialog does not wait for
each AI tool's model list or start any AI tool. Without a change the new session
runs on the main AI and its chat starts in **Auto**, as the dialog's **Starts in
Auto** line says, with every [Chat settings](chat-settings.md) switch on.

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
opens the new session; a large project can take minutes, and a dropped
connection never creates a second session. If creation fails, review the error
and retry or dismiss the dialog. This works the same way on desktop and mobile.

On a phone the session's header controls (**New session** (+), a local
project's Git branch button and the session's GitHub account) sit beside the
project name while the chat pane is shown. With Preview or Dashboard shown they
make room for that pane's controls; choose **Show chat** to reach them again.
On a phone the GitHub account shows only its GitHub icon; on a computer hover
it to see which account the session's GitHub commands run as.

For a project with connected repositories, the dialog closes once the session's
own source is ready. The session then shows **Preparing connected repositories**
while Vibe64 makes the session's own copy of each one (one **[Connected]** line
per repository in the output), followed by the project's setup steps. The assistant can start when preparation
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

A session's checkout works on its own branch, `vibe64/<session id>`, and keeps
no local copy of the branch it was created from (such as `main`): nothing would
keep it current, so it would look like the latest saved work when it is not.
**Git log**, **Current changes**, **Save** and **Update** read the saved work
themselves; in a terminal, `origin/main` remains. The copy is kept only when Git
shows it holds commits found nowhere else or the checkout is not on its own
branch. Older sessions lose their copy once, during the Vibe64 update that
brings this, under the same check.

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

Select a session tab above the chat, on its name or anywhere but its work icon,
to open that session's conversation and work.
The selected tab includes the Archive session control. Hover or keyboard focus
alone does not select a session.

Hover or keyboard-focus a session tab for one second to read its details, or
click or tap the work icon after the tab's name, such as the green tick of
**All work is saved**: every device shows it, and it opens the same details
without selecting the session; another click or tap closes them. With the
keyboard, Tab to the icon and press Enter or Space. The details
list **Status**, **Assistant**, **Model**, **Work**, **Saves to**, **Session**,
**Session branch** and **Created**, with **Rename session**. **Saves to**
always names where that session's **Save** puts its work: the repository in
short form (`owner/name` for GitHub, the project's short name for Vibe64 Git,
or **Project repository** for a project folder on this computer, never a
folder path or sign-in details) followed by the branch, for example
`example-owner/example-app · main`. When the branch is not the project's main
branch, such as a session opened on another branch or a pull request's branch,
it is a highlighted chip followed by **(not main)** (naming the project's main
branch), so a session that saves somewhere else is obvious; a fork's branch
with the main branch's name reads **(not this project's repository)**. Until
Vibe64 has checked the session's work it reads **Checking…**, and **Unknown**
if that check failed, until the next check. **Session branch** is the
session's own working branch, `vibe64/<session id>`, not where Save goes. The
**Save changes** review and the Save button's hint name the destination the
same way. Reading the details changes nothing; it is the person's step, on
desktop and mobile alike.

A project link opens the session named in its address. The address always
names the session on screen: selecting another tab, starting a new session or
archiving the one shown changes its `session` part (and drops the previous
session's chat), so a reload, a copied link or the address opened again shows
the session you were looking at. A session renewed while you look at it hands
its address to its successor with the same chat, since the work goes on there.
These changes replace the address, so the
browser's **Back** leaves the project rather than stepping through sessions.
Following a different session link selects its named session. A session being
archived is temporarily unavailable for selection.

Vibe64 remembers the session you last opened in each project, per person.
Opening the project without a session in its address (project list, bookmark,
**Back** and in again, reload, another browser or device) goes straight to it;
the chat shows **Loading sessions.** until the session list is read. A session
named in the address, or opened by Colleague, wins and becomes the remembered
one. Tabs already open keep their selection. If the remembered session is
archived or no longer open, the project opens its usual session (the last tab)
without an error. Practice projects work the same way.

A link whose session is not one of this project's open sessions (another
project's session, or one that has since been archived) opens your remembered
session or the project's usual session instead once the session list loads, and
the address then names that session; no chat, Preview or other session work
starts for the unknown session. Switching projects always starts the next
project from its own sessions, never the previous project's.

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
chats or an open AI task, read their saved history and keep a plain text draft.
The draft's save state appears in that chat. Sending or changing assistant work waits for the
repository operation to finish. If an Update response is lost, use the saved
Update status and recovery controls before requesting another Update; a reload
does not establish that the first one failed.

Colleague can explain the tabs and open an accessible session through its
navigation action when you explicitly ask it to do so.

## Chat availability, assistant activity and reconnecting

[Chat availability and assistant activity](chat-activity.md) covers which chat modes you can use, what a
session tab's activity dot and the chat's status lines mean, and **Reload chat** when a conversation stops
updating.

## Open the coding agent's terminal

To open the coding agent's own terminal, or leave it on a phone, see [Open the coding agent's terminal](session-terminal.md).

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

## Archive a session

[Archive a session](session-archive.md) covers archiving, unsaved work, and
retrying a cleanup that fails.

## The session's temporary folder

Each session has its own temporary folder, `v64s-` and 12 letters and digits,
in the temporary folder Vibe64 itself runs with (on a hosted workspace, the
workspace's temporary folder). The AI's shell commands, and every program they
start, get it as `TMPDIR`, so their throwaway files, and the Git repositories
tests make, stay apart from every other session's. Commands can also run in it.
Its path is short whatever the workspace, project and session are called, so
the Unix sockets that tests and tools such as mobilynet's make below it fit the
107 characters a socket's path can hold. Vibe64 makes it on the AI's first
command, only for its own account and group, and empties it when the session is
archived or renewed; nothing in it is saved or kept in the session's archive.

When Vibe64 itself runs with a temporary folder so long that the session's
would leave no room for a socket, the AI does not start and each command
reports **This session's temporary folder … is too long for a Unix socket below
it**, naming the longest `TMPDIR` that fits. Start Vibe64 again with a shorter
`TMPDIR`, such as `/tmp`. On a hosted workspace this does not happen.

The AI's Git decides by the repository a command acts on: the folder it names
with `-C`, `--git-dir`, `--work-tree`, `GIT_DIR` or `GIT_WORK_TREE`, not just the
folder it runs from. A repository in the temporary folder gets plain local Git:
`init`, `clone`, `commit`, `log`, and `push` or `fetch` between repositories in
that folder all work, with none of the session's GitHub sign-in and not your Git
name and email (a test names its commits' author itself, with `GIT_AUTHOR_NAME`
and the like or `git -c user.name=...`). From the temporary folder Git can read
the session's source and connected repositories, for example
`git -C <source> rev-parse --show-toplevel` or a clone of the source; a command
that changes them follows their own rules, as when it runs inside them, and one
that would change them from the temporary folder (a clone into the source, a
push to it) is refused. Git on another session's folder, another project or the
temporary folder that holds every session's is refused too, with a message naming this
session's temporary folder for throwaway repositories. In the source, the Git and
gh commands that reach GitHub with your sign-in, the AI's and Save's, run no
program the AI or the repository picked
(see [What the AI's Git does with your GitHub sign-in](ai-save-and-update.md#what-the-ais-git-does-with-your-github-sign-in)).

## Leave a dashboard tool

On mobile, use the **Dashboard** button at the top of Database, Files, Changes or
Architecture, then use **Dashboard section** to select another page. The **Dashboard** button works
even when you opened the tool from a direct link or its data is still loading.
Database opens Overview when the link does not specify a view; selecting ERD
or Data updates that view in the URL.

Colleague can explain these controls or navigate to another dashboard section
through its existing navigation action when you ask it to.

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
push, freeze file contents, or publish.

The pinned session cannot be archived or renewed, and the project cannot close
or be closed by idle cleanup. Closing your browser does not remove the pin.
Idle cleanup otherwise closes an open project, with its Preview, terminals and
assistant processes, 30 to 35 minutes after its last recorded activity (opening
it, typing in one of its chats, session changes and assistant work). Opening the
project while idle cleanup is closing it waits for that Close, however long it
takes, then opens the project again. A chat message sent then, or after the Close, also reopens the
project and then reaches the assistant; if the project cannot open, the message
stays marked as not sent, with the reason. Starting Preview or another output after
the Close reopens the project the same way, also when the coding agent or a check
starts it from the session (`vibe64-helper preview ensure` or `restart`, browser
tests), with nobody visiting the project; one asked for while the project is still
closing is refused with **The project is closing, so nothing in it can start now**:
run it again once the Close has finished. A Preview that restarts by itself, after
a workspace preparation, does not reopen a closed project. If idle cleanup closes the project
while a chat holds a draft or an undelivered message, the page stays, showing
**Idle cleanup closed this project** with **Reopen**; sending the message or
choosing **Reopen** opens it again. Otherwise the page returns to the project
list. Leaving the project or closing the browser does not close it sooner; close the project yourself to free its
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
