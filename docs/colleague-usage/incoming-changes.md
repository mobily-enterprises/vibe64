# Review incoming contributions

Open the receiving GitHub project and choose **Dashboard → Incoming changes**.
On a phone, choose **Show project**, then **Dashboard section → Incoming changes**.
Select or create a working session if asked; its checkout supplies Git storage,
while the queue and integration target belong to the project and are shared by
all its sessions. The menu badge counts pending contributions when a read succeeds.

The default **Contribution state** is **Pending**. Use **Merged**, **Discarded**,
**Unresolved**, or **All** to inspect other outcomes. **Previous page** and **Next
page** keep large lists manageable. Only branches named
`vibe64-incoming/<contribution-id>` and their `_discarded` counterparts appear;
ordinary feature branches are not submissions. No separate queue needs copying
to another machine.

Choose **Review** beside a contribution. It shows the commit title, changed-file
count, exact contribution and target commits, and a bounded diff. A truncated
diff is labelled; ask a coding agent to inspect the complete change before
integration. **Back** returns to your preceding project page, with Dashboard as
the direct-entry fallback. **All incoming changes** returns to the retained list
filter and page.

**Merge into <target>** opens a confirmation for the reviewed commit. **Merge
contribution** integrates it by fast-forward or an ordinary merge commit, keeping
its ancestry and contribution branch. It does not update session files or save
unsaved work. Use the ordinary session Update workflow to consume accepted work.
The contribution then appears under Merged.

**Discard contribution** asks for confirmation, then renames the branch with
`_discarded` appended. Commits, author checkout and unsaved work remain. Discard
does not satisfy a dependency or unblock its originating project's Save.

Your current GitHub account must have write access to the receiving repository.
Archived or disabled repositories refuse mutations. A project configured to
require pull requests refuses direct Incoming merges; GitHub's own protections
also apply. Colleague must report the constraint, not change that policy merely
to make Merge succeed.

If a branch or target changed since Review, refresh and review again. Vibe64
rebuilds generated Genesis maps from the proposed merged source; generated-only
conflicts do not need AI or manual edits. Authored conflicts
leave the remote target and receiving session files unchanged. Vibe64 retains a
private checkpoint of that session's complete work before offering **Fix it with
AI**. The existing Temporary AI chat starts with Senior in this receiving session;
its Senior model and account must be available. It uses the working session
currently selected in the receiving project and receives the exact reviewed
commits and conflicting paths. It repairs those
working files without committing, rebasing or publishing. You can also repair
them manually. Preserve unrelated work and inspect both sides' intended behavior.

When repair finishes, return to **Incoming changes → Review resolved conflicts**.
This displays the proposed merge using the repaired conflicting files and the
ordinary merge result for every other authored file, with regenerated Genesis
maps included in the diff. Do not hand-edit generated maps. If regeneration
fails, the merge stops without publishing or changing your session files.
Unrelated local changes are excluded.
Review that diff, then explicitly choose **Merge into <target> → Merge contribution**.
Vibe64 rechecks the candidate, receiving worktree/index/HEAD and both remote heads.
Changed inputs require another review. AI completion alone never publishes or
proves a merge. The merge preserves both parents; local files, staged changes and
the contribution branch remain available. Use ordinary Update to reconcile the
receiving session afterwards.

Temporary chat and private checkpoints retain their existing recovery lifecycle.
Reloading clears the transient merge review: refresh, try Merge to rediscover any
remaining conflict, then review the resolved files again. This does not restart
AI or discard its edits. After an uncertain response, **Refresh** inspects Git before another action is enabled.
An unavailable remote or incomplete history is an error, not proof of merging.

An interrupted discard can leave both branches. The default view points to
**Review interrupted discards**. Under Unresolved, **Finish discard** is available
only when both branches still identify the same commit. Different heads require
a coding agent's inspection; do not erase one to clear the warning. A discarded
commit already contained in the integration target still counts as merged.

Colleague can list and inspect bounded contribution summaries and perform an
explicitly requested Merge or Discard through these same authorized actions.
It receives exact review identities but no source contents or diffs. A how-to
question does not authorize a mutation; code review and conflict resolution
belong to a coding agent. GitHub login and permission grants remain human steps.

This receiving view supports configured GitHub projects. The originating task's
ordinary workspace preparation prepares its configured connected sources through
the existing receiving-project permissions and Stack recipe. See
[Connected projects](connected-projects.md) for that setup and Save flow.
Local-folder repositories do not provide this GitHub Incoming queue.


To revise a discarded contribution, return to its originating session and use
Save's **Review replacement contribution** recovery control. Confirm the exact
revision to prepare a new contribution, then open that replacement session.
The old branch and checkout remain; unsaved old edits are not copied silently.
See [connected-project replacement and retry](connected-projects.md) for the
preparation, submission and acceptance steps. Discard never unblocks Main Save.
