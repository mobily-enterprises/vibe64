# When Save, Update or the plan goes wrong

When Save, Update, Fix it with AI or the plan cannot do what you asked, Vibe64
says what happened and what to do next, in words. This guide shows where to read
it and what each answer means. It is written for you and for the session's AI,
which reads the same answers.

## Where Vibe64 says what happened

- **The Save or Update notice in chat.** Its line says what went wrong, for
  example *1 file needs review before this session can update: index.html*, and
  its buttons are the ways out: **Fix it with AI**, **Review resolved
  conflicts**, **Create draft PR** or **Retry**, whichever can help.
- **The session's tab.** A circled **!** reads **Repository needs help**: hover
  it, or click or tap it to open the tab's info, and **Why** and **Next** say
  what failed and what to do. A working icon reads **Saving work**,
  **Updating session** or **Being fixed with AI**: something is already working
  on it, so wait.
- **A dimmed Save.** Save or Update cannot act right now. Tap or click it and
  the reason shows beside it, for example *Fix Update is still running. Wait for
  it to finish first.* or *Waiting for the assistant to reconnect before saving
  or updating*. The notice's **Review resolved conflicts** and **Create draft
  PR** wait for the same reasons and show theirs beside them.
- **The session's AI** reads the same state with `vibe64-helper session status
  --json`, under `repository`.

## Save

- **Nothing to save** (a note) is not a failure. The work was already saved,
  by another tab or by the session's AI, or the change was undone. There is
  nothing to do.
- **Main has newer saved versions**, for example *Main has 1 newer saved
  version (8:11 AM, from the Passes session, 2 files)*: choose **Update this
  session (rebase)**, which keeps your unsaved work, then Save. There is
  nothing to merge.
- **A pull request is required**: choose **Create draft PR**, or **Fix it with AI**.
- **History diverged**: choose **Fix it with AI**. Retrying alone cannot succeed.
- **Anything else**, such as a rejected push or an unavailable repository: fix
  the cause the message names (access, connection, the repository), then Save
  again, or choose **Fix it with AI**.

## Update

- **Files need review** (a conflict): resolve the listed files yourself, in Main
  chat or with **Fix it with AI**, then choose **Review resolved conflicts** on
  the Update notice. Update keeps the session's unsaved work.
- **A connected repository could not be updated**: its own line says why. The
  others were updated; repair that copy as you would the session's own.

## Fix it with AI

**Fix it with AI** opens a window where the AI repairs what stops Save or
Update, then Vibe64 runs Save or Update itself. While the fix works, the tab
reads **Being fixed with AI** and Save and Update wait for it. If the fix needs
a decision from you, the window asks; when it ends, **See result** shows what
happened. See [Fix a problem with AI in the AI task window](ai-tasks.md).

## Retrying is safe

- Save and Update carry on at the server once they start. Closing the page or
  losing the connection does not stop them; the notice shows the outcome when
  you come back. A second press, from another tab too, follows the running one
  instead of starting another.
- Read the reason before retrying: a conflict or diverged history fails the same
  way every time until it is repaired.
- Do not push, rebase or reset with Git by hand while Save or Update runs. A
  repair you or the AI made with Git counts at the next check: after the AI's
  next turn, a refresh, or **Check for updates** on Save.

## The plan

A plan file Vibe64 cannot use (another account's, one whose permissions changed,
or one that no longer matches its saved content) never stops the plan. **History**
names each such file and what is wrong with it, above the plans it still lists,
and the current plan keeps working. Someone who administers the computer gives
the file back to the account Vibe64 runs as, or restores it from a backup; it
then reappears. See [View a plan and its history](plans.md).

## For the session's AI

- Read `vibe64-helper session status --json` before acting, and tell the person
  Vibe64's own reason rather than a guess.
- `vibe64-helper session save` and `vibe64-helper session update` refuse with
  Save's or Update's own reason and change nothing. Follow it: when Update is
  needed first, update and save again; with nothing to save, say so plainly.
- Never retry blindly, force-push, or delete plan files. When the next step is
  the person's (a pull request, a permission, a decision), say which control to
  use and stop.

Your Vibe64 host may add its own guides for its actions, such as publishing to
Staging, deploying to Production or signing in.
