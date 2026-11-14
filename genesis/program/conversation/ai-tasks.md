# AI tasks

An AI task is a specific job given to an agent: a problem, the conversation that
works on it, the proof that it worked, and an outcome. People find it in one
window that presents the problem and its solution, or the lack of one, together.
A task ends **Done** or **Not done**. Done is proved, never assumed; Not done is
decided by a person. Every task Vibe64 or Colleague starts is an AI task: Fix it
with AI on Update, Save, workspace preparation, preview sign-in and project setup, the setup screen's create, inspect and adopt requests, the Data
overview, a page's AI refresh, and Colleague's own requests and reviews. A person's own request is a
temporary chat, never an AI task ([temporary assistance](temporary-assistance.md)).
The `20261104-temporary-repair-chats-removed` state upgrade deletes the repair chats
that the repair flows opened as temporary chats before AI tasks, as Close deletes
one, and keeps every person's and Colleague's temporary chat (`docs/state-upgrades.md`).
A live repair chat with a Codex or OpenCode conversation is handed to Close as a
closing record, which Close finishes after that engine's next turn in the session
or before the session is archived or renewed
([temporary assistance](temporary-assistance.md)). An AI task whose Close was
interrupted finishes closing the same way. The `20261110-archived-closing-chats`
upgrade cleans up the closing records older archives still hold.

## Sources

- Main: `packages/vibe64-ai-tasks/src/server/service.js`
- `packages/vibe64-ai-tasks/src/server/aiTaskMachine.js`
- `packages/vibe64-ai-tasks/src/server/aiTaskRunner.js`
- `packages/vibe64-ai-tasks/src/server/aiTaskKinds.js`
- `packages/vibe64-ai-tasks/src/server/hostKinds.js`
- `packages/vibe64-ai-tasks/src/server/aiTaskActions.js`
- `packages/vibe64-ai-tasks/src/server/registerRoutes.js`
- `packages/vibe64-ai-tasks/src/server/inputSchemas.js`
- `packages/vibe64-ai-tasks/src/server/Vibe64AiTasksFeature.js`
- `packages/vibe64-ai-tasks/src/server/kinds/request.js`
- `packages/vibe64-ai-tasks/src/server/kinds/repository.js`
- `packages/vibe64-ai-tasks/src/server/kinds/update.js`
- `packages/vibe64-ai-tasks/src/server/kinds/save.js`
- `packages/vibe64-ai-tasks/src/server/kinds/workspaceSetup.js`
- `packages/vibe64-ai-tasks/src/server/kinds/previewIdentity.js`
- `packages/vibe64-ai-tasks/src/server/kinds/projectSetup.js`
- `packages/vibe64-ai-tasks/src/server/kinds/databaseOverview.js`
- `packages/vibe64-ai-tasks/src/server/kinds/pageRefresh.js`
- `packages/vibe64-ai-tasks/src/server/pageRefreshTasks.js`
- `packages/vibe64-ai-tasks/src/shared/aiTaskPhases.js`
- `packages/vibe64-ai-tasks/src/client/aiTaskKey.js`
- `packages/vibe64-ai-tasks/src/client/useAiTaskHost.js`
- `packages/vibe64-ai-tasks/src/client/useAiTasks.js`
- `packages/vibe64-ai-tasks/src/client/useAiTaskWindow.js`
- `packages/vibe64-ai-tasks/src/client/useAiTaskFocus.js`
- `packages/vibe64-ai-tasks/src/client/aiTaskProjection.js`
- `packages/vibe64-ai-tasks/src/client/aiTaskFit.js`
- `packages/vibe64-ai-tasks/src/client/aiTaskMessages.js`
- `packages/vibe64-ai-tasks/src/client/Vibe64AiTaskWindow.vue`
- `packages/vibe64-ai-tasks/src/client/Vibe64AiTaskProgress.vue`
- `packages/vibe64-ai-tasks/src/client/Vibe64AiTaskOutcome.vue`
- `packages/vibe64-ai-tasks/src/client/Vibe64AiTaskButton.vue`
- `packages/vibe64-ai-tasks/src/client/Vibe64AiTaskTray.vue`
- `src/components/studio/vibe64-session/Vibe64AiTaskHost.vue`
- `src/components/studio/vibe64-session/Vibe64AiTaskChat.vue`
- `src/composables/useAiTaskConversation.js`
- `src/composables/useAiTaskConversationRecord.js`
- `src/composables/useAiTaskConversationSaves.js`
- `src/composables/useAiTaskConversationMessages.js`
- `src/lib/vibe64AiTaskConversation.js`
- `src/composables/useVibe64TemporaryAiColleagueView.js`
- `packages/vibe64-terminals/src/server/temporaryConversationLifecycle.js`
- `packages/vibe64-terminals/src/server/temporaryConversationTurns.js`
- `packages/vibe64-terminals/src/server/temporaryConversationInteraction.js`
- `packages/vibe64-terminals/src/server/temporaryRepairChatsUpgrade.js`
- `packages/vibe64-core/src/server/stateUpgrades/20261104-temporary-repair-chats-removed.js`
- `packages/vibe64-core/src/server/stateUpgrades/20261110-archived-closing-chats.js`
- `tests/server/temporaryRepairChatsUpgrade.unit.test.js`

## Public contract

A task is a nested `task` field on its temporary conversation record. It holds the
kind, phase, reason, problem, attempt, pending effect, log and outcome. One pure
machine moves it and is the only writer of the field, apart from copying a
conversation into a development copy. Everything else asks: a client sends a
command, a finished turn sends an event, and the runner carries out the effect the
machine asked for. A task therefore keeps going without a browser, and reads the
same after a reload, on another device and for another member.

Each move adds to the task's `revision`, so a late answer can never replace a newer
one in a browser. A browser's conversation snapshot carries only `task.kind`; the
prompts a task carries never reach it, and a task's own route presents the task
without them.

The kinds are plain objects on the server, so a check or retry survives restart.
A kind says what the task is called, its steps, how it opens, and how it is proved.
Each kind lives in its own file under `kinds/`. Update's check runs Vibe64's Update
operation with the task's recorded conflict review. Save's check runs Vibe64's Save
to the destination the session has now, so a fixed Save pushes by itself; work a
person saved meanwhile counts, because nothing left to save after a ready Save means
Save succeeded. A Save refused for a reason only a person can settle (a changed
destination review, Update first, nothing to save) stops at
`needs_you(check_stuck)` without asking the AI again. Workspace preparation's check
runs Vibe64's preparation retry and waits for its result; it refuses to start while
Update is failed, because Update prepares the workspace again. Preview sign-in's
check runs the application's identity command for the identity the person chose;
the browser sends that identity and its error as the task's input. Project setup's check re-reads the opening
inspection; one kind covers repair, adopt, inspect and create, so its problem names
the task (`title`, `noun`, `opening`). The Data overview's check reads the overview
back through the database service: present, valid against the refreshed schema and,
for a whole or new-tables review, with no table unreviewed. A database that can't be
read is not the AI's to repair. A page refresh (`page-refresh`) is started by the
pages scheduler, not a person, in the session its refresh was set from: its brief
gives the refresh's prompt, the saved commit, the page's current `data.json` and
the one command that writes the new data, and tells the AI never to ask; its check
reads the page back and passes once its version has gone past the one the task
started from. It holds no repository (`repository: false`), so Save and Update
carry on beside it; the scheduler starts it only in an open session
(`vibe64_ai_task_session_closed` otherwise) and follows it to its end
([page refreshes](../pages/refreshes.md)). A request kind (`colleague` for Colleague's own
requests, `colleague-review` for an assignment's review) has nothing Vibe64 can
prove, so it is checked by a person: its
turns send no result schema, each ended turn stops at `needs_you(your_turn)`, and
Finish ends it Done. It follows the starter's chat mode (`routing: "inherit"`) and can
copy recent Main messages into its conversation; both choices come with the request
(`problem.conversation`). A kind with no opening message starts at
`needs_you(your_turn)`: a Colleague review waits for Colleague's first request.
A host adds kinds of its own through the optional token `vibe64.ai-tasks.host-kinds`
(`server/hostKinds.js`): an array of kinds, made by a feature set up before
`vibe64.ai-tasks`, that run in the same window through the same machine, runner and
check, and whose ids must differ from public's and each other's. A host's check calls
the host's own owners; one that must save the AI's repair before its own step runs
`createAiTaskSave`, the Save that Save's own check runs, waiting for the main chat's
AI in the same way. A check that runs several long steps says which one it is on
through `context.progress({ step, since, output })`: the step's name, when it
started (none: now, or when the same step was first reported) and what it has
printed so far, as its owner already shows it. The runner keeps only the latest
report, writes one at a time as a `check_progress` event, bounds the name and the
output's tail, and saves nothing once the check has answered, so a late report
never outlives the answer. The task keeps it as `progress`: a report clears a wait
the check reported before, and a wait, a new run of the check, its answer or any
other phase clears it, so it only ever describes the check running now; it is not
an Activity entry. `createAiTaskSave`'s `step` option reports Save's step only once
Save really saves, never while it waits for the main chat's AI. A kind's problem
receives the person starting the task (`vibe64User`), so a kind whose work only
some people may do refuses everyone else before a task opens. A host page that can show outside a session's AI task host
injects `VIBE64_AI_TASKS_KEY` with the named default `NO_AI_TASKS`
(`client/aiTaskKey.js`) and leaves out its AI task buttons there.
Input is untrusted text: a check hands it
back to its owner, which validates it again. Any other failed check goes
back to the same conversation up to three times, carrying the check's diagnostic.
A failure that repeats the same retry key (for Update, the same saved version and
conflicts) stops at `needs_you(check_stuck)` instead, and one that finds the person
writing a draft in Chat stops at `needs_you(draft_waiting)`. A message from the
person is a new instruction, so the AI's own tries start again from one.

The AI can edit, explain and say it has finished, but it never declares a managed
operation successful: the operation's own result, run by the check, decides Done.
Update itself never publishes. A failed, stopped or lost turn stops at `needs_you`
with Continue and never runs the check by itself; a turn that ends without saying it
finished offers Check, which runs it.

One task at a time runs in a session, whatever its kind and whoever started it.
Starting the same problem reopens the open task; starting another is refused. A
caller may name the task (`taskId`), so Colleague's retry finds the same task. A task
that ended and waits for Close doesn't block: starting a new one closes it.
Repository operations refuse to start during a task that changes the repository,
apart from the task's own check. The session's Update, Save and Prepare actions
are refused this way, not hidden. A button's view reloads when its task ends Done (`done`).

A completed repair runs its check by itself, on the server, whether or not any
browser watched the turn end. A failed check returns to the same conversation.
A person's Check, Continue or review carries on from where the task stopped.

A check that answers `waiting` keeps its pending check and runs again when a
turn settles or after thirty seconds. Update and Save can run while the AI works;
Save asks first because it includes unfinished changes. So Fix Update waits only
for its own conversation, and for another change holding the session
(`vibe64_agent_write_mode_busy`) or a file written, or a commit made, while Update
ran. Fix Save also waits while the main chat's AI works: its turn is open, read
from `terminals.agentSessionState`, the same turn the chat's working indicator
shows, or `terminals.sessionAssistantWorking` (`serviceSessionRecords.js`) finds
an active run or a `working` request it has not stopped that is being routed or
sent, or is a workflow between its turns. A delivery still being checked, a
stopped request's helper still being cleaned up, or a plain reply whose turn has
ended does not hold Save back, though the work plan's archive and restore still
wait for the first two. Its wait records
`mainChatSince`, the turn's start, or else when the wait began. Its kind declares
`check.whileAiWorks` (an action label and a note), so the window names the main
chat and that time and offers Wait for the AI, which hides the window and
focuses the main chat, and Save now, a `check_now` with `whileAiWorks` that runs
the pending check at once with `pending.whileAiWorks`. An idle main chat saves
without a click.

Cancel is always accepted at once and recorded. A turn is stopped through the
existing native Stop. A check that can stop receives an `AbortSignal`; the record
write that saves Cancel aborts it, and the runner re-reads the task before the
check starts so a Cancel saved meanwhile also stops it. Update stops before it
changes the session's files and Prepare stops its running step; the stopped run's
answer then ends the task Not done, and a run that finished first ends it Done.
Save, a sign-in, a merge build, an inspection and an overview read have no real
stop (`check.unstoppable`), so a task cancelled during one waits for the run to
end, and says so.

A turn lost to a restart stops at `needs_you(interrupted)` with Continue. A check
interrupted by a restart runs again with the same request identity, so the
existing Update operation is recovered rather than repeated. Connecting,
disconnecting or switching an AI account never stops or waits on a running turn;
a failure caused by an account stops at `needs_you(ai_unavailable)`. Archiving a
session ends its open task as Not done, and the archive dialog warns about it first.

## The window

`Vibe64AiTaskWindow` is one component for every kind. It knows nothing about
sessions or stores: a source object supplies the task and what a person can do to it.
`projectAiTask` turns a task into words, steps and actions in one place, and the
server's phase and reason decide them all.

Screen fit is one rule for every task. Under 600 px wide, or under 560 px tall at any
width, the window fills the screen and honours the safe area; the short-height case
folds the header and problem into two rows. From 600 px it is a dialog of
`min(92vw, 46rem)` by `88dvh`, and from 960 px `46rem` by `min(80dvh, 46rem)`. The
height is fixed, so the window never jumps as its content changes. Its buttons are
JSKIT's Material 3 buttons, whose touch targets are 48 px, and motion stops under
reduced motion.

The window has a header with a status line, the problem, a Progress and Chat tablist
with arrow keys, the chosen view, and a footer present only while the person is
needed. The outcome replaces the problem strip and views, and Close replaces Hide and
Cancel. The window opens on Chat when the AI asked something or the person decides
the end, otherwise on Progress, and never switches view by itself. When an Update
check is stuck on a conflict review, the footer also offers **Review resolved
conflicts**, the same file-list acknowledgement the session's Update error offers.
The status line, the problem, the note under the steps and the outcome's problem,
what happened and what the AI did are Markdown whose inline code the window renders
as code through JSKIT's `LongTextInlineParts`, as the conversation does; the problem's
tooltip keeps its raw text, and the title, the activity list, **Details** and the
check's output stay literal.
While a running check names its step, the status line is that step, followed by how
long it has run (`@local/vibe64-core/shared/elapsedText`, such as `2 min`), timed from
the step's `since` on the browser's clock, which ticks every second and reads
nothing. Only the step itself is in the status line's live region, so a new step is
announced and the ticking time is not. The host passes the step output's last line
(`terminalLastMeaningfulLine`, as a running terminal step is summed up elsewhere),
which Progress shows under the steps.

Esc hides an active task and closes an ended one. Clicking outside does nothing. Focus
goes to the title on open, never the composer, then to the outcome heading when the
task ends, and back to the opener or the tray on leaving. `?aiTask=<id>` names the
open window, so a reload, a copied link and phone Back all behave as a person expects.

The app-bar tray is one chip, never a list, because a session has one task. It shows
how the hidden task is going and reopens it. The Fix it with AI button follows the same
task: **Opening…**, **Being fixed… →** and **See result →**. A task ending while its
window is hidden raises a toast with **See result**, and a person whose window someone
else closes hears how the task ended. Each Fix it with AI entry checks the viewer's
effective Fix it with AI access, independently of Main's mode or personal connection.
Without it the button stays visible but disabled, and its title gives the role's
reason or says Fix it with AI is unavailable; a task of its kind that is already open
can always be looked at.

`Vibe64AiTaskHost`, mounted once per session view, holds the window, the tray and
the task's conversation. Chat (`Vibe64AiTaskChat`) presents that conversation through
`useAiTaskConversation`, which binds the session's conversation record whose id is
the task's id; the window's progress shows its commentary.

There is no header action or form for a task of the person's own: the session
header's Temporary AI opens their temporary chats instead. Colleague reaches tasks
through the task actions (`list`, `read`, `start`, `cancel`, `finish`, `close`),
which return a bounded summary of each task. Check and Continue are the person's,
from the window. `start` runs a `colleague` task (the request, its title, an optional
copy of recent Main messages and a chat mode) or the `project-setup` task, and its
description tells Colleague to start one only when the person asked for that work or
accepted the offer. Colleague reaches a task's conversation through the
`vibe64.terminals.temporary-conversation.*` read, update, turn and stop tools, with
the task id as the conversation id; the list tool leaves tasks out. Starting a task
creates its conversation and closing the task deletes it. The temporary-conversation
create and delete tools are for the person's temporary chats: create's description
says to create one only when the person asks for a chat of their own, and delete's
sends a task to the task close tool. Colleague's review of an assignment is a
`colleague-review` task named by the assignment, finished when the work is ready and
cancelled otherwise.

Colleague's selected-view interface lives with the temporary workspace
(`useVibe64TemporaryAiColleagueView`). It reports the selected session, its
readiness and the selected conversation: the task's id while the window is open,
otherwise the selected temporary chat's, or none for Main. Opening or closing the
window is a new selection. "Open this conversation" with no id hides an open window
and shows Main chat; with the session's task id it opens the window and settles once
the window's address is in place, so a host that writes the selection back to the URL
reads the window, not the selection it had before; with a temporary chat's id it
selects that tab. Removing the view withdraws the interface
and invalidates an open still in progress.

## The task's conversation

A task's conversation is a session conversation record that carries `task`; a record
without one is a person's temporary chat. Both use the conversation machinery that
[temporary assistance](temporary-assistance.md) describes: records, routes, turns,
routing, delivery, steering and Stop, attachments, native engines and Close. Its
exchanges never enter Main chat or main History. Starting a
task creates its conversation through Terminals' `createTemporaryConversation`
with the task, inside the same write that refuses a second open task, and creation
publishes `temporary-conversation-created` as for a chat. Its title starts as the
task's title. The temporary chat list
(`listTemporaryConversations`) always leaves the record out, so it is never shown
as a temporary chat tab.

A message keeps the author's text, and the turn adds what the task's record says:
the kind's context above a message from the person or Colleague, Update's brief on
how the session stands against its saved version (read afresh on every Update turn,
so the repair never redoes saved work), and the result schema unless a person checks
the kind. The schema does not change permissions. The runner sends Vibe64's own
messages with a short displayed bubble (`displayMessage`) while the AI receives the
full request; the composer owns only the person's unsent text.

A conversation for a kind that Vibe64 proves (`routing: "fix"`) uses Fix it with AI
and accepts only Fix it with AI or Custom; another mode is refused with
`vibe64_repair_chat_mode_invalid`. A request kind follows its starter
(`routing: "inherit"`): an owner's conversation copies Main's current role and custom
model override, Auto mapping to Senior with review off, and a team member's starts on
Fix it with AI; a Colleague start can name its chat mode instead. The window's Chat
offers Fix it with AI and Choose model (`Vibe64ChatModeControls` with `required-mode`
fix). Auto, plan approval and passes after a plan are unavailable, as in temporary chats.

A Colleague task's start may ask for a copy of recent Main messages
(`includeRecentChatContext`). The copy is captured exactly as for a new temporary
chat ([optional recent Main context](temporary-assistance.md#optional-recent-main-context)).

Close is the shared conversation Close, run when an ended task is closed by a person,
by Colleague or by starting the session's next task. Archiving a session ends its
open task as Not done; the conversation's open runtime entry is retired like a
temporary chat's. The archive keeps every task's record and saved history, and
its native conversations join the archive's native bindings for the host's
archived native-history retirement, as a temporary chat's do
([temporary assistance](temporary-assistance.md)).

## The task chat in the browser

`Vibe64AiTaskHost` builds `useAiTaskConversation` from three parts:
`useAiTaskConversationRecord` binds and follows the record,
`useAiTaskConversationSaves` queues its saves, and
`useAiTaskConversationMessages` sends, retries, cancels, edits and stops.
`src/lib/vibe64AiTaskConversation.js` holds the request, message and transcript
projections they share. Main and the task chat use the same JSKIT conversation
element, transcript, composer and collapsible progress components; their supplied
bindings own pending entries, failed delivery and receipt matching. The shared
prepared-submit binding chooses Send or Steer from the application's native-working
eligibility, checks uncertain receipts without resending, and removes only accepted
composer attachments. Router admission remains application policy.

The record reads the task's own conversation by its id
(`GET /sessions/:sessionId/temporary-conversations/:taskId`) when the session, its API
path, the viewer and readiness allow, and binds it; the temporary chat list, which
leaves tasks out, is never read. A conversation already closed reads as expired and
binds nothing. It reads current readiness on
mount and watches later changes. Assistant-operation contention retries after a
second without showing an error. Losing readiness, changing session or viewer, and
unmounting retire pending reads; refreshes during a pending read share that wait,
then the latest refresh reads one fresh snapshot, and late responses cannot alter a
newly bound conversation with the same ID. Only account and connection events and a
returning realtime connection read it again, and so do `temporary-conversation-created`
for the task's id while nothing is bound and `temporary-conversation-renamed`;
unrelated progress events do not. A
genuine read failure shows in place of the conversation. When saved AI settings
need a state upgrade, the read reports the administrator's stop, upgrade and restart
steps; it never converts old settings during a read.

Hiding the window keeps the binding and its reader, because the host holds them.
Changing session or viewer, or removing the view, releases the binding without
stopping native work, sending no Stop or Delete request, and first sends the draft,
attachment and settings edits still waiting for their save, including one queued
behind an unfinished save; their responses are not applied to the departed view.
Each session keeps its own task conversation and saved draft. When
`temporary-conversation-closed` names the bound conversation, the view cancels its
pending saves, releases its reader and ignores late responses that would restore it.
A closed-conversation API error does the same, and Send never recreates a
conversation closed by another browser. A reconnect reads the conversation again,
which recovers a missed creation or closure.

Draft, attachment and settings changes save after a short pause. A still-busy save
retries automatically, and a later successful save clears the earlier save error. A
failed draft save says so above the composer. Send inserts the person's bubble
before waiting for a draft save or native admission; the shared element overlays that
entry on canonical history and replaces it once by message identity. Resend keeps
the original message ID, text, settings and attachment IDs, while preserving a newer
draft and unsent files. While the connection is being recovered, drafts stay
editable and Send is unavailable until it returns. Restoration starts once the
session is available, independently of the main model's connection.

Attachments use the shared upload queue, text references and preview/download
dialog. The shared attachment service retains sent and saved draft files under an
explicit conversation owner, and Close removes only that owner's files and uploads;
it cannot delete main-chat attachments. Saved draft attachments appear beside the
composer in the same visible queue as new uploads and can be removed before Send. The
composer combines saved receipts with its pending upload queue, retains completed
uploads, and cancels unfinished ones. Restored files count against the normal
attachment limit; additions and removals keep numbered text references consistent.
A confirmed send clears only its accepted receipts. Both adapters receive trusted file
descriptors from the same attachment service.

Assistant replies use the same formatted text presentation as normal chat, including
lists, bold text, code and links; user-authored text stays literal. Raw HTML remains
text, and executable or data-URL links are not made clickable. Progress starts
collapsed inside its assistant message; expanding it uses the scrollable transcript.
The status above the composer uses normal chat's shared plain status component and
says "Sending to assistant…" during admission, then "AI is working…" during
execution, and "Still working · waiting on background commands…" while a finished
reply's background work continues (`backgroundWorkLabel` in
`src/lib/vibe64BackgroundWorkLabel.js`; Main chat adds the count Claude reports).
The transcript has no second working indicator and the status never
repeats reasoning paragraphs. Long progress cannot push Stop or the composer out of
view, and the composer keeps its buttons visible while long drafts scroll within the
input. An unavailable progress read keeps the draft and Stop available. Subsequent
native events and reconnects invalidate the same supplied reader; there is no
private polling loop. A read failure does not report completion, erase the
conversation or send another turn.

Typing presence reuses the session presence endpoint, realtime event, debounce and
expiry with the conversation ID as an additional scope. Actual input is coalesced
into at most one update per five seconds, with no autonomous heartbeat or
overlapping requests, and requests have a five-second deadline. The server takes the
actor from authentication, reads only session status and checks the saved record;
it never loads agent runs, background tasks, chat history or a provider for
presence. State remains bounded and in memory, and Main chat ignores these typing
events. The shared composer status displays the person's name, or a count for
several people, without receiving draft text through presence. Blur, Send, hiding
the window and disposal cancel pending updates without requests. Remote indicators
expire within ten seconds; reconnect sends no typing request. This indicator does not
lock or merge simultaneous draft edits.
