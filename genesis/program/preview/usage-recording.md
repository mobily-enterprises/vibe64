# Usage recording

People record which of their project's own functions run while they use
Preview or run one declared terminal Output target, counted per request or run,
so Architecture's Usage view can show what each one actually executed. A
recording indicator in the project header (on a phone, a strip below it)
follows it on every pane.

## Sources

- Main: `packages/vibe64-usage-recording/src/server/service.js`
- `packages/vibe64-usage-recording/src/server/Vibe64UsageRecordingProvider.js`
- `packages/vibe64-usage-recording/src/server/actions.js`
- `packages/vibe64-usage-recording/src/server/registerRoutes.js`
- `packages/vibe64-usage-recording/src/server/traceStore.js`
- `packages/vibe64-usage-recording/src/server/activeRecordings.js`
- `packages/vibe64-usage-recording/src/server/admission.js`
- `packages/vibe64-usage-recording/src/server/recordingFiles.js`
- `packages/vibe64-usage-recording/src/server/tracers/index.js`
- `packages/vibe64-usage-recording/src/server/tracers/nodejs.js`
- `packages/vibe64-usage-recording/src/server/tracers/python.js`
- `packages/vibe64-usage-recording/src/server/tracers/php.js`
- `packages/vibe64-usage-recording/runtime/node/preload.mjs`
- `packages/vibe64-usage-recording/runtime/node/instrument.mjs`
- `packages/vibe64-usage-recording/runtime/python/vibe64_usage/tracer.py`
- `packages/vibe64-usage-recording/runtime/php/ext/vibe64_usage.c`
- `packages/vibe64-usage-recording/runtime/php/build.mjs`
- `packages/vibe64-usage-recording/src/shared/contract.js`
- `packages/vibe64-usage-recording/src/client/useVibe64UsageRecording.js`
- `packages/vibe64-usage-recording/src/client/Vibe64UsageRecordingIndicator.vue`
- `packages/vibe64-usage-recording/src/client/Vibe64UsageRecordDialog.vue`
- `packages/vibe64-terminals/src/server/outputTargetTerminal.js`
- `packages/vibe64-terminals/src/server/launchPreviewProxy.js`
- `packages/vibe64-execution/src/host/execHelper.js`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `tests/server/vibe64UsageRecordingService.unit.test.js`
- `tests/server/vibe64UsageTraceStore.unit.test.js`
- `tests/server/vibe64UsageRecordingPreviewProxy.unit.test.js`
- `tests/server/vibe64UsageNodeTracer.unit.test.js`
- `tests/server/vibe64UsagePythonTracer.unit.test.js`
- `tests/server/vibe64UsagePhpTracer.unit.test.js`
- `tests/e2e/usage-recording.spec.ts`

## Public contract

The `vibe64.usage-recording.*` actions sit under one session's
`/usage-recordings` routes: list the recordable Output targets, start, read the
current recording, list recent ones, stop, dismiss, delete, page a recording's
requests and one request's functions, and record a Preview interaction (a
click, Enter or submit, with an optional component file). Editor clients send
interactions from the Preview page bridge while the recording runs. Each
interaction number is accepted once: a repeat is refused with the next free
number, and a recording names its highest accepted number so a page opened
later continues after it. Results
name project files, functions, positions and counts, never values.

## Recording lifecycle

Starting checks the session, that no recording runs in it, the target and its
parameters, then the host's admission decision, before anything is written.
The recording's directory sits in the session's `usage-recordings` folder,
outside the source. While a recording is registered in the server process,
every launch of its target carries the declared runtimes' tracers, and the
Preview proxy numbers each request, sends that id to the application and logs
the request without its query, with long ids and tokens in its path redacted.
The target restarts to load the recorder.

Node.js loads a preload that instruments project files as they load, Python
loads a `sitecustomize` recorder through `PYTHONPATH`, and PHP loads a small
observer module, built per PHP version, through `PHP_INI_SCAN_DIR`; each
tracer's variables are prepended to the target's own. Tracers count project
function entries per request, run or background scope and write them to files; the service reads those files incrementally and
announces changes to the session's viewers. Stop always succeeds and is safe to
repeat: it tells tracers to stop through `control.json`, then writes an index
of the results. Recordings also stop at their time, request and size limits,
when a terminal target exits, when the session closes, and after a read error.
A recording left running by an earlier server process ends as an error.

## Results

Each request, local request, terminal run and background scope that ran
project code becomes a row with its function and file counts. Background rows
hold a process's start-up and any requests a tracer cannot separate. A row's
functions carry their source position, count, and whether they are plumbing:
code that ran in most recorded requests. A file's top-level code is its
function named `""` at 1:1. Malformed trace lines, files over their limits and
unknown positions are skipped and counted, never trusted.

## Indicator

The selected session's indicator is teleported into the project header, wide
or compact by the width the header gives it. On a phone the page teleports it
instead into a full-width strip below the header, which keeps the header's
room for the pane controls; the strip shows the wide text, and tapping it
opens the results (or a failure's reason) without a menu. It shows starting,
recording time and count, stopping, ready and failed, offers Stop, Open
results and dismiss, and announces only state changes. Open results selects
the Architecture tool and asks its Usage view to show the recording.

## Security and retention

Only people with control of the session start, stop, dismiss or delete
recordings; readers can view them. Assistant tools cannot use these actions.
Recordings never contain headers, cookies, bodies, query strings, arguments or
values. Tracers open no port or socket. The Node.js preload is accepted only
from this package's runtime directory, by real path. A session keeps its 10
newest recordings within 64 MiB and 7 days; archives exclude them.
