# Choose Auto roles and follow the workflow

For the Plan and Progress tabs and archived artifacts, see [View a plan and
its history](plans.md).

In **Auto**, name **Senior** or **Junior** in your message to choose either role
for that request. For example, “Junior developer: say hello” needs no plan, and
“Senior, implement the current plan” uses Senior for implementation.

Without an explicit role, Senior handles discussing, writing and improving plans,
review and Deslop. Junior implements an existing plan: say “Execute the plan” or
ask it to continue implementation. Answering the plan's open questions so coding
can proceed also defaults to Junior; recording accepted choices or implementation
progress does not change that default. An explicit Senior or Junior request
always takes precedence. Junior also handles other questions and work, including
implementation without a plan. The router uses your new request, the last three
visible messages and a short current-plan summary to understand follow-ups.

Auto uses three workflow states: **Working**, **Waiting** and **Complete**.
The current stage is separate: **Planning**, **Implementation** or **Review**.
Router chooses a role and one of conversation, planning, implementation or review
only for a new Auto request. It does not decide what happens after each turn.

The working agent reports one of four outcomes:

- **Continue** keeps its stage and role while authorised work or checks remain.
- **Handoff** moves finished implementation to Senior review. If Senior discovers
  substantial necessary rework, Senior updates the technical plan and Progress
  within the agreed outcome and hands that work back to Junior. Junior finishes
  it, then Senior reviews again and performs any enabled Deslop.
- **Wait** retains the stage for a real blocker, your required decision or an
  explicit pause. A status question or clarification is incorporated into the
  ongoing work; it does not abandon review.
- **Complete** is available only to Senior after verified review. Senior explicitly
  completes an involved plan before Auto archives it after the final explanation.

The agent's concrete explanation appears as an ordinary **Status** message in
chat. It is evidence of the reported work, not independent verification.
Auto waits after two consecutive turns without reported progress or eight
automatic steps. Inspect the reason and select **Resume workflow** to continue
with a fresh allowance. This does not grant permission to change the product scope.

If implementation is blocked on a requirement you want to defer, say so explicitly
in **Auto**: for example, “Exclude actual email delivery from this implementation.
Keep email setup and real delivery testing as future work before release, and
finish the remaining plan.” Without an explicitly requested role, Router sends
this scope change to **Senior**, who can edit the saved Plan. Junior can update
Progress but cannot remove agreed requirements.

Senior records the deferred requirement and its agreed timing under **Deferred
work** in Progress before removing it from the current acceptance scope, keeping
the completed implementation evidence. When every remaining item is checked and
supported by evidence, Senior hands the revised implementation to separate Senior review
and any enabled **Deslop**. Missing resources for the explicitly deferred work
do not block that review. Remaining implementation continues; a pause or missing
evidence can still stop the handoff. Ordinary draft-plan edits do not trigger
review just because all their items are checked.

Deferral does not complete the excluded work or schedule it automatically. Its
record stays with Progress, including after the reviewed plan moves to History.
Use the document icon beside the usage percentage to open **Progress** in
Current plan or History. Explicitly request the deferred work when ready. The same conversational steps apply on desktop and mobile. Colleague can
explain this process and offer to send your explicit scope-change request through
the existing chat action; an explanation or offer alone does not authorise it.

The composer's **Stop** pauses the current workflow and interrupts active work
or request preparation. Auto retains the stage, plan and completed changes.
A late successful result cannot undo Stop. Select **Resume workflow** when ready;
this starts a fresh turn at the retained stage. A failed or interrupted turn, or
one ending without a confirmed outcome, leaves **Waiting** with a concrete reason.

After a server restart, unfinished scheduling requires explicit **Resume workflow**;
opening a session never sends another turn. **Check delivery** checks the original
receipt of an uncertain message without sending a second copy. If the plan or
conversation changed before an unsent handoff, stop it and send a fresh request.
An unsent handoff shows **Stop** beside **Resume workflow**. Stopping it preserves
history and file changes, and lets you send a new request. A delivery check remains
necessary for an uncertain attempt; stopping does not prove it was never delivered.

Recovery errors and controls stay above the composer; workflow explanations stay
in the scrollable chat. Desktop and mobile use the same controls. Colleague can
explain the retained stage and blocker and offer to stop work or send your requested
continuation through its existing actions. An explanation or offer alone does not
authorise another turn. Colleague's watches treat Waiting as needing attention.

Auto always uses a separate Senior review after implementation, even when Senior
implemented it or both roles use the same model. The **Deslop** switch adds
behavior-preserving cleanup to Senior review; turning it off does not disable
review. Unfinished checks continue in Senior review; substantial necessary rework
returns to Junior and comes back for another review. A changed product requirement
needs your decision. Planning-only work waits for your request to implement it.
Direct Senior, Junior and Custom keep their direct behavior without automatic
continuation or review. Junior cannot mark a plan completed.

Executing the current plan requires it to be Active. A missing or Completed plan
is explained without reviving an old task. Independent work does not need a plan.
Junior can update Progress; only Senior can manage its lifecycle and
explicitly mark it Completed after verifying the evidence.

If an automatic handoff failed before its message was sent, you can type a new
request and use the ordinary **Send** button (or speak a new request). Sending
replaces that failed, unsent handoff; it does not mark its review completed.
The previous coding history, plan and file changes remain. **Resume workflow** still
resumes the retained stage, and **Stop** cancels it without sending new work.
A handoff with unconfirmed delivery still requires **Check delivery** first.
Colleague can explain these choices and offer to help you continue; sending new
work requires your direct request or accepted offer.
