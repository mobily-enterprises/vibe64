# Choose Auto roles and follow the workflow

For the Plan and Progress tabs and archived artifacts, see [View a plan and
its history](plans.md).

In **Auto**, name **Senior** or **Junior** in your message to choose either role
for that request. For example, “Junior developer: say hello” needs no plan, and
“Senior, implement the current plan” uses Senior for implementation.

Without an explicit role, Senior handles discussing, writing and improving plans,
review, Deslop and the [UI pass](ui-pass.md). Any request to make, write, save,
update or extend a plan goes to Senior as planning, including "Yes, make a plan
from it" as the answer to a numbered question, "OK make the plan!", a plan built
from the conversation so far, and "in the same plan" to add work to the current
or a completed plan. Agreeing to make a plan never starts implementing it.
Junior implements an existing plan: say “Execute the plan” or ask it to continue
implementation. Answering the plan's open questions so coding
can proceed also defaults to Junior; recording accepted choices or implementation
progress does not change that default. An explicit Senior or Junior request
always takes precedence. Junior also handles other questions and work, including
implementation without a plan. The router uses your new request, the last three
visible messages and a short current-plan summary to understand follow-ups.

Auto uses three workflow states: **Working**, **Waiting** and **Complete**.
The current stage is separate: **Planning**, **Implementation** or **Review**.
Router chooses a role and one of conversation, planning, implementation or review
only for a new Auto request. It does not decide what happens after each turn.
A conversation request only gets an answer: its agent reports no outcome, Vibe64
records the reply as finished when the turn ends, and no Status message appears.

A request that needs a plan always gets one, and you never have to ask for
Senior. If Router sends such a request to Junior (or treats it as conversation),
the agent still writes the plan and sends it to the plan helper; creating a plan,
changing its scope, reopening or archiving it is Senior's, so the helper hands
the same request, with that draft, to Senior instead of saving it. A **Senior is
saving the plan.** notice appears, the chat shows the automatic **Senior saves
the plan.** message, and as soon as the first turn ends Senior saves or corrects
the plan in a Planning turn of its own, asking first when a current plan exists
and you haven't said whether to update it or archive and replace it. Planning
then waits for your go-ahead as usual. Router's mistake costs one extra turn.
**Stop** during the first turn hands nothing on. This happens only in Auto: in a
Junior chat, which you chose, Junior still can't create a plan and tells you to
switch **Chat mode** to **Senior** or **Auto** and ask again.

At planning, implementation and review, the working agent reports one of four
outcomes:

- **Continue** keeps its stage and role while authorised work or checks remain.
- **Handoff** reports finished implementation. When Junior implemented the
  current plan, Senior then checks the plan in a turn of its own: it reads every
  page of Plan and Progress, verifies each requirement, fixes in-scope gaps and
  completes the plan, or leaves it active with the gaps recorded in Progress. If
  Senior discovers substantial necessary rework, Senior updates the technical
  plan and Progress within the agreed outcome and hands that work back to Junior.
  Junior finishes it, then Senior checks the plan again. Without a plan, or when
  Senior implemented it, the work ends with that turn: no review, Deslop or UI
  pass runs, and [Automatically save changes](chat-settings.md) saves it.
- **Wait** retains the stage for a real blocker, your required decision or an
  explicit pause. A status question or clarification is incorporated into the
  ongoing work; it does not abandon review.
- **Complete** is available only to Senior. Senior explicitly completes an
  involved plan after verifying it; once its final explanation is delivered, the
  passes ticked under **After a plan** in
  [Passes](passes.md#choose-the-passes-that-run-after-a-plan) run, each in its
  own turn, then Auto archives the plan and saves the work.

After implementation, Auto adds one turn only in one case: Junior implemented
an involved plan and that plan is still active, so Senior checks and completes
it. That check is not a pass, has no setting and runs no pass. Work done without
a plan is no longer reviewed, deslopped or UI-passed automatically: it ends with
its implementation, saved when Automatically save changes is on. Ask for those checks when you want
them, from [Passes](passes.md), through the Master pass, or by typing the
request in chat, such as **Deslop**, **UI pass** or "Review my changes".

A turn that asks you a question (numbered questions or **Possible answers**
choices, the replies for which the composer shows answer controls) always waits
for your answer, whatever outcome the agent reported, including when the agent
adds a short message after the questions, such as "I'll continue once you've
answered." The composer and this wait read the same questions: the newest among
the agent's last ten messages since your latest message. Auto never
moves to Senior's check of the plan, continues or completes past an open question. The notice
says **Waiting for your answer. Reply in chat to continue.** and offers no stage
**Continue** action; reopening the session or recovery after a restart sends
nothing. Your reply is a new request that Router routes as usual, so answering
"Yes, fix them" starts implementation, which, for a plan, Senior then checks. At
Planning with an active saved plan, **Implement plan** remains available.

The agent's concrete explanation appears as an ordinary **Status** message in
chat. It is evidence of the reported work, not independent verification.
Auto waits after two consecutive turns without reported progress or eight
automatic steps. Inspect the reason and select **Continue planning**, **Continue implementation**, or **Continue review**,
matching the waiting stage, to continue with a fresh allowance. This does not grant permission to change the product scope.

If implementation is blocked on a requirement you want to defer, say so explicitly
in **Auto**: for example, “Exclude actual email delivery from this implementation.
Keep email setup and real delivery testing as future work before release, and
finish the remaining plan.” Without an explicitly requested role, Router sends
this scope change to **Senior**, who can edit the saved Plan. Junior can update
Progress but cannot remove agreed requirements.

Senior records the deferred requirement and its agreed timing under **Deferred
work** in Progress before removing it from the current acceptance scope, keeping
the completed implementation evidence. When every remaining item is checked and
supported by evidence, Senior completes the revised plan, which starts the
passes ticked under **After a plan**. Missing resources for the explicitly
deferred work do not block that completion. Remaining implementation continues;
a pause or missing evidence can still stop it. Ordinary draft-plan edits do not
complete a plan just because all their items are checked.

Deferral does not complete the excluded work or schedule it automatically. Its
record stays with Progress, including after the completed plan moves to History.
Use the document icon beside the usage percentage to open **Progress** in
Current plan or History. Explicitly request the deferred work when ready. The same conversational steps apply on desktop and mobile. Colleague can
explain this process and offer to send your explicit scope-change request through
the existing chat action; an explanation or offer alone does not authorise it.

The composer's **Stop** pauses the current workflow and interrupts active work
or request preparation. Auto retains the stage, plan and completed changes.
Stop ends the turn: the next message you send is a new request, which Router
routes afresh as usual (naming **Senior** or **Junior** in it still chooses the
role). It never joins the stopped turn; sent while that turn is still ending, it
waits a few seconds for it to end, and if it is still ending after that, the
message is left unsent for you to send again.
A late successful result cannot undo Stop. Select the stage-specific **Continue** action when ready;
this starts a fresh turn at that stage. A failed or interrupted turn, or
one ending without a confirmed outcome, leaves **Waiting** with a concrete reason.

After a server restart, unfinished scheduling requires an explicit stage-specific **Continue** action;
opening a session never sends another turn. **Retry** checks the original
receipt of an uncertain message without sending a second copy. If the plan or
conversation changed before an unsent handoff, stop it and send a fresh request.
An unsent handoff shows **Stop** beside its stage-specific **Continue** action. Stopping it preserves
history and file changes, and lets you send a new request. A delivery check remains
necessary for an uncertain attempt; stopping does not prove it was never delivered.

Recovery errors and controls stay above the composer; workflow explanations stay
in the scrollable chat. Desktop and mobile use the same controls. Colleague can
explain the retained stage and blocker and offer to stop work or send your requested
continuation through its existing actions. An explanation or offer alone does not
authorise another turn. Colleague's watches treat Waiting as needing attention.

In Auto, only Senior completes a plan, even when both roles use the same model.
When Junior implemented it, Senior checks it in a turn of its own, which runs no
pass. Junior's implementation turns before it end by saying what changed and
what was checked, without asking you to try or publish the work; see [How each
turn ends](chat-settings.md#how-each-turn-ends). Once the plan is completed, the
passes ticked under **After a plan** in
[Passes](passes.md#choose-the-passes-that-run-after-a-plan) run, each in its
own Senior turn over the plan's changes, with a notice such as **Security pass
started automatically after the plan (Passes: After a plan)**; then the plan is
archived and **Automatically save changes** runs **Save**. **Review** and
**Security pass** always run; **Data pass**, **Quality pass**, [UI
pass](ui-pass.md) and **Deslop** are ticked for new chats. Work without a plan
ends after its implementation, with no Senior turn, and goes straight to
**Save**. Nothing runs when a turn ends. Senior, Junior and Custom work the
same way, except that only a Senior chat completes a plan; see [Choose what
happens once work is finished](chat-settings.md). Colleague can explain
automatic save and the passes after a plan and, for the owner, change them
through the chat mode action.

Unfinished checks continue in Senior's check of the plan; substantial necessary
rework returns to Junior and comes back to Senior. A changed product requirement
needs your decision. Planning-only work waits for your request to implement it.

Waiting workflow controls show only the available actions above the composer.
In chat history, select **Workflow details** to expand a saved outcome and its
reason; select it again to collapse it. Restored outcomes are also collapsed.
A separate delivery or cleanup error retains its own **Details** and recovery
actions until resolved. Clicking a workflow action immediately shows **Starting…**,
**Continuing…**, or **Checking…** on that button while it is submitted. Other
workflow submissions are disabled until it settles. **Continue planning**,
**Continue implementation**, and **Continue review** act on the saved workflow
without resending its original chat message. **Check delivery** inspects the saved
attempt without starting another copy. If a control cannot start or the saved
plan has changed, its error appears beside the controls; inspect the current
state before trying again. **Implement plan** still sends a new request, and
shows a refusal beside the controls if that request cannot start.

When Auto is waiting at Planning with an active saved plan, the notice offers
**Implement plan**, **View plan** and **Stop**. These are
specific alternatives, not a generic “resume” command. **View plan** opens the
existing Current plan dialog without sending anything. To revise the saved plan,
send the requested changes through the composer. **Implement plan** sends
a new human request authorizing implementation within the saved plan's scope;
it starts Junior implementation, followed by Senior's check of the plan. Your
composer draft and attachments remain untouched. The button cannot reinterpret
the original planning request or become another automatic planning continuation.

Planning, implementation, review and delivery-recovery notices use a compact
layout. The summary and actions share a row when space permits and wrap on narrow
screens. **Details** expands the full explanation; touch controls remain easy to tap.

Without an active saved plan, paused Planning offers **Continue planning**.
Only the relevant stage's continuation appears: paused Implementation offers
**Continue implementation** and paused Review offers **Continue review**. An
uncertain delivery offers **Check delivery** instead; it does not offer implementation.
If the selected plan changed or is no longer active, implementation is refused:
open **View plan**, inspect the current document, and send your intended request
in chat. No plan is silently reopened. These controls behave the same on desktop
and mobile. Colleague can explain them or offer to send your explicit request
through its existing chat action; an explanation alone starts no work.
Senior, Junior and Custom report the same outcomes, except that a message their
agent only answers, changing nothing, reports none (see [Choose what happens
once work is finished](chat-settings.md#when-work-is-finished)); their work ends
with their own agent's last turn, with no Router. Junior and Custom cannot mark
a plan completed.

Executing the current plan requires it to be Active. A missing or Completed plan
is explained without reviving an old task. Independent work does not need a plan.
Junior updates Progress and existing checklist marks as work goes: a half tick once an item is built, a full tick once
the plan's final checks prove it (see [Checklist marks](plans.md#checklist-marks)). Only Senior can manage the plan’s
lifecycle and explicitly mark it Completed after verifying the evidence, and only once every item is proven.

If an automatic handoff failed before its message was sent, you can type a new
request and use the ordinary **Send** button (or speak a new request). Sending
replaces that failed, unsent handoff; it does not complete that work.
The previous coding history, plan and file changes remain. The stage-specific **Continue** action still
continues the retained stage, and **Stop** cancels it without sending new work.
A handoff with unconfirmed delivery still requires **Retry** first.
Colleague can explain these choices and offer to help you continue; sending new
work requires your direct request or accepted offer.
