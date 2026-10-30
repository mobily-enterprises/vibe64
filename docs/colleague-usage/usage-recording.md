# Record what runs

A recording shows which of the project's own functions ran while you used the
app in Preview, or while one of the project's commands ran, counted for each
request or run. Use it to see what a page, button or command really executes.
The results open in **Architecture** › **Usage** › **Recording**; see
[Usage map](usage-map.md) for reading them.

Vibe64 saves which functions ran (their file, name and lines) and how often,
and for each request its method, path, status and time. A path is saved
without the part after `?`, and each long id or token in it, such as a UUID or
the code in a reset link, is saved as `[redacted]`; shorter ids are kept. For
each click, form submit or Enter in Preview it saves the element's role, up to
40 characters of the text the page shows for it (its visible text or label)
and the component file it belongs to; a password field is saved only as
"password field". It never saves what you type, request contents, headers,
cookies, query strings or function arguments, and the recorder opens no
network port. Anyone who can view the session can read its recordings.

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
results. Reloading the page, or using Preview in a second browser tab, keeps
each click's requests grouped under that click. A command starts running at
once and the recording follows that run.

The scripts, styles, images and fonts a page loads, including a development
server's modules, are counted instead of listed: with **Show requests that ran
no project code** on, the requests list says how many were counted. Preview
logs up to 20,000 other requests per recording. After that the results say
**Request log full; later requests not recorded**: what later requests ran is
still recorded, under **Request not in the request log**, but their method,
path and status are not.

Only one recording runs in a session at a time. Other sessions are not
affected, and a recording in another session keeps running when you switch.

## Runtimes

Recording follows the project's server-side code in Node.js, Python and PHP.
Code that runs in the browser is not recorded. A target whose runtime has no
recorder, such as Go or Rust, shows **Recording not available for `<runtime>`**
in the Record dialog.

Arrows between recorded functions come from the architecture scan's calls,
which it reads only in the languages of the project's Stack components. A
function in another language shows **Calls not read in this file's language**.
When Git does not ignore `.genesis/call-web.json` and Vibe64 could not set that
up itself, functions show **Calls not read: Git does not ignore the call web**;
add `/.genesis/call-web.json` to the project's `.gitignore`, then refresh the
scan.

### Node.js

Node.js 22.15 or newer. Every Node.js process of the recorded target loads
Vibe64's recorder at startup. Only your project's own `.js`, `.mjs`, `.cjs`,
`.ts`, `.mts` and `.cts` files are recorded, never files under `node_modules`.
Each Preview request that reaches a Node.js server is recorded on its own. A
terminal target records the whole run. Work outside any request, such as the
server starting up, is listed first as **Start-up and work outside requests**.
Each file's top-level code counts as one function. After **Stop** the recorder
switches itself off.

### Python

Python 3.12 or newer. While a recording is on, every Python process of the
recorded target loads Vibe64's recorder at startup. Your project's own
`sitecustomize` still runs. Servers built on the standard library's
`http.server`, which include Django's `runserver` and the Flask/Werkzeug
development server, record each Preview request separately. Other servers,
such as ASGI servers like uvicorn, or gunicorn, record all their work
together, and the results say **Not separated per request for this server**.
A terminal target records the whole run of each Python process. Only your
project's files are recorded: files outside `node_modules`, `vendor`,
`site-packages`/`dist-packages` and any virtualenv inside the project. Each
function's calls are counted. Decorated functions show at their `def` line;
generator expressions and class bodies count as part of the code around them.
Recording slows CPU-heavy Python code to about twice its normal time. After
**Stop** the recorder switches itself off and costs nothing. Nothing is
recorded when Python is older than 3.12 (the recorder reports it), or when the
target starts Python with `-I`, `-E` or `-S`; then the recording says the
application did not load the recorder.

### PHP

Recording works with non-thread-safe PHP 8 (the usual command-line build).
Thread-safe (ZTS) PHP, which FrankenPHP uses, shows **Recording not
available**.

**Before the first recording.** PHP recording uses a small module built for
your computer's PHP. Until it is built, the Record dialog shows **Recording
not available** with the command to run:

    node <vibe64>/packages/vibe64-usage-recording/runtime/php/build.mjs

It needs `phpize` and `php-config` from your PHP's development package (for
example `php8.3-dev`), `make` and a C compiler. Add
`--php-config=/path/to/php-config` to build for a PHP that is not first on
PATH, and `--force` to rebuild. A build is reused for the same PHP version.
When a Vibe64 update changes the recorder, the dialog asks for the command
again. The module loads only into recorded processes, through
`PHP_INI_SCAN_DIR`. Your own PHP settings and extensions keep loading as
before.

**What is separated per request.**
- `php artisan serve` and `php -S`, with or without a router script, record
  each request on its own, including several workers answering at once
  (`PHP_CLI_SERVER_WORKERS`).
- A command-line run (a terminal Output target, `php artisan` commands,
  scripts) records as one run.
- Worker servers that keep one PHP request alive for many HTTP requests
  (Laravel Octane, RoadRunner, Swoole, FrankenPHP worker mode) show **Not
  separated per request for this server**.

**What it records.** Only project files: the paths, function and method names,
start lines and how many times each ran. Nothing under `vendor/` or
`node_modules/` is recorded.
- Files and named functions match the usage map exactly. Methods are matched
  by their name and line.
- Closures and arrow functions run, but they have no Calls count on the map.
- A function whose whole body returns a constant may be removed by OPcache
  before it runs, so it never appears as called.
- Each file's content is fingerprinted the first time a process runs it. If
  that differs from the last scan, the map shows **Changed since the last
  scan**.

**Stopping.** A running server notices **Stop** at its next request. A request
already running finishes, and its calls are kept.

**PHP from a package manager that sets its own scan directory.** Some PHP
builds (for example Nix's `php.withExtensions`) load their extensions only
while `PHP_INI_SCAN_DIR` is unset. Set `PHP_INI_SCAN_DIR` to that PHP's scan
directory (shown by `php --ini` as "Scan for additional .ini files in") in the
environment that starts your project, and recording keeps those extensions
loaded.

## The recording indicator

While a recording exists, the project header shows its state beside the
Preview and Dashboard switch. On a phone it is a full-width strip directly
below the header instead, so the header keeps its pane switch and **Show
preview controls**. It stays on every pane, with the chat open or collapsed,
and after reloading the page; the time continues from when the recording
started.

- **Starting recording…**: the app is restarting with the recorder.
- **Recording 2:14 · 37 requests** (a command shows runs), with **Stop**.
- **Stopping…**: Vibe64 is finishing the files. **Stop** stays available and
  stopping again is safe.
- **Recording ready · 37 requests**, with **Open** and **×** (dismiss). It
  stays for 10 minutes unless dismissed.
- **Recording failed**, with **Details** (the reason) and **×**.

Where a computer's header is narrow, it is shorter: **2:14 · 37** with a stop
icon, **Ready · 37** with an open icon. Select the indicator itself for a menu
with the target, time, count, **Open results** and **Stop recording**.

On a phone the strip shows the same words in full, with **Stop**, or **Open**
and **×**. Tap the strip itself to open the results (or, for **Recording
failed**, the reason).

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
