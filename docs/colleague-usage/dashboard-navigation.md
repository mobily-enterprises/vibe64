# Find project tools and return to chat

Open a project and select **Dashboard** beside **Preview**. The Dashboard provides
the available session and project tools, including Files, Changes, Database,
Architecture, AI Terminal, Project settings, Git log, Env, App access, Integrations, Issues
and Pull requests. Availability depends on the selected session, host and permissions.
On desktop the section list is grouped: tools under the **Project** label come first,
then a **Session** label with the selected session's name and its tools. The
highlighted pill marks the open section, and each page's header repeats that
section's icon and title with a one-line description and its actions.

On mobile, **Show project** reveals the project from chat. Use **Dashboard section**
to choose a tool and **Back to dashboard** to return from its detail. **Show chat**
returns to the coding conversation. Preview and Dashboard retain their own selected
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
to review saved commits and their file differences. **Current changes** remains
with the selected session. If Git log offers a session update or reconciliation,
that action applies to the selected session; opening the log does not change files.
The same **Git log** label appears in the mobile **Dashboard section** chooser.

Files provides **Repo** for source and **Session Dropzone** for exchanging files with the
selected session, plus **Project Backups (2w retention)** shared by all sessions
of the project. Choose an area to browse its folders and files; searching is
optional. The workspace owner also sees the read-only **Session** area.
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
actual selection before reporting success. Ask “Show me Database for this session”
or “Open Project settings”. It can explain visible controls using its guides.
During a lesson, it opens the practice project's ordinary **Preview** or
**Database → ERD** like any project's, minimising Learning if it is open.
By default Colleague points at the real tab or Dashboard section (Database, Files,
Current changes, Git log, Session info, Architecture) with a short ring and
caption so you click it yourself. A changed project, session or browser is
refused instead of being silently retargeted. Agent navigation is a demonstration,
not proof that the learner used the control.
Colleague no longer starts a Learning watch for “Watch me while I do this”; your
own step actions in the Learning environment record step results directly.
Code, file, terminal and visual investigation belongs to a coding conversation;
Colleague can ask that agent and relay its result, but cannot itself read source,
execute a shell command or inspect the screen. A navigation request does not
authorize editing source, stopping work or changing settings.


In **Files → Project Backups (2w retention)**, use **Upload**, drag files into the
folder, or choose **New folder**. Open a text file to edit it and choose **Save**;
use its menu for **Rename** or **Delete**, and **Download** to keep a permanent
copy. The same controls are available in Session Dropzone. On phones, file
browsing and editing share the pane and secondary actions are in the file menu.
Confirm **Delete** to remove the selected item; **New folder** creates an empty
folder in the currently displayed directory.
Uploads accept individual files up to 500 MiB; use a zip to exchange a directory.

Project Backups is an ordinary directory outside Git. The coding agent can put
files there using its supplied path; **Copy AI path** lets you refer to that same
directory. Switching, renewing or archiving a session does not remove the
project's backups. Every file displays an expiry date. Hosted daily maintenance
deletes files after 14 days without a write or filesystem change; a newly copied
file gets a fresh window even if it preserves an older modification date. Download
anything you want to retain permanently. This folder does not automatically
snapshot your project. Session Dropzone is temporary and disappears when its
session is successfully archived.

Colleague can explain these controls and open Files. Ask the coding agent to
create or inspect backup files; Colleague itself has no filesystem or shell
access. If a backup operation reports busy, wait for the current upload or
maintenance to finish and retry. Symbolic links are not browsable or cleaned
automatically. Workspace upgrade recovery copies remain private operator data
and are not exposed in the project's backup folder.
