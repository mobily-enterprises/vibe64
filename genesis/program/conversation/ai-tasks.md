# AI tasks

An AI task is a specific job given to an agent: a problem, the conversation that
works on it, the proof that it worked, and an outcome. People find it in one
window that presents the problem and its solution, or the lack of one, together.
A task ends **Done** or **Not done**. Done is proved, never assumed; Not done is
decided by a person. Update, Save, workspace preparation, preview sign-in, incoming
merge, project setup and the Data overview have moved to AI tasks so far, and so have
the person's own requests (**New AI task**) and Colleague's requests and reviews.
Every session conversation besides Main is an AI task's conversation: the
`20261104-temporary-conversations-closed` state upgrade deleted the temporary and
repair chats recorded before AI tasks, as Close deletes one (`docs/state-upgrades.md`).

## Sources

- Main: `packages/vibe64-ai-tasks/src/server/service.js`
- `packages/vibe64-ai-tasks/src/server/aiTaskMachine.js`
- `packages/vibe64-ai-tasks/src/server/aiTaskRunner.js`
- `packages/vibe64-ai-tasks/src/server/aiTaskKinds.js`
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
- `packages/vibe64-ai-tasks/src/server/kinds/incomingMerge.js`
- `packages/vibe64-ai-tasks/src/server/kinds/projectSetup.js`
- `packages/vibe64-ai-tasks/src/server/kinds/databaseOverview.js`
- `packages/vibe64-ai-tasks/src/shared/aiTaskPhases.js`
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
- `packages/vibe64-ai-tasks/src/client/Vibe64AiTaskRename.vue`
- `packages/vibe64-ai-tasks/src/client/Vibe64AiTaskButton.vue`
- `packages/vibe64-ai-tasks/src/client/Vibe64AiTaskTray.vue`
- `src/components/studio/vibe64-session/Vibe64AiTaskHost.vue`
- `src/components/studio/vibe64-session/Vibe64AiTaskChat.vue`
- `src/components/studio/vibe64-session/Vibe64NewAiTaskDialog.vue`
- `src/composables/useAiTaskConversation.js`
- `src/composables/useAiTaskConversationRecord.js`
- `src/composables/useAiTaskConversationSaves.js`
- `src/composables/useAiTaskConversationMessages.js`
- `src/lib/vibe64AiTaskConversation.js`
- `src/composables/useVibe64SessionColleagueView.js`
- `src/composables/useVibe64SessionTypingPresence.js`
- `src/components/studio/vibe64-session/Vibe64ComposerDelivery.vue`
- `src/components/studio/vibe64-session/Vibe64ChatModeControls.vue`
- `src/components/studio/vibe64-session/Vibe64AgentSettingsMenu.vue`
- `src/components/studio/vibe64-session/Vibe64ConversationAttachments.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotSessionHeader.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotActivity.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotChat.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotDialogs.vue`
- `src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue`
- `src/composables/useVibe64AutopilotView.js`
- `src/lib/vibe64AssistantHost.js`
- `src/lib/vibe64AssistantConversation.js`
- `src/lib/vibe64ConversationAttribution.js`
- `src/lib/vibe64ThinkingPresentation.js`
- `packages/vibe64-terminals/src/server/sessionConversations.js`
- `packages/vibe64-terminals/src/server/aiTaskConversationRecords.js`
- `packages/vibe64-terminals/src/server/aiTaskConversationTurns.js`
- `packages/vibe64-terminals/src/server/aiTaskConversationLifecycle.js`
- `packages/vibe64-terminals/src/server/aiTaskConversationInteraction.js`
- `packages/vibe64-terminals/src/server/aiTaskConversationRules.js`
- `packages/vibe64-terminals/src/server/sessionAttachments.js`
- `packages/vibe64-terminals/src/server/assistantContracts.js`
- `packages/vibe64-terminals/src/server/assistantRouting.js`
- `packages/vibe64-terminals/src/server/assistantRoutingAdmission.js`
- `packages/vibe64-terminals/src/server/assistantRoutingDelivery.js`
- `packages/vibe64-terminals/src/server/assistantRoutingCancellation.js`
- `packages/vibe64-terminals/src/server/agent/sessionAgentManager.js`
- `packages/vibe64-terminals/src/server/agent/sessionAgentProviderCalls.js`
- `packages/vibe64-terminals/src/server/agent/sessionAgentLifecycle.js`
- `packages/vibe64-terminals/src/server/agent/sessionAgentRules.js`
- `packages/vibe64-terminals/src/server/agent/providers/claudeConversationHost.js`
- `packages/vibe64-terminals/src/server/agent/providers/codexSessionAgentProvider.js`
- `packages/vibe64-terminals/src/server/agent/providers/opencodeSessionAgentProvider.js`
- `packages/vibe64-terminals/src/server/codexHelperThreadLedger.js`
- `packages/vibe64-terminals/src/server/codexScopedConversationPreparation.js`
- `packages/vibe64-terminals/src/server/codexHelperPreparation.js`
- `packages/vibe64-terminals/src/server/opencodeServerProcess.js`
- `packages/vibe64-terminals/src/server/openCodeHostPreparation.js`
- `packages/vibe64-terminals/src/server/openCodeScopedPreparation.js`
- `packages/vibe64-terminals/src/server/temporaryConversationsClosedUpgrade.js`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `packages/vibe64-runtime/src/server/sessionConversationStore.js`
- `packages/vibe64-runtime/src/server/sessionTemporaryConversationRemoval.js`
- `packages/vibe64-runtime/src/server/codexAppServerAgent.js`
- `packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js`
- `packages/vibe64-runtime/src/server/assistantRoutingStateUpgrade.js`
- `packages/vibe64-sessions/src/server/sessionPresence.js`
- `packages/vibe64-core/src/server/actionContext.js`
- `packages/vibe64-core/src/server/featureRoutes.js`
- `packages/vibe64-core/src/server/stateUpgrades/20261104-temporary-conversations-closed.js`
- `tests/server/assistantRoutingStateUpgrade.unit.test.js`
- `tests/server/temporaryConversationsClosedUpgrade.unit.test.js`

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
destination review, connected projects, Update first, nothing to save) stops at
`needs_you(check_stuck)` without asking the AI again. Workspace preparation's check
runs Vibe64's preparation retry and waits for its result; it refuses to start while
Update is failed, because Update prepares the workspace again. Preview sign-in's
check runs the application's identity command for the identity the person chose;
the browser sends that identity and its error as the task's input. An incoming
merge's check runs the explicit repair review and refuses leftover conflict markers;
its conflict also arrives as input, because only the person's Merge met it. Merge
stays the person's reviewed action. Project setup's check re-reads the opening
inspection; one kind covers repair, adopt, inspect and create, so its problem names
the task (`title`, `noun`, `opening`). The Data overview's check reads the overview
back through the database service: present, valid against the refreshed schema and,
for a whole or new-tables review, with no table unreviewed. A database that can't be
read is not the AI's to repair. A request kind (`free` for New AI task, `colleague`,
`colleague-review`) has nothing Vibe64 can prove, so it is checked by a person: its
turns send no result schema, each ended turn stops at `needs_you(your_turn)`, and
Finish ends it Done. It follows the starter's chat mode (`routing: "inherit"`) and can
copy recent Main messages into its conversation; both choices come with the request
(`problem.conversation`). A kind with no opening message starts at
`needs_you(your_turn)`: a Colleague review waits for Colleague's first request.
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
apart from the task's own check. The session's Update, Save and Prepare actions,
and Incoming's Merge, Discard and review, are refused this way, not hidden. A
button's view reloads when its task ends Done (`done`).

A completed repair runs its check by itself, on the server, whether or not any
browser watched the turn end. A failed check returns to the same conversation.
A person's Check, Continue or review carries on from where the task stopped.

Cancel is always accepted at once and recorded. A turn is stopped through the
existing native Stop. Update, Save, Prepare and a sign-in have no real stop, so a task cancelled
during such a check waits for the run to end, and says so.

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
height is fixed, so the window never jumps as its content changes. Touch targets are
48 px on coarse pointers, and motion stops under reduced motion.

The window has a header with a status line, the problem, a Progress and Chat tablist
with arrow keys, the chosen view, and a footer present only while the person is
needed. The outcome replaces the problem strip and views, and Close replaces Hide and
Cancel. The window opens on Chat when the AI asked something or the person decides
the end, otherwise on Progress, and never switches view by itself. When an Update
check is stuck on a conflict review, the footer also offers **Review resolved
conflicts**, the same file-list acknowledgement the session's Update error offers.

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

The session header's **New AI task** opens a small form, then the window. A refused
start keeps the form open with what the person typed. Colleague reaches tasks through
the task actions (`list`, `read`, `start`, `cancel`, `finish`, `close`, `rename`), which return a
bounded summary of each task, and reaches the task's conversation through the
`vibe64.terminals.ai-task-conversation.*` list, read, update, turn and stop tools.
Conversations are created only by starting a task and deleted only by closing one;
there is no create or delete conversation action or route. Colleague's review of an
assignment is a `colleague-review` task named by the assignment, finished when the
work is ready and cancelled otherwise.

Colleague's selected-view interface (`useVibe64SessionColleagueView`) reports the
selected session, its readiness and, while the window is open, the task's
conversation id. Opening or closing the window is a new selection. "Open this
conversation" with no id hides an open window and shows Main chat; with the session's
task id it opens the window; any other id is refused. Removing the view withdraws the
interface and invalidates an open still in progress.

## Rename

Only a New AI task can be renamed: the `free` kind carries `rename`, and presenting
a task marks it `renamable` from its kind, so nothing new is saved on the task.
`vibe64.ai-tasks.rename` (`POST …/ai-tasks/:taskId/rename`, also a Colleague tool)
sends a `rename` event through the machine like Finish: the kind turns the name
into one line of at most 80 characters, and an empty name gives back the kind's
title. It is the one event an ended task still takes, so a task can be renamed in
any phase until Close. It counts up `revision` and reaches every viewer like any
other move, and never touches the conversation. Other kinds refuse it with 409
`vibe64_ai_task_not_renamable`; a closed task with 404 `vibe64_ai_task_closed`.
The header's pencil (`Vibe64AiTaskRename`) shows when the projection says
`renamable` and the window's source has `rename`, so a host's own task source
without it offers no Rename.

## The task's conversation

A task's conversation is separate from Main chat: its exchanges never enter the main
project conversation or session history, and it never appears in main History.
Starting a task creates it through Terminals' `createAiTaskConversation` with the
task, inside the same write that refuses a second open task. The server stores its
identity, settings, draft, task and attachments below its session's
`conversations/` directory. It uses the existing JSKIT transcript policy with a
separate filesystem scope and a persisted native provider conversation; Codex
conversations are not native ephemeral threads.

A conversation's presentation is only its `title` and its unsent `draft`. The title
starts as the task's title; it is a plain name, whitespace collapsed, at most 80
characters. A title-only update, like a draft-only update, saves without the
assistant's write lock; a title change publishes `ai-task-conversation-renamed`
so other open views reread it. Each conversation stores its number once, at
creation: one more than the highest among the session's open conversations. Listing
still numbers a record saved without one by creation order and treats an old
"Temporary N" title as unnamed, without rewriting it. Plain draft-only writes use
the short session-store mutation and a durable draft revision, so admission of an
older message cannot clear newer typing or files.

The shared HTTP route carries the project, session and conversation identity in
one selector. The application server permits route parameters up to 1024
characters so every task's conversation reaches the same authorized route. The
collection GET lists the session's conversations, GET reads one, PATCH saves
presentation and settings, and the turn and stop routes send and stop work. Creation
publishes `ai-task-conversation-created` once, when the record is first saved.
Feature routes wait for response delivery, including asynchronous response hooks,
so error codes and messages reach the client instead of an empty response.

Conversation actions resolve their project and acting user through the shared
action boundary. The acting user is trusted context, never an action argument.
HTTP URL selection and explicit action selection must agree; automation enters the
same project context as HTTP. Hosts recheck authentication and project access
before each execution. Ordinary product handlers must invoke their owning action;
custom transports may retain their transport adapter. The authenticated actor
supplied by the HTTP turn action is captured with the routing request, so retries
and reconciliation retain the submitting user's access even when an owner reads
the conversation.

Task conversations in Codex, Claude Code and OpenCode load the same Genesis
project hooks or plugin as main chat and standalone CLI use. The host bridge
binds each native ID to the conversation's context before its first turn or
resume. They have the same capabilities, tools and project access as main chat,
with normal execution settings and the same session write coordination and skill
preparation. There is no separate permission mode or R/O–R/W toggle. Preview
screenshots and console/network diagnostics attach to the task's Chat through the
normal upload path.

A task conversation receives one stable Genesis and Vibe64 context with main chat's
project capabilities, and keeps the session directory and normal command boundary.
A message keeps the author's text, and the turn adds what the task's record says:
the kind's context above a message from the person or Colleague, Update's brief on
how the session stands against its saved version (read afresh on every Update turn,
so the repair never redoes saved work), and the result schema unless a person checks
the kind. The schema does not change permissions. The runner sends Vibe64's own
messages with a short displayed bubble (`displayMessage`) while the AI receives the
full request.

Listing and opening a conversation read the assistant natively only when its turn
is starting or in progress or its last reported goal is unfinished. Every native
read saves the goal it reports on the record. A settled conversation (completed,
interrupted or failed, with no open goal) answers from its saved transcript, goal
and access through the shared stored projection, so restoring it after a reconnect,
session switch or account change never starts its assistant process. The idle
check after each turn still reads the native conversation once to save its settled
outcome and goal. Creation and reading release the write lock before looking up
mode availability, so slow provider catalogue reads do not block sibling Router
updates or draft saves; native admission and transcript reconciliation remain
serialized. Connected Codex history reads reuse their existing native observer and
do not rebuild the execution environment; Send and reconnection still prepare it.

Reads optionally accept a stable message cursor and a bounded count, return
messages in chronological order, and report whether earlier messages exist. An
unknown cursor reports a conflict instead of silently reading another page. Normal
reads retain the complete UI transcript. The assistant tool projection returns
bounded text and explicit truncation flags, never native provider bindings or
attachment records. A read failure cannot establish that agent work stopped.

Saved authored rows and native streamed replies interleave by their message times,
including user steering inside one native turn, exactly as in Main. Rendering
preserves the original turn identities, metadata and stored history. When
reconciling native messages, the accepted request's recorded selection and mode
supply metadata for new transcript blocks, including progress and later assistant
replies after an initial message. If no request receipt is available, the retained
conversation selection supplies the identity. Existing block metadata is preserved;
this does not relabel historical messages or inherit Main's model.

## Chat mode and models

A conversation for a kind that Vibe64 proves (`routing: "fix"`) uses Fix it with AI,
and accepts only Fix it with AI or Custom; another mode is refused with
`vibe64_repair_chat_mode_invalid`, and saved metadata is held to Fix for future turns
without rewriting saved requests or history. A request kind follows its starter: an
owner's conversation copies Main's current role and custom model override, Auto
mapping to Senior with review off, and a Main chat without routing preferences
passes its exact AI as a Senior override; a team member's starts on Fix it with AI.
New conversations resolve access for the submitting actor through the ordinary
purpose resolver; inherited choices do not grant new access. Auto, plan approval
and automatic review are unavailable in task conversations, including through direct
API calls and pending handoff retries. Senior and Junior are the workspace owner's
only. Each conversation keeps its own selection, routing preferences, pending request
and retained native conversations after Main changes or the view reloads. Background
helpers keep their assigned roles. Direct roles use the conversation and user
request; unrelated requests leave saved plans unchanged and do not trigger an
automatic reviewer.

The task chat's compact role control (`Vibe64ChatModeControls`, with `required-mode`
fix) offers the roles a person may use; owners can open the shared Models overlay
from its menu. Custom opens the same Orchestrator → Model → Thinking dialog as Main;
selections stay local until Apply, which validates the exact selection and stores
it in this conversation's routing preferences without changing the draft or Main.
Custom never silently substitutes another model; a selection the person cannot
access is refused. Each conversation reads availability from the same central
resolver as Send, using its own mode and custom override, so its menu labels the
person's effective destination and thinking choice rather than Main's last model.
Mode changes return refreshed decisions without inference. Selecting another role
clears a custom override. Explicit model and thinking edits update that mode's
saved override and are validated against the current catalogue; Fix it with AI
takes its model from Models and refuses them until Custom is chosen. Senior and
Junior overrides must both run in the main AI's tool, never as a split-orchestrator
pair. Configuration and connection changes refresh the conversation's decisions
without replacing its unsent draft. Restoring its history does not require access
to Main's last model. An active turn reports its separate native steering
permission; a collaborator may be unable to steer that turn while still having a
shared route for the next request. Reply labels show the role first, followed by
the orchestrator and model, as in main chat.

The chooser uses the same live catalogue as main chat, scoped to the session's
current engine and connected model provider; only available models and their
advertised thinking variants are selectable. Before a new turn, the server resolves
the conversation's settings through the existing catalogue validator and passes
that selection to the native conversation without changing main metadata. OpenCode
applies it only to the conversation's native session; its shared process retains
the main session's configuration. Catalogue failures are shown with Retry, and
unavailable selections cannot be applied or executed. Draft and attachment saves
omit model settings; only explicit model or thinking edits submit them, so a stale
pre-routing selection cannot become an override. Acknowledging an older settings
save retains a newer pending edit. Settings-only updates use their existing settings
lock; payloads combining settings with a draft or attachments retain the
source-write coordinator. The saved-record mutation computes its patch from current
state and releases the storage lease before publishing, so subscriber
initialization cannot block an independent plain draft save.

An unfinished native goal retains its orchestrator and suppresses automatic review;
settings remain editable for subsequent turns. Its observed goal reaches the mode
menu through restoration, canonical reads and live updates; an omitted goal in a
failed read cannot clear an earlier observation. Native completion first saves the
final reply through the ordinary snapshot owner; review then checks the saved reply
for the composer's structured questions, and an unanswered question retains the
coding model and waits for the person's answer. An unavailable native goal does not
disable preference saves or clear its existing pin. Native settings updates require
an observed goal and preserve its objective and progress.

A turn whose selection runs in another orchestrator uses the same changeover
preparation and Send owner as Main chat, scoped to this conversation's metadata and
visible transcript. The previous native conversation is stopped and retained before
selection changes; a failed stop leaves that selection unchanged. Returning resumes
the recorded native conversation and sends missed or corrected visible messages with
the ordinary authored request. No separate handover inference is added. Each
retained binding stores its native ID, exact selection, settings and last
message/run IDs. Codex routing accepts only its current shared native binding. A
request to use Codex rejects unsupported retained bindings before stopping the
current assistant, changing its selection or rewriting its home, including after an
intervening foreign-engine turn; the error asks for a new conversation and keeps the
existing history intact. A fresh conversation can start even when the main chat
retains Codex history in an older provider home; neither history is moved or
converted, and a conversation with its own unsupported history reports the required
action as a conflict, not a server error. The manager keys task bindings separately
from Main chat while providers continue to receive the real project session and
exact native conversation ID.

DeepSeek and GLM under Codex or Claude preview their latest short commentary as
thinking. Expanding progress shows those short updates only; raw reasoning is
omitted and final answers remain separate replies. This uses recorded selections and
the same presentation mapping as Main chat without rewriting saved history. Both
transcripts use the same recorded-selection attribution; message-level selection
remains available for live scoped replies, and changing the composer selection never
rewrites historical attribution.

## Delivery, steering and Stop

The task chat and Main share `Vibe64ComposerDelivery` for Send/Steer and Stop.
Preparation, attachment ownership, permissions and model routing remain with the
existing application owners. The task's conversation binding uses the shared
serial prepared-send queue (`queueWhileSending`); queued messages retain their
authored payload and identity, and uncertain delivery is inspected rather than
replayed.

Task conversations share Main's delivery-state presentation. An ordinary send stays
pending. Lost confirmation shows Retry against the original message ID, without
Edit or Cancel or another native submission. Saved history and accepted routing
state clear stale delivery errors, including a late HTTP failure after an exact
receipt. Pending entries are reconciled only against actual history; synthetic
routing rows never acknowledge delivery. Direct messages can be saved before native
admission. Their read-only projection carries `receipt: false` until the exact
requested native message is confirmed; routed rows written after admission retain
the normal receipt contract. The shared delivery owner keeps that provisional row
visible once, with its pending or uncertain status. Native read failures leave Retry
available. Its explicit check retains the captured request and cannot start it again
while admission is unknown. Historical checks use the row's recorded selection and
retained native binding, without consulting another conversation for acceptance.
The qualifier never enters saved history, routing metadata, prompt history or
message fingerprints. The original logical record remains authoritative. Its
canonical server facade and the task chat use the common read, subscription and
delivery operations; the chat acquires the supplied retained binding with its
existing logical ID and has no second delivery record or private reader.

An uncertain delivery is inspected by its original message identity rather than
replayed; an unreadable or absent receipt remains uncertain. Only the native
owner's proof of non-admission (`not-admitted`, from Claude) makes the routed
attempt unsent: routing clears its attempt and reports `not-sent`, and a changeover
holding the same attempt settles it through its own owner. Retry then sends it
normally. Cancel is decided by the server: JSKIT's delivery cancel aborts a running
check and an unsent request, keeps the message as Cancelling… and calls
`POST …/deliveries/:messageId/cancel`, which reaches
`cancelAiTaskConversationMessage` without opening the native conversation. The
shared routing `cancelMessage` records a durable tombstone, stops that
conversation's route (`stopped` and `cancelled`) and classifier, and interrupts its
persistent turn when the message may own it, all without the agent-write lock, then
answers success. Discarding the retained changeover attempt waits for the lock in
the background, or for the next admission. Snapshots, inspection (`cancelled`) and
admission all honour the tombstone, so the message never returns. A message shown
only from its route joins the delivery first, and a cancelled route never returns its
text to the draft. When the server cannot be reached the message stays with Cancel
again and is retried after reconnecting; accepted history remains. A failed
delivery entry not shown from a route was definitely never sent, even when the
conversation never started, so `useAiTaskConversationMessages` retires it through
JSKIT's delivery `edit()` instead of a server cancel.

Accepted Claude steering retains the original input identity on partial output. The
shared scoped reader resolves native input identities against authored messages and
uses the existing transcript turn IDs when saving replies. A follow-up cannot take
ownership of the interrupted request's partial reply, including after a cold
native-history read; existing saved rows are not repaired or rewritten by this read
path. Definite pre-delivery rejection retains the authored follow-up but restores
the previous admitted message/run identity before reconciling native output. The
shared scoped owner anchors the first answer to its original unanswered transcript
turn, preserving the existing separate-turn projection for later native messages.
New ordinary sends reserve the existing pending shape just like catch-up sends; only
the same message ID with retained `attempted: false` allows a pre-write retry after
reload. Unknown delivery still uses receipt inspection and never grants automatic
replay. Historical rows and missing pending evidence are unchanged.

When routing stops before delivery, the local prompt returns to the composer; its
next explicit Send uses a new message ID. Newer draft text and attachments are
retained, and a clean cancellation does not appear as a failed message. The composer
owns only unsent user text: the runner's own messages go directly to the delivery
record, which retains the full prompt separately from its displayed bubble, and are
never copied into the composer. Retry resends the saved payload and identity
without reading or clearing the draft, including after reload. Edit places a failed
message's visible text into the composer, before the draft unless the draft already
starts with it, by the same rule as Main chat and JSKIT's delivery edit; a
cancelled routed request returns the same way. A message that may have reached the
AI is never turned back into a draft.

The composer stays editable during work. Steer sends guidance to the current native
conversation and keeps Stop available. The server retains the conversation's
current model and skips source and skill preparation during steering. Codex uses the
exact active thread and turn; Claude uses its existing native interrupt-and-continue
path; OpenCode uses native steering while the same observer follows the latest
prompt. Late reads cannot overwrite a newer send, and failed steering does not imply
that the original work stopped. Stop ends the turn so the AI can be redirected; it
does not reset source files, HEAD or the index, and Cancel ends the task. A Stop
error appears in the chat's error line above the composer, and a failed Stop leaves
the live reader active.

The selected conversation's saved transcript is projected without provider
observation when source coordination is busy; its snapshot explicitly defers
reconciliation. Every status change is saved before it is announced, so each view
applies the saved status from such a snapshot exactly as from a reconciled one. A
routing notice marks a view working only while its request is delivering or
running, and adopts that request's ID unless the view's own Send is still being
delivered; a failed or uncertain Send never fences another view's request. The send
fence holds only a request that the saved transcript has not yet followed with a
later one. Realtime routing updates use the supplied reader's existing in-flight
request and one queued latest read; a replaced turn is observed after the older
read settles. While a turn runs, each completed native message marks its
conversation for saving. One coalesced write per session saves every marked
conversation after a short delay, and output completed during that write is saved
by one more write after it. The write does not wait: when the lease is busy the
marks stay for the next completed message. The idle completion, the last server
work for a finished turn, retries a busy source lease for both its transcript save
and its routing completion and logs a failure instead of silently leaving the turn
in progress. Native idle events and read-time reconciliation finish the admitted
turn without starting another model. Every view showing a reply therefore settles
on the same finished state, whichever view sent it.

The shared routing coordinator uses the conversation's existing write lock and
transcript; it does not write main-chat history or alter Main's selection. Requests
wait briefly for the session write coordinator instead of failing immediately on
contention, and the existing filesystem lock admits local waiters in arrival order,
so repeated reads cannot overtake a pending routing update or cancellation. Wait
timeouts still apply, and filesystem ownership continues to protect separate
processes. First Send creates the native conversation under the session write
coordinator. Accepted message identities prevent a retry from sending the same work
again. Native history reconciles replies completed while the browser was absent;
incomplete replies remain visible as they arrive. Main and task chat views read a
saved routing request through the shared runtime reader and show an unreadable value
as none; server guards use the strict reader and refuse to act on it.

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

The record reads the session's saved conversations when the session, its API path,
the viewer and readiness allow, and binds the one whose id is the task's id; a task
the server has just started appears in the next list. It reads current readiness on
mount and watches later changes. Assistant-operation contention retries after a
second without showing an error. Losing readiness, changing session or viewer, and
unmounting retire pending reads; refreshes during a pending read share that wait,
then the latest refresh reads one fresh snapshot, and late responses cannot alter a
newly bound conversation with the same ID. Only account and connection events and a
returning realtime connection reread the list; unrelated progress events do not. A
genuine read failure shows in place of the conversation. When saved AI settings
need a state upgrade, the read reports the administrator's stop, upgrade and restart
steps; it never converts old settings during a read.

Hiding the window keeps the binding and its reader, because the host holds them.
Changing session or viewer, or removing the view, releases the binding without
stopping native work, sending no Stop or Delete request, and first sends the draft,
attachment and settings edits still waiting for their save, including one queued
behind an unfinished save; their responses are not applied to the departed view.
Each session keeps its own task conversation and saved draft. When
`ai-task-conversation-closed` names the bound conversation, the view cancels its
pending saves, releases its reader and ignores late responses that would restore it.
A closed-conversation API error does the same, and Send never recreates a
conversation closed by another browser. A reconnect rereads the list, which recovers
a missed creation or closure.

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
execution, and "Reply ready · background task still running…" while a finished
reply's background work continues. The transcript has no second working indicator and the status never
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

## Native engines

Before a native conversation ID exists, the same session-agent manager completes
its original access and execution-profile checks, then uses the common runtime's
server-only creation operation. The common application owner prepares the original
input and selected native facilities without opening Main or creating a placeholder.
The Codex and OpenCode drivers call their existing creation owners; Claude's same
owner allocates the UUID, acquires the entry, records the scoped profile and
persistence flag, and completes the original second save before returning. The
task's conversation still records that actual identity before Start.

JSKIT assistant-core's existing `codexTurn.js` run owner executes scoped/persistent
Codex creation from authorized settings and registers results in the original maps.
It also owns start deduplication, duplicate and active-turn selection, native resume
and dispatch, native observation, paginated history projection, turn-start watchers,
active-turn steering, Send-result settlement, persistent native Stop, ordinary scoped
interruption/deletion and completion waits. The watcher retains its original
deadline before Send; completion and failed-turn interruption use the exact native
identity. Provider-loss recovery, pending-start draining, renewal activity and
explicit close use that same state. Vibe64 retains profile and account admission,
output-limit validation, task-result parsing, checkpoints and completion
publication. Its result projection remains inside the shared completion promise, so
a rejected result follows the original interruption and retry behavior. The existing
checkpoint facility carries the turn's exact outer identity. Vibe64 retains
namespace admission and Helper ownership receipts. The scoped Codex driver calls the
same run owner for acquisition, cached or persistent reads, Start, wait, Stop and
deletion. Shared native interrupt/delete commands run inside the original admission
boundary, then settle the captured watcher/map after its release. Scoped deletion
stops only what this server runs for the scope and requires verified exit for it. A
helper thread from before a restart lived only in that process, so its cleanup sends
no native delete, starts no Codex app-server and needs no account, tool home or
workdir. Vibe64 supplies its cleanup policy. Vibe64's scoped preparation retains
authorized context, profile and permission settings, input/output limits and
observation-loss admission. Its Helper account capture stays after native resume and
before the shared watcher and Send. The run owner invokes the existing provider and
verified Helper isolation owner from that preparation; Public supplies no executable
create, resume or dispatch callback on this path. The same run owner also restores
Helper ownership before native model discovery and account description. It preserves
original provider reuse, account-acquisition gating and the per-connection catalog
cache; Vibe64 retains authorized scoped preparation, workload deadlines and returned
profile/account policy.

OpenCode uses JSKIT's extracted observer to wait for the event channel before
dispatch, propagate observation loss and await closure. Its extracted steering
operation follows the newly submitted input and restores the prior input when native
dispatch fails. Application authorization, execution-profile policy, checkpointing,
run publication and durable conversation identity remain here. Its records, native
creation, model/agent selection, Start, Steer, reads, completion waits, Stop,
deletion and target draining use the same JSKIT shared runtime, reached directly by
the common OpenCode driver. The binding supplies exact native identity and
application preparation to that same owner. Vibe64 retains profile and context
authority, prompt and result limits, exact receipt projection and registry
publication. The shared owner performs acquisition, compares the retained profile
and opens the original native observer using those prepared values. It records
native selection before awaiting that registry write, and attaches the original
completion notices before Start returns admission. A bounded Helper keeps its saved
completion when a caller supplies another wait timeout. Persistent Stop retains its
native idle check; ordinary Main Stop remains acknowledgement-only. Native deletion
still precedes observer retirement and registry publication. Vibe64 retains
authorized target selection, scoped Helper release and the parent's durable cleanup
receipt. OpenCode Start returns the accepted turn immediately, keeping Stop
available while the same JSKIT native owner observes completion. Conversation reads
retain working or failed state for that turn. Stop requires provider confirmation
within five seconds; a refusal or timeout leaves the turn available for retry. A
confirmed Stop cancels only that conversation's pending reads. Deleting a
conversation retires only its observer; provider shutdown drains all observers using
that provider.

Interactive Codex turns of a task conversation have no fixed completion deadline.
They remain observable until completion, Stop, deletion, or loss or replacement of
the shared provider connection. Short helper turns retain their bounded deadlines.

After the original coordinator has saved a native conversation ID, its admitted
Send, read, wait, Stop and delete operations acquire the same JSKIT scoped native
handle used by the existing provider. That handle keeps the real parent session,
the conversation's routing context and native identity; it does not create a Helper
scope or a second state record. Explicit Close still owns native deletion, while
runtime shutdown preserves durable native history. JSKIT's existing scoped owner
performs the original persistent read/reconciliation, duplicate and active-steering
decisions, demand creation, Start and exact native receipt inspection. These
operations run inside the existing application write lease and use its actual
transcript, stream and admitted session-agent operations. They create no copied
state, additional queue or delivery journal. Direct provisional rows remain
unconfirmed until exact native admission; routing policy still writes its receipt
after admission. A failed native read cannot prove acceptance or trigger replay.
Vibe64 retains discovery, draft saves, Router and task policy, authorized model and
skill preparation, attachment/receipt content, record layout and explicit Close
policy, routing-helper cleanup, attachments and logical-record deletion. The shared
persistent owner also performs the original idle/Stop/retain sequence before engine
changeover, canonical receipt recovery through the existing continuity owner, and
Stop/delete over retained native histories. Each successful history retirement is
saved before proceeding; failures retain the same retryable closing record. Native
and routing contexts keep their original stores and write-lease order, without a
second journal. The sessions-owned AssistantFeature accepts the
project/session/logical-conversation selector. Its common runtime handle delegates
Send, Stop and selection to the original authorized actions; read and delivery
inspection use the original logical write owner. It creates no native thread or
runtime metadata on open, and its native segment stays absent until the original
coordinator has saved the actual native ID.

Codex's existing scoped subscription, Claude's normalized message callback and
OpenCode's existing completion observer publish into the same scoped stream owner.
Original transcript reconciliation publishes the saved turns and retires their exact
live identities. No additional native observer or per-delta read is installed. Each
shared subscription rechecks project access before forwarding. Closing this
presentation handle preserves the saved conversation and its native work; only the
explicit Close performs destructive cleanup.

The bounded native output-schema validator originally owned by
`codexAppServerSessionBridge.js` now lives in JSKIT assistant-core's
`conversation/structuredOutput.js`. The Public bridge retains Helper profile and
error policy. OpenCode's original `openCodeDetachedPrompt` and
`openCodeStructuredOutput` live in the shared `conversation/openCodeTurn.js` owner,
used by both the Public terminal and common native driver. Claude and Codex forward
the validated schema through their existing native turn settings; the direct-API
engine rejects that unsupported configuration before inference.

## Close, archive and restart

Close is one server operation, run when an ended task is closed by a person, by
Colleague or by starting the session's next task:
retain the closing record, pause any goal, confirm native work stopped, delete the
native conversation, remove its owned attachments, then delete the record and
transcript. A failure retains the record and offers the same Close again, including
after reload; a repeated Close finds nothing to do. File edits remain. Close verifies
stop and deletion for every visited binding, saving each successful removal, so a
failed later deletion remains retryable without repeating earlier successful ones.
During routing it waits for a late native start and helper cleanup before removing the
conversation. Failed helper cleanup retains the parent record for another Close;
Renew and Archive also retain sessions that still own helper cleanup. Scoped receipt
checks recover uncertain native admission, including while the accepted turn is
still active. Closing or stopping cancels pending delivery and cleans up retained
helpers. After the cleared stream is published, Close retires the conversation's open
entry in the shared conversation runtime (`retireOpenConversation`), so its old
handles close, and the session realtime event identifies the closed conversation.
For Claude, the retained JSKIT conversation owner coordinates verified Stop and
active native-transcript deletion, then awaits Vibe64's saved metadata and scoped
receipt removal before retiring the entry. The original deletion guard and
application receipt storage remain in Vibe64; archival history retirement remains a
separate preservation workflow.

Archive retires every task conversation entry of the session the same way, after
the Main session closes, while keeping the saved records. Service shutdown drains
pending delivery before closing native providers. Server startup restores discovery
and finishes recorded Close attempts. Work discovered without its original backend
observer is stopped; restoration does not send or resume a turn. Active task work and
Codex goals also prevent dormant-project cleanup, just like main chat. Claude counts
only a turn its server is running; one saved as active before a restart ended with
that server and does not keep the project open. The shared owner reports an expired
health-probe deadline without stopping Main or task conversations. Vibe64 records
shared-process stop reasons and session counts through its operational logger,
including recovery failures, without requiring session debug logging. Provider
identity and credentials are not included in that event.

## Optional recent Main context

The New AI task form offers an unchecked **Include recent chat context** option
when Main chat has messages; Colleague's `start` accepts the same choice. Cancelling
the form creates no record and sends no turn. Creation captures at most forty
canonical visible user, assistant and commentary messages from the authorized
session's Main transcript, bounded to 64 KiB of text, without attachment payloads or
reasoning. The shared goal-message classifier excludes native management records
just as the transcript UI does; the existing exact objective decoder removes
generated role envelopes from remaining visible goal text. The optional
`recentChatContext` field belongs to the newly created record; absent means no copy.
Repeated creation with the same ID preserves the captured text and timestamp.

The conversation's routing owner supplies this immutable snapshot to the existing
conversation continuity owner alongside its own transcript. Existing seen/pending
admission state delivers context and manages retries and model changes. Copied
messages are not written as newly delivered turns. Main remains unchanged, and
neither conversation observes later messages or edits in the other.

## Scoped helpers on the same runtime

Task conversations and lightweight helper conversations use the parent session's
selected Codex or OpenCode service, but they do not start or retain a second
resident assistant service. Scoped helper cleanup removes its native conversation and
environment entry, while the existing project runtime retains the shared OpenCode
service for the next helper. Project closure, runtime invalidation and server
shutdown still stop that service. Each new request rechecks its selected connection
and access.

The terminal service also exposes one generic non-project ephemeral conversation
seam for a composing host. Its exact scope supplies a private absolute working
directory, private runtime root, empty or explicitly bounded environment, provider
binding id, and one bounded host-authored stable context. It requires an explicit
admitted provider/model selection but requires no project, session, worktree,
History, or Genesis project conversation kind. The host can opt into native
persistent retention without relaxing this scope; its own storage still owns
discovery, transcript and explicit clearing. Persistent interactive waits have no
default turn deadline. Native completion, Stop and connection loss settle the wait;
an explicit deadline or a bounded Helper execution profile still limits the turn.
Codex runs that scope read-only with dynamic tools and inherited facilities
disabled; OpenCode retains its native tool definitions with approval required, and
the session plugin rejects every host-conversation tool call before native
execution. The guard also refuses unregistered conversations and applies through
verified native ancestry. Without that plugin, the host agent remains deny-all. This
preserves Zen's native request format without granting shell, filesystem, network,
or subagent execution. Stop, read, wait, deletion, provider cleanup, and unchanged
authored turns reuse the ordinary provider lifecycle. Codex deletion detaches the
exact thread/provider from a shared process or requires verified exit when that
runtime is no longer shared; it retains the exact binding for retry when exit cannot
be proven. A composing product presents that lifecycle with its own view, without
changing the project-writing contract of task conversations.

Router uses the generic non-project seam with its existing bounded workload. Scoped
Codex, Claude and OpenCode profiles use the exact resolved model; profile provenance
covers scope, actor, connection and destination and cannot be restored as inference
authority from a saved JSON snapshot. Input/output limits, deadlines and tool
restrictions remain provider-enforced. Lifecycle operations carry the same scope and
provider settings, without the parent session's runtime or binding. Codex wait
retains the original deadline and interrupts the exact turn on timeout. A bounded
Codex Helper also retains its admitted native account signature until completion.
Public validates that same signature before exposing the result; a same-account
credential refresh remains valid. The shared run owner keeps the Helper busy during
validation, and a late check cannot revive a stopped turn. The parent retains its
original cleanup receipt and retry ownership. OpenCode wait retains bounded-output
validation even with an explicit timeout. Claude applies the helper's output limit to
answer text and structured results; reasoning keeps the normal block-size limit
instead of consuming that allowance. Router refuses interrupted or failed helper
results before parsing a decision, preserving the provider's error and cleaning up
without dispatching the request. Claude reports its managed execution ID before
inference so the parent request can retain it for restart cleanup. Cleanup uses the
captured native reference and must verify stop; it does not authorize another
inference. Cancellation before native thread creation also releases any catalogue
runtime owned by that scope. The same JSKIT runtime owns the original bounded helper
coordinator through `runScopedTurn`. The manager supplies its existing admitted
operations and keeps the required live-profile validation and audit snapshot. The
shared coordinator awaits the parent's native-identity event before starting. Abort
during startup stops the late native turn; abort while waiting stops that same scoped
turn, retaining Stop-failure precedence over an earlier wait or abort error.

Scoped Codex, Claude and OpenCode Send, read, wait, Stop and explicit deletion enter
the same JSKIT conversation runtime through its native representation. Each native
driver invokes its existing shared owner: Codex's run owner, Claude's conversation
owner, or OpenCode's shared runtime. Application bindings supply the authorized
scope, native identity and original preparation; they open no main session store,
copied transcript or additional delivery journal. Before a native ID exists, the
shared coordinator invokes the same admitted creation operation and awaits the
parent's thread receipt; it creates no placeholder identity or second runtime.
Repeated responses reuse the supplied native conversation ID and return the actual
new turn ID. Native wait keeps the exact run and original deadline. A failed delete
or provider-exit proof retains the common handle and the feature receipt for retry.
Runtime shutdown releases the original scope's provider resources; it does not clear
the feature's durable cleanup reference or delete its paths. OpenCode's private
scoped preparation retains the guarded profile, authorized context, original
input/output/deadline bounds, historical message identities and product
publication. Its lazy cleanup descriptor is read only after successful native
deletion; the same shared runtime owns lifecycle and reuse. Claude's original
authorized entry acquisition supplies the same retained entry to its shared owner for
each operation. Session close still drains those entries and closes its terminals
before an explicitly requested cached-binding release. After restart, its parent's
captured managed-execution receipt still drives verified Stop before native history
or the retained scoped record is removed.

Save naming and suggestions resolve the actor's effective Quick helper, and source
explanations and database help its Explain & check, through this seam. Each feature
retains its own durable helper-cleanup references, exact destination and connection
identity; the last main-chat model does not determine helper access. Prompt
suggestions, commit subjects, database help, and source explanations use the bounded
low-cost execution profile in a private non-project workspace. Their complete task
prompt is their only model context: they receive neither Genesis project context nor
Vibe64 driver output. Codex helper admission is bound to the shared service's Vibe64
login identity. Its fingerprint remains stable across native token refreshes and
server restarts, including when native ChatGPT tokens omit the OpenAI account ID. A
new Vibe64 sign-in replaces that local identity, so it cannot reuse earlier helper
ownership. Isolated runtimes that explicitly transfer authentication still require
the actual OpenAI account ID and never substitute the local login ID. OpenCode tasks
use the same model-advertised response-limit policy as the main conversation, and
any narrower task-specific limit remains authoritative.

Bounded tasks use the central resolver's exact destination. Their provider profiles
validate that model and enforce workload limits without choosing an implicit
fallback. The profile retains the model for that task. Codex requires low thinking;
Claude validates low effort when the model exposes effort controls. Claude's
tool-free process uses the selected account's private home without the project's
command environment, Genesis prompt or driver. Routing changes affect new tasks.
Bounded operations use the `helper` execution profile and the model and thinking of
their purpose's role: Explain & check for source explanations, database help and
lesson reviews, Quick helper for titles, commit subjects, prompt hints and summaries;
Auto classification uses Router's separate assignment. The profile constrains tools,
environment access, output and time, not model selection.

Managed OpenCode Helper turns preserve the same native tool definitions as ordinary
requests. The existing execution plugin enforces the conversation's actual access
when a tool is called; a classification task does not gain coding access merely
because definitions are present. Without the plugin and its trusted session
registry, the Helper remains denied. Routing therefore admits a connected OpenCode
model for Router, Explain & check and Quick helper as well as chat. Vibe64 offers no
account-free model: OpenCode Zen's free Big Pickle is never offered, so without a
connected AI these background workloads are not admitted.

The shared Codex Helper owner restores durable ownership only while its exact
managed runtime and provider context remain current. If the runtime has disappeared,
it atomically retires the stale ownership. If the provider context changed under the
same account, it first verifies retirement of the earlier runtime and then retires
the ownership, allowing a fresh bounded helper instead of reporting a false account
conflict. A real account change cannot adopt or delete the earlier account's
threads. Cleanup-required records can be retired through the local runtime owner: it
verifies shutdown of that account's process, or verifies that a replacement was
already installed after shutdown. It never stops a replacement for stale cleanup.
The existing background-task history records retirement and cleanup failures;
unverified records remain for retry on the next reconciliation. Each reconciliation
reports one result per session: any remaining failure keeps the cleanup status
failed, even when other records were successfully retired. Prompt-hint cancellation
awaits interruption before attempting thread deletion. The runtime owner notifies
the waiting task only after verified retirement and durable ownership removal. The
task uses that acknowledgement for its exact thread instead of interrupting or
deleting it again. Failed retirement retains ownership and remains reportable and
retryable through the same runtime owner.

The original native Helper interruption, thread deletion and invalid-request
read-back proof live in JSKIT assistant-core's `codexProvider.js`. Its shared Helper
lifecycle writes cleanup-required ownership before invoking that operation and
removes the durable receipt only after success. It also owns native cleanup
coalescing and provider retirement. Native conversation commands call that same
Helper owner directly at the original control-inspection point; a returned
retirement promise still releases application admission before settling. Vibe64
retains account/profile authorization, authorized storage locations, application
cleanup policy and retry/error presentation. Scoped preparation supplies its
existing verified isolation owner once for compatibility checks and execution.

The original detached Codex turn watcher, immediate status handling, provider
failure detail grace and completion wait belong to JSKIT's existing run owner. Its
conversation commands project the native thread ID after ordinary or Helper
acquisition. The same Helper owner retains the pending-start map and awaited ACTIVE
receipt: dispatch failure retires the Helper before releasing that map entry, while
successful dispatch releases it before waiting for completion. Account rechecks and
the READY receipt also belong to that owner. The original server-only detached
run/stream facades use one lazy operation on that same common runtime and native
owners, without opening Main or writing a canonical transcript. The manager retains
fresh access and trusted profile resolution. No-profile calls retain the Main writer
lease for the complete turn; profile calls retain their separate admission.
Codex/OpenCode emit the original audit before dispatch without awaiting it; Claude
acquires its entry before awaiting the audit and starting work. Admitted context
remains separate from each engine's original native options. Vibe64 supplies Codex's
ordinary and Helper preparation, output bounds and contextual errors; shared owners
retain watcher, account rechecks and Helper lifecycle. Current bounded tasks also use
the unchanged scoped runtime. Saved Helper receipts keep their existing
interrupt/delete cleanup.
