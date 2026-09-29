# Switch between open sessions

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
