# When Vibe64 is updated

A browser tab keeps running the version of Vibe64 it loaded until it reloads.
After Vibe64 is updated and restarted, an open tab reconnects by itself, but
it still runs the old version, so fixes in the update do not reach it yet.

When the tab reconnects to a Vibe64 that serves a different version, a banner
appears at the top of the page:

**Vibe64 was updated. Reload to get the latest version.** with **Reload**

- **A plain reload is enough.** Choosing **Reload**, the browser's reload
  button or opening Vibe64 again loads the new version. You never need a hard
  reload (Ctrl+Shift+R, or Cmd+Shift+R on a Mac) or to clear the browser's
  cache.
- **Nothing reloads by itself.** Finish or save what you are doing first. Chat
  drafts stay in this browser when browser storage is available, but an open
  dialog or an unsaved form is lost when the page reloads.
- **Reload** first checks that Vibe64 answers, then reloads the same address,
  so you return to the same project and page. If Vibe64 cannot be reached, the
  banner **The app cannot reload because the app server is not reachable.
  Restart the server, then click Reload.** appears instead. Wait until Vibe64
  is back, then choose **Reload** again.
- Closing the banner hides it for that version. It returns only for a later
  update. Until you reload, the tab keeps running the old version.
- Reconnecting to the same version does not show the banner again. If Vibe64
  goes back to the version the tab is running, the banner disappears.
- Each tab checks for itself: reload every open Vibe64 tab that shows the
  banner.
- The banner and its button are the same on desktop and phone.
- Running Vibe64 from source in development mode (`npm run dev`) has no
  version to compare, so the banner never appears there; the development
  server updates the page itself.

A tab still running the old version may also open a part of Vibe64 that the
update replaced, before the banner shows. It then shows **App module did not
download. The app may have been updated, or the network request failed.** (or
**Page did not download. …**) with **Reload** and **Close**. Choose **Reload**:
it opens the same address on the new version.

Vibe64 notices the update only when the tab reconnects after the restart; it
does not keep asking. A tab that stayed connected because Vibe64 was not
restarted does not show the banner.

Colleague can explain the banner and what reloading keeps or loses. It cannot
see whether a tab shows the banner and cannot reload your tab: choosing
**Reload** requires your interaction.

## While Vibe64 restarts

Vibe64 is unreachable for a few seconds while it restarts for an update. An
open tab carries on by itself, and you don't need to do anything:

- After a moment without an answer, a banner at the top of the page says
  **Updating…**. It goes away by itself when Vibe64 answers again, usually
  within half a minute. Closing it only hides it.
- What the page was loading finishes once Vibe64 is back. Live updates (chat,
  status, lists) catch up by themselves.
- Something you do while the banner shows (sending, saving, starting) waits
  and is done once Vibe64 is back, exactly once.
- If Vibe64 stays unreachable for about a minute, the page says so in words:
  **Vibe64 can't reach the editor. It may be updating; try again in a
  moment.** A part of the page that could not load offers **Retry** (for
  example **Projects could not reach the server or network**), and
  **Updating…** stays until Vibe64 answers. Something you did then says
  **Vibe64 couldn't reach the editor, so this wasn't done. Try again in a
  moment.**
- If the restart cut off something already under way, Vibe64 may not know
  whether it finished. It never repeats it on its own, and says **Vibe64 lost
  contact with the editor while doing this, so it can't tell whether it was
  done. Check, then try again if it wasn't.** Look at the result first, for
  example the file, the list or the chat, before you try again.
- When Vibe64 itself answers that something can't be done right now (a
  service it uses is down, for example), that is not a restart: its own
  message shows at once, usually with **Retry**, and no **Updating…** banner
  appears.
- The banner and messages are the same on desktop and phone.

Colleague can explain the banner and these messages. It cannot see whether a
tab shows them, and waiting for Vibe64 to come back needs nothing from you.
