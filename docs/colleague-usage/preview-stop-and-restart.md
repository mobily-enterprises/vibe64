# Stopping and restarting Preview

This continues [Previewing a web application](preview.md). It covers **Stop
preview**, what Preview shows after a stop or a platform restart, and what
**Start preview** and **Restart preview** do while another run is starting or
running.

The top Preview toolbar shows **Stop preview** while the application is running.
Stop waits for the application's owned work and managed browser to close; it
does not close the coding session, chat, source checkout or shared services.
On managed hosts, service cleanup runs before remaining processes are terminated.
Wait for Stop to finish; a cleanup failure is not a successful stop.
Stopping Preview closes its browser process but keeps the coding assistant's
managed-browser registration. The same assistant can run another managed browser
check or test suite afterward without reopening its conversation.
It stays stopped after navigation, reload or reopening the session. The pane
then shows **Preview stopped**, and both its button and the toolbar's read
**Start preview**; use either to run it again deliberately.

A Preview also stops when the platform restarts, for example during an update.
The pane then removes the old page instead of leaving it looking alive. It shows
**Preview state was lost after a server restart** with **Restart preview**, or,
once that has been seen, **Preview is not running** with a **Start preview**
button in the middle of the pane. Starting it runs the session's current code.
A Preview tab opened before the platform restart needs opening again from the
editor; its old access no longer works.
If Stop reports incomplete cleanup, retry Stop before starting. Browser tests
may temporarily run an isolated target, then restore the prior stopped choice.
Managed suites without `--target` also restore the previous running or stopped
Preview state, including after an assertion failure or cancellation. An explicitly
supplied external `PLAYWRIGHT_BASE_URL` does not start or stop managed Preview.
The selected target and its parameter values remain saved while stopped, including
after browser tests or an editor restart, for the next explicit Start.
If Preview reports an invalid saved stop state, use the explicit Stop action
before retrying Start; automatic recovery does not overwrite that state.
Colleague can offer the existing authorized stop/start actions, but a how-to
question alone does not authorize either action.
Retrying the same output reuses its running application when its settings and
environment still match. It does not start another process merely because a
new Preview address could be allocated. Use **Restart preview** when you intend
to replace that run.
When the coding agent starts the Preview, open tabs update to show it starting.
If a tab still shows an older state, such as **Preview stopped** while the
agent's start is booting the app, pressing **Start preview** or **Restart
preview** there shows the run that is starting or running instead of replacing
it; the tab's own automatic start and recovery do the same. Press **Restart
preview** again on that run to restart it.
Restarts asked for close together, from tabs, the coding agent or the restart
after workspace setup, give one new run: a restart finds the run another one
started after it was asked for, and keeps it. A restart asked for after that run
started replaces it as usual.
A restart never cuts the application's Prepare steps (its database migration or
seed, before the server starts). When the run is still in one, the restart waits
for it to finish, and Preview reads **Waiting for the database step to finish**
meanwhile; the coding agent's `preview restart --wait` and `preview status` say
the same. It waits at most five minutes, as long as Preview may take to become
ready, then restarts anyway, so a restart never stays stuck behind a step that
does not end. **Stop preview** stays immediate, also during that step: it stops
at once, and the stopped Preview says **Preview was stopped during its database
step (Prepare), which may be half done**, which also ends a restart that was
waiting for it. Start Preview again to run the step again; if it then fails on
what the cut step left (for example a migration lock), fix that in the
application's database before starting again.
Stopping or restarting a Preview includes processes in its child groups,
that are owned by that output. Wait for cleanup to finish before starting
another run. If cleanup fails, open **Resources** for the reported operation
and retry only after its running work has been stopped.
