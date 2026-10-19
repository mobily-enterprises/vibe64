# Choosing lessons and Learning conversations

Use the **L** button at the left of the app header to switch between Working and
Learning. It is the same size as the other header icon buttons. While Learning
is on it is a full yellow L (pressed, tooltip **Leave Learning mode**) and the
header is tinted; in Working it is an outlined, untoggled L (tooltip **Enter
Learning mode**). It is the first keyboard stop in the header: Enter or Space
switches mode. In a lesson with saved practice projects, the **Practice
project** menu sits beside it in place of Working's project switcher; on a phone
it shrinks to its ▾ arrow. On the
projectless app page, Working shows the original project picker; Learning shows
installed courses without asking you to invent or choose a project; its header
reads **Courses**. In a project
view, the same control changes the existing session panel's purpose filter.

The **Courses** pane (called **Lessons** in earlier releases) opens with a
**Courses** banner (with **Refresh courses**) and a list of course cards. Each card
has decorative cover art (the same for a course every time; its dots mirror that
course's lessons, ticked when complete), a chip saying whether it is **Enabled**,
a **Preview course** or **Disabled for new lessons** (plus **Saved lesson** or
**Course complete** when true), the title, its ID and release, topic and lesson
counts, "N of M lessons complete" with a progress ring, and the next lesson. A lesson counts as complete when all of its required
assessments are passed in your saved progress; only required lessons are counted,
unless a course has none. Progress is read from what is already saved; opening a
course grades nothing. A lesson passed in one course counts in every course that
contains the same lesson.

On a card, **Continue** reopens your saved lesson when it belongs to that course;
it is the same request as **Resume saved lesson**. Otherwise **Start** starts the
course's first published lesson that is not yet complete. **View course** opens
the course page: a header with the course cover and a ring showing lessons complete,
an **Up next** card, then a path of its topics in order, each with its lessons, their title and code
and a status of **Completed** (green tick), **In progress** (yellow; an open attempt or some passes) or
**Not started** (numbered). The **Up next** card has one main action, **Continue** or **Start next
lesson** (with the next lesson named beside it), and each available lesson has a **Start lesson** button
if you want a different one. **Back to courses** returns to
the list. While you have a saved active lesson, Start buttons stay disabled:
continue it, or end it first. There is no End button; ask Colleague to end the
lesson (see [Lesson history and resume](learning-history.md)). On a phone the cards stack in one column and the
course page scrolls in the same pane.

Choose **Resume saved lesson** on the saved lesson card (above the course cards,
headed "Saved lesson · code" with the lesson title and, once reported, a ring of
required assessments passed) for the exact saved attempt. Disabled,
unavailable, loading and error states are shown on the same page. **Refresh
courses** rereads installed courses, progress and the course catalogue.

Below the course cards, **Course catalogue → Install a course** lists the
official catalogue's topics and their courses with **Install** buttons; an
installed course with a newer release shows **Update available** and **Update**.
See [Installing and updating Learning courses](learning-course-catalogue.md). A lesson without a practice project, such as local
Vibe64's Lesson 0 **Set yourself up**, opens only its Learning conversation; that
lesson uses [Dashboard → Health](health-checks.md).
Returning from Working to Learning rereads saved lessons and any admitted author trial; a newly admitted trial does not require reloading the page.
If Resume reports that the saved exercise is busy preparing or finishing a command, wait for that operation to settle and retry the same attempt. Do not create a replacement.

### Creating a custom course

The workspace owner sees a dashed **New course** tile after the course cards (on
local Vibe64 you are the owner). Enter a **Course name**, tick whole topics under **Installed
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

A **Preview course** is for the workspace owner to review before release. The
owner (on local Vibe64, you) sees **Try preview** instead of **Start**, **Start
next lesson** and **Start lesson**, on desktop and phone; it starts an ordinary
saved lesson exactly like Start. Others see **Preview — the workspace owner can
try it; it becomes startable when released** and no start button, and the server
refuses their start. Drafts and disabled courses stay unavailable to everyone.
Once released, everyone gets **Start**.

Practice commands and their Git operations stay with the saved lesson until they
finish. If a command is still finishing, wait before ending the lesson. Ending a
lesson stops its lesson conversation's running work, as **Stop** does, and keeps
the conversation, practice project and history; it does not archive or delete
anything. After cancellation or an end, an old command cannot restart work. An
ended lesson cannot be resumed; ask Colleague to continue it in a fresh exercise
(see [Lesson history and resume](learning-history.md)).

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
Learning uses the same header as Working: the session row on the left, the
collapse-chat arrow, the **Preview** | **Dashboard** tab group and, while
Preview is shown, the same Preview toolbar (address, reload, pause, copy and
status). Learning adds exactly one thing: a graduation-cap option at the end of
that same tab group (**Preview** | **Dashboard** | 🎓, tooltip "Learning:
courses and lesson"). Selecting the graduation-cap button beside Preview and
Dashboard shows the Learning panes (**Courses**, **Check my code**, the lesson
and its history); Preview and Dashboard then appear unselected, exactly as one
option of three. Selecting **Preview** or **Dashboard** deselects the cap. The
collapse-chat arrow hides or shows the teacher chat exactly as it hides or shows
the Working chat. In a practice lesson, **Dashboard** is the ordinary Dashboard for the
lesson's practice project and lesson session, showing every section that works
inside a lesson:

- Project sections: **Git log**, **Env**, **Session History** and **Health**.
- Session tools: **Session info**, **Current changes**, **Files**, **Database**
  and **Architecture**.

Each one reads and changes only this lesson's practice project and session,
never your Working project. **Database** shows the practice app's ERD, tables
and data, editable like any project's database (see
[Browse a project's Database](database.md)). An app without a database shows
"The session Stack does not declare a supported database." **Files** is the
source editor for the practice project; see
[Answering a code question in a lesson](learning-code-questions.md).
**Env** shows and edits this lesson session's user values; **Reveal** for a
secret is not offered. **Git log** and **Current changes** are read-only: their
**Check for updates**, update and **Review changes** (save) buttons are not
shown, because a lesson is never saved, updated or published. **Session
History** lists only this lesson's archived lesson sessions. **Architecture**
can analyse the practice project; its **Ask** assistant is off (ask your lesson
teacher instead). The **Database** Copilot is off too.

A lesson's Dashboard does not show **Project settings**, **Integrations**,
**App access**, **Incoming changes**, **Issues/PR** or **AI Terminal**. These
change or reach outside the practice project, and the AI Terminal would type
straight into the teacher's agent. Opening one of their addresses directly in a
lesson shows **Env** instead. Moving between Dashboard sections keeps Learning
on. Switching between Preview, Dashboard and Learning keeps Learning mode on and
retains the same selected teacher session; it does not switch to your last
Working session. The graduation-cap **Learning** option shows the **Courses** | **Presentation**
switch. Returning to it keeps the selected Courses or
Presentation content visible without requiring another click. A supervised
project opens on its Preview by default. On reopening, the practice project waits for the
assistant's initial connection check to settle before opening the saved practice
runtime. It still opens if that check reports an unavailable or failed AI;
repairing the AI connection is separate from using the practice Preview.
A source-less lesson disables **Preview** and **Dashboard** (their tooltip says
the lesson has no project workspace) and keeps the graduation cap selected,
instead of showing a remembered Working project. On phones and tablets Learning
behaves like Working: the teacher chat and the right-hand pane are shown one at
a time; the arrow button or a horizontal swipe switches between them, and the
header's next-pane button (shown while the right-hand pane is open) steps through
**Dashboard**, **Learning** and **Preview**. On the projectless **Courses** page,
which has no right-hand project pane, chat and lessons are stacked instead.

Working and Learning share one chat-collapse choice. Both modes use
one retained session panel, so switching modes does not delete drafts or stop
already admitted background work. A project that is still loading or failed
keeps its original Working readiness gate while retaining the hidden panel.
If the hidden Working project closes through ordinary inactivity cleanup, your
selected Learning conversation stays open. Returning to Working reopens its
original project through the usual access checks before showing it as ready.
This does not restart stopped Working agents or outputs. Explicit project Close
or deletion still leaves the project view; a missing runtime or revoked access
is not treated as ordinary inactivity.

The selected Learning conversation prepares the configured agent through the same
Main readiness flow as Working. Preparation retains that saved conversation and
checks your current access; it does not send your draft or begin teaching. An
ended or inaccessible attempt cannot start agent preparation.

While a start is in progress, the Courses pane says **Starting the selected
lesson and preparing its practice project. Its teacher conversation opens when
this finishes.** Every **Start**, **Start next lesson** and **Start lesson**
button stays disabled until the request settles; the teacher conversation then
opens by itself. A practice project's Workspace setup can continue afterwards;
the lesson becomes ready by itself when setup succeeds, so you do not need
**Resume saved lesson** after a normal start (see
[Practice projects in standalone lessons](learning-practice-projects.md)). This
looks the same on desktop and phone. **Starting lessons is unavailable in this
installation** appears only when the installation cannot start lessons.

If Start is unconfirmed, the pane says **The last lesson start was not confirmed**
and a **Retry lesson start** button appears above it. It keeps its original request
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

After Main finishes a Learning turn, **Courses** refreshes the saved progress
for that same lesson. An owner’s author trial remains separate from ordinary
lesson progress. If updates were disconnected, use **Refresh courses** to read
the current saved results before choosing Start or Resume. The saved checkpoint
question may already have been assessed; it is not a new unanswered question.

Related topics: [Answering a code question in a lesson](learning-code-questions.md),
[Watching a lesson step by step](learning-lesson-watch.md) and
[Lesson diagrams and voice](learning-diagrams-and-voice.md).
