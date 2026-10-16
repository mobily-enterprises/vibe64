# Working session interface

Presents the selected project's working session as one retained workspace for
conversation, application preview, files and engineering tools.

## Sources

- Main: `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64SessionFiles.vue`
- `src/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue`
- `src/components/studio/vibe64-session/Vibe64SourceInterface.vue`
- `src/components/studio/Vibe64SessionPanel.vue`
- `src/components/studio/Vibe64DashboardBackButton.vue`
- `src/composables/useVibe64AutopilotView.js`
- `packages/vibe64-system-graph/src/client/components/Vibe64UiStoryboardView.vue`

## Public contract

Given the currently selected project/session, its admitted services and current
viewer access, the workspace presents the conversation and selected project tool.
Switching tools retains their mounted content while hiding inactive views and
suspending their automatic reads. Session changes use the existing session owners
and do not adopt another conversation's native identity or source authority.

Architecture, Changes, Files, Database and the GitHub panels use one shared
dashboard back control. It owns the arrow and text-button presentation; the
calling view retains its existing destination or navigation handler, including
returning to Architecture or to an issue/pull-request list.

Files retains Repo, Drop Zone and Session browsing. Repo and Architecture share
the same source viewer/editor, including language highlighting, autosave, base-hash
conflict checks, download and source references. Architecture hides the viewer's
file browser and conversation dock; its source links remain in the canvas and
Back restores the previous Program, source file or subsystem. A Program is a
capability explanation with an explicitly authored main source and supporting
files; opening it never opens its Genesis Markdown as a source file.

File interfaces use the native language facts, distinguishing recorded exports
from intended subsystem API and externally observed imports. Opening a file or
signature does not ask an AI to explain it. Explicit Generate/Update controls
request a file overview or function pseudocode from the current Helper, through
the original source service. Saved text remains readable during updates.

The component does not own project, provider, execution, account or teaching
policy. Its composables and package services retain those operations and their
permissions; server rejection is surfaced instead of assuming a view change
performed the requested effect.
