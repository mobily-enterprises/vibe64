# Usage map

People start from an entry point (a page, component, route, action, library
export, command, job, Program operation or test file) and see which subsystems
and functions it reaches through Imports, Calls or a Recording. The usage view
is being added; its shared fixtures describe the documents it reads.

## Sources

- Main: `packages/vibe64-system-graph/src/server/genesisCities.js`
- `tests/fixtures/usage-map/machine-city.json`
- `tests/fixtures/usage-map/call-web.json`
- `tests/server/vibe64UsageMapFixtures.unit.test.js`

## Public contract

The Machine City's architecture gains `entryPoints` and a `callWeb` summary
whose `identity` names the separate `.genesis/call-web.json` document. Static
edges are Imports or Calls, each call exact, probable or unresolved; recorded
functions ran. No usage routes exist yet.
