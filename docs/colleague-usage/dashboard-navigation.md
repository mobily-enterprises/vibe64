# Find project tools and return to chat

Open a project and select **Dashboard** beside **Preview**. The Dashboard provides
the available session and project tools, including Files, Changes, Database,
Architecture, AI Terminal, Project settings, Git log, Project files, Env, App access, Integrations, Publish, Issues
and Pull requests. **Publish** turns the project into an app or package people install; see
[Publish your project](publishing.md). Availability depends on the selected session, host and permissions.
On desktop the section list is grouped: tools under the **Project** label come first,
then a **Session** label with the selected session's name and its tools. The
highlighted pill marks the open section, and each page's header repeats that
section's icon and title with a one-line description and its actions.

On mobile, **Show project** reveals the project from chat. Use **Dashboard section**
to choose a tool and **Back to dashboard** to return from its detail. **Show chat**
returns to the coding conversation. A link, reload or Back to a session tool such
as Files, Changes, Database or Architecture opens on that tool, not on chat. On a
desktop the header's **Preview** and **Dash** (Dashboard) switch between the two panes. Preview and Dashboard retain their own selected
state when hidden; leaving the preview does not stop its application.

The left-arrow **Back to dashboard** control has the same appearance in
Architecture, Current changes, Files, Database, Issues and Pull requests, including
the same readable text size on phones. Issue actions wrap below it when space is
limited. Use
Tab to focus it and Enter to activate it. Files and Database opened from
Architecture instead show **Back to Architecture**, returning to that view.
Inside an individual issue or pull request, the same control says **All issues**
or **All pull requests** and returns to its list.

**Git log** is in the project section above the active session's tools. Open it
to review saved commits and their file differences. With no session selected it
lists the project's saved versions on its default branch, and selecting a version
opens its files and differences; **Check for updates** stays disabled and the
status says to select a session. With a session selected, the log is pinned to
the version that session is based on and can offer to update it. **Current
changes** remains with the selected session. If Git log offers a session update
or reconciliation, that action applies to the selected session; opening the log
does not change files.
The same **Git log** label appears in the mobile **Dashboard section** chooser.
Colleague can answer "What did my last Save change?": it reads the same saved
versions (commit, author, time and message) and the names of the files each
version changed, with added and removed line counts. It never reads the file
differences; open the version in **Git log** to see them, or ask a coding
conversation.

Files provides **Repo** for source and **Session Dropzone** for exchanging files with the
selected session; the workspace owner also sees the read-only **Session** area.
**Project files**, in the project section, holds **Project Dropzone** and
**Project Backups**, shared by all sessions of the project. Choose an area to
browse its folders and files; searching is optional. Uploading, creating text
files, image previews and moving or copying between areas are described in
[Upload, create, preview, move and copy files](files.md).
Access follows the signed-in account; changing a link cannot select another role.
Changes shows the session's source changes. AI Terminal shows the coding agent's
native terminal; an enlarged terminal has **Exit full screen**. This leaves it
running, while **Close terminal** stops that terminal. Architecture presents the UI storyboard and Engine dependency layers on one
pannable, zoomable sheet, with registered routes on web cards; asking the coding
agent to investigate or update it
is separate from opening the view. Do not mistake an unavailable/loading tool for
an empty successful result.

A practice lesson's project is an ordinary project of yours, so its
**Dashboard** is this same Dashboard with every section and the usual access; it
has no separate lesson Dashboard. See
[Practice projects in standalone lessons](learning-practice-projects.md).

Colleague can open supported views in your initiating browser and wait for the
actual selection before reporting success. Ask “Show me Database for this session”,
“Open Project settings”, “Open Project files” or “Open Publish”: it opens Preview and every Dashboard
section listed above (session tools need a session). It can explain visible
controls using its guides.
During a lesson, it opens the practice project's ordinary **Preview** or
**Database → ERD** like any project's, minimising Learning if it is open.
By default Colleague points at the real tab or Dashboard section (Database, Files,
Current changes, Git log, Session info, Architecture, Publish) with a short ring and
caption so you click it yourself. A changed project, session or browser is
refused instead of being silently retargeted. Agent navigation is a demonstration,
not proof that the learner used the control; only the learner's own step
actions in the Learning environment record step results.
Code, file, terminal and visual investigation belongs to a coding conversation;
Colleague can ask that agent and relay its result, but cannot itself read source,
execute a shell command or inspect the screen. A navigation request does not
authorize editing source, stopping work or changing settings.
