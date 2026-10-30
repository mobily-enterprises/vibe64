# @local/vibe64-system-graph

Architecture opens one spatial sheet: explicit UI page/screen/scene parents above
and Engine directory-rooted subsystem circles below a horizontal divider. The
existing ERD's Vue Flow canvas owns pan/selection. Engine displays all native
source owners, bounded source sizes, readable roots/responsibilities and declared
API counts. Application entries are emphasised, support resources subdued.
Explicit shared libraries stack on the right, followed by an alphabetical opaque
External dependencies list. There are no imposed layers or Engine import arrows.

Clicking a subsystem animates circle → interface square, with directory-grouped
file icons directly beneath its interface → exact file interface. A circle backdrop preserves
context; a compact skeleton paints before detail prepares. Wheel/pinch lock the
initial target and animate scale/centering together. Outward movement preserves
context without aggressive recentring. One animation-frame camera path avoids
awaiting interruptible D3 transitions. Ordinary mouse/touchpad wheel and one-touch
swipes scroll the bounded square beneath its fixed breadcrumb; reaching a scroll
boundary never switches to zoom. Ctrl-wheel/pinch explicitly zooms anywhere;
ordinary wheel zooms on uncovered canvas. Inward gestures alone can enter nested
views, and returns use the enclosing pre-gesture reading camera. Breadcrumbs,
the top-right close control and Esc provide explicit returns one level at a time.
Map node IDs/types and the file browser remain mounted while hidden; local
arrangement/search/disclosures survive deeper navigation. Compact rows and
stable label sizes avoid stretched cards and per-frame text reflow.

The existing `subsystemOutline` model shows exact externally imported signatures,
declared API members, candidates from externally imported files and other available
exports separately. Imported symbols require analyser evidence; importing a file
does not promote every export to its observed interface. Missing declared intent
is explicit. Import paths are secondary.
Exact source hash/name/range joins resolve native implementation IDs, including
re-export aliases. Stale/ambiguous/opaque declarations never link to guessed
source. Selecting a signature opens the host's `file-interface` slot with the
exact path and declaration. It reuses `Vibe64SessionSourceEditor` single-file mode,
existing explanation/hash/admission owners and read-only whole-file Code; it
does not open the Files workspace. The host passes its already loaded common
facts and refresh operation, avoiding repeat whole-index reads while retaining
fresh source hash checks. Icons retain directory nesting, search,
single-click/tap or Enter opening and source sizes relative to that subsystem.

Purple controller bridges preserve `pageConnections` component reachability,
protocol/scope and separate receiving-file ports. Calls are hidden initially;
page selection focuses its own calls. Unresolved observations stay explicit.
Receives UI calls opens the evidenced receiving file and exact declaration when
supplied. No source parsing, language or transport discovery lives in the
renderer. The earlier subsystem list, layer diagram and three-dimensional City
presentation have been removed.

Genesis owns native file/symbol/dependency facts, one-root ownership, observation
validation and neutral controller joins. Older snapshots expose unavailable architecture capabilities
until explicit refresh. The browser lays out facts and selections; it never
parses project source or guesses pages from a directory.

The Architecture read response projects file ownership, public declaration ranges
and dependency evidence from the validated native artifact. It omits internal
symbols and duplicate parser details; it is the only read of the Machine City. Large subsystem interfaces search available declarations and render at
most 200 matches, with an explicit count and notice; Files retains access to the
remaining declarations.
Type-only facts remain in that response; dependency ranking excludes them from
ranks and cycles unless a caller asks to include them. Retained hidden views
suspend geometry observers and pending animation frames until reactivation.

The existing session-scoped service validates reads. Explicit refresh holds the
original source-work admission, invokes declared finite `Architecture inspection`
commands through the existing managed execution owner, validates bounded JSON,
then refreshes the native index against those hashed inputs. Failure, changed
source/Stack or corrupt observations retain the previous index. Cancellation is
scoped to this refresh and waits for cleanup. `Re-scan project` reads source and
existing Genesis explanations; it does not rewrite Program or generate function
explanations. Explicit runtime, workdir and Required files checks precede scanning.
`refresh.status` reports the actual stage and elapsed seconds from the running
refresh, with no index reads. The client polls once per second while refreshing
and shows bounded failed-command diagnostics inline, without another blocking
shell dialog. The request budget reaches the HTTP client through endpoint
resource write options. Re-scan project is only an Architecture toolbar option;
file views expose no project-scan action. Opening/Reload only reads indexes.
`Explain file` requests a short informational overview without requiring an index.
It reuses the private source-editor cache, invalidated by saved source and prompt
identity. `Explain function`
uses the existing on-demand Helper and source-hash cache for a short purpose
statement followed by steps. Supporting files show `Part of` links to the
explicit main source, which holds the authored Program context.

Status and view reads share a validated snapshot while its filesystem revision
is unchanged, including concurrent reads. The reader checks identity, size and
nanosecond modification/change times on each request, rejects changes during a
read, and retains at most two snapshots. Replacement, deletion and corrupt input
invalidate reuse; no persisted index is repaired by an ordinary read.

Core data and presentation are stack-neutral: registered navigation, filesystem
routing, local calls, HTTP, RPC and WebSocket observations share the same contract.
Technology owners provide inspectors; unavailable capabilities remain explicit.

`Architecture layout` is Vibe64-owned presentation grammar consumed through the
existing public Genesis boundary. Ordered groups declare Kind, Purpose and exact
root/name/description placements. Libraries are designated explicitly, not
inferred from package status or fan-in. Group order guides circle arrangement;
supporting owners are subdued and undeclared owners remain visible. No visible
layer or import rank is imposed. Native dependency evidence remains intact.
This presentation does not validate layering or library independence.

Example Stack presentation declaration (groups are listed top to bottom):

```markdown
## Architecture layout

### Group `requests`: Request handling
- Kind: `layer`
- Purpose: `Receives and coordinates application requests.`
- Subsystem: `services/orders`

### Group `shared`: Shared libraries
- Kind: `libraries`
- Purpose: `Reusable APIs independent of their consumers.`
- Subsystem: `common/math`

### Group `resources`: Supporting resources
- Kind: `support`
- Purpose: `Resources outside the runtime layer policy.`
- Subsystem: `assets`
```

Each member is one exact backticked canonical Genesis subsystem directory root.
Titles, responsibilities and Program membership come only from the Genesis map. Each root appears once. Missing roots never create source
owners. `- Nothing.` explicitly leaves placement unconfigured. Names and kinds
are presentation declarations, not inferred language or framework roles.

Architecture replaces the old subsystem list and layer prototype. Native Program
facts carry each capability's one owner, required main source, authored contract and cross-subsystem
source citations. The subsystem square and file browser reuse those facts, with
lazy contract rendering and explicit missing/invalid explanation states. The
main source is a reading anchor in the Program's owner, not necessarily an
executable entry point. Its file icon has a gold border, star and Main label.
Supporting files keep compact membership links instead of repeating its body.
Previously cached facts without an anchor remain readable until re-scanned;
the viewer never derives one from citations or imports.

## Usage

Architecture's **Map | Usage** switch shows, for one Genesis entry point, only
what it reaches. `src/server/usageWeb.js` answers four read actions
(`vibe64.system-graph.usage.entries.read`, `.web.read`, `.function.read`,
`.join`) on `/vibe64/system-graph/sessions/:sessionId/usage/*`:

- entries: the Machine City's `entryPoints`, searched, filtered by kind and
  paged by a numeric cursor;
- Imports: breadth-first over resolved, non-type-only file imports;
- Calls: breadth-first over exact and probable calls and operation bridges in
  the Genesis call web, read only when its bytes match the City's `callWeb`
  identity; pages and components start from every function in their file;
- function: one function's calls, callers and unresolved calls;
- join: recorded functions matched to the call web by hash and start, else
  by name within three lines.

Refresh first keeps `.genesis/call-web.json` out of Git through a managed
block in the clone's `.git/info/exclude`, because Genesis writes the call web
only for an ignored path. Answers carry the snapshot (`sourceIdentity`,
`callWebIdentity`, `callWebProblem` when Genesis reported the call web not
ignored, `builtAt`, `stale`). A joined function the call web cannot know says
why in `reason`: `not-ignored`, or `language` for a file without call coverage.
Answers stay bounded: subsystem counts always, nodes only for a zoomed
subsystem or a reach within `maxNodes` (300, at most 1,000), 50 unresolved
calls, 200 rows per function list, 1 MiB, `truncated` when cut. One parsed call
web per session source is cached for two sessions and ten idle minutes.

`src/client/usage/` holds the view. `Vibe64UsageView` keeps its address state
(`view`, `entry`, `mode`, `subsystem`, `recording`, `request`) with the
Architecture view, which writes it to the system dashboard route's query and
handles `usageOpenRequest` and `restoreRequest`. Recording reads the
`@local/vibe64-usage-recording` API and opens its Record dialog; that package
never depends on this one. `usageModel.js` only shapes server answers for
display.
