# See what one entry point uses

Open **Dashboard → Architecture** and choose **Usage** in the **Map | Usage**
switch at the top. Usage starts from one entry point and shows only what it
reaches, instead of the whole project. Choose **Map** to return to the full
architecture map exactly as you left it.

An entry point is where work starts: a page, component, route, action,
library export, command, job, Program operation or test file. Projects without
pages still have entry points, such as commands or library exports.

## Pick an entry point

On a wide screen, the entry points are listed on the left and the chosen one
is named above the modes as **Entry: <name>**. On a phone, tap **Choose an
entry** (or **Entry: <name>**) to open the same list full screen.

- **Search entries** matches names and file paths.
- The chips filter by kind and show how many of each exist. Only kinds the
  project has are shown.
- Each row shows the entry's name, kind icon and file.

If the list says **No entry points found yet. Refresh the architecture scan.**,
choose **Refresh**. That runs the same scan as **Architecture options →
Re-scan project**.

From **Map**, **Show usage** opens Usage for what you are looking at:

- on a page card, that page;
- in a zoomed subsystem, its directory;
- on a Program, its operation;
- on a file, that file.

When exactly one entry matches, Usage opens it straight away; otherwise the
list is filtered so you can pick one.

## Choose what to follow

The mode switch has three choices:

- **Imports**: the project files the entry imports, directly or indirectly.
  Imports used only for types are left out.
- **Calls**: the functions the entry may call. Each call is **exact** (the
  analyser proved the target), **probable** (likely, for example by method
  name) or **unresolved** (the target could not be worked out). Probable calls
  may list several possible targets. Turn on **Exact only** to follow only
  proven calls.
- **Recording**: what actually ran for one request or run you recorded. See
  [Record what runs](usage-recording.md) for making a recording.

A page or component starts from every function in its file, including the
file's top-level code.

## Read the result

**Subsystems.** Each subsystem the entry reaches is a card, grouped like the
project's **Architecture layout** (alphabetical when it has none). A card
shows how many files or functions are reached; in Calls also how many are
reached by exact calls alone, and in Recording how many functions ran. Lines
such as **→ Sessions · 2 exact** count the calls or imports into another
subsystem. Subsystems the entry never reaches are hidden; **Show untouched**
shows them faded.

**One subsystem.** Tap a card to see its files or functions, arranged by
distance from the entry: **Start**, **1 step away** and so on. When there is
room for two columns of them they are boxes with arrows:

- a solid arrow is an exact call;
- a dashed arrow is a probable call;
- a short line ending in an open circle marks unresolved calls.

On a phone, or beside the chat on a narrower screen, the same functions are
a list showing **calls N → · called by M ←** for each. **All subsystems** goes
back.

**One function.** Tap a function to open its details (a side panel, or a
sheet from the bottom on a phone):

- **Calls (exact)**, **Calls (probable)**, **Called by (exact)** and **Called by
  (probable)** list the other functions with the code that makes each call.
  Tap one to move to it.
- **Unresolved call:** rows show the expression whose target is unknown.
- **Open source** opens the file at that function's line. The code button on a
  row opens the line of that call. Use the source viewer's way back to return
  to the same Usage view.

A function named **anonymous (line N)** has no name in the code. **top level**
is a file's own code outside any function.

## Recordings

In **Recording**, the list on the left (or behind **Choose a request** on a
phone) shows:

- the recording, chosen from the last ten;
- **Search requests**;
- **Show requests that ran no project code**, off by default;
- the requests, grouped under the click, Enter or form submit that caused
  them, such as **Click: button "Add" (SessionList.vue)**, **Enter: textbox
  "Title"** or **Submit: form "New note"**. Each shows its method, route,
  status and how many files and functions ran. Later requests that no click,
  Enter or submit caused are listed under **Other requests**. A process's
  start-up work is listed first as **Start-up and work outside requests**.

Pick a request to light up only the subsystems that ran. Functions that ran in
most requests of the recording, such as logging or request setup, are counted
as **Shared plumbing** on each card; inside a subsystem they are hidden until
you turn on the **Shared plumbing** chip. Each function shows how many times
it ran. Arrows between them come from the static calls.

A function marked **changed** (**Changed since the last scan** in its
tooltip and list row) ran from a file that has changed since Architecture was
scanned; **not scanned** (**Not in the last scan**) means the scan does not
know it. Re-scan to see their calls. Calls are read only in the languages of
the project's Stack components; a function in any other language shows **Calls
not read in this file's language**, and re-scanning does not change that.

Some web servers handle every request in one shared process. Their code is
then shown as one row, **Not separated per request for this server**, with
everything that ran while recording.

**Record** in the mode bar is always there; where the bar is narrow it is a
record icon with the tooltip **Record**. When no part of the project can be
recorded, Usage says **Recording not available for this project's runtimes**
and names them; Imports and Calls still work.

## When the view says more

- **Source changed since the last scan — Refresh** means the project changed
  after the scan. Results still show the last scan until you refresh.
- **Showing the first 300 — Show more** appears when one subsystem holds more
  than fits. **Show more** raises the limit to 1,000.
- **Calls are not available here** means the scan did not read calls for this
  entry or project. **Show Imports** still shows the files it reaches.
- The scan reads calls only while Git ignores `.genesis/call-web.json`.
  **Refresh** sets that up itself in the clone's own Git settings, without
  changing project files. If it cannot (for example in a linked Git worktree),
  Usage says **Git does not ignore .genesis/call-web.json in this project**,
  and recorded functions show **Calls not read: Git does not ignore the call
  web**. Add `/.genesis/call-web.json` to the project's `.gitignore`, then
  refresh.
- Errors offer **Retry**. **This entry point is not in the current scan.**
  offers **Choose another**.
- Before the project's first scan there is nothing to retry: the entry list
  says **No entry points found yet. Refresh the architecture scan.**, and a
  recorded request says **Not scanned yet**. Both offer **Refresh**, which
  runs the scan.

The address keeps the chosen entry, mode, subsystem, recording and request, so
reloading the page or sharing the address with someone on the same project
reopens the same view.

## What the evidence means

Imports and Calls are read from the code without running it. A probable call
might not happen, and an absent arrow does not prove that nothing calls a
function: dynamic calls stay unresolved. A recording shows what ran in that
one recording only. Use Calls to see what may happen and Recording to see
what did.

Colleague can explain these views and walk you through them. It cannot read
the project's source or recordings itself; questions about specific code belong
in a coding conversation.
