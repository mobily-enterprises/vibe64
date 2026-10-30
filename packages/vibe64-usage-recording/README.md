# @local/vibe64-usage-recording

Records which of a project's own functions run while a person uses Preview or
runs one declared terminal Output target, counted per request or run. The
Architecture Usage view (`@local/vibe64-system-graph`) presents the results;
this package owns the recording, its files and the header indicator.

## How a recording runs

1. `POST …/usage-recordings/sessions/:sessionId` checks the session (active,
   with a source), that no recording runs, the target and its parameters, then
   asks the admission decision. Only then does it create
   `<sessionRoot>/usage-recordings/<rec_id>/` (mode `2770`), write
   `control.json` `{"state":"recording"}` and `recording.json`, and register the
   recording in this process (`server/activeRecordings`).
2. The target restarts in the background. Preview restarts the session's
   Preview; a terminal target starts with its parameters. While the recording
   is registered, every launch of that target gets the tracers' environment
   (merged with `mergePrependEnvironment`) and, for Node.js, the
   `usageRecordingPreload`, which the execution layer turns into
   `NODE_OPTIONS=--import=<preload>` only when its real path is inside this
   package's `runtime/node` directory.
3. The Preview proxy numbers each proxied request (`r_000001`, …), sends that
   id upstream in `x-vibe64-recording-request`, and logs method, path (never
   the query), status and time to `requests.ndjson`. It strips both recording
   headers from every browser request and WebSocket upgrade. A valid
   `x-vibe64-interaction` id is logged with the request while recording.
   Script, style, image and font loads (`sec-fetch-dest`, development-server
   module paths such as `/@vite/`, or a source or asset extension when the
   browser sends no `sec-fetch-dest`) get no id and only increase
   `recording.requestLog.assets`. Past 20,000 logged lines,
   `recording.requestLog.full` becomes true and later requests are not logged.
4. Tracers write `hits-<runtime>-<pid>[-n].ndjson`
   (`vibe64.usage-trace.v1`). The service reads them incrementally and
   publishes `vibe64.usage-recording.changed` to the session's viewers at most
   every 2 seconds.
5. Stop always agrees: it writes `control.json` `{"state":"stopping"}`,
   unregisters, waits briefly for tracers to go idle, reads the rest and
   writes `index.json`. It also stops at 10 minutes, 2,000 proxied requests,
   the trace size limit, a read error, when a terminal target exits, and when
   the session closes. A recording left running by an earlier server process
   ends as an error when next read.

States: `starting`, `recording`, `stopping`, `stopped`, `failed` (the target
could not start) and `unavailable` (the target never loaded a recorder, or
exited first). Failure reasons are on `tracers[].reason`.

## API

Base `/api/app/:projectSlug/vibe64/usage-recordings/sessions/:sessionId`;
each route runs the `vibe64.usage-recording.<operation>` action. Commands need
session control (the authority that controls Preview); queries need read
access. All are excluded from assistant tools.

| Method and path | Action | Result |
| --- | --- | --- |
| `GET /targets` | `targets.read` | `{ targets: [{ id, kind, label, runtimes, available, reason, parameters }] }` |
| `POST /` `{ targetId, parameters? }` | `start` | `{ recording }` |
| `GET /current` | `current.read` | `{ recording \| null, serverTime }`: the running one, else the newest undismissed one stopped within 10 minutes |
| `GET /` | `list` | `{ recordings }`, newest first, at most 10 |
| `POST /:recordingId/stop` | `stop` | `{ recording }`, idempotent |
| `POST /:recordingId/dismiss` | `dismiss` | `{ recording }` |
| `GET /:recordingId/requests?cursor&limit&q&includeEmpty` | `requests.read` | `{ requests, interactions, nextCursor }` |
| `GET /:recordingId/requests/:requestId/functions?cursor&limit` | `request-functions.read` | `{ functions, total, truncated }` |
| `POST /:recordingId/interactions` | `interaction.record` | `{ ok }` |
| `DELETE /:recordingId` | `delete` | `{ ok }` |

A request row is `{ id, method, path, status, startedAt, durationMs,
interaction, functionCount, fileCount }`. A process's work outside any request
(its start-up, timers, or every request of a server whose requests cannot be
told apart) is a row with `kind: "background"` and null method, path and
status. Vibe64's launch readiness check sends the reserved request id
`r_000000` while its launch records, which the proxy never assigns; it is a row
with `kind: "readiness"`, likewise without method, path or status. Neither
counts as a request or towards plumbing. A function is `{ path, hash, name, start, end, count, plumbing }`; a
file's top-level code is the function named `""` at 1:1.

Refusals: 409 `vibe64_usage_recording_session_inactive` or
`vibe64_usage_recording_active`; 422 for an unknown or unavailable target or
invalid parameters; 503 `vibe64_usage_recording_refused` with
`details.reason` when the host's admission decision refuses.

`recording.sourceIdentity` is the Machine City's `architecture.sourceHash` at
start, or null. Genesis sorts keys and the City can be tens of MiB, so start
streams the file and follows only that field.

## Host seams

- `vibe64.usage-recording.admission` (`server/admission`): an optional async
  `({ sessionId, projectSlug, targetKind, runtimes }) → { admitted, reason }`.
  The default admits.
- `server/recordingFiles`: where a session's recordings are, for hosts that
  account for disk use.
- `server/tracers`: the tracer interface and `mergePrependEnvironment`.

## Storage and privacy

Recordings stay outside the source and are not part of session archives. A
session keeps at most 10 recordings, 64 MiB and 7 days of them; older ones are
deleted when a recording starts or the session's current recording is read.
Files hold function positions, counts, request methods, paths without query
(each UUID and each long hex or base64url token segment saved as `[redacted]`),
status codes, times and interaction labels: never headers, cookies, bodies,
query strings, arguments or values. Tracers open no port or socket; they write
only files in the recording directory.

## Client

`@local/vibe64-usage-recording/client` exports `useVibe64UsageRecording`,
`Vibe64UsageRecordDialog` ("Record what runs") and
`Vibe64UsageRecordingIndicator`, which the session view teleports into the
project header (`#studio-home-shell-usage-recording`). It emits `open-usage`
`{ recordingId }`.
