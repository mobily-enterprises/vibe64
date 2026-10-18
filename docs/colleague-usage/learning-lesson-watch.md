# Watching a lesson step by step

Colleague and the lesson teacher (Main) can show you places in a lesson, and
Colleague can watch the steps you take; see also
[Choosing lessons and Learning conversations](learning-mode-ui.md).

You can ask Colleague to enter or leave Learning, show **Courses**, show the
active lesson, or reveal the exact lesson project's normal **Preview** or
**Dashboard → Database → ERD**. Main can reveal those same workspace views only
for its bound active lesson, and can return to that lesson's Learning pane or
open a visual declared by its pinned content.

Main usually points you to these places instead of opening them; see
**Learning teacher guide** (`learning-teacher-guide`). Both use the same initiating
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
outcome. Observations include switching between the practice project's
**Preview**/**Dashboard** and the graduation-cap **Learning** option, and between project panes such
as **Preview**, **Dashboard → Database** and **Dashboard → Files**;
a view opened by Main or Colleague is recorded as their demonstration, not your step.
The watch also notices when something you do inside the practice app fails: if
you click or submit in the visible **Preview** (for example **Add note**) and the
app's data-changing request then fails, the watch records **app-request** with
only its method, a path the lesson declared (otherwise `other`), the HTTP status
and a failure code (`http-4xx`, `http-5xx` or `network`). Main may then offer one
hint; at most one such hint is offered every 30 seconds, and the same failure
gets only one. Successful app requests, requests the app makes by itself, and
anything while Preview is hidden (including behind the phone Colleague overlay)
are not reported. This is the app's own claim, so it never grades or completes. Expand **Task criteria** below the watch controls to read the full
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
task's project panes and its Learning tab keeps polling active.
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
line such as “Watching: you are in Preview.” followed by the teacher's
reply. The teacher still receives the full observation; its internal prompt is
not shown as a chat message. A failed step shows “Watching: that step did not
finish.”; choosing the graduation-cap **Learning** option shows “Watching: you are in the Learning pane.”

Polling reports only named Vibe64 controls, the settled project-or-Learning view,
saved lesson progress and the reduced failed app request described above. It
never sends typed text, form values, request or response bodies, headers, query
strings, arbitrary page content, screenshots, secrets or another project. Navigation performed by Colleague is
reported as a demonstration, not as something you did and not as assessment
evidence. Polling does not grade a question or mark a lesson complete.
Only a saved assessment outcome supports completion; a recent observation or a
delivered-help receipt does not. Colleague cannot observe arbitrary activity
inside the supervised application unless that interaction is one of the named
Vibe64 controls or the declared exercise-response bridge.
