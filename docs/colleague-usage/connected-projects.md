# Configure connected projects

If a receiving repository's status cannot be checked, the ordinary Main Save
control remains available. Save checks access and state again and reports the
blocker without pushing the main project. An unavailable status does not count
as a merged contribution.

Checking connected Save status can take longer on a busy development workspace
because it checks each receiving repository. Allow up to two minutes for the
check. If status remains unavailable, use Save to check again and read its
reported blocker; an incomplete check never publishes the main project.

The session badge shows **Unsaved changes** when a connected repository needs
publication, even if the main repository is clean. After connected Save succeeds,
the result lists the pushed commits. An empty progress card closes when the action
finishes; opened details with real output remain available until dismissed.

Open the intended project and session, then **Dashboard → Project settings →
Connected projects**. On phones, use **Show project** and **Dashboard section**
to reach Project settings. The list belongs to the displayed source checkout.

`vibe64.connections.json` is the only repository connection list. If it does not
exist, use **Add project**, then **Save connected projects** to create it. You can
also edit this tracked source file directly. Stack contains technology and generic
placement/treatment instructions, never repository identities or initial lists.
Opening Settings and preparing a workspace do not create or import this file.

For concurrent hosted tasks, configure each receiving project's **Project settings
→ Development database → A separate database for each session** before opening
its sessions. **One database shared by this project** permits only one open
session unless **Allow multiple sessions with this shared database** is enabled,
including connected contributions and libraries with no database. With project
scope already selected, enable the override and choose **Save database choice**
without closing work; all sessions share data and the ordinary three-session cap
still applies. Then use workspace preparation **Retry**. Disabling the override
preserves existing sessions but blocks additional creation. Preparation never
archives existing work or changes this preference for you.

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

For preparing sources, contribution sessions, Save connected work and integration, see [Connected contributions and saving](connected-contributions.md).

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

If a command reports that it requires an undeclared runtime, add that runtime
to the affected command in Stack and prepare again. Vibe64 and Online's own
Node composition checks declare both `nodejs` and `git`: Genesis inspects the
Git worktree while verifying the composed application. Do not bypass the managed
runtime restriction by adding host executables to PATH.

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
