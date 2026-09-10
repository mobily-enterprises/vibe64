# Database relationship exploration

The database diagram makes a session's refreshed schema navigable without
requiring every table and field to be read at once.

## Sources

- `packages/vibe64-database-tools/src/client/components/DatabaseErd.vue`
- `packages/vibe64-database-tools/src/client/components/DatabaseErdNode.vue`
- `packages/vibe64-database-tools/src/client/components/DatabaseTableList.vue`
- `packages/vibe64-database-tools/src/client/components/DatabaseErdEdge.vue`
- `packages/vibe64-database-tools/src/client/components/Vibe64DatabaseWorkspace.vue`
- `packages/vibe64-database-tools/src/client/composables/useVibe64DatabaseTools.js`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `packages/vibe64-database-tools/src/client/erdModel.js`
- `packages/vibe64-database-tools/src/client/erdRelationships.js`
- `packages/vibe64-database-tools/src/client/erdRouting.js`
- `packages/vibe64-database-tools/src/client/workers/erdLayout.js`
- `packages/vibe64-database-tools/src/client/workers/erdLayout.worker.js`
- `packages/vibe64-database-tools/src/server/sessionState.js`
- `packages/vibe64-database-tools/src/server/service.js`
- `packages/vibe64-database-tools/src/server/events.js`
- `packages/vibe64-database-tools/src/client/components/DatabaseOverview.vue`
- `packages/vibe64-database-tools/src/client/components/DatabaseOverviewEdge.vue`
- `packages/vibe64-database-tools/src/client/dataOverviewModel.js`
- `packages/vibe64-database-tools/src/shared/dataOverview.js`
- `packages/vibe64-database-tools/src/server/dataOverview.js`
- `packages/vibe64-terminals/src/server/agentDatabaseCommand.js`
- `packages/vibe64-genesis/src/server/promptContext.js`

## Public contract

Automatic database reads follow the visible Database pane. A retained hidden
workspace defers automatic table opening until it is active again, including
when schema data arrives after leaving. Returning to the same selected table
keeps its mounted SQL draft and results rather than running that table again.
When a command finishes after the workspace is hidden, its follow-up state
reload also defers to normal activation. The command keeps its result without
creating an unavailable-resource error behind the hidden pane.

Given the selected session's schema snapshot and its shared saved
diagram, the ERD starts in Keys only mode unless another mode was saved. Initial
loading uses one small, faint table skeleton and a politely announced Preparing
diagram label, with the canvas geometry reserved. Its short delayed fade avoids
flashing on quick openings; reduced-motion users get a static indicator. The table list
and faded overview stay visible while an actor's diagram is prepared.
All columns, per-table expansion, and collapse change visible detail without moving
any table or changing the camera. Extra fields may overlap neighbouring cards;
they never trigger automatic arrangement, even for very large tables. Fit and
Reset positions remain explicit controls. Search finds
tables or columns, reveals the matching field, and centres its table. Selecting
a table highlights its immediate relationships and linked fields, keeping that
table and its immediate neighbours fully opaque while dimming unrelated tables.
With no selection, all tables are opaque. Hovering a connection adds endpoint
and field highlights without dimming tables or replacing the clicked selection;
clearing selection restores all tables. This applies to the full and scoped ERD.
Highlighting updates the existing graph objects in place, without reparsing every
node and edge on pointer movement. Immutable schema metadata stays outside deep
Vue reactivity; replacing the schema snapshot still rebuilds the diagram.
Zooming and panning save the camera after 600 ms of inactivity, rather than
writing and reloading shared state between wheel ticks. Table moves and explicit
layout changes save immediately and include the current camera. Closing the
diagram cancels a pending camera-only save, so it cannot write into a different
session.
Focus hides
everything except that table and its immediate neighbours. Open data retains
the database workspace's table-selection operation.

Connections point from referenced parent columns to child foreign-key columns.
Every pair in a composite foreign key is drawn and selects the same constraint.
Selected or hovered connections show endpoint multiplicity; the inspector lists
all field pairs and delete/update actions. Multiplicity derives from known
unique keys and nullability, never implies that a parent must have children,
and marks unknown nullability with `?`. Optional or unknown-requiredness links
are dashed. Collapsed tables use header ports instead of pretending their
hidden fields are visible.

Reset positions uses port-aware orthogonal layout within automatic relationship
neighbourhoods or user-named groups, packs those groups with space between them,
and separates disconnected tables. Named membership takes precedence over
automatic membership. Pinned tables cannot be dragged and retain their exact
positions on Reset; other cards are placed outside occupied bounds. Connection
routing also runs in the worker, keeping typing and navigation responsive while dense schemas are arranged. It checks clear corridors before
a bounded obstacle-grid search. Clear corridor candidates penalize shared
horizontal/vertical runs and crossings; the fallback search prioritizes progress
towards the target and card clearance so crossing costs do not consume its budget.
A route that exhausts the search budget
remains visible with the same notice as an obstructed route. Enclosed endpoints
are detected without searching for an impossible path. The router does not promise a crossing-free graph or clear routes through overlapping
pinned cards. An obstructed-route notice explains how to recover. Worker
failures use an announced basic arrangement where available, or show an error
with Retry; they do not silently claim the recommended layout succeeded.

During dragging, incident paths use inexpensive temporary corridors while
unchanged unrelated routes remain stable. Pending worker updates are coalesced;
only the latest graph can be applied. Superseded routing completions do not save
or start moving the camera, and only the current restore or arrangement unlocks
controls. Acknowledging an unchanged saved graph does not reroute it or disable
its controls. Drop reroutes paths obstructed by the moved
card and persists positions. Undo/Redo retains up to 30 diagram snapshots for
the mounted view, including moves, Reset, display/focus/group changes and
loading a saved view; it does not undo saving or deleting named views.

Up to 20 named views store positions, pins, groups, focus, column display, and
viewport. Saving an existing name replaces that view with a visible notice.
Views and the current layout belong to the session, not an individual user.
Positions, pins, groups, focus and display choices are saved in one shared
session artifact, separate from database tables and the schema snapshot. A
successful save publishes a project/session-scoped refresh hint. Other active
viewers reload protected state and apply the layout without saving it back;
hidden workspaces catch up on activation. A remote move leaves the viewer's
current camera and selection alone. Reload restores the shared saved zoom and
exact positions, even if cards overlap; automatic placement only moves new
tables unless Reset positions was requested. Writes are serialized and assigned
increasing revisions; older refreshes cannot replace newer acknowledged layouts. When no shared layout
exists, the first opened existing user diagram is adopted into the shared
artifact; old artifacts remain recoverable but cannot override it afterwards.
SQL history and snippets remain user-specific. Fullscreen keeps
controls, menus, and dialogs inside the fullscreen element.

Diagram controls use one compact search/Fit/options toolbar in the shared ERD.
The options surface retains column modes, table filtering, reset, undo/redo,
saved views, named groups and fullscreen. Filter labels distinguish all tables,
automatic clusters around named tables, named groups, connected tables and
unconnected tables. Only active filters occupy a chip row. The overview hides
its toolbar while a concept is expanded, and puts occasional overview actions
and connection visibility in its own options menu. Concept editing/promotion
is available through the scoped ERD's options slot, using the existing editor.

## Implementation map

Overview is the default Database view, followed by ERD and Data. Opening Overview or ERD does not automatically query table records; Data admits the first table query when selected.

The Overview tab uses a source-owned `data-overview.json` definition:

```json
{"version":1,"actors":[{"table":"public.bookings","name":"Bookings","description":"Bookings with invoice groups and their checklists and transactions","tables":["public.bookings","public.invoice_groups","public.checklists","public.transactions"]}]}
```

Membership is explicit and independent of relationship distance. Each table has
one home; genuinely shared concepts can be separate actors. Every actor includes
its main table. Exact qualified names come from the refreshed schema. Unassigned
tables appear under Other tables, and missing references remain visible as a
warning until reviewed. An invalid definition falls back to all tables in Other
tables with its error visible. Opening each actor exposes every current table
exactly once across the groups.

Opening an actor leaves the map mounted at its exact viewport and positions,
reduces its opacity, and layers a scoped `DatabaseErd` over it. This is the existing
ERD component with the group's physical tables. Incident FK metadata preserves
the normal key columns and icons; the existing router draws only relationships
whose two endpoints are visible in that group. The existing worker uses shared radial placement to
centre the main table and distribute its supporting tables around it. Nodes cannot
be dragged in this scoped mode; the full ERD retains dragging. Search, fields,
selection, highlighting, focus, zoom and other ERD interactions use the same owner.
The shared `DatabaseTableList` renders tables and fields in both the database
navigator and the scoped layer; ERD selections update its selected table, and its
table/field choices locate the corresponding ERD content. Scoped layout/view state
is kept only in the mounted overview, separately per actor, and is never written
over the shared full ERD layout. Close details, Escape, or clicking outside the
layer restores the unchanged overview. Late worker completions cannot reopen it.

Optional `mainRelationships` lists actual schema foreign-key IDs chosen for their
business significance. The overview normally draws only these, bundled by directed
actor pair. All connections exposes the complete cross-actor FK graph. Definitions
without a selection show all connections with guidance to review them with AI;
an explicit empty selection shows none. Missing FK IDs produce a schema-drift
warning. Neither the underlying schema nor the full/actor ERD loses relationships.
Inspection names actual endpoints and constraints rather than asserting inferred
main-table cardinalities. Shared ownership, authorship and infrastructure references
normally stay out of the main view unless meaningful to the application.

AI-authored `rings` choose business actors at the centre and supporting actors
clockwise farther out. The worker uses shared radial placement, with 220 pixels
between bounding circles. Collapsed card area reflects table count and is capped
at twice the smallest card; fonts stay readable. Other tables join the outer ring.
Connections use facing card sides and 48-pixel obstacle clearance. Without authored
placement, larger groups start nearer the centre. Fit shows the entire map; opening
and closing a scoped ERD never refits it. Overview uses the full workspace width,
including intermediate sidebar breakpoints and chat/copilot layouts. Unchanged
refreshes retain zoom without another routing request.

Dragging a collapsed actor moves the concept itself; scoped physical tables remain
fixed. During movement, incident connections use the existing Vue Flow inexpensive
path calculation. Routing keeps the existing cards and connections mounted at
their displayed positions; it never exposes the temporary layout grid. A new
gesture retires older routing replies. Saving and routing do not disable dragging:
successive drops retain the latest local positions while source writes run in
order, coalescing intermediate drops. Each next write uses the preceding save's
acknowledged hash, so a concurrent source edit still conflicts. Save acknowledgements
and routing replies do not rewind a newer drag or the camera.
Drop reroutes in the worker and saves optional `positions`, keyed
by actor main table or `other-tables`, through the same hash-protected overview
operation. Saved positions override radial placement, including after a reload or
connection-visibility change. Reset actor positions clears these overrides without
changing membership or AI rings. A stale save cannot overwrite another editor;
failed saves restore the current persisted arrangement and use command feedback.
These positions belong to the overview source, never the full ERD layout. Actor
edits prune overrides for removed actors; incremental AI review preserves them.

Edit actors writes the definition through the existing source editor with a
content-hash conflict check, including when two viewers have old forms open.
It does not write database records. Definitions belong to each session's source
and follow ordinary Save/Update versioning. Overview reload and schema refresh
reread the file; successful saves/refreshes notify other active database viewers.

Make main actor promotes an internal table into its own group. Edit or merge actor moves an actor and all its tables into another actor, through the same reviewable editor and conflict check. These changes preserve review history and keep authored rings valid.

Create/Review with AI offers Not abstract (one actor per table), Balanced (normally 5–10 business concepts), and Very abstract (normally 3–5 domains). These are semantic targets, not hard caps; AI also selects main business connections by real FK IDs. Users choose full regeneration, which explicitly replaces authored choices, or new-tables-only generation, which preserves existing actors and manual adjustments. `reviewedTables` records reviewed names, including tables deliberately left under Other tables; only unseen names are pending. Older definitions treat assigned tables as reviewed without assuming that unassigned tables were considered. AI instructions cover both classification and logical radial placement.

Create/Review with AI uses the provider-independent Temporary AI workspace with
source-write permission. `vibe64-database overview --json` returns the schema,
current definition, coverage, warnings and complete authoring instructions through
the bound session bridge. Instructions ask the agent to inspect relevant models
and documentation, preserve authored choices, classify new tables and repair
renamed/removed references. They explicitly permit either broad multi-hop actors
or smaller actors linked by the actual relationships. The normal managed agent
guide carries the same maintenance entry point for Codex and OpenCode. Rendering
and coverage checks are deterministic and make no AI calls. Routine agents refresh
the schema after database changes; an already-running conversation receives new
stable guidance at its normal context-refresh boundary.

The definition accepts version 1, up to 2000 actors and 2000 assigned/reviewed tables,
with a 256 KiB file limit. It rejects duplicate membership, absent main tables,
unknown properties and invalid text. Files must be regular source files, not
symlinks. Invalid files keep table access available rather than failing the whole
Database pane.

`erdModel.js` owns column visibility, cardinality, one-hop focus, deterministic
neighbourhood grouping, and collision placement. The layout worker supplies
ELK fixed-port routes as well as node coordinates. `erdRelationships.js` assigns
per-column handles and accepts clear worker routes; `erdRouting.js` repairs
cross-group and moved routes using obstacle-aware orthogonal routing with
lane-sharing penalties. `sessionState.js` normalizes bounded layout/view data
and stores the shared diagram through the existing session artifact boundary.
