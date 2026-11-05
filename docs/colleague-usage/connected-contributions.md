# Connected contributions and saving

This continues [Configure connected projects](connected-projects.md): how you choose each connected session, and how its contribution is saved, revised and integrated.

## Choose a connected session

Vibe64 never starts a session in a connected project on its own. It uses one of
that project's existing sessions, and what happens depends on how many are free
when a session has no usable link yet: on its first connection, after its linked
session was archived, and on **Retry**.

- **Exactly one free session, and it is untouched:** **Prepare workspace** links
  it by itself and carries on. The output says so, for example `[Connected] vibe64
  is now linked to Payments, its only free session, which has no work in it and is
  used as it stands.` That session is used exactly as it is, so if you want it on
  the latest main, open it and use **Update this session (rebase)** before
  preparing, or start a second session there so the choice is yours.
- **Exactly one free session with work in it:** preparation stops at **Workspace
  setup needs a choice** and says why, for example `Its only free session, Payments,
  was not linked by itself: it has unsaved changes.` You can still choose it, knowing
  that.
- **Two or more free sessions:** preparation stops the same way. The notice names
  each project that needs a session and offers its free sessions in **Session in**
  *project*, with the first free one already selected. Pick one and choose **Link
  session**. Once the last project has its session, the server carries preparation
  on by itself, even if you close the tab or the page reloads. If a restart interrupts
  that, opening the session again finishes it. Until then Preview stays unavailable.
- **No free session:** preparation stops the same way and creates nothing; see
  below.

Each connected project is settled on its own, so one can link by itself while
another waits for your choice.

A session is untouched when all of this holds, checked at the moment of linking:

- it has no commits beyond the main it started from;
- it has no unsaved work, not counting files its own setup generates;
- no AI turn, AI terminal, temporary chat or AI task is running in it, and no Save or
  Update either;
- it is not pinned and not closing.

If Vibe64 cannot finish this check, for example because it cannot read the session's
Git state, it treats the session as not untouched and asks you. Preparation also
asks instead of linking when this session has already submitted work to that
project, because the next session decides whether that work is in your Preview, and
when you confirmed a replacement there that has not finished. A renewal never
links by itself.

When preparation links again because an earlier link stopped working, the output
says why first, for example `[Connected] vibe64's earlier link no longer holds: Its
connected session Payments in example/vibe64 was archived on 2026-10-28.` Work in
the archived session does not move to the new one.

A session is free when it is open, its source is ready, it is not already linked
to a contribution, and it does not work on its own branch or pull request. When
this session is itself a contribution, a session that uses connected projects of
its own is not free either. Vibe64 checks all this again when you link, so a
session that changed in the meantime is refused with a message saying why and
leaves the list, for example **That session is no longer free. Choose again.**,
**That session is already linked to another contribution. Choose again.** or **That
session moved to another commit. Choose again.** If that happens to a session
preparation was linking by itself, it stops for your choice instead of failing.

When the project has no free session, the notice says so and creates nothing.
Choose **Open** *project*, start a session there, then come back and choose
**Retry**, which links that session when it is the only free one and untouched. A
project normally allows three open sessions, or one when its sessions share a
development database, and a linked session stays open until you archive it. If
**New session** is unavailable there, archive a session you no longer need first.

Linking keeps the session's commits, unsaved work and name. It also changes where
that session saves: from then on its Save goes to a contribution branch for review
in the receiving project's **Incoming changes**, not straight to its main branch.
It cannot be undone from the notice, so when the session has work in it, link it
only if you mean to use that work here. A working link is not changed from the
notice either. A linked session stays on the commit it started from until its contribution is pushed, so when you need
the project's latest commits, use **Update this session (rebase)** in that session
before linking it.

Linking records your Git identity for that receiving session, unless it already
has one, which it keeps. You can inspect and save its contribution without first opening an AI conversation there. GitHub
access is still checked when used.

Colleague can explain this choice and run **Retry** when you ask. A Retry it runs
never links a session by itself, not even an untouched one: linking cannot be
undone, so it stops for you to choose in the notice. A **Retry** you press yourself
follows the rules above.

## Renew a session that uses connected sessions

A renewed session keeps its links, and its new session stays hidden until the renewal
finishes, so nobody could choose for it. Confirming a renewal therefore checks every
link first. If one no longer holds, the confirmation is refused before anything
stops, naming the project and why, and the renewal stays open for review. Use
**Prepare workspace** in this session, choose in its notice, then confirm again.

If a link stops holding after you confirmed, the renewal fails with the same project
and reason, and a renewal never links a session by itself. Cancel it, choose in this
session's notice, then renew again.

## How connected sessions relate

Linking a session does not prepare that receiving project's own connections. The
originating project's Stack recipe prepares its directly connected sources. A
receiving session can still be prepared separately when you deliberately work in
that project, and it chooses its own connected sessions the same way. If project A
connects to B and B connects to A, the A session that uses B's session is not
offered back to it. You cannot use these controls to make two contributions wait
for each other. Split a shared library change from its consumer adaptation when
they need separate acceptance steps.

A connected contribution session saves to its own receiving-repository branch,
shown in the normal Save destination review. Its first Save creates that branch;
later Saves update the same contribution. The receiving project's main branch
is unchanged. Contribution submission does not require creating a pull request,
but the receiving repository's branch permissions still apply.

If the contribution was discarded, further work needs a new contribution. If both
active and discarded branches exist, resolve the interrupted discard first. A
missing branch after a push attempt needs its retained exact revision and
receiving history checked; its absence alone proves nothing. An integrated
revision remains accepted after its branch is discarded or deleted. Explicit
Update can consume the proven accepted source, but further contribution pushes
cannot recreate that removed branch. Keep the checkout and ask the coding agent
to inspect uncertain saved work. After a lost acknowledgement, existing Save recovery can reconcile a
push when the remote confirms its exact prepared commit.

To revise a discarded, unmerged contribution, return to the originating session
and press Save. Its refusal offers **Review replacement contribution**. Review
the repository, integration target and exact discarded commit, then choose
**Create replacement contribution**. The same controls are available on phones.
This creates a new receiving session and contribution ID, selects it for this
originating task and updates the development source map. It does not push anything.
It is the one time Vibe64 creates a connected session, because you confirmed it.
The new session starts without a name of its own, so it shows its session identity
until you rename it. Use **Open replacement session** to revise that source.

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
**Prepare workspace** never creates it for you: if the session was not created, it
stops at **Workspace setup needs a choice** and the notice offers **Start a new
session in** *project* **for the replacement** beside any free sessions. That button
is the only one here that creates a session, for the replacement you confirmed. A changed review, revoked access or
unavailable source stops with an error and preserves both sources. Colleague can review and
create a replacement through the same actions after an explicit request; it
cannot silently discard or move unsaved edits.

## Keeping connected repositories current

Each workspace preparation of the consuming session also brings every connected
checkout up to the latest commit of its integration branch. That happens when
the session is created, after **Update this session (rebase)** and on **Prepare
workspace**. A session with connected repositories also shows **Update connected
repositories** in its session actions menu (**⋮** on a phone or narrow window).
It runs the same preparation.

The update uses the receiving session's normal **Update this session (rebase)**,
which carries that checkout's own changes, including unsaved edits, onto the
branch's latest commit. A checkout is left as it is while its agent is working,
while a Save or Update runs in it, while its pushed contribution still awaits
acceptance, or when the update would conflict with its changes. The preparation
output shows one line per repository: `[Connected] jskit updated to abc1234.`,
`[Connected] genesis is up to date.`, or `[Connected] vibe64 was not updated:`
followed by the reason. A conflict is recorded in the receiving session for review;
open that session in the receiving project to resolve it. Preparation continues
either way, and an updated checkout is prepared again before the consuming
session links it. Choose **Update connected repositories** again once the cause
is resolved. Colleague can run this preparation for the session on request and
report each line; it does not resolve a skipped checkout's work.

Main Save and pull-request creation check each connected repository's branch
live. If a connected checkout is behind, they stop with `<repository> is behind
<branch> by N commits. Choose Update connected repositories, check your work,
then Save.` This keeps saved and deployed work tested against the current
connected sources.

When a session has recorded submitted contributions, its normal Save checks those
exact revisions before pushing, including when the main repository has no new
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
checkout. Use normal renewal when you want a fresh conversation that continues the
same contribution.

If it was archived anyway, the next **Prepare workspace** follows
[Choose a connected session](#choose-a-connected-session): it links the project's
only free session and says so, or stops at **Workspace setup needs a choice**,
saying which session was archived and when. It never silently uses an npm package,
and the archived work does not move to the new session. To carry on with that work
instead, retain the archive and
ask the administrator to recover its source through the existing archive
facilities. Colleague can explain the choice; it cannot substitute another
checkout or clear the integration requirement to make Save succeed.

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
contribution branches. Choose **Push connected contributions** to push those
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
completed repositories without new changes are skipped. If the push succeeded
but recording failed, retry records the confirmed receiving commit without
pushing it again. These commit records identify required integration, not a
separate retry ledger. Files and existing receiving Save recovery remain available.
Each receiver is checked again when its turn arrives, so new edits made while
an earlier repository was saving are included in the next receiver's Save.
If a push loses its acknowledgement, the exact remote commit can confirm it.
If the remote is unavailable too, the push outcome stays unknown: restore repository
access and inspect work again. Recovery checks the original prepared commit
without another push, including after restarting the editor. Main Save remains
blocked while that outcome is unknown.
The same recovery checks a failed local update after a push. When Git proves
the attempt did not push, its original rejection remains visible. A receiving
project with its own connected work must satisfy its own Save checks; this action
does not recursively save further repositories.
If preparation fails before any push is attempted, fix the reported cause and
retry; the contribution's files and recovery checkpoint remain. A missing branch
after an uncertain push is still unknown, so Vibe64 does not recreate it merely
because it is absent.

After connected work is saved, omit `connectedReview` for ordinary Main Save.
Pending integration is reported by the existing exact-revision gate. New connected
work or an unreconciled push blocks Main Save; inspect and save/recover the
receiving session first. Colleague must review these destinations and have an
explicit Save instruction before saving.
Main Save checks those sources again after preparing its commit, immediately
before pushing. If a receiving worktree, HEAD, or recorded saved commit changed,
inspect connected work and save it before retrying. This is a final snapshot
check, not a lock across projects; avoid editing connected sources while Main
Save is pushing, because changes after the final read belong to later work.
