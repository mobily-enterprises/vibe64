# Lessons in progress, practice projects and archives

Vibe64 has two modes: **Develop**, for your own projects, and **Learn**, for
lessons. **L** switches between them (see
[The Learning environment (L)](learning-environment.md)). This guide covers
what a lesson keeps while it is in progress, and what happens when you finish,
restart or delete it.

## One lesson in progress

Starting a lesson (**Courses**, then **Start lesson**) begins one run of it, called an
attempt. The attempt owns:

- its step results,
- its teacher conversation with Colleague,
- its practice project, when the lesson needs a practice application.
  A lesson without one has no project.

You have at most one lesson in progress. It stays in progress until you finish,
restart or delete it. Switching to Develop, or opening another page, only
pauses it: its project, results and conversation are all kept, for as long as
you like. Press **L** to come back to it. Like any project, a practice project
left without activity for about 30 minutes is closed by idle cleanup: its
Preview and assistant stop, while its files, results and conversation stay.
Coming back to the lesson opens it again; start Preview again if you need it.

If you start a different lesson while one is in progress, Vibe64 asks once
whether to archive the current lesson first. Confirming archives it (see
below) and starts the new lesson. Cancelling changes nothing and keeps the
current lesson in progress. Starting the lesson that is already in progress
just opens it.

## Practice projects

Some lessons need a practice application. Starting such a lesson creates a
practice project for it. If the installation reports that exercise preparation
is unavailable, ask the owner to provide preparation support before retrying.
That refusal means preparation did not start.

Preparation uses the exercise bundled with the lesson. Workspace setup may
continue after the start request finishes; when it succeeds the lesson becomes
ready on its own. Failed setup needs its existing recovery; then ask Colleague
to resume the lesson's preparation. Setup success does not mean Preview is running or a step has
passed. Standalone setup uses the installation's actual resources; it does not
create a hosted development database by default.

Practice projects live in your own learning space, apart from your projects.
In Develop mode they never appear in the project lists, the project switcher or
Management → **Projects**, and opening one says
"This is a practice project. Press L to switch to Learn." In Learn mode only
your practice projects open; opening one of your own projects says
"You're in Learn mode. Press L to go back to your projects." Only you see your
practice projects; the workspace owner does not.

This separation is part of Vibe64, not of the computer. Vibe64 keeps the two
apart in where it stores them, what it lists and what it opens. It is not a
security boundary: agents and the practice application run on the same machine,
with the same system access, as your other projects. Treat a practice project
like any of your projects and do not put secrets in it.

Before an agent turn, Vibe64 writes its agent guidance (the `.agents`,
`.claude`, `.codex` and `.opencode` folders) into the project. In a practice
project these folders stay out of **Current changes** and out of what **Save**
commits, so you see and save only your own changes; every lesson gets this
without anything in its exercise. In your own projects they appear as changes
to save, as before.

A practice project is a complete project. Its chat, **Preview**, **Dashboard**
and sessions work as in any project. The session that lesson preparation
creates in it is an ordinary session.

Which AI the practice project's chat uses depends on who you are. The workspace
owner's lessons (and yours on Vibe64 on your own computer) run on the owner's
main AI, as in any project. A team member's lesson runs on the team setup's
Workspace-use models and their messages are sent straight away, without the
owner's approval: the composer reads "Message your lesson's AI — *model* (team
AI)". A personal plan is never used for a team member's lesson; see
**Lessons** in [Team AI access](team-ai-access.md).

## In progress and Archived

In Learn mode, **Courses** (on the lesson step bar, or in the project menu beside **L**) has an **In progress** list and an
**Archived** list. Until your lessons are read, each list shows **Loading your
lesson…** or **Loading archived lessons…** instead of staying blank.

**In progress** shows the lesson in progress, if any: its title and its
practice project's name (or **No practice project**). Without one it says
**No lesson in progress. Start one from Courses.** The row has three buttons:

- **Open** closes Courses and opens the lesson in the **Lesson** tab of its
  practice project (or, for a lesson without one, of the page with no project
  selected).
- **Restart** turns into **Archive and restart**; press that to archive this
  attempt and start the same lesson again with a new practice project, a new
  teacher conversation and no step results.
- **Delete** turns into **Delete for good**; press that to delete the lesson
  in progress for good: its practice project (files, sessions and Preview) and
  its teacher conversation go, with no archive. A lesson you completed before
  stays completed.

**Archived** lists your archived lessons, newest first, with the lesson title,
whether it was finished or archived, and the date. Each row has a delete
icon, then **Delete for good**, which removes that archive for good. You can keep at most 20 archived lessons;
finishing, restarting or archiving another lesson is refused until you delete
one. Archived lessons cannot be reopened from Vibe64; use **Start lesson** again to
redo a lesson.

An archive keeps the attempt's record and step results, its teacher
conversation and its practice project's source, sessions and state, but leaves
out dependencies that can be rebuilt, such as `node_modules`. A lesson without
a practice project keeps only its record and conversation.

To limit disk use, only your 3 newest archived lessons with a practice project
keep it (they show **with practice project** in the list). When archiving
another lesson's project would make 4, the oldest of them loses its practice
project, on its own; it keeps its record, step results and teacher
conversation. Lessons without a practice project do not count. This never
touches the lesson in progress, however long it stays paused, or your own
projects.

## Finishing a lesson

When every required step has passed, the lesson's **Lesson finished** screen,
in the page's **Lesson** tab, finishes it: the lesson counts as completed for good, and the attempt is
archived as one bundle (its record, practice project and conversation). The
screen then offers **Next lesson** and **Back to courses**. **Start lesson** on
the course page starts a new attempt with a fresh project, teacher and results; the
course list still shows the lesson as completed.

## When something refuses or stops

If a session in the practice project is pinned, finishing, restarting,
archiving or deleting refuses with a message that names the session. Nothing
was changed. Open the session, choose **Unpin session**, and try again. A full
archive (20 lessons) or too little storage also refuses with nothing changed.

If archiving or deleting stops part-way, the lesson stays in progress (a
stopped removal shows **Being deleted**). Press the same button again; it
continues from the step that failed. **Delete** also finishes a stopped archive.
If it keeps failing, the error says why; ask the person who runs this Vibe64
to inspect it.

## What Colleague can do

Colleague can list the lesson in progress and the archived lessons, and switch
between Learn and Develop when you ask. It restarts or finishes a lesson only
when you ask, and deletes the lesson in progress or an archive only when you
ask and then confirm that exact deletion; an offer is not a request. Starting a
different lesson while one is in progress needs your confirmation to archive
the current one first.

## A practice project open elsewhere

If a practice project that was archived or deleted is still open in another tab
or window, that page switches by itself (no reload needed) to **This practice
project is gone** instead of an error. The page's requests answer not found with
the code `vibe64_practice_project_deleted`. Colleague can explain this.

## How a practice project is named

A practice project keeps its address (`/app/project/training-…`), but Vibe64
names it after its lesson: in the project header, in **Courses** and by
Colleague. The name is **Practice:** followed by the lesson title, otherwise the
lesson code, for example **Practice: V64-START-02**. Hover the header name on a
computer to see the address too.

On a phone the header name shortens with **…** so it never covers the other
header buttons. While Preview's controls are showing on a very narrow phone, or
beside a local project's Git branch and GitHub controls on a phone narrower than
about 540px, there may be no room for it at all; the name is then hidden rather
than squeezed. With Preview shown, **Show chat** brings it back; otherwise turn
the phone sideways or use a wider screen. On phones narrower than about 480px the button that switches
between **Preview** and **Dashboard** shows that pane's icon instead of the word
(its name is still **Go to dashboard** or **Go to preview**).

## Working in the practice project

The practice project's session has an ordinary Vibe64 agent, without lesson
instructions. Ask it to make a change and it works in the practice project, as
in any project; Colleague teaches you to instruct it well (say the goal, where
the change belongs and how you will check it). Then check the result yourself in
**Preview** and the **Dashboard** sections.

Work an agent does for you never counts as your own work. While a code step is
open, make the edits to its files yourself in
**Dashboard → Files**: your saves there are recorded for the lesson, and any
other writer's edit in those files means the step's **Check now** asks for an
independent attempt (see [Answering a code question in a lesson](learning-code-questions.md)).
Hosted workspaces record these saves the same way.
