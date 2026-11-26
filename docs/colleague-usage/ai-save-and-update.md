# Save and Update with the session's AI

Save and Update can run while the session's AI works. The session's AI also runs
Update itself before building on old code and, while **Automatically save
changes** is on, Main chat's AI saves each finished and checked stage itself.
This guide also says what the AI's Git does with your GitHub sign-in. The Save
and Update controls themselves are in [Review, Save and work with
GitHub](github-work.md).

During the five minutes before a host's planned restart, Save and Update are
paused for you and for the AI alike, and so are the AI's own Git commit, push
and rebase; the AI is told to wait. See [A planned restart of the
workspace](planned-restarts.md).

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

When the project's main has newer saved versions than the session, the session's AI runs Update
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
