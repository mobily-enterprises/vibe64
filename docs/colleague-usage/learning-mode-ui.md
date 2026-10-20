# Choosing lessons and courses

The **L** button opens the Learning environment above the current page; see
[The Learning environment (L)](learning-environment.md). Its **Courses** page is
described here. Learning mode, its graduation-cap pane, **Check my code** and
the practice selector have been retired: an old `?mode=learning` address opens
the ordinary project page, and earlier lesson history is read from the Learning
environment.

The **Courses** pane (called **Lessons** in earlier releases) opens with a
**Courses** banner (with **Refresh courses**) and a list of course cards. Each card
has decorative cover art (the same for a course every time; its dots mirror that
course's lessons, ticked when complete), a chip saying whether it is **Enabled**,
a **Preview course** or **Disabled for new lessons** (plus **Saved lesson** or
**Course complete** when true), the title, its ID and release, topic and lesson
counts, "N of M lessons complete" with a progress ring, and the next lesson. A lesson counts as complete when every required step
has passed in your saved progress (required assessments, for a lesson in the
earlier format); only required lessons are counted,
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
continue it, or end it first. When every required step of it has passed, its
reader shows **Finish lesson**, which ends it and returns here; otherwise ask
Colleague to end the lesson (see [Lesson history and resume](learning-history.md)). On a phone the cards stack in one column and the
course page scrolls in the same pane.

Choose **Resume saved lesson** on the saved lesson card (above the course cards,
headed "Saved lesson · code" with the lesson title and, once reported, a ring of
required steps passed and "N of M required steps passed. This lesson is
complete." or "Continue the remaining steps.") for the exact saved attempt. Disabled,
unavailable, loading and error states are shown on the same page. **Refresh
courses** rereads installed courses, progress and the course catalogue.

Below the course cards, **Course catalogue → Install a course** lists the
official catalogue's topics and their courses with **Install** buttons; an
installed course with a newer release shows **Update available** and **Update**.
See [Installing and updating Learning courses](learning-course-catalogue.md). A lesson without a practice project, such as local
Vibe64's Lesson 0 **Set yourself up**, opens only the lesson in the Learning environment, with no project or
conversation; that lesson uses [Dashboard → Health](health-checks.md).
Opening L again rereads saved lessons and any admitted author trial; a newly admitted trial does not require reloading the page.
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

Colleague teaches every lesson from its steps in the Learning environment;
there is no lesson teacher conversation. A practice lesson's project is an
ordinary project of yours and its session an ordinary session of that project:
open it with **Open practice project** in the lesson, or from **Practice** on
the Courses page, where its trash button deletes it with one click. Its chat, **Preview** and every **Dashboard** section are the
ordinary ones, with full access, during and after the lesson; see
[Practice projects in standalone lessons](learning-practice-projects.md).

While a start is in progress, the Courses pane says **Starting the selected
lesson and preparing its practice project. The lesson opens when this
finishes.** Every **Start**, **Start next lesson** and **Start lesson**
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
An ended replay is history; it does not select a different current attempt. A page unload does not preserve this temporary
UI retry identity; read saved progress before making another request afterward.

An account change immediately hides the previous person's progress. Changing
account or route during a request does not undo admitted lesson work; a
late result cannot open the lesson in the new view. Local request
errors are cleared when their view is retired. Colleague can explain this flow
and offer existing actions; a how-to question alone does not authorize execution.
Private provider key entry remains a human-only step. A diagram belongs to its
original signed-in learner; changing accounts retires its
display and pending reads rather than transferring it to the next person.

In a practice project, setup repair is ordinary project work in its session:
ask that session's agent, or use the ordinary Workspace setup recovery. A repair
or successful setup is not a learner answer or passed step. Colleague can
explain and coordinate this recovery but has no source-editing or shell access.

After a step result is saved, **Courses** refreshes the saved progress for that
same lesson. An owner’s author trial remains separate from ordinary lesson
progress. If updates were disconnected, use **Refresh courses** to read the
current saved results before choosing Start or Resume.

Related topics: [Answering a code question in a lesson](learning-code-questions.md)
and [The Learning environment (L)](learning-environment.md).
