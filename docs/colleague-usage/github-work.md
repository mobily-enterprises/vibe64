# Review, Save and work with GitHub

Source edits in a session, saving a project version and publishing an application
are separate operations. A different session has its own worktree. Check which
project, session and branch you are using before saving or creating a pull request:
the session tab's details show **Saves to**, the repository and branch its Save
uses, marked **(not main)** when that is not the project's main branch (see
[Create and switch sessions](sessions.md#switch-between-open-sessions)).

Open **Changes** in Dashboard to inspect the work. Use the session's **Save**
control for its native review and save workflow. When the selected session has
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
work when offered; Save does not silently perform that update for you. A failed or
uncertain push needs a state check before another request.

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

Vibe64 reuses your GitHub login for a few minutes across repository operations.
If you reconnect GitHub and the previous login was revoked, the next operation can
fail once with a GitHub authentication error; retry it and it uses the new login.

In every main-chat mode, **Automatically save changes** (on by default under
**Chat settings** in the chat mode menu) runs this same Save once a finished
piece of work's last turn ends: for a plan, once the last pass in its Passes
section is done (see [Passes](passes.md)).
Its progress, result and recovery are the ordinary Save's; when it cannot save,
chat shows **Automatic save didn't run:** with the reason, and nothing changes.
While it is on, the main chat's AI also runs this same Save itself at each
finished and checked stage of longer work; see [The session's AI saves its
finished stages](#the-sessions-ai-saves-its-finished-stages) and [Choose what
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

## Save or Update while the AI works

Update and Save can run while the AI works; Save asks first because it includes
unfinished changes. Choosing **Save** while the main chat's AI is working opens
**Save changes** with **The AI is still working. Save now, including its
unfinished changes?**; its button reads **Save now**, and **Cancel** saves
nothing. Update runs straight away. While either runs, **Stop** still stops the
AI at once, and a message sent to the working AI joins its turn straight away.
A new request waits for Save or Update to finish, and after a minute asks you to
send it again.

Nothing written, deleted or renamed while either runs is lost. A file the AI
writes after Save has captured the work stays as unsaved work, and Save's notice
says how many files changed while it ran. That includes a file Save itself
changes, such as a project file Save regenerates: the session still moves onto
the saved version and the AI's copy stays as an unsaved change. When a Git commit
is made in the session while Save runs, the work is still saved, every change is
kept, and the notice says Update brings the session onto the saved version. When a file
Update changes is written, deleted or renamed while Update runs, Update stops,
puts the session back as it was with every change kept, and says **A file
changed while Update ran**, so try Update again. If files keep changing each time
Update tries to put the session back, the session stays updated instead, keeps
every file as last written, and says **Files kept changing while Update ran**:
check those files before saving. When Update would replace a
local file Git ignores in this session, it stops before changing anything and
names that file: move or rename it, then try Update again. When a Git commit is
made in the session while Update runs, Update stops, leaves every file as it is
and says so; try Update again.

Afterwards Vibe64 tells the main chat's AI what happened: after Update, which
files changed, so it re-reads them before editing and re-runs checks that touch
them (a turn that is working is told at once, otherwise the note leads your next
message, and several waiting notes go together); after Save, a working turn is
told its work was saved as it was when Save started and which files Save
regenerated. A note sent to a working turn appears in the chat as Vibe64's, not
as yours, and Claude is told it is a note from Vibe64, not from you. An Update the session's AI ran itself (see below) does not interrupt
its turn with that note, because its own command already told it; the note still
leads your next message. A Save the AI ran itself sends no note at all: its
command's answer already said what was saved and which files Save regenerated. Colleague can explain these notices; Save and Update
themselves still need your instruction to Colleague. These steps apply on
desktop and mobile.

## The session's AI updates the session itself

When the session is behind its saved version, the session's AI runs Update
itself before building on the old code, at a point where it can deal with a
conflict, so you don't need to choose **Update this session (rebase)** for it.
Nothing updates on its own: the AI decides when. It is the same Update, for this
session and its [connected repositories](connected-repositories.md): it runs inside the AI's own
turn without waiting for it to end, keeps the AI's unsaved work like any Update,
and its notice in chat shows it as it shows yours. The AI runs it with
`vibe64-helper session update`, which tells it what changed, so it re-reads
those files and restarts Preview itself when Preview still runs the code from
before Update.

When a repository conflicts, the command names that repository and its files,
and leaves that repository unchanged. The AI stops its other work and repairs
the files first, keeping both versions' intended changes, then applies the
repair with `vibe64-helper session update --resolved <review-id>`, as **Review
resolved conflicts** does; if it can't repair them then, it leaves them and
tells you. When
Update stops for any other reason, the AI gets Update's own message: it tries
again in a moment when something else was running, fixes a cause in the
session's files and tries again, or otherwise tells you what Update said. An
Update can take several minutes; if the AI's own tool stops waiting sooner,
Update carries on and the AI checks the session's status until it ends.

Update never saves. The same applies on desktop and mobile.

## The session's AI saves its finished stages

**Save** publishes the session's work to the project's main, where the
project's other sessions update onto it. With **Automatically save changes** on,
Main chat's AI does not wait for a long plan to end: at each finished and checked
stage of a plan, or once a piece of work is finished, it runs this session's
Save itself, never in the middle of an edit, and runs Update first when the
session is behind. It is the same Save as the Save button, with the same checks,
backups and [connected repositories](connected-repositories.md): it runs inside
the AI's own turn, saves the files as they are when the AI runs it, keeps any
file written meanwhile as unsaved work, and runs no pass. While it runs the
session shows **Saving work**, as for any Save. The AI runs it with
`vibe64-helper session save`, which tells it each saved commit and the files
saved. Then it tells the other sessions it is working with, through [project
messages](project-messages.md), so they run Update before building on the old
code.

When Save cannot save, the command refuses with Save's own reason and changes
nothing: when an Update is needed first, the AI runs Update and saves again;
with nothing new to save, it says so plainly; for anything else, such as a
conflict, a required pull request or an unavailable repository, it fixes a cause
in the session's files and tries again, or tells you what Save said. A Save can
take several minutes; if the AI's own tool stops waiting sooner, Save carries on.

Only Main chat saves this way, and only while its **Automatically save changes**
is on. With it off, and in a temporary chat, an AI task, Fix it with AI or a
lesson, the command refuses and says why, and **Save** stays your choice. Vibe64
decides this from the session's own record of which chats are working, never
from what the command says: while a temporary chat or AI task works beside Main
chat, it refuses because it can't tell which chat ran it, and Main chat's AI
saves once the other has finished. The same applies on desktop and mobile.

## What the AI's Git does with your GitHub sign-in

In a GitHub project's session, the AI's `git fetch`, `pull`, `push`,
`ls-remote`, `clone` and `remote`, and its `gh` commands, reach GitHub with the
session's GitHub sign-in. The token travels with the command, so such a command
never runs a program the AI picked: it runs none of the repository's hooks,
reaches GitHub only over HTTPS, uses only Vibe64's own credential, and does not
enter submodules. It refuses, saying what to do instead, when the command or
the AI's shell names a program or Git setting it would hand the token to (such
as `-c credential.helper=...`, `--upload-pack`, `--exec-path`, `--config-env` or
`GIT_SSH_COMMAND`), when the repository's own Git config sets one it would
run (a filter, merge or diff program for a `pull` or a `gh` command, which
check out and compare files, or a setting that turns off checking GitHub's
certificate for any of them), and for `gh auth`, `gh alias`, `gh extension`,
`gh config`, `gh codespace` or a gh command that is not one of gh's own. The AI
then leaves the option out or tries again once the setting is gone; it asks you
before removing a setting it did not add.

**Save**, **Update this session (rebase)** and the checks that show whether
the session is behind reach GitHub the same way: their Git runs none of the
repository's hooks, reaches GitHub only over HTTPS, uses only Vibe64's own
credential and signs no commits. When the repository's own Git config sets a
filter, merge or diff program or turns off checking GitHub's certificate,
Save and Update stop before reaching GitHub and name the setting, its file and
the `git config ... --unset-all` command that removes it; remove it, or ask
Colleague or the session's AI to, then try again.

Every other Git command of the AI, such as `commit`, `log`, `merge` or
`rebase`, runs without your sign-in and keeps the repository's hooks and
settings, as does a `fetch` or `push` that names a folder on this computer.
Your own and the computer's Git settings are left alone. Colleague can explain
such a refusal; the AI itself chooses what to run. The same applies on desktop
and mobile.

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

These controls are on the Save or Update notice in chat. If you dismissed it,
open the selected tab's info and choose **Show Update notice** (or **Show Save
notice**); the notice returns with its controls, and on phones chat is revealed.
Screen readers hear the same reason and next step in the tab's name, and the
**Save** button's hover text repeats it. The failure does not disable Save:
**Save** is unavailable only when the session has nothing to save, and its
hover text then says **No work to save**. A Save that finds nothing left to
save (another tab or the AI saved it first) shows **Nothing to save** as a
note, never a failure.

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
