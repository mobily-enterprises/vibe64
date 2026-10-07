# Pinned teaching content and recovery

This topic explains verified lesson content, private progress and owner recovery.
For host-registered learner controls and assessment, read **Learn with Colleague**
(`learning-with-colleague`). For authoring and Git publication, read **Author a
lesson and publish its source** (`lesson-authoring`). The underlying facilities
below do not by themselves add learner controls or grant Colleague source access;
available operations depend on the host registrations described in those topics.

The internal orientation check reads the lesson's exact installed check and runs
it against the current App server. It does not run a mutable copy from the
learner's project and is not a Colleague shell tool. A successful check confirms
only that server's matching button response; the lesson still requires the
learner's own observed interaction and explanation before assessment. If the App
restarts or the response expires, repeat the actual button interaction. If native
execution cleanup is uncertain, report that failure for operator recovery rather
than claiming success or resending an old observation.

Opening or minimising Colleague during workspace-navigation is ordinary chat
use, not an assessment step; it preserves the question and accepted steps. Only
return-to-Colleague collects actual minimise/restore gestures. After its saved
pass is confirmed against the native accepted-answer and evaluation receipt,
normal launcher use no longer arms that completed question, including after a
restart. Explicitly requested practice uses a new delivered question; earlier
passes stay saved. Unconfirmed current tasks still require the original order.
Continue project → Main coding conversation → Preview under the same question.

On a phone, after minimising Colleague, **Show project** counts as the workspace
step when it reveals the selected **Preview**. Reopen Colleague with its dedicated
avatar launcher under the same pending question. Dashboard, automatic attention,
swipes and programmatic navigation do not create Preview evidence.

A lesson version must remain pinned to the content the learner started. If its
content is reported missing or invalid, ask the workspace owner to restore that
exact verified revision. A newer bundle or a draft is not a substitute for the
missing lesson, and retrying must not reset learning history. Colleague can explain
this recovery and offer to formulate the request; it cannot reinstall content.
The server can read the declared visual's exact SVG, controller and asset bytes
from that same verified lesson revision. This adds no animation viewer or
Colleague source access: Colleague cannot request arbitrary files, run the
controller or claim that an animation has played. Missing or invalid visual
content follows the same owner recovery above. Reading these resources alone adds no learner
start/install control. The server can also read the
same lesson's declared bundled exercise files. Reading them does not prepare a
project or run Preview, and gives Colleague no source access. Ordinary project
and Preview permissions still apply; this internal API grants no new access.

An internal isolated diagram player can consume the verified SVG and controller
bytes from that reader. It displays an accessible title and current explanation;
**Reload diagram** recovers a failed channel from its last semantic snapshot
without replaying unfinished commands. Acceptance means a command started, not
that its animation completed. The authored controller owns completion and retry
receipts. This facility supports self-contained diagrams, adds no asset or network
loader, and leaves placement to the existing Preview host. It does not by itself add an
authenticated learner control, a Colleague tool or saved learner progress. Colleague
must not claim an animation played or obtain controller source or screenshots.

In a prepared lesson, the Preview host saves the real diagram's semantic state
after a completed command or a confirmed pause. Reopening that same attempt
restores its last confirmed state, paused flag and labels into a new player; it
does not replay motion, narration or a completed cue. Snapshot reads alone save
nothing. If **Retry diagram checkpoint** appears, retry the retained exact save.
**Save current diagram** captures a fresh state after a rejected revision conflict.
Keep the diagram open until confirmation; a hard reload can recover only the last
confirmed checkpoint. These saves preserve the question and earlier assessments,
and never grant a pass. If a concurrent assessment conflicts, read its saved
result and retry its existing operation with the current revision.

The application also has a server-only verified-snapshot installation facility.
It has no visible control or Colleague tool; the local operator commands in **Author a lesson and publish its source**
invoke the original installation owner.
An admitted owner operation must select the canonical local source and exact
course pin. Colleague can explain this boundary and offer to help contact the
workspace owner through the supported conversation actions; it cannot choose a
filesystem path, install content or grant course access. A busy installation can
be retried after its current operation finishes. Existing invalid content requires
owner inspection; it must not be replaced automatically during lesson reads.

The server retains a private pinned lesson reservation. This storage facility
alone adds no learner start/resume control or Colleague lesson tool. Creating a reservation
does not mean that the exercise is prepared or that a quiz has passed. Colleague
should explain what is available and offer to help through its current supported
conversation actions, using the host-registered lesson operations described in **Learn with Colleague**.

When a lesson operation reports an interrupted save, retry its same request
identity. A saved reservation with a missing summary must resume that same attempt;
it must not create another project. Busy state means another update is active, not
that progress was erased. Corrupt or mismatched state requires owner inspection;
opening projects or switching devices must not manufacture a repair or a pass.
These internal facilities add no separate desktop/mobile controls in this release.

The internal preparation record now distinguishes a reservation, pending setup
with its saved initial session, and readiness actually reported by the admitted
server owner. This record alone adds no learner start control or Colleague tool. A saved
session ID is not proof that setup succeeded. Colleague should explain a genuine
reported failure and offer supported assistance; it must not claim a pass or a
running Preview from the reservation or diagram. Ordinary project and Preview
permissions apply. Retry/resume retains the exact project/session association;
if a save is unconfirmed, read or retry that same operation before creating anything.
A recorded ready time describes an earlier observation, so a future resume must
check the actual environment again.

An admitted server operation can exclude duplicate preparation of the same
learner's saved attempt while project/session/setup work runs. A busy response
means wait for that operation, then retry the same attempt; it does not mean
progress was lost or authorize creating another exercise. The internal lock adds
no visible control or Colleague tool and does not prove setup or Preview succeeded.

Before first-session preparation, the admitted server can verify that the
saved canonical source matches the exact exercise. A mismatch requires inspection,
not overwriting the project or pretending preparation succeeded. Existing sessions
keep their edits and use ordinary recovery. This internal proof adds no visible
control or Colleague tool and does not show that Preview is running.

An internal project provenance marker can retain the learner attempt and exact
exercise pin at trusted creation. It does not grant or restrict project or Preview
access, record a pass, or prove that setup succeeded. It adds no visible control
or Colleague tool in this release; existing project controls remain unchanged.
The owner must complete the candidate's stopped-writer compatibility upgrade
before a release activates these training writes. Recording that boundary
does not prepare an exercise, grant access or create learner progress. Colleague
can explain this prerequisite and offer supported assistance contacting the owner;
it cannot run the operator upgrade through its current tools.

The server now also retains owner-approved course releases and their enablement.
This is still an internal facility, with no course-enable control or Colleague
tool. Colleague can explain the boundary and offer to help formulate an owner
request through supported conversation actions; it cannot grant course access.
A fresh enabled catalogue read admits a new start. Disabling that release
blocks later admissions without revoking already admitted work or saved attempts.
Missing or corrupt installed material, even in a disabled release, requires the
owner to restore its exact approved pin. Resume uses the saved pin independently;
neither catalogue failure nor publishing a newer release resets the reservation.
An unconfirmed catalogue save requires reading its actual current revision before
the owner deliberately retries. It is not evidence that enablement changed.

The private lesson record can now retain a pending question, teaching position,
diagram state and assessment results for the saved lesson version. These storage methods alone add no
quiz/start/resume control or Colleague grading tool. A pass requires an admitted actual learner answer or a native
practical observation tied to that learner's prepared project/session. An assistant
paraphrase, demonstration or animation is not evidence of a learner pass. Completion
requires every required pinned assessment to pass; preparation alone does not count.
Colleague can explain this boundary and offer supported assistance, but cannot
assert trusted observations, fabricate results or erase history by retrying.

After starting or resuming, Colleague must read the fresh teaching brief, recap
its exact pinned passed and remaining assessment IDs, and normally continue a
remaining task. The saved `resume.pendingQuestion` is the last checkpoint; it may
belong to an assessment that already passed. Explicitly requested practice or
reassessment remains supported and keeps the earlier pass. A request to resume,
open the project, inspect setup or navigate is not an answer to grade. A fresh
conversation must prepare and actually deliver its next question before assessing
a new learner answer; it cannot reattach old messages or infer missing provenance.
These read-only progress facts preserve the checkpoint, visual state and history.

If a future result/resume save is unconfirmed, read or retry its exact submission
or current checkpoint identity. A changed revision requires reading current state
before another write. A reused evidence reference or conflicting identity requires
inspection rather than resubmission as different work. Missing pinned content must
be restored by the owner. There is still at most one active attempt. Internal explicit retirement can
retain ended history, but this alone adds no restart/discard action or control. The owner must apply the stopped-writer assessment
compatibility boundary before activating these writes; it does not convert old
reservations or grant access. Desktop and mobile controls are unchanged.

Offline recovery remains an owner operation with every learner-state writer
stopped. Before publishing a private checkpoint, the documented staged restore
checks saved assessment and resume facts against its exact installed lesson.
Conflicting facts or missing content stop recovery without changing live records;
Colleague can explain the recovery procedure but cannot repair or replace them.
