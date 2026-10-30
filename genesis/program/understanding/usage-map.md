# Usage map

People start from one entry point (a page, component, route, action, library
export, command, job, Program operation or test file) and see only what it
reaches: the files it imports, the functions its exact and probable calls
reach, or the functions one recorded request actually ran. Architecture shows it as Usage beside Map.

## Sources

- Main: `packages/vibe64-system-graph/src/server/usageWeb.js`
- `packages/vibe64-system-graph/src/server/usageActions.js`
- `packages/vibe64-system-graph/src/server/usageRoutes.js`
- `packages/vibe64-system-graph/src/server/genesisCities.js`
- `packages/vibe64-system-graph/src/server/snapshotCache.js`
- `packages/vibe64-system-graph/src/client/usage/Vibe64UsageView.vue`
- `packages/vibe64-system-graph/src/client/usage/Vibe64UsageEntryRail.vue`
- `packages/vibe64-system-graph/src/client/usage/Vibe64UsageEntryPicker.vue`
- `packages/vibe64-system-graph/src/client/usage/Vibe64UsageWebCanvas.vue`
- `packages/vibe64-system-graph/src/client/usage/Vibe64UsageFunctionPanel.vue`
- `packages/vibe64-system-graph/src/client/usage/Vibe64UsageRecordingResults.vue`
- `packages/vibe64-system-graph/src/client/usage/usageModel.js`
- `packages/vibe64-system-graph/src/client/usage/useVibe64UsageWeb.js`
- `packages/vibe64-system-graph/src/client/components/Vibe64UiStoryboardView.vue`
- `tests/fixtures/usage-map/machine-city.json`
- `tests/fixtures/usage-map/call-web.json`
- `tests/server/vibe64UsageMapFixtures.unit.test.js`
- `tests/server/vibe64UsageWeb.unit.test.js`
- `tests/server/vibe64UsageRoutes.unit.test.js`
- `tests/client/vibe64UsageModel.vitest.js`
- `tests/client/vibe64UsageView.vitest.js`
- `tests/e2e/usage-map.spec.ts`

## Public contract

Four read-only `vibe64.system-graph.usage.*` actions answer on the active
session's routes under `/vibe64/system-graph/sessions/:sessionId/usage`:
`entries` (search, kind filter, numeric cursor), `web` (`imports` or `calls`,
optional `certainty: exact`, one zoomed `subsystemId`, `maxNodes` up to 1,000),
`function` (one function's calls, callers and unresolved calls, 200 per list)
and `join` (up to 1,500 recorded functions). They keep Architecture's
authority, are not offered to the assistant, and add `snapshot` (source
identity, call-web identity, build time and `stale`) to every answer.

Entries and Imports come from the validated Machine City; Calls come from the
Genesis call web named by the City's `callWeb` summary, read only when its
bytes match that identity. Imports follow resolved, non-type-only imports.
Calls follow exact and probable calls plus operation bridges; a page or
component starts from every function in its file. From a file's top-level code
Calls also follows the City's UI component uses as `renders` steps to each
rendered component's top-level code and functions, exact when the use is
resolved; crossings count renders apart from calls. A page entry is titled by
its registered address. Each reached function says
whether exact calls alone reach it. Unresolved calls stay listed, never
followed. Without a call web, Calls says so and Imports still works; when
Genesis reported the call web not ignored by Git, the snapshot's
`callWebProblem` says so and Usage names the fix. A joined function the call web
cannot know carries a `reason`: `not-ignored`, or `language` for a file whose
language the scan reads no calls in.

Every answer is bounded: subsystems always, files or functions only for a
zoomed subsystem or when the whole reach fits `maxNodes`, at most 50
unresolved calls, and at most 1 MiB, with `truncated` when anything was left
out. No edge names a node the answer does not return. One parsed call web per
session source stays cached (two sessions, released after two idle minutes or
when a scan of that source starts) and reloads when the City names a new
identity.

A join matches a recorded function by file hash and exact start, else by name
within three lines when unique; a changed file is `stale`, anything else
`none`. A file's top-level code and a function opening the file both start at
1:1; the recorded name picks the function, any other name the top level.

The system dashboard's address keeps Usage's state (`view`, `entry`, `mode`,
`subsystem`, `recording`, `request`), so reloads and the source viewer's way
back restore it. Map's pages and zoomed views offer Show usage. A recorded web
server that runs every request in one process is labelled "Not separated per
request for this server" and shows everything that ran.
