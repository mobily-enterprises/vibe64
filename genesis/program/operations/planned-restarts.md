# Planned restarts

A host that restarts the editor's machine for an update gives five minutes'
notice through a file. The editor pauses the work a restart must not cut,
tells every running AI turn, records what the restart stops, and afterwards
resumes the work and says what happened, so a planned restart costs nothing
but the minutes it takes.

## Sources

- Main: `packages/vibe64-core/src/server/plannedRestart.js`
- `packages/vibe64-core/src/server/plannedRestartNotice.js`
- `packages/vibe64-core/src/server/Vibe64PlannedRestartProvider.js`
- `packages/vibe64-terminals/src/server/servicePlannedRestart.js`
- `packages/vibe64-terminals/src/server/plannedRestartSteering.js`
- `packages/vibe64-terminals/src/server/serviceShutdown.js`
- `packages/vibe64-terminals/src/server/serviceTurnRecovery.js`
- `packages/vibe64-terminals/src/server/assistantRoutingDelivery.js`
- `packages/vibe64-terminals/src/server/assistantRoutingInterruptions.js`
- `packages/vibe64-terminals/src/server/assistantRoutingOwedSteps.js`
- `packages/vibe64-terminals/src/server/codexGitCommand.js`
- `packages/vibe64-terminals/src/server/agentSessionCommandRun.js`
- `packages/studio-health/src/server/studioHealthActions.js`
- `src/composables/usePlannedRestart.js`
- `src/lib/vibe64PlannedRestartPresentation.js`
- `src/components/studio/Vibe64PlannedRestartBanner.vue`
- `src/lib/vibe64ClientUpdateOffer.js`
- `tests/server/plannedRestart.unit.test.js`
- `tests/server/plannedRestartResume.unit.test.js`
- `tests/client/vibe64PlannedRestartPresentation.vitest.js`
- `tests/client/vibe64ClientUpdateOffer.vitest.js`
- `docs/colleague-usage/planned-restarts.md`

## Public contract

The host names the notice file in the editor's environment,
`VIBE64_PLANNED_RESTART_NOTICE_FILE`; without it no notice is read. The file is
`{ schema: "vibe64.planned-restart.v1", id, restartAt, expiresAt, reason,
bootId }`, exactly these fields, `expiresAt` at most 3 minutes after
`restartAt`, `bootId` this machine's `/proc/sys/kernel/random/boot_id`. It is
obeyed only while valid, unexpired and written in this boot; otherwise it is
ignored with one warning. Removing it before `restartAt` cancels the restart.
The reader reads it every 5 seconds and at its expiry.

While a notice is in force every crucial operation is refused with
`vibe64_planned_restart` (HTTP 409), a sentence naming the restart time in UTC
and `details.restartAt`; nothing already running is stopped. The one list is
`CRUCIAL_OPERATIONS` in `plannedRestartNotice.js`: Save, Update, Publish to
staging, Deploy to production, workspace preparation, an output's Prepare
steps, adding, archiving and restoring a project, creating and archiving a
session, Env saves, the plan handoff, Senior's review or a plan's pass (owed,
started after the restart), and the AI's `git` commit, push and rebase through
the Git gateway. A host gates its own operations through the container token
`vibe64.planned-restart` (`refusal({ operation, label?, typicalMs? })` returns
null or `{ code, message, restartAt }`; `status()`), and its pages read
`usePlannedRestart()`.

When a notice comes, every chat whose turn runs (Main chat and temporary
chats in every open session) is steered with Vibe64's note through its own
steer; a turn starting in the window gets the note first. Helper turns are not
chats and are never steered. Each notice has a durable record,
`<systemRoot>/planned-restarts/<id>.json` (the newest 20 kept): the chats told,
the crucial operations and session commands running at the notice and at the
editor's stop (written synchronously as shutdown begins), and how it ended.

An editor that starts at or after a minute before `restartAt`, finding a
record still in force and no notice file, restarted: the turns it recovers
resume with "Vibe64: Restarted at HH:MM UTC. This was stopped: …. Continue from
your notes.", and so does each chat the record says was told whose turn ended
before the restart (its request no longer working, sent by an earlier run, not
stopped by the person, not a goal's or an AI task's), in the same conversation
as its sender, its entry the planned "carried on" line (`toldBeforeRestart`,
routing's `resumeAfterPlannedRestart`). A told chat at work is resumed as an
interrupted turn alone, and a request this server has sent since is never
resumed again (`sent-since-restart`), so no chat is resumed twice however often
recovery checks again; a chat the person stopped is skipped as
`stopped-by-person`, and `recovery_finished` names each skipped session and
why. `GET
/api/studio/health/planned-restart` reports the restart
for 30 minutes (`restarted: { id, restartedAt, reason, sessions, stopped }`,
with `active`). Otherwise the restart did not
happen: every told chat hears "Vibe64: the planned restart didn't happen; carry
on.", and owed steps start.

The shell layout shows the amber banner (time, countdown, reason) while a
notice is in force, and once afterwards a green "Restarted for an update at
HH:MM. Nothing was lost." with what stopped, **Dismiss**, and, when JSKIT
realtime's served client build differs from the page's, "Reload to get the
latest version." with **Reload**. That offer is JSKIT's client update, which
`src/error.js` routes into this banner (`src/lib/vibe64ClientUpdateOffer.js`), so
an update is one notice; an update without a planned restart shows the offer's
own sentence in the same banner, blue. While the page says **Updating…** the
banner steps aside. Its buttons draw in the banner's on-colour (Reload filled,
Dismiss outlined), as the crash banner's do: the app's primary default sat faded
on its colour (28 Nov 2026).
