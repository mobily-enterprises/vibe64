# Inspect application resource estimates

A project can describe initial memory estimates for its real operations without
turning those hints into required capacity or host settings.

## Sources

- `packages/vibe64-genesis/src/server/index.js`
- Main: `packages/vibe64-genesis/src/server/resourceEstimates.js`
- `packages/vibe64-genesis/src/server/outputs.js`
- `packages/vibe64-genesis/src/server/workspaceSetup.js`
- `packages/vibe64-genesis/src/server/stackOperation.js`

## Public contract

`inspectVibe64ResourceEstimates()` returns `vibe64.resource-estimates.v1` from the
opaque project-owned `Resource estimates` Stack section. Outputs and Workspace
setup inspections also include that normalized result. Only the Genesis package
boundary reads this source; Genesis itself does not interpret memory fields.

Each referenced output must exist in the same Stack snapshot. Interactive outputs
declare complete startup and running typical/high pairs; finite outputs and
declared Workspace setup use one execution pair. Strict positive bounded integer
MiB values normalize to bytes, with typical no greater than high. Duplicate
operations, duplicate/unknown fields and command entries are rejected. The parser
accepts at most 64 KiB and 2048 lines, and no record for an undeclared operation.

An absent section or explicit `- Nothing.` reports `unconfigured`; malformed
estimates report `invalid`, diagnostics and an explicit fallback reason without
returning partial estimates. Neither case changes the separately owned operation's
readiness or availability. Changing estimates alone does not invalidate the
successful workspace preparation recipe. A Stack identity mismatch between reads
requires reinspection rather than a fallback for mismatched source.

Ready results include exact Stack/section identities, normalized estimate identity,
provenance and separate operation phases. They do not include measured usage,
learned minima, granted limits or an admission decision. Those remain the
execution host's responsibility. Source inspections never rewrite declarations
or mix host observations into the project contract.

One reader plans with an estimate itself: a browser-test run on a test target
that serves several app servers sizes their count by one app server's measure,
plus 512 MiB for each worker's Chromium, against the memory free for its work.
The measure is the peak the last run's largest app server reached, as JSKIT's
launcher records it in the target's folder (`browserTestServerPeakBytes()` of
`@jskit-ai/jskit-catalog/browser-tests`), else the target's Running high
estimate, else 1.5 GiB a worker. The target's listing carries that estimate as
`runningHighBytes` and its folder as `workdir` (`vibe64OutputTargets.js`,
`outputTargetPreviewTests.js`, `browserTestWorkers.js`). The host still admits
the run itself.
