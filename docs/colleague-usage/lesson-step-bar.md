# The lesson step bar

The yellow lesson step bar above the project page plays the current lesson
step: its position, beats, **Back** and **Next**, and **Courses**. The rest of
Learn mode is in [The Learning environment](learning-environment.md).

In Learn mode, while your lesson is loaded, a yellow bar above the project page
names the lesson and shows **Step N of M** (this step's number among all the
lesson's steps) with the step's title and status.

**Moving through the lesson.** One labelled pair of buttons, with the same
names for screen readers and the keyboard:

- **Back** goes back one part of this step, or into the previous step from its
  first part. It is greyed out at the very start of the lesson.
- The forward button says exactly what it does: **Next** while this step has
  more parts, **Next step** on its last part (and on a step without parts),
  and **Finish** on the last step once every required step is done (it shows
  the **Lesson finished** screen). On the last step before that there is no
  forward button. There is no second **Next step** button.

On a practice project the **Lesson** toggle is in the header beside **Preview**
| **Dash** (see [The Lesson pane](learning-environment.md#the-lesson-pane)); on
Management and other screens outside any project it is on the bar, between
the forward button and **Courses**. Press it to show the lesson (it turns
yellow with its switch on); press it again to hide it. On a lesson without a
practice project the lesson is already the whole page, so there is no toggle.

Away from the lesson's practice project (for example on Management), the bar
also offers **Open practice project**, which goes back to that project's
editor. **Courses**, at its right end (a book icon on a phone), opens the
Courses overlay to choose another lesson. The bar is always shown in full; it
cannot be collapsed or hidden. On a phone the lesson name is hidden.

### Steps with beats

Some steps walk you through the real page from the bar itself, one short line
(a *beat*) at a time, while the lesson stays where it is. The bar then shows
the lesson name, **Step N of M** and a dot per beat, the parts of this step
(the filled dot is the current one; hovering the dots says, for example,
**This step: part 2 of 4**), then the beat's line:

- A *show* line rings the place it names (for example the **Preview** tab or the
  coding chat) and moves on by itself after a few seconds; a thin line under
  the bar shows the time left. **Pause** (and **Play**) stops and resumes it;
  it also waits while your pointer or keyboard focus is on the bar, while
  Courses is open or while the tab is hidden. With
  reduced motion turned on in your system it never moves by itself: press
  **Next**.
- A *do* line waits for you to do what it says, in this lesson's practice
  project: be at a place (for example open **Files**), send a message in the
  coding chat, wait for the agent to finish, open a file, press the practice
  App's button, open or minimise Colleague, press **Save** or **Reload
  preview**, or press **L** (it counts once you are back in Learn). When the
  page sees you do it, the line says **✓ Done.** (or **✓ You're already here.**
  when you already are) and the next beat plays after a moment. **Next** skips
  it. What you did earlier in this step counts too, in order: a message sent
  while an earlier line played completes the send line, and an agent that
  finished before its line appeared completes the wait line (what happened
  before the step's previous *do* line was done does not count). Going **Back** onto a line you have
  done leaves it waiting.
- **Do it for me** on a *do* line does it through the page's own controls:
  it opens the place (or the file), reveals and focuses the coding chat, opens
  Courses or Colleague (without asking it anything), reloads the Preview, or
  sends the line's quoted prompt as your next message in the practice
  project's Main chat (for a team member, on the team AI, with no owner
  approval). That message shows a **Sent by the lesson** chip under it. On a **Save** line it only points at **Save**: saving stays yours. On a
  line about waiting for the agent, pressing the App's button, minimising
  Colleague or pressing **L** there is no Do it for me (for **L** it shows
  where the button is). If it cannot be done here (for example the chat cannot take a
  message now), the bar says so; do it yourself or press **Next**, or, with
  no AI connected, **Set up your AI**.
- While the lesson waits for your AI (its practice project could not be
  prepared without one), the bar plays no beats and says so instead, with
  **Set up your AI**; see `learning-mode-ui`.
- On a step you would finish with **Done**, doing every *do* line of it marks
  the step done by itself.
- **Back** and **Next** move one beat; on the step's last beat the forward
  button reads **Next step** and goes into the next step.
- After the last beat the bar shows the step's own control: **Done**, **Mark as
  done**, **Check my work** (an automatic check, or a review; a check that does
  not pass says why under the line) or **Answer in Lesson** for a question, which shows the
  step in the Lesson pane, beside a quieter **Next step**. **I'm stuck**
  (on a *do* line, and after the last beat of a step that **Check my work**
  decides, until the step passes; also in the Lesson pane beside **Teach me**) opens
  Colleague and asks it for help with this step (see `learning-with-colleague`).
  On a phone a *do* line keeps only **Do it for me** on the bar; **I'm stuck**
  is then in the Lesson pane.
  A step never moves on by itself.
- **Show me** on such a step (in the Lesson pane) plays its
  beats again from the first one.

**Check my work on a reviewed step.** Some steps are checked by a review of
your work: the bar's line (and the step in the Lesson pane) shows what the review
looks for. **Check my work** uses your own AI (the **Explain & check** model in
AI Accounts → Models) to look at the changes in your practice project
(and, when the step says so, your coding chat); the line says **Checking your
work with your AI…** for up to about a minute, without a Cancel. **Passed ✓**
with the reviewer's comment passes the step for good. **Not yet:** says what
is missing, often with a **Hint:**; change your work and press **Check
again**. Checking unchanged work again repeats the saved answer without using
your AI. With no changes yet it says so and uses nothing. If the review cannot
run (the agent is still working, no AI route, a provider error), the bar says
why, nothing is recorded, and you can press **Check again**. Colleague never
runs a review or passes a step for you.

This tab remembers the beat and the pause; another tab or device starts the
step at its first beat. On a phone the bar has three tidy rows: the position
with the icon buttons (**Courses**, **Open practice project** and, off a
project, **Lesson**), then the beat's line and its one button, then **Back**
at the left and the forward button at the right. A step without beats shows
its title and status as before, and **Show me** when it can point at a place.
