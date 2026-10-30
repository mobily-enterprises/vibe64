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
- Each row shows the entry's name, kind icon and file. A page is named by its
  address, such as **/app/project/:slug/dashboard/env**, because many page
  files share names like `index`.

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
- **Calls**: the functions reached from the entry, call by call. Each call is
  **exact** (the analysis proved the target), **probable** (likely, for
  example by method name) or **unresolved** (the target could not be worked
  out). A probable call can list several possible targets. Turn on **Exact
  only** to follow only proven calls.
- **Recording**: what actually ran for one request or run you recorded. See
  [Record what runs](usage-recording.md) for making a recording.

A page or component starts from every function in its file, including the
file's top-level code. Calls then follows the components it renders: a
**renders** step leads from the file's top-level code to each rendered
component's, and all of that component's functions count as one step away.
Their own rendered components are followed the same way, so a page reaches
the requests its components make. A renders step is exact when the tag is
resolved through the file's imports.

## Read the result

**Subsystems.** Each subsystem the entry reaches is a card, grouped like the
project's **Architecture layout** (alphabetical when it has none). A card
counts the files or functions reached, or in Recording the functions that
ran. In Calls it splits the functions: **9 by exact calls · 22 only via
probable** means exact calls alone reach 9, and the other 22 need at least one
probable call. Lines under a card count calls, not functions: **→ Sessions ·
4 exact calls, 3 probable** are the calls into another subsystem, and
**renders 1 component** the components rendered there. In Imports they count
imports. In Recording, **→ Sessions · 9 calls in code** counts the calls the
code makes between functions that ran; it does not say those calls happened.
Subsystems the entry never reaches are hidden; **Show untouched** shows them
faded.

**One subsystem.** Tap a card to see its files or functions, arranged by
distance from the entry: **Start**, **1 step away** and so on. When there is
room for two columns of them they are boxes with arrows:

- a solid arrow is an exact call;
- a dashed arrow is a probable call;
- a short line ending in an open circle marks unresolved calls.

Each box names the function and its file and line, such as
**service.js:12**; its tooltip gives the full path.

On a phone, or beside the chat on a narrower screen, the same functions are
a list instead, without the line legend. Each row says **only via probable
calls** when no exact path reaches it, then **calls N → · called by M ←** and
how many unresolved calls it makes. **All subsystems** goes back.

**One function.** Tap a function to open its details (a side panel, or a
sheet from the bottom on a phone):

- **Calls (exact)**, **Calls (probable)**, **Called by (exact)** and **Called by
  (probable)** list the other functions with the code that makes each call
  and how its target was found, such as **proved by types** or **matched by
  imported name**. Tap one to move to it.
- A note says how the file's calls were read: **Calls read by JSKIT analysis,
  which can prove exact calls**, or **Calls read by name only: probable at
  best** where the project's technology has no deeper analysis.
- **Renders** and **Rendered by** appear on a file's top-level code: the
  components it renders, and the files that render it, with the tag such as
  `<EnvPanel>`.
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
know it. Re-scan to see their calls.

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
- Errors offer **Retry**. **This entry point is not in the current scan.**
  offers **Choose another**.

The address keeps the chosen entry, mode, subsystem, recording and request, so
reloading the page or sharing the address with someone on the same project
reopens the same view.

## What the evidence means

Imports and Calls are read from the code without running it. A probable call
might not happen, and an absent arrow does not prove that nothing calls a
function: dynamic calls stay unresolved. A recording shows what ran in that
one recording only. Calls shows exact and probable calls in the code;
Recording shows what ran.

Colleague can explain these views and walk you through them. It cannot read
the project's source or recordings itself; questions about specific code belong
in a coding conversation.
