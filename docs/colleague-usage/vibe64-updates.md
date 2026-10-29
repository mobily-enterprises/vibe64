# When Vibe64 is updated

A browser tab keeps running the version of Vibe64 it loaded until it reloads.
After Vibe64 is updated and restarted, an open tab reconnects by itself, but
it still runs the old version, so fixes in the update do not reach it yet.

When the tab reconnects to a Vibe64 that serves a different version, a banner
appears at the top of the page:

**Vibe64 was updated. Reload to get the latest version.** with **Reload**

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

Vibe64 notices the update only when the tab reconnects after the restart; it
does not keep asking. A tab that stayed connected because Vibe64 was not
restarted does not show the banner.

Colleague can explain the banner and what reloading keeps or loses. It cannot
see whether a tab shows the banner and cannot reload your tab: choosing
**Reload** requires your interaction.
