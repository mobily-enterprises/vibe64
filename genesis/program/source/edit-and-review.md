# Source editing and change review

People can inspect and make focused source changes, see every file that differs
from saved project work, and inspect one exact file change at a time.

## Sources

- `packages/vibe64-source-editor/src/server/service.js`
- `packages/vibe64-source-editor/src/server/starredFiles.js`
- `packages/vibe64-source-editor/src/server/registerRoutes.js`
- `src/composables/useVibe64StarredFiles.js`
- `src/components/studio/vibe64-session/Vibe64StarredFilesMenu.vue`
- `src/components/studio/vibe64-session/Vibe64StarredFilesList.vue`
- `packages/vibe64-terminals/src/server/repositoryHistory.js`
- `packages/vibe64-terminals/src/server/sessionWorkOperationCommand.js`
- `packages/vibe64-terminals/src/server/sessionWorkSave.js`
- `src/composables/useVibe64SourceEditor.js`
- `src/composables/useVibe64SourceEditorFileSync.js`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue`
- `src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue`
- `src/composables/useVibe64RepositoryWorkspace.js`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64SessionRuntimeHost.js`
- `src/components/studio/repository/Vibe64RepositoryWorkspace.vue`
- `src/components/studio/repository/Vibe64RepositoryFileBrowser.vue`
- `src/components/studio/repository/Vibe64RepositoryDiff.vue`
- `src/components/SectionContainerShell.vue`
- `src/lib/vibe64RepositoryRealtime.js`
- `src/pages/app/project/[slug]/dashboard/changes/index.vue`
- `src/pages/app/project/[slug]/dashboard/repository/index.vue`

## Public contract

The source browser lists, searches, opens, edits, and saves allowed project
files inside the selected session source. It rejects paths outside that source
and reports concurrent changes rather than silently overwriting them. The
source editor publishes successful creates and saves with project, session,
path, hash, and originating-tab identity. In a visible editor, a foreign create
refreshes the file tree, while a foreign save refreshes a clean matching file
or warns without overwriting a dirty draft. A hidden editor admits no new file
revalidation reads; foreign creates mark its tree for one refresh on return,
including when no file is selected. Changing source discards that pending tree
refresh. Reads already in flight may finish.
An assistant turn becoming idle refreshes the visible tree's already-loaded
directory pages and selected file. Hidden editors coalesce that work until
return. This adds no recursive watcher or continuous tree polling. Tree refresh
keeps the previous tree visible until replacement pages are ready, preserving
expanded folders, selection and editor position; concurrent local edits are
never replaced. The existing Refresh action uses the same path.

The selected file header and file-row actions offer Star and Download. Downloads
return the saved file's original bytes and filename, including binary files and
files too large to edit. An unsaved selected file offers Download saved file or
Save & download; a failed save does not download a supposedly saved draft.
Source containment, excluded-path and symlink protections also apply to downloads.
The download handler awaits Fastify's streamed reply so its async completion
cannot send an empty response before the file stream starts. Route verification
checks original bytes over real HTTP, including nonempty binary, text, large and
genuinely empty files.
Opening a binary or oversized file from a chat link or the file browser shows
its filename and a Download action. That selection stays outside the editable
buffer, autosave and text-file observation. Opening another text file restores
editing; changing sessions discards the selection and ignores pending file-read
results. Download failures show their error message and leave retry available.

Stars are personal and project-scoped, not Git changes or shared project settings.
The server stores at most 100 paths per authenticated account in private project
runtime state, with serialized atomic updates. Stars follow the account across
devices and sessions and retain their insertion order. Missing or excluded files
remain listed as unavailable in the selected session until unstarred. Availability
checks touch only the bounded starred paths, never the whole source tree.
The collapsible Starred section and chat's searchable star picker share one
client state. The file browser shows one filename per row, with an ellipsis for
long names and the full path on hover and in each button's accessible name.
More than four stars start collapsed.
The picker is a popover on larger screens and a bottom sheet on
compact screens, with a compact search field and Close on one row and no
redundant heading. Opening a star uses normal Dashboard Files navigation without
clearing the chat draft. Toggle failures roll back only the affected star and
show action feedback without shifting the list. Once pending changes settle,
a failed batch rereads saved stars to restore authoritative ordering without
losing successful changes. Newer edits supersede an in-flight reread; reconciliation
remains pending until a current read succeeds. Successful toggles alone do not
add a read or generate toasts. Opening the picker
reloads saved stars, so other-device changes appear without background polling.
Selected-file observation follows the active session and editor pane.
Retaining an inactive session does not retain its file connection; returning to the
editor reconnects and revalidates the selected file through the existing sync
owner. Events from a replaced connection do not update the current editor.
Successful revalidation clears its own previous error even when the file is
unchanged or has a local draft, without hiding a failed tree load or another
file's failed open. Switching to Preview retains the selected dashboard tool
inactively; returning to Files keeps its selected file and draft. A cold Preview
does not mount a source tool, and explicitly choosing another dashboard tool
still unmounts the previous one.

When its source is not yet known, opening Files or another source-backed tool
directly waits for the selected session's initial detail read. The Project pane
shows its existing loading skeleton during that wait, keeping the requested route
and bringing the pane into view on compact screens. A ready source opens the
tool; settled missing or failed detail uses the normal environment fallback.
Navigating elsewhere while detail loads is respected. Only the active session
host hydrates or redirects the
shared tool route; a retained hidden host waits until reactivation to reconsider
its source and the current route.

A source explanation is temporary assistance for a selected code range or file.
A matching cached answer can appear without starting a provider conversation;
its first follow-up starts an independently owned conversation through the same
verified low-cost execution profile. The server retains source, account, profile,
and conversation authorization. The browser submits the explanation identity
and question, not a provider thread or model configuration. Failed conversations
offer regeneration instead of another follow-up; unavailable assistants leave
the existing answer readable with generation and follow-up actions disabled.
Stop targets the selected explanation. Closing keeps its answer visible and
disables conflicting actions until cleanup is acknowledged. Failed cleanup
retains the answer and reports action feedback so Close can be retried. Changing
session or unmounting releases the old stream's pending browser state; a late
Stop response, cleanup result or streamed event cannot reopen that explanation
or overwrite a newer request, including a follow-up in the same conversation.
Hiding a retained editor does not cancel an explanation the person started;
its answer remains available when they return.

The Repository presents the session's complete current changes against saved project
work, even when those changes are already committed inside the session. It can
open an exact changed file without exposing staging mechanics to the user.
Current changes refreshes when an assistant turn becomes idle and when Vibe64
observes editor, Save, or repository-status events, so work completed during a
turn appears without a manual reload. Arbitrary filesystem writes that produce
none of those events are not promised to appear immediately.
Current Changes first renders from the last locally proven canonical version
while Vibe64 checks the configured GitHub, managed-Git, or local-repository
authority in the background. Save remains unavailable until that authority
check succeeds. The initially selected file difference comes from the same
immutable worktree snapshot as the file list.

Switching away from a retained session retires its History and Current Changes
readers and realtime listeners. Late responses cannot start further review work.
Returning starts a fresh read; transient History paging and version details
reset. This does not tear down chat or session-wide status tracking.

History file paging and differences belong to the selected commit. Selecting
another version clears the previous version's loading and error state. Late
results from that previous selection cannot change the new view or prevent it
from loading more files.
Closing version details retires that selection, including a pending file list;
its later response cannot start an unused diff behind the closed dialog.
After Save, History refreshes before a separate authority-check result is applied,
including a check already in flight. A check for the displayed version does not
load it again; a newer version still refreshes the list, and a failed check does
not discard the successfully refreshed history.
A replaced Save request does not keep the current authority check busy after
the latest History response has arrived.
Loaded history and version files remain usable if a later page fails, and the
same page can be retried without discarding earlier content. A failed first load
offers an explicit retry. Once a version's file list arrives, its files are
selectable while the independently owned first diff is still loading.
In both History and Current Changes, a selected filename is literal, not a Git
search pattern, even when it contains wildcard or colon characters. Whitespace,
tabs and literal backslashes remain part of the exact filename through listing,
selection and diff requests. An exact file diff never includes descendant files,
including when a deleted file has been replaced by a directory; Git submodule
entries remain independently readable.
The full-screen history view scrolls its file list independently from the diff,
so long versions keep later files and their Load more action reachable without
moving the selected difference out of view.
Desktop Current Changes also scrolls its file list and selected difference
independently. In short windows, status notices and the review pane can scroll
below the fixed heading without collapsing the pane. Dashboard navigation owns
its own scrolling, so reaching a lower section does not shift the page content.

## Implementation map

- The source-editor service owns explanation cache lookup, temporary conversation
  creation and cleanup. `useVibe64SourceEditor()` owns the selected explanation,
  request generation, streamed messages and acknowledged Close state;
  `Vibe64SourceExplanationPanel` presents the answer, follow-up, cancellation
  and recovery controls. An answered cache record does not need a thread id to
  enable its first follow-up.
- Source explanations use a lock for their own conversation rather than holding
  the session source lock while awaiting an answer. Source edits, previews and
  other explanations can proceed; a second turn in the same explanation receives
  an explanation-specific busy response. Session renewal admission still applies.
- Server interruption stays outside the conversation lock. If a new message
  has not received its provider turn identity, Stop waits for that exact message's
  identity or startup failure; it never reuses the previous message's turn. After
  its provider acknowledgement, Stop compares the targeted assistant message and
  provider turn before publishing state; it cannot overwrite a newer turn or restore an
  explanation that has already been deleted.
- `runSessionWorkOperation()` admits each Current Changes, file-diff, work-state,
  or update-check request as one managed job. Canonical Save uses one managed
  checkpoint-and-summary job before commit naming and one managed
  publish-and-reconcile transaction under the project source lock.
  `sessionWorkOperationCommand.js` performs each operation's exact Git work
  inside its admitted child instead of paying managed-host admission cost for
  every individual Git command. It loads the Genesis compiler only for Save,
  so update checks and other inspections avoid that compiler startup cost.
- `refreshWorkState(observedWork)` accepts the complete work-state snapshot
  already returned by Current Changes. The runtime host also projects Save and
  Update task events directly from the mounted realtime session, so visible
  progress does not wait for repository inspection behind an active source
  lock.
- Current Changes calculates its initial selected-file difference inside the
  file-list managed job, reusing that job's exact worktree tree instead of
  admitting and scanning the worktree a second time.
- Concurrent update checks for one session share the same exact server
  operation, and repeated repository refresh events collapse into one bounded
  follow-up Current Changes inspection.
- History validates its pinned Git snapshot once per files or diff request. When
  that exact commit is selected, its object resolution is reused; older selected
  commits still receive their own resolution and reachability checks.
