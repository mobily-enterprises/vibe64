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

If a branch or target changed since Review, refresh and review again. Conflicts
leave the remote target unchanged: ask a coding agent to resolve them in the
contribution source, publish the revision, then review it again. After an
uncertain response, **Refresh** inspects Git before another action is enabled.
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

This receiving view currently supports configured GitHub projects. Local-folder
receiving-target resolution and automatic originating-project contribution
preparation remain separate implementation work.
