# Prepare a session after updating its source

**Workspace preparation required** means the session needs its declared setup
steps run against the updated source. It is a neutral notice, not a failed run.
For a Node project this can include installing dependencies, but the actual
steps come from the project's setup contract.

Select **Prepare workspace**. The notice shows progress while those steps run.
Use **Expand** to inspect output, or **Dismiss** to hide an inactive notice.
Preparation does not publish the project.

To rerun preparation after success, select **Prepare workspace** (the wrench)
in the session header. On narrow screens, open **Session actions** (three dots)
and select **Prepare workspace**. This stays available after dismissing the
preparation notice. It runs the complete current recipe, including declared
database steps and connected-source Prepare/Verify commands. It is unavailable
while another assistant or repository operation is active, or for archived sessions.

A new session with connected projects starts preparation automatically. Its
first step, **Preparing connected projects**, creates or reuses each connected
project's contribution session at the same time and lists the ones still in
progress, then **Linking connected sources** and **Checking connected sources**
while it rechecks access to each one. If one fails, the notice names that repository; earlier prepared
sources are kept and **Retry** reuses them instead of copying them again.

A successful result records the previous recipe execution. It does not prove
that custom compiled outputs still match later source or script edits. Rerun
preparation explicitly after those edits when the project needs rebuilt outputs;
Vibe64 does not automatically rebuild custom connections.

An actual failed command or failure to start preparation still displays an error
and its diagnostic. Use the available retry or **Fix it with AI** action to deal
with that failure; do not assume a required preparation step has already failed.

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

After the declaration is repaired, select **Recheck setup**. If workspace
preparation is still required, **Prepare workspace** or **Retry** runs the
declared recipe; inspect it before rerunning database or installation steps.
The same recovery applies on desktop and mobile. Colleague can explain the
warning and offer the supported repair flow; source edits and terminal commands
belong to the coding assistant or the person, not Colleague.

## Locally installed command-line tools

When you open a directory with the local Vibe64 editor, start Vibe64 from the
terminal where your coding tools already work. The editor uses that terminal's
`PATH` for commands run as your own user, so tools installed in personal
locations, such as OpenCode, remain available to assistants and Preview.

If an assistant reports that its command cannot be found, check that the command
works in that terminal, then restart the local editor after correcting the
installation or shell path. Hosted workspaces use their host's prepared tools.
Colleague can explain this recovery; installing a local tool and restarting the
local editor require the person to use their terminal.


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
