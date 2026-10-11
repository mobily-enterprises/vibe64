# Read file interfaces and exact code

Open **Dashboard → Files → Repo**, then select a source file. The default view is
**Public interface**, listing the public/exported symbols available from the
project's selected language parser. Visibility follows that language's conventions.
Callable signatures show indexed parameters and return information when available.
The view explains that definitions can be operations, components, values or types.
File exports are not automatically the subsystem's intended API. Select a
definition to read its details; the empty detail area explicitly asks for a selection.
Unrecorded return information is omitted; this does not mean a function returns
nothing. Coverage is partial; an empty list does not prove there is no public interface.
For Python, a static `__all__` list determines module exports. Dynamic or
conditional exports leave coverage partial and use naming conventions; review
the analysis warning rather than treating the list as complete.
Public values, properties, types and callables follow the selected language's
declarations. For example, a Rust item declared `pub(crate)` displays **Visibility:
crate**; it is available within that scope, not an unrestricted external API.
Symbol **Code** retains declaration keywords, modifiers, decorators and attached
attributes. A grouped declaration can include more than one named value. Build
configuration, macro expansion and conditional compilation remain outside static
coverage; use the project's declared preparation/verification for runtime proof.

Select a symbol to request its **Description** in English through the existing
Helper explanation panel. **Steps** requests an ordered English account of its
decisions, data flow and effects; meaningful pseudo-variable names can clarify the
steps. **Code** displays that symbol's exact source range. **File summary** and
**File steps** describe the complete file with the service's existing bounded
context. **Code · whole file** opens the existing editable source view; **Interface**
in the header returns to public symbols. The controls are available on desktop
and mobile. The compact header keeps the full path beneath the title and
whole-file Code control; file actions stay together when space permits.
Explicit immersive Code view still opens the editor directly.
Long declarations scroll horizontally within the Code area; the public-symbol
list and presentation controls stay within the available pane width.

Explanation requests require an available assistant and obey the same existing
account, access, admission and cancellation rules as **Explain file or selection**.
If the Helper is unavailable, its status appears before the definition list,
even before you select an item. Description and Steps remain disabled; signatures
and whole-file Code can still be read. This notice does not invent an explanation
for missing source or assistant evidence.
The panel retains **Stop**, retry and follow-up controls. Description and Steps
have separate caches; cached answers remain scoped to the same source, account
and verified Helper profile. Explanations are generated interpretation, not proof.

An out-of-date index disables symbol-range use. **Refresh analysis** rebuilds
available analysis; **Code · whole file** and whole-file descriptions remain
available without a supported parser. Unsaved edits disable generated
explanations and indexed range use until saved. Save with the existing **Save now**
control; conflicts retain the existing draft and recovery workflow. A source change
between selection and explanation is rejected rather than describing the wrong
range. For a symbol, the server resolves its indexed identity and checks that
declaration against the saved file; browser-supplied selection coordinates do
not determine the symbol explanation. Missing or invalid analysis offers
**Refresh analysis**; oversized analysis retains Code and ordinary selection
explanations. Binary/download-only files retain their normal preview/download
controls.

Colleague can explain these steps and offer supported navigation. It cannot read
source text or request source investigation through usage knowledge; such work
belongs to the coding conversation and its existing authorized operations.

Vue single-file components expose a **default component** interface even when
they use script setup or contain only a template. Its **Code** covers the complete
component declaration. Explicit functions and other public declarations remain
available according to the selected language analysis.

From Architecture, enter a subsystem and scroll to its graphical files. Click or tap a
file icon once or press Enter to open only that file inside the
subsystem square. Selecting a subsystem public signature goes directly to its
implementation file and selects that exact declaration, including a resolved
re-export's original implementation. The same interface and explanation service
is used; there is no project-wide folder tree, Open file or Find in files in
this file view. Whole-file Code is read-only. A mouse wheel, two-finger touchpad
movement or a one-finger phone swipe scrolls the file, even at a scroll boundary.
Scroll out on the canvas outside the square, or Ctrl-scroll/pinch anywhere, to
return to its file icons. Outward zoom never opens a file. **×** at the top right
or Esc goes back one level. The subsystem breadcrumb returns to its retained interface and file browser;
**Engine** to the retained map. Use Dashboard Files for editing and project-wide
browsing. A stale, ambiguous or unavailable implementation identity never
selects a guessed declaration.

Saved informational interpretations remain readable when the Helper is unavailable.
**Matches saved source** identifies a current answer; **Stale — source or guidance
changed** retains the old text with its warning. **Regenerate** requests a new
answer through the Helper. Source edits invalidate freshness. Initial completed
answers are privately cached across reopening and service restart; follow-up
messages do not silently replace them. They are not passed to coding agents.
