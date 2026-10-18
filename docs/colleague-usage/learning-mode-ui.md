# Choosing lessons and Learning conversations

Use the yellow **L** plate in the app header to switch between Working and
Learning. Its pressed state and highlighted header indicate Learning. It is the
first keyboard stop in the header: Enter or Space switches mode, and its tooltip
names the mode it will switch to. In a lesson with saved practice projects, the
**Practice project** menu sits beside it; on a phone it shrinks to its ▾ arrow so
the **Workspace**/**Learning** switch stays visible. On the
projectless app page, Working shows the original project picker; Learning shows
installed courses without asking you to invent or choose a project; its header
reads **Courses**. In a project
view, the same control changes the existing session panel's purpose filter.

The **Courses** pane (called **Lessons** in earlier releases) opens on a list of
course cards. Each card shows the course title, its ID and release, whether it is
**Enabled**, a **Preview course** or **Disabled for new lessons**, "N of M lessons
complete" and a progress bar. A lesson counts as complete when all of its required
assessments are passed in your saved progress; only required lessons are counted,
unless a course has none. Progress is read from what is already saved; opening a
course grades nothing. A lesson passed in one course counts in every course that
contains the same lesson.

On a card, **Continue** reopens your saved lesson when it belongs to that course;
it is the same request as **Resume saved lesson**. Otherwise **Start** starts the
course's first published lesson that is not yet complete. **View course** opens
the course page: its topics in order, each with its lessons, their title and code
and a status of **Completed**, **In progress** (an open attempt or some passes) or
**Not started**. The page has one main action, **Continue** or **Start next
lesson** (with the next lesson named beside it), and a **Start lesson** button on
each available lesson if you want a different one. **Back to courses** returns to
the list. While you have a saved active lesson, Start buttons stay disabled:
continue it, or end it first. On a phone the cards stack in one column and the
course page scrolls in the same pane.

Choose **Resume saved lesson** on the saved lesson card for the exact saved attempt. Disabled,
unavailable, loading and error states are shown on the same page. Choosing a
release is not permission to install or enable it. **Refresh courses** rereads
the catalogue and progress.
Returning from Working to Learning rereads saved lessons and any admitted author trial; a newly admitted trial does not require reloading the page.
If Resume reports that the saved exercise is busy preparing or finishing a command, wait for that operation to settle and retry the same attempt. Do not create a replacement.

### Creating a custom course

The workspace owner sees **New course** below the course cards (on local Vibe64
you are the owner). Enter a **Course name**, tick whole topics under **Installed
topics**, put them in learning order with **Up** and **Down** under **Topic
order**, then choose **Create course**; **Cancel** closes the form without
changes. The new course opens straight away and stays in the list for everyone in
this installation. Only topics from enabled, released courses are offered. The
course is pinned to those exact installed topic releases, so it never changes
lesson content, and saved progress is shared with the original course.

If creation fails, the message appears at the top of the pane: a name that is
already used (choose another name), a catalogue that changed meanwhile (use
**Refresh courses**, then try again), a topic that is no longer available, or the
16 course-release limit. Other people cannot create courses; on hosted Vibe64
only the workspace owner can. Colleague can create a custom course when the owner
asks for it with a name and topics. A custom course cannot be renamed or edited;
the owner can disable it with `vibe64 training disable-course` (see
`docs/training-content.md`) and create another one.

A course labelled **Preview course** is not available through ordinary Start,
even when its individual lessons are published. It needs an authorized author
trial or a released, enabled course; changing views does not bypass that rule.

Practice commands and their Git operations stay with the saved lesson until they
finish. If a command is still finishing, wait before ending the lesson. After
cancellation or End, an old command cannot restart work; resume the same saved
attempt only when you intend to continue.

When Learning first creates its teacher session, it uses the first available AI
workflow shown by the normal session picker, then checks your current Junior
model and account access. It does not assume OpenCode is configured. You can
change the teacher's AI through the normal chat model controls afterward. If no
workflow is available, connect/configure one in **AI Accounts → Model routing**,
then resume the same saved lesson or author trial; do not start a replacement.

The Main teacher uses the saved lesson's exact instructions with Codex, Claude
or OpenCode. In a practice project those instructions accompany the project's
normal development guidance; switching AI does not turn the lesson into an
ordinary coding task. The teacher should give the declared learner task and wait
for your own answer or action. It must not ask you to reconstruct the installed
lesson, invent an observation or count its own demonstration as your pass.

After a confirmed active Start or Resume, the existing Main conversation is
opened and selected only if its loaded row matches your learner and attempt.
The teacher chat stays visible throughout Learning, including after opening a
lesson or reloading the page. The right side gains **Workspace** and **Learning**
tabs. **Workspace** reveals the ordinary **Preview**/**Dashboard** tabs. In a
practice lesson, **Dashboard** shows the practice app's **Database** view: its ERD,
tables and data, read-only. Running a change to data reports that Learning shows the
data read-only; change data in a Working session. An app without a database shows
"The session Stack does not declare a supported database." A practice lesson's
**Dashboard** also has a **Code** tab next to **Database**; see "Answering a code
question" below. Switching between Preview and Dashboard keeps Learning
on and retains the same selected teacher session; it does not switch to your last
Working session. **Learning** reveals the existing **Courses** and
**Presentation** controls. Returning from Workspace keeps the selected Courses
or Presentation content visible without requiring another click. A supervised
project opens in Workspace by default. On reopening, Workspace waits for the
assistant's initial connection check to settle before opening the saved practice
runtime. It still opens if that check reports an unavailable or failed AI;
repairing the AI connection is separate from using the practice Preview.
A source-less lesson disables Workspace and explains that it has no project,
instead of showing a remembered Working project. On phones and tablets, the same
two choices remain available around the stacked chat and right-hand content.
Learning has no chat-collapse or pane-swipe control.

### Answering a code question

Some practice lessons ask you to change code, for example "make `notes.mjs`
refuse an empty title". To answer:

1. Choose **Workspace**, then **Dashboard**, then the **Code** tab (beside
   **Database**). It is the ordinary source editor for this lesson's practice
   project, showing code only. Downloads, new files, file uploads, file areas,
   integrations, stars and **Explain** are not available here; ask your teacher
   in Learning instead. On a phone, use the files button to show or hide the
   file list.
2. Open the file the teacher named and edit it. Your changes save automatically
   a moment after you stop typing; the editor shows when a save has finished.
3. Press **Check my code**. The lesson's declared check runs on a private copy of
   the pinned exercise with your saved version of the named files. The result
   appears next to the button: either "Your code passed the check…" or
   "Not yet: …" with the check's reason (for example "Empty or blank titles are
   still accepted", or that the check stopped after its time limit because the
   code never finished). Fix the code and press **Check my code** again as often
   as you like; only your latest check counts.
4. After a passing check, explain to your teacher in Learning, in your own
   words, what you changed and why. The teacher submits that explanation with the
   check for grading. A pass is saved only when the check passed **and** the
   explanation meets the lesson's rubric.

What counts: only edits you saved yourself in this **Code** tab since the
teacher asked the question. If anything else changed a named file in the
meantime—the teacher or another assistant, a terminal command, Git, or another
editor—the check does not run and reports "needs an independent attempt: other
edits detected in `<file>`". That question cannot pass; ask the teacher for a new
question and write the change yourself. The teacher is instructed not to edit
those files or send solution code; it can give hints and point to lines.
Checking never saves progress by itself, and a check without your explanation
is not a pass. **Check my code** requires this lesson's Learning conversation
to be connected in this browser. Every press either checks your code or shows
why it could not in the line under the button: "This lesson's Learning
conversation is not open here" (open the lesson conversation, then press again),
"There is no open lesson question yet" or a report that the question is not a
code question (ask the teacher for the code question first), or "Earlier presses
are still being handled" (wait, then press again). Colleague can explain
these steps but cannot type, save or check code for you.

You can ask Colleague to enter or leave Learning, show **Courses**, show the
active lesson, or reveal the exact lesson project's normal **Preview** or
**Dashboard → Database → ERD**. Main can reveal those same workspace views only
for its bound active lesson, and can return to that lesson's Learning pane or
open a visual declared by its pinned content. Both use the same initiating
browser and wait for its actual settled mode, pane, session and attempt before
reporting success. For a declared visual, confirmation follows the visual opening;
the earlier Courses view is not its success receipt. This also applies when a
saved lesson finishes loading after the chat first appears. If the lesson or
visual changes while opening, the request is not confirmed; return to the intended
saved lesson before requesting its visual again. On a phone, the request changes
the same stacked panes; it
does not open another app or conversation. Showing **Courses** does not start a
lesson, leaving Learning does not end one, and any agent-opened view is a
demonstration rather than evidence that you performed an assessed step.

Use Colleague's eye button to manage polling for the lesson task currently open
in this browser. If Main has delivered a lesson question, **Start polling** uses
that exact question and pinned lesson, including its current practice project;
you do not need to enter the project again. Otherwise, enter one bounded task in
**Task to watch**, then start it. This also works for a lesson without a practice
project, such as Lesson 0; its target then shows as a source-less lesson. The compact details dialog shows the task as
**active**, **paused**, or **unavailable**, its exact target, and its latest
structured observation and time, last delivered help, and any saved assessment
outcome. Observations include switching between **Workspace** and **Learning** and
between Workspace panes such as **Preview** and **Dashboard** (the lesson's database);
a view opened by Main or Colleague is recorded as their demonstration, not your step. Expand **Task criteria** below the watch controls to read the full
criteria; long criteria stay collapsed so **Pause**, **Resume** and **Stop** remain
easy to reach. You can instead tell Colleague “Watch me while I do this”; that direct
request starts the same watch and the eye dialog shows the same state. Asking how
polling works only gets an explanation. Ask Colleague to list, pause, resume or
stop a watch when you do not want to use the buttons. **Pause** retains the cursor,
**Resume** rechecks the current learner, lesson and browser before continuing,
and **Stop** removes only the watch—it does not stop the app, Main or the lesson.
Returning to another project, lesson or account pauses the old watch;
after a server restart, return to the same Learning task and choose **Resume**.
If you leave the task while **Start polling**, **Resume**, or an observed step
is being checked, that request reports the changed task instead of activating
the departed watch or queuing help for it. Return to the intended task before
starting or resuming; repeat a step only after its watch is active.
Polling follows the exact saved attempt, including an authorized author trial; it does not substitute the ordinary course progress for that task.
If the lesson can no longer be read or access is lost, polling becomes
**unavailable** and discards help that has not been delivered. After resolving
the problem, **Resume** watches fresh steps; it does not replay that discarded help.
Closing the initiating tab or losing its live connection pauses that tab's watch
and discards pending help. Watches in other tabs keep their own state. Reconnecting
registers your current view but leaves the watch paused: return to the intended
task and choose **Resume**. Minimizing Colleague keeps the same connected task.
Replacing or closing the watched Main conversation also pauses its old watch,
even when the project and lesson remain selected. Switching only between that
task's Workspace and Learning panes keeps polling active.
After an application update, reload the page before starting or resuming polling.
Start and Resume require the initiating browser's live connection. If it has not
connected yet, wait for it to reconnect and then choose the control again; saved
focus alone cannot start a detached watcher.
The saved assessment outcome supports the watched outcome only when it is a pass
for that task's referenced assessment. A pass from another assessment does not
complete your task. A task you describe in your own words has no automatic
assessment match; polling and help do not grade it.
You do not need to keep the dialog open.
When a watched step reaches the lesson teacher, Main's chat shows a short status
line such as “Watching: you are in Workspace → Preview.” followed by the teacher's
reply. The teacher still receives the full observation; its internal prompt is
not shown as a chat message. A failed step shows “Watching: that step did not
finish.”; returning to the lesson shows “Watching: you are back in the lesson.”

Polling reports only named Vibe64 controls, settled Workspace/Learning view and
saved lesson progress. It never sends typed text, arbitrary page content,
screenshots, secrets or another project. Navigation performed by Colleague is
reported as a demonstration, not as something you did and not as assessment
evidence. Polling does not grade a question or mark a lesson complete.
Only a saved assessment outcome supports completion; a recent observation or a
delivered-help receipt does not. Colleague cannot observe arbitrary activity
inside the supervised application unless that interaction is one of the named
Vibe64 controls or the declared exercise-response bridge.
Returning to Working restores its previous chat-collapse choice. Both modes use
one retained session panel, so switching modes does not delete drafts or stop
already admitted background work. A project that is still loading or failed
keeps its original Working readiness gate while retaining the hidden panel.
If the hidden Working project closes through ordinary inactivity cleanup, your
selected Learning conversation stays open. Returning to Working reopens its
original project through the usual access checks before showing it as ready.
This does not restart stopped Working agents or outputs. Explicit project Close
or deletion still leaves the project view; a missing runtime or revoked access
is not treated as ordinary inactivity.
The original Preview host remains mounted beneath these choices. A saved practice
workspace is reopened through its existing exact-session check before its outputs
appear; a failure stays visible with **Retry workspace**. A declared diagram can
open from Learning; covered workspace controls do not remain interactive.
Switching views retains the App and diagram instances, the lesson picker, and
Dashboard selections within that host. Hidden diagrams pause; returning does
not replay their motion or count as a completed lesson. If sound is off, use the
presentation's **Continue** only after its explanation is ready. A supported
narrated diagram waits for its confirmed final explanation and actual sound and
motion completion. Hiding or stopping it does not count as completed teaching.
If its cue receipt was not confirmed, read the current status before continuing;
do not assume the explanation or motion succeeded.
When Main opens a lesson diagram, keep that same browser open until its operation
is confirmed. Main opens it in that lesson's **Presentation** pane; opening the
Colleague drawer is not required. If the browser did not acknowledge navigation,
keep the initiating conversation open and check its current status before
requesting another operation. If Main already finished with that failure, its
message remains saved; read its result and your saved lesson progress before
asking it to continue. Do not resend that completed message to recover navigation.
Stop or a replacement Learning conversation retires its old
explanation; an old confirmation cannot complete a new one.
When Main opens a diagram in the practice project, wait for its confirmation;
you do not need to request the diagram again while the view changes.
This also applies with read-aloud off; opening voice first is not required.
Wait for Main to confirm that the diagram is ready before continuing its
illustrated steps.

The selected Learning conversation prepares the configured agent through the same
Main readiness flow as Working. Preparation retains that saved conversation and
checks your current access; it does not send your draft or begin teaching. An
ended or inaccessible attempt cannot start agent preparation.

Source-less Learning conversations show Learning and disable Workspace. A supported declared
diagram can use the same Presentation player only in your exact saved lesson
conversation; an empty picker or unavailable diagram cannot open it. This does
not give the lesson repository, Save or Temporary AI/workspace access. A saved
checkpoint does not mean a presentation is currently open. After a completed
command or pause, the player saves its semantic state and labels. Reopening the
same attempt restores its last confirmed state without replaying sound or motion.
**Retry diagram checkpoint** retains an unconfirmed save identity; after a
revision conflict, **Save current diagram** captures fresh state. Keep the player
open until confirmation. Practice lesson diagrams save to that same lesson and
Main conversation. A changed account, attempt or conversation retires its old
handle; an error never grants a pass.

While a start is in progress, the picker says **Starting the selected lesson and
preparing its practice project**, and **Start selected lesson** stays disabled
until the request settles; the teacher conversation then opens by itself. This
looks the same on desktop and phone. **Starting lessons is unavailable in this
installation** appears only when the installation cannot start lessons.

If Start is unconfirmed, the picker says so and **Retry lesson start** keeps its original request
identity, lesson and revision. Do not substitute a different lesson request.
An ended replay is history; it does not select a different current attempt. If
opening the saved conversation is unconfirmed, the exact Start retry or Resume
uses the original server opener. A page unload does not preserve this temporary
UI retry identity; read saved progress before making another request afterward.

An account change immediately hides the previous person's progress. Changing
account, mode or route during a request does not undo admitted lesson work; a
late result cannot open a new conversation or select the new view. Local request
errors are cleared when their view is retired. Colleague can explain this flow
and offer existing actions; a how-to question alone does not authorize execution.
Private provider key entry remains a human-only step. A diagram belongs to its
original signed-in learner and Main conversation; changing accounts retires its
display and pending reads rather than transferring it to the next person.

To request teaching, open the exact saved Learning Main conversation and ask
“Teach me this lesson.” Starting or resuming the lesson does not itself send that
request. Main can use the lesson's declared diagrams in that same browser;
Colleague remains available for general help and workspace supervision. Text
teaching does not require voice, and private key entry remains your action.

Lessons speak by default where this installation has a speech service. When the
lesson conversation has loaded and read-aloud is on, Main's voice opens by itself and reads new replies aloud; earlier history
is not replayed. The microphone stays off until you press **Talk**. Use the
read-aloud button beside the avatar to mute replies; text continues in chat.
If the browser reports **Sound is blocked**, choose **Enable sound**. Ending
voice keeps it off for that lesson until you open it again or reload the page.
Working conversations still start voice only when you choose it. Without a speech
service, lessons stay text-only and quiet; **Continue** paces any diagram.

If sound stops early, for example because the voice service could not be
reached or you hid a narrated diagram, the diagram does not claim it finished.
Choose **Continue** to go on without sound, or ask Main to repeat the
explanation. Turning read-aloud off while it speaks stops the speech and leaves
the diagram interrupted; turning it on again does not replay it. Your next message
to Main is read aloud again once the voice service is available; you do not need
to toggle read-aloud or reload.

An exercise's Main coding assistant can perform an explicitly requested setup
repair in that same practice session. Its commands recheck the saved lesson each
time, including after the opening request has finished. If the assistant starts a
command before **Send** finishes saving its receipt, that command waits for the
same send to finish, then checks the lesson again. **Stop** cancels a waiting
command. A failed send does not allow its waiting command to proceed. Ending the lesson prevents
new commands; retained status remains readable. If Workspace setup failed, inspect
the concrete diagnostic before **Retry**; a repair or successful setup is not a
learner answer or passed assessment. Colleague can explain and coordinate this
recovery but has no source-editing or shell access.

For a narrated diagram, keep the initiating browser and exact lesson conversation
open until its operation is confirmed. Its explanation waits until Main has
finished that turn. Stopping or interrupting an unfinished explanation prevents
it from playing later when you ask a new question. With sound off, use
**Continue** only after the explanation is ready. A visible diagram or saved
state does not itself mean narration, motion or an assessment succeeded.

Main confirms a diagram explanation from that turn's finished response before
enabling **Continue**. Keep the same lesson and conversation open while it
finishes. A stopped explanation or a response from a different turn cannot
confirm the old diagram; read Main's current result before asking it to continue.
The response may appear before **Continue** becomes ready; wait for its
confirmation instead of resending that finished reply.

If an operation is unconfirmed, read its current status before requesting a
repeat. A reload or changed lesson/account cannot reuse an old cue confirmation.
Switching the compact screen between chat and Preview retains the same active
lesson; selecting a different session or account retires its old presentation.

While a lesson’s narrated visual explanation awaits its final response, optional
thinking and interim speech stay silent too. Your speech preferences remain saved;
fresh confirmed replies use the same voice controls. This does not hide chat text.

After Main finishes a Learning turn, **Courses** refreshes the saved progress
for that same lesson. An owner’s author trial remains separate from ordinary
lesson progress. If updates were disconnected, use **Refresh courses** to read
the current saved results before choosing Start or Resume. The saved checkpoint
question may already have been assessed; it is not a new unanswered question.
