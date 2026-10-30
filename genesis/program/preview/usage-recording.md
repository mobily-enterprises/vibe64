# Usage recording

People record which of their project's functions run while they use Preview or
run a declared terminal Output target, so Architecture can show what each
request or run actually executed. Recording is being added; so far the package
registers no routes or actions.

## Sources

- Main: `packages/vibe64-usage-recording/src/server/Vibe64UsageRecordingProvider.js`
- `packages/vibe64-usage-recording/src/shared/contract.js`
- `packages/vibe64-usage-recording/src/server/admission.js`
- `packages/vibe64-usage-recording/src/server/recordingFiles.js`
- `packages/vibe64-usage-recording/src/server/tracers/index.js`
- `packages/vibe64-usage-recording/src/client/useVibe64UsageRecording.js`
- `tests/server/vibe64UsageRecordingContract.unit.test.js`

## Public contract

The shared contract fixes recording, request, interaction and scope
identifiers, the recording limits, the Preview request and interaction headers,
the three tracer environment variables and the `vibe64.usage-trace.v1` line
format. Recordings belong in the session's `usage-recordings` directory. A host
may provide `vibe64.usage-recording.admission` to refuse a recording with a
reason; without one, every recording is admitted. Every runtime tracer
currently reports that recording for its runtime is being added.
