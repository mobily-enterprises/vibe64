# Chat availability and assistant activity

This continues [Create and switch sessions](sessions.md): which chat modes you can use, what a session tab's
activity dot and the chat's status lines mean while the assistant works, and how to reconnect a chat.

## Chat availability

The chat checks which modes you can use and shows the effective assistant or an
actionable connection message. Modes that run on the owner's AI are not listed
for team members. These lightweight
checks do not start a model or download its repeated execution plan. Opening
**Chat mode** still shows the available choices; access is checked again when
work is sent. Colleague can explain an unavailable mode, but cannot grant access.
The owner's Colleague can change Main chat's mode on request; a team member's
cannot, outside their own lesson (see [Main chat approvals](main-chat-approvals.md)).

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

With Claude, **Still working · waiting on 2 background commands…** (Main, with
the number running) means Claude has posted its answer, but commands it started
in the background are still running. The answer above is complete and readable.
The turn stays active until that command finishes or times out, and Claude may
then add a short follow-up reply after the answer; earlier replies stay visible.
Temporary chats and an AI task's Chat show the same text without the number.
In Main, **Stop** ends Claude's turn as Esc does in Claude Code and keeps Claude
running, so its background commands and agents run on: the chat stops showing
them as work, and when one reports back Claude answers it in a reply of its own.
Your next message goes to the same Claude. Pausing a goal or a Vibe64 restart
ends that background work. In a temporary chat or an AI task's Chat, **Stop**
also ends the background command, so press it there if you do not need it.

Colleague can explain these states. It should verify current session activity
through its available read operations before claiming that work has stopped.

## Reconnect a chat

If the conversation shows **Conversation subscription failed.**, choose
**Reload chat** to reconnect to the same session. This reads its saved history
and restores updates without sending your draft or repeating an earlier request.
Standalone Vibe64 supports this through the local editor for its selected project;
it does not require a separate login. Keep using the editor's localhost
address. If the error persists, report the project, session and exact error.
On phones, open the chat pane to find the same control. Colleague can explain
recovery and open the session; the person selects **Reload chat**.
