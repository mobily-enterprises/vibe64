# Need help

When something is wrong that a session's AI can't fix itself (the platform, a
managed service, access it lacks), it raises Need help instead of waiting or
guessing, and keeps working on what it can, because a request for help that
nobody sees helps nobody. The person sees it on the session and its tab,
answers or clears it, and a host may forward it to whoever can help.

## Sources

- Main: `packages/vibe64-terminals/src/server/needHelp/needHelpService.js`
- `packages/vibe64-terminals/src/shared/needHelp.js`
- `packages/vibe64-terminals/src/server/needHelp/needHelpHost.js`
- `packages/vibe64-terminals/src/server/needHelp/needHelpActions.js`
- `packages/vibe64-terminals/src/server/needHelp/registerNeedHelpRoutes.js`
- `packages/vibe64-terminals/src/server/needHelp/NeedHelpFeature.js`
- `packages/vibe64-terminals/src/server/needHelp/agentNeedHelpCommand.js`
- `packages/vibe64-terminals/src/server/agentSessionCommand.js`
- `src/lib/vibe64NeedHelp.js`
- `src/components/studio/vibe64-session/Vibe64NeedHelpDialog.vue`
- `src/components/studio/vibe64-session/Vibe64SessionToolbar.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotSessionHeader.vue`
- `tests/server/needHelp.unit.test.js`
- `tests/client/needHelp.vitest.js`
- `docs/colleague-usage/need-help.md`

## Public contract

A session's Need help is its metadata `need_help`, one JSON document
`vibe64.need-help.v1`: its id, when and by whom (`agent` or `person`) it was
raised, its messages oldest first (`{ at, from, author, kind: request |
answer, text }`, each at most 2,000 characters, the first and the newest 19
kept) and `forwarded` (`{ state: sent | failed, at, to, reference, message }`,
or null). A session has one at a time: a raise while one is open adds a
request to it. Every change is written under the session record's lock, one
per session at a time, and published as `need-help-changed` with a list
refresh; the session list and the session's page carry it in `metadata`.
A new key, written in its current format, needs no state upgrade.

The session's AI runs `vibe64-helper need-help raise <message>` (or `raise -`
with the message on stdin), `read [--json]` and `clear`, over the session
control socket (`/agent-session-command/need-help`, `{ operation, text? }`,
each operation refusing a field it doesn't read). A raise acts for the person
whose request the AI works on. The person's pages use
`POST /api/app/:slug/vibe64/sessions/:sessionId/need-help { text }` (raise or
add a request), `POST …/need-help/answer { text }` and
`DELETE …/need-help`, none an assistant tool. An answer is told to the main
chat's AI (`noteMainChat`, steering a running turn, else leading the next
message).

A host provides `vibe64.need-help.host` (`forward`), optional: each raise
whose flag hasn't reached it yet (none, or a failed one) is forwarded inside
the session's project with the session, project, flag, new message and the
person, bounded at 20 s; its answer `{ to, reference }` is kept as `sent`, a
refusal as `failed` with its words, and null leaves the flag unforwarded.
Public names no host and sends nowhere itself.

The session tab shows a lifebuoy icon and a details line, and the header a
chip: **Need help**, **Need help · no answer yet** once the newest request has
waited 15 minutes unanswered, or **Need help · answered**.
