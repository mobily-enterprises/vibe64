# Choosing lessons and Learning conversations

The **L** button now opens the Learning environment above the current page;
see [The Learning environment (L)](learning-environment.md). It no longer
switches the header into Learning mode. The Learning mode described below is
kept only for lessons opened by an earlier address (`?mode=learning`) or a
Colleague request, and for reading earlier history; pressing the lit **L** there
leaves Learning mode and opens the Learning environment; new lessons start and are read in the Learning
environment, without a teacher conversation. Its **Courses** page is the same
one described here.

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

Ending a lesson keeps its history; it does not archive or delete anything.
It does not stop or close the practice project: that project and its session
are ordinary and stay yours. An ended lesson cannot be resumed; ask Colleague to
continue it in a fresh exercise (see [Lesson history and resume](learning-history.md)).

The lesson Main teacher conversation has been retired: Colleague teaches every
lesson from its steps in the Learning environment. Learning uses the same header as Working: the session row on the left, the
collapse-chat arrow, the **Preview** | **Dashboard** tab group and, while
Preview is shown, the same Preview toolbar (address, reload, pause, copy and
status). Learning adds exactly one thing: a graduation-cap option at the end of
that same tab group (**Preview** | **Dashboard** | 🎓, tooltip "Learning:
courses and lesson"). Selecting the graduation-cap button beside Preview and
Dashboard shows the Learning panes (**Courses**, **Check my code**, the lesson
and its history); Preview and Dashboard then appear unselected, exactly as one
option of three. Selecting **Preview** or **Dashboard** deselects the cap. The
collapse-chat arrow hides or shows the chat exactly as it hides or shows
the Working chat. A practice lesson's project is an ordinary project of yours
and its session is an ordinary session of that project: open it with **Open
practice project** in Learning (or from **Practice** in the project list). Its
chat, **Preview** and every **Dashboard** section (including **Files**, **Env**,
**Database**, **Architecture**, **Current changes** and **Git log**) are the
ordinary ones, with full access, during and after the lesson; see
[Practice projects in standalone lessons](learning-practice-projects.md). Moving between Dashboard sections keeps Learning
on. Switching between Preview, Dashboard and Learning keeps Learning mode on and
retains the same selected session; it does not switch to your last
Working session. The graduation-cap **Learning** option shows the **Courses** | **Presentation**
switch. Returning to it keeps the selected Courses or
Presentation content visible without requiring another click. A supervised
project opens on its Preview by default.
A source-less lesson disables **Preview** and **Dashboard** (their tooltip says
the lesson has no project workspace) and keeps the graduation cap selected,
instead of showing a remembered Working project. On phones and tablets Learning
behaves like Working: the chat and the right-hand pane are shown one at
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

While a start is in progress, the Courses pane says **Starting the selected
lesson and preparing its practice project. Its teacher conversation opens when
this finishes.** Every **Start**, **Start next lesson** and **Start lesson**
button stays disabled until the request settles; the lesson then
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
original signed-in learner; changing accounts retires its
display and pending reads rather than transferring it to the next person.

In a practice project, setup repair is ordinary project work in its session:
ask that session's agent, or use the ordinary Workspace setup recovery. A repair
or successful setup is not a learner answer or passed assessment. Colleague can
explain and coordinate this recovery but has no source-editing or shell access.

After a step result is saved, **Courses** refreshes the saved progress for that
same lesson. An owner’s author trial remains separate from ordinary lesson
progress. If updates were disconnected, use **Refresh courses** to read the
current saved results before choosing Start or Resume.

Related topics: [Answering a code question in a lesson](learning-code-questions.md)
and [The Learning environment (L)](learning-environment.md).
