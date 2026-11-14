# See what happened in a session (session timeline)

Each session keeps a short **timeline** of what happened to it, so you, or
whoever helps you, can see why an AI turn stopped or why the page said the
connection was lost. It is read with one command in a terminal on the computer
that runs Vibe64; there is no screen for it.

## Read it

List the sessions that have a timeline, most recent first:

```sh
npx vibe64 timeline
```

Each line shows when the session's timeline last changed, its project, its
session id and its size. A session's id is also the end of its working branch,
`vibe64/<session id>`.

Show one session, oldest event first:

```sh
npx vibe64 timeline 2026-11-14_04-58-00
```

```text
2026-11-14T05:00:00.000Z  Browser tab connected (tab tab:5f…; user owner)
2026-11-14T05:00:05.000Z  Turn started (Main chat; engine claude; message message_tab_…; asked by owner; via POST /api/…)
2026-11-14T05:00:06.000Z  Turn running (Main chat; engine claude; turn 7c…)
2026-11-14T05:01:00.000Z  Browser tab disconnected (tab tab:5f…; user owner; reason: ping timeout)
2026-11-14T05:01:30.000Z  Browser tab reconnected (tab tab:5f…; user owner; after 30 s offline)
2026-11-14T05:02:10.000Z  Turn finished (Main chat; engine claude; turn 7c…)
```

Narrow it down:

| Option | Shows |
| --- | --- |
| `--since 2h` | Events from the last two hours. Also `90s`, `30m`, `7d`, or an ISO time such as `2026-11-14T05:00:00Z`. |
| `--until TIME` | Events before that time. |
| `--kind turn,connection` | Only those kinds: `turn`, `conversation`, `process`, `connection`, `request`, `server`. |
| `--project NAME` | The project to use when two projects have a session with that id; the command says so. |
| `--json` | One JSON object per line, for tools. |
| `--state-root DIR` | Another Vibe64 state folder (see below). |

`npx vibe64 timeline --help` prints the same list. A session without a timeline
answers **No timeline for session …**.

## What it records

- **Turns**: a message that started a turn or joined the running one, a
  message that was not sent (with its error code), the turn running, and how it ended:
  finished, failed, interrupted, cancelled, stopped at its deadline, or Vibe64
  losing sight of it. **Cancel requested** and **Stop requested** say who asked,
  why (such as `cancel-message`) and through which request; `via background`
  means Vibe64 asked by itself. Each line names the chat (**Main chat**, a **temporary
  chat** or an **AI task window**) and the AI engine.
- **Conversations**: temporary chats and AI tasks opened and closed, and an
  AI engine session closed, for example when the session's AI changes.
- **AI engine processes**: a Claude Code process started, stopped by Vibe64
  (with the reason), or exited (with its exit code or signal).
- **Browser connections**: each browser tab that opens the session, leaves it,
  disconnects (with the reason, such as `ping timeout` or `transport close`)
  and reconnects (with how long it was away). A dropped connection never stops
  a running turn; the timeline shows the two side by side.
- **Failed requests**: a request about the session that failed on Vibe64's side
  (status 500 or above), with its method, route, status and error code.
- **Server stopping**: Vibe64 stopping while the session was in use.

It records ids, states, reasons and error codes only. It never holds your
messages, the AI's replies, prompts, tool output, file contents or secrets.

## Where it is kept

The timeline stays on the computer that runs Vibe64, beside the session's other
state: `<state folder>/projects/<project>/timeline/<session id>.jsonl`. The
state folder is `~/.local/state/vibe64` on Linux (or `$XDG_STATE_HOME/vibe64`),
`~/Library/Application Support/Vibe64` on macOS, or the folder in
`VIBE64_SYSTEM_ROOT` when Vibe64 was started with it; `--state-root` reads
another one.

Only the account that runs Vibe64 (and the computer's administrator) can read
it. Nothing sends it anywhere: to share it, copy the lines you want to share.

A session keeps at most two files of 1 MB each: when the newest is full it
replaces the older one, so a busy day keeps its most recent events. A
timeline untouched for 14 days is removed.

## Colleague

Colleague can explain what each timeline line means and which options to use,
but it does not run terminal commands and cannot read the timeline itself:
run the command and paste the lines you want explained.
