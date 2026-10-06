# Create and switch sessions

Use **New session** (+), or **Create session** when there are no open sessions,
to open **Start an AI session**. Choose an available orchestrator, review any
branch choice, then select **Create session** (or **Create branch & session**).
While **Creating session…** is shown, the dialog stays open: clicking outside,
pressing Escape, Close and Cancel cannot dismiss it. On success it closes and
opens the new session. If creation fails, review the error and retry or dismiss
the dialog. This works the same way on desktop and mobile.

Colleague can explain the choices or create a session through its session
creation action when you explicitly ask it to do so.

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

Colleague can explain the tabs and open an accessible session through its
navigation action when you explicitly ask it to do so.

## Archive a session

Select the session, choose **Archive session**, and confirm **Archive session**
in the dialog. This stops its assistant and terminals, preserves the session and
removes its active workspace. Desktop and mobile use the same confirmation.
If history preservation fails, the operation reports the error and keeps the
workspace for retry. Resolve the reported problem, then retry **Archive session**.
Colleague can explain these steps and the reported error; the existing session
permissions and confirmation still apply.

## Open the coding agent's terminal

Open **Dashboard → AI Terminal**, then select **Start Codex**, **Start Claude
Code** or **Start OpenCode**, depending on the session's agent. The terminal
continues that session's native conversation. **Close terminal** stops its
interactive terminal; starting it again resumes the saved conversation.

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
updates, including changes to AI access and configuration. Returning after a real
connection loss can still require recovery. Known repository state is also reused;
explicit Refresh and checks for changes made outside Vibe64 remain available.
Opening a session also checks your AI access. Sending waits for that result;
the pending check does not itself mean the connection is unavailable. A confirmed
unavailable connection or access error is shown after the check returns.

**Assistant is working…** means the turn is active. Its animated dots require
the provider to report a live reasoning phase. Tool use and waiting between
provider events can keep the turn active without animating those dots. Reasoning
summaries may arrive late in a response; absent dots alone do not prove a stall.
Reduced-motion preferences also disable the animation.

Colleague can explain these states. It should verify current session activity
through its available read operations before claiming that work has stopped.
