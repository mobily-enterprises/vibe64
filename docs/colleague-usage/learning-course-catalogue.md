# Installing and updating Learning courses

Learning (the **L** button) can install courses from the official Vibe64 course catalogue
straight from the **Courses** pane. Nobody needs a terminal for official
courses.

## Where it is

1. Open Learning with the **L** button at the left of the header.
2. Its **Courses** tab shows your installed course cards first. Below them is
   the **Course catalogue** section, headed **Install a course**.
3. The catalogue is grouped by **topic** (for example **Vibe64**). Under each
   topic, every course shows its title, release (for example `0.1.10`), a
   **Released** or **Preview** chip, its lesson count and whether it is
   **Installed**, **Not installed**, **Disabled by the owner** or has a
   **Conflicting copy installed**. A topic without courses says **No courses in
   this topic yet.** Courses whose catalogue entry names no topic are listed
   under **Other courses**.

When no course is installed yet, the installed area says **No courses are
installed yet. Choose a course in the catalogue below and select Install.**

On a phone the same sections stack in one column and each course's button
fills the row width. On desktop the button sits at the right of the course.

## Installing a course

Select **Install** on a course that is **Not installed**. While it works, the
button shows a spinner and the row reports each step: **Reading the official
catalogue…**, **Downloading and verifying topic 1 of N…**, **Enabling the
course…**, or **Waiting for another course installation to finish…** when
another install is running. You can keep reading other parts of the page; other
course buttons wait until it finishes.

When it succeeds the course card appears among your installed courses and the
catalogue row shows **Installed** with **View course**. Installing a course does
not start a lesson.

What the server does: it rereads the official catalogue, downloads each topic of
that exact course release at the exact Git commit named in the catalogue's lock,
verifies every file byte for byte against that lock, installs the verified copy
and enables the course. It runs no course code. If anything does not match, it
installs nothing new for that topic and enables nothing.

Any signed-in person can install official catalogue courses. The catalogue
location is fixed by the server, so the page can only install the courses it
lists. Courses from other sources remain an owner/operator task (see
[Author a lesson and publish its source](lesson-authoring.md)).

### Preview courses

A **Preview** course can be installed so that it is ready, and the row says
**Preview course: it can be installed; until it is released, only the workspace
owner can try its lessons from Courses.** Its installed card keeps the
**Preview course** chip. The workspace owner (on local Vibe64, you) sees
**Try preview**, which starts the lesson exactly like **Start**; everyone else
sees the course with the note **Preview — the workspace owner can try it; it
becomes startable when released** and no start button. Installing does not change
this; once the course is released, everyone gets **Start**.

## Updating a course

When the catalogue has a newer release of a course you already have, the
installed course card shows **Update available: <release>** with an **Update**
button, and the catalogue row says **You have <old release>. Updating keeps
your saved lessons and progress.** with the same **Update** button. Both run the
same installation as **Install**, for the newer release.

After an update:

- The new release is installed and enabled, and new lessons start from it.
- Older releases of that course are disabled **for new starts only**. They are
  not deleted. Their old card is hidden from the list, except while you still
  have a saved lesson in that release: that card stays, labelled **Disabled for
  new lessons**, and **Continue lesson** still opens the
  exact lesson you started. Lesson history is unchanged.
- Progress carries over. A lesson whose content did not change keeps its
  **Completed** status. A lesson whose content changed shows **Not started**
  (or **In progress**) with the note **Completed in <old release> · updated
  since**, so you can see you finished the earlier version. Completing the new
  version records new progress; the earlier record stays.

## Errors and recovery

The message appears on the course row, and the button becomes **Retry install**
or **Retry update**. Retrying repeats the same request safely; an already
installed course is not installed twice.

- **The official course catalogue … could not be downloaded** (shown in the
  catalogue section, with **Retry**): the server cannot reach GitHub. Installed
  courses keep working. Retry later or ask the operator to check the server's
  internet access.
- **Topic … could not be downloaded …**: the same network problem during
  install. Nothing was enabled; retry.
- **The official course catalogue is invalid …**: the published catalogue is
  wrong. Nothing was installed; the catalogue maintainers must correct it.
- **The owner disabled course … on this server**: shown as **Disabled by the
  owner**. Only the workspace owner can enable it again.
- **… already keeps 16 installed course releases, its limit**: every installed
  or updated release uses one of 16 places and none is deleted automatically. Ask
  the owner to free space; nothing was changed.
- **Topic source or installed snapshot conflicts with the approved owner pin** or
  **Conflicting copy installed**: the server holds different content under the
  same release. Nothing is replaced automatically; ask the owner to inspect it.
- **Installing courses from the catalogue is unavailable in this installation**:
  this host has not enabled catalogue installation. Installed courses still work.

**Refresh courses** at the top rereads installed courses, progress and the
catalogue.

## What Colleague can do

Colleague can list the catalogue (`available.list`), explain each course's state,
and offer to install or update a course. It installs or updates only after you
directly ask for that course or accept its offer, using the same server action
as the button, and it reports the real result. It cannot install courses from
other sources, choose a different catalogue, delete releases or re-enable a
course the owner disabled.
