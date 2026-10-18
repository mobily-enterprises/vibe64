# Colleague watches and operations

Ask Colleague to watch work or inspect a recorded operation. Watching does not
authorize more coding work. For chat controls and assignments, see
[Talk with Colleague](colleague.md).

Ask “Tell me when that agent replies, even while it keeps working” to request a
response watch. Colleague can watch the exact Main or temporary conversation and
report its next completed message, including a progress reply during an active
goal. Partial words, thinking and tool output do not trigger it. A reply does not
mean the task is done: Colleague reports what the agent actually said and whether
work continues. Ask for an ongoing watch to receive later responses too; a
one-shot watch ends after its first delivered report. Ask “Tell me when the work
finishes” for a completion watch instead. Watching starts only on your request,
checks your current project access and does not stop or resend the coding work.

Use the eye-and-count **Watches and assignments** button beside Previous
conversations to inspect ongoing work. It opens a separate view; nothing is
listed below chat. **Resume** restarts a paused watch, and **Cancel** removes its
watch without stopping the agent. Close this view to return to the same chat and
draft. On phone, use **Close watches and assignments** in its header. Ask
Colleague to list, cancel or resume watches if you prefer.

In an active Learning task, “Watch me while I do this” starts the same polling
watch shown in that dialog; asking how it works does not start anything. You can
ask Colleague to read, pause, resume or stop it. Learning status reports the exact
goal/target, active/paused/unavailable state, latest valid observation and time,
last delivered-help receipt, and any saved assessment outcome. Observation and
help are not themselves proof of completion. When Main points you to a place
(a ring and caption on the real control), the view switch you then make yourself,
such as Preview to **Dashboard → Database** or **Dashboard → Files**, is observed as
your step; a database sub-view switch (Overview/ERD/Data) is not yet observed
separately. Besides Vibe64 view and control
steps, the watch notices a failed data-changing request that your own click or
submit in the visible practice-app **Preview** started (method, a lesson-declared
path or `other`, status and failure code only—never typed text, bodies, headers
or queries); Main gets at most one hint for it per 30 seconds. A separate Learning watcher checks
only those validated facts; Colleague manages its controls, while Main receives
bounded updates and never checks your activity itself. Each observation is
delivered to Main once. Switching between the practice project's **Preview** or
**Dashboard** and the graduation-cap **Learning** option, and between project panes such as
**Preview**, **Dashboard → Database** and **Dashboard → Files**, is observed; a
lesson without a practice project, such as Lesson 0, can be watched too. Stop
removes the watch without stopping Main, the lesson or the app, and polling grants
no unrelated mutation permission. For the eye dialog's controls, see
[Watching a lesson step by step](learning-lesson-watch.md).

You can ask “Which projects do I have?” from any page, including AI Accounts;
no open project is required. Colleague checks the projects available to you.
A completed or attempted application action also appears under **Operations**
beside Previous conversations. Open it to see Vibe64's recorded state—executing,
completed, failed or unknown—and the saved project/session/conversation target.
**Open target** uses the normal project and chat navigation without rerunning the
action. **Prepare retry** writes a cautious follow-up into your draft after a
verified failure; review it and press **Send** yourself. It does not replay the
action when clicked. For an unknown outcome, use **Prepare inspection** instead:
the draft asks Colleague to inspect the saved target and forbids repetition until
the real outcome is known and you explicitly continue. Internal catalogue lookups
are not shown as product operations. These controls work the same way in the
desktop drawer and full-screen phone chat.
Opening or restoring Colleague moves keyboard focus into the message box. From
there, **Tab** reaches the model, history, Operations, watch, Send and Stop
controls that are currently available. **Escape**, **Minimize conversation** and
**Close Colleague** return focus to the Colleague launcher; the full-screen phone
chat keeps keyboard focus within its dialog while it is open.
The avatar and its voice controls keep their own space above the conversation;
they do not cover the first message on narrow screens.
An unfinished operation retained from before these product receipts existed is
shown as **Unknown** after restart, without an invented target or retry. Inspect
the affected area before deciding whether to make a new explicit request.
A malformed lookup returns a validation error. An unavailable tool runs no action;
Colleague receives its verified refusal and can give a final reply. A provider failure
or uncertain operation stops the turn. Your request is retained. Read the reported error and
inspect the action's target before trying again; you can select another model
once the turn has stopped. If a model change was interrupted, select that same
model again to finish the change before sending another message.
An operation-limit error keeps completed results; send a follow-up. Repeated
invalid responses keep your message; retry or choose another model after the
turn stops. This does not mean your projects are missing or your account disconnected.

Colleague can look up an operation and then carry it out within the same request.
Changing its focused project or switching between your request and background
observation requires a new lookup. Current permissions still apply: an earlier
lookup cannot make an operation available after access is removed.
