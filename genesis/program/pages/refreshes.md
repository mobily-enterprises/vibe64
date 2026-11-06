# Page refreshes

A page can keep itself up to date: on a schedule, Vibe64's server writes the
page a new `data.json` that its layout reads, as the person who set the
schedule, from the project as last saved. Nothing runs between refreshes.

## Sources

- Main: `packages/vibe64-pages/src/server/pageRefreshes.js`
- `packages/vibe64-pages/src/server/pageRefreshSchedule.js`
- `packages/vibe64-pages/src/server/pageRefreshRecords.js`
- `packages/vibe64-pages/src/server/pageRefreshSource.js`
- `packages/vibe64-pages/src/server/service.js`
- `packages/vibe64-pages/src/server/pageStore.js`
- `packages/vibe64-pages/src/server/pagesActions.js`
- `packages/vibe64-pages/src/server/Vibe64PagesFeature.js`
- `packages/vibe64-pages/src/client/Vibe64PageRefreshLog.vue`
- `packages/vibe64-ai-tasks/src/server/kinds/pageRefresh.js`
- `packages/vibe64-ai-tasks/src/server/pageRefreshTasks.js`
- `packages/vibe64-packaging/src/server/projectCommands.js`
- `tests/server/vibe64PageRefreshes.unit.test.js`

## Public contract

- The session agent sets a refresh with
  `vibe64-helper pages refresh <page-id> (--every 30m|2h | --daily 07:30 [--time-zone Area/City]) (--command <script> | --prompt "what to do")`
  and stops it with `--off`; `pages data <page-id> <data.json>` adds a version
  with a new `data.json` and every other file of the current version kept.
  Setting a refresh again replaces it, starts its schedule afresh and keeps its
  run log. A refresh runs as whoever set it: the person behind the session's
  latest message. An archived page refuses a new refresh.
- A schedule is every 15 minutes to 24 hours (`m`, `min`, `minutes`, `h`,
  `hours`), or daily at `HH:MM` in an IANA time zone, else Vibe64's own. A period
  counts from when it was set. Only the next time is kept (`nextAt`), so turns
  missed while Vibe64 was stopped become one catch-up when it starts, and the
  rhythm carries on from when the schedule was set.
- A command refresh (`--command`, the usual one) runs its script (`.mjs`, `.js`,
  `.cjs` with `node`, `.py` with `python3`, `.sh` with `bash`; at most 256 KiB)
  in a throwaway shared-object clone of the saved commit, in
  `<project state>/pages/.refresh-runs/` (where a host that confines project
  commands runs them; leftovers are removed at start), through the command
  gateway as the app, with a credential-free empty `HOME`, `CI=1`, no installed
  packages, `VIBE64_PAGE_ID` and `VIBE64_PAGE_DATA`, the file it writes. It stops
  after 5 minutes. The saved commit is the tip of the project's default branch
  in its own folder, Vibe64's repository for it, or the GitHub copy that Save
  updates, by repository mode; a project with none fails the run. The new data
  must be JSON of at most 5 MiB. The clone is removed when the run ends.
- A prompt refresh (`--prompt`, at most 4000 characters) starts a `page-refresh`
  AI task in the session the refresh was set from, as the person who scheduled
  it (the task's `vibe64User`, so its turns use that person's AI access), given the prompt, the saved
  commit and the current `data.json`, and told to write the new data with
  `vibe64-helper pages data` and never to ask. The task is Done once the page's
  version has gone past the one it started from. The scheduler reads the task
  every 10 seconds: once the page has new data the run has refreshed and its
  task is closed (or cancelled, if it still waits); a task that needs a person
  is cancelled, because nobody is there, and the run fails. Another AI task open
  in that session skips the turn. A session that is no longer open, or an AI
  account that isn't available, fails the run and pauses the schedule with why.
- A refresh never piles up: a turn that falls due while one runs, or while the
  page is archived or paused, is skipped and the next time is kept. A run that
  fails keeps the page's version as it was; three failures in a row pause the
  schedule ("The last 3 refreshes failed."). Refreshed runs reset the count;
  skipped and cancelled runs leave it.
- Cancel is always accepted: a script is aborted, a starting AI task is
  cancelled as soon as it exists, and a followed one is cancelled and read again
  at once. A task someone cancels in the session's AI task window ends its run
  as cancelled too. Archiving cancels a running refresh and stops the schedule; restoring
  starts it from then. Deleting the page deletes its refresh. When Vibe64 stops,
  scripts are aborted; at start, a script run left behind ends as cancelled, and
  a prompt refresh's task is followed again.
- Storage: `<project state>/pages/<page id>/refresh.json` (contract
  `vibe64.page-refresh.v1`: kind, schedule, script name or prompt, session,
  who scheduled it and when, paused and why, failures in a row, next time, the running
  run, and the last ten runs, each with its outcome, message, the last 8000
  characters of its log, the version it made and, for an AI run, its task) and
  `refresh/<script>`, readable only by Vibe64.
- Project members steer it through actions behind the project access check,
  never AI tools: `vibe64.pages.refresh.runs`
  (`GET /api/app/:slug/vibe64/pages/:pageId/refresh/runs`, newest first, with
  logs), `vibe64.pages.refresh.run`, `.cancel`, `.pause` and `.resume`
  (`POST …/pages/:pageId/refresh/run|cancel|pause|resume`). Refresh now refuses
  while a refresh runs or the page is archived, and leaves the schedule as it
  was. Pause records who paused it; Resume runs it as the member who resumed it,
  from then on, with the failure count cleared.
- Every page summary carries `refresh`: kind, schedule text ("Every 30 minutes",
  "Every hour", "Daily at 07:30 (Europe/Rome)"), who scheduled it, session, next time,
  paused and why, failures, the running run and the last run without its log.
