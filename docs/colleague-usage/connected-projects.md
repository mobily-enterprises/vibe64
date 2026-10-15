# Configure connected projects

Open the intended project and session, then **Dashboard → Project settings →
Connected projects**. On phones, use **Show project** and **Dashboard section**
to reach Project settings. The list belongs to the displayed source checkout.

If no connection file exists, **Initialize from Stack** imports the initial
list declared by that project. An existing file, including an empty list, is
never replaced by initialization. Alternatively, use **Add project** to create
the list yourself.

Creating a working session or explicitly preparing its workspace also imports
the declared initial list when the file is absent. Projects without a Connected
projects Stack section are left unchanged. Passive checks and opening Settings
do not create a file. A failed import appears in workspace preparation; correct
the reported declaration or GitHub access problem and use **Retry**. Learning
workspace preparation does not import connected repositories.

For each entry, provide a **Name**, a **GitHub repository URL**, and a
**Relationship**: Dependency for a library or tool; Composition for source
assembled into this project. Use an HTTPS URL without credentials. The same
repository cannot appear twice under different names. More projects can be
added later, up to 64 entries.

Use **Save connected projects** to write the complete list to
`vibe64.connections.json` in the selected source. You must be the project owner
and have write access to each receiving repository through your connected GitHub
account. The file is ordinary project source and follows normal project Save.
Saving this configuration does not commit, push, merge or deploy source.

In the standalone editor, the local project owner can use these controls without
a hosted account. A connected GitHub account still supplies repository access.

**Remove** removes an entry from the draft. Saving that removal does not delete
existing contribution source, branches or pending work. An empty saved list
remains empty when initialization is requested again.

If another edit changed the file, saving refuses to overwrite it. Review your
draft, use **Reload saved list**, and reapply the intended edits. A malformed
file needs repair by a coding agent or through Files; initialization does not
hide the error by replacing it. Missing GitHub write access requires the correct
connected account or repository permission. After an uncertain save, refresh and
inspect the current list before retrying.

Colleague can read this list, initialize it or save explicitly requested changes
through the same actions. It preserves unrelated entries and uses the read
source session and revision. A how-to question does not authorize changes.
Account login and repository permission grants remain human-controlled steps.

The current configuration controls declare the connections. Source preparation,
connected-first Save and Incoming changes are separate facilities; configuration
success alone does not establish that those sources are ready or used by Preview.
GitHub receiving projects expose [Incoming changes](incoming-changes.md) in
Dashboard. This view reconstructs contributions from Git, independently of the
originating project's connection list.

A connected contribution session saves to its own receiving-repository branch,
shown in the normal Save destination review. Its first Save creates that branch;
later Saves update the same contribution. The receiving project's main branch
is unchanged. Contribution submission does not require creating a pull request,
but the receiving repository's branch permissions still apply.

If the contribution was discarded, further work needs a new contribution. If both
active and discarded branches exist, resolve the interrupted discard first. A
missing branch after a publication attempt is an unknown outcome: keep the
checkout and ask the coding agent to inspect its saved commit and receiving
history. After a lost acknowledgement, existing Save recovery can reconcile a
publication when the remote confirms its exact prepared commit.

When a session has recorded submitted contributions, its normal Save checks those
exact revisions before publishing. If one is still pending, the error names the
receiving repository, contribution, revision and integration branch. Open that
receiving project's **Incoming changes**, review and merge the contribution, then
retry Save. Discarding it or removing its connection does not satisfy the check.
An access or incomplete-history error requires fixing that cause and retrying;
Vibe64 does not infer a merge from a missing branch or a similar diff.

A newer submitted revision needs its own integration. Later unrelated work on
the contribution branch does not block a revision already merged. Colleague can
explain a Save refusal and offer the supported receiving action, but must obtain
an instruction to merge or discard. Automatic contribution preparation and
connected-first publication are still being implemented; declaring a connection
does not yet create these submitted-revision bindings.

Development consumption belongs to the project's Stack declarations. Those
declarations must identify the connected source, where the task exposes it, how
the selected toolchain builds/uses it, and how to verify that selection. This
applies to every supported stack, including compiled libraries. A cloned
repository alone does not establish that Preview or tests use its changes.
Automatic Stack-driven placement and consumption are not complete yet.
Vibe64 can inspect a `Connected development` declaration containing the source-map
location and preparation/verification commands. A valid declaration is not a
successful preparation result: the current preparation API still reports
checkout readiness only. Colleague must not describe a declaration as proof
that Preview or tests consume the selected dependency.

For API clients, the explicit **Prepare connected sources** operation is
`POST /api/app/:slug/vibe64/sessions/:sessionId/connected/prepare`. It uses the
session's configured list and requires access to each registered receiving
project plus GitHub write access. The returned `prepared` entries identify the
receiving project/session and report source readiness and workspace setup.
This operation creates isolated source through the receiving session owner;
it does not yet select that source for the consuming application's commands.
After failure or a lost response, retry the same originating session: its saved
reservation prevents duplicate source creation. A failure retains the earlier
`prepared` entries and identifies the receiving repository that failed. If an
entry reports `sourceReady: false`, open that receiving session and use its
source recovery controls before retrying; preparation does not replace the
failed checkout with a fresh one. Missing registration requires
setting up the receiving project first; mismatched saved authority requires
inspection and reconciliation. There is no preparation button or Colleague
preparation tool yet; Colleague can explain these limits but cannot claim it
has prepared sources through an unavailable action.
