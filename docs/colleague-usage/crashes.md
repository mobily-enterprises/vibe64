# See and report a Vibe64 crash (Crashes)

When Vibe64's own server ends unexpectedly, every page of the editor shows a red
banner across the top until the workspace owner acknowledges it. A crash is a
defect in Vibe64 itself, never something your project did: report it so it gets
fixed.

## The banner

The owner (and you, on your own computer, where you are the owner) sees:

> **Vibe64 crashed at 04:18: read ECONNRESET.** The AI work that was running was
> resumed.

The time is in your own time zone, with the day before it when it was not today.
After the message comes what became of the AI work that was running: **No AI work
was running.**, **… was resumed.**, **… was stopped.**, or how many of several
turns were resumed. When it has not been counted yet, nothing is said about it.
When more than one crash waits, the banner counts them: **Vibe64 crashed 3 times;
the last at 04:18: …**

Its buttons:

- **See crashes** opens the **Crashes** page (`/app/crashes`).
- **Copy for a bug report** copies everything the record says as plain text: the
  error, its code and stack, the Vibe64 version, the process, how long it had run
  and the AI turns. The button says **Copied** once it worked. Paste it into your
  bug report as it is.
- **Acknowledge** says you have seen it. The banner goes for everyone, and the
  record keeps who acknowledged it and when. It covers the newest crash you were
  shown and every older one; a crash after that brings the banner back.

Everyone else in the workspace (members) sees a smaller red line instead, without
the error: **Vibe64 crashed at 04:18 and restarted. The AI work that was running
was resumed. The workspace owner can see what happened.** Members cannot open the
Crashes page or acknowledge; the server refuses with "Only the workspace owner can
see and acknowledge crashes."

A restart the host announced beforehand is not a crash: it shows a green
**Restarted for an update at 07:40. Nothing was lost.** message instead, and no
red banner. See [A planned restart of the workspace](planned-restarts.md). Nor is
a restart whose stop took longer than its second: Vibe64 ends what still runs and
notes it in its log, and records no crash.

## The Crashes page

**Crashes** lists every recorded crash, newest first. Each shows its message,
what became of the AI work, the version, process, how long it had run, the error
code, and the whole stack; **Not acknowledged yet.** in red, or **Acknowledged by
… at …**. Each has its own **Copy for a bug report**. **Acknowledge this crash**
(or **Acknowledge all 3**) at the top does what the banner's button does. With no
crash it says **Vibe64 has not crashed here.**

Kinds of crash:

- **An error**: Vibe64 hit an error nothing handled (such as `read ECONNRESET`)
  or stopped with an error code. It wrote the record itself before it ended.
- **It stopped without a trace**: the process was gone without a word, as after
  a forced kill, running out of memory or a power cut. The next start found it
  and recorded it, with when it was last heard from and, where the host says, how
  it ended (for example `oom-kill`). Its time reads **about 04:17**, the last
  time it was heard from.
- **Its crash record could not be read**: the record's file is damaged. It is
  shown, but not counted in the banner.

The latest 100 crashes are kept. Older ones are removed, and the page says how
many: **Only the latest 100 crashes are kept: 3 older ones were removed.**

## Where the records are

Each crash is a small JSON file in Vibe64's system folder, in
`crashes/records/`, readable only by the account that runs Vibe64. A host's own
reports read them there too, as a host reports its own server.

## Ask Colleague

Colleague can explain the banner, the kinds of crash and how to report one. It
cannot read the crash records, because an error's message or stack can hold
secrets, and it cannot acknowledge them for you. Open **See crashes**, use **Copy
for a bug report**, and paste the text where you report the bug; check it for
anything private first.
