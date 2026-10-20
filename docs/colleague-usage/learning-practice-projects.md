# Practice projects in standalone lessons

Some lessons need a practice application. In Learning → **Courses**, use
**Start**, **Start next lesson** or **Start lesson** for a new lesson, or
**Continue**/**Resume saved lesson** for your saved one (see
[Choosing lessons and courses](learning-mode-ui.md)). If the installation reports that exercise preparation is
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

A practice project is an ordinary project of yours, and the session that
lesson preparation creates in it is an ordinary session of that project. Open
it with **Open practice project** in Learning or from **Practice** in the
project list. Its chat, **Preview**, **Dashboard** and session list work exactly
as in any of your projects, with full access, and they stay that way after the
lesson ends, until you delete the practice project. Ending a lesson does not
stop or close the project or its session.

A local installation normally serves only the project you selected. It also
opens your own practice projects by their address (for example when Colleague
navigates there or you open **Account settings** from it), with the same full
access as on a hosted workspace, including after the lesson has ended. Another
person's practice project, or a practice address with no saved lesson behind it,
still reports "Local editor mode only serves the selected project."

## Practice list and deleting a practice project

Practice projects are ordinary projects marked as practice. The local start
page (**Projects**, the project picker) lists them separately under
**Practice**, below your projects: each row names the lesson and the practice
project's address. Select a row to open that project.

The trash button beside one of your own practice projects (**Delete practice
project** followed by its name) deletes it with one click; there is no
confirmation dialog. A **Practice project deleted.** message confirms it. The
project's source, sessions and runtime state are removed and no archive is
kept, so it cannot be restored. Your lesson progress and earlier passes stay;
the lesson attempt that owned the project ends. If a session in that project is
pinned, deletion refuses with **Unpin session … before deleting this practice
project.** Open that session, choose **Unpin session**, then delete again. If
deletion stops part-way, press the trash button again; it continues from the
step that failed. Ordinary projects never appear under **Practice** and are
never deleted this way.

Colleague can explain these steps. It deletes a practice project only when you
ask it to and then confirm the exact project; an offer is not a request.

## Working in the practice project

The practice project's session has an ordinary Vibe64 agent, without lesson
instructions. Ask it to make a change and it works in the practice project, as
in any project; Colleague teaches you to instruct it well (say the goal, where
the change belongs and how you will check it). Then check the result yourself in
**Preview** and the **Dashboard** sections.

Work an agent does for you never counts as your practical evidence. While a code
question or code step is open, make the edits to its files yourself in
**Dashboard → Files**: your saves there are recorded for the lesson, and any
other writer's edit in those files means the step's **Check** asks for an
independent attempt (see [Answering a code question in a lesson](learning-code-questions.md)).
On a hosted workspace, **Files** saves are not yet recorded for lessons.

Lessons started before this change keep their practice conversation: the
installation's update turns it into an ordinary session of the practice
project with its history, and retires the old lesson-only conversations of
lessons without a practice project.
