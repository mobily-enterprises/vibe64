# Review, Save and work with GitHub

Source edits in a session, saving a project version and publishing an application
are separate operations. A different session has its own worktree. Check which
project, session and branch you are using before saving or creating a pull request:
the session tab's details show **Saves to**, the repository and branch its Save
uses, marked **(not main)** when that is not the project's main branch (see
[Create and switch sessions](sessions.md#switch-between-open-sessions)).

Open **Changes** in Dashboard to inspect the work. Use the session's **Save**
control to review and save; a dimmed **Save** says why when you tap or click it.
When the selected session has
unsaved changes, the **Save** button is red, matching the red save icon on that
session's tab. A green tick on the tab means **All work is saved**. While that
session's assistant is working (its dot pulses), the tick is grey and reads
**All work was saved at the last check; the assistant is still working**,
because the turn can still change files; when the turn ends the tab shows the
session's current state again. Phones and other touch screens hide this icon;
select the tab's info button to read the same status under **Work**.
Managed Vibe64 Git saves a version;
GitHub workflows use your repository permissions and the project's direct-push or
pull-request policy. **Update this session (rebase)** reconciles newer saved project
work when offered; Save does not silently perform that update for you. While the
project's main has newer saved versions, Save waits and every place that shows it
(the Save button's hint, the Changes page, the session tab's status and Save's
answer) says the same thing, for example *Main has 1 newer saved version (8:11 AM,
from the Passes session, 2 files). Update this session to take it in (your unsaved
work stays), then Save.* The session is named only when Vibe64's own Save recorded
which session saved the version; otherwise the message gives the time and files
alone. Update is how newer saved versions come in: there is nothing to merge by
hand. A failed or uncertain push needs a state check before another request.

Save and Update record the Git name and email
you have at that moment, the ones **Account settings → GitHub** shows, for every
kind of project. If one says Vibe64 could not read your Git name and email,
nothing was changed; try it again.

While a browser tab has the project open, even in the background, or an AI turn
runs in one of its sessions, Vibe64 checks the project's repository every 30
seconds. Newer saved work pushed from elsewhere, or committed in a local project
folder, turns each affected session's tab and header action to **Update this
session (rebase)** within about half a minute, so a tab you return to already
shows it; a Save from another Vibe64 session shows it at once. Nothing is checked
while no tab has the project open and no AI works in it; it checks again as soon
as you open it. A tab opened before Vibe64 was last updated may not keep these
checks running; reload it. If a check fails, the session's repository status
shows the error and Vibe64 retries every minute. **Check for updates** in
Repository checks immediately. After an AI turn, a Save or edited files, the
session's saved-work status follows within a few seconds. These steps apply on
desktop and mobile.

Vibe64 reuses your GitHub login for a few minutes: after you reconnect GitHub,
the next operation can fail once with an authentication error; retry it.

In every main-chat mode, **Automatically save changes** (on by default under
**Chat settings** in the chat mode menu) runs this same Save once a finished
piece of work's last turn ends: for a plan, after the last pass in its Passes
section (see [Passes](passes.md)).
Its progress, result and recovery are the ordinary Save's; when it cannot save,
chat shows **Automatic save didn't run:** with the reason, and nothing changes.
When Save needs newer saved work first, it runs **Update this session
(rebase)**, then Save; if that Update stops, chat says why and names **Fix it
with AI** on the Update notice.
While it is on, the main chat's AI also runs this same Save itself at each
finished and checked stage of longer work; see [The session's AI saves its
finished stages](ai-save-and-update.md#the-sessions-ai-saves-its-finished-stages) and [Choose what
happens once work is finished](chat-settings.md).

Whenever Save or Update reports a problem, its activity panel offers **Fix it with
AI**, which opens the [AI task window](ai-tasks.md) with the exact error. The AI
repairs the files, then Vibe64 runs Save or Update itself, so you never press
another button to finish: a fixed Save pushes the work by itself. If Save needs your
review of where it goes, the fix stops and asks you to choose **Save** and then
**Check now**. Ordinary failures also keep **Retry** while no fix is open; conflicts
and diverged history offer only the repair, because retrying alone cannot succeed.
Selecting the button requires the person's interaction; Colleague can explain it.

If a session's own coding agent rewrote the saved branch's history and pushed it
(for example, by splitting large commits and force-pushing), select **Check for
updates** in Repository. When the session already contains the rewritten branch,
Vibe64 adopts it as the session's new starting version: the update status and Git
log refresh, and Update and Save work normally, with no repair needed. A rewrite
pushed from elsewhere while this session still holds the old history remains a
diverged-history error; start a new session on that branch and carry the work
across. These steps apply on desktop and mobile.

For Genesis projects, Save and Update regenerate the project diagrams from the
saved source. Genesis never stops either one: when it cannot regenerate them,
for example because `genesis/stack.md` is missing a section Genesis needs, or
Genesis fails or does not answer, your work is still saved or updated with the
diagrams it had. The activity shows **Genesis could not regenerate the project
diagrams, so this Save kept the ones it had.** (or **this update**) followed by
Genesis's reason. Ask the coding agent to fix what the reason names; the next
Save or Update after the fix regenerates the diagrams. Colleague can explain the
note; the coding agent performs the source repair. These steps apply on desktop
and mobile.

If assistant naming is unavailable, Save uses a checkpoint-based version name
and continues. A successful Save clears that nonfatal diagnostic from its current
failure status; the fallback notice remains in its progress history. Check the
final Save result and the session's **All work is saved** indicator rather than
treating the naming notice as a failed push.

If a push loses its response, Vibe64 checks the exact prepared commit on the
remote before treating it as failed. If the remote cannot be read, restore access
and inspect the session's work again. Recovery uses the original Save operation
and Git evidence, including after an editor restart, without another push. A
failed local update after a push uses the same recovery. If Git confirms
that nothing was pushed, the original rejection remains visible or an
uncertain attempt becomes explicitly retryable. Colleague can inspect work and
explain that result; a new Save still requires your instruction.

Save and Update can take minutes, for example while they update or save several
connected repositories. Choosing **Save** or **Update session from main** (or
**Update this session (rebase)**) starts the work on the Vibe64 server, and its
notice shows each step as it happens. The work runs to its end on the server
whatever happens to the page: closing or reloading the tab, losing the connection,
or a proxy between the browser and the server cutting off a long request neither
stops it nor counts as its failure. When it ends, the notice shows its outcome,
with **Review resolved conflicts**, **Fix it with AI** and **Retry** where they
apply; opening the session again shows a Save or Update that is still running, or
one that failed. Choosing the same action again while it runs, from another tab
for instance, follows the one that is running instead of starting a second. A
refusal that stops it before it starts, such as another repository operation
holding the session, is reported at once.

Existing temporary chats and an open
[AI task](ai-tasks.md)'s Chat remain readable, and plain text typed in them is saved
without waiting for the source operation. A new assistant send or change to its model or attachments waits
until that operation finishes.

Use **Dismiss** to hide an inactive Save or Update notice. This browser remembers
each dismissed operation in that project and session, including after reload or
dismissing another notice. A new failed attempt still appears. Dismiss changes
only the notice; it does not resolve a repository failure or stop active work.
To see a dismissed failure again, choose **Show Update notice** or **Show Save
notice** in the selected session tab's info.
On phones, reveal chat to reach the notice and its controls.

Save and Update can also run while the session's AI works, and the AI runs them
itself: see [Save and Update with the session's AI](ai-save-and-update.md), which
also says what the AI's Git does with your GitHub sign-in.

## When the repository needs help

A circled **!** on a session's tab reads **Repository needs help**: that
session's last Save or Update failed and Vibe64 still records the failure. To
read why, hover the icon or open the tab's info (hover or keyboard focus on
desktop; the info button on phones and other touch screens). Under **Work**,
**Why** shows the failed operation's own message, for example *2 files need
review before this session can update: package-lock.json, package.json…*, and
**Next** names the controls that lead out of it:

- an Update conflict: **Fix it with AI** opens the [AI task window](ai-tasks.md),
  which ends the fix itself; or resolve the listed files yourself in Main chat,
  then choose **Review resolved conflicts** (see below);
- a required pull request: **Create draft PR** or **Fix it with AI**;
- diverged history: **Fix it with AI** only, because retrying cannot succeed;
- anything else: **Fix it with AI**, which opens the same window for Save and
  Update, or fix the cause and Save or Update again.

While Fix it with AI works on it, the tab shows a working icon and reads **Being
fixed with AI**, and **Save** and **Update** wait, their hint naming the fix.

These controls are on the Save or Update notice in chat. If you dismissed it,
open the selected tab's info and choose **Show Update notice** (or **Show Save
notice**); the notice returns with its controls, and on phones chat is revealed.
Screen readers hear the same reason and next step in the tab's name, and the
**Save** button's hover text repeats it. The failure does not disable Save:
**Save** is unavailable only when the session has nothing to save, and its
hover text then says **No work to save**. Nothing to save means no changed file
in the session or its connected copies, no commit a copy's main lacks, and no
Composition pin behind its copy: after **Update** moves a connected copy to a
newer commit that the project's main does not pin yet, **Save** stays available
with no changed file, says `Save pins <repository> at <commit> in
vibe64.connections.lock.json`, and records it (see [Save saves the copies
first](connected-repositories.md#save-saves-the-copies-first)). The **Changes**
page lists files only, and offers its **Save** on this same answer. A Save that
finds nothing left to save (another tab or the AI saved it first) shows
**Nothing to save** as a note, never a failure.

A repair made outside Save and Update counts. If you or the session's AI fixed
the repository with Git (for example, rebased onto the latest saved version and
finished the rebase), Vibe64 checks the session's own repository the next time
it inspects its work: after an AI turn, a refresh, or **Check for updates**.
When the session already contains the saved version the Update was trying to
apply, or has nothing left to update, and no merge, rebase, cherry-pick or
revert is unfinished and no file is still conflicted, the label clears and the
Update's history notes why it no longer applies. A conflict that is still open
keeps the label and its reason. The same applies on desktop and mobile.

The session's AI reads this stored reason and next step in `vibe64-helper
session status --json` (under `repository`), and Colleague reads it when it
inspects the session's work, so both can explain the label instead of guessing.
Explaining it authorizes nothing: **Fix it with AI**, **Review resolved
conflicts** and **Show Update notice** need your interaction, and any repair the
AI makes needs your request, except the conflicts of an Update the AI ran itself,
which it repairs as part of that work.

## Apply an Update after resolving conflicts

If Update reports conflicting files, repair them manually, in Main chat, or with
**Fix it with AI**, which runs in the [AI task window](ai-tasks.md). Preserve the
intended changes from both versions. Wait for coding work to finish, then:

1. Select **Review resolved conflicts** on the Update error. While a fix is open,
   this control leaves the error and appears in the window's footer once its
   checks have stopped.
2. Review every file listed in **Apply resolved Update**. Select **Cancel** if
   further repair is needed; cancelling leaves the files unchanged.
3. Select **Conflicts resolved — apply Update** to acknowledge the
   repair and run Update. Without a fix open, this works directly. With one, Update
   runs as that fix's check. It does not Save or push the work.

On phones, reveal chat to reach the Update error; the file review and confirmation
are the same as on desktop. The controls wait while a repository operation is
busy; an AI that is working does not hold them. A changed conflict invalidates an open review.
If Update refuses a stale review or finds remaining conflicts, inspect the new
diagnostic, finish the repair and review again. This manual action does not send
another AI request. Successful Update may still require workspace preparation;
its result does not establish that application tests passed.

The window's **Check now** is a plain retry, not an acknowledgement that
conflicting files are resolved. A completed **Fix it with AI**
repair still submits its recorded review by itself on the server, whether or not
anyone is watching, subject to the same repository checks.

Colleague can explain these steps and offer a supported Update after a coding
agent verifies the repair. A how-to question does not authorize it. Main coding
chat can repair files but has no Vibe64 Update command; the person can use the
review control without starting another AI conversation.

## Issues and pull requests

Use **Issues** or **Pull requests** in the project Dashboard for the repository's
records. Search or select the exact issue/PR before changing it or adding a comment.
External writes use the connected person's GitHub identity; missing sign-in or
repository access cannot be bypassed by using another workspace account.
On mobile, reveal the project and choose the corresponding **Dashboard section**.

Creating a pull request saves the session's connected copies first, straight to
their mains, exactly as Save does, then pushes this session's work to the pull
request branch; see [Work in connected repositories](connected-repositories.md).
A copy behind its main stops it with the same **Update first** refusal.
The dialog says it is creating while Vibe64 saves the work and asks GitHub, which
can take minutes for a large change, and follows it to the end; a dropped
connection never creates a second pull request. If Vibe64 restarted meanwhile,
the dialog asks you to check the session's pull request before creating again.

Colleague can explain these workflows, open their views, inspect bounded saved-work
status, request native Save/Update, and use supported issue/PR actions when asked.
It delegates code/diff investigation to a coding agent rather than reading the
repository itself. Tell it the intended branch, issue or PR when ambiguous. A
question such as “How do I create a PR?” makes no commit, push or external write.
An accepted offer or direct request still needs any unresolved inputs and the
native review/permission rules. Its report must distinguish requested, saved,
pushed and unknown outcomes, and disclose unverified external results.
