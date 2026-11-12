# Prepare a session after updating its source

**Workspace preparation required** means the session needs its declared setup
steps run against the updated source. It is a neutral notice, not a failed run.
For a Node project this can include installing dependencies, but the actual
steps come from the project's setup contract.

It also appears, once, when the session's installed packages lack an Agent
Skill its Genesis needs; the chat explains which. If preparing the workspace
installs the same older packages again, select **Update this session** to take
the project's newer ones; Vibe64 does not ask for preparation again for the same
missing skill.

Select **Prepare workspace**. The notice shows progress while those steps run.
Use **Expand** to inspect output, or **Dismiss** to hide an inactive notice.
Preparation does not save or push the project.

When preparation succeeds while the session's Preview is running, after Update
or any other run, Vibe64 restarts the Preview by itself so the app uses what the
steps installed. A stopped Preview stays stopped, and a failed preparation does
not restart it.

To rerun preparation after success, select **Prepare workspace** (the wrench)
in the session header. It is the first header action to move into **Session
actions** (three dots) when the chat is narrow; select it there instead. This stays available after dismissing the
preparation notice. It runs the complete current recipe, including declared
database steps and connected-source Prepare/Verify commands. It is unavailable
while another assistant or repository operation is active, or for archived sessions.

A new session with connected repositories starts preparation automatically. Its
first step, **Preparing connected repositories**, makes this session's missing
copies of them, one output line per repository, then **Checking connected
repositories** checks them. It never fetches or replaces a copy it already has.
It copies with the session's GitHub account, also when it starts on its own
after Update, an AI turn or a Preview start. A session with no GitHub account
yet, whose preparation nobody started, shows **Workspace preparation required**
with `Select Prepare workspace to copy this session's connected repositories
with your GitHub account.` instead of a failure; **Prepare workspace** then
copies them with yours.
If one fails, the notice reads **Prepare connected repositories** with the
reason, and the output keeps it; copies already made are kept and **Retry** does
not copy them again. Each retry starts its own lines in the output, so an earlier
failure is never shown as its progress. See
[Work in connected repositories](connected-repositories.md#prepare-workspace-makes-the-missing-copies).

A successful result records the previous recipe execution. It does not prove
that custom compiled outputs still match later source or script edits. Rerun
preparation explicitly after those edits when the project needs rebuilt outputs;
Vibe64 does not automatically rebuild custom connections.

An actual failed command or failure to start preparation still displays an error
and its diagnostic. Use the available retry or **Fix it with AI** action to deal
with that failure; do not assume a required preparation step has already failed.
**Fix it with AI** opens the [AI task window](ai-tasks.md): the AI repairs the
workspace, then Vibe64 runs preparation itself and the fix is **Done** only when
it succeeds. A failure goes back to the same conversation. Cancelling the fix
while that preparation runs stops its running step; the card then reports the
preparation as cancelled, and the next preparation runs every step again.

## Preparation runs once per source

A successful preparation remembers the exact source it prepared: the session's
commit and uncommitted changes, each connected repository's commit and
uncommitted changes, and the setup recipe (files Git ignores, such as installed
dependencies, are not part of it). After **Update this session**, preparation
runs only when one of these differs from what the last successful preparation
prepared. An Update that brought nothing in, or whose changes were undone, says
`This source is already prepared, so no step runs again.` in the preparation
output and runs no step. A failed or cancelled preparation is never remembered,
so the next one runs every step. **Prepare workspace** and **Retry** always run
every step. A session prepared before this behaviour runs its steps after its
next Update, as before, and is remembered from then on.

When the source did change, a step that names the files it reads runs only when
those files changed since it last succeeded. In `genesis/stack.md` such a step
lists them after `from`, for example
``- Prepare `Install dependencies` from `package.json` `package-lock.json` with `nodejs`: `npm` `ci` ``.
After an Update that changed only documentation, that step adds
`[Install dependencies] Skipped: what it reads and runs is unchanged since it last succeeded.`
to the preparation output and installs nothing. A changed file it names, a
changed command, new or recreated databases, or a failure of that step the last
time runs it again. A step without `from` runs every time, as before. Genesis's
Stack technologies propose `from` for their install and database steps; a
project's existing `genesis/stack.md` keeps its steps as written until the
project's coding assistant or the person adds it. To run every step anyway,
select **Prepare workspace**. Colleague can explain a skipped step from the
preparation output; editing `genesis/stack.md` belongs to the coding assistant
or the person.

One preparation runs at a time in a session, whichever starts it. A Preview
start in another tab, or the end of an assistant turn, waits for the running
preparation instead of starting another; a session that is already prepared
starts its Preview without waiting for anything else.

**Update this session** started while preparation runs waits for it: Update's
progress says, for example,
`The workspace is being prepared (Install dependencies); waiting for it to finish.`
and continues by itself once preparation ends. An AI task's **Cancel** ends that
wait and leaves the session unchanged. If preparation is still running after 20
minutes, Update stops with
`The workspace is being prepared (Install dependencies). Try again when it finishes.`

When another operation briefly holds the session, the refusal names it, for
example `The workspace is being prepared. Try again when it is ready.`,
`This session is being updated. Try again when Update finishes.` or
`This session is being saved. Try again when Save finishes.` Try again when that
operation ends; nothing has changed. Colleague can explain these messages and
the current preparation result; starting preparation again needs the person's
request.

## Retrying a failed setup

Only a successful setup is reused. A failed one is never treated as done:
starting Preview yourself (**Start preview**, or the assistant's
`vibe64-helper preview ensure`/`restart`) runs the complete declared setup again
once, and only a success lets Preview start. An automatic Preview start, the end
of an assistant turn or a source update do not rerun a failure on their own.
While setup has failed, the Preview pane shows its diagnostic with **Retry
setup**, which does the same; **Retry** on the failed preparation card and
**Prepare workspace** in the session header also rerun it. The coding assistant
can run `vibe64-helper session setup retry`; it returns once preparation starts,
and `vibe64-helper session status --json` reports the result.

A long failure keeps its opening lines and its end, joined by `[…]`; **Expand**
on the preparation card shows the whole output.

### Database migrations from another session

When the project uses **One database shared by this project** (Project
settings), every session prepares the same development database. If another
session has already applied migrations that this session's branch does not
contain yet, database preparation can fail with the migration tool's own
message, for example Knex's "The migration directory is corrupt, the following
files are missing: …". The database is not damaged: it is ahead of this branch.
Update the session's branch (for example, bring in the main branch that holds
those migrations), then retry setup. A database per session avoids this.

Colleague can explain the notice and, when explicitly asked, use the session's
authorized workspace-preparation operation. It should inspect the current
result before saying preparation succeeded.

## Missing project-owned Stack sections

**Project setup needs attention** can report a missing section such as
`## Connected development` after the installed Stack catalog changes. This is
a declaration problem; repeatedly retrying dependency installation will not
repair it.

For an older Genesis project format, follow the diagnostic's `genesis migrate`
instruction first. If the missing-section diagnostic remains after migration,
explicitly reconcile the selected component as described below. A format upgrade
does not necessarily add newer catalog proposals, and migration on a
current-format project does not add them. Use **Fix it with AI** or ask your
coding assistant to inspect
`genesis/stack.md` and reconcile the missing section with the actual application.
If `nodejs` is already listed under **Components**, the existing explicit repair
is `genesis stack add nodejs`. Use the project's installed Genesis command
(`npm exec --no -- genesis stack add nodejs` when it declares `genesis-compiler`).
Do not select Node or another technology merely to dismiss a warning.

The command preserves existing complete project sections and adds missing
proposals. Review its returned preparation instructions and the source diff;
keep the application's real setup, launch and database commands. Node's default
`Connected development` declaration selects `npm` treatment only; it adds no
connected repositories and performs no dependency installation by itself.

Vibe64 also checks setup again each time you choose **Preview** (on a phone,
**Go to preview**), so the warning always shows the current setup, even after a
quick trip to the Dashboard and back.

After a manual repair, select **Recheck setup**; a **Fix it with AI** task on the
warning rechecks setup itself and is **Done** only once it no longer needs
attention (see [AI tasks](ai-tasks.md)). If workspace
preparation is still required, **Prepare workspace** or **Retry** runs the
declared recipe; inspect it before rerunning database or installation steps.
The same recovery applies on desktop and mobile. Colleague can explain the
warning and offer the supported repair flow; source edits and terminal commands
belong to the coding assistant or the person, not Colleague.

## Project setup waits for Update

When the session's Update has failed, is running or is waiting (the session is
behind its saved version), **Project setup needs attention** shows why, for
example *This session's Update needs repair first*. It does not offer
**Fix it with AI** for setup, and workspace preparation's **Fix it with AI** is
unavailable. Setup is often blocked only by local work that the saved version
already supersedes, such as a partial dependency bump, and repairing it here
would redo that work.

Bring the session up to date first: choose **Update**, or **Fix it with AI** on
the Update notice when Update needs help. When the repair finishes, Vibe64 checks Update
again. When Update succeeds, Vibe64 prepares the workspace again and
rechecks setup. Setup repair is offered again only if setup still needs
attention. Colleague's onboarding read reports the same `updateFirst` state and
offers no setup repair while it is present.

## Competing Stack proposals

When two selected technologies propose different bodies for the same section,
for example Node and Python both proposing `## Connected development`, Genesis
leaves that heading unwritten and reports `STACK_SECTION_AMBIGUOUS` until the
project chooses. **Project setup needs attention** shows Genesis's message,
which quotes each proposal; workspace preparation shows **Workspace setup needs
a choice** with the same text. Vibe64 never picks a proposal for you, and
retrying preparation alone does not resolve it.

Chat stays available: use **Fix it with AI** or ask your coding assistant to
author one complete project-owned section in `genesis/stack.md` that fits the
application (a multi-language project chooses one `Default package type`).
Then select **Recheck setup** and **Prepare workspace** or **Retry**. Skill
refresh waits until the section is decided. Colleague can explain the choice;
the source edit belongs to the coding assistant or the person.

## Locally installed command-line tools

When you open a directory with the local Vibe64 editor, start Vibe64 from the
terminal where your coding tools already work. The editor uses that terminal's
`PATH` for commands run as your own user, so tools installed in personal
locations, such as OpenCode, remain available to assistants and Preview.

If an assistant reports that its command cannot be found, check that the command
works in that terminal, then restart the local editor after correcting the
installation or shell path.
Colleague can explain this recovery; installing a local tool and restarting the
local editor require the person to use their terminal.


## A tool the step needs

When a step fails because a program it runs isn't installed, the failed step
says so in one sentence ("Vibe64 couldn't find bundle on this computer, so this
step couldn't run.") and **This step needs a tool that isn't working** lists the
missing runtime with its install command, **Check again** and **Other ways**.
A long failure (a stack trace) shows as three lines; **Expand** shows all of it.
The database server panel below waits until no tool is missing, so there is one
thing to fix at a time.

## A database server you run

When the project's Stack declares a MySQL/MariaDB or PostgreSQL database and
this computer supplies none itself, the person runs that server: one they
already have, or one they install. After a preparation step fails, a
**database server** panel appears under the failed step. It says whether
Vibe64 could sign in, in one sentence: nothing answering at the host and port,
a wrong user or password, a user that can only sign in from the computer's
administrator account (such as `root` on a fresh MariaDB, or `postgres`), a
missing database, or no access to it.

The panel's fields are the project's Env values under the exact names the
Stack declares (for example `DB_HOST`, `DB_PORT`, `DB_NAME` or `DB_DATABASE`,
`DB_USER` or `DB_USERNAME`, `DB_PASSWORD`). **Save and check** saves them in
Env and signs in for real with the drivers Vibe64 bundles; **Check again**
repeats the sign-in. A saved password is never shown or sent back; an empty
password field keeps it. Env values always win over the Stack's defaults, and a
variable exported in the shell that started Vibe64 does not count.

**Install or start** shows the command for this computer (Debian, Ubuntu and
WSL, or macOS with Homebrew); its link opens the Databases step of the setup
guide, which also has the Fedora and Arch lines ([Linux](set-up-linux.md#databases),
[macOS](set-up-macos.md#databases)). **Create a login and
database** shows one command that creates a project user, its database and,
for PostgreSQL, the right to create test databases. **Suggest a user and
password** fills in a project user and a strong password first; the command
shows the password as dots but copies the real one. The person runs these
commands in their own terminal; Vibe64 never starts a database server or runs
them. While nothing answers, the panel leads with **Install or start** and
folds the settings into one line, "Looking for it at host:port · database ·
user", with **Change** to edit them. When the panel says connected, choose
**Finish preparing** on it (or **Retry** on the failed step).

Colleague can explain the panel and each message. When asked, it can check the
server again with the current values and save the non-secret ones the person
gives (host, port, database name, user name) in Env. It must not ask for,
repeat or save a password, and it never runs `sudo` or creates databases
itself; the password goes in the panel's password field.

## Resource recovery after a daemon restart

When the host supports database preservation checks, reopening a previously
prepared session can restore its managed environment without repeating unchanged
Workspace setup commands. Vibe64 requires the same successful recipe and resource
identity, and the host must verify that its databases already existed. Recreated,
changed or unverified resources run the full recipe, including application database
initialization. An older successful setup without that identity runs once to
establish it; existing session metadata is not guessed or rewritten on opening.

**Retry** still runs the declared setup again. If resource recovery fails, inspect
the preparation error before retrying. Colleague can inspect that result and retry
when asked; it should not call an unchanged setup successful merely because saved
database connection settings exist. The controls are the same on desktop and mobile.

If someone manually drops and recreates a database under the same name outside
Vibe64's preparation, use **Retry** to rerun the application's setup. Preservation
checks cover Vibe64's own provisioning; they do not inspect or reconstruct an
application schema changed outside that operation.
