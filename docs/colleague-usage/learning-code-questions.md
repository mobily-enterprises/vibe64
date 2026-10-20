# Answering a code question in a lesson

A lesson can ask you to change code, for example "make `notes.mjs` refuse an
empty title". Make the change yourself in the practice project's ordinary
**Dashboard → Files** editor, then press the step's **Check now** in the Learning
environment; see [The Learning environment (L)](learning-environment.md).
Earlier-format code questions (**Check my code**) were retired; their passes
stay in your saved history.

## How a code step is checked

A code step names the files to change. Opening the
step for the first time in an attempt records their starting contents; every
code step keeps its own start for the rest of the attempt, so reopening it or
moving between code steps never changes it. Code already in a file when you
first opened the step (from the coding agent, Colleague, Git or an earlier step)
is the start, not your work: you must change every named file yourself, through
your own saves in **Dashboard → Files**, after opening the step. If you have not,
the check reports "needs your own change: edit `<file>` yourself in Dashboard →
Files during this step, then press Check now" without running. Saving a file
never runs the check by itself. Any
other change to a named file after that start makes it report "needs an
independent attempt: other edits detected in `<file>`" without running. If the
step has no recorded start, the check says so: open the step again, then make
your change. The pass is recorded only when you press the step's **Check now**
yourself; a check Colleague runs only reports what it found and saves nothing.
No explanation or grading is needed.
