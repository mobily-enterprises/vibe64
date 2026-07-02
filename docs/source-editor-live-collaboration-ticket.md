# Source Editor Live Collaboration Ticket

## Goal

Make source-editor typing live-collaborative for every browser window that has
the same Vibe64 session and file open.

The current saved-file fanout only tells peers that a file was saved. The future
version should let peers see edits as they happen, without waiting for autosave
or hitting whole-file `baseHash` conflicts.

## Current State

- The source editor uses CodeMirror 6.
- Saves are whole-file `PUT /source-editor/file` requests protected by
  `baseHash`.
- Successful saves publish metadata-only realtime invalidation for
  `{ projectSlug, sessionId, path }`.
- Clean peers can reload the file; dirty peers are warned so unsaved local work
  is not overwritten.

## Desired Future State

Use CodeMirror's collaboration primitives for the active open file:

- one collaboration room per `{ projectSlug, sessionId, path }`
- server-side document authority that owns current text, version, and accepted
  updates
- clients submit CodeMirror updates against the synced version
- server accepts/rebases/rejects updates in order
- accepted updates fan out to other clients in the same room
- clients apply remote updates through CodeMirror rather than replacing the
  whole document
- disk persistence remains the final source for saved session files

## Suggested Shape

Start with `@codemirror/collab`, not a full app-state or Yjs subsystem.

Phase 1:

- Add the server authority for one active file room.
- Add update history with a bounded replay window.
- If a client falls too far behind, make it reload the full file.
- Flush accepted updates to disk through the existing source-editor file policy.
- Preserve the existing max file size, text/binary checks, and path policy.

Phase 2:

- Add presence cursors/selections.
- Add clearer conflict/reconnect UI.
- Consider Yjs only if shared undo, rich awareness, or offline-first behavior
  becomes important enough to justify the larger subsystem.

## Non-Goals

- Do not sync every source file in the session.
- Do not sync arbitrary UI/app state.
- Do not broadcast full file text through generic realtime events.
- Do not replace source-editor path policy or session source ownership.

## Acceptance Criteria

- Ten browser windows can edit the same session file without whole-file save
  conflicts during normal typing.
- Windows for other sessions, other projects, or other files do not receive or
  apply the updates.
- Reload/reconnect behavior is deterministic and easy to reason about.
- Existing source-editor read/save APIs continue to work for non-collaborative
  clients.
