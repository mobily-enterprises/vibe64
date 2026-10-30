# Browse your project's architecture

Open **Dashboard → Architecture**. The sheet shows UI pages, screens or scenes
above the Engine subsystem map. UI parents sit above their children; registered
web routes show their host-relative paths. Independent roots remain independent.
Hierarchy comes from recorded navigation, including explicit registration and
filesystem routing when the selected technology uses it. Paths alone do not
prove a parent relationship.

Engine subsystems are circles showing a readable name, directory root, purpose,
available public declarations and measured source size. Declared application
entries say **Start here**. Supporting directories are subdued. Circle diameters
use a bounded logarithmic source-line scale: larger owners look larger, while
even tiny owners retain a readable minimum and huge owners cannot dominate
the canvas. Unknown source sizes receive the minimum. Source size does
not prove architectural importance. The map keeps every indexed source owner,
including directories outside Stack's default subsystem parents. The canonical
list and responsibilities come from `genesis/subsystems.md`; Architecture is the
single subsystem/Program view, replacing the older list screen. Each subsystem
has one directory root; a nested owner keeps its own files. The current map
does not impose layers or draw Engine import arrows.

**Shared libraries** form a fixed vertical stack on the right. The project must
designate them explicitly; a package name or many consumers does not make an
owner a library. **External dependencies**, farther right, lists observed direct
packages alphabetically. Select a package name to read its available public
declarations and import paths in a compact panel. Package internals stay opaque:
there is no source tree or invented source-line count. Close the panel with **×**.
Package and source-owner discovery belong to the selected analysers, so the
viewer needs no language or package-manager-specific controls.

For text ownership, generation triggers and freshness, see
[Where Architecture explanations come from](architecture-explanations.md).

## Map and Usage

The **Map | Usage** switch at the top chooses between this map and **Usage**,
which starts from one entry point (a page, route, command, library export and
so on) and shows only the files it imports, the functions its exact and
probable calls reach, or what one recorded request ran. Page cards and zoomed subsystems, Programs and files
offer **Show usage** to open it there. See
[See what one entry point uses](usage-map.md).

## Explore by zooming

1. Click or tap a subsystem to enter with a smooth zoom. Alternatively,
   place the pointer over it and scroll or pinch in. That initial
   element owns the gesture even if the moving sheet puts a neighbour under the
   pointer. The circle grows and moves towards the centre together.
2. At reading size it becomes a square on the same canvas. A faint circle remains
   behind it. A compact skeleton appears while the interface is prepared.
3. **Explanation** shows the subsystem’s full authored responsibility inline.
   The shortcuts follow reading order: **Explanation**, **Programs** when present,
   **Interface**, then **Files**.
   **Programs** lists its associated capabilities. Select a Program to open its
   own compact view inside Architecture, with an opening preview, **Main source file**
   and **Supporting files**. **Read full explanation** opens the complete authored
   text in a separate scrollable dialog, filling the screen on phones. Close it
   with **×**, Esc or a click outside on desktop to return to the unchanged Program
   view. The subsystem list limits each Program preview to two lines. Click a source icon to open that file with the shared
   Files viewer. A gold border, star and **Main · …** identify the mandatory main
   source; supporting icons say **Part of · …**. A library can participate in
   another subsystem’s Program without changing source ownership.
   There are no links to the raw Genesis subsystem or Program documents here.
   If Program descriptions need refresh, correct the authored declarations through
   normal Files editing and use **Architecture options → Re-scan project**.
   The subsystem responsibility stays readable while Program evidence is invalid.
   **Interface** lists recorded functions, methods, components, values and types.
   Select a signature to reach its implementation and exact declaration.
   Unknown return information is omitted. Drag across text to select and copy it;
   selecting signature text does not open the implementation.
4. Graphical **Files** appear below the interface as soon as the selected
   subsystem's detail is ready. Use the **Files** shortcut at the top to reach them immediately, or scroll down.
   **Interface**, **Explanation** and **Programs** jump to their sections in the same retained document. Direct files appear before subdirectories at every level.
   Open a folder's disclosure arrow; **Find a file** filters
   names and paths and exposes matching folders. File bars and icon heights
   compare measured source size within this subsystem. A dash means unavailable
   size. Icons and extension labels distinguish file types. **Sort** offers
   **Name**, **File type** and **Size · largest first**; unavailable sizes come
   last. Folders remain alphabetical below files. Sorting retains folder state
   and search. **Entry** marks a file with recorded boundary evidence; hover for details.
5. Click or tap a file icon once, or focus it and press Enter. Only that
   file's interface opens inside the square. Selecting a subsystem signature
   likewise opens only its implementation file, with the requested declaration
   selected. The project-wide Files workspace does not open.
6. The file is a document with an **Explanation** field and **File exports**.
   **Generate explanation** fills an empty field; **Update explanation** refreshes
   saved text. Reopening displays the saved explanation directly, without a chat.
   Select a callable signature to reveal its **Pseudocode** field and use
   **Generate pseudocode**, **Update pseudocode** or **Code**. **Code · whole file**
   uses the same editor, Save now, autosave, Undo/Redo and download controls as
   Files, with its file browser hidden. **Interface** returns to the document.
   **Part of …** and **Main Program file** open the dedicated Program view. Helper
   progress and **Stop** stay in the field while generation runs. These cached
   interpretations check saved source and remain informational; they do not change
   Genesis documents or enter the coding agent's context.
   See [Read file interfaces](file-interfaces.md).
7. Scroll out on the uncovered canvas outside the square to return through the
   enclosing views, or use the breadcrumb: **Engine → subsystem → Program → file**.
   Inside the square, a mouse wheel, two-finger touchpad movement or a one-finger
   phone swipe scrolls its contents. Reaching the top or bottom does not turn
   scrolling into zoom. Pinch or Ctrl-scroll explicitly zooms anywhere, including
   over file icons. Pinching changes magnification; opening a file uses a click
   or tap. Zoom out never opens an icon or pulls a new target towards
   the centre. Returning from a file restores the enclosing reading view before
   its icon grew, keeping the square's surrounding canvas accessible. **×** at
   the top right or Esc goes back one level; both retain the enclosing view's state.
   Esc also works after generation temporarily releases keyboard focus.
   A compact reminder beneath the breadcrumb shows these scroll, zoom and return rules.

**← Back**, **×** and Esc retrace Program and file links, including links to
another subsystem. Back restores the previous file and exact declaration, or
the Program and its source icons. With no nested view history,
it returns to the enclosing subsystem or map. **×** and Esc always close the
current level; breadcrumbs jump directly to their named view.

The map stays mounted while hidden, retaining its arrangement. The file browser
stays mounted behind a file interface, retaining its search, folder disclosures
and selection. The latest file viewer also stays mounted while hidden within
that subsystem, including behind a Program view. Re-entering a subsystem and interrupted gestures use the same
navigation. The file viewer reuses the sheet's analysis; hiding views suspends
their reads while retaining existing facts. A session change resets the local view. The square has compact
signature rows instead of equal-height cards. The square fits the canvas height;
long interfaces and file lists scroll inside it while the breadcrumb stays visible.
Resizing the window or chat divider keeps the open square visible, preserving
its zoom, scroll position and selected declaration. Returning through file links
uses the resized enclosing view.
Drag empty canvas outside the square to pan. There is no source-subsystem
side pane, extra toolbar row or pane-balance slider.

## Read the API evidence

**Imported by other subsystems** identifies particular declarations named in
cross-boundary imports, with consumer counts. It does not prove runtime calls or
intended API membership. **Declared API** shows explicit package/module exports;
**Exports from externally used files** are exports from files imported across
the boundary; use of those individual exports is not established. **Other available exports** is collapsed initially and
can include internal or unused declarations. **Find a signature** searches these
groups. **Import paths** are the names another part imports to access the API, such as
`@local/vibe64-voice/client`. They explain how to reach an interface; the
signatures explain what it offers. They remain secondary detail.
Hover a group heading for its definition. Short notices keep missing intended
API and partial import coverage visible beside the signatures.

Expand **Imported by …** beneath a signature to see full paths of its importing
files. Click a path to open that file inside Architecture; **← Back**, **×** or Esc
returns to the signature list with the disclosure retained. The same disclosure
is available under **Other available exports** and **Declared API**. Imports within
the same subsystem are included; the group still reflects cross-boundary
classification. **No recorded imports** means the current analysis found none,
not that an export is unused. **Source file imported
by …** shows file-level evidence only: these consumers import the source file,
without proving that they import the particular export. These groups do not divide
public from private or used from unused. The list reflects recorded imports,
not every possible runtime consumer.

Missing declarations do not mean an empty API. Import coverage is shown explicitly;
namespace, dynamic, build-dependent or unresolved imports may remain partial.
Signatures link only when analysis identifies one implementation declaration;
re-export aliases retain their public name and lead to the original source.
External package declarations have no project source link.

Ordinary source indexing retains an unchanged UI map. If source or Stack changes
invalidate that evidence, **UI map needs refresh** offers **Re-scan project** to
run the project's configured inspector. Engine files remain browsable meanwhile.

A coding conversation can inspect source and propose corrections to the
subsystem responsibilities, public-operation explanations and boundary roots in
Genesis's editable Blueprint, Program and subsystem map. It can also author
Vibe64's **Architecture layout** Stack section: exact roots grouped for presentation, with explicitly designated libraries/support. This changes
presentation, not native ownership. Require source citations and separate
declared intent from observed usage when reviewing a proposal. An AI can
identify a directory root outside default Stack grouping; it must not invent
an owner or treat import counts as proof of responsibility.

## Follow UI calls

UI-call arrows are hidden initially. Select a page to show only its evidenced
connections, including calls through components. Click empty canvas to clear
that focus. **Architecture options → Show all UI calls** shows every resolved
connection; **Hide UI calls** hides them. UI hierarchy connectors remain visible.

Purple arrows identify protocol, operation and receiving controller file. They
run from the page to that file's separate port on its subsystem's left edge.
Zoom into the receiving subsystem; **Receives UI calls** opens the corresponding
file. An exact controller declaration is selected when the inspector supplies
its identity. Otherwise the file's interface opens without guessing a function.
HTTP, RPC, WebSocket and local calls use the same validated observation contract.
Unresolved or ambiguous calls stay explicit; they never produce guessed arrows.
**UI calls not analysed** identifies unconfigured discovery. An absent arrow
does not prove that no runtime call exists.

## Arrange, fit and refresh

Drag empty space to pan. **Fit** returns to the complete map. **Architecture
options** (**⋯**) contains **Fit UI**, **Fit Engine**, **Zoom in**, **Zoom out**, the
UI-call toggle, **Reset arrangement**, **Reload architecture** and **Re-scan project**.
In Usage the menu keeps only **Reload architecture** and **Re-scan project**. On mobile use the
top bar's **Show project** control if chat fills the screen, then use the same
menu, pinch and pan; folder and file controls remain keyboard accessible.
The existing chat divider controls workspace width.

Use a subsystem's **⠿** grip to arrange it within the application map. Ordinary
circle clicks open it. Left/Right arrow keys move a focused grip sideways.
Libraries and the dependency column retain their fixed side positions.
**Reset arrangement** restores analysis order. Arrangement is local to the
retained view and changes no source ownership or relationship.

Opening reads existing facts without running inspectors. A failed load shows
**Retry loading**; **Reload architecture** rereads existing snapshots. If a local
preview was restarted, reload its browser tab to reconnect. **Re-scan project**
rebuilds the whole project browsing index through Stack's declared finite inspectors.
Source parsing runs once; UI inspectors use that scan before Genesis checks
the inputs again and saves it. Previously loaded facts remain available during
the scan. Existing indexes are read as saved; opening a file never triggers it.
It reads existing Genesis documents; it does not rewrite Program or generate
file or function explanations. This project-wide action is in Architecture
options, never the file view. The running stage and elapsed seconds show what is happening.
Leaving Architecture does not stop the scan. Returning restores its original
elapsed time, and other viewers of that session see the same progress. While it
runs, **Cancel analysis** replaces **Re-scan project**; a racing second request
joins the existing scan instead of starting another one. Progress and completion
arrive through live updates. Returning or reconnecting rereads the server state,
including a failure that happened while the view was closed. Use **Reload
architecture** if a connection warning persists. Scan status lasts for the current
server process; it does not claim that an interrupted scan survived a server restart.
**Cancel analysis** waits for cleanup and preserves the previous valid index.
Large refreshes have a ten-minute request budget; inspectors retain their own
finite limits. Invalid output, changed source or missing prerequisites leaves
the previous index and an inline error. **Command output** shows bounded inspector
diagnostics; no second blocking dialog is opened. Correct the declaration/command or
finish preparation, then retry. Missing page evidence asks for Stack navigation
inputs and a technology inspector. An Engine-only project needs no UI pages.

Colleague can explain these controls and offer supported navigation through its
existing authorized actions. A how-to answer does not authorize execution.
Source inspection, explanations and declaration changes belong to the coding
conversation; usage knowledge grants Colleague no source, shell or screenshot
access.
