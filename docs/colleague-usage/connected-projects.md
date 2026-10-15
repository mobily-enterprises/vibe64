# Configure connected projects

If a receiving repository's status cannot be checked, the ordinary Main Save
control remains available. Save checks access and state again and reports the
blocker without pushing the main project. An unavailable status does not count
as a merged contribution.

Open the intended project and session, then **Dashboard → Project settings →
Connected projects**. On phones, use **Show project** and **Dashboard section**
to reach Project settings. The list belongs to the displayed source checkout.

`vibe64.connections.json` is the only repository connection list. If it does not
exist, use **Add project**, then **Save connected projects** to create it. You can
also edit this tracked source file directly. Stack contains technology and generic
placement/treatment instructions, never repository identities or initial lists.
Opening Settings and preparing a workspace do not create or import this file.

For each entry, provide a **Name**, a **GitHub repository URL**, and a
**Relationship**: Dependency for a library or tool; Composition for source
assembled into this project. Use an HTTPS URL without credentials. The same
repository cannot appear twice under different names. More projects can be
added later, up to 64 entries within a 64 KiB file. Oversized saves preserve the
current list; shorten the entries before retrying.

**Package type** is separate from Relationship. Choose **Stack default** to
inherit the consuming Stack's package type; Node defines `npm`. Choose **npm**
or **custom** to override it for this connection. Stack default leaves `type`
out of the file, so a later Stack default change still applies.

For **custom**, provide **Preparation script (project-relative)**, for example
`tooling/prepare-native-worker.mjs`. The script lives in the consuming project;
use a relative path outside `.git`, without `..`, absolute paths or backslashes.
Stack declares the script runtime and runner, for example:

```markdown
- Custom runner with `nodejs` `cpp`: `node`
```

The existing preparer appends the absolute script path, then `--phase`
(`prepare` or `verify`), `--source-root`, `--project-root`, `--sources-file` and
`--repository` with their values. The script must remain inside the consuming
project; preparation rejects missing files and symlinks that escape that root.
An npm connection cannot have a script; choosing npm removes the script from
the draft. Stack default may retain a script for a custom default, and workspace
preparation checks the effective type before running anything. The script must
handle both phases: prepare makes the development artifact available; verify
checks that the consuming app uses the selected source and exits nonzero on
failure. Keep generated development artifacts ignored by Git and preserve
release manifests and lockfiles. Vibe64 provides execution and failure reporting;
it cannot infer what a custom artifact means or prove it from a zero-exit no-op.

Use **Save connected projects** to write the complete list to
`vibe64.connections.json` in the selected source. You must be the project owner
and have write access to each receiving repository through your connected GitHub
account. The file is ordinary project source and follows normal project Save.
Saving this configuration does not commit, push, merge or deploy source.

In the standalone editor, the local project owner can use these controls without
a hosted account. A connected GitHub account still supplies repository access.

**Remove** removes an entry from the draft. Saving that removal does not delete
existing contribution source, branches or pending work. An empty saved list
remains authoritative.

If another edit changed the file, saving refuses to overwrite it. Review your
draft, use **Reload saved list**, and reapply the intended edits. A malformed
file needs repair by a coding agent or through Files; it is never silently
replaced. Missing GitHub write access requires the correct
connected account or repository permission. After an uncertain save, refresh and
inspect the current list before retrying.

Colleague can read this list or save explicitly requested changes
through the same actions. It preserves unrelated entries and uses the read
source session and revision. A how-to question does not authorize changes.
Account login and repository permission grants remain human-controlled steps.

The current configuration controls declare the connections. Source preparation,
connected-first Save and Incoming changes are separate facilities; configuration
success alone does not establish that those sources are ready or used by Preview.
GitHub receiving projects expose [Incoming changes](incoming-changes.md) in
Dashboard. This view reconstructs contributions from Git, independently of the
originating project's connection list.

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
exact revisions before publishing. If one is still pending, the error names the
receiving repository, contribution, revision and integration branch. Open that
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

Development consumption belongs to the project's Stack declarations. Those
declarations must identify the connected source, where the task exposes it, how
the selected toolchain builds/uses it, and how to verify that selection. This
applies to mixed-language connections too: a Node application can use a connected
C executable or library. Choose **custom** for that connection's **Package type**. Package type is
independent of programming language and relationship. **Stack default** omits
`type` in the repository file; Node projects declare `npm` as their default.
The prepared source map records the effective type. npm treatment requires a
Node package manifest and excludes custom entries even if they contain one.
Custom sources remain available to the project's build and execution commands. For a C program those commands must build it, expose its development
executable or library to the app, and verify the app uses that build. It need
not appear in `node_modules`. A cloned repository alone does not establish that
Preview or tests use its changes.
Use the existing **Prepare workspace** action (or its **Retry** action after a
failure). When Stack declares `Connected development`, preparation creates or
reuses the task's authorized contribution sources, writes the declared source
map, runs ordinary Workspace setup, then runs the connected Prepare and Verify
commands in order. Success requires those commands to succeed. The preparation
identity includes both recipes and the exact task source selection; changing
that selection requires preparation again. Access is rechecked before each
command and when checking whether preparation remains current.

The initial consumption proof covers Node.js packages through `node_modules`:
two tasks use distinct sources, source edits reach only the intended task, and
an ordinary release installation retains its published dependency. PHP, Python,
Ruby, C/C++, C#, Go, Java, Kotlin, Rust and framework-specific consumption still
need their own commands and end-to-end proof. Installed language runtimes alone
do not establish connected-source support. A declaration alone does not prove
that Preview or tests consume the dependency.

For API clients, the explicit **Prepare connected sources** operation is
`POST /api/app/:slug/vibe64/sessions/:sessionId/connected/prepare`. It uses the
session's configured list and requires access to each registered receiving
project plus GitHub write access. The returned `prepared` entries identify the
receiving project/session and report source readiness and workspace setup.
Once every receiving source is ready, the operation writes the Stack's
`Sources file` and returns `development.status: "inputs-prepared"`. The JSON
file uses contract `vibe64.connected-sources.v1` and identifies the originating
session and each connected repository's exact source path and contribution ID.
Vibe64 excludes this generated file from Git locally; the portable connection
list remains unchanged. The consuming project's commands can read this map,
and **Prepare workspace** executes and verifies the complete recipe. This explicit
API operation only prepares inputs; `inputs-prepared` does not mean its commands
have run.

The source-map location must be a development-only, project-relative file.
Vibe64 refuses to overwrite tracked files, symbolic links, unrelated content or
another session's map. If this check fails, preserve the file, choose another
`Sources file` location in Stack and retry. A missing or invalid Connected
development declaration also requires correcting Stack before retrying; the
already-created receiving sources remain available.
An internal readiness check can recheck receiving access and compare the map
with the task's saved bindings without changing files. The workspace runner uses that check before running
commands and before accepting cached preparation. `inputs-prepared` still does
not mean the Stack's development commands have run.
After failure or a lost response, retry the same originating session: its saved
reservation prevents duplicate source creation. A failure retains the earlier
`prepared` entries and identifies the receiving repository that failed. If an
entry reports `sourceReady: false`, open that receiving session and use its
source recovery controls before retrying; preparation does not replace the
failed checkout with a fresh one. Missing registration requires
setting up the receiving project first; mismatched saved authority requires
inspection and reconciliation. Use the existing workspace preparation controls for the full recipe. Colleague
can explain the process and offer supported preparation actions; it must not
claim successful preparation from a declaration or an input-map response alone.
