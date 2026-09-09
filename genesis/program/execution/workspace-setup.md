# Workspace preparation

Vibe64 can prepare a fresh session source using its exact Workspace setup
contract transported by the project's Stack.

## Sources

- `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-runtime/src/server/workspaceSetupState.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-genesis/bin/genesis`
- `packages/vibe64-genesis/src/server/index.js`
- `packages/vibe64-genesis/src/server/workspaceSetup.js`
- `src/components/studio/Vibe64TemporaryActionTerminal.vue`
- `src/components/studio/Vibe64TemporaryAiFixAction.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64TemporaryAi.js`

## Public contract

`vibe64.workspace-setup.v1` is the only accepted schema. Its source is strict,
readable Markdown: each `Prepare` entry declares a label, runtimes, optional
working directory and path condition, then separate backticked argv values.
Vibe64 parses that opaque Stack section mechanically and runs the normalized
argv with the project's resolved environment. It runs once for a fresh recipe,
records progress and exact recipe identity, waits before dependent work, and
exposes retry after failure. Missing or ambiguous declarations remain explicit;
Vibe64 never guesses an installer or reads a retired grammar.

Before Update or its interrupted-operation recovery replaces session source,
the terminal service invalidates preparation durably. The `required` state
clears the successful recipe identity and retains the earlier transcript with
the reason for invalidation. An unchanged installer command cannot certify
dependencies for updated source. A no-op Update retains preparation. The next
preparation uses the existing managed execution and admission path; Update
does not run installers itself. The required-state banner offers Prepare
workspace directly, without requiring AI. Its message remains accurate after
Update finishes instead of claiming source is still changing. The server accepts
that explicit request in the required state and runs the full declared recipe,
not merely an inferred package install. A command run independently in chat
cannot certify that recipe. An explicit preparation retry at the runner seam
reruns even a previously successful recipe, allowing repair of removed installed
files; the public retry action still rejects an already-successful state.

Preview can inspect whether the current recipe already succeeded without taking
assistant-write admission. If preparation is needed, it rereads the session under
that admission and holds it until the preparation command finishes. A busy
admission result prevents the preview from continuing with an unprepared recipe.

If an explicit retry finds that Genesis recognizes the project as unversioned
or outdated and prescribes migration, Vibe64 runs its bundled `genesis migrate`
command through the same locked managed-source execution boundary. That command
declares both its Node and Git runtimes and receives the exact session source as
a Git-safe directory, so the managed daemon identity can inspect the
session-owned worktree without weakening Git policy elsewhere. Vibe64 records
the bounded output, re-inspects the resulting Stack contract, and then runs the
declared preparation recipe. It does not migrate a current, newer, invalid, or
otherwise unrecognized project merely because setup inspection failed.

During preparation, the workspace shows one compact progress line. Opening its
details reveals the bounded transcript; while work is active, Collapse returns
to the compact line and Dismiss is unavailable. After the operation finishes,
Dismiss removes it. An opened transcript remains available after completion
until dismissed. The browser remembers that dismissal across reloads for the
exact preparation attempt without changing its result; a new attempt is visible
again. A successful preparation left compact disappears when it finishes; a
failure remains visible with direct Retry and Fix it with AI actions until
dismissed, without requiring the person to expand terminal details. Fix it
opens a workspace-writing Temporary AI task with the current diagnostic and
bounded transcript, selects and focuses that separate chat, and presents a
concise visible request instead of the complete operational prompt. A compact
heading shows repair status while the AI works; the result appears afterward. Every
product surface that offers this ephemeral repair path uses the same Fix it with
AI control and handoff presentation.
The shared action banner fits its containing pane, wraps failure messages, and
keeps Retry, details, Dismiss and Fix it with AI independently usable. Narrow
panes give actions their own wrapping row; the repair control can wrap its label
when magnification leaves less room than its usual width.

After an accepted repair turn completes or fails, Vibe64—not the assistant—runs
the deterministic preparation retry and records its result. This includes a
provider timeout after edits may already have landed; an explicit user stop is
not treated as permission to retry. A repair that changed nothing simply
returns to the same authoritative setup failure. If the assistant needs human
input, that question remains in the temporary conversation instead of being
mistaken for a completed repair.
