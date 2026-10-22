# Choosing lessons and courses

The **L** button switches between **Develop** (your own projects) and
**Learn** (lessons); see [The Learning environment (L)](learning-environment.md).
In Learn mode the app bar turns yellow, and **Courses** (at the right of the
lesson step bar, or in the project menu beside **L**) opens the Courses overlay, the catalogue where
lessons are chosen; a lesson itself is read in the page's **Lesson** tab. This
guide describes the overlay's **Courses** tab. Its **In progress** and
**Archived** tabs are described in
[Practice projects](learning-practice-projects.md).

## Course cards

**Courses** opens with a banner (with **Refresh courses**) and a list of course
cards. Each card has decorative cover art (the same for a course every time;
its dots mirror the course's lessons, ticked when complete), a chip saying
whether it is **Enabled**, a **Preview course** or **Disabled for new lessons**
(plus **Lesson in progress** or **Course complete** when true), the title, its ID and
release, topic and lesson counts, "N of M lessons complete" with a progress ring,
and the next lesson.

A lesson is complete when every required step has passed in your saved progress
(required assessments, for a lesson in the earlier format). Only required
lessons are counted, unless a course has none. Progress is read from what is
already saved; opening a course grades nothing. A lesson passed in one course
counts in every course that contains the same lesson.

On a card, **Continue lesson** reopens your lesson in progress when it belongs
to that course. Otherwise **Start** starts the course's first published lesson
that is not yet complete. **View course** opens the course page: a header with
the cover and a ring of lessons complete, an **Up next** card, then its topics
in order, each with its lessons, their title and code and a status of
**Completed** (green tick), **In progress** (yellow; an open attempt or some
passes) or **Not started** (numbered). **Up next** has one main action,
**Continue lesson** or **Start next lesson** (with the next lesson named beside
it). Every available lesson except the one in progress has a **Start lesson**
button; an archived lesson starts again as a new attempt with a fresh practice
project. **Back to courses** returns to the list. On a phone the cards stack in
one column and the course page scrolls in the same pane.

The lesson card above the course cards is headed "Lesson in progress · code"
with the lesson title and, once reported, a ring of required steps passed with
"N of M required steps passed. This lesson is complete." or "Continue the
remaining steps." **Continue lesson** opens that exact attempt. Disabled,
unavailable, loading and error states are shown on the same page. **Refresh
courses** rereads installed courses, progress and the course catalogue; after a
step result is saved, Courses refreshes that lesson's progress by itself. If
updates were disconnected, use **Refresh courses** before choosing Start or
Continue lesson.

Below the course cards, **Course catalogue → Install a course** lists the
official catalogue's topics and courses with **Install**; an installed course
with a newer release shows **Update available** and **Update** (see
[Installing and updating Learning courses](learning-course-catalogue.md)).

A lesson without a practice project opens on the Learn page (at `/app/learning`) with no project
selected: the lesson's own **Lesson** pane fills the page beside Colleague,
with no pane switches, no chat column and no sessions (see the shared guide's
*The Lesson tab*). Your own projects stay hidden until you
press **L** to go back to Develop. Its steps say which real screens it uses.

## Starting, continuing, archiving and finishing

While a start is in progress, Courses says **Starting the selected lesson and
preparing its practice project. The lesson opens when this finishes.** Every
start button stays disabled until the request settles. As soon as the start is
confirmed, Courses closes by itself and the lesson opens in the **Lesson** tab
of its practice project; you do not need **Continue lesson**. A practice project's Workspace setup can
continue afterwards and the lesson becomes ready when setup succeeds (see
[Practice projects](learning-practice-projects.md)). **Starting lessons is
unavailable in this installation** appears only when the installation cannot
start lessons. This looks the same on desktop and phone.

If a start is unconfirmed, Courses says **The last lesson start was not
confirmed** and shows **Retry lesson start**, which repeats the same request,
lesson and revision; do not substitute a different lesson. The retry is lost if
the page unloads, so read saved progress before making another request.

You have at most one lesson in progress. Starting a different lesson while one
is in progress asks **Archive your lesson in progress?**, naming it. **Archive
and start** archives it, with its practice project and conversation, under
**Archived**, then starts the new lesson; **Keep it** cancels and nothing
changes. Pressing **L** to go back to Develop only pauses the lesson: it stays
in progress, and **L** returns to it. When every required step has passed, the
**Lesson finished** screen finishes the lesson, which archives it the same way
(see [The Learning environment (L)](learning-environment.md)).

Starting or continuing a lesson, or **Open** under **In progress**, closes
Courses and opens the lesson in the **Lesson** tab of its practice project; its
**Preview** and **Dashboard** tabs are beside it. Setup repair there is ordinary project work
(ask that session's agent or use Workspace setup recovery); it is not a learner
answer or a passed step.

Opening Courses again rereads saved lessons and any admitted author trial, without
reloading the page. An account change immediately hides the previous person's
progress and diagrams; a late result of a request made before the change cannot
open the lesson in the new view, but admitted lesson work is not undone.

## Creating a custom course

The workspace owner sees a dashed **New course** tile after the course cards (on
local Vibe64 you are the owner). Enter a **Course name**, tick whole topics under
**Installed topics**, order them with **Up** and **Down** under **Topic order**,
then choose **Create course**; **Cancel** closes the form without changes. The
new course opens straight away and stays in the list for everyone in this
installation. Only topics from enabled, released courses are offered. The course
is pinned to those exact installed topic releases, so its lesson content never
changes, and saved progress is shared with the original course.

If creation fails, the message appears at the top of the pane: a name already in
use (choose another), a catalogue that changed meanwhile (use **Refresh
courses**, then try again), a topic that is no longer available, or the 16
course-release limit. Only the workspace owner can create courses; Colleague can
create one when the owner asks with a name and topics. A custom course cannot be
renamed or edited; the owner can disable it with `vibe64 training
disable-course` (see `docs/training-content.md`) and create another one.

## Preview courses

A **Preview course** is for the workspace owner to review before release. The
owner (on local Vibe64, you) sees **Try preview** instead of **Start**, **Start
next lesson** and **Start lesson**, on desktop and phone; it starts an ordinary
saved lesson exactly like Start. Others see **Preview — the workspace owner can
try it; it becomes startable when released** and no start button, and the server
refuses their start. Drafts and disabled courses stay unavailable to everyone.
Once released, everyone gets **Start**.

## What Colleague can do

Colleague can explain this page and offer its actions; a how-to question alone
does not authorize them. Private provider key entry remains a human-only step.
Colleague can explain setup recovery but has no source-editing or shell access.

Related topics: [Practice projects](learning-practice-projects.md),
[Answering a code question in a lesson](learning-code-questions.md)
and [The Learning environment (L)](learning-environment.md).
