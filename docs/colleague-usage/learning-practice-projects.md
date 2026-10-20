# Practice projects

Some lessons need a practice application. Starting such a lesson in Learning →
**Courses** (**Start**, **Start next lesson** or **Start lesson**; see
[Choosing lessons and courses](learning-mode-ui.md)) creates a practice project
for it. If the installation reports that exercise preparation is unavailable,
ask the owner to provide preparation support before retrying. That refusal means
preparation did not start.

Preparation uses the exercise bundled with the lesson. Workspace setup may
continue after the start request finishes; when it succeeds the lesson becomes
ready on its own. Failed setup needs its existing recovery, then **Continue
lesson**. Setup success does not mean Preview is running or a step has passed.
Standalone setup uses the installation's actual resources; it does not create a
hosted development database by default.

## The learning space

Practice projects live in your own learning space, apart from your projects.
They never appear in the project lists, the project switcher or Management →
**Projects**, and your projects never appear among them. The same is true on a
local Vibe64 and on a hosted workspace. Only you see your practice projects;
the workspace owner does not.

This separation is part of Vibe64, not of the computer. Vibe64 keeps the two
apart in where it stores them, what it lists and what it opens. It is not a
security boundary: agents and the practice application run on the same machine,
with the same system access, as your other projects. Treat a practice project
like any of your projects and do not put secrets in it.

A practice project is a complete project. Its chat, **Preview**, **Dashboard**
and sessions work as in any project. The session that lesson preparation
creates in it is an ordinary session.

## A lesson in progress

While a lesson is in progress you are in learning mode (see
[The Learning environment (L)](learning-environment.md)) and in the learning
space only: the lesson's practice project is the one project you can open.
Opening another project brings you back to the practice project with the note
"You're in a lesson. Leave lesson to get back to your projects." Open the
practice project with **Open practice project** in the lesson.

Press **Leave lesson** (the yellow bar on a computer, Learning's header, or
the Learning page) to end the lesson. Your step results and the practice project
are kept, your projects come back, and a practice project page (or the
Learning page) returns you to `/app`. Later, **Continue lesson** in Learning → **Courses**, or **Open** in
Learning → **Practice**, starts the lesson again in the same practice project,
at the first required step you have not passed. If that practice project was
deleted meanwhile, the lesson gets a new one.

Lesson 0 and other lessons without a practice project open no project. They
use the Learning page (`/app/learning`); see
[The Learning environment (L)](learning-environment.md).

## The Practice tab

Press **L**, then **Practice** (next to **Courses**). The tab lists your
practice projects. Each row shows **Practice:** followed by the lesson title (the
lesson code while the title cannot be read) and the lesson's status: **In
progress**, **Finished** or **Not finished**. Each row has three buttons:

- **Open** continues the project's lesson (ending another lesson in progress,
  with its results kept), opens the practice project and minimises Learning on
  the current step. **L** brings Learning back.
- **Archive** (the box button, named **Archive** and the project name) archives
  the project with one click. The archive keeps the project's source,
  sessions and state, but leaves out dependencies that can be rebuilt, such as
  `node_modules`. The project then moves to **Archived**.
- **Delete** (the trash button, named **Delete** and the project name) deletes
  the project for good with one click, with no archive.

There is no confirmation dialog. Archiving or deleting the project of the lesson
in progress ends that lesson first; its results are kept.

Below the list, **Archived** lists archived practice projects with the lesson
title and the date they were archived. The trash button (**Delete archived**
and the name) deletes one archive for good. You can keep at most 20 archives;
delete one before archiving another. Archived practice projects cannot
be reopened from Vibe64. Turning a practice project into one of your own
projects is not available.

If a session in the project is pinned, archiving or deleting refuses with a
message that names the session. Open it, choose **Unpin session**, and try
again. If archiving or deleting stops part-way, the row stays (a stopped
deletion shows **Being deleted** with only **Delete**). Press the button again;
it continues from the step that failed. If it keeps failing, the error says
why; ask the person who runs this Vibe64 to inspect it.

When a lesson finishes, its **Lesson finished** screen offers the same choices
for its practice project: **Archive practice project**, **Delete practice
project** or **Keep** (it stays in **Practice**). The practice project page
stays behind Learning while you choose; when you hide Learning it returns to
your project.

Colleague can list your practice projects and open one when you ask. It
archives or deletes a practice project, or deletes an archive, only when you ask
and then confirm that exact project; an offer is not a request.

## A practice project open elsewhere

If an archived or deleted practice project is still open in another tab or
window, that page switches by itself (no reload needed) to **This practice
project is gone** instead of an error. **Open Learning** there opens Learning on
its course list (desktop and phone alike), where **Continue lesson** starts the
lesson again, with a new practice project if the old one was deleted. The page's requests answer not found
with the code `vibe64_practice_project_deleted`. Colleague can explain this;
only you press **Open Learning**.

## How a practice project is named

A practice project keeps its address (`/app/project/training-…`), but Vibe64
names it after its lesson: in the project header, in Learning's **Practice**
tab and by Colleague. The name is **Practice:** followed by the lesson title,
otherwise the lesson code, for example **Practice: V64-START-02**. Hover the
header name on a computer to see the address too.

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
