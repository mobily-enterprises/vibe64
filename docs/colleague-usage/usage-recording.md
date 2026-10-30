# Record what runs

A recording shows which of the project's own functions ran while you used the
app in Preview, or while one of the project's commands ran, counted for each
request or run. Use it to see what a page, button or command really executes.
The results open in **Architecture** › **Usage** › **Recording**; see
[Usage map](usage-map.md) for reading them.

Vibe64 saves only which functions ran, how often, and for each request its
method, path (without the part after `?`), status and time. It never saves
request contents, headers, cookies, query strings, function arguments or any
other data, and the recorder opens no network port.

## Start a recording

1. Open the session's **Dashboard**, then **Architecture**.
2. Choose **Usage** at the top, then **Recording**.
3. Select **Record**. The **Record what runs** dialog opens (full screen on a
   phone).
4. Choose what to record:
   - **Preview (restarts Preview)** records the app you use in Preview. Preview
     restarts so the recorder can load.
   - **Run <command>** records one run of a declared terminal command. Fill in
     its fields; required ones say **(required)**.
   A choice that cannot be recorded is greyed out with the reason, for example
   **Recording not available for `go`**.
5. Select **Start recording**.

After Preview starts recording, **Recording — use Preview now** appears with
**Go to Preview**, which shows the Preview pane. Use the app normally: each
page load, button or form that reaches the server becomes a request in the
results. A command starts running at once and the recording follows that run.

Only one recording runs in a session at a time. Other sessions are not
affected, and a recording in another session keeps running when you switch.

## The recording indicator

While a recording exists, the project header shows its state beside the
Preview and Dashboard switch. It stays there on every pane, with the chat open
or collapsed, on a phone, and after reloading the page; the time continues
from when the recording started.

- **Starting recording…**: the app is restarting with the recorder.
- **Recording 2:14 · 37 requests** (a command shows runs), with **Stop**.
- **Stopping…**: Vibe64 is finishing the files. **Stop** stays available and
  stopping again is safe.
- **Recording ready · 37 requests**, with **Open** and **×** (dismiss). It
  stays for 10 minutes unless dismissed.
- **Recording failed**, with **Details** (the reason) and **×**.

On a phone, and where the header is narrow, it is shorter: **2:14 · 37** with
a stop icon, **Ready · 37** with an open icon. Select the indicator itself for
a menu (a sheet on a phone) with the target, time, count, **Open results**
and **Stop recording**.

**Open** or **Open results** shows Architecture › Usage › Recording with this
recording selected; on a phone it shows the project instead of the chat. You
can open results while still recording to see what has run so far. Opening a
finished recording also removes it from the header; it stays in the list of
recordings.

## When a recording stops

A recording stops when you select **Stop**, and also by itself:

- after 10 minutes, or 2,000 Preview requests;
- when its files reach their size limit;
- when the recorded command finishes (a Preview that restarts keeps
  recording);
- when the session is closed or archived;
- when something goes wrong while recording.

The indicator's menu says which one happened. Requests still in progress when
it stops may be incomplete.

## When it does not work

- **A recording is already running in this session. Stop it first.** Stop or
  wait for the current one.
- **Recording needs an active session.** Archived sessions cannot record.
- **This target cannot be recorded.** The project's runtime has no recorder,
  or the target changed. Choose another.
- A refusal with a reason, such as the machine being busy: nothing was
  started. Try again later.
- **Recording failed** with **The application did not load the recorder.**:
  the target does not run a supported runtime directly, for example when a
  script starts another program. Ask the coding agent to make the target run
  the app directly, or record another target.
- **Recording needs Node.js 22.15 or later.** or another version message:
  update the runtime the project uses.
- **The recorder could not read its recording files.** or **The recorder
  stopped after an internal error.**: start a new recording.

If the results look empty, check that you used the app while the indicator
said **Recording**, and turn on **Show requests that ran no project code**.

## Keeping and deleting recordings

Each session keeps its 10 newest recordings, within 64 MiB and for 7 days.
Older ones are deleted when a new recording starts or the session opens.
Recordings are not part of the project's source or of archived sessions; they
are deleted with the session.

## Who can record, and what Colleague can do

Starting, stopping, dismissing and deleting recordings needs control of the
session, the same as controlling its Preview. People who can only view the
session can see recordings and their results.

Colleague can explain recording and the results and walk you through these
steps. It cannot start or stop a recording or read recording files itself:
you select **Record**, **Start recording** and **Stop**.
