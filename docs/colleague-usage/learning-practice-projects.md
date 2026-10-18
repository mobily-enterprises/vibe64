# Practice projects in standalone lessons

Some lessons need a practice application. In Learning → **Courses**, use
**Start**, **Start next lesson** or **Start lesson** for a new lesson, or
**Continue**/**Resume saved lesson** for your saved one (see
[Choosing lessons and Learning conversations](learning-mode-ui.md)). If the installation reports that exercise preparation is
unavailable, keep the saved attempt and ask the owner to provide preparation
support before retrying. That refusal means preparation did not start.

Supported preparation uses the exercise bundled with your saved lesson and keeps
its reserved practice project and session when you resume. Workspace setup may
continue after the start request finishes. When that setup run succeeds, the
lesson becomes ready on its own; you do not need to press **Resume saved lesson**
first. Failed setup needs its existing recovery, then **Resume saved lesson**;
setup success does not mean Preview is running or a practical has passed.
Standalone setup uses the installation's actual resources; it does not create a
hosted development database by default.

The saved lesson and progress remain intact. Keep mismatched or unsafe practice
storage intact and ask the owner to inspect the reported error. An unrelated
Working project cannot replace this saved attempt's practice project.

Colleague can explain the error and use supported lesson controls when asked.

In a practice lesson, **Preview** shows the practice app as soon as it
reports ready, including after the app starts while you are on the **Learning**
pane. **Stop preview** stops the practice app cleanly and keeps it stopped, even
after a reload, until you choose **Restart preview**. Switching between
**Preview**, **Dashboard** and the graduation-cap **Learning** option keeps the same running app without reloading it.
Standalone exercise conversations in Learning, their Preview and practical
assessment are still being integrated; prepared source alone does not make that
complete flow available.

A local installation normally serves only the project you selected. It also
opens your own active lesson's practice project by its address (for example
when Colleague navigates there or you open **Account settings** from it): the
page, **Preview** and **Dashboard** load the same way as on a hosted workspace.
That address gives viewing and Preview control only; start new coding work from
the lesson in **Learning**. The lesson's own conversation stays in **Learning**:
the project's ordinary (Working) session list and settings do not show it. Another person's practice project, or a practice
address with no saved lesson behind it, still reports "Local editor mode only
serves the selected project."

## Instructing your teacher-agent

In a lesson with a practice project, the teacher in the lesson's conversation is
also your Vibe64 agent for that project, as in normal Vibe64. Ask it to make a
change and it does the work in the practice project. It also teaches you to
instruct it well: say the goal, where the change belongs, and how you will check
it. Then check the result yourself in the real interface: **Preview**, and in the
lesson **Dashboard** the **Files**, **Current changes**, **Git log**,
**Architecture**, **Env** and **Database** → **ERD** views. These are the ordinary
Dashboard sections, limited to this practice project and lesson session; see
[Choosing lessons and Learning conversations](learning-mode-ui.md) for which
sections a lesson shows.

Work the teacher does for you is a demonstration. It never counts as your
practical evidence, and the teacher does not do a graded task for you before you
try it. When a lesson is about instructing the agent, your own explanation or
instruction is what is assessed.

While a code question is open, the teacher will not edit that question's files,
even if you ask; any agent edit there voids the attempt and **Check my code**
then reports that an independent attempt is needed. Make those edits yourself in
the lesson Dashboard's **Files** tool. The teacher also never deploys, publishes,
pushes to real remotes, changes Git remotes, or touches other projects or folders
outside this practice project. Lesson 0 and other lessons without a practice
project keep a conversation-only teacher that does no project work.

Opening supported practice teaching retains the reserved initial conversation,
source and history. An ownership or lesson-binding error needs owner inspection;
do not create a replacement or switch it to an unrelated Working project. An
older prepared conversation is not silently converted by resuming the lesson.
