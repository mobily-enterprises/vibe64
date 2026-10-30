# List sessions

People see every saved session, newest first, in the browser and from the
command line.

## Sources

- Main: `packages/sessions/src/server/service.js`
- `packages/sessions/src/server/store.ts`

## Public contract

`listSessions({ limit })` returns at most `limit` sessions with cleaned titles.

## Implementation map

- `listSessions` reads the stored records and cleans each title.
