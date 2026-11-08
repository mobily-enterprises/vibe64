# Archive a session

This continues [Create and switch sessions](sessions.md).

Select the session, choose **Archive session**, and confirm **Archive session**
in the dialog. This stops its assistant and terminals, preserves the session and
removes its active workspace. Desktop and mobile use the same confirmation.
Archiving does not Save. Work the project does not have yet, such as an added
starter, stays only in the session archive, and archived sessions cannot restore
source to the project. When the session has unsaved changes, the dialog says how
many and its button reads **Archive without saving**; choose **Cancel**, then
**Save**, to keep them. When Vibe64 has not yet confirmed whether the work is
saved, the dialog says so. A new session starts from the project's saved source,
so it does not contain an archived session's unsaved work.
An OpenCode session can be archived before its main chat has started; an idle
assistant with no native conversation does not need a main-turn Stop request.
Its helper conversations and terminals still go through normal cleanup.
Archiving also cancels pending Main, temporary-chat and AI task routing, waits for its
owned helpers to stop, then closes native work through the normal cleanup path.
You do not need to send the pending request or change AI accounts to close it.
If routing cleanup takes longer than 30 seconds, the session stays available
with a retryable cleanup error; choose **Archive session** again. A new request
arriving during cancellation can also require another Close attempt. Pinning,
renewal and active workspace preparation still prevent archival. While a
renewal is unfinished, Archive says so and names both ways out: open the renewal
and choose **Retry** to finish it, or **Cancel renewal** to discard its fresh
session (see [Cancel a failed renewal](session-renewal.md#cancel-a-failed-renewal)). Once the
renewal is cancelled, **Archive session** works as usual.
Archiving uses the session's saved assistant even after a server restart; it
does not require connecting a different assistant just to stop that session.
If a local editor ends uncleanly (a crash, a closed terminal or a forced
shutdown) while Claude is working, its Claude process ends with it, and after
the restart that chat can be read, messaged, archived and removed as usual.
After a Vibe64 restart, a Codex or OpenCode turn it stopped ends without an
error and gets its recovery snapshot.
A session whose workspace could not be created never started its assistant, so
archiving it skips that assistant's cleanup; it also does not hold the project
open or make project Close fail.
A session whose workspace could not be created, or whose source an earlier
archive attempt already removed, can still be archived the same way.
When Vibe64 starts, it finishes archives a restart interrupted. A session it
cannot finish is named in the server log with the reason, and the other sessions
are still finished. If the server is too busy to open an archived session, for
example under memory pressure, the error says so and you can try again later;
the archive itself is not damaged.
If history preservation fails, the operation reports the error and keeps the
workspace for retry. Resolve the reported problem, then retry **Archive session**.
When a helper such as a Database copilot, a source explanation or a naming helper
cannot be closed, archiving still stops every other part of the session first.
The error then names each part that could not stop, such as
`Database copilot: The database copilot helper could not be closed: <reason>.
Retry before asking again.`, and a source explanation or copilot that could not
close is kept so the retry closes it. Resolve the named reason, often an AI
account to reconnect, then retry **Archive session**. Archiving also closes the
session's open temporary chats in the browser; their saved history stays with
the archived session, as does that of its AI tasks. None of them continues
anywhere, so their AI conversations are cleaned up with the main chat's
([archived AI history](coding-agent-history.md#attachments-and-saved-history)).
A chat or AI task whose **Close** did not finish (it shows
as closing) finishes closing first, with its AI conversations. If that still
fails, archiving stops before anything else with **A chat in this session could
not finish closing: <reason>. Resolve that, then try again.** and the session
stays open; resolve the reason, often an AI account to reconnect, then retry
**Archive session**. If a [Fix it with AI task](ai-tasks.md) is running, the dialog
says **An AI task is still running. Archiving cancels it.** and archiving ends that
fix as **Not done**.
If the last open session cannot be archived, its chat is selected again so you
can inspect the failure and retry. If another session is already selected, that
selection stays in place and the failed session becomes available in its tab.
Colleague can explain these steps and the reported error. When you explicitly
ask it to archive a named session, it first checks that session's saved-work
status. If the session has unsaved changes, or their status is unconfirmed, it
tells you how many, offers **Save**, and archives only after you confirm
archiving without saving. It archives through the same action; the same pin,
renewal and preparation guards apply, and it reports a failed cleanup for retry.
Stopping an agent or ending Colleague is never an archive request.
