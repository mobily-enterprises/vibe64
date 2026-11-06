# Make, open, star, refresh, archive and restore pages

A page is an HTML page the AI makes for the project: a report, a comparison, a
status overview, a dashboard or a diagram. Everyone with access to the project
can open it. Pages belong to the project, not to a session or the repository:
archiving or renewing the session that made one leaves the page alone, and
pages are never part of **Save work**.

## Ask the AI to make a page

In the main chat or a temporary chat, ask in your own words, for example
"make a page summarising this project's structure that my colleague can open"
or "put the test results somewhere the team can see them". You do not need to
name a command.

Pages look finished by default: a bold title with when it was updated, summary
tiles with the key counts, then sections of cards with coloured status labels,
tables and charts, in light and dark mode and on a phone. To change the look,
ask the AI ("make it more compact", "add a chart of the test times").

- When you say a result is for someone else (a colleague, the team, a client,
  your manager, a meeting) or that you will come back to it, the AI makes the
  page straight away and gives you its link.
- After an answer that would read better as a page (a report, comparison,
  status or progress overview, dashboard, diagram, plan or review), the AI ends
  with a one-line offer, such as "Want this as a page everyone on the project
  can open?". Answer yes to get it. It does not offer pages for quick answers or code changes, and
  offers once per topic.
- To change a page, ask the AI to update it ("add last week's numbers to that
  page"). It updates the same page, so its link stays the same, instead of
  making a second one. To undo an update, ask it to bring back the previous
  version, or use **Versions** in the page (below).

Everyone on the project can open every page, so never ask for passwords, keys
or anything private to go into one.

## Open a page

- **From the chat:** a page link in a message, the AI's or one you paste, shows
  as a card with the page's title and when it was last updated. Choose **Open**
  on the card, or the link itself. The page opens beside the chat, like Preview;
  on a phone it comes to the front, and **Show chat** goes back to the chat.
- **From the Pages list:** open the Dashboard and choose **Pages** in its
  **Project** group. Choose a page's title or **Open**.

Beside the chat, the page shows its version and last update. **Open in new
tab** shows it on its own in a new browser tab, for the whole screen; if the
browser blocks the tab, allow pop-ups for Vibe64 and choose it again.
**Reload** shows the page's newest version. The **Back** arrow in the top bar
returns to the list.

A page link you open in a tab works for 15 minutes without use and 4 hours at
most; after that, or after Vibe64 restarts, the tab says the link has ended.
Open the page again from Vibe64 to get a new one.

## Star a page to reach it quickly

Choose the star (**Star page**) on a page's chat card, beside its title when it
is open, or at the start of its row in the Pages list. The star fills in. Your
stars are yours alone: other people on the project do not see them. They show
in every session of the project. Choose the filled star (**Unstar page**) to
remove one.

To open a starred page, choose the star button beside the chat's message box
(**Starred**). It lists your starred pages under **Pages**, above your starred
files under **Files**, and **Search** finds either by name. Choose a page and it
opens beside the chat straight away; choose a file and it opens in Files. On a
phone the list opens from the bottom of the screen.

In the Pages list, your starred pages come first under **Current**, each with a
filled star. An archived page leaves your starred pages and comes back when it
is restored. Deleting a page removes it from everyone's stars.

## Bring back an earlier version

A page keeps its last ten versions. Open the page and choose **Versions**: each
kept version shows when it was made and by whom. Choose **Bring back** beside
one to make it the page's newest version, with the title it had then. The
versions after it stay in the list, so this can itself be undone. An archived page must be restored first.

## Archive, restore and delete

- **Archive:** in the Pages list's **Current** tab, or in an open page, choose
  **Archive**. The page moves to the **Archived** tab. It can still be opened,
  but the AI cannot update it.
- **Restore:** in the **Archived** tab, or in an open archived page, choose
  **Restore**. The page returns to **Current**.
- **Delete:** only an archived page can be deleted. In the **Archived** tab,
  choose **Delete**, then **Delete** again to confirm. This removes the page
  and all its kept versions for everyone and cannot be undone.

## Keep a page up to date

Ask the AI for a page that keeps itself up to date, in your own words, for
example "make a page of the open issues that updates itself every hour" or "a
test results page that refreshes every morning at 8". It can refresh every so
many minutes or hours, never more often than every 15 minutes, or daily at a set
time. When a page's content will change, the AI also offers to keep it up to
date. To change or stop a page's refreshes, ask the AI ("refresh it every 2
hours instead", "stop refreshing that page"); a page that stops refreshing keeps
its last version.

A refresh changes only the page's data, never its layout, and each one that
works is a new version of the page. It reads the project as last saved with
**Save work**, never a session's unsaved changes. It runs as the person who set
it. There are two kinds:

- **A script** (the usual kind): the AI writes a small script that collects the
  data. Vibe64 runs it on its own on each refresh; no AI is used. Where Vibe64
  doesn't run refresh scripts, the AI sets an AI refresh instead, and a script
  refresh already set pauses and says why.
- **An AI refresh** (**· AI** in the list): for data that needs judgement, such
  as a summary of the week's work. Each refresh is a short AI task in the session
  the refresh was set from, with the AI that session uses, and shows there like
  any AI task ([Fix a problem with AI](ai-tasks.md)). Keep that session open.

### See how a page's refreshes stand

In the Pages list, the **Refreshes** column shows how often a page refreshes and
how it stands. An open page shows the same beside its version.

- **Next** and a time: when it refreshes next.
- **Refreshing…**: a refresh is running.
- **Refresh failed** and a time, in red: the last refresh failed. The page keeps
  its last good version.
- **Paused:** and why, in red: it refreshes no more until someone resumes it.
  A refresh also pauses when the person who set it can no longer run it, for
  example once they can no longer open the project; resuming makes it yours.
- **Stopped while archived**: an archived page doesn't refresh.

Under it:

- **Refresh now** runs a refresh at once; the schedule carries on as before.
- **Cancel**, while a refresh runs, stops it. The page keeps the version it has.
- **Pause** stops the refreshes until **Resume**. Resuming runs them as you
  from then on.
- **Log** lists the last ten refreshes, newest first: how each ended, why, and
  what it printed. A failed AI refresh has **Open its AI task**, which shows
  what the AI did, until the next AI task starts in that session.

### When refreshes pause or skip

- Three refreshes fail in a row.
- An AI refresh's AI account isn't available. Sign in again, then **Resume**.
- An AI refresh's session is no longer open. Ask the AI in an open session to
  set the refresh again.
- Someone chose **Pause**.

When another AI task is open in an AI refresh's session at refresh time, that
refresh is skipped (**Skipped** in the log) and the next one runs as planned. A
refresh never starts while the last one is still running. If Vibe64 was stopped
when refreshes were due, the page refreshes once as soon as it starts again,
not once for each missed time.

Archiving a page cancels a refresh that is running and stops its refreshes.
Restoring it starts them again from then.

## What a page can and cannot do

A page runs in a sandbox. It shows only its own files: it cannot see Vibe64,
your sign-in, other projects or other pages, and it cannot send anything to
another address or load files from the internet. A page that needs a library
carries its own copy. Links inside a page open only its own files.

## What Colleague can do

Colleague can explain these steps. Making and updating a page, and setting,
changing or stopping its refreshes, are done by the session's AI in the chat.
Opening, archiving, restoring and deleting pages, and **Refresh now**,
**Cancel**, **Pause**, **Resume** and **Log**, are done by you in the Pages list
or the open page.
