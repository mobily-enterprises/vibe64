# Connected contributions and saving

This continues [Configure connected projects](connected-projects.md): how prepared sources become contributions, how they are saved, revised and integrated.

Preparing a connected source records the creating user's Git identity for that
receiving session. You can inspect and save its contribution without first
opening an AI conversation there. GitHub access is still checked when used.

A connected session takes the name of the session it was prepared for: that
session's name, or its date when it has none yet. When the originating session
is renamed, its connected sessions follow at the next workspace preparation. If
you rename a connected session yourself, it keeps your name.

Allocating a connected contribution creates its receiving checkout without
automatically preparing that receiving project's own connections. The originating
project's Stack recipe prepares its directly connected sources. This prevents
automatic chains and cycles of extra contribution checkouts. A receiving session
can still be prepared separately when you deliberately work in that project.
If project A connects to B and B connects to A, preparing B's contribution creates
a new A contribution; it does not attach the original A session. Each preparation
owns its child contributions, and retry reuses those children. You cannot use
these controls to make two existing contributions wait for each other. Split a
shared library change from its consumer adaptation when they need separate
acceptance steps.

A connected contribution session saves to its own receiving-repository branch,
shown in the normal Save destination review. Its first Save creates that branch;
later Saves update the same contribution. The receiving project's main branch
is unchanged. Contribution submission does not require creating a pull request,
but the receiving repository's branch permissions still apply.

If the contribution was discarded, further work needs a new contribution. If both
active and discarded branches exist, resolve the interrupted discard first. A
missing branch after a publication attempt needs its retained exact revision and
receiving history checked; its absence alone proves nothing. An integrated
revision remains accepted after its branch is discarded or deleted. Explicit
Update can consume the proven accepted source, but further contribution pushes
cannot recreate that removed branch. Keep the checkout and ask the coding agent
to inspect uncertain saved work. After a lost acknowledgement, existing Save recovery can reconcile a
publication when the remote confirms its exact prepared commit.

To revise a discarded, unmerged contribution, return to the originating session
and press Save. Its refusal offers **Review replacement contribution**. Review
the repository, integration target and exact discarded commit, then choose
**Create replacement contribution**. The same controls are available on phones.
This creates a new receiving session and contribution ID, selects it for this
originating task and updates the development source map. It does not push anything.
Use **Open replacement session** to revise that source.

The replacement starts at the discarded commit. The old checkout, including
unsaved edits, remains intact; copy any wanted unsaved edits into the replacement
explicitly. The discarded branch remains available in Incoming changes. Old
submitted revisions remain integration requirements, and the replacement retains
their ancestry. Removing a connection or creating a replacement does not unblock
Main Save by itself.

After editing, run **Prepare workspace** in the originating project and restart
Preview so it uses the replacement. Use **Save connected first** to submit the
revision, merge it through the receiving project's Incoming changes, and Update
the replacement session to the accepted target before Main Save. If creation's
response is lost, retry the same confirmation: it reuses the reserved replacement.
After reloading or closing that dialog, **Prepare workspace** also resumes the
saved reservation. A changed review, revoked access or unavailable source stops
preparation with an error and preserves both sources. Colleague can review and
create a replacement through the same actions after an explicit request; it
cannot silently discard or move unsaved edits.

When a session has recorded submitted contributions, its normal Save checks those
exact revisions before publishing, including when the main repository has no new
file changes. If one is still pending, the error names the receiving repository,
contribution, revision and integration branch. Once all are accepted and the
selected sources are reconciled, a clean main repository reports no work to save. Open that
receiving project's **Incoming changes**, review and merge the contribution, then
open its connected contribution session and use **Update this session (rebase)**
to incorporate the accepted receiving source before retrying Main Save. This
matters when merge conflict repairs changed the accepted code. Save never performs
that update automatically. Discarding it or removing its connection does not satisfy the check.
An access or incomplete-history error requires fixing that cause and retrying;
Vibe64 does not infer a merge from a missing branch or a similar diff.

After a receiving contribution session completes normal renewal, connected
preparation and Save use its confirmed successor while retaining the same
contribution branch and integration requirements. An unfinished, missing or
mismatched handover blocks access instead of falling back to archived source.
Complete or recover the renewal in the receiving project, then run **Prepare
workspace** and restart the originating Preview to consume the new source path.

Archiving the originating session does not archive its connected sessions or
delete their incoming branches. Each receiving session has its own lifecycle.
Use **Stop preview** when you only want to stop a dependency's running app; this
keeps its source available to the originating project.

Avoid archiving a receiving contribution while another session still needs its
checkout. Archive preserves its commits, changed files, untracked files and
connection metadata through the existing recovery archive, then removes the live
checkout. The originating project reports unavailable source; it does not select
a different session or silently use an npm package. Use normal renewal when you
want a fresh conversation that continues the same contribution. If already
archived, retain the archive and ask the administrator to recover its source
through the existing archive facilities before preparing the originating project
again. Colleague can explain the error; it cannot substitute another checkout or
clear the integration requirement to make Save succeed.

After integration, the contribution session's existing update check follows the
receiving integration branch. Its Save destination remains the reserved incoming
branch; later edits become another contribution there. Main Save requires the
accepted target in the connected source's history, so a newer receiving target
can require another explicit Update. Rerun the originating project's workspace
preparation when its connected outputs need rebuilding, then verify the app.

A newer submitted revision needs its own integration. Later unrelated work on
the contribution branch does not block a revision already merged. Colleague can
explain a Save refusal and offer the supported receiving action, but must obtain
an instruction to merge or discard.

For prepared sources, the chat Save button changes to a branch icon labelled **Save connected
first** when connected work needs submission. It remains available when the main
checkout has no changes. Its confirmation lists receiving repositories and
contribution branches. Choose **Push connected contributions** to publish those
changes; the main project's changes stay local. The same controls work on phones.
The result lists confirmed pushes, including those completed before a later
failure. Review them in each receiving project's **Incoming changes**.

Once connected work is submitted, the button returns to its ordinary Save
appearance. Pending integration does not disable it: clicking reports the
receiving contribution that must be merged. New connected edits restore **Save
connected first**. A main-project PR policy does not require a PR for submitting
these contribution branches.

Colleague and API clients use the existing
work inspection and Save actions. When inspection returns
`connectedSaveRequired: true`, review every `connectedReview` destination and
pass that list unchanged with the main `destinationReview` to Save.

This saves one connected repository at a time: commit, push, record its commit,
then continue. It never pushes the main project in that action. A failure reports
the completed repositories and the repository that failed. Inspect and retry:
completed repositories without new changes are skipped. If publication succeeded
but recording failed, retry records the confirmed receiving commit without
republishing it. These commit records identify required integration, not a
separate retry ledger. Files and existing receiving Save recovery remain available.
Each receiver is checked again when its turn arrives, so new edits made while
an earlier repository was saving are included in the next receiver's Save.
If a push loses its acknowledgement, the exact remote commit can confirm it.
If the remote is unavailable too, publication stays unknown: restore repository
access and inspect work again. Recovery checks the original prepared commit
without another push, including after restarting the editor. Main Save remains
blocked while that outcome is unknown.
The same recovery checks a failed local update after a push. When Git proves
the attempt did not publish, its original rejection remains visible. A receiving
project with its own connected work must satisfy its own Save checks; this action
does not recursively publish further repositories.
If preparation fails before any push is attempted, fix the reported cause and
retry; the contribution's files and recovery checkpoint remain. A missing branch
after an uncertain push is still unknown, so Vibe64 does not recreate it merely
because it is absent.

After connected work is saved, omit `connectedReview` for ordinary Main Save.
Pending integration is reported by the existing exact-revision gate. New connected
work or unreconciled publication blocks Main Save; inspect and save/recover the
receiving session first. Colleague must review these destinations and have an
explicit Save instruction before publishing.
Main Save checks those sources again after preparing its commit, immediately
before pushing. If a receiving worktree, HEAD, or recorded saved commit changed,
inspect connected work and save it before retrying. This is a final snapshot
check, not a lock across projects; avoid editing connected sources while Main
Save is publishing, because changes after the final read belong to later work.
