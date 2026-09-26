# Choose a collaboration approach

People can keep project-wide communication preferences in portable project
source while retaining personal naming and Vibe64 prompt suggestions as UI
conveniences outside agent prompts.

## Sources

- `packages/vibe64-genesis/src/server/index.js`
- `packages/vibe64-project/src/server/actions.js`
- `packages/vibe64-project/src/server/inputSchemas.js`
- `packages/vibe64-project/src/server/registerRoutes.js`
- `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-core/src/server/projectPromptHints.js`
- `src/components/studio/ProjectSettingsPanel.vue`
- `src/composables/useVibe64SessionPanel.js`
- `src/lib/studioGateApi.js`
- `src/lib/studioUrls.js`

## Public contract

Project settings presents the tone, response-length, assumed-experience, and
explanation-style choices supplied by the exact pinned Genesis contract, plus
optional project requirements. Vibe64 does not duplicate those choices or
their instruction text. Saving changes `genesis/collaboration.md` in the
standalone source or selected hosted session source, so the result follows the
same source authority and history as the project.
The controls and their Save action stay together beside the section description,
stacking below it in narrow panes. Project requirements spans the form width,
starts at six rows and grows up to eighteen before scrolling. Prompt suggestions
has a separate section and Save action. Material typography and theme colors
provide the same hierarchy in light and dark themes.
An unsaved choice survives refreshes of that same source. Switching project,
source kind or source session loads the new source's choices; the previous
source's draft is never submitted as the new source's settings. A temporary
query-loading interval does not by itself discard a same-source draft.
Settings reads retain their original project and source through transport
retries; switching projects does not redirect an earlier read to the new one.
Save keeps the choices disabled through the follow-up canonical settings read, so
the previous save's refresh cannot overwrite a newly enabled choice. A failed
save releases the controls and preserves the draft for retry; a failed read
uses the existing settings error and Retry view. Save failures use the shared
action feedback, without also opening an unexpected-UI-error dialog.

Only the project owner can change collaboration through hosted Project
settings. Anyone independently authorized to edit the source can still change
the Genesis file directly. Genesis validates the complete declaration and
expands it only in stable session context. The change affects conversations
when they next establish or refresh that context; it does not alter past
history or live Codex developer instructions.

The prompt-suggestion switch is a separate Vibe64 project-runtime setting. It
controls whether Vibe64 offers optional next-message ideas and never changes
agent instructions or `genesis/collaboration.md`. The preferred name is a
personal account or local profile choice used in Vibe64 welcomes and
collaboration cues. It is never written into project source or sent as agent
context.

## Implementation map

- The persistent session panel owns project-settings refresh events for its
  project. Active selected-source and explicit-session readers refresh through
  that one owner; inactive source entries become stale without starting reads.
  Engineering settings keep their separate query and refresh subscription.
- `collaborationSettingsState()` reads the selected source through Genesis and
  returns Genesis's current choice catalog.
- `saveCollaborationSettingsState()` serializes source mutation with other
  project work and delegates validation and writing to Genesis.
- `savePromptHintsState()` changes only the independent Vibe64 prompt-hints
  record.
