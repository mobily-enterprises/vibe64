# Crash records

Every abnormal end of the editor server is recorded and shown until someone who
can fix its cause has seen it, because a crash is a defect in Vibe64 itself.

## Sources

- Main: `packages/studio-health/src/server/crashes.js`
- `server.js`
- `packages/vibe64-core/src/server/crashRecords.js`
- `packages/vibe64-core/src/server/crashWatch.js`
- `packages/vibe64-core/src/shared/crashText.js`
- `packages/studio-health/src/server/studioHealthActions.js`
- `packages/studio-health/src/server/registerRoutes.js`
- `packages/studio-health/src/server/inputSchemas.js`
- `packages/studio-health/src/server/StudioHealthFeature.js`
- `src/composables/useVibe64Crashes.js`
- `src/lib/vibe64CrashPresentation.js`
- `src/components/studio/Vibe64CrashBanner.vue`
- `src/components/studio/Vibe64CrashesScreen.vue`
- `src/components/StudioAppShellLayout.vue`
- `src/pages/app/crashes.vue`
- `tests/server/crashRecords.unit.test.js`
- `tests/server/crashRecordsServer.integration.test.js`
- `tests/e2e/support/start-crash-test-server.mjs`
- `tests/e2e/crash-banner.spec.ts`
- `tests/client/crashPresentation.vitest.js`
- `docs/colleague-usage/crashes.md`

## Public contract

`startServer` (`server.js`, used by public's `bin/server.js` and a host's own
launcher alike) starts a crash watch once the server listens. The watch holds a
running marker, its heartbeat rewritten every 30 s, in
`<systemRoot>/crashes/running/`. An uncaught error or unhandled rejection is
recorded synchronously from Node's `uncaughtExceptionMonitor`; nothing catches
it, so Node still prints it and exits with code 1 for the supervisor to restart.
Any other non-zero exit is recorded from the exit handler, and a stop that
fails from the signal shutdown. A clean stop removes the marker and records
nothing, and so does a stop that overruns its deadline: it is still the stop
that was asked for, ending what runs on its schedule, and only logs
`vibe64.server.shutdown_timeout` before its exit 1. A process that left only
its marker (SIGKILL, an out-of-memory kill, power loss) is recorded as stopped
without a trace by `createServer` at the next start, after the state-upgrade baseline and before anything resumes
work, with its last heartbeat and, newest only, the exit a host's supervisor
wrote to `crashes/last-exit.json` (`{ result, code, status }`, as systemd's
`SERVICE_RESULT`, `EXIT_CODE` and `EXIT_STATUS`). A marker is still live only
while its pid runs, in the same boot, with the start time it recorded.

A record is one private JSON file, `crashes/records/<id>.json` (folders 0700,
files 0600), written whole and synced: `{ id, at, pid, kind: "fatal-error" |
"stopped-without-trace", origin, error: { name, message, code, stack } | null,
uptimeSeconds, version, activeTurns, resumed, lastHeartbeatAt, exit,
acknowledged: { at, by: { username, displayName } } | null }`. Messages and
stacks are redacted as the log redacts them and bounded. Ids sort by time. The
start after a crash counts the turns still marked working into the newest
record still to count them (`activeTurnsPending`); the resume work sets
`resumed` with `recordVibe64CrashResumedTurns` and finds the crash that
stopped a turn with `crashForInterruptedTurn`. The newest 100 records are kept;
the cap counts what it removes, and how many of them nobody acknowledged, in
`crashes/removed.json` before removing them, so none goes silently. A record
that cannot be read is listed as unreadable and not counted.

`readVibe64CrashRecords({ systemRoot })` (`@local/vibe64-core/server/crashRecords`,
Node only) returns `{ records (newest first), unacknowledged, removed: { count,
unacknowledged, lastRemovedAt } }` for the editor and for a host's own report.

Studio Health serves them: `GET /api/studio/health/crashes/summary` (every
person: the newest unacknowledged record and the count; members get only its
time, kind and AI-work counts), `GET /api/studio/health/crashes` and
`POST /api/studio/health/crashes/acknowledge` with `{ through }` (the workspace
owner, or the person at their own computer, who has no signed-in user; others
get 403 `vibe64_owner_required`). Acknowledging records who and when on every
unacknowledged record up to `through`, the newest the person was shown, and
clears the removed count; a later crash stays unacknowledged. None of these is
an assistant tool. The editor's shell layout shows the red banner above the app
bar on every page (owner: the error, **See crashes**, **Copy for a bug report**,
**Acknowledge**; member: a smaller line without the error), re-read when the
realtime connection returns and when the tab is focused, and `/app/crashes`
lists every record with its stack. Its buttons draw in the banner's on-colour
(Acknowledge filled, the others outlined), so each reads as enabled on the red;
the app's primary default looked disabled on a filled banner (28 Nov 2026,
`tests/e2e/crash-banner.spec.ts`).
