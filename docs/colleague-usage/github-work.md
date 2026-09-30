# Review, Save and work with GitHub

Source edits in a session, saving a project version and publishing an application
are separate operations. A different session has its own worktree. Check which
project, session and branch you are using before saving or creating a pull request.

Open **Changes** in Dashboard to inspect the work. Use the session's **Save**
control for its native review and save workflow. Managed Vibe64 Git saves a version;
GitHub workflows use your repository permissions and the project's direct-push or
pull-request policy. **Update this session (rebase)** reconciles newer saved project
work when offered; Save does not silently perform that update for you. A failed or
uncertain publication needs a state check before another request.

Use **Issues** or **Pull requests** in the project Dashboard for the repository's
records. Search or select the exact issue/PR before changing it or adding a comment.
External writes use the connected person's GitHub identity; missing sign-in or
repository access cannot be bypassed by using another workspace account.
On mobile, reveal the project and choose the corresponding **Dashboard section**.

Colleague can explain these workflows, open their views, inspect bounded saved-work
status, request native Save/Update, and use supported issue/PR actions when asked.
It delegates code/diff investigation to a coding agent rather than reading the
repository itself. Tell it the intended branch, issue or PR when ambiguous. A
question such as “How do I create a PR?” makes no commit, push or external write.
An accepted offer or direct request still needs any unresolved inputs and the
native review/permission rules. Its report must distinguish requested, saved,
published and unknown outcomes, and disclose unverified external results.
