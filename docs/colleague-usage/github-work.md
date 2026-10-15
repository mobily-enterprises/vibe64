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

If a push loses its response, Vibe64 checks the exact prepared commit on the
remote before treating it as failed. If the remote cannot be read, restore access
and inspect the session's work again. Recovery uses the original Save operation
and Git evidence, including after an editor restart, without another push. A
failed local update after publication uses the same recovery. If Git confirms
that nothing was published, the original rejection remains visible or an
uncertain attempt becomes explicitly retryable. Colleague can inspect work and
explain that result; a new Save still requires your instruction.

Save and Update can take time. Existing temporary chats remain readable, and
plain text typed in an existing chat is saved without waiting for the source
operation. A new assistant send or change to its model or attachments waits
until that operation finishes. If the Update request loses its response, inspect
the current Update operation in this session before starting another one; a
disconnected browser does not prove that Update failed or succeeded.

Use **Dismiss** to hide an inactive Save or Update notice. This browser remembers
each dismissed operation in that project and session, including after reload or
dismissing another notice. A new failed attempt still appears. Dismiss changes
only the notice; it does not resolve a repository failure or stop active work.
On phones, reveal chat to reach the notice and its controls.

## Apply an Update after resolving conflicts

If Update reports conflicting files, repair them manually, in Main chat, or with
**Fix it with AI**. Preserve the intended changes from both versions. Wait for
coding work to finish, then:

1. Select **Review resolved conflicts** on the Update error. If an Update repair
   chat is open, the same control appears beside **Check Update** in its repair
   status area.
2. Review every file listed in **Apply resolved Update**. Select **Cancel** if
   further repair is needed; cancelling leaves the files unchanged.
3. Select **I've resolved these conflicts — apply Update** to acknowledge the
   repair and run Update. This works even when no repair chat exists or its AI
   was stopped or failed. It does not Save, push or publish the work.

On phones, reveal chat to reach the Update error or repair tab; the file review
and confirmation are the same as on desktop. The controls wait while an assistant
or repository operation is busy. A changed conflict invalidates an open review.
If Update refuses a stale review or finds remaining conflicts, inspect the new
diagnostic, finish the repair and review again. This manual action does not send
another AI request. Successful Update may still require workspace preparation;
its result does not establish that application tests passed.

**Check Update** is a plain retry, not an acknowledgement that conflicting files
are resolved. A completed **Fix it with AI** repair still submits its recorded
review automatically, subject to the same repository checks.

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

Creating a pull request uses the same connected-work checks as Main Save. Save
connected work first, merge its submitted revisions in the receiving projects,
and Update those connected sessions to the accepted source before creating the
pull request. Changed source or revoked receiving access stops publication;
creating a pull request does not bypass those checks.

Colleague can explain these workflows, open their views, inspect bounded saved-work
status, request native Save/Update, and use supported issue/PR actions when asked.
It delegates code/diff investigation to a coding agent rather than reading the
repository itself. Tell it the intended branch, issue or PR when ambiguous. A
question such as “How do I create a PR?” makes no commit, push or external write.
An accepted offer or direct request still needs any unresolved inputs and the
native review/permission rules. Its report must distinguish requested, saved,
published and unknown outcomes, and disclose unverified external results.
